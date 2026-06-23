-- =====================================================================
-- Migration 015: 결제 멱등성 + amount 검증 인프라
--   - pending_orders (orderId 사전 등록 + expected_amount 검증)
--   - processed_webhook_events (webhook replay/재시도 멱등성)
--   - subscriptions.toss_order_id UNIQUE
--   - apply_payment_event RPC (단일 트랜잭션 처리, GREATEST clamp)
--   - apply_payment_cancel RPC (활성 sub 매칭, credits 비회수)
--   - cleanup_expired_pending_orders RPC (운영 cron 후속 작업)
-- =====================================================================
--
-- 적용 절차 / 주의사항 (한국어)
-- ---------------------------------------------------------------------
-- 1. Supabase Studio → SQL Editor 에서 본 파일 전체 실행.
-- 2. 본 마이그레이션은 새 테이블 2개 + 새 RPC 3개를 만든다. 기존 테이블/RPC 는
--    수정하지 않으므로 안전하게 적용 가능.
-- 3. subscriptions.toss_order_id 에 UNIQUE 제약을 추가한다. 만약 기존에 동일
--    toss_order_id 가 중복 저장된 행이 있다면 실패할 수 있다.
--    아래 쿼리로 사전 점검 후 적용하라:
--      select toss_order_id, count(*) from subscriptions
--       where toss_order_id is not null
--       group by toss_order_id having count(*) > 1;
--    결과가 0행이면 안전.
-- 4. RPC 함수는 모두 SECURITY DEFINER + service_role 만 호출 가능하도록 grant 한다.
-- 5. 검증:
--      -- pending_orders insert / 매칭 흐름
--      select public.apply_payment_event(
--        '<orderId>'::text, 49900, '<evt_id>'::text);
--      -- 두 번째 호출은 0행 반환 (멱등성)
-- 6. 롤백:
--      drop function if exists public.apply_payment_event(text, integer, text);
--      drop function if exists public.apply_payment_cancel(text, text);
--      drop function if exists public.cleanup_expired_pending_orders();
--      drop table if exists public.processed_webhook_events;
--      drop table if exists public.pending_orders;
--      alter table public.subscriptions drop constraint if exists subscriptions_toss_order_id_key;
-- =====================================================================

-- ─── 1. pending_orders : orderId 사전 등록 + expected_amount 검증 ────────────
create table if not exists public.pending_orders (
  order_id        text        primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  kind            text        not null check (kind in ('plan', 'topup')),
  -- plan: 'starter' | 'pro' | 'business' / topup: 'topup10' | 'topup30' | 'topup100' ...
  key             text        not null,
  expected_amount integer     not null check (expected_amount > 0),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '15 minutes'),
  consumed_at     timestamptz
);

create index if not exists idx_pending_orders_user
  on public.pending_orders(user_id, created_at desc);

create index if not exists idx_pending_orders_expires
  on public.pending_orders(expires_at) where consumed_at is null;

alter table public.pending_orders enable row level security;

-- service_role 전용 (일반 사용자/anon 접근 불가)
drop policy if exists "pending_orders_service_only" on public.pending_orders;
create policy "pending_orders_service_only"
  on public.pending_orders
  for all
  to service_role
  using (true)
  with check (true);

