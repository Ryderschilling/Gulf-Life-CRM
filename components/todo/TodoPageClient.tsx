'use client'

// ============================================================
// To-Do page — ONE ranked queue: every single thing that needs
// attention, in one place. Sources, in priority order:
//   1. Inbound texts/emails waiting on a reply  ("Needs reply")
//   2. Briefing priority leads                  (Gulf AI)
//   3. AI email drafts pending review
//   4. Leads whose follow-up date has arrived
//   5. Quick tasks
// Every row has exactly one action button that opens a focused
// popup (ActionModals.tsx) which finishes the whole job. When an
// action completes, the next follow-up is scheduled silently by
// stage cadence — no questions — so the queue drains itself and
// refills when leads come due again.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Plus, Mail, Phone, MessageSquare, ChevronDown, ChevronUp,
  ArrowUpRight, Archive, Check, CheckSquare, Sparkles,
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { Todo, EmailDraft, Lead, DailyDigest } from '@/lib/types'
import { leadDisplayName, timeAgo, cn } from '@/lib/utils'
import { followUpStatus, daysOverdue } from '@/lib/dates'
import { Card, Button, Pill, Avatar, Input, EmptyState } from '@/components/ui/kit'
import { AIMark, AIThinking, AIBadge } from '@/components/ai/AIMark'
import {
  TextActionModal, EmailActionModal, CallActionModal, type QueueLead,
} from './ActionModals'

/** A conversation where the last message is THEIRS — computed server-side. */
export interface NeedsReplyItem {
  lead: Lead
  channel: 'sms' | 'email'
  body: string
  at: string
}

interface Props {
  todos: Todo[]
  drafts: EmailDraft[]
  followUps: Lead[]
  needsReply: NeedsReplyItem[]
  priorityLeadRecords: Lead[]
  initialDigest: DailyDigest | null
}

interface QueueEntry {
  lead: QueueLead
  draft: EmailDraft | null
  isDraftRow: boolean
}

// ── Build the unified queue ─────────────────────────────────

function inferAction(suggested: string | null, email: string | null, phone: string | null): QueueLead['action'] {
  const s = (suggested ?? '').toLowerCase()
  if (s.includes('text') && phone) return 'text'
  if (s.includes('call') && phone) return 'call'
  if (s.includes('email') && email) return 'email'
  if (phone) return 'text'
  if (email) return 'email'
  return 'none'
}

