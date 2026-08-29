# 다음 세션 시작 프롬프트 (2026-08-28 갱신 · 마스터 레퍼런스 세트 스모크 시점)

> 새 세션 첫 메시지로 "docs/NEXT_SESSION_PROMPT.md 읽고 이어서 진행" 이라고 지시하세요.

> ✅ **P0 해소 (2026-08-28) — 이미지 생성 복구 완료**
> 증상은 prod·preview 양쪽 Gemini 이미지 모델 429 `RESOURCE_EXHAUSTED / FreeTier limit: 0` 이었으나,
> **원인은 결제가 아니라 "Vercel 이 옛 free-tier 키를 보고 있었던 것"** 이었다.
> - AI Studio 실물 확인: `...nr6E`(프로젝트 **Fashion Product manager**, `gen-lang-client-0513131840`)·`...FgYM`(Gemini Obsidian) **둘 다 이미 paid Tier 1 후불**.
> - 그런데 Vercel 의 `GOOGLE_GENERATIVE_AI_API_KEY` 는 **두 키 어느 것도 아니었다**(끝 4자리 대조) → AI Studio 목록에 없는 제3의 free-tier 프로젝트 키. 이미지 모델은 free tier 자체가 없어 `limit: 0` 이 된다.
> - **조치(오너 수행)**: Production·Preview·Development 3개 환경의 키를 `...nr6E` 로 교체 + Production/Preview 는 **Sensitive** 로 저장. 이후 prod 재배포(`vercel redeploy`).
> - **복구 검증**: prod 썸네일 생성 200 · 실이미지 475KB · 크레딧 40→39 · usage_events 1행.
> - ⚠️ **잔여(오너)**: ① AI Studio 상단 "공개적으로 노출된 API 키가 감지되었습니다" 경고 + `...FgYM` 경고 배지 — **이 레포 히스토리는 전수 스캔했고 실제 키 없음**(문서 플레이스홀더 `AIzaSy...` 한 줄뿐)이라 노출 지점은 다른 곳으로 추정. 해당 키 회전 권장. ② Development 환경 값은 아직 Non-sensitive. ③ 안 쓰게 된 옛 free-tier 키 폐기.
> - 부수 코드 수정은 브랜치 **`fix/provider-error-cause`** 로 분리(아래 §7).

> 🟢 **레퍼런스 세트 — 스모크 게이트 통과 (머지 판단만 남음)**
> 브랜치 **`feat/master-reference-set`** (main 미머지). **확인 A·B·C 전부 통과** — 근거는 §6.
> 남은 것은 **오너의 머지 승인** 뿐이다(머지 = prod 배포).

> ✅ **P0 해소 (2026-08-01)**: Supabase(`jspajtwnxnuvutekbhii`) 오너가 복구 완료 — DNS·Auth·DB·Storage 정상, 데이터 보존 확인(기존 사용자/썸네일 존재). 재발 방지: 무료 티어면 7일 비활성 시 다시 pause 될 수 있음 — 유료 전환 또는 주기적 keep-alive 검토(오너).
>
> ✅ **마이그레이션 017 적용 완료 (2026-08-01)**: 오너 적용 후 `saved:true` + generations 에 `detail_page` 행 실저장 검증 완료. 상세페이지 저장 경로 정상.
>
> ✅ **권한상승 취약점 차단 완료 (2026-08-08)**: 013~016 적용 후에도 가드가 **no-op** 이었다(원인 = 가드 함수의 `security definer` → `current_user` 가 항상 소유자 + 트리거 미생성). **018·019** 로 해소하고 공격 재현으로 차단 확인. 상세는 §5 교훈.

---

프로젝트: **ProductCraft AI** — 한국 패션 이커머스 SaaS (사진 1장 → 상품명·카피·상세페이지·썸네일·AI피팅 자동 생성).

