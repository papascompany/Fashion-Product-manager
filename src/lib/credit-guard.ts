/**
 * 크레딧 가드 미들웨어 (T-08)
 * 모든 AI 생성 전 크레딧/플랜 검사
 *
 * Track 1 핫픽스:
 *   - OPS-01: DEV_BYPASS_CREDITS 가 prod 에서 동작하지 않도록 NODE_ENV 가드.
 *     모듈 로드 시점에 prod + bypass=true 조합이면 throw 로 fast-fail.
 *   - BIZ-09: banned_at IS NOT NULL 인 사용자는 모든 operation 차단.
 */

import { createClient } from '@/lib/supabase/server'

// Track 2 (BIZ-06, BIZ-07, BIZ-08, BIZ-10):
//   - detail_page        : 상세페이지 HTML 자동 조립 (Pro+ 게이팅)
//   - studio_text_refine : naming/tagline/description 부분 재생성 (1 크레딧)
//   - share_sms          : SMS 공유 — 크레딧 0, plan 별 일일 quota cap
//   - share_kakao        : 카카오 공유 — 크레딧 0, plan 별 일일 quota cap
type Operation =
  | 'quick'
  | 'studio_text'
  | 'studio_thumbnail'
  | 'studio_fitting'
  | 'detail_page'
  | 'studio_text_refine'
  | 'share_sms'
  | 'share_kakao'
type Resolution = '1K' | '2K' | '4K'
type Plan = 'free' | 'starter' | 'pro' | 'business'

export const CREDIT_COSTS: Record<Operation, number> = {
  quick: 1,
  studio_text: 1,
  studio_thumbnail: 3,
  studio_fitting: 5,        // Phase 4 — AI Fitting (모델 합성, multi-reference)
  detail_page: 2,           // BIZ-06 — 상세페이지 HTML 자동 조립
  studio_text_refine: 1,    // BIZ-07 — naming/tagline/description 부분재생성
  share_sms: 0,             // BIZ-08 — quota cap 로만 게이팅, 크레딧 미차감
  share_kakao: 0,           // BIZ-08 — quota cap 로만 게이팅, 크레딧 미차감
}

// 4K는 Pro 이상만 허용
const RESOLUTION_PLAN_GATE: Record<Resolution, Plan[]> = {
  '1K': ['free', 'starter', 'pro', 'business'],
  '2K': ['starter', 'pro', 'business'],
  '4K': ['pro', 'business'],
}

// Phase 4 — Operation 별 플랜 게이트 (해상도와 별개)
const OPERATION_PLAN_GATE: Partial<Record<Operation, Plan[]>> = {
  studio_fitting: ['pro', 'business'],  // AI Fitting 은 Pro 이상만
  detail_page:    ['pro', 'business'],  // BIZ-06 — 상세페이지 HTML 내보내기는 Pro 이상만
}

export interface CreditGuardResult {
  allowed: boolean
  /** 거부 사유 (BANNED / INSUFFICIENT_CREDITS / PLAN_GATE / NOT_FOUND 등) */
  code?: 'BANNED' | 'PLAN_GATE' | 'INSUFFICIENT_CREDITS' | 'NOT_FOUND'
  reason?: string
  creditsRequired?: number
  creditsAfter?: number
  upgradeUrl?: string
}

export interface CreditGuardParams {
  userId: string
  operation: Operation
  resolution?: Resolution
  /** 동적 비용 (Phase 4 D안 — AI Fitting 비율 개수별 차등) */
  creditsOverride?: number
  // 테스트용 mock 파라미터
  mockCreditsLeft?: number
  mockPlan?: Plan
  /** 테스트용: banned 시뮬레이션 */
  mockBannedAt?: string | null
}

/**
 * Phase 4 D안 — AI Fitting 의 비율 개수별 동적 크레딧.
 * 1장 = 2 / 2장 = 4 / 3장 = 5 (할인) / 4장+ = 6
 */
export function aiFittingCredits(count: number): number {
  if (count <= 1) return 2
  if (count === 2) return 4
  if (count === 3) return 5
  return 6
}

// ─── OPS-01: prod 환경에서 DEV_BYPASS_CREDITS=true 면 fast-fail ───────────────
// 모듈 로드 시점 단 1회 검사. Vercel env 오타·복붙으로 prod 에 bypass 가
// 흘러들어가면 함수가 deploy 되더라도 첫 호출 시 throw 로 죽도록 한다.
;(function assertNoBypassInProduction() {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.DEV_BYPASS_CREDITS === 'true'
  ) {
    throw new Error(
      '[credit-guard] DEV_BYPASS_CREDITS=true is not allowed in production. ' +
        'Remove the env var from the production environment.'
    )
  }
})()

/**
 * 개발 우회 활성 여부 — prod 에서는 항상 false.
 */
function isDevBypassActive(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_BYPASS_CREDITS === 'true'
  )
}

