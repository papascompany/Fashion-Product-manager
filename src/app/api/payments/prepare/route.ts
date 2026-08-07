/**
 * 결제 사전 등록 (WH-02 hot-fix)
 * POST /api/payments/prepare
 *
 * 흐름:
 *   1. 인증 사용자만 호출 가능
 *   2. plan / topup key 를 받아 서버에서 PRICING 단일 소스로 expected_amount 계산
 *   3. 서버 생성 orderId 를 pending_orders 테이블에 INSERT
 *   4. { orderId, amount } 반환 → 클라이언트가 Toss 결제창에 그대로 전달
 *
 * webhook 진입 시 (api/webhooks/toss/route.ts) 에서 pending_orders 의
 * expected_amount === payload.totalAmount 정확 일치만 통과시킨다.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
// WHK-02(prepare) fix: 가격을 중복 정의하지 않고 단일 진실(plan-settings-shared)에서 가져온다.
// 예전에는 여기 사본과 billing-client 표시값이 어긋날 수 있어(가격 인상 시 청구/표시 불일치)
// 위험했다. 이제 서버 청구액·UI 표시가 같은 상수를 참조한다.
import { PLAN_PRICES, TOPUP_PRICES } from '@/lib/plan-settings-shared'

export const runtime = 'nodejs'
export const maxDuration = 10

const PrepareSchema = z
  .object({
    plan: z.enum(['starter', 'pro', 'business']).optional(),
    topup: z.enum(['topup10', 'topup30', 'topup100']).optional(),
  })
  .refine((v) => Boolean(v.plan) !== Boolean(v.topup), {
    message: 'plan 또는 topup 중 정확히 하나만 지정해야 합니다.',
  })

export async function POST(request: NextRequest) {
  // ─── 인증 검증 ─────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  // ─── 입력 파싱 ─────────────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문' }, { status: 400 })
  }

  const parsed = PrepareSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { plan, topup } = parsed.data

  // ─── kind/key/amount 결정 (서버 단일 소스) ─────────────────────────────────
  let kind: 'plan' | 'topup'
  let key: string
  let expectedAmount: number

  if (plan) {
    kind = 'plan'
    key = plan
    expectedAmount = PLAN_PRICES[plan]
  } else if (topup) {
    kind = 'topup'
    key = topup
    expectedAmount = TOPUP_PRICES[topup]
  } else {
    // schema refine 으로 이미 막혔지만 타입 좁히기용
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })
  }

  // ─── orderId 서버 생성 + pending_orders INSERT ────────────────────────────
  // prefix 는 디버깅 가독성용이며 신뢰 경계는 아니다 (실제 검증은 expected_amount).
  const orderId = `${kind}-${key}-${randomUUID()}`

  const admin = await createAdminClient()
  const { error: insertError } = await admin.from('pending_orders').insert({
    order_id: orderId,
    user_id: user.id,
    kind,
    key,
    expected_amount: expectedAmount,
  })

  if (insertError) {
    console.error('[/api/payments/prepare] pending_orders insert failed:', insertError.message)
    return NextResponse.json(
      { error: '결제 준비에 실패했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    orderId,
    amount: expectedAmount,
    kind,
    key,
  })
}
