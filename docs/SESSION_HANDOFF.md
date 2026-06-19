# 세션 핸드오프 — 2026-06-13 기준 (보안·성능·스킬 강화 완료 시점)

> 컨텍스트 한계로 세션이 분리될 때, 다음 세션이 **개발 히스토리·결정사항·다음 작업**을 잃지 않고 이어가기 위한 핸드오프 문서.
> 새 세션 시작 시 이 문서 + `CLAUDE.md`(→`AGENTS.md`)를 먼저 읽을 것. Phase 4 상세는 `docs/PHASE_4_COMPLETION.md` 참조.

---

## 1. 프로젝트 식별

- **이름**: ProductCraft AI (Korean fashion e-commerce SaaS — 사진 1장 → 상품명·카피·상세설명·썸네일·AI피팅 자동 생성)
- **루트**: `/Users/yohan/Documents/claude/Fashion Product Manager/productcraft-ai`
- **레포**: `github.com/papascompany/Fashion-Product-manager` (main 브랜치) — *2026-06-19 papasyohan→papascompany 조직으로 이전 (Vercel git 자동배포 복구 목적)*
- **배포**: Vercel GitHub Integration **자동 배포** (`main` push → 자동 빌드). 별칭 `productcraft-ai.vercel.app`
- **운영자**: yohan73@gmail.com, yohan@papascompany.co.kr (둘 다 admin)
- **스택**: Next.js **16.2.4** (App Router, Turbopack) · React 19.2 · Vercel AI SDK **v6** · Supabase · pnpm v10
- **AI 라우팅**: Claude(주) + Gemini(보조·Fallback) 하이브리드
- **이미지 생성**: Nano Banana 2 (`gemini-3.1-flash-image-preview`) — multi-reference

> ⚠️ **Next.js 16 은 학습 데이터와 API/규약이 다르다.** 코드 수정 전 `node_modules/next/dist/docs/` 를 먼저 확인할 것 (`AGENTS.md` 지시).

---

## 2. 완료된 단계 요약

### Phase 1~4 (이전 세션들)
- **Phase 1** — 의도 입력 → 분석 편집 → 인라인 편집 → 부분 재생성
- **Phase 2** — 결과 카드 variants, 잠금(Lock)/고정(Pin), Notion-style 에디터
- **Phase 3** — 자연어 보정 + LLM 상세페이지 조립 + 네이버 DataLab 트렌드 실연동 + 영역 마스크 + Admin 대시보드
- **Phase 4** — AI Fitting(모델 사진 합성, multi-reference) + 동적 크레딧(1장=2/2장=4/3장=5/4장+=6) + Pro+ 게이팅 + 히스토리 흐름. 상세: `docs/PHASE_4_COMPLETION.md`

### 이번 세션 (2026-06-13) 작업 — 4개 영역

**① 코드 품질·보안 (commit `e7c7e38`, `2d5742b`)**
- 전체 코드 품질 감사 10건 + 보안 취약점 11건 수정
- SSRF 방어(`isSafeImageUrl` — private IP 차단), Open Redirect(`sanitizeRedirectPath`), MIME XSS(`extractSafeMimeType`), 크레딧 Race Condition(TOCTOU), Toss webhook userId 검증, 전화번호 PII 검증
- HTTP 보안 헤더 6종(`next.config.ts`), `poweredByHeader: false`
- 중앙 보안 모듈 신설: `src/lib/security.ts`
- migration **011**(atomic credit) + **012**(security hardening: `deduct_credits_atomic` RPC, `v_admin_stats` 권한 회수, `app_settings` RLS `is_admin()`) — **둘 다 Supabase 콘솔에서 적용 완료**

**② Core Web Vitals (commit `f13e949`)**
- 폰트 self-host: CDN `<link>` 3개 → `next/font`(Pretendard local woff2 + Bebas Neue + Instrument Serif) → CLS 제거
- 코드 분할: `DetailPageEditor`/`AIFittingPanel` `next/dynamic` (초기 번들 ~1,160줄 감소)
- Toss SDK 범위 축소: 전역 → `/billing` 레이아웃 한정
- Studio 초기 로드 Supabase 왕복 축소(2쿼리→1)

**③ 추가 성능 최적화 (commit `2905b04`)**
- `next/image` 교체 5곳(thumbnail-grid·history·studio·share·admin) + AVIF/WebP 자동 변환 + deviceSizes/imageSizes 최소화
- History 쿼리: DB 레벨 `created_at` 날짜 필터 + limit 100→50 (Free/Starter 플랜 전송량 70%+ 절감)
- `GeneratingView` memo 분리(status/progress/mode만 구독) → SSE 스트리밍 중 리렌더 범위 축소
- Turbopack `root: __dirname` (홈 디렉토리 package-lock.json 오인 경고 제거)

