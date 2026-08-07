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
--    보호 컬럼 변경은 신뢰 경로(service_role 세션 또는 SECURITY DEFINER 크레딧 RPC)에서만
--    허용된다. 일반 authenticated 세션의 직접 UPDATE 는 무력화된다.
--    ⚠️ 크레딧 차감 RPC(deduct_credits_atomic/record_* )는 SECURITY DEFINER 라
--    current_user 가 postgres 로 바뀌어 정상 통과한다(WHK-01 fix). 이 마이그레이션 적용 후
--    반드시 quick 생성 1회로 credits_left 가 실제 감소하는지 확인할 것.
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
-- 신뢰 경로(service_role 세션 + SECURITY DEFINER RPC)만 보호 컬럼 변경 허용.
-- 그 외(authenticated 일반 사용자, anon 의 직접 UPDATE)는 OLD 값을 강제 복원한다.
--
-- WHK-01 fix: 판정 기준을 auth.role() → current_user(DB 역할)로 교체.
--   auth.role() 은 JWT claim 기반이라 SECURITY DEFINER RPC 내부에서도 'authenticated'
--   로 남는다. 그러면 deduct_credits_atomic(012)·record_thumbnail_generation·
--   record_ai_fitting_generation(011) 같은 정당한 크레딧 차감 RPC 의 credits_left
--   UPDATE 가 전부 OLD 로 되돌려져 "모든 유료 생성이 무료"가 되는 치명 회귀 발생.
--   반면 current_user 는 SECURITY DEFINER 함수 내부에서 함수 소유자(postgres)로 바뀌므로
--   "직접 authenticated/anon UPDATE" 와 "신뢰 RPC 내부 UPDATE" 를 정확히 구분할 수 있다.
create or replace function public.user_profiles_guard_columns_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trusted boolean := false;
begin
  -- (1) DB 역할(current_user)이 PostgREST 노출 역할(authenticated/anon)이 아니면 신뢰.
  --     → SECURITY DEFINER RPC 내부(소유자=postgres)와 service_role 세션이 여기에 해당.
  v_trusted := current_user::text not in ('authenticated', 'anon');

  -- (2) 보강: 일부 환경에서 service_role 연결이 SET ROLE 을 안 하는 경우 대비해
  --     auth.role()='service_role' 도 신뢰로 인정.
  if not v_trusted then
    begin
      v_trusted := (auth.role() = 'service_role');
    exception when others then
      v_trusted := false;
    end;
  end if;

  if v_trusted then
    return new;
  end if;

  -- 직접 authenticated/anon UPDATE: 보호 컬럼이 변경되면 OLD 로 강제 복원 (silent revert)
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
  'DB-01: privilege escalation 차단 — 직접 authenticated/anon UPDATE 는 role/plan/credits_left/banned_at/last_model_image_url 변경 무력화. 신뢰 경로(service_role 세션 + SECURITY DEFINER 크레딧 RPC, current_user 기반 판정)만 허용 (WHK-01 fix).';
