'use client'

/**
 * AIFittingPanel — 색상·디자인 변형별 다중 합성
 *
 * 1. 생성할 비율 선택 (D안 — 체크박스 + 채널 힌트)
 * 2. 제품 변형: 원본 + 셀러가 추가로 올린 색상·디자인 사진 (최대 MAX_PRODUCT_VARIANTS)
 * 3. 모델 + 실행: 선택한 변형 × 비율을 같은 모델에 합성. 크레딧 = 변형마다 기존 단가 합산
 * 4. 결과: 변형별 그룹 · 대표(hero) 지정 · 선택/전체 일괄 다운로드(ZIP)
 *
 * D-3: Pro 이상만 — 비-Pro 클릭 시 CreditGuardModal 트리거 (부모에서 처리)
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  Loader2, Upload, Sparkles, Download, X, RefreshCw, Plus, Star,
  Image as ImageIcon, AlertCircle, Check,
} from 'lucide-react'
import { aiFittingCredits } from '@/lib/credit-guard'
import { buildImageName, downloadImages, ratioToken, type DownloadItem } from '@/lib/download-images'
import {
  MAX_PRODUCT_VARIANTS,
  ORIGINAL_VARIANT_ID,
  type AiFittingItem,
  type VariantKind,
} from '@/store/studio'

export interface FittingVariantView {
  id: string
  label: string
  kind: VariantKind | null
  imageUrl: string | null
  isOriginal: boolean
}

export type VariantRunState =
  | { state: 'running' }
  | { state: 'done'; count: number }
  | { state: 'failed'; message: string }

export type VariantStatusCallback = (variantId: string, status: VariantRunState) => void

interface AIFittingPanelProps {
  /** 원본이 첫 번째 */
  variants: FittingVariantView[]
  onAddVariant: (file: File) => Promise<void>
  onUpdateVariant: (id: string, patch: { label?: string; kind?: VariantKind }) => void
  onRemoveVariant: (id: string) => void
  /** 직전에 업로드한 모델 (재사용 옵션 표시용) */
  lastModelImageUrl: string | null
  /** 현재 사용 중인 모델 (base64 or URL) — 새로 올렸을 때 즉시 미리보기 */
  currentModelBase64: string | null
  currentModelUrl: string | null
  reuseLastModel: boolean
  onToggleReuseModel: () => void
  onModelUpload: (base64: string) => void
  onModelClear: () => void
  /** 선택한 비율 × 변형을 합성. 변형별 진행 상태는 onStatus 로 보고 */
  onGenerate: (aspectRatios: string[], variantIds: string[], onStatus: VariantStatusCallback) => Promise<void>
  /** 진행 중인 배치 중단 (진행 중 요청 abort + 남은 변형 취소) */
  onCancel?: () => void
  fittings: AiFittingItem[]
  selectedFittingUrl: string | null
  onSelectHero: (url: string) => void
  /** UX-05 — alt·파일명 합성용 */
  productName?: string
  category?: string
  keywords?: string[]
}

// ─── D안 — 비율별 채널 힌트 ─────────────────────────────────────────────────
const RATIO_OPTIONS: Array<{ value: string; label: string; channel: string }> = [
  { value: '1:1',  label: '1:1',  channel: '인스타 피드 · 스마트스토어 메인' },
  { value: '4:5',  label: '4:5',  channel: '인스타 세로 · 쿠팡 메인' },
  { value: '9:16', label: '9:16', channel: '인스타 스토리·릴스' },
]

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MODEL_MAX_MB = 10
// /api/upload 상한과 동일
const VARIANT_MAX_MB = 20

const KIND_LABEL: Record<VariantKind, string> = { color: '색상', design: '디자인' }

