# Migration 013 / 014 / 015 적용 가이드 (Track 1 — 결제·RLS 핫픽스)

> 이 가이드는 ProductCraft AI 운영 DB(Supabase) 에 다음 3개 마이그레이션을
> 안전하게 적용하기 위한 절차서입니다. **모든 SQL 은 Supabase Studio →
> SQL Editor 에서 service_role 권한으로 실행해야 합니다.**

| 파일 | 목적 | 핵심 변화 |
| --- | --- | --- |
| `013_user_profiles_lockdown.sql` | 권한 상승 차단 | `users_own FOR ALL` 제거, 자기 행 SELECT/INSERT/UPDATE 만 허용 + 보호 컬럼 가드 트리거 |
| `014_rls_completeness.sql` | RLS 사각지대 정리 | `usage_events` INSERT, storage(`product-images`/`ai-fittings`) 폴더 prefix, `ai_fittings` DELETE |
| `015_payment_idempotency.sql` | 결제 무결성 | `pending_orders`, `processed_webhook_events`, `subscriptions.toss_order_id UNIQUE`, RPC 3개 |

---

## 0. 사전 점검

```sql
-- (a) 동일 toss_order_id 중복이 있는지 — 있으면 015 UNIQUE 추가가 실패
select toss_order_id, count(*)
  from public.subscriptions
 where toss_order_id is not null
 group by toss_order_id
 having count(*) > 1;

-- (b) ai-fittings 버킷이 존재하는지 (014 가 정책을 만들기 전 필수)
select id from storage.buckets where id = 'ai-fittings';
-- 결과가 없으면 Dashboard → Storage → Create bucket 'ai-fittings' (Public read 권장)
```

## 1. 적용 순서

순서를 지켜야 합니다. (013 → 014 → 015)

1. **013** : user_profiles 정책 교체. 일반 사용자가 role/plan/credits 변경
   시도하더라도 트리거가 OLD 값을 강제 복원하므로 즉시 효과 발생.
2. **014** : usage_events INSERT 정책, storage objects 폴더 prefix, ai_fittings
   DELETE 정책. 운영 코드는 service_role 사용이라 호환 깨짐 없음.
3. **015** : pending_orders, processed_webhook_events, subscriptions.toss_order_id
   UNIQUE, RPC 3개 (apply_payment_event, apply_payment_cancel,
   cleanup_expired_pending_orders).

## 2. 적용 후 검증 쿼리

### 013 검증 — privilege escalation 차단 확인

```sql
-- 일반 사용자 세션(authenticated)으로 실행 (Studio 의 "Impersonate user" 기능 사용)
update public.user_profiles
   set role = 'admin', plan = 'business', credits_left = 99999
 where id = auth.uid();

-- 업데이트는 성공처럼 보일 수 있지만, 다시 SELECT 하면 OLD 값이 그대로:
select role, plan, credits_left from public.user_profiles where id = auth.uid();
-- 기대 결과: role = 'user', plan = 'free' (또는 service_role 이 설정한 값),
--           credits_left = (원래 값)
```

### 014 검증 — RLS 완전성

```sql
-- usage_events 자기 user_id 외에는 INSERT 거부
insert into public.usage_events (user_id, event_type) values (auth.uid(), 'test');
-- 성공
insert into public.usage_events (user_id, event_type) values (gen_random_uuid(), 'test');
-- ERROR: new row violates row-level security policy

-- storage product-images: 자기 폴더만 업로드 허용 (PostgREST 가 아닌 storage API 로 테스트)
-- ai_fittings DELETE: 자기 프로젝트만 가능
delete from public.ai_fittings where id = '<own-fitting-id>';   -- 성공
delete from public.ai_fittings where id = '<other-fitting-id>'; -- 0 rows
```

### 015 검증 — 결제 멱등성 + amount

