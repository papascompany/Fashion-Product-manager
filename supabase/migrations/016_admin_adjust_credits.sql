-- Migration 016: admin_adjust_credits RPC — Admin 크레딧 조정 안전화 (DB-05)
--
-- ─── 적용 절차 ────────────────────────────────────────────────────────────────
-- 1. Supabase Dashboard → SQL Editor 에서 본 파일 전체를 그대로 실행.
-- 2. 적용 후 다음 두 라우트의 동작을 확인:
--    - PATCH /api/admin/users/[id] — creditsDelta 음수 양수 모두 정상 처리
--    - 잔액 부족 케이스에서 409 응답이 떨어지는지 확인
-- 3. 본 마이그레이션은 idempotent — 이미 적용된 환경에서 재실행해도 안전.
--
-- ─── 주의사항 ─────────────────────────────────────────────────────────────────
-- * 본 RPC 는 SECURITY DEFINER + service_role 만 호출 가능. (authenticated 사용자가
--   직접 호출하면 ROLE check 에 의해 거부됨.) Admin 라우트가 createAdminClient()
--   (service_role) 로 호출하므로 정상 동작한다.
-- * 기존 005_*.sql 의 deduct_credits, 006_*.sql 의 add_credits 는 폐기하지 않음
--   (다른 서비스가 의존할 수 있음). Admin 경로에서만 본 RPC 로 전환.
-- * 잔액 부족 시에는 false 반환 + 아무런 변경도 일어나지 않음.
--   호출 측은 false → 409 + INSUFFICIENT_CREDITS code 로 응답해야 함.
-- * audit_log 는 RPC 가 아닌 호출 측(admin route) 에서 RPC 성공 후 기록. (RPC 내부에서
--   기록하면 호출자 actor_id 를 알 수 없음.)
--
-- ─── DB-05 배경 ───────────────────────────────────────────────────────────────
-- 기존 코드 (legacy):
--   if (delta > 0) supa.rpc('add_credits',    { p_user_id, p_amount: |delta| })
--   else           supa.rpc('deduct_credits', { p_user_id, p_amount: |delta| })
--
-- 문제: deduct_credits 는 GREATEST(credits_left - amount, 0) 로 클램프 →
--   잔액 50 사용자에게 -200 을 적용해도 0 으로 보정 + RPC 는 성공 반환.
--   audit_log 에 delta=-200 으로 남지만 실제 차감은 50. 회계 불일치.
--
-- 해결 (본 마이그레이션):
--   admin_adjust_credits(p_user_id, p_delta)
--     - delta > 0 : credits_left + delta  (상한 없음)
--     - delta < 0 : credits_left >= |delta| 일 때만 차감, 아니면 false 반환
--     - delta = 0 : NO-OP 성공
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_adjust_credits(
  p_user_id UUID,
  p_delta   INTEGER
)
RETURNS BOOLEAN  -- true = 성공, false = 잔액 부족 (음수 차감 시에만 가능)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_updated INTEGER;
BEGIN
  -- delta = 0 은 의미 없는 호출 — 성공으로 처리하고 아무 것도 변경하지 않음.
  IF p_delta = 0 THEN
    RETURN TRUE;
  END IF;

  IF p_delta > 0 THEN
    -- 추가: 상한 없이 누적.
    UPDATE public.user_profiles
    SET    credits_left = credits_left + p_delta,
           updated_at   = NOW()
    WHERE  id = p_user_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    -- 사용자 미존재 시에도 false 반환 (호출 측이 409 처리)
    RETURN v_rows_updated > 0;

  ELSE
    -- 차감: 잔액이 충분할 때만 적용. 조건 미달 시 행 0 → false 반환.
    -- (deduct_credits_atomic 과 동일 패턴.)
    UPDATE public.user_profiles
    SET    credits_left = credits_left + p_delta,   -- p_delta 는 음수
           updated_at   = NOW()
    WHERE  id           = p_user_id
      AND  credits_left >= ABS(p_delta);

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    RETURN v_rows_updated > 0;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_adjust_credits IS
  'DB-05: Admin 크레딧 조정 — delta > 0 은 누적 가산, delta < 0 은 잔액 충분 시에만 차감.
   잔액 부족·사용자 미존재 시 false 반환. legacy add_credits/deduct_credits 의 silent
   클램프 문제 해결.';

-- 권한: service_role 만 호출 (Admin 라우트의 createAdminClient).
-- authenticated 에는 부여하지 않음 → 일반 사용자가 직접 RPC 호출 불가.
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_adjust_credits TO   service_role;