## 0. 세션 시작 프로토콜 (순서 고정)
1. **정본 경로에서 작업**: `/Users/yohan/Developer/claude/Fashion Product Manager/productcraft-ai` — ⚠️ `Documents/claude/...` 는 동기화된 중복본. **반드시 Developer/ 경로 사용.**
2. 이 파일 + `docs/DETAIL_PAGE_ENGINE_PRD.md` 를 먼저 읽어 상태 파악.
3. `CLAUDE.md`(→`AGENTS.md`): **Next.js 16 은 학습데이터와 다름** — Next 특정 코드 전 `node_modules/next/dist/docs/01-app/` 확인.
4. `git branch -a && git log --oneline -6 && git status` 확인. 내가 만들지 않은 변경은 보존. (현재 브랜치는 `main` 하나뿐이며 정본이다)
5. Supabase 생존 확인: `dig +short jspajtwnxnuvutekbhii.supabase.co @1.1.1.1` — 응답 없으면(NXDOMAIN) 무료 티어 pause 재발이니 오너에게 Restore 요청.

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

## 2. 브랜치 현황
- **`main` = `a9fff49`** — 감사 브랜치 + 상세페이지 엔진 Phase 1+2 전부 반영, **prod 배포 완료**. 정본.
- **`feat/master-reference-set`** ← main 미머지. preview READY + **스모크 확인 A·B·C 전부 통과**(2026-08-28). 머지 승인 대기. 상세 §6.
- **`fix/provider-error-cause`** ← main 미머지. provider 가 삼키던 실패 원인을 `cause` 로 보존해 결제/쿼터 오류 분류를 복구. preview READY + 런타임 검증 완료. 상세 §7.
- (삭제 완료) `audit-immediate-thisweek`·`feat/detail-page-engine` — main 에 머지 후 로컬·원격 삭제. 복구 필요 시 `git branch <name> e14a958` / `432628a`.

**적용된 마이그레이션 (prod DB)**: 001~012(기존) + **013·014·015·016** + **017**(generations detail_page) + **018·019**(가드 수정). 다음 신규 마이그레이션은 **020부터**.

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

**검증 상태 — E2E 런타임 스모크 통과 (2026-08-01, preview `0394da8`)**:
- ① thumbnail + `shotPreset:flat-lay` + `lockSeed`: **PASS** — 200/23s, 실이미지 690KB 저장, 프롬프트에 프리셋·CONSISTENCY·텍스트세이프존·NEGATIVE 포함, 크레딧 40→37 정합.
- ①b `detail-macro` 동일 seed(배치 재현): **PASS** — 크레딧 37→34, weave/macro 프롬프트 확인.
- ② ai-fitting `shotVariant`/`lockSeed`: zod 통과 + 모델이미지 가드 정상 400. **실생성은 미검증** — DB/스토리지에 모델 이미지가 없음(데이터 부재). 오너가 모델 사진 업로드 후 1회 실생성 확인 권장.
- ③ detail-page 조립: **PASS** — 컷 url 4곳 `<img>` 렌더, 빈 fitShot 은 drape 플레이스홀더, closing 렌더, 커머스 요소 없음.
- ④ render 프록시: **PASS** — 미구성 시 501 + `fallback:"client"`.
- DB 정합: usage_events 2건(각 3크레딧)·thumbnails 2행·credits_left 일치.
- **E2E 발견 버그(수정 완료, `0394da8`)**: `generations_type_check` 가 `detail_page` 미허용 → 저장 조용히 유실(Phase 1 부터 잠복). 수정 = 마이그레이션 017 + 라우트 `saved` 플래그 + 편집기 실패 표시. **017 적용 완료 + `saved:true` 실저장 검증 완료.**
- ⚠️ **스모크 픽스처는 2026-08-08 전부 삭제됨** (계정 `smoke-e2e@…`·프로젝트·생성물·스토리지 컷·usage_events). **다시 찾지 말 것** — 필요하면 아래 "스모크 계정 만드는 법"으로 새로 만든다. 현재 DB 의 실계정 2개(yohan73@gmail.com / yohan@papascompany.co.kr, 둘 다 business·admin)는 **테스트에 쓰지 않는다.**
- UI 클릭-스루는 이 시점엔 미수행이었고, **2026-08-08 프로덕션에서 완료**(아래 참조).

