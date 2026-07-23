'use client'

// Overview — segment-aware.
//   prospect → homeowner-LEAD sales view (stat cards + stage filters + stages)
//   client   → current-homeowner directory (no sales stages)
// Matches the WhiteUI reference: light bg, white cards, soft pills.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users, CalendarClock, UserPlus, Trophy, Mail, Phone, Plus, Search, ChevronRight, ChevronLeft } from 'lucide-react'
import type { Lead, LeadStatus } from '@/lib/types'
import type { Segment } from '@/lib/segment'
import { STATUS_CONFIG, ORDERED_STATUSES, formatPhone, timeAgo, followUpState, sourceLabel, cn } from '@/lib/utils'
import { Card, StatCard, Pill, Button, Input, PageHeader, Th, Td, Avatar, EmptyState } from '@/components/ui/kit'
import NewLeadModal from '@/components/leads/NewLeadModal'

const PAGE_SIZE = 25

export default function LeadsOverview({ leads, segment = 'prospect' }: { leads: Lead[]; segment?: Segment }) {
  const router = useRouter()
  const isClient = segment === 'client'
  const [stageFilter, setStageFilter] = useState<LeadStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showNewLead, setShowNewLead] = useState(false)

  // ── Stats ──────────────────────────────────────────────────
  const active = leads.filter(l => !['closed_won', 'closed_lost'].includes(l.status))
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const newThisWeek = leads.filter(l => l.created_at >= weekAgo).length
  const followUpsDue = leads.filter(l => {
    const s = followUpState(l)
    return (s === 'overdue' || s === 'today') && !['closed_won', 'closed_lost'].includes(l.status)
  }).length
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const wonThisMonth = leads.filter(l => l.status === 'closed_won' && new Date(l.updated_at) >= monthStart).length
  const withEmail = leads.filter(l => l.email).length
  const withPhone = leads.filter(l => l.phone).length

  // ── Filtering ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = leads
    if (!isClient && stageFilter !== 'all') list = list.filter(l => l.status === stageFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(l =>
        l.name.toLowerCase().includes(q) ||
        (l.email ?? '').toLowerCase().includes(q) ||
        (l.phone ?? '').includes(q) ||
        (l.company ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [leads, stageFilter, search, isClient])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div>
      <PageHeader
        title={isClient ? 'Homeowners' : 'Overview'}
        subtitle={isClient ? 'Your current managed homeowners' : 'Your homeowner leads, all in one place'}
        right={
          <Button onClick={() => setShowNewLead(true)}>
            <Plus size={16} /> {isClient ? 'New Homeowner' : 'New Lead'}
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isClient ? (
          <>
            <StatCard label="Homeowners" value={leads.length} delta={newThisWeek > 0 ? `+${newThisWeek} this week` : undefined} icon={<Users size={18} />} tint="accent" />
            <StatCard label="New This Week" value={newThisWeek} icon={<UserPlus size={18} />} tint="info" />
            <StatCard label="With Email" value={withEmail} icon={<Mail size={18} />} tint="good" />
            <StatCard label="With Phone" value={withPhone} icon={<Phone size={18} />} tint="good" />
          </>
        ) : (
          <>
            <StatCard label="Active Leads" value={active.length} delta={newThisWeek > 0 ? `+${newThisWeek} this week` : undefined} icon={<Users size={18} />} tint="accent" />
            <StatCard label="Follow-ups Due" value={followUpsDue} deltaGood={followUpsDue === 0} icon={<CalendarClock size={18} />} tint={followUpsDue > 0 ? 'warn' : 'good'} />
            <StatCard label="New This Week" value={newThisWeek} icon={<UserPlus size={18} />} tint="info" />
            <StatCard label="Won This Month" value={wonThisMonth} icon={<Trophy size={18} />} tint="good" />
          </>
        )}
      </div>

      {/* Table */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
          <h2 className="text-[15px] font-semibold text-ink m-0">
            {isClient ? 'All homeowners' : 'All leads'} <span className="text-ink-3 font-medium">· {leads.length}</span>
          </h2>
          <div className="relative w-full sm:w-[260px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search name, email, phone…"
              className="pl-9"
            />
          </div>
        </div>

        {/* Stage filter chips — prospects only */}
        {!isClient && (
          <div className="flex flex-wrap items-center gap-1.5 px-5 pb-4">
            <FilterChip active={stageFilter === 'all'} onClick={() => { setStageFilter('all'); setPage(1) }}>
              All stages
            </FilterChip>
            {ORDERED_STATUSES.map(s => {
              const count = leads.filter(l => l.status === s).length
              return (
                <FilterChip key={s} active={stageFilter === s} onClick={() => { setStageFilter(s); setPage(1) }}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: STATUS_CONFIG[s].hex }} />
                  {STATUS_CONFIG[s].label}
                  <span className="text-ink-3 font-semibold">{count}</span>
                </FilterChip>
              )
            })}
          </div>
        )}

        {/* Table */}
        {pageRows.length === 0 ? (
          <EmptyState
            icon={<Users size={22} />}
            title={leads.length === 0 ? (isClient ? 'No homeowners yet' : 'No leads yet') : 'Nothing matches your filters'}
            subtitle={leads.length === 0
              ? (isClient ? 'Import your homeowner list to get started.' : 'Add your first homeowner lead to get started.')
              : 'Try clearing the search or picking a different stage.'}
            action={leads.length === 0 && !isClient ? <Button onClick={() => setShowNewLead(true)}><Plus size={15} /> Add first lead</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th className="pl-5">{isClient ? 'Homeowner' : 'Lead'}</Th>
                  {!isClient && <Th>Stage</Th>}
                  <Th>Phone</Th>
                  <Th>Source</Th>
                  <Th>Activity</Th>
                  <Th className="pr-5" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map(lead => (
                  <LeadRow key={lead.id} lead={lead} isClient={isClient} onClick={() => router.push(`/crm/leads/${lead.id}`)} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-4">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="flex items-center gap-1 text-[13px] font-semibold text-ink-2 disabled:opacity-40 hover:text-ink"
            >
              <ChevronLeft size={15} /> Prev
            </button>
            <div className="flex items-center gap-1">
              {pageNumbers(safePage, totalPages).map((n, i) =>
                n === '…' ? (
                  <span key={`gap-${i}`} className="px-1.5 text-ink-3 text-[13px]">…</span>
                ) : (
                  <button
                    key={n}
                    onClick={() => setPage(n as number)}
                    className={cn(
                      'min-w-[30px] h-[30px] rounded-lg text-[13px] font-semibold transition-colors',
                      n === safePage ? 'bg-accent text-white' : 'text-ink-2 hover:bg-[#f2f4f7]'
                    )}
                  >
                    {n}
                  </button>
                )
              )}
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="flex items-center gap-1 text-[13px] font-semibold text-ink-2 disabled:opacity-40 hover:text-ink"
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        )}
      </Card>

      <NewLeadModal open={showNewLead} onClose={() => setShowNewLead(false)} relationship={segment} />
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12.5px] font-semibold border transition-colors',
        active
          ? 'bg-accent-soft text-accent border-accent/30'
          : 'bg-card text-ink-2 border-line hover:border-line-strong hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}

function LeadRow({ lead, isClient, onClick }: { lead: Lead; isClient: boolean; onClick: () => void }) {
  const fu = followUpState(lead)
  return (
    <tr onClick={onClick} className="cursor-pointer hover:bg-[#fafbfe] transition-colors group">
      <Td className="pl-5">
        <div className="flex items-center gap-3 min-w-[180px]">
          <Avatar name={lead.name} />
          <div className="min-w-0">
            <p className="m-0 font-semibold text-ink text-[14px] truncate flex items-center gap-1.5">
              {lead.name}
              {!isClient && (fu === 'overdue' || fu === 'today') && (
                <span
                  className={cn('w-2 h-2 rounded-full inline-block pulse-dot', fu === 'overdue' ? 'bg-bad' : 'bg-warn')}
                  title={fu === 'overdue' ? 'Follow-up overdue' : 'Follow-up due today'}
                />
              )}
            </p>
            <p className="m-0 text-[12.5px] text-ink-3 truncate">{lead.email ?? 'No email'}</p>
          </div>
        </div>
      </Td>
      {!isClient && <Td><Pill tone={STATUS_CONFIG[lead.status].tone}>{STATUS_CONFIG[lead.status].label}</Pill></Td>}
      <Td><span className="text-ink-2 whitespace-nowrap">{formatPhone(lead.phone)}</span></Td>
      <Td><span className="text-ink-2 whitespace-nowrap">{sourceLabel(lead.source)}</span></Td>
      <Td>
        <span className="text-[13px] text-ink-3 whitespace-nowrap">
          {lead.last_contacted_at ? `Contacted ${timeAgo(lead.last_contacted_at)}` : 'Never contacted'}
        </span>
      </Td>
      <Td className="pr-5 text-right">
        <ChevronRight size={16} className="text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity inline-block" />
      </Td>
    </tr>
  )
}

function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '…')[] = [1]
  if (current > 3) pages.push('…')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}
