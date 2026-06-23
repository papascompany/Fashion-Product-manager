-- =====================================================================
-- Migration 013: user_profiles RLS 잠금 — privilege escalation 차단
-- =====================================================================
--
-- 적용 절차 / 주의사항 (한국어)
-- ---------------------------------------------------------------------
-- 1. Supabase Studio → SQL Editor 에서 이 파일 전체를 복사하여 실행한다.
-- 2. 실행 후 즉시 아래 검증 쿼리로 일반 사용자가 role/plan/credits_left
--    컬럼을 변경할 수 없음을 확인한다.
--      -- 일반 인증 세션으로:
--      update public.user_profiles set role = 'admin' where id = auth.uid();
--      -- 결과: 성공처럼 보이나, 트리거가 OLD 값을 강제 복원하므로 실제 변경 없음.
-- 3. 운영 중 admin 승격은 반드시 service_role (Supabase 대시보드 SQL Editor 의
--    "Run with service_role" 또는 서버 코드의 createAdminClient) 로 수행해야 한다.
--    auth.role() = 'service_role' 일 때만 보호 컬럼 변경이 허용된다.
-- 4. 롤백:
--      drop trigger if exists user_profiles_guard_columns on public.user_profiles;
--      drop function if exists public.user_profiles_guard_columns_fn();
--      drop policy if exists "users_self_read" on public.user_profiles;
--      drop policy if exists "users_self_insert" on public.user_profiles;
--      drop policy if exists "users_self_update" on public.user_profiles;
--      -- 그리고 001 의 users_own FOR ALL 정책을 재생성해야 한다(권장하지 않음).
-- 5. 영향 컬럼: role, plan, credits_left, banned_at, last_model_image_url
--    last_model_image_url 은 사용자가 모델 사진을 새로 올릴 때 갱신이 필요할 수
--    있으므로 향후 별도 RPC(set_last_model_image_url) 로 우회 경로 마련 고려
--    (현재는 보수적으로 잠금).
-- =====================================================================

-- ─── 1. 기존 "users_own FOR ALL" 정책 제거 (privilege escalation 차단) ───────
drop policy if exists "users_own" on public.user_profiles;

-- ─── 2. 분리된 정책: SELECT / INSERT / UPDATE ──────────────────────────────
drop policy if exists "users_self_read"   on public.user_profiles;
drop policy if exists "users_self_insert" on public.user_profiles;
drop policy if exists "users_self_update" on public.user_profiles;

create policy "users_self_read"
  on public.user_profiles
  for select
  using (id = auth.uid());

-- INSERT 는 사실상 handle_new_user 트리거가 수행하지만 안전망으로 자기 행만 허용.
create policy "users_self_insert"
  on public.user_profiles
  for insert
  with check (id = auth.uid());

-- UPDATE 는 자기 행에 한해 허용하되, 아래 BEFORE UPDATE 트리거가 보호 컬럼을
-- OLD 값으로 강제 복원하여 self-elevation 을 차단한다.
create policy "users_self_update"
  on public.user_profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ─── 3. 보호 컬럼 가드 트리거 (role/plan/credits_left/banned_at/last_model_image_url) ──
-- auth.role() = 'service_role' 인 경우(서버 admin 클라이언트)만 보호 컬럼을 변경 가능.
-- 그 외(authenticated 일반 사용자, anon)는 OLD 값을 강제 복원한다.
create or replace function public.user_profiles_guard_columns_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_service boolean := false;
begin
  -- auth.role() 은 PostgREST/Supabase 세션에서 'service_role' / 'authenticated' / 'anon' 반환.
  -- service_role 세션이면 통과시킨다.
  begin
    v_is_service := (auth.role() = 'service_role');
  exception when others then
    v_is_service := false;
  end;

  if v_is_service then
    return new;
  end if;

  -- 일반 세션: 보호 컬럼이 변경되면 OLD 로 강제 복원 (silent revert)
  if new.role is distinct from old.role then
    new.role := old.role;
  end if;
  if new.plan is distinct from old.plan then
    new.plan := old.plan;
  end if;
  if new.credits_left is distinct from old.credits_left then
    new.credits_left := old.credits_left;
  end if;
  if new.banned_at is distinct from old.banned_at then
    new.banned_at := old.banned_at;
  end if;
  if new.last_model_image_url is distinct from old.last_model_image_url then
    new.last_model_image_url := old.last_model_image_url;
  end if;

  return new;
end;
$$;

drop trigger if exists user_profiles_guard_columns on public.user_profiles;
create trigger user_profiles_guard_columns
  before update on public.user_profiles
  for each row
  execute function public.user_profiles_guard_columns_fn();

comment on function public.user_profiles_guard_columns_fn() is
  'DB-01: privilege escalation 차단 — service_role 이외의 UPDATE 는 role/plan/credits_left/banned_at/last_model_image_url 변경 무력화.';
