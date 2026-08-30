-- =====================================================================
-- Migration 021: v_admin_stats 권한 재부여 — Admin 대시보드 42501 복구
-- =====================================================================
--
-- 증상 (프로덕션 런타임 로그, 2026-08-29):
--   [admin/dashboard] stats load failed:
--     { code: '42501', message: 'permission denied for view v_admin_stats' }
--   → 대시보드가 총 가입자·MRR·플랜 분포를 "0" 으로 렌더링했다.
--     (앱 쪽은 이번 배포에서 0 대신 "불러오기 실패" 를 명시하도록 수정됨 —
--      src/app/admin/page.tsx. 이 마이그레이션 없이도 화면은 안전하다.)
--
-- 012 가 의도한 최종 상태 (SEC-14):
--   REVOKE SELECT ON public.v_admin_stats FROM authenticated;  -- 일반 사용자 차단
--   GRANT  SELECT ON public.v_admin_stats TO   service_role;   -- 서버 전용 허용
--   앱은 service_role 로 조회하므로 이 조합이 정답이다. 021 은 이 상태를
--   "몇 번 실행해도 같은 결과" 가 되도록 멱등하게 재적용한다.
--
-- 42501 의 가능한 원인 — SQL 실행 권한이 없어 어느 쪽인지 확정하지 못했다:
--   (A) 012 부분 적용. 019 에서 겪은 "긴 스크립트 붙여넣기 중 일부 누락" 과 같은 유형.
--       REVOKE 만 실행되고 GRANT 가 빠지면 정확히 이 증상이 된다.
--   (B) 뷰 소유자 / security_invoker 문제. 뷰가 security_invoker=true 이면
--       하위 테이블(user_profiles·usage_events)을 호출자 권한으로 읽는다.
--       하위 테이블 GRANT 가 좁혀졌다면 여기서 막힌다.
--       ※ 아래 1번 GRANT 가 'must be owner of view v_admin_stats' 로 실패하면
--         소유자가 postgres 가 아니라는 뜻이고, 그 자체가 (B) 의 직접 증거다.
--   (C) 조회 커넥션의 실제 DB 역할이 service_role 이 아니라 authenticated 인 경우.
--       012 가 authenticated 의 SELECT 를 회수했으므로 같은 42501 이 난다.
--       ⚠️ 이 경우는 SQL 로 고칠 수 없다(고치려면 authenticated 에 다시 GRANT 해야
--          하는데, 그러면 모든 로그인 사용자가 MRR·가입자수를 볼 수 있어 SEC-14 회귀).
--          아래 3번 진단 SELECT 로 (A)/(B) 인지 (C) 인지 판별한다.
--
-- 적용: Supabase Studio → SQL Editor 에서 이 파일 전체 실행.
--       ⚠️ 마지막 SELECT 가 결과 표를 반환한다. "No rows returned" 가 뜨면
--          붙여넣기가 잘려 끝까지 실행되지 않은 것이다 (019 의 교훈).
-- =====================================================================

-- ─── 1. (A) 커버: 012 의 의도한 권한을 멱등 재적용 ──────────────────────────
-- REVOKE 는 권한이 없어도 no-op 이므로 반복 실행해도 안전하다.

revoke select on public.v_admin_stats from authenticated;
revoke select on public.v_admin_stats from anon;          -- 012 에 없던 방어 (SEC-14 의도와 동일)
grant  select on public.v_admin_stats to   service_role;

-- ─── 2. (B) 커버: 하위 테이블의 service_role 읽기 권한 보장 ─────────────────
-- security_invoker=true 인 뷰는 하위 테이블을 호출자 권한으로 읽는다.
-- service_role 은 Supabase 기본값으로 이미 권한이 있는 것이 정상이며,
-- 아래는 "좁혀졌을 경우" 를 대비한 멱등 복구다. RLS 는 service_role 이 우회한다.

grant select on public.user_profiles to service_role;
grant select on public.usage_events  to service_role;

-- security_invoker 자체는 이 마이그레이션에서 바꾸지 않는다.
--   - false(기본): 뷰가 소유자 권한으로 하위 테이블을 읽는다 → service_role 조회 가능
--   - true       : service_role 이 직접 읽는다(RLS 우회) → 역시 조회 가능
-- 둘 다 service_role 경로는 열려 있으므로, 근거 없이 뒤집으면 오히려 회귀 위험이 있다.
-- 실제 값은 3번 진단 결과로 확인한다.

comment on view public.v_admin_stats is
  'SEC-14: 운영 통계 뷰 — service_role(서버 admin 클라이언트) 전용.
   authenticated/anon 에는 SELECT 를 주지 않는다(MRR·가입자수 노출 방지).';

-- ─── 3. 적용 결과 확인 (결과 표가 반환된다) ─────────────────────────────────
-- 기대: service_role_can_select = true, authenticated_can_select = false,
--       anon_can_select = false.
--
-- 판별 규칙:
--   service_role_can_select 가 true 인데도 대시보드가 계속 42501 이면 원인은 (C) 다
--   — 즉 조회 커넥션이 service_role 이 아니라 로그인 사용자(authenticated) 로 나가고
--     있다는 뜻이므로, DB 가 아니라 앱의 admin 클라이언트 생성 경로를 고쳐야 한다.

select
  'v_admin_stats'                                                        as object,
  pg_get_userbyid(c.relowner)                                            as owner,
  coalesce(
    (select option_value
       from pg_options_to_table(c.reloptions)
      where option_name = 'security_invoker'),
    'false'
  )                                                                      as security_invoker,
  has_table_privilege('service_role',  'public.v_admin_stats', 'SELECT') as service_role_can_select,
  has_table_privilege('authenticated', 'public.v_admin_stats', 'SELECT') as authenticated_can_select,
  has_table_privilege('anon',          'public.v_admin_stats', 'SELECT') as anon_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'v_admin_stats';
