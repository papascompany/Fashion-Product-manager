# 다음 세션 시작 프롬프트 (2026-07-13 갱신)

> 새 세션 첫 메시지로 이 파일 내용을 붙여넣거나 "docs/NEXT_SESSION_PROMPT.md 읽고 이어서 진행" 이라고 지시하세요.

---

프로젝트: **ProductCraft AI** — 한국 패션 이커머스 SaaS (사진 1장 → 상품명·카피·상세페이지·썸네일·AI피팅 자동 생성).

## 0. 세션 시작 프로토콜 (순서 고정)
1. **정본 경로에서 작업**: `/Users/yohan/Developer/claude/Fashion Product Manager/productcraft-ai` — ⚠️ `Documents/claude/...` 는 동기화된 중복본. **반드시 Developer/ 경로 사용.**
2. 이 파일 + `docs/DETAIL_PAGE_ENGINE_PRD.md` 를 먼저 읽어 상태 파악.
3. `CLAUDE.md`(→`AGENTS.md`): **Next.js 16 은 학습데이터와 다름** — Next 특정 코드 전 `node_modules/next/dist/docs/01-app/` 확인.
4. `git branch -a && git log --oneline -6 && git status` 확인. 내가 만들지 않은 변경은 보존.

## 1. 레포·배포·검증 환경 (필수 사실)
- 레포: **`github.com/papascompany/Fashion-Product-manager`** (main). 2026-06-19 papasyohan→papascompany 이전(Vercel 자동배포 복구). **git push → 자동 배포 정상.**
- Vercel: project `prj_yckqBCyzuikioKvgHzJn1lMHWSwH`, team `team_dOpgsAqfLyl4qNlVgSiFVm6B`(slug `yohans-projects-de3234df`), prod alias `productcraft-ai.vercel.app`.
- 스택: Next.js **16.2.9**(App Router, Turbopack) · React 19.2 · Vercel AI SDK v6 · Supabase · pnpm v10.33. AI: Claude(주)+Gemini. 이미지: Nano Banana 2.
- ⚠️ **로컬 node_modules 미설치 → tsc/eslint/build 로컬 실행 불가. 검증은 Vercel preview 빌드로**: 브랜치 push → Vercel MCP `list_deployments`(위 project/team id) 로 state READY/ERROR 확인(ERROR면 `get_deployment_build_logs`). 의존성 추가 시 `pnpm install --lockfile-only` 후 lockfile 커밋(CI=--frozen-lockfile).
- ⚠️ **Vercel CLI 토큰 만료**(whoami=Not authorized) → git push 로만 배포. Vercel MCP 간헐 403 → 재시도/대시보드.
- ⚠️ **Supabase CLI 미연동** → 마이그레이션은 콘솔 SQL Editor 수동 적용.
- ⚠️ Artifact/preview **스크린샷 도구 불안정**(공백·0-폭). 신뢰 렌더 확인은 로컬 `python3 -m http.server`(부모 폴더 `.claude/launch.json`) + `preview_eval` 를 데스크톱 폭에서.
- fashion-curation 톤 단일진실 2곳: `.claude/skills/fashion-curation-copy/SKILL.md` + `src/lib/prompts/fashion-curation-style.ts`.
- 커밋 트레일러: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. 커밋/푸시는 요청 시에만.

## 2. 브랜치 3개 (모두 main 미머지)
- **`main` = `621a9cf`** — 현 prod 베이스라인.
- **`audit-immediate-thisweek` = `2f1157f`** — 감사 86 finding 조치(critical 8 + 71) + pre-merge fix(BLOCKER: 013 RLS 가드 current_user 기준, webhook 멱등성/부분취소). preview READY. 🚧 **머지 전제: Supabase 마이그레이션 013→014→015→016 을 prod 에 순서대로 적용**(안 하면 결제·admin 500). 절차·이월: 그 브랜치의 `docs/MIGRATION_GUIDE_013_014_015.md`, `docs/PREMERGE_REVIEW_FIXES.md`. 적용 후 013 회귀검증(quick 생성 → credits_left 감소) + webhook smoke → merge.
- **`feat/detail-page-engine` = `7153625`** ← **현재 작업 브랜치**. 상세페이지 엔진 PRD+목업+Phase1+**Phase2(컷 오케스트레이션+렌더 승격)**. preview READY. 감사와 독립.

## 3. 현재 작업: 상세페이지 생성 엔진 (feat/detail-page-engine)
목표: 상품 특징 반영 **1페이지 버티컬 상세페이지를 디자이너급 퀄리티로 자동 생성**.
핵심 설계: 프리미엄 템플릿(토큰) + AI 콘텐츠 + AI 사진컷 + HTML 한글 타이포(AI 이미지에 한글 안 굽음). **860px 고정 캔버스**. 상세: `docs/DETAIL_PAGE_ENGINE_PRD.md`. 목업: `docs/mockups/detail-page-{editorial-minimal,soft-luxury-serif,clean-conversion}.html`.

**오너 확정 지시(2026-07-11) — 항상 준수**:
- Pretendard = 전 테마 기본 서체(디폴트). 세리프는 선택 액센트.
- 래스터화(긴 이미지 내보내기) = 고객 **opt-in**(자동 아님).
- **생성 상세페이지에 가격·구매 CTA 미포함**(커머스는 판매 플랫폼 몫). closing 섹션은 마감 문구만.

