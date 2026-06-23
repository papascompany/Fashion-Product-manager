'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { AlertCircle, Check, Copy, Share2, MessageSquare, FileCode2, Download, Loader2, ExternalLink, Lock, Unlock, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShareSheet } from '@/components/share-sheet'
import { ThumbnailGrid, type ThumbnailItem } from '@/components/thumbnail-grid'
import { EditableText } from '@/components/editable-text'
import { RegenerateMenu } from '@/components/regenerate-menu'
import { VariantsTray } from '@/components/variants-tray'
import { PointKeywords } from '@/components/point-keywords'
import type { GenerationResult, DetailSection, SectionKind } from '@/store/studio'

// buildDefaultSections은 순수 함수 → 동기 import (번들 크기 미미)
import { buildDefaultSections } from '@/components/detail-page-editor'

// ─── 무거운 컴포넌트 lazy load ────────────────────────────────────────────────
// DetailPageEditor (~730줄) + AIFittingPanel (~430줄) 은 결과 화면 진입 후
// 스크롤해야 나오는 하단 섹션 → dynamic import로 초기 번들에서 제외.
// Quick 모드에서는 두 컴포넌트 모두 렌더링되지 않으므로 항상 코드 분할 이득.

const DetailPageEditor = dynamic(
  () => import('@/components/detail-page-editor').then((m) => ({ default: m.DetailPageEditor })),
  {
    loading: () => (
      <div className="h-32 bg-[#f5f5f5] animate-pulse" style={{ borderRadius: 0 }} />
    ),
    ssr: false,
  }
)

const AIFittingPanel = dynamic(
  () => import('@/components/ai-fitting-panel').then((m) => ({ default: m.AIFittingPanel })),
  {
    loading: () => (
      <div className="h-48 bg-[#f5f5f5] animate-pulse" style={{ borderRadius: 0 }} />
    ),
    ssr: false,
  }
)

interface ResultCardProps {
  result: GenerationResult
  mode: 'quick' | 'studio'
  projectId?: string | null
  /** UX-01 — 부분 재생성/AI Fitting 실패 시 상단 배너로 표시 */
  errorMessage?: string | null
  onDismissError?: () => void
  onSelectName: (index: number) => void
  onRegenerate?: () => void
  onSave?: () => void

  // v1.1 Phase 1 — 인라인 편집 + 부분 재생성
  onEditName?: (index: number, newName: string) => void
  onEditTagline?: (newTagline: string) => void
  onEditDescription?: (newDescription: string) => void
  onRegenerateNaming?: (refinement?: string) => Promise<void>
  onRegenerateTagline?: (refinement?: string) => Promise<void>
  onRegenerateDescription?: (refinement?: string) => Promise<void>

  // v1.1 Phase 2 — Variants / Lock / Pin & Re-roll / Detail Page Editor
  variantsCount?: { naming: number; tagline: number; description: number }
  variantsActive?: { naming: number; tagline: number; description: number }
  variantsRefinements?: {
    naming: Array<string | undefined>
    tagline: Array<string | undefined>
    description: Array<string | undefined>
  }
  onSelectVariant?: (kind: SectionKind, index: number) => void
  locks?: { naming: boolean; tagline: boolean; description: boolean }
  onToggleLock?: (kind: SectionKind) => void
  onRegenerateAll?: () => Promise<void>

  // Studio 모드 썸네일 핀
  pinnedAspectRatios?: Set<string>
  onTogglePin?: (aspectRatio: string) => void
  onRerollThumbnails?: (refinement: string) => Promise<void>

  // 상세페이지 노션 에디터 (L8)
  detailPageSections?: DetailSection[] | null
  onChangeDetailSections?: (sections: DetailSection[]) => void

  // Phase 4 — AI Fitting (Studio 모드 한정)
  productImageUrl?: string | null
  lastModelImageUrl?: string | null
  currentModelBase64?: string | null
  currentModelUrl?: string | null
  reuseLastModel?: boolean
  onToggleReuseModel?: () => void
  onModelUpload?: (base64: string) => void
  onModelClear?: () => void
  onGenerateAIFitting?: (aspectRatios: string[]) => Promise<void>
  aiFittings?: Array<{ url: string; aspectRatio: string; width: number; height: number; modelImageUrl?: string | null }>
  selectedFittingUrl?: string | null
  onSelectFittingHero?: (url: string) => void
}

