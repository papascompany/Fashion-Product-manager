import Link from 'next/link'
import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { LayoutDashboard, Users, FileText, CreditCard, Settings, ArrowLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Admin · ProductCraft AI',
  description: '운영 대시보드',
  // 운영 화면은 검색 색인 대상이 아니다 (robots.txt 차단과 별개로 meta 로도 이중 차단)
  robots: { index: false, follow: false },
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 모든 admin 페이지 진입 전 권한 검증
  const admin = await requireAdmin()

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* 상단 admin 바 */}
      <header className="bg-[#111111] sticky top-0 z-50">
        <div className="max-w-[1440px] mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/studio" className="flex items-center gap-1.5 text-[11px] font-semibold text-[#9e9ea0] hover:text-white transition-colors">
              <ArrowLeft className="w-3 h-3" />
              스튜디오로
            </Link>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#9e9ea0]">|</span>
            <span className="text-[11px] font-black uppercase tracking-widest text-white">
              ProductCraft Admin
            </span>
          </div>
          <span className="text-[11px] text-[#9e9ea0]">{admin.email}</span>
        </div>
      </header>

      {/* 2-단 레이아웃 */}
      <div className="max-w-[1440px] mx-auto flex">
        {/* 좌측 nav */}
        <aside className="w-56 shrink-0 hidden md:block" style={{ borderRight: '1px solid #e5e5e5', minHeight: 'calc(100vh - 3rem)', backgroundColor: '#ffffff' }}>
          <nav className="p-4 space-y-1">
            <NavLink href="/admin"          icon={LayoutDashboard} label="대시보드" />
            <NavLink href="/admin/users"    icon={Users}           label="유저 관리" />
            <NavLink href="/admin/projects" icon={FileText}        label="생성 히스토리" />
            <NavLink href="/admin/billing"  icon={CreditCard}      label="결제 / 매출" />
            <NavLink href="/admin/settings" icon={Settings}        label="설정" />
          </nav>
        </aside>

        {/* 본문 */}
        <main className="flex-1 min-w-0 bg-white">{children}</main>
      </div>
    </div>
  )
}

function NavLink({ href, icon: Icon, label }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors"
    >
      <Icon className="w-4 h-4 text-[#707072]" />
      {label}
    </Link>
  )
}
