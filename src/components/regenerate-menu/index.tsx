'use client'

/**
 * RegenerateMenu — v1.1 UX Customization L4 (Per-section Regenerate)
 *
 * ↻ 버튼 + 풀다운 메뉴 (프리셋 4종 + 직접 입력 모달)
 *
 * - 프리셋: "같은 의도로 다시" / "더 짧게" / "더 트렌디하게" / "더 고급스럽게" / "더 캐주얼하게"
 * - "직접 입력": 모달 띄워 자연어 보정 지시 입력
 * - onRegenerate(refinement?) 호출 (refinement undefined = 같은 의도로 다시)
 */

import { useState, useRef, useEffect } from 'react'
import { RotateCw, ChevronDown, Loader2, X } from 'lucide-react'

interface RegenerateMenuProps {
  /** 재생성 호출 — refinement undefined 면 "같은 의도로 다시" */
  onRegenerate: (refinement?: string) => Promise<void> | void
  /** 작업 라벨 — 모달 헤더에 "{section}만 다시 생성" 표시 */
  section: string
  disabled?: boolean
  /** 외부에서 진행 중 상태 주입 가능 (예: 다른 작업 로딩 중일 때 비활성화) */
  busy?: boolean
}

const PRESETS = [
  { key: 'same',     label: '같은 의도로 다시', refinement: undefined },
  { key: 'shorter',  label: '더 짧게',          refinement: '더 짧고 임팩트 있게' },
  { key: 'trendy',   label: '더 트렌디하게',    refinement: '요즘 MZ세대 감성으로 더 트렌디하게' },
  { key: 'premium',  label: '더 고급스럽게',    refinement: '프리미엄 브랜드 톤으로 더 고급스럽게' },
  { key: 'casual',   label: '더 캐주얼하게',    refinement: '친근하고 캐주얼한 톤으로' },
] as const

export function RegenerateMenu({ onRegenerate, section, disabled, busy = false }: RegenerateMenuProps) {
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const handlePreset = async (refinement?: string) => {
    setOpen(false)
    setLoading(true)
    try {
      await onRegenerate(refinement)
    } finally {
      setLoading(false)
    }
  }

  const isBusy = busy || loading

  return (
    <>
      <div ref={menuRef} className="relative inline-block">
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={disabled || isBusy}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold text-[#111111] transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }}
          title={`${section}만 다시 생성`}
        >
          {isBusy ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RotateCw className="w-3 h-3" />
          )}
          다시
          <ChevronDown className="w-3 h-3" />
        </button>

        {open && (
          <div
            className="absolute top-full right-0 mt-1 z-30 w-48 bg-white overflow-hidden"
            style={{ border: '1px solid #e5e5e5' }}
          >
            {PRESETS.map((p, i) => (
              <button
                key={p.key}
                onClick={() => handlePreset(p.refinement)}
                className="w-full text-left px-3.5 py-2 text-[12px] text-[#111111] hover:bg-[#f5f5f5] transition-colors"
                style={i < PRESETS.length - 1 ? { borderBottom: '1px solid #f5f5f5' } : undefined}
              >
                {p.label}
              </button>
            ))}
            <div style={{ borderTop: '1px solid #e5e5e5' }} />
            <button
              onClick={() => {
                setOpen(false)
                setCustomOpen(true)
              }}
              className="w-full text-left px-3.5 py-2 text-[12px] font-semibold text-[#111111] hover:bg-[#f5f5f5] transition-colors"
            >
              📝 직접 입력…
            </button>
          </div>
        )}
      </div>

      {customOpen && (
        <CustomRefinementModal
          section={section}
          onClose={() => setCustomOpen(false)}
          onSubmit={async (refinement) => {
            setCustomOpen(false)
            setLoading(true)
            try {
              await onRegenerate(refinement)
            } finally {
              setLoading(false)
            }
          }}
        />
      )}
    </>
  )
}

// ─── 직접 입력 모달 ─────────────────────────────────────────────────────────

function CustomRefinementModal({
  section, onClose, onSubmit,
}: {
  section: string
  onClose: () => void
  onSubmit: (refinement: string) => void
}) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // UX-04 — a11y: panel ref for focus trap
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // UX-04 — a11y: ESC 닫기 + focus trap + body scroll lock
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
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
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [onClose, submitting])

  const handleSubmit = async () => {
    const refined = text.trim()
    if (!refined) return
    setSubmitting(true)
    onSubmit(refined)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="refine-modal-title"
        className="w-full max-w-md bg-white overflow-hidden"
        style={{ border: '1px solid #e5e5e5' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-6 pt-5 pb-4 flex items-start justify-between" style={{ borderBottom: '1px solid #e5e5e5' }}>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">
              Refine
            </div>
            <h3 id="refine-modal-title" className="text-[18px] font-black text-[#111111] mt-0.5">
              {section}만 다시 생성
            </h3>
            <p className="text-[12px] text-[#707072] mt-1">
              어떻게 바꿀까요? 자연어로 자유롭게 적어주세요.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="재생성 모달 닫기"
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
          >
            <X className="w-4 h-4 text-[#707072]" strokeWidth={2.5} />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 300))}
            placeholder="예: 30대 직장인 남성 타겟으로, 좀 더 슬림한 느낌을 강조해서 다시 만들어주세요"
            rows={4}
            disabled={submitting}
            className="w-full p-3 text-[13px] text-[#111111] placeholder:text-[#9e9ea0] leading-relaxed resize-none focus:outline-none"
            style={{ border: '1px solid #cacacb' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#111111')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#cacacb')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-[#9e9ea0]">
            <span>Cmd+Enter 로 제출</span>
            <span>{text.length}/300</span>
          </div>
        </div>

        {/* 액션 */}
        <div
          className="px-6 py-4 flex items-center justify-end gap-2"
          style={{ backgroundColor: '#f5f5f5', borderTop: '1px solid #e5e5e5' }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 h-9 rounded-full text-[12px] font-semibold text-[#707072] hover:text-[#111111] transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || submitting}
            className="px-4 h-9 rounded-full text-[12px] font-semibold text-white bg-[#111111] hover:bg-[#333333] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            {section}만 재생성
          </button>
        </div>
      </div>
    </div>
  )
}
