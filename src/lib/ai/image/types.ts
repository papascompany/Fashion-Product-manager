export type AspectRatio =
  | '1:1' | '4:5' | '5:4' | '3:4' | '4:3'
  | '9:16' | '16:9' | '21:9' | '1:4' | '4:1' | '1:8' | '8:1'

export type Resolution = '1K' | '2K' | '4K'
export type ThinkingLevel = 'minimal' | 'high'

export interface ImageGenParams {
  /** URL 또는 base64 형식의 참조 이미지 목록 */
  referenceImages: string[]
  /** 5계층 조립 결과 프롬프트 */
  prompt: string
  /** 생성할 이미지 종횡비 목록 */
  aspectRatios: AspectRatio[]
  /** 생성할 이미지 개수 */
  count: number
  /** 이미지 해상도 */
  resolution: Resolution
  /** AI 사고 수준 (기본: minimal) */
  thinking?: ThinkingLevel
  /** 한글 배지 텍스트 (선택사항) */
  overlayText?: string
  /**
   * 컷 간 상품 일관성용 lock seed (0 ~ 2^31-1).
   * 같은 상품의 모든 상세페이지 컷 요청에 동일 값 전달 → 스타일 드리프트 감소.
   * (Gemini generationConfig.seed — 모델이 무시할 수 있는 best-effort 힌트)
   */
  seed?: number
}

export interface ImageGenResult {
  /** 생성된 이미지 목록 */
  images: Array<{
    /** 이미지 URL (Supabase Storage) */
    url: string
    /** 이미지 너비 (px) */
    width: number
    /** 이미지 높이 (px) */
    height: number
    /** 종횡비 */
    aspectRatio: AspectRatio
  }>
  /** API 요청 ID (비용 추적용) */
  requestId: string
  /** 소모된 토큰 수 */
  costTokens: number
}

export interface IImageGenProvider {
  /** 이미지 생성 메인 메서드 */
  generate(params: ImageGenParams): Promise<ImageGenResult>
}
