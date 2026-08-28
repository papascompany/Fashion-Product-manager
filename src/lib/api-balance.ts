/**
 * AI 프로바이더 장애 분류 + 헬스 헬퍼 (운영 강화 ④)
 *
 * 목적
 *  - Anthropic / Google AI 호출 실패를 "왜 실패했는지(잔액·rate-limit·인증·타임아웃)"로
 *    타입 안전하게 분류해서, 로그를 grep/알람 가능한 단일 구조로 남긴다.
 *  - Admin 대시보드가 호출할 수 있는 가벼운 헬스 조회(getApiHealth)를 제공한다.
 *
 * 설계 메모
 *  - 분류 regex / status code 는 기존 라우트(pipeline·ai-fitting·thumbnail)와
 *    router.ts `isRetriableError` 에 흩어진 패턴과 "행동상 호환"되도록 맞췄다.
 *    (status 429/402/503/529 + /quota|rate.?limit|credit.?balance|insufficient|
 *     RESOURCE_EXHAUSTED|401|unauthorized|invalid.*api.*key|timeout/)
 *  - 이 파일은 어떤 기존 라우트에도 연결돼 있지 않다(순수 add-only). 라우트들이
 *    나중에 채택하면 세 군데 중복을 제거할 수 있다.
 *  - getApiHealth() 는 네트워크 호출을 하지 않는다. Anthropic/Google 모두 저렴한
 *    "잔액 조회" 엔드포인트를 제공하지 않고, AI 호출은 Edge/Node 라우트 핸들러에서
 *    일어나므로, 여기서는 API 키 "설정 여부" + (선택) 마지막 분류된 장애만 보고한다.
 *
 * Edge Runtime 호환 — Node 전용 API 미사용.
 */

// ─── 타입 ───────────────────────────────────────────────────────────────────

/** AI 호출 실패의 분류 결과 (판별 유니온). */
export type ApiBalanceStatus =
  | 'ok'              // 실패 아님 (분류 대상 아님)
  | 'quota_exhausted' // 잔액 소진 / 결제 미활성 (402, credit_balance, RESOURCE_EXHAUSTED)
  | 'rate_limited'    // 호출 빈도 초과 (429, rate limit, overloaded)
  | 'auth_invalid'    // 인증 실패 (401, invalid api key)
  | 'timeout'         // 타임아웃 / 네트워크 일시 오류
  | 'unknown'         // 위에 해당 없음

/** 어느 프로바이더에서 났는지 (메시지/키 힌트 기반 best-effort). */
export type ApiProvider = 'anthropic' | 'google' | 'unknown'

export interface ProviderErrorClassification {
  status: ApiBalanceStatus
  provider: ApiProvider
  /** 사람이 읽기 위한 원본 메시지 (앞부분만, 최대 240자). */
  message: string
}

/** reportProviderFailure 호출 시 함께 남길 컨텍스트. */
export interface ProviderFailureContext {
  /** 어떤 작업 중 실패했는지 — 예: 'analyze' | 'naming' | 'thumbnail' | 'ai-fitting'. */
  task?: string
  /** 호출자가 이미 알고 있다면 프로바이더 명시 (분류보다 우선). */
  provider?: ApiProvider
}

// ─── 내부 유틸 ───────────────────────────────────────────────────────────────

function errMessageOne(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string }
    return e.message ?? e.details ?? e.hint ?? JSON.stringify(err)
  }
  return String(err)
}

/**
 * 에러와 그 `cause` 체인을 하나의 진단 문자열로 펼친다.
 *
 * 래핑된 에러의 최상위 message 만 보면 원인이 가려진다 — 실제로
 * NanaBanana2Provider 가 전부 실패를 고정 문구로 감싸는 바람에 thumbnail 라우트의
 * 결제/쿼터 분류(BILLING_REQUIRED)가 발화하지 못했다. 분류는 이 함수의 결과로 해야 한다.
 *
 * ⚠️ 반환값에는 업스트림(Google 등) 원문이 포함되므로 **서버 로그·분류 전용**이다.
 * 클라이언트 응답 본문에 그대로 싣지 말 것.
 */
export function flattenErrorChain(err: unknown, maxDepth = 5): string {
  const parts: string[] = []
  let current: unknown = err
  const seen = new Set<unknown>()

  for (let depth = 0; depth < maxDepth && current !== undefined && current !== null; depth++) {
    if (typeof current === 'object') {
      if (seen.has(current)) break // 순환 cause 방어
      seen.add(current)
    }
    parts.push(errMessageOne(current))
    current = current instanceof Error ? (current as Error).cause : undefined
  }

  return parts.join(' | ')
}

function errMessage(err: unknown): string {
  return flattenErrorChain(err)
}

