import { createAdminClient } from '@/lib/supabase/server'
import { UsersTable } from '@/components/admin/users-table'

interface SearchParams {
  q?: string
  plan?: 'free' | 'starter' | 'pro' | 'business'
  showBanned?: string
}

interface UserRow {
  id: string
  plan: 'free' | 'starter' | 'pro' | 'business'
  credits_left: number
  role: 'user' | 'admin'
  banned_at: string | null
  created_at: string
  email: string | null
}

/** TYP-09: auth.admin.listUsers perPage 상한 — 초과 시 silent 누락 안내 */
const LIST_USERS_PER_PAGE = 200

interface LoadUsersResult {
  rows: UserRow[]
  /** auth.users 총량이 LIST_USERS_PER_PAGE 를 초과해 검색 누락 가능 시 true */
  reachedAuthCap: boolean
  /** authUsers 응답 갯수 (참고용) */
  authUsersCount: number
}

async function loadUsers(params: SearchParams): Promise<LoadUsersResult> {
  const admin = await createAdminClient()
  let query = admin
    .from('user_profiles')
    .select('id, plan, credits_left, role, banned_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (params.plan) query = query.eq('plan', params.plan)
  if (!params.showBanned) query = query.is('banned_at', null)

  const { data: profiles } = await query
  if (!profiles) return { rows: [], reachedAuthCap: false, authUsersCount: 0 }

  // auth.users 에서 email 조회 (admin 권한 필요)
  const ids = profiles.map((p) => p.id)
  const { data: { users: authUsers } } = await admin.auth.admin.listUsers({
    perPage: LIST_USERS_PER_PAGE,
  })
  const emailMap = new Map<string, string | null>()
  for (const u of authUsers ?? []) emailMap.set(u.id, u.email ?? null)

  const rows: UserRow[] = profiles
    .map((p) => ({
      ...(p as Omit<UserRow, 'email'>),
      email: emailMap.get(p.id) ?? null,
    }))
    .filter((u) => {
      if (!params.q) return true
      const q = params.q.toLowerCase()
      return (u.email?.toLowerCase().includes(q) ?? false) || u.id.includes(q)
    })

  const filtered = rows.filter((r) => ids.includes(r.id))
  const authUsersCount = authUsers?.length ?? 0
  // perPage 상한 도달 = 다음 페이지가 더 있어 검색 silent 누락 가능 (TYP-09).
  const reachedAuthCap = authUsersCount >= LIST_USERS_PER_PAGE

  return { rows: filtered, reachedAuthCap, authUsersCount }
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const { rows: users, reachedAuthCap, authUsersCount } = await loadUsers(params)

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-1">
          User Management
        </div>
        <h1 className="text-[28px] font-black text-[#111111]">유저 관리</h1>
        <p className="text-[13px] text-[#707072] mt-1">
          이메일 검색 · 플랜 변경 · 크레딧 조정 · 계정 정지
        </p>
      </header>

      {reachedAuthCap && (
        <div
          role="alert"
          className="mb-4 p-3 text-[12px] text-[#7a4c00] bg-[#fff4d6] border border-[#e9c66a]"
        >
          <strong className="font-bold">검색 누락 주의:</strong> auth.users 응답이
          상한({authUsersCount})에 도달했습니다. 200명 초과 시 이메일 검색이
          silent 누락될 수 있습니다 — 서버측 페이지네이션 도입(TYP-09 후속) 전까지
          ID 기반 직접 조회를 권장합니다.
        </div>
      )}

      <UsersTable initial={users} />
    </div>
  )
}
