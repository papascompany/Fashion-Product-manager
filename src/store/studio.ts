// Zustand store — 'use client' 불필요 (컴포넌트 파일 규약이며 store에는 해당 없음)
import { create } from 'zustand'
import type { UserIntent } from '@/lib/ai/types'

// ─── v1.1 Phase 2 — Detail Page Editor 섹션 타입 ───────────────────────────

export type DetailSection =
  | { id: string; type: 'hero';        title: string; tagline: string; image?: string }
  | { id: string; type: 'features';    heading: string; items: string[] }
  | { id: string; type: 'description'; content: string }
  | { id: string; type: 'keywords';    items: string[] }
  | { id: string; type: 'reviews';     placeholder: string }
  | { id: string; type: 'cta';         label: string; url?: string }
  | { id: string; type: 'text';        heading?: string; content: string }
  | { id: string; type: 'image';       url: string; caption?: string }

export type DetailSectionType = DetailSection['type']
export type SectionKind = 'naming' | 'tagline' | 'description'
export type Resolution = '1K' | '2K' | '4K'

/**
 * TYP-10 — DetailSection 판별 유니온에 새 variant 가 추가될 때 컴파일 단계에서
 * 누락을 잡기 위한 exhaustive 가드.
 *
 * 사용 패턴:
 *   switch (section.type) {
 *     case 'hero': ...
 *     case 'features': ...
 *     // ...모든 case 처리...
 *     default: return assertExhaustiveDetailSection(section)
 *   }
 *
 * 새 variant 가 추가됐는데 switch 가 누락하면 `never` 가 아닌 타입이 흘러
 * TypeScript 컴파일 에러로 보고된다. 호출 후엔 안전하게 null 반환 가능.
 */
export function assertExhaustiveDetailSection(section: never): null {
  if (process.env.NODE_ENV !== 'production') {
    // dev 에서는 빠르게 인지하도록 경고. prod 는 silent null 로 graceful.
    console.warn(
      '[studio] Unhandled DetailSection variant — TYP-10 exhaustive guard hit:',
      section
    )
  }
  return null
}

// ─── 타입 정의 ─────────────────────────────────────────────────────────────

export type StudioMode = 'quick' | 'studio'

export type StudioStatus =
  | 'idle'
  | 'intent'             // v1.1 — L1: 모드 선택 후 의도 입력 단계
  | 'loading_history'    // v1.2 — 히스토리에서 프로젝트 복원 중
  | 'uploading'
  | 'analyzing'
  | 'generating_names'
  | 'generating_tagline'
  | 'generating_description'
  | 'generating_thumbnails'
  | 'done'
  | 'error'

// v1.1 — L2 사용자 분석 보정 (Override)
export interface AnalysisOverride {
  category?: string
  style?: string
  targetAudience?: string
  keyFeatures?: string[]
  keywords?: string[]
}

export interface ProductName {
  name: string
  trend: string
}

export interface GenerationResult {
  names: ProductName[]
  tagline: string
  description: string
  thumbnails?: ThumbnailResult[]
  selectedNameIndex: number
  /** 상세페이지 조립용 부가 메타데이터 (analyze 단계 결과) */
  category?: string
  keywords?: string[]
  features?: string[]
  /** 포인트 키워드 3~5개 — 소재·핏·시즌·스타일 태그 (description 생성 결과) */
  pointKeywords?: string[]
  /** 썸네일 중 대표 이미지 URL — 상세페이지 Hero에 삽입 */
  primaryThumbnailUrl?: string
}

export interface ThumbnailResult {
  ratio: string
  label: string
  size: string
  url?: string
  width?: number
  height?: number
}

export interface StudioStore {
  // ─── 상태 ──────────────────────────────────────────────────────────────
  mode: StudioMode | null
  uploadedImageUrl: string | null
  uploadedImageBase64: string | null
  projectId: string | null
  status: StudioStatus
  progress: number            // 0–100 진행률
  errorMessage: string | null
  result: GenerationResult | null

