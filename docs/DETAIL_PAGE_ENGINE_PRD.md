# 상세페이지 생성 엔진 — 설계/PRD (v0.1)

> "최적화된 문구"에서 → "디자이너급 프리미엄 버티컬 상세페이지 자동 생성"으로 승격.
> 6레인 웹 리서치(55+ 출처) → 디자인 브리프 합성 결과를 실행 스펙으로 정리한 문서.
> 목업: `docs/mockups/detail-page-editorial-minimal.html` (또는 Artifact 링크).

## 오너 확정 사항 (2026-07-11)

- **Pretendard Variable = 전 테마 기본 서체(디폴트).** 세리프 디스플레이(Fraunces/명조)는 테마별 선택 액센트일 뿐 강제 아님.
- **래스터화(긴 세로 이미지 내보내기)는 고객 opt-in.** 자동 실행 아님 — 편집기의 "이미지로 내보내기" 액션으로 필요 시에만. 기본 출력은 편집 가능한 HTML/미리보기.
- **생성 상세페이지에는 가격·구매 CTA를 넣지 않는다.** 가격·"구매하기" 버튼 등 커머스는 판매 플랫폼(스마트스토어/쿠팡/자사몰)의 몫. `cta-closing` 섹션은 기본적으로 커머스 요소 없이 에디토리얼 마감 문구만. (목업 3종도 이 원칙으로 정리됨.)

## 0. 핵심 통찰 (설계를 가르는 사실)

1. **상세페이지는 반응형 웹이 아니라, 다운스케일되는 고정폭 래스터 이미지다.** 스마트스토어에 올라가는 건 가로 **860px 고정폭** 이미지이고 모바일(~375px)에서 ~43%로 축소된다. → 캔버스 860px 고정, 내부 렌더 2x(1720px)로 그린 뒤 다운스케일, **본문 하한 26~30px @860**(모바일 13~15px 가독).
2. **레이아웃은 미니멀, 비주얼은 맥시멀** 이 프리미엄 공식. AI가 매번 조판하지 않고 **디자인 토큰 템플릿 고정 + 콘텐츠·사진만 채움** = Shopify OS2.0 sections/blocks JSON 아키텍처와 동형.
3. **한글은 절대 AI 이미지에 굽지 않는다.** AI 컷은 배경 비주얼만, 한글 타이포/CTA는 조립 HTML의 자체호스팅 `@font-face`로 오버레이(우리 CSP `font-src 'self'`와도 정합). 컷 프롬프트에 상·하단 "텍스트 세이프 존" 요구.
4. **서사 구조가 테마를 가른다.** 에디토리얼 5단계(오프닝→공감→브릿지→본문→결론) vs 컨버전 9단계(판매증거→신뢰→액션)는 별개 디자인 시스템 → 테마 분기.
5. **차별화 지점은 속도가 아니라(경쟁사 이미 30초~3분 자동생성 제공) "디자이너급 레이아웃 + 한글 HTML 타이포 품질 + 컷 간 상품 아이덴티티 일관성"이다.**

## 1. 디자인 시스템 — 3 프리미엄 테마 (CSS 토큰 스왑, 구조 불변)

| 테마 | 포지셔닝 | 서체(국/영) | 핵심 컬러 | 그리드 |
|---|---|---|---|---|
| **에디토리얼 미니멀** (기본) | 디자이너·프리미엄, 화보형. 무신사/29CM 톤. 큐레이터 카피와 정합 최고 | Pretendard Variable + 영문 디스플레이 세리프(Fraunces, OFL) | bg #F7F4EF · text #2A2621 · accent #7A5C43(mocha, 라벨만) · cta #1E1A16 | 폭860·세이프70·8px 베이스라인·섹션패딩96~120 |
| **소프트 럭셔리 세리프** | 페미닌·라이프스타일·주얼리/원피스. W컨셉 지향 | Noto Serif KR(헤드) + Pretendard(본문) | bg #FBF8F4 · accent #9DA98C(세이지) · cta #35302A | 벤토 2~4셀·radius16~20·패딩100~140 |
| **클린 컨버전** (스마트스토어형) | 매스 셀러·전환중심이되 프리미엄 | Pretendard 전 구간 | bg #FFF · benefit #FF4438(혜택배너) · cta #111114 · trust #2B6CB0 | 폭860/780·정보밀도·radius10·표/FAQ |

타입스케일(@860, 2x 내부렌더) 예: Display 72 / H1 52 / H2 38 / H3 26 / Body 27(lh1.75) / Eyebrow 20(ls .15em) / Caption 21.

