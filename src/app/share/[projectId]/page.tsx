/**
 * 공유 수신 페이지 (공개 — 인증 불필요)
 * GET /share/[projectId]
 *
 * 서비스 롤 클라이언트로 RLS 우회 → 링크를 받은 사람이 볼 수 있는 상품 소개 페이지
 *
 * ⚠️ 인가 게이트 (감사 이슈 2):
 *   RLS 를 우회하므로 `status = 'done'` 만 확인하면 **소유자가 한 번도 공유하지 않은
 *   프로젝트**까지 URL 만 알면 제3자가 전부 열람한다. 그래서 렌더 전에
 *   `shares` 테이블에 해당 project_id 의 공유 기록이 실제로 있는지 확인하고,
 *   없거나 조회가 실패하면 404 로 떨어뜨린다(fail-closed).
 *
 *   판정은 **기존 컬럼(project_id)만** 사용한다. 020_share_gate.sql 이 추가하는
 *   token / revoked_at 은 오너가 Supabase 콘솔에서 수동 적용하므로, 적용 전에
 *   코드가 참조하면 모든 공유 페이지가 죽는다. 020 적용을 확인한 뒤에만
 *   revoked_at 필터를 켤 것.
 */

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/server'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface ProductName {
  name: string
  trend?: string
}

interface SharePageProps {
  params: Promise<{ projectId: string }>
}

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

// ─── 인가 게이트 ──────────────────────────────────────────────────────────────

/** 공유 페이지는 링크를 받은 사람만 보는 것이므로 검색엔진 색인 대상이 아니다. */
const NO_INDEX_ROBOTS: Metadata['robots'] = { index: false, follow: false }

/**
 * 소유자가 이 프로젝트를 실제로 공유했는지 판정한다.
 * 조회 자체가 실패해도 안전측(false → 404)으로 떨어진다.
 */
async function hasShareRecord(supabase: AdminClient, projectId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('shares')
    .select('id')
    .eq('project_id', projectId)
    .limit(1)

  if (error) {
    console.error('[/share] shares lookup error:', error.message)
    return false
  }

  return (data?.length ?? 0) > 0
}

// ─── 동적 메타데이터 ───────────────────────────────────────────────────────────

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { projectId } = await params
  const supabase = await createAdminClient()

  // 공유 기록이 없으면 상품 정보를 메타데이터(제목/OG)로도 노출하지 않는다.
  if (!(await hasShareRecord(supabase, projectId))) {
    return {
      title: 'ProductCraft AI',
      description: '팔리는 상품 콘텐츠를 AI로 자동 생성',
      robots: NO_INDEX_ROBOTS,
    }
  }

  const { data: gens } = await supabase
    .from('generations')
    .select('type, payload')
    .eq('project_id', projectId)
    .in('type', ['naming', 'tagline'])

  const naming = gens?.find((g) => g.type === 'naming')
  const taglineRow = gens?.find((g) => g.type === 'tagline')

  const payload = naming?.payload as Record<string, unknown> | null
  const names = (payload?.names as ProductName[] | undefined) ?? []
  const productName = names[0]?.name ?? 'ProductCraft AI'
  const tagline = (taglineRow?.payload as Record<string, unknown> | null)?.tagline as string | undefined

  return {
    title: `${productName} — ProductCraft AI`,
    description: tagline ?? '팔리는 상품 콘텐츠를 AI로 자동 생성',
    robots: NO_INDEX_ROBOTS,
    openGraph: {
      title: productName,
      description: tagline ?? '팔리는 상품 콘텐츠를 AI로 자동 생성',
      type: 'website',
    },
  }
}

// ─── 페이지 ───────────────────────────────────────────────────────────────────

