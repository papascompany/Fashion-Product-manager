/**
 * DB Keep-alive · 헬스 체크
 * GET /api/health/db
 *
 * 목적 1 — Supabase FREE 티어 pause 재발 방지.
 *   무료 티어는 7일 무활동이면 프로젝트가 pause 되고 서비스가 전면 중단된다
 *   (2026-08-01 실제 발생 이력). vercel.json 의 cron 이 12시간마다 이 라우트를
 *   호출해 DB 를 1회 touch 한다.
 * 목적 2 — 오너가 DB 연결 상태만 확인할 수 있는 최소 엔드포인트.
 *
 * 보안:
 *   - 사용자 데이터를 일절 반환하지 않는다 (ok / db / latencyMs 만).
 *   - CRON_SECRET 이 설정돼 있으면 `Authorization: Bearer <CRON_SECRET>` 를 요구한다.
 *     Vercel Cron 은 프로젝트 env 에 CRON_SECRET 이 있으면 이 헤더를 자동으로 붙인다.
 *     미설정이면 통과시킨다 — env 를 넣지 않아도 keep-alive 는 돌아야 하기 때문.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { timingSafeEqual } from 'crypto'
import { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '@/lib/env'

export const runtime = 'nodejs'      // service_role 키 + node crypto 사용
export const dynamic = 'force-dynamic'
export const maxDuration = 10        // 실제로는 1초 이내. 길게 잡을 이유가 없다.

// 캐시되면 cron 이 DB 까지 닿지 않는다.
const NO_STORE: Record<string, string> = { 'Cache-Control': 'no-store' }

// ─── 시크릿 비교 (webhooks/toss 와 동일 패턴) ──────────────────────────────
function safeEqual(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ab.length !== bb.length) {
      // timingSafeEqual 은 길이가 다르면 throw 하므로 동일 길이 fallback 으로
      // 1회 비교 후 false 반환 (constant-time 유지)
      timingSafeEqual(ab, Buffer.alloc(ab.length))
      return false
    }
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

/**
 * CRON_SECRET 은 선택 키라 lib/env 의 중앙 검증 대상이 아니다.
 * 미설정 = 인증 없이 통과 (Vercel 크론 관례).
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true

  const header = request.headers.get('authorization') ?? ''
  const prefix = 'Bearer '
  if (!header.startsWith(prefix)) return false
  return safeEqual(header.slice(prefix.length), secret)
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const startedAt = Date.now()

  let serviceKey: string
  try {
    serviceKey = SUPABASE_SERVICE_ROLE_KEY()
  } catch {
    console.error('[health/db] SUPABASE_SERVICE_ROLE_KEY 미설정 — keep-alive 불가')
    return NextResponse.json({ ok: false, db: 'misconfigured' }, { status: 503, headers: NO_STORE })
  }

  if (!NEXT_PUBLIC_SUPABASE_URL) {
    console.error('[health/db] NEXT_PUBLIC_SUPABASE_URL 미설정 — keep-alive 불가')
    return NextResponse.json({ ok: false, db: 'misconfigured' }, { status: 503, headers: NO_STORE })
  }

  try {
    const supabase = createSupabaseAdmin(NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
      auth: { persistSession: false },
    })

    // 가장 싼 쿼리 — 설정 테이블(app_settings)의 PK 컬럼 1행.
    // 사용자 데이터가 아니고, 결과는 버린다(연결 성립 여부만 본다).
    const { error } = await supabase.from('app_settings').select('key').limit(1)
    if (error) {
      console.error('[health/db] Supabase 쿼리 실패:', error.code, error.message)
      return NextResponse.json({ ok: false, db: 'down' }, { status: 503, headers: NO_STORE })
    }
  } catch (err) {
    console.error('[health/db] Supabase 연결 실패:', err)
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503, headers: NO_STORE })
  }

  return NextResponse.json(
    { ok: true, db: 'up', latencyMs: Date.now() - startedAt },
    { headers: NO_STORE }
  )
}
