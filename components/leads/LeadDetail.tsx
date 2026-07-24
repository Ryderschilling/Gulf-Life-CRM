'use client'

// Lead detail — profile header, quick actions, timeline, notes,
// properties, and everything the CSV brought in.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Mail, MessageSquare, Phone, CalendarClock, RefreshCw,
  StickyNote, ArrowRightLeft, Upload, Home, Plus, Trash2, CircleCheck, PenLine, Zap, UserCheck
} from 'lucide-react'
import { AIMark } from '@/components/ai/AIMark'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import type { Lead, LeadActivity, LeadAddress, LeadNote, LeadStatus, SmsMessage, EmailDraft, Profile } from '@/lib/types'
import { LEAD_STATUS_LABELS } from '@/lib/types'
import { STATUS_CONFIG, ORDERED_STATUSES, formatPhone, formatDate, formatDateTime, timeAgo, sourceLabel, leadDisplayName, isPhoneName, cn } from '@/lib/utils'
import { localTimeToISO } from '@/lib/dates'
import { Card, CardHeader, Button, Pill, Avatar, Field, Input, Textarea, Modal, Select } from '@/components/ui/kit'
import ConversationCard from '@/components/leads/ConversationCard'

interface Props {
  lead: Lead
  activities: LeadActivity[]
  notes: LeadNote[]
  addresses: LeadAddress[]
  smsMessages: SmsMessage[]
  pendingDrafts: EmailDraft[]
  team?: Profile[]
  meId?: string
}

function memberFirstName(p: Profile | undefined): string {
  const n = p?.full_name?.trim()
  if (!n) return 'Someone'
  return n.includes('@') ? n.split('@')[0] : n.split(' ')[0]
}

