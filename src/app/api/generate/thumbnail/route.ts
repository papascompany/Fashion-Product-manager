/**
 * 썸네일 생성 API (Sprint 2 — Studio Mode 전용)
 * POST /api/generate/thumbnail
 *
 * 흐름:
 *  1. 인증 확인 + 크레딧 가드 (3크레딧 필요)
 *  2. 이미지 분석 결과로 5계층 프롬프트 조립
 *  3. NanaBanana2Provider로 다중 종횡비 병렬 생성
 *  4. Supabase Storage 저장 + thumbnails 테이블 기록
 *  5. usage_events 기록 + 크레딧 차감
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkCreditGuard } from '@/lib/credit-guard'
import { isSafeImageUrl, MAX_BASE64_LENGTH, extractSafeMimeType } from '@/lib/security'
import { buildImagePrompt, buildPromptLayers } from '@/lib/ai/image/prompt-builder'
import { NanaBanana2Provider } from '@/lib/ai/image/nano-banana2-provider'
import { setImageProvider, getImageProvider } from '@/lib/ai/client'
import type { AspectRatio, Resolution } from '@/lib/ai/image/types'
import { getResolutionForPlan } from '@/lib/plan-settings'
import type { Plan } from '@/lib/plan-settings'

/**
 * BIZ-10 — 썸네일 동적 단가.
 * 기존 고정 3 크레딧 → count × ratios 비례 차감.
 *
 * 정책 (4 단계 — 단가 정책이므로 운영 결정 필요):
 *   1장        → 1 크레딧
 *   2~3장      → 2 크레딧
 *   4~6장      → 3 크레딧 (기존값 유지)
 *   7~12장     → 5 크레딧
 *   13~24장    → 8 크레딧
 *   25~48장    → 12 크레딧
 *
 * 가장 흔한 사용 (1 ratio × 1 count = 1장) 부담을 줄이고, 12 ratios × 4 count = 48장
 * 같은 극단 사용은 비용을 반영하도록 설계.
 */
function thumbnailCredits(totalImages: number): number {
  if (totalImages <= 1) return 1
  if (totalImages <= 3) return 2
  if (totalImages <= 6) return 3
  if (totalImages <= 12) return 5
  if (totalImages <= 24) return 8
  return 12
}

// ─── 스키마 ─────────────────────────────────────────────────────────────────