function snippet(text: string, max = 90): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function buildQueue(
  digest: DailyDigest | null,
  followUps: Lead[],
  needsReply: NeedsReplyItem[],
  priorityLeadRecords: Lead[],
  drafts: EmailDraft[],
): { queue: QueueEntry[]; handled: QueueLead[]; extraActionItems: string[] } {
  const recById = new Map(priorityLeadRecords.map(l => [l.id, l]))
  const followById = new Map(followUps.map(l => [l.id, l]))
  const generatedAt = digest?.generated_at ? new Date(digest.generated_at).getTime() : null

  const active: QueueLead[] = []
  const handled: QueueLead[] = []
  const takenIds = new Set<string>()

  // 1. Needs reply — they messaged us last; nothing outranks answering.
  for (const nr of needsReply) {
    if (takenIds.has(nr.lead.id)) continue
    takenIds.add(nr.lead.id)
    const l = nr.lead
    const preferred: QueueLead['action'] = nr.channel === 'sms'
      ? (l.phone ? 'text' : l.email ? 'email' : 'none')
      : (l.email ? 'email' : l.phone ? 'text' : 'none')
    active.push({
      lead_id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      status: l.status,
      reason: `${nr.channel === 'sms' ? 'Texted' : 'Emailed'} ${timeAgo(nr.at)}: “${snippet(nr.body)}”`,
      message: '',
      urgency: null,
      overdueDays: null,
      action: preferred,
      needsReply: true,
    })
  }

  // 2. Briefing priority leads
  for (const pl of digest?.content?.priority_leads ?? []) {
    if (takenIds.has(pl.lead_id)) continue
    takenIds.add(pl.lead_id)
    const rec = recById.get(pl.lead_id)
    const fu = followById.get(pl.lead_id)
    const email = rec?.email ?? pl.lead_email
    const phone = rec?.phone ?? pl.lead_phone
    const item: QueueLead = {
      lead_id: pl.lead_id,
      name: rec?.name ?? pl.lead_name,
      email,
      phone,
      status: rec?.status ?? pl.current_status,
      reason: pl.reason,
      message: pl.suggested_message ?? '',
      urgency: pl.urgency,
      overdueDays: fu?.next_follow_up_at ? Math.max(daysOverdue(fu.next_follow_up_at), 0) : null,
      action: inferAction(pl.suggested_action, email, phone),
    }
    // Handled = contacted since the briefing was generated (every popup
    // action stamps last_contacted_at).
    const isHandled = !!(
      generatedAt && rec?.last_contacted_at &&
      new Date(rec.last_contacted_at).getTime() > generatedAt
    )
    ;(isHandled ? handled : active).push(item)
  }

  // 4. Due follow-ups nothing above already covered
  for (const l of followUps) {
    if (takenIds.has(l.id)) continue
    takenIds.add(l.id)
    const overdue = followUpStatus(l.next_follow_up_at) === 'overdue'
    const days = l.next_follow_up_at ? Math.max(daysOverdue(l.next_follow_up_at), 0) : 0
    active.push({
      lead_id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      status: l.status,
      reason: overdue
        ? `Follow-up ${days === 1 ? '1 day' : `${days} days`} overdue`
        : 'Follow-up due today',
      message: '',
      urgency: null,
      overdueDays: days,
      action: inferAction(null, l.email, l.phone),
    })
  }

  const draftByLead = new Map(drafts.map(d => [d.lead_id, d]))

  const entries: QueueEntry[] = active.map(lead => ({
    lead,
    draft: lead.action === 'email' ? (draftByLead.get(lead.lead_id) ?? null) : null,
    isDraftRow: false,
  }))

  // 3. Pending AI drafts for leads not already in the queue → their own rows
  const allIds = new Set([...takenIds, ...handled.map(h => h.lead_id)])
  for (const d of drafts) {
    if (allIds.has(d.lead_id)) continue
    entries.push({
      isDraftRow: true,
      draft: d,
      lead: {
        lead_id: d.lead_id,
        name: d.lead?.name ?? d.to_name ?? d.to_email,
        email: d.to_email,
        phone: d.lead?.phone ?? null,
        status: d.lead?.status ?? 'new',
        reason: d.subject,
        message: '',
        urgency: null,
        overdueDays: null,
        action: 'email',
      },
    })
  }

  // Importance score — one number, sorted high to low. Replies always win;
  // after that urgency sets the base and every overdue day adds weight, so a
  // badly overdue medium lead can climb past a fresh high one.
  function importanceOf(e: QueueEntry): number {
    if (e.lead.needsReply) return 10000
    let score = 0
    if (e.isDraftRow) score += 500                      // zero-effort win: already written
    switch (e.lead.urgency) {
      case 'high': score += 400; break
      case 'medium': score += 200; break
      case 'low': score += 80; break
      default: score += 150                             // follow-up-only rows
    }
    score += Math.min(e.lead.overdueDays ?? 0, 14) * 25 // +25/day overdue, capped
    return score
  }
  entries.sort((a, b) => importanceOf(b) - importanceOf(a))

  // Briefing action items that just restate a priority lead are noise — the
  // lead row IS that action. Only keep the genuinely extra ones.
  const names = (digest?.content?.priority_leads ?? []).map(p => p.lead_name.toLowerCase()).filter(Boolean)
  const extraActionItems = (digest?.content?.action_items ?? []).filter(item => {
    const t = item.toLowerCase()
    return !names.some(n => t.includes(n))
  })

  return { queue: entries, handled, extraActionItems }
}

// ── Page ────────────────────────────────────────────────────

