/**
 * T-06, T-06b, T-06c: 썸네일 생성 (Nano Banana 2) 단위 테스트
 *
 * Track 3 — TST-07 fix:
 *   `new NanaBanana2Provider()` 의 생성자가 GOOGLE_GENERATIVE_AI_API_KEY /
 *   SUPABASE_* 누락 시 throw 하던 문제를 해결.
 *   tests/setup.ts 가 모듈 전체를 vi.mock 으로 가로채 더미 generate() 를
 *   반환하므로, 테스트는 인터페이스 호환성만 검증한다.
 */

import { describe, it, expect } from 'vitest'
import type { ImageGenParams } from '@/lib/ai/image/types'

// ─── T-06: 기본 이미지 생성 ────────────────────────────────────────────────

describe('T-06: NanaBanana2Provider.generate', () => {
  it('유효한 파라미터로 이미지 생성 결과를 반환해야 한다', async () => {
    const { NanaBanana2Provider } = await import(
      '@/lib/ai/image/nano-banana2-provider'
    )

    const params: ImageGenParams = {
      referenceImages: ['data:image/png;base64,iVBORw0KGgo='],
      prompt:
        'Keep the exact product appearance intact. White studio background.',
      aspectRatios: ['1:1'],
      count: 1,
      resolution: '2K',
    }

    const provider = new NanaBanana2Provider()
    const result = await provider.generate(params)

    expect(result).toBeDefined()
    expect(result.images).toBeInstanceOf(Array)
    expect(result.images.length).toBe(1)
    expect(result.images[0]).toHaveProperty('url')
    expect(result.images[0]).toHaveProperty('width')
    expect(result.images[0]).toHaveProperty('height')
    expect(result.requestId).toBeTruthy()
  })

  it('IImageGenProvider 인터페이스를 구현해야 한다', async () => {
    const { NanaBanana2Provider } = await import(
      '@/lib/ai/image/nano-banana2-provider'
    )

    const provider = new NanaBanana2Provider()
    expect(typeof provider.generate).toBe('function')
  })
})

// ─── T-06b: 다중 종횡비 생성 ──────────────────────────────────────────────

describe('T-06b: 다중 종횡비 동시 생성', () => {
  it('요청한 모든 종횡비의 이미지를 반환해야 한다', async () => {
    const { NanaBanana2Provider } = await import(
      '@/lib/ai/image/nano-banana2-provider'
    )

    const params: ImageGenParams = {
      referenceImages: ['data:image/png;base64,iVBORw0KGgo='],
      prompt: 'Product studio shot.',
      aspectRatios: ['1:1', '4:5', '9:16', '16:9'],
      count: 1,
      resolution: '2K',
    }

    const provider = new NanaBanana2Provider()
    const result = await provider.generate(params)

    expect(result.images.length).toBe(4)

    const returnedRatios = result.images.map((img) => img.aspectRatio)
    expect(returnedRatios).toContain('1:1')
    expect(returnedRatios).toContain('4:5')
    expect(returnedRatios).toContain('9:16')
    expect(returnedRatios).toContain('16:9')
  })
})

// ─── T-06c: Subject Consistency 검증 (프롬프트 빌더) ─────────────────────

describe('T-06c: Subject Consistency 검증', () => {
  it('Subject Anchor 구문이 프롬프트에 포함되어야 한다', async () => {
    const { buildImagePrompt } = await import('@/lib/ai/image/prompt-builder')

    const layers = {
      subjectAnchor:
        'Keep the exact product appearance, shape, color, logo 100% intact.',
      scene: 'White clean studio background',
      moodStyle: 'Korean e-commerce style, bright, clean',
      composition: 'Center composition, product filling 70% of frame',
    }

    const prompt = buildImagePrompt(layers)

    expect(typeof prompt).toBe('string')
    expect(prompt).toContain('intact')
    expect(prompt.indexOf(layers.subjectAnchor)).toBeLessThan(
      prompt.indexOf(layers.scene)
    )
  })

  it('overlayText가 있을 때 텍스트 오버레이 계층이 추가되어야 한다', async () => {
    const { buildImagePrompt } = await import('@/lib/ai/image/prompt-builder')

    const layers = {
      subjectAnchor: 'Keep product intact.',
      scene: 'Studio background',
      moodStyle: 'Minimal',
      composition: 'Center',
      textOverlay: '신상 20% 할인',
    }

    const prompt = buildImagePrompt(layers)
    expect(prompt).toContain('신상 20% 할인')
  })
})
