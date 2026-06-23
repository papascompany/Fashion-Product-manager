'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Zap, Wand2, Clock, ImageOff, ChevronRight, Trash2, Loader2, Shirt, X, Download } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { FittingHistoryItem } from '@/lib/history-items'

interface Generation {
  type: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
}

interface Project {
  id: string
  mode: string
  status: string
  product_image_url: string | null
  created_at: string
  updated_at: string
  generations: Generation[]
}

interface Props {
  projects: Project[]
  fittings?: FittingHistoryItem[]
  plan?: string
  retentionDays?: number | null
}

/** '전체' 뷰에서 projects + fittings 를 created_at 기준으로 병합하기 위한 판별 유니온 */
type MergedItem =
  | { kind: 'project'; createdAt: string; project: Project }
  | { kind: 'fitting'; createdAt: string; fitting: FittingHistoryItem }

export function HistoryClient({ projects: initialProjects, fittings = [], plan = 'free', retentionDays = 7 }: Props) {
  const [filter, setFilter] = useState<'all' | 'quick' | 'studio' | 'fitting'>('all')
  const [projects, setProjects] = useState<Project[]>(initialProjects)
  const [deleteState, setDeleteState] = useState<Record<string, 'confirm' | 'deleting'>>({})
  // UX-11 — 피팅 카드 클릭 시 인플레이스 미리보기 (새 탭 대신 모달)
  const [fittingPreview, setFittingPreview] = useState<FittingHistoryItem | null>(null)

  // '전체' 뷰: projects + fittings 를 created_at desc 로 병합.
  // 'quick' | 'studio': 해당 모드의 프로젝트만. 'fitting': AI 피팅 결과만.
  const mergedItems = useMemo<MergedItem[]>(() => {
    if (filter === 'fitting') {
      return fittings.map((f) => ({ kind: 'fitting' as const, createdAt: f.createdAt, fitting: f }))
    }

    const projectItems: MergedItem[] = (
      filter === 'all' ? projects : projects.filter((p) => p.mode === filter)
    ).map((p) => ({ kind: 'project' as const, createdAt: p.created_at, project: p }))

    if (filter !== 'all') return projectItems

    const fittingItems: MergedItem[] = fittings.map((f) => ({
      kind: 'fitting' as const,
      createdAt: f.createdAt,
      fitting: f,
    }))

    return [...projectItems, ...fittingItems].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
    )
  }, [filter, projects, fittings])

  const handleDeleteClick = (projectId: string) => {
    setDeleteState((prev) => ({ ...prev, [projectId]: 'confirm' }))
  }

  const handleDeleteCancel = (projectId: string) => {
    setDeleteState((prev) => {
      const next = { ...prev }
      delete next[projectId]
      return next
    })
  }

  const handleDeleteConfirm = async (projectId: string) => {
    setDeleteState((prev) => ({ ...prev, [projectId]: 'deleting' }))
    try {
      const supabase = createClient()
      const { error } = await supabase.from('projects').delete().eq('id', projectId)
      if (error) throw error
      setProjects((prev) => prev.filter((p) => p.id !== projectId))
    } catch {
      setDeleteState((prev) => ({ ...prev, [projectId]: 'confirm' }))
    } finally {
      setDeleteState((prev) => {
        const next = { ...prev }
        delete next[projectId]
        return next
      })
    }
  }

  const getProductName = (p: Project): string => {
    const naming = p.generations?.find((g) => g.type === 'naming')
    const names = naming?.payload?.names as Array<{ name: string }> | undefined
    return names?.[0]?.name ?? '상품명 없음'
  }

  const getTagline = (p: Project): string => {
    const tagline = p.generations?.find((g) => g.type === 'tagline')
    return (tagline?.payload?.tagline as string) ?? ''
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      {/* 헤더 */}
      <div className="mb-8">
        <h1 className="text-[28px] font-black text-[#111111] mb-2">
          히스토리
          <span className="text-[#9e9ea0] font-medium text-[18px] ml-3">— 생성 내역</span>
        </h1>
        <p className="text-[13px] text-[#707072]">
          {retentionDays === null
            ? '모든 AI 생성 내역을 확인할 수 있습니다 (무제한 보관).'
            : `최근 ${retentionDays}일간의 AI 생성 내역입니다 · `}
          {retentionDays !== null && (
            <a href="/billing" className="underline hover:text-[#111111] transition-colors">
              {plan === 'free' ? 'Starter 업그레이드 시 30일 보관' : 'Pro 업그레이드 시 무제한 보관'}
            </a>
          )}
        </p>
      </div>

      {/* 필터 탭 */}
      <div className="flex items-center gap-2 mb-6">
        {(['all', 'quick', 'studio', 'fitting'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-4 py-1.5 rounded-full text-[13px] font-semibold transition-colors"
            style={{
              backgroundColor: filter === f ? '#111111' : '#f5f5f5',
              color: filter === f ? '#ffffff' : '#707072',
            }}
          >
            {f === 'all'
              ? '전체'
              : f === 'quick'
              ? '간편 모드'
              : f === 'studio'
              ? '스튜디오 모드'
              : 'AI 피팅'}
          </button>
        ))}
        <span className="ml-auto text-[12px] text-[#9e9ea0]">
          {mergedItems.length}건
        </span>
      </div>

      {/* 목록 */}
      {mergedItems.length === 0 ? (
        <div className="text-center py-20">
          <div
            className="w-16 h-16 mx-auto flex items-center justify-center mb-4"
            style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }}
          >
            <Clock className="w-8 h-8 text-[#9e9ea0]" />
          </div>
          <p className="text-[13px] text-[#9e9ea0]">
            {filter === 'fitting' ? 'AI 피팅 내역이 없습니다.' : '생성 내역이 없습니다.'}
          </p>
          <Link
            href="/studio"
            className="mt-4 inline-block text-[13px] font-bold text-[#111111] hover:underline"
          >
            스튜디오로 이동 →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {mergedItems.map((item) => {
            // ─── AI 피팅 결과 카드 — UX-11: 일반 카드와 같은 인플레이스 미리보기 패턴 ─
            // 이전: 새 탭에서 result_url 직접 열기 (탐색 비일관).
            // 변경: button + 모달 미리보기 — 일반 카드의 클릭→상세 보기와 같은 멘탈모델.
            // (삭제 UI 는 projects.delete 기반이라 피팅 카드에는 노출하지 않음 — 읽기 전용)
            if (item.kind === 'fitting') {
              const fitting = item.fitting
              return (
                <button
                  key={`fitting-${fitting.id}`}
                  type="button"
                  onClick={() => setFittingPreview(fitting)}
                  className="group flex items-center gap-4 p-5 hover:bg-[#f5f5f5] transition-all cursor-pointer relative text-left w-full"
                  style={{ border: '1px solid #e5e5e5', backgroundColor: '#ffffff' }}
                >
                  {/* hover 시 좌측 검정 인디케이터 */}
                  <span
                    className="absolute left-0 top-0 bottom-0 w-1 bg-[#111111] opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-hidden
                  />
                  {/* 썸네일 — 피팅 결과 이미지 */}
                  <div
                    className="w-16 h-16 relative overflow-hidden flex-shrink-0"
                    style={{ border: '1px solid #e5e5e5', backgroundColor: '#f5f5f5' }}
                  >
                    {fitting.resultUrl ? (
                      <Image
                        src={fitting.resultUrl}
                        alt="AI 피팅 결과"
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageOff className="w-5 h-5 text-[#9e9ea0]" />
                      </div>
                    )}
                  </div>

                  {/* 내용 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {/* AI 피팅 태그 */}
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
                        style={{ backgroundColor: '#111111', color: '#ffffff' }}
                      >
                        <Shirt className="w-3 h-3" />
                        AI 피팅
                      </span>
                      {fitting.aspectRatio && (
                        <span
                          className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ backgroundColor: '#f5f5f5', color: '#707072' }}
                        >
                          {fitting.aspectRatio}
                        </span>
                      )}
                    </div>
                    <p className="text-[15px] font-bold text-[#111111] truncate">
                      AI 피팅 결과
                    </p>
                    <p className="text-[11px] text-[#9e9ea0] mt-1">
                      {formatDate(fitting.createdAt)}
                    </p>
                  </div>

                  {/* 액션 — 일반 카드와 동일한 패턴 (인플레이스 미리보기) */}
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold text-[#111111] transition-colors opacity-100 md:opacity-0 group-hover:opacity-100"
                      style={{ backgroundColor: '#f5f5f5', border: '1px solid #cacacb' }}
                    >
                      미리보기
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </button>
              )
            }

            // ─── 일반 생성물(프로젝트) 카드 — 기존 동작 그대로 ────────────────
            const project = item.project
            const productName = getProductName(project)
            const tagline = getTagline(project)
            const ModeIcon = project.mode === 'quick' ? Zap : Wand2

            return (
              <Link
                key={project.id}
                href={`/studio?projectId=${project.id}`}
                className="group flex items-center gap-4 p-5 hover:bg-[#f5f5f5] transition-all cursor-pointer relative"
                style={{ border: '1px solid #e5e5e5', backgroundColor: '#ffffff' }}
              >
                {/* hover 시 좌측 검정 인디케이터 */}
                <span
                  className="absolute left-0 top-0 bottom-0 w-1 bg-[#111111] opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-hidden
                />
                {/* 썸네일 */}
                <div
                  className="w-16 h-16 relative overflow-hidden flex-shrink-0"
                  style={{ border: '1px solid #e5e5e5', backgroundColor: '#f5f5f5' }}
                >
                  {project.product_image_url ? (
                    <Image
                      src={project.product_image_url}
                      alt={productName}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageOff className="w-5 h-5 text-[#9e9ea0]" />
                    </div>
                  )}
                </div>

                {/* 내용 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {/* 모드 태그 */}
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
                      style={{ backgroundColor: '#111111', color: '#ffffff' }}
                    >
                      <ModeIcon className="w-3 h-3" />
                      {project.mode === 'quick' ? '간편' : '스튜디오'}
                    </span>
                    {/* 상태 태그 */}
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{
                        backgroundColor:
                          project.status === 'done' ? '#f0faf6'
                          : project.status === 'processing' ? '#fffbeb'
                          : '#fff5f5',
                        color:
                          project.status === 'done' ? '#007d48'
                          : project.status === 'processing' ? '#b45309'
                          : '#d30005',
                      }}
                    >
                      {project.status === 'done'
                        ? '완료'
                        : project.status === 'processing'
                        ? '생성중'
                        : '오류'}
                    </span>
                  </div>
                  <p className="text-[15px] font-bold text-[#111111] truncate">{productName}</p>
                  {tagline && (
                    <p className="text-[12px] text-[#707072] truncate mt-0.5">
                      &ldquo;{tagline}&rdquo;
                    </p>
                  )}
                  <p className="text-[11px] text-[#9e9ea0] mt-1">
                    {formatDate(project.created_at)}
                  </p>
                </div>

                {/* 액션 */}
                <div className="flex items-center gap-2">
                  {deleteState[project.id] === 'confirm' ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteCancel(project.id) }}
                        className="px-3 py-1 rounded-full text-[12px] font-semibold text-[#707072] hover:text-[#111111] transition-colors"
                        style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }}
                      >
                        취소
                      </button>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteConfirm(project.id) }}
                        className="px-3 py-1 rounded-full text-[12px] font-semibold text-white transition-colors"
                        style={{ backgroundColor: '#d30005' }}
                      >
                        삭제
                      </button>
                    </div>
                  ) : deleteState[project.id] === 'deleting' ? (
                    <div className="p-2">
                      <Loader2 className="w-4 h-4 text-[#9e9ea0] animate-spin" />
                    </div>
                  ) : (
                    <button
                      className="p-2 rounded-full text-[#9e9ea0] hover:text-[#d30005] hover:bg-[#fff5f5] transition-colors opacity-0 group-hover:opacity-100"
                      title="삭제"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleDeleteClick(project.id)
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {/* 명확한 CTA — 결과 보기 */}
                  <span
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold text-[#111111] transition-colors opacity-100 md:opacity-0 group-hover:opacity-100"
                    style={{ backgroundColor: '#f5f5f5', border: '1px solid #cacacb' }}
                  >
                    결과 보기
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* UX-11 — 피팅 인플레이스 미리보기 모달 */}
      {fittingPreview && (
        <FittingPreviewModal
          item={fittingPreview}
          onClose={() => setFittingPreview(null)}
        />
      )}
    </div>
  )
}

