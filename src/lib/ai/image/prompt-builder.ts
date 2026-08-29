/**
 * 5계층 프롬프트 조립기 (ai-pipeline-dev)
 *
 * Layer 순서:
 *   [1] Subject Anchor  — 원본 제품 일관성 유지
 *   [2] Scene           — 배경·공간
 *   [3] Mood / Style    — 한국 쇼핑몰 스타일 가이드
 *   [4] Composition     — 구도·앵글 (종횡비별 최적화)
 *   [5] TextOverlay     — 한글 배지 (선택)
 */

import type { AspectRatio } from './types'

export interface PromptLayers {
  /** [1] 원본 제품 유지 — Subject Anchor */
  subjectAnchor: string
  /** [2] 배경·공간 설정 */
  scene: string
  /** [3] 무드·스타일 (한국 쇼핑몰 스타일 가이드 기반) */
  moodStyle: string
  /** [4] 구도·앵글 (종횡비별 최적화) */
  composition: string
  /** [5] 텍스트 삽입 (한글 배지, 선택사항) */
  textOverlay?: string
  /** [6] 컷 세트 일관성 지시 (상세페이지 컷 오케스트레이션, 선택) */
  consistency?: string
  /** 프리셋 고유 네거티브 — 전역 네거티브 뒤에 병합 (선택) */
  extraNegative?: string
}

// ─── 종횡비별 기본 구도 사전 ─────────────────────────────────────────────────

const ASPECT_RATIO_COMPOSITION: Record<AspectRatio, string> = {
  '1:1':  'square framing, centered product placement, equal white space on all sides',
  '4:5':  'portrait crop, product in upper-center, subtle background gradient below',
  '5:4':  'slight landscape, product centered, breathing room on left and right',
  '3:4':  'tall portrait, product fills 60% of frame, negative space above and below',
  '4:3':  'standard landscape, product slightly left of center, contextual scene on right',
  '9:16': 'vertical mobile-first, product in upper-third, text/CTA space at bottom',
  '16:9': 'cinematic widescreen, product in rule-of-thirds left, expansive scene background',
  '21:9': 'ultra-wide banner, product small and precise, immersive panoramic backdrop',
  '1:4':  'vertical strip, product stacked top-to-bottom, editorial tower composition',
  '4:1':  'horizontal banner, product left-aligned, wide scene stretching right',
  '1:8':  'extreme vertical strip, sequential product detail shots stacked',
  '8:1':  'extreme horizontal strip, product at left anchor, sweeping landscape',
}

// ─── 한국 쇼핑몰 무드 사전 ───────────────────────────────────────────────────

const KOREAN_SHOPPING_MOOD_MAP: Record<string, string> = {
  minimal:    'clean minimal Korean e-commerce style, pure white background, soft diffused lighting, product-first clarity',
  premium:    'luxury editorial style, moody dramatic lighting, deep shadows, sophisticated color palette',
  casual:     'bright airy lifestyle, natural daylight, warm neutral tones, approachable and friendly',
  sporty:     'dynamic action-oriented, high contrast, bold shadows, energetic composition',
  natural:    'organic earthy tones, soft bokeh background, warm golden-hour glow, eco-conscious feel',
  feminine:   'pastel palette, delicate lighting, floral or textile textures, soft romantic mood',
  functional: 'clean technical product shot, neutral grey background, sharp details, utility-focused',
}

// ─── 상세페이지 샷 프리셋 (Phase 2 — 컷 오케스트레이션) ─────────────────────
// 상품컷/설명컷의 촬영 방식 사전. scene/composition 을 프리셋이 소유하고
// 종횡비 구도는 보조 힌트로 밀려난다. 한글은 절대 굽지 않으므로 텍스트 세이프 존 요구.

export type ShotPreset =
  | 'flat-lay'         // 플랫레이 — 위에서 내려찍은 정돈 컷
  | 'hanger'           // 행거 — 옷걸이 연출
  | 'ghost-mannequin'  // 고스트 마네킹 — 착용 형태 유지 누끼
  | 'detail-macro'     // 디테일 매크로 — 소재 결·스티치·버튼 클로즈업
  | 'hero-object'      // 히어로 오브제 — 풀블리드 무드 상품컷
  | 'lifestyle'        // 라이프스타일 — 상황·배경 연출 (모델 없이)

interface ShotPresetSpec {
  scene: string
  composition: string
  /** 프리셋 고유 네거티브 (전역 네거티브에 추가) */
  negative?: string
}

