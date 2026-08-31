-- ═══════════════════════════════════════════════════════════════════════════
-- 022. 마지막 활성 관리자 보호 트리거
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 배경
--   `/api/admin/users/[id]` 에 자기 강등·자기 정지 차단 가드가 있지만, 이는
--   **단일 요청 안에서만** 성립한다. checkAdmin 은 요청마다 독립적으로 role 을
--   읽으므로 admin A·B 가 **동시에** 서로를 강등/정지하면 양쪽 모두
--   "타인 대상" 으로 판정돼 통과하고, 두 UPDATE 가 커밋되어 활성 admin 이
--   0명이 될 수 있다(TOCTOU). 그 상태가 되면 아무도 admin 화면에 들어갈 수 없고
--   복구 경로는 Supabase 콘솔의 service_role 직접 수정뿐이다.
--
--   앱 레벨 선검사로는 닫히지 않는다(검사와 쓰기 사이에 다른 트랜잭션이 끼어든다).
--   DB 레벨에서 직렬화해야 한다.
--
-- 정의
--   "활성 관리자" = role = 'admin' AND banned_at IS NULL
--   이 트리거는 어떤 행이 활성 관리자에서 **벗어나는** 전이(강등 또는 정지)를
--   시도할 때, 자기 자신을 제외한 다른 활성 관리자가 하나도 없으면 거부한다.
--
-- 경합 차단 방법
--   단순히 count(*) 를 세면 MVCC 스냅샷 때문에 동시 트랜잭션이 서로를 보지 못해
--   레이스를 막지 못한다. 그래서 count 직전에 **트랜잭션 advisory lock** 을 잡아
--   "활성 admin 을 줄이는" 트랜잭션들을 직렬화한다. 먼저 커밋한 쪽은 통과하고,
--   뒤이어 락을 얻은 쪽은 갱신된 상태를 보고 거부된다(READ COMMITTED 기준 —
--   PostgREST/Supabase 기본 격리 수준).
--   락은 전이가 실제로 일어나는 경우에만 잡는다. credits_left 갱신처럼 잦은
--   일반 UPDATE 까지 직렬화하면 안 되기 때문이다.
--
-- 트리거 이름과 실행 순서 (중요)
--   PostgreSQL 은 같은 이벤트의 트리거를 **이름 알파벳 순**으로 실행한다.
--   019 의 `user_profiles_guard_columns` 가 먼저 실행돼(g < l) 신뢰되지 않은
--   호출자의 role/banned_at 변경을 OLD 로 되돌린 뒤, 이 트리거가 그 결과를 본다.
--   따라서 authenticated 가 PostgREST 로 직접 시도한 강등은 이 트리거 시점에는
--   이미 "전이 없음" 이 되어 여기서 거부될 일이 없다(중복 거부·오탐 방지).
--   ⚠️ 이 트리거 이름을 `user_profiles_g...` 보다 앞서게 바꾸면 순서가 뒤집혀
--      오탐이 생긴다.
--
-- SECURITY DEFINER 를 쓰는 이유 (018 의 교훈과 다른 점)
--   count 가 RLS 에 걸려 "다른 admin 이 0명" 으로 잘못 보이면 정당한 강등까지
--   막힌다. 그래서 DEFINER 로 전체 행을 세게 한다.
--   018 에서 문제가 됐던 것은 가드 함수가 `current_user` 로 신뢰 여부를 **분기**
--   했기 때문인데(DEFINER 면 항상 소유자가 되어 판정이 무의미해짐), 이 함수는
--   current_user 를 전혀 보지 않으므로 DEFINER 로 안전하다.
--
-- 범위 밖 (의도적)
--   DELETE 는 가드하지 않는다. user_profiles 행 삭제는 auth.users 삭제의 cascade
--   로 일어나며, 여기를 막으면 계정 삭제·테스트 픽스처 정리가 함께 막힌다.
--   마지막 admin 이 자기 계정을 삭제하는 것은 명시적 파괴 행위로 본다.
--
-- 멱등 — 재실행 안전.
-- ═══════════════════════════════════════════════════════════════════════════

