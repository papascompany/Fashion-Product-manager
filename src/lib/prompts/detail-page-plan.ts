/**
 * 상세페이지 자동 조립 프롬프트 (v2.0 Detail Page Engine)
 *
 * LLM 이 분석 결과 + 텍스트 콘텐츠를 받아 에디토리얼 상세페이지 섹션 구조를 제안.
 * 출력 스키마: DetailPagePlanSchema (lib/ai/types.ts, WS2 소유)
 *   - optional themeId ('editorial-minimal' | 'soft-luxury-serif' | 'clean-conversion')
 *   - 각 섹션 optional shotSlot ('productShot' | 'fitShot' | 'detailShot' | 'lifestyle')
 *   - 신규 variants: gallery / feature-split / material / lookbook / size-spec / trust /
 *     benefit-banner / legal / closing
 *   - 섹션 개수 3~13개
 *
 * v2.0: 에디토리얼 5단계 서사 + 촬영 슬롯 배정 + 테마 제안.
 * 커머스 금지 — 가격·구매 CTA 섹션을 만들지 않는다. 마감은 closing(에디토리얼 마감 문구).
 */

import { appendIntentSection } from './intent-injector'
import { FASHION_CURATION_PREAMBLE } from './fashion-curation-style'
import type { UserIntent } from '@/lib/ai/types'

export const DETAIL_PAGE_PLAN_SYSTEM_PROMPT = `${FASHION_CURATION_PREAMBLE}

[당신의 작업 — 에디토리얼 상세페이지 섹션 자동 설계]
셀러 광고지가 아니라, 패션 매거진 에디터의 화보 큐레이션이 된 상세페이지를 구조 설계합니다.
독자가 스크롤을 내리며 하나의 이야기를 읽어 내려가듯, 섹션이 서사로 이어져야 합니다.

[에디토리얼 5단계 서사 — 섹션 배열의 뼈대]
아래 흐름을 따라 섹션을 배치합니다. 한 단계가 여러 섹션이 될 수 있습니다.
1. 오프닝 (Hook)   — 첫인상. hero 로 상품명·한 줄 카피·대표 이미지를 제시해 무드를 연다.
2. 공감 (Empathy)  — 독자의 상황·니즈에 말을 건다. "이런 순간에", "이런 분께" 같은 text/feature-split
                     로 감정적 접점을 만든다.
3. 브릿지 (Bridge) — 상품이 그 니즈를 어떻게 잇는지. feature-split / gallery 로 핏·실루엣·연출을 보여준다.
4. 본문 (Body)     — 핵심 정보. material(소재·디테일), lookbook(코디 제안), size-spec(사이즈·스펙),
                     features/description/keywords 로 구체적 근거를 채운다.
5. 결론 (Close)    — 여운 있는 마감. closing 으로 에디토리얼 마감 문구를 남긴다.
                     신뢰가 필요하면 trust, 고지가 필요하면 legal 을 본문 후반~마감 전에 배치.

[사용 가능한 섹션 유형]
- hero        : { headline, subheadline?, ... } 첫 번째 필수. 오프닝.
- text        : { heading?, body } 공감·스타일링 노트·에디토리얼 서술.
- feature-split: { heading, body, shotSlot, reverse? } 이미지+텍스트 좌우 분할. 공감/브릿지에 강력.
- gallery     : { heading?, items:[{ shotSlot, caption? }] } 여러 컷 화보 그리드. 브릿지/본문.
- material    : { heading?, cells:[{ kind:'image'|'text', shotSlot?, title?, text?, span? }] }
                소재·디테일 클로즈업 + 설명 셀 조합. 본문 핵심.
- lookbook    : { heading?, looks:[{ shotSlot, caption? }] } 착장·코디 제안 룩북. 본문.
- size-spec   : { caption?, columns:[...], rows:[{ label, values:[...] }], note? } 사이즈·스펙 표. 본문.
- features    : 핵심 특징 리스트. 본문.
- description  : 상세 설명. 본문.
- keywords    : 포인트 키워드 태그. 본문.
- reviews     : 후기(있을 때만). 본문 후반.
- trust       : { rating?, quote?, quoteMeta?, badges:[{ title, desc? }] } 신뢰 요소. 마감 전.
- benefit-banner: { text } 짧은 강조 배너 한 줄. 테마가 허용할 때만 사용.
- legal       : { fields:[{ label, value }], aiNotice? } 소재·원산지 등 고지. 마감 전후.
- closing     : { heading, subtext? } 에디토리얼 마감 문구. 권장 마감 섹션.

⚠️ 커머스 금지 (필수):
- 가격·할인·"구매하기"·"장바구니" 같은 상거래 요소를 어떤 섹션에도 넣지 않는다.
- 가격/구매 CTA 는 판매 플랫폼(스마트스토어 등)의 몫이다. 상세페이지는 에디토리얼 콘텐츠만 담는다.
- 마감은 반드시 closing 으로. 가격·버튼이 있는 판매 유도 섹션을 만들지 말 것.

[촬영 슬롯(shotSlot) 배정 — 이미지가 필요한 섹션마다]
이미지를 쓰는 섹션(hero/gallery/feature-split/material image cell/lookbook 등)에는 아래 슬롯 중
가장 알맞은 것을 배정합니다. 셀러가 어떤 컷을 준비해야 하는지 안내하는 역할입니다.
- productShot : 상품 단독 정면·누끼·오브제 컷 (오프닝/본문 소재 클로즈업 전).
- fitShot     : 모델 착용 전신·핏 컷 (브릿지 핏 제안, lookbook).
- detailShot  : 디테일 클로즈업 — 소재 결감·스티치·버튼·카라 (material 소재 셀).
- lifestyle   : 배경·상황이 있는 라이프스타일 컷 (공감 오프닝, lookbook 무드).
슬롯은 서사 단계와 맞춰 배정: 공감엔 lifestyle, 브릿지엔 fitShot, 본문 소재엔 detailShot 등.

[테마 제안(themeId)]
카테고리·무드에 어울리는 테마를 하나 제안합니다.
- editorial-minimal : 여백 많은 미니멀 매거진. 대부분의 데일리·미니멀·모던 상품 기본값.
- soft-luxury-serif : 세리프 디스플레이 액센트의 부드러운 럭셔리. 로맨틱·우아·프리미엄 무드.
- clean-conversion  : 정돈된 정보형. 스펙·기능이 중요한 상품, benefit-banner 를 활용.

[구조 원칙]
- hero 가 반드시 첫 번째.
- 전체 섹션 개수: 3~13개 (권장 6~9개). 서사가 자연스럽게 이어질 만큼만.
- 같은 섹션 유형을 의미 없이 반복하지 않는다. 이미지형·텍스트형·정보형을 리듬감 있게 교차.
- 각 섹션의 텍스트는 큐레이터 톤("~해줍니다 / ~연출됩니다") 유지, 금칙어 절대 금지.

JSON 스키마(DetailPagePlanSchema)를 정확히 지켜 응답하세요. themeId 와 각 섹션 shotSlot 을 포함하세요.`

