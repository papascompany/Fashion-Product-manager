/**
 * AI Fitting API — Phase 4
 * POST /api/generate/ai-fitting
 *
 * 사용자가 업로드한 모델 사진에 원본 제품을 자연스럽게 입혀준 합성 이미지를 생성.
 *
 * 흐름:
 *  1. 인증 + 크레딧 가드 (Pro 이상 + 5크레딧)
 *  2. 모델 이미지를 Supabase Storage 의 ai-fittings/ 폴더에 업로드 (재사용 위해)
 *  3. user_profiles.last_model_image_url 갱신 (다음 fitting 시 재사용 옵션)
 *  4. Nano Banana 2 multi-reference 호출 [제품, 모델]
 *  5. ai_fittings 테이블 기록 + usage_events 기록 + 크레딧 차감
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkCreditGuard, aiFittingCredits } from '@/lib/credit-guard'
import { buildAiFittingPrompt } from '@/lib/prompts/image/ai-fitting'
import { NanaBanana2Provider } from '@/lib/ai/image/nano-banana2-provider'
import { setImageProvider, getImageProvider } from '@/lib/ai/client'
import type { AspectRatio, Resolution } from '@/lib/ai/image/types'
import { getResolutionForPlan } from '@/lib/plan-settings'
import type { Plan } from '@/lib/plan-settings'
import { isSafeImageUrl, MAX_BASE64_LENGTH, extractSafeMimeType } from '@/lib/security'
import { flattenErrorChain } from '@/lib/api-balance'

// Node Runtime — Storage 업로드 + Google SDK
// 120s: 참조이미지 fetch(20s) + 3비율 병렬 Gemini(65s) + Storage업로드·DB기록(35s) 여유
export const maxDuration = 120

// ─── 스키마 ─────────────────────────────────────────────────────────────────

const FittingSchema = z.object({
  projectId: z.string().uuid(),
  /** 원본 제품 이미지 (이미 store 에 있음. URL 또는 base64) */
  // SEC-02: SSRF 방어 — 내부망 URL 차단
  productImageUrl: z.string().url().refine(isSafeImageUrl, { message: '허용되지 않는 이미지 URL입니다.' }).optional(),
  // SEC-08: 20MB 초과 base64 차단
  productImageBase64: z.string().max(MAX_BASE64_LENGTH, { message: '이미지 크기가 초과되었습니다. (최대 20MB)' }).optional(),
  /** 모델 이미지 — 처음 업로드: base64. 재사용: URL (last_model_image_url) */
  modelImageUrl: z.string().url().refine(isSafeImageUrl, { message: '허용되지 않는 이미지 URL입니다.' }).optional(),
  modelImageBase64: z.string().max(MAX_BASE64_LENGTH, { message: '이미지 크기가 초과되었습니다. (최대 20MB)' }).optional(),
  /** D-2: 3장 (1:1, 4:5, 9:16) 기본 */
  aspectRatios: z
    .array(z.enum(['1:1', '4:5', '9:16', '16:9', '4:3', '3:4']))
    .default(['1:1', '4:5', '9:16']),
  resolution: z.enum(['1K', '2K', '4K']).default('2K'),
  /** 분석 결과 일부 (큐레이션 prompt 강화용) */
  category: z.string().default('패션 아이템'),
  productKeyFeatures: z.array(z.string()).default([]),
  /** 자연어 보정 지시 */
  refinement: z.string().max(300).optional(),
  /** 마지막 모델 이미지 자동 저장 여부 — 사용자가 명시적으로 새 모델 사용 시 false */
  saveAsLastModel: z.boolean().default(true),
  /** 상세페이지 컷 세트 — 착장 앵글 배리언트 (전/측/후/라이프스타일) */
  shotVariant: z.enum(['front', 'side', 'back', 'lifestyle']).optional(),
  /** 컷 간 일관성 lock seed — 전달 시 모델 프로필 락 가드레일도 함께 활성화 */
  lockSeed: z.number().int().min(0).max(2_147_483_647).optional(),
})

