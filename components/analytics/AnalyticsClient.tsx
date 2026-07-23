'use client'

// Analytics — sales pipeline health for homeowner leads. Pure SVG charts,
// same soft WhiteUI look as the rest of the app.

import { useMemo } from 'react'
import { TrendingUp, Target, Trophy, Users } from 'lucide-react'
import type { Lead } from '@/lib/types'
import { STATUS_CONFIG, ORDERED_STATUSES, isWonThisMonth, sourceLabel } from '@/lib/utils'
import { Card, CardHeader, StatCard, PageHeader, EmptyState } from '@/components/ui/kit'

interface Props {
  leads: Lead[]
  activities: { type: string; created_at: string }[]
}

const CHART_COLORS = ['#a08447', '#2B354E', '#f79009', '#12b76a', '#7d5b8f', '#f04438', '#9aa1b0']

export default function AnalyticsClient({ leads, activities }: Props) {
  // Server already scopes to homeowner (owner) leads.
  const owners = leads

  // ── Core stats ─────────────────────────────────────────────
  const won = owners.filter(l => l.status === 'closed_won').length
  const closed = won + owners.filter(l => l.status === 'closed_lost').length
  const winRate = closed > 0 ? Math.round((won / closed) * 100) : null
  const active = owners.filter(l => !['closed_won', 'closed_lost'].includes(l.status)).length

  // Shared helper (lib/utils.ts) — same calc as the Overview stat card, always in sync
  const wonThisMonth = owners.filter(isWonThisMonth).length

  // ── Leads per week (8 weeks) ───────────────────────────────
  const weeklyData = useMemo(() => {
    const weeks: { label: string; count: number }[] = []
    for (let w = 7; w >= 0; w--) {
      const start = new Date(Date.now() - (w + 1) * 7 * 86400000)
      const end = new Date(Date.now() - w * 7 * 86400000)
      const label = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      weeks.push({
        label,
        count: owners.filter(l => { const d = new Date(l.created_at); return d >= start && d < end }).length,
      })
    }
    return weeks
  }, [owners])

  // ── Stage distribution ─────────────────────────────────────
  const stageData = ORDERED_STATUSES.map(s => ({
    status: s,
    label: STATUS_CONFIG[s].label,
    hex: STATUS_CONFIG[s].hex,
    count: owners.filter(l => l.status === s).length,
  }))
  const maxStage = Math.max(...stageData.map(d => d.count), 1)

  // ── Sources ────────────────────────────────────────────────
  const sourceData = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of owners) {
      const key = l.source ?? 'other'
      counts[key] = (counts[key] ?? 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([source, count], i) => ({ source, count, color: CHART_COLORS[i % CHART_COLORS.length] }))
  }, [owners])

  // ── Outreach activity (4 weeks) ────────────────────────────
  const outreachData = useMemo(() => {
    const OUTREACH = ['email_sent', 'sms_sent', 'call']
    const weeks: { label: string; count: number }[] = []
    for (let w = 3; w >= 0; w--) {
      const start = new Date(Date.now() - (w + 1) * 7 * 86400000)
      const end = new Date(Date.now() - w * 7 * 86400000)
      weeks.push({
        label: w === 0 ? 'This week' : `${w}w ago`,
        count: activities.filter(a => {
          const d = new Date(a.created_at)
          return OUTREACH.includes(a.type) && d >= start && d < end
        }).length,
      })
    }
    return weeks
  }, [activities])

  if (leads.length === 0) {
    return (
      <div>
        <PageHeader title="Analytics" subtitle="Homeowner pipeline performance" />
        <Card>
          <EmptyState
            icon={<TrendingUp size={22} />}
            title="No data yet"
            subtitle="Add homeowner leads and this page fills itself in."
          />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Homeowner pipeline performance" />

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Leads" value={active} icon={<Target size={17} />} tint="accent" />
        <StatCard label="Win Rate" value={winRate != null ? `${winRate}%` : '—'} icon={<Trophy size={17} />} tint="good" />
        <StatCard label="Won This Month" value={wonThisMonth} icon={<TrendingUp size={17} />} tint="info" />
        <StatCard label="Total Leads" value={owners.length} icon={<Users size={17} />} tint="grape" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        {/* New leads per week */}
        <Card>
          <CardHeader title="New leads per week" subtitle="Homeowner leads added, last 8 weeks" />
          <div className="px-6 pb-6">
            <SimpleBars data={weeklyData} color="#a08447" />
          </div>
        </Card>

        {/* Pipeline by stage */}
        <Card>
          <CardHeader title="Pipeline by stage" subtitle="Where leads sit right now" />
          <div className="px-6 pb-6 flex flex-col gap-3">
            {stageData.map(d => (
              <div key={d.status} className="flex items-center gap-3">
                <span className="text-[12.5px] font-semibold text-ink-2 w-[76px] shrink-0">{d.label}</span>
                <div className="flex-1 h-[26px] bg-[#f0ebe1] rounded-lg overflow-hidden">
                  <div
                    className="h-full rounded-lg transition-all flex items-center justify-end pr-2"
                    style={{ width: `${Math.max((d.count / maxStage) * 100, d.count > 0 ? 8 : 0)}%`, background: d.hex }}
                  >
                    {d.count > 0 && <span className="text-[11px] font-bold text-white">{d.count}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Sources donut */}
        <Card>
          <CardHeader title="Lead sources" subtitle="Where your leads come from" />
          <div className="px-6 pb-6 flex items-center gap-5">
            <Donut data={sourceData.map(s => ({ value: s.count, color: s.color }))} total={owners.length} />
            <div className="flex flex-col gap-2 min-w-0">
              {sourceData.map(s => (
                <div key={s.source} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-ink-2 font-medium truncate">{sourceLabel(s.source)}</span>
                  <span className="text-ink-3 font-semibold ml-auto">{s.count}</span>
                </div>
              ))}
              {sourceData.length === 0 && <p className="text-[12.5px] text-ink-3 m-0">No leads yet</p>}
            </div>
          </div>
        </Card>

        {/* Outreach */}
        <Card>
          <CardHeader title="Outreach sent" subtitle="Emails, texts & calls logged" />
          <div className="px-6 pb-6">
            {outreachData.every(d => d.count === 0) ? (
              <p className="text-[12.5px] text-ink-3 m-0 py-8 text-center">Send emails, texts, or log calls and this fills in</p>
            ) : (
              <SimpleBars data={outreachData} color="#2B354E" />
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

// ── Chart primitives (SVG, no deps) ───────────────────────────

function SimpleBars({ data, color }: { data: { label: string; count: number }[]; color: string }) {
  const H = 150, PAD_B = 22
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <svg width="100%" height={H} viewBox={`0 0 300 ${H}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
      {data.map((d, i) => {
        const w = 300 / data.length
        const x = i * w
        const barW = Math.min(30, w * 0.5)
        const chartH = H - PAD_B - 12
        const h = d.count > 0 ? Math.max((d.count / max) * chartH, 4) : 0
        return (
          <g key={i}>
            {h > 0 && <rect x={x + w / 2 - barW / 2} y={H - PAD_B - h} width={barW} height={h} rx={4} fill={color} />}
            {d.count > 0 && (
              <text x={x + w / 2} y={H - PAD_B - h - 5} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#5d6577" fontFamily="Inter, sans-serif">{d.count}</text>
            )}
            <text x={x + w / 2} y={H - 6} textAnchor="middle" fontSize={9.5} fill="#9aa1b0" fontFamily="Inter, sans-serif">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Donut({ data, total }: { data: { value: number; color: string }[]; total: number }) {
  const R = 52, STROKE = 16, C = 2 * Math.PI * R
  const sum = data.reduce((s, d) => s + d.value, 0) || 1
  let offset = 0
  return (
    <svg width={140} height={140} viewBox="0 0 140 140" className="shrink-0">
      <circle cx={70} cy={70} r={R} fill="none" stroke="#f0ebe1" strokeWidth={STROKE} />
      {data.map((d, i) => {
        const frac = d.value / sum
        const dash = frac * C
        const el = (
          <circle
            key={i}
            cx={70} cy={70} r={R}
            fill="none"
            stroke={d.color}
            strokeWidth={STROKE}
            strokeDasharray={`${dash} ${C - dash}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
            transform="rotate(-90 70 70)"
          />
        )
        offset += dash
        return el
      })}
      <text x={70} y={66} textAnchor="middle" fontSize={22} fontWeight={800} fill="#1f2941" fontFamily="Inter, sans-serif">{total}</text>
      <text x={70} y={84} textAnchor="middle" fontSize={10} fontWeight={600} fill="#9aa1b0" fontFamily="Inter, sans-serif">leads</text>
    </svg>
  )
}