```sql
-- 1. pending_orders 사전 등록 (실제는 /api/payments/prepare 가 수행)
insert into public.pending_orders (order_id, user_id, kind, key, expected_amount)
values ('plan-pro-test-001', auth.uid(), 'plan', 'pro', 49900);

-- 2. 정상 케이스
select public.apply_payment_event('plan-pro-test-001', 49900, 'evt-001');
-- 기대: {"processed": true, "kind": "plan", "key": "pro", "credits_added": 200}

-- 3. 멱등성 (같은 event_id 재호출)
select public.apply_payment_event('plan-pro-test-001', 49900, 'evt-001');
-- 기대: {"processed": false, "reason": "duplicate_event"}

-- 4. amount 위조 시도
insert into public.pending_orders (order_id, user_id, kind, key, expected_amount)
values ('plan-pro-test-002', auth.uid(), 'plan', 'pro', 49900);
select public.apply_payment_event('plan-pro-test-002', 5500, 'evt-002');
-- 기대: {"processed": false, "reason": "amount_mismatch", "expected_amount": 49900, "received_amount": 5500}
```

## 3. 롤백 절차

복원이 필요하면 아래 SQL 을 역순으로 실행하세요. (가능하면 git 상의 이전
마이그레이션을 참조해 일관성을 유지.)

```sql
-- 015 롤백
drop function if exists public.cleanup_expired_pending_orders();
drop function if exists public.apply_payment_cancel(text, text);
drop function if exists public.apply_payment_event(text, integer, text);
drop function if exists public.payment_credits_for(text, text);
drop table if exists public.processed_webhook_events;
drop table if exists public.pending_orders;
alter table public.subscriptions drop constraint if exists subscriptions_toss_order_id_key;

-- 014 롤백
drop policy if exists "users delete own ai_fittings" on public.ai_fittings;
drop policy if exists "ai_fittings_user_delete"   on storage.objects;
drop policy if exists "ai_fittings_user_update"   on storage.objects;
drop policy if exists "ai_fittings_user_insert"   on storage.objects;
drop policy if exists "ai_fittings_public_read"   on storage.objects;
drop policy if exists "product_images_user_delete" on storage.objects;
drop policy if exists "product_images_user_update" on storage.objects;
drop policy if exists "product_images_user_insert" on storage.objects;
drop policy if exists "usage_events_insert_own"   on public.usage_events;
-- (필요 시 004 의 storage 정책을 재생성)

-- 013 롤백
drop trigger  if exists user_profiles_guard_columns         on public.user_profiles;
drop function if exists public.user_profiles_guard_columns_fn();
drop policy   if exists "users_self_update" on public.user_profiles;
drop policy   if exists "users_self_insert" on public.user_profiles;
drop policy   if exists "users_self_read"   on public.user_profiles;
-- 주의: 이 시점에 일반 사용자가 user_profiles 에 접근 못 함.
-- 001 의 "users_own" FOR ALL 정책 재생성 필요 (보안 위험 — 권장하지 않음).
```

## 4. 운영 노트

- **webhook 배포 순서**: 015 적용 → `/api/payments/prepare` 배포 →
  `billing-client.tsx` 가 prepare 를 호출하도록 변경(Track 2 작업) →
  새 webhook 코드 배포. 순서를 어기면 webhook 이 모든 결제를
  `order_not_found` 로 거부하게 됩니다.
- **prepare endpoint 만 먼저 배포된 상태**에서는 기존 클라이언트 흐름이
  여전히 클라이언트 생성 orderId 를 쓰므로 webhook 의 `order_not_found`
  로그가 늘어날 수 있습니다. 단기간이라면 안전 (결제 거부) 하지만,
  운영팀에 사전 공지를 권장합니다.
- **DEV_BYPASS_CREDITS**: prod 환경에서 이 env 가 `true` 면 서버가 부팅 시
  throw 합니다(`src/lib/credit-guard.ts`). 배포 실패가 더 안전한 단일점입니다.
- **`last_model_image_url`** 컬럼은 보수적으로 잠겼습니다. 사용자가 모델
  사진을 새로 업로드할 때 자기 컬럼을 갱신해야 한다면, 별도의
  `set_last_model_image_url(p_url text)` SECURITY DEFINER RPC 를 추후
  추가하세요. 본 트랙에서는 결정 보류.
