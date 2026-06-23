/**
 * Toss Payments 웹훅 핸들러 (전면 재작성 — Track 1 결제 무결성)
 * POST /api/webhooks/toss
 *
 * 처리 흐름:
 *   1. TOSS_SECRET_KEY 미설정 시 즉시 거부 (우회 차단)
 *   2. HMAC-SHA256 서명 비교 — timingSafeEqual (WH-04)
 *   3. payload 파싱 → eventType / orderId / amount / eventId 추출
 *   4. processed_webhook_events 멱등성 키 INSERT (WH-01/03, SEC-NEW-04)
 *   5. apply_payment_event / apply_payment_cancel RPC 호출
 *      - pending_orders 매칭 → expected_amount 정확 일치 (WH-02)
 *      - GREATEST clamp 로 사용자 잔여 크레딧 보존 (BIZ-01)
 *      - 취소 시 credits_left 회수 금지 (BIZ-02)
 *      - 활성 sub 매칭 후에만 다운그레이드 (WH-05)
 *   6. RPC 실패/일치 안 됨 → 5xx 반환 (Toss 자동 재시도 유도)
 *   7. DONE 외 status (CANCELED, PARTIAL_CANCELED) 처리 (WH-09)
 *
 * 보안 노트:
 *   - 사용자 fingerprint (plan/credits/userId) 로그 출력 금지 (OPS-03)
 *   - 모든 supabase 호출에 error 체크 (SEC-NEW-02 패턴)
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─── 멱등성 안전 비교 ──────────────────────────────────────────────────────
function safeEqual(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ab.length !== bb.length) {
      // timingSafeEqual 은 길이 다르면 throw 하므로 길이만 다른 케이스는
      // 동일 길이의 fallback 으로 1회 비교 후 false 반환 (constant-time 유지)
      timingSafeEqual(ab, Buffer.alloc(ab.length))
      return false
    }
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

// ─── 페이로드 타입 (Toss 공식 스펙 일부) ───────────────────────────────────
interface TossWebhookEvent {
  eventId?: string
  // 일부 페이로드는 event.data.paymentKey 를 dedup 키로 사용 가능
  eventType?: string
  createdAt?: string
  data?: {
    paymentKey?: string
    orderId?: string
    status?: string
    totalAmount?: number
    balanceAmount?: number
    canceledAmount?: number
    method?: string
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // ─── 1. secret 미설정 → 503 ─────────────────────────────────────────────
  const tossSecret = process.env.TOSS_SECRET_KEY
  if (!tossSecret) {
    console.error('[Toss Webhook] TOSS_SECRET_KEY not configured — rejecting request')
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 503 }
    )
  }

  // ─── 2. 서명 검증 (timingSafeEqual) ──────────────────────────────────────
  const signature = request.headers.get('Toss-Payments-Signature') ?? ''
  const expected = createHmac('sha256', tossSecret).update(rawBody).digest('base64')

  if (!safeEqual(signature, expected)) {
    console.warn('[Toss Webhook] Signature mismatch')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // ─── 3. JSON 파싱 ────────────────────────────────────────────────────────
  let event: TossWebhookEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = event.eventType ?? ''
  const data = event.data ?? {}
  const orderId = data.orderId
  const totalAmount = typeof data.totalAmount === 'number' ? data.totalAmount : null

  if (!orderId) {
    console.warn('[Toss Webhook] Missing orderId in payload')
    return NextResponse.json({ error: 'Missing orderId' }, { status: 400 })
  }

  // eventId 추출: 공식 eventId > paymentKey > orderId+status (마지막 fallback)
  const eventId =
    event.eventId ??
    data.paymentKey ??
    `${orderId}:${eventType}:${data.status ?? 'unknown'}`

  // 사용자 fingerprint 없는 최소 로깅 (OPS-03)
  console.log('[Toss Webhook] received', { eventType, status: data.status })

  // ─── 4. service_role 클라이언트 ──────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[Toss Webhook] Supabase service env missing')
    return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 })
  }

  const supabase = createSupabaseAdmin(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // ─── 5. eventType 별 분기 ───────────────────────────────────────────────
  try {
    if (eventType === 'PAYMENT_STATUS_CHANGED' && data.status === 'DONE') {
      if (totalAmount === null) {
        console.warn('[Toss Webhook] DONE event missing totalAmount')
        return NextResponse.json({ error: 'Missing totalAmount' }, { status: 400 })
      }

      const { data: result, error } = await supabase.rpc('apply_payment_event', {
        p_order_id: orderId,
        p_amount: totalAmount,
        p_event_id: eventId,
      })

      if (error) {
        console.error('[Toss Webhook] apply_payment_event RPC error:', error.message)
        return NextResponse.json(
          { error: 'Internal processing error' },
          { status: 500 }
        )
      }

      // result: { processed: bool, reason?: string, ... }
      const processed = (result as { processed?: boolean } | null)?.processed
      const reason = (result as { reason?: string } | null)?.reason

      if (!processed) {
        if (reason === 'duplicate_event') {
          // 멱등성 hit — 정상 200 (Toss 재시도 종료)
          return NextResponse.json({ received: true, idempotent: true })
        }

        if (reason === 'amount_mismatch') {
          // amount 불일치 → 200 으로 응답해 재시도 멈추고, 운영 알람으로 처리.
          // (5xx 로 답하면 Toss 가 무한 재시도하므로 명시적으로 처리 종료)
          console.error('[Toss Webhook] amount_mismatch detected — review required')
          return NextResponse.json({ received: true, rejected: 'amount_mismatch' })
        }

        if (reason === 'order_not_found' || reason === 'order_expired') {
          console.warn(`[Toss Webhook] ${reason}`)
          return NextResponse.json({ received: true, rejected: reason })
        }

        if (reason === 'order_already_consumed') {
          // 정상 멱등성 케이스
          return NextResponse.json({ received: true, idempotent: true })
        }

        // 그 외 미정의 reason → 운영자가 검토하도록 5xx
        console.error('[Toss Webhook] unknown reason:', reason)
        return NextResponse.json(
          { error: 'Unknown processing reason' },
          { status: 500 }
        )
      }

      return NextResponse.json({ received: true })
    }

    if (
      eventType === 'CANCEL_PAYMENT' ||
      data.status === 'CANCELED' ||
      data.status === 'PARTIAL_CANCELED'
    ) {
      const { data: result, error } = await supabase.rpc('apply_payment_cancel', {
        p_order_id: orderId,
        p_event_id: eventId,
      })

      if (error) {
        console.error('[Toss Webhook] apply_payment_cancel RPC error:', error.message)
        return NextResponse.json(
          { error: 'Internal processing error' },
          { status: 500 }
        )
      }

      const processed = (result as { processed?: boolean } | null)?.processed
      const reason = (result as { reason?: string } | null)?.reason

      if (!processed) {
        if (reason === 'duplicate_event') {
          return NextResponse.json({ received: true, idempotent: true })
        }
        if (
          reason === 'subscription_not_found' ||
          reason === 'subscription_not_active'
        ) {
          // 오래된 결제의 취소 — 현재 활성 플랜은 보존 (WH-05)
          console.warn(`[Toss Webhook] cancel skipped: ${reason}`)
          return NextResponse.json({ received: true, skipped: reason })
        }
        console.error('[Toss Webhook] cancel unknown reason:', reason)
        return NextResponse.json(
          { error: 'Unknown cancel reason' },
          { status: 500 }
        )
      }

      return NextResponse.json({ received: true })
    }

    // 기타 이벤트는 명시적으로 무시 (200 응답)
    return NextResponse.json({ received: true, ignored: eventType })
  } catch (err) {
    console.error('[Toss Webhook] handler exception:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Internal processing error' }, { status: 500 })
  }
}