export async function checkCreditGuard(
  params: CreditGuardParams
): Promise<CreditGuardResult> {
  // ── 개발/테스트 우회 ──────────────────────────────────────────────────────
  // .env.local 에 DEV_BYPASS_CREDITS=true 를 설정하면 크레딧/플랜 검사 전체 스킵.
  // prod 에서는 모듈 로드 시 throw 되므로 여기까지 도달 안 함.
  if (isDevBypassActive()) {
    return { allowed: true, creditsRequired: 0, creditsAfter: 9999 }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const {
    userId,
    operation,
    resolution = '2K',
    creditsOverride,
    mockCreditsLeft,
    mockPlan,
    mockBannedAt,
  } = params

  let creditsLeft: number
  let plan: Plan
  let bannedAt: string | null = null

  if (mockCreditsLeft !== undefined && mockPlan !== undefined) {
    // 테스트 모드
    creditsLeft = mockCreditsLeft
    plan = mockPlan
    bannedAt = mockBannedAt ?? null
  } else if (mockCreditsLeft !== undefined) {
    creditsLeft = mockCreditsLeft
    plan = 'free'
    bannedAt = mockBannedAt ?? null
  } else {
    // 실제 DB 조회 — banned_at 도 함께 조회 (BIZ-09)
    const supabase = await createClient()
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('credits_left, plan, banned_at')
      .eq('id', userId)
      .single()

    if (error || !profile) {
      return {
        allowed: false,
        code: 'NOT_FOUND',
        reason: '사용자 정보를 찾을 수 없습니다.',
      }
    }

    creditsLeft = (profile as { credits_left: number }).credits_left
    plan = (profile as { plan: Plan }).plan
    bannedAt = (profile as { banned_at: string | null }).banned_at
  }

  // ── BIZ-09: 정지된 사용자 즉시 차단 ─────────────────────────────────────
  if (bannedAt) {
    return {
      allowed: false,
      code: 'BANNED',
      reason: '계정 사용이 정지되었습니다. 문의: support@productcraft.ai',
    }
  }

  // Phase 4 — 동적 비용 override 우선 (AI Fitting 비율 개수별)
  const required = creditsOverride ?? CREDIT_COSTS[operation]

  // Phase 4 — Operation 자체 플랜 게이트 (예: AI Fitting 은 Pro 이상)
  const opAllowedPlans = OPERATION_PLAN_GATE[operation]
  if (opAllowedPlans && !opAllowedPlans.includes(plan)) {
    const opLabel: Partial<Record<Operation, string>> = {
      studio_fitting: 'AI Fitting',
      detail_page: '상세페이지 HTML 내보내기',
    }
    return {
      allowed: false,
      code: 'PLAN_GATE',
      reason: `${opLabel[operation] ?? operation} 기능은 Pro 이상 플랜에서만 사용 가능합니다.`,
      upgradeUrl: '/billing',
    }
  }

  // 해상도 플랜 게이팅 (보안 규칙: 4K는 Pro 이상)
  const allowedPlans = RESOLUTION_PLAN_GATE[resolution]
  if (!allowedPlans.includes(plan)) {
    return {
      allowed: false,
      code: 'PLAN_GATE',
      reason: `${resolution} 해상도는 Pro 이상 플랜에서만 사용 가능합니다.`,
      upgradeUrl: '/billing',
    }
  }

  // 크레딧 부족 확인
  if (creditsLeft < required) {
    return {
      allowed: false,
      code: 'INSUFFICIENT_CREDITS',
      reason: `크레딧이 부족합니다. (필요: ${required}, 잔여: ${creditsLeft})`,
      creditsRequired: required,
      upgradeUrl: '/billing',
    }
  }

  return {
    allowed: true,
    creditsRequired: required,
    creditsAfter: creditsLeft - required,
  }
}

/**
 * 크레딧 차감 (생성 성공 후 호출)
 *
 * SEC-03: deduct_credits_atomic RPC 사용 — credits_left >= amount 조건부 원자 UPDATE.
 *   동시 요청(Race Condition)에서도 DB 레벨에서 한 번만 차감 보장.
 *   false 반환(크레딧 부족) 시 에러를 throw하지 않고 경고만 기록
 *   (생성은 이미 완료됐으므로 롤백 불가 — 크레딧 초과 소모 방지가 목적).
 */
export async function deductCredits(params: {
  userId: string
  operation: Operation
  /** 동적 비용 (없으면 CREDIT_COSTS 기본값) */
  amount?: number
}): Promise<void> {
  // 개발 우회 모드: 실제 차감 스킵 (prod 에서는 isDevBypassActive() = false)
  if (isDevBypassActive()) return

  const supabase = await createClient()
  const cost = params.amount ?? CREDIT_COSTS[params.operation]

  const { data: success, error } = await supabase.rpc('deduct_credits_atomic', {
    p_user_id: params.userId,
    p_amount: cost,
  })

  if (error) {
    console.error('[deductCredits] RPC error:', error.message)
    return
  }
  if (!success) {
    // 이미 checkCreditGuard를 통과했지만 동시 요청으로 잔액 소진된 경우
    console.warn(`[deductCredits] Insufficient credits for user ${params.userId} (race condition)`)
  }
}
