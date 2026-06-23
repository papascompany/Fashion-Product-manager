'use client'

/**
 * ThumbnailMaskEditor — v1.1 Phase 3.4 (G4-7)
 *
 * Canvas 위에 사각형 영역 드래그로 선택 → 9-grid 위치 라벨 변환 → 자연어 보정 prompt 에 주입.
 *
 * 현재 Nano Banana 2 SDK 가 mask PNG 입력을 지원하지 않으므로,
 * 영역 좌표는 위치 자연어 hint 로 변환되어 prompt 에 결합됩니다.
 * (정식 inpainting API 도입 시 mask 첨부로 확장 가능)
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { Loader2, X } from 'lucide-react'

interface ThumbnailMaskEditorProps {
  imageUrl: string
  aspectRatio: string
  onClose: () => void
  onApply: (refinement: string) => Promise<void>
}

interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

const GRID_LABELS_3x3 = [
  ['좌상단', '상단 중앙', '우상단'],
  ['좌측 중앙', '정중앙',   '우측 중앙'],
  ['좌하단', '하단 중앙', '우하단'],
] as const

/** 박스 중심점과 크기를 받아 9-grid 위치 라벨 + 점유율 한국어 설명 생성 */
function describeRegion(box: BoundingBox, canvasW: number, canvasH: number): string {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const col = cx < canvasW / 3 ? 0 : cx < (canvasW * 2) / 3 ? 1 : 2
  const row = cy < canvasH / 3 ? 0 : cy < (canvasH * 2) / 3 ? 1 : 2
  const positionLabel = GRID_LABELS_3x3[row][col]

  const areaPct = Math.round((box.width * box.height) / (canvasW * canvasH) * 100)
  const sizeHint =
    areaPct < 10 ? '작은' :
    areaPct < 30 ? '중간 크기의' :
    areaPct < 60 ? '큰' : '거의 전체에 가까운'

  return `이미지의 ${positionLabel} 부분 (${sizeHint} 영역, 전체의 약 ${areaPct}%)`
}

