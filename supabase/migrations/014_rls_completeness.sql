-- =====================================================================
-- Migration 014: RLS 완전성 보강
--   - usage_events INSERT 정책 추가 (DB-02)
--   - product-images / ai-fittings storage 폴더 prefix 강제 (DB-04)
--   - ai_fittings DELETE 정책 추가 (DB-07)
-- =====================================================================
--
-- 적용 절차 / 주의사항 (한국어)
-- ---------------------------------------------------------------------
-- 1. Supabase Studio → SQL Editor 에서 본 파일 전체 실행.
-- 2. ai-fittings 버킷이 미생성 상태면 먼저 Dashboard → Storage → "Create bucket"
--    으로 ai-fittings (public read) 를 만들고 본 마이그레이션을 적용한다.
-- 3. storage.objects 정책은 service_role 이 소유한다. 정책 이름이 이미
--    존재하면 drop policy if exists 로 안전하게 재생성한다.
-- 4. 검증 쿼리:
--      -- usage_events: 인증 사용자가 자기 user_id 로만 insert 가능
--      insert into usage_events (user_id, event_type) values (auth.uid(), 'test');
--      -- 성공해야 함
--      insert into usage_events (user_id, event_type) values (gen_random_uuid(), 'test');
--      -- 거부되어야 함 (new row violates RLS)
--
--      -- ai_fittings: 자기 프로젝트의 fitting 만 삭제 가능
--      delete from ai_fittings where id = '<자기 fitting id>';   -- 성공
--      delete from ai_fittings where id = '<남 fitting id>';      -- 0 rows
-- 5. 롤백:
--      drop policy if exists "usage_events_insert_own" on public.usage_events;
--      drop policy if exists "usage_events_insert_service" on public.usage_events;
--      drop policy if exists "product_images_user_insert" on storage.objects;
--      -- 기존 004 의 정책을 재적용해야 한다.
-- =====================================================================

-- ─── 1. usage_events INSERT 정책 (DB-02) ─────────────────────────────────────
-- 002 마이그레이션은 SELECT 만 정의했고 INSERT 정책이 없어, 일반 사용자가
-- usage_events 에 직접 insert 시도하면 silent drop 된다.
-- (실제 운영 코드는 service_role 로 insert 하므로 영향 없었으나, 정합성 확보용.)
drop policy if exists "usage_events_insert_own" on public.usage_events;
create policy "usage_events_insert_own"
  on public.usage_events
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- ─── 2. Storage product-images 폴더 prefix 강제 (DB-04) ──────────────────────
-- 004 마이그레이션의 INSERT 정책은 'bucket_id + authenticated' 만 검증하여
-- 다른 사용자 폴더에 임의 업로드가 가능했다. path 의 첫 segment 가 자기
-- auth.uid() 와 일치해야만 허용하도록 좁힌다.
drop policy if exists "product_images_user_insert" on storage.objects;
create policy "product_images_user_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "product_images_user_update" on storage.objects;
create policy "product_images_user_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "product_images_user_delete" on storage.objects;
create policy "product_images_user_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── 3. Storage ai-fittings 정책 (DB-04) ─────────────────────────────────────
-- ai-fittings 버킷에는 정책이 정의된 적 없으므로 동일 패턴으로 신규 작성.
-- 결과 이미지는 public read 가능, 업로드/수정/삭제는 본인 폴더만.
drop policy if exists "ai_fittings_public_read" on storage.objects;
create policy "ai_fittings_public_read"
  on storage.objects
  for select
  using (bucket_id = 'ai-fittings');

drop policy if exists "ai_fittings_user_insert" on storage.objects;
create policy "ai_fittings_user_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'ai-fittings'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "ai_fittings_user_update" on storage.objects;
create policy "ai_fittings_user_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'ai-fittings'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'ai-fittings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "ai_fittings_user_delete" on storage.objects;
create policy "ai_fittings_user_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'ai-fittings'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── 4. ai_fittings DELETE 정책 (DB-07) ──────────────────────────────────────
drop policy if exists "users delete own ai_fittings" on public.ai_fittings;
create policy "users delete own ai_fittings"
  on public.ai_fittings
  for delete
  using (
    project_id in (
      select id from public.projects where user_id = auth.uid()
    )
  );
