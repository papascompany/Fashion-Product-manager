-- ═══════════════════════════════════════════════════════════════════════════
-- 024. is_admin() 이 정지(banned) 상태를 반영하도록 수정
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 배경
--   008 의 is_admin() 은 role = 'admin' 만 보고 banned_at 을 무시한다. 이 함수는
--   user_profiles / projects / usage_events 의 "admin reads all ..." RLS 정책의
--   근거이므로, **정지된 관리자 계정이 DB 레벨에서 여전히 전체 사용자 데이터를
--   읽을 수 있다.** 앱 레벨 가드(requireAdmin/checkAdmin)는 banned_at 을 확인해
--   화면 진입을 막지만, RLS 최후 방어선인 이 함수가 뚫려 있으면 authenticated
--   클라이언트로 직접 조회할 때 막히지 않는다.
--
-- 조치
--   is_admin() 정의에 `and banned_at is null` 을 추가한다.
--   활성 관리자(role='admin' AND banned_at IS NULL)만 true.
--
-- 안전성 (양방향)
--   ① 막혀야 — 정지된 admin 은 is_admin()=false 가 되어 "admin reads all ..."
--      정책이 더 이상 열리지 않는다.
--   ② 통과해야 — 정지되지 않은 admin 은 예전과 동일하게 true. is_admin() 은
--      **추가 접근을 부여하기만** 하므로(정책의 USING 절), 더 엄격해져도 일반
--      사용자·정상 관리자 흐름에는 영향이 없다. admin 라우트는 service_role
--      (createAdminClient)로 동작해 이 함수를 타지 않으므로 운영 화면도 무관.
--
-- 멱등 — CREATE OR REPLACE. 여러 번 실행해도 안전.
-- 적용: Supabase Studio → SQL Editor 전체 실행. 마지막 SELECT 가 결과 표를 반환한다.
-- ═══════════════════════════════════════════════════════════════════════════

set search_path = public;

create or replace function public.is_admin()
returns boolean
language sql
security definer    -- RLS 우회 (재귀 차단)
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid()
      and role = 'admin'
      and banned_at is null   -- 024: 정지된 관리자는 관리자로 보지 않는다
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- ─── 상태 확인 (결과 표가 반환된다) ─────────────────────────────────────────
-- 기대: 정의 본문에 banned_at 조건이 포함돼 있어야 한다.
select
  p.proname                              as function_name,
  p.prosecdef                            as is_security_definer,
  (position('banned_at is null' in pg_get_functiondef(p.oid)) > 0) as respects_ban
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'is_admin';