export default function LeadDetail({ lead, activities, notes, addresses, smsMessages, pendingDrafts, team = [], meId = '' }: Props) {
  const router = useRouter()
  const supabase = createClient()

  // id → profile, for "who did what" on the timeline + assignment
  const teamById = new Map(team.map(p => [p.id, p]))

  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [smsOpen, setSmsOpen] = useState(false)
  const [smsText, setSmsText] = useState('')
  const [sendingSms, setSendingSms] = useState(false)
  const [addingAddress, setAddingAddress] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [followUpDate, setFollowUpDate] = useState(lead.next_follow_up_at?.slice(0, 10) ?? '')

  // ── Actions ────────────────────────────────────────────────
  async function changeStage(newStatus: LeadStatus) {
    if (newStatus === lead.status) return
    const { error } = await supabase.from('leads').update({ status: newStatus }).eq('id', lead.id)
    if (error) { toast.error('Failed to update stage'); return }
    await fetch(`/api/leads/${lead.id}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'status_change',
        description: `Moved from ${LEAD_STATUS_LABELS[lead.status]} → ${LEAD_STATUS_LABELS[newStatus]}`,
        metadata: { from_status: lead.status, to_status: newStatus },
      }),
    })
    // Keep the lead's Stage tag current in Mailchimp (fire-and-forget)
    fetch('/api/mailchimp/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'outstanding' }) }).catch(() => {})
    toast.success(`Moved to ${LEAD_STATUS_LABELS[newStatus]}`)
    router.refresh()
  }

  async function addNote() {
    if (!noteText.trim()) return
    setSavingNote(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('lead_notes').insert({
        lead_id: lead.id, user_id: user?.id ?? null, body: noteText.trim(),
      })
      if (error) throw error
      await supabase.from('lead_activities').insert({
        lead_id: lead.id, user_id: user?.id ?? null, type: 'note', body: noteText.trim(),
      })
      setNoteText('')
      router.refresh()
    } catch {
      toast.error('Failed to save note')
    } finally {
      setSavingNote(false)
    }
  }

  async function draftEmail() {
    if (!lead.email) { toast.error(`${lead.name} has no email on file`); return }
    setDrafting(true)
    try {
      const res = await fetch('/api/emails/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, trigger_type: 'manual' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast.success('Draft ready — review it below or in To-Do')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }

  async function sendSms() {
    if (!smsText.trim()) return
    setSendingSms(true)
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, body: smsText.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast.success('Text sent')
      setSmsOpen(false)
      setSmsText('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSendingSms(false)
    }
  }

  async function syncMailchimp() {
    setSyncing(true)
    try {
      const res = await fetch('/api/mailchimp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: [lead.id] }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (data.synced > 0) toast.success('Synced to Mailchimp')
      else throw new Error(data.failures?.[0]?.error ?? 'Sync failed')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function changeAssignee(newId: string) {
    const value = newId || null
    if (value === (lead.assigned_to ?? null)) return
    const { error } = await supabase.from('leads').update({ assigned_to: value }).eq('id', lead.id)
    if (error) { toast.error('Failed to assign'); return }
    const who = value ? memberFirstName(teamById.get(value)) : null
    await supabase.from('lead_activities').insert({
      lead_id: lead.id, user_id: meId || null, type: 'assigned',
      body: who ? `Assigned to ${who}` : 'Unassigned',
      metadata: { assigned_to: value },
    })
    toast.success(who ? `Assigned to ${who}` : 'Unassigned')
    router.refresh()
  }

  async function saveFollowUp() {
    // Store as 9am CRM-local on the chosen calendar day (lib/dates.ts)
    const value = followUpDate ? localTimeToISO(followUpDate) : null
    const { error } = await supabase.from('leads').update({ next_follow_up_at: value }).eq('id', lead.id)
    if (error) { toast.error('Failed to save'); return }
    toast.success(value ? 'Follow-up scheduled' : 'Follow-up cleared')
    setFollowUpOpen(false)
    router.refresh()
  }

  // ── Timeline (activities + sms merged) ─────────────────────
  // The "Lead created" event always mirrors the Details card's "Added" date —
  // both derive from leads.created_at. (Seeded/backdated rows would otherwise
  // show the seeding time; leads without a stored 'created' activity, like
  // inbound-SMS auto-leads, get one synthesized.)
  const createdActivity = activities.find(a => a.type === 'created')
  const createdEvent: LeadActivity = createdActivity
    ? { ...createdActivity, created_at: lead.created_at }
    : { id: `created-${lead.id}`, lead_id: lead.id, user_id: null, type: 'created', body: 'Lead created', metadata: null, created_at: lead.created_at }
  const timeline = [...activities.filter(a => a.type !== 'created'), createdEvent]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const displayName = leadDisplayName(lead.name)
  const firstName = isPhoneName(lead.name) ? displayName : lead.name.split(' ')[0]

  const extraEntries = Object.entries(lead.extra ?? {}).filter(([, v]) => v)

  return (
    <div>
      {/* Back */}
      <Link href="/crm" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-2 hover:text-ink no-underline mb-4">
        <ArrowLeft size={15} /> All leads
      </Link>

      {/* Header card */}
      <Card className="px-6 py-5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar name={lead.name} size={52} />
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-[20px] font-bold text-ink m-0 tracking-tight">{displayName}</h1>
                {lead.mailchimp_status === 'synced' && <Pill tone="yellow">Mailchimp ✓</Pill>}
                {lead.mailchimp_status === 'failed' && <Pill tone="red">Mailchimp sync failed</Pill>}
              </div>
              <p className="text-[13px] text-ink-2 m-0 mt-1">
                {lead.email ?? 'No email'} · {formatPhone(lead.phone)} · {sourceLabel(lead.source)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-ink-3 uppercase tracking-wide">Assigned</span>
              <Select value={lead.assigned_to ?? ''} onChange={e => changeAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {team.map(p => (
                  <option key={p.id} value={p.id}>
                    {memberFirstName(p)}{p.id === meId ? ' (me)' : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-ink-3 uppercase tracking-wide">Stage</span>
              <Select value={lead.status} onChange={e => changeStage(e.target.value as LeadStatus)}>
                {ORDERED_STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-line">
          <Button size="sm" className="ai-btn" onClick={draftEmail} loading={drafting} disabled={!lead.email}>
            <AIMark size={14} variant="white" thinking={drafting} /> AI Email Draft
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setSmsOpen(true)} disabled={!lead.phone}>
            <MessageSquare size={14} /> Text
          </Button>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="no-underline">
              <Button size="sm" variant="secondary"><Phone size={14} /> Call</Button>
            </a>
          )}
          <Button size="sm" variant="secondary" onClick={() => setFollowUpOpen(true)}>
            <CalendarClock size={14} /> {lead.next_follow_up_at ? `Follow-up ${formatDate(lead.next_follow_up_at)}` : 'Set follow-up'}
          </Button>
          <Button size="sm" variant="secondary" onClick={syncMailchimp} loading={syncing} disabled={!lead.email}>
            <RefreshCw size={14} /> Sync Mailchimp
          </Button>
        </div>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        {/* ── Left: timeline ── */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Pending drafts */}
          {pendingDrafts.length > 0 && (
            <Card>
              <CardHeader title="Drafts waiting for review" subtitle="Gulf AI wrote these — edit and send from To-Do" />
              <div className="px-6 pb-5 flex flex-col gap-2">
                {pendingDrafts.map(d => (
                  <Link key={d.id} href="/crm/todo" className="no-underline">
                    <div className="border border-line rounded-xl px-4 py-3 hover:border-accent/40 transition-colors">
                      <p className="text-[13.5px] font-semibold text-ink m-0 flex items-center gap-2">
                        <PenLine size={13} className="text-accent" /> {d.subject}
                      </p>
                      <p className="text-[12.5px] text-ink-3 m-0 mt-0.5 truncate">{d.body.slice(0, 110)}…</p>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {/* Note composer */}
          <Card className="px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-warn-soft text-warn flex items-center justify-center shrink-0 mt-0.5">
                <StickyNote size={15} />
              </div>
              <div className="flex-1">
                <Textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder={`Add a note about ${firstName}…`}
                  rows={2}
                  className="min-h-[56px]"
                />
                <div className="flex justify-end mt-2">
                  <Button size="sm" onClick={addNote} loading={savingNote} disabled={!noteText.trim()}>Save note</Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader title="Timeline" subtitle={`${timeline.length} events`} />
            <div className="px-6 pb-6">
              {timeline.length === 0 && (
                <p className="text-[13px] text-ink-3 text-center py-6 m-0">No activity yet</p>
              )}
              <div className="flex flex-col">
                {timeline.map((a, i) => (
                  <TimelineItem key={a.id} activity={a} isLast={i === timeline.length - 1} byName={a.user_id ? memberFirstName(teamById.get(a.user_id)) : undefined} />
                ))}
              </div>
            </div>
          </Card>

          {/* Conversation — the lead's inbox, embedded */}
          <ConversationCard lead={lead} smsMessages={smsMessages} activities={activities} />
        </div>

        {/* ── Right: details ── */}
        <div className="flex flex-col gap-4">
          {/* Details */}
          <Card className="px-5 py-4">
            <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wide m-0 mb-3">Details</p>
            <DetailRow label="Email" value={lead.email} />
            <DetailRow label="Phone" value={formatPhone(lead.phone)} />
            <DetailRow label="Company" value={lead.company} />
            <DetailRow label="Property interest" value={lead.property_interest} />
            <DetailRow label="Source" value={sourceLabel(lead.source)} />
            <DetailRow label="Last contacted" value={lead.last_contacted_at ? timeAgo(lead.last_contacted_at) : 'Never'} />
            <DetailRow label="Added" value={formatDate(lead.created_at)} last />
          </Card>

          {/* Properties / addresses */}
          <Card className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wide m-0">
                Properties
              </p>
              <button onClick={() => setAddingAddress(true)} className="text-accent hover:text-accent-dark">
                <Plus size={15} />
              </button>
            </div>
            {addresses.length === 0 && <p className="text-[12.5px] text-ink-3 m-0">None on file</p>}
            <div className="flex flex-col gap-2.5">
              {addresses.map(a => (
                <AddressRow key={a.id} address={a} onDeleted={() => router.refresh()} />
              ))}
            </div>
          </Card>

          {/* Notes */}
          {notes.length > 0 && (
            <Card className="px-5 py-4">
              <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wide m-0 mb-3">Notes</p>
              <div className="flex flex-col gap-2.5">
                {notes.slice(0, 8).map(n => (
                  <div key={n.id} className="bg-warn-soft/50 border border-warn/10 rounded-lg px-3 py-2.5">
                    <p className="text-[12.5px] text-ink m-0 whitespace-pre-wrap">{n.body}</p>
                    <p className="text-[11px] text-ink-3 m-0 mt-1">
                      {n.user_id && teamById.has(n.user_id) ? `${memberFirstName(teamById.get(n.user_id))} · ` : ''}{timeAgo(n.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Extra CSV fields */}
          {extraEntries.length > 0 && (
            <Card className="px-5 py-4">
              <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wide m-0 mb-3 flex items-center gap-1.5">
                <Upload size={12} /> More from import
              </p>
              {extraEntries.map(([k, v], i) => (
                <DetailRow key={k} label={k} value={String(v)} last={i === extraEntries.length - 1} />
              ))}
            </Card>
          )}

        </div>
      </div>

      {/* SMS modal */}
      <Modal open={smsOpen} onClose={() => setSmsOpen(false)} title={`Text ${firstName}`}>
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-ink-2 m-0">To {formatPhone(lead.phone)} via your Quo number</p>
          <Textarea
            value={smsText}
            onChange={e => setSmsText(e.target.value)}
            placeholder="Keep it short and personal…"
            rows={4}
            autoFocus
          />
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-ink-3">{smsText.length} characters</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setSmsOpen(false)}>Cancel</Button>
              <Button onClick={sendSms} loading={sendingSms} disabled={!smsText.trim()}>
                <MessageSquare size={14} /> Send text
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Follow-up modal */}
      <Modal open={followUpOpen} onClose={() => setFollowUpOpen(false)} title="Next follow-up">
        <div className="flex flex-col gap-4">
          <Field label="Date">
            <Input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} />
          </Field>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => { setFollowUpDate(''); }}>Clear</Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setFollowUpOpen(false)}>Cancel</Button>
              <Button onClick={saveFollowUp}>Save</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Add address modal */}
      <AddAddressModal
        open={addingAddress}
        onClose={() => setAddingAddress(false)}
        leadId={lead.id}
        hasPrimary={addresses.some(a => a.is_primary)}
        onSaved={() => { setAddingAddress(false); router.refresh() }}
      />
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────

const ACTIVITY_ICON: Record<string, { icon: React.ReactNode; cls: string }> = {
  note: { icon: <StickyNote size={13} />, cls: 'bg-warn-soft text-warn' },
  email_sent: { icon: <Mail size={13} />, cls: 'bg-info-soft text-info' },
  email_received: { icon: <Mail size={13} />, cls: 'bg-info-soft text-info' },
  sms_sent: { icon: <MessageSquare size={13} />, cls: 'bg-good-soft text-good' },
  sms_received: { icon: <MessageSquare size={13} />, cls: 'bg-good-soft text-good' },
  call: { icon: <Phone size={13} />, cls: 'bg-grape-soft text-grape' },
  status_change: { icon: <ArrowRightLeft size={13} />, cls: 'bg-accent-soft text-accent' },
  ai_draft: { icon: <AIMark size={13} />, cls: 'bg-grape-soft text-grape' },
  ai_action: { icon: <Zap size={13} />, cls: 'bg-grape-soft text-grape' },
  created: { icon: <CircleCheck size={13} />, cls: 'bg-good-soft text-good' },
  imported: { icon: <Upload size={13} />, cls: 'bg-accent-soft text-accent' },
  mailchimp_sync: { icon: <RefreshCw size={13} />, cls: 'bg-warn-soft text-warn' },
  assigned: { icon: <UserCheck size={13} />, cls: 'bg-accent-soft text-accent' },
}

function TimelineItem({ activity, isLast, byName }: { activity: LeadActivity; isLast: boolean; byName?: string }) {
  const cfg = ACTIVITY_ICON[activity.type] ?? ACTIVITY_ICON.note
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', cfg.cls)}>
          {cfg.icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-line my-1" />}
      </div>
      <div className={cn('min-w-0 flex-1', !isLast && 'pb-4')}>
        <p className="text-[13.5px] text-ink m-0 whitespace-pre-wrap break-words">{activity.body}</p>
        <p className="text-[11.5px] text-ink-3 m-0 mt-0.5">
          {formatDateTime(activity.created_at)}{byName ? ` · ${byName}` : ''}
        </p>
      </div>
    </div>
  )
}

function DetailRow({ label, value, last }: { label: string; value: string | null | undefined; last?: boolean }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 py-2', !last && 'border-b border-line')}>
      <span className="text-[12.5px] text-ink-3 font-medium capitalize shrink-0">{label}</span>
      <span className="text-[13px] text-ink font-medium text-right break-words min-w-0">{value || '—'}</span>
    </div>
  )
}

function AddressRow({ address, onDeleted }: { address: LeadAddress; onDeleted: () => void }) {
  const supabase = createClient()
  const line = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ')
  async function remove() {
    await supabase.from('lead_addresses').delete().eq('id', address.id)
    onDeleted()
  }
  return (
    <div className="group flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-info-soft text-info flex items-center justify-center shrink-0">
        <Home size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold text-ink-2 m-0">{address.label}{address.is_primary ? ' · Primary' : ''}</p>
        <p className="text-[12.5px] text-ink m-0">{line || 'Address pending'}</p>
        {address.notes && <p className="text-[11.5px] text-ink-3 m-0">{address.notes}</p>}
      </div>
      <button onClick={remove} className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad transition-opacity shrink-0">
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function AddAddressModal({ open, onClose, leadId, hasPrimary, onSaved }: {
  open: boolean; onClose: () => void; leadId: string; hasPrimary: boolean; onSaved: () => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ label: 'Property', street: '', city: '', state: 'FL', zip: '', notes: '' })

  async function save() {
    if (!form.street.trim() && !form.city.trim()) { toast.error('Add at least a street or city'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('lead_addresses').insert({
        lead_id: leadId,
        label: form.label.trim() || 'Property',
        street: form.street.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        notes: form.notes.trim() || null,
        is_primary: !hasPrimary,
      })
      if (error) throw error
      toast.success('Added')
      setForm({ label: 'Property', street: '', city: '', state: 'FL', zip: '', notes: '' })
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add property">
      <div className="flex flex-col gap-3">
        <Field label="Label">
          <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Beach House" />
        </Field>
        <Field label="Street">
          <Input value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))} placeholder="123 Gulf Shore Dr" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="City">
            <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Santa Rosa Beach" />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
          </Field>
          <Field label="Zip">
            <Input value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} placeholder="32459" />
          </Field>
        </div>
        <Field label="Notes">
          <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. 4BR, private pool" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Add</Button>
        </div>
      </div>
    </Modal>
  )
}