**머지 후 회귀검증 (2026-08-08, preview `432628a` READY → main `51693a9` 배포)**:
- detail-page: 감사의 크레딧 가드(2크레딧 차감) + detail-page 의 `saved:true` **동시 동작 PASS**.
- 컷 생성: ghost-mannequin 프리셋·CONSISTENCY·텍스트세이프존 프롬프트 반영 PASS.
- render 프록시: 501 + `fallback:"client"` PASS.
- **머지가 드러낸 문제(수정 `432628a`)**: 감사 브랜치의 동적 단가(BIZ-10, 1장=1크레딧)로 바뀌었는데 `estimateShotCredits` 가 옛 고정값(3)을 써 패널이 과대 표시 → 1/2 로 정정. **9컷 추정 ≈24 → 9~13 크레딧**(번들 단가 결정의 전제가 바뀜).
- 머지 충돌 2건 해소: detail-page 라우트(크레딧 가드 + saved 결합) · 편집기(감사의 `PreviewModal` a11y 채택 + 래스터화 컨트롤/iframe ref 통합). iframe sandbox 는 `allow-scripts` 미부여를 유지한 채 `allow-same-origin` 만 허용(클라이언트 래스터화 폴백에 필요, 스크립트 실행 불가라 권한 상승 벡터 아님).

**패널 UI 클릭-스루 (2026-08-08, prod)**: 히스토리 복원(`/studio?projectId=`)으로 편집기 진입 → 패널이 "빈 슬롯 2개 · 예상 2크레딧 · 착용컷 제외" 표시 → 버튼 클릭 → "컷 생성 중..." → 슬롯 2개 `<img>` 채움(플레이스홀더 0) → **빈 슬롯 0 이 되자 패널 자동 소멸** → 크레딧 27→25(예상치와 일치)·usage_events 2건·이미지 실파일 705KB/639KB. **한계**: 브라우저 페인이 0×0 뷰포트라 픽셀 클릭 불가 → DOM `click()` 으로 React onClick 구동. 핸들러·네트워크·상태·렌더는 실경로지만 **버튼 히트영역·레이아웃은 미검증**(오너 육안 확인 권장).

**E2E 재실행 레시피**: Vercel MCP `get_access_to_vercel_url`(⚠️ `_vercel_jwt` 는 배포 단위 — 새 배포마다 재발급) → `vercel env pull` 로 서비스 키(사용 후 삭제) → Admin `generate_link`(magiclink)→`verify` 로 세션(비밀번호 미사용) → `sb-<ref>-auth-token` base64-JSON 쿠키로 API 호출. UI 검증은 같은 쿠키를 브라우저에 `document.cookie` 로 주입.

**스모크 계정 만드는 법 (매번 새로 만들고, 끝나면 지운다)**:
1. Admin API 로 사용자 생성(`POST /auth/v1/admin/users`, `email_confirm:true`) → `user_profiles` 자동 생성(free/3크레딧) → 서비스 키로 plan/credits PATCH.
2. `projects` INSERT(`mode:'studio'`, `status:'processing'`, `product_image_url`).
3. 편집기 화면까지 가려면 `generations` 에 **naming·tagline·description(payload.description 문자열)** 이 있어야 복원된다(`analyze` 는 선택). 패널을 띄우려면 `payload.detailPageSections` 에 빈 `shotSlot` 이 있는 섹션(gallery/lookbook)을 포함.
4. 정리: storage 객체 → thumbnails → generations → usage_events → ai_fittings → projects → auth 사용자 순으로 삭제.

