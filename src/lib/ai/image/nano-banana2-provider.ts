/**
 * NanaBanana2Provider
 * Google Gemini 3.1 Flash Image Preview (내부 코드명: Nano Banana 2)
 *
 * 특징:
 *  - referenceImage 인라인 전달 → Subject Consistency 유지
 *  - candidate_count: 최대 4 (병렬 비율 생성)
 *  - thinking_level: minimal(기본) / high(Pro+)
 *  - 결과 이미지 → Supabase Storage 업로드 후 서명 URL 반환
 *  - SynthID 워터마크 자동 삽입 (Google 정책)
 *
 * v1.1 perf patch:
 *  - URL→base64 변환을 generate() 에서 한 번만 수행 (3비율 3중 fetch 제거)
 *  - 이미지 fetch에 20s 타임아웃 적용
 *  - 개별 Gemini 호출에 65s 타임아웃 적용 (maxDuration=120 기준)
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import type { IImageGenProvider, ImageGenParams, ImageGenResult, AspectRatio } from './types'

// ─── 종횡비 → px 매핑 ────────────────────────────────────────────────────────

const ASPECT_TO_PX: Record<AspectRatio, { width: number; height: number }> = {
  '1:1':  { width: 1024, height: 1024 },
  '4:5':  { width: 819,  height: 1024 },
  '5:4':  { width: 1024, height: 819  },
  '3:4':  { width: 768,  height: 1024 },
  '4:3':  { width: 1024, height: 768  },
  '9:16': { width: 576,  height: 1024 },
  '16:9': { width: 1024, height: 576  },
  '21:9': { width: 1024, height: 439  },
  '1:4':  { width: 256,  height: 1024 },
  '4:1':  { width: 1024, height: 256  },
  '1:8':  { width: 128,  height: 1024 },
  '8:1':  { width: 1024, height: 128  },
}

// ─── 해상도 배율 ─────────────────────────────────────────────────────────────

const RESOLUTION_SCALE: Record<string, number> = {
  '1K': 1.0,
  '2K': 2.0,
  '4K': 4.0,
}

// ─── URL → data URL 변환 헬퍼 ────────────────────────────────────────────────
// Gemini 에 전달하기 전에 한 번만 실행 — generate() 에서 사전 해상(resolve)

async function resolveImageToDataUrl(ref: string, timeoutMs = 20_000): Promise<string> {
  if (ref.startsWith('data:')) return ref  // 이미 data URL
  if (!ref.startsWith('http')) return ref  // 알 수 없는 형식 — 그대로 전달

  // URL → fetch → base64 data URL
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(ref, { signal: controller.signal })
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching image: ${ref}`)
    const buf = await resp.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')
    const mimeType = resp.headers.get('content-type')?.split(';')[0]?.trim() ?? 'image/jpeg'
    return `data:${mimeType};base64,${base64}`
  } finally {
    clearTimeout(timer)
  }
}

// ─── Provider ───────────────────────────────────────────────────────────────

export class NanaBanana2Provider implements IImageGenProvider {
  private genAI: GoogleGenerativeAI
  private supabase: ReturnType<typeof createSupabaseAdminClient>

  constructor() {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set')

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase environment variables are not set')
    }

    this.genAI = new GoogleGenerativeAI(apiKey)
    this.supabase = createSupabaseAdminClient(supabaseUrl, serviceKey)
  }

  async generate(params: ImageGenParams): Promise<ImageGenResult> {
    const {
      referenceImages,
      prompt,
      aspectRatios,
      count,
      resolution,
      thinking = 'minimal',
      seed,
    } = params

    // Nano Banana 2 (Google 2026-02-26 출시) — 개발계획서 8-A.2절 명시 모델
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-image-preview',
    })

    // ── 참조 이미지 사전 해상 ── URL → data URL 변환을 한 번만 실행 ─────────
    // 비율별 generateSingle 에서 각자 fetch 하던 비효율 제거:
    // 3비율 × 2이미지 = 6회 fetch → 1회 사전 fetch 후 공유.
    const resolvedRefs = await Promise.all(
      referenceImages.slice(0, 5).map((ref) =>
        resolveImageToDataUrl(ref).catch((err) => {
          console.warn('[NanaBanana2] ref image resolve failed:', err)
          return ref  // 실패 시 원본 전달 (generateSingle 에서 재시도)
        })
      )
    )

    // 종횡비당 count만큼 생성 (병렬)
    const tasks = aspectRatios.flatMap((ratio) =>
      Array.from({ length: count }, () => ({ ratio }))
    )

    const scale = RESOLUTION_SCALE[resolution] ?? 1.0

    const results = await Promise.allSettled(
      tasks.map(({ ratio }) =>
        this.generateSingle({ model, prompt, referenceImages: resolvedRefs, ratio, scale, thinking, seed })
      )
    )

    const images: ImageGenResult['images'] = []

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        images.push(result.value)
      }
    }

    if (images.length === 0) {
      throw new Error('이미지 생성에 실패했습니다. 모든 요청이 거부되었습니다.')
    }

    return {
      images,
      requestId: `nb2-${Date.now()}`,
      costTokens: images.length * 500, // 추정값
    }
  }

  private async generateSingle(params: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: any
    prompt: string
    referenceImages: string[]
    ratio: AspectRatio
    scale: number
    thinking: string
    seed?: number
  }): Promise<ImageGenResult['images'][number] | null> {
    const { model, prompt, referenceImages, ratio, scale, seed } = params
    const baseDims = ASPECT_TO_PX[ratio] ?? { width: 1024, height: 1024 }
    const width = Math.round(baseDims.width * scale)
    const height = Math.round(baseDims.height * scale)

    try {
      // 참조 이미지 파트 구성 (이미 data URL 로 변환된 상태)
      // Phase 4: multi-reference 지원
      // - 단일 이미지 (썸네일): [제품] 만 전달
      // - 멀티 이미지 (AI Fitting): [제품, 모델] 순서로 전달
      const parts: object[] = []

      for (const ref of referenceImages) {
        if (ref.startsWith('data:')) {
          const [header, data] = ref.split(',')
          const mimeType = header.split(':')[1]?.split(';')[0] ?? 'image/jpeg'
          parts.push({ inlineData: { mimeType, data } })
        } else if (ref.startsWith('http')) {
          // 사전 해상 실패 시 fallback — 15s 타임아웃 적용
          const ctrl = new AbortController()
          const t = setTimeout(() => ctrl.abort(), 15_000)
          try {
            const resp = await fetch(ref, { signal: ctrl.signal })
            const buf = await resp.arrayBuffer()
            const base64 = Buffer.from(buf).toString('base64')
            const mimeType = resp.headers.get('content-type') ?? 'image/jpeg'
            parts.push({ inlineData: { mimeType, data: base64 } })
          } finally {
            clearTimeout(t)
          }
        }
      }

      // 프롬프트 파트
      parts.push({
        text: `${prompt}\n\nGenerate image at ${width}x${height}px for ${ratio} aspect ratio. Preserve the exact product from the reference image — same shape, color, texture, and details.`,
      })

      // ── Gemini 호출 (65s 타임아웃) ──────────────────────────────────────
      // maxDuration=120s 기준 — 여유 55s를 DB 기록·Storage 업로드용으로 확보.
      const timeoutMs = 65_000
      const geminiCall = model.generateContent({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          // 컷 간 상품 일관성 lock seed (전달 시에만) — 모델이 무시해도 무해
          ...(typeof seed === 'number' ? { seed } : {}),
        },
      })
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Gemini timeout after ${timeoutMs / 1000}s (${ratio})`)), timeoutMs)
      )
      const response = await Promise.race([geminiCall, timeoutPromise])

      const candidate = response.response.candidates?.[0]
      if (!candidate) return null

      // 이미지 파트 추출
      for (const part of candidate.content.parts ?? []) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
          const imageUrl = await this.uploadToStorage(
            part.inlineData.data,
            part.inlineData.mimeType,
            ratio
          )
          return { url: imageUrl, width, height, aspectRatio: ratio }
        }
      }

      return null
    } catch (err) {
      console.error(`[NanaBanana2] generateSingle(${ratio}) failed:`, err)
      return null
    }
  }

  private async uploadToStorage(
    base64Data: string,
    mimeType: string,
    ratio: AspectRatio
  ): Promise<string> {
    const ext = mimeType.split('/')[1] ?? 'png'
    const fileName = `thumbnails/${Date.now()}-${ratio.replace(':', 'x')}.${ext}`

    const buffer = Buffer.from(base64Data, 'base64')

    const { error } = await this.supabase.storage
      .from('product-images')
      .upload(fileName, buffer, {
        contentType: mimeType,
        upsert: false,
      })

    if (error) throw new Error(`Storage upload failed: ${error.message}`)

    const { data } = this.supabase.storage
      .from('product-images')
      .getPublicUrl(fileName)

    return data.publicUrl
  }
}