  // v1.1 — 사용자 의도 (L1) + 분석 보정 (L2)
  userIntent: UserIntent
  /** AI 가 추출한 원본 분석 (변경하지 않고 보관) */
  analysisOriginal: {
    category?: string
    style?: string
    targetAudience?: string
    keyFeatures?: string[]
    keywords?: string[]
  } | null
  /** 사용자가 수정한 필드만 담는 patch (analysisOriginal 위에 덮어쓰기) */
  analysisOverride: AnalysisOverride
  /** 인라인 편집된 generation id 추적 — DB user_edited 동기화용 */
  userEditedIds: Set<string>

  // v1.1 Phase 2 — Variants (L5) / Locks (L5-B) / Pin (L6) / Trend (L7) / Detail Page (L8)
  variants: {
    naming: Array<{ data: GenerationResult['names']; refinement?: string; ts: number }>
    tagline: Array<{ data: string; refinement?: string; ts: number }>
    description: Array<{ data: string; refinement?: string; ts: number }>
  }
  activeIndex: { naming: number; tagline: number; description: number }
  locks: { naming: boolean; tagline: boolean; description: boolean }
  pinnedAspectRatios: Set<string>
  thumbnailResolution: Resolution
  trendKeywords: string[]
  detailPageSections: DetailSection[] | null

  // Phase 4 — AI Fitting
  /** 현재 업로드된 모델 이미지 (base64 — 막 업로드한 경우) */
  modelImageBase64: string | null
  /** 모델 이미지 URL (Storage 에 저장된 경우, 재사용 가능) */
  modelImageUrl: string | null
  /** "같은 모델로 다시 피팅" / "다른 모델 사용" 사용자 선택 */
  reuseLastModel: boolean
  /** 생성된 AI Fitting 결과들 */
  aiFittings: Array<{
    id?: string
    url: string
    aspectRatio: string
    width: number
    height: number
    modelImageUrl?: string | null
  }>
  /** 결과 페이지의 hero 이미지로 선택된 fitting URL */
  selectedFittingUrl: string | null

  // ─── Actions ───────────────────────────────────────────────────────────
  setMode: (mode: StudioMode) => void
  setImage: (url: string, base64?: string) => void
  setProjectId: (id: string) => void
  setStatus: (status: StudioStatus, progress?: number) => void
  setResult: (result: GenerationResult) => void
  selectName: (index: number) => void
  setError: (message: string) => void
  reset: () => void

  // v1.1
  setIntent: (intent: Partial<UserIntent>) => void
  clearIntent: () => void
  setAnalysis: (analysis: NonNullable<StudioStore['analysisOriginal']>) => void
  updateAnalysis: (patch: Partial<AnalysisOverride>) => void
  /** Original + Override 머지 결과 — UI/API 호출 시 사용 */
  getEffectiveAnalysis: () => AnalysisOverride
  markEdited: (genId: string) => void
  /** 결과의 특정 부분만 갱신 (인라인 편집 / 부분 재생성) */
  patchResult: (patch: Partial<GenerationResult>) => void

  // Phase 2
  addNamingVariant: (data: GenerationResult['names'], refinement?: string) => void
  addTaglineVariant: (data: string, refinement?: string) => void
  addDescriptionVariant: (data: string, refinement?: string) => void
  selectNamingVariant: (i: number) => void
  selectTaglineVariant: (i: number) => void
  selectDescriptionVariant: (i: number) => void
  toggleLock: (kind: SectionKind) => void
  togglePin: (aspectRatio: string) => void
  setThumbnailResolution: (r: Resolution) => void
  setTrendKeywords: (items: string[]) => void
  setDetailPageSections: (sections: DetailSection[] | null) => void

