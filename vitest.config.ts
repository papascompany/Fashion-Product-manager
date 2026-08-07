import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Track 3 — TST-01 fix:
 *   - Playwright 스펙(`tests/e2e/**`, `e2e/**`) 을 vitest 수집에서 제외.
 *   - include 를 명시해 단위 테스트만 가로채도록 한다.
 *
 * Track 3 — TST-03 부수 효과:
 *   - tests/setup.ts 가 env 더미 키와 vi.mock 표준 모킹을 주입한다.
 *     본 파일은 setupFiles 만 지정하면 되며, 실제 모킹은 setup.ts 안에서 한다.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],

    // 단위 테스트만 포함 — Playwright/E2E 는 별도 러너 (playwright.config.ts).
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}', 'tests/integration/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'tests/e2e/**',
      'e2e/**',
    ],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
