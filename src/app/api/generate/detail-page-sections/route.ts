/**
 * 상세페이지 섹션 LLM 자동 조립 API (v1.1 Phase 3.2)
 *
 * 입력: 분석 + 결과 텍스트 → 출력: DetailSection[] (id 는 클라이언트가 부여)
 * Task: 'detail_page' — AI SDK Router 경유.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { generateObject } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { runWithFallback } from '@/lib/ai/router'
import {
  DetailPagePlanSchema,
  UserIntentSchema,
} from '@/lib/ai/types'
import {
  DETAIL_PAGE_PLAN_SYSTEM_PROMPT,
  buildDetailPagePlanPrompt,
} from '@/lib/prompts/detail-page-plan'
import { checkCreditGuard, deductCredits } from '@/lib/credit-guard'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

const PlanRequestSchema = z.object({
  productName: z.string().min(1),
  tagline: z.string(),
  description: z.string(),
  category: z.string(),
  keywords: z.array(z.string()),
  features: z.array(z.string()),
  projectId: z.string().uuid().optional(),
  userIntent: UserIntentSchema.optional(),
  refinement: z.string().max(300).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const body = await request.json()
    const parsed = PlanRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const p = parsed.data

    // BIZ-06 — Pro+ 플랜 게이트 + 2 크레딧 차감 (상세페이지 섹션 자동 조립)
    const guard = await checkCreditGuard({ userId: user.id, operation: 'detail_page' })
    if (!guard.allowed) {
      return NextResponse.json(
        { error: guard.reason, code: guard.code, upgradeUrl: guard.upgradeUrl, guardResult: guard },
        { status: 402 }
      )
    }

    const result = await runWithFallback('detail_page', (model) =>
      generateObject({
        model,
        schema: DetailPagePlanSchema,
        system: DETAIL_PAGE_PLAN_SYSTEM_PROMPT,
        prompt: buildDetailPagePlanPrompt(p),
        maxOutputTokens: 2048,
      })
    )

    // id 부여 (클라이언트의 DetailSection 형식과 호환)
    const sections = result.object.sections.map((s, i) => ({
      ...s,
      id: `s_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
    }))

    // DB 저장
    if (p.projectId) {
      await supabase.from('generations').insert({
        project_id: p.projectId,
        type: 'description', // 별도 type 없으므로 description 으로 묶음 보관
        payload: { detailPageSections: sections, refinement: p.refinement } as unknown as Record<string, unknown>,
        refinement_prompt: p.refinement ?? null,
      })
    }

    // 성공 후 크레딧 차감
    await deductCredits({ userId: user.id, operation: 'detail_page' })

    return NextResponse.json({ sections })
  } catch (err) {
    console.error('[/api/generate/detail-page-sections]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '상세페이지 조립 실패' },
      { status: 500 }
    )
  }
}