## 4. 예정 내역 (우선순위 순)
0. 🟢 **머지 승인 2건 대기** — `feat/master-reference-set`(§6, 게이트 통과) · `fix/provider-error-cause`(§7, 검증 완료). 둘 다 오너 승인 후 머지.
1. **잔여 런타임 검증 1건** — **AI Fitting 실생성 1회**(모델 사진 필요 — 오너가 앱에서 1회 업로드하면 `shotVariant`·모델락·컷 세트 일관성까지 확인 가능). 패널 UI 클릭-스루는 2026-08-08 완료(§3 참조).
2. ⚠️ **결제 오픈 전 필수** — `TOSS_SECRET_KEY`/`TOSS_CLIENT_KEY` 가 **모든 Vercel 환경에 미설정**이라 Toss webhook 핸들러는 현재 fail-closed(요청 거부)이며 스모크 불가. 015 RPC 레벨(멱등성·금액·취소)은 검증 완료. 결제 오픈 시 secret 설정 → 핸들러 스모크 필수.
3. **오너 결정 3건** — ① 크레딧 번들 단가(**동적 단가 반영 후 9컷 ≈ 9~13크레딧** — 재산정 필요) ② 세리프 라이선스(OFL Fraunces/Noto Serif KR vs 상용; 현재 system fallback) ③ 쿠팡 대표컷(1000×1000) 파이프·설명컷 기본값·테마 출시 우선순위·AI 고지 법무.
4. **render-service VPS 실배포** (오너 또는 SSH 지시) — `render-service/README.md`: docker build/run(RENDER_TOKEN) → Vercel env 2개 등록. 미배포여도 클라이언트 폴백으로 무해.
5. **Phase 2 심화** — 상품 마스터 레퍼런스 **세트**(정면+디테일+컬러칩 자동 파생, 현재는 원본 1장만 동봉), A컷 자동선별·카피↔이미지 페어링.
6. **편집기 개선** — material 셀 인라인 편집(현 read-only).
7. **Phase 3 백로그** — 공유 웹뷰 스크롤 리빌·키네틱 헤드라인, 컷 QC 대시보드(상품 보존율/컬러 매칭), 3D 프리뷰.
8. **Supabase pause 재발 방지** (오너) — 무료 티어 유지 시 keep-alive 크론 또는 유료 전환 검토.

> ✅ 정리 완료(2026-08-08): 머지된 두 브랜치 삭제(로컬·원격) · 스모크 픽스처 전부 삭제 · 결제 테스트 데이터 0행.

## 5. 오케스트레이션·작업 교훈
- 병렬 서브에이전트 ~12 동시 → rate/session limit. **3~4 동시 배치**, 배치 간 sequential. Workflow resume 는 캐시 재생.
- 파일 소유권 분리 + **정확한 공유 계약**(export 시그니처·필드명 verbatim) 명시 → 병렬 코드 함께 컴파일.
- 돈/RLS/인증 코드는 **머지 전 적대검증 리뷰 필수**. 컷 생성 신기능은 기존 크레딧 경로 재사용으로 리스크 회피(이번 Phase 2 방식).
- 마이그레이션 번호: **019까지 사용됨 — 새 마이그레이션은 020부터.**
- "빌드 READY" ≠ 런타임 정상 — 백엔드 의존 기능은 반드시 런타임 스모크까지. (P0 를 놓친 원인)
- **"마이그레이션이 적용됐는가"가 아니라 "가드가 실제로 막는가"를 공격해봐야 한다.** 013 은 적용된 뒤에도 가드가 no-op 이었다(`security definer` → `current_user` 가 항상 소유자). 보안 수정은 반드시 **공격 시나리오 재현**으로 검증할 것.
- 보안 가드는 **양방향 쌍으로** 검증한다 — "막아야 할 것이 막히는가" + "통과해야 할 것이 통과하는가"(WHK-01: 가드가 정당한 크레딧 차감까지 되돌리면 전 서비스 무료화).
- **스모크 시드 payload 는 실제 타입과 정확히 맞춘다.** `generations.naming.payload.names` 를 `{name, reason}` 로 넣었더니(정타는 `ProductName={name, trend}`) 편집기 복원 중 `TypeError: Cannot read properties of undefined (reading 'length')` 로 **페이지 전체가 죽었다**. 섹션도 마찬가지 — `DetailSection` 유니온에 없는 `type:'story'`, `hero` 의 `headline/sub`(정타는 `title/tagline`), `closing` 의 `message`(정타는 `heading`)는 전부 무효. 정타는 `src/store/studio.ts` 상단 유니온 참조.
  (부수 관찰: 잘못된 payload 에 대해 스튜디오 복원이 graceful 하지 않고 크래시한다 — 앱이 쓰는 payload 라 실사용 위험은 낮지만 방어 여지 있음.)
