'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Check, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  PLAN_PRICES,
  PLAN_CREDITS,
  PLAN_DISPLAY_NAMES,
  TOPUP_PRICES,
  TOPUP_CREDITS,
  formatKRW,
  type Plan,
  type TopupPack,
} from '@/lib/plan-settings-shared'

// ─── 플랜 정의 ────────────────────────────────────────────────────────────────
// UX-02 — 가격/크레딧 수치는 모두 plan-settings-shared 의 SoT 에서 import.
// features 카피는 UI 전용 (변경 시 page.tsx 와 함께 검토할 것).

interface PlanRow {
  id: Plan
  name: string
  price: number
  priceLabel: string
  credits: number
  period: string
  features: string[]
  highlight: boolean
  badge?: string
}

const PLANS: PlanRow[] = [
  {
    id: 'free',
    name: PLAN_DISPLAY_NAMES.free,
    price: PLAN_PRICES.free,
    priceLabel: '무료',
    credits: PLAN_CREDITS.free,
    period: '월',
    features: [
      '가입 시 3 크레딧 제공',
      '간편 모드 전용',
      '1K 해상도',
      '생성 내역 7일 보관',
    ],
    highlight: false,
  },
  {
    id: 'starter',
    name: PLAN_DISPLAY_NAMES.starter,
    price: PLAN_PRICES.starter,
    priceLabel: formatKRW(PLAN_PRICES.starter),
    credits: PLAN_CREDITS.starter,
    period: '월',
    features: [
      `월 ${PLAN_CREDITS.starter}크레딧`,
      '간편 + 스튜디오 모드',
      '최대 2K 해상도',
      '생성 내역 30일 보관',
      'SMS 공유 5건/일',
    ],
    highlight: false,
  },
  {
    id: 'pro',
    name: PLAN_DISPLAY_NAMES.pro,
    price: PLAN_PRICES.pro,
    priceLabel: formatKRW(PLAN_PRICES.pro),
    credits: PLAN_CREDITS.pro,
    period: '월',
    features: [
      `월 ${PLAN_CREDITS.pro}크레딧`,
      '간편 + 스튜디오 모드',
      '4K 해상도 (Nano Banana 2)',
      '생성 내역 무제한 보관',
      'SMS + 카카오 공유 무제한',
      '상세페이지 HTML 내보내기',
    ],
    highlight: true,
    badge: '인기',
  },
  {
    id: 'business',
    name: PLAN_DISPLAY_NAMES.business,
    price: PLAN_PRICES.business,
    priceLabel: formatKRW(PLAN_PRICES.business),
    credits: PLAN_CREDITS.business,
    period: '월',
    features: [
      `월 ${PLAN_CREDITS.business.toLocaleString()}크레딧`,
      '모든 Pro 기능',
      '팀 계정 5명',
      'API 접근 권한',
      '전담 지원',
      '커스텀 브랜딩',
    ],
    highlight: false,
  },
]

// ─── 크레딧 충전 팩 ──────────────────────────────────────────────────────────

interface TopupRow {
  id: TopupPack
  credits: number
  price: number
  priceLabel: string
  highlight: boolean
  badge?: string
}

const TOPUP_PACKS: TopupRow[] = [
  { id: 'topup10',  credits: TOPUP_CREDITS.topup10,  price: TOPUP_PRICES.topup10,  priceLabel: formatKRW(TOPUP_PRICES.topup10),  highlight: false },
  { id: 'topup30',  credits: TOPUP_CREDITS.topup30,  price: TOPUP_PRICES.topup30,  priceLabel: formatKRW(TOPUP_PRICES.topup30),  highlight: true, badge: '추천' },
  { id: 'topup100', credits: TOPUP_CREDITS.topup100, price: TOPUP_PRICES.topup100, priceLabel: formatKRW(TOPUP_PRICES.topup100), highlight: false },
]

interface UsageEvent {
  event_type: string
  credits_used: number
  created_at: string
}

interface Props {
  userId: string
  currentPlan: string
  creditsLeft: number
  email: string
  usageEvents: UsageEvent[]
}

