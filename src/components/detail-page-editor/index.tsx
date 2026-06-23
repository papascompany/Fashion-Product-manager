'use client'

/**
 * DetailPageEditor — v1.1 Phase 2 (L8 · 결정 C=3)
 *
 * 풀 노션 스타일 에디터:
 * - 섹션 인라인 편집 (EditableText)
 * - 섹션 추가 (hover 시 [+ 추가] 라인)
 * - 섹션 삭제
 * - 드래그 정렬 (HTML5 native)
 * - HTML 내보내기 / 프로젝트와 함께 저장
 *
 * Nike 디자인 — 0px radius, hairline border
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { Plus, GripVertical, MoreHorizontal, Trash2, Download, Save, ExternalLink, X, Loader2, Sparkles } from 'lucide-react'
import { EditableText } from '@/components/editable-text'
import { PointKeywords } from '@/components/point-keywords'
import type { DetailSection, DetailSectionType } from '@/store/studio'

interface DetailPageEditorProps {
  sections: DetailSection[]
  onChange: (sections: DetailSection[]) => void
  /** 프로젝트와 함께 저장 — projectId 필요 */
  projectId?: string | null
  /** sections 초기화에 사용할 기본 값 */
  defaults?: {
    productName: string
    tagline: string
    description: string
    keywords: string[]
    features: string[]
    /** 포인트 키워드 — hero 본문 chip 표시용 (소재·핏·시즌·스타일). 비면 chip 미표시 */
    pointKeywords?: string[]
    thumbnailUrl?: string
  }
}

// ─── 섹션 타입 메타 ─────────────────────────────────────────────────────────

const SECTION_META: Record<DetailSectionType, { label: string; icon: string }> = {
  hero:        { label: '히어로',         icon: '✦' },
  features:    { label: '핵심 특징',      icon: '⊞' },
  description: { label: '상품 소개',      icon: '¶' },
  keywords:    { label: '검색 키워드',    icon: '#' },
  reviews:     { label: '리뷰 영역',      icon: '☆' },
  cta:         { label: 'CTA 버튼',       icon: '→' },
  text:        { label: '텍스트 블록',    icon: 'T' },
  image:       { label: '이미지 블록',    icon: '◇' },
}

// 새 섹션 생성 헬퍼
function makeNewSection(type: DetailSectionType): DetailSection {
  const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  switch (type) {
    case 'hero':        return { id, type, title: '상품명', tagline: '한줄 카피' }
    case 'features':    return { id, type, heading: '이런 점이 특별합니다', items: ['특징을 입력하세요'] }
    case 'description': return { id, type, content: '상품 소개 내용을 입력하세요.' }
    case 'keywords':    return { id, type, items: ['키워드'] }
    case 'reviews':     return { id, type, placeholder: '📦 첫 번째 구매자가 되어주세요!' }
    case 'cta':         return { id, type, label: '지금 구매하기' }
    case 'text':        return { id, type, content: '내용을 입력하세요.' }
    case 'image':       return { id, type, url: '' }
  }
}

