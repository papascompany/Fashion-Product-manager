/**
 * opt-in 클라이언트 래스터화 (WS4)
 *
 * 편집기의 "이미지로 내보내기" 액션에서만 호출되는 순수 클라이언트 모듈.
 * 자동 실행 요소 없음 — 함수/상수만 export. "use client" 컴포넌트에서 import.
 *
 * 흐름: HTMLElement 캡처(html-to-image) → 플랫폼 preset.width 로 다운스케일
 *   → preset.maxSliceHeight 단위로 세로 슬라이스(가능하면 섹션 경계 근처)
 *   → 투명 감지 시 PNG, 아니면 JPEG(quality) → JSZip 으로 묶어 다운로드.
 * 실패 시 throw — 호출측(편집기)에서 try/catch 하여 사용자에게 안내.
 */

import { toCanvas } from 'html-to-image'
import JSZip from 'jszip'

export interface PlatformPreset {
  id: 'smartstore' | 'coupang' | 'gmarket' | 'wemakeprice'
  label: string
  /** 최종 내보내기 가로폭(px) */
  width: number
  /** 이 높이(px)를 초과하면 세로 분할 */
  maxSliceHeight: number
  /** 'auto' = 투명 감지 시 PNG, 아니면 JPEG */
  format: 'auto' | 'png' | 'jpeg'
  /** JPEG 품질(0~1) */
  quality: number
}

/** PRD §4 수치 (스마트스토어 860/5000, 쿠팡 780/3000, G마켓 860/4000, 위메프 758/3000) */
export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: 'smartstore',
    label: '스마트스토어 (860px / 장당 5,000px)',
    width: 860,
    maxSliceHeight: 5000,
    format: 'auto',
    quality: 0.9,
  },
  {
    id: 'coupang',
    label: '쿠팡 (780px / 장당 3,000px)',
    width: 780,
    maxSliceHeight: 3000,
    format: 'auto',
    quality: 0.85,
  },
  {
    id: 'gmarket',
    label: 'G마켓·옥션 (860px / 장당 4,000px)',
    width: 860,
    maxSliceHeight: 4000,
    format: 'auto',
    quality: 0.9,
  },
  {
    id: 'wemakeprice',
    label: '위메프 (758px / 장당 3,000px, 강압축)',
    width: 758,
    maxSliceHeight: 3000,
    format: 'jpeg',
    quality: 0.8,
  },
]

/** 내부 렌더 슈퍼샘플 배율 (출력폭 대비). 다운스케일로 텍스트 선명도 확보. */
const SUPERSAMPLE = 2
/** 이 값보다 가까운 섹션 경계는 슬라이스 컷으로 스냅 */
const BOUNDARY_SNAP_TOLERANCE = 0.4

/**
 * 주어진 요소를 플랫폼 preset 규격의 세로 슬라이스 이미지 zip 으로 내보낸다.
 * @throws 캡처/인코딩 실패 시 Error
 */
