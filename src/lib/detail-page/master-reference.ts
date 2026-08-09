/**
 * 마스터 레퍼런스 세트 파생 (Phase 2 심화 — 컷 간 상품 아이덴티티 일관성)
 *
 * PRD §3 ①: 원본 상품 이미지 1장으로부터 "정면 + 디테일 + 컬러칩" 레퍼런스 세트를
 * 만들어, 모든 하위 컷 요청에 다중 레퍼런스로 동봉한다. 모델이 상품을 한 각도가 아니라
 * 여러 정규화된 뷰로 인식해 색·질감·형태 드리프트가 줄어든다.
 *
 * 설계:
 *  - **정면(front)** = 원본 이미지 그 자체(패널이 primary 로 이미 전송) → 여기서 파생 안 함.
 *  - **디테일(detail)** = 중앙 확대 크롭. 소재 결·스티치·하드웨어를 근접 노출.
 *  - **컬러칩(colorChip)** = 지배 색상 스와치. 중립 배경 위 색 밴드로 화이트밸런스·색 앵커.
 *
 * 순수 클라이언트(canvas). Gemini 추가 호출 없음 → 크레딧 영향 0.
 * CORS 타인트/디코드 실패 등 어떤 단계라도 실패하면 **null 반환**(graceful) →
 * 호출측은 기존 단일 레퍼런스 동작으로 폴백한다(회귀 없음).
 */

export interface ReferenceAnchors {
  /** 디테일 근접 크롭 (JPEG data URL) */
  detail: string
  /** 지배 색상 컬러칩 (JPEG data URL) */
  colorChip: string
}

const DETAIL_SIZE = 768
const COLORCHIP_SIZE = 512
/** 중앙 크롭 비율 — 원본의 가운데 55% 영역을 확대 */
const DETAIL_CROP_RATIO = 0.55
const JPEG_QUALITY = 0.9

/**
 * 원본 상품 이미지(data URL 또는 https URL)에서 디테일·컬러칩 앵커를 파생한다.
 * 브라우저 전용. 실패 시 null.
 */
export async function deriveReferenceAnchors(source: string): Promise<ReferenceAnchors | null> {
  if (typeof document === 'undefined') return null // SSR 가드
  try {
    const img = await loadImage(source)
    if (!img.naturalWidth || !img.naturalHeight) return null

    const detail = renderDetailCrop(img)
    const colorChip = renderColorChip(img)
    if (!detail || !colorChip) return null

    return { detail, colorChip }
  } catch {
    // 디코드 실패·CORS 타인트(SecurityError) 등 — 조용히 폴백
    return null
  }
}

// ─── 내부 구현 ──────────────────────────────────────────────────────────────

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // https URL 은 CORS 로 로드해야 canvas 오염 없이 toDataURL 가능.
    // data: URL 은 crossOrigin 무관하지만 설정해도 무해.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = source
  })
}

/** 중앙 55% 영역을 잘라 정사각 캔버스에 확대(cover) 렌더. */
function renderDetailCrop(img: HTMLImageElement): string | null {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const side = Math.floor(Math.min(w, h) * DETAIL_CROP_RATIO)
  if (side <= 0) return null
  const sx = Math.floor((w - side) / 2)
  const sy = Math.floor((h - side) / 2)

  const canvas = document.createElement('canvas')
  canvas.width = DETAIL_SIZE
  canvas.height = DETAIL_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, side, side, 0, 0, DETAIL_SIZE, DETAIL_SIZE)
  return safeToDataUrl(canvas)
}

/** 지배 색상 2~3개를 뽑아 세로 밴드 스와치로 렌더. */
function renderColorChip(img: HTMLImageElement): string | null {
  const colors = dominantColors(img, 3)
  if (colors.length === 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = COLORCHIP_SIZE
  canvas.height = COLORCHIP_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const bandW = COLORCHIP_SIZE / colors.length
  colors.forEach((c, i) => {
    ctx.fillStyle = `rgb(${c[0]}, ${c[1]}, ${c[2]})`
    ctx.fillRect(Math.round(i * bandW), 0, Math.ceil(bandW), COLORCHIP_SIZE)
  })
  return safeToDataUrl(canvas)
}

/**
 * 이미지를 32×32 로 다운스케일 후 RGB 를 32단계로 양자화해 히스토그램을 만들고,
 * 빈도 상위 색을 반환. 거의 흰색/검정(배경 추정)은 후순위로 밀되, 전부 그런 경우
 * 그대로 사용한다.
 */
function dominantColors(img: HTMLImageElement, max: number): Array<[number, number, number]> {
  const S = 32
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, S, S)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, S, S).data
  } catch {
    return [] // 타인트 → 폴백
  }

  const hist = new Map<number, { count: number; r: number; g: number; b: number; neutral: boolean }>()
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 128) continue // 투명(누끼) 픽셀 무시
    const r = data[i], g = data[i + 1], b = data[i + 2]
    // 32단계 양자화 키
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const max3 = Math.max(r, g, b), min3 = Math.min(r, g, b)
    // 배경 추정: 매우 밝거나(>235) 매우 어둡고(<20) 채도가 낮은 픽셀
    const neutral = (max3 > 235 || min3 < 20) && (max3 - min3) < 24
    const e = hist.get(key)
    if (e) e.count++
    else hist.set(key, { count: 1, r, g, b, neutral })
  }
  if (hist.size === 0) return []

  const entries = Array.from(hist.values())
  const nonNeutral = entries.filter((e) => !e.neutral)
  const pool = nonNeutral.length > 0 ? nonNeutral : entries
  pool.sort((a, b) => b.count - a.count)
  return pool.slice(0, max).map((e) => [e.r, e.g, e.b] as [number, number, number])
}

/** toDataURL 은 canvas 오염 시 SecurityError 를 던진다 → null 로 폴백. */
function safeToDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } catch {
    return null
  }
}
