import type { NextConfig } from "next";

// SEC-13 / OPS-04 — 보안 헤더 및 이미지 호스트 화이트리스트.
// NEXT_PUBLIC_SUPABASE_URL 가 있으면 그 host 만 정확히 화이트리스트.
// fallback: 일반 *.supabase.co (개발용). *.supabase.in 은 제거.
function getSupabaseHostname(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return '*.supabase.co'
  try {
    return new URL(url).hostname
  } catch {
    return '*.supabase.co'
  }
}

const supabaseHost = getSupabaseHostname()

// UX-04 / OPS-04 — Content-Security-Policy 강화.
// - script-src: self + 카카오/토스 SDK ('unsafe-inline' Next 부트스트랩, dev 만 'unsafe-eval')
// - connect-src: self + Supabase + Anthropic/Google AI 게이트웨이 + 토스/카카오
// - img-src: self + Supabase + data: (base64 미리보기)
// - frame-ancestors: 'none' (클릭재킹 방어 — X-Frame-Options 보강)
const isDev = process.env.NODE_ENV !== 'production'
const CSP_DIRECTIVES = [
  "default-src 'self'",
  // Next.js 인라인 부트스트랩 + 외부 SDK. dev 에선 turbopack 이 eval 사용 가능.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://developers.kakao.com https://t1.kakaocdn.net https://*.tosspayments.com`,
  // styled-jsx / Tailwind 인라인 스타일 허용
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://${supabaseHost} https://*.supabase.co https://k.kakaocdn.net`,
  "font-src 'self' data:",
  // AI 라우트 + Supabase + 결제 webhook
  `connect-src 'self' https://${supabaseHost} https://*.supabase.co wss://${supabaseHost} wss://*.supabase.co https://api.anthropic.com https://generativelanguage.googleapis.com https://api.tosspayments.com https://kapi.kakao.com`,
  "frame-src 'self' https://*.tosspayments.com https://*.kakao.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const SECURITY_HEADERS = [
  // 클릭재킹 방어: 동일 출처 iframe만 허용
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // MIME 스니핑 방어: Content-Type을 반드시 따르도록 강제
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Referrer 정보 최소화 (외부 사이트로 경로 정보 미전송)
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // XSS 방어 (레거시 브라우저용)
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // HTTPS 강제 (1년 + 서브도메인 포함)
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // 권한 정책: 불필요한 브라우저 기능 비활성화
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // OPS-04 — CSP 강화 (외부 도메인 화이트리스트만 허용)
  { key: 'Content-Security-Policy', value: CSP_DIRECTIVES },
]

const nextConfig: NextConfig = {
  // X-Powered-By 헤더 제거 (기술 스택 노출 차단)
  poweredByHeader: false,

  // SEC-13: 보안 헤더 전역 적용
  headers: async () => [
    {
      source: '/(.*)',
      headers: SECURITY_HEADERS,
    },
  ],

  // OPS-04 — next/image — 사용 중인 Supabase host 만 정확히 화이트리스트.
  // *.supabase.in 은 사용처가 없어 제거 (불필요한 image optimizer surface 축소).
  // pathname 도 /storage/v1/object/** 로 좁혀 다른 endpoint 우회 방지.
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: supabaseHost === '*.supabase.co'
      ? [
          {
            protocol: 'https',
            hostname: '*.supabase.co',
            pathname: '/storage/v1/object/**',
          },
        ]
      : [
          {
            protocol: 'https',
            hostname: supabaseHost,
            pathname: '/storage/v1/object/**',
          },
          // dev/preview fallback
          {
            protocol: 'https',
            hostname: '*.supabase.co',
            pathname: '/storage/v1/object/**',
          },
        ],
    deviceSizes: [640, 828, 1080, 1200, 1920],
    imageSizes: [40, 64, 128, 256, 512],
  },

  // Turbopack: 프로젝트 루트를 명시해 홈 디렉토리 package-lock.json 오인 방지
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