## 2. 섹션 라이브러리 (13종, 판별 유니온 확장)

순서·목적·컷 슬롯 매핑:

| # | 섹션 | 컷 슬롯 | 목적 |
|---|---|---|---|
| 1 | hero-editorial | fitShot 또는 productShot | 3초 후킹. 풀블리드 배경 + HTML 오버레이 대형 타이틀 |
| 2 | benefit-banner | 없음(HTML) | 혜택/쿠폰(컨버전 테마 on, 에디토리얼 off) |
| 3 | intro-empathy | lifestyle(AI Fitting) | 공감 라이프스타일 컷 + 감정 이입 |
| 4 | index-bridge | 없음/소형 productShot | 핵심 3키워드 요약, 본문 예고 |
| 5 | product-gallery | productShot(flat-lay/hanger/ghost) | 다각도 형태·색 그리드 |
| 6 | feature-split | detailShot | 기능→이점 좌우 분할 |
| 7 | material-detail | detailShot(seam/texture) | 소재·봉제 벤토 매크로 |
| 8 | styling-lookbook | fitShot(전/측/후, 모델 락) | 착용·코디 제안 |
| 9 | size-spec | 없음(표)/사이즈 도식 | 측정치·혼용률·핏 |
| 10 | trust-stack | 없음(배지) | 리뷰·인증·A/S·배송 |
| 11 | brand-story | lifestyle/없음 | 브랜드 감성 |
| 12 | cta-closing | 없음/productShot 배경 | 결론 CTA 타이포 블록 |
| 13 | legal-footer | 없음 | 원산지·KC·소재·주의 + AI생성 고지 |

## 3. 컷 전략 (보유 엔진 재사용 + 설명컷 신설)

- **상품컷 = 썸네일 엔진**(`NanaBanana2Provider`/`prompt-builder.ts`) → `prompt-builder`에 flat-lay·hanger·ghost-mannequin 스타일 파라미터 추가.
- **연출컷 = AI Fitting**(`ai-fitting.ts`, product+model 멀티레퍼런스) → 전/측/후 2~3컷 세트.
- **설명컷 = 신설(디테일 매크로)** → (a) 원본 매크로 크롭, (b) Nano Banana 디테일 파생(weave/seam/button 컴포지션 프리셋).
- **컷 예산 6~9장**: 히어로1 + 착용2~3 + 디테일2~3 + 연출1~2. 상품:연출:설명 ≈ 2~3 : 3~4 : 2~3.
- **컷 간 상품 일관성**: ① 상품 마스터 레퍼런스 세트(정면+디테일+컬러칩 3~5장) 자동 파생 후 모든 하위 컷에 동봉 조건화(strength 0.75~0.85) ② 상품별 **lock seed** DB 저장 ③ 히어로컷 컬러를 화이트밸런스 기준값 ④ AI Fitting **모델 프로필 락**(얼굴+체형+톤 공유, 극단 조명/앵글 가드레일).

## 4. 플랫폼 Export 규격 (리서치 실수치)

- 마스터 캔버스 **860px** 고정, 2x 내부렌더 → 다운스케일. DPI 72~96. JPG q90+.

| 플랫폼 | 폭 | 세로 최대 | 용량/장 | 비고 |
|---|---|---|---|---|
| 스마트스토어 | 860 | 5,000px/장 | 20MB | 세로 무제한, 장당 ≤5,000px |
| 쿠팡 | 780(700~1000) | 3,000px 초과 분할 | 5~10MB | 대표컷 1000×1000 별도, 텍스트/합성 금지, 법적고지 강제 |
| G마켓/옥션 | 860 | 4,000px | 10MB | |
| 위메프 | 758 | 3,000px | 2MB | 강압축 |

- **세로 3,000px 초과 시 섹션 경계 분할**(통짜 리스크 회피). 투명배경(누끼/고스트)→PNG, 연출/라이프스타일→JPEG q80~85. GIF 금지. 대표컷 1:1 1000×1000 별도 아트보드(오버레이 금지 enforce).
- Export 프리셋 토큰: `{ platform, width, maxSliceHeight, maxBytes, format, quality }`.

## 5. 기술 아키텍처 (현 코드 확장, 리라이트 아님)

