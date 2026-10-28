import { describe, it, expect } from 'vitest'
import {
  splitParagraphs,
  replaceParagraph,
  descriptionGapCount,
  resolveDescriptionImages,
  buildDescriptionImagePool,
} from '@/lib/description-layout'

const FOUR_SECTIONS = [
  '1. 핏',
  '    깔끔하게 떨어지는 세미 크롭 기장으로',
  '    체형을 부드럽게 감싸줍니다',
  '',
  '2. 소재 ★',
  '    린넨 55% 레이온 45%',
  '',
  '3. 디자인',
  '    2.5cm 스탠드 카라',
  '',
  '    데일리룩부터 출근룩까지 활용 가능합니다',
  '',
  '4. 코디추천',
  '    와이드 슬랙스와 매치하기 좋으며',
].join('\n')

describe('splitParagraphs', () => {
  it('번호 섹션 단위로 나누고 섹션 안의 빈 줄·들여쓰기는 보존한다', () => {
    const paras = splitParagraphs(FOUR_SECTIONS)
    expect(paras).toHaveLength(4)
    expect(paras[0].startsWith('1. 핏')).toBe(true)
    expect(paras[2]).toContain('\n\n    데일리룩부터')
    expect(paras[1]).toContain('    린넨 55%')
  })

  it('들여쓴 "2.5cm" 같은 본문 줄은 섹션 제목으로 보지 않는다', () => {
    expect(splitParagraphs(FOUR_SECTIONS)[2]).toContain('2.5cm 스탠드 카라')
  })

  it('번호 섹션이 없으면 빈 줄 기준으로 나눈다', () => {
    expect(splitParagraphs('첫 문단\n이어짐\n\n\n둘째 문단\n')).toEqual(['첫 문단\n이어짐', '둘째 문단'])
  })

  it('빈 텍스트는 문단이 없다', () => {
    expect(splitParagraphs('  \n \n')).toEqual([])
    expect(descriptionGapCount('')).toBe(0)
  })
})

describe('replaceParagraph', () => {
  it('지정한 문단만 바꾸고 나머지는 그대로 둔다', () => {
    const next = replaceParagraph(FOUR_SECTIONS, 1, '2. 소재\n    코튼 100%')
    const paras = splitParagraphs(next)
    expect(paras).toHaveLength(4)
    expect(paras[1]).toBe('2. 소재\n    코튼 100%')
    expect(paras[3]).toBe(splitParagraphs(FOUR_SECTIONS)[3])
  })

  it('빈 값이면 문단을 지운다', () => {
    expect(splitParagraphs(replaceParagraph(FOUR_SECTIONS, 0, ''))).toHaveLength(3)
  })
})

describe('resolveDescriptionImages', () => {
  it('배치를 고친 적이 없으면 후보 순서대로 칸을 채운다', () => {
    expect(resolveDescriptionImages(null, ['a', 'b'], 3)).toEqual(['a', 'b', null])
  })

  it('사용자 배치는 그대로 쓰고 늘어난 칸은 비운다', () => {
    expect(resolveDescriptionImages([null, 'x'], ['a', 'b', 'c'], 3)).toEqual([null, 'x', null])
  })

  it('칸이 없으면 빈 배열', () => {
    expect(resolveDescriptionImages(['x'], ['a'], 0)).toEqual([])
  })
})

describe('buildDescriptionImagePool', () => {
  it('변형별 대표(4:5 우선) → 나머지 피팅 → 썸네일 → hero 순서이며 중복은 제거한다', () => {
    const pool = buildDescriptionImagePool({
      fittings: [
        { url: 'orig-1x1', aspectRatio: '1:1' },
        { url: 'orig-4x5', aspectRatio: '4:5' },
        { url: 'navy-9x16', aspectRatio: '9:16', variantId: 'navy' },
        { url: 'navy-1x1', aspectRatio: '1:1', variantId: 'navy' },
      ],
      thumbnails: [{ ratio: '16:9', url: 'thumb-16x9' }, { ratio: '4:5', url: 'thumb-4x5' }, { ratio: '1:1' }],
      heroUrl: 'orig-1x1',
    })
    expect(pool).toEqual(['orig-4x5', 'navy-1x1', 'navy-9x16', 'thumb-4x5', 'thumb-16x9', 'orig-1x1'])
  })
})
