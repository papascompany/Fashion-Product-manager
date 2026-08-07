/**
 * 상세페이지 서버 래스터화 프록시 (Phase 2 — VPS Playwright 승격)
 * POST /api/render/detail-page
 *
 * 편집기 HTML 을 VPS 렌더 서비스(render-service/)로 전달해
 * 섹션 경계 슬라이스 이미지 ZIP 을 스트리밍으로 반환한다.
 *
 * - DETAIL_RENDER_URL 미설정 → 501 + { fallback: 'client' }
 *   (편집기가 클라이언트 html-to-image 래스터화로 자동 폴백)
 * - 인증: Supabase 세션 필수. 렌더 토큰은 서버에서만 주입 (클라이언트 비노출)
 * - 크레딧 차감 없음 — 래스터화는 opt-in 내보내기 유틸이며 생성 비용이 아님
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { DETAIL_RENDER_URL, DETAIL_RENDER_TOKEN, NEXT_PUBLIC_APP_URL } from '@/lib/env'

// 렌더 서비스 왕복(장문 페이지 스크린샷 다수) 여유
export const maxDuration = 120

const RenderSchema = z.object({
  /** 조립된 상세페이지 HTML (detail-page API 산출물) */
  html: z.string().min(1).max(3 * 1024 * 1024, { message: 'HTML 이 너무 큽니다 (최대 3MB).' }),
  /** 플랫폼 프리셋 규격 (rasterize.ts PLATFORM_PRESETS 와 동일 수치) */
  width: z.number().int().min(300).max(1200),
  maxSliceHeight: z.number().int().min(1000).max(10_000),
  format: z.enum(['jpeg', 'png']).default('jpeg'),
  quality: z.number().min(0.5).max(1).default(0.9),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const renderUrl = DETAIL_RENDER_URL()
    const renderToken = DETAIL_RENDER_TOKEN()
    if (!renderUrl || !renderToken) {
      // 렌더 서비스 미구성 — 편집기는 클라이언트 래스터화로 폴백
      return NextResponse.json(
        { error: '서버 렌더 서비스가 구성되지 않았습니다.', fallback: 'client' },
        { status: 501 },
      )
    }

    const body = await request.json()
    const parsed = RenderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const upstream = await fetch(renderUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${renderToken}`,
      },
      body: JSON.stringify({
        ...parsed.data,
        // 자체호스팅 폰트(/fonts/...) 해석용 base URL
        baseUrl: NEXT_PUBLIC_APP_URL,
      }),
      signal: AbortSignal.timeout(110_000),
    })

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      console.error('[render/detail-page] upstream failed:', upstream.status, detail.slice(0, 300))
      return NextResponse.json(
        { error: '서버 렌더에 실패했습니다.', fallback: 'client' },
        { status: 502 },
      )
    }

    // ZIP 스트리밍 패스스루 (Vercel 응답 버퍼 한도 회피)
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="detail-page.zip"',
        'X-Slice-Count': upstream.headers.get('x-slice-count') ?? '',
      },
    })
  } catch (err) {
    console.error('[/api/render/detail-page]', err)
    return NextResponse.json(
      { error: '서버 렌더 중 오류가 발생했습니다.', fallback: 'client' },
      { status: 500 },
    )
  }
}
