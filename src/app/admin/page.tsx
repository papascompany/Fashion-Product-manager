/**
 * Admin 대시보드 — 핵심 지표 카드 그리드 + 최근 이벤트 / 가입 유저
 *
 * Server Component — RLS 우회용 admin 클라이언트로 v_admin_stats view + 최근 이벤트 조회.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { TrendingUp, Users, Sparkles, CreditCard, Activity, AlertTriangle } from 'lucide-react'
import { getApiHealth } from '@/lib/api-balance'

interface Stats {
  total_users: number
  new_users_7d: number
  active_users_7d: number
  generations_7d: number
  mrr: number
  free_users: number
  starter_users: number
  pro_users: number
  business_users: number
}

interface RecentEvent {
  id: string
  user_id: string
  event_type: string
  credits_used: number
  created_at: string
  metadata: Record<string, unknown> | null
}

interface RecentUser {
  id: string
  plan: string
  credits_left: number
  created_at: string
}

/**
 * 통계 로드 결과.
 *
 * 이전에는 실패 시 null 을 돌려주고 화면이 `?? 0` 으로 폴백해,
 * 권한 오류(42501) 상황에서도 "총 가입자 0 · MRR ₩0" 이 정상값처럼 보였다.
 * 오너의 단가·번들 결정 근거가 되는 화면이라 실패를 실패로 표시해야 한다.
 */
type StatsResult =
  | { ok: true; stats: Stats }
  | { ok: false; reason: string }

/** 값을 못 불러왔을 때의 자리표시자 — 0 과 명확히 구분된다. */
const UNAVAILABLE = '—'

/** Postgres 에러 코드를 오너가 조치 가능한 한 줄로 변환 (상세는 서버 로그에만 남긴다). */
function describeStatsError(code: string | undefined): string {
  if (code === '42501') {
    return '권한 오류 (42501) — v_admin_stats 조회 권한이 없습니다. supabase/migrations/021_admin_stats_grant.sql 적용이 필요합니다.'
  }
  if (code === '42P01') {
    return '뷰 없음 (42P01) — v_admin_stats 가 존재하지 않습니다. 008 마이그레이션 적용 상태를 확인하세요.'
  }
  return `통계 조회 실패${code ? ` (${code})` : ''} — 서버 로그의 [admin/dashboard] 항목을 확인하세요.`
}

async function loadStats(): Promise<StatsResult> {
  const admin = await createAdminClient()
  const { data, error } = await admin.from('v_admin_stats').select('*').single()
  if (error) {
    console.error('[admin/dashboard] stats load failed:', error)
    return { ok: false, reason: describeStatsError(error.code) }
  }
  return { ok: true, stats: data as Stats }
}

async function loadRecentEvents(): Promise<RecentEvent[]> {
  const admin = await createAdminClient()
  const { data } = await admin
    .from('usage_events')
    .select('id, user_id, event_type, credits_used, created_at, metadata')
    .order('created_at', { ascending: false })
    .limit(20)
  return (data ?? []) as RecentEvent[]
}

async function loadRecentUsers(): Promise<RecentUser[]> {
  const admin = await createAdminClient()
  const { data } = await admin
    .from('user_profiles')
    .select('id, plan, credits_left, created_at')
    .order('created_at', { ascending: false })
    .limit(10)
  return (data ?? []) as RecentUser[]
}

