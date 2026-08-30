import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Supabase Auth 세션 갱신 미들웨어
 * 모든 요청에서 쿠키 기반 세션을 유지
 *
 * 환경변수 누락 또는 Supabase 통신 실패 시 500을 던지는 대신,
 * 비인증 상태로 통과시켜 페이지 레벨에서 명확한 에러를 표시할 수 있게 한다.
 */
export async function proxy(request: NextRequest) {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supaAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // 환경변수 미설정 시 그대로 통과 (강제 이동 시 500 방지)
  if (!supaUrl || !supaAnon) {
    console.error('[proxy] Supabase 환경변수 누락 — .env.local 확인 필요')
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(supaUrl, supaAnon, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // 세션 갱신 (토큰 만료 방지) — Supabase 통신 실패 시 비인증으로 폴백
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (err) {
    console.error('[proxy] supabase.auth.getUser 실패:', err)
    // 인증 검사 없이 통과 (보호 페이지로 이동 시 페이지 레벨에서 처리)
    return supabaseResponse
  }

  // 인증 필요 페이지 보호
  const { pathname } = request.nextUrl
  const isAuthPage = pathname.startsWith('/auth')
  const isApiRoute = pathname.startsWith('/api')
  const isPublicPage =
    pathname === '/' ||
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname.startsWith('/share/') ||
    isAuthPage ||
    isApiRoute

  // 인증된 사용자가 루트(랜딩) 접근 시 → 스튜디오로 리다이렉트
  if (user && pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/studio'
    return NextResponse.redirect(url)
  }

  // 비인증 사용자가 보호된 페이지 접근 시 → 로그인으로 리다이렉트
  if (!user && !isPublicPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // v1.1 Admin — /admin/* 경로는 role='admin' 유저만 접근 가능
  if (user && pathname.startsWith('/admin')) {
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role, banned_at')
        .eq('id', user.id)
        .single()

      const isAdmin = profile?.role === 'admin' && !profile?.banned_at
      if (!isAdmin) {
        const url = request.nextUrl.clone()
        url.pathname = '/studio'
        return NextResponse.redirect(url)
      }
    } catch (err) {
      console.error('[proxy] admin check failed:', err)
      const url = request.nextUrl.clone()
      url.pathname = '/studio'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // 크롤러/PWA 정적 파일(robots.txt·sitemap.xml·manifest)은 프록시 제외.
    // 제외하지 않으면 비인증 요청이 /auth/login 으로 리다이렉트돼 robots.txt 가 무효화된다.
    // 각 항목은 `$` 로 경로 전체를 고정해 과잉 제외(인증 우회)를 막는다.
    '/((?!_next/static|_next/image|favicon.ico|robots\\.txt$|sitemap\\.xml$|manifest\\.json$|site\\.webmanifest$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
