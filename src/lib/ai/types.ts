/**
 * AI 라우터 타입 정의
 * 작업(task) → 모델 매핑, 스트리밍 이벤트 타입, Zod 스키마
 */

import { z } from 'zod'

// ─── v1.1: 사용자 의도 + 보정 지시 (UX Customization Loop) ─────────────────

export const UserIntentSchema = z.object({
  tone: z.string().max(20).optional(),         // L1 — 캐주얼 / 감성 / 프리미엄 / 위트
  audience: z.string().max(40).optional(),     // L1 — 20대 여성, 30대 직장인 등
  channel: z.string().max(20).optional(),      // L1 — naver / coupang / musinsa / instagram
  memo: z.string().max(200).optional(),        // L1 — 자유 메모
})
export type UserIntent = z.infer<typeof UserIntentSchema>

/** L4 — 자연어 보정 지시 ("더 짧게", "30대 남성 타깃으로 다시" 등) */
export const RefinementSchema = z.string().max(300).optional()

/**
 * 모든 generator 라우트의 Zod 스키마에 spread 로 합쳐 사용:
 *
 *   const NamingSchema = z.object({
 *     category: z.string(),
 *     ...IntentRefinementFields,
 *   })
 */
export const IntentRefinementFields = {
  userIntent: UserIntentSchema.optional(),
  refinement: z.string().max(300).optional(),
} as const

// ─── 기존 정의 계속 ────────────────────────────────────────────────────────

// ─── 작업 식별자 (env 키 prefix) ────────────────────────────────────────────

export type AITask =
  | 'analyze'      // 이미지→메타데이터 (vision)
  | 'naming'       // 상품명 3종
  | 'tagline'      // 35자 한줄카피
  | 'description'  // 400~800자 상세설명
  | 'detail_page'  // (현재 미사용, 추후 LLM HTML 조립 시)

export type AIProvider = 'anthropic' | 'google' | 'local'

/** `provider:model-id` 형식 (예: "anthropic:claude-sonnet-4-5") */
export type ModelSpec = string

// ─── 구조화 출력 스키마 (Zod) ───────────────────────────────────────────────

export const AnalyzeSchema = z.object({
  category: z.string().describe('제품 카테고리 (예: 텀블러, 티셔츠)'),
  subcategory: z.string().describe('세부 카테고리'),
  colors: z.array(z.string()).describe('주요 색상 (1~3개)'),
  materials: z.array(z.string()).describe('소재 (1~3개)'),
  style: z.string().describe('스타일 (미니멀, 캐주얼, 프리미엄 등)'),
  targetAudience: z.string().describe('주요 타깃 고객층'),
  keyFeatures: z.array(z.string()).describe('핵심 특징 3~5개'),
  keywords: z.array(z.string()).describe('SEO 키워드 5~8개'),
  mood: z.string().describe('제품 무드'),
  platform: z.string().describe('최적 판매 플랫폼 (쿠팡/네이버/무신사 중 1개)'),
})
export type AnalyzeOutput = z.infer<typeof AnalyzeSchema>

// v1.1 — 모델이 정확히 3개를 못 반환해도 받아주도록 완화 (2~5개 허용)
export const NamingSchema = z.object({
  names: z
    .array(
      z.object({
        name: z.string().describe('상품명 (40자 이내)'),
        trend: z.string().describe('해시태그 (#태그1 #태그2 형식)'),
      })
    )
    .min(1).max(5)
    .describe('상품명 (이상적으로 3개. 가성비/감성/기능 각도)'),
})
export type NamingOutput = z.infer<typeof NamingSchema>

// v1.1 — 35자 hard limit 제거 (서버에서 트림 처리). 응답 자체가 거부되지 않게.
export const TaglineSchema = z.object({
  tagline: z.string().describe('한줄 홍보문구 (가능하면 35자 이내)'),
  seoKeywords: z.array(z.string()).optional().describe('포함된 SEO 키워드'),
})
export type TaglineOutput = z.infer<typeof TaglineSchema>

// v1.1 — highlights 옵셔널 (생성 못 해도 description 만으로 통과)
// v1.3 — pointKeywords 추가 (소재·핏·시즌·스타일 2~5자 태그 3~5개)
export const DescriptionSchema = z.object({
  description: z.string().describe('상세 설명 본문 (스펙은 · 기호로 구분)'),
  highlights: z.array(z.string()).optional().describe('핵심 셀링포인트 문장 3~5개'),
  pointKeywords: z.array(z.string()).min(3).max(5).optional()
    .describe('포인트 키워드 3~5개 — 소재·핏·시즌·스타일 카테고리의 2~5자 짧은 태그'),
})
export type DescriptionOutput = z.infer<typeof DescriptionSchema>

// ─── Phase 3.2 — 상세페이지 섹션 LLM 조립 스키마 ────────────────────────────

