/**
 * Supabase 서버 클라이언트 (Server Components / API Routes 용)
 *
 * Track 3 (TYP-01) — `<Database>` 제네릭을 명시해 `.from()` / `.rpc()` 호출이
 * 정적 타입 안전망 안에서 동작하도록 한다. 다른 트랙이 import 하는
 * `createClient` / `createAdminClient` 함수 시그니처는 그대로 유지한다
 * (반환 타입이 좁아져도 호출 측 코드는 컴파일에 그대로 통과).
 */
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
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
 * ⚠️ 이 클라이언트는 RLS 를 우회한다. 호출처는 반드시 스스로 행을 좁혀야 한다
 *    (`.eq('user_id', user.id)` 등). RLS 가 대신 막아주지 않는다.
 *
 * ⚠️ 쿠키를 절대 연결하지 말 것 — 예전에는 `createServerClient(url, SERVICE_KEY, { cookies })`
 *    였는데, 이 조합은 service_role 로 동작하지 않는다:
 *      · supabase-js `fetchWithAuth` 는 `apikey` 에만 supabaseKey 를 넣고,
 *        `Authorization` 은 `_getAccessToken()` 결과를 쓴다.
 *      · `_getAccessToken()` = `(await auth.getSession()).session?.access_token ?? supabaseKey`
 *      · `createServerClient` 는 쿠키를 auth 스토리지로 연결하므로, 로그인 쿠키가 있으면
 *        세션이 잡혀 `Authorization: Bearer <사용자 JWT>` 로 나간다 → RLS 적용(authenticated).
 *    즉 "로그인한 사용자가 부르면 admin 이 아니고, 익명이 부르면 admin" 인 상태였다.
 *    (실측 증상: 로그인 admin 의 /admin 통계 42501, AI Fitting 의 last_model_image_url
 *     업데이트가 가드 트리거에 되돌려짐. @supabase/ssr 0.10.2 소스로 확인)
 *
 * 그래서 여기서는 ssr 래퍼가 아니라 supabase-js 를 직접 쓰고 세션을 완전히 끈다.
 * 세션이 없으면 `_getAccessToken()` 이 supabaseKey(service_role)로 폴백한다.
 */
export async function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}
