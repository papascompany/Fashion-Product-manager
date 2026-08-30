-- =====================================================================
-- Migration 020: 공유 게이트 토대 — shares.token / shares.revoked_at
-- =====================================================================
--
-- 배경 (감사 이슈 2):
--   /share/[projectId] 는 createAdminClient() 로 RLS 를 우회한다. 따라서 게이트가
--   `status = 'done'` 하나뿐이면 **소유자가 한 번도 공유하지 않은 프로젝트**까지
--   URL 만 알면 제3자가 상품명·태그라인·설명·이미지를 전부 열람한다.
--   공유를 되돌릴(회수) 수단도 없다.
--
--   1차 차단은 코드 쪽에서 이미 끝났다:
--     src/app/share/[projectId]/page.tsx 가 `public.shares` 에 해당 project_id 행이
--     존재할 때만 렌더한다(없거나 조회 실패면 404 — fail-closed).
--     이 판정은 **기존 컬럼(project_id)만** 쓰므로 본 마이그레이션 적용 전에도
--     정상 동작한다. 즉 코드 배포와 이 스크립트 적용의 순서는 자유롭다.
--
-- ⚠️ 적용 순서 (중요):
--   이 마이그레이션을 적용한 **후에야** 코드에서
--     - revoked_at 필터 (`.is('revoked_at', null)`) — 공유 취소
--     - token 기반 공유 URL (`/share/[projectId]?t=<token>`)
--   를 켤 수 있다. 순서를 뒤집으면(컬럼이 없는 상태에서 코드가 참조하면)
--   모든 공유 페이지가 즉시 죽는다. 코드에 필터를 켜기 전에 아래 4번 확인 표로
--   두 컬럼이 실제로 존재하는지 먼저 볼 것.
--
-- 전부 멱등(idempotent) 이므로 몇 번 실행해도 안전하다.
--
-- 적용: Supabase Studio → SQL Editor 전체 실행.
--       ⚠️ 마지막 SELECT 가 **결과 표를 반환**한다. "No rows returned" 가 뜨면
--          스크립트가 끝까지 실행되지 않은 것이므로 반드시 결과 표를 확인할 것.
-- =====================================================================

-- ─── 0. gen_random_bytes 준비 ───────────────────────────────────────────────
-- Supabase 는 pgcrypto 를 보통 extensions 스키마에 둔다. 스크립트 실행 동안
-- 검색 경로에 포함시켜 unqualified 호출이 확실히 해석되게 한다.
set search_path = public, extensions;

create extension if not exists pgcrypto;

-- ─── 1. 컬럼 추가 ───────────────────────────────────────────────────────────
alter table public.shares
  add column if not exists token text;

alter table public.shares
  add column if not exists revoked_at timestamptz;

comment on column public.shares.token is
  '공유 링크 시크릿(hex 32자). 향후 /share/[projectId]?t=<token> 검증용. 020 적용 후에만 코드에서 참조할 것.';

comment on column public.shares.revoked_at is
  '공유 취소 시각. NULL 이면 유효. 020 적용 후에만 코드에서 revoked_at 필터를 켤 것.';

-- ─── 2. 기존 행 토큰 백필 ───────────────────────────────────────────────────
-- 이미 토큰이 있는 행은 건드리지 않는다(재실행 시 토큰이 바뀌면 기존 링크가 죽는다).
update public.shares
   set token = encode(gen_random_bytes(16), 'hex')
 where token is null;

-- ─── 3. 인덱스 ──────────────────────────────────────────────────────────────
-- token unique: Postgres 는 NULL 을 서로 다른 값으로 취급하므로, token 을
-- 채우지 않는 기존 insert 경로(/api/share)가 있어도 충돌하지 않는다.
create unique index if not exists shares_token_key
  on public.shares (token);

-- 게이트가 공유 페이지 조회마다 project_id 로 shares 를 확인하므로 인덱스 필수.
-- (001 은 shares 에 project_id 인덱스를 만들지 않았다 — user_id 만 005 에서 추가)
create index if not exists shares_project_id_idx
  on public.shares (project_id);

-- ─── 4. 적용 결과 확인 (결과 표가 반환된다) ─────────────────────────────────
select 'column'::text as kind, c.column_name::text as name, c.data_type::text as detail
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name = 'shares'
   and c.column_name in ('token', 'revoked_at')
union all
select 'index'::text, i.indexname::text, ''::text
  from pg_indexes i
 where i.schemaname = 'public'
   and i.tablename = 'shares'
union all
select 'backfill'::text, 'token_is_null_rows'::text, count(*)::text
  from public.shares
 where token is null
order by kind, name;

-- 기대 결과:
--   column   : revoked_at | timestamp with time zone
--   column   : token      | text
--   index    : shares_pkey / shares_project_id_idx / shares_token_key / shares_user_id_idx
--   backfill : token_is_null_rows | 0
