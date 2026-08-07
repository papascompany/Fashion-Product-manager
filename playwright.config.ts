/**
 * Playwright 러너 설정 — Track 3 / TST-02
 *
 * 적용 배경:
 *  - 기존 스펙은 tests/e2e/ 에 위치 (quick-mode / studio-mode).
 *  - Phase 4 D안에서 e2e/ai-fitting.spec.ts 가 별도 e2e/ 디렉토리에 추가됐다.
 *  - playwright.config.ts 가 없어 `pnpm test:e2e` 가 사실상 죽어 있었다.
 *
 * 두 디렉토리(tests/e2e + e2e)를 동시에 잡기 위해 `testMatch` 를 사용한다.
 * (testDir 은 단일 경로만 받으므로 repo 루트 기준 glob 로 합친다.)
 *
 * webServer: `pnpm dev` 가 이미 실행 중이면 재사용, 아니면 띄운다.
 */
import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  // testDir 은 단일 루트만 가능. tests/e2e 와 e2e 둘 다 잡기 위해 testMatch 사용.
  testMatch: ['tests/e2e/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
