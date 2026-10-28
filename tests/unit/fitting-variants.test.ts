import { describe, it, expect, beforeEach } from 'vitest'
import { runPool } from '@/lib/run-pool'
import { buildImageName, ratioToken } from '@/lib/download-images'
import { useStudioStore, MAX_PRODUCT_VARIANTS, ORIGINAL_VARIANT_ID } from '@/store/studio'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('runPool', () => {
  it('동시 실행 수를 상한 이하로 유지하고 모든 작업을 처리한다', async () => {
    let active = 0
    let peak = 0
    const done: number[] = []
    await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await tick()
      done.push(n)
      active--
    })
    expect(peak).toBe(2)
    expect(done.sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('중단 신호 이후에는 새 작업을 꺼내지 않는다', async () => {
    const started: number[] = []
    let stop = false
    await runPool([1, 2, 3, 4], 1, async (n) => {
      started.push(n)
      if (n === 2) stop = true
      await tick()
    }, () => stop)
    expect(started).toEqual([1, 2])
  })
})

describe('다운로드 파일명', () => {
  it('파일명에 쓸 수 없는 문자를 지우고 공백을 하이픈으로 바꾼다', () => {
    expect(buildImageName(['린넨 셔츠/블라우스', '네이비', ratioToken('4:5')])).toBe('린넨-셔츠블라우스_네이비_4x5')
    expect(buildImageName([undefined, '', null])).toBe('image')
  })
})

describe('studio store — 변형별 합성 결과', () => {
  beforeEach(() => useStudioStore.getState().reset())

  const fitting = (url: string, variantId?: string) => ({ url, aspectRatio: '1:1', width: 1, height: 1, variantId })

  it('한 변형의 결과만 교체하고 다른 변형 결과는 유지한다', () => {
    const s = useStudioStore.getState()
    s.replaceVariantFittings(ORIGINAL_VARIANT_ID, [fitting('o1', ORIGINAL_VARIANT_ID)])
    s.replaceVariantFittings('navy', [fitting('n1', 'navy')])
    s.replaceVariantFittings('navy', [fitting('n2', 'navy')])
    const state = useStudioStore.getState()
    expect(state.aiFittings.map((f) => f.url)).toEqual(['o1', 'n2'])
    expect(state.selectedFittingUrl).toBe('o1')
  })

  it('대표 사진이 속한 변형을 다시 만들면 대표를 새 결과로 바꾼다', () => {
    const s = useStudioStore.getState()
    s.replaceVariantFittings(ORIGINAL_VARIANT_ID, [fitting('o1', ORIGINAL_VARIANT_ID)])
    s.replaceVariantFittings(ORIGINAL_VARIANT_ID, [fitting('o2', ORIGINAL_VARIANT_ID)])
    expect(useStudioStore.getState().selectedFittingUrl).toBe('o2')
  })

  it('변형을 지우면 그 변형의 결과와 문단 사진 배치도 함께 정리한다', () => {
    const s = useStudioStore.getState()
    s.addProductVariant({ id: 'navy', label: '네이비', kind: 'color', imageUrl: 'p-navy' })
    s.replaceVariantFittings('navy', [fitting('n1', 'navy')])
    s.setDescriptionImages(['n1', 'keep'])
    useStudioStore.getState().removeProductVariant('navy')
    const state = useStudioStore.getState()
    expect(state.productVariants).toEqual([])
    expect(state.aiFittings).toEqual([])
    expect(state.descriptionImages).toEqual([null, 'keep'])
  })

  it(`원본 포함 최대 ${MAX_PRODUCT_VARIANTS}개까지만 변형을 추가한다`, () => {
    const s = useStudioStore.getState()
    for (let i = 0; i < MAX_PRODUCT_VARIANTS + 2; i++) {
      s.addProductVariant({ id: `v${i}`, label: `변형 ${i}`, kind: 'design', imageUrl: `p${i}` })
    }
    expect(useStudioStore.getState().productVariants).toHaveLength(MAX_PRODUCT_VARIANTS - 1)
  })
})