export async function exportDetailPageAsImages(
  el: HTMLElement,
  opts: { preset: PlatformPreset; fileBaseName?: string },
): Promise<void> {
  const { preset } = opts
  const baseName = sanitizeBaseName(opts.fileBaseName ?? `detail-${preset.id}`)

  const rect = el.getBoundingClientRect()
  const sourceCssWidth = rect.width || el.offsetWidth
  if (sourceCssWidth <= 0) {
    throw new Error('내보낼 요소의 너비를 측정할 수 없습니다.')
  }

  // 출력폭의 SUPERSAMPLE 배로 렌더 → 다운스케일 시 선명.
  const pixelRatio = (preset.width * SUPERSAMPLE) / sourceCssWidth

  // 투명 감지를 위해 배경 없이(투명) 캡처.
  const sourceCanvas = await toCanvas(el, {
    pixelRatio,
    backgroundColor: undefined,
    cacheBust: true,
  })

  // 출력(px) 좌표계: preset.width 기준.
  const outScale = preset.width / sourceCssWidth
  const cssHeight = sourceCanvas.height / pixelRatio
  const outHeight = Math.max(1, Math.round(cssHeight * outScale))
  // source px 당 output px 비율 (동일 배율 y): source/output = pixelRatio/outScale = SUPERSAMPLE
  const srcPerOut = sourceCanvas.height / outHeight

  const boundaries = collectBoundaryOffsets(el, rect, outScale, outHeight)
  const cuts = computeSliceCuts(outHeight, preset.maxSliceHeight, boundaries)

  // 포맷 결정: 'auto' 는 투명 픽셀 존재 여부로 PNG/JPEG 선택.
  let useFormat: 'png' | 'jpeg'
  if (preset.format === 'auto') {
    useFormat = detectTransparency(sourceCanvas) ? 'png' : 'jpeg'
  } else {
    useFormat = preset.format
  }
  const ext = useFormat === 'png' ? 'png' : 'jpg'
  const mime = useFormat === 'png' ? 'image/png' : 'image/jpeg'

  const zip = new JSZip()
  const pad = String(cuts.length).length

  for (let i = 0; i < cuts.length; i++) {
    const oy0 = cuts[i]
    const oy1 = cuts[i + 1] ?? outHeight
    const sliceOutHeight = oy1 - oy0
    if (sliceOutHeight <= 0) continue

    const sliceCanvas = document.createElement('canvas')
    sliceCanvas.width = preset.width
    sliceCanvas.height = sliceOutHeight
    const ctx = sliceCanvas.getContext('2d')
    if (!ctx) throw new Error('캔버스 2D 컨텍스트를 생성할 수 없습니다.')

    // JPEG 는 알파를 지원하지 않으므로 흰 배경 합성.
    if (useFormat === 'jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height)
    }

    ctx.drawImage(
      sourceCanvas,
      0,
      oy0 * srcPerOut,
      sourceCanvas.width,
      sliceOutHeight * srcPerOut,
      0,
      0,
      preset.width,
      sliceOutHeight,
    )

    const blob = await canvasToBlob(sliceCanvas, mime, preset.quality)
    const index = String(i + 1).padStart(pad, '0')
    zip.file(`${baseName}_${index}.${ext}`, blob)
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  triggerDownload(zipBlob, `${baseName}.zip`)
}

/** 직접 자식 요소들의 상단 y(출력 px)를 섹션 경계 후보로 수집. */
function collectBoundaryOffsets(
  el: HTMLElement,
  rootRect: DOMRect,
  outScale: number,
  outHeight: number,
): number[] {
  const offsets = new Set<number>()
  const children = el.querySelectorAll<HTMLElement>(':scope > *')
  children.forEach((child) => {
    const top = (child.getBoundingClientRect().top - rootRect.top) * outScale
    if (top > 0 && top < outHeight) {
      offsets.add(Math.round(top))
    }
  })
  return Array.from(offsets).sort((a, b) => a - b)
}

/**
 * [0, outHeight) 를 maxSliceHeight 이하 조각들의 시작 y 배열로 분할.
 * 각 컷은 maxSliceHeight 목표 근처의 섹션 경계로 스냅(있으면), 없으면 고정 높이.
 */
function computeSliceCuts(
  outHeight: number,
  maxSliceHeight: number,
  boundaries: number[],
): number[] {
  const cuts: number[] = [0]
  if (outHeight <= maxSliceHeight) return cuts

  let current = 0
  const minStep = Math.max(1, Math.floor(maxSliceHeight * BOUNDARY_SNAP_TOLERANCE))

  while (outHeight - current > maxSliceHeight) {
    const target = current + maxSliceHeight
    // (current+minStep, target] 범위 내 가장 큰 경계로 스냅.
    let next = -1
    for (const b of boundaries) {
      if (b > current + minStep && b <= target && b > next) next = b
    }
    if (next <= current) next = target
    cuts.push(next)
    current = next
  }
  return cuts
}

/** 캔버스에 alpha < 255 픽셀이 있으면 true. 읽기 실패 시 안전하게 true(PNG). */
function detectTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return true
  try {
    // 성능을 위해 세로로 샘플링(전체 폭, 일정 간격 행).
    const step = Math.max(1, Math.floor(canvas.height / 400))
    for (let y = 0; y < canvas.height; y += step) {
      const data = ctx.getImageData(0, y, canvas.width, 1).data
      for (let x = 3; x < data.length; x += 4) {
        if (data[x] < 255) return true
      }
    }
    return false
  } catch {
    return true
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('이미지 인코딩에 실패했습니다.'))
      },
      mime,
      quality,
    )
  })
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 다운로드 트리거 후 objectURL 회수.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function sanitizeBaseName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9가-힣_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'detail-page'
}