export function ThumbnailMaskEditor({ imageUrl, aspectRatio, onClose, onApply }: ThumbnailMaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const [box, setBox] = useState<BoundingBox | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null)

  const [refinement, setRefinement] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 렌더에서 canvasRef.current 를 직접 읽지 않도록 치수를 state 로 관리
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null)
  // UX-04 — a11y: panel ref for focus trap
  const panelRef = useRef<HTMLDivElement>(null)

  // drawCanvas 를 effect 보다 먼저 선언 (const 는 호이스팅 안 됨)
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 캔버스 표시 크기 = 부모 너비에 맞추되 비율 유지
    const containerW = canvas.parentElement?.clientWidth ?? 640
    const [arW, arH] = aspectRatio.split(':').map(Number)
    const targetH = (containerW * arH) / arW
    canvas.width = containerW
    canvas.height = targetH
    canvas.style.width = `${containerW}px`
    canvas.style.height = `${targetH}px`
    // 치수 state 동기화 (렌더에서 ref 직접 접근 방지)
    setCanvasSize({ width: containerW, height: Math.round(targetH) })

    // 이미지
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    // 어두운 오버레이 (선택 영역 외) — 선택된 박스가 있을 때만
    if (box) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // 선택 영역은 다시 클리어해서 원본 보이게
      ctx.clearRect(box.x, box.y, box.width, box.height)
      ctx.drawImage(
        img,
        (box.x / canvas.width) * img.naturalWidth,
        (box.y / canvas.height) * img.naturalHeight,
        (box.width / canvas.width) * img.naturalWidth,
        (box.height / canvas.height) * img.naturalHeight,
        box.x, box.y, box.width, box.height
      )

      // 박스 테두리
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.strokeRect(box.x, box.y, box.width, box.height)
      ctx.strokeStyle = '#111111'
      ctx.lineWidth = 1
      ctx.strokeRect(box.x - 1, box.y - 1, box.width + 2, box.height + 2)
    }
  }, [box, aspectRatio])

  // 이미지 로드 + 캔버스 초기화
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = imageUrl
    img.onload = () => {
      imgRef.current = img
      drawCanvas()
    }
    img.onerror = () => setError('이미지 로드 실패')
  }, [imageUrl, drawCanvas])

  // 박스 변경 시 다시 그리기
  useEffect(() => {
    drawCanvas()
  }, [box, drawCanvas])

  // UX-04 — a11y: ESC 닫기 + focus trap + body scroll lock
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()
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

  const getCanvasPoint = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const onDown = (e: React.MouseEvent | React.TouchEvent) => {
    const p = getCanvasPoint(e)
    if (!p) return
    setStartPoint(p)
    setIsDrawing(true)
    setBox({ x: p.x, y: p.y, width: 0, height: 0 })
  }

  const onMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !startPoint) return
    const p = getCanvasPoint(e)
    if (!p) return
    setBox({
      x: Math.min(startPoint.x, p.x),
      y: Math.min(startPoint.y, p.y),
      width: Math.abs(p.x - startPoint.x),
      height: Math.abs(p.y - startPoint.y),
    })
  }

  const onUp = () => {
    setIsDrawing(false)
    setStartPoint(null)
    // 너무 작은 박스는 무시
    if (box && (box.width < 8 || box.height < 8)) {
      setBox(null)
    }
  }

  const handleSubmit = async () => {
    if (!refinement.trim()) {
      setError('어떻게 바꿀지 입력해주세요.')
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return

    let combinedRefinement = refinement.trim()
    if (box && box.width > 0 && box.height > 0) {
      const regionDesc = describeRegion(box, canvas.width, canvas.height)
      combinedRefinement = `${regionDesc}에 대해: ${combinedRefinement}`
    }

    setSubmitting(true)
    setError(null)
    try {
      await onApply(combinedRefinement)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '재생성 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mask-editor-title"
        className="w-full max-w-2xl bg-white overflow-hidden"
        style={{ border: '1px solid #e5e5e5' }}
      >
        {/* 헤더 */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #e5e5e5' }}>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">
              영역 마스크 편집
            </div>
            <h3 id="mask-editor-title" className="text-[16px] font-black text-[#111111]">
              바꾸고 싶은 영역을 드래그하여 선택
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="마스크 편집기 닫기"
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
          >
            <X className="w-4 h-4 text-[#707072]" strokeWidth={2.5} />
          </button>
        </div>

        {/* Canvas */}
        <div className="p-4 bg-[#1c1c1c]">
          <canvas
            ref={canvasRef}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onTouchStart={onDown}
            onTouchMove={onMove}
            onTouchEnd={onUp}
            className="block max-w-full mx-auto cursor-crosshair"
            style={{ display: 'block' }}
          />
        </div>

        {/* 입력 */}
        <div className="px-5 py-4 space-y-2">
          {box && box.width > 8 && box.height > 8 && (
            <div className="text-[11px] text-[#707072]">
              📍 선택 영역: <span className="font-bold text-[#111111]">
                {canvasSize
                  ? describeRegion(box, canvasSize.width, canvasSize.height)
                  : '—'}
              </span>
              {' · '}
              <button onClick={() => setBox(null)} className="underline">초기화</button>
            </div>
          )}
          <textarea
            value={refinement}
            onChange={(e) => setRefinement(e.target.value.slice(0, 200))}
            placeholder="예: 더 밝게, 자연광 들어오는 카페 분위기로"
            rows={2}
            disabled={submitting}
            className="w-full p-2.5 text-[13px] text-[#111111] placeholder:text-[#9e9ea0] resize-none focus:outline-none"
            style={{ border: '1px solid #cacacb' }}
          />
          {error && (
            <p className="text-[11px]" style={{ color: '#d30005' }}>{error}</p>
          )}
        </div>

        {/* 액션 */}
        <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: '#f5f5f5', borderTop: '1px solid #e5e5e5' }}>
          <p className="text-[10px] text-[#9e9ea0]">
            영역 미선택 시 이미지 전체에 적용됩니다
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 h-9 rounded-full text-[12px] font-semibold text-[#707072] hover:text-[#111111] transition-colors disabled:opacity-50"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !refinement.trim()}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-[12px] font-bold text-white bg-[#111111] hover:bg-[#333333] transition-colors disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              이 영역 다듬기
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
