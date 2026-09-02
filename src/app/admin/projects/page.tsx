/**
 * Admin 생성 히스토리 — 모든 유저의 projects 목록
 */

import Link from 'next/link'
import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { ExternalLink, Zap, Wand2 } from 'lucide-react'

interface SearchParams {
  mode?: 'quick' | 'studio'
  status?: 'pending' | 'processing' | 'done' | 'failed'
}

interface ProjectRow {
  id: string
  user_id: string
  mode: 'quick' | 'studio'
  status: 'pending' | 'processing' | 'done' | 'failed'
  product_image_url: string | null
  created_at: string
}

async function loadProjects(params: SearchParams): Promise<ProjectRow[]> {
  const admin = await createAdminClient()
  let q = admin
    .from('projects')
    .select('id, user_id, mode, status, product_image_url, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (params.mode)   q = q.eq('mode', params.mode)
  if (params.status) q = q.eq('status', params.status)
  const { data } = await q
  return (data ?? []) as ProjectRow[]
}

export default async function AdminProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // 페이지 자체 인가 가드 — 레이아웃 + proxy.ts 미들웨어에 더한 심층방어
  // (service_role 로 전체 사용자 프로젝트를 읽으므로 RLS 가 대신 막아주지 않는다).
  await requireAdmin()

  const params = await searchParams
  const projects = await loadProjects(params)

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-1">
          Generation History
        </div>
        <h1 className="text-[28px] font-black text-[#111111]">생성 히스토리</h1>
        <p className="text-[13px] text-[#707072] mt-1">
          모든 유저의 프로젝트 (최근 100건)
        </p>
      </header>

      {/* 필터 */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <FilterLink label="전체"     href="/admin/projects" active={!params.mode && !params.status} />
        <FilterLink label="간편 모드" href="/admin/projects?mode=quick"  active={params.mode === 'quick'} />
        <FilterLink label="스튜디오" href="/admin/projects?mode=studio" active={params.mode === 'studio'} />
        <span className="text-[#9e9ea0]">|</span>
        <FilterLink label="완료"      href="/admin/projects?status=done"       active={params.status === 'done'} />
        <FilterLink label="진행중"    href="/admin/projects?status=processing" active={params.status === 'processing'} />
        <FilterLink label="실패"      href="/admin/projects?status=failed"     active={params.status === 'failed'} />
      </div>

      {/* 테이블 */}
      <div style={{ border: '1px solid #e5e5e5' }}>
        <table className="w-full">
          <thead>
            <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '1px solid #e5e5e5' }}>
              <Th>썸네일</Th>
              <Th>유저 ID</Th>
              <Th>모드</Th>
              <Th>상태</Th>
              <Th>생성일</Th>
              <Th align="right">액션</Th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-[12px] text-[#9e9ea0]">결과 없음</td></tr>
            ) : projects.map((p, i) => (
              <tr key={p.id} style={{ borderBottom: i < projects.length - 1 ? '1px solid #f5f5f5' : undefined }}>
                <Td>
                  {p.product_image_url ? (
                    <div className="w-10 h-10 relative overflow-hidden" style={{ border: '1px solid #e5e5e5' }}>
                      <Image src={p.product_image_url} alt="" fill sizes="40px" className="object-cover" />
                    </div>
                  ) : (
                    <div className="w-10 h-10" style={{ backgroundColor: '#f5f5f5', border: '1px solid #e5e5e5' }} />
                  )}
                </Td>
                <Td>
                  <span className="text-[11px] font-mono text-[#9e9ea0]">{p.user_id.slice(0, 8)}…</span>
                </Td>
                <Td>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest"
                    style={{ backgroundColor: '#111111', color: '#ffffff' }}
                  >
                    {p.mode === 'quick' ? <Zap className="w-2.5 h-2.5" /> : <Wand2 className="w-2.5 h-2.5" />}
                    {p.mode === 'quick' ? '간편' : '스튜디오'}
                  </span>
                </Td>
                <Td>
                  <StatusBadge status={p.status} />
                </Td>
                <Td>
                  <span className="text-[11px] text-[#9e9ea0]">{formatDate(p.created_at)}</span>
                </Td>
                <Td align="right">
                  <Link
                    href={`/studio?projectId=${p.id}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold text-[#111111] hover:bg-[#f5f5f5] transition-colors"
                    style={{ border: '1px solid #cacacb' }}
                  >
                    <ExternalLink className="w-3 h-3" />
                    열기
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-[11px] text-[#9e9ea0]">총 {projects.length}건</div>
    </div>
  )
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className="px-3 py-1 rounded-full text-[11px] font-semibold transition-colors"
      style={{
        backgroundColor: active ? '#111111' : '#ffffff',
        color: active ? '#ffffff' : '#111111',
        border: `1px solid ${active ? '#111111' : '#cacacb'}`,
      }}
    >
      {label}
    </Link>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    done:       { bg: '#f0faf6', fg: '#007d48', label: '완료' },
    processing: { bg: '#fffbeb', fg: '#b45309', label: '진행중' },
    pending:    { bg: '#f5f5f5', fg: '#707072', label: '대기' },
    failed:     { bg: '#fff5f5', fg: '#d30005', label: '실패' },
  }
  const m = map[status] ?? map.pending
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: m.bg, color: m.fg }}
    >
      {m.label}
    </span>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] text-${align}`}
    >
      {children}
    </th>
  )
}

function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <td className={`px-3 py-2 text-${align}`}>{children}</td>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
