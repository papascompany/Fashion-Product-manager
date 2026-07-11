/**
 * 상세페이지 HTML 자동 조립 API
 * POST /api/generate/detail-page
 *
 * v2 (detail-page-engine): 테마 토큰(WS1 buildThemeStyle) 구동 + 섹션별 프리미엄 템플릿.
 * - 860px 고정 캔버스, docs/mockups 수준의 섹션 마크업.
 * - 커머스 금지: 어떤 섹션도 가격/구매버튼을 렌더하지 않는다 (판매 플랫폼 몫).
 * - 한글 타이포/CTA 는 조립 HTML 의 자체호스팅 @font-face 로 오버레이 (AI 이미지에 굽지 않음).
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { buildThemeStyle, DEFAULT_THEME } from '@/lib/detail-page/themes'
import type { ThemeId } from '@/lib/detail-page/themes'
import type { DetailSection, ShotSlot } from '@/store/studio'

// ─── 스키마 ─────────────────────────────────────────────────────────────────

const THEME_IDS = ['editorial-minimal', 'soft-luxury-serif', 'clean-conversion'] as const

const shotSlotSchema = z.enum(['productShot', 'fitShot', 'detailShot', 'lifestyle'])

const galleryItemSchema = z.object({
  url: z.string().optional(),
  shotSlot: shotSlotSchema,
  caption: z.string().optional(),
})
const materialCellSchema = z.object({
  kind: z.enum(['image', 'text']),
  shotSlot: shotSlotSchema.optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  span: z.enum(['big', 'wide', 'normal']).optional(),
})
const lookSchema = z.object({ shotSlot: shotSlotSchema, caption: z.string().optional() })
const specRowSchema = z.object({ label: z.string(), values: z.array(z.string()) })
const trustBadgeSchema = z.object({ title: z.string(), desc: z.string().optional() })
const legalFieldSchema = z.object({ label: z.string(), value: z.string() })

/**
 * 계약(SHARED CONTRACT) 의 DetailSection union 을 런타임 검증용으로 미러링.
 * 각 기존 섹션에 optional shotSlot 추가 + 신규 variants 포함. 모두 id:string.
 */
const SectionSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('hero'),        title: z.string(), tagline: z.string(), image: z.string().optional(), shotSlot: shotSlotSchema.optional() }),
  z.object({ id: z.string(), type: z.literal('features'),    heading: z.string(), items: z.array(z.string()), shotSlot: shotSlotSchema.optional() }),
  z.object({ id: z.string(), type: z.literal('description'), content: z.string(), shotSlot: shotSlotSchema.optional() }),
  z.object({ id: z.string(), type: z.literal('keywords'),    items: z.array(z.string()), shotSlot: shotSlotSchema.optional() }),
  z.object({ id: z.string(), type: z.literal('reviews'),     placeholder: z.string(), shotSlot: shotSlotSchema.optional() }),
  z.object({ id: z.string(), type: z.literal('cta'),         label: z.string(), url: z.string().optional(), shotSlot: shotSlotSchema.optional() }),
  z.object({ id: z.string(), type: z.literal('text'),        heading: z.string().optional(), content: z.string(), shotSlot: shotSlotSchema.optional() }),
  z.object({ id: z.string(), type: z.literal('image'),       url: z.string(), caption: z.string().optional(), shotSlot: shotSlotSchema.optional() }),
  z.object({ id: z.string(), type: z.literal('gallery'),     heading: z.string().optional(), items: z.array(galleryItemSchema) }),
  z.object({ id: z.string(), type: z.literal('feature-split'), heading: z.string(), body: z.string(), shotSlot: shotSlotSchema, reverse: z.boolean().optional() }),
  z.object({ id: z.string(), type: z.literal('material'),    heading: z.string().optional(), cells: z.array(materialCellSchema) }),
  z.object({ id: z.string(), type: z.literal('lookbook'),    heading: z.string().optional(), looks: z.array(lookSchema) }),
  z.object({ id: z.string(), type: z.literal('size-spec'),   caption: z.string().optional(), columns: z.array(z.string()), rows: z.array(specRowSchema), note: z.string().optional() }),
  z.object({ id: z.string(), type: z.literal('trust'),       rating: z.string().optional(), quote: z.string().optional(), quoteMeta: z.string().optional(), badges: z.array(trustBadgeSchema) }),
  z.object({ id: z.string(), type: z.literal('benefit-banner'), text: z.string() }),
  z.object({ id: z.string(), type: z.literal('legal'),       fields: z.array(legalFieldSchema), aiNotice: z.string().optional() }),
  z.object({ id: z.string(), type: z.literal('closing'),     heading: z.string(), subtext: z.string().optional() }),
])