  // Phase 4 — AI Fitting
  setModelImage: (url: string | null, base64?: string | null) => void
  clearModelImage: () => void
  toggleReuseLastModel: () => void
  setAiFittings: (items: StudioStore['aiFittings']) => void
  addAiFittings: (items: StudioStore['aiFittings']) => void
  selectFittingHero: (url: string | null) => void
}

// ─── 초기 상태 ─────────────────────────────────────────────────────────────

const initialState = {
  mode: null,
  uploadedImageUrl: null,
  uploadedImageBase64: null,
  projectId: null,
  status: 'idle' as StudioStatus,
  progress: 0,
  errorMessage: null,
  result: null,
  userIntent: {} as UserIntent,
  analysisOriginal: null,
  analysisOverride: {} as AnalysisOverride,
  userEditedIds: new Set<string>(),

  // Phase 2
  variants: { naming: [], tagline: [], description: [] } as StudioStore['variants'],
  activeIndex: { naming: 0, tagline: 0, description: 0 },
  locks: { naming: false, tagline: false, description: false },
  pinnedAspectRatios: new Set<string>(),
  thumbnailResolution: '2K' as Resolution,
  trendKeywords: [],
  detailPageSections: null as DetailSection[] | null,

  // Phase 4 — AI Fitting
  modelImageBase64: null,
  modelImageUrl: null,
  reuseLastModel: true,
  aiFittings: [] as StudioStore['aiFittings'],
  selectedFittingUrl: null,
}

// ─── Store 정의 (전역 1개만 허용) ──────────────────────────────────────────