function errStatusCode(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; statusCode?: number }
    return e.status ?? e.statusCode
  }
  return undefined
}

/** 메시지/키 힌트로 프로바이더 추정. 확정 불가 시 'unknown'. */
function inferProvider(message: string): ApiProvider {
  const m = message.toLowerCase()
  if (/anthropic|claude|x-api-key|console\.anthropic/.test(m)) return 'anthropic'
  if (/google|gemini|generativelanguage|aistudio|resource_exhausted|gcp/.test(m)) return 'google'
  return 'unknown'
}

// ─── 핵심: 에러 분류 ─────────────────────────────────────────────────────────

/**
 * AI 프로바이더 에러를 타입 안전한 상태로 분류한다 (순수 함수, 부작용 없음).
 *
 * 우선순위: 잔액 > 인증 > rate-limit > 타임아웃 > unknown.
 * (잔액/인증은 사용자가 조치해야 하는 "지속성" 장애라 먼저 잡는다.)
 */
export function classifyProviderError(err: unknown): ProviderErrorClassification {
  const rawMessage = errMessage(err)
  const message = rawMessage.toLowerCase()
  const code = errStatusCode(err)
  const provider = inferProvider(rawMessage)

  let status: ApiBalanceStatus

  if (
    code === 402 ||
    /credit.?balance|insufficient.*credit|credits?.*low|low.*credit.*balance|resource_exhausted|billing/i.test(message)
  ) {
    status = 'quota_exhausted'
  } else if (code === 401 || /unauthorized|invalid.*api.*key|x-api-key|forbidden/i.test(message)) {
    status = 'auth_invalid'
  } else if (
    code === 429 ||
    code === 503 ||
    code === 529 ||
    /rate.?limit|too many requests|quota|overloaded|capacity/i.test(message)
  ) {
    status = 'rate_limited'
  } else if (/timeout|timed out|aborted|econnreset|fetch.?failed/i.test(message)) {
    status = 'timeout'
  } else {
    status = 'unknown'
  }

  return {
    status,
    provider,
    message: rawMessage.slice(0, 240),
  }
}

// ─── 장애 보고 (구조화 로그) ─────────────────────────────────────────────────

/**
 * 마지막으로 분류된 장애(프로세스 인메모리). 다중 인스턴스/콜드스타트에서는
 * 휘발되므로 "지금 이 인스턴스에서 최근에 본 장애" 수준의 힌트로만 쓴다.
 * 영속 저장(예: api_incidents 테이블)은 decisionsNeeded 로 분리.
 */
let lastIncident: (ProviderErrorClassification & { task?: string; at: string }) | undefined

/**
 * 에러를 분류하고 단일 구조화 로그로 남긴다.
 *  `console.warn('[api-balance]', '{"status":...,"provider":...,"task":...,"message":...}')`
 * 형태라 추후 grep / 로그 기반 알람을 걸기 쉽다.
 *
 * 외부 알림 채널(Slack/SMS/email)은 의도적으로 연결하지 않는다 — decisionsNeeded 참고.
 *
 * @returns 분류 결과 (호출자가 사용자 메시지 변환 등에 재사용 가능).
 */
export function reportProviderFailure(
  err: unknown,
  ctx: ProviderFailureContext = {}
): ProviderErrorClassification {
  const classified = classifyProviderError(err)
  const provider = ctx.provider ?? classified.provider
  const result: ProviderErrorClassification = { ...classified, provider }

  lastIncident = { ...result, task: ctx.task, at: new Date().toISOString() }

  console.warn(
    '[api-balance]',
    JSON.stringify({
      status: result.status,
      provider: result.provider,
      task: ctx.task,
      message: result.message,
    })
  )

  return result
}

// ─── 헬스 조회 (Admin 대시보드용) ────────────────────────────────────────────

export interface ApiHealth {
  /** ANTHROPIC_API_KEY 설정 여부 (실제 잔액이 아님). */
  anthropicKey: boolean
  /** GOOGLE_GENERATIVE_AI_API_KEY 설정 여부 (실제 잔액이 아님). */
  googleKey: boolean
  /** 이 인스턴스에서 마지막으로 분류된 장애 (있다면). 영속 아님. */
  lastIncident?: {
    status: ApiBalanceStatus
    provider: ApiProvider
    task?: string
    message: string
    at: string
  }
}

/**
 * 현재 AI 프로바이더 "설정 헬스"를 반환한다.
 *
 * 주의: 실시간 잔액/할당량이 아니라 (a) API 키 설정 여부 + (b) 이 인스턴스에서
 * 최근 분류된 장애를 보여준다. 네트워크 호출 없음 → ~0ms.
 */
export function getApiHealth(): ApiHealth {
  return {
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    googleKey: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    lastIncident,
  }
}
