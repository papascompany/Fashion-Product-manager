'use client'

import { useEffect, useRef } from 'react'
import { Zap, ArrowRight, X, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import type { CreditGuardResult } from '@/lib/credit-guard'
import {
  PLAN_PRICES,
  PLAN_CREDITS,
  PLAN_DISPLAY_NAMES,
  formatKRW,
} from '@/lib/plan-settings-shared'

// ─── Plan 업그레이드 정보 ──────────────────────────────────────────────────
// UX-02 — billing-client / 랜딩 / 모달 가격표 일원화. 모든 수치는 SoT 에서 import.

interface PlanRow {
  id: 'starter' | 'pro' | 'business'
  name: string
  price: string
  period: string
  credits: number
  highlight: boolean
  badge?: string
}

const PLANS: PlanRow[] = [
  {
    id: 'starter',
    name: PLAN_DISPLAY_NAMES.starter,
    price: formatKRW(PLAN_PRICES.starter),
    period: '/월',
    credits: PLAN_CREDITS.starter,
    highlight: false,
  },
  {
    id: 'pro',
    name: PLAN_DISPLAY_NAMES.pro,
    price: formatKRW(PLAN_PRICES.pro),
    period: '/월',
    credits: PLAN_CREDITS.pro,
    highlight: true,
    badge: '인기',
  },
  {
    id: 'business',
    name: PLAN_DISPLAY_NAMES.business,
    price: formatKRW(PLAN_PRICES.business),
    period: '/월',
    credits: PLAN_CREDITS.business,
    highlight: false,
  },
]

// ─── Props ──────────────────────────────────────────────────────────────────

interface CreditGuardModalProps {
  open: boolean
  onClose: () => void
  /** checkCreditGuard() 반환값 */
  guardResult: CreditGuardResult
  /** 크레딧 부족 vs 플랜 미달 구분 */
  reason: 'insufficient_credits' | 'plan_required'
  /** 현재 사용자 크레딧 */
  creditsLeft?: number
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────

export function CreditGuardModal({
  open,
  onClose,
  guardResult,
  reason,
  creditsLeft = 0,
}: CreditGuardModalProps) {
  // UX-04 — a11y: ESC 키 + focus trap + 초기 focus + body scroll lock
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    // 첫 focusable 에 포커스
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        )
        if (focusable.length === 0) return
        const firstEl = focusable[0]
        const lastEl = focusable[focusable.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey && active === firstEl) {
          e.preventDefault()
          lastEl.focus()
        } else if (!e.shiftKey && active === lastEl) {
          e.preventDefault()
          firstEl.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    // body scroll lock
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const isCreditsIssue = reason === 'insufficient_credits'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* Overlay + Panel */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="credit-guard-title"
          aria-describedby="credit-guard-desc"
          className="relative w-full max-w-lg bg-white overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 상단 다크 배너 */}
          <div className="px-8 pt-8 pb-10" style={{ backgroundColor: '#111111' }}>
            <div className="flex items-start justify-between">
              <div
                className="w-12 h-12 flex items-center justify-center mb-4"
                style={{ backgroundColor: '#1c1c1c' }}
              >
                {isCreditsIssue ? (
                  <Zap className="w-6 h-6 text-white" strokeWidth={2} />
                ) : (
                  <CreditCard className="w-6 h-6 text-white" strokeWidth={2} />
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="모달 닫기"
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#1c1c1c] transition-colors"
              >
                <X className="w-4 h-4 text-white" strokeWidth={2.5} />
              </button>
            </div>

            <h2 id="credit-guard-title" className="text-[24px] font-black text-white">
              {isCreditsIssue ? '크레딧이 부족해요' : '플랜 업그레이드 필요'}
            </h2>
            <p id="credit-guard-desc" className="mt-1 text-[#9e9ea0] text-[13px] leading-relaxed">
              {isCreditsIssue
                ? `현재 잔여 크레딧: ${creditsLeft}개${guardResult.creditsRequired ? ` · 필요: ${guardResult.creditsRequired}개` : ''}`
                : guardResult.reason ?? '이 기능은 상위 플랜에서 이용할 수 있습니다.'}
            </p>
          </div>

          {/* 플랜 카드 */}
          <div className="px-8 pt-6 pb-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-4">
              플랜 선택
            </p>
            <div style={{ border: '1px solid #e5e5e5' }}>
              {PLANS.map((plan, idx) => (
                <a
                  key={plan.id}
                  href="/billing"
                  className="flex items-center justify-between px-5 py-4 hover:bg-[#f5f5f5] transition-colors"
                  style={{
                    borderBottom: idx < PLANS.length - 1 ? '1px solid #e5e5e5' : undefined,
                    borderTop: plan.highlight ? '3px solid #111111' : '3px solid transparent',
                    backgroundColor: plan.highlight ? '#f5f5f5' : '#ffffff',
                  }}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-[#111111]">
                        {plan.name}
                      </span>
                      {plan.badge && (
                        <span className="px-1.5 py-0.5 bg-[#111111] text-white text-[9px] font-black tracking-widest">
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <span className="text-[12px] text-[#707072]">
                      월 {plan.credits.toLocaleString()}크레딧
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[18px] font-black text-[#111111]">{plan.price}</span>
                    <span className="text-[12px] text-[#9e9ea0]">{plan.period}</span>
                    <ArrowRight className="w-4 h-4 text-[#9e9ea0] ml-1" />
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* 하단 버튼 */}
          <div className="px-8 pb-8 pt-4 flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 rounded-full text-[13px] font-semibold border-[#cacacb] text-[#707072] hover:border-[#111111]"
            >
              나중에
            </Button>
            <a
              href="/billing"
              className="flex-1 rounded-full bg-[#111111] text-white font-semibold hover:bg-[#333333] inline-flex items-center justify-center px-4 py-2 text-[13px] transition-colors"
            >
              플랜 업그레이드 <ArrowRight className="w-4 h-4 ml-1.5" />
            </a>
          </div>

          {/* 소액 크레딧 구매 링크 */}
          {isCreditsIssue && (
            <div className="px-8 py-4 text-center" style={{ borderTop: '1px solid #e5e5e5' }}>
              <a
                href="/billing#topup"
                className="text-[12px] text-[#9e9ea0] hover:text-[#111111] underline transition-colors"
              >
                플랜 변경 없이 크레딧만 충전하기 →
              </a>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
