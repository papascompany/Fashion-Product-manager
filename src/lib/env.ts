/**
 * 환경변수 중앙 검증 모듈
 *
 * 모든 환경변수는 이 파일을 통해서만 접근합니다.
 * backend-dev 규칙: 환경변수는 반드시 lib/env.ts에서 중앙 검증
 */

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

/** Toss Payments 클라이언트 키 */
export const NEXT_PUBLIC_TOSS_CLIENT_KEY =
  process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? optionalEnv('TOSS_CLIENT_KEY')

/** Kakao JavaScript SDK 키 */
export const NEXT_PUBLIC_KAKAO_JS_KEY =
  process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? ''

/** 앱 URL */
export const NEXT_PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
