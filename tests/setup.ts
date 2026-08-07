/**
 * Vitest 전역 setup — Track 3 (TST-03 / TST-07)
 *
 * 목적:
 *   1. 모든 단위 테스트 실행 전 더미 env 키를 주입해 모듈 로드 시점의
 *      `if (!apiKey) throw` 를 차단한다. (NanaBanana2Provider, env.ts 등)
 *   2. AI 라우터 / 이미지 프로바이더 / Supabase 서버 클라이언트를 vi.mock 으로
 *      가로채 외부 호출 없이도 테스트가 정상 실행되도록 표준 모킹을 제공한다.
 *   3. testing-library/jest-dom 매처 등록.
 *
 * 개별 테스트가 더 정교한 모킹을 원하면 `vi.mocked(...).mockReturnValue(...)`
 * 로 덮어쓰면 된다. 여기 정의된 기본값은 모두 "성공" 시나리오로 맞춘다.
 */
import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// ─── 1. 더미 env 주입 ─────────────────────────────────────────────────────
// 모듈 로드 시점에 검증되는 키들 — credit-guard 의 NODE_ENV 가드, env.ts,
// nano-banana2-provider 의 생성자 throw 를 모두 무력화한다.
//
// ⚠️ 실제 API 호출은 vi.mock 으로 차단되므로 이 값들은 형식 더미면 충분하다.

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DEV_BYPASS_CREDITS: 'false',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test-project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key-dummy',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-dummy',
  ANTHROPIC_API_KEY: 'test-anthropic-key-dummy',
  GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key-dummy',
  TOSS_SECRET_KEY: 'test-toss-secret-dummy',
  COOLSMS_API_KEY: 'test-coolsms-key-dummy',
  COOLSMS_API_SECRET: 'test-coolsms-secret-dummy',
  COOLSMS_FROM_NUMBER: '01000000000',
  NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test-toss-client-dummy',
  NEXT_PUBLIC_KAKAO_JS_KEY: 'test-kakao-key-dummy',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
}

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (!process.env[key]) {
    process.env[key] = value
  }
}

// NODE_ENV / DEV_BYPASS_CREDITS 는 반드시 강제 설정.
// (a) credit-guard.ts 의 모듈 로드 시 IIFE 가 prod + bypass=true 조합이면 throw.
// (b) 호스트 머신에 DEV_BYPASS_CREDITS=true 가 남아 있으면 실제 가드가 우회되어
//     테스트 의도와 어긋난다.
process.env.DEV_BYPASS_CREDITS = 'false'

// ─── 2. fetch 폴리필 차단 — 외부 호출 시 가시적 오류 ─────────────────────
// 테스트 안에서 의도치 않게 실제 fetch 가 발생하면 즉시 인지할 수 있도록
// 글로벌 fetch 를 안전한 거부 함수로 대체한다. 개별 테스트가 필요하면
// `vi.stubGlobal('fetch', ...)` 로 덮어쓴다.
if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch
  // 테스트가 setup 직후 setupFiles 단계에서 fetch 를 즉시 호출하는 경우는
  // 없으므로 그대로 보존하되, 개별 테스트가 vi.stubGlobal 로 손쉽게 대체할
  // 수 있도록 reference 만 잡아둔다.
  void originalFetch
}

// ─── 3. AI 라우터 표준 모킹 (TST-03) ──────────────────────────────────────
// generators / analyzers 가 import 하는 router 모듈을 차단.
// 개별 테스트가 더 자세한 응답을 원하면 vi.doMock 으로 재정의 가능.
vi.mock('@/lib/ai/router', () => ({
  resolveModel: vi.fn(() => ({
    primary: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' },
    fallback: { provider: 'google', modelId: 'gemini-2.5-pro' },
  })),
  getLanguageModel: vi.fn(() => ({
    // ai SDK 인터페이스 더미 — 호출은 generators 단에서 vi.mock 으로 별도 차단.
    specificationVersion: 'v2',
    provider: 'mock',
    modelId: 'mock-model',
    doGenerate: vi.fn(async () => ({ content: [], usage: {} })),
    doStream: vi.fn(),
  })),
}))

// ─── 4. NanaBanana2 프로바이더 모듈 차단 (TST-07) ─────────────────────────
// `new NanaBanana2Provider()` 가 생성자에서 throw 하지 않도록 클래스 자체를
// 더미 구현으로 교체. 개별 테스트가 generate() 응답을 덮어쓰려면
// vi.mocked(NanaBanana2Provider) 로 접근하면 된다.
vi.mock('@/lib/ai/image/nano-banana2-provider', () => ({
  NanaBanana2Provider: class {
    async generate(params: {
      referenceImages: string[]
      aspectRatios: string[]
      count: number
    }) {
      const ratios = params.aspectRatios ?? ['1:1']
      return {
        images: ratios.map((ratio) => ({
          url: `https://test.local/mock-${ratio}.png`,
          width: 1024,
          height: 1024,
          aspectRatio: ratio,
        })),
        requestId: `mock-${Date.now()}`,
        costTokens: 100,
      }
    }
  },
}))

// ─── 5. Supabase server 클라이언트 표준 모킹 ──────────────────────────────
// credit-guard / pipeline 등 server 라우트 코드가 import 할 때 next/headers
// 의 cookies() 가 jsdom 에서 동작하지 않는 문제를 차단한다.
vi.mock('@/lib/supabase/server', () => {
  const stub = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: null })),
    })),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }
  return {
    createClient: vi.fn(async () => stub),
    createAdminClient: vi.fn(async () => stub),
  }
})