export function ResultCard({
  result,
  mode,
  projectId,
  errorMessage,
  onDismissError,
  onSelectName,
  onRegenerate,
  onSave,
  onEditName,
  onEditTagline,
  onEditDescription,
  onRegenerateNaming,
  onRegenerateTagline,
  onRegenerateDescription,
  variantsCount,
  variantsActive,
  variantsRefinements,
  onSelectVariant,
  locks,
  onToggleLock,
  onRegenerateAll,
  pinnedAspectRatios,
  onTogglePin,
  onRerollThumbnails,
  detailPageSections,
  onChangeDetailSections,
  productImageUrl,
  lastModelImageUrl,
  currentModelBase64,
  currentModelUrl,
  reuseLastModel,
  onToggleReuseModel,
  onModelUpload,
  onModelClear,
  onGenerateAIFitting,
  aiFittings,
  selectedFittingUrl,
  onSelectFittingHero,
}: ResultCardProps) {
  const [regenAllLoading, setRegenAllLoading] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [detailPageHtml, setDetailPageHtml] = useState<string | null>(null)
  const [generatingDetail, setGeneratingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  // 간편모드 — AI Fitting 클릭 시 업그레이드 CTA 표시
  const [showQuickCta, setShowQuickCta] = useState(false)

  // AI Fitting 이미지 선택 → 상세페이지 hero 섹션 이미지 자동 동기화 (TYP-07)
  // detailPageSections / onChangeDetailSections 를 deps 에 포함하지 않으면 stale
  // closure 로 사용자가 편집한 다른 섹션이 wipe 될 수 있음. 무한루프는 hero 이미지가
  // 이미 selectedFittingUrl 과 동일할 때 setter 호출을 가드해서 차단한다.
  useEffect(() => {
    if (!selectedFittingUrl || !detailPageSections || !onChangeDetailSections) return
    // 이미 동일하면 no-op (가드)
    const heroIdx = detailPageSections.findIndex((s) => s.type === 'hero')
    if (heroIdx === -1) return
    const hero = detailPageSections[heroIdx]
    if (hero.type === 'hero' && hero.image === selectedFittingUrl) return
    const updated = detailPageSections.map((s) =>
      s.type === 'hero' ? ({ ...s, image: selectedFittingUrl } as DetailSection) : s
    )
    onChangeDetailSections(updated)
  }, [selectedFittingUrl, detailPageSections, onChangeDetailSections])

  const selectedName = result.names[result.selectedNameIndex]?.name ?? ''

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // ─── 상세페이지 HTML 생성 (G5) ──────────────────────────────────────────
  const handleGenerateDetailPage = async () => {
    if (!projectId) {
      setDetailError('projectId가 없습니다.')
      return
    }
    setGeneratingDetail(true)
    setDetailError(null)
    try {
      const res = await fetch('/api/generate/detail-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          productName: selectedName,
          tagline: result.tagline,
          description: result.description,
          category: result.category ?? '상품',
          keywords: result.keywords ?? [],
          features: result.features ?? [],
          thumbnailUrl: result.primaryThumbnailUrl,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '상세페이지 생성 실패')
      }
      const { html } = await res.json()
      setDetailPageHtml(html)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '상세페이지 생성 실패')
    } finally {
      setGeneratingDetail(false)
    }
  }

  const handleDownloadDetailPage = () => {
    if (!detailPageHtml) return
    const blob = new Blob([detailPageHtml], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const slug = selectedName.replace(/[^\w가-힣0-9]+/g, '-').replace(/^-|-$/g, '') || 'detail-page'
    a.href = url
    a.download = `${slug}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handlePreviewDetailPage = () => {
    if (!detailPageHtml) return
    const win = window.open('', '_blank', 'noopener,noreferrer')
    if (!win) return
    win.document.open()
    win.document.write(detailPageHtml)
    win.document.close()
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      {/* UX-01 — 부분 재생성/AI Fitting 실패 banner (부모가 dismiss 컨트롤) */}
      {errorMessage && (
        <div
          className="mb-4 flex items-start gap-2.5 p-3"
          role="status"
          aria-live="polite"
          style={{ backgroundColor: '#fff5f5', border: '1px solid #fecaca' }}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#d30005' }} />
          <p className="flex-1 text-[13px]" style={{ color: '#d30005' }}>
            {errorMessage}
          </p>
          {onDismissError && (
            <button
              onClick={onDismissError}
              aria-label="에러 알림 닫기"
              className="flex-shrink-0 p-0.5 text-[#9e9ea0] hover:text-[#111111] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      {/* 헤더 */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-black text-[#111111] mb-2">
            생성 완료
            <span className="text-[#9e9ea0] font-medium text-[20px] ml-3">— 미리보기</span>
          </h1>
          <p className="text-[13px] text-[#707072]">
            아래 결과는 스마트스토어·쿠팡에 바로 복사해 사용할 수 있습니다. 클릭하여 직접 편집하거나 ↻ 으로 부분 재생성하세요.
          </p>
        </div>
        {onRegenerateAll && locks && (
          <button
            onClick={async () => {
              setRegenAllLoading(true)
              try {
                await onRegenerateAll()
              } finally {
                setRegenAllLoading(false)
              }
            }}
            disabled={regenAllLoading || (locks.naming && locks.tagline && locks.description)}
            title={
              locks.naming && locks.tagline && locks.description
                ? '모든 항목이 잠겨있어 재생성할 항목이 없습니다'
                : '잠기지 않은 모든 항목을 다시 생성'
            }
            className="shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-[12px] font-semibold text-[#111111] hover:bg-[#f5f5f5] transition-colors disabled:opacity-50"
            style={{ border: '1px solid #cacacb' }}
          >
            {regenAllLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
            모두 다시
          </button>
        )}
      </div>

      {/* 01: AI Fitting — Studio 실제 동작, Quick 모드는 CTA 안내 */}
      <section className="mb-8">
        <SectionHeader number="01" title="AI Fitting" subtitle="모델에게 입혀보기 · Pro 이상" />

        {/* 간편모드 CTA 배너 */}
        {mode === 'quick' && showQuickCta && (
          <div
            className="mb-4 p-4 flex items-start justify-between gap-4"
            style={{ backgroundColor: '#fff9e6', border: '1px solid #f5c430' }}
          >
            <div>
              <p className="text-[13px] font-bold text-[#111111] mb-1">
                AI Fitting은 Pro 이상 플랜에서 사용 가능합니다
              </p>
              <p className="text-[12px] text-[#707072] mb-3">
                모델에게 제품을 자연스럽게 입혀주는 AI Fitting 기능은 Pro · Business 플랜 전용입니다.
              </p>
              <Link
                href="/billing"
                className="inline-flex items-center gap-1 px-4 py-1.5 text-[12px] font-bold text-white bg-[#111111] hover:bg-[#333333] transition-colors"
              >
                플랜 업그레이드 →
              </Link>
            </div>
            <button
              onClick={() => setShowQuickCta(false)}
              className="flex-shrink-0 text-[#9e9ea0] hover:text-[#111111] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <AIFittingPanel
          productImageUrl={productImageUrl ?? null}
          lastModelImageUrl={lastModelImageUrl ?? null}
          currentModelBase64={currentModelBase64 ?? null}
          currentModelUrl={currentModelUrl ?? null}
          reuseLastModel={reuseLastModel ?? true}
          onToggleReuseModel={onToggleReuseModel ?? (() => {})}
          onModelUpload={
            mode === 'quick'
              ? () => setShowQuickCta(true)
              : (onModelUpload ?? (() => {}))
          }
          onModelClear={onModelClear ?? (() => {})}
          onGenerate={
            mode === 'quick'
              ? async () => { setShowQuickCta(true) }
              : (onGenerateAIFitting ?? (async () => {}))
          }
          fittings={aiFittings ?? []}
          selectedFittingUrl={selectedFittingUrl ?? null}
          onSelectHero={onSelectFittingHero ?? (() => {})}
          // UX-05 — alt 합성용 메타
          productName={selectedName}
          category={result.category}
          keywords={result.keywords}
        />
      </section>

      {/* 02: 상품명 3종 */}
      <section className="mb-8">
        <SectionHeader
          number="02"
          title="상품명 3종"
          subtitle="트렌드 반영"
          locked={locks?.naming}
          onToggleLock={onToggleLock ? () => onToggleLock('naming') : undefined}
          action={onRegenerateNaming ? (
            <RegenerateMenu
              section="상품명"
              onRegenerate={onRegenerateNaming}
              disabled={locks?.naming}
            />
          ) : undefined}
        />
        {variantsCount && variantsActive && variantsRefinements && onSelectVariant && (
          <VariantsTray
            count={variantsCount.naming}
            activeIndex={variantsActive.naming}
            refinements={variantsRefinements.naming}
            onSelect={(i) => onSelectVariant('naming', i)}
            locked={locks?.naming}
          />
        )}
        <div
          className="grid md:grid-cols-3"
          style={{ border: '1px solid #e5e5e5' }}
        >
          {result.names.map((n, i) => {
            const isSelected = result.selectedNameIndex === i
            return (
              <div
                key={i}
                data-testid="product-name-card"
                onClick={() => onSelectName(i)}
                className="text-left p-5 transition-colors cursor-pointer hover:bg-[#f5f5f5]"
                style={{
                  backgroundColor: isSelected ? '#f5f5f5' : '#ffffff',
                  borderRight: i < result.names.length - 1 ? '1px solid #e5e5e5' : undefined,
                  borderTop: isSelected ? '3px solid #111111' : '3px solid transparent',
                }}
              >
                <div className="text-[11px] font-semibold text-[#9e9ea0] uppercase tracking-widest mb-1.5 flex items-center gap-2">
                  Option {i + 1}
                  {isSelected && (
                    <span className="px-1.5 py-0.5 bg-[#111111] text-white text-[9px] font-black tracking-widest">
                      선택됨
                    </span>
                  )}
                </div>
                {/* 클릭 = 편집. onEditName 미전달 시 read-only */}
                <div
                  className="mb-2 leading-snug"
                  onClick={(e) => onEditName && e.stopPropagation()}
                >
                  {onEditName ? (
                    <EditableText
                      value={n.name}
                      onSave={(v) => onEditName(i, v)}
                      maxLength={40}
                      className="text-[18px] font-bold text-[#111111] block"
                      placeholder="상품명을 입력하세요"
                      showEditIcon={false}
                    />
                  ) : (
                    <div className="text-[18px] font-bold text-[#111111]">{n.name}</div>
                  )}
                </div>
                <div className="text-[12px] text-[#707072]">{n.trend}</div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 03: 한줄 홍보문구 */}
      <section className="mb-8">
        <SectionHeader
          number="03"
          title="한줄 홍보문구"
          subtitle="35자 이내"
          locked={locks?.tagline}
          onToggleLock={onToggleLock ? () => onToggleLock('tagline') : undefined}
          action={onRegenerateTagline ? (
            <RegenerateMenu
              section="홍보문구"
              onRegenerate={onRegenerateTagline}
              disabled={locks?.tagline}
            />
          ) : undefined}
        />
        {variantsCount && variantsActive && variantsRefinements && onSelectVariant && (
          <VariantsTray
            count={variantsCount.tagline}
            activeIndex={variantsActive.tagline}
            refinements={variantsRefinements.tagline}
            onSelect={(i) => onSelectVariant('tagline', i)}
            locked={locks?.tagline}
          />
        )}
        <div
          className="p-8 relative group"
          style={{ backgroundColor: '#111111' }}
        >
          {onEditTagline ? (
            <div className="text-[28px] font-black text-white leading-tight tracking-tight">
              <span className="text-white">&ldquo;</span>
              <span className="inline-block">
                <EditableText
                  value={result.tagline}
                  onSave={onEditTagline}
                  maxLength={35}
                  className="text-[28px] font-black text-white leading-tight tracking-tight"
                  placeholder="홍보문구"
                  showEditIcon={false}
                />
              </span>
              <span className="text-white">&rdquo;</span>
            </div>
          ) : (
            <p className="text-[28px] font-black text-white leading-tight tracking-tight">
              &ldquo;{result.tagline}&rdquo;
            </p>
          )}
          <PointKeywords keywords={result.pointKeywords} variant="dark" className="mt-4" />
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[12px] text-[#9e9ea0]">
              {result.tagline.length}자 · 검색 노출 최적화됨
            </span>
            <button
              onClick={() => copyToClipboard(result.tagline, 'tagline')}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-[#1c1c1c] text-[#9e9ea0] hover:text-white"
            >
              {copiedField === 'tagline' ? (
                <Check className="w-4 h-4" style={{ color: '#007d48' }} />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </section>

      {/* 04: 상세 설명 */}
      <section className="mb-8">
        <SectionHeader
          number="04"
          title="상세 설명"
          locked={locks?.description}
          onToggleLock={onToggleLock ? () => onToggleLock('description') : undefined}
          action={onRegenerateDescription ? (
            <RegenerateMenu
              section="상세 설명"
              onRegenerate={onRegenerateDescription}
              disabled={locks?.description}
            />
          ) : undefined}
        />
        {variantsCount && variantsActive && variantsRefinements && onSelectVariant && (
          <VariantsTray
            count={variantsCount.description}
            activeIndex={variantsActive.description}
            refinements={variantsRefinements.description}
            onSelect={(i) => onSelectVariant('description', i)}
            locked={locks?.description}
          />
        )}
        <div
          className="p-6 relative group"
          style={{ border: '1px solid #e5e5e5', backgroundColor: '#ffffff' }}
        >
          {onEditDescription ? (
            <EditableText
              value={result.description}
              onSave={onEditDescription}
              multiline
              maxLength={800}
              className="text-[13px] text-[#111111] leading-relaxed whitespace-pre-wrap block"
              placeholder="상세 설명을 입력하세요"
              showEditIcon={false}
            />
          ) : (
            <pre className="text-[13px] text-[#111111] leading-relaxed whitespace-pre-wrap font-sans">
              {result.description}
            </pre>
          )}
          <button
            onClick={() => copyToClipboard(result.description, 'description')}
            className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-[#f5f5f5] text-[#9e9ea0] hover:text-[#111111]"
          >
            {copiedField === 'description' ? (
              <Check className="w-4 h-4" style={{ color: '#007d48' }} />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>
      </section>

      {/* 스튜디오 모드 전용: 05 썸네일 */}
      {mode === 'studio' && result.thumbnails && result.thumbnails.length > 0 && (
        <section className="mb-8">
          <SectionHeader number="05" title="썸네일" subtitle="Nano Banana 2 · Pin & Re-roll" />
          <ThumbnailGrid
            thumbnails={result.thumbnails
              .filter((t): t is typeof t & { url: string } => !!t.url)
              .map<ThumbnailItem>((t) => ({
                url: t.url,
                width: t.width ?? 0,
                height: t.height ?? 0,
                aspectRatio: t.ratio,
              }))}
            onSelectPrimary={(thumb) => {
              void thumb
            }}
            pinnedAspectRatios={pinnedAspectRatios}
            onTogglePin={onTogglePin}
            onReroll={onRerollThumbnails}
          />
        </section>
      )}

      {/* 스튜디오 모드 전용: 06 상세페이지 노션 에디터 (L8, 이전 05) */}
      {mode === 'studio' && (
        <section className="mb-8">
          <SectionHeader number="06" title="상세페이지" subtitle="섹션 에디터 · 드래그·편집·내보내기" />
          {onChangeDetailSections ? (
            (() => {
              // D-4 보강: selectedFittingUrl 이 있으면 그것을 hero 이미지로 우선 사용
              // (AI Fitting 으로 모델이 입은 모습 > 원본 썸네일)
              const heroImage = selectedFittingUrl ?? result.primaryThumbnailUrl
              const defaultsCommon = {
                productName: selectedName || (result.names[0]?.name ?? '상품'),
                tagline: result.tagline,
                description: result.description,
                keywords: result.keywords ?? [],
                features: result.features ?? [],
                pointKeywords: result.pointKeywords ?? [],
                thumbnailUrl: heroImage,
              }
              return (
                <DetailPageEditor
                  sections={detailPageSections ?? buildDefaultSections(defaultsCommon)}
                  onChange={onChangeDetailSections}
                  projectId={projectId}
                  defaults={defaultsCommon}
                />
              )
            })()
          ) : (
            // Fallback (구버전 호출자) — 정적 HTML 생성 UI 유지
            <LegacyDetailPagePanel
              detailPageHtml={detailPageHtml}
              detailError={detailError}
              generatingDetail={generatingDetail}
              copiedField={copiedField}
              onGenerate={handleGenerateDetailPage}
              onPreview={handlePreviewDetailPage}
              onDownload={handleDownloadDetailPage}
            />
          )}
        </section>
      )}

      {/* 스튜디오 모드 전용: 07 공유 (이전 06) */}
      {mode === 'studio' && (
        <section className="mb-8">
          <SectionHeader number="07" title="공유하기" />
          <div
            className="grid grid-cols-3"
            style={{ border: '1px solid #e5e5e5' }}
          >
            <ShareButton
              icon={<MessageSquare className="w-5 h-5" />}
              label="SMS"
              borderRight
              onClick={() => setShareOpen(true)}
            />
            <ShareButton
              icon={
                <div className="w-6 h-6 rounded-full bg-[#f5c430] flex items-center justify-center text-[11px] font-black text-[#111111]">K</div>
              }
              label="카카오톡"
              borderRight
              onClick={() => setShareOpen(true)}
            />
            <ShareButton
              icon={<Share2 className="w-5 h-5" />}
              label="링크 복사"
              onClick={() => setShareOpen(true)}
            />
          </div>
        </section>
      )}

      {/* ShareSheet 모달 */}
      {shareOpen && projectId && (
        <ShareSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          projectId={projectId}
          productName={selectedName}
          tagline={result.tagline}
        />
      )}

      {/* SynthID 고지 */}
      {mode === 'studio' && (
        <div
          className="mb-6 p-3 text-[11px] text-[#707072] leading-relaxed"
          style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }}
        >
          <strong className="text-[#111111]">고지:</strong> 스튜디오 모드로 생성된
          이미지는 Google SynthID 워터마크를 포함하며, AI 생성 콘텐츠임을 식별할 수 있습니다.
        </div>
      )}

      <div className="h-px bg-[#e5e5e5] mb-6" />

      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={onRegenerate}
          className="px-5 rounded-full text-[13px] font-semibold border-[#cacacb] text-[#111111] hover:border-[#111111]"
        >
          다시 생성
        </Button>
        <Button
          onClick={onSave}
          title="이 페이지의 인라인 편집은 자동 저장되지 않습니다. 히스토리에서 다시 진입하면 원본으로 복원될 수 있어요."
          className="px-5 rounded-full bg-[#111111] text-white text-[13px] font-semibold hover:bg-[#333333]"
        >
          히스토리로
        </Button>
      </div>
    </div>
  )
}

// ─── 서브 컴포넌트 ─────────────────────────────────────────────────────────

function SectionHeader({
  number,
  title,
  subtitle,
  action,
  locked,
  onToggleLock,
}: {
  number: string
  title: string
  subtitle?: string
  action?: React.ReactNode
  locked?: boolean
  onToggleLock?: () => void
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div
        className="w-6 h-6 text-white text-[11px] font-black flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: '#111111' }}
      >
        {number}
      </div>
      <h2 className="text-[20px] font-black text-[#111111] flex-1">
        {title}
        {subtitle && (
          <span className="text-[#9e9ea0] font-medium text-[14px] ml-2">— {subtitle}</span>
        )}
      </h2>
      {onToggleLock && (
        <button
          onClick={onToggleLock}
          title={locked ? '잠금 해제 (다시 재생성 가능)' : '잠금 (이 섹션은 재생성에서 제외)'}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold transition-colors"
          style={{
            backgroundColor: locked ? '#111111' : '#ffffff',
            color: locked ? '#ffffff' : '#707072',
            border: `1px solid ${locked ? '#111111' : '#cacacb'}`,
          }}
        >
          {locked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
          {locked ? '잠김' : '잠금'}
        </button>
      )}
      {action}
    </div>
  )
}

// Legacy 상세페이지 패널 (onChangeDetailSections 미전달 시 fallback)
function LegacyDetailPagePanel({
  detailPageHtml,
  detailError,
  generatingDetail,
  copiedField,
  onGenerate,
  onPreview,
  onDownload,
}: {
  detailPageHtml: string | null
  detailError: string | null
  generatingDetail: boolean
  copiedField: string | null
  onGenerate: () => void
  onPreview: () => void
  onDownload: () => void
}) {
  void copiedField
  if (!detailPageHtml) {
    return (
      <div className="p-8 text-center" style={{ border: '2px dashed #e5e5e5', backgroundColor: '#f5f5f5' }}>
        <div className="w-12 h-12 mx-auto flex items-center justify-center mb-4" style={{ backgroundColor: '#111111' }}>
          <FileCode2 className="w-6 h-6 text-white" />
        </div>
        <p className="text-[15px] font-semibold text-[#111111] mb-1">상품 상세페이지 자동 조립</p>
        <p className="text-[13px] text-[#707072] mb-5">
          Hero · 핵심 특징 · 상품 소개 · 키워드 · 리뷰 플레이스홀더까지 한 번에
        </p>
        <Button
          onClick={onGenerate}
          disabled={generatingDetail}
          className="rounded-full bg-[#111111] text-white text-[13px] font-semibold hover:bg-[#333333] px-6"
        >
          {generatingDetail ? (
            <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> 조립 중...</>
          ) : (
            <><FileCode2 className="w-4 h-4 mr-1.5" /> 상세페이지 생성</>
          )}
        </Button>
        {detailError && (
          <p className="mt-3 text-[12px]" style={{ color: '#d30005' }}>{detailError}</p>
        )}
      </div>
    )
  }
  return (
    <div style={{ border: '1px solid #e5e5e5', backgroundColor: '#ffffff', overflow: 'hidden' }}>
      <iframe
        title="상세페이지 미리보기"
        srcDoc={detailPageHtml}
        // UX-09 — allow-same-origin 제거 (부모 origin 권한으로 fetch 가능성 차단)
        sandbox="allow-popups"
        referrerPolicy="no-referrer"
        className="w-full h-[420px] bg-white"
        style={{ borderBottom: '1px solid #e5e5e5' }}
      />
      <div className="flex items-center justify-between p-4" style={{ backgroundColor: '#f5f5f5' }}>
        <span className="text-[12px] text-[#707072]">
          {Math.round(detailPageHtml.length / 1024)}KB
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onPreview} className="rounded-full text-[12px] border-[#cacacb] text-[#111111] hover:border-[#111111]">
            <ExternalLink className="w-3.5 h-3.5 mr-1" /> 새 창
          </Button>
          <Button onClick={onDownload} className="rounded-full bg-[#111111] text-white text-[12px] font-semibold hover:bg-[#333333]">
            <Download className="w-3.5 h-3.5 mr-1" /> HTML 다운로드
          </Button>
        </div>
      </div>
    </div>
  )
}

function ShareButton({
  icon,
  label,
  borderRight,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  borderRight?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="p-5 hover:bg-[#f5f5f5] transition-colors flex flex-col items-center gap-2"
      style={{
        backgroundColor: '#ffffff',
        borderRight: borderRight ? '1px solid #e5e5e5' : undefined,
      }}
    >
      <div className="text-[#111111]">{icon}</div>
      <span className="text-[13px] font-semibold text-[#111111]">{label}</span>
    </button>
  )
}
