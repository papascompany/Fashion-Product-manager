/**
 * 단위 테스트용 fixture — 1×1 투명 PNG (base64 data URI)
 *
 * Track 3 — TST-05 / TST-08:
 *   외부 example.com/product.jpg(404) 의존을 끊고, 이미지 입력이 필요한
 *   단위 테스트가 자기완결로 동작하도록 한다. 실 이미지 파싱·해상도·콘텐츠는
 *   AI 라우터 vi.mock 으로 차단되므로 픽셀 자체는 중요치 않다.
 */

export const SAMPLE_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** 임의 fixture 메타데이터 — 분석 mock 응답 구성에 활용 */
export const SAMPLE_PRODUCT_META = {
  category: '텀블러',
  colors: ['white'],
  keywords: ['텀블러', '보냉'],
} as const
