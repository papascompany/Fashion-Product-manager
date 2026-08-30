# ProductCraft AI

> 제품 사진 1장으로 상품명·홍보문구·상세설명·상세페이지·썸네일까지 30초 안에 자동 생성하는 한국형 이커머스 AI SaaS.

스마트스토어·쿠팡·무신사 셀러를 위한 콘텐츠 자동화 도구. 간편 모드(텍스트만)와 스튜디오 모드(텍스트 + Nano Banana 2 썸네일 + 상세페이지 HTML)를 제공합니다.

---

## 기술 스택

- **프레임워크**: Next.js 16 (App Router, Turbopack, Edge Runtime)
- **UI**: React 19, Tailwind v4, shadcn, Nike 디자인 시스템
- **상태관리**: Zustand
- **DB / 인증**: Supabase (Postgres + Auth + RLS + Storage)
- **AI 텍스트**: [Vercel AI SDK v6](https://sdk.vercel.ai) — Claude · Gemini · 로컬LLM 멀티 프로바이더 라우팅
- **AI 이미지**: Google Nano Banana 2 (Gemini 3.1 Flash Image)
- **결제**: Toss Payments
- **공유**: CoolSMS (문자) · Kakao Share SDK
- **호스팅**: Vercel (GitHub Integration 자동 배포 — `main` → Production, 그 외 브랜치/PR → Preview)

---

## 핵심 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│   Client (studio/page.tsx)                                  │
│   ─ Zustand store (mode/image/status/result)                │
│   ─ SSE stream consumer (sse-client.ts)                     │
└──────────────────────────┬──────────────────────────────────┘
                           │ POST /api/generate/pipeline
                           │ Content-Type: text/event-stream
                           ▼
┌─────────────────────────────────────────────────────────────┐
│   Pipeline Route (Edge Runtime)                             │
│   ─ ReadableStream of SSE events                            │
│   ─ project → analyze → naming(+trends) → tagline → desc    │
└──────────────────────────┬──────────────────────────────────┘
                           │ uses
                           ▼
┌─────────────────────────────────────────────────────────────┐
│   AI Router (lib/ai/router.ts)                              │
│   ─ MODEL_<TASK> env → ModelSpec → AI SDK model 인스턴스     │
│   ─ 1순위 실패 시 2순위 자동 fallback                          │
│   ─ Providers: anthropic / google / local (OpenAI 호환)      │
└──────────────────────────┬──────────────────────────────────┘
                           │ generateObject / streamObject
                           ▼
                  ┌────────┴────────┐
                  │                 │
            Anthropic API     Google AI API     Local LLM
            (Claude)           (Gemini)         (Ollama/vLLM)
```

자세한 내용은 [`docs/AI_ARCHITECTURE.md`](./docs/AI_ARCHITECTURE.md) 참조.

---

## 빠른 시작

### 1. 환경변수 설정

```bash
cp .env.local.example .env.local
# .env.local 편집 — 최소 다음 키만 있으면 동작:
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
#   ANTHROPIC_API_KEY        ← 또는 GOOGLE_GENERATIVE_AI_API_KEY 중 하나
#   GOOGLE_GENERATIVE_AI_API_KEY  ← 썸네일 생성용은 필수
```

### 2. 개발 서버 실행

```bash
pnpm install
pnpm dev
```

> 런타임 고정: Node **24.x** · pnpm **10** (`package.json` 의 `engines` / `packageManager`).
> Vercel 프로젝트·CI 도 같은 버전을 씁니다.

http://localhost:3000 열기.

### 3. 빌드 & 배포

```bash
pnpm build            # 로컬 빌드 검증
git push origin main  # → Vercel GitHub Integration 이 Production 배포
```

배포는 **Vercel GitHub Integration 단일 경로**입니다. `main` 푸시는 Production,
그 외 브랜치·PR 은 Preview 로 자동 배포됩니다. Vercel CLI 나 배포 워크플로를
따로 돌릴 필요가 없습니다.

GitHub Actions(`.github/workflows/deploy.yml`)는 **배포하지 않고 검증만** 합니다 —
`main` 푸시와 `main` 대상 PR 에서 타입체크 → 단위 테스트 → 린트를 실행합니다.
로컬에서 같은 게이트를 미리 돌리려면:

```bash
pnpm exec tsc --noEmit && pnpm test:run && pnpm lint
```

---

## 디렉터리 구조

```
src/
├─ app/
│  ├─ (app)/              # 인증된 사용자 영역
│  │  ├─ studio/          # 메인 생성 화면
│  │  ├─ history/         # 생성 내역
│  │  └─ billing/         # 플랜·결제
│  ├─ api/
│  │  └─ generate/
│  │     ├─ pipeline/     # 통합 파이프라인 (Edge + SSE 스트리밍)
│  │     ├─ analyze/      # 개별 엔드포인트 (Edge)
│  │     ├─ naming/
│  │     ├─ tagline/
│  │     ├─ description/
│  │     ├─ thumbnail/    # Nano Banana 2 (Node Runtime)
│  │     └─ detail-page/  # HTML 조립 (LLM 미사용)
│  └─ auth/               # 로그인·회원가입·OAuth 콜백
├─ components/
│  ├─ upload-dropzone/
│  ├─ mode-selector/
│  ├─ result-card/
│  ├─ thumbnail-grid/
│  ├─ share-sheet/
│  ├─ credit-guard-modal/
│  └─ app-nav/
├─ lib/
│  ├─ ai/
│  │  ├─ router.ts        # 멀티 프로바이더 라우터
│  │  ├─ types.ts         # Zod 스키마 + PipelineEvent
│  │  ├─ sse-client.ts    # 클라이언트 SSE 파서
│  │  ├─ client.ts        # 이미지 프로바이더 레지스트리
│  │  ├─ analyzers/
│  │  ├─ generators/
│  │  └─ image/           # Nano Banana 2 wrapper
│  ├─ prompts/            # 프롬프트 템플릿 (기능별 1파일)
│  ├─ supabase/           # DB 클라이언트
│  ├─ trends/             # 트렌드 키워드
│  └─ credit-guard.ts     # 크레딧/플랜 검사
└─ store/
   └─ studio.ts           # Zustand 전역 상태
```

---

## 주요 명령어

| 명령 | 설명 |
|------|------|
| `pnpm dev` | 개발 서버 (Turbopack) |
| `pnpm build` | 프로덕션 빌드 |
| `pnpm start` | 프로덕션 서버 |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest 단위 테스트 (watch) |
| `pnpm test:run` | Vitest 단위 테스트 1회 실행 (CI 와 동일) |
| `pnpm test:e2e` | Playwright E2E |

---

## 디자인 시스템

Nike의 editorial 스타일을 따릅니다. 자세한 토큰은 디자인 문서 참고:

- **컬러**: `#111111` / `#ffffff` / `#f5f5f5` 3톤 + `#9e9ea0` / `#707072` / `#e5e5e5` (그레이 스케일)
- **시멘틱**: `#d30005` (에러/세일) / `#007d48` (성공)
- **타이포**: Pretendard Variable (본문), Bebas Neue (디스플레이)
- **컨테이너**: 0px radius (사각 hairline border)
- **버튼**: `rounded-full` pill만 허용
- **그래픽**: 그래디언트·그림자 금지, 솔리드 컬러만

---

## 라이선스 / 고지

- AI 생성 콘텐츠임을 사용자에게 명시 (SynthID 워터마크 안내 포함)
- 금칙어 필터: 의약품·"세계 최고"·"국내 유일"·"치료" 등 자동 제거
- 개인정보보호법 / 전자상거래법 준수

---

## 추가 문서

- [`docs/AI_ARCHITECTURE.md`](./docs/AI_ARCHITECTURE.md) — AI 라우터·스트리밍·프로바이더 세팅
- [`AGENTS.md`](./AGENTS.md) — Next.js 16 관련 에이전트 주의사항
- [`.claude/agents/`](./.claude/agents/) — 도메인별 에이전트 정의 (Spec / Test / Backend / AI / DevOps 등)
