-- =====================================================================
-- Migration 019: user_profiles 권한상승 가드 — 자체 완결 재적용 (정책 + 함수 + 트리거)
-- =====================================================================
--
-- 배경 (2026-08-01 회귀검증):
--   013(정책+함수+트리거) → 014~016 적용 → 018(함수를 SECURITY INVOKER 로 교체)
--   순서로 진행했음에도, 일반 사용자 토큰의
--     PATCH /rest/v1/user_profiles {credits_left:99999, plan:'business', role:'admin'}
--   이 계속 그대로 반영됐다(3회 재현).
--
--   018 은 **함수만** 교체한다. 013 의 `create trigger` 가 실행되지 않았다면
--   (긴 스크립트 붙여넣기 중 앞부분 누락 등) 함수가 아무리 올바라도 호출되지 않는다.
--   014~016 오브젝트는 존재하므로 스크립트 뒷부분만 적용된 정황과 일치한다.
--
-- 이 마이그레이션은 **013 의 어떤 부분이 실행됐는지와 무관하게** 최종 상태를 보장한다.
-- 전부 멱등(idempotent) 이므로 몇 번 실행해도 안전하다.
--
-- 적용: Supabase Studio → SQL Editor 전체 실행.
--       ⚠️ 마지막 SELECT 가 **결과 표를 반환**한다. "No rows returned" 가 뜨면
--          스크립트가 끝까지 실행되지 않은 것이므로 반드시 결과 표를 확인할 것.
-- =====================================================================

-- ─── 1. 정책: users_own(FOR ALL) 제거 + SELECT/INSERT/UPDATE 분리 (013 파트) ──
drop policy if exists "users_own"         on public.user_profiles;
drop policy if exists "users_self_read"   on public.user_profiles;
drop policy if exists "users_self_insert" on public.user_profiles;
drop policy if exists "users_self_update" on public.user_profiles;

create policy "users_self_read"
  on public.user_profiles for select
  using (id = auth.uid());

create policy "users_self_insert"
  on public.user_profiles for insert
  with check (id = auth.uid());

create policy "users_self_update"
  on public.user_profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

alter table public.user_profiles enable row level security;

-- ─── 2. 가드 함수 (018 파트: SECURITY INVOKER 필수) ─────────────────────────
create or replace function public.user_profiles_guard_columns_fn()
returns trigger
language plpgsql
security invoker   -- ⚠️ DEFINER 로 되돌리면 current_user 가 항상 소유자가 되어 가드가 no-op.
set search_path = public
as $$
declare
  v_trusted boolean := false;
begin
  v_trusted := current_user::text not in ('authenticated', 'anon');

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

alter function public.user_profiles_guard_columns_fn() security invoker;
grant execute on function public.user_profiles_guard_columns_fn() to authenticated, anon;

-- ─── 3. 트리거 (013 파트 — 이번 누락 지점) ──────────────────────────────────
drop trigger if exists user_profiles_guard_columns on public.user_profiles;
create trigger user_profiles_guard_columns
  before update on public.user_profiles
  for each row
  execute function public.user_profiles_guard_columns_fn();

-- ─── 4. 적용 결과 확인 (결과 표가 반환된다) ─────────────────────────────────
select 'trigger'  as kind, tgname    as name, '' as detail
  from pg_trigger
 where tgrelid = 'public.user_profiles'::regclass and not tgisinternal
union all
select 'function', p.proname,
       case when p.prosecdef then 'SECURITY DEFINER (✗ 잘못됨)' else 'SECURITY INVOKER (✓)' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'user_profiles_guard_columns_fn'
union all
select 'policy', policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'user_profiles'
order by kind, name;

-- 기대 결과:
--   function : user_profiles_guard_columns_fn | SECURITY INVOKER (✓)
--   policy   : users_self_insert(INSERT) / users_self_read(SELECT) / users_self_update(UPDATE)
--   trigger  : user_profiles_guard_columns
