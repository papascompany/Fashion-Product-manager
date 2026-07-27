# 다음 세션 시작 프롬프트 (2026-07-17 갱신 · 상세페이지 Phase 2 완료 + P0 장애 발견 시점)

> 새 세션 첫 메시지로 "docs/NEXT_SESSION_PROMPT.md 읽고 이어서 진행" 이라고 지시하세요.

> 🚨 **P0 — Supabase 백엔드 전면 불능 (2026-07-17 발견, 오너 조치 대기)**
> Vercel preview/production env 의 `NEXT_PUBLIC_SUPABASE_URL` = `https://jspajtwnxnuvutekbhii.supabase.co` 가 **NXDOMAIN**
> (로컬 dig·8.8.8.8·1.1.1.1·Cloudflare DoH Status 3 전부 동일) → 프로젝트 일시정지(무료 티어 pause) 또는 삭제.
> **prod·preview 의 로그인/DB/생성 API 전부 런타임 불능** — 지금까지의 "preview READY" 는 컴파일 검증일 뿐.
> 복구 경로 (오너):
> ① 일시정지면 해당 Supabase 계정 대시보드에서 **Restore** (데이터 보존, 가장 빠름).
> ② 삭제면 신규 프로젝트 생성 → 마이그레이션 001~012 재적용 → Storage 버킷(`product-images`, `ai-fittings`) 재생성
>    → Vercel env 교체(`NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`) → 재배포. (지시가 있으면 에이전트가 대부분 수행 가능)
> 매 세션 시작 시 `dig +short jspajtwnxnuvutekbhii.supabase.co @1.1.1.1` 로 복구 여부부터 확인할 것.

---

프로젝트: **ProductCraft AI** — 한국 패션 이커머스 SaaS (사진 1장 → 상품명·카피·상세페이지·썸네일·AI피팅 자동 생성).

## 0. 세션 시작 프로토콜 (순서 고정)
1. **정본 경로에서 작업**: `/Users/yohan/Developer/claude/Fashion Product Manager/productcraft-ai` — ⚠️ `Documents/claude/...` 는 동기화된 중복본. **반드시 Developer/ 경로 사용.**
2. 이 파일 + `docs/DETAIL_PAGE_ENGINE_PRD.md` 를 먼저 읽어 상태 파악.
3. `CLAUDE.md`(→`AGENTS.md`): **Next.js 16 은 학습데이터와 다름** — Next 특정 코드 전 `node_modules/next/dist/docs/01-app/` 확인.
4. `git branch -a && git log --oneline -6 && git status` 확인. 내가 만들지 않은 변경은 보존.
5. 위 P0 배너의 dig 체크로 Supabase 복구 여부 확인.