- **"쿼터 초과"가 반드시 결제 문제인 것은 아니다.** 429 `FreeTier limit: 0` 을 보고 결제 비활성으로 단정했지만, 실제 원인은 **Vercel 이 AI Studio 에 없는 옛 free-tier 프로젝트 키를 보고 있었던 것**이었다. 결제는 처음부터 정상(Tier 1)이었다.
  진단 순서: ① 에러의 quotaId 에 `FreeTier` 가 박혀 있으면 "그 키의 프로젝트가 free tier" 라는 뜻 → ② **키가 어느 프로젝트 것인지부터 확인**(AI Studio API 키 목록의 끝 4자리와 대조. 값을 출력하지 않고도 매칭 가능) → ③ 결제 상태는 그다음. 이미지 모델은 free tier 자체가 없어서 `limit: 0` 이 정상값이다.
- **preview 와 production 은 env 값이 다를 수 있다.** `GOOGLE_GENERATIVE_AI_API_KEY` 는 Production(Sensitive)·Preview·Development 가 각각 별도 값이다. `vercel env pull --environment=production` 은 Sensitive 값을 **자리표시자(11자)로 내려준다** — 그걸 실키로 착각하지 말 것(로컬 프로브가 "API key not valid" 를 뱉는 이유). preview 키는 Non-sensitive 라 실값이 내려온다.
- 긴 SQL 을 콘솔에 붙여넣을 때는 **끝에 상태 확인 SELECT** 를 둔다. 붙여넣기 잘림을 "결과 표 유무"로 즉시 판별할 수 있다(이번에 150줄에서 잘린 사고를 이 방식으로 잡음).

---

## 6. 🔵 진행 중 — 마스터 레퍼런스 세트 자동 파생 (Phase 2 심화)

**브랜치 `feat/master-reference-set` = `9761b1a`** (main 미머지). **preview 빌드 READY 확인됨**(38s, `productcraft-pwxox9vha`).

### 무엇을 만들었나 (PRD §3 ① — 컷 간 상품 아이덴티티 일관성)
원본 상품 이미지 1장에서 **"정면 + 디테일 + 컬러칩" 레퍼런스 세트**를 파생해, 상품 컷(thumbnail 엔진) 요청마다 **다중 레퍼런스로 동봉**한다. 모델이 상품을 한 각도가 아니라 여러 정규화된 뷰로 인식해 색·질감·형태 드리프트가 줄어든다.

**핵심 설계 판단 (되돌리기 전에 이유를 읽을 것)**
- **파생은 클라이언트 canvas** — 별도 Gemini 호출로 뷰를 생성하지 않는다. 따라서 **크레딧 영향 0**, 파생물이 원본에서 결정론적으로 나와 그 자체의 드리프트가 없다.
- **정면 = 원본 그 자체** — 이미 primary 로 전송되므로 따로 파생하지 않는다. 서버가 `[정면, 디테일, 컬러칩]` 순으로 provider 에 조건화(provider 5장 캡 이내).
- **실패 시 무조건 폴백** — CORS 타인트·디코드 실패 등 어떤 단계든 실패하면 `null` 반환 → 기존 단일 레퍼런스 동작. **회귀 없음**이 설계 전제다.
- **AI Fitting 은 의도적으로 제외** — 그 프롬프트는 `[제품=image 1, 모델=image 2]` 순서를 본문에서 명시 참조하므로, 레퍼런스를 끼우면 인덱스가 어긋난다. 확장하려면 `buildAiFittingPrompt` 의 image 번호 참조를 먼저 바꿔야 한다.

