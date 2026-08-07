/**
 * Admin 유저 변경 API
 * PATCH /api/admin/users/[id]
 *
 * Body 옵션:
 *   { plan: 'free'|'starter'|'pro'|'business' }  — 플랜 변경
 *   { creditsDelta: number }                     — 크레딧 +/- (양수=추가, 음수=차감)
 *   { ban: true }                                — 계정 정지 (banned_at 설정)
 *   { unban: true }                              — 정지 해제
 *   { role: 'user'|'admin' }                     — 권한 변경
 *
 * 모든 변경은 audit_log 에 기록됨.
 *
 * Track 2 보안 보강:
 *  - SEC-NEW-03: audit_log 는 DB 변경 성공 후에만 기록. (이전 구현은 update 전에
 *    logAdminAction 을 호출해 update 실패해도 가짜 기록이 남는 무결성 결함.)
 *  - DB-05: 크레딧 조정은 admin_adjust_credits RPC 사용 (잔액 부족 시 실패 반환).
 *    legacy add_credits / deduct_credits 호출 폐기 (deduct_credits 는
 *    GREATEST(left - amount, 0) 클램프로 실패가 silent.)
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { checkAdmin, logAdminAction } from '@/lib/auth/admin-guard'
import { createAdminClient } from '@/lib/supabase/server'

export const runtime = 'nodejs' // service role 사용을 위해 Node runtime
export const dynamic = 'force-dynamic'
export const maxDuration = 15

const PatchSchema = z.object({
  plan: z.enum(['free', 'starter', 'pro', 'business']).optional(),
  creditsDelta: z.number().int().min(-10000).max(10000).optional(),
  ban: z.literal(true).optional(),
  unban: z.literal(true).optional(),
  role: z.enum(['user', 'admin']).optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Next 16: params 는 Promise
  const { id: targetId } = await params

  // 권한 확인
  const admin = await checkAdmin()
  if (!admin) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  let parsed
  try {
    const body = await request.json()
    parsed = PatchSchema.safeParse(body)
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const supa = await createAdminClient()

  // 본인을 admin → user 로 강등 방지
  if (parsed.data.role === 'user' && targetId === admin.userId) {
    return NextResponse.json(
      { error: '본인의 admin 권한은 강등할 수 없습니다.' },
      { status: 400 }
    )
  }

  // ─── SEC-NEW-03: DB 변경 → 성공 시에만 audit_log 기록 ─────────────────────
  // 이전 구현은 logAdminAction 을 update 전에 호출해 무결성이 깨졌음.
  // 여기서는 변경할 컬럼을 모은 뒤 update → error 없을 때만 logAdminAction.

  const updates: Record<string, unknown> = {}
  const auditEntries: Array<{
    action: 'plan_changed' | 'credits_adjusted' | 'banned' | 'unbanned' | 'role_changed'
    payload?: Record<string, unknown>
  }> = []

  // 1) 플랜 변경
  if (parsed.data.plan) {
    updates.plan = parsed.data.plan
    auditEntries.push({ action: 'plan_changed', payload: { plan: parsed.data.plan } })
  }

  // 2) 권한 변경
  if (parsed.data.role) {
    updates.role = parsed.data.role
    auditEntries.push({ action: 'role_changed', payload: { role: parsed.data.role } })
  }

  // 3) 정지 / 해제
  if (parsed.data.ban) {
    updates.banned_at = new Date().toISOString()
    auditEntries.push({ action: 'banned' })
  } else if (parsed.data.unban) {
    updates.banned_at = null
    auditEntries.push({ action: 'unbanned' })
  }

  // user_profiles update 가 필요한 경우에만 실행
  if (Object.keys(updates).length > 0) {
    const { error } = await supa.from('user_profiles').update(updates).eq('id', targetId)
    if (error) {
      console.error('[admin/users PATCH] update failed:', error)
      // SEC-NEW-03: update 실패 → audit_log 기록 안 함.
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // update 성공 → 누적된 audit_log 기록 (각 변경 항목별)
    for (const entry of auditEntries) {
      await logAdminAction({
        actorId: admin.userId,
        action: entry.action,
        targetId,
        payload: entry.payload,
      })
    }
  }

  // 4) 크레딧 조정 — DB-05: admin_adjust_credits RPC 사용
  // 잔액보다 큰 차감 시 RPC 가 false 반환 → 409 응답. (legacy deduct_credits 의
  // GREATEST 클램프 + silent success 폐기.)
  if (parsed.data.creditsDelta && parsed.data.creditsDelta !== 0) {
    const delta = parsed.data.creditsDelta
    const { data: ok, error } = await supa.rpc('admin_adjust_credits', {
      p_user_id: targetId,
      p_delta:   delta,
    })
    if (error) {
      console.error('[admin/users PATCH] credit adjust failed:', error)
      // SEC-NEW-03: RPC error → audit_log 기록 안 함.
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (ok === false) {
      // 잔액 부족(차감 실패) — SEC-NEW-03: 실패 시 audit_log 기록 안 함.
      return NextResponse.json(
        { error: '잔액 부족으로 크레딧 조정에 실패했습니다.', code: 'INSUFFICIENT_CREDITS' },
        { status: 409 }
      )
    }
    // 성공 시에만 audit_log
    await logAdminAction({
      actorId: admin.userId,
      action: 'credits_adjusted',
      targetId,
      payload: { delta },
    })
  }

  // 최신 행 반환 — 이메일 join
  const { data: profile } = await supa
    .from('user_profiles')
    .select('id, plan, credits_left, role, banned_at, created_at')
    .eq('id', targetId)
    .single()

  let email: string | null = null
  try {
    const { data: { user } } = await supa.auth.admin.getUserById(targetId)
    email = user?.email ?? null
  } catch {
    // ignore
  }

  return NextResponse.json({ ...profile, email })
}