export default async function AdminDashboard() {
  // 페이지 자체 인가 가드 — 레이아웃 requireAdmin 에만 의존하지 않는다.
  // App Router 에서 레이아웃은 soft(RSC) 네비게이션 시 재실행되지 않으므로,
  // service_role 로 전체 사용자 데이터를 읽는 이 페이지는 스스로 검증해야 한다.
  // (proxy.ts 미들웨어가 1차로 막지만, RLS 가 걷힌 페이지의 심층방어로 이중화)
  await requireAdmin()

  const [statsResult, events, users] = await Promise.all([
    loadStats(),
    loadRecentEvents(),
    loadRecentUsers(),
  ])

  // 실패 시 stats 는 null 이고, 각 카드는 0 대신 UNAVAILABLE 을 그린다.
  const stats = statsResult.ok ? statsResult.stats : null

  // API 헬스 — env 기반(동기, 네트워크 호출 없음). 실시간 잔액이 아니라 키 설정 상태.
  const apiHealth = getApiHealth()

  return (
    <div className="p-6 md:p-8">
      <header className="mb-8">
        <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-1">
          Overview
        </div>
        <h1 className="text-[28px] font-black text-[#111111]">대시보드</h1>
      </header>

      {/* 통계 로드 실패 배너 — 숫자를 0 으로 위장하지 않고 상태를 명시한다 */}
      {!statsResult.ok && (
        <div className="mb-4 p-4" style={{ border: '1px solid #d30005', backgroundColor: '#fff5f5' }}>
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#d30005] mb-1.5">
            <AlertTriangle className="w-3 h-3" />
            통계 불러오기 실패
          </div>
          <div className="text-[13px] font-black text-[#111111]">
            아래 지표·플랜 분포는 실제 값이 아닙니다. 0 이 아니라 “{UNAVAILABLE}” 로 표시합니다.
          </div>
          <div className="text-[11px] text-[#9e9ea0] mt-1">{statsResult.reason}</div>
        </div>
      )}

      {/* 지표 카드 그리드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 mb-10" style={{ border: '1px solid #e5e5e5' }}>
        <StatCard
          icon={Users}
          label="총 가입자"
          value={stats ? stats.total_users : UNAVAILABLE}
          delta={stats ? `+${stats.new_users_7d} 지난 7일` : undefined}
          unavailable={!stats}
          borderRight
        />
        <StatCard
          icon={TrendingUp}
          label="활성 셀러 (7일)"
          value={stats ? stats.active_users_7d : UNAVAILABLE}
          unavailable={!stats}
          borderRight
        />
        <StatCard
          icon={Sparkles}
          label="생성 (7일)"
          value={stats ? stats.generations_7d : UNAVAILABLE}
          unavailable={!stats}
          borderRight
        />
        <StatCard
          icon={CreditCard}
          label="MRR"
          value={stats ? `₩${stats.mrr.toLocaleString()}` : UNAVAILABLE}
          unavailable={!stats}
        />
      </div>

      {/* 플랜 분포 */}
      <section className="mb-10">
        <SectionTitle>플랜 분포</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4" style={{ border: '1px solid #e5e5e5' }}>
          <PlanCell plan="Free"     count={stats ? stats.free_users : null}     borderRight />
          <PlanCell plan="Starter"  count={stats ? stats.starter_users : null}  borderRight />
          <PlanCell plan="Pro"      count={stats ? stats.pro_users : null}      borderRight  highlight />
          <PlanCell plan="Business" count={stats ? stats.business_users : null} />
        </div>
      </section>

      {/* API 상태 — AI 프로바이더 키 설정 헬스 (실시간 잔액 아님) */}
      <section className="mb-10">
        <SectionTitle>API 상태</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-3" style={{ border: '1px solid #e5e5e5' }}>
          <ApiHealthCell label="Anthropic Claude" ok={apiHealth.anthropicKey} borderRight />
          <ApiHealthCell label="Google Gemini" ok={apiHealth.googleKey} borderRight />
          <div className="p-4 bg-white">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-1.5">
              <Activity className="w-3 h-3" />
              최근 장애 (인스턴스)
            </div>
            {apiHealth.lastIncident ? (
              <div>
                <div className="text-[13px] font-black text-[#d30005] uppercase tracking-wide">
                  {apiHealth.lastIncident.status}
                </div>
                <div className="text-[11px] text-[#9e9ea0] mt-0.5">
                  {apiHealth.lastIncident.provider}
                  {apiHealth.lastIncident.task ? ` · ${apiHealth.lastIncident.task}` : ''}
                  {' · '}
                  {formatDate(apiHealth.lastIncident.at)}
                </div>
              </div>
            ) : (
              // TYP-05 — reportProviderFailure 가 호출되지 않으면 "정상" 인지
              // "보고가 없는지" 구분이 안 된다. 메시지를 명확히 한다.
              <div>
                <div className="text-[13px] font-black text-[#007d48]">정상 또는 데이터 없음</div>
                <div className="text-[11px] text-[#9e9ea0] mt-0.5">
                  이 인스턴스에서 감지된 장애가 없거나, 라우트가 아직 wire 되지 않았습니다.
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="text-[11px] text-[#9e9ea0] mt-2">
          키 설정 여부와 이 인스턴스에서 최근 감지된 장애를 표시합니다. 실시간 잔액·할당량은 아닙니다.
          장애 데이터는 라우트의 catch 블록에 <code className="font-mono">reportProviderFailure()</code> 가 호출돼야 채워집니다.
        </p>
      </section>

      {/* 2단: 최근 가입 / 최근 이벤트 */}
      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <SectionTitle>최근 가입 유저 (10명)</SectionTitle>
          <div style={{ border: '1px solid #e5e5e5' }}>
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '1px solid #e5e5e5' }}>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">ID (앞 8자)</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">플랜</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">크레딧</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">가입일</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-[12px] text-[#9e9ea0]">데이터 없음</td></tr>
                ) : users.map((u, i) => (
                  <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid #f5f5f5' : undefined }}>
                    <td className="px-4 py-2 text-[12px] font-mono text-[#111111]">{u.id.slice(0, 8)}…</td>
                    <td className="px-4 py-2 text-[12px] text-[#111111] uppercase font-black tracking-wider">{u.plan}</td>
                    <td className="px-4 py-2 text-[12px] text-right text-[#111111] font-bold">{u.credits_left}</td>
                    <td className="px-4 py-2 text-[11px] text-right text-[#9e9ea0]">{formatDate(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <SectionTitle>최근 사용 이벤트 (20건)</SectionTitle>
          <div style={{ border: '1px solid #e5e5e5', maxHeight: '420px', overflowY: 'auto' }}>
            <table className="w-full">
              <thead className="sticky top-0">
                <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '1px solid #e5e5e5' }}>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">유저</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">이벤트</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">크레딧</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">시각</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-[12px] text-[#9e9ea0]">데이터 없음</td></tr>
                ) : events.map((e, i) => (
                  <tr key={e.id} style={{ borderBottom: i < events.length - 1 ? '1px solid #f5f5f5' : undefined }}>
                    <td className="px-4 py-2 text-[11px] font-mono text-[#111111]">{e.user_id.slice(0, 8)}…</td>
                    <td className="px-4 py-2 text-[11px] text-[#111111]">{eventLabel(e.event_type)}</td>
                    <td className="px-4 py-2 text-[11px] text-right font-bold" style={{ color: e.credits_used > 0 ? '#d30005' : '#007d48' }}>
                      {e.credits_used > 0 ? '-' : '+'}
                      {Math.abs(e.credits_used)}
                    </td>
                    <td className="px-4 py-2 text-[10px] text-right text-[#9e9ea0]">{formatDate(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

// ─── 서브 컴포넌트 ─────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, delta, unavailable, borderRight,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  delta?: string
  unavailable?: boolean
  borderRight?: boolean
}) {
  return (
    <div className="p-5 bg-white" style={{ borderRight: borderRight ? '1px solid #e5e5e5' : undefined }}>
      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-2">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div
        className="text-[28px] font-black text-[#111111] tracking-tight"
        style={{ color: unavailable ? '#9e9ea0' : undefined }}
      >
        {value}
      </div>
      {unavailable ? (
        <div className="text-[11px] text-[#d30005] mt-1">불러오기 실패</div>
      ) : (
        delta && <div className="text-[11px] text-[#007d48] mt-1">{delta}</div>
      )}
    </div>
  )
}

function PlanCell({ plan, count, borderRight, highlight }: { plan: string; count: number | null; borderRight?: boolean; highlight?: boolean }) {
  return (
    <div
      className="p-4"
      style={{
        borderRight: borderRight ? '1px solid #e5e5e5' : undefined,
        backgroundColor: highlight ? '#f5f5f5' : '#ffffff',
        borderTop: highlight ? '3px solid #111111' : '3px solid transparent',
      }}
    >
      <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-1.5">{plan}</div>
      <div
        className="text-[22px] font-black text-[#111111]"
        style={{ color: count === null ? '#9e9ea0' : undefined }}
      >
        {count === null ? UNAVAILABLE : count.toLocaleString()}
      </div>
    </div>
  )
}

function ApiHealthCell({ label, ok, borderRight }: { label: string; ok: boolean; borderRight?: boolean }) {
  return (
    <div className="p-4 bg-white" style={{ borderRight: borderRight ? '1px solid #e5e5e5' : undefined }}>
      <div className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0] mb-1.5">{label}</div>
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: ok ? '#007d48' : '#d30005' }}
        />
        <span className="text-[13px] font-black" style={{ color: ok ? '#007d48' : '#d30005' }}>
          {ok ? '키 설정됨' : '키 없음'}
        </span>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[16px] font-black text-[#111111] mb-3">{children}</h2>
  )
}

const EVENT_LABELS: Record<string, string> = {
  quick_generated: '간편 생성',
  studio_generated: '스튜디오 생성',
  thumbnail_generated: '썸네일',
  credit_purchased: '크레딧 충전',
  plan_upgraded: '플랜 업그레이드',
}

function eventLabel(t: string) {
  return EVENT_LABELS[t] ?? t
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