export default function TodoPageClient({ todos, drafts, followUps, needsReply, priorityLeadRecords, initialDigest }: Props) {
  const router = useRouter()
  const [digest, setDigest] = useState<DailyDigest | null>(initialDigest)
  useEffect(() => { setDigest(initialDigest) }, [initialDigest])

  const [active, setActive] = useState<QueueEntry | null>(null)

  const openTodos = todos.filter(t => !t.is_completed)
  const doneTodos = todos.filter(t => t.is_completed)

  const { queue, handled, extraActionItems } = useMemo(
    () => buildQueue(digest, followUps, needsReply, priorityLeadRecords, drafts),
    [digest, followUps, needsReply, priorityLeadRecords, drafts],
  )

  const replies = queue.filter(e => e.lead.needsReply)
  const rest = queue.filter(e => !e.lead.needsReply)
  const replyCount = replies.length
  const doneCount = handled.length + doneTodos.length
  const totalCount = queue.length + openTodos.length + doneCount

  function closeModal() { setActive(null) }
  function finishModal() { setActive(null); router.refresh() }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-ink m-0 tracking-tight">To-Do</h1>
          <p className="text-[13.5px] text-ink-2 mt-0.5 m-0">
            {queue.length + openTodos.length === 0
              ? 'All clear'
              : `${queue.length + openTodos.length} to go${replyCount > 0 ? ` · ${replyCount} waiting on a reply` : ''}${doneCount > 0 ? ` · ${doneCount} done today` : ''}`}
          </p>
        </div>
      </div>

      <BriefingStrip digest={digest} onDigest={d => { setDigest(d); router.refresh() }} extraItems={extraActionItems} />

      <Card className="mt-4">
        {/* Progress */}
        {totalCount > 0 && (
          <div className="px-6 pt-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[16px] font-semibold text-ink m-0">Today&apos;s queue</h2>
              <span className="text-[12.5px] font-semibold text-ink-3">{doneCount} of {totalCount} done</span>
            </div>
            <div className="h-1.5 bg-[#f0ebe1] rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: `${totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Lead + draft rows */}
        <div className="px-6 pt-4 pb-2 flex flex-col gap-2">
          {queue.length === 0 && (
            handled.length > 0 ? (
              <div className="flex items-center gap-3 bg-good-soft/60 rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-good text-white flex items-center justify-center shrink-0">
                  <Check size={16} strokeWidth={3} />
                </div>
                <p className="text-[13.5px] text-ink m-0 font-medium">Every lead handled — nice work.</p>
              </div>
            ) : (
              <EmptyState
                icon={<CheckSquare size={20} />}
                title="Queue's clear"
                subtitle="Replies, due follow-ups, and briefing leads all land here the moment they need you."
              />
            )
          )}
          {replies.length > 0 && (
            <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wide m-0 mt-1">Reply first</p>
          )}
          {replies.map(e => (
            <QueueRow key={e.isDraftRow ? `draft-${e.draft!.id}` : e.lead.lead_id} entry={e} onOpen={() => setActive(e)} />
          ))}
          {replies.length > 0 && rest.length > 0 && (
            <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wide m-0 mt-3">Up next</p>
          )}
          {rest.map(e => (
            <QueueRow key={e.isDraftRow ? `draft-${e.draft!.id}` : e.lead.lead_id} entry={e} onOpen={() => setActive(e)} />
          ))}
        </div>

        {/* Handled today */}
        {handled.length > 0 && <HandledSection handled={handled} />}

        {/* Quick tasks */}
        <TasksSection openTodos={openTodos} doneTodos={doneTodos} />
      </Card>

      {/* Action popups */}
      {active && active.lead.action === 'text' && (
        <TextActionModal key={active.lead.lead_id} lead={active.lead} onClose={closeModal} onDone={finishModal} />
      )}
      {active && active.lead.action === 'email' && (
        <EmailActionModal key={active.lead.lead_id} lead={active.lead} draft={active.draft} onClose={closeModal} onDone={finishModal} />
      )}
      {active && active.lead.action === 'call' && (
        <CallActionModal key={active.lead.lead_id} lead={active.lead} onClose={closeModal} onDone={finishModal} />
      )}
    </div>
  )
}

// ── Briefing strip (compact) ────────────────────────────────

function BriefingStrip({ digest, onDigest, extraItems }: {
  digest: DailyDigest | null
  onDigest: (d: DailyDigest) => void
  extraItems: string[]
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function generate(force: boolean) {
    setLoading(true)
    try {
      const res = await fetch('/api/digest', { method: force ? 'POST' : 'GET' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onDigest(data.digest)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate briefing')
    } finally {
      setLoading(false)
    }
  }

  async function addAsTask(item: string) {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: item, type: 'digest_action' }),
    })
    if (res.ok) { toast.success('Added to tasks'); router.refresh() }
  }

  const content = digest?.content

  return (
    <Card className="ai-card">
      <div className="flex items-center gap-3.5 px-5 py-4">
        <AIMark size={34} thinking={loading} breathe={!content} />
        <div className="min-w-0 flex-1">
          {loading && !content ? (
            <AIThinking label="Reading your pipeline…" />
          ) : content ? (
            <>
              <p className="text-[14px] font-semibold text-ink m-0">{content.greeting}</p>
              {content.summary && <p className="text-[12.5px] text-ink-2 mt-0.5 m-0">{content.summary}</p>}
            </>
          ) : (
            <>
              <p className="text-[14px] font-semibold text-ink m-0">Today&apos;s Briefing</p>
              <p className="text-[12.5px] text-ink-2 mt-0.5 m-0">Gulf AI reads the pipeline and lines up who needs you — hit Generate.</p>
            </>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => generate(!!digest)} loading={loading} className="shrink-0">
          {digest ? 'Refresh' : 'Generate'}
        </Button>
      </div>
      {extraItems.length > 0 && (
        <div className="px-5 pb-4 flex flex-wrap gap-1.5 -mt-1">
          {extraItems.map((item, i) => (
            <button
              key={i}
              onClick={() => addAsTask(item)}
              title="Add as task"
              className="inline-flex items-center gap-1.5 bg-[#f7f4ed] hover:bg-[#f0ebe1] text-ink text-[12.5px] font-medium rounded-full px-3 py-1.5 transition-colors"
            >
              <Plus size={12} className="text-accent" /> {item}
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Queue row ───────────────────────────────────────────────

const ACTION_META: Record<Exclude<QueueLead['action'], 'none'>, { label: string; icon: typeof Mail }> = {
  text: { label: 'Text', icon: MessageSquare },
  email: { label: 'Email', icon: Mail },
  call: { label: 'Call', icon: Phone },
}

function QueueRow({ entry, onOpen }: { entry: QueueEntry; onOpen: () => void }) {
  const { lead, isDraftRow } = entry

  // One pill max — the most important thing about the row, nothing else.
  const pill = lead.needsReply
    ? <Pill tone="red" className="text-[10.5px] px-1.5 py-0.5">Needs reply</Pill>
    : (lead.overdueDays ?? 0) > 0
      ? <Pill tone="red" className="text-[10.5px] px-1.5 py-0.5">{lead.overdueDays}d overdue</Pill>
      : isDraftRow
        ? <Pill tone="indigo" className="text-[10.5px] px-1.5 py-0.5"><Sparkles size={10} /> Draft ready</Pill>
        : lead.urgency === 'high'
          ? <Pill tone="red" className="text-[10.5px] px-1.5 py-0.5 uppercase">High</Pill>
          : lead.overdueDays === 0 && lead.urgency === null
            ? <Pill tone="yellow" className="text-[10.5px] px-1.5 py-0.5">Due today</Pill>
            : null

  if (lead.action === 'none') {
    return (
      <Link href={`/crm/leads/${lead.lead_id}`} className="no-underline">
        <div className="flex items-center gap-3 border border-line rounded-xl px-4 py-3 hover:border-accent/40 transition-colors">
          <Avatar name={lead.name} size={34} />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-ink m-0 flex items-center gap-2">
              {leadDisplayName(lead.name)} {pill}
            </p>
            <p className="text-[12.5px] text-ink-2 m-0 truncate">{lead.reason} · no contact info</p>
          </div>
          <Button size="sm" variant="secondary" className="shrink-0 pointer-events-none">
            Open lead <ArrowUpRight size={13} />
          </Button>
        </div>
      </Link>
    )
  }

  const meta = ACTION_META[lead.action]
  const Icon = meta.icon
  const label = lead.needsReply ? 'Reply' : isDraftRow ? 'Review & send' : meta.label

  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3 border border-line rounded-xl px-4 py-3 hover:border-accent/40 hover:bg-[#faf8f2] transition-colors cursor-pointer"
    >
      <Avatar name={lead.name} size={34} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-ink m-0 flex items-center gap-2">
          {leadDisplayName(lead.name)} {pill}
        </p>
        <p className="text-[12.5px] text-ink-2 m-0 truncate">{lead.reason}</p>
      </div>
      <Button size="sm" className="shrink-0" onClick={e => { e.stopPropagation(); onOpen() }}>
        <Icon size={13} /> {label}
      </Button>
      <Link
        href={`/crm/leads/${lead.lead_id}`}
        onClick={e => e.stopPropagation()}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-3 hover:bg-[#f0ebe1] hover:text-ink transition-colors shrink-0"
        title="Open lead"
      >
        <ArrowUpRight size={15} />
      </Link>
    </div>
  )
}

// ── Handled today ───────────────────────────────────────────

function HandledSection({ handled }: { handled: QueueLead[] }) {
  const [show, setShow] = useState(false)
  return (
    <div className="px-6 pb-2">
      <button
        onClick={() => setShow(s => !s)}
        className="text-[12px] font-semibold text-ink-3 hover:text-ink flex items-center gap-1"
      >
        {show ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {handled.length} handled today
      </button>
      {show && (
        <div className="flex flex-col gap-1.5 mt-2">
          {handled.map(l => (
            <Link key={l.lead_id} href={`/crm/leads/${l.lead_id}`} className="no-underline">
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#f7f4ed] transition-colors">
                <div className="w-[18px] h-[18px] rounded-md bg-good text-white flex items-center justify-center shrink-0">
                  <Check size={11} strokeWidth={3} />
                </div>
                <span className="text-[13px] text-ink-3 line-through">{leadDisplayName(l.name)}</span>
                <span className="text-[11.5px] text-ink-3">· contacted</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Quick tasks ─────────────────────────────────────────────

function TasksSection({ openTodos, doneTodos }: { openTodos: Todo[]; doneTodos: Todo[] }) {
  const router = useRouter()
  const [newTask, setNewTask] = useState('')
  const [adding, setAdding] = useState(false)
  const [showDone, setShowDone] = useState(false)

  async function addTask() {
    if (!newTask.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTask.trim(), type: 'manual' }),
      })
      if (!res.ok) throw new Error('Failed')
      setNewTask('')
      router.refresh()
    } catch {
      toast.error('Could not add task')
    } finally {
      setAdding(false)
    }
  }

  async function toggle(todo: Todo) {
    const completing = !todo.is_completed
    await fetch(`/api/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_completed: completing }),
    })
    if (completing) {
      // Brief undo window — the task also stays in the collapsed "completed"
      // list below, so nothing vanishes for good until "Clear done".
      toast(t => (
        <span className="flex items-center gap-3">
          <span>Task completed</span>
          <button
            onClick={async () => {
              toast.dismiss(t.id)
              await fetch(`/api/todos/${todo.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_completed: false }),
              })
              router.refresh()
            }}
            className="font-bold text-accent hover:underline"
          >
            Undo
          </button>
        </span>
      ), { duration: 5000, icon: '✓' })
    }
    router.refresh()
  }

  async function archiveDone() {
    await Promise.all(doneTodos.map(t =>
      fetch(`/api/todos/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_archived: true }),
      })
    ))
    toast.success('Cleared')
    router.refresh()
  }

  return (
    <div className="border-t border-line mt-3 px-6 pt-4 pb-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wide m-0">Quick tasks</p>
        {doneTodos.length > 0 && (
          <Button size="sm" variant="ghost" onClick={archiveDone}><Archive size={13} /> Clear done</Button>
        )}
      </div>

      <div className="flex gap-2 mb-3">
        <Input
          value={newTask}
          onChange={e => setNewTask(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addTask() }}
          placeholder="Add a task…"
        />
        <Button onClick={addTask} loading={adding} disabled={!newTask.trim()}><Plus size={15} /></Button>
      </div>

      {openTodos.length === 0 && doneTodos.length === 0 && (
        <p className="text-[13px] text-ink-3 text-center py-2 m-0">Nothing here — enjoy it while it lasts</p>
      )}

      <div className="flex flex-col gap-1">
        {openTodos.map(t => <TodoRow key={t.id} todo={t} onToggle={() => toggle(t)} />)}
      </div>

      {doneTodos.length > 0 && (
        <>
          <button
            onClick={() => setShowDone(s => !s)}
            className="text-[12px] font-semibold text-ink-3 hover:text-ink mt-3 flex items-center gap-1"
          >
            {showDone ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {doneTodos.length} completed
          </button>
          {showDone && (
            <div className="flex flex-col gap-1 mt-2">
              {doneTodos.map(t => <TodoRow key={t.id} todo={t} onToggle={() => toggle(t)} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TodoRow({ todo, onToggle }: { todo: Todo; onToggle: () => void }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5 group">
      <button
        onClick={onToggle}
        className={cn(
          'w-[18px] h-[18px] rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors',
          todo.is_completed ? 'bg-good border-good text-white' : 'border-line-strong hover:border-accent'
        )}
      >
        {todo.is_completed && <Check size={11} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('text-[13.5px] m-0', todo.is_completed ? 'text-ink-3 line-through' : 'text-ink')}>
          {todo.title}
        </p>
        <div className="flex items-center gap-2">
          {todo.lead?.name && (
            <Link href={`/crm/leads/${todo.linked_lead_id}`} className="text-[11.5px] text-accent font-semibold no-underline hover:underline">
              {todo.lead.name}
            </Link>
          )}
          {todo.type === 'ai_created' && <AIBadge />}
        </div>
      </div>
    </div>
  )
}