export function BillingClient({ userId, currentPlan, creditsLeft, email, usageEvents }: Props) {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const searchParams = useSearchParams()
  const router = useRouter()

  // ─── Toss 결제 리다이렉트 결과 배너 표시 ────────────────────────────────
  useEffect(() => {
    const status = searchParams.get('status')
    if (!status) return
    if (status === 'success') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBanner({
        kind: 'success',
        text: '결제 요청이 접수되었습니다. 웹훅 확인 후 플랜이 자동 업그레이드됩니다.',
      })
    } else if (status === 'fail') {
      const code = searchParams.get('code')
      const message = searchParams.get('message')
      setBanner({
        kind: 'error',
        text: `결제 실패 — ${message ?? code ?? '알 수 없는 오류'}`,
      })
    }
    router.replace('/billing')
    const t = setTimeout(() => setBanner(null), 7000)
    return () => clearTimeout(t)
  }, [searchParams, router])

  // WH-02 — orderId 와 expected_amount 를 서버에서 발급받아 Toss SDK 에 그대로 전달.
  // 클라이언트 직접 생성 (`plan-${planId}-${userId}-${Date.now()}`) 폐기.
  async function preparePayment(body: { plan: Plan } | { topup: TopupPack }): Promise<{ orderId: string; amount: number } | null> {
    const res = await fetch('/api/payments/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let message = '결제 준비 실패'
      try {
        const j = await res.json()
        if (typeof j.error === 'string') message = j.error
      } catch {
        // ignore
      }
      setBanner({ kind: 'error', text: message })
      return null
    }
    const j = await res.json()
    if (typeof j.orderId !== 'string' || typeof j.amount !== 'number') {
      setBanner({ kind: 'error', text: '결제 준비 응답이 올바르지 않습니다.' })
      return null
    }
    return { orderId: j.orderId, amount: j.amount }
  }

  const handleUpgrade = async (planId: Plan) => {
    if (planId === 'free' || planId === currentPlan) return

    const plan = PLANS.find((p) => p.id === planId)
    if (!plan || plan.price === 0) return

    const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY
    if (!clientKey) {
      setBanner({
        kind: 'error',
        text: 'Toss 클라이언트 키가 설정되지 않아 결제를 진행할 수 없습니다. 관리자에게 문의해주세요.',
      })
      return
    }
    if (typeof window === 'undefined' || !window.TossPayments) {
      setBanner({ kind: 'error', text: 'Toss SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.' })
      return
    }

    setLoadingPlan(planId)
    try {
      // WH-02 — 서버에서 orderId + expected amount 발급
      const prepared = await preparePayment({ plan: planId })
      if (!prepared) return

      const origin = window.location.origin
      const tossPayments = window.TossPayments(clientKey)
      await tossPayments.requestPayment('카드', {
        amount: prepared.amount,
        orderId: prepared.orderId,
        orderName: `ProductCraft AI ${plan.name} 플랜 (월 구독)`,
        customerName: email.split('@')[0] || '구독자',
        customerEmail: email,
        successUrl: `${origin}/billing?status=success`,
        failUrl: `${origin}/billing?status=fail`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '결제 요청 실패'
      setBanner({ kind: 'error', text: message })
    } finally {
      setLoadingPlan(null)
    }
  }

  const handleTopup = async (pack: TopupRow) => {
    const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY
    if (!clientKey) {
      setBanner({ kind: 'error', text: 'Toss 클라이언트 키가 설정되지 않았습니다.' })
      return
    }
    if (typeof window === 'undefined' || !window.TossPayments) {
      setBanner({ kind: 'error', text: 'Toss SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.' })
      return
    }
    const loadingKey = `topup-${pack.id}`
    setLoadingPlan(loadingKey)
    try {
      // WH-02 — 서버에서 orderId + expected amount 발급
      const prepared = await preparePayment({ topup: pack.id })
      if (!prepared) return

      const origin = window.location.origin
      const tossPayments = window.TossPayments(clientKey)
      await tossPayments.requestPayment('카드', {
        amount: prepared.amount,
        orderId: prepared.orderId,
        orderName: `ProductCraft AI 크레딧 ${pack.credits}개 충전`,
        customerName: email.split('@')[0] || '구매자',
        customerEmail: email,
        successUrl: `${origin}/billing?status=success`,
        failUrl: `${origin}/billing?status=fail`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '결제 요청 실패'
      setBanner({ kind: 'error', text: message })
    } finally {
      setLoadingPlan(null)
    }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const EVENT_LABELS: Record<string, string> = {
    quick_generated: '간편 모드 생성',
    studio_generated: '스튜디오 모드 생성',
    thumbnail_generated: '썸네일 생성',
    credit_purchased: '크레딧 충전',
    plan_upgraded: '플랜 업그레이드',
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      {/* 결제 결과 배너 */}
      {banner && (
        <div
          className="mb-6 px-5 py-4 text-[13px]"
          style={{
            border: `1px solid ${banner.kind === 'success' ? '#007d48' : banner.kind === 'error' ? '#d30005' : '#e5e5e5'}`,
            backgroundColor: banner.kind === 'success' ? '#f0faf6' : banner.kind === 'error' ? '#fff5f5' : '#f5f5f5',
            color: banner.kind === 'success' ? '#007d48' : banner.kind === 'error' ? '#d30005' : '#111111',
          }}
        >
          {banner.text}
        </div>
      )}

      {/* 헤더 */}
      <div className="mb-10">
        <h1 className="text-[28px] font-black text-[#111111] mb-2">
          플랜 &amp; 결제
          <span className="text-[#9e9ea0] font-medium text-[16px] ml-3">— {email}</span>
        </h1>
        <div className="flex items-center gap-3 mt-4">
          <div
            className="flex items-center gap-2 px-4 py-2"
            style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }}
          >
            <span className="text-[13px] text-[#707072]">현재 플랜</span>
            <span className="text-[13px] font-black text-[#111111] uppercase">{currentPlan}</span>
          </div>
          <div
            className="flex items-center gap-2 px-4 py-2"
            style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }}
          >
            <span className="text-[13px] text-[#707072]">잔여 크레딧</span>
            <span className="text-[13px] font-black text-[#111111]">{creditsLeft}개</span>
          </div>
        </div>
      </div>

      {/* 플랜 그리드 — 연속 패널 구조 */}
      <div
        className="grid md:grid-cols-4 mb-12"
        style={{ border: '1px solid #e5e5e5' }}
      >
        {PLANS.map((plan, idx) => {
          const isCurrentPlan = plan.id === currentPlan

          return (
            <div
              key={plan.id}
              className="p-6 flex flex-col"
              style={{
                borderRight: idx < PLANS.length - 1 ? '1px solid #e5e5e5' : undefined,
                borderTop: plan.highlight ? '3px solid #111111' : '3px solid transparent',
                backgroundColor: plan.highlight ? '#f5f5f5' : '#ffffff',
              }}
            >
              {/* 인기 배지 */}
              {plan.badge && (
                <div className="mb-3">
                  <span className="px-2 py-0.5 bg-[#111111] text-white text-[9px] font-black tracking-widest">
                    {plan.badge}
                  </span>
                </div>
              )}

              {/* 플랜명 */}
              <div className="mb-4">
                <span className="text-[13px] font-black text-[#111111] uppercase tracking-wide">
                  {plan.name}
                </span>
              </div>

              <div className="mb-1">
                <span className="text-[28px] font-black text-[#111111] tracking-tight">{plan.priceLabel}</span>
                {plan.price > 0 && (
                  <span className="text-[12px] text-[#9e9ea0] ml-1">/{plan.period}</span>
                )}
              </div>
              <p className="text-[12px] text-[#707072] mb-5">
                {plan.id === 'free'
                  ? `가입 시 ${plan.credits.toLocaleString()}크레딧`
                  : `월 ${plan.credits.toLocaleString()}크레딧`}
              </p>

              <ul className="space-y-2.5 flex-1 mb-6">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-[#707072]">
                    <Check className="w-3.5 h-3.5 mt-0.5 text-[#111111] flex-shrink-0" strokeWidth={2.5} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => handleUpgrade(plan.id)}
                disabled={isCurrentPlan || loadingPlan === plan.id}
                className={`w-full rounded-full text-[13px] font-semibold transition-colors ${
                  isCurrentPlan
                    ? 'bg-[#f5f5f5] text-[#9e9ea0] border border-[#e5e5e5] cursor-default'
                    : 'bg-[#111111] text-white hover:bg-[#333333]'
                }`}
              >
                {isCurrentPlan
                  ? '현재 플랜'
                  : loadingPlan === plan.id
                  ? '처리중...'
                  : plan.price === 0
                  ? '무료 플랜'
                  : '업그레이드'}
                {!isCurrentPlan && plan.price > 0 && <ChevronRight className="w-4 h-4 ml-1" />}
              </Button>
            </div>
          )
        })}
      </div>

      {/* 크레딧 충전 (소액 일회성 구매) */}
      <div id="topup" className="mb-12 scroll-mt-20">
        <h2 className="text-[20px] font-black text-[#111111] mb-1">
          크레딧 충전
          <span className="text-[#9e9ea0] font-medium text-[14px] ml-2">— 플랜 변경 없이</span>
        </h2>
        <p className="text-[13px] text-[#707072] mb-6">
          플랜을 유지하면서 크레딧만 추가 구매할 수 있습니다.
        </p>
        <div
          className="grid sm:grid-cols-3"
          style={{ border: '1px solid #e5e5e5' }}
        >
          {TOPUP_PACKS.map((pack, idx) => (
            <div
              key={pack.id}
              className="p-6 flex flex-col"
              style={{
                borderRight: idx < TOPUP_PACKS.length - 1 ? '1px solid #e5e5e5' : undefined,
                borderTop: pack.highlight ? '3px solid #111111' : '3px solid transparent',
                backgroundColor: pack.highlight ? '#f5f5f5' : '#ffffff',
              }}
            >
              {pack.badge && (
                <div className="mb-3">
                  <span className="px-2 py-0.5 bg-[#111111] text-white text-[9px] font-black tracking-widest">
                    {pack.badge}
                  </span>
                </div>
              )}
              <p className="text-[28px] font-black text-[#111111] tracking-tight mb-0.5">{pack.priceLabel}</p>
              <p className="text-[13px] text-[#707072] mb-1">
                {pack.credits.toLocaleString()}크레딧
              </p>
              <p className="text-[12px] text-[#9e9ea0] mb-5">
                크레딧당 {Math.round(pack.price / pack.credits).toLocaleString()}원
              </p>
              <Button
                onClick={() => handleTopup(pack)}
                disabled={loadingPlan === `topup-${pack.id}`}
                className="mt-auto w-full rounded-full text-[13px] font-semibold bg-[#111111] text-white hover:bg-[#333333] transition-colors"
              >
                {loadingPlan === `topup-${pack.id}` ? '처리중...' : '충전하기'}
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* 사용량 내역 */}
      <div>
        <h2 className="text-[20px] font-black text-[#111111] mb-1">
          사용 내역
          <span className="text-[#9e9ea0] font-medium text-[14px] ml-2">— 최근 20건</span>
        </h2>
        <div className="mb-6" />

        {usageEvents.length === 0 ? (
          <div
            className="text-center py-12"
            style={{ border: '1px solid #e5e5e5' }}
          >
            <p className="text-[13px] text-[#9e9ea0]">사용 내역이 없습니다.</p>
          </div>
        ) : (
          <div style={{ border: '1px solid #e5e5e5', overflow: 'hidden' }}>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e5e5', backgroundColor: '#f5f5f5' }}>
                  <th className="text-left px-5 py-3 text-[11px] font-black text-[#9e9ea0] uppercase tracking-widest">항목</th>
                  <th className="text-right px-5 py-3 text-[11px] font-black text-[#9e9ea0] uppercase tracking-widest">크레딧</th>
                  <th className="text-right px-5 py-3 text-[11px] font-black text-[#9e9ea0] uppercase tracking-widest">일시</th>
                </tr>
              </thead>
              <tbody>
                {usageEvents.map((evt, i) => (
                  <tr
                    key={i}
                    className="hover:bg-[#f5f5f5] transition-colors"
                    style={{ borderBottom: i < usageEvents.length - 1 ? '1px solid #e5e5e5' : undefined }}
                  >
                    <td className="px-5 py-3 text-[13px] text-[#111111]">
                      {EVENT_LABELS[evt.event_type] ?? evt.event_type}
                    </td>
                    <td
                      className="px-5 py-3 text-[13px] font-bold text-right"
                      style={{ color: evt.credits_used > 0 ? '#d30005' : '#007d48' }}
                    >
                      {evt.credits_used > 0 ? `-${evt.credits_used}` : `+${Math.abs(evt.credits_used)}`}
                    </td>
                    <td className="px-5 py-3 text-[12px] text-[#9e9ea0] text-right">
                      {formatDate(evt.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
