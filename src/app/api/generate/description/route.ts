import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { generateDescription } from '@/lib/ai/generators/description-agent'
import { UserIntentSchema } from '@/lib/ai/types'
import { checkCreditGuard, deductCredits } from '@/lib/credit-guard'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

const DescriptionSchema = z.object({
  productName: z.string().min(1),
  tagline: z.string().min(1),
  category: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  mode: z.enum(['quick', 'studio']).default('quick'),
  targetAudience: z.string().optional(),
  projectId: z.string().uuid().optional(),
  userIntent: UserIntentSchema.optional(),
  refinement: z.string().max(300).optional(),
  parentId: z.string().uuid().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const body = await request.json()
    const parsed = DescriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const {
      productName, tagline, category, keywords, mode, targetAudience,
      projectId, userIntent, refinement, parentId,
    } = parsed.data

    // BIZ-07 — 부분재생성 라우트에도 크레딧 가드 (studio_text_refine = 1 크레딧)
    const guard = await checkCreditGuard({ userId: user.id, operation: 'studio_text_refine' })
    if (!guard.allowed) {
      return NextResponse.json(
        { error: guard.reason, code: guard.code, upgradeUrl: guard.upgradeUrl, guardResult: guard },
        { status: 402 }
      )
    }

    const result = await generateDescription({
      productName, tagline, category, keywords, mode, targetAudience,
      userIntent, refinement,
    })

    if (projectId) {
      await supabase.from('generations').insert({
        project_id: projectId,
        type: 'description',
        payload: result as unknown as Record<string, unknown>,
        parent_id: parentId ?? null,
        refinement_prompt: refinement ?? null,
      })
    }

    await deductCredits({ userId: user.id, operation: 'studio_text_refine' })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/generate/description]', err)
    return NextResponse.json({ error: '상세설명 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
