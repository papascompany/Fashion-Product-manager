'use client'

/**
 * UsersTable — Admin 유저 관리 테이블 (Phase 3 / Admin)
 *
 * 인라인 액션: 플랜 변경 / 크레딧 +/- / 정지 / 정지 해제
 * 모든 변경은 /api/admin/users/[id] PATCH 호출 → 감사 로그 자동 기록
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Ban, RotateCcw, Plus, Minus, Loader2 } from 'lucide-react'

type Plan = 'free' | 'starter' | 'pro' | 'business'

export interface AdminUserRow {
  id: string
  email: string | null
  plan: Plan
  credits_left: number
  role: 'user' | 'admin'
  banned_at: string | null
  created_at: string
}

interface UsersTableProps {
  initial: AdminUserRow[]
}

export function UsersTable({ initial }: UsersTableProps) {
  const router = useRouter()
  const [rows, setRows] = useState<AdminUserRow[]>(initial)
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState<Plan | ''>('')
  const [showBanned, setShowBanned] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 변경은 성공했으나 감사 기록(audit_log)에 실패한 경우의 경고 (200 응답에 실려 온다)
  const [auditWarning, setAuditWarning] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = rows.filter((u) => {
    if (planFilter && u.plan !== planFilter) return false
    if (!showBanned && u.banned_at) return false
    if (search) {
      const s = search.toLowerCase()
      return (u.email?.toLowerCase().includes(s) ?? false) || u.id.includes(s)
    }
    return true
  })

  const refresh = () => startTransition(() => router.refresh())

  const callAction = async (
    userId: string,
    body: Record<string, unknown>,
  ): Promise<AdminUserRow | null> => {
    setBusyId(userId)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      const updated: AdminUserRow & { auditWarning?: string } = await res.json()
      // 변경은 적용됐지만 감사 기록에 실패한 경우 — 서버가 auditWarning 을 실어 보낸다.
      // 200 이라 에러 배너 경로를 타지 않으므로 여기서 별도 경고로 노출한다.
      // (표시하지 않으면 감사 누락이 결국 조용히 묻혀 이 기능의 목적이 사라진다)
      setAuditWarning(updated.auditWarning ?? null)
      // 낙관적 업데이트
      setRows((prev) => prev.map((r) => (r.id === userId ? { ...r, ...updated } : r)))
      return updated
    } catch (err) {
      setError(err instanceof Error ? err.message : '액션 실패')
      return null
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9e9ea0]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이메일 또는 ID 검색"
            className="w-full h-10 pl-10 pr-3 text-[13px] focus:outline-none"
            style={{ border: '1px solid #cacacb' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#111111')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#cacacb')}
          />
        </div>
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value as Plan | '')}
          className="h-10 px-3 text-[13px] focus:outline-none"
          style={{ border: '1px solid #cacacb' }}
        >
          <option value="">전체 플랜</option>
          <option value="free">Free</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="business">Business</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-[#707072]">
          <input
            type="checkbox"
            checked={showBanned}
            onChange={(e) => setShowBanned(e.target.checked)}
          />
          정지된 계정 포함
        </label>
        <button
          onClick={refresh}
          disabled={isPending}
          className="h-10 px-3 text-[12px] font-semibold text-[#111111] hover:bg-[#f5f5f5] transition-colors disabled:opacity-50"
          style={{ border: '1px solid #cacacb' }}
        >
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '🔄 새로고침'}
        </button>
      </div>

      {auditWarning && (
        <div
          className="p-3 text-[12px]"
          role="status"
          aria-live="polite"
          style={{ color: '#b45309', backgroundColor: '#fff9e6', border: '1px solid #f5c430' }}
        >
          ⚠️ {auditWarning}
        </div>
      )}

      {error && (
        <div className="p-3 text-[12px]" style={{ color: '#d30005', backgroundColor: '#fff5f5', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* 테이블 */}
      <div style={{ border: '1px solid #e5e5e5', overflowX: 'auto' }}>
        <table className="w-full min-w-[900px]">
          <thead>
            <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '1px solid #e5e5e5' }}>
              <Th>이메일</Th>
              <Th>ID</Th>
              <Th>플랜</Th>
              <Th align="right">크레딧</Th>
              <Th>권한</Th>
              <Th>가입일</Th>
              <Th align="right">액션</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[12px] text-[#9e9ea0]">결과 없음</td></tr>
            ) : filtered.map((u, i) => (
              <tr
                key={u.id}
                style={{
                  borderBottom: i < filtered.length - 1 ? '1px solid #f5f5f5' : undefined,
                  backgroundColor: u.banned_at ? '#fff5f5' : '#ffffff',
                }}
              >
                <Td>
                  <span className="text-[12px] text-[#111111]">{u.email ?? '—'}</span>
                  {u.banned_at && (
                    <span className="ml-2 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest" style={{ backgroundColor: '#d30005', color: '#ffffff' }}>
                      정지
                    </span>
                  )}
                </Td>
                <Td>
                  <span className="text-[11px] font-mono text-[#9e9ea0]">{u.id.slice(0, 8)}…</span>
                </Td>
                <Td>
                  <select
                    value={u.plan}
                    onChange={(e) => callAction(u.id, { plan: e.target.value as Plan })}
                    disabled={busyId === u.id}
                    className="text-[11px] px-2 py-1 focus:outline-none uppercase font-bold tracking-wider"
                    style={{ border: '1px solid #cacacb' }}
                  >
                    <option value="free">Free</option>
                    <option value="starter">Starter</option>
                    <option value="pro">Pro</option>
                    <option value="business">Business</option>
                  </select>
                </Td>
                <Td align="right">
                  <CreditAdjustor
                    value={u.credits_left}
                    busy={busyId === u.id}
                    onAdjust={(delta) => callAction(u.id, { creditsDelta: delta })}
                  />
                </Td>
                <Td>
                  <span
                    className="px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest"
                    style={{
                      backgroundColor: u.role === 'admin' ? '#111111' : '#f5f5f5',
                      color: u.role === 'admin' ? '#ffffff' : '#9e9ea0',
                    }}
                  >
                    {u.role}
                  </span>
                </Td>
                <Td>
                  <span className="text-[11px] text-[#9e9ea0]">{formatDate(u.created_at)}</span>
                </Td>
                <Td align="right">
                  {u.banned_at ? (
                    <button
                      onClick={() => callAction(u.id, { unban: true })}
                      disabled={busyId === u.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold text-[#007d48] hover:bg-[#f0faf6] transition-colors"
                      style={{ border: '1px solid #007d48' }}
                    >
                      <RotateCcw className="w-3 h-3" />
                      정지 해제
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (confirm(`${u.email ?? u.id} 계정을 정지하시겠습니까?`)) {
                          callAction(u.id, { ban: true })
                        }
                      }}
                      disabled={busyId === u.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold text-[#d30005] hover:bg-[#fff5f5] transition-colors"
                      style={{ border: '1px solid #fecaca' }}
                    >
                      <Ban className="w-3 h-3" />
                      정지
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-[#9e9ea0]">
        총 {filtered.length}명 / 로드 {rows.length}명 (최근 100건)
      </div>
    </div>
  )
}

// ─── 보조 컴포넌트 ──────────────────────────────────────────────────────────

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

function CreditAdjustor({
  value, onAdjust, busy,
}: { value: number; onAdjust: (delta: number) => void; busy: boolean }) {
  const [showInput, setShowInput] = useState(false)
  const [input, setInput] = useState('10')

  if (showInput) {
    return (
      <div className="inline-flex items-center gap-1">
        <input
          type="number"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-16 px-1.5 py-0.5 text-[11px] text-right focus:outline-none"
          style={{ border: '1px solid #cacacb' }}
        />
        <button
          onClick={() => { onAdjust(Number(input)); setShowInput(false) }}
          disabled={busy}
          className="p-1 text-[#007d48] hover:bg-[#f0faf6]"
          title="추가"
        >
          <Plus className="w-3 h-3" />
        </button>
        <button
          onClick={() => { onAdjust(-Number(input)); setShowInput(false) }}
          disabled={busy}
          className="p-1 text-[#d30005] hover:bg-[#fff5f5]"
          title="차감"
        >
          <Minus className="w-3 h-3" />
        </button>
        <button
          onClick={() => setShowInput(false)}
          className="text-[10px] text-[#9e9ea0] px-1"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setShowInput(true)}
      disabled={busy}
      className="inline-flex items-center gap-1 px-2 py-0.5 hover:bg-[#f5f5f5] transition-colors"
      title="크레딧 조정"
    >
      <span className="text-[12px] font-bold text-[#111111]">{value}</span>
      {busy && <Loader2 className="w-3 h-3 animate-spin text-[#9e9ea0]" />}
    </button>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' })
}
