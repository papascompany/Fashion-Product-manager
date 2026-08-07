/**
 * T-08: 크레딧 가드 미들웨어 단위 테스트
 * Track 3 — TST-04 fix:
 *   mockPlan 누락으로 4건 실패하던 문제 해결.
 *   각 it 의 케이스 의도에 맞게 plan 을 명시 주입한다.
 */

import { describe, it, expect } from 'vitest'

// 크레딧 소모량 상수 (기획 문서 기준)
const CREDIT_COSTS = {
  quick: 1,
  studio_text: 1,
  studio_thumbnail: 3,
} as const

describe('T-08: CreditGuard', () => {
  /**
   * Given: 크레딧이 5개 남은 starter 사용자
   * When: 간편 모드 실행 (1 크레딧 소모)
   * Then: 통과(allowed: true)하고 잔여 크레딧 4개를 반환해야 한다
   */
  it('잔여 크레딧이 충분할 때 요청을 허용해야 한다', async () => {
    const { checkCreditGuard } = await import('@/lib/credit-guard')

    const result = await checkCreditGuard({
      userId: 'test-user-id',
      operation: 'quick',
      // 2K(기본) 가드 통과를 위해 starter 이상 지정.
      mockPlan: 'starter',
      mockCreditsLeft: 5,
    })

    expect(result.allowed).toBe(true)
    expect(result.creditsAfter).toBe(5 - CREDIT_COSTS.quick)
  })

  /**
   * Given: 크레딧이 0개인 starter 사용자
   * When: 간편 모드 실행 시도
   * Then: 차단(allowed: false)하고 업그레이드 안내를 반환해야 한다
   */
  it('크레딧이 부족할 때 요청을 차단해야 한다', async () => {
    const { checkCreditGuard } = await import('@/lib/credit-guard')

    const result = await checkCreditGuard({
      userId: 'test-user-id',
      operation: 'quick',
      mockPlan: 'starter',
      mockCreditsLeft: 0,
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/크레딧|credit/i)
    expect(result.upgradeUrl).toBeTruthy()
  })

  /**
   * Given: 크레딧이 2개 남은 starter 사용자
   * When: 썸네일 생성 시도 (3 크레딧 소모)
   * Then: 크레딧 부족으로 차단해야 한다
   */
  it('썸네일 생성 시 크레딧 3개가 필요하다', async () => {
    const { checkCreditGuard } = await import('@/lib/credit-guard')

    const result = await checkCreditGuard({
      userId: 'test-user-id',
      operation: 'studio_thumbnail',
      // 2K 기본 해상도 통과를 위해 starter.
      mockPlan: 'starter',
      mockCreditsLeft: 2,
    })

    expect(result.allowed).toBe(false)
    expect(result.creditsRequired).toBe(CREDIT_COSTS.studio_thumbnail)
  })

  /**
   * Given: Pro 플랜 사용자
   * When: 4K 썸네일 생성 요청
   * Then: 허용해야 한다 (4K는 Pro 이상 전용)
   */
  it('Pro 플랜 사용자는 4K 생성이 허용되어야 한다', async () => {
    const { checkCreditGuard } = await import('@/lib/credit-guard')

    const result = await checkCreditGuard({
      userId: 'test-user-id',
      operation: 'studio_thumbnail',
      resolution: '4K',
      mockCreditsLeft: 10,
      mockPlan: 'pro',
    })

    expect(result.allowed).toBe(true)
  })

  /**
   * Given: Free 플랜 사용자
   * When: 4K 썸네일 생성 요청
   * Then: 플랜 제한으로 차단해야 한다 (보안 규칙: 4K는 Pro 이상만)
   */
  it('Free 플랜 사용자는 4K 생성이 차단되어야 한다', async () => {
    const { checkCreditGuard } = await import('@/lib/credit-guard')

    const result = await checkCreditGuard({
      userId: 'test-user-id',
      operation: 'studio_thumbnail',
      resolution: '4K',
      mockCreditsLeft: 10,
      mockPlan: 'free',
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/Pro|플랜|plan/i)
  })
})
