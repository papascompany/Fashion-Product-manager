/**
 * AI Fitting 5계층 프롬프트 (Phase 4)
 *
 * 입력: [제품 이미지, 모델 이미지] (multi-reference)
 * 출력: 모델이 제품을 자연스럽게 입고 있는 합성 이미지
 *
 * Nano Banana 2 의 multi-reference 기능을 활용하여
 * 제품의 외관(색·형태·로고·텍스처)과 모델의 외관(얼굴·체형·피부톤)을 동시에 보존.
 *
 * 5계층 구조:
 *   [1] Subject Anchor — 제품 보존 명령
 *   [2] Person Reference — 모델 외관 보존 명령
 *   [3] Scene — 배경·조명
 *   [4] Composition — 구도·앵글
 *   [5] Quality — 사진 품질·안전 가이드
 */

import type { AspectRatio } from '@/lib/ai/image/types'

export interface AiFittingPromptParams {
  category: string                    // 분석에서 나온 카테고리 (예: "니트 가디건")
  productKeyFeatures?: string[]       // 제품의 핵심 특징 (예: ["골드 버튼", "크롭 기장"])
  aspectRatio: AspectRatio
  /** 사용자 보정 지시 (선택) — "더 밝게", "카페 배경으로" 등 */
  refinement?: string
  /** 상세페이지 컷 세트 — 착장 앵글 배리언트 (전/측/후/라이프스타일) */
  shotVariant?: FittingShotVariant
  /** 모델 프로필 락 — 컷 세트 전체에서 동일 모델·조명 유지 가드레일 강화 */
  modelLock?: boolean
}

export type FittingShotVariant = 'front' | 'side' | 'back' | 'lifestyle'

// ─── 컷 세트 앵글 배리언트 (상세페이지 lookbook 전/측/후) ───────────────────

const SHOT_VARIANT_COMPOSITION: Record<FittingShotVariant, string> = {
  front:
    'Front-facing full-body editorial shot. The model faces the camera directly, relaxed natural stance, the garment silhouette fully readable from the front.',
  side:
    'Side-profile full-body shot. The model is turned 90 degrees showing the garment drape and side silhouette, gaze ahead, natural posture.',
  back:
    'Back-view full-body shot. The model faces away from the camera showing the back of the garment completely — back seams, hem, and fit clearly visible.',
  lifestyle:
    'Candid lifestyle moment in a warm lived-in premium space (cafe, street, home interior). The model wears the product naturally mid-motion; the environment stays softly blurred behind.',
}

/** 컷 세트 전체에서 모델·조명 아이덴티티를 고정하는 가드레일 (PRD §3 ④). */
const MODEL_LOCK_GUARDRAIL =
  'MODEL LOCK: This image belongs to a single product detail page set. ' +
  'The model must remain IDENTICAL across the set — same face, same hairstyle, same skin tone, same body proportions, same height. ' +
  'Keep lighting neutral and consistent (soft daylight, no dramatic color casts), avoid extreme camera angles (no worm/bird-eye), ' +
  'and keep the garment color and texture identical to the reference under neutral white balance.'

// ─── 비율별 구도 가이드 ─────────────────────────────────────────────────────

const COMPOSITION_BY_RATIO: Record<string, string> = {
  '1:1':   'Square composition. 3/4 shot from waist up showing the product clearly. Centered framing.',
  '4:5':   'Vertical fashion editorial composition. Full-body or 3/4 shot showing the product as the hero element.',
  '9:16':  'Tall vertical for mobile feed. Full-body shot with vertical headroom. Product visible from head to ~waist.',
  '16:9':  'Wide landscape, fashion campaign style. Model centered, product clearly visible. Some negative space.',
  '4:3':   'Standard photo composition. 3/4 shot with the product as focal point.',
  '3:4':   'Mobile-friendly vertical. Tight 3/4 framing emphasizing the product.',
}

export function buildAiFittingPrompt(params: AiFittingPromptParams): string {
  const features = params.productKeyFeatures?.join(', ') ?? params.category
  // 샷 배리언트가 있으면 앵글 구도가 우선, 종횡비 구도는 보조로 병기
  const ratioComposition = COMPOSITION_BY_RATIO[params.aspectRatio] ?? COMPOSITION_BY_RATIO['1:1']
  const composition = params.shotVariant
    ? `${SHOT_VARIANT_COMPOSITION[params.shotVariant]} ${ratioComposition}`
    : ratioComposition

  const lines: string[] = []

  // [1] Subject Anchor — 제품
  lines.push(
    `[1] PRODUCT (from image 1): Keep the EXACT product appearance 100% intact. ` +
    `Preserve color, shape, fabric texture, buttons, logos, stitching, prints, and all distinctive details. ` +
    `Category: ${params.category}. Key features to preserve: ${features}.`
  )

  // [2] Person Reference — 모델
  lines.push(
    `[2] PERSON (from image 2): Apply the product naturally onto this person. ` +
    `Preserve their facial features, hairstyle, skin tone, and overall body proportions exactly. ` +
    `Do NOT alter their face or body shape — only dress them in the product from image 1.`
  )

  // [3] Scene
  lines.push(
    `[3] SCENE: Clean studio background or soft neutral environment. ` +
    `Natural soft lighting from front-side angle. No harsh shadows. ` +
    `Background should not compete with the product.`
  )

  // [4] Composition
  lines.push(`[4] COMPOSITION: ${composition}`)

  // [5] Quality & Safety
  lines.push(
    `[5] QUALITY: Photo-realistic, professional fashion editorial quality. ` +
    `No cartoon style, no anime, no distortions, no extra limbs or fingers. ` +
    `Magazine-quality polish. ` +
    `SAFETY: No celebrity likeness. No identity manipulation. The person from image 2 is the only model — do not invent new faces.`
  )

  // [6] 모델 프로필 락 — 컷 세트 일관성 (상세페이지 오케스트레이션 시)
  if (params.modelLock) {
    lines.push(`[6] ${MODEL_LOCK_GUARDRAIL}`)
  }

  // 사용자 보정 지시 (있을 때만)
  if (params.refinement && params.refinement.trim()) {
    lines.push(`\n[USER REFINEMENT]: ${params.refinement.trim()}`)
  }

  return lines.join('\n\n')
}
