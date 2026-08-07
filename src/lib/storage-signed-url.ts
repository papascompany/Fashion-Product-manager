/**
 * Supabase Storage 서명 URL 헬퍼 — ai-fittings 버킷 (운영 강화 ④)
 *
 * ⚠️ OPT-IN 전용. 현재 어떤 코드 경로에서도 호출하지 않는다.
 *
 * 배경
 *  - 'ai-fittings' 버킷은 현재 의도적으로 public-read 다.
 *    (migration 004 헤더 "공개 URL 사용", 009 노트 "public read 권장")
 *    공개 공유 페이지·히스토리 썸네일·OG 이미지가 이 공개 URL 에 의존한다.
 *  - 따라서 이 파일은 버킷을 private 으로 "전환하지 않는다". 단지 나중에
 *    단계적으로 마이그레이션할 수 있도록 서명 URL 생성 능력만 제공한다.
 *  - 마이그레이션 레시피는 docs/SIGNED_URL_MIGRATION.md 참고.
 *
 * Node Runtime 전용 — createAdminClient(service-role) 사용.
 */

import { createAdminClient } from '@/lib/supabase/server'

const AI_FITTINGS_BUCKET = 'ai-fittings'

export interface SignedUrlResult {
  /** 서명된 임시 URL. 실패 시 null. */
  signedUrl: string | null
  /** 실패 사유 (사람이 읽기 위한 메시지). 성공 시 null. */
  error: string | null
}

/**
 * ai-fittings 버킷의 객체 경로에 대해 서명 URL 을 생성한다.
 *
 * @param path             버킷 내 객체 경로 (예: `<userId>/<ts>.png`).
 *                         공개 URL 을 가지고 있다면 toStoragePath() 로 먼저 추출.
 * @param expiresInSeconds 만료(초). 기본 1시간.
 *
 * 버킷이 아직 public 인 상태에서도 createSignedUrl 은 동작하므로, 채택 전
 * 검증/롤아웃 용도로 안전하게 호출할 수 있다.
 */
export async function createAiFittingSignedUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<SignedUrlResult> {
  const cleanPath = path.replace(/^\/+/, '')
  if (!cleanPath) {
    return { signedUrl: null, error: '빈 경로입니다.' }
  }

  try {
    const admin = await createAdminClient()
    const { data, error } = await admin.storage
      .from(AI_FITTINGS_BUCKET)
      .createSignedUrl(cleanPath, expiresInSeconds)

    if (error || !data?.signedUrl) {
      return { signedUrl: null, error: error?.message ?? '서명 URL 생성 실패' }
    }
    return { signedUrl: data.signedUrl, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    return { signedUrl: null, error: message }
  }
}

/**
 * 옵트인 hook — 호출 측이 (history / share / OG 이미지 등) ai-fittings 결과
 * URL 을 서명 URL 로 점진 마이그레이션할 수 있도록 단일 진입점을 제공한다.
 *
 * 사용 패턴:
 *   const url = await maybeSignedAiFittingUrl(publicUrl, { enabled: false })
 *
 *   - enabled=false (기본): publicUrl 을 그대로 반환 (현재 운영 모드).
 *   - enabled=true : public URL 에서 path 를 추출해 서명 URL 발급, 실패 시
 *     publicUrl 로 graceful fallback.
 *
 * Track 3 (TYP-04) — 본 함수는 dead module 마크를 벗기기 위해 추가됐다.
 * 실제 wiring (history/share 라우트 호출) 은 트랙 4 책임.
 */
export async function maybeSignedAiFittingUrl(
  publicUrl: string,
  opts: { enabled?: boolean; expiresInSeconds?: number } = {}
): Promise<string> {
  const { enabled = false, expiresInSeconds = 3600 } = opts
  if (!enabled || !publicUrl) return publicUrl

  const path = toStoragePath(publicUrl)
  if (!path) return publicUrl

  const { signedUrl } = await createAiFittingSignedUrl(path, expiresInSeconds)
  return signedUrl ?? publicUrl
}

/**
 * 기존 ai-fittings 공개 URL 에서 버킷 내부 객체 경로를 추출한다.
 * 공개→서명 URL 로 점진 마이그레이션할 때, 호출자가 저장돼 있던 public URL 을
 * 그대로 createAiFittingSignedUrl 에 넘길 수 있도록 돕는다.
 *
 * 지원 형태:
 *   …/storage/v1/object/public/ai-fittings/<path>
 *   …/storage/v1/object/sign/ai-fittings/<path>?token=…
 *
 * @returns 객체 경로 (`<userId>/<ts>.png`) 또는 추출 불가 시 null.
 */
export function toStoragePath(publicUrl: string): string | null {
  if (!publicUrl) return null
  // public 또는 sign 경로 모두에서 버킷 다음 세그먼트부터 추출
  const marker = new RegExp(`/${AI_FITTINGS_BUCKET}/(.+)$`)
  const match = publicUrl.match(marker)
  if (!match) return null
  // 쿼리스트링(서명 토큰 등) 제거
  const pathWithoutQuery = match[1].split('?')[0]
  try {
    return decodeURIComponent(pathWithoutQuery)
  } catch {
    return pathWithoutQuery
  }
}
