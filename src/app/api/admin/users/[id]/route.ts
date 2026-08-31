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
  const { id: rawTargetId } = await params

  // ─── targetId 정규화 (자기 자신 판정의 전제) ─────────────────────────────
  // PostgREST 는 uuid 컬럼 비교 시 텍스트를 uuid 로 캐스트하므로 대문자·중괄호·
  // 하이픈 생략형을 **같은 값**으로 취급한다. 반면 아래 자기 자신 가드는 JS 문자열
  // 비교다. 정규화하지 않으면 `PATCH /api/admin/users/<자기 UUID 를 대문자로>` +
  // `{ban:true}` 가 가드를 통과하면서 .eq('id', ...) 는 자기 행에 매칭돼
  // **스스로 정지 → 복구 불가 락아웃**이 된다.
  // uuid 형식으로 좁혀 중괄호·하이픈생략형을 걸러내고, 비교는 소문자로 통일한다.
  const parsedTargetId = z.string().uuid().safeParse(rawTargetId)
  if (!parsedTargetId.success) {
    return NextResponse.json({ error: '잘못된 사용자 ID 형식입니다.' }, { status: 400 })
  }
  const targetId = parsedTargetId.data.toLowerCase()

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

  // ─── 관리자 락아웃 방지 ───────────────────────────────────────────────────
  // 아래 두 가드는 **단일 요청 안에서** 호출자가 스스로 admin 자격을 잃는 것을 막는다.
  // 호출자는 checkAdmin 을 통과했으므로 활성 admin 이고, 자기 강등·자기 정지를 막으면
  // 순차 처리에서는 admin 이 0명이 되지 않는다.
  //
  // ⚠️ 다만 이것이 "admin 0명 불가"를 보장하지는 않는다. checkAdmin 은 요청마다
  //    독립적으로 role 을 읽으므로, admin A·B 가 **동시에** 서로를 강등/정지하면
  //    양쪽 모두 "타인 대상"으로 판정돼 통과하고 두 UPDATE 가 커밋되어 0명이 될 수
  //    있다(TOCTOU). 앱 레벨 선검사로는 닫히지 않고 DB 레벨 원자적 제약(마지막
  //    활성 admin 보호 트리거)이 필요하다 — 별도 마이그레이션 과제로 남긴다.
  //    현재 복구 경로: Supabase 콘솔에서 role/banned_at 직접 수정.
  const isSelf = targetId === admin.userId.toLowerCase()

  // 본인을 admin → user 로 강등 방지
  if (parsed.data.role === 'user' && isSelf) {
    return NextResponse.json(
      { error: '본인의 admin 권한은 강등할 수 없습니다.' },
      { status: 400 }
    )
  }

  // 본인 정지 방지 — 정지되면 checkAdmin 이 null 을 반환해(admin-guard.ts) 스스로
  // 해제할 수단이 사라진다. 단일 admin 환경에서는 복구 불가능한 락아웃이 된다.
  if (parsed.data.ban && isSelf) {
    return NextResponse.json(
      { error: '본인 계정은 정지할 수 없습니다. 정지 시 스스로 해제할 수 없습니다.' },
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

  // 감사 기록에 실패한 항목 — 응답에 경고로 실어 admin 이 인지하게 한다.
  const auditFailures: string[] = []

  // user_profiles update 가 필요한 경우에만 실행
  if (Object.keys(updates).length > 0) {
    // .select('id') 로 **실제 영향받은 행**을 돌려받는다. 예전에는 영향 행 수를
    // 확인하지 않아, 존재하지 않는 targetId 로도 200 을 주고 audit_log 에는
    // "변경했다"는 가짜 기록이 남았다(아무것도 바뀌지 않았는데도).
    const { data: updated, error } = await supa
      .from('user_profiles')
      .update(updates)
      .eq('id', targetId)
      .select('id')

    if (error) {
      console.error('[admin/users PATCH] update failed:', error)

      // 마이그레이션 022 의 마지막 활성 관리자 보호 트리거에 막힌 경우.
      // 앱의 자기 강등·자기 정지 가드는 단일 요청 안에서만 성립하고, 동시 요청으로
      // 서로를 강등/정지하는 경합은 DB 트리거만 막을 수 있다(TOCTOU).
      // 원문 Postgres 에러를 그대로 노출하지 않고 조치 가능한 메시지로 바꾼다.
      if (error.message?.includes('LAST_ADMIN_PROTECTED')) {
        return NextResponse.json(
          {
            error: '마지막 활성 관리자는 강등하거나 정지할 수 없습니다. 다른 관리자를 먼저 지정하세요.',
            code: 'LAST_ADMIN_PROTECTED',
          },
          { status: 409 }
        )
      }

      // SEC-NEW-03: update 실패 → audit_log 기록 안 함.
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!updated || updated.length === 0) {
      // 대상이 없음 → 변경도 없었으므로 audit_log 도 남기지 않는다.
      return NextResponse.json(
        { error: '대상 사용자를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    // update 성공 → 누적된 audit_log 기록 (각 변경 항목별)
    for (const entry of auditEntries) {
      const logged = await logAdminAction({
        actorId: admin.userId,
        action: entry.action,
        targetId,
        payload: entry.payload,
      })
      if (!logged) auditFailures.push(entry.action)
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
    const logged = await logAdminAction({
      actorId: admin.userId,
      action: 'credits_adjusted',
      targetId,
      payload: { delta },
    })
    if (!logged) auditFailures.push('credits_adjusted')
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

  // 변경 자체는 적용됐지만 감사 기록에 실패한 항목이 있으면 응답에 알린다.
  // (여기서 500 을 주면 admin 이 재시도해 크레딧 조정 등이 이중 적용된다)
  return NextResponse.json({
    ...profile,
    email,
    ...(auditFailures.length > 0
      ? { auditWarning: `변경은 적용됐으나 감사 기록에 실패했습니다: ${auditFailures.join(', ')}` }
      : {}),
  })
}