const DetailPageSchema = z.object({
  projectId: z.string().uuid(),
  productName: z.string(),
  tagline: z.string(),
  description: z.string(),
  category: z.string(),
  keywords: z.array(z.string()),
  features: z.array(z.string()),
  thumbnailUrl: z.string().url().optional(),
  /** 테마 — 요청/plan 에서 받되 없으면 DEFAULT_THEME */
  themeId: z.enum(THEME_IDS).optional(),
  /** 사용자가 에디터로 편집한 섹션 배열 */
  sections: z.array(SectionSchema).optional(),
})

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const body = await request.json()
    const parsed = DetailPageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const data = parsed.data
    const themeId: ThemeId = data.themeId ?? DEFAULT_THEME

    // 계약상 zod 미러 스키마의 결과는 스토어 DetailSection union 과 동형(verbatim).
    const sections: DetailSection[] =
      data.sections && data.sections.length > 0
        ? (data.sections as DetailSection[])
        : buildFallbackSections(data)

    const html = assembleThemedPage(sections, {
      themeId,
      title: data.productName,
      keywords: data.keywords,
    })

    // generations 테이블에 저장
    await supabase.from('generations').insert({
      project_id: data.projectId,
      type: 'detail_page',
      payload: { html, productName: data.productName, themeId } as unknown as Record<string, unknown>,
    })

    return NextResponse.json({ html, projectId: data.projectId, themeId })
  } catch (err) {
    console.error('[/api/generate/detail-page]', err)
    return NextResponse.json({ error: '상세페이지 생성 실패' }, { status: 500 })
  }
}

// ─── 레거시 입력 → 섹션 매핑 (커머스 없음) ──────────────────────────────────

interface DetailPageInput {
  productName: string
  tagline: string
  description: string
  category: string
  keywords: string[]
  features: string[]
  thumbnailUrl?: string
}

/** sections 미제공 시 기본 상세페이지 골격을 섹션으로 구성 (가격/구매버튼 없음). */
function buildFallbackSections(d: DetailPageInput): DetailSection[] {
  const out: DetailSection[] = [
    { id: 'hero', type: 'hero', title: d.productName, tagline: d.tagline, image: d.thumbnailUrl, shotSlot: 'fitShot' },
  ]
  if (d.features.length > 0) {
    out.push({ id: 'features', type: 'features', heading: '이런 점이 특별합니다', items: d.features.slice(0, 8) })
  }
  out.push({ id: 'description', type: 'description', content: d.description })
  if (d.keywords.length > 0) {
    out.push({ id: 'keywords', type: 'keywords', items: d.keywords.slice(0, 10) })
  }
  out.push({ id: 'reviews', type: 'reviews', placeholder: '첫 번째 후기의 주인공이 되어 주세요.' })
  out.push({ id: 'closing', type: 'closing', heading: '지금, 이 한 벌의 여유를', subtext: d.tagline })
  out.push({
    id: 'legal',
    type: 'legal',
    fields: [
      { label: '카테고리', value: d.category },
      { label: '제품명', value: d.productName },
    ],
  })
  return out
}

// ─── 테마-어웨어 조립기 ──────────────────────────────────────────────────────