export const buildDetailPagePlanPrompt = (params: {
  productName: string
  tagline: string
  description: string
  category: string
  keywords: string[]
  features: string[]
  userIntent?: UserIntent
  refinement?: string
}) =>
  appendIntentSection(
    `다음 제품 정보를 바탕으로 에디토리얼 상세페이지 구조를 설계해주세요:

상품명: ${params.productName}
홍보문구: ${params.tagline}
카테고리: ${params.category}
핵심 키워드: ${params.keywords.join(', ')}
주요 특징: ${params.features.join(', ')}

기본 설명:
${params.description}

요청:
- 에디토리얼 5단계 서사(오프닝→공감→브릿지→본문→결론)로 섹션을 배열
- hero 가 반드시 첫 번째, 마감은 closing 으로 (가격·구매 CTA 금지)
- 3~13개(권장 6~9개) 섹션. 이미지형·텍스트형·정보형을 리듬감 있게 교차
- gallery / feature-split / material / lookbook / size-spec / trust / legal / closing 등
  신규 유형을 카테고리에 맞게 적극 활용
- 이미지가 필요한 섹션에는 shotSlot(productShot/fitShot/detailShot/lifestyle)을 서사에 맞게 배정
- 카테고리·무드에 어울리는 themeId 를 하나 제안
- 모든 텍스트는 자연스러운 한국어 큐레이터 톤으로, content/items 는 풍부하고 구체적으로`,
    params.userIntent,
    params.refinement,
  )