export function AIFittingPanel(p: AIFittingPanelProps) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [runStates, setRunStates] = useState<Record<string, VariantRunState>>({})
  const [runTotal, setRunTotal] = useState(0)
  const [addingVariant, setAddingVariant] = useState(false)
  const [excludedVariantIds, setExcludedVariantIds] = useState<Set<string>>(new Set())
  const [downloadSelection, setDownloadSelection] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState(false)
  const [downloadNote, setDownloadNote] = useState<string | null>(null)
  const cancelledRef = useRef(false)
  const modelInputRef = useRef<HTMLInputElement | null>(null)
  const variantInputRef = useRef<HTMLInputElement | null>(null)

  const buildAlt = useCallback((kind: string): string => {
    const name = (p.productName ?? '').trim()
    const cat = (p.category ?? '').trim()
    const kw = (p.keywords ?? []).slice(0, 2).filter(Boolean).join(' · ')
    const parts = [name, cat, kw].filter(Boolean)
    if (parts.length === 0) return kind
    return `${kind} — ${parts.join(' · ')}`
  }, [p.productName, p.category, p.keywords])

  // 변형 1개 실행 시에만 시간 기반 진행률 — 여러 개면 완료 개수로 표시.
  // 시작값(8)·초기화(0)는 생성/취소 핸들러에서 설정한다.
  useEffect(() => {
    if (!generating) return
    const interval = setInterval(() => {
      setProgress((cur) => {
        if (cur >= 95) return cur
        const delta = cur < 60 ? 2 : cur < 85 ? 1 : 0.5
        return Math.min(cur + delta, 95)
      })
    }, 800)
    return () => clearInterval(interval)
  }, [generating])

  const [selectedRatios, setSelectedRatios] = useState<Set<string>>(new Set(['1:1', '4:5', '9:16']))
  const toggleRatio = (ratio: string) => {
    setSelectedRatios((prev) => {
      const next = new Set(prev)
      if (next.has(ratio)) next.delete(ratio)
      else next.add(ratio)
      return next
    })
  }

  const runnableVariants = p.variants.filter((v) => Boolean(v.imageUrl))
  const selectedVariants = runnableVariants.filter((v) => !excludedVariantIds.has(v.id))
  const ratioCount = selectedRatios.size
  const variantCount = selectedVariants.length
  // TYP-06 — 단가는 서버 SoT(aiFittingCredits). 변형마다 별도 요청이므로 합산
  const creditsPerVariant = aiFittingCredits(ratioCount)
  const totalImages = ratioCount * variantCount
  const totalCredits = ratioCount === 0 ? 0 : creditsPerVariant * variantCount
  const canAddVariant = p.variants.length < MAX_PRODUCT_VARIANTS

  const toggleVariant = (id: string) => {
    setExcludedVariantIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const effectiveModel = p.currentModelBase64
    ?? p.currentModelUrl
    ?? (p.reuseLastModel ? p.lastModelImageUrl : null)
  const hasModel = !!effectiveModel

  // ─── 업로드 ────────────────────────────────────────────────────────────
  const validateFile = (file: File, maxMb: number): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) return 'JPG, PNG, WebP 형식만 지원합니다.'
    if (file.size > maxMb * 1024 * 1024) return `파일 크기는 ${maxMb}MB 이하여야 합니다.`
    return null
  }

  const handleModelFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const invalid = validateFile(file, MODEL_MAX_MB)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = () => p.onModelUpload(reader.result as string)
    reader.onerror = () => setError('파일 읽기 실패')
    reader.readAsDataURL(file)
  }, [p])

  const handleVariantFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const invalid = validateFile(file, VARIANT_MAX_MB)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setAddingVariant(true)
    try {
      await p.onAddVariant(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : '변형 사진 업로드 실패')
    } finally {
      setAddingVariant(false)
    }
  }

  // ─── 생성 ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (ratioCount === 0) {
      setError('생성할 비율을 최소 1개 선택해주세요.')
      return
    }
    if (variantCount === 0) {
      setError('합성할 제품 변형을 최소 1개 선택해주세요.')
      return
    }
    const ids = selectedVariants.map((v) => v.id)
    setError(null)
    setRunStates(Object.fromEntries(ids.map((id) => [id, { state: 'running' } as VariantRunState])))
    setRunTotal(ids.length)
    setProgress(8)
    setGenerating(true)
    cancelledRef.current = false
    try {
      await p.onGenerate(Array.from(selectedRatios), ids, (variantId, status) => {
        if (cancelledRef.current) return
        setRunStates((prev) => ({ ...prev, [variantId]: status }))
      })
    } catch (err) {
      if (cancelledRef.current) return
      setError(err instanceof Error ? err.message : 'AI Fitting 실패')
    } finally {
      setGenerating(false)
      setProgress(0)
    }
  }

  const handleCancel = () => {
    cancelledRef.current = true
    p.onCancel?.()
    setGenerating(false)
    setProgress(0)
    setRunStates((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, s]) => [id, s.state === 'running' ? { state: 'failed', message: '취소됨' } : s]),
      ) as Record<string, VariantRunState>,
    )
    setError('취소했어요. 이미 서버에서 처리 중이던 변형은 크레딧이 차감될 수 있습니다.')
  }

  const finishedCount = Object.values(runStates).filter((s) => s.state !== 'running').length
  const failedCount = Object.values(runStates).filter((s) => s.state === 'failed').length
  const progressPct = runTotal <= 1
    ? progress
    : Math.max(5, Math.round((finishedCount / runTotal) * 100))

  // ─── 결과 그룹 ─────────────────────────────────────────────────────────
  const labelOf = useCallback(
    (variantId: string) => {
      const v = p.variants.find((x) => x.id === variantId)
      return v?.label.trim() || (variantId === ORIGINAL_VARIANT_ID ? '기본' : '변형')
    },
    [p.variants],
  )

  const groups = useMemo(() => {
    const order = new Map(p.variants.map((v, i) => [v.id, i]))
    const map = new Map<string, AiFittingItem[]>()
    for (const f of p.fittings) {
      const id = f.variantId ?? ORIGINAL_VARIANT_ID
      const list = map.get(id) ?? []
      list.push(f)
      map.set(id, list)
    }
    return [...map.entries()]
      .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
      .map(([variantId, items]) => ({ variantId, items }))
  }, [p.fittings, p.variants])

  const fittingName = useCallback(
    (f: AiFittingItem) =>
      buildImageName([p.productName, f.variantLabel ?? labelOf(f.variantId ?? ORIGINAL_VARIANT_ID), ratioToken(f.aspectRatio)]),
    [p.productName, labelOf],
  )

  // 결과가 바뀌면 사라진 URL 은 선택에서 제외 (렌더 시 교집합으로 계산)
  const fittingUrls = useMemo(() => new Set(p.fittings.map((f) => f.url)), [p.fittings])
  const selectedForDownload = [...downloadSelection].filter((u) => fittingUrls.has(u))

  const toggleDownloadSelection = (url: string) => {
    setDownloadSelection((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const runDownload = async (items: AiFittingItem[]) => {
    if (items.length === 0) return
    setDownloading(true)
    setDownloadNote(null)
    try {
      const payload: DownloadItem[] = items.map((f) => ({ url: f.url, name: fittingName(f) }))
      const outcome = await downloadImages(payload, buildImageName([p.productName, 'AI피팅']))
      if (outcome.failed > 0) setDownloadNote(`${outcome.saved}장 저장 · ${outcome.failed}장은 받지 못했어요.`)
    } catch (err) {
      setDownloadNote(err instanceof Error ? err.message : '다운로드 실패')
    } finally {
      setDownloading(false)
    }
  }

  const allSelected = p.fittings.length > 0 && selectedForDownload.length === p.fittings.length

  return (
    <div className="space-y-3">
      {/* 안내 박스 */}
      <div
        className="p-3 text-[12px] text-[#707072] leading-relaxed"
        style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }}
      >
        <strong className="text-[#111111]">✨ AI Fitting</strong> · 모델 사진을 업로드하시면
        AI 가 제품을 그 모델에 자연스럽게 입혀준 합성 이미지를 만들어드립니다. 색상·디자인별 사진을 추가하면
        같은 모델로 한 번에 합성합니다.
        <br />
        <span className="text-[10px]">⚠️ 본인 또는 동의를 받은 인물의 사진만 업로드해주세요. SynthID 워터마크가 자동 삽입됩니다. (Pro 이상 · 변형·비율 개수별 차등 크레딧)</span>
      </div>

      {/* 1. 비율 선택 */}
      <div className="p-3" style={{ backgroundColor: '#ffffff', border: '1px solid #e5e5e5' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">생성할 비율 선택</span>
          <span className="text-[10px] text-[#9e9ea0]">
            {ratioCount === 0 ? '비율을 선택하세요' : `변형당 ${ratioCount}장 · ${creditsPerVariant} 크레딧`}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {RATIO_OPTIONS.map((opt) => {
            const checked = selectedRatios.has(opt.value)
            return (
              <button
                key={opt.value}
                onClick={() => toggleRatio(opt.value)}
                disabled={generating}
                aria-pressed={checked}
                className="flex items-start gap-2 p-2.5 text-left transition-colors hover:bg-[#f5f5f5] disabled:opacity-50"
                style={{
                  backgroundColor: checked ? '#f5f5f5' : '#ffffff',
                  border: `1px solid ${checked ? '#111111' : '#e5e5e5'}`,
                }}
              >
                <CheckBox checked={checked} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-bold text-[#111111]">{opt.label}</span>
                  <span className="block text-[10px] text-[#9e9ea0] mt-0.5">{opt.channel}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 2. 제품 변형 */}
      <div className="p-3" style={{ backgroundColor: '#ffffff', border: '1px solid #e5e5e5' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">
            제품 변형 · 색상·디자인별
          </span>
          <span className="text-[10px] text-[#9e9ea0]">
            {variantCount}/{runnableVariants.length} 선택 · 최대 {MAX_PRODUCT_VARIANTS}개
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {p.variants.map((v, idx) => {
            const included = !excludedVariantIds.has(v.id) && Boolean(v.imageUrl)
            const run = runStates[v.id]
            return (
              <div
                key={v.id}
                className="flex flex-col"
                style={{ border: `1px solid ${included ? '#111111' : '#e5e5e5'}`, backgroundColor: '#ffffff' }}
              >
                <div className="relative aspect-square overflow-hidden" style={{ backgroundColor: '#f5f5f5' }}>
                  {v.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.imageUrl} alt={buildAlt(`${v.label} 제품`)} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-8 h-8 text-[#9e9ea0]" />
                    </div>
                  )}
                  <button
                    onClick={() => toggleVariant(v.id)}
                    disabled={generating || !v.imageUrl}
                    aria-pressed={included}
                    aria-label={`${v.label} 합성 ${included ? '제외' : '포함'}`}
                    className="absolute top-1 left-1 p-0.5 disabled:opacity-50"
                    style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
                  >
                    <CheckBox checked={included} />
                  </button>
                  {!v.isOriginal && (
                    <button
                      onClick={() => p.onRemoveVariant(v.id)}
                      disabled={generating}
                      aria-label={`${v.label} 변형 삭제`}
                      className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center disabled:opacity-50"
                      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  )}
                </div>
                <div className="p-1.5 space-y-1">
                  <input
                    value={v.label}
                    onChange={(e) => p.onUpdateVariant(v.id, { label: e.target.value.slice(0, 20) })}
                    disabled={generating}
                    placeholder={v.isOriginal ? '기본' : `변형 ${idx}`}
                    aria-label="변형 이름"
                    className="w-full px-1.5 py-1 text-[11px] font-semibold text-[#111111] focus:outline-none disabled:opacity-60"
                    style={{ border: '1px solid #e5e5e5' }}
                  />
                  {v.isOriginal ? (
                    <span className="block text-[10px] text-[#9e9ea0]">원본 사진</span>
                  ) : (
                    <div className="flex gap-1" role="group" aria-label="변형 종류">
                      {(['color', 'design'] as const).map((k) => (
                        <button
                          key={k}
                          onClick={() => p.onUpdateVariant(v.id, { kind: k })}
                          disabled={generating}
                          aria-pressed={v.kind === k}
                          className="flex-1 h-5 rounded-full text-[9px] font-bold transition-colors disabled:opacity-60"
                          style={{
                            backgroundColor: v.kind === k ? '#111111' : '#ffffff',
                            color: v.kind === k ? '#ffffff' : '#707072',
                            border: '1px solid #cacacb',
                          }}
                        >
                          {KIND_LABEL[k]}
                        </button>
                      ))}
                    </div>
                  )}
                  {run && <RunBadge run={run} />}
                </div>
              </div>
            )
          })}

          {canAddVariant && (
            <button
              onClick={() => variantInputRef.current?.click()}
              disabled={generating || addingVariant}
              className="aspect-square flex flex-col items-center justify-center gap-1.5 transition-colors hover:bg-[#f5f5f5] disabled:opacity-50"
              style={{ border: '2px dashed #cacacb', backgroundColor: '#ffffff' }}
            >
              {addingVariant ? (
                <Loader2 className="w-5 h-5 text-[#111111] animate-spin" />
              ) : (
                <Plus className="w-5 h-5 text-[#111111]" />
              )}
              <span className="text-[11px] font-bold text-[#111111]">
                {addingVariant ? '업로드 중' : '변형 추가'}
              </span>
              <span className="text-[9px] text-[#9e9ea0] text-center px-2">다른 색상·디자인 사진</span>
            </button>
          )}
        </div>
        <input
          ref={variantInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          className="hidden"
          onChange={handleVariantFile}
        />
        <p className="mt-2 text-[10px] text-[#9e9ea0]">
          같은 상품의 다른 색상·디자인을 촬영한 사진을 올리면, 실제 색감 그대로 같은 모델에 각각 합성합니다.
        </p>
      </div>

      {/* 3. 모델 + 실행 */}
      <div
        className="grid grid-cols-1 md:grid-cols-[200px_1fr]"
        style={{ border: '1px solid #e5e5e5', backgroundColor: '#ffffff' }}
      >
        <div className="p-4" style={{ borderRight: '1px solid #e5e5e5' }}>
          {hasModel ? (
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] text-center">모델</div>
              <div className="aspect-square overflow-hidden relative" style={{ border: '1px solid #e5e5e5', backgroundColor: '#f5f5f5' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={effectiveModel!} alt={buildAlt('모델')} className="w-full h-full object-cover" />
                <button
                  onClick={() => {
                    p.onModelClear()
                    if (modelInputRef.current) modelInputRef.current.value = ''
                  }}
                  disabled={generating}
                  className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center disabled:opacity-50"
                  style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                  aria-label="모델 사진 제거"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
              {p.lastModelImageUrl && !p.currentModelBase64 && !p.currentModelUrl && (
                <button
                  onClick={p.onToggleReuseModel}
                  className="w-full px-2 py-1 rounded-full text-[10px] font-semibold text-[#707072] hover:text-[#111111] transition-colors"
                  style={{ border: '1px solid #cacacb' }}
                >
                  {p.reuseLastModel ? '같은 모델 ✓' : '다른 모델 사용'}
                </button>
              )}
              <button
                onClick={() => modelInputRef.current?.click()}
                disabled={generating}
                className="w-full px-2 py-1 rounded-full text-[10px] font-semibold text-[#707072] hover:text-[#111111] transition-colors disabled:opacity-50"
                style={{ border: '1px solid #cacacb' }}
              >
                <RefreshCw className="w-2.5 h-2.5 inline mr-1" />
                다시 업로드
              </button>
            </div>
          ) : (
            <button
              onClick={() => modelInputRef.current?.click()}
              disabled={generating}
              className="w-full aspect-square flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-50 hover:bg-[#f5f5f5]"
              style={{ border: '2px dashed #cacacb', backgroundColor: '#ffffff' }}
            >
              <div className="w-10 h-10 flex items-center justify-center" style={{ backgroundColor: '#111111' }}>
                <Upload className="w-5 h-5 text-white" strokeWidth={2} />
              </div>
              <span className="text-[12px] font-bold text-[#111111]">모델 업로드</span>
              <span className="text-[10px] text-[#9e9ea0]">JPG·PNG·WebP</span>
            </button>
          )}
          <input
            ref={modelInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            className="hidden"
            onChange={handleModelFile}
          />
        </div>

        <div className="p-4 flex flex-col justify-center gap-3">
          <div className="text-[12px] text-[#707072] leading-relaxed">
            {variantCount === 0 || ratioCount === 0 ? (
              '변형과 비율을 선택하세요.'
            ) : (
              <>
                변형 <strong className="text-[#111111]">{variantCount}개</strong> × 비율{' '}
                <strong className="text-[#111111]">{ratioCount}장</strong> ={' '}
                <strong className="text-[#111111]">{totalImages}장</strong> ·{' '}
                <strong className="text-[#111111]">{totalCredits} 크레딧</strong>
                {variantCount > 1 && (
                  <span className="block text-[10px] text-[#9e9ea0] mt-0.5">
                    변형마다 {creditsPerVariant} 크레딧 · 같은 모델 얼굴·체형을 유지하도록 고정 시드로 생성합니다
                  </span>
                )}
              </>
            )}
          </div>

          {generating ? (
            <div className="space-y-2">
              <div
                className="w-full h-1.5"
                style={{ backgroundColor: '#e5e5e5' }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progressPct)}
                aria-label="AI Fitting 진행률"
              >
                <div className="h-full" style={{ backgroundColor: '#111111', width: `${progressPct}%`, transition: 'width 400ms ease-out' }} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-[#707072] inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {runTotal > 1 ? `${finishedCount}/${runTotal} 변형 완료` : `합성 중 · ${Math.round(progressPct)}%`}
                  <span className="text-[#9e9ea0]">· 변형당 약 30초~1분</span>
                </p>
                <button
                  onClick={handleCancel}
                  className="inline-flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-semibold text-[#707072] hover:text-[#111111] transition-colors"
                  style={{ border: '1px solid #cacacb', backgroundColor: '#ffffff' }}
                >
                  <X className="w-3 h-3" />
                  취소
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!hasModel || ratioCount === 0 || variantCount === 0}
              className="self-start inline-flex items-center justify-center gap-1.5 px-5 h-10 rounded-full text-[12px] font-bold text-white bg-[#111111] hover:bg-[#333333] transition-colors disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {!hasModel
                ? '모델 사진을 올려주세요'
                : ratioCount === 0 || variantCount === 0
                  ? '변형·비율 선택 필요'
                  : `AI Fitting · ${totalImages}장 · ${totalCredits}크레딧`}
            </button>
          )}

          {!generating && failedCount > 0 && runTotal > 0 && (
            <p className="text-[10px]" style={{ color: '#d30005' }}>
              {failedCount}개 변형이 실패했어요. 실패한 변형만 선택해 다시 시도할 수 있습니다.
            </p>
          )}
          {error && (
            <div className="flex items-start gap-1.5 text-[11px]" style={{ color: '#d30005' }}>
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* 4. 결과 */}
      {p.fittings.length > 0 && (
        <div className="p-3" style={{ backgroundColor: '#ffffff', border: '1px solid #e5e5e5' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">
              합성 결과 {p.fittings.length}장
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setDownloadSelection(allSelected ? new Set() : new Set(p.fittings.map((f) => f.url)))}
                className="px-3 h-8 rounded-full text-[11px] font-semibold text-[#707072] hover:text-[#111111] transition-colors"
                style={{ border: '1px solid #cacacb' }}
              >
                {allSelected ? '선택 해제' : '전체 선택'}
              </button>
              <button
                onClick={() => runDownload(p.fittings.filter((f) => selectedForDownload.includes(f.url)))}
                disabled={downloading || selectedForDownload.length === 0}
                className="inline-flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-semibold text-[#111111] hover:bg-[#f5f5f5] transition-colors disabled:opacity-40"
                style={{ border: '1px solid #111111' }}
              >
                <Download className="w-3 h-3" />
                선택 {selectedForDownload.length}장
              </button>
              <button
                onClick={() => runDownload(p.fittings)}
                disabled={downloading}
                className="inline-flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold text-white bg-[#111111] hover:bg-[#333333] transition-colors disabled:opacity-50"
              >
                {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                전체 다운로드{p.fittings.length > 1 ? ' (ZIP)' : ''}
              </button>
            </div>
          </div>
          {downloadNote && <p className="mb-2 text-[11px]" style={{ color: '#d30005' }}>{downloadNote}</p>}

          <div className="space-y-4">
            {groups.map(({ variantId, items }) => (
              <div key={variantId}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-[12px] font-bold text-[#111111]">{labelOf(variantId)}</span>
                  <span className="text-[10px] text-[#9e9ea0]">{items.length}장</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {items.map((f) => {
                    const isHero = f.url === p.selectedFittingUrl
                    const picked = selectedForDownload.includes(f.url)
                    return (
                      <div
                        key={f.url}
                        className="group relative"
                        style={{ border: isHero ? '2px solid #111111' : '1px solid #e5e5e5' }}
                      >
                        <div className="h-[220px] flex items-center justify-center" style={{ backgroundColor: '#f5f5f5' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={f.url}
                            alt={`${buildAlt('AI Fitting 결과')} · ${labelOf(variantId)} · ${f.aspectRatio}`}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <button
                          onClick={() => toggleDownloadSelection(f.url)}
                          aria-pressed={picked}
                          aria-label={`${labelOf(variantId)} ${f.aspectRatio} 다운로드 선택`}
                          className="absolute top-1.5 left-1.5 p-0.5"
                          style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
                        >
                          <CheckBox checked={picked} />
                        </button>
                        <button
                          onClick={() => p.onSelectHero(f.url)}
                          aria-pressed={isHero}
                          title="대표 사진 (상세페이지 맨 위)"
                          className="absolute top-1.5 right-1.5 h-6 px-2 inline-flex items-center gap-1 rounded-full text-[9px] font-bold"
                          style={{
                            backgroundColor: isHero ? '#111111' : 'rgba(255,255,255,0.9)',
                            color: isHero ? '#ffffff' : '#111111',
                          }}
                        >
                          <Star className="w-2.5 h-2.5" fill={isHero ? '#ffffff' : 'transparent'} />
                          대표
                        </button>
                        <button
                          onClick={() => runDownload([f])}
                          disabled={downloading}
                          aria-label={`${labelOf(variantId)} ${f.aspectRatio} 다운로드`}
                          className="absolute bottom-8 right-1.5 w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-40"
                          style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
                        >
                          <Download className="w-3.5 h-3.5 text-[#111111]" />
                        </button>
                        <div className="px-1.5 py-1 flex items-center justify-between" style={{ borderTop: '1px solid #e5e5e5' }}>
                          <span className="text-[11px] font-semibold text-[#111111]">{f.aspectRatio}</span>
                          <span className="text-[10px] text-[#9e9ea0]">{f.width}×{f.height}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-[#9e9ea0]">
            ★ 대표 사진은 상세페이지 맨 위에, 나머지 사진은 상세 설명 문단 사이에 자동 배치됩니다.
          </p>
        </div>
      )}
    </div>
  )
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className="flex-shrink-0 w-4 h-4 inline-flex items-center justify-center"
      style={{
        backgroundColor: checked ? '#111111' : '#ffffff',
        border: `1px solid ${checked ? '#111111' : '#cacacb'}`,
      }}
    >
      {checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
    </span>
  )
}

function RunBadge({ run }: { run: VariantRunState }) {
  if (run.state === 'running') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-[#707072]">
        <Loader2 className="w-2.5 h-2.5 animate-spin" /> 합성 중
      </span>
    )
  }
  if (run.state === 'done') {
    return <span className="block text-[10px] font-semibold" style={{ color: '#007d48' }}>완료 {run.count}장</span>
  }
  return (
    <span className="block text-[10px] leading-tight" style={{ color: '#d30005' }} title={run.message}>
      실패 · {run.message}
    </span>
  )
}