const SHOT_PRESET_SPECS: Record<ShotPreset, ShotPresetSpec> = {
  'flat-lay': {
    scene: 'top-down flat lay on a clean neutral surface (linen, paper, or light wood), garment neatly arranged and smoothed, minimal styling props kept to the edges',
    composition: 'perfect 90-degree overhead angle, garment centered and fully in frame, generous even margins, soft diffused daylight with no harsh shadows',
  },
  hanger: {
    scene: 'garment on a slim matte wooden or brass hanger against a clean plaster or seamless wall, natural window light from one side',
    composition: 'straight-on eye-level framing, garment fully visible with drape and silhouette clearly readable, breathing room above the hanger hook',
  },
  'ghost-mannequin': {
    scene: 'invisible ghost mannequin effect — the garment holds a natural worn 3D shape with no visible mannequin, model, or stand, on a pure seamless studio background',
    composition: 'straight-on centered product photography, complete garment visible including inner collar and hem, crisp edges suitable for cut-out use',
    negative: 'visible mannequin, visible body parts, floating distorted fabric',
  },
  'detail-macro': {
    scene: 'extreme close-up macro of the fabric surface showing weave texture, stitching, seams, buttons, or hardware of the exact product',
    composition: 'tight macro framing filling the frame with material detail, shallow depth of field, raking side light that reveals texture relief',
    negative: 'full garment view, distant shot',
  },
  'hero-object': {
    scene: 'editorial hero still of the product as a sculptural object — draped, folded, or suspended with intention, on a tonal premium backdrop with soft gradient light',
    composition: 'dramatic but clean composition with the product occupying the central two-thirds, cinematic soft shadows, negative space preserved at top and bottom',
  },
  lifestyle: {
    scene: 'the product placed naturally in a lived-in premium space (cafe table, bedroom chair, entryway bench) with warm ambient light and subtle contextual props, no people',
    composition: 'natural documentary angle, product clearly the focal subject at rule-of-thirds, softly blurred environment behind',
    negative: 'people, faces, hands, model',
  },
}

/** 조립 HTML 이 한글 타이포를 오버레이하므로, 컷 상·하단에 텍스트 세이프 존을 요구. */
const TEXT_SAFE_ZONE =
  'keep the top 15% and bottom 20% of the frame visually quiet (no busy detail) as text-safe zones for typography overlay, and render absolutely no text, letters, or logos of any kind in the image'

/**
 * 컷 간 상품 아이덴티티 일관성 블록 (PRD §3).
 * 마스터 레퍼런스(원본 상품 이미지) 조건화 + 히어로 컬러 화이트밸런스 앵커.
 * hasReferenceSet=true 이면 다중 레퍼런스(정면+디테일+컬러칩) 언어를 사용한다.
 */
export function buildConsistencyBlock(opts?: { heroColorNote?: string; hasReferenceSet?: boolean }): string {
  const parts: string[] = []
  if (opts?.hasReferenceSet) {
    parts.push(
      'you are given MULTIPLE reference views of the SAME single product: the first is the front view, followed by a detail close-up (fabric weave, stitching, hardware) and a color swatch',
      'treat all reference images as one identical product seen from different crops — reproduce that exact product; use the color-swatch reference as the ground-truth white balance and garment color',
    )
  } else {
    parts.push('this image is part of a single product detail page set — every shot must depict the IDENTICAL product from the reference image')
  }
  parts.push(
    'match the reference exactly: same color under neutral white balance, same fabric texture, same buttons/zippers/hardware, same stitching, same proportions and length',
    'consistent neutral color grading across the set; do not shift hue, saturation, or garment tone',
  )
  if (opts?.heroColorNote?.trim()) {
    parts.push(`anchor white balance and garment color to: ${opts.heroColorNote.trim()}`)
  }
  return parts.join(', ')
}

// ─── 공공 네거티브 프롬프트 ──────────────────────────────────────────────────

const GLOBAL_NEGATIVE_PROMPT =
  'deformed, blurry, low quality, watermark, text artifacts, misshapen product, ' +
  'duplicate objects, extra limbs, cropped product, overexposed, underexposed, ' +
  'garbled Korean characters, English translation of Korean badge text, misspelled hangul'

// ─── 한글 배지 렌더링 옵션 ──────────────────────────────────────────────────

export type BadgePosition =
  | 'top-right'
  | 'top-left'
  | 'top-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center'