/**
 * AI 가 셀러 의도에 맞춰 상세페이지를 자동 구성한다.
 * 노션 에디터 의 buildDefaultSections (정적) 보다 한 단계 위 — LLM 이 섹션 종류·순서·텍스트까지 결정.
 *
 * 출력: DetailSection[] 호환 형태. id 는 클라이언트에서 부여.
 */
/** 섹션 이미지 슬롯 종류 — src/store/studio.ts ShotSlot 과 verbatim 일치 */
export const ShotSlotSchema = z.enum(['productShot', 'fitShot', 'detailShot', 'lifestyle'])
export type ShotSlot = z.infer<typeof ShotSlotSchema>

/** 테마 식별자 — src/lib/detail-page/themes.ts ThemeId 와 verbatim 일치 */
export const ThemeIdSchema = z.enum(['editorial-minimal', 'soft-luxury-serif', 'clean-conversion'])

export const DetailPageSectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hero'),        title: z.string(), tagline: z.string(), shotSlot: ShotSlotSchema.optional() }),
  z.object({ type: z.literal('features'),    heading: z.string(), items: z.array(z.string()).min(2).max(8), shotSlot: ShotSlotSchema.optional() }),
  z.object({ type: z.literal('description'), content: z.string(), shotSlot: ShotSlotSchema.optional() }),
  z.object({ type: z.literal('keywords'),    items: z.array(z.string()).min(3).max(12), shotSlot: ShotSlotSchema.optional() }),
  z.object({ type: z.literal('reviews'),     placeholder: z.string(), shotSlot: ShotSlotSchema.optional() }),
  z.object({ type: z.literal('cta'),         label: z.string(), shotSlot: ShotSlotSchema.optional() }),
  z.object({ type: z.literal('text'),        heading: z.string().optional(), content: z.string(), shotSlot: ShotSlotSchema.optional() }),
  // ─── 상세페이지 엔진 신규 유형 ─────────────────────────────────────────────
  z.object({
    type: z.literal('gallery'),
    heading: z.string().optional(),
    items: z.array(z.object({
      url: z.string().optional(),
      shotSlot: ShotSlotSchema,
      caption: z.string().optional(),
    })).min(1).max(8),
  }),
  z.object({
    type: z.literal('feature-split'),
    heading: z.string(),
    body: z.string(),
    shotSlot: ShotSlotSchema,
    reverse: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('material'),
    heading: z.string().optional(),
    cells: z.array(z.object({
      kind: z.enum(['image', 'text']),
      shotSlot: ShotSlotSchema.optional(),
      title: z.string().optional(),
      text: z.string().optional(),
      span: z.enum(['big', 'wide', 'normal']).optional(),
    })).min(1).max(6),
  }),
  z.object({
    type: z.literal('lookbook'),
    heading: z.string().optional(),
    looks: z.array(z.object({
      shotSlot: ShotSlotSchema,
      caption: z.string().optional(),
    })).min(1).max(8),
  }),
  z.object({
    type: z.literal('size-spec'),
    caption: z.string().optional(),
    columns: z.array(z.string()).min(1).max(8),
    rows: z.array(z.object({
      label: z.string(),
      values: z.array(z.string()),
    })).min(1).max(20),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal('trust'),
    rating: z.string().optional(),
    quote: z.string().optional(),
    quoteMeta: z.string().optional(),
    badges: z.array(z.object({
      title: z.string(),
      desc: z.string().optional(),
    })).min(1).max(6),
  }),
  z.object({ type: z.literal('benefit-banner'), text: z.string() }),
  z.object({
    type: z.literal('legal'),
    fields: z.array(z.object({
      label: z.string(),
      value: z.string(),
    })).min(1).max(20),
    aiNotice: z.string().optional(),
  }),
  // 커머스 없는 에디토리얼 마감 (가격/구매버튼 없음)
  z.object({ type: z.literal('closing'), heading: z.string(), subtext: z.string().optional() }),
])

export const DetailPagePlanSchema = z.object({
  themeId: ThemeIdSchema.optional().describe('상세페이지 테마 (기본 editorial-minimal)'),
  sections: z.array(DetailPageSectionSchema).min(3).max(13)
    .describe('상품 상세페이지를 구성하는 섹션 배열. hero 가 반드시 첫 번째.'),
})
export type DetailPagePlan = z.infer<typeof DetailPagePlanSchema>

// ─── 파이프라인 SSE 이벤트 ──────────────────────────────────────────────────

export type PipelineEvent =
  | { type: 'progress'; step: PipelineStep; percent: number }
  | { type: 'project'; projectId: string }
  | { type: 'analysis'; data: AnalyzeOutput }
  | { type: 'names'; data: NamingOutput['names']; trendTags: string[] }
  | { type: 'tagline'; data: string }
  | { type: 'description_chunk'; text: string }
  | { type: 'description_done'; data: string; highlights: string[]; pointKeywords: string[] }
  | { type: 'complete'; elapsedMs: number }
  | { type: 'error'; message: string; step?: PipelineStep; status?: number }

export type PipelineStep =
  | 'project_create'
  | 'analyze'
  | 'naming'
  | 'tagline'
  | 'description'