// ─── 핸들러 ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    // ── 인증 ──────────────────────────────────────────────────────────────
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    // ── 입력 파싱 ─────────────────────────────────────────────────────────
    const body = await request.json()
    const parsed = FittingSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }
    const {
      projectId, productImageUrl, productImageBase64,
      modelImageUrl, modelImageBase64,
      aspectRatios,
      category, productKeyFeatures,
      refinement, saveAsLastModel,
      shotVariant, lockSeed,
    } = parsed.data

    // 제품/모델 이미지 모두 있어야 함
    const productImage = productImageBase64 ?? productImageUrl
    const modelImage = modelImageBase64 ?? modelImageUrl
    if (!productImage) return NextResponse.json({ error: '제품 이미지가 필요합니다.' }, { status: 400 })
    if (!modelImage)   return NextResponse.json({ error: '모델 이미지가 필요합니다.' }, { status: 400 })

    // ── 서버 측 해상도 결정 (Admin 설정 기반) ─────────────────────────────
    // 클라이언트 전송값 무시 — 서버에서 플랜별 해상도를 결정.
    // AI Fitting 은 멀티-레퍼런스 이미지 합성 특성상 4K 는 생성 시간이 너무 길어
    // 504 Timeout 이 발생하므로 최대 2K 로 제한.
    const { data: profileForPlan } = await supabase
      .from('user_profiles')
      .select('plan')
      .eq('id', user.id)
      .single()
    const userPlan = (profileForPlan?.plan ?? 'free') as Plan
    const planResolution = await getResolutionForPlan(userPlan)
    // 4K → 2K 다운그레이드 (AI Fitting 전용 상한선)
    const resolution: Resolution = planResolution === '4K' ? '2K' : (planResolution as Resolution)

    // ── 크레딧 가드 (D안 동적 비용 + Pro 이상) ────────────────────────────
    // 1장=2 / 2장=4 / 3장=5 / 4장+=6 (aiFittingCredits 헬퍼)
    const requiredCredits = aiFittingCredits(aspectRatios.length)
    const guard = await checkCreditGuard({
      userId: user.id,
      operation: 'studio_fitting',
      resolution: resolution as Resolution,
      creditsOverride: requiredCredits,
    })
    if (!guard.allowed) {
      return NextResponse.json(
        { error: guard.reason, upgradeUrl: guard.upgradeUrl, guardResult: guard },
        { status: 402 }
      )
    }

    // ── 모델 이미지를 Storage 에 업로드 (base64 일 때만) ─────────────────
    // 이미 URL 인 경우 재사용이므로 다시 업로드 안 함.
    let persistedModelUrl: string | null = modelImageUrl ?? null
    if (modelImageBase64 && !modelImageUrl) {
      // SEC-04: 사용자가 조작한 MIME 타입으로 SVG 등 XSS 벡터 업로드 차단
      const safeMime = extractSafeMimeType(modelImageBase64)
      if (!safeMime) {
        return NextResponse.json(
          { error: '허용되지 않는 이미지 형식입니다. JPEG, PNG, WebP만 업로드할 수 있습니다.' },
          { status: 400 }
        )
      }
      try {
        const admin = await createAdminClient()
        const mimeType = safeMime
        const ext = mimeType.split('/')[1] ?? 'jpg'
        const data = modelImageBase64.replace(/^data:image\/[a-z0-9+.-]+;base64,/, '')
        const buf = Buffer.from(data, 'base64')
        const path = `${user.id}/${Date.now()}.${ext}`
        const { error: uploadErr } = await admin.storage
          .from('ai-fittings')
          .upload(path, buf, { contentType: mimeType, upsert: false })
        if (uploadErr) {
          console.warn('[ai-fitting] model upload failed (storage may not exist yet):', uploadErr.message)
          // 업로드 실패해도 생성은 진행 (URL 만 비어있게 됨)
        } else {
          const { data: pub } = admin.storage.from('ai-fittings').getPublicUrl(path)
          persistedModelUrl = pub.publicUrl
          // user_profiles.last_model_image_url 갱신
          if (saveAsLastModel) {
            await admin
              .from('user_profiles')
              .update({ last_model_image_url: persistedModelUrl })
              .eq('id', user.id)
          }
        }
      } catch (storageErr) {
        console.warn('[ai-fitting] storage step failed:', storageErr)
        // graceful: storage 실패해도 생성은 진행
      }
    }

    // ── 이미지 프로바이더 초기화 ──────────────────────────────────────────
    try {
      getImageProvider()
    } catch {
      setImageProvider(new NanaBanana2Provider())
    }
    const provider = getImageProvider()

    // ── multi-reference 호출 [제품, 모델] ─────────────────────────────────
    const referenceImages = [productImage, modelImage]

    // 비율별 병렬 생성 — 각 비율마다 prompt 조정
    // 단일 generate() 호출이 내부적으로 비율을 병렬 처리하지만 prompt 가 비율별로 달라야
    // 더 좋은 구도가 나오므로 여기서는 첫 비율의 prompt 를 사용 (provider 가 비율 정보를 활용함)
    const prompt = buildAiFittingPrompt({
      category,
      productKeyFeatures,
      aspectRatio: aspectRatios[0] as AspectRatio,
      refinement,
      shotVariant,
      // lock seed 가 있는 요청 = 상세페이지 컷 세트 → 모델 프로필 락 가드레일 활성화
      modelLock: typeof lockSeed === 'number',
    })

    const genResult = await provider.generate({
      referenceImages,
      prompt,
      aspectRatios: aspectRatios as AspectRatio[],
      count: 1,
      resolution: resolution as Resolution,
      seed: lockSeed,
    })

    if (genResult.images.length === 0) {
      throw new Error('Nano Banana 2 가 결과 이미지를 반환하지 않았습니다.')
    }

    // ── DB 기록 + 크레딧 차감 (단일 원자 트랜잭션) ─────────────────────
    // record_ai_fitting_generation RPC: ai_fittings INSERT + usage_events INSERT +
    // user_profiles.credits_left UPDATE 를 한 번의 PostgreSQL 트랜잭션으로 처리.
    // 어느 단계든 실패하면 전부 롤백 → 크레딧 이중차감/누락 방지 (BUG-01).
    const elapsed = Date.now() - startTime

    const fittingPayload = genResult.images.map((img) => ({
      result_url:      img.url,
      aspect_ratio:    img.aspectRatio,
      width:           img.width,
      height:          img.height,
      model_image_url: persistedModelUrl,
      prompt,
    }))

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'record_ai_fitting_generation',
      {
        p_user_id:    user.id,
        p_project_id: projectId,
        p_fittings:   fittingPayload,
        p_credits:    requiredCredits,
        p_metadata:   {
          count: genResult.images.length,
          aspectRatios,
          resolution,
          elapsedMs: elapsed,
          requestId: genResult.requestId,
        },
      }
    )

    if (rpcError) {
      console.error('[ai-fitting] record_ai_fitting_generation RPC failed:', rpcError)
      throw new Error(`DB 기록 실패: ${rpcError.message}`)
    }

    // RPC 반환값에서 삽입된 레코드 추출
    const saved = (rpcResult as { records: unknown[] } | null)?.records ?? fittingPayload

    console.log(`[ai-fitting] Generated ${genResult.images.length} fittings in ${elapsed}ms`)

    return NextResponse.json({
      fittings: saved,
      modelImageUrl: persistedModelUrl,
      projectId,
      elapsedMs: elapsed,
    })
  } catch (err) {
    console.error('[/api/generate/ai-fitting]', err)
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    // 썸네일 라우트와 동일 이유 — provider 가 전부 실패를 고정 문구로 감싸므로
    // message 만으로는 결제/쿼터/타임아웃을 구분할 수 없다. 분류는 cause 체인으로.
    // ⚠️ diagnostic 은 업스트림 원문을 포함하므로 응답 본문에 싣지 않는다(debug 는 message 유지).
    const diagnostic = flattenErrorChain(err)
    let userMessage = `AI Fitting 실패: ${message}`
    if (/credit_balance|credits.*low|insufficient|billing|RESOURCE_EXHAUSTED/i.test(diagnostic)) {
      // 결제 미활성/잔액 소진은 재시도로 풀리지 않는다 — 조치 가능한 문구로 안내.
      userMessage = 'AI API 크레딧이 부족합니다. Google AI Studio 잔액을 확인해주세요.'
    } else if (/quota|rate.?limit/i.test(diagnostic)) {
      userMessage = 'Google AI API 할당량을 초과했습니다. 잠시 후 다시 시도해주세요.'
    } else if (/timeout/i.test(diagnostic)) {
      userMessage = 'AI Fitting 생성 시간이 초과되었습니다. 잠시 후 다시 시도하거나, 비율을 줄여서 시도해보세요.'
    } else if (/fetch.*image|resolve.*image|HTTP.*fetching/i.test(diagnostic)) {
      userMessage = '제품/모델 이미지를 불러오지 못했습니다. 다시 업로드 후 시도해주세요.'
    }
    return NextResponse.json({ error: userMessage, debug: message }, { status: 500 })
  }
}
