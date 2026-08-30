import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { generateTagline } from '@/lib/ai/generators/tagline-agent'
import { UserIntentSchema } from '@/lib/ai/types'
import { checkCreditGuard, deductCredits } from '@/lib/credit-guard'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'
// Edge Function 은 route segment 의 maxDuration 이 적용되지 않는다
// (그 설정은 Node 서버리스 함수용). 프로젝트 기본 300s 상속도 Edge 에는 해당하지 않으므로
// 여기서 상한을 선언하지 않는다 — 비용 상한이 필요하면 Node 런타임으로 옮겨야 한다.

const TaglineSchema = z.object({
  productName: z.string().min(1),
  category: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  mood: z.string().optional(),
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
    const parsed = TaglineSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { productName, category, keywords, mood, projectId, userIntent, refinement, parentId } = parsed.data

    // BIZ-07 — 부분재생성 라우트에도 크레딧 가드 (studio_text_refine = 1 크레딧)
    const guard = await checkCreditGuard({ userId: user.id, operation: 'studio_text_refine' })
    if (!guard.allowed) {
      return NextResponse.json(
        { error: guard.reason, code: guard.code, upgradeUrl: guard.upgradeUrl, guardResult: guard },
        { status: 402 }
      )
    }

    const result = await generateTagline({
      productName,
      category,
      keywords,
      mood,
      userIntent,
      refinement,
    })

    if (projectId) {
      await supabase.from('generations').insert({
        project_id: projectId,
        type: 'tagline',
        payload: result as unknown as Record<string, unknown>,
        parent_id: parentId ?? null,
        refinement_prompt: refinement ?? null,
      })
    }

    await deductCredits({ userId: user.id, operation: 'studio_text_refine' })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/generate/tagline]', err)
    return NextResponse.json({ error: '홍보문구 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
