'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, KanbanSquare, CheckSquare, Inbox, Megaphone, BarChart3, Sparkles, Upload, Settings, LogOut, Waves } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/kit'
import type { Profile } from '@/lib/types'
import type { Segment } from '@/lib/segment'

interface Props {
  profile: Profile | null
  pendingTodoCount?: number
  segment?: Segment
}

// Pipeline + Analytics are sales-funnel tools — hidden when viewing Clients.
const PROSPECT_ONLY = ['/crm/pipeline', '/crm/analytics']

const NAV = [
  { href: '/crm', label: 'Overview', icon: LayoutDashboard },
  { href: '/crm/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { href: '/crm/inbox', label: 'Inbox', icon: Inbox },
  { href: '/crm/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/crm/todo', label: 'To-Do', icon: CheckSquare, badge: true },
  { href: '/crm/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/crm/ai', label: 'AI Assistant', icon: Sparkles },
  { href: '/crm/import', label: 'Import', icon: Upload },
  { href: '/crm/settings', label: 'Settings', icon: Settings },
]

export default function Sidebar({ profile, pendingTodoCount = 0, segment = 'prospect' }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  const visibleNav = NAV.filter(item => !(segment === 'client' && PROSPECT_ONLY.includes(item.href)))

  function switchSegment(next: Segment) {
    if (next === segment) return
    document.cookie = `crm_seg=${next};path=/;max-age=31536000;samesite=lax`
    const onProspectOnly = PROSPECT_ONLY.some(p => pathname === p || pathname.startsWith(p + '/'))
    if (next === 'client' && onProspectOnly) router.push('/crm')
    else router.refresh()
  }

  const rawName = profile?.full_name ?? ''
  const displayName = rawName.includes('@')
    ? rawName.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : rawName || 'User'

  function isActive(href: string) {
    return href === '/crm' ? pathname === '/crm' : pathname === href || pathname.startsWith(href + '/')
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sidebar-desktop fixed left-0 top-0 bottom-0 z-[100] w-[232px] bg-card border-r border-line flex flex-col">
        {/* Logo */}
        <div className="px-5 pt-6 pb-5 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center text-white shrink-0">
            <Waves size={18} />
          </div>
          <div className="leading-tight">
            <p className="text-[14px] font-bold text-ink m-0 tracking-tight">Gulf Life</p>
            <p className="text-[11px] font-semibold text-ink-3 m-0 uppercase tracking-widest">CRM</p>
          </div>
        </div>

        {/* Prospect / Client segment toggle */}
        <div className="px-3 pb-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#f1f2f7] border border-line">
            {(['prospect', 'client'] as const).map(seg => (
              <button
                key={seg}
                onClick={() => switchSegment(seg)}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors',
                  segment === seg ? 'bg-card text-accent shadow-card' : 'text-ink-3 hover:text-ink-2'
                )}
              >
                {seg === 'prospect' ? 'Prospects' : 'Clients'}
              </button>
            ))}
          </div>
        </div>

        {/* Nav */}
        <nav className="px-3 flex-1 overflow-y-auto">
          {visibleNav.map(item => {
            const active = isActive(item.href)
            const Icon = item.icon
            const badge = item.badge && pendingTodoCount > 0 ? pendingTodoCount : undefined
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl mb-0.5 text-[14px] no-underline transition-colors',
                  active
                    ? 'bg-accent-soft text-accent font-semibold'
                    : 'text-ink-2 font-medium hover:bg-[#f5f6fa] hover:text-ink'
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={17} strokeWidth={active ? 2.4 : 2} />
                  {item.label}
                </span>
                {badge !== undefined && (
                  <span className={cn(
                    'min-w-[19px] h-[19px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center',
                    active ? 'bg-accent text-white' : 'bg-accent-soft text-accent'
                  )}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-line flex items-center gap-2.5">
          <Avatar name={displayName} size={34} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink m-0 truncate">{displayName}</p>
            <p className="text-[11.5px] text-ink-3 m-0 capitalize">{profile?.role === 'owner' ? 'Owner' : 'Team'}</p>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-3 hover:bg-[#f5f6fa] hover:text-bad transition-colors"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* Spacer for fixed sidebar */}
      <div className="sidebar-desktop w-[232px] shrink-0" />

      {/* Mobile bottom nav */}
      <nav
        className="sidebar-mobile hidden fixed bottom-0 left-0 right-0 bg-card border-t border-line z-[100]"
        style={{ padding: '6px 0 max(6px, env(safe-area-inset-bottom))' }}
      >
        <div className="flex justify-around">
          {visibleNav.slice(0, 5).map(item => {
            const active = isActive(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-1 px-3 py-1.5 no-underline relative min-w-[52px]',
                  active ? 'text-accent' : 'text-ink-3'
                )}
              >
                <Icon size={19} strokeWidth={active ? 2.4 : 2} />
                <span className="text-[10px] font-semibold">{item.label}</span>
                {item.badge && pendingTodoCount > 0 && (
                  <span className="absolute top-0.5 right-1.5 min-w-[15px] h-[15px] px-1 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {pendingTodoCount > 99 ? '99+' : pendingTodoCount}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>

      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .sidebar-mobile { display: block !important; }
        }
      `}</style>
    </>
  )
}