export interface BadgeOptions {
  /** 배지 위치 (기본: top-right) */
  position?: BadgePosition
  /** 배지 배경 색상 설명 (기본: vivid red) — 예: 'vivid red', 'deep black', 'pastel pink' */
  color?: string
  /** 배지 모양 (기본: rounded rectangle) */
  shape?: 'rounded rectangle' | 'circle' | 'pill' | 'ribbon'
}

/**
 * 한글 배지 텍스트를 Nano Banana 2가 정확히 렌더링하도록 스타일링 지시 포함 프롬프트로 변환.
 *
 * 단순 텍스트 전달 시 모델이 영문화하거나 깨진 한글을 그리는 문제를 방지하기 위해,
 * 위치·색상·폰트·모양을 명시적으로 지시합니다.
 *
 * @example
 *   buildTextOverlay('신상 20%') →
 *     render the exact Korean text "신상 20%" as a prominent badge, positioned at the top-right corner, ...
 */
export function buildTextOverlay(text: string, options?: BadgeOptions): string {
  const position = options?.position ?? 'top-right'
  const color = options?.color ?? 'vivid red'
  const shape = options?.shape ?? 'rounded rectangle'

  return [
    `render the exact Korean text "${text}" as a prominent promotional badge`,
    `positioned at the ${position} corner of the composition`,
    `${shape} badge shape with ${color} fill and white bold Korean typography`,
    `use Pretendard Bold or equivalent heavy sans-serif hangul font`,
    `high contrast and fully readable at thumbnail size`,
    `preserve the Korean characters exactly as written — do not translate, romanize, or alter them in any way`,
    `keep badge size proportionate (≈10-15% of image area) and do not obscure the product`,
  ].join(', ')
}

// ─── buildImagePrompt ────────────────────────────────────────────────────────

/**
 * 5계층을 조립하여 최종 이미지 생성 프롬프트를 반환합니다.
 * Gemini 3.1 Flash Image Preview (Nano Banana 2) 최적화 형식.
 *
 * @param layers - 5개 계층 프롬프트 구성 요소
 * @returns 조립된 최종 프롬프트 문자열
 */
export function buildImagePrompt(layers: PromptLayers): string {
  const parts: string[] = []

  // [1] Subject Anchor — 반드시 가장 먼저 기입 (모델이 제품을 anchor로 인식)
  parts.push(`SUBJECT: ${layers.subjectAnchor.trim()}`)

  // [2] Scene
  parts.push(`SCENE: ${layers.scene.trim()}`)

  // [3] Mood / Style
  parts.push(`STYLE: ${layers.moodStyle.trim()}`)

  // [4] Composition
  parts.push(`COMPOSITION: ${layers.composition.trim()}`)

  // [5] TextOverlay (선택)
  if (layers.textOverlay?.trim()) {
    parts.push(`TEXT OVERLAY: ${layers.textOverlay.trim()}`)
  }

  // [6] Consistency — 상세페이지 컷 세트 일관성 (선택)
  if (layers.consistency?.trim()) {
    parts.push(`CONSISTENCY: ${layers.consistency.trim()}`)
  }

  // 네거티브 프롬프트를 끝에 명시 (프리셋 고유 네거티브 병합)
  const negative = layers.extraNegative?.trim()
    ? `${GLOBAL_NEGATIVE_PROMPT}, ${layers.extraNegative.trim()}`
    : GLOBAL_NEGATIVE_PROMPT
  parts.push(`NEGATIVE: ${negative}`)

  return parts.join('\n')
}

// ─── buildPromptLayers: AnalyzeResult → PromptLayers 자동 조립 ──────────────

export interface BuildLayersInput {
  /** image-analyzer 분석 결과 */
  category: string
  colors: string[]
  style: string
  mood: string
  keyFeatures: string[]
  keywords: string[]
  /** 사용자 선택 종횡비 (기본: '4:5') */
  aspectRatio?: AspectRatio
  /** 커스텀 배경 설명 (없으면 자동 생성) */
  customScene?: string
  /** 한글 배지 텍스트 (예: '신상', '20% 할인', '무료배송') */
  overlayText?: string
  /** 한글 배지 스타일링 옵션 (위치·색·모양) — 생략 시 top-right / vivid red / rounded rectangle */
  overlayBadge?: BadgeOptions
  /** 상세페이지 샷 프리셋 — 지정 시 scene/composition 을 프리셋이 소유 */
  shotPreset?: ShotPreset
  /** 컷 세트 일관성 블록 포함 여부 (상세페이지 컷 오케스트레이션) */
  consistency?: { heroColorNote?: string; hasReferenceSet?: boolean }
}

