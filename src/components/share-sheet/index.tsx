'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Link2, Check, Share2, X, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ─── Props ──────────────────────────────────────────────────────────────────

interface ShareSheetProps {
  open: boolean
  onClose: () => void
  projectId: string
  productName: string
  tagline: string
  thumbnailUrl?: string
}

type ShareMethod = 'sms' | 'kakao' | 'link'

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function ShareSheet({
  open,
  onClose,
  projectId,
  productName,
  tagline,
  thumbnailUrl,
}: ShareSheetProps) {
  const [activeMethod, setActiveMethod] = useState<ShareMethod | null>(null)
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // UX-06 — 카카오 SDK 미초기화 시 사용자에게 명시적 fallback 토스트
  const [kakaoFallbackNote, setKakaoFallbackNote] = useState<string | null>(null)
  // UX-04 — a11y: ESC + focus trap
  const panelRef = useRef<HTMLDivElement>(null)

  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${projectId}`

  /**
   * 공유 기록 등록 — /share/[projectId] 페이지의 공개 게이트 근거가 된다.
   *
   * 공유 페이지는 `shares` 행이 있어야만 렌더된다(소유자가 공유한 적 없는 프로젝트가
   * URL 추측만으로 열리던 문제를 막기 위함). 따라서 링크 복사·카카오 공유도
   * SMS 와 마찬가지로 먼저 이 기록을 남겨야 수신자가 링크를 열 수 있다.
   *
   * 실패하면 죽은 링크(404)를 사용자 손에 쥐여주게 되므로 공유 자체를 중단한다.
   */
  const registerShare = async (method: 'link' | 'kakao'): Promise<boolean> => {
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, projectId, productName, tagline, shareUrl }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(typeof data.error === 'string' ? data.error : '공유 링크 준비에 실패했습니다.')
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '공유 링크 준비에 실패했습니다.')
      return false
    }
  }

  const handleCopyLink = async () => {
    setError(null)
    setLoading(true)
    try {
      if (!(await registerShare('link'))) return
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } finally {
      setLoading(false)
    }
  }

  const handleSMS = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phone.trim()) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'sms',
          projectId,
          phone,
          productName,
          tagline,
          shareUrl,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'SMS 발송 실패')
      }

      setSent(true)
      setTimeout(() => { setSent(false); setActiveMethod(null) }, 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : '발송 실패')
    } finally {
      setLoading(false)
    }
  }

  const handleKakao = async () => {
    setError(null)
    setLoading(true)
    // 공유 기록을 먼저 남겨야 수신자가 링크를 열 수 있다 (registerShare 주석 참조).
    // 카카오 SDK 미초기화 시의 링크 복사 fallback 도 같은 기록을 재사용하므로
    // 여기서 한 번만 등록하고, fallback 에서는 재등록하지 않는다.
    const registered = await registerShare('kakao')
    setLoading(false)
    if (!registered) return

    if (typeof window !== 'undefined' && window.Kakao?.isInitialized()) {
      window.Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title: productName,
          description: tagline,
          imageUrl: thumbnailUrl,
          link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
        },
        buttons: [
          { title: '상품 보러가기', link: { mobileWebUrl: shareUrl, webUrl: shareUrl } },
        ],
      })
      setKakaoFallbackNote(null)
    } else {
      // UX-06 — SDK 미초기화 시 명시적 안내 + 링크 복사 fallback
      // 공유 기록은 위에서 이미 남겼으므로 여기서는 클립보드 복사만 한다(중복 등록 방지).
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
      setKakaoFallbackNote('카카오 공유 준비 중입니다. 대신 링크를 복사했어요.')
    }
  }

  // 카카오 fallback 메모는 5초 후 자동 dismiss
  useEffect(() => {
    if (!kakaoFallbackNote) return
    const t = setTimeout(() => setKakaoFallbackNote(null), 5000)
    return () => clearTimeout(t)
  }, [kakaoFallbackNote])

  // UX-04 — a11y: ESC 닫기 + focus trap + body scroll lock
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
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
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-sheet-title"
        className="relative w-full max-w-sm bg-white overflow-hidden"
        style={{ border: '1px solid #e5e5e5' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 핸들 바 (모바일) */}
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[#e5e5e5]" />
        </div>

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4" style={{ borderBottom: '1px solid #e5e5e5' }}>
          <div>
            <h2 id="share-sheet-title" className="text-[18px] font-black text-[#111111]">공유하기</h2>
            <p className="text-[12px] text-[#9e9ea0] mt-0.5 truncate max-w-[220px]">
              {productName}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="공유 시트 닫기"
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
          >
            <X className="w-4 h-4 text-[#707072]" strokeWidth={2.5} />
          </button>
        </div>

        {/* UX-06 — 카카오 SDK 미초기화 fallback 토스트 */}
        {kakaoFallbackNote && (
          <div
            className="px-6 py-2.5 flex items-start gap-2"
            role="status"
            aria-live="polite"
            style={{ backgroundColor: '#fff9e6', borderBottom: '1px solid #f5c430' }}
          >
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: '#b45309' }} />
            <p className="text-[12px] text-[#111111] flex-1">{kakaoFallbackNote}</p>
          </div>
        )}

        {/* 공유 버튼 그리드 */}
        {!activeMethod && (
          <div
            className="grid grid-cols-3"
            style={{ borderBottom: '1px solid #e5e5e5' }}
          >
            <ShareButton
              icon={<MessageSquare className="w-5 h-5" />}
              label="문자"
              sublabel="CoolSMS"
              borderRight
              onClick={() => setActiveMethod('sms')}
            />
            <ShareButton
              icon={
                <div className="w-5 h-5 rounded-full bg-[#f5c430] flex items-center justify-center">
                  <span className="text-[10px] font-black text-[#111111]">K</span>
                </div>
              }
              label="카카오톡"
              sublabel="OG 카드"
              borderRight
              onClick={handleKakao}
            />
            <ShareButton
              icon={copied ? <Check className="w-5 h-5" style={{ color: '#007d48' }} /> : <Link2 className="w-5 h-5" />}
              label={copied ? '복사됨!' : '링크 복사'}
              sublabel="클립보드"
              onClick={handleCopyLink}
            />
          </div>
        )}

        {/* SMS 폼 */}
        {activeMethod === 'sms' && (
          <form onSubmit={handleSMS} className="px-6 py-5 space-y-4" style={{ borderBottom: '1px solid #e5e5e5' }}>
            <div className="space-y-1.5">
              <Label className="text-[13px] font-semibold text-[#111111]">휴대폰 번호</Label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                required
                autoFocus
                className="rounded-none border-[#cacacb] focus-visible:ring-0 focus-visible:border-[#111111] h-10 text-[13px]"
              />
            </div>
            {error && (
              <p className="text-[12px]" style={{ color: '#d30005' }}>{error}</p>
            )}
            {sent && (
              <p className="text-[12px] flex items-center gap-1" style={{ color: '#007d48' }}>
                <Check className="w-3.5 h-3.5" /> 문자 발송 완료!
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setActiveMethod(null)}
                className="flex-1 rounded-full text-[13px] font-semibold border-[#cacacb] text-[#111111] hover:border-[#111111]"
              >
                취소
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-full bg-[#111111] text-white text-[13px] font-semibold hover:bg-[#333333]"
              >
                {loading ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />발송 중</> : '발송'}
              </Button>
            </div>
          </form>
        )}

        {/* 링크 미리보기 */}
        <div className="px-6 py-3" style={{ backgroundColor: '#f5f5f5' }}>
          <div className="flex items-center gap-2">
            <Share2 className="w-3.5 h-3.5 text-[#9e9ea0] flex-shrink-0" />
            <p className="text-[11px] text-[#9e9ea0] truncate">{shareUrl}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 서브 컴포넌트 ──────────────────────────────────────────────────────────

function ShareButton({
  icon,
  label,
  sublabel,
  borderRight,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  sublabel?: string
  borderRight?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-5 hover:bg-[#f5f5f5] transition-colors"
      style={{
        backgroundColor: '#ffffff',
        borderRight: borderRight ? '1px solid #e5e5e5' : undefined,
      }}
    >
      <div className="text-[#111111]">{icon}</div>
      <div className="text-center">
        <div className="text-[13px] font-semibold text-[#111111]">{label}</div>
        {sublabel && <div className="text-[10px] text-[#9e9ea0]">{sublabel}</div>}
      </div>
    </button>
  )
}

// Kakao SDK 타입 확장은 src/components/kakao-sdk-loader에서 관리