export const useStudioStore = create<StudioStore>((set, get) => ({
  ...initialState,

  setMode: (mode) => set({ mode }),

  setImage: (url, base64) =>
    set({ uploadedImageUrl: url, uploadedImageBase64: base64 ?? null }),

  setProjectId: (id) => set({ projectId: id }),

  setStatus: (status, progress) =>
    set((state) => ({
      status,
      progress: progress ?? state.progress,
      errorMessage: status === 'error' ? state.errorMessage : null,
    })),

  setResult: (result) => set({ result, status: 'done', progress: 100 }),

  selectName: (index) =>
    set((state) =>
      state.result
        ? { result: { ...state.result, selectedNameIndex: index } }
        : {}
    ),

  setError: (message) =>
    set({ status: 'error', errorMessage: message }),

  reset: () => set({ ...initialState, userEditedIds: new Set<string>() }),

  // v1.1
  setIntent: (patch) =>
    set((state) => ({ userIntent: { ...state.userIntent, ...patch } })),
  clearIntent: () => set({ userIntent: {} }),

  setAnalysis: (analysis) => set({ analysisOriginal: analysis }),

  updateAnalysis: (patch) =>
    set((state) => ({ analysisOverride: { ...state.analysisOverride, ...patch } })),

  getEffectiveAnalysis: () => {
    const { analysisOriginal, analysisOverride } = get()
    return { ...(analysisOriginal ?? {}), ...analysisOverride }
  },

  markEdited: (genId) =>
    set((state) => ({ userEditedIds: new Set(state.userEditedIds).add(genId) })),

  patchResult: (patch) =>
    set((state) => (state.result ? { result: { ...state.result, ...patch } } : {})),

  // ─── Phase 2 ────────────────────────────────────────────────────────────
  addNamingVariant: (data, refinement) =>
    set((state) => {
      const entry = { data, refinement, ts: Date.now() }
      const variants = { ...state.variants, naming: [...state.variants.naming, entry] }
      const idx = variants.naming.length - 1
      const activeIndex = { ...state.activeIndex, naming: idx }
      const result = state.result ? { ...state.result, names: data, selectedNameIndex: 0 } : null
      return { variants, activeIndex, result }
    }),

  addTaglineVariant: (data, refinement) =>
    set((state) => {
      const entry = { data, refinement, ts: Date.now() }
      const variants = { ...state.variants, tagline: [...state.variants.tagline, entry] }
      const idx = variants.tagline.length - 1
      const activeIndex = { ...state.activeIndex, tagline: idx }
      const result = state.result ? { ...state.result, tagline: data } : null
      return { variants, activeIndex, result }
    }),

  addDescriptionVariant: (data, refinement) =>
    set((state) => {
      const entry = { data, refinement, ts: Date.now() }
      const variants = { ...state.variants, description: [...state.variants.description, entry] }
      const idx = variants.description.length - 1
      const activeIndex = { ...state.activeIndex, description: idx }
      const result = state.result ? { ...state.result, description: data } : null
      return { variants, activeIndex, result }
    }),

  selectNamingVariant: (i) =>
    set((state) => {
      const v = state.variants.naming[i]
      if (!v || !state.result) return {}
      return {
        activeIndex: { ...state.activeIndex, naming: i },
        result: { ...state.result, names: v.data, selectedNameIndex: 0 },
      }
    }),

  selectTaglineVariant: (i) =>
    set((state) => {
      const v = state.variants.tagline[i]
      if (!v || !state.result) return {}
      return {
        activeIndex: { ...state.activeIndex, tagline: i },
        result: { ...state.result, tagline: v.data },
      }
    }),

  selectDescriptionVariant: (i) =>
    set((state) => {
      const v = state.variants.description[i]
      if (!v || !state.result) return {}
      return {
        activeIndex: { ...state.activeIndex, description: i },
        result: { ...state.result, description: v.data },
      }
    }),

  toggleLock: (kind) =>
    set((state) => ({ locks: { ...state.locks, [kind]: !state.locks[kind] } })),

  togglePin: (aspectRatio) =>
    set((state) => {
      const next = new Set(state.pinnedAspectRatios)
      if (next.has(aspectRatio)) next.delete(aspectRatio)
      else next.add(aspectRatio)
      return { pinnedAspectRatios: next }
    }),

  setThumbnailResolution: (r) => set({ thumbnailResolution: r }),

  setTrendKeywords: (items) => set({ trendKeywords: items }),

  setDetailPageSections: (sections) => set({ detailPageSections: sections }),

  // ─── Phase 4 — AI Fitting ───────────────────────────────────────────────
  setModelImage: (url, base64) =>
    set({ modelImageUrl: url, modelImageBase64: base64 ?? null }),

  clearModelImage: () =>
    set({ modelImageBase64: null, modelImageUrl: null, aiFittings: [], selectedFittingUrl: null }),

  toggleReuseLastModel: () =>
    set((state) => ({ reuseLastModel: !state.reuseLastModel })),

  setAiFittings: (items) =>
    set({
      aiFittings: items,
      selectedFittingUrl: items[0]?.url ?? null,
    }),

  addAiFittings: (items) =>
    set((state) => ({
      aiFittings: [...state.aiFittings, ...items],
      selectedFittingUrl: state.selectedFittingUrl ?? items[0]?.url ?? null,
    })),

  selectFittingHero: (url) => set({ selectedFittingUrl: url }),
}))

// ─── 편의 셀렉터 ───────────────────────────────────────────────────────────

export const selectIsGenerating = (state: StudioStore) =>
  ['uploading', 'analyzing', 'generating_names', 'generating_tagline',
   'generating_description', 'generating_thumbnails'].includes(state.status)

export const selectStatusLabel = (status: StudioStatus): string => {
  const labels: Record<StudioStatus, string> = {
    idle: '대기 중',
    intent: '의도 입력 중',
    loading_history: '이전 작업 불러오는 중...',
    uploading: '이미지 업로드 중...',
    analyzing: '이미지 분석 중...',
    generating_names: '상품명 생성 중...',
    generating_tagline: '홍보문구 생성 중...',
    generating_description: '상세설명 작성 중...',
    generating_thumbnails: '썸네일 생성 중...',
    done: '완료',
    error: '오류 발생',
  }
  return labels[status]
}