/**
 * 분석 결과와 파라미터를 받아 5계층 레이어를 자동으로 조립합니다.
 * buildImagePrompt()와 함께 사용합니다.
 */
export function buildPromptLayers(input: BuildLayersInput): PromptLayers {
  const ratio = input.aspectRatio ?? '4:5'

  // [1] Subject Anchor — 제품의 핵심 정체성 보존
  const subjectAnchor = [
    `the exact same ${input.category}`,
    input.colors.length > 0 ? `in ${input.colors.slice(0, 2).join(' and ')}` : '',
    input.keyFeatures.length > 0 ? `with ${input.keyFeatures.slice(0, 2).join(', ')}` : '',
    '— preserve original product appearance, shape, color, and all distinguishing details exactly',
  ]
    .filter(Boolean)
    .join(' ')

  // 샷 프리셋 — 지정 시 scene/composition 을 프리셋이 소유하고 종횡비 구도는 힌트로 격하
  const preset = input.shotPreset ? SHOT_PRESET_SPECS[input.shotPreset] : undefined

  // [2] Scene — 프리셋 > 커스텀 > 자동
  const scene =
    preset?.scene ??
    (input.customScene?.trim() || buildAutoScene(input.style, input.mood))

  // [3] Mood / Style — 한국 쇼핑몰 스타일
  const moodKey = normalizeMoodKey(input.mood)
  const moodStyle =
    KOREAN_SHOPPING_MOOD_MAP[moodKey] ??
    `${input.mood} style, professional product photography, Korean e-commerce optimized`

  // [4] Composition — 프리셋 구도 + 텍스트 세이프 존, 없으면 종횡비별 구도
  const composition = preset
    ? `${preset.composition}, ${ASPECT_RATIO_COMPOSITION[ratio]}, ${TEXT_SAFE_ZONE}`
    : ASPECT_RATIO_COMPOSITION[ratio]

  // [5] TextOverlay — 한글 배지가 있으면 모델이 정확히 렌더링하도록 구체 지시로 변환
  //     단순 문자열이 전달되면 buildTextOverlay()로 스타일링(위치/색/폰트/모양) 주입
  //     (프리셋 컷은 텍스트 금지 원칙이므로 배지와 동시 사용을 권장하지 않음)
  const textOverlay = input.overlayText?.trim()
    ? buildTextOverlay(input.overlayText.trim(), input.overlayBadge)
    : undefined

  // [6] Consistency — 상세페이지 컷 세트 일관성
  const consistency = input.consistency
    ? buildConsistencyBlock(input.consistency)
    : undefined

  return {
    subjectAnchor, scene, moodStyle, composition, textOverlay,
    consistency,
    extraNegative: preset?.negative,
  }
}

// ─── 내부 유틸 ────────────────────────────────────────────────────────────────

function buildAutoScene(style: string, mood: string): string {
  const sceneParts: string[] = []

  if (/premium|luxury|high.?end/i.test(style + mood)) {
    sceneParts.push('sleek marble surface, subtle gradient background in soft grey and white')
  } else if (/natural|organic|eco/i.test(style + mood)) {
    sceneParts.push('wooden table surface, soft green foliage in background, natural diffused light')
  } else if (/casual|lifestyle|everyday/i.test(style + mood)) {
    sceneParts.push('light linen fabric surface, airy indoor setting with soft window light')
  } else if (/sport|active|dynamic/i.test(style + mood)) {
    sceneParts.push('textured concrete surface, dramatic directional lighting, dark vignette edges')
  } else {
    // 기본: 미니멀 스튜디오
    sceneParts.push('pure white seamless studio background, soft even lighting from above-left')
  }

  return sceneParts.join(', ')
}

function normalizeMoodKey(mood: string): string {
  const lower = mood.toLowerCase()
  if (/minimal|clean|simple/.test(lower)) return 'minimal'
  if (/premium|luxury|high.?end/.test(lower)) return 'premium'
  if (/casual|everyday|friendly/.test(lower)) return 'casual'
  if (/sport|active|dynamic|energy/.test(lower)) return 'sporty'
  if (/natural|organic|eco|earth/.test(lower)) return 'natural'
  if (/feminine|cute|romantic|soft/.test(lower)) return 'feminine'
  if (/functional|technical|utility/.test(lower)) return 'functional'
  return 'minimal'
}