export default async function SharePage({ params }: SharePageProps) {
  const { projectId } = await params
  const supabase = await createAdminClient()

  // 인가 게이트 — 소유자가 공유한 프로젝트만 공개한다 (조회 실패 시에도 404)
  if (!(await hasShareRecord(supabase, projectId))) {
    notFound()
  }

  // 프로젝트 조회
  const { data: project } = await supabase
    .from('projects')
    .select('id, mode, product_image_url, status')
    .eq('id', projectId)
    .single()

  if (!project || project.status !== 'done') {
    notFound()
  }

  // 생성물 조회 (naming, tagline, description)
  const { data: gens } = await supabase
    .from('generations')
    .select('type, payload')
    .eq('project_id', projectId)
    .in('type', ['naming', 'tagline', 'description'])

  const namingPayload = (gens?.find((g) => g.type === 'naming')?.payload ?? {}) as Record<string, unknown>
  const taglinePayload = (gens?.find((g) => g.type === 'tagline')?.payload ?? {}) as Record<string, unknown>
  const descPayload = (gens?.find((g) => g.type === 'description')?.payload ?? {}) as Record<string, unknown>

  const names = (namingPayload.names as ProductName[] | undefined) ?? []
  const tagline = (taglinePayload.tagline as string | undefined) ?? ''
  const description = (descPayload.description as string | undefined) ?? ''
  const highlights = (descPayload.highlights as string[] | undefined) ?? []

  const primaryName = names[0]?.name ?? ''

  // 썸네일 조회 (있는 경우)
  const { data: thumbnails } = await supabase
    .from('thumbnails')
    .select('url, width, height, aspect_ratio')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(1)

  const thumbnail = thumbnails?.[0] ?? null

  return (
    <div
      className="min-h-screen bg-[#faf9f7]"
      style={{ fontFamily: "'Instrument Serif', 'Noto Serif KR', Georgia, serif" }}
    >
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <span className="text-sm font-sans font-semibold text-stone-900 tracking-tight">
            ProductCraft AI
          </span>
          <Link
            href="/"
            className="text-xs font-sans font-semibold text-white bg-stone-900 hover:bg-stone-700 transition-colors px-4 py-1.5 rounded-full"
          >
            나도 만들기
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        {/* 썸네일 (있는 경우) */}
        {thumbnail && (
          <div className="mb-10 rounded-3xl overflow-hidden bg-stone-100 shadow-sm">
            <Image
              src={thumbnail.url}
              alt={primaryName}
              width={thumbnail.width || 800}
              height={thumbnail.height || 800}
              className="w-full object-cover"
              style={{ maxHeight: '420px', objectFit: 'cover' }}
              priority
            />
          </div>
        )}

        {/* 상품 이미지 (썸네일 없고 원본 있는 경우) */}
        {!thumbnail && project.product_image_url && (
          <div className="mb-10 rounded-3xl overflow-hidden bg-stone-100 shadow-sm">
            <Image
              src={project.product_image_url}
              alt={primaryName}
              width={800}
              height={800}
              className="w-full object-cover"
              style={{ maxHeight: '420px', objectFit: 'cover' }}
              priority
            />
          </div>
        )}

        {/* 상품명 */}
        {primaryName && (
          <h1 className="text-4xl md:text-5xl tracking-tight leading-tight mb-3">
            {primaryName}
          </h1>
        )}

        {/* 홍보문구 */}
        {tagline && (
          <p className="text-xl italic text-stone-500 mb-8 leading-relaxed">
            &ldquo;{tagline}&rdquo;
          </p>
        )}

        {/* 핵심 하이라이트 */}
        {highlights.length > 0 && (
          <div className="mb-8 grid grid-cols-1 gap-2.5">
            {highlights.map((h, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3"
              >
                <span className="text-amber-600 mt-0.5 text-sm">✦</span>
                <span className="font-sans text-sm text-stone-700 leading-relaxed">{h}</span>
              </div>
            ))}
          </div>
        )}

        {/* 상세 설명 */}
        {description && (
          <div className="mb-10 bg-white border border-stone-200 rounded-2xl p-6">
            <pre className="font-sans text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
              {description}
            </pre>
          </div>
        )}

        {/* 대체 상품명 (2, 3번째) */}
        {names.length > 1 && (
          <div className="mb-10">
            <p className="text-xs font-sans text-stone-400 uppercase tracking-widest mb-3">
              다른 이름 옵션
            </p>
            <div className="flex flex-col gap-2">
              {names.slice(1).map((n, i) => (
                <div
                  key={i}
                  className="bg-white border border-stone-200 rounded-xl px-5 py-3"
                >
                  <p className="text-lg">{n.name}</p>
                  {n.trend && (
                    <p className="text-xs font-sans text-stone-400 mt-0.5">{n.trend}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="mt-12 rounded-3xl bg-stone-900 p-8 text-center">
          <p className="text-white text-2xl mb-2">이 상품 소개, AI가 30초 만에 만들었습니다</p>
          <p className="text-stone-400 font-sans text-sm mb-6">
            상품명 · 홍보문구 · 상세설명 · 썸네일까지 자동 생성
          </p>
          <Link
            href="/"
            className="inline-block font-sans font-semibold text-sm bg-white text-stone-900 hover:bg-stone-100 transition-colors px-7 py-3 rounded-full"
          >
            무료로 시작하기
          </Link>
        </div>
      </main>

      {/* 푸터 */}
      <footer className="max-w-2xl mx-auto px-6 py-8 mt-8 border-t border-stone-200">
        <p className="text-xs font-sans text-stone-400 text-center">
          ProductCraft AI로 생성된 콘텐츠 · AI 생성물임을 명시합니다
        </p>
      </footer>
    </div>
  )
}