## 1. 레포·배포·검증 환경 (필수 사실 — 2026-07-17 재검증)
- 레포: **`github.com/papascompany/Fashion-Product-manager`**. **git push → Vercel 자동 배포 정상.**
- Vercel: project `prj_yckqBCyzuikioKvgHzJn1lMHWSwH`, team `team_dOpgsAqfLyl4qNlVgSiFVm6B`(slug `yohans-projects-de3234df`), prod alias `productcraft-ai.vercel.app`.
- 스택: Next.js **16.2.9**(App Router, Turbopack) · React 19.2 · Vercel AI SDK v6 · Supabase · pnpm v10.33. AI: Claude(주)+Gemini. 이미지: Nano Banana 2 (`gemini-3.1-flash-image-preview`).
- ⚠️ **로컬 node_modules 미설치 → 검증은 Vercel preview 빌드로**: 브랜치 push → Vercel MCP `list_deployments` 로 READY/ERROR 확인(ERROR면 `get_deployment_build_logs`). 의존성 추가 시 `pnpm install --lockfile-only` 후 lockfile 커밋(CI=--frozen-lockfile).
- ✅ **Vercel CLI 재인증 완료**(2026-07-17 확인: `vercel whoami`=papas-yohan). `vercel env pull` 사용 가능 — 스크래치 디렉터리에 `.vercel/project.json`(위 orgId/projectId) 만들고 pull. **받은 env 파일은 사용 후 즉시 삭제.**
- ⚠️ **레포의 `.env.local` 은 ProductCraft 가 아님** — `aigvfqplnlzcyvacnien` 은 다른 앱(북에디터류) DB. 실제 값은 Vercel env 가 정본.
- ⚠️ **연결된 Supabase MCP 조직에 ProductCraft 프로젝트 없음**(mystory/storige/bookmoa 만) → SQL/restore 는 MCP 불가, Admin API(서비스 키) 또는 오너 대시보드로.
- ⚠️ **Supabase CLI 미연동** → 마이그레이션은 콘솔 SQL Editor 수동 적용.
- Preview 는 **Vercel Deployment Protection** 활성 — 접근은 Vercel MCP `get_access_to_vercel_url` 로 `_vercel_share` 링크 발급 → 쿠키 교환(`_vercel_jwt`).
- fashion-curation 톤 단일진실 2곳: `.claude/skills/fashion-curation-copy/SKILL.md` + `src/lib/prompts/fashion-curation-style.ts`.
- 커밋 트레일러: 현재 활성 모델 기준(최근: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`). 커밋/푸시는 요청 시에만(단, preview 빌드 검증 목적 push 는 이 문서가 정의한 절차로 허용).

## 2. 브랜치 3개 (모두 main 미머지)
- **`main` = `621a9cf`** — 현 prod 베이스라인 (런타임은 P0 로 불능).
- **`audit-immediate-thisweek` = `2f1157f`** — 감사 86 finding 조치 + pre-merge fix(013 RLS 가드·webhook 멱등성/부분취소). preview READY. 🚧 머지 전제: **마이그레이션 013→016 을 prod DB 에 순서 적용**(Supabase 복구 후에만 가능) → 013 회귀검증(quick 생성 → credits_left 감소) + webhook smoke → merge. 절차: 그 브랜치의 `docs/MIGRATION_GUIDE_013_014_015.md`, `docs/PREMERGE_REVIEW_FIXES.md`.
- **`feat/detail-page-engine` = `ffecc25`** ← **현재 작업 브랜치**. 상세페이지 엔진 PRD+목업+Phase1+Phase2. preview READY. 감사와 독립.

## 3. 완료된 내역 — 상세페이지 생성 엔진 (feat/detail-page-engine)
목표: **1페이지 버티컬 상세페이지를 디자이너급 퀄리티로 자동 생성**. 설계 정본: `docs/DETAIL_PAGE_ENGINE_PRD.md`. 목업: `docs/mockups/detail-page-*.html`.

**오너 확정 지시(2026-07-11) — 항상 준수**: ① Pretendard = 전 테마 디폴트(세리프는 액센트) ② 래스터화 = 고객 opt-in ③ **생성 상세페이지에 가격·구매 CTA 미포함**(closing 은 마감 문구만).

**Phase 1 (033898b)**:
- `src/lib/detail-page/themes.ts` — 3테마 토큰(editorial-minimal/soft-luxury-serif/clean-conversion) + `buildThemeStyle`(Pretendard @font-face).
- `DetailSection` 17 variant(신규 9종: gallery/feature-split/material/lookbook/size-spec/trust/benefit-banner/legal/closing) + `shotSlot` 4종 + `themeId` — `src/store/studio.ts`·`src/lib/ai/types.ts`.
- `src/app/api/generate/detail-page/route.ts` — 테마-어웨어 860px 조립기(커머스 렌더 금지, escapeHtml/isSafeUrl, exhaustive 가드).
- `src/lib/detail-page/rasterize.ts` — opt-in 클라이언트 래스터화(html-to-image→섹션경계 슬라이스→JSZip) + `PLATFORM_PRESETS`(스마트스토어/쿠팡/G마켓/위메프).
- `src/lib/prompts/detail-page-plan.ts` — 에디토리얼 5단계 서사 + shotSlot 배정.

**Phase 2 (7153625)**:
- `src/lib/ai/image/prompt-builder.ts` — **ShotPreset 6종**(flat-lay/hanger/ghost-mannequin/detail-macro/hero-object/lifestyle) + 텍스트 세이프 존(상15%·하20%, 이미지 내 텍스트 전면 금지) + `buildConsistencyBlock`(동일 상품·중립 화이트밸런스 앵커) + 프리셋 네거티브.
- **lock seed**: `ImageGenParams.seed` → Gemini `generationConfig.seed`(best-effort). thumbnail/ai-fitting 라우트 `lockSeed` 파라미터, store `ensureShotLockSeed()`(프로젝트당 1회 생성·재사용).
- **AI Fitting 모델 프로필 락**: `shotVariant`(front/side/back/lifestyle) + `lockSeed` 전달 시 모델락 가드레일(얼굴·체형·톤 고정, 극단 조명/앵글 금지) 자동 활성 — `src/lib/prompts/image/ai-fitting.ts`.
- `src/lib/detail-page/shot-plan.ts` — 빈 촬영 슬롯 추출(`extractShotJobs`, 예산 9컷) · 엔진/프리셋/비율 매핑(productShot→썸네일+프리셋 순환, detailShot→detail-macro, fitShot→피팅 전/측/후 순환, lifestyle→모델 유무 분기) · `applyShotResult` write-back · `estimateShotCredits`.
- `src/components/detail-page-editor/shot-panel.tsx` — "AI 컷 일괄 생성" 패널(3건 동시 배치 + 배치 간 순차, 작업별 진행 칩). **기존 thumbnail/ai-fitting 엔드포인트만 사용 — 신규 크레딧/결제 코드 없음.**
- 섹션 `url` 확장: feature-split/material 셀/lookbook look — store·LLM zod·라우트 zod 미러·조립 렌더러·편집기 5곳 verbatim 동기.
- **래스터화 서버 승격**: `render-service/`(VPS Playwright 마이크로서비스 — 섹션경계 슬라이스 ZIP, 2x 슈퍼샘플, Bearer 토큰, Dockerfile+배포 README) + `/api/render/detail-page` 프록시(`DETAIL_RENDER_URL`/`DETAIL_RENDER_TOKEN` env.ts 중앙화, 미구성 시 501 → 편집기가 클라이언트 래스터화 자동 폴백).

**검증 상태**: 두 Phase 모두 Vercel preview 빌드 READY(컴파일·타입·번들). **런타임 E2E 는 0회 — P0 로 차단됨.**

**E2E 스모크 준비물(검증 완료, 복구 즉시 실행 가능)**:
- Preview 접근: Vercel MCP `get_access_to_vercel_url` → `_vercel_share` → `_vercel_jwt` 쿠키.
- 세션: 비밀번호 미사용 — Supabase Admin API `generate_link`(magiclink) → `verify`(token_hash) → access/refresh 토큰 → `sb-<ref>-auth-token` 쿠키(base64-JSON) 구성. (에이전트는 비밀번호 입력·계정 생성 불가 원칙)
- 시나리오 4단계: ① thumbnail(`shotPreset`+`lockSeed`) ② ai-fitting(`shotVariant`+`lockSeed`) ③ detail-page(url 채운 섹션 → `<img>` 렌더 확인) ④ render 프록시(501 → 클라이언트 폴백 확인).

## 4. 예정 내역 (우선순위 순)
1. 🚨 **Supabase 복구** (오너) — 위 P0 배너. 이것 없이는 2·3 진행 불가.
2. **E2E 런타임 스모크** — 위 준비물로 즉시 실행. 통과 기준: 컷 생성→슬롯 채움→미리보기 이미지 렌더→크레딧 차감 확인.
3. **감사 브랜치 머지** — 마이그레이션 013→016 적용 → 회귀검증 → webhook smoke → main merge.
4. **`feat/detail-page-engine` → main 머지** — E2E 통과 후. 감사 브랜치와 머지 순서 조정(감사 먼저 권장 — 결제/RLS 수정 포함).
5. **오너 결정 3건** — ① 크레딧 번들 단가(현행 컷당 2~3크레딧 → 9컷 ≈ 24크레딧, 확정 시 `shot-plan.ts estimateShotCredits`+서버 가드 갱신) ② 세리프 라이선스(OFL Fraunces/Noto Serif KR vs 상용; 현재 system fallback) ③ 쿠팡 대표컷(1000×1000) 파이프·설명컷 기본값·테마 출시 우선순위·AI 고지 법무.
6. **render-service VPS 실배포** (오너 또는 SSH 지시) — `render-service/README.md`: docker build/run(RENDER_TOKEN) → Vercel env 2개 등록. 미배포여도 클라이언트 폴백으로 무해.
7. **Phase 2 심화** — 상품 마스터 레퍼런스 **세트**(정면+디테일+컬러칩 자동 파생, 현재는 원본 1장만 동봉), A컷 자동선별·카피↔이미지 페어링.
8. **편집기 개선** — material 셀 인라인 편집(현 read-only), 미리보기 iframe sandbox 강화.
9. **Phase 3 백로그** — 공유 웹뷰 스크롤 리빌·키네틱 헤드라인, 컷 QC 대시보드(상품 보존율/컬러 매칭), 3D 프리뷰.

## 5. 오케스트레이션·작업 교훈
- 병렬 서브에이전트 ~12 동시 → rate/session limit. **3~4 동시 배치**, 배치 간 sequential. Workflow resume 는 캐시 재생.
- 파일 소유권 분리 + **정확한 공유 계약**(export 시그니처·필드명 verbatim) 명시 → 병렬 코드 함께 컴파일.
- 돈/RLS/인증 코드는 **머지 전 적대검증 리뷰 필수**. 컷 생성 신기능은 기존 크레딧 경로 재사용으로 리스크 회피(이번 Phase 2 방식).
- 마이그레이션 번호: 013~016 은 감사 브랜치 소유 — 새 마이그레이션은 **017부터** (충돌 방지).
- "빌드 READY" ≠ 런타임 정상 — 백엔드 의존 기능은 반드시 런타임 스모크까지. (이번 P0 를 놓친 원인)

마지막 커밋: `ffecc25` (feat/detail-page-engine, preview READY). Phase 2 본 커밋: `7153625`.