- **데이터 모델**: 상세페이지 = JSON `{ themeId, sections: [{ type, content, shotSlot }] }`. 템플릿이 레이아웃/토큰 소유, AI는 JSON만 채움.
- **조립기**: `assembleFromSections()`(detail-page/route.ts, 이미 860px·escapeHtml·safeLinkHref 방어 有)를 **테마-어웨어 프리미엄 조립기**로 리라이트(그라데이션 hero 제거, 토큰 구동).
- **폰트**: `public/fonts`에 Pretendard Variable + OFL 세리프(Fraunces/Noto Serif KR) woff2 자체호스팅, 인라인 `@font-face`.
- **래스터화 (Vercel 제약 고려)**:
  1. Satori/@vercel/og — **부적합**(flexbox 서브셋만, grid/벤토 깨짐, 가변폰트 취약).
  2. Headless Chromium(`@sparticuz/chromium`) — CSS 100% 충실하나 Vercel 용량(50/250MB)·maxDuration·콜드스타트 부담.
  3. **VPS Playwright `/render` 마이크로서비스 (권장 정본)** — 오너 소유 Vultr VPS의 "워커형 오프로드" 패턴과 정합. `{html,width,sliceHeight}` → 섹션경계 슬라이스 PNG/JPEG 배열. 결정론적·픽셀 정확.
  → **Phase 1은 클라이언트(`html-to-image`, zero-infra), Phase 2는 VPS로 승격.**
- **편집기**(`detail-page-editor` + `store/studio`): `DetailSection` 유니온에 신규 7종 추가 + 각 섹션 `shotSlot` 필드(엔진 라우팅 강제) + **themeSelector**(CSS custom property 스왑) + Export 패널(플랫폼 프리셋·슬라이스 미리보기·zip).

## 6. 단계별 빌드

- **Phase 1 (MVP, ~2~3주, zero-infra)**: 3테마 CSS 토큰 + 폰트 자체호스팅 + 테마-어웨어 조립기 리라이트 + `DetailSection`/`shotSlot` 확장 + 클라이언트 래스터화(html-to-image → 폭 리사이즈 → 3000px 슬라이스 → PNG/JPEG → zip) + `detail-page-plan.ts` 프롬프트를 에디토리얼 5단계 + shotSlot + 상황맥락 카피로 확장.
- **Phase 2 (~6~8주)**: VPS Playwright 렌더 승격 + 컷 일관성 엔진(마스터 레퍼런스·lock seed·모델 프로필 락) + `prompt-builder` 디테일/고스트/행거 프리셋 + A컷 자동선별·카피↔이미지 페어링 + 벤토/표/신뢰스택 컴포넌트 + themeSelector·shotSlot UI.
- **Phase 3 (백로그)**: 공유 웹뷰 스크롤 리빌/키네틱 헤드라인, 테마 변형, 컷 QC 대시보드(상품 보존율/컬러 매칭), 3D 프리뷰.

## 7. 오너 결정 필요

- 영문 디스플레이 세리프 라이선스: OFL 대안(Fraunces/Playfair) vs 상용(Neue Haas) 구매·반입(CSP상 CDN 불가).
- Phase 2 래스터화: VPS Playwright(권장) vs Vercel `@sparticuz/chromium`. Vercel 플랜/예산 확인.
- 쿠팡 대표컷(1000×1000, 텍스트/합성 금지) 별도 파이프 지원 범위.
- 설명컷 기본값: 원본 매크로 크롭 vs Nano Banana 디테일 파생 vs 둘 다.
- **크레딧 재산정**: 상세페이지 1건 = 6~9컷 + LLM 조립 → 기존 detail_page 2크레딧으론 부족. **번들 단가 정책 필요**.
- 테마 출시 우선순위: 3종 동시 vs 에디토리얼 미니멀 1종 검증 후 확장.
- 세로 export 기본값: 통짜 vs 섹션 분할(리서치는 분할 권고).
- AI생성물 고지(표시광고법)·SynthID 워터마크 상업사용 법무 확인.

## 부록 — 리서치 출처(발췌)

무신사 뉴스룸(UI·UX), 29CM 룩북 매뉴얼·콘텐츠 톤, 스마트스토어/쿠팡 규격(SellPage·기획공방·GENCY), imweb 이미지 규격, 미리캔버스/망고보드 템플릿, Shopify sections/blocks, Pretendard(orioncactus), KRDS 서체 가이드, 2026 타이포/컬러 트렌드(DesignMonks·Pantone SS2026), AI 컷 일관성(LaonGEN·멀티레퍼런스). 전체 55+ 출처는 리서치 워크플로 산출물 참조.
