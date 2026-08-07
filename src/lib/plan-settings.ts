/**
 * 플랜별 이미지 해상도 설정 헬퍼 — 서버 전용
 *
 * Admin 이 /admin/settings 에서 변경하면 Supabase app_settings 테이블에 반영되고,
 * 모든 이미지 생성 API 라우트는 이 헬퍼를 통해 서버 측 해상도를 결정한다.
 *
 * 클라이언트에서 보낸 resolution 파라미터는 **무시**되고
 * 서버가 플랜에 맞는 해상도를 직접 결정한다.
 *
 * ⚠️ 이 파일은 createAdminClient (서버 전용) 를 사용하므로
 *    클라이언트 컴포넌트에서 import 하지 말 것.
 *    타입/상수만 필요하면 plan-settings-shared.ts 를 import 할 것.
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { Plan, Resolution } from '@/lib/plan-settings-shared'
import { DEFAULT_PLAN_RESOLUTION } from '@/lib/plan-settings-shared'

// 공유 타입/상수를 re-export (서버 코드가 한 파일에서 다 가져올 수 있도록)
export type { Plan, Resolution, PaidPlan, TopupPack } from '@/lib/plan-settings-shared'
export {
  DEFAULT_PLAN_RESOLUTION,
  RESOLUTION_LABELS,
  PLAN_LABELS,
  PLAN_DISPLAY_NAMES,
  PLANS,
  RESOLUTIONS,
  PLAN_PRICES,
  TOPUP_PRICES,
  PLAN_CREDITS,
  TOPUP_CREDITS,
  FREE_INITIAL_CREDITS,
  SMS_DAILY_QUOTA,
  KAKAO_DAILY_QUOTA,
  formatKRW,
  getPlanPriceLabel,
  getTopupPriceLabel,
  FREE_PLAN_COPY,
  PRO_RESOLUTION_COPY,
} from '@/lib/plan-settings-shared'

/**
 * DB에서 플랜별 해상도 설정을 읽어온다.
 * 읽기 실패 시 DEFAULT_PLAN_RESOLUTION 반환.
 */
export async function getPlanResolutions(): Promise<Record<Plan, Resolution>> {
  try {
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'plan_resolution')
      .single()

    if (error || !data?.value) return { ...DEFAULT_PLAN_RESOLUTION }

    return {
      ...DEFAULT_PLAN_RESOLUTION,
      ...(data.value as Partial<Record<Plan, Resolution>>),
    }
  } catch {
    return { ...DEFAULT_PLAN_RESOLUTION }
  }
}

/**
 * 특정 플랜의 해상도를 반환한다.
 */
export async function getResolutionForPlan(plan: Plan): Promise<Resolution> {
  const settings = await getPlanResolutions()
  return settings[plan] ?? DEFAULT_PLAN_RESOLUTION[plan]
}

/**
 * 플랜별 해상도 설정을 DB에 저장한다 (Admin 전용).
 */
export async function savePlanResolutions(
  resolutions: Record<Plan, Resolution>,
  updatedBy: string
): Promise<{ error?: string }> {
  try {
    const admin = await createAdminClient()
    const { error } = await admin
      .from('app_settings')
      .upsert(
        {
          key: 'plan_resolution',
          value: resolutions,
          updated_at: new Date().toISOString(),
          updated_by: updatedBy,
        },
        { onConflict: 'key' }
      )

    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}
