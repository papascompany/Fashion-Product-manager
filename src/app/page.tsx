/**
 * 랜딩페이지 — Nike 디자인 시스템 완전 적용
 *
 * DESIGN-nike.md 핵심 원칙:
 *  - Chrome: #111111 / #ffffff / #f5f5f5 — 3-tone 외 장식색 없음
 *  - rounded.none = 0px — 컨테이너 전체 직각. 오직 pill 버튼만 rounded-full
 *  - typography.display-campaign: Bebas Neue 96px+ / line-height 0.9 / uppercase
 *  - typography.body: Pretendard Variable — globals.css --font-sans 적용
 *  - spacing.section = 48px — 섹션 수직 리듬 py-12
 *  - 드롭섀도우 없음 · 그라디언트 없음
 *  - button-primary: h-12 px-8 rounded-full bg-[#111111] text-white
 */

import Link from 'next/link'
import { ArrowRight, Check, Zap, Wand2 } from 'lucide-react'
import {
  PLAN_PRICES,
  PLAN_CREDITS,
  PLAN_DISPLAY_NAMES,
  FREE_INITIAL_CREDITS,
  formatKRW,
} from '@/lib/plan-settings-shared'

// ─── 요금제 ────────────────────────────────────────────────────────────────────
// BIZ-05 / BIZ-11 / UX-02 — 가격·크레딧 수치는 모두 plan-settings-shared SoT 에서 import.
// Free 카피는 "월 N회" 가 아니라 "가입 시 N크레딧 제공" 으로 수정 (월 cron 미도입).

interface LandingPlan {
  id: 'free' | 'starter' | 'pro' | 'business'
  name: string
  price: string
  sub: string
  credits: number
  highlight: boolean
  badge?: string
  features: string[]
  cta: string
  href: string
}

const PLANS: LandingPlan[] = [
  {
    id: 'free',
    name: PLAN_DISPLAY_NAMES.free,
    price: '무료',
    sub: '영원히',
    credits: PLAN_CREDITS.free,
    highlight: false,
    features: [
      `가입 시 ${FREE_INITIAL_CREDITS} 크레딧 제공`,
      '간편 모드',
      '1K 해상도',
      '7일 내역 보관',
    ],
    cta: '무료로 시작',
    href: '/auth/signup',
  },
  {
    id: 'starter',
    name: PLAN_DISPLAY_NAMES.starter,
    price: formatKRW(PLAN_PRICES.starter),
    sub: '/월',
    credits: PLAN_CREDITS.starter,
    highlight: false,
    features: [
      `월 ${PLAN_CREDITS.starter}크레딧`,
      '간편 + 스튜디오 모드',
      '2K 해상도',
      '30일 내역 보관',
    ],
    cta: '시작하기',
    href: '/auth/signup',
  },
  {
    id: 'pro',
    name: PLAN_DISPLAY_NAMES.pro,
    price: formatKRW(PLAN_PRICES.pro),
    sub: '/월',
    credits: PLAN_CREDITS.pro,
    highlight: true,
    badge: '인기',
    features: [
      `월 ${PLAN_CREDITS.pro}크레딧`,
      '4K 해상도 (Nano Banana 2)',
      'SMS + 카카오 공유 무제한',
      'HTML 상세페이지 내보내기',
      '무제한 내역 보관',
    ],
    cta: 'Pro 시작하기',
    href: '/auth/signup',
  },
  {
    id: 'business',
    name: PLAN_DISPLAY_NAMES.business,
    price: formatKRW(PLAN_PRICES.business),
    sub: '/월',
    credits: PLAN_CREDITS.business,
    highlight: false,
    features: [
      `월 ${PLAN_CREDITS.business.toLocaleString()}크레딧`,
      '팀 계정 5명',
      'API 접근 권한',
      '커스텀 브랜딩',
      '전담 지원',
    ],
    cta: '문의하기',
    href: 'mailto:hello@productcraft.ai',
  },
]

// ─── 스텝 ──────────────────────────────────────────────────────────────────────
const STEPS = [
  {
    num: '01',
    title: '사진 업로드',
    body: '스마트폰으로 찍은 사진이면 충분합니다. JPG · PNG · WEBP 모두 지원. 업로드 즉시 AI 분석 시작.',
    tag: '5초',
  },
  {
    num: '02',
    title: 'AI 자동 생성',
    body: '9개의 AI 에이전트가 실시간 트렌드를 분석해 상품명 3종, 홍보문구, 상세설명을 동시에 생성합니다.',
    tag: '15~30초',
  },
  {
    num: '03',
    title: '복사 & 등록',
    body: '스마트스토어, 쿠팡, 29CM에 바로 붙여넣기. SMS·카카오로 즉시 공유도 가능합니다.',
    tag: '즉시',
  },
]

