'use client'

/**
 * AIFittingPanel — Phase 4 (D-4 A안: 새 04 섹션)
 *
 * 3-패널 레이아웃:
 *  좌: 원본 제품 사진 (읽기전용)
 *  중: 모델 업로드 + "AI Fitting" 버튼 + 같은 모델 재사용 토글
 *  우: 생성된 fitting 결과 (가장 첫 번째) + 비율 chip + 다운로드 버튼
 *
 * D-5: 모델 사진은 영구 보관, 사용자가 "다른 모델 사용" 토글 시 재업로드 dropzone 노출
 * D-2: 1:1 + 4:5 + 9:16 3장 동시 생성
 * D-3: Pro 이상만 — 비-Pro 클릭 시 CreditGuardModal 트리거 (부모에서 처리)
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Loader2, Upload, Sparkles, Download, X, RefreshCw,
  Image as ImageIcon, AlertCircle,
} from 'lucide-react'
import { aiFittingCredits } from '@/lib/credit-guard'

interface FittingResult {
  url: string
  aspectRatio: string
  width: number
  height: number
  modelImageUrl?: string | null
}

interface AIFittingPanelProps {
  /** 원본 제품 이미지 (URL 또는 base64) */
  productImageUrl: string | null
  /** 직전에 업로드한 모델 (재사용 옵션 표시용) */
  lastModelImageUrl: string | null
  /** 현재 사용 중인 모델 (base64 or URL) — 새로 올렸을 때 즉시 미리보기 */
  currentModelBase64: string | null
  currentModelUrl: string | null
  /** 같은 모델 재사용 여부 */
  reuseLastModel: boolean
  onToggleReuseModel: () => void
  /** 모델 업로드 콜백 */
  onModelUpload: (base64: string) => void
  onModelClear: () => void
  /**
   * AI Fitting 생성 콜백 — D안: 선택된 비율 목록을 전달
   * 빈 배열이면 생성 안 함 (체크박스 모두 해제 시)
   */
  onGenerate: (aspectRatios: string[]) => Promise<void>
  /** 생성 결과 */
  fittings: FittingResult[]
  /** 결과 hero 선택 */
  selectedFittingUrl: string | null
  onSelectHero: (url: string) => void
  /** UX-05 — alt 합성용 제품명·카테고리·키워드 */
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

// TYP-06 — 비율 개수별 크레딧은 서버 SoT (credit-guard.aiFittingCredits) 만 사용.
// 클라이언트는 표시용으로만 호출 — 실제 차감은 서버에서 결정.
const ratiosToCredits = aiFittingCredits

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_MB = 10

