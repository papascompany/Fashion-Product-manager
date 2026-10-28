/**
 * 상세설명 문단 분할 + 문단 사이 사진 배치.
 *
 * 04 상세설명 미리보기 · 상세페이지 편집기 · 서버 조립기(detail-page route)가 같은 규칙으로
 * 문단을 나눠야 사진 위치가 세 곳에서 일치한다. 순수 함수만 둔다(클라이언트·서버 공용).
 */

// 상세설명은 "1. 핏 / 2. 소재 / 3. 디자인 / 4. 코디추천" 번호 섹션 구조로 생성된다
// (fashion-curation-style FOUR_SECTION_STRUCTURE). 본문 줄은 들여쓰기되므로 들여쓰기 없는
// "N. " 줄만 섹션 제목으로 본다. "2.5cm" 같은 소수는 제외.
const SECTION_HEADING = /^\d{1,2}\.(?!\d)[ \t]*\S/

function trimBlock(block: string): string {
  return block.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
}

/** 상세설명을 문단 배열로 나눈다. 번호 섹션이 2개 이상이면 섹션 단위, 아니면 빈 줄 단위. */
export function splitParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const headings: number[] = []
  lines.forEach((line, i) => {
    if (SECTION_HEADING.test(line)) headings.push(i)
  })

  let blocks: string[]
  if (headings.length >= 2) {
    blocks = []
    if (headings[0] > 0) blocks.push(lines.slice(0, headings[0]).join('\n'))
    headings.forEach((start, k) => {
      blocks.push(lines.slice(start, headings[k + 1] ?? lines.length).join('\n'))
    })
  } else {
    blocks = normalized.split(/\n[ \t]*\n/)
  }
  return blocks.map(trimBlock).filter((b) => b.length > 0)
}

export function joinParagraphs(paragraphs: string[]): string {
  return paragraphs.map(trimBlock).filter((p) => p.length > 0).join('\n\n')
}

/** index 번째 문단만 바꾼 전체 텍스트. 빈 값이면 그 문단을 지운다. */
export function replaceParagraph(text: string, index: number, value: string): string {
  const paragraphs = splitParagraphs(text)
  if (index < 0 || index >= paragraphs.length) return text
  paragraphs[index] = value
  return joinParagraphs(paragraphs)
}

/** 사진이 들어갈 수 있는 문단 사이 칸 수. */
export function descriptionGapCount(text: string): number {
  return Math.max(0, splitParagraphs(text).length - 1)
}

/** 문단 사이 칸별 이미지 URL. index i = i번째 문단 바로 뒤. null = 비움. */
export type DescriptionImageSlots = Array<string | null>

/**
 * 실제로 표시할 칸별 이미지.
 * explicit(사용자가 한 번이라도 고친 배치)이 있으면 그대로, 없으면 pool 순서대로 자동 배치.
 */
export function resolveDescriptionImages(
  explicit: DescriptionImageSlots | null,
  pool: string[],
  gaps: number,
): DescriptionImageSlots {
  if (gaps <= 0) return []
  const source: DescriptionImageSlots = explicit ?? pool
  return Array.from({ length: gaps }, (_, i) => source[i] ?? null)
}

export interface PoolFitting {
  url: string
  aspectRatio: string
  variantId?: string
}

export interface PoolThumbnail {
  url?: string
  ratio: string
}

// 세로형 상세페이지 본문에 어울리는 순서
const RATIO_PREFERENCE = ['4:5', '3:4', '1:1', '9:16', '2:3', '4:3', '16:9']

function ratioRank(ratio: string): number {
  const i = RATIO_PREFERENCE.indexOf(ratio)
  return i === -1 ? RATIO_PREFERENCE.length : i
}

/**
 * 자동 배치 후보 순서: 변형별 대표 1장 → 나머지 피팅 → 썸네일 → 대표(hero) 사진.
 * hero 는 상세페이지 맨 위에 이미 쓰이므로 본문에는 마지막 후보로만 둔다.
 */
export function buildDescriptionImagePool(input: {
  fittings: PoolFitting[]
  thumbnails: PoolThumbnail[]
  heroUrl?: string | null
}): string[] {
  const { fittings, thumbnails, heroUrl } = input
  const out: string[] = []
  const seen = new Set<string>()
  let heroSeen = false
  const push = (url: string | undefined) => {
    if (!url) return
    if (url === heroUrl) {
      heroSeen = true
      return
    }
    if (seen.has(url)) return
    seen.add(url)
    out.push(url)
  }

  const byRatio = <T extends { ratio: string }>(a: T, b: T) => ratioRank(a.ratio) - ratioRank(b.ratio)
  const groups = new Map<string, PoolFitting[]>()
  for (const f of fittings) {
    const key = f.variantId ?? 'original'
    const list = groups.get(key) ?? []
    list.push(f)
    groups.set(key, list)
  }
  const sortedGroups = [...groups.values()].map((list) =>
    list.map((f) => ({ url: f.url, ratio: f.aspectRatio })).sort(byRatio),
  )

  for (const list of sortedGroups) push(list[0]?.url)
  for (const list of sortedGroups) list.slice(1).forEach((f) => push(f.url))
  thumbnails
    .filter((t): t is PoolThumbnail & { url: string } => Boolean(t.url))
    .sort(byRatio)
    .forEach((t) => push(t.url))

  if (heroUrl && heroSeen) out.push(heroUrl)
  return out
}