// ─── 페이지 ────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="text-[#111111] bg-white">

      {/* ══════════════════════════════════════════════════════════════════════
          UTILITY BAR — height 36px, #f5f5f5
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="h-9 flex items-center justify-center bg-[#f5f5f5] border-b border-[#e5e5e5]">
        <p className="text-[12px] font-medium text-[#111111]">
          🍌&nbsp; Nano Banana 2 탑재 — AI 4K 썸네일 자동 생성&ensp;
          <Link href="/auth/signup" className="font-bold underline hover:no-underline">
            무료 체험 시작 →
          </Link>
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          PRIMARY NAV — height 56px, white, sticky
          button-primary: h-10 px-6 rounded-full bg-[#111111] text-white
      ══════════════════════════════════════════════════════════════════════ */}
      <header
        className="sticky top-0 z-50 bg-white h-14 flex items-center"
        style={{ borderBottom: '1px solid #e5e5e5' }}
      >
        <div className="w-full max-w-[1440px] mx-auto px-6 md:px-12 flex items-center justify-between">
          {/* 로고 */}
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[#111111] flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[10px] font-black tracking-tight">PC</span>
            </div>
            <span className="text-[14px] font-bold text-[#111111] tracking-tight hidden sm:block">
              ProductCraft AI
            </span>
          </Link>

          {/* 네비 링크 */}
          <nav className="hidden md:flex items-center gap-8">
            {([['#how', '작동 방식'], ['#features', '기능'], ['#pricing', '요금제']] as const).map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="text-[14px] font-medium text-[#707072] hover:text-[#111111] transition-colors"
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* CTA */}
          <div className="flex items-center gap-2">
            <Link
              href="/auth/login"
              className="hidden md:block text-[14px] font-medium text-[#707072] hover:text-[#111111] transition-colors px-4 py-2"
            >
              로그인
            </Link>
            <Link
              href="/auth/signup"
              className="h-10 px-6 rounded-full bg-[#111111] text-white text-[14px] font-semibold inline-flex items-center hover:bg-[#333] transition-colors"
            >
              무료 시작
            </Link>
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════════
          HERO — campaign-tile, #111111, display-campaign typography
          컨테이너: 0px radius (campaign-tile 스펙)
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-[#111111] px-6 md:px-12 pt-20 pb-16 md:pt-28 md:pb-24">
        <div className="max-w-[1440px] mx-auto">
          <div className="grid lg:grid-cols-[1fr_480px] xl:grid-cols-[1fr_560px] gap-12 xl:gap-20 items-start">

            {/* ── 헤드라인 블록 ── */}
            <div className="pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9e9ea0] mb-6">
                AI 상품 콘텐츠 자동화
              </p>

              {/* display-campaign: Bebas Neue, 0.9 line-height, uppercase */}
              <h1 className="mb-8 select-none" style={{ lineHeight: 1 }}>
                <span
                  className="block text-white uppercase"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(72px, 9.5vw, 128px)',
                    lineHeight: 0.88,
                    letterSpacing: 0,
                  }}
                >
                  PRODUCT
                </span>
                <span
                  className="block text-white uppercase"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(72px, 9.5vw, 128px)',
                    lineHeight: 0.88,
                    letterSpacing: 0,
                  }}
                >
                  CONTENT,
                </span>
                {/* heading-xl tier: Pretendard 900 */}
                <span
                  className="block text-white mt-3"
                  style={{
                    fontSize: 'clamp(44px, 6vw, 76px)',
                    fontWeight: 900,
                    lineHeight: 1.0,
                  }}
                >
                  30초면
                </span>
                <span
                  className="block text-[#9e9ea0] italic"
                  style={{
                    fontSize: 'clamp(44px, 6vw, 76px)',
                    fontWeight: 900,
                    lineHeight: 1.0,
                  }}
                >
                  충분합니다.
                </span>
              </h1>

              <p className="text-[16px] text-[#9e9ea0] leading-relaxed max-w-[420px] mb-8">
                사진 한 장 올리면 AI가 트렌드 반영 상품명 3종, 홍보문구,
                상세설명, 4K 썸네일까지 한 번에 만들어드립니다.
              </p>

              {/* button-primary + button-outline-on-image */}
              <div className="flex flex-wrap gap-3 mb-5">
                <Link
                  href="/auth/signup"
                  className="h-12 px-8 rounded-full bg-white text-[#111111] text-[14px] font-semibold inline-flex items-center gap-2 hover:bg-[#f5f5f5] transition-colors"
                >
                  무료로 시작하기 <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="#how"
                  className="h-12 px-8 rounded-full text-white text-[14px] font-medium inline-flex items-center transition-colors"
                  style={{ border: '1px solid rgba(255,255,255,0.18)' }}
                >
                  작동 방식 보기
                </Link>
              </div>
              <p className="text-[12px] text-[#4b4b4d]">카드 등록 없음 · 가입 시 {FREE_INITIAL_CREDITS} 크레딧 제공</p>
            </div>

            {/* ── Mock Output — 0px radius (campaign-tile 규칙) ── */}
            <div
              className="w-full"
              style={{ backgroundColor: '#1c1c1c', border: '1px solid #2a2a2a' }}
            >
              {/* 타이틀바 */}
              <div
                className="flex items-center gap-2 px-5 py-3"
                style={{ borderBottom: '1px solid #2a2a2a', backgroundColor: '#161616' }}
              >
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                  <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
                </div>
                <p className="text-[11px] text-[#707072] ml-2">AI 생성 결과 — 러닝화 상품</p>
              </div>

              <div className="p-5 space-y-4">
                {/* 상품명 */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#707072] mb-2">
                    상품명 3종
                  </p>
                  {[
                    { name: '프리미엄 방수 러닝화 Pro Max', selected: true },
                    { name: '울트라라이트 트레일화 V2 Edition', selected: false },
                    { name: '올웨더 스포츠화 퍼포먼스 Pro', selected: false },
                  ].map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 py-2 px-3 mb-1"
                      style={{
                        backgroundColor: item.selected ? '#2a2a2a' : 'transparent',
                        border: `1px solid ${item.selected ? '#3a3a3a' : 'transparent'}`,
                      }}
                    >
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: item.selected ? '#fff' : '#3a3a3a' }}
                      />
                      <span
                        className="text-[13px]"
                        style={{ color: item.selected ? '#ffffff' : '#707072' }}
                      >
                        {item.name}
                      </span>
                      {item.selected && (
                        <span
                          className="ml-auto text-[10px] font-bold rounded-full px-2 py-0.5"
                          style={{ backgroundColor: '#ffffff', color: '#111111' }}
                        >
                          선택
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ height: '1px', backgroundColor: '#2a2a2a' }} />

                {/* 홍보문구 */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#707072] mb-2">
                    한줄 홍보문구
                  </p>
                  <p className="text-[15px] font-medium italic text-white leading-snug">
                    &ldquo;비 오는 날에도, 당신의 달리기를 멈추지 않는다&rdquo;
                  </p>
                  <p className="text-[10px] text-[#4b4b4d] mt-1.5">23자 · SEO 최적화</p>
                </div>

                <div style={{ height: '1px', backgroundColor: '#2a2a2a' }} />

                {/* 키워드 */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#707072] mb-2">
                    트렌드 키워드
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {['#러닝화', '#방수', '#트레일러닝', '#스포츠화', '#방수화'].map((tag) => (
                      <span
                        key={tag}
                        className="text-[11px] px-2.5 py-1"
                        style={{ backgroundColor: '#2a2a2a', color: '#9e9ea0' }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ height: '1px', backgroundColor: '#2a2a2a' }} />

                {/* 상세설명 미리보기 */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#707072] mb-2">
                    SEO 상세설명 (미리보기)
                  </p>
                  <p className="text-[12px] text-[#9e9ea0] leading-relaxed line-clamp-3">
                    국내 최고의 방수 기술이 적용된 프리미엄 러닝화. 고어텍스 소재로
                    어떤 날씨에도 발을 건조하게 유지하며, 미끄럼 방지 아웃솔이
                    트레일 코스에서도 완벽한 그립을 제공합니다...
                  </p>
                  <p className="text-[10px] text-[#4b4b4d] mt-1.5">487자 · 스마트스토어 최적화</p>
                </div>
              </div>

              {/* 상태바 */}
              <div
                className="flex items-center justify-between px-5 py-3"
                style={{ borderTop: '1px solid #2a2a2a', backgroundColor: '#161616' }}
              >
                <p className="text-[10px] text-[#4b4b4d]">생성 완료 — 23초</p>
                <p className="text-[10px] font-semibold text-[#27c93f]">✓ 스마트스토어 최적화</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          TRUST STRIP — 4 stats, #f5f5f5, hairline dividers
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-[#f5f5f5] border-b border-[#e5e5e5]">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12">
          <div className="grid grid-cols-2 md:grid-cols-4 md:divide-x divide-[#cacacb]">
            {[
              { val: '30초', label: '간편 모드 평균 생성 시간' },
              { val: '4K', label: 'Nano Banana 2 최대 해상도' },
              { val: '9개', label: 'AI 에이전트 동시 협업' },
              { val: '무료', label: `가입 시 ${FREE_INITIAL_CREDITS}크레딧 · 카드 없이 시작` },
            ].map((stat) => (
              <div key={stat.label} className="py-8 px-4 md:px-8 text-center">
                <p
                  className="font-black text-[#111111] mb-1 leading-none"
                  style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', letterSpacing: 0 }}
                >
                  {stat.val}
                </p>
                <p className="text-[12px] font-medium text-[#707072]">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          PROBLEM SECTION — 공감 획득
          컨테이너: 0px radius, hairline border
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="py-16 md:py-24 px-6 md:px-12 bg-white">
        <div className="max-w-[1440px] mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 xl:gap-20 items-start">

            {/* 문제 */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9e9ea0] mb-4">
                문제
              </p>
              <h2
                className="font-black mb-6"
                style={{ fontSize: 'clamp(28px, 3.5vw, 48px)', lineHeight: 1.1 }}
              >
                상품 하나 등록하는 데<br />
                <span className="italic text-[#707072]">몇 시간씩 쓰고 계신가요?</span>
              </h2>
              <p className="text-[15px] text-[#707072] leading-relaxed mb-8">
                판매 채널마다 최적화된 상품명, 키워드, 상세설명을 따로 써야 하고,
                이미지는 채널 규격에 맞게 각각 편집해야 합니다.
                상품 10개만 등록해도 하루가 사라집니다.
              </p>

              {/* Before — 0px radius */}
              <div
                className="p-6"
                style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9e9ea0] mb-5">
                  기존 방식 — 상품 1개 등록
                </p>
                <div className="space-y-3">
                  {[
                    { time: '20분', task: '상품명 · 카테고리 리서치' },
                    { time: '30분', task: '상세설명 직접 작성' },
                    { time: '15분', task: '이미지 편집 (규격 맞추기)' },
                    { time: '20분', task: '키워드 최적화 · SEO 수정' },
                    { time: '15분', task: '각 채널 형식에 맞게 재작성' },
                  ].map((item) => (
                    <div key={item.task} className="flex items-center gap-3">
                      <span
                        className="text-[12px] font-semibold px-2.5 py-1 min-w-[52px] text-center flex-shrink-0"
                        style={{ backgroundColor: '#e5e5e5', color: '#707072' }}
                      >
                        {item.time}
                      </span>
                      <span className="text-[13px] text-[#4b4b4d]">{item.task}</span>
                    </div>
                  ))}
                  <div
                    className="flex items-center gap-3 pt-3"
                    style={{ borderTop: '1px solid #cacacb' }}
                  >
                    <span
                      className="text-[12px] font-bold px-2.5 py-1 min-w-[52px] text-center flex-shrink-0 bg-[#111111] text-white"
                    >
                      100분
                    </span>
                    <span className="text-[13px] font-bold text-[#111111]">총 소요 시간</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 해결책 */}
            <div className="lg:pt-[104px]">
              {/* After — 0px radius, dark */}
              <div className="p-6 bg-[#111111]">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9e9ea0] mb-5">
                  ProductCraft AI — 상품 1개 등록
                </p>
                <div className="space-y-3">
                  {[
                    { time: '5초', task: '사진 업로드' },
                    { time: '25초', task: '상품명 3종 + 홍보문구 + 상세설명 생성' },
                    { time: '30초', task: '4K 썸네일 4개 비율 자동 생성' },
                    { time: '즉시', task: '스마트스토어 · 쿠팡 포맷 적용' },
                    { time: '즉시', task: 'SMS · 카카오 공유' },
                  ].map((item) => (
                    <div key={item.task} className="flex items-center gap-3">
                      <span
                        className="text-[12px] font-semibold px-2.5 py-1 min-w-[52px] text-center flex-shrink-0"
                        style={{ backgroundColor: '#2a2a2a', color: '#9e9ea0' }}
                      >
                        {item.time}
                      </span>
                      <span className="text-[13px] text-[#cacacb]">{item.task}</span>
                      <Check className="w-3.5 h-3.5 ml-auto flex-shrink-0 text-[#27c93f]" strokeWidth={2.5} />
                    </div>
                  ))}
                  <div
                    className="flex items-center gap-3 pt-3"
                    style={{ borderTop: '1px solid #2a2a2a' }}
                  >
                    <span className="text-[12px] font-bold px-2.5 py-1 min-w-[52px] text-center flex-shrink-0 bg-white text-[#111111]">
                      1분
                    </span>
                    <span className="text-[13px] font-bold text-white">총 소요 시간</span>
                    <span
                      className="ml-auto text-[11px] font-bold px-2.5 py-1 flex-shrink-0"
                      style={{ backgroundColor: '#27c93f', color: '#111111' }}
                    >
                      99% 단축
                    </span>
                  </div>
                </div>
              </div>

              <p className="mt-6 text-[14px] text-[#707072] leading-relaxed">
                하루 10개 상품을 등록한다면? 기존 <strong className="text-[#111111]">16시간</strong>이
                걸리던 작업이 이제 <strong className="text-[#111111]">10분</strong>으로 줄어듭니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          HOW IT WORKS — #f5f5f5, 3 steps
          대형 step number: Bebas Neue, display-campaign tier
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        id="how"
        className="py-16 md:py-24 px-6 md:px-12 bg-[#f5f5f5]"
        style={{ borderTop: '1px solid #e5e5e5', borderBottom: '1px solid #e5e5e5' }}
      >
        <div className="max-w-[1440px] mx-auto">
          <div className="mb-12 md:mb-16">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9e9ea0] mb-4">
              작동 방식
            </p>
            <h2
              className="font-black text-[#111111]"
              style={{ fontSize: 'clamp(28px, 3.5vw, 48px)', lineHeight: 1.1 }}
            >
              단 3단계로 끝납니다
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-0 md:divide-x divide-[#cacacb]">
            {STEPS.map((step) => (
              <div key={step.num} className="md:px-10 first:pl-0 last:pr-0 pb-10 md:pb-0">
                {/* 대형 step number — display-campaign */}
                <p
                  className="font-black mb-5 select-none leading-none"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '96px',
                    color: '#cacacb',
                    lineHeight: 0.9,
                    letterSpacing: 0,
                  }}
                >
                  {step.num}
                </p>
                <div className="flex items-center gap-2.5 mb-3">
                  <h3 className="text-[18px] font-black text-[#111111]">{step.title}</h3>
                  <span className="text-[11px] font-bold px-2.5 py-1 bg-[#111111] text-white flex-shrink-0">
                    {step.tag}
                  </span>
                </div>
                <p className="text-[14px] text-[#707072] leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 pt-10 border-t border-[#cacacb]">
            <Link
              href="/auth/signup"
              className="h-12 px-8 rounded-full bg-[#111111] text-white text-[14px] font-semibold inline-flex items-center gap-2 hover:bg-[#333] transition-colors"
            >
              지금 무료로 시작하기 <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          FEATURES — TWO MODES
          0px radius on mode cards
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="features" className="py-16 md:py-24 px-6 md:px-12 bg-white">
        <div className="max-w-[1440px] mx-auto">
          <div className="mb-12 md:mb-16">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9e9ea0] mb-4">
              두 가지 모드
            </p>
            <h2
              className="font-black"
              style={{ fontSize: 'clamp(28px, 3.5vw, 48px)', lineHeight: 1.1 }}
            >
              목적에 맞게 선택하세요
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-0 border border-[#e5e5e5]">
            {/* 간편 모드 — light */}
            <div
              className="p-8 md:p-10"
              style={{ borderRight: '1px solid #e5e5e5', backgroundColor: '#f5f5f5' }}
            >
              <div className="flex items-start justify-between mb-8">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-[#111111]" strokeWidth={2.5} />
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9e9ea0]">
                      Quick Mode
                    </p>
                  </div>
                  <h3 className="text-[22px] font-black text-[#111111]">간편 모드</h3>
                </div>
                <span className="text-[11px] font-bold px-3 py-1.5 bg-[#111111] text-white flex-shrink-0">
                  15~30초
                </span>
              </div>
              <p className="text-[14px] text-[#707072] leading-relaxed mb-8">
                빠른 텍스트 콘텐츠가 필요할 때. 사진 하나로 트렌드 키워드가
                반영된 상품명과 상세설명을 즉시 생성합니다.
              </p>
              <ul className="space-y-3 mb-10">
                {[
                  '트렌드 반영 상품명 3종 제안',
                  '35자 이내 한줄 홍보문구',
                  '400~600자 SEO 최적화 상세설명',
                  '스마트스토어 · 쿠팡 형식 자동 적용',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#111111]" strokeWidth={2.5} />
                    <span className="text-[14px] font-medium text-[#111111]">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/signup"
                className="h-12 px-8 rounded-full bg-[#111111] text-white text-[14px] font-semibold inline-flex items-center gap-2 hover:bg-[#333] transition-colors"
              >
                간편 모드 시작
              </Link>
            </div>

            {/* 스튜디오 모드 — dark */}
            <div className="p-8 md:p-10 bg-[#111111]">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Wand2 className="w-4 h-4 text-white" strokeWidth={2.5} />
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9e9ea0]">
                      Studio Mode
                    </p>
                  </div>
                  <h3 className="text-[22px] font-black text-white">스튜디오 모드</h3>
                </div>
                <span className="text-[11px] font-bold px-3 py-1.5 bg-white text-[#111111] flex-shrink-0">
                  Pro+
                </span>
              </div>

              {/* Nano Banana 2 배지 */}
              <div
                className="inline-flex items-center gap-2 px-3 py-2 mb-8"
                style={{ backgroundColor: '#1c1c1c', border: '1px solid #2a2a2a' }}
              >
                <span className="text-[13px]">🍌</span>
                <p className="text-[11px] font-semibold text-[#9e9ea0]">
                  Powered by Nano Banana 2
                </p>
              </div>

              <p className="text-[14px] text-[#9e9ea0] leading-relaxed mb-8">
                텍스트 콘텐츠에 4K 썸네일과 HTML 상세페이지까지.
                브랜드 완성도를 높이는 모든 것을 한 번에.
              </p>
              <ul className="space-y-3 mb-10">
                {[
                  '1:1 · 4:5 · 9:16 · 16:9 다중 비율 썸네일',
                  '2K ~ 4K 네이티브 고해상도',
                  '원본 이미지 Subject Consistency 유지',
                  '상세페이지 HTML 자동 조립',
                  'SMS + 카카오톡 즉시 공유',
                  'Google SynthID 워터마크 포함',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-white" strokeWidth={2.5} />
                    <span className="text-[14px] font-medium text-white">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/signup"
                className="h-12 px-8 rounded-full bg-white text-[#111111] text-[14px] font-semibold inline-flex items-center gap-2 hover:bg-[#f5f5f5] transition-colors"
              >
                스튜디오 시작 <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          NANO BANANA 2 — editorial dark campaign tile
          display-campaign: Bebas Neue, 0.9 line-height
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        className="py-16 md:py-24 px-6 md:px-12 bg-[#111111]"
        style={{ borderTop: '1px solid #1c1c1c' }}
      >
        <div className="max-w-[1440px] mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 xl:gap-20 items-center">

            {/* 텍스트 */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9e9ea0] mb-5">
                AI 썸네일 생성
              </p>
              {/* display-campaign headline */}
              <h2
                className="text-white uppercase mb-3 select-none"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(52px, 7vw, 96px)',
                  lineHeight: 0.9,
                  letterSpacing: 0,
                }}
              >
                NANO BANANA 2.
              </h2>
              <p
                className="font-black text-white mb-8"
                style={{ fontSize: 'clamp(22px, 2.8vw, 36px)', lineHeight: 1.15 }}
              >
                단순한 이미지가 아닙니다.
                <span className="italic text-[#9e9ea0]"> 브랜드입니다.</span>
              </p>
              <p className="text-[15px] text-[#9e9ea0] leading-relaxed mb-8">
                Google Gemini 기반의 Nano Banana 2가 상품 사진의 피사체 일관성을 유지하면서
                인스타그램 피드, 스토리, 유튜브 배너, 모바일 쇼핑몰에 최적화된
                4가지 비율의 4K 썸네일을 동시에 생성합니다.
              </p>

              {/* 비율 그리드 — 0px radius */}
              <div className="grid grid-cols-2 gap-3 mb-8">
                {[
                  { ratio: '1:1', use: '인스타그램 피드', size: '최대 4K' },
                  { ratio: '4:5', use: '인스타 세로형', size: '최대 4K' },
                  { ratio: '9:16', use: '스토리 · 릴스', size: '최대 4K' },
                  { ratio: '16:9', use: '유튜브 · 배너', size: '최대 4K' },
                ].map((item) => (
                  <div
                    key={item.ratio}
                    className="p-4"
                    style={{ backgroundColor: '#1c1c1c', border: '1px solid #2a2a2a' }}
                  >
                    <p
                      className="font-black text-white mb-1"
                      style={{ fontFamily: 'var(--font-display)', fontSize: '28px', lineHeight: 1 }}
                    >
                      {item.ratio}
                    </p>
                    <p className="text-[12px] text-[#707072]">{item.use}</p>
                    <p className="text-[10px] font-semibold text-[#4b4b4d] mt-0.5">{item.size}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[#4b4b4d]">
                * 생성된 이미지에는 Google SynthID 워터마크가 포함됩니다.
              </p>
            </div>

            {/* 썸네일 그리드 미리보기 — 0px radius */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { ratio: '1/1', label: '1:1', use: '인스타그램 피드' },
                { ratio: '4/5', label: '4:5', use: '인스타 세로형' },
                { ratio: '9/16', label: '9:16', use: '스토리' },
                { ratio: '16/9', label: '16:9', use: '배너' },
              ].map((item) => (
                <div key={item.label}>
                  <div
                    className="w-full flex items-center justify-center"
                    style={{
                      aspectRatio: item.ratio,
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #2a2a2a',
                    }}
                  >
                    <div className="text-center">
                      <p
                        className="font-black"
                        style={{ fontFamily: 'var(--font-display)', fontSize: '28px', color: '#2a2a2a', lineHeight: 1 }}
                      >
                        {item.label}
                      </p>
                      <p className="text-[9px] mt-0.5 text-[#1e1e1e]">AI 생성</p>
                    </div>
                  </div>
                  <p className="text-[11px] font-semibold mt-1.5 text-[#707072]">{item.use}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          PRICING — #f5f5f5
          product-card: 0px radius · featured: 2px solid #111111
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        id="pricing"
        className="py-16 md:py-24 px-6 md:px-12 bg-[#f5f5f5]"
        style={{ borderTop: '1px solid #e5e5e5', borderBottom: '1px solid #e5e5e5' }}
      >
        <div className="max-w-[1440px] mx-auto">
          <div className="mb-12 md:mb-16">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9e9ea0] mb-4">
              요금제
            </p>
            <h2
              className="font-black"
              style={{ fontSize: 'clamp(28px, 3.5vw, 48px)', lineHeight: 1.1 }}
            >
              투명한 가격 정책
            </h2>
            <p className="mt-3 text-[15px] text-[#707072]">
              숨겨진 비용 없음 · 월간 구독 · 언제든 해지 가능
            </p>
          </div>

          {/* 4-up plan cards — 0px radius */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-0 border border-[#e5e5e5]">
            {PLANS.map((plan, idx) => (
              <div
                key={plan.id}
                className="relative flex flex-col bg-white p-7"
                style={{
                  borderRight: idx < PLANS.length - 1 ? '1px solid #e5e5e5' : undefined,
                  borderTop: plan.highlight ? '3px solid #111111' : '3px solid transparent',
                }}
              >
                {'badge' in plan && plan.badge && (
                  <span
                    className="absolute top-4 right-5 text-[10px] font-bold px-2.5 py-1 bg-[#111111] text-white"
                  >
                    {plan.badge}
                  </span>
                )}

                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9e9ea0] mb-4">
                  {plan.name}
                </p>
                <div className="flex items-end gap-1 mb-1">
                  <span
                    className="font-black text-[#111111] leading-none"
                    style={{ fontSize: 'clamp(22px, 2.5vw, 30px)' }}
                  >
                    {plan.price}
                  </span>
                  <span className="text-[12px] text-[#9e9ea0] mb-0.5">{plan.sub}</span>
                </div>
                <p className="text-[12px] text-[#9e9ea0] mb-6">
                  월 {plan.credits.toLocaleString()}크레딧
                </p>

                <ul className="space-y-2.5 flex-1 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[#9e9ea0]" strokeWidth={2.5} />
                      <span className="text-[13px] font-medium text-[#4b4b4d]">{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.href}
                  className="h-11 px-6 rounded-full text-[13px] font-semibold inline-flex items-center justify-center transition-colors"
                  style={
                    plan.highlight
                      ? { backgroundColor: '#111111', color: '#ffffff' }
                      : { border: '1px solid #cacacb', color: '#111111', backgroundColor: '#ffffff' }
                  }
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-[12px] text-[#9e9ea0]">
            플랜 없이 크레딧만 충전도 가능합니다 —{' '}
            <Link href="/billing#topup" className="underline text-[#707072] hover:text-[#111111] transition-colors">
              소액 크레딧 구매 →
            </Link>
          </p>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          FINAL CTA — dark editorial block
          display-campaign headline
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 md:py-28 px-6 md:px-12 bg-[#111111]">
        <div className="max-w-[1440px] mx-auto text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9e9ea0] mb-6">
            지금 시작하세요
          </p>
          {/* display-campaign */}
          <h2
            className="text-white uppercase mb-5 select-none"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(48px, 7.5vw, 112px)',
              lineHeight: 0.9,
              letterSpacing: 0,
            }}
          >
            상품 등록의<br className="hidden md:block" /> 새 기준.
          </h2>
          <p className="text-[15px] font-medium text-[#9e9ea0] mb-10 max-w-md mx-auto leading-relaxed">
            카드 등록 없이 가입 시 {FREE_INITIAL_CREDITS}크레딧 무료 제공.
            지금 바로 사진 한 장으로 시작해보세요.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/auth/signup"
              className="h-12 px-10 rounded-full bg-white text-[#111111] text-[14px] font-semibold inline-flex items-center gap-2 hover:bg-[#f5f5f5] transition-colors"
            >
              무료로 시작하기 <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/auth/login"
              className="h-12 px-10 rounded-full text-white text-[14px] font-medium inline-flex items-center transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.18)' }}
            >
              로그인
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          FOOTER — 4 columns, white, hairline top divider
      ══════════════════════════════════════════════════════════════════════ */}
      <footer
        className="px-6 md:px-12 pt-14 pb-8 bg-white"
        style={{ borderTop: '1px solid #e5e5e5' }}
      >
        <div className="max-w-[1440px] mx-auto">
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-8 pb-10"
            style={{ borderBottom: '1px solid #e5e5e5' }}
          >
            {/* 브랜드 */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-full bg-[#111111] flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[10px] font-black">PC</span>
                </div>
                <span className="text-[14px] font-bold text-[#111111]">ProductCraft AI</span>
              </div>
              <p className="text-[12px] text-[#9e9ea0] leading-relaxed max-w-[200px]">
                사진 한 장으로 팔리는 상품 콘텐츠를.
                AI가 트렌드를 분석해 상품명·홍보문구·썸네일을 자동 생성합니다.
              </p>
            </div>

            {/* 서비스 */}
            <div>
              <p className="text-[12px] font-bold uppercase tracking-widest text-[#111111] mb-5">서비스</p>
              <div className="space-y-3">
                {[
                  ['/studio', '스튜디오'],
                  ['/#features', '기능 소개'],
                  ['/#pricing', '요금제'],
                  ['/billing#topup', '크레딧 충전'],
                ].map(([href, label]) => (
                  <Link
                    key={href}
                    href={href}
                    className="block text-[13px] text-[#9e9ea0] hover:text-[#111111] transition-colors"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>

            {/* 계정 */}
            <div>
              <p className="text-[12px] font-bold uppercase tracking-widest text-[#111111] mb-5">계정</p>
              <div className="space-y-3">
                {[
                  ['/auth/signup', '무료 회원가입'],
                  ['/auth/login', '로그인'],
                  ['/history', '생성 내역'],
                  ['/billing', '플랜 관리'],
                ].map(([href, label]) => (
                  <Link
                    key={href}
                    href={href}
                    className="block text-[13px] text-[#9e9ea0] hover:text-[#111111] transition-colors"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>

            {/* 법적 고지 */}
            <div>
              <p className="text-[12px] font-bold uppercase tracking-widest text-[#111111] mb-5">법적 고지</p>
              <div className="space-y-3">
                {[
                  ['/terms', '이용약관'],
                  ['/privacy', '개인정보처리방침'],
                ].map(([href, label]) => (
                  <Link
                    key={href}
                    href={href}
                    className="block text-[13px] text-[#9e9ea0] hover:text-[#111111] transition-colors"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <p className="text-[11px] text-[#9e9ea0]">
              © 2026 ProductCraft AI. All rights reserved.
            </p>
            <p className="text-[11px] text-[#9e9ea0] md:text-right max-w-sm">
              AI 생성 이미지에는 Google SynthID 워터마크가 포함됩니다.
              본 서비스의 일부 콘텐츠는 AI가 자동 생성합니다.
            </p>
          </div>
        </div>
      </footer>

    </div>
  )
}