**Phase 1 완료(033898b)**:
- `src/lib/detail-page/themes.ts`(신규) — 3테마 토큰 + `buildThemeStyle`(Pretendard @font-face). `public/fonts/PretendardVariable.woff2` 존재.
- `src/store/studio.ts`·`src/lib/ai/types.ts` — `DetailSection` 신규 9종(gallery/feature-split/material/lookbook/size-spec/trust/benefit-banner/legal/closing) + `shotSlot`(productShot/fitShot/detailShot/lifestyle) + `themeId`. 총 17 variant.
- `src/app/api/generate/detail-page/route.ts` — 테마-어웨어 프리미엄 조립기 전면 리라이트(커머스 렌더 금지, escapeHtml/isSafeUrl, exhaustive never 가드).
- `src/lib/detail-page/rasterize.ts`(신규) — opt-in `exportDetailPageAsImages`(html-to-image→슬라이스→JSZip) + `PLATFORM_PRESETS`(스마트스토어 860/5000·쿠팡 780/3000·G마켓·위메프). deps: html-to-image, jszip.
- `src/components/detail-page-editor/index.tsx` — themeSelector + 신규섹션 렌더 + opt-in "이미지로 내보내기".
- `src/lib/prompts/detail-page-plan.ts` — 에디토리얼 5단계 + shotSlot 배정 + closing.

**Phase 2 완료(7153625, preview READY)**:
- `src/lib/ai/image/prompt-builder.ts` — ShotPreset 6종(flat-lay/hanger/ghost-mannequin/detail-macro/hero-object/lifestyle) + 텍스트 세이프 존 + `buildConsistencyBlock`(마스터 레퍼런스·화이트밸런스 앵커).
- lock seed: `ImageGenParams.seed` → Gemini `generationConfig.seed`. thumbnail/ai-fitting 라우트 `lockSeed`, store `ensureShotLockSeed()`(프로젝트당 1회).
- AI Fitting: `shotVariant`(front/side/back/lifestyle) + 모델 프로필 락 가드레일(`lockSeed` 전달 시 자동 활성).
- `src/lib/detail-page/shot-plan.ts`(신규) — 빈 슬롯 추출(예산 9컷)·엔진/프리셋/비율 매핑·`applyShotResult` write-back·크레딧 추정.
- `src/components/detail-page-editor/shot-panel.tsx`(신규) — "AI 컷 일괄 생성"(3건 동시 배치, 기존 thumbnail/ai-fitting 엔드포인트만 사용 — 신규 크레딧 경로 없음).
- 섹션 url 확장: feature-split/material 셀/lookbook look (store·LLM zod·라우트 zod·조립 렌더러·편집기 동기).
- `render-service/`(신규) — VPS Playwright ZIP 렌더 마이크로서비스(Dockerfile+배포 가이드) + `/api/render/detail-page` 프록시(`DETAIL_RENDER_URL/TOKEN`, 미구성 시 편집기 클라이언트 래스터화 자동 폴백).

**Phase 2 이후 follow-up**:
- 🚧 **render-service VPS 실배포** (사용자/오너 작업): `render-service/README.md` 절차 — docker build → RENDER_TOKEN 주입 실행 → Vercel env `DETAIL_RENDER_URL`/`DETAIL_RENDER_TOKEN` 등록. 미배포여도 클라이언트 폴백으로 무해.
- 컷 오케스트레이션 심화: 상품 마스터 레퍼런스 **세트**(정면+디테일+컬러칩 자동 파생 다중 레퍼런스 동봉), A컷 자동선별·카피↔이미지 페어링.
- 세리프 폰트 바이너리(현 system fallback): OFL Fraunces/Noto Serif KR self-host(CSP `font-src 'self'`).
- material 셀 인라인 편집(현 read-only), 편집기 iframe sandbox 강화.
- **크레딧 번들 단가**(상세페이지=6~9컷, 현행 단가로는 컷당 2~3크레딧 → 9컷 ≈ 24크레딧) — 오너 결정. 확정 시 `shot-plan.ts estimateShotCredits` + 서버 가드 갱신.
- 실사용 E2E: 실제 계정으로 스튜디오 → 상세페이지 → "AI 컷 일괄 생성" → 미리보기/내보내기 스모크 (preview 빌드만으로는 런타임 미검증).

## 4. 오케스트레이션 교훈
- 병렬 서브에이전트 ~12 동시 → Anthropic rate/session limit. **3~4 동시 배치**, 배치 간 sequential. Workflow resume 는 캐시 재생(한도 도달 시 resume).
- 파일 소유권 분리 + **정확한 공유 계약**(export 시그니처·필드명 verbatim)을 프리앰블에 명시 → 병렬 코드 함께 컴파일.
- 돈/RLS/인증 코드는 산출 후 **머지 전 적대검증 리뷰 필수**.

## 5. 다음 후보 (사용자 선택)
1. **상세페이지 실사용 E2E 스모크** — preview 에서 실제 계정으로 컷 일괄 생성 → 미리보기 → 내보내기 검증.
2. **감사 브랜치 머지** — 마이그레이션 013→016 적용(사용자) → smoke → main merge.
3. **render-service VPS 배포** — `render-service/README.md` 절차 (docker + Vercel env 2개).
4. **오너 결정 정리** — 크레딧 번들 단가(9컷≈24크레딧 이슈) · 세리프 라이선스 · 쿠팡 대표컷 파이프.
5. Phase 2 심화 — 마스터 레퍼런스 세트 자동 파생 · A컷 자동선별, 또는 detail-page-engine → main 머지.

마지막 커밋: `7153625 feat(detail-page): Phase 2 — 컷 오케스트레이션 + VPS Playwright 렌더 승격` (feat/detail-page-engine, preview READY).
