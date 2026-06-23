/**
 * 플랜 설정 공유 타입/상수 — 서버·클라이언트 모두에서 import 가능
 * (서버 전용 DB 함수는 plan-settings.ts 에만 있음)
 *
 * Track 2 SoT 일원화 (UX-02, BIZ-05, BIZ-11, BIZ-08, BIZ-10):
 *  - 가격 (PLAN_PRICES / TOPUP_PRICES) — billing-client / page / prepare 단일 진실
 *  - 크레딧 (PLAN_CREDITS / TOPUP_CREDITS) — modal / billing / SQL 와 동일 값
 *  - 해상도 (DEFAULT_PLAN_RESOLUTION) — Pro 도 4K (BIZ-05 채택)
 *  - 공유 quota (SMS / 카카오 일/월 cap) — BIZ-08
 *  - 마케팅 카피 보정 (FREE_INITIAL_CREDITS) — BIZ-11: '월 3' 광고 → '가입 시 3' 으로 통일
 */

export type Plan = 'free' | 'starter' | 'pro' | 'business'
export type Resolution = '1K' | '2K' | '4K'

/** 결제 가능 플랜 (free 제외) */
export type PaidPlan = Exclude<Plan, 'free'>

/** 토픽업 팩 식별자 */
export type TopupPack = 'topup10' | 'topup30' | 'topup100'

// ─── 해상도 ────────────────────────────────────────────────────────────────
/** 코드 기본값 — DB 조회 실패 시 fallback
 *  BIZ-05: 마케팅이 "Pro 4K" 를 광고 → Pro 도 4K 로 통일.
 *  Admin 이 app_settings.plan_resolution 에서 별도 override 가능. */
export const DEFAULT_PLAN_RESOLUTION: Record<Plan, Resolution> = {
  free:     '1K',
  starter:  '2K',
  pro:      '4K',
  business: '4K',
}

/** 해상도 표시 레이블 */
export const RESOLUTION_LABELS: Record<Resolution, string> = {
  '1K': '1K (1024px)',
  '2K': '2K (2048px)',
  '4K': '4K (4096px)',
}

/** 플랜 표시 레이블 */
export const PLAN_LABELS: Record<Plan, string> = {
  free:     'FREE',
  starter:  'STARTER',
  pro:      'PRO',
  business: 'BUSINESS',
}

/** 사용자에게 보여주는 한글 이름 */
export const PLAN_DISPLAY_NAMES: Record<Plan, string> = {
  free:     'Free',
  starter:  'Starter',
  pro:      'Pro',
  business: 'Business',
}

export const PLANS: Plan[] = ['free', 'starter', 'pro', 'business']
export const RESOLUTIONS: Resolution[] = ['1K', '2K', '4K']

// ─── 가격 (원) ────────────────────────────────────────────────────────────
/** 월간 구독 가격 (Free 는 0).
 *  ⚠️ 변경 시 supabase/migrations/015_payment_idempotency.sql 의
 *     payment_credits_for() 함수도 함께 검토할 것. */
export const PLAN_PRICES: Record<Plan, number> = {
  free:     0,
  starter:  19900,
  pro:      49900,
  business: 149000,
}

/** 토픽업 팩 가격 */
export const TOPUP_PRICES: Record<TopupPack, number> = {
  topup10:  3000,
  topup30:  8000,
  topup100: 24000,
}

// ─── 크레딧 ───────────────────────────────────────────────────────────────
/** 월 충전 크레딧 (Free 는 가입 시 1회만 — BIZ-11: 월 cron 없음) */
export const PLAN_CREDITS: Record<Plan, number> = {
  free:     3,
  starter:  50,
  pro:      200,
  business: 1000,
}

/** 토픽업 팩 크레딧 */
export const TOPUP_CREDITS: Record<TopupPack, number> = {
  topup10:  10,
  topup30:  30,
  topup100: 100,
}

/** Free 가입 시 1회 지급 크레딧 — BIZ-11 카피 정합성. */
export const FREE_INITIAL_CREDITS = PLAN_CREDITS.free

// ─── 공유 quota (BIZ-08) ──────────────────────────────────────────────────
/** SMS 일일 cap (per user). Free 는 0 — 트랙 1 가 share-sms 라우트에서 차단함. */
export const SMS_DAILY_QUOTA: Record<Plan, number> = {
  free:     0,
  starter:  5,
  pro:      30,
  business: 100,
}

/** 카카오 공유 일일 cap — 카카오는 비용이 작아 Free 도 허용 (1건). */
export const KAKAO_DAILY_QUOTA: Record<Plan, number> = {
  free:     1,
  starter:  10,
  pro:      50,
  business: 200,
}

// ─── 표시용 헬퍼 ──────────────────────────────────────────────────────────
/** ₩19,900 같은 한국 원화 표기. */
export function formatKRW(amount: number): string {
  return `₩${amount.toLocaleString('ko-KR')}`
}

// ─── 결제 SoT API ─────────────────────────────────────────────────────────
/**
 * 결제 사전 등록용 단일 진실. billing-client / page / prepare-route 가
 * 모두 이 함수만 호출한다. (UX-02, WH-02 의 클라이언트 보강)
 */
export function getPlanPriceLabel(plan: Plan): string {
  if (plan === 'free') return '무료'
  return formatKRW(PLAN_PRICES[plan])
}

export function getTopupPriceLabel(pack: TopupPack): string {
  return formatKRW(TOPUP_PRICES[pack])
}

// ─── 텍스트 카피 (랜딩/모달 공통) ─────────────────────────────────────────
/**
 * BIZ-11 — Free 플랜 카피.
 * "월 3크레딧" 이라는 표현은 월 cron 이 없는 한 표시광고법 위반 소지가 있으므로
 * "가입 시 3 크레딧 제공" 으로 통일한다.
 */
export const FREE_PLAN_COPY = '가입 시 3 크레딧 제공'

/**
 * BIZ-05 — Pro 플랜 해상도 카피.
 * DEFAULT_PLAN_RESOLUTION.pro = '4K' 로 통일했으므로 광고와 정합.
 */
export const PRO_RESOLUTION_COPY = '4K 해상도 (Nano Banana 2)'