**④ 패션 큐레이션 스킬 강화 (commit `baf5279`, `7c49388`)**
- `fashion-curation-copy` 스킬 + 런타임 `fashion-curation-style.ts` 동기 업데이트
- 상품명 3종 중 **최소 2종 소재·원단명 포함** 의무화 (`NAMING_PATTERNS`)
- 상세설명 **소재 섹션 강화** — 원단명 구체화, 구성 비율은 정보 있을 때만 간결히
- **포인트 키워드 3~5개** 신규 기능 — 소재/핏/시즌/스타일 태그 (`POINT_KEYWORDS_GUIDE`)
  - 데이터 흐름: `analyze.materials → description prompt`, `DescriptionSchema.pointKeywords → SSE → store.GenerationResult.pointKeywords`
  - ⚠️ **store 저장까지만 완료. UI 렌더링 미구현** (아래 미해결 #1)

**⑤ 상세페이지 에디터 이미지 레이아웃 (commit `e310d05`, `b6909c0`)**
- AI 피팅 이미지 크롭 이슈 수정: `object-cover` → `object-contain`
- hero 섹션 순서: 상품명 → 한줄카피 → 이미지(미설정 시 220px 플레이스홀더)

### 추가 세션 (2026-06-13, 서브에이전트 오케스트레이션) — 4 워크스트림 동시 진행

> 파일 소유권 분리(겹침 0) + recon→구현 파이프라인 병렬 실행. 통합 후 `tsc 0 / eslint 0 / next build 성공` 검증 완료. **미커밋 상태이면 커밋 시 footer 갱신.**

**① 포인트 키워드 UI 렌더링 — 완료 (미해결 #1 해소)**
- 신규 재사용 컴포넌트 `src/components/point-keywords/index.tsx` — `light`/`dark` variant, 빈 값 시 `null`(layout shift 없음), `ul`/`li`+`aria-label` 접근성, 기존 chip 토큰 재사용
- `result-card/index.tsx`: 한줄카피 하단 dark chips + editor defaults 로 `pointKeywords` 전달
- `detail-page-editor/index.tsx`: hero 본문(한줄카피 아래) light chips. **display-only, 스키마 변경 없음**
- ⚠️ 남은 follow-up: 히스토리에서 프로젝트 복원 시 `pointKeywords` 미복원(studio `loadProject`/store restore 경로는 studio 소유) → 복원 프로젝트는 chip 미표시. DB 영속화 여부와 함께 추후 결정

**② AI Fitting E2E — 정적 검증 + 산출물 (앱 소스 무수정)**
- `docs/E2E_AI_FITTING.md` — 전체 코드패스 트레이스 + 체크포인트 18건 판정표(file:line) + 1/2/3/4장=2/4/5/6 크레딧 교차검증 + 번호 매긴 수동 브라우저 체크리스트 + risks 7건. **실버그 0건**(보안·동적가격·Pro게이트·원자차감·URL전용전송·모달 매핑 모두 정상)
- `e2e/ai-fitting.spec.ts` — Playwright 스캐폴드(내비/라벨/모달 검증, 업로드+라이브는 `test.skip`). 의도적으로 러너 글롭 밖(`tests/e2e/` 아님) — 비실행 스캐폴드
- 관찰(앱 소스 미수정, flag only): R-1 `route.ts` maxDuration 실제 **120**(brief의 90과 불일치, 타이밍 주석으로 정당) · R-2 `runtime='nodejs'` 명시 export 없음(주석만) · R-3 AI Fitting 차감은 `record_ai_fitting_generation`(011, GREATEST clamp)이라 경합 시 과소청구 가능(이중청구 아님)

**③ fitting 결과 history 통합 — 완료 (미해결 #4 해소)**
- `history/page.tsx`: `ai_fittings` 병렬 쿼리(`Promise.all`, 동일 `cutoffIso` 날짜필터 + `limit(50)`, projects embed) — 기존 성능 최적화 보존, 추가 지연 없음. **인증 `createClient`(RLS) 사용** (admin 금지)
- 신규 `src/lib/history-items.ts`: `FittingHistoryItem` 타입 + `mapFittingRows`(embed 객체/배열/null 방어, 손상 행 제외)
- `history-client.tsx`: 'AI 피팅' 탭 추가 + '전체' 뷰 `created_at` desc 병합(판별 유니온). 피팅 카드는 `result_url` 새 탭(스튜디오 미복원), 삭제 UI 미노출(읽기 전용)
- 검증: `ai_fittings`에 `width/height/aspect_ratio` 실재(009), read RLS(`project_id→projects.user_id`) 확인 — 조용한 빈 결과 버그 없음

**④ 운영 강화 — 안전·가산적 범위 (신규 파일 위주)**
- 신규 `src/lib/api-balance.ts`: `classifyProviderError`(순수)·`reportProviderFailure`(구조화 console.warn)·`getApiHealth`(env 키 설정 + 인메모리 last incident). 기존 라우트 미연결(채택 시 4곳 중복 분류 제거 가능)
- 신규 `src/lib/storage-signed-url.ts`: `createAiFittingSignedUrl`/`toStoragePath` — **opt-in, 미호출, 버킷 private 전환 안 함**(공유/히스토리/OG 보호)
- 신규 `src/lib/analytics.ts`: `logEvent`(best-effort, never-throw, dynamic import로 Edge 경량). `usage_events` 런타임 컬럼 사용. **호출 사이트 wiring은 미적용(follow-up)**
- 신규 `docs/SIGNED_URL_MIGRATION.md` — 단계적 전환 레시피
- `admin/page.tsx`: 읽기 전용 'API 상태' 섹션(Anthropic/Google 키 green/red + 최근 장애), "실시간 잔액 아님" 명시
- 오너 결정 필요: 외부 알림 채널(Slack/CoolSMS/email) 연결 · 라우트 분류 로직 일원화 · `api_incidents`/`analytics_events` 영속 테이블 · `logEvent` wiring 지점 · maxDuration 90↔120 · signed URL 실제 전환 시점

---

## 3. 핵심 코드 위치

```
src/
  app/
    (app)/
      studio/page.tsx                  # 메인 생성 흐름, SSE 소비, AI Fitting 핸들러, GeneratingView(memo)
      history/page.tsx                 # DB 레벨 날짜 필터 (서버 컴포넌트)
      history/history-client.tsx       # 목록 UI (next/image)
      billing/layout.tsx               # Toss SDK 범위 한정
    api/generate/
      pipeline/route.ts                # SSE 파이프라인 (analyze→naming→tagline→description), materials/pointKeywords
      ai-fitting/route.ts              # Node Runtime maxDuration=90, MIME 검증
      description/route.ts             # 개별 상세설명 재생성
    auth/callback/route.ts             # sanitizeRedirectPath (Open Redirect 방어)
    share/[projectId]/page.tsx         # 공개 공유 페이지 (next/image priority)
  components/
    result-card/index.tsx              # 04 AI Fitting / 05 썸네일 / 06 상세페이지 / 07 공유
    detail-page-editor/index.tsx       # hero 이미지 레이아웃, object-contain
    ai-fitting-panel/index.tsx         # 체크박스 + 채널 힌트 + 동적 크레딧 라벨
    thumbnail-grid/index.tsx           # next/image fill
  lib/
    security.ts                        # ★신설 — SSRF/Redirect/MIME/에러 새니타이즈
    credit-guard.ts                    # aiFittingCredits(), deduct_credits_atomic RPC 호출
    prompts/
      fashion-curation-style.ts        # ★스킬 런타임 단일진실 — PERSONA/TONE/4SECTION/NAMING/POINT_KEYWORDS
      naming.ts · description.ts       # 위 상수 import
    ai/
      types.ts                         # DescriptionSchema.pointKeywords, PipelineEvent
      generators/description-agent.ts  # pointKeywords 반환, materials 파라미터
      sse-client.ts · router.ts
  store/studio.ts                      # GenerationResult.pointKeywords 필드

supabase/migrations/
  001~009                              # ~Phase 4 (ai_fittings 테이블)
  010_app_settings.sql                 # Admin 설정
  011_atomic_credit_transactions.sql   # ✅ 적용
  012_security_hardening.sql           # ✅ 적용 (deduct_credits_atomic, v_admin_stats, app_settings RLS)

.claude/skills/                        # fashion-curation-copy(강화됨) + kakao-share-og + korean-ecommerce-copy + product-image-preflight
                                       # ⚠️ .claude 는 .gitignore 대상 — 스킬 변경은 git에 안 올라감
docs/
  SESSION_HANDOFF.md (이 문서) · PHASE_4_COMPLETION.md · NEXT_SESSION_PROMPT.md
  AI_ARCHITECTURE.md · ADMIN.md · UX_CUSTOMIZATION.md · 상품설명 학습데이터.md
```

---

## 4. 빌드/품질 상태 (이번 세션 마지막 검증)

- `npx tsc --noEmit` → **오류 0**
- `npx eslint src` → **오류 0, 경고 0**
- `npx next build` → **성공** (Turbopack root 설정 후 경고도 해소)

---

## 5. 환경 변수 (운영 — `.env.local` ≡ Vercel env)

| 키 | 용도 | 상태 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude (주) | ✅ |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini + Nano Banana 2 | ✅ (빌링 활성 키로 교체 완료) |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | Supabase | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage·admin | ✅ |
| `NAVER_DATALAB_CLIENT_ID` / `SECRET` | 트렌드 | ✅ |
| `TOSS_SECRET_KEY` | 결제 webhook 서명 | 설정 필요 시 확인 |
| `COOLSMS_API_KEY/SECRET/FROM_NUMBER` | SMS 공유 | 미설정 시 mock |
| `DEV_BYPASS_CREDITS` | 로컬 테스트 우회 | **운영에선 unset (제거 완료)** |

---

## 6. 알려진 미해결/관찰 사항 (= 다음 작업 후보)

1. ~~**★ 포인트 키워드 UI 렌더링 미구현**~~ → **✅ 해소(2026-06-13)**: `PointKeywords` 컴포넌트로 result-card·detail-page-editor hero에 chip 렌더. 남은 follow-up은 **히스토리 복원 시 chip 미표시**(studio `loadProject` 미복원 + DB 영속화 여부 미정) — studio 소유 경로라 별도 작업.

2. **Vercel CLI 토큰 만료** — 이번 세션에서 `vercel` CLI 토큰 만료 확인됨(`whoami` 실패). 배포는 **git push 자동 배포로 정상 동작**하지만, CLI 직접 배포/로그 조회가 필요하면 `vercel login` 재인증 필요. (Vercel MCP는 일부 도구 사용 가능)

3. **AI Fitting 실 사용자 E2E 테스트 미완료** — 브라우저 자동화 file picker 한계로 실제 모델 사진 업로드 검증이 안 됨. 수동 테스트 필요.

4. ~~**fitting 결과 history 통합**~~ → **✅ 해소(2026-06-13)**: 히스토리에 'AI 피팅' 탭 + '전체' 병합 뷰로 노출(읽기 전용, 결과 이미지 새 탭). 남은 결정: 피팅 카드 클릭을 스튜디오 딥링크로 바꿀지(스튜디오 피팅 복원 기능 필요) · per-type limit 50(병합 최대 100, 페이지네이션 없음) 유지 여부.

5. **ai-fittings 버킷 public read** — 향후 signed URL 또는 RLS로 좁힐지 검토.

6. **AI API 잔액 모니터링 알람 미구축** — Anthropic/Google 한도 도달 시 fallback 차단. 에러 메시지에 충전 링크는 노출하나 사전 알람 없음.

7. **소재 구성 비율 출력 품질** — 셀러가 소재 정보를 제공한 경우에만 비율 표시되도록 했으나, 실제 생성 결과 톤 검증은 사용자 확인 필요.

---

## 7. 보안/운영 원칙 (전역 — 반드시 준수)

- **시크릿 절대 출력 금지** — API 키·비밀번호·JWT는 위치만 기록
- **`CLAUDE.local.md`는 항상 `.gitignore`**
- **destructive git 금지** — `--force`, `--no-verify`는 사용자 명시 요청 시에만
- **`.claude/`는 gitignore 대상** — 스킬(SKILL.md) 수정은 git 추적 안 됨. 런타임 반영은 `src/lib/prompts/fashion-curation-style.ts`를 **함께** 수정해야 함 (둘은 단일 진실)
- **Phase 4 D안 변경 금지** — 체크박스 + 채널 힌트 + 동적 크레딧
- **fail2ban 회피** — VPS 접속 시 사용자명 추측 다중 시도 금지

---

## 8. 빠른 운영 명령

```bash
cd "/Users/yohan/Documents/claude/Fashion Product Manager/productcraft-ai"
pnpm dev                              # 로컬 개발
npx tsc --noEmit && npx eslint src    # 품질 체크
git add -A && git commit && git push  # → Vercel 자동 배포 (CLI 불필요)

# Supabase 마이그레이션: CLI 미연동 — Supabase 콘솔 SQL Editor에서 직접 실행
```

---

마지막 커밋(이전): `76e6a71 docs: 세션 핸드오프 문서 최신화`
이번 세션 작업: **4 워크스트림(①포인트키워드 UI · ②E2E 산출물 · ③fitting history 통합 · ④운영강화)** — `tsc 0 / eslint 0 / next build 성공`. 커밋 시 이 줄을 새 해시로 갱신.
마지막 적용 마이그레이션: `012_security_hardening.sql` (✅ 콘솔 적용 완료) — **이번 세션은 새 마이그레이션 없음**(④는 신규 테이블 없이 가산적 구현)
