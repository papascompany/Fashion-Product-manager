// Edge 호환 (fetch만 사용). 'server-only' 는 client import 를 빌드 타임에 차단.
import 'server-only'

import type { ApiBalanceStatus, ApiProvider, ProviderErrorClassification } from './api-balance'

/**
 * 운영 알람 채널 (운영 강화 ④ wiring)
 *
 * 전송 채널 (환경변수로 선택):
 *  - Slack: `SLACK_ALERT_WEBHOOK_URL` (Incoming Webhook URL)
 *  - Email: Resend API — `RESEND_API_KEY` + `ALERT_EMAIL_FROM` + `ALERT_EMAIL_TO`
 *
 * 설계
 *  - best-effort, never throws — 알람 실패가 요청 흐름을 깨뜨리면 안 됨.
 *  - fire-and-forget 가능 (void sendAlert(...)) — 호출자가 await 하지 않아도 됨.
 *  - in-memory dedupe: 같은 `dedupeKey` 는 `DEDUPE_WINDOW_MS` 내 1회만 전송.
 *    (멀티 인스턴스/콜드스타트에서는 완벽하지 않지만, 폭주 억제엔 충분.)
 *  - Edge 호환 (fetch 외 Node 전용 API 미사용).
 *
 * 호출 사이트
 *  - `reportProviderFailure` (api-balance.ts) 가 심각도 필터 후 자동 호출.
 *  - Toss webhook 의 amount_mismatch / unknown_key / 예외 분기에서 직접 호출.
 */

// ─── dedupe (프로세스 인메모리) ────────────────────────────────────────────

const DEDUPE_WINDOW_MS = 10 * 60 * 1000 // 10분
const dedupeMap = new Map<string, number>()

function shouldSuppress(key: string | undefined): boolean {
  if (!key) return false
  const now = Date.now()
  const prev = dedupeMap.get(key)
  if (prev && now - prev < DEDUPE_WINDOW_MS) return true
  dedupeMap.set(key, now)
  // 간이 GC — 창을 넘긴 항목 정리 (맵이 무한 성장하지 않도록)
  if (dedupeMap.size > 500) {
    for (const [k, t] of dedupeMap) {
      if (now - t >= DEDUPE_WINDOW_MS) dedupeMap.delete(k)
    }
  }
  return false
}

// ─── 타입 ──────────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warn' | 'error'

export interface AlertPayload {
  /** 알람 제목 (한 줄). 이메일 subject, Slack 헤더로 쓰임. */
  subject: string
  /** 본문 — 2~5줄 요약 권장. markdown 금지(Slack mrkdwn 과 email html 두 포맷 공존). */
  body: string
  severity: AlertSeverity
  /** 추가 컨텍스트 — Slack code block 과 email <pre> 로 직렬화. */
  context?: Record<string, unknown>
  /** 같은 키의 알람은 10분 내 1회만 전송 (폭주 억제). */
  dedupeKey?: string
}

// ─── Slack ─────────────────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: ':information_source:',
  warn: ':warning:',
  error: ':rotating_light:',
}

async function sendSlack(payload: AlertPayload): Promise<void> {
  const webhook = process.env.SLACK_ALERT_WEBHOOK_URL
  if (!webhook) return

  const emoji = SEVERITY_EMOJI[payload.severity]
  const contextBlock = payload.context
    ? '```' + JSON.stringify(payload.context, null, 2).slice(0, 2500) + '```'
    : ''

  const text = `${emoji} *${payload.subject}*\n${payload.body}${contextBlock ? '\n' + contextBlock : ''}`

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      // Edge: timeout 은 AbortSignal.timeout 로. 5s 이상 걸리면 포기.
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.warn('[alerts] slack webhook returned', res.status)
    }
  } catch (err) {
    console.warn('[alerts] slack send failed (ignored):', err instanceof Error ? err.message : err)
  }
}

