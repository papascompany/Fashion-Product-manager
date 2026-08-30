import type { MetadataRoute } from 'next'

/**
 * 크롤 정책 — /robots.txt 로 서빙되는 메타데이터 라우트
 *
 * 공개 페이지(랜딩·이용약관·개인정보처리방침)만 크롤을 허용하고
 * 인증·운영·API·작업 공간·공유 링크 경로는 전부 차단한다.
 *
 * ⚠️ proxy.ts 의 matcher 에서 robots.txt 가 제외돼 있어야 실제로 서빙된다.
 *    제외가 빠지면 비인증 요청이 /auth/login 으로 리다이렉트돼 이 파일이 무효화된다.
 *
 * sitemap 은 공개 페이지가 3개뿐이라 생성하지 않는다 (참조도 하지 않음 — 404 유발 방지).
 *
 * ⚠️ `/share` 는 의도적으로 Disallow 에 넣지 않는다.
 *    robots.txt 로 크롤을 막으면 카카오·페이스북 링크 미리보기 스크레이퍼도 함께 막혀
 *    공유 링크의 OG 미리보기가 죽는다(공유가 제품의 핵심 경로다).
 *    색인 차단은 페이지 자체의 `robots: { index:false, follow:false }` 메타로 처리한다 —
 *    크롤러가 페이지를 가져와야 그 지시를 볼 수 있으므로 이쪽이 올바른 계층이다.
 *    (share/[projectId]/page.tsx 의 generateMetadata 참조)
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/terms', '/privacy'],
      disallow: [
        '/admin',   // 운영 대시보드
        '/api',     // 서버 라우트
        '/auth',    // 로그인 / 회원가입 / OAuth 콜백
        '/studio',  // 인증 사용자 작업 공간
        '/history', // 생성 히스토리
        '/billing', // 결제
      ],
    },
  }
}