const ThumbnailSchema = z.object({
  projectId: z.string().uuid(),
  imageUrl: z.string().url().refine(isSafeImageUrl, { message: '허용되지 않는 이미지 URL입니다.' }).optional(),
  imageBase64: z.string().max(MAX_BASE64_LENGTH, { message: '이미지 크기가 초과되었습니다. (최대 20MB)' }).optional(),
  /** 분석 결과 — pipeline에서 받아옴 */
  analysis: z.object({
    category: z.string(),
    colors: z.array(z.string()),
    style: z.string(),
    mood: z.string(),
    keyFeatures: z.array(z.string()),
    keywords: z.array(z.string()),
  }),
  aspectRatios: z
    .array(z.enum(['1:1', '4:5', '5:4', '3:4', '4:3', '9:16', '16:9', '21:9', '1:4', '4:1', '1:8', '8:1']))
    .default(['1:1', '4:5', '9:16', '16:9']),
  /** v1.1 Phase 2 — 핀 처리된 비율 (재생성에서 제외) */
  pinnedAspectRatios: z
    .array(z.enum(['1:1', '4:5', '5:4', '3:4', '4:3', '9:16', '16:9', '21:9', '1:4', '4:1', '1:8', '8:1']))
    .default([]),
  count: z.number().min(1).max(4).default(1),
  resolution: z.enum(['1K', '2K', '4K']).default('2K'),
  /** v1.1 Phase 2 — 핀 외 재생성 시 사용자 보정 지시 */
  refinement: z.string().max(200).optional(),
  /** 상세페이지 컷 오케스트레이션 — 촬영 프리셋 (scene/composition 프리셋 소유) */
  shotPreset: z
    .enum(['flat-lay', 'hanger', 'ghost-mannequin', 'detail-macro', 'hero-object', 'lifestyle'])
    .optional(),
  /** 컷 간 상품 일관성 lock seed (같은 상품 컷 세트에 동일 값 전달) */
  lockSeed: z.number().int().min(0).max(2_147_483_647).optional(),
  /**
   * 마스터 레퍼런스 세트 — 원본(정면) 외 추가 조건화 이미지(디테일·컬러칩).
   * 클라이언트가 원본에서 파생한 data URL. 각 항목은 안전한 https URL 또는
   * 화이트리스트 MIME 의 base64 data URI 여야 한다. provider 가 총 5장으로 캡.
   */
  referenceImages: z
    .array(
      z.string().max(MAX_BASE64_LENGTH).refine(
        (v) => isSafeImageUrl(v) || extractSafeMimeType(v) !== null,
        { message: '허용되지 않는 레퍼런스 이미지입니다.' },
      ),
    )
    .max(4)
    .optional(),
  /** 한글 배지 텍스트 (예: '신상', '20% 할인') */
  overlayText: z.string().max(20).optional(),
  /** 한글 배지 스타일 옵션 (위치·색·모양) */
  overlayBadge: z
    .object({
      position: z
        .enum(['top-right', 'top-left', 'top-center', 'bottom-right', 'bottom-left', 'bottom-center'])
        .optional(),
      color: z.string().max(40).optional(),
      shape: z.enum(['rounded rectangle', 'circle', 'pill', 'ribbon']).optional(),
    })
    .optional(),
})

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    // ─── 인증 ─────────────────────────────────────────────────────────────
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    // ─── 요청 파싱 ────────────────────────────────────────────────────────
    const body = await request.json()
    const parsed = ThumbnailSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const {
      projectId, imageUrl, imageBase64, analysis,
      aspectRatios, pinnedAspectRatios, count,
      overlayText, overlayBadge, refinement,
      shotPreset, lockSeed,
      referenceImages: extraReferenceImages,
    } = parsed.data

    // v1.1 Phase 2 — 핀된 비율 제외 (남은 비율이 없으면 모든 비율 진행 — 안전 fallback)
    const targetRatios = aspectRatios.filter((r) => !pinnedAspectRatios.includes(r))
    const finalRatios = targetRatios.length > 0 ? targetRatios : aspectRatios

    // ─── 서버 측 해상도 결정 (Admin 설정 기반) ───────────────────────────
    // 클라이언트 전송값 무시 — 서버에서 플랜별 해상도를 결정
    const { data: profileRow } = await supabase
      .from('user_profiles')
      .select('plan')
      .eq('id', user.id)
      .single()
    const userPlan = (profileRow?.plan ?? 'free') as Plan
    const resolution = await getResolutionForPlan(userPlan)

    // ─── 크레딧 가드 (BIZ-10: 동적 단가) ──────────────────────────────────
    // 핀 처리 후 실제 생성될 비율 × count 로 비용 계산
    const expectedImages = finalRatios.length * count
    const dynamicCredits = thumbnailCredits(expectedImages)
    const guard = await checkCreditGuard({
      userId: user.id,
      operation: 'studio_thumbnail',
      resolution: resolution as Resolution,
      creditsOverride: dynamicCredits,
    })

    if (!guard.allowed) {
      return NextResponse.json(
        { error: guard.reason, upgradeUrl: guard.upgradeUrl, guardResult: guard },
        { status: 402 }
      )
    }

    // ─── 이미지 프로바이더 초기화 ─────────────────────────────────────────
    try {
      getImageProvider()
    } catch {
      setImageProvider(new NanaBanana2Provider())
    }

    const provider = getImageProvider()

    // ─── 5계층 프롬프트 조립 ──────────────────────────────────────────────
    const layers = buildPromptLayers({
      category: analysis.category,
      colors: analysis.colors,
      style: analysis.style,
      mood: analysis.mood,
      keyFeatures: analysis.keyFeatures,
      keywords: analysis.keywords,
      aspectRatio: finalRatios[0] as AspectRatio,
      overlayText,
      overlayBadge,
      shotPreset,
      // lock seed 가 있는 요청 = 상세페이지 컷 세트 → 일관성 블록 포함.
      // 추가 레퍼런스(마스터 세트)가 오면 프롬프트에 "다중 레퍼런스" 언어를 켠다.
      consistency:
        typeof lockSeed === 'number'
          ? { hasReferenceSet: (extraReferenceImages?.length ?? 0) > 0 }
          : undefined,
    })
    let prompt = buildImagePrompt(layers)
    // v1.1 Phase 2 — refinement 가 있으면 프롬프트 끝에 보정 지시 추가
    if (refinement && refinement.trim()) {
      prompt = `${prompt}\n\nAdditional user refinement: ${refinement.trim()}`
    }

    // ─── 참조 이미지 준비 ─────────────────────────────────────────────────
    // primary(원본=정면)를 맨 앞에, 이어서 마스터 레퍼런스 세트(디테일·컬러칩).
    // provider 가 최대 5장으로 캡하므로 순서상 원본이 항상 우선 조건화된다.
    const referenceImages: string[] = []
    if (imageBase64) referenceImages.push(imageBase64)
    else if (imageUrl) referenceImages.push(imageUrl)

    if (referenceImages.length === 0) {
      return NextResponse.json({ error: '참조 이미지가 필요합니다.' }, { status: 400 })
    }

    if (extraReferenceImages && extraReferenceImages.length > 0) {
      referenceImages.push(...extraReferenceImages)
    }

    // ─── 썸네일 생성 ─────────────────────────────────────────────────────
    const genResult = await provider.generate({
      referenceImages,
      prompt,
      aspectRatios: finalRatios as AspectRatio[],
      count,
      resolution: resolution as Resolution,
      seed: lockSeed,
    })

    // ─── DB 기록 + 크레딧 차감 (단일 원자 트랜잭션) ─────────────────────
    // record_thumbnail_generation RPC: thumbnails INSERT + usage_events INSERT +
    // user_profiles.credits_left UPDATE 를 한 번의 PostgreSQL 트랜잭션으로 처리.
    // 어느 단계든 실패하면 전부 롤백 → 크레딧 이중차감/누락 방지 (BUG-01).
    const elapsed = Date.now() - startTime

    const thumbnailPayload = genResult.images.map((img) => ({
      url: img.url,
      width: img.width,
      height: img.height,
      aspect_ratio: img.aspectRatio,
      resolution,
      prompt,
    }))

    // BIZ-10 — 실제 생성된 이미지 수 기준 단가 재계산 (provider 가 일부 실패할 수도 있으므로)
    const actualCredits = thumbnailCredits(genResult.images.length || expectedImages)

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'record_thumbnail_generation',
      {
        p_user_id:    user.id,
        p_project_id: projectId,
        p_thumbnails: thumbnailPayload,
        p_credits:    actualCredits,
        p_metadata:   {
          count: genResult.images.length,
          resolution,
          aspectRatios,
          elapsedMs: elapsed,
          requestId: genResult.requestId,
          dynamicCredits: actualCredits,
        },
      }
    )

    if (rpcError) {
      console.error('[thumbnail] record_thumbnail_generation RPC failed:', rpcError)
      throw new Error(`DB 기록 실패: ${rpcError.message}`)
    }

    // RPC 반환값에서 삽입된 레코드 추출
    const savedThumbnails = (rpcResult as { records: unknown[] } | null)?.records ?? thumbnailPayload

    console.log(`[thumbnail] Generated ${genResult.images.length} images in ${elapsed}ms`)

    return NextResponse.json({
      thumbnails: savedThumbnails,
      prompt,
      layers,
      creditsAfter: guard.creditsAfter,
      requestId: genResult.requestId,
      elapsedMs: elapsed,
    })
  } catch (err) {
    console.error('[/api/generate/thumbnail]', err)
    const message = err instanceof Error ? err.message : '썸네일 생성 중 오류'

    // Google API 미결제 에러 처리
    if (message.includes('billing') || message.includes('quota') || message.includes('RESOURCE_EXHAUSTED')) {
      return NextResponse.json(
        { error: 'Google GenAI 결제가 활성화되지 않았습니다. GCP 결제 수단을 연결해주세요.', code: 'BILLING_REQUIRED' },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
