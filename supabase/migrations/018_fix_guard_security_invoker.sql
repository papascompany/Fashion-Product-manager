-- =====================================================================
-- Migration 018: 013 가드 트리거 무력화(no-op) 수정 — SECURITY INVOKER 로 교체
-- =====================================================================
--
-- 발견 (2026-08-01, 013~016 적용 후 회귀검증):
--   013 적용 직후에도 일반 사용자 토큰으로
--     PATCH /rest/v1/user_profiles { credits_left: 99999, plan: 'business', role: 'admin' }
--   이 그대로 반영됐다. 즉 가드가 전혀 동작하지 않는 상태였다.
--
-- 원인:
--   013 의 user_profiles_guard_columns_fn() 이 `security definer` 로 선언돼 있다.
--   PostgreSQL 에서 SECURITY DEFINER 함수 내부의 current_user 는 "함수 소유자"로 바뀐다.
--   따라서 트리거 본문의 판정식
--       v_trusted := current_user::text not in ('authenticated', 'anon');
--   은 호출 경로와 무관하게 **항상 true** 가 된다(소유자=postgres).
--   → 직접 authenticated UPDATE 까지 신뢰 경로로 처리되어 가드가 완전한 no-op.
--
--   013 주석의 의도("SECURITY DEFINER RPC 내부에서는 current_user 가 postgres 로 바뀌므로
--   직접 UPDATE 와 구분 가능")는 **트리거 함수가 SECURITY INVOKER 일 때만** 성립한다.
--
-- 수정:
--   함수를 SECURITY INVOKER(기본)로 재정의한다. 그러면 current_user 는 UPDATE 시점의
--   유효 역할이 되어 두 경로가 정확히 갈린다.
--     - 직접 PostgREST UPDATE  : current_user = 'authenticated' → 신뢰 안 함 → OLD 복원 ✅
--     - 신뢰 RPC 내부 UPDATE   : current_user = postgres(함수 소유자) → 신뢰 → 통과 ✅
--       (deduct_credits_atomic·record_thumbnail_generation·record_ai_fitting_generation
--        은 모두 SECURITY DEFINER 이므로 WHK-01 회귀 없음)
--
--   본문 로직은 013 과 동일하며, 권한 승격이 필요 없는 함수라 DEFINER 가 불필요하다.
--
-- 적용: Supabase Studio → SQL Editor 에서 본 파일 전체 실행. 트리거 재생성은 불필요
--       (create or replace 로 함수 본체만 교체 — 기존 트리거가 새 정의를 사용).
-- =====================================================================

create or replace function public.user_profiles_guard_columns_fn()
returns trigger
language plpgsql
security invoker   -- ⚠️ 013 의 security definer 가 가드를 무력화했다. 절대 되돌리지 말 것.
set search_path = public
as $$
declare
  v_trusted boolean := false;
begin
  -- (1) DB 역할(current_user)이 PostgREST 노출 역할(authenticated/anon)이 아니면 신뢰.
  --     SECURITY INVOKER 이므로 여기서의 current_user 는 UPDATE 시점의 유효 역할이다.
  --     → SECURITY DEFINER RPC 내부(소유자=postgres)와 service_role 세션만 신뢰된다.
  v_trusted := current_user::text not in ('authenticated', 'anon');

  -- (2) 보강: service_role 연결이 SET ROLE 을 안 하는 환경 대비.
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

  -- 직접 authenticated/anon UPDATE: 보호 컬럼 변경을 OLD 로 강제 복원 (silent revert)
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

-- create or replace 가 보안 속성을 유지하는 환경 대비 — 명시적으로 재설정.
alter function public.user_profiles_guard_columns_fn() security invoker;

-- 트리거 함수는 UPDATE 를 수행하는 역할이 실행하므로 EXECUTE 권한을 보장한다.
grant execute on function public.user_profiles_guard_columns_fn() to authenticated, anon;

comment on function public.user_profiles_guard_columns_fn() is
  'DB-01 (018 fix): privilege escalation 차단 — 직접 authenticated/anon UPDATE 는 role/plan/credits_left/banned_at/last_model_image_url 변경 무력화. SECURITY INVOKER 필수 — DEFINER 로 되돌리면 current_user 가 항상 소유자가 되어 가드가 no-op 이 된다.';

-- 적용 후 검증
-- ---------------------------------------------------------------------
-- (a) 차단 확인 — 일반 사용자 토큰으로 자기 행 UPDATE 시도 후 값이 그대로여야 한다.
-- (b) 회귀 확인 — 썸네일/피팅 생성 1회 후 credits_left 가 정상 차감돼야 한다(WHK-01).
