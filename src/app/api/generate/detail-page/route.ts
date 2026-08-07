/**
 * 상세페이지 HTML 자동 조립 API (Sprint 2 — G5)
 * POST /api/generate/detail-page
 *
 * 섹션: Hero / 핵심 특징 / 사용법 / 스펙 / 리뷰 플레이스홀더 / CTA
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkCreditGuard, deductCredits } from '@/lib/credit-guard'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─── 스키마 ─────────────────────────────────────────────────────────────────

/**
 * v1.1 Phase 2 (L8): sections 가 있으면 그것 기준으로 HTML 조립, 없으면 기존 정적 템플릿.
 */
const SectionSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('hero'),        title: z.string(), tagline: z.string(), image: z.string().optional() }),
  z.object({ id: z.string(), type: z.literal('features'),    heading: z.string(), items: z.array(z.string()) }),
  z.object({ id: z.string(), type: z.literal('description'), content: z.string() }),
  z.object({ id: z.string(), type: z.literal('keywords'),    items: z.array(z.string()) }),
  z.object({ id: z.string(), type: z.literal('reviews'),     placeholder: z.string() }),
  z.object({ id: z.string(), type: z.literal('cta'),         label: z.string(), url: z.string().optional() }),
  z.object({ id: z.string(), type: z.literal('text'),        heading: z.string().optional(), content: z.string() }),
  z.object({ id: z.string(), type: z.literal('image'),       url: z.string(), caption: z.string().optional() }),
])
type DetailSection = z.infer<typeof SectionSchema>

const DetailPageSchema = z.object({
  projectId: z.string().uuid(),
  productName: z.string(),
  tagline: z.string(),
  description: z.string(),
  category: z.string(),
  keywords: z.array(z.string()),
  features: z.array(z.string()),
  thumbnailUrl: z.string().url().optional(),
  shopUrl: z.string().url().optional(),
  /** v1.1 Phase 2 — 사용자가 노션 에디터로 편집한 섹션 배열 */
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

    // BIZ-06 — Pro+ 플랜 게이트 + 2 크레딧 차감 (상세페이지 HTML 자동 조립)
    const guard = await checkCreditGuard({ userId: user.id, operation: 'detail_page' })
    if (!guard.allowed) {
      return NextResponse.json(
        { error: guard.reason, code: guard.code, upgradeUrl: guard.upgradeUrl, guardResult: guard },
        { status: 402 }
      )
    }

    const data = parsed.data
    // v1.1 Phase 2 — sections 가 있으면 그것 기준으로 조립
    const html = data.sections && data.sections.length > 0
      ? assembleFromSections(data.sections, { keywords: data.keywords })
      : assembleDetailPage(data)

    // generations 테이블에 저장
    await supabase.from('generations').insert({
      project_id: data.projectId,
      type: 'detail_page',
      payload: { html, productName: data.productName } as unknown as Record<string, unknown>,
    })

    // 성공 후 크레딧 차감
    await deductCredits({ userId: user.id, operation: 'detail_page' })

    return NextResponse.json({ html, projectId: data.projectId })
  } catch (err) {
    console.error('[/api/generate/detail-page]', err)
    return NextResponse.json({ error: '상세페이지 생성 실패' }, { status: 500 })
  }
}

// ─── HTML 조립기 ─────────────────────────────────────────────────────────────

interface DetailPageInput {
  productName: string
  tagline: string
  description: string
  category: string
  keywords: string[]
  features: string[]
  thumbnailUrl?: string
  shopUrl?: string
}

