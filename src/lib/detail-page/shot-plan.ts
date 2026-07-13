/**
 * 컷 오케스트레이션 플랜 (Phase 2 — detail-page-engine)
 *
 * 섹션 배열을 훑어 "이미지가 비어 있는 촬영 슬롯"을 ShotJob 목록으로 추출하고,
 * 생성 결과 URL 을 해당 슬롯에 되써 넣는 순수 모듈. 서버/클라이언트 공용 (부수효과 없음).
 *
 * 엔진 매핑 (PRD §3):
 *  - productShot → 썸네일 엔진 + 프리셋(hero-object / flat-lay / hanger / ghost-mannequin)
 *  - detailShot  → 썸네일 엔진 + detail-macro
 *  - fitShot     → AI Fitting (전/측/후 배리언트 순환, 모델 프로필 락)
 *  - lifestyle   → 모델 있으면 AI Fitting lifestyle, 없으면 썸네일 lifestyle(무인물)
 *
 * 컷 예산: 기본 9장 (PRD 6~9장). 초과분은 잘라내고 개수를 반환값에 담는다.
 */

import type { DetailSection, ShotSlot } from '@/store/studio'
import type { ShotPreset } from '@/lib/ai/image/prompt-builder'
import type { FittingShotVariant } from '@/lib/prompts/image/ai-fitting'

export type ShotEngine = 'thumbnail' | 'fitting'

/** 컷 1장 생성 작업 단위 */
export interface ShotJob {
  /** 대상 섹션 id */
  sectionId: string
  /** 섹션 내 배열 슬롯 인덱스 (gallery items / material cells / lookbook looks). 단일 슬롯이면 -1 */
  itemIndex: number
  slot: ShotSlot
  engine: ShotEngine
  /** engine === 'thumbnail' 일 때 촬영 프리셋 */
  preset?: ShotPreset
  /** engine === 'fitting' 일 때 착장 앵글 배리언트 */
  fittingVariant?: FittingShotVariant
  aspectRatio: '1:1' | '4:5' | '3:4' | '4:3'
  /** UI 표시용 라벨 (예: "룩북 · 착용 컷(측면)") */
  label: string
}

export interface ShotPlan {
  jobs: ShotJob[]
  /** 예산 초과로 잘려나간 슬롯 수 */
  truncated: number
}

/** 컷 예산 기본값 (PRD 6~9장의 상한) */
export const DEFAULT_SHOT_BUDGET = 9

const SLOT_LABEL: Record<ShotSlot, string> = {
  productShot: '제품 컷',
  fitShot: '착용 컷',
  detailShot: '디테일 컷',
  lifestyle: '라이프스타일 컷',
}

const FITTING_VARIANT_LABEL: Record<FittingShotVariant, string> = {
  front: '정면',
  side: '측면',
  back: '후면',
  lifestyle: '라이프스타일',
}

const SECTION_LABEL: Partial<Record<DetailSection['type'], string>> = {
  hero: '히어로',
  image: '이미지',
  gallery: '갤러리',
  'feature-split': '특징 분할',
  material: '소재 상세',
  lookbook: '룩북',
}

/** productShot 프리셋 순환 (갤러리 다각도 그리드용) */
const PRODUCT_PRESET_CYCLE: ShotPreset[] = ['flat-lay', 'hanger', 'ghost-mannequin']
/** fitShot 앵글 순환 (룩북 전/측/후) */
const FITTING_VARIANT_CYCLE: FittingShotVariant[] = ['front', 'side', 'back']

interface ExtractOptions {
  /** 모델 이미지 보유 여부 — 없으면 fitShot 은 건너뛰고 lifestyle 은 썸네일 엔진으로 */
  hasModelImage: boolean
  /** 컷 예산 (기본 DEFAULT_SHOT_BUDGET) */
  budget?: number
}

/**
 * 이미지가 비어 있는 촬영 슬롯을 ShotJob 목록으로 추출한다.
 * 모델 이미지가 없으면 fitShot 슬롯은 제외된다 (AI Fitting 은 모델 필수).
 */