function assembleThemedPage(
  sections: DetailSection[],
  meta: { themeId: ThemeId; title: string; keywords: string[] },
): string {
  const body = sections.map((s, i) => renderSection(s, i)).filter(Boolean).join('\n')
  const themeVars = buildThemeStyle(meta.themeId)
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="keywords" content="${escapeHtml(meta.keywords.join(', '))}">
<title>${escapeHtml(meta.title || '상품 상세페이지')} — 상세페이지</title>
<style>${themeVars}</style>
<style>${CANVAS_STYLES}</style>
</head>
<body>
<main class="dp" data-theme-id="${escapeHtml(meta.themeId)}">
${body}
</main>
</body>
</html>`
}

// ─── 섹션 렌더러 ─────────────────────────────────────────────────────────────

function renderSection(s: DetailSection, i: number): string {
  const no = String(i + 1).padStart(2, '0')

  switch (s.type) {
    // ── HERO — 풀블리드 컷 + 오버레이 카피 (제목 → 카피) ──────────────────
    case 'hero': {
      const shot = heroShot({ slot: s.shotSlot ?? 'fitShot', url: s.image, alt: s.title })
      return `<section class="hero">
${shot}
<div class="hero__scrim"></div>
<div class="hero__copy">
<h1>${escapeHtml(s.title)}</h1>
<p class="hero__tag">${escapeHtml(s.tagline)}</p>
</div>
</section>`
    }

    // ── FEATURES — 넘버드 카드 그리드 ─────────────────────────────────────
    case 'features': {
      const cards = s.items.slice(0, 12)
        .map((f, idx) => `<div class="feat-card"><div class="feat-card__n">${String(idx + 1).padStart(2, '0')}</div><p>${escapeHtml(f)}</p></div>`)
        .join('')
      return band(
        `${eyebrow(no, '핵심 특징')}<h2 class="title">${escapeHtml(s.heading)}</h2><div class="grid-feat">${cards}</div>`,
        { alt: false },
      )
    }

    // ── DESCRIPTION — 스토리 본문 (sand 밴드) ─────────────────────────────
    case 'description':
      return band(
        `${eyebrow(no, '상품 이야기')}<h2 class="title">상품 소개</h2><p class="body">${escapeHtml(s.content)}</p>`,
        { alt: true },
      )

    // ── KEYWORDS — 태그 칩 ────────────────────────────────────────────────
    case 'keywords': {
      const chips = s.items.map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join('')
      return band(`${eyebrow(no, '키워드')}<div class="chips">${chips}</div>`, { alt: false, tight: true })
    }

    // ── REVIEWS — 후기 플레이스홀더 ───────────────────────────────────────
    case 'reviews':
      return band(
        `${eyebrow(no, '고객 후기')}<div class="review-ph"><p>${escapeHtml(s.placeholder)}</p></div>`,
        { alt: false },
      )

    // ── CTA — 커머스 제거: 마감 문구만 (가격/버튼 없음) ───────────────────
    case 'cta':
      return `<section class="sec closing">${eyebrow(no, '마무리')}<h2>${escapeHtml(s.label)}</h2></section>`

    // ── TEXT — 일반 텍스트 블록 ───────────────────────────────────────────
    case 'text': {
      const heading = s.heading ? `<h2 class="title">${escapeHtml(s.heading)}</h2>` : ''
      return band(`${heading}<p class="body">${escapeHtml(s.content)}</p>`, { alt: false })
    }

    // ── IMAGE — 단일 이미지 + 캡션 ────────────────────────────────────────
    case 'image': {
      const cap = s.caption ? `<figcaption class="cap">${escapeHtml(s.caption)}</figcaption>` : ''
      const img = isSafeUrl(s.url)
        ? `<img src="${escapeHtml(s.url)}" alt="${escapeHtml(s.caption ?? '')}" />`
        : shotSlotTag(s.shotSlot ?? 'detailShot')
      return band(`<figure class="image-fig"><div class="shot ${shotClass(s.shotSlot ?? 'detailShot')}">${img}</div>${cap}</figure>`, { alt: false })
    }

    // ── GALLERY — 멀티 컷 그리드 ──────────────────────────────────────────
    case 'gallery': {
      const shots = s.items
        .map((it) => shotBlock({ slot: it.shotSlot, url: it.url, caption: it.caption }))
        .join('')
      const head = s.heading ? `<h2 class="title">${escapeHtml(s.heading)}</h2>` : ''
      return band(`${eyebrow(no, '디테일')}${head}<div class="gallery">${shots}</div>`, { alt: true })
    }

    // ── FEATURE-SPLIT — 좌우 분할 (이미지/본문) ──────────────────────────
    case 'feature-split': {
      const shot = shotBlock({ slot: s.shotSlot })
      const copy = `<div><h2 class="title">${escapeHtml(s.heading)}</h2><p class="body">${escapeHtml(s.body)}</p></div>`
      const inner = s.reverse
        ? `<div class="split rev">${shot}${copy}</div>`
        : `<div class="split">${copy}${shot}</div>`
      return band(`${eyebrow(no, '본문')}${inner}`, { alt: false })
    }

    // ── MATERIAL — 벤토 그리드 (이미지/텍스트 셀) ────────────────────────
    case 'material': {
      const cells = s.cells.map((c) => {
        const span = c.span === 'big' ? ' big' : c.span === 'wide' ? ' wide' : ''
        if (c.kind === 'text') {
          const h = c.title ? `<h4>${escapeHtml(c.title)}</h4>` : ''
          const p = c.text ? `<p>${escapeHtml(c.text)}</p>` : ''
          return `<div class="cell${span} txt"><div>${h}${p}</div></div>`
        }
        const slot = c.shotSlot ?? 'detailShot'
        return `<div class="cell${span} shot ${shotClass(slot)} drape">${shotSlotTag(slot)}</div>`
      }).join('')
      const head = s.heading ? `<h2 class="title">${escapeHtml(s.heading)}</h2>` : ''
      return band(`${eyebrow(no, '소재')}${head}<div class="bento">${cells}</div>`, { alt: true })
    }

    // ── LOOKBOOK — 스타일링 3컷 ───────────────────────────────────────────
    case 'lookbook': {
      const figs = s.looks.map((l) => {
        const cap = l.caption ? `<figcaption>${escapeHtml(l.caption)}</figcaption>` : ''
        return `<figure>${shotBlock({ slot: l.shotSlot })}${cap}</figure>`
      }).join('')
      const head = s.heading ? `<h2 class="title">${escapeHtml(s.heading)}</h2>` : ''
      return band(`${eyebrow(no, '스타일링')}${head}<div class="look">${figs}</div>`, { alt: false })
    }

    // ── SIZE-SPEC — 실측 표 ───────────────────────────────────────────────
    case 'size-spec': {
      const thead = `<thead><tr>${s.columns.map((c, idx) => idx === 0 ? `<th>${escapeHtml(c)}</th>` : `<td class="num">${escapeHtml(c)}</td>`).join('')}</tr></thead>`
      const tbody = `<tbody>${s.rows.map((r) => `<tr><th>${escapeHtml(r.label)}</th>${r.values.map((v) => `<td class="num">${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody>`
      const cap = s.caption ? `<caption>${escapeHtml(s.caption)}</caption>` : ''
      const note = s.note ? `<p class="cap" style="margin-top:14px">${escapeHtml(s.note)}</p>` : ''
      return band(
        `${eyebrow(no, '사이즈 · 스펙')}<div class="spec-wrap"><table class="spectbl">${cap}${thead}${tbody}</table></div>${note}`,
        { alt: true },
      )
    }

    // ── TRUST — 신뢰 (평점/인용/배지) ─────────────────────────────────────
    case 'trust': {
      const score = s.rating ? `<div class="score">${escapeHtml(s.rating)}</div>` : ''
      const quote = s.quote ? `<p class="quote">${escapeHtml(s.quote)}</p>` : ''
      const qmeta = s.quoteMeta ? `<p class="qmeta">${escapeHtml(s.quoteMeta)}</p>` : ''
      const badges = s.badges.map((b) => `<div class="b"><div class="bt">${escapeHtml(b.title)}</div>${b.desc ? `<div class="bd">${escapeHtml(b.desc)}</div>` : ''}</div>`).join('')
      return band(
        `${eyebrow(no, '신뢰')}<div class="trust"><div><div class="stars">★★★★★</div>${score}${quote}${qmeta}</div><div class="badges">${badges}</div></div>`,
        { alt: false },
      )
    }

    // ── BENEFIT-BANNER — 혜택 밴드 (커머스 가격 없음) ────────────────────
    case 'benefit-banner':
      return `<div class="benefit">${escapeHtml(s.text)}</div>`

    // ── LEGAL — 상품 정보 고시 + AI 고지 ──────────────────────────────────
    case 'legal': {
      const dl = s.fields.map((f) => `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd>`).join('')
      const notice = s.aiNotice ?? '본 상세페이지의 이미지는 ProductCraft AI로 생성·조립되었으며, 일부 컷은 AI 이미지 합성(SynthID 워터마크 포함)을 포함합니다. 실제 상품과 색·질감이 다를 수 있습니다.'
      return `<footer class="legal"><h5>상품 정보 고시</h5><dl>${dl}</dl><p class="ai">${escapeHtml(notice)}</p></footer>`
    }

    // ── CLOSING — 에디토리얼 마감 (가격/버튼 없음) ───────────────────────
    case 'closing': {
      const sub = s.subtext ? `<p>${escapeHtml(s.subtext)}</p>` : ''
      return `<section class="sec closing">${eyebrow(no, '결론')}<h2>${escapeHtml(s.heading)}</h2>${sub}</section>`
    }

    default: {
      // exhaustive guard — DetailSection union 에 미처리 variant 가 생기면 컴파일 실패
      const _exhaustive: never = s
      return _exhaustive
    }
  }
}

// ─── 렌더 헬퍼 ───────────────────────────────────────────────────────────────

function band(inner: string, opts: { alt: boolean; tight?: boolean }): string {
  const cls = ['sec']
  if (opts.alt) cls.push('sec--alt')
  if (opts.tight) cls.push('sec--tight')
  return `<section class="${cls.join(' ')}">${inner}</section>`
}

function eyebrow(no: string, label: string): string {
  return `<p class="eyebrow"><span class="no">${no}</span><span class="rule"></span>${escapeHtml(label)}</p>`
}

function shotSlotLabel(slot: ShotSlot): string {
  switch (slot) {
    case 'productShot': return '상품컷'
    case 'fitShot':     return '연출컷'
    case 'detailShot':  return '설명컷'
    case 'lifestyle':   return '라이프스타일'
    default:            return '이미지'
  }
}

function shotClass(slot: ShotSlot): string {
  switch (slot) {
    case 'productShot': return 'shot--product'
    case 'fitShot':     return 'shot--fit'
    case 'detailShot':  return 'shot--detail'
    case 'lifestyle':   return 'shot--life'
    default:            return 'shot--product'
  }
}

function shotSlotTag(slot: ShotSlot): string {
  return `<span class="shot__slot">${escapeHtml(shotSlotLabel(slot))}</span>`
}

/** 일반 컷 블록: 이미지가 있으면 <img>, 없으면 듀오톤 플레이스홀더 + 슬롯 라벨. */
function shotBlock(opts: { slot: ShotSlot; url?: string; caption?: string }): string {
  const cls = shotClass(opts.slot)
  if (opts.url && isSafeUrl(opts.url)) {
    return `<div class="shot ${cls}"><img src="${escapeHtml(opts.url)}" alt="${escapeHtml(opts.caption ?? shotSlotLabel(opts.slot))}" /></div>`
  }
  return `<div class="shot ${cls} drape">${shotSlotTag(opts.slot)}</div>`
}

/** 히어로용 풀블리드 컷 (고정 높이). */
function heroShot(opts: { slot: ShotSlot; url?: string; alt: string }): string {
  const cls = shotClass(opts.slot)
  if (opts.url && isSafeUrl(opts.url)) {
    return `<div class="shot hero__shot ${cls}"><img src="${escapeHtml(opts.url)}" alt="${escapeHtml(opts.alt)}" /></div>`
  }
  return `<div class="shot hero__shot ${cls} drape">${shotSlotTag(opts.slot)}</div>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** img src 로 안전한 URL 인지 — javascript:/vbscript:/data:(비이미지) 차단. */
function isSafeUrl(url: string): boolean {
  const s = url.replace(/[\s -]+/g, '').toLowerCase()
  if (s.startsWith('javascript:') || s.startsWith('vbscript:')) return false
  if (s.startsWith('data:') && !s.startsWith('data:image/')) return false
  return true
}

// ─── 캔버스/섹션 스타일 (테마 CSS 변수 구동, 폴백 = 에디토리얼 미니멀) ──────

const CANVAS_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background:
      radial-gradient(120% 60% at 50% -10%, rgba(0,0,0,0.05), transparent 60%),
      #e7e3dc;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  @media (prefers-color-scheme: dark) { body { background: #16130f; } }

  .dp {
    width: 860px; max-width: 100%; margin: 0 auto;
    background: var(--paper, #F7F4EF);
    color: var(--ink, #2A2621);
    font-family: var(--body-font, -apple-system, BlinkMacSystemFont, "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", system-ui, sans-serif);
    line-height: 1.75;
    overflow: hidden;
    box-shadow: 0 1px 0 rgba(0,0,0,0.06), 0 40px 90px -50px rgba(20,15,10,0.55);
  }
  @media (max-width: 900px) { .dp { width: 100%; } }

  /* 섹션 밴드 */
  .sec { padding: 96px 70px; position: relative; }
  .sec--alt { background: var(--sand, #EDE6DB); }
  .sec--tight { padding: 60px 70px; }
  @media (max-width: 620px) { .sec { padding: 60px 30px; } .sec--tight { padding: 44px 30px; } }

  .eyebrow {
    display: flex; align-items: center; gap: 12px;
    font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--accent, #7A5C43); font-weight: 600; margin: 0 0 22px;
  }
  .eyebrow .no { font-family: var(--display-font, "Iowan Old Style", Georgia, serif); font-style: italic; font-size: 15px; letter-spacing: 0; color: var(--ink, #2A2621); opacity: 0.5; }
  .eyebrow .rule { flex: 0 0 32px; height: 1px; background: var(--accent, #7A5C43); opacity: 0.6; }

  .title {
    font-family: var(--display-font, "Iowan Old Style", Georgia, serif);
    font-weight: 500; letter-spacing: -0.01em; line-height: 1.16;
    font-size: 34px; margin: 0 0 18px; color: var(--ink, #2A2621); text-wrap: balance;
  }
  @media (max-width: 620px) { .title { font-size: 27px; } }
  .body { font-size: 16px; line-height: 1.85; color: var(--ink, #2A2621); opacity: 0.82; margin: 0; max-width: 60ch; white-space: pre-line; }
  .cap { font-size: 13px; letter-spacing: 0.01em; color: var(--muted, #8C8378); }

  /* 컷 블록 (듀오톤 플레이스홀더) */
  .shot { position: relative; border-radius: var(--radius, 6px); overflow: hidden; background: var(--sand, #EDE6DB); isolation: isolate; }
  .shot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 2; }
  .shot__slot {
    position: absolute; z-index: 4; left: 12px; top: 12px;
    font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600;
    color: #f7f4ef; background: rgba(20,15,10,0.44);
    padding: 5px 9px; border-radius: 100px; border: 1px solid rgba(247,244,239,0.28);
  }
  .shot--product { background: linear-gradient(160deg, color-mix(in srgb, var(--paper, #F7F4EF) 82%, #000 6%) 0%, var(--sand, #EDE6DB) 55%, color-mix(in srgb, var(--muted, #8C8378) 65%, #000 12%) 100%); }
  .shot--fit     { background: radial-gradient(75% 90% at 60% 26%, color-mix(in srgb, var(--muted, #8C8378) 55%, #fff 45%) 0%, var(--muted, #8C8378) 45%, var(--ink, #2A2621) 100%); }
  .shot--detail  { background: radial-gradient(120% 120% at 20% 12%, var(--muted, #8C8378) 0%, color-mix(in srgb, var(--ink, #2A2621) 72%, var(--muted, #8C8378) 28%) 62%, var(--ink, #2A2621) 100%); }
  .shot--life    { background: radial-gradient(70% 80% at 38% 30%, var(--sand, #EDE6DB) 0%, color-mix(in srgb, var(--muted, #8C8378) 70%, #fff 30%) 44%, var(--muted, #8C8378) 88%); }
  .drape::after {
    content: ""; position: absolute; inset: 0; z-index: 1;
    background:
      linear-gradient(105deg, transparent 30%, rgba(255,250,242,0.14) 48%, transparent 62%),
      linear-gradient(255deg, transparent 42%, rgba(20,15,10,0.16) 80%);
  }

  /* HERO */
  .hero { position: relative; }
  .hero__shot { height: 820px; border-radius: 0; }
  @media (max-width: 620px) { .hero__shot { height: 520px; } }
  .hero__scrim { position: absolute; inset: 0; z-index: 3; pointer-events: none;
    background: linear-gradient(to top, rgba(18,13,9,0.72) 0%, rgba(18,13,9,0.12) 42%, transparent 66%); }
  .hero__copy { position: absolute; z-index: 5; left: 0; right: 0; bottom: 0; padding: 64px; color: #fbf9f5; }
  .hero h1 { font-family: var(--display-font, "Iowan Old Style", Georgia, serif); font-weight: 500; font-size: 56px; line-height: 1.12; letter-spacing: -0.01em; color: #fbf9f5; margin: 0 0 16px; text-wrap: balance; }
  .hero__tag { font-size: 18px; line-height: 1.7; color: rgba(247,244,239,0.92); max-width: 42ch; margin: 0; }
  @media (max-width: 620px) { .hero h1 { font-size: 36px; } .hero__copy { padding: 32px; } }

  /* FEATURES */
  .grid-feat { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .feat-card { padding: 24px; background: var(--paper, #F7F4EF); border: 1px solid var(--line, #DED6C9); border-radius: var(--radius, 6px); }
  .sec--alt .feat-card { background: color-mix(in srgb, var(--paper, #F7F4EF) 60%, var(--sand, #EDE6DB) 40%); }
  .feat-card__n { font-family: var(--display-font, "Iowan Old Style", Georgia, serif); font-size: 30px; color: var(--muted, #8C8378); line-height: 1; margin-bottom: 10px; opacity: 0.7; }
  .feat-card p { font-size: 14.5px; line-height: 1.7; color: var(--ink, #2A2621); margin: 0; opacity: 0.9; }

  /* KEYWORDS */
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { padding: 7px 15px; border: 1px solid var(--line, #DED6C9); border-radius: 100px; font-size: 13px; color: var(--muted, #8C8378); }

  /* REVIEWS */
  .review-ph { padding: 40px; border: 1.5px dashed var(--line, #DED6C9); border-radius: var(--radius, 6px); text-align: center; color: var(--muted, #8C8378); }
  .review-ph p { margin: 0; font-size: 14px; }

  /* IMAGE */
  .image-fig { margin: 0; }
  .image-fig .shot { aspect-ratio: 4 / 3; }
  .image-fig figcaption { margin-top: 12px; text-align: center; }

  /* SPLIT / FEATURE-SPLIT */
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 44px; align-items: center; }
  .split.rev { direction: rtl; } .split.rev > * { direction: ltr; }
  .split .shot { aspect-ratio: 4 / 5; }
  @media (max-width: 620px) { .split { grid-template-columns: 1fr; gap: 24px; } }

  /* GALLERY */
  .gallery { display: grid; grid-template-columns: 2fr 1fr; grid-template-rows: repeat(2, 1fr); gap: 12px; }
  .gallery .shot { aspect-ratio: 1 / 1; }
  .gallery .shot:nth-child(1) { grid-row: 1 / span 2; aspect-ratio: auto; }
  @media (max-width: 620px) { .gallery { grid-template-columns: 1fr 1fr; grid-template-rows: none; } .gallery .shot:nth-child(1) { grid-row: auto; grid-column: 1 / -1; aspect-ratio: 4 / 3; } }

  /* MATERIAL / BENTO */
  .bento { display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 150px; gap: 12px; }
  .bento .cell { position: relative; border-radius: var(--radius, 6px); overflow: hidden; }
  .bento .cell.big { grid-column: span 2; grid-row: span 2; }
  .bento .cell.wide { grid-column: span 2; }
  .bento .txt { background: var(--paper, #F7F4EF); border: 1px solid var(--line, #DED6C9); padding: 20px; display: flex; flex-direction: column; justify-content: flex-end; }
  .sec--alt .bento .txt { background: color-mix(in srgb, var(--paper, #F7F4EF) 60%, var(--sand, #EDE6DB) 40%); }
  .bento .txt h4 { font-family: var(--display-font, "Iowan Old Style", Georgia, serif); font-size: 19px; font-weight: 500; margin: 0; color: var(--ink, #2A2621); }
  .bento .txt p { font-size: 13px; color: var(--muted, #8C8378); margin: 8px 0 0; line-height: 1.6; }
  @media (max-width: 620px) { .bento { grid-template-columns: 1fr 1fr; grid-auto-rows: 130px; } .bento .cell.big { grid-column: span 2; } }

  /* LOOKBOOK */
  .look { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .look figure { margin: 0; }
  .look .shot { aspect-ratio: 3 / 4; }
  .look figcaption { font-size: 12px; color: var(--muted, #8C8378); margin-top: 10px; letter-spacing: 0.02em; }
  @media (max-width: 620px) { .look { grid-template-columns: 1fr; } }

  /* SIZE-SPEC */
  .spec-wrap { overflow-x: auto; }
  .spectbl { width: 100%; border-collapse: collapse; font-size: 14.5px; }
  .spectbl caption { text-align: left; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted, #8C8378); padding-bottom: 14px; }
  .spectbl th, .spectbl td { text-align: left; padding: 14px 12px; border-bottom: 1px solid var(--line, #DED6C9); }
  .spectbl th { font-weight: 600; color: var(--ink, #2A2621); width: 90px; }
  .spectbl td.num { font-variant-numeric: tabular-nums; text-align: right; color: var(--ink, #2A2621); }
  .spectbl thead th, .spectbl thead td { color: var(--muted, #8C8378); font-weight: 600; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; border-bottom: 1.5px solid var(--ink, #2A2621); }

  /* TRUST */
  .trust { display: grid; grid-template-columns: 1.3fr 1fr; gap: 40px; align-items: center; }
  .trust .stars { color: var(--accent, #7A5C43); letter-spacing: 3px; font-size: 15px; }
  .trust .score { font-size: 30px; font-weight: 700; color: var(--ink, #2A2621); margin-top: 6px; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .trust .quote { font-family: var(--display-font, "Iowan Old Style", Georgia, serif); font-size: 21px; line-height: 1.6; font-style: italic; color: var(--ink, #2A2621); margin: 12px 0 8px; text-wrap: balance; }
  .trust .qmeta { font-size: 13px; color: var(--muted, #8C8378); }
  .badges { display: grid; gap: 4px; }
  .badges .b { padding: 14px 0; border-top: 1px solid var(--line, #DED6C9); }
  .badges .b:first-child { border-top: 0; }
  .badges .bt { font-size: 14px; font-weight: 600; color: var(--ink, #2A2621); }
  .badges .bd { font-size: 12.5px; color: var(--muted, #8C8378); margin-top: 3px; }
  @media (max-width: 620px) { .trust { grid-template-columns: 1fr; gap: 24px; } }

  /* BENEFIT BANNER (커머스 가격 없음 — 혜택/공지 문구만) */
  .benefit { background: var(--accent, #7A5C43); color: #fff; text-align: center; padding: 15px 24px; font-weight: 700; font-size: 15px; letter-spacing: -0.01em; }

  /* CLOSING / CTA (마감 문구 — 가격/구매버튼 없음) */
  .closing { background: var(--cta, #1E1A16); color: var(--cta-text, #F7F4EF); text-align: center; }
  .closing .eyebrow { justify-content: center; color: color-mix(in srgb, var(--cta-text, #F7F4EF) 66%, transparent); }
  .closing .eyebrow .no { color: color-mix(in srgb, var(--cta-text, #F7F4EF) 50%, transparent); }
  .closing .eyebrow .rule { background: color-mix(in srgb, var(--cta-text, #F7F4EF) 50%, transparent); }
  .closing h2 { font-family: var(--display-font, "Iowan Old Style", Georgia, serif); font-weight: 500; font-size: 38px; letter-spacing: -0.01em; margin: 0 0 12px; color: var(--cta-text, #F7F4EF); }
  .closing p { font-size: 16px; line-height: 1.75; color: color-mix(in srgb, var(--cta-text, #F7F4EF) 82%, transparent); max-width: 42ch; margin: 0 auto; }

  /* LEGAL FOOTER */
  .legal { background: color-mix(in srgb, var(--sand, #EDE6DB) 82%, #000 5%); color: var(--muted, #8C8378); font-size: 11.5px; line-height: 1.9; letter-spacing: 0.01em; padding: 40px 70px; }
  .legal h5 { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted, #8C8378); margin: 0 0 12px; font-weight: 700; }
  .legal dl { display: grid; grid-template-columns: 118px 1fr; gap: 5px 14px; margin: 0; }
  .legal dt { color: var(--muted, #8C8378); } .legal dd { margin: 0; color: var(--ink, #2A2621); }
  .legal .ai { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line, #DED6C9); color: var(--muted, #8C8378); }
  @media (max-width: 620px) { .legal { padding: 30px 34px; } .legal dl { grid-template-columns: 92px 1fr; } }
`
