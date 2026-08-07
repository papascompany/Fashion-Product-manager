/**
 * 텍스트 파이프라인 API — Edge Runtime + SSE 스트리밍
 *
 * 흐름:
 *   1. project_create
 *   2. analyze (vision)
 *   3. naming (병렬: trends + naming)
 *   4. tagline
 *   5. description (streamObject — 토큰 단위 SSE chunk)
 *   6. complete (크레딧 차감, project status update)
 *
 * 각 단계 결과/진행률은 SSE 이벤트로 즉시 클라이언트에 전달됩니다.
 * Edge Runtime 사용 → 10초 timeout 회피, 응답이 살아있는 한 무제한 스트림 유지.
 *
 * POST /api/generate/pipeline
 * Content-Type: text/event-stream
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { analyzeProductImage } from '@/lib/ai/analyzers/image-analyzer'
import { generateProductNames } from '@/lib/ai/generators/naming-agent'
import { generateTagline } from '@/lib/ai/generators/tagline-agent'
import { streamDescription, generateDescription } from '@/lib/ai/generators/description-agent'
import { fetchTrendKeywords } from '@/lib/trends/trend-fetcher'
import { checkCreditGuard, deductCredits } from '@/lib/credit-guard'
import { UserIntentSchema, type PipelineEvent, type PipelineStep } from '@/lib/ai/types'
import {
  isSafeImageUrl,
  MAX_BASE64_LENGTH,
  sanitizeErrorMessage,
} from '@/lib/security'

// ─── 런타임 설정 ────────────────────────────────────────────────────────────

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

// ─── 스키마 ─────────────────────────────────────────────────────────────────

const PipelineSchema = z.object({
  // SEC-02: isSafeImageUrl로 SSRF(내부망 요청) 방어
  imageUrl: z.string().url().refine(isSafeImageUrl, { message: '허용되지 않는 이미지 URL입니다.' }).optional(),
  // SEC-08: 20MB(base64 ≈ 26.7MB) 초과 본문으로 서버 메모리 고갈 방지
  imageBase64: z.string().max(MAX_BASE64_LENGTH, { message: '이미지 크기가 초과되었습니다. (최대 20MB)' }).optional(),
  mode: z.enum(['quick', 'studio']).default('quick'),
  // v1.1 — 사용자 의도 (L1)
  userIntent: UserIntentSchema.optional(),
})

// ─── SSE 유틸 ───────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

function sseEvent(event: PipelineEvent): Uint8Array {
  // Server-Sent Events 표준: `data: <JSON>\n\n`
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
}

// ─── 핵심 핸들러 ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  // ─── 사전 검증 (스트림 시작 전, 일반 JSON 응답으로 에러 처리) ───────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: '인증 필요' }, { status: 401 })
  }

  let parsed
  try {
    const body = await request.json()
    parsed = PipelineSchema.safeParse(body)
  } catch {
    return Response.json({ error: '잘못된 요청 본문' }, { status: 400 })
  }
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { imageUrl, imageBase64, mode, userIntent } = parsed.data

  // 크레딧 가드 (DEV_BYPASS_CREDITS=true 면 자동 통과)
  const operation = mode === 'studio' ? 'studio_text' : 'quick'
  const guard = await checkCreditGuard({ userId: user.id, operation })
  if (!guard.allowed) {
    return Response.json(
      { error: guard.reason, upgradeUrl: guard.upgradeUrl, guardResult: guard },
      { status: 402 }
    )
  }

  // ─── 여기서부터 스트림 시작 ─────────────────────────────────────────────
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 현재 진행 중인 step — outer catch 가 어느 단계에서 실패했는지 보고용
      let currentStep: PipelineStep | undefined = undefined
      // BIZ-12 — 실패 시 projects.status='failed' 를 위해 projectId 보존
      let createdProjectId: string | undefined = undefined
      const emit = (event: PipelineEvent) => controller.enqueue(sseEvent(event))
      const fail = (step: PipelineStep | undefined, err: unknown, status = 500) => {
        // TYP-11: lib/security.sanitizeErrorMessage 로 중앙화.
        // 개발/프로덕션 분기·DB 코드 마스킹·Error vs object 처리를 단일 구현으로 통합.
        const isDev = process.env.NODE_ENV === 'development'
        let message = sanitizeErrorMessage(err, '처리 중 오류가 발생했습니다.')
        // 마이그레이션 미적용 힌트 (개발 전용)
        if (isDev && /user_intent|column.*does not exist|schema cache/i.test(message)) {
          message += ' — 마이그레이션 007/008 적용이 필요합니다. Supabase SQL Editor 에서 supabase/migrations/007_*.sql 과 008_*.sql 을 실행해주세요.'
        }
        emit({ type: 'error', message, step, status })
      }

      try {
        // ── Step 1: project_create ─────────────────────────────────────────
        currentStep = 'project_create'
        emit({ type: 'progress', step: 'project_create', percent: 5 })
        const { data: project, error: projectErr } = await supabase
          .from('projects')
          .insert({
            user_id: user.id,
            mode,
            product_image_url: imageUrl ?? null,
            status: 'processing',
            // v1.1 — 사용자 의도 저장 (없으면 빈 객체)
            user_intent: userIntent ?? {},
          })
          .select('id')
          .single()
        if (projectErr || !project) {
          fail('project_create', projectErr ?? new Error('no project'), 500)
          return controller.close()
        }
        const projectId = project.id as string
        createdProjectId = projectId
        emit({ type: 'project', projectId })

        // ── Step 2: analyze ────────────────────────────────────────────────
        currentStep = 'analyze'
        emit({ type: 'progress', step: 'analyze', percent: 25 })
        const analysis = await analyzeProductImage({
          imageUrl,
          imageBase64,
          mode,
          userIntent,
        })
        emit({ type: 'analysis', data: analysis })
        await supabase.from('generations').insert({
          project_id: projectId,
          type: 'analyze',
          payload: analysis as unknown as Record<string, unknown>,
        })

        // ── Step 3: trends → naming (순차 — 트렌드 키워드를 상품명 생성에 반영) ─
        // 주의: 병렬 실행 시 naming 에 trendKeywords: [] 가 전달되어 트렌드 반영 불가.
        // 트렌드 fetch 는 캐시 미스 시 ~500ms 이내이므로 순차 처리 허용.
        currentStep = 'naming'
        emit({ type: 'progress', step: 'naming', percent: 50 })
        const { keywords: trendKeywords } = await fetchTrendKeywords({ category: analysis.category })
        const namingResult = await generateProductNames({
            category: analysis.category,
            keywords: analysis.keywords,
            trendKeywords,
            style: analysis.style,
            platform: analysis.platform,
            userIntent,
          })
        emit({
          type: 'names',
          data: namingResult.names,
          trendTags: namingResult.trendTags,
        })
        await supabase.from('generations').insert({
          project_id: projectId,
          type: 'naming',
          payload: { ...namingResult, trendKeywords } as unknown as Record<string, unknown>,
        })

        // ── Step 4: tagline ────────────────────────────────────────────────
        currentStep = 'tagline'
        emit({ type: 'progress', step: 'tagline', percent: 70 })
        const primaryName = namingResult.names[0]?.name ?? analysis.category
        const taglineResult = await generateTagline({
          productName: primaryName,
          category: analysis.category,
          keywords: analysis.keywords,
          mood: analysis.mood,
          userIntent,
        })
        emit({ type: 'tagline', data: taglineResult.tagline })
        await supabase.from('generations').insert({
          project_id: projectId,
          type: 'tagline',
          payload: taglineResult as unknown as Record<string, unknown>,
        })

        // ── Step 5: description (streamObject — 토큰 단위 SSE) ──────────────
        currentStep = 'description'
        emit({ type: 'progress', step: 'description', percent: 80 })
        const descParams = {
          productName: primaryName,
          tagline: taglineResult.tagline,
          category: analysis.category,
          keywords: analysis.keywords,
          mode,
          targetAudience: analysis.targetAudience,
          // 소재 정보 전달 — 소재 섹션 구체화에 활용
          materials: analysis.materials?.length ? analysis.materials : undefined,
          userIntent,
        }

        let description = ''
        let highlights: string[] = []
        let pointKeywords: string[] = []
        try {
          // v1.1 — 1차: streamObject 로 토큰 단위 SSE
          const descStream = streamDescription(descParams)
          let lastEmittedLen = 0
          for await (const partial of descStream.partialObjectStream) {
            const current = partial.description ?? ''
            if (current.length > lastEmittedLen) {
              const chunk = current.slice(lastEmittedLen)
              lastEmittedLen = current.length
              emit({ type: 'description_chunk', text: chunk })
            }
          }
          const finalDesc = await descStream.object
          description = finalDesc.description
          highlights = finalDesc.highlights ?? []
          pointKeywords = finalDesc.pointKeywords ?? []
        } catch (streamErr) {
          // v1.1 — 2차: streamObject 실패 시 비스트리밍 generateObject + fallback 체인
          console.warn('[pipeline] streamDescription failed, retrying with generateDescription:', streamErr)
          const result = await generateDescription(descParams)
          description = result.description
          highlights = result.highlights
          pointKeywords = result.pointKeywords
          // 클라이언트에 전체 텍스트 한 번에 전달
          emit({ type: 'description_chunk', text: description })
        }

        emit({ type: 'description_done', data: description, highlights, pointKeywords })

        await supabase.from('generations').insert({
          project_id: projectId,
          type: 'description',
          payload: { description, charCount: description.length, highlights, pointKeywords } as unknown as Record<string, unknown>,
        })

        currentStep = undefined  // 모든 단계 성공 — outer catch 가 아니라 정상 완료

        // ── 프로젝트 완료 + 크레딧 차감 ───────────────────────────────────
        await supabase
          .from('projects')
          .update({ status: 'done', updated_at: new Date().toISOString() })
          .eq('id', projectId)

        await Promise.all([
          deductCredits({ userId: user.id, operation }),
          supabase.from('usage_events').insert({
            user_id: user.id,
            project_id: projectId,
            event_type: mode === 'studio' ? 'studio_generated' : 'quick_generated',
            credits_used: guard.creditsRequired ?? 1,
            metadata: { mode, elapsedMs: Date.now() - startTime },
          }),
        ])

        emit({ type: 'progress', step: 'description', percent: 100 })
        emit({ type: 'complete', elapsedMs: Date.now() - startTime })
        controller.close()
      } catch (err) {
        console.error(`[/api/generate/pipeline] stream error at step=${currentStep}`, err)

        // BIZ-12 — 부분 실패 시 projects.status='failed' 로 업데이트.
        // (성공 경로에서 status='done' 으로 업데이트하므로 catch 만 'failed' 처리.)
        if (createdProjectId) {
          try {
            await supabase
              .from('projects')
              .update({ status: 'failed', updated_at: new Date().toISOString() })
              .eq('id', createdProjectId)
          } catch (updateErr) {
            console.error('[/api/generate/pipeline] failed to mark project as failed:', updateErr)
          }
        }

        // v1.1 — Supabase 등 비-Error 객체도 안전하게 직렬화
        let message: string
        if (err instanceof Error) {
          message = err.message
        } else if (err && typeof err === 'object') {
          const e = err as { message?: string; code?: string; details?: string; hint?: string }
          message = e.message ?? e.details ?? e.hint ?? JSON.stringify(err)
          if (e.code) message = `[${e.code}] ${message}`
        } else {
          message = String(err)
        }

        // 사용자 친화 메시지 변환 — 어느 단계 + 프로바이더 힌트 포함
        const stepLabel = currentStep ?? 'unknown'
        let userMessage = `[${stepLabel}] ${message}`
        if (/credit_balance|credits.*low|insufficient.*credit|low.*credit.*balance/i.test(message)) {
          // Anthropic 잔액 부족
          userMessage = `[${stepLabel}] Anthropic Claude API 잔액이 부족합니다. ` +
            `https://console.anthropic.com/settings/billing 에서 충전하시거나, ` +
            `Vercel env vars 의 MODEL_${stepLabel.toUpperCase()} 를 google:gemini-2.5-pro 로 전환하세요. ` +
            `원본 에러: "${message.slice(0, 200)}"`
        } else if (/quota|rate.?limit.*exceeded.*free.?tier/i.test(message)) {
          // Google API 할당량 초과
          userMessage = `[${stepLabel}] Google AI API 할당량을 초과했습니다. ` +
            `https://aistudio.google.com/app/apikey 에서 결제 활성화 또는 잠시 후 재시도. ` +
            `원본 에러: "${message.slice(0, 200)}"`
        } else if (/401|unauthorized|invalid.*api.*key|x-api-key/i.test(message)) {
          userMessage = `[${stepLabel}] AI API 키가 유효하지 않습니다. Vercel env vars 확인 필요. 원본 에러: "${message.slice(0, 200)}"`
        } else if (/no object generated|could not parse/i.test(message)) {
          userMessage = `[${stepLabel}] AI 응답을 해석할 수 없었습니다 (1순위·2순위 모델 모두 실패). 다시 시도해주세요. 원본 에러: "${message.slice(0, 200)}"`
        }
        emit({ type: 'error', message: userMessage, step: currentStep })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Nginx/프록시 버퍼링 방지
    },
  })
}
