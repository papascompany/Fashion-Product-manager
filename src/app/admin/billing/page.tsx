/**
 * Admin 결제 / 매출 — usage_events 의 credit_purchased / plan_upgraded 표시
 */

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { TrendingUp, Users } from 'lucide-react'

interface PaymentEvent {
  id: string
  user_id: string
  event_type: string
  credits_used: number
  created_at: string
  metadata: Record<string, unknown> | null
}

interface PlanRevenue {
  plan: string
  count: number
  monthly: number
}

const PLAN_PRICE: Record<string, number> = {
  free: 0,
  starter: 19900,
  pro: 49900,
  business: 149000,
}

async function loadPaymentEvents(): Promise<PaymentEvent[]> {
  const admin = await createAdminClient()
  const { data } = await admin
    .from('usage_events')
    .select('id, user_id, event_type, credits_used, created_at, metadata')
    .in('event_type', ['credit_purchased', 'plan_upgraded'])
    .order('created_at', { ascending: false })
    .limit(100)
  return (data ?? []) as PaymentEvent[]
}

async function loadPlanRevenue(): Promise<PlanRevenue[]> {
  const admin = await createAdminClient()
  const { data } = await admin
    .from('user_profiles')
    .select('plan')
    .is('banned_at', null)
  if (!data) return []
  const counts: Record<string, number> = {}
  for (const row of data) counts[row.plan] = (counts[row.plan] ?? 0) + 1
  return ['free', 'starter', 'pro', 'business'].map((plan) => ({
    plan,
    count: counts[plan] ?? 0,
    monthly: (counts[plan] ?? 0) * (PLAN_PRICE[plan] ?? 0),
  }))
}

export default async function AdminBillingPage() {
  // 페이지 자체 인가 가드 — 레이아웃 + proxy.ts 미들웨어에 더한 심층방어
  // (service_role 로 전체 결제·매출 데이터를 읽으므로 RLS 가 대신 막아주지 않는다).
  await requireAdmin()

  const [events, revenue] = await Promise.all([loadPaymentEvents(), loadPlanRevenue()])

  const mrr = revenue.reduce((sum, r) => sum + r.monthly, 0)
  const totalPayingUsers = revenue
    .filter((r) => r.plan !== 'free')
    .reduce((sum, r) => sum + r.count, 0)

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-1">
          Revenue & Payments
        </div>
        <h1 className="text-[28px] font-black text-[#111111]">결제 / 매출</h1>
      </header>

      {/* 상단 지표 */}
      <div className="grid grid-cols-2 mb-8" style={{ border: '1px solid #e5e5e5' }}>
        <div className="p-5 bg-white" style={{ borderRight: '1px solid #e5e5e5' }}>
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-2">
            <TrendingUp className="w-3 h-3" />
            MRR (구독 합산)
          </div>
          <div className="text-[32px] font-black text-[#111111] tracking-tight">
            ₩{mrr.toLocaleString()}
          </div>
        </div>
        <div className="p-5 bg-white">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-2">
            <Users className="w-3 h-3" />
            유료 가입자
          </div>
          <div className="text-[32px] font-black text-[#111111] tracking-tight">
            {totalPayingUsers}명
          </div>
        </div>
      </div>

      {/* 플랜별 매출 */}
      <section className="mb-8">
        <h2 className="text-[16px] font-black text-[#111111] mb-3">플랜별 매출</h2>
        <div className="grid grid-cols-4" style={{ border: '1px solid #e5e5e5' }}>
          {revenue.map((r, i) => (
            <div
              key={r.plan}
              className="p-4 bg-white"
              style={{
                borderRight: i < revenue.length - 1 ? '1px solid #e5e5e5' : undefined,
                borderTop: r.plan === 'pro' ? '3px solid #111111' : '3px solid transparent',
                backgroundColor: r.plan === 'pro' ? '#f5f5f5' : '#ffffff',
              }}
            >
              <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-1.5">
                {r.plan}
              </div>
              <div className="text-[22px] font-black text-[#111111] mb-0.5">
                {r.count}명
              </div>
              <div className="text-[12px] text-[#707072]">
                ₩{r.monthly.toLocaleString()} / 월
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 최근 결제 이벤트 */}
      <section>
        <h2 className="text-[16px] font-black text-[#111111] mb-3">최근 결제·구독 이벤트 (최대 100건)</h2>
        <div style={{ border: '1px solid #e5e5e5' }}>
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '1px solid #e5e5e5' }}>
                <Th>유저 ID</Th>
                <Th>이벤트</Th>
                <Th align="right">크레딧</Th>
                <Th>메타데이터</Th>
                <Th align="right">시각</Th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-[12px] text-[#9e9ea0]">결제·구독 이벤트 없음</td></tr>
              ) : events.map((e, i) => (
                <tr key={e.id} style={{ borderBottom: i < events.length - 1 ? '1px solid #f5f5f5' : undefined }}>
                  <Td>
                    <span className="text-[11px] font-mono text-[#9e9ea0]">{e.user_id.slice(0, 8)}…</span>
                  </Td>
                  <Td>
                    <span className="text-[12px] font-semibold text-[#111111]">
                      {e.event_type === 'credit_purchased' ? '💳 크레딧 충전' : '⬆️ 플랜 업그레이드'}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="text-[12px] font-bold text-[#111111]">
                      {e.credits_used !== 0 ? `${e.credits_used > 0 ? '-' : '+'}${Math.abs(e.credits_used)}` : '—'}
                    </span>
                  </Td>
                  <Td>
                    <code className="text-[10px] text-[#707072] font-mono">
                      {e.metadata ? JSON.stringify(e.metadata).slice(0, 50) : '—'}
                    </code>
                  </Td>
                  <Td align="right">
                    <span className="text-[11px] text-[#9e9ea0]">{formatDate(e.created_at)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] text-${align}`}
    >
      {children}
    </th>
  )
}

function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <td className={`px-3 py-2 text-${align}`}>{children}</td>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