/** defaults 로부터 기본 섹션 배열을 만든다 */
export function buildDefaultSections(defaults: NonNullable<DetailPageEditorProps['defaults']>): DetailSection[] {
  const mk = (type: DetailSectionType, extra: Partial<DetailSection>): DetailSection => ({
    id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${type}`,
    type, ...extra,
  } as DetailSection)
  return [
    mk('hero',        { title: defaults.productName, tagline: defaults.tagline, image: defaults.thumbnailUrl }),
    mk('features',    { heading: '이런 점이 특별합니다', items: defaults.features.length > 0 ? defaults.features : ['특징을 입력하세요'] }),
    mk('description', { content: defaults.description }),
    mk('keywords',    { items: defaults.keywords }),
    mk('reviews',     { placeholder: '📦 첫 번째 구매자가 되어주세요!' }),
    mk('cta',         { label: '지금 구매하기' }),
  ]
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────

export function DetailPageEditor({ sections, onChange, projectId, defaults }: DetailPageEditorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [addOpenAt, setAddOpenAt] = useState<number | null>(null)

  const [exporting, setExporting] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  // Phase 3.2 — AI 자동 조립
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const handleAutoCompose = async () => {
    if (!defaults) {
      setPlanError('자동 구성을 위한 기본 정보가 없습니다.')
      return
    }
    setPlanning(true)
    setPlanError(null)
    try {
      const res = await fetch('/api/generate/detail-page-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: defaults.productName,
          tagline: defaults.tagline,
          description: defaults.description,
          category: '상품',
          keywords: defaults.keywords,
          features: defaults.features,
          projectId,
        }),
      })
      if (!res.ok) throw new Error(`AI 자동 구성 실패 (${res.status})`)
      const { sections: newSections } = await res.json()
      // hero 섹션에 thumbnail 이미지 자동 주입
      const enriched = (newSections as DetailSection[]).map((s) =>
        s.type === 'hero' && defaults.thumbnailUrl
          ? ({ ...s, image: defaults.thumbnailUrl } as DetailSection)
          : s
      )
      onChange(enriched)
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'AI 자동 구성 실패')
    } finally {
      setPlanning(false)
    }
  }

  // ── 섹션 변경 헬퍼들 ────────────────────────────────────────────────────
  const updateSection = useCallback(
    (index: number, patch: Partial<DetailSection>) => {
      const next = sections.map((s, i) =>
        i === index ? ({ ...s, ...patch } as DetailSection) : s
      )
      onChange(next)
    },
    [sections, onChange]
  )

  const deleteSection = useCallback(
    (index: number) => {
      onChange(sections.filter((_, i) => i !== index))
    },
    [sections, onChange]
  )

  const insertSection = useCallback(
    (afterIndex: number, type: DetailSectionType) => {
      const newOne = makeNewSection(type)
      const next = [...sections]
      next.splice(afterIndex + 1, 0, newOne)
      onChange(next)
      setAddOpenAt(null)
    },
    [sections, onChange]
  )

  // 드래그 처리
  const moveSection = useCallback(
    (from: number, to: number) => {
      if (from === to) return
      const next = [...sections]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      onChange(next)
    },
    [sections, onChange]
  )

  // ── 내보내기 ─────────────────────────────────────────────────────────────
  const handleExport = async (mode: 'preview' | 'download' | 'save') => {
    setExporting(true)
    setExportError(null)
    try {
      const res = await fetch('/api/generate/detail-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projectId ?? '00000000-0000-0000-0000-000000000000',
          productName: extractText(sections, 'hero', 'title') ?? defaults?.productName ?? '상품',
          tagline:     extractText(sections, 'hero', 'tagline') ?? defaults?.tagline ?? '',
          description: extractText(sections, 'description', 'content') ?? defaults?.description ?? '',
          category: '상품',
          keywords: extractArr(sections, 'keywords', 'items')   ?? defaults?.keywords ?? [],
          features: extractArr(sections, 'features', 'items')   ?? defaults?.features ?? [],
          sections,
        }),
      })
      if (!res.ok) throw new Error(`내보내기 실패 (${res.status})`)
      const { html } = await res.json()
      if (mode === 'preview') {
        setPreviewHtml(html)
      } else if (mode === 'download') {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'detail-page.html'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else {
        // 'save' — 그냥 서버에 저장된 상태 (위 POST 호출이 generations 테이블에 기록함)
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '내보내기 실패')
    } finally {
      setExporting(false)
    }
  }

  // ── 빈 상태 ──────────────────────────────────────────────────────────────
  if (sections.length === 0) {
    return (
      <div className="p-8 text-center" style={{ border: '2px dashed #e5e5e5', backgroundColor: '#f5f5f5' }}>
        <p className="text-[14px] text-[#707072] mb-4">섹션이 없습니다.</p>
        <SectionPicker onPick={(t) => onChange([makeNewSection(t)])} />
      </div>
    )
  }

  return (
    <>
      <div style={{ border: '1px solid #e5e5e5', backgroundColor: '#ffffff' }}>
        {sections.map((section, index) => (
          <div key={section.id}>
            <SectionWrapper
              section={section}
              index={index}
              pointKeywords={defaults?.pointKeywords}
              isDragging={dragIndex === index}
              isDragTarget={hoverIndex === index && dragIndex !== null}
              onDragStart={() => setDragIndex(index)}
              onDragOver={() => setHoverIndex(index)}
              onDragEnd={() => {
                if (dragIndex !== null && hoverIndex !== null) moveSection(dragIndex, hoverIndex)
                setDragIndex(null)
                setHoverIndex(null)
              }}
              onDelete={() => deleteSection(index)}
              onUpdate={(patch) => updateSection(index, patch)}
            />

            {/* 섹션 사이 [+ 추가] */}
            <div className="relative">
              <button
                onClick={() => setAddOpenAt(addOpenAt === index ? null : index)}
                className="w-full py-1.5 flex items-center justify-center opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity text-[11px] font-semibold text-[#9e9ea0] hover:text-[#111111]"
                style={{ borderTop: index === sections.length - 1 ? '1px solid #e5e5e5' : undefined }}
                title="여기에 섹션 추가"
              >
                <Plus className="w-3 h-3 mr-1" />
                {addOpenAt === index ? '취소' : '여기에 섹션 추가'}
              </button>
              {addOpenAt === index && (
                <div className="px-4 py-2" style={{ backgroundColor: '#f5f5f5', borderTop: '1px solid #e5e5e5', borderBottom: '1px solid #e5e5e5' }}>
                  <SectionPicker onPick={(t) => insertSection(index, t)} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 액션 바 */}
      <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[12px] text-[#9e9ea0]">
            {sections.length}개 섹션 · 인라인 편집 · 드래그 정렬
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Phase 3.2 — AI 자동 구성 */}
          {defaults && (
            <button
              onClick={handleAutoCompose}
              disabled={planning || exporting}
              title="AI 가 분석 결과 기반으로 상세페이지 구조를 자동 설계"
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-[12px] font-bold text-white bg-[#111111] hover:bg-[#333333] transition-colors disabled:opacity-50"
            >
              {planning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              AI 로 자동 구성
            </button>
          )}
          <button
            onClick={() => handleExport('preview')}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-[12px] font-semibold text-[#111111] hover:bg-[#f5f5f5] transition-colors disabled:opacity-50"
            style={{ border: '1px solid #cacacb' }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            미리보기
          </button>
          <button
            onClick={() => handleExport('download')}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-[12px] font-semibold text-[#111111] hover:bg-[#f5f5f5] transition-colors disabled:opacity-50"
            style={{ border: '1px solid #cacacb' }}
          >
            <Download className="w-3.5 h-3.5" />
            HTML 다운로드
          </button>
          {projectId && (
            <button
              onClick={() => handleExport('save')}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-[12px] font-semibold text-[#111111] hover:bg-[#f5f5f5] transition-colors disabled:opacity-50"
              style={{ border: '1px solid #cacacb' }}
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              저장
            </button>
          )}
        </div>
      </div>

      {(exportError || planError) && (
        <div className="mt-3 p-3 text-[12px]" style={{ color: '#d30005', border: '1px solid #fecaca', backgroundColor: '#fff5f5' }}>
          {exportError ?? planError}
        </div>
      )}

      {/* 미리보기 모달 */}
      {previewHtml && (
        <PreviewModal html={previewHtml} onClose={() => setPreviewHtml(null)} />
      )}
    </>
  )
}

// ─── 미리보기 모달 (UX-04 a11y + UX-09 iframe sandbox 강화) ────────────────
function PreviewModal({ html, onClose }: { html: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
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
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-preview-title"
        className="w-full max-w-3xl bg-white overflow-hidden"
        style={{ border: '1px solid #e5e5e5' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #e5e5e5' }}>
          <div id="detail-preview-title" className="text-[13px] font-black text-[#111111]">상세페이지 미리보기</div>
          <button
            onClick={onClose}
            aria-label="미리보기 닫기"
            className="p-1 text-[#707072] hover:text-[#111111]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <iframe
          title="상세페이지 미리보기"
          srcDoc={html}
          // UX-09 — allow-same-origin 제거. allow-popups 만 유지해 부모 origin 권한 차단
          sandbox="allow-popups"
          referrerPolicy="no-referrer"
          className="w-full bg-white"
          style={{ height: '70vh' }}
        />
      </div>
    </div>
  )
}

// ─── 섹션 래퍼 ─────────────────────────────────────────────────────────────

interface SectionWrapperProps {
  section: DetailSection
  index: number
  /** hero 본문에 표시할 포인트 키워드 (display-only) */
  pointKeywords?: string[]
  isDragging: boolean
  isDragTarget: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDragEnd: () => void
  onDelete: () => void
  onUpdate: (patch: Partial<DetailSection>) => void
}

function SectionWrapper(p: SectionWrapperProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const meta = SECTION_META[p.section.type]
  return (
    <div
      className="group/section relative px-5 py-4"
      style={{
        borderBottom: '1px solid #f5f5f5',
        opacity: p.isDragging ? 0.4 : 1,
        backgroundColor: p.isDragTarget ? '#f5f5f5' : '#ffffff',
        transition: 'background-color 100ms',
      }}
      onDragOver={(e) => {
        e.preventDefault()
        p.onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        p.onDragEnd()
      }}
    >
      {/* 헤더 */}
      <div className="mb-2 flex items-center gap-2">
        <span
          draggable
          onDragStart={p.onDragStart}
          onDragEnd={p.onDragEnd}
          className="cursor-grab active:cursor-grabbing text-[#9e9ea0] hover:text-[#111111] opacity-0 group-hover/section:opacity-100 transition-opacity"
          title="드래그하여 순서 변경"
        >
          <GripVertical className="w-4 h-4" />
        </span>
        <span className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">
          {meta.icon} {meta.label}
        </span>
        <div className="flex-1" />
        <div className="relative">
          <button
            onClick={() => setMenuOpen((m) => !m)}
            className="p-1 text-[#9e9ea0] hover:text-[#111111] opacity-0 group-hover/section:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 w-32 bg-white" style={{ border: '1px solid #e5e5e5' }}>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    p.onDelete()
                  }}
                  className="w-full text-left px-3 py-2 text-[12px] text-[#d30005] hover:bg-[#fff5f5] flex items-center gap-1.5"
                >
                  <Trash2 className="w-3 h-3" /> 삭제
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 본문 — 타입별 렌더링 */}
      <SectionBody section={p.section} onUpdate={p.onUpdate} pointKeywords={p.pointKeywords} />
    </div>
  )
}

// ─── 섹션 본문 (타입별) ────────────────────────────────────────────────────

function SectionBody({
  section,
  onUpdate,
  pointKeywords,
}: {
  section: DetailSection
  onUpdate: (patch: Partial<DetailSection>) => void
  /** hero 본문에 표시할 포인트 키워드 (display-only) */
  pointKeywords?: string[]
}) {
  switch (section.type) {
    case 'hero':
      return (
        <div>
          <EditableText
            value={section.title}
            onSave={(v) => onUpdate({ title: v } as Partial<DetailSection>)}
            maxLength={60}
            className="text-[22px] font-black text-[#111111] block"
            placeholder="상품명"
            showEditIcon={false}
          />
          <div className="mt-2">
            <EditableText
              value={section.tagline}
              onSave={(v) => onUpdate({ tagline: v } as Partial<DetailSection>)}
              maxLength={80}
              className="text-[14px] text-[#707072] block"
              placeholder="한줄 카피"
              showEditIcon={false}
            />
          </div>
          {/* 포인트 키워드 chip — 소재·핏·시즌·스타일 (display-only) */}
          <PointKeywords keywords={pointKeywords} className="mt-3" />
          {/* 이미지 영역 — AI 피팅 이미지 또는 썸네일 */}
          <div className="mt-4">
            {section.image ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={section.image}
                alt={section.title}
                className="w-full object-contain"
                style={{ border: '1px solid #e5e5e5' }}
              />
            ) : (
              <div
                className="flex items-center justify-center text-[12px] text-[#c5c5c7]"
                style={{ height: '220px', backgroundColor: '#f8f8f8', border: '1px dashed #e0e0e0' }}
              >
                AI 피팅 이미지가 여기에 표시됩니다
              </div>
            )}
          </div>
        </div>
      )

    case 'features': {
      const items = section.items
      return (
        <div>
          <EditableText
            value={section.heading}
            onSave={(v) => onUpdate({ heading: v } as Partial<DetailSection>)}
            maxLength={40}
            className="text-[16px] font-bold text-[#111111] mb-2 block"
            placeholder="섹션 제목"
            showEditIcon={false}
          />
          <ul className="space-y-1.5">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-[11px] font-black text-[#9e9ea0] mt-0.5 w-5 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                <div className="flex-1">
                  <EditableText
                    value={it}
                    onSave={(v) => {
                      const next = [...items]
                      next[i] = v
                      onUpdate({ items: next } as Partial<DetailSection>)
                    }}
                    maxLength={100}
                    className="text-[13px] text-[#111111] block"
                    placeholder="특징을 입력"
                    showEditIcon={false}
                  />
                </div>
                <button
                  onClick={() => onUpdate({ items: items.filter((_, idx) => idx !== i) } as Partial<DetailSection>)}
                  className="text-[#9e9ea0] hover:text-[#d30005] opacity-0 group-hover/section:opacity-100"
                >
                  <X className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => onUpdate({ items: [...items, '새 특징'] } as Partial<DetailSection>)}
            className="mt-2 text-[11px] font-semibold text-[#707072] hover:text-[#111111]"
          >
            + 특징 추가
          </button>
        </div>
      )
    }

    case 'description':
      return (
        <EditableText
          value={section.content}
          onSave={(v) => onUpdate({ content: v } as Partial<DetailSection>)}
          multiline
          maxLength={2000}
          className="text-[13px] text-[#111111] leading-relaxed whitespace-pre-wrap block"
          placeholder="상품 소개 내용"
          showEditIcon={false}
        />
      )

    case 'keywords': {
      const items = section.items
      return (
        <KeywordsEditor
          items={items}
          onChange={(next) => onUpdate({ items: next } as Partial<DetailSection>)}
        />
      )
    }

    case 'reviews':
      return (
        <div className="p-6 text-center" style={{ border: '2px dashed #e5e5e5', backgroundColor: '#fafafa' }}>
          <EditableText
            value={section.placeholder}
            onSave={(v) => onUpdate({ placeholder: v } as Partial<DetailSection>)}
            maxLength={120}
            className="text-[13px] text-[#9e9ea0] block"
            placeholder="리뷰 영역 플레이스홀더"
            showEditIcon={false}
          />
        </div>
      )

    case 'cta':
      return (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <EditableText
              value={section.label}
              onSave={(v) => onUpdate({ label: v } as Partial<DetailSection>)}
              maxLength={30}
              className="text-[14px] font-bold text-[#111111] block"
              placeholder="버튼 라벨"
              showEditIcon={false}
            />
            <div className="mt-1">
              <input
                type="url"
                value={section.url ?? ''}
                onChange={(e) => onUpdate({ url: e.target.value } as Partial<DetailSection>)}
                placeholder="https://… (선택)"
                className="w-full px-2 py-1 text-[11px] text-[#707072] focus:outline-none"
                style={{ border: '1px solid #cacacb' }}
              />
            </div>
          </div>
        </div>
      )

    case 'text':
      return (
        <div>
          <EditableText
            value={section.heading ?? ''}
            onSave={(v) => onUpdate({ heading: v || undefined } as Partial<DetailSection>)}
            maxLength={60}
            className="text-[15px] font-bold text-[#111111] block mb-1"
            placeholder="제목 (선택)"
            showEditIcon={false}
          />
          <EditableText
            value={section.content}
            onSave={(v) => onUpdate({ content: v } as Partial<DetailSection>)}
            multiline
            maxLength={1500}
            className="text-[13px] text-[#111111] leading-relaxed whitespace-pre-wrap block"
            placeholder="내용"
            showEditIcon={false}
          />
        </div>
      )

    case 'image':
      return (
        <div>
          <input
            type="url"
            value={section.url}
            onChange={(e) => onUpdate({ url: e.target.value } as Partial<DetailSection>)}
            placeholder="이미지 URL"
            className="w-full px-2 py-1.5 text-[12px] focus:outline-none"
            style={{ border: '1px solid #cacacb' }}
          />
          {section.url && (
            <div className="mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={section.url} alt={section.caption ?? ''} className="w-full object-contain" />
            </div>
          )}
          <div className="mt-2">
            <EditableText
              value={section.caption ?? ''}
              onSave={(v) => onUpdate({ caption: v || undefined } as Partial<DetailSection>)}
              maxLength={120}
              className="text-[11px] text-[#9e9ea0] block"
              placeholder="캡션 (선택)"
              showEditIcon={false}
            />
          </div>
        </div>
      )
  }
}

// ─── 키워드 chip 편집기 ─────────────────────────────────────────────────────

function KeywordsEditor({ items, onChange }: { items: string[]; onChange: (next: string[]) => void }) {
  const [input, setInput] = useState('')
  const add = () => {
    const v = input.trim()
    if (!v) return
    onChange([...items, v])
    setInput('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((it, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
            style={{ backgroundColor: '#f5f5f5', color: '#111111', border: '1px solid #e5e5e5' }}
          >
            #{it}
            <button
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="text-[#9e9ea0] hover:text-[#d30005]"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="키워드 추가..."
          className="flex-1 px-2 py-1 text-[12px] focus:outline-none"
          style={{ border: '1px solid #cacacb' }}
        />
        <button onClick={add} className="p-1 text-[#9e9ea0] hover:text-[#111111]">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── 섹션 추가 픽커 ─────────────────────────────────────────────────────────

function SectionPicker({ onPick }: { onPick: (t: DetailSectionType) => void }) {
  const types: DetailSectionType[] = ['hero', 'features', 'description', 'text', 'keywords', 'image', 'reviews', 'cta']
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map((t) => (
        <button
          key={t}
          onClick={() => onPick(t)}
          className="px-3 py-1 rounded-full text-[11px] font-semibold text-[#111111] hover:bg-[#e5e5e5] transition-colors"
          style={{ backgroundColor: '#ffffff', border: '1px solid #cacacb' }}
        >
          + {SECTION_META[t].label}
        </button>
      ))}
    </div>
  )
}

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

function extractText(sections: DetailSection[], type: DetailSectionType, field: string): string | undefined {
  const s = sections.find((x) => x.type === type)
  if (!s) return undefined
  return (s as Record<string, unknown>)[field] as string | undefined
}

function extractArr(sections: DetailSection[], type: DetailSectionType, field: string): string[] | undefined {
  const s = sections.find((x) => x.type === type)
  if (!s) return undefined
  return (s as Record<string, unknown>)[field] as string[] | undefined
}