set search_path = public;

-- ─── 1. 가드 함수 ───────────────────────────────────────────────────────────

create or replace function public.user_profiles_last_admin_guard_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_active_admin boolean;
  v_is_active_admin  boolean;
  v_other_admins     integer;
begin
  -- role 은 NOT NULL(008), banned_at 만 nullable 이므로 두 불리언은 NULL 이 될 수 없다.
  v_was_active_admin := (old.role = 'admin' and old.banned_at is null);
  v_is_active_admin  := (new.role = 'admin' and new.banned_at is null);

  -- 활성 관리자에서 벗어나는 전이가 아니면 관여하지 않는다.
  -- (일반 UPDATE 는 여기서 즉시 반환 — 락도 잡지 않는다)
  if not v_was_active_admin or v_is_active_admin then
    return new;
  end if;

  -- 활성 admin 을 줄이는 트랜잭션끼리 직렬화. 트랜잭션 종료 시 자동 해제.
  perform pg_advisory_xact_lock(hashtext('user_profiles_last_admin_guard'));

  select count(*)
    into v_other_admins
    from public.user_profiles
   where role = 'admin'
     and banned_at is null
     and id <> old.id;

  if v_other_admins = 0 then
    raise exception
      'LAST_ADMIN_PROTECTED: 마지막 활성 관리자는 강등하거나 정지할 수 없습니다. 다른 관리자를 먼저 지정하세요.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

alter function public.user_profiles_last_admin_guard_fn() security definer;

-- ─── 2. 트리거 ──────────────────────────────────────────────────────────────
-- 이름은 반드시 `user_profiles_guard_columns` 뒤에 정렬돼야 한다(위 주석 참조).

drop trigger if exists user_profiles_last_admin_guard on public.user_profiles;

create trigger user_profiles_last_admin_guard
  before update on public.user_profiles
  for each row
  execute function public.user_profiles_last_admin_guard_fn();

-- ─── 3. 상태 확인 ───────────────────────────────────────────────────────────
-- 이 SELECT 의 결과 표가 보이지 않으면 붙여넣기가 잘린 것이다 (019 의 교훈).
-- 기대: 2행 — guard_columns 가 먼저(fires_order=1), last_admin_guard 가 나중(2).

select
  t.tgname                                   as trigger_name,
  row_number() over (order by t.tgname)      as fires_order,
  p.prosecdef                                as is_security_definer,
  (select count(*) from public.user_profiles
    where role = 'admin' and banned_at is null) as active_admins_now
from pg_trigger t
join pg_class c   on c.oid = t.tgrelid
join pg_proc  p   on p.oid = t.tgfoid
where c.relname = 'user_profiles'
  and not t.tgisinternal
  and t.tgname in ('user_profiles_guard_columns', 'user_profiles_last_admin_guard')
order by t.tgname;

-- ═══════════════════════════════════════════════════════════════════════════
-- 즉시 롤백 (문제 발생 시)
-- ═══════════════════════════════════════════════════════════════════════════
-- 이 트리거는 user_profiles 의 **모든** UPDATE 를 타므로(크레딧 차감 포함)
-- 블라스트 반경이 크다. 정상 동작이 막히는 징후가 보이면 아래 한 줄로 즉시 무력화한다.
-- 함수는 남겨두어도 트리거가 없으면 호출되지 않는다.
--
--   drop trigger if exists user_profiles_last_admin_guard on public.user_profiles;
--
-- 적용 후 확인해야 할 것 (양방향):
--   ① 막혀야 할 것 — 활성 admin 이 1명일 때 그 계정의 강등/정지가 거부되는가
--   ② 통과해야 할 것 — 일반 사용자의 크레딧 차감(썸네일 생성)이 그대로 되는가
--      admin 이 2명 이상일 때 한 명을 강등/정지하는 것이 되는가
--   ②가 깨지면 서비스 전체가 멈추므로 ①보다 먼저 확인할 것.