### 변경 파일 (커밋 `9761b1a`, 5개)
- `src/lib/detail-page/master-reference.ts`(신규) — `deriveReferenceAnchors(source)`: 중앙 55% 크롭(768px) + 지배색 컬러칩(512px, 32단계 양자화·배경색 후순위). 전부 try/catch, 실패 시 null.
- `src/store/studio.ts` — `referenceAnchors` 캐시(프로젝트당 1회) + `setReferenceAnchors`. **`setImage` 에서 무효화**(새 원본 → 재파생).
- `src/components/detail-page-editor/shot-panel.tsx` — 첫 생성 시 1회 파생·캐시, `runJob(job, lockSeed, anchors)` 로 전달, thumbnail 요청 body 에 `referenceImages: [detail, colorChip]`. 서브타이틀에 "상품 레퍼런스 세트 자동 동봉" 표시.
- `src/app/api/generate/thumbnail/route.ts` — `referenceImages` 수용(최대 4, `isSafeImageUrl` 또는 화이트리스트 MIME base64 가드) → `[primary, ...extra]` 로 provider 전달. 세트가 있으면 `consistency: { hasReferenceSet: true }`.
- `src/lib/ai/image/prompt-builder.ts` — `buildConsistencyBlock({ hasReferenceSet })`: 다중 레퍼런스를 "동일 상품의 다른 크롭"으로 취급하고 **컬러칩을 화이트밸런스 ground-truth** 로 지시.

### 검증 상태 (2026-08-28 런타임 스모크 실행 결과 — preview `81c6841` / `productcraft-f3op9och2`)
- ✅ **preview 빌드 READY** (타입·번들 통과)
- ✅ **파생 알고리즘 로직 단위검증** — 크롭 좌표가 항상 원본 내부 중앙, 32단계 양자화 무충돌, 배경 판정이 채도색 보존.
- ✅ **확인 C — 통과 (브라우저 실행)**. 스모크 계정으로 편집기 복원 → 패널에 "빈 촬영 슬롯 2개 · 예상 2크레딧 · 모델 이미지 없음 — 착용 컷 제외 · **상품 레퍼런스 세트 자동 동봉**" 표시 → 버튼 클릭.
  - Supabase Storage 공개 객체는 **CORS 허용 확인** — `crossOrigin='anonymous'` 로드 후 `getImageData`·`toDataURL` 모두 성공(canvas 타인트 없음). 폴백 경로로 새지 않는다.
  - 나가는 요청 2건을 fetch 인터셉터로 캡처: 각각 `referenceImages` **2장**(`data:image/jpeg;base64,…`, 52,299B 디테일 + 3,487B 컬러칩), `imageUrl`=스토리지 원본, `shotPreset`=`flat-lay`/`detail-macro`, `lockSeed`=동일값(1577299142).
  - 두 컷의 앵커 바이트 길이가 **완전히 동일** → 프로젝트당 1회 파생·캐시 재사용이 실제로 동작.
- ✅ **확인 A — 통과 (2026-08-28, 키 교체 후 preview `productcraft-ldupdkfix`)**. 배포된 람다 응답 `prompt` 를 직접 관측했고, **대조군을 함께 돌려 스위치가 데이터로 갈린다는 것까지** 확인:
  - `referenceImages` **동봉** → `MULTIPLE reference views` ✅ · `color-swatch` ✅ · 단일 레퍼런스 폴백 문구 없음. 200/18.5s, 실이미지 460KB.
  - `referenceImages` **미동봉**(대조군) → 위 두 문구 없음 · 기존 단일 레퍼런스 문구 있음. 200/13.8s, 실이미지 665KB.
  - 두 요청 모두 `flat-lay` 프리셋 문구 포함 — 프리셋 경로 회귀 없음.
- ✅ **확인 B — 통과**. 컷당 정확히 **1크레딧**(39→38, 38→37). 파생은 무과금이라 레퍼런스 세트 동봉이 단가를 올리지 않는다.
  - DB 정합: usage_events 3행(전부 `credits_used:1`, `thumbnail_generated`) · thumbnails 3행 · credits_left 40→37 일치.

