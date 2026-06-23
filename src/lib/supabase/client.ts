/**
 * Supabase 브라우저 클라이언트 (클라이언트 컴포넌트용)
 *
 * Track 3 (TYP-01) — `<Database>` 제네릭을 명시해 client-side `.from()` 호출도
 * 정적 타입 안전망 안에 둔다.
 */
import { createBrowserClient } from '@supabase/ssr'
// Track 3 의 <Database> 제네릭은 server.ts 와 같은 이유로 일시 제거 (TYP-01 후속).

/**
 * 환경변수가 비어있거나 placeholder인지 감지하고 사용자가 이해 가능한 에러를 던진다.
 * 예전에는 빈 문자열로 createClient를 호출하여 fetch가 무한 hang하면서
 * 회원가입/로그인 progress 인디케이터가 멈추지 않는 문제가 있었음.
 */
function assertSupabaseEnv(url: string, key: string): void {
  const placeholders = [
    '',
    'your-project',
    'your-anon-key',
    'YOUR_SUPABASE_URL',
    'YOUR_SUPABASE_ANON_KEY',
  ]

  if (!url || placeholders.some((p) => p && url.includes(p))) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았거나 placeholder입니다. .env.local을 확인하고 dev 서버를 재시작하세요.'
    )
  }
  if (!key || placeholders.some((p) => p && key.includes(p))) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았거나 placeholder입니다. .env.local을 확인하고 dev 서버를 재시작하세요.'
    )
  }
  // URL 형식 검증
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith('.supabase.co') && !parsed.hostname.endsWith('.supabase.in')) {
      throw new Error('not a supabase host')
    }
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL 형식이 올바르지 않습니다 (값: "${url}"). https://xxx.supabase.co 형식이어야 합니다.`
    )
  }
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  assertSupabaseEnv(url, key)
  return createBrowserClient(url, key)
}
