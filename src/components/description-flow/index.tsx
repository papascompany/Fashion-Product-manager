'use client'

/**
 * DescriptionFlow — 상세설명 문단 사이에 생성 사진을 끼워 보여주고 편집한다.
 *
 * 04 상세설명 카드와 상세페이지 편집기가 같은 배치(store.descriptionImages)를 공유한다.
 * 배치를 한 번도 고치지 않았으면 AI Fitting·썸네일 결과로 자동 배치하고,
 * 사진 후보가 없거나 문단이 하나뿐이면 기존 전체 텍스트 편집 UI 로 렌더한다.
 */

import { Fragment, useCallback, useMemo, useState } from 'react'
import { ImagePlus, RefreshCw, X } from 'lucide-react'
import { EditableText } from '@/components/editable-text'
import { useStudioStore } from '@/store/studio'
import {
  buildDescriptionImagePool,
  descriptionGapCount,
  replaceParagraph,
  resolveDescriptionImages,
  splitParagraphs,
  type DescriptionImageSlots,
} from '@/lib/description-layout'

/** 사진 후보(pool)와 사용자 배치. slotsFor(text) = 그 텍스트의 문단 사이 칸별 사진 */
export function useDescriptionImages() {
  const aiFittings = useStudioStore((s) => s.aiFittings)
  const thumbnails = useStudioStore((s) => s.result?.thumbnails)
  const heroUrl = useStudioStore((s) => s.selectedFittingUrl)
  const explicit = useStudioStore((s) => s.descriptionImages)
  const setExplicit = useStudioStore((s) => s.setDescriptionImages)

  const pool = useMemo(
    () => buildDescriptionImagePool({ fittings: aiFittings, thumbnails: thumbnails ?? [], heroUrl }),
    [aiFittings, thumbnails, heroUrl],
  )
  const slotsFor = useCallback(
    (text: string) => resolveDescriptionImages(explicit, pool, descriptionGapCount(text)),
    [explicit, pool],
  )
  return { pool, explicit, setExplicit, slotsFor }
}

interface DescriptionFlowProps {
  text: string
  onChangeText?: (next: string) => void
  /** 사진 사이 모드에서는 문단 하나, 기본 모드에서는 전체 글자수 상한 */
  maxLength: number
  placeholder?: string
  /** false 면 사진 없이 기존 전체 편집 UI */
  withImages?: boolean
}

const TEXT_CLASS = 'text-[13px] text-[#111111] leading-relaxed whitespace-pre-wrap block'

export function DescriptionFlow({ text, onChangeText, maxLength, placeholder, withImages = true }: DescriptionFlowProps) {
  const { pool, explicit, setExplicit, slotsFor } = useDescriptionImages()
  const [pickerAt, setPickerAt] = useState<number | null>(null)
  const paragraphs = useMemo(() => splitParagraphs(text), [text])

  if (!withImages || pool.length === 0 || paragraphs.length < 2) {
    return onChangeText ? (
      <EditableText
        value={text}
        onSave={onChangeText}
        multiline
        maxLength={maxLength}
        className={TEXT_CLASS}
        placeholder={placeholder}
        showEditIcon={false}
      />
    ) : (
      <p className={TEXT_CLASS}>{text}</p>
    )
  }

  const slots = slotsFor(text)
  const setSlot = (index: number, url: string | null) => {
    const next: DescriptionImageSlots = [...slots]
    next[index] = url
    setExplicit(next)
    setPickerAt(null)
  }

  return (
    <div>
      {paragraphs.map((para, i) => (
        <Fragment key={i}>
          {onChangeText ? (
            <EditableText
              value={para}
              onSave={(v) => onChangeText(replaceParagraph(text, i, v))}
              multiline
              maxLength={maxLength}
              className={TEXT_CLASS}
              placeholder={placeholder}
              showEditIcon={false}
            />
          ) : (
            <p className={TEXT_CLASS}>{para}</p>
          )}
          {i < paragraphs.length - 1 && (
            <ImageSlot
              index={i}
              url={slots[i] ?? null}
              pool={pool}
              open={pickerAt === i}
              onToggle={() => setPickerAt(pickerAt === i ? null : i)}
              onPick={(url) => setSlot(i, url)}
            />
          )}
        </Fragment>
      ))}
      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-[#9e9ea0]">
        <span>문단 사이 사진은 상세페이지에도 같은 위치로 들어갑니다 · 복사 버튼은 글만 복사합니다</span>
        {explicit && (
          <button
            onClick={() => {
              setExplicit(null)
              setPickerAt(null)
            }}
            className="flex-shrink-0 font-semibold hover:text-[#111111] transition-colors"
          >
            자동 배치로 되돌리기
          </button>
        )}
      </div>
    </div>
  )
}

function ImageSlot({
  index,
  url,
  pool,
  open,
  onToggle,
  onPick,
}: {
  index: number
  url: string | null
  pool: string[]
  open: boolean
  onToggle: () => void
  onPick: (url: string | null) => void
}) {
  return (
    <div className="my-4">
      {url ? (
        <figure
          className="relative mx-auto max-w-[420px] m-0"
          style={{ border: '1px solid #e5e5e5', backgroundColor: '#f5f5f5' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`문단 사이 사진 ${index + 1}`} className="block w-full max-h-[420px] object-contain" />
          <div className="absolute top-2 right-2 flex gap-1">
            <button
              onClick={onToggle}
              aria-expanded={open}
              className="h-7 px-2.5 inline-flex items-center gap-1 rounded-full text-[10px] font-bold text-[#111111]"
              style={{ backgroundColor: 'rgba(255,255,255,0.92)', border: '1px solid #cacacb' }}
            >
              <RefreshCw className="w-3 h-3" /> 변경
            </button>
            <button
              onClick={() => onPick(null)}
              aria-label={`문단 사이 사진 ${index + 1} 빼기`}
              className="w-7 h-7 flex items-center justify-center"
              style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        </figure>
      ) : (
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="w-full h-9 inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-[#9e9ea0] hover:text-[#111111] transition-colors"
          style={{ border: '1px dashed #cacacb' }}
        >
          <ImagePlus className="w-3.5 h-3.5" /> 문단 사이에 사진 넣기
        </button>
      )}
      {open && (
        <div
          className="mt-2 p-2 flex flex-wrap gap-1.5"
          style={{ border: '1px solid #e5e5e5', backgroundColor: '#ffffff' }}
          role="listbox"
          aria-label="넣을 사진 선택"
        >
          {pool.map((candidate) => (
            <button
              key={candidate}
              onClick={() => onPick(candidate)}
              role="option"
              aria-selected={candidate === url}
              className="w-16 h-16 overflow-hidden"
              style={{
                border: candidate === url ? '2px solid #111111' : '1px solid #e5e5e5',
                backgroundColor: '#f5f5f5',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={candidate} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
