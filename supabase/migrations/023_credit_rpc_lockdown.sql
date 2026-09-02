-- ═══════════════════════════════════════════════════════════════════════════
-- 023. 크레딧 RPC 잠금 — anon/authenticated 의 임의 크레딧 조작 차단
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 배경 (2026-09-02 프로덕션에서 실측·재현)
--   크레딧 관련 SECURITY DEFINER RPC 들이 임의의 p_user_id 를 받으면서 anon/
--   authenticated 에게 실행 권한이 열려 있어, 브라우저 번들에 실려 나가는
--   NEXT_PUBLIC_SUPABASE_ANON_KEY 만으로 아무 사용자의 크레딧을 발행·소각할 수
--   있었다. 앱(RLS·019 컬럼가드·022 트리거)을 전부 우회한다.
--
--   실측 (스모크 계정 대상, anon 키 직접 POST /rest/v1/rpc):
--     add_credits(+1000)           → 204, credits 100→1100   (무한 발행)
--     deduct_credits(-5)           → 204, 감소                (타인 소각)
--     deduct_credits_atomic(-7)    → 200, 감소                (타인 소각)
--     admin_adjust_credits(+250)   → 200, 증가                (관리자 전용인데 열림)
--   authenticated 세션으로 타인 uuid 지정:
--     add_credits(victim,+1000)    → 204, victim 100→1100
--     deduct_credits_atomic(victim)→ 200, victim 감소
--
-- 왜 016 의 `REVOKE ... FROM PUBLIC` 로 안 막혔나
--   Supabase 는 postgres 가 public 스키마에 만든 함수를 default privileges 로
--   anon·authenticated 에 **역할별로** 자동 부여한다(PUBLIC 경유가 아니다).
--   따라서 `REVOKE FROM PUBLIC` 은 이 역할별 grant 를 지우지 못한다. 016 이
--   admin_adjust_credits 를 authenticated 에서만 명시적으로 revoke 했기에
--   authenticated 는 403 이지만 anon 은 그대로 통과했다(실측 일치).
--   → 반드시 `REVOKE ... FROM anon` 을 **역할명으로 명시**해야 한다.
--
-- 조치
--   ① add_credits / deduct_credits — 호출처가 코드 어디에도 없다(005/006 유물).
--      순수 공격면이므로 DROP.
--   ② deduct_credits_atomic / record_thumbnail_generation /
--      record_ai_fitting_generation — 정당한 호출자는 authenticated 세션이며
--      항상 자기 자신(user.id)을 넘긴다(credit-guard.ts / 두 생성 라우트).
--      본문 첫머리에 소유권 가드(p_user_id = auth.uid())를 넣고, anon 실행권을
--      회수한다. service_role 은 통과(향후 서버 배치 대비).
--   ③ admin_adjust_credits — service_role 전용. anon/authenticated/PUBLIC 회수.
--
-- 검증해야 할 것 (양방향)
--   ① 막혀야 — anon 키로 위 RPC 호출이 401/403/42501 로 거부되는가
--             authenticated 가 **타인** uuid 로 호출 시 거부되는가
--   ② 통과해야 — 로그인 사용자의 썸네일/AI Fitting 생성 크레딧 차감이 그대로
--             되는가(record_*·deduct_credits_atomic, 전부 자기 자신 대상)
--             admin 라우트의 크레딧 조정(admin_adjust_credits, service_role)이 되는가
--   ②가 깨지면 생성·결제가 멈추므로 ①보다 먼저 확인할 것.
--
-- 전부 멱등(idempotent). 여러 번 실행해도 안전.
-- 적용: Supabase Studio → SQL Editor 전체 실행. 마지막 SELECT 가 결과 표를 반환한다.
-- ═══════════════════════════════════════════════════════════════════════════

set search_path = public;

-- ─── ① 유물 함수 제거 (호출처 없음) ─────────────────────────────────────────
drop function if exists public.add_credits(uuid, integer);
drop function if exists public.deduct_credits(uuid, integer);