-- ─── 2. processed_webhook_events : 멱등성 키 ─────────────────────────────────
create table if not exists public.processed_webhook_events (
  provider     text        not null,
  event_id     text        not null,
  order_id     text,
  processed_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create index if not exists idx_processed_webhook_events_order
  on public.processed_webhook_events(order_id);

alter table public.processed_webhook_events enable row level security;

drop policy if exists "processed_webhook_events_service_only" on public.processed_webhook_events;
create policy "processed_webhook_events_service_only"
  on public.processed_webhook_events
  for all
  to service_role
  using (true)
  with check (true);

-- ─── 3. subscriptions.toss_order_id UNIQUE (DB-03/08) ────────────────────────
-- 사전 점검: 동일 toss_order_id 중복이 있으면 add constraint 가 실패한다.
-- 아래는 UNIQUE 가 없을 때만 추가하는 idempotent 패턴.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_toss_order_id_key'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_toss_order_id_key unique (toss_order_id);
  end if;
end$$;

-- ─── 4. PLAN_CREDITS 매핑 함수 ───────────────────────────────────────────────
-- 토픽업/플랜의 크레딧 수를 RPC 내부에서 일관되게 결정.
create or replace function public.payment_credits_for(p_kind text, p_key text)
returns integer
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_kind = 'plan' then
    return case p_key
      when 'starter'  then 50
      when 'pro'      then 200
      when 'business' then 1000
      else 0
    end;
  elsif p_kind = 'topup' then
    return case p_key
      when 'topup10'  then 10
      when 'topup30'  then 30
      when 'topup100' then 100
      else 0
    end;
  end if;
  return 0;
end;
$$;

-- ─── 5. apply_payment_event RPC ──────────────────────────────────────────────
-- 단일 트랜잭션:
--   1) processed_webhook_events 에 (toss, event_id) INSERT — 이미 처리된 이벤트면 0행 반환 (멱등성)
--   2) pending_orders 매칭 + expected_amount 정확 일치 검증
--   3) plan 결제: subscriptions upsert + user_profiles.plan/credits_left 적용
--      credits_left 는 GREATEST(credits_left + plan_credits, credits_left) 로 보수적 누적
--      (이미 충분한 잔액이 있으면 그대로 유지하고, 부족하면 신규 플랜 크레딧만큼 보장)
--   4) topup 결제: user_profiles.credits_left += topup_credits
--   5) usage_events 기록
--
-- 반환: JSONB {processed: true/false, reason: text, applied: {...}}
create or replace function public.apply_payment_event(
  p_order_id text,
  p_amount   integer,
  p_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending   public.pending_orders;
  v_credits   integer;
  v_inserted  integer;
  v_plan      text;
  v_now       timestamptz := now();
begin
  -- ── 1. 멱등성: 이미 처리된 event_id 면 즉시 종료 ───────────────────────
  insert into public.processed_webhook_events (provider, event_id, order_id)
    values ('toss', p_event_id, p_order_id)
    on conflict (provider, event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object(
      'processed', false,
      'reason',    'duplicate_event'
    );
  end if;

  -- ── 2. pending_orders 매칭 ───────────────────────────────────────────────
  select * into v_pending
    from public.pending_orders
   where order_id = p_order_id
   for update;

  if not found then
    return jsonb_build_object(
      'processed', false,
      'reason',    'order_not_found'
    );
  end if;

  if v_pending.consumed_at is not null then
    return jsonb_build_object(
      'processed', false,
      'reason',    'order_already_consumed'
    );
  end if;

  if v_pending.expires_at < v_now then
    return jsonb_build_object(
      'processed', false,
      'reason',    'order_expired'
    );
  end if;

  -- ── 3. amount 정확 일치 ─────────────────────────────────────────────────
  if v_pending.expected_amount <> p_amount then
    return jsonb_build_object(
      'processed',       false,
      'reason',          'amount_mismatch',
      'expected_amount', v_pending.expected_amount,
      'received_amount', p_amount
    );
  end if;

  v_credits := public.payment_credits_for(v_pending.kind, v_pending.key);
  if v_credits <= 0 then
    return jsonb_build_object(
      'processed', false,
      'reason',    'unknown_key'
    );
  end if;

  -- ── 4. 분기 처리 ────────────────────────────────────────────────────────
  if v_pending.kind = 'plan' then
    v_plan := v_pending.key;

    -- 플랜 업그레이드 (credits_left 는 보수적 누적: 사용자 잔여 보존)
    update public.user_profiles
       set plan         = v_plan,
           credits_left = greatest(credits_left + v_credits, credits_left),
           updated_at   = v_now
     where id = v_pending.user_id;

    -- subscriptions upsert (toss_order_id 가 UNIQUE 이므로 onConflict 가능)
    insert into public.subscriptions (
      user_id, plan, status,
      current_period_start, current_period_end,
      toss_order_id, updated_at
    )
    values (
      v_pending.user_id, v_plan, 'active',
      v_now, v_now + interval '30 days',
      v_pending.order_id, v_now
    )
    on conflict (user_id) do update
      set plan                 = excluded.plan,
          status               = 'active',
          current_period_start = excluded.current_period_start,
          current_period_end   = excluded.current_period_end,
          toss_order_id        = excluded.toss_order_id,
          updated_at           = excluded.updated_at;

    insert into public.usage_events (user_id, event_type, credits_used, metadata)
    values (
      v_pending.user_id,
      'plan_upgraded',
      -v_credits,
      jsonb_build_object('plan', v_plan, 'order_id', v_pending.order_id)
    );

  elsif v_pending.kind = 'topup' then
    update public.user_profiles
       set credits_left = credits_left + v_credits,
           updated_at   = v_now
     where id = v_pending.user_id;

    insert into public.usage_events (user_id, event_type, credits_used, metadata)
    values (
      v_pending.user_id,
      'credit_purchased',
      -v_credits,
      jsonb_build_object('pack', v_pending.key, 'order_id', v_pending.order_id)
    );
  end if;

  -- ── 5. pending_orders 소비 마크 ─────────────────────────────────────────
  update public.pending_orders
     set consumed_at = v_now
   where order_id = p_order_id;

  return jsonb_build_object(
    'processed',     true,
    'kind',          v_pending.kind,
    'key',           v_pending.key,
    'credits_added', v_credits
  );
end;
$$;

comment on function public.apply_payment_event(text, integer, text) is
  'WH-01/02/03 : 결제 webhook 단일 진입 RPC. 멱등성(processed_webhook_events) + amount 검증(pending_orders) + 크레딧/플랜 적용.';

-- service_role 만 호출
revoke all on function public.apply_payment_event(text, integer, text) from public;
revoke all on function public.apply_payment_event(text, integer, text) from authenticated;
grant execute on function public.apply_payment_event(text, integer, text) to service_role;

-- ─── 6. apply_payment_cancel RPC ─────────────────────────────────────────────
-- 결제 취소 시:
--   - 해당 orderId 가 현재 활성 subscription 의 마지막 결제인지 확인 (WH-05 방지)
--   - 맞으면 subscriptions.status='cancelled' + user_profiles.plan='free'
--   - credits_left 는 회수하지 않음 (사용 잔여분 보존, BIZ-02)
--     단, GREATEST(credits_left, 0) 으로 음수 가드만 한다.
create or replace function public.apply_payment_cancel(
  p_order_id text,
  p_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_sub      public.subscriptions;
  v_now      timestamptz := now();
begin
  -- 멱등성
  insert into public.processed_webhook_events (provider, event_id, order_id)
    values ('toss', p_event_id, p_order_id)
    on conflict (provider, event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('processed', false, 'reason', 'duplicate_event');
  end if;

  -- 현재 활성 subscription 중 이 orderId 가 마지막인지 확인
  select * into v_sub
    from public.subscriptions
   where toss_order_id = p_order_id
   limit 1;

  if not found then
    return jsonb_build_object('processed', false, 'reason', 'subscription_not_found');
  end if;

  if v_sub.status <> 'active' then
    return jsonb_build_object('processed', false, 'reason', 'subscription_not_active');
  end if;

  -- 플랜 다운그레이드 (크레딧은 보존, 음수 가드)
  update public.user_profiles
     set plan         = 'free',
         credits_left = greatest(credits_left, 0),
         updated_at   = v_now
   where id = v_sub.user_id;

  update public.subscriptions
     set status     = 'cancelled',
         updated_at = v_now
   where id = v_sub.id;

  insert into public.usage_events (user_id, event_type, credits_used, metadata)
  values (
    v_sub.user_id,
    'plan_cancelled',
    0,
    jsonb_build_object('order_id', p_order_id, 'prev_plan', v_sub.plan)
  );

  return jsonb_build_object('processed', true, 'user_id', v_sub.user_id);
end;
$$;

comment on function public.apply_payment_cancel(text, text) is
  'WH-05/BIZ-02 : 결제 취소 처리. 활성 subscription 의 마지막 결제만 다운그레이드, credits_left 는 회수하지 않음.';

revoke all on function public.apply_payment_cancel(text, text) from public;
revoke all on function public.apply_payment_cancel(text, text) from authenticated;
grant execute on function public.apply_payment_cancel(text, text) to service_role;

-- ─── 7. cleanup_expired_pending_orders RPC (운영 cron 후속 작업) ─────────────
create or replace function public.cleanup_expired_pending_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.pending_orders
   where expires_at < now() - interval '1 day'
     and consumed_at is null;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.cleanup_expired_pending_orders() is
  '운영용: 만료된 pending_orders 정리 (cron 으로 1일 1회 호출 권장).';

revoke all on function public.cleanup_expired_pending_orders() from public;
revoke all on function public.cleanup_expired_pending_orders() from authenticated;
grant execute on function public.cleanup_expired_pending_orders() to service_role;
