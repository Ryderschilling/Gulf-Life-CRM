'use client'

// Kanban board for owner leads — drag between stages.
// Stage changes log an activity automatically.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Phone, Mail, CalendarClock } from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import type { Lead, LeadStatus, Profile } from '@/lib/types'
import { LEAD_STATUS_LABELS } from '@/lib/types'
import { STATUS_CONFIG, ORDERED_STATUSES, timeAgo, followUpState, leadDisplayName, cn } from '@/lib/utils'
import { PageHeader, Button, Avatar, Pill, Segmented } from '@/components/ui/kit'
import NewLeadModal from '@/components/leads/NewLeadModal'

type OwnerFilter = 'all' | 'mine' | 'unassigned'

export default function PipelineBoard({ initialLeads, team = [], meId = '' }: { initialLeads: Lead[]; team?: Profile[]; meId?: string }) {
  const supabase = createClient()
  const router = useRouter()

  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<LeadStatus | null>(null)
  const [showNewLead, setShowNewLead] = useState(false)
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')

  useEffect(() => { setLeads(initialLeads) }, [initialLeads])

  const teamById = new Map(team.map(p => [p.id, p]))
  const assigneeName = (id: string | null) => {
    const n = id ? teamById.get(id)?.full_name?.trim() : null
    if (!n) return null
    return n.includes('@') ? n.split('@')[0] : n.split(' ')[0]
  }

  const visibleLeads = leads.filter(l =>
    ownerFilter === 'all' ? true :
    ownerFilter === 'mine' ? l.assigned_to === meId :
    !l.assigned_to
  )

  const columns = ORDERED_STATUSES.map(status => ({
    status,
    leads: visibleLeads.filter(l => l.status === status),
  }))

  function handleDragStart(e: React.DragEvent, leadId: string) {
    setDraggingId(leadId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('leadId', leadId)
  }

  async function handleDrop(e: React.DragEvent, newStatus: LeadStatus) {
    e.preventDefault()
    setDragOverCol(null)
    const leadId = e.dataTransfer.getData('leadId')
    if (!leadId) return
    const lead = leads.find(l => l.id === leadId)
    if (!lead || lead.status === newStatus) { setDraggingId(null); return }

    const prevStatus = lead.status
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l))
    setDraggingId(null)

    try {
      const { error } = await supabase
        .from('leads')
        .update({ status: newStatus })
        .eq('id', leadId)
      if (error) throw error

      await fetch(`/api/leads/${leadId}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'status_change',
          description: `Moved from ${LEAD_STATUS_LABELS[prevStatus]} → ${LEAD_STATUS_LABELS[newStatus]}`,
          metadata: { from_status: prevStatus, to_status: newStatus },
        }),
      })
      // Keep the lead's Stage tag current in Mailchimp (fire-and-forget)
      fetch('/api/mailchimp/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'outstanding' }) }).catch(() => {})
      router.refresh()
    } catch {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: prevStatus } : l))
      toast.error('Failed to move lead')
    }
  }

  return (
    <div>
      <PageHeader
        title="Pipeline"
        subtitle="Drag owner leads between stages"
        right={
          <>
            <Segmented<OwnerFilter>
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'mine', label: 'My leads', count: leads.filter(l => l.assigned_to === meId).length },
                { value: 'unassigned', label: 'Unassigned', count: leads.filter(l => !l.assigned_to).length },
              ]}
              value={ownerFilter}
              onChange={setOwnerFilter}
            />
            <Button onClick={() => setShowNewLead(true)}><Plus size={16} /> New Lead</Button>
          </>
        }
      />

      <div className="flex gap-3.5 overflow-x-auto items-start pb-4 -mx-1 px-1">
        {columns.map(({ status, leads: colLeads }) => (
          <div
            key={status}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(status) }}
            onDragLeave={() => setDragOverCol(c => (c === status ? null : c))}
            onDrop={e => handleDrop(e, status)}
            className={cn(
              'w-[248px] min-w-[248px] shrink-0 rounded-card border transition-colors p-3',
              dragOverCol === status ? 'border-accent bg-accent-soft/50' : 'border-line bg-[#efeade]'
            )}
          >
            {/* Column header */}
            <div className="flex items-center justify-between mb-2.5 px-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_CONFIG[status].hex }} />
                <span className="text-[12px] font-bold text-ink-2 uppercase tracking-wider">
                  {STATUS_CONFIG[status].label}
                </span>
              </div>
              <span className="text-[11.5px] font-bold text-ink-3 bg-card border border-line rounded-full px-2 py-0.5">
                {colLeads.length}
              </span>
            </div>

            {/* Cards */}
            <div className="min-h-[56px] flex flex-col gap-2">
              {colLeads.map(lead => {
                const fu = followUpState(lead)
                return (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={e => handleDragStart(e, lead.id)}
                    onDragEnd={() => { setDraggingId(null); setDragOverCol(null) }}
                    onClick={() => router.push(`/crm/leads/${lead.id}`)}
                    className={cn(
                      'bg-card border border-line rounded-xl p-3 cursor-pointer shadow-card hover:border-accent/40 transition-all',
                      draggingId === lead.id && 'opacity-40'
                    )}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <Avatar name={lead.name} size={28} />
                      <p className="m-0 text-[13.5px] font-semibold text-ink truncate flex-1">{leadDisplayName(lead.name)}</p>
                    </div>
                    {lead.property_interest && (
                      <p className="m-0 text-[12px] text-ink-2 truncate mb-1.5">{lead.property_interest}</p>
                    )}
                    <div className="flex items-center gap-2 text-ink-3">
                      {lead.phone && <Phone size={12} />}
                      {lead.email && <Mail size={12} />}
                      {assigneeName(lead.assigned_to) && (
                        <span className="text-[11px] font-semibold text-accent bg-accent-soft rounded-full px-1.5 py-0.5" title={`Assigned to ${assigneeName(lead.assigned_to)}`}>
                          {assigneeName(lead.assigned_to)}
                        </span>
                      )}
                      <span className="text-[11.5px] ml-auto">
                        {lead.last_contacted_at ? timeAgo(lead.last_contacted_at) : 'No contact yet'}
                      </span>
                    </div>
                    {fu && fu !== 'upcoming' && (
                      <div className="mt-2">
                        <Pill tone={fu === 'overdue' ? 'red' : 'yellow'} className="text-[11px] px-2 py-0.5">
                          <CalendarClock size={11} />
                          {fu === 'overdue' ? 'Follow-up overdue' : 'Follow up today'}
                        </Pill>
                      </div>
                    )}
                  </div>
                )
              })}
              {colLeads.length === 0 && (
                <div className="py-4 text-center text-[11.5px] text-ink-3 border border-dashed border-line-strong rounded-xl">
                  Drop here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <NewLeadModal open={showNewLead} onClose={() => setShowNewLead(false)} />
    </div>
  )
}
