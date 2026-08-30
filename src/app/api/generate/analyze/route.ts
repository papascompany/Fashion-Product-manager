import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { analyzeProductImage } from '@/lib/ai/analyzers/image-analyzer'
import { UserIntentSchema } from '@/lib/ai/types'
import { isSafeImageUrl, MAX_BASE64_LENGTH } from '@/lib/security'

// Edge Runtime — 10초 timeout 회피
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
// Edge Function 은 route segment 의 maxDuration 이 적용되지 않는다
// (그 설정은 Node 서버리스 함수용). 프로젝트 기본 300s 상속도 Edge 에는 해당하지 않으므로
// 여기서 상한을 선언하지 않는다 — 비용 상한이 필요하면 Node 런타임으로 옮겨야 한다.

const AnalyzeSchema = z.object({
  imageUrl: z.string().url().refine(isSafeImageUrl, { message: '허용되지 않는 이미지 URL입니다.' }).optional(),
  imageBase64: z.string().max(MAX_BASE64_LENGTH, { message: '이미지 크기가 초과되었습니다. (최대 20MB)' }).optional(),
  projectId: z.string().uuid().optional(),
  mode: z.enum(['quick', 'studio']).default('quick'),
  // v1.1 — 의도 / 보정 / 변형 트리
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
    const parsed = AnalyzeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { imageUrl, imageBase64, projectId, mode, userIntent, refinement, parentId } = parsed.data

    const result = await analyzeProductImage({
      imageUrl,
      imageBase64,
      mode,
      userIntent,
      refinement,
    })

    // DB 저장 (projectId 있을 때) — v1.1: parent_id / refinement_prompt 기록
    if (projectId) {
      await supabase.from('generations').insert({
        project_id: projectId,
        type: 'analyze',
        payload: result as unknown as Record<string, unknown>,
        parent_id: parentId ?? null,
        refinement_prompt: refinement ?? null,
      })
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/generate/analyze]', err)
    return NextResponse.json({ error: '분석 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
