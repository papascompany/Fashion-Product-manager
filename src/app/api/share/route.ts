/**
 * 공유 API (Track 1 핫픽스 — SEC-NEW-01/02 + BIZ-08 SMS 일부)
 * POST /api/share
 *
 * 보안 강화 사항:
 *   - SEC-NEW-01: projectId 소유 검증 + productName/tagline 길이 제한
 *     + shareUrl 호스트 화이트리스트 + 플랜별 일일 cap.
 *   - SEC-NEW-02: shares.insert error 시 5xx 반환 (RLS 거부 → SMS 발송 차단).
 *   - BIZ-08 (SMS 부분): Free 차단, Starter 5건/일, Pro/Business 30건/일.
 *     카카오 공유는 클라이언트 SDK 에서 처리되므로 본 라우트는 SMS·link 만.
 *   - SMS fail-closed: COOLSMS 키가 하나라도 없으면 운영에서는 503 을 반환한다.
 *     예전에는 mock messageId 로 성공 응답 + 일일 쿼터 차감이 일어나 사용자는
 *     "보냈다"고 믿었지만 문자는 가지 않았다. 확인 순서를 shares insert 와
 *     쿼터 차감보다 앞에 두어 실패 시 부수효과가 남지 않게 한다.
 *     비운영(NODE_ENV !== 'production')에서는 기존 mock 동작을 유지한다.
 *
 * ⚠️ shares insert 는 /share/[projectId] 공개 게이트의 근거이기도 하다
 *    (공유 기록이 있는 프로젝트만 공개). 이 라우트가 기록을 남기지 않으면
 *    해당 공유 링크는 404 가 된다.
 *
 * runtime: nodejs (CoolSMS 가 crypto 모듈 사용).
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─── 입력 스키마 ────────────────────────────────────────────────────────────
const ShareSchema = z.object({
  method: z.enum(['sms', 'kakao', 'link']),
  projectId: z.string().uuid(),
  // 한국 휴대전화: 010-XXXX-XXXX (하이픈 옵션)
  phone: z
    .string()
    .regex(/^010-?[0-9]{4}-?[0-9]{4}$/, { message: '올바른 휴대전화 번호 형식이 아닙니다.' })
    .optional(),
  productName: z.string().min(1).max(60, { message: '상품명은 60자 이내여야 합니다.' }),
  tagline: z.string().min(1).max(120, { message: '태그라인은 120자 이내여야 합니다.' }),
  shareUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
})

// ─── 호스트 화이트리스트 ────────────────────────────────────────────────────
const STATIC_ALLOWED_HOSTS = new Set<string>([
  'productcraft.ai',
  'www.productcraft.ai',
  'productcraft-ai.vercel.app',
])

function isShareUrlAllowed(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = u.host.toLowerCase()
    if (STATIC_ALLOWED_HOSTS.has(host)) return true
    const envHost = process.env.NEXT_PUBLIC_SITE_URL
    if (envHost) {
      try {
        const allowed = new URL(envHost).host.toLowerCase()
        if (host === allowed) return true
      } catch {
        // env 가 깨졌으면 무시
      }
    }
    return false
  } catch {
    return false
  }
}

// ─── 플랜별 일일 SMS 한도 ──────────────────────────────────────────────────
type Plan = 'free' | 'starter' | 'pro' | 'business'

const DAILY_SMS_CAP: Record<Plan, number> = {
  free: 0,
  starter: 5,
  pro: 30,
  business: 30,
}

const SHARE_EVENT_TYPE = 'share_sms_sent'

// ─── SMS 구성 여부 (fail-closed) ────────────────────────────────────────────
// 키가 없으면 예전에는 mock messageId 를 성공으로 반환해 "보냈다"고 응답하면서
// 일일 쿼터까지 차감했다(문자는 안 감). 운영에서는 발송 전에 막는다.
// env.ts 의 COOLSMS_* 는 누락 시 throw 하므로 여기서는 존재 여부만 본다.
function isSmsConfigured(): boolean {
  return Boolean(
    process.env.COOLSMS_API_KEY &&
      process.env.COOLSMS_API_SECRET &&
      process.env.COOLSMS_FROM_NUMBER
  )
}

const SMS_NOT_CONFIGURED_MESSAGE =
  'SMS 발송이 구성되지 않았습니다. 링크 복사나 카카오 공유를 이용해 주세요.'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: '인증 필요' }, { status: 401 })
    }

    // ─── 본문 파싱 ─────────────────────────────────────────────────────────
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ error: '잘못된 요청 본문' }, { status: 400 })
    }
    const parsed = ShareSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { method, projectId, phone, productName, tagline, shareUrl } = parsed.data

    // ─── shareUrl 호스트 화이트리스트 ───────────────────────────────────────
    if (!isShareUrlAllowed(shareUrl)) {
      return NextResponse.json(
        { error: '허용되지 않은 공유 URL 입니다.' },
        { status: 400 }
      )
    }

    // ─── projectId 소유 검증 (SEC-NEW-01) ───────────────────────────────────
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('user_id')
      .eq('id', projectId)
      .maybeSingle()

    if (projectError) {
      console.error('[/api/share] project lookup error:', projectError.message)
      return NextResponse.json({ error: '프로젝트 조회 실패' }, { status: 500 })
    }
    if (!project || (project as { user_id: string }).user_id !== user.id) {
      // 존재하지 않거나 타인의 프로젝트 → 동일하게 404 로 응답 (정보 노출 방지)
      return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
    }

    // ─── SMS 방식: 사전 검증 (banned + 일일 cap) ──────────────────────────
    if (method === 'sms') {
      if (!phone) {
        return NextResponse.json(
          { error: 'SMS 발송에는 전화번호가 필요합니다.' },
          { status: 400 }
        )
      }

      // 구성 확인은 shares insert / 쿼터 차감보다 **먼저** 한다.
      // 뒤에서 막으면 문자는 안 갔는데 공유 기록만 남아 공유 페이지가 열린다.
      if (process.env.NODE_ENV === 'production' && !isSmsConfigured()) {
        console.error('[/api/share] COOLSMS env not configured — SMS fail-closed')
        return NextResponse.json({ error: SMS_NOT_CONFIGURED_MESSAGE }, { status: 503 })
      }

      // 사용자 plan + banned_at 조회
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('plan, banned_at')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        return NextResponse.json(
          { error: '사용자 정보를 찾을 수 없습니다.' },
          { status: 500 }
        )
      }

      if ((profile as { banned_at: string | null }).banned_at) {
        return NextResponse.json(
          { error: '계정 사용이 정지되었습니다.' },
          { status: 403 }
        )
      }

      const plan = (profile as { plan: Plan }).plan
      const cap = DAILY_SMS_CAP[plan] ?? 0
      if (cap <= 0) {
        return NextResponse.json(
          {
            error: '현재 플랜에서는 SMS 공유를 사용할 수 없습니다.',
            upgradeUrl: '/billing',
          },
          { status: 402 }
        )
      }

      // 오늘(자정 기준 UTC) 사용량 카운트
      const startOfDay = new Date()
      startOfDay.setUTCHours(0, 0, 0, 0)

      const { count, error: countError } = await supabase
        .from('usage_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('event_type', SHARE_EVENT_TYPE)
        .gte('created_at', startOfDay.toISOString())

      if (countError) {
        console.error('[/api/share] usage count error:', countError.message)
        return NextResponse.json(
          { error: '사용량 확인에 실패했습니다.' },
          { status: 500 }
        )
      }

      if ((count ?? 0) >= cap) {
        return NextResponse.json(
          {
            error: `오늘 SMS 공유 한도(${cap}건)를 초과했습니다.`,
            upgradeUrl: '/billing',
          },
          { status: 402 }
        )
      }
    }

    // ─── shares 기록 (RLS 거부 시 5xx 로 SMS 차단) ────────────────────────
    const { error: shareInsertError } = await supabase.from('shares').insert({
      project_id: projectId,
      user_id: user.id,
      channel: method,
      target: phone ?? null,
    })

    if (shareInsertError) {
      console.error('[/api/share] shares insert error:', shareInsertError.message)
      return NextResponse.json(
        { error: '공유 이벤트 기록에 실패했습니다.' },
        { status: 500 }
      )
    }

    if (method === 'sms') {
      const result = await sendSMS({
        phone: phone as string,
        productName,
        tagline,
        shareUrl,
      })

      // 일일 카운터 기록 (성공 시점에만)
      const { error: usageError } = await supabase.from('usage_events').insert({
        user_id: user.id,
        event_type: SHARE_EVENT_TYPE,
        credits_used: 0,
        metadata: { projectId, messageId: result.messageId },
      })
      if (usageError) {
        // 카운트 누락은 운영 알람으로만, 사용자 응답은 성공 처리
        console.warn('[/api/share] usage_events insert failed:', usageError.message)
      }

      return NextResponse.json({ success: true, messageId: result.messageId })
    }

    if (method === 'kakao') {
      // Kakao 는 클라이언트 SDK 가 처리. shares 기록만 남기고 성공 반환.
      return NextResponse.json({ success: true, method: 'kakao' })
    }

    // link copy — 별도 외부 호출 없음
    return NextResponse.json({ success: true, shareUrl })
  } catch (err) {
    console.error('[/api/share]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: '공유 처리 중 오류' }, { status: 500 })
  }
}

// ─── CoolSMS 발송 ─────────────────────────────────────────────────────────────

async function sendSMS(params: {
  phone: string
  productName: string
  tagline: string
  shareUrl: string
}): Promise<{ messageId: string }> {
  const apiKey = process.env.COOLSMS_API_KEY
  const apiSecret = process.env.COOLSMS_API_SECRET
  const fromNumber = process.env.COOLSMS_FROM_NUMBER

  if (!apiKey || !apiSecret || !fromNumber) {
    // 운영에서는 절대 성공으로 위장하지 않는다 (라우트 진입부에서 이미 503 으로
    // 막히지만, 다른 호출 경로가 생겨도 fail-open 되지 않도록 여기서도 차단).
    if (process.env.NODE_ENV === 'production') {
      throw new Error(SMS_NOT_CONFIGURED_MESSAGE)
    }
    // 비운영(개발/스테이징/테스트)에서만 Mock 응답 — 전화번호 로그 금지
    console.log('[CoolSMS Mock] SMS skipped — keys not configured')
    return { messageId: `mock-${Date.now()}` }
  }

  const timestamp = Date.now().toString()
  const { createHmac } = await import('crypto')
  const signature = createHmac('sha256', apiSecret)
    .update(`${timestamp}${apiKey}`)
    .digest('hex')

  const response = await fetch('https://api.coolsms.co.kr/messages/v4/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${timestamp}, salt=${timestamp}, signature=${signature}`,
    },
    body: JSON.stringify({
      message: {
        to: params.phone.replace(/-/g, ''),
        from: fromNumber,
        text: buildSMSText(params),
      },
    }),
  })

  if (!response.ok) {
    let errMessage = 'CoolSMS 발송 실패'
    try {
      const err = (await response.json()) as { message?: string }
      errMessage = err?.message ?? errMessage
    } catch {
      // body 가 비어있거나 JSON 이 아닐 수 있음
    }
    throw new Error(errMessage)
  }

  const data = (await response.json()) as { groupId?: string }
  return { messageId: data?.groupId ?? `sms-${Date.now()}` }
}

function buildSMSText(params: { productName: string; tagline: string; shareUrl: string }): string {
  return `[ProductCraft AI]\n${params.productName}\n"${params.tagline}"\n\n상세보기: ${params.shareUrl}`
}
