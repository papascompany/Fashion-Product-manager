/**
 * 생성 이미지 다운로드 (브라우저 전용).
 *
 * 1장은 파일 그대로, 2장 이상은 ZIP 으로 묶는다. 이미지는 Supabase Storage 공개 URL 이라
 * `<a download>` 를 직접 걸면 교차 출처로 무시되고 새 탭이 열린다 — 그래서 blob 으로 받아 저장한다.
 */

export interface DownloadItem {
  url: string
  /** 확장자 없는 파일명. 확장자는 실제 MIME 으로 붙인다. */
  name: string
}

export interface DownloadOutcome {
  saved: number
  failed: number
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function sanitizeFilePart(value: string, max = 40): string {
  return value
    .normalize('NFC')
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
}

/** '4:5' → '4x5' (파일명에 콜론 불가) */
export function ratioToken(ratio: string): string {
  return ratio.replace(/:/g, 'x')
}

/** ['린넨 셔츠', '네이비', '4x5'] → '린넨-셔츠_네이비_4x5' */
export function buildImageName(parts: Array<string | null | undefined>): string {
  const cleaned = parts
    .map((p) => (p ? sanitizeFilePart(p) : ''))
    .filter((p) => p.length > 0)
  return cleaned.join('_') || 'image'
}

function extFor(blob: Blob, url: string): string {
  const byMime = EXT_BY_MIME[blob.type]
  if (byMime) return byMime
  const m = url.match(/\.(png|jpe?g|webp)(?:[?#]|$)/i)
  if (m) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()
  return 'png'
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(5, comma)
  const mime = meta.split(';')[0] || 'application/octet-stream'
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function fetchBlob(url: string): Promise<Blob> {
  // data: 는 CSP connect-src 에 없으므로 fetch 하지 않고 직접 디코드
  if (url.startsWith('data:')) return dataUrlToBlob(url)
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 일부 브라우저는 click 직후 revoke 하면 저장이 취소된다
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

export async function downloadImages(items: DownloadItem[], zipName: string): Promise<DownloadOutcome> {
  if (items.length === 0) return { saved: 0, failed: 0 }

  if (items.length === 1) {
    const [item] = items
    const blob = await fetchBlob(item.url)
    saveBlob(blob, `${item.name}.${extFor(blob, item.url)}`)
    return { saved: 1, failed: 0 }
  }

  const results = await Promise.allSettled(
    items.map(async (item) => ({ item, blob: await fetchBlob(item.url) })),
  )

  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const used = new Set<string>()
  let saved = 0
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    const { item, blob } = r.value
    const ext = extFor(blob, item.url)
    let filename = `${item.name}.${ext}`
    for (let n = 2; used.has(filename); n++) filename = `${item.name}-${n}.${ext}`
    used.add(filename)
    zip.file(filename, blob)
    saved++
  }

  if (saved === 0) throw new Error('이미지를 내려받지 못했습니다. 잠시 후 다시 시도해주세요.')

  const archive = await zip.generateAsync({ type: 'blob' })
  saveBlob(archive, `${sanitizeFilePart(zipName, 60) || 'images'}.zip`)
  return { saved, failed: items.length - saved }
}
