-- 017: generations.type CHECK 제약에 'detail_page' 추가
--
-- 배경 (2026-08-01 E2E 스모크 발견):
--   /api/generate/detail-page 가 type='detail_page' 로 insert 하지만
--   001 의 CHECK 제약이 ('analyze','naming','tagline','description','thumbnail')만
--   허용해 23514 로 실패 — 라우트가 에러를 무시해 상세페이지 저장이 조용히 유실됨.
--
-- 적용: Supabase 콘솔 SQL Editor 에서 실행 (013~016 감사 마이그레이션과 독립 —
--       순서 무관하게 단독 적용 가능. 번호만 충돌 회피용 017).

alter table public.generations
  drop constraint if exists generations_type_check;

alter table public.generations
  add constraint generations_type_check
  check (type in ('analyze', 'naming', 'tagline', 'description', 'thumbnail', 'detail_page'));