function assembleDetailPage(d: DetailPageInput): string {
  const keywordsMetaContent = d.keywords.join(', ')
  const featuresHTML = d.features
    .slice(0, 6)
    .map(
      (f, i) => `
      <div class="feature-item">
        <div class="feature-num">${String(i + 1).padStart(2, '0')}</div>
        <p class="feature-text">${escapeHtml(f)}</p>
      </div>`
    )
    .join('')

  const keywordsHTML = d.keywords
    .slice(0, 8)
    .map((k) => `<span class="keyword-tag">${escapeHtml(k)}</span>`)
    .join('')

  const heroImgHTML = d.thumbnailUrl
    ? `<img src="${escapeHtml(d.thumbnailUrl)}" alt="${escapeHtml(d.productName)}" class="hero-img" />`
    : `<div class="hero-img hero-img-placeholder"><span>이미지</span></div>`

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="keywords" content="${escapeHtml(keywordsMetaContent)}">
<title>${escapeHtml(d.productName)} — 상세페이지</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Noto Sans KR', sans-serif; background: #fff; color: #1a1a1a; max-width: 860px; margin: 0 auto; }

  /* Hero */
  .hero { padding: 60px 32px; text-align: center; background: linear-gradient(135deg, #fef9f0 0%, #fdf2f8 100%); }
  .hero-category { display: inline-block; padding: 4px 14px; border-radius: 100px; background: rgba(245,158,11,.1); color: #b45309; font-size: 12px; font-weight: 600; letter-spacing: .5px; margin-bottom: 20px; }
  .hero-title { font-size: clamp(28px, 5vw, 44px); font-weight: 800; letter-spacing: -1px; margin-bottom: 16px; line-height: 1.2; }
  .hero-tagline { font-size: 18px; color: #6b6b80; max-width: 520px; margin: 0 auto 32px; line-height: 1.6; }
  .hero-img { width: 100%; max-width: 480px; border-radius: 20px; display: block; margin: 0 auto 32px; object-fit: cover; }
  .hero-img-placeholder { height: 320px; background: #f0f0ec; display: flex; align-items: center; justify-content: center; color: #bbb; font-size: 14px; }
  .cta-btn { display: inline-block; padding: 16px 40px; background: #1a1a1a; color: #fff; border-radius: 100px; font-weight: 700; font-size: 16px; text-decoration: none; letter-spacing: -.3px; }

  /* Features */
  .section { padding: 60px 32px; }
  .section-label { font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #aaa; margin-bottom: 12px; }
  .section-title { font-size: 28px; font-weight: 800; letter-spacing: -.5px; margin-bottom: 32px; }
  .features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; }
  .feature-item { padding: 24px; background: #f8f8f5; border-radius: 16px; }
  .feature-num { font-size: 32px; font-weight: 800; color: #e5e5e0; margin-bottom: 8px; line-height: 1; }
  .feature-text { font-size: 14px; color: #444; line-height: 1.7; }

  /* Description */
  .desc-section { padding: 60px 32px; background: #f8f8f5; }
  .desc-text { font-size: 15px; line-height: 1.9; color: #333; white-space: pre-line; }

  /* Keywords */
  .keywords-section { padding: 40px 32px; }
  .keywords-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
  .keyword-tag { padding: 6px 16px; border: 1px solid #e0e0dc; border-radius: 100px; font-size: 13px; color: #555; }

  /* Review placeholder */
  .review-section { padding: 60px 32px; background: #fff; }
  .review-placeholder { padding: 40px; border: 2px dashed #e5e5e0; border-radius: 20px; text-align: center; color: #bbb; }
  .review-placeholder p { font-size: 13px; }

  /* Footer */
  footer { padding: 32px; background: #1a1a1a; color: #666; font-size: 11px; text-align: center; line-height: 1.8; }
  footer strong { color: #aaa; }
</style>
</head>
<body>

<!-- 01. Hero — D-4: 제목 → 카피 → 이미지 순서 -->
<section class="hero">
  <div class="hero-category">${escapeHtml(d.category)}</div>
  <h1 class="hero-title">${escapeHtml(d.productName)}</h1>
  <p class="hero-tagline">${escapeHtml(d.tagline)}</p>
  ${heroImgHTML}
  ${d.shopUrl ? `<a href="${safeLinkHref(d.shopUrl)}" class="cta-btn">지금 구매하기 →</a>` : ''}
</section>

<!-- 02. 핵심 특징 -->
<section class="section">
  <div class="section-label">Key Features</div>
  <h2 class="section-title">이런 점이 특별합니다</h2>
  <div class="features-grid">
    ${featuresHTML}
  </div>
</section>

<!-- 03. 상세 설명 -->
<section class="desc-section">
  <div class="section-label">Product Story</div>
  <h2 class="section-title">상품 소개</h2>
  <p class="desc-text">${escapeHtml(d.description)}</p>
</section>

<!-- 04. 검색 키워드 -->
<section class="keywords-section">
  <div class="section-label">Search Keywords</div>
  <div class="keywords-wrap">
    ${keywordsHTML}
  </div>
</section>

<!-- 05. 리뷰 플레이스홀더 -->
<section class="review-section">
  <div class="section-label">Customer Reviews</div>
  <h2 class="section-title">고객 리뷰</h2>
  <div class="review-placeholder">
    <p>📦 첫 번째 구매자가 되어주세요!</p>
    <p style="margin-top:8px">구매 후 소중한 리뷰를 남겨주시면 다음 구매 시 적립금을 드립니다.</p>
  </div>
</section>

<!-- Footer -->
<footer>
  <strong>AI 생성 콘텐츠 고지</strong><br>
  이 상세페이지의 일부 콘텐츠는 ProductCraft AI (Claude Sonnet 4.5, Google Gemini)를 통해 자동 생성되었습니다.<br>
  생성된 이미지는 Google SynthID 워터마크를 포함하며, AI 생성 콘텐츠임을 식별할 수 있습니다.
</footer>

</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** href 속성에 안전한 URL인지 확인 — javascript: 스킴 차단 */
function safeLinkHref(url: string | undefined): string {
  if (!url) return '#'
  // javascript: / vbscript: 스킴 차단 (대소문자, 공백 우회 포함)
  const stripped = url.replace(/[ -]+/g, '').trim()
  if (/^javascript:/i.test(stripped) || /^vbscript:/i.test(stripped)) return '#'
  return escapeHtml(url)
}

// ─── v1.1 Phase 2 — Sections-based HTML 조립 ───────────────────────────────

const SECTION_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Noto Sans KR', 'Pretendard Variable', sans-serif; background: #fff; color: #111; max-width: 860px; margin: 0 auto; }
  section { padding: 56px 32px; }
  .hero { text-align: center; background: #f5f5f5; padding: 72px 32px 60px; }
  .hero h1 { font-size: clamp(28px, 5vw, 44px); font-weight: 900; letter-spacing: -1px; margin-bottom: 16px; line-height: 1.15; }
  .hero p { font-size: 18px; color: #707072; max-width: 520px; margin: 0 auto 32px; line-height: 1.6; }
  .hero img { width: 100%; max-width: 480px; display: block; margin: 0 auto 24px; object-fit: cover; }
  .cta-btn { display: inline-block; padding: 16px 40px; background: #111; color: #fff; border-radius: 999px; font-weight: 700; font-size: 16px; text-decoration: none; }
  .section-label { font-size: 11px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #9e9ea0; margin-bottom: 12px; }
  .section-title { font-size: 28px; font-weight: 900; letter-spacing: -.5px; margin-bottom: 32px; }
  .features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .feature-item { padding: 24px; border: 1px solid #e5e5e5; }
  .feature-num { font-size: 32px; font-weight: 800; color: #e5e5e5; margin-bottom: 8px; line-height: 1; }
  .feature-text { font-size: 14px; color: #444; line-height: 1.7; }
  .desc-text { font-size: 15px; line-height: 1.9; color: #333; white-space: pre-line; }
  .keywords-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
  .keyword-tag { padding: 6px 14px; border: 1px solid #e5e5e5; font-size: 13px; color: #555; }
  .review-placeholder { padding: 40px; border: 2px dashed #e5e5e5; text-align: center; color: #9e9ea0; }
  .text-block h2 { font-size: 22px; font-weight: 900; margin-bottom: 16px; letter-spacing: -.3px; }
  .text-block p { font-size: 15px; line-height: 1.8; color: #333; white-space: pre-line; }
  .image-block { text-align: center; }
  .image-block img { width: 100%; max-width: 720px; display: block; margin: 0 auto; }
  .image-block figcaption { font-size: 12px; color: #9e9ea0; margin-top: 12px; }
  footer { padding: 32px; background: #111; color: #707072; font-size: 11px; text-align: center; line-height: 1.8; }
  footer strong { color: #9e9ea0; }
`

function assembleFromSections(
  sections: DetailSection[],
  meta: { keywords: string[] },
): string {
  const htmlBody = sections.map(renderSection).filter(Boolean).join('\n')
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="keywords" content="${escapeHtml(meta.keywords.join(', '))}">
<title>상품 상세페이지</title>
<style>${SECTION_STYLES}</style>
</head>
<body>
${htmlBody}
<footer>
  <strong>AI 생성 콘텐츠 고지</strong><br>
  이 상세페이지의 일부 콘텐츠는 ProductCraft AI 를 통해 자동 생성·편집되었습니다.<br>
  생성된 이미지는 Google SynthID 워터마크를 포함하며, AI 생성 콘텐츠임을 식별할 수 있습니다.
</footer>
</body>
</html>`
}

function renderSection(s: DetailSection): string {
  switch (s.type) {
    case 'hero': {
      // D-4: 제목 → 카피 → 이미지 순서 (매거진 헤드라인 패턴)
      const img = s.image
        ? `<img src="${escapeHtml(s.image)}" alt="${escapeHtml(s.title)}" class="hero-img" />`
        : ''
      return `<section class="hero"><h1>${escapeHtml(s.title)}</h1><p>${escapeHtml(s.tagline)}</p>${img}</section>`
    }
    case 'features': {
      const items = s.items.slice(0, 12)
        .map((f, i) => `<div class="feature-item"><div class="feature-num">${String(i + 1).padStart(2, '0')}</div><p class="feature-text">${escapeHtml(f)}</p></div>`)
        .join('')
      return `<section><div class="section-label">Key Features</div><h2 class="section-title">${escapeHtml(s.heading)}</h2><div class="features-grid">${items}</div></section>`
    }
    case 'description':
      return `<section style="background:#f5f5f5"><div class="section-label">Product Story</div><h2 class="section-title">상품 소개</h2><p class="desc-text">${escapeHtml(s.content)}</p></section>`
    case 'keywords': {
      const tags = s.items.map((k) => `<span class="keyword-tag">${escapeHtml(k)}</span>`).join('')
      return `<section><div class="section-label">Search Keywords</div><div class="keywords-wrap">${tags}</div></section>`
    }
    case 'reviews':
      return `<section><div class="section-label">Customer Reviews</div><h2 class="section-title">고객 리뷰</h2><div class="review-placeholder"><p>${escapeHtml(s.placeholder)}</p></div></section>`
    case 'cta': {
      const href = safeLinkHref(s.url)
      return `<section style="text-align:center"><a href="${href}" class="cta-btn">${escapeHtml(s.label)} →</a></section>`
    }
    case 'text': {
      const heading = s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : ''
      return `<section class="text-block">${heading}<p>${escapeHtml(s.content)}</p></section>`
    }
    case 'image': {
      const cap = s.caption ? `<figcaption>${escapeHtml(s.caption)}</figcaption>` : ''
      return `<section class="image-block"><img src="${escapeHtml(s.url)}" alt="${escapeHtml(s.caption ?? '')}" />${cap}</section>`
    }
  }
}
