/**
 * 상세페이지 생성 엔진 — 3 프리미엄 테마 토큰 시스템 (WS1)
 *
 * 구조 불변 · CSS 토큰 스왑 방식. 3테마의 hex/px/폰트 토큰은
 * docs/DETAIL_PAGE_ENGINE_PRD.md §1 + docs/mockups/detail-page-*.html 의
 * :root 토큰에서 그대로 가져왔다.
 *
 * 오너 확정(2026-07-11):
 * - Pretendard Variable = 전 테마 기본 서체(디폴트). bodyFont 는 전부 Pretendard 우선 스택.
 * - 세리프 디스플레이(Fraunces/명조)는 테마별 "선택 액센트"일 뿐 강제 아님.
 *   세리프 바이너리 미존재 → system serif fallback 스택으로만 둔다.
 */

export type ThemeId = 'editorial-minimal' | 'soft-luxury-serif' | 'clean-conversion'

export interface ThemeTokens {
  id: ThemeId
  name: string
  /** 캔버스 배경(용지) */
  paper: string
  /** 보조 서피스(surface/sand) */
  sand: string
  /** 본문 텍스트 */
  ink: string
  /** 흐린 텍스트 */
  muted: string
  /** 구분선 */
  line: string
  /** 액센트(라벨/아이브로 등, 절제 사용) */
  accent: string
  /** CTA(마감 타이포 블록) 색 — 커머스 버튼 아님 */
  cta: string
  /** CTA 대비 텍스트 */
  ctaText: string
  /** 이미지/셀 라운드(px 단위 문자열, 예: "4px") */
  radius: string
  /** 고정 캔버스 폭(px 숫자) */
  contentWidth: number
  /** 섹션 좌우 세이프 마진(px 숫자) */
  safeMargin: number
  /** 디스플레이 서체 스택(세리프는 system fallback) */
  displayFont: string
  /** 본문 서체 스택(전 테마 Pretendard 우선 = 디폴트) */
  bodyFont: string
  /** 혜택 배너 사용 여부(컨버전 테마만 on) */
  benefitBanner: boolean
}

/** 전 테마 공통 본문 스택 — Pretendard Variable 우선(디폴트) */
const PRETENDARD_STACK =
  '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", system-ui, sans-serif'

/** 에디토리얼 디스플레이 세리프(라틴, system fallback — 바이너리 미존재) */
const SERIF_LATIN_STACK =
  '"Hoefler Text", "Iowan Old Style", "Apple Garamond", Palatino, "Palatino Linotype", Georgia, serif'

/** 소프트 럭셔리 명조(한글 세리프, system fallback — 바이너리 미존재) */
const SERIF_KO_STACK =
  '"AppleMyungjo", "Nanum Myeongjo", "Apple SD Gothic Neo", serif'

export const THEMES: Record<ThemeId, ThemeTokens> = {
  'editorial-minimal': {
    id: 'editorial-minimal',
    name: '에디토리얼 미니멀',
    paper: '#F7F4EF',
    sand: '#EDE6DB',
    ink: '#2A2621',
    muted: '#8C8378',
    line: '#DED6C9',
    accent: '#7A5C43', // mocha — 라벨만
    cta: '#1E1A16',
    ctaText: '#F7F4EF',
    radius: '4px',
    contentWidth: 860,
    safeMargin: 70,
    displayFont: SERIF_LATIN_STACK,
    bodyFont: PRETENDARD_STACK,
    benefitBanner: false,
  },
  'soft-luxury-serif': {
    id: 'soft-luxury-serif',
    name: '소프트 럭셔리 세리프',
    paper: '#FBF8F4',
    sand: '#F0EAE1',
    ink: '#35302A',
    muted: '#9A9186',
    line: '#E4DCD1',
    accent: '#9DA98C', // sage
    cta: '#35302A',
    ctaText: '#FBF8F4',
    radius: '18px',
    contentWidth: 860,
    safeMargin: 56,
    displayFont: SERIF_KO_STACK,
    bodyFont: PRETENDARD_STACK,
    benefitBanner: false,
  },
  'clean-conversion': {
    id: 'clean-conversion',
    name: '클린 컨버전',
    paper: '#FFFFFF',
    sand: '#F4F5F7',
    ink: '#17171A',
    muted: '#6B6F76',
    line: '#E6E8EC',
    accent: '#FF4438', // benefit
    cta: '#111114',
    ctaText: '#FFFFFF',
    radius: '10px',
    contentWidth: 860,
    safeMargin: 40,
    displayFont: PRETENDARD_STACK, // 세리프 없음 — 전 구간 Pretendard
    bodyFont: PRETENDARD_STACK,
    benefitBanner: true,
  },
}

export const DEFAULT_THEME: ThemeId = 'editorial-minimal'

/**
 * <style> 태그 내부에 그대로 삽입할 문자열을 반환한다.
 *   (1) @font-face — Pretendard Variable 자체호스팅(/fonts/PretendardVariable.woff2).
 *       CSP `font-src 'self'` 정합. 가변 weight 45~920.
 *   (2) :root custom properties — 조립기/편집기가 참조하는 토큰.
 *
 * 세리프 디스플레이는 @font-face 없이 system serif fallback 스택(--font-display)으로만 노출한다.
 * 알 수 없는 themeId 는 DEFAULT_THEME 로 폴백.
 */
export function buildThemeStyle(themeId: ThemeId): string {
  const t = THEMES[themeId] ?? THEMES[DEFAULT_THEME]
  return `@font-face {
  font-family: "Pretendard Variable";
  src: url("/fonts/PretendardVariable.woff2") format("woff2");
  font-weight: 45 920;
  font-style: normal;
  font-display: swap;
}
:root {
  --paper: ${t.paper};
  --sand: ${t.sand};
  --ink: ${t.ink};
  --muted: ${t.muted};
  --line: ${t.line};
  --accent: ${t.accent};
  --cta: ${t.cta};
  --cta-text: ${t.ctaText};
  --radius: ${t.radius};
  --content-w: ${t.contentWidth}px;
  --safe: ${t.safeMargin}px;
  --font-display: ${t.displayFont};
  --font-body: ${t.bodyFont};
}`
}