export function AIFittingPanel(p: AIFittingPanelProps) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  // UX-10 — 사용자 취소 신호. 부모는 별도 AbortController 를 들고 있으므로
  // 여기선 UI 상 즉시 generating=false 로 전환해 사용자에게 즉각 피드백을 준다.
  const cancelledRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // UX-05 — alt 합성 헬퍼: productName + category + 핵심 키워드 1~2개
  const buildAlt = useCallback((kind: '원본 제품' | '모델' | 'AI Fitting 결과'): string => {
    const name = (p.productName ?? '').trim()
    const cat = (p.category ?? '').trim()
    const kw = (p.keywords ?? []).slice(0, 2).filter(Boolean).join(' · ')
    const parts = [name, cat, kw].filter(Boolean)
    if (parts.length === 0) return kind
    return `${kind} — ${parts.join(' · ')}`
  }, [p.productName, p.category, p.keywords])

  // UX-10 — 진행률 placeholder: 60~90s 동안 점진적 증가, 95% 에서 정체
  useEffect(() => {
    if (!generating) {
      setProgress(0)
      return
    }
    setProgress(8)
    const interval = setInterval(() => {
      setProgress((cur) => {
        // 95% 에서 정체 → 응답 받을 때까지 대기
        if (cur >= 95) return cur
        // 후반부는 천천히
        const delta = cur < 60 ? 2 : cur < 85 ? 1 : 0.5
        return Math.min(cur + delta, 95)
      })
    }, 800)
    return () => clearInterval(interval)
  }, [generating])

  // D안 — 생성할 비율 선택 (기본: 3개 모두 체크)
  const [selectedRatios, setSelectedRatios] = useState<Set<string>>(
    new Set(['1:1', '4:5', '9:16'])
  )
  const toggleRatio = (ratio: string) => {
    setSelectedRatios((prev) => {
      const next = new Set(prev)
      if (next.has(ratio)) next.delete(ratio)
      else next.add(ratio)
      return next
    })
  }
  const selectedCount = selectedRatios.size
  const requiredCredits = ratiosToCredits(selectedCount)

  // 현재 표시할 모델 이미지 결정
  // - reuseLastModel = true + lastModelImageUrl 있으면 → 재사용
  // - 새로 업로드한 base64 가 있으면 → 그것 우선
  const effectiveModel = p.currentModelBase64
    ?? p.currentModelUrl
    ?? (p.reuseLastModel ? p.lastModelImageUrl : null)

  const hasModel = !!effectiveModel
  const hasFittings = p.fittings.length > 0

  // ─── 파일 업로드 핸들러 ────────────────────────────────────────────────
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('JPG, PNG, WebP 형식만 지원합니다.')
      return
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`파일 크기는 ${MAX_SIZE_MB}MB 이하여야 합니다.`)
      return
    }

    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result as string
      p.onModelUpload(base64)
    }
    reader.onerror = () => setError('파일 읽기 실패')
    reader.readAsDataURL(file)
  }, [p])

  const triggerFileSelect = () => fileInputRef.current?.click()

  // ─── 생성 핸들러 — D안: 선택된 비율 목록 전달 ──────────────────────────
  const handleGenerate = async () => {
    if (selectedCount === 0) {
      setError('생성할 비율을 최소 1개 선택해주세요.')
      return
    }
    setError(null)
    setGenerating(true)
    cancelledRef.current = false
    try {
      await p.onGenerate(Array.from(selectedRatios))
    } catch (err) {
      // UX-10 — 사용자 취소면 조용히 처리
      if (cancelledRef.current) return
      setError(err instanceof Error ? err.message : 'AI Fitting 실패')
    } finally {
      setGenerating(false)
      setProgress(0)
    }
  }

  // UX-10 — 사용자 취소: UI 즉시 종료. 실제 fetch abort 는 부모 controller 가 담당.
  const handleCancel = () => {
    cancelledRef.current = true
    setGenerating(false)
    setProgress(0)
    setError('취소했어요. 크레딧은 차감되지 않을 수 있습니다(서버 진행 단계에 따라 다름).')
  }

  // 표시용 결과 (selectedFittingUrl 우선)
  const heroFitting = p.fittings.find((f) => f.url === p.selectedFittingUrl) ?? p.fittings[0]

  return (
    <div className="space-y-3">
      {/* 안내 박스 */}
      <div
        className="p-3 text-[12px] text-[#707072] leading-relaxed"
        style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }}
      >
        <strong className="text-[#111111]">✨ AI Fitting</strong> · 모델 사진을 업로드하시면
        AI 가 원본 제품을 그 모델에 자연스럽게 입혀준 합성 이미지를 만들어드립니다.
        <br />
        <span className="text-[10px]">⚠️ 본인 또는 동의를 받은 인물의 사진만 업로드해주세요. SynthID 워터마크가 자동 삽입됩니다. (Pro 이상 · 비율 개수별 차등 크레딧)</span>
      </div>

      {/* D안 — 생성할 비율 체크박스 + 채널 힌트 */}
      <div
        className="p-3"
        style={{ backgroundColor: '#ffffff', border: '1px solid #e5e5e5' }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">
            생성할 비율 선택
          </span>
          <span className="text-[10px] text-[#9e9ea0]">
            {selectedCount === 0 ? '비율을 선택하세요' : `${selectedCount}장 · ${requiredCredits} 크레딧`}
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
                className="flex items-start gap-2 p-2.5 text-left transition-colors hover:bg-[#f5f5f5] disabled:opacity-50"
                style={{
                  backgroundColor: checked ? '#f5f5f5' : '#ffffff',
                  border: `1px solid ${checked ? '#111111' : '#e5e5e5'}`,
                }}
              >
                {/* 체크박스 */}
                <span
                  className="mt-0.5 flex-shrink-0 w-4 h-4 inline-flex items-center justify-center"
                  style={{
                    backgroundColor: checked ? '#111111' : '#ffffff',
                    border: `1px solid ${checked ? '#111111' : '#cacacb'}`,
                  }}
                >
                  {checked && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5 L4 7.5 L8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-bold text-[#111111]">{opt.label}</span>
                  <span className="block text-[10px] text-[#9e9ea0] mt-0.5">{opt.channel}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 3-패널 그리드 */}
      <div
        className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch"
        style={{ border: '1px solid #e5e5e5', backgroundColor: '#ffffff' }}
      >
        {/* 좌: 원본 제품 */}
        <div className="p-4 flex flex-col" style={{ borderRight: '1px solid #e5e5e5' }}>
          <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-2">
            원본 제품
          </div>
          <div
            className="flex-1 aspect-square overflow-hidden flex items-center justify-center"
            style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5', minHeight: 240 }}
          >
            {p.productImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.productImageUrl} alt={buildAlt('원본 제품')} className="w-full h-full object-cover" />
            ) : (
              <ImageIcon className="w-10 h-10 text-[#9e9ea0]" />
            )}
          </div>
        </div>

        {/* 중: 모델 업로드 + 액션 */}
        <div className="p-4 flex flex-col items-stretch justify-center md:w-[200px]">
          {/* 모델 이미지 미리보기 또는 업로드 영역 */}
          {hasModel ? (
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] text-center">
                모델
              </div>
              <div
                className="aspect-square overflow-hidden relative"
                style={{ border: '1px solid #e5e5e5', backgroundColor: '#f5f5f5' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={effectiveModel!} alt={buildAlt('모델')} className="w-full h-full object-cover" />
                <button
                  onClick={() => {
                    p.onModelClear()
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                  className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                  title="모델 사진 제거"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>

              {/* "같은 모델 재사용 / 다른 모델 사용" 토글 — 직전 모델 있을 때만 */}
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
                onClick={triggerFileSelect}
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
              onClick={triggerFileSelect}
              disabled={generating}
              className="aspect-square flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-50 hover:bg-[#f5f5f5]"
              style={{ border: '2px dashed #cacacb', backgroundColor: '#ffffff' }}
            >
              <div
                className="w-10 h-10 flex items-center justify-center"
                style={{ backgroundColor: '#111111' }}
              >
                <Upload className="w-5 h-5 text-white" strokeWidth={2} />
              </div>
              <span className="text-[12px] font-bold text-[#111111]">모델 업로드</span>
              <span className="text-[10px] text-[#9e9ea0]">JPG·PNG·WebP</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            className="hidden"
            onChange={handleFileChange}
          />

          {/* AI Fitting 실행 버튼 — D안: 동적 라벨 */}
          <button
            onClick={handleGenerate}
            disabled={!hasModel || generating || selectedCount === 0}
            className="mt-3 inline-flex items-center justify-center gap-1.5 px-3 h-10 rounded-full text-[12px] font-bold text-white bg-[#111111] hover:bg-[#333333] transition-colors disabled:opacity-40"
          >
            {generating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                생성 중...
              </>
            ) : selectedCount === 0 ? (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                비율 선택 필요
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                AI Fitting · {selectedCount}장 · {requiredCredits}크레딧
              </>
            )}
          </button>

          {error && (
            <div className="mt-2 flex items-start gap-1.5 text-[10px]" style={{ color: '#d30005' }}>
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* 우: Fitting 결과 */}
        <div className="p-4 flex flex-col" style={{ borderLeft: '1px solid #e5e5e5' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">
              Fitting 결과
            </div>
            {hasFittings && (
              <div className="flex items-center gap-1">
                {p.fittings.map((f) => (
                  <button
                    key={f.url}
                    onClick={() => p.onSelectHero(f.url)}
                    className="px-2 py-0.5 rounded-full text-[9px] font-bold transition-colors"
                    style={{
                      backgroundColor: f.url === (heroFitting?.url ?? '') ? '#111111' : '#ffffff',
                      color: f.url === (heroFitting?.url ?? '') ? '#ffffff' : '#111111',
                      border: '1px solid #cacacb',
                    }}
                    title={`${f.aspectRatio} hero 로 선택`}
                  >
                    {f.aspectRatio}
                  </button>
                ))}
              </div>
            )}
          </div>

          {hasFittings && heroFitting ? (
            <div className="flex-1 flex flex-col gap-2">
              <div
                className="overflow-hidden flex-1 flex items-center justify-center"
                style={{
                  aspectRatio: heroFitting.aspectRatio.replace(':', '/'),
                  border: '1px solid #e5e5e5',
                  backgroundColor: '#f5f5f5',
                  maxHeight: 360,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={heroFitting.url}
                  alt={`${buildAlt('AI Fitting 결과')} · ${heroFitting.aspectRatio}`}
                  className="w-full h-full object-contain"
                />
              </div>
              <a
                href={heroFitting.url}
                download={`ai-fitting-${heroFitting.aspectRatio.replace(':', 'x')}.png`}
                className="inline-flex items-center justify-center gap-1.5 px-3 h-9 rounded-full text-[12px] font-bold text-white transition-colors"
                style={{ backgroundColor: '#ec4899' }}
              >
                <Download className="w-3.5 h-3.5" />
                다운로드
              </a>
              <p className="text-[10px] text-[#9e9ea0] text-center">
                선택한 비율이 상세페이지 hero 아래 자동 삽입됩니다
              </p>
            </div>
          ) : generating ? (
            <div
              className="flex-1 flex flex-col items-center justify-center gap-3 px-4"
              style={{ minHeight: 240, backgroundColor: '#f5f5f5', border: '1px dashed #cacacb' }}
            >
              <Loader2 className="w-8 h-8 text-[#111111] animate-spin" />
              <p className="text-[12px] font-semibold text-[#111111]">AI Fitting 진행 중</p>
              {/* UX-10 — 진행률 placeholder (실제 서버 진행률이 아닌 시간 기반 시각화) */}
              <div
                className="w-full h-1.5"
                style={{ backgroundColor: '#e5e5e5' }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
                aria-label="AI Fitting 진행률"
              >
                <div
                  className="h-full"
                  style={{ backgroundColor: '#111111', width: `${progress}%`, transition: 'width 400ms ease-out' }}
                />
              </div>
              <p className="text-[10px] text-[#707072]">약 30초 ~ 1분 소요 · {Math.round(progress)}%</p>
              {/* UX-10 — 취소 버튼 */}
              <button
                onClick={handleCancel}
                className="inline-flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-semibold text-[#707072] hover:text-[#111111] transition-colors"
                style={{ border: '1px solid #cacacb', backgroundColor: '#ffffff' }}
              >
                <X className="w-3 h-3" />
                취소
              </button>
            </div>
          ) : (
            <div
              className="flex-1 flex flex-col items-center justify-center gap-2"
              style={{ minHeight: 240, backgroundColor: '#fafafa', border: '2px dashed #e5e5e5' }}
            >
              <ImageIcon className="w-10 h-10 text-[#9e9ea0]" />
              <p className="text-[12px] text-[#9e9ea0] text-center px-4">
                모델 사진을 업로드하고
                <br />
                AI Fitting 버튼을 눌러주세요
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
