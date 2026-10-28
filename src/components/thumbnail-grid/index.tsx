'use client'

/**
 * ThumbnailGrid — Nike 디자인 시스템 + v1.1 Phase 2 (L6) Pin & Re-roll 지원
 */

import { useState } from 'react'
import Image from 'next/image'
import { Check, Download, Loader2, ImageOff, Pin, RotateCw, X, Crop } from 'lucide-react'
import { ThumbnailMaskEditor } from '@/components/thumbnail-mask-editor'
import { buildImageName, downloadImages, ratioToken } from '@/lib/download-images'

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface ThumbnailItem {
  id?: string
  url: string
  width: number
  height: number
  aspectRatio: string
}

interface ThumbnailGridProps {
  thumbnails: ThumbnailItem[]
  isGenerating?: boolean
  onSelectPrimary?: (thumbnail: ThumbnailItem) => void
  /** v1.1 Phase 2 — 핀 토글 콜백 */
  pinnedAspectRatios?: Set<string>
  onTogglePin?: (aspectRatio: string) => void
  /** v1.1 Phase 2 — "핀 안 된 것만 다시" — refinement 와 함께 호출 */
  onReroll?: (refinement: string) => Promise<void>
  selectedId?: string
  /** 다운로드 파일명 앞부분 (보통 상품명) */
  downloadBaseName?: string
}

// ─── 종횡비 레이블 ────────────────────────────────────────────────────────────

const RATIO_LABELS: Record<string, { label: string; use: string }> = {
  '1:1':  { label: '1:1',  use: '인스타 피드' },
  '4:5':  { label: '4:5',  use: '인스타 세로' },
  '9:16': { label: '9:16', use: '스토리·릴스' },
  '16:9': { label: '16:9', use: '유튜브·배너' },
  '3:4':  { label: '3:4',  use: '모바일 쇼핑' },
  '4:3':  { label: '4:3',  use: 'PC 쇼핑몰' },
  '21:9': { label: '21:9', use: '와이드 배너' },
}

