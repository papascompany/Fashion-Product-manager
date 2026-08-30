/**
 * Admin Settings API
 * GET  /api/admin/settings  — 현재 플랜별 해상도 설정 조회
 * POST /api/admin/settings  — 플랜별 해상도 설정 저장
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { checkAdmin } from '@/lib/auth/admin-guard'
import { getPlanResolutions, savePlanResolutions } from '@/lib/plan-settings'

// Node Runtime — 단순 CRUD (admin 검증 + app_settings 조회/저장). 외부 API·AI 호출 없음.
// 10s: Supabase 왕복 2회면 충분 (payments/prepare 와 동일 기준)
export const maxDuration = 10

const SettingsSchema = z.object({
  plan_resolution: z.object({
    free:     z.enum(['1K', '2K', '4K']),
    starter:  z.enum(['1K', '2K', '4K']),
    pro:      z.enum(['1K', '2K', '4K']),
    business: z.enum(['1K', '2K', '4K']),
  }),
})

export async function GET() {
  const admin = await checkAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const resolutions = await getPlanResolutions()
  return NextResponse.json({ plan_resolution: resolutions })
}

export async function POST(request: NextRequest) {
  const admin = await checkAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const parsed = SettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { error } = await savePlanResolutions(parsed.data.plan_resolution, admin.userId)
  if (error) {
    return NextResponse.json({ error }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
