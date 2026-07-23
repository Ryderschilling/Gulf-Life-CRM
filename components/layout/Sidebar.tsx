'use client'

// Navy premium rail — matches the Gulf Life logo (navy wordmark, gold key).
// Gold = active / brand moments; muted slate for everything at rest.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, KanbanSquare, CheckSquare, Inbox, Megaphone, BarChart3, Upload, Settings, LogOut, Waves } from 'lucide-react'
import { AIMark } from '@/components/ai/AIMark'
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
  { href: '/crm/ai', label: 'Gulf AI', icon: AIMark },
  { href: '/crm/import', label: 'Import', icon: Upload },
  { href: '/crm/settings', label: 'Settings', icon: Settings },
]

const GOLD_GRAD = 'linear-gradient(135deg, #c9a96e 0%, #AB9055 55%, #907240 130%)'

export default function Sidebar({ profile, pendingTodoCount = 0, segment = 'prospect' }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  // The layout only computes the badge on full loads (layouts don't re-run on
  // soft navigation), so refetch the live count on every route change.
  const [badgeCount, setBadgeCount] = useState(pendingTodoCount)
  useEffect(() => { setBadgeCount(pendingTodoCount) }, [pendingTodoCount])
  useEffect(() => {
    let cancelled = false
    fetch('/api/todos/count')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d && typeof d.count === 'number') setBadgeCount(d.count) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [pathname])

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
      <aside className="sidebar-desktop fixed left-0 top-0 bottom-0 z-[100] w-[232px] bg-navy-deep flex flex-col">
        {/* Logo */}
        <div className="px-5 pt-6 pb-5 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: GOLD_GRAD }}>
            <Waves size={18} />
          </div>
          <div className="leading-tight">
            <p className="text-[14px] font-bold text-white m-0 tracking-tight">Gulf Life</p>
            <p className="text-[11px] font-semibold text-accent-light m-0 uppercase tracking-widest">Concierge</p>
          </div>
        </div>

        {/* Prospect / Client segment toggle */}
        <div className="px-3 pb-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-black/25 border border-white/10">
            {(['prospect', 'client'] as const).map(seg => (
              <button
                key={seg}
                onClick={() => switchSegment(seg)}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors',
                  segment === seg ? 'text-white shadow-card' : 'text-[#8e97b1] hover:text-white'
                )}
                style={segment === seg ? { background: GOLD_GRAD } : undefined}
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
            const badge = item.badge && badgeCount > 0 ? badgeCount : undefined
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl mb-0.5 text-[14px] no-underline transition-colors',
                  active
                    ? 'bg-[#ab9055]/[0.18] text-accent-light font-semibold'
                    : 'text-[#9ba4bd] font-medium hover:bg-white/[0.06] hover:text-white'
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={17} strokeWidth={active ? 2.4 : 2} />
                  {item.label}
                </span>
                {badge !== undefined && (
                  <span
                    className="min-w-[19px] h-[19px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center text-white"
                    style={{ background: GOLD_GRAD }}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-white/10 flex items-center gap-2.5">
          <Avatar name={displayName} size={34} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-white m-0 truncate">{displayName}</p>
            <p className="text-[11.5px] text-[#8e97b1] m-0 capitalize">{profile?.role === 'owner' ? 'Owner' : 'Team'}</p>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8e97b1] hover:bg-white/10 hover:text-[#f4a69d] transition-colors"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* Spacer for fixed sidebar */}
      <div className="sidebar-desktop w-[232px] shrink-0" />

      {/* Mobile bottom nav */}
      <nav
        className="sidebar-mobile hidden fixed bottom-0 left-0 right-0 bg-navy-deep border-t border-white/10 z-[100]"
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
                  active ? 'text-accent-light' : 'text-[#8e97b1]'
                )}
              >
                <Icon size={19} strokeWidth={active ? 2.4 : 2} />
                <span className="text-[10px] font-semibold">{item.label}</span>
                {item.badge && badgeCount > 0 && (
                  <span
                    className="absolute top-0.5 right-1.5 min-w-[15px] h-[15px] px-1 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
                    style={{ background: GOLD_GRAD }}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
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