### 다음 세션이 할 일
1. **오너 머지 승인 대기** — 게이트(확인 A·B·C)는 전부 통과했다. 머지 = prod 배포라 승인 후 진행.
2. 머지 시: `main` 머지 → prod 배포 READY 확인 → `feat/master-reference-set` 로컬·원격 삭제.
3. 같이 대기 중인 브랜치: **`fix/provider-error-cause`**(§7) — 순서는 무관하나 둘 다 main 기준이라 각각 머지 후 배포 확인.

> **머지 판단 메모**: 신규 코드 경로(클라이언트 파생 → 요청 동봉 → 서버 수용 → 프롬프트 분기 → 실제 컷 생성)가 전부 런타임으로 관측됐고, 실패 시 단일 레퍼런스 폴백이라 회귀 위험은 낮다. 대조군 비교까지 됐으므로 추가 검증 없이 머지 가능하다.

### 검증 방법 참고
API 레벨은 §3 "E2E 재실행 레시피", UI 레벨은 같은 절의 쿠키 주입 방식(브라우저 `document.cookie` 에 `sb-<ref>-auth-token` 주입). ⚠️ in-app 브라우저는 **0×0 뷰포트**라 픽셀 클릭 불가 — DOM `click()` 으로 대체했던 전례가 있다.

---

## 7. 🟢 대기 중 — `fix/provider-error-cause` (provider 실패 원인 보존)

**문제**: `NanaBanana2Provider.generateSingle` 이 예외를 catch 해 `null` 을 반환 → `Promise.allSettled` 가 전부 `fulfilled(null)` → `generate()` 가 고정 문구로 던져 **업스트림 원문이 소실**. 그 결과 thumbnail 라우트의 `BILLING_REQUIRED`(503) 분기가 **한 번도 발화하지 못하고** 사용자에게 일반 500 만 노출됐다. ai-fitting 도 동일.

**수정 (4파일)**
- `nano-banana2-provider.ts` — `generateSingle` 은 로깅 후 **rethrow**, `generate` 는 전부 실패 시 첫 rejection 을 **Error `cause`** 로 부착. **사용자 메시지는 기존과 동일**(업스트림 원문을 응답에 싣지 않기 위함).
- `api-balance.ts` — `flattenErrorChain(err)` 추가(순환·깊이 방어). `errMessage` 가 이를 사용해 `classifyProviderError` 도 cause 를 본다.
- thumbnail·ai-fitting 라우트 — **분류 입력만** `flattenErrorChain(err)` 로 교체. 응답 본문(`error`/`debug`)은 그대로 `err.message` 라 원문 유출 없음.
- ai-fitting — `billing|RESOURCE_EXHAUSTED` 를 "잠시 후 재시도" 가 아니라 **"잔액 확인"** 분기로. 재시도로 풀리지 않는 장애다.

**검증 (P0 진행 중이던 실제 429 를 픽스처로 사용 — prod/main 대조군 포함)**
| | 수정 후(preview) | 수정 전(prod main) |
|---|---|---|
| thumbnail | **503 `BILLING_REQUIRED`** | 500, code 없음 |
| ai-fitting | **"AI API 크레딧이 부족합니다…"** | "AI Fitting 실패: 이미지 생성에…" |
| 크레딧 | 40→40 (무과금) | 40→40 (무과금) |
| 업스트림 원문 유출 | 없음 | 없음 |

추가로 스텁 SDK 로 429 를 강제한 단위 테스트 15건 통과(버그 재현·원문 미유출·`flattenErrorChain` 엣지·**일부 비율만 실패 시 성공분만 반환하는 회귀 가드**).

**남은 것**: ① 오너 머지 승인 ② ai-fitting 은 여전히 500 반환(문구만 개선) — thumbnail 처럼 503+code 로 맞출지는 응답 계약 변경이라 별건으로 분리.

---

마지막 상태: `feat/master-reference-set`(게이트 통과) · `fix/provider-error-cause`(검증 완료) **둘 다 머지 승인 대기**. main 최신: `a9fff49` (2026-08-28 키 교체 후 재배포 완료, 이미지 생성 정상).