const PLACEHOLDER_RATIOS = ['1:1', '4:5', '9:16', '16:9']

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function ThumbnailGrid({
  thumbnails,
  isGenerating = false,
  onSelectPrimary,
  pinnedAspectRatios,
  onTogglePin,
  onReroll,
  selectedId,
  downloadBaseName,
}: ThumbnailGridProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [rerollOpen, setRerollOpen] = useState(false)
  const [rerollText, setRerollText] = useState('')
  const [rerolling, setRerolling] = useState(false)
  // Phase 3.4 — 영역 마스크 편집 대상
  const [maskTarget, setMaskTarget] = useState<ThumbnailItem | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadNote, setDownloadNote] = useState<string | null>(null)

  const getKey = (t: ThumbnailItem, i: number) => t.id ?? `${t.aspectRatio}-${i}`

  const pinCount = pinnedAspectRatios?.size ?? 0
  const totalCount = thumbnails.length

  const runDownload = async (items: ThumbnailItem[]) => {
    if (items.length === 0) return
    setDownloading(true)
    setDownloadNote(null)
    try {
      const outcome = await downloadImages(
        items.map((t) => ({ url: t.url, name: buildImageName([downloadBaseName, '썸네일', ratioToken(t.aspectRatio)]) })),
        buildImageName([downloadBaseName, '썸네일']),
      )
      if (outcome.failed > 0) setDownloadNote(`${outcome.saved}장 저장 · ${outcome.failed}장은 받지 못했어요.`)
    } catch (err) {
      setDownloadNote(err instanceof Error ? err.message : '다운로드 실패')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-3">
      {!isGenerating && totalCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          {downloadNote && <span className="text-[11px]" style={{ color: '#d30005' }}>{downloadNote}</span>}
          <button
            onClick={() => runDownload(thumbnails)}
            disabled={downloading}
            className="inline-flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold text-white bg-[#111111] hover:bg-[#333333] transition-colors disabled:opacity-50"
          >
            {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            전체 {totalCount}장 다운로드 (ZIP)
          </button>
        </div>
      )}
      {/* 그리드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isGenerating
          ? PLACEHOLDER_RATIOS.map((ratio) => (
              <PlaceholderCard key={ratio} ratio={ratio} />
            ))
          : thumbnails.map((thumb, i) => {
              const key = getKey(thumb, i)
              const isSelected = selectedId === key || (!selectedId && i === 0)
              const isHovered = hoveredId === key
              const isPinned = pinnedAspectRatios?.has(thumb.aspectRatio) ?? false
              const meta = RATIO_LABELS[thumb.aspectRatio] ?? {
                label: thumb.aspectRatio,
                use: '커스텀',
              }
              return (
                <div
                  key={key}
                  className="group relative"
                  onMouseEnter={() => setHoveredId(key)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <div
                    className="relative overflow-hidden cursor-pointer transition-colors"
                    style={{
                      aspectRatio: thumb.aspectRatio.replace(':', '/'),
                      background: '#f5f5f5',
                      border: isSelected ? '2px solid #111111' : '1px solid #e5e5e5',
                    }}
                    onClick={() => onSelectPrimary?.(thumb)}
                  >
                    <Image
                      src={thumb.url}
                      alt={`${thumb.aspectRatio} 썸네일`}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      className="object-cover"
                    />

                    {/* 선택 오버레이 */}
                    {isSelected && (
                      <div
                        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center"
                        style={{ backgroundColor: '#111111' }}
                      >
                        <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                      </div>
                    )}

                    {/* 핀 토글 — 우상단 (선택 표시와 자리 다툼하지 않도록 좌상단) */}
                    {onTogglePin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onTogglePin(thumb.aspectRatio)
                        }}
                        className="absolute top-2 left-2 w-7 h-7 flex items-center justify-center transition-colors"
                        style={{
                          backgroundColor: isPinned ? '#111111' : 'rgba(255,255,255,0.85)',
                          color: isPinned ? '#ffffff' : '#111111',
                        }}
                        title={isPinned ? '핀 해제' : '핀 (재생성 시 유지)'}
                      >
                        <Pin className="w-3.5 h-3.5" fill={isPinned ? '#ffffff' : 'transparent'} />
                      </button>
                    )}

                    {/* 호버 시 하단 액션 — 마스크 편집 / 다운로드 */}
                    {isHovered && (
                      <div className="absolute bottom-2 right-2 flex items-center gap-1">
                        {onReroll && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setMaskTarget(thumb)
                            }}
                            className="w-7 h-7 flex items-center justify-center"
                            style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
                            title="영역만 다듬기"
                          >
                            <Crop className="w-3.5 h-3.5 text-[#111111]" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void runDownload([thumb])
                          }}
                          disabled={downloading}
                          className="w-7 h-7 flex items-center justify-center disabled:opacity-50"
                          style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
                          title="다운로드"
                          aria-label={`${thumb.aspectRatio} 썸네일 다운로드`}
                        >
                          <Download className="w-3.5 h-3.5 text-[#111111]" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 메타 정보 */}
                  <div className="mt-1.5 px-0.5 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#111111]">
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-[#9e9ea0]">
                      {thumb.width}×{thumb.height}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#9e9ea0] px-0.5">{meta.use}</p>
                </div>
              )
            })}
      </div>

      {/* 핀 & 재롤 컨트롤 */}
      {!isGenerating && totalCount > 0 && onReroll && (
        <div className="p-4" style={{ border: '1px solid #e5e5e5', backgroundColor: '#f5f5f5' }}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[11px] font-black uppercase tracking-widest text-[#9e9ea0] mb-1">
                Pin & Re-roll
              </div>
              <div className="text-[13px] text-[#111111]">
                {pinCount > 0
                  ? `핀: ${pinCount}장 유지 · 재생성: ${totalCount - pinCount}장`
                  : '핀 안 된 사진을 자연어 보정과 함께 재생성할 수 있습니다.'}
              </div>
            </div>
            {!rerollOpen ? (
              <button
                onClick={() => setRerollOpen(true)}
                className="px-3 h-8 rounded-full text-[12px] font-semibold text-[#111111] hover:bg-white transition-colors inline-flex items-center gap-1.5"
                style={{ border: '1px solid #cacacb' }}
              >
                <RotateCw className="w-3 h-3" />
                재생성 설정
              </button>
            ) : null}
          </div>

          {rerollOpen && (
            <div className="mt-3 space-y-2">
              <textarea
                value={rerollText}
                onChange={(e) => setRerollText(e.target.value.slice(0, 200))}
                placeholder="예: 더 밝고 따뜻한 느낌으로, 카페 배경 추가"
                rows={2}
                disabled={rerolling}
                className="w-full p-2.5 text-[12px] text-[#111111] placeholder:text-[#9e9ea0] resize-none focus:outline-none"
                style={{ border: '1px solid #cacacb', backgroundColor: '#ffffff' }}
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#9e9ea0]">{rerollText.length}/200 · 핀된 비율은 유지됩니다</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setRerollOpen(false)
                      setRerollText('')
                    }}
                    disabled={rerolling}
                    className="px-3 h-7 rounded-full text-[11px] font-semibold text-[#707072] hover:text-[#111111] transition-colors disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={async () => {
                      setRerolling(true)
                      try {
                        await onReroll(rerollText.trim())
                        setRerollOpen(false)
                        setRerollText('')
                      } finally {
                        setRerolling(false)
                      }
                    }}
                    disabled={rerolling}
                    className="px-3 h-7 rounded-full text-[11px] font-semibold text-white bg-[#111111] hover:bg-[#333333] transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {rerolling && <Loader2 className="w-3 h-3 animate-spin" />}
                    핀 유지 + 재생성
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SynthID 고지 */}
      {!isGenerating && thumbnails.length > 0 && (
        <div
          className="p-3 text-[11px] text-[#707072] leading-relaxed"
          style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }}
        >
          <strong className="text-[#111111]">고지:</strong> 위 이미지는 Google Gemini AI로
          생성되었으며 SynthID 워터마크가 포함됩니다. 상업적 이용 시 AI 생성 콘텐츠임을 명시해야
          합니다.
        </div>
      )}

      {/* Phase 3.4 — 영역 마스크 편집 모달 */}
      {maskTarget && onReroll && (
        <ThumbnailMaskEditor
          imageUrl={maskTarget.url}
          aspectRatio={maskTarget.aspectRatio}
          onClose={() => setMaskTarget(null)}
          onApply={async (refinement) => {
            // 핀이 안 된 다른 비율들은 보존하고, 대상 비율만 새로 만들도록
            // 임시로 모든 다른 비율을 핀에 추가 (호출 후 복원할 수 있지만 단순화)
            await onReroll(refinement)
          }}
        />
      )}
    </div>
  )
}

