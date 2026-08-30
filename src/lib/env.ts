/**
 * 환경변수 중앙 검증 모듈 (Track 3 — TYP-02 활성화)
 *
 * 변경 이전: 선언만 되어 어디서도 import 안 됨 (dead code).
 * 변경 이후: 본 모듈은 두 가지 책임을 한다.
 *   1. requireEnv / optionalEnv 헬퍼 + 키별 export 를 제공해 호출자가
 *      `process.env.XXX!` 대신 `XXX()` 를 쓰도록 유도한다.
 *   2. 서버 사이드에서 본 모듈이 import 되는 시점에 한해
 *      `assertServerEnvOrWarn()` 가 1회 호출되어, 필수 키 누락을
 *      console.warn 으로 로깅한다. (throw 하지 않는 이유: dev/local 환경에서
 *      일부 키가 없는 상태로도 페이지를 띄울 수 있도록 보수적으로 동작.)
 *
 * 호출 패턴:
 *   import { TOSS_SECRET_KEY } from '@/lib/env'
 *   const secret = TOSS_SECRET_KEY()  // 누락이면 throw
 *
 * 클라이언트 번들 보호:
 *   서버 전용 키는 함수형(`() => string`)으로만 export 한다 → 클라이언트가
 *   value 를 직접 참조해도 함수 본문 안의 process.env 접근만 일어나고,
 *   webpack tree-shaker / 'server-only' 패턴과 함께 안전.
 */

// ─── 내부 헬퍼 ────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function optionalEnv(key: string, defaultValue = ''): string {
  return process.env[key] ?? defaultValue
}

// ─── 서버사이드 전용 환경변수 ───────────────────────────────────────────────

/** Supabase 서비스 롤 키 (서버사이드 전용) */
export const SUPABASE_SERVICE_ROLE_KEY = () =>
  requireEnv('SUPABASE_SERVICE_ROLE_KEY')

/** Anthropic API 키 */
export const ANTHROPIC_API_KEY = () => requireEnv('ANTHROPIC_API_KEY')

/** Google Generative AI API 키 */
export const GOOGLE_GENERATIVE_AI_API_KEY = () =>
  requireEnv('GOOGLE_GENERATIVE_AI_API_KEY')

/** Toss Payments 시크릿 키 */
export const TOSS_SECRET_KEY = () => requireEnv('TOSS_SECRET_KEY')

/** CoolSMS API 키 */
export const COOLSMS_API_KEY = () => requireEnv('COOLSMS_API_KEY')

/** CoolSMS API 시크릿 */
export const COOLSMS_API_SECRET = () => requireEnv('COOLSMS_API_SECRET')

/** CoolSMS 발신 번호 */
export const COOLSMS_FROM_NUMBER = () => requireEnv('COOLSMS_FROM_NUMBER')

/** 상세페이지 렌더 서비스 URL (VPS Playwright, 선택 — 미설정 시 클라이언트 폴백) */
export const DETAIL_RENDER_URL = () => optionalEnv('DETAIL_RENDER_URL')

/** 상세페이지 렌더 서비스 인증 토큰 (선택) */
export const DETAIL_RENDER_TOKEN = () => optionalEnv('DETAIL_RENDER_TOKEN')

// ─── 클라이언트/서버 공용 환경변수 ─────────────────────────────────────────

/** Supabase 프로젝트 URL */
export const NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

/** Supabase Anon 키 */
export const NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

/**
 * Toss Payments 클라이언트 키 (공개값 — 브라우저 번들에 인라인된다)
 *
 * 과거 `?? optionalEnv('TOSS_CLIENT_KEY')` 폴백이 있었으나 제거했다.
 * `NEXT_PUBLIC_*` 만 빌드 타임에 값으로 치환되고 접두사 없는 `TOSS_CLIENT_KEY` 는
 * 클라이언트 번들에 주입되지 않으므로, 폴백은 서버에서만 우연히 동작하고
 * 브라우저에서는 항상 '' 였다 — 이름 불일치를 가려 등록 실수를 늦게 드러내는
 * 죽은 코드다. 이름은 `.env.local.example` 과 동일하게 하나만 쓴다.
 */
export const NEXT_PUBLIC_TOSS_CLIENT_KEY =
  process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? ''

/** Kakao JavaScript SDK 키 */
export const NEXT_PUBLIC_KAKAO_JS_KEY =
  process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? ''

/** 앱 URL */
export const NEXT_PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// ─── 모듈 로드 시 1회 검증 (server-only 환경) ────────────────────────────
// next/edge 또는 node 서버 컨텍스트에서만 실행. 클라이언트 번들에서는
// `typeof window !== 'undefined'` 가드로 noop.
//
// 운영 환경(prod 또는 preview)에서만 strict 하게 throw 한다. dev 는 경고.

const SERVER_REQUIRED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  // ANTHROPIC / GOOGLE / TOSS / COOLSMS 는 각 라우트 진입 시점에 검증되므로
  // 모듈 로드 시 누락이어도 즉시 throw 하지 않는다 (테스트/로컬 편의).
]

function assertServerEnvOrWarn(): void {
  if (typeof window !== 'undefined') return
  const missing = SERVER_REQUIRED_KEYS.filter((k) => !process.env[k])
  if (missing.length === 0) return

  const isProd = process.env.NODE_ENV === 'production'
  const isTest = process.env.NODE_ENV === 'test'
  if (isTest) return // 테스트는 setup.ts 가 더미 키를 주입하므로 검증 스킵.

  if (isProd) {
    // 운영에서 핵심 Supabase 키가 빠지면 fast-fail.
    throw new Error(
      `[env] 운영 환경에서 필수 환경변수가 누락됐습니다: ${missing.join(', ')}`
    )
  }
  console.warn(`[env] 누락된 환경변수: ${missing.join(', ')}`)
}

// 모듈 로드 1회 실행.
assertServerEnvOrWarn()