export function extractShotJobs(sections: DetailSection[], opts: ExtractOptions): ShotPlan {
  const jobs: ShotJob[] = []
  let productCycle = 0
  let fittingCycle = 0

  const nextProductPreset = (): ShotPreset =>
    PRODUCT_PRESET_CYCLE[productCycle++ % PRODUCT_PRESET_CYCLE.length]
  const nextFittingVariant = (): FittingShotVariant =>
    FITTING_VARIANT_CYCLE[fittingCycle++ % FITTING_VARIANT_CYCLE.length]

  const push = (
    section: DetailSection,
    itemIndex: number,
    slot: ShotSlot,
    aspectRatio: ShotJob['aspectRatio'],
    presetOverride?: ShotPreset,
  ): void => {
    const sectionLabel = SECTION_LABEL[section.type] ?? section.type

    if (slot === 'fitShot') {
      if (!opts.hasModelImage) return // 모델 없으면 착용 컷 생성 불가
      const variant = nextFittingVariant()
      jobs.push({
        sectionId: section.id, itemIndex, slot,
        engine: 'fitting', fittingVariant: variant, aspectRatio,
        label: `${sectionLabel} · ${SLOT_LABEL[slot]}(${FITTING_VARIANT_LABEL[variant]})`,
      })
      return
    }

    if (slot === 'lifestyle') {
      if (opts.hasModelImage) {
        jobs.push({
          sectionId: section.id, itemIndex, slot,
          engine: 'fitting', fittingVariant: 'lifestyle', aspectRatio,
          label: `${sectionLabel} · ${SLOT_LABEL[slot]}(착용)`,
        })
      } else {
        jobs.push({
          sectionId: section.id, itemIndex, slot,
          engine: 'thumbnail', preset: 'lifestyle', aspectRatio,
          label: `${sectionLabel} · ${SLOT_LABEL[slot]}(무드)`,
        })
      }
      return
    }

    const preset: ShotPreset =
      presetOverride ?? (slot === 'detailShot' ? 'detail-macro' : nextProductPreset())
    jobs.push({
      sectionId: section.id, itemIndex, slot,
      engine: 'thumbnail', preset, aspectRatio,
      label: `${sectionLabel} · ${SLOT_LABEL[slot]}`,
    })
  }

  for (const s of sections) {
    switch (s.type) {
      case 'hero':
        if (!s.image) push(s, -1, s.shotSlot ?? 'fitShot', '4:5', 'hero-object')
        break
      case 'image':
        if (!s.url) push(s, -1, s.shotSlot ?? 'detailShot', '4:3')
        break
      case 'gallery':
        s.items.forEach((it, i) => {
          if (!it.url) push(s, i, it.shotSlot, '1:1')
        })
        break
      case 'feature-split':
        if (!s.url) push(s, -1, s.shotSlot, '4:5')
        break
      case 'material':
        s.cells.forEach((c, i) => {
          if (c.kind === 'image' && !c.url) push(s, i, c.shotSlot ?? 'detailShot', '1:1')
        })
        break
      case 'lookbook':
        s.looks.forEach((lk, i) => {
          if (!lk.url) push(s, i, lk.shotSlot, '3:4')
        })
        break
      default:
        break // 이미지 슬롯 없는 섹션
    }
  }

  const budget = opts.budget ?? DEFAULT_SHOT_BUDGET
  const truncated = Math.max(0, jobs.length - budget)
  return { jobs: jobs.slice(0, budget), truncated }
}

/**
 * 생성된 컷 URL 을 해당 슬롯에 immutable 하게 되써 넣는다.
 * 대상 섹션/슬롯을 찾지 못하면 원본 배열을 그대로 반환.
 */
export function applyShotResult(
  sections: DetailSection[],
  job: ShotJob,
  url: string,
): DetailSection[] {
  return sections.map((s) => {
    if (s.id !== job.sectionId) return s
    switch (s.type) {
      case 'hero':
        return { ...s, image: url }
      case 'image':
        return { ...s, url }
      case 'feature-split':
        return { ...s, url }
      case 'gallery':
        return {
          ...s,
          items: s.items.map((it, i) => (i === job.itemIndex ? { ...it, url } : it)),
        }
      case 'material':
        return {
          ...s,
          cells: s.cells.map((c, i) => (i === job.itemIndex ? { ...c, url } : c)),
        }
      case 'lookbook':
        return {
          ...s,
          looks: s.looks.map((lk, i) => (i === job.itemIndex ? { ...lk, url } : lk)),
        }
      default:
        return s
    }
  })
}

/**
 * 예상 크레딧 계산 — 현행 단가 기준(썸네일 3 / AI Fitting 1장 2).
 * ⚠️ 번들 단가는 오너 결정 대기 항목 — 확정 시 이 함수만 갱신.
 */
export function estimateShotCredits(jobs: ShotJob[]): number {
  return jobs.reduce((sum, j) => sum + (j.engine === 'thumbnail' ? 3 : 2), 0)
}