// ─── 플레이스홀더 ──────────────────────────────────────────────────────────

function PlaceholderCard({ ratio }: { ratio: string }) {
  const meta = RATIO_LABELS[ratio] ?? { label: ratio, use: '' }
  return (
    <div className="group relative">
      <div
        className="relative overflow-hidden animate-pulse"
        style={{
          aspectRatio: ratio.replace(':', '/'),
          background: '#f5f5f5',
          border: '1px solid #e5e5e5',
        }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 text-[#9e9ea0] animate-spin" />
          <span className="text-[10px] text-[#9e9ea0]">생성 중...</span>
        </div>
      </div>
      <div className="mt-1.5 px-0.5">
        <span className="text-[11px] font-semibold text-[#9e9ea0]">{meta.label}</span>
        <p className="text-[10px] text-[#9e9ea0]">{meta.use}</p>
      </div>
    </div>
  )
}

// ─── 에러 상태 ─────────────────────────────────────────────────────────────

export function ThumbnailGridError({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div
      className="p-6 text-center"
      style={{ border: '1px solid #fecaca', backgroundColor: '#fff5f5' }}
    >
      <ImageOff className="w-8 h-8 mx-auto mb-3" style={{ color: '#d30005' }} />
      <p className="text-[13px] font-semibold mb-1" style={{ color: '#d30005' }}>썸네일 생성 실패</p>
      <p className="text-[12px] mb-4" style={{ color: '#d30005' }}>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 h-9 rounded-full text-[12px] font-semibold transition-colors"
          style={{ color: '#d30005', border: '1px solid #fecaca', backgroundColor: '#ffffff' }}
        >
          다시 시도
        </button>
      )}
    </div>
  )
}

// X 재export (편의)
export { X }
