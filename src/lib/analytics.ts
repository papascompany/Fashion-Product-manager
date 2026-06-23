// Next 16/Turbopack: dynamic import 도 static 분석으로 client 번들에 끌려오므로
// 'server-only' 가드로 client 컴포넌트에서 import 시 명확한 빌드 에러 발생.
// 호출은 server-side(API route, server component)에서만.
import 'server-only'

/**
 * 경량 분석 이벤트 로거 (운영 강화 ④, server-only)
 *
 * 핵심 액션(생성 시작/완료, 피팅 생성, 크레딧 구매)을 한 줄 호출로 기록한다.
 *
 * 동작
 *  - dev: 항상 `console.log('[analytics]', name, props)` 로 출력.
 *  - props.userId 가 있으면: 기존 `usage_events` 테이블에 best-effort 로 INSERT.
 *  - userId 가 없으면: console 전용 (DB 미기록).
 *  - 어떤 경우에도 에러를 throw 하지 않는다 (요청 흐름을 절대 깨뜨리지 않음).
 *
 * 스키마 메모
 *  - `usage_events` 의 "실제 런타임 컬럼" 은 (user_id, project_id, event_type,
 *     credits_used, metadata) 다. (migration 002 기준 — pipeline/route.ts 가
 *     동일 컬럼으로 insert 함)
 *  - src/types/supabase.ts 의 usage_events 타입은 (kind/cost/tokens) 로 stale 하다.
 *    supabase 서버 클라이언트는 <Database> 제네릭 없이 생성되므로 insert 가
 *    타입 강제되지 않아 런타임 컬럼으로 안전하게 기록할 수 있다.
 *  - 분석 전용 테이블(analytics_events)로 분리하는 것이 장기적으로는 더 깔끔하다 —
 *    follow-up/decisionsNeeded 로 분리.
 *
 * 호출 사이트(생성/피팅/구매 라우트)에 wiring 하는 것은 의도적으로 하지 않았다
 * (해당 파일은 다른 에이전트 소유). wiring 은 follow-up.
 *
 * Edge/Node 양쪽 호환 — createAdminClient 를 dynamic import 하므로 userId 없는
 * 경로(Edge)에서는 Supabase 의존성을 로드하지 않는다.
 */

/** 추적하는 핵심 이벤트. usage_events.event_type 으로 그대로 들어간다. */
export type AnalyticsEvent =
  | 'generation_started'
  | 'generation_completed'
  | 'fitting_created'
  | 'credit_purchase'

export interface AnalyticsProps {
  /** 있으면 usage_events 에 기록, 없으면 console 전용. */
  userId?: string
  /** 연관 프로젝트 (있으면 project_id 로 기록). */
  projectId?: string
  /** 차감/충전된 크레딧 (있으면 credits_used 로 기록). 기본 0. */
  credits?: number
  /** 그 외 임의 속성 — metadata jsonb 로 직렬화. */
  [key: string]: unknown
}

/**
 * 분석 이벤트를 기록한다. 실패해도 절대 throw 하지 않는다 (best-effort).
 *
 * @example
 *   await logEvent('generation_completed', { userId, projectId, credits: 1, mode: 'quick' })
 */
export async function logEvent(
  name: AnalyticsEvent,
  props: AnalyticsProps = {}
): Promise<void> {
  // dev 가시성 — 항상 출력
  if (process.env.NODE_ENV === 'development') {
    console.log('[analytics]', name, props)
  }

  const { userId, projectId, credits, ...rest } = props

  // userId 없으면 console 전용 (DB 미기록)
  if (!userId) return

  try {
    // userId 가 있을 때만 Supabase 를 로드 — Edge 경로 번들 경량화.
    const { createAdminClient } = await import('@/lib/supabase/server')
    const admin = await createAdminClient()

    // 런타임 컬럼(event_type/credits_used/project_id/metadata)으로 기록.
    // supabase 서버 클라이언트는 <Database> 제네릭 없이 생성돼 insert 가 타입 강제되지
    // 않으므로, pipeline/route.ts·webhooks/toss/route.ts 와 동일하게 캐스트 없이 기록.
    await admin.from('usage_events').insert({
      user_id: userId,
      project_id: projectId ?? null,
      event_type: name,
      credits_used: credits ?? 0,
      metadata: rest,
    })
  } catch (err) {
    // best-effort — 분석 실패가 요청을 깨뜨리면 안 됨.
    console.warn('[analytics] logEvent failed (ignored):', err instanceof Error ? err.message : err)
  }
}
