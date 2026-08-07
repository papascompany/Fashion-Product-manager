/**
 * T-01, T-02: 이미지 분석 에이전트 단위 테스트
 *
 * Track 3 — TST-05 / TST-06 fix:
 *   - 외부 example.com/product.jpg(404) 제거. fixtures/sample.png (base64
 *     data URI) 사용.
 *   - toContain(expect.stringMatching(...)) 잘못된 어설션을
 *     toEqual(expect.arrayContaining([expect.stringMatching(...)])) 로 교체.
 *   - runWithFallback 을 vi.mock 으로 가로채 실제 AI 호출 차단.
 */

import { describe, it, expect, vi } from 'vitest'
import { SAMPLE_PNG_BASE64 } from '../fixtures/sample-image'

// ─── AI 라우터 모킹 — analyze 작업이 호출하는 runWithFallback 만 가로챈다 ──
vi.mock('@/lib/ai/router', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return {
    ...actual,
    runWithFallback: vi.fn(async () => ({
      object: {
        category: '텀블러',
        subcategory: '스테인리스 텀블러',
        colors: ['white', 'black'],
        materials: ['stainless steel'],
        style: '미니멀',
        targetAudience: '20대 직장인',
        keyFeatures: ['보냉 12시간', '가벼움'],
        keywords: ['텀블러', '보냉', '미니멀'],
        mood: 'clean',
        platform: 'coupang',
      },
    })),
  }
})

// ─── T-01: analyzeProductImage ──────────────────────────────────────────────

describe('T-01: analyzeProductImage', () => {
  /**
   * Given: 유효한 base64 이미지 (fixture)
   * When: analyzeProductImage 호출
   * Then: 카테고리/색상/키워드가 채워진 구조화 결과를 반환해야 한다
   */
  it('유효한 base64 이미지로 제품 분석 결과를 반환해야 한다', async () => {
    const { analyzeProductImage } = await import(
      '@/lib/ai/analyzers/image-analyzer'
    )

    const result = await analyzeProductImage({
      // 외부 URL 대신 fixture base64 사용
      imageBase64: SAMPLE_PNG_BASE64,
      mode: 'quick',
    })

    expect(result).toBeDefined()
    expect(result.category).toBeTruthy()
    expect(result.colors).toBeInstanceOf(Array)
    expect(result.keywords).toBeInstanceOf(Array)
    expect(result.keywords.length).toBeGreaterThan(0)
  })

  /**
   * Given: 잘못된 형식의 이미지 URL
   * When: analyzeProductImage 호출
   * Then: 명확한 에러를 던져야 한다
   */
  it('잘못된 이미지 URL에 대해 에러를 던져야 한다', async () => {
    const { analyzeProductImage } = await import(
      '@/lib/ai/analyzers/image-analyzer'
    )

    await expect(
      analyzeProductImage({
        imageUrl: 'not-a-valid-url',
        mode: 'quick',
      })
    ).rejects.toThrow()
  })
})

// ─── T-02: preflight 이미지 검사 ───────────────────────────────────────────

describe('T-02: preflightImageCheck', () => {
  /**
   * Given: 최소 PNG 데이터 URI
   * When: preflightImageCheck 호출
   * Then: passed 필드를 가진 결과를 반환해야 한다
   */
  it('유효한 이미지 파일에 대해 passed 필드를 반환해야 한다', async () => {
    const { preflightImageCheck } = await import(
      '@/lib/ai/analyzers/image-analyzer'
    )

    // 1×1 PNG base64 (최소 테스트용)
    const minimalPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

    const result = await preflightImageCheck(minimalPng)

    expect(result).toBeDefined()
    expect(result).toHaveProperty('passed')
  })

  /**
   * Given: 최소 해상도 미달의 이미지 데이터 URI
   * When: preflightImageCheck 호출
   * Then: passed: false 와 함께 errors 에 해상도 관련 메시지가 있어야 한다
   *
   * TST-06: `toContain(expect.stringMatching(...))` 는 Jest/Vitest 에서 의도된
   * 동작이 아니다. 배열 안에 매처를 포함시키려면 `arrayContaining` 을 써야 한다.
   */
  it('해상도 미달 이미지에 대해 passed: false 를 반환해야 한다', async () => {
    const { preflightImageCheck } = await import(
      '@/lib/ai/analyzers/image-analyzer'
    )

    const tinyImage = 'data:image/png;base64,TINY'

    const result = await preflightImageCheck(tinyImage)

    expect(result.passed).toBe(false)
    // TST-06 fix — arrayContaining + stringMatching 결합.
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/해상도|resolution|이미지/i)])
    )
  })
})