// ─── 피팅 미리보기 모달 (UX-04 a11y + UX-11 탐색 일관성) ───────────────────
function FittingPreviewModal({ item, onClose }: { item: FittingHistoryItem; onClose: () => void }) {
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
        aria-labelledby="fitting-preview-title"
        className="w-full max-w-2xl bg-white overflow-hidden"
        style={{ border: '1px solid #e5e5e5' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #e5e5e5' }}>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
              style={{ backgroundColor: '#111111', color: '#ffffff' }}
            >
              <Shirt className="w-3 h-3" />
              AI 피팅
            </span>
            <h3 id="fitting-preview-title" className="text-[14px] font-black text-[#111111]">
              피팅 결과 미리보기 {item.aspectRatio ? `· ${item.aspectRatio}` : ''}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="미리보기 닫기"
            className="p-1 text-[#707072] hover:text-[#111111]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 flex flex-col items-center gap-3" style={{ backgroundColor: '#f5f5f5' }}>
          {item.resultUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.resultUrl}
              alt="AI 피팅 결과"
              className="max-w-full object-contain bg-white"
              style={{ maxHeight: '60vh', border: '1px solid #e5e5e5' }}
            />
          ) : (
            <div className="w-full h-64 flex items-center justify-center bg-white">
              <ImageOff className="w-8 h-8 text-[#9e9ea0]" />
            </div>
          )}
          {item.resultUrl && (
            <a
              href={item.resultUrl}
              download={`ai-fitting-${(item.aspectRatio ?? '1x1').replace(':', 'x')}.png`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-[12px] font-bold text-white bg-[#111111] hover:bg-[#333333] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              다운로드
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