// ─── Email (Resend) ────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendEmail(payload: AlertPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.ALERT_EMAIL_FROM
  const toRaw = process.env.ALERT_EMAIL_TO
  if (!apiKey || !from || !toRaw) return

  // 쉼표로 구분된 수신자 지원
  const to = toRaw.split(',').map((s) => s.trim()).filter(Boolean)
  if (to.length === 0) return

  const contextHtml = payload.context
    ? `<pre style="background:#f5f5f5;padding:12px;border-radius:4px;overflow:auto;">${escapeHtml(
        JSON.stringify(payload.context, null, 2).slice(0, 4000)
      )}</pre>`
    : ''

  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;">
  <h2 style="margin:0 0 12px;">[${payload.severity.toUpperCase()}] ${escapeHtml(payload.subject)}</h2>
  <p style="white-space:pre-wrap;">${escapeHtml(payload.body)}</p>
  ${contextHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <small style="color:#777;">ProductCraft AI · ${new Date().toISOString()}</small>
</div>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: `[${payload.severity.toUpperCase()}] ${payload.subject}`,
        html,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn('[alerts] resend returned', res.status, text.slice(0, 200))
    }
  } catch (err) {
    console.warn('[alerts] email send failed (ignored):', err instanceof Error ? err.message : err)
  }
}

// ─── 공용 진입점 ───────────────────────────────────────────────────────────

/**
 * 운영 알람 전송 — Slack + Email 양쪽에 best-effort 로 보낸다.
 *
 * 호출자는 await 하거나 fire-and-forget 모두 가능 (어느 쪽도 throw 하지 않음).
 * dedupe 는 프로세스 인메모리이므로 다중 인스턴스에선 각자 1회씩 전송될 수 있다.
 */
export async function sendAlert(payload: AlertPayload): Promise<void> {
  if (shouldSuppress(payload.dedupeKey)) return

  // 알람 미설정 환경(로컬·CI)에서는 조용히 return — dev 가시성용 로그만 남긴다.
  if (
    !process.env.SLACK_ALERT_WEBHOOK_URL &&
    !(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_FROM && process.env.ALERT_EMAIL_TO)
  ) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[alerts] (no channel configured)', payload.severity, payload.subject)
    }
    return
  }

  // 두 채널 병렬 — 하나가 느려도 다른 하나 블로킹하지 않도록.
  await Promise.allSettled([sendSlack(payload), sendEmail(payload)])
}

// ─── 프로바이더 장애 전용 헬퍼 ────────────────────────────────────────────

/** 알람 발송 대상 심각도 — rate_limit·timeout 은 fallback 으로 흡수되므로 제외. */
const ALERTED_STATUSES: ReadonlySet<ApiBalanceStatus> = new Set<ApiBalanceStatus>([
  'quota_exhausted',
  'auth_invalid',
])

const SEVERITY_BY_STATUS: Record<ApiBalanceStatus, AlertSeverity> = {
  ok: 'info',
  quota_exhausted: 'error',
  auth_invalid: 'error',
  rate_limited: 'warn',
  timeout: 'warn',
  unknown: 'warn',
}

const PROVIDER_LABEL: Record<ApiProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini / Nano Banana 2)',
  unknown: 'Unknown provider',
}

const CONSOLE_URL: Record<ApiProvider, string | undefined> = {
  anthropic: 'https://console.anthropic.com/settings/billing',
  google: 'https://aistudio.google.com/app/apikey',
  unknown: undefined,
}

/**
 * 프로바이더 장애를 사람이 읽기 쉬운 알람으로 변환해 전송한다.
 * api-balance.ts 의 `reportProviderFailure` 가 자동 호출한다.
 */
export async function sendProviderAlert(
  classification: ProviderErrorClassification,
  task?: string
): Promise<void> {
  if (!ALERTED_STATUSES.has(classification.status)) return

  const providerLabel = PROVIDER_LABEL[classification.provider]
  const console_ = CONSOLE_URL[classification.provider]

  const subject =
    classification.status === 'quota_exhausted'
      ? `${providerLabel} 잔액/할당량 소진`
      : `${providerLabel} 인증 실패 (API 키 확인 필요)`

  const bodyLines = [
    `작업: ${task ?? 'unknown'}`,
    `상태: ${classification.status}`,
    `원문: ${classification.message}`,
  ]
  if (console_) bodyLines.push(`조치: ${console_} 에서 확인·충전 또는 키 재발급.`)

  await sendAlert({
    subject,
    body: bodyLines.join('\n'),
    severity: SEVERITY_BY_STATUS[classification.status],
    context: {
      provider: classification.provider,
      status: classification.status,
      task,
    },
    // 같은 (provider, status, task) 조합은 10분에 한 번만.
    dedupeKey: `provider:${classification.provider}:${classification.status}:${task ?? '-'}`,
  })
}
