/**
 * Supabase 서버 클라이언트 (Server Components / API Routes 용)
 *
 * Track 3 (TYP-01) — `<Database>` 제네릭을 명시해 `.from()` / `.rpc()` 호출이
 * 정적 타입 안전망 안에서 동작하도록 한다. 다른 트랙이 import 하는
 * `createClient` / `createAdminClient` 함수 시그니처는 그대로 유지한다
 * (반환 타입이 좁아져도 호출 측 코드는 컴파일에 그대로 통과).
 */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
// Track 3 의 <Database> 제네릭은 supabase-js v2 의 select-string 추론과
// 충돌해 다수 호출 사이트에서 row 가 `never` 로 좁아져 빌드 실패를 일으켰다.
// types/supabase.ts 는 정의가 정확하지만 47 개 호출 사이트의 cast 보강이
// 별도 작업으로 필요. 우선 untyped 로 되돌리고 supabase gen types 연결 후
// 재적용한다 (TYP-01 후속 PR).

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component 에서 호출 시 cookies().set 이 막혀 있어 무시.
          }
        },
      },
    }
  )
}

/**
 * 서비스 롤 클라이언트 (웹훅/관리자 작업 전용 — RLS 우회)
 *
 * Track 1 의 admin client 사용 패턴과 동일한 export 시그니처 유지.
 */
export async function createAdminClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