-- ─── ② deduct_credits_atomic — 소유권 가드 + anon 회수 ──────────────────────
-- 본문은 012 원문 그대로, 첫머리에 가드만 추가.
create or replace function public.deduct_credits_atomic(
  p_user_id uuid,
  p_amount  integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows_updated integer;
begin
  -- 소유권 가드: authenticated 는 자기 자신만. service_role 은 예외(서버 배치 대비).
  -- auth.uid() 는 SECURITY DEFINER 아래서도 요청 JWT 클레임을 읽는다.
  if auth.role() is distinct from 'service_role'
     and p_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN: 타인 계정의 크레딧은 조작할 수 없습니다.'
      using errcode = '42501';
  end if;

  update public.user_profiles
  set    credits_left = credits_left - p_amount,
         updated_at   = now()
  where  id           = p_user_id
    and  credits_left >= p_amount;

  get diagnostics v_rows_updated = row_count;
  return v_rows_updated > 0;
end;
$$;

-- ─── ② record_thumbnail_generation — 소유권 가드 + anon 회수 ─────────────────
-- 본문은 011 원문 그대로, BEGIN 직후에 호출자 소유권 가드만 추가.
-- (기존의 project↔user 소유 확인은 그대로 유지 — 이제 호출자까지 묶인다)
create or replace function public.record_thumbnail_generation(
  p_user_id    uuid,
  p_project_id uuid,
  p_thumbnails jsonb,
  p_credits    integer,
  p_metadata   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thumb   jsonb;
  v_records jsonb := '[]'::jsonb;
  v_id      uuid;
  v_url     text;
  v_width   integer;
  v_height  integer;
  v_ar      text;
begin
  if auth.role() is distinct from 'service_role'
     and p_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN: 타인 계정 대상 기록은 허용되지 않습니다.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.projects
    where id = p_project_id and user_id = p_user_id
  ) then
    raise exception 'Project not found or unauthorized: %', p_project_id
      using errcode = 'insufficient_privilege';
  end if;

  for v_thumb in select * from jsonb_array_elements(p_thumbnails)
  loop
    insert into public.thumbnails (
      project_id, url, width, height, aspect_ratio, resolution, prompt
    )
    values (
      p_project_id,
      (v_thumb->>'url'),
      (v_thumb->>'width')::integer,
      (v_thumb->>'height')::integer,
      (v_thumb->>'aspect_ratio'),
      (v_thumb->>'resolution'),
      (v_thumb->>'prompt')
    )
    returning id, url, width, height, aspect_ratio
    into v_id, v_url, v_width, v_height, v_ar;

    v_records := v_records || jsonb_build_array(
      jsonb_build_object(
        'id',           v_id,
        'url',          v_url,
        'width',        v_width,
        'height',       v_height,
        'aspect_ratio', v_ar
      )
    );
  end loop;

  insert into public.usage_events (user_id, project_id, event_type, credits_used, metadata)
  values (p_user_id, p_project_id, 'thumbnail_generated', p_credits, p_metadata);

  update public.user_profiles
  set    credits_left = greatest(credits_left - p_credits, 0),
         updated_at   = now()
  where  id = p_user_id;

  return jsonb_build_object('records', v_records);
end;
$$;

-- ─── ② record_ai_fitting_generation — 소유권 가드 + anon 회수 ────────────────
create or replace function public.record_ai_fitting_generation(
  p_user_id    uuid,
  p_project_id uuid,
  p_fittings   jsonb,
  p_credits    integer,
  p_metadata   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fitting    jsonb;
  v_records    jsonb := '[]'::jsonb;
  v_id         uuid;
  v_result_url text;
  v_ar         text;
  v_width      integer;
  v_height     integer;
  v_model_url  text;
begin
  if auth.role() is distinct from 'service_role'
     and p_user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN: 타인 계정 대상 기록은 허용되지 않습니다.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.projects
    where id = p_project_id and user_id = p_user_id
  ) then
    raise exception 'Project not found or unauthorized: %', p_project_id
      using errcode = 'insufficient_privilege';
  end if;

  for v_fitting in select * from jsonb_array_elements(p_fittings)
  loop
    insert into public.ai_fittings (
      project_id, model_image_url, result_url, aspect_ratio, width, height, prompt
    )
    values (
      p_project_id,
      (v_fitting->>'model_image_url'),
      (v_fitting->>'result_url'),
      (v_fitting->>'aspect_ratio'),
      (v_fitting->>'width')::integer,
      (v_fitting->>'height')::integer,
      (v_fitting->>'prompt')
    )
    returning id, result_url, aspect_ratio, width, height, model_image_url
    into v_id, v_result_url, v_ar, v_width, v_height, v_model_url;

    v_records := v_records || jsonb_build_array(
      jsonb_build_object(
        'id',              v_id,
        'result_url',      v_result_url,
        'aspect_ratio',    v_ar,
        'width',           v_width,
        'height',          v_height,
        'model_image_url', v_model_url
      )
    );
  end loop;

  insert into public.usage_events (user_id, project_id, event_type, credits_used, metadata)
  values (p_user_id, p_project_id, 'ai_fitting_generated', p_credits, p_metadata);

  update public.user_profiles
  set    credits_left = greatest(credits_left - p_credits, 0),
         updated_at   = now()
  where  id = p_user_id;

  return jsonb_build_object('records', v_records);
end;
$$;

-- ─── ③ 실행 권한 재정의 (핵심) ──────────────────────────────────────────────
-- ⚠️ Supabase default privileges 때문에 CREATE OR REPLACE 후에도 anon 이 실행권을
--    보유할 수 있으므로, **역할명으로 명시적으로** 회수한다. PUBLIC 회수만으로는
--    부족하다(위 주석 참조).

-- 자기 자신만 대상으로 하는 크레딧 RPC: anon 회수, authenticated 유지,
-- service_role 유지(본문 가드의 service_role 예외가 실제로 실행될 수 있도록).
revoke execute on function public.deduct_credits_atomic(uuid, integer)               from public, anon;
grant  execute on function public.deduct_credits_atomic(uuid, integer)               to authenticated, service_role;

revoke execute on function public.record_thumbnail_generation(uuid, uuid, jsonb, integer, jsonb) from public, anon;
grant  execute on function public.record_thumbnail_generation(uuid, uuid, jsonb, integer, jsonb) to authenticated, service_role;

revoke execute on function public.record_ai_fitting_generation(uuid, uuid, jsonb, integer, jsonb) from public, anon;
grant  execute on function public.record_ai_fitting_generation(uuid, uuid, jsonb, integer, jsonb) to authenticated, service_role;

-- 관리자 전용: service_role 만. anon/authenticated/PUBLIC 전부 회수.
revoke execute on function public.admin_adjust_credits(uuid, integer) from public, anon, authenticated;
grant  execute on function public.admin_adjust_credits(uuid, integer) to service_role;

-- ─── ④ 적용 결과 확인 (결과 표가 반환된다) ──────────────────────────────────
-- 기대: add_credits/deduct_credits 는 목록에 없어야(DROP). 나머지는 proacl 에
--       anon 이 없어야 하고, admin_adjust_credits 는 service_role 만 있어야 한다.
select
  p.proname                             as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef                           as is_security_definer,
  coalesce(array_to_string(p.proacl, E'\n'), '(default: PUBLIC EXECUTE)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'add_credits', 'deduct_credits', 'deduct_credits_atomic',
    'record_thumbnail_generation', 'record_ai_fitting_generation',
    'admin_adjust_credits'
  )
order by p.proname;

-- ═══════════════════════════════════════════════════════════════════════════
-- 즉시 차단만 필요할 때 (본문 교체 없이 anon 만 끊는 최소 스니펫)
-- ═══════════════════════════════════════════════════════════════════════════
-- 위 전체를 검토할 시간이 없다면 아래 4줄만 먼저 실행해도 anon 경로는 즉시 닫힌다
-- (authenticated 의 타인 uuid 지정은 본문 가드가 있어야 완전히 닫힌다):
--
--   revoke execute on function public.deduct_credits_atomic(uuid,integer) from anon;
--   revoke execute on function public.record_thumbnail_generation(uuid,uuid,jsonb,integer,jsonb) from anon;
--   revoke execute on function public.record_ai_fitting_generation(uuid,uuid,jsonb,integer,jsonb) from anon;
--   revoke execute on function public.admin_adjust_credits(uuid,integer) from anon;
--   drop function if exists public.add_credits(uuid,integer);
--   drop function if exists public.deduct_credits(uuid,integer);
-- ═══════════════════════════════════════════════════════════════════════════
