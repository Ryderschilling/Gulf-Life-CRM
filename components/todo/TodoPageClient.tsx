'use client'

// To-Do page — the daily command center:
//   AI morning briefing · tasks · email drafts to review · follow-ups due

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Sun, RefreshCw, Plus, CheckSquare, Mail, CalendarClock, Send, X,
  ChevronDown, ChevronUp, Copy, ArrowRight, Archive
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { Todo, EmailDraft, Lead, DailyDigest, PriorityLead } from '@/lib/types'
import { STATUS_CONFIG, formatPhone, timeAgo, cn } from '@/lib/utils'
import { Card, CardHeader, Button, Pill, Avatar, Input, EmptyState, Textarea } from '@/components/ui/kit'
import { AIMark, AIThinking, AIBadge } from '@/components/ai/AIMark'

interface Props {
  todos: Todo[]
  drafts: EmailDraft[]
  followUps: Lead[]
  initialDigest: DailyDigest | null
}

export default function TodoPageClient({ todos, drafts, followUps, initialDigest }: Props) {
  const openTodos = todos.filter(t => !t.is_completed)
  const doneTodos = todos.filter(t => t.is_completed)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-ink m-0 tracking-tight">To-Do</h1>
          <p className="text-[13.5px] text-ink-2 mt-0.5 m-0">
            {openTodos.length} task{openTodos.length === 1 ? '' : 's'} · {drafts.length} draft{drafts.length === 1 ? '' : 's'} to review · {followUps.length} follow-up{followUps.length === 1 ? '' : 's'} due
          </p>
        </div>
      </div>

      <DigestCard initialDigest={initialDigest} />

      <div className="grid lg:grid-cols-2 gap-4 mt-4 items-start">
        <div className="flex flex-col gap-4">
          <TasksCard openTodos={openTodos} doneTodos={doneTodos} />
          <FollowUpsCard followUps={followUps} />
        </div>
        <DraftsCard drafts={drafts} />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// DAILY DIGEST
// ════════════════════════════════════════════════════════════

function DigestCard({ initialDigest }: { initialDigest: DailyDigest | null }) {
  const router = useRouter()
  const [digest, setDigest] = useState<DailyDigest | null>(initialDigest)
  const [loading, setLoading] = useState(false)
  const [expandedLead, setExpandedLead] = useState<string | null>(null)

  async function generate(force = false) {
    setLoading(true)
    try {
      const res = await fetch('/api/digest', { method: force ? 'POST' : 'GET' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setDigest(data.digest)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate briefing')
    } finally {
      setLoading(false)
    }
  }

  async function addActionAsTodo(item: string) {
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
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <AIMark size={36} thinking={loading} />
          <div>
            <h2 className="text-[16px] font-semibold text-ink m-0">Today&apos;s Briefing</h2>
            <p className="text-[13px] text-ink-2 mt-0.5 m-0">Gulf AI reads the whole pipeline and tells you where to focus</p>
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => generate(!!digest)} loading={loading}>
          {digest ? <><RefreshCw size={13} /> Refresh</> : <><Sun size={14} /> Generate</>}
        </Button>
      </div>

      {!content && !loading && (
        <div className="px-6 pb-6">
          <div className="bg-accent-soft/50 border border-accent/15 rounded-xl px-5 py-4 flex items-center gap-3">
            <AIMark size={34} breathe />
            <p className="text-[13.5px] text-ink-2 m-0">
              Hit <strong className="text-ink">Generate</strong> and Gulf AI builds your morning game plan — who to contact, why, and what to say.
            </p>
          </div>
        </div>
      )}

      {loading && !content && (
        <div className="px-6 pb-8">
          <AIThinking label="Reading your pipeline…" />
        </div>
      )}

      {content && (
        <div className="px-6 pb-6 ai-msg-in">
          <p className="text-[14.5px] font-semibold text-ink m-0">{content.greeting}</p>
          {content.summary && <p className="text-[13.5px] text-ink-2 mt-1 m-0">{content.summary}</p>}

          {content.priority_leads.length > 0 && (
            <div className="flex flex-col gap-2 mt-4">
              {content.priority_leads.map(pl => (
                <PriorityLeadRow
                  key={pl.lead_id}
                  pl={pl}
                  expanded={expandedLead === pl.lead_id}
                  onToggle={() => setExpandedLead(e => e === pl.lead_id ? null : pl.lead_id)}
                />
              ))}
            </div>
          )}

          {content.action_items.length > 0 && (
            <div className="mt-4">
              <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wide m-0 mb-2">Also today</p>
              <div className="flex flex-col gap-1.5">
                {content.action_items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 bg-[#f7f8fb] rounded-lg px-3.5 py-2">
                    <span className="text-[13px] text-ink">{item}</span>
                    <button onClick={() => addActionAsTodo(item)} className="text-accent hover:text-accent-dark shrink-0" title="Add as task">
                      <Plus size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function PriorityLeadRow({ pl, expanded, onToggle }: { pl: PriorityLead; expanded: boolean; onToggle: () => void }) {
  const router = useRouter()
  const [drafting, setDrafting] = useState(false)

  const urgencyTone = pl.urgency === 'high' ? 'red' : pl.urgency === 'medium' ? 'yellow' : 'gray'

  async function draftIt() {
    setDrafting(true)
    try {
      const res = await fetch('/api/emails/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: pl.lead_id, trigger_type: 'follow_up_due' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast.success('Draft ready below')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }

  function copyMessage() {
    navigator.clipboard.writeText(pl.suggested_message)
    toast.success('Copied')
  }

  return (
    <div className="border border-line rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-[#fafbfe] transition-colors text-left">
        <Avatar name={pl.lead_name} size={30} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-ink m-0 flex items-center gap-2">
            {pl.lead_name}
            <Pill tone={urgencyTone} className="text-[10.5px] px-1.5 py-0.5 uppercase">{pl.urgency}</Pill>
            <Pill tone={STATUS_CONFIG[pl.current_status]?.tone ?? 'gray'} className="text-[10.5px] px-1.5 py-0.5">
              {STATUS_CONFIG[pl.current_status]?.label ?? pl.current_status}
            </Pill>
          </p>
          <p className="text-[12.5px] text-ink-2 m-0 truncate">{pl.reason}</p>
        </div>
        <span className="text-[12px] font-bold text-accent shrink-0">{pl.suggested_action}</span>
        {expanded ? <ChevronUp size={15} className="text-ink-3 shrink-0" /> : <ChevronDown size={15} className="text-ink-3 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-[#fafbfe] border-t border-line">
          <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wide m-0 mb-1.5">What to say</p>
          <p className="text-[13px] text-ink m-0 bg-card border border-line rounded-lg px-3.5 py-3 whitespace-pre-wrap">
            {pl.suggested_message}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button size="sm" variant="secondary" onClick={copyMessage}><Copy size={13} /> Copy</Button>
            {pl.lead_email && (
              <Button size="sm" className="ai-btn" onClick={draftIt} loading={drafting}>
                <AIMark size={14} variant="white" thinking={drafting} /> AI email draft
              </Button>
            )}
            <Link href={`/crm/leads/${pl.lead_id}`} className="no-underline">
              <Button size="sm" variant="ghost">Open lead <ArrowRight size={13} /></Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// TASKS
// ════════════════════════════════════════════════════════════

function TasksCard({ openTodos, doneTodos }: { openTodos: Todo[]; doneTodos: Todo[] }) {
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
    await fetch(`/api/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_completed: !todo.is_completed }),
    })
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
    <Card>
      <CardHeader
        title="Tasks"
        right={doneTodos.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={archiveDone}><Archive size={13} /> Clear done</Button>
        ) : undefined}
      />
      <div className="px-6 pb-5">
        <div className="flex gap-2 mb-4">
          <Input
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTask() }}
            placeholder="Add a task…"
          />
          <Button onClick={addTask} loading={adding} disabled={!newTask.trim()}><Plus size={15} /></Button>
        </div>

        {openTodos.length === 0 && doneTodos.length === 0 && (
          <p className="text-[13px] text-ink-3 text-center py-4 m-0">Nothing here — enjoy it while it lasts</p>
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
    </Card>
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
        {todo.is_completed && <CheckSquare size={11} strokeWidth={3} />}
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

// ════════════════════════════════════════════════════════════
// EMAIL DRAFTS
// ════════════════════════════════════════════════════════════

function DraftsCard({ drafts }: { drafts: EmailDraft[] }) {
  return (
    <Card>
      <CardHeader title="Email drafts to review" subtitle="Gulf AI wrote these — edit, then send or dismiss" />
      <div className="px-6 pb-5 flex flex-col gap-3">
        {drafts.length === 0 && (
          <EmptyState
            icon={<Mail size={20} />}
            title="No drafts waiting"
            subtitle='Ask the AI to "draft a follow-up for..." or hit AI Email Draft on any lead.'
          />
        )}
        {drafts.map(d => <DraftRow key={d.id} draft={d} />)}
      </div>
    </Card>
  )
}

function DraftRow({ draft }: { draft: EmailDraft }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [sending, setSending] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  async function send() {
    setSending(true)
    try {
      const res = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draft.id, subject, body }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast.success(`Sent to ${draft.to_name ?? draft.to_email}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function dismiss() {
    setDismissing(true)
    try {
      await fetch('/api/emails/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draft.id }),
      })
      router.refresh()
    } finally {
      setDismissing(false)
    }
  }

  return (
    <div className="border border-line rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-[#fafbfe] transition-colors text-left">
        <div className="w-8 h-8 rounded-lg bg-info-soft text-info flex items-center justify-center shrink-0">
          <Mail size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-ink m-0 truncate">{subject}</p>
          <p className="text-[12px] text-ink-3 m-0">
            To {draft.to_name ?? draft.to_email} · {timeAgo(draft.created_at)}
          </p>
        </div>
        {expanded ? <ChevronUp size={15} className="text-ink-3 shrink-0" /> : <ChevronDown size={15} className="text-ink-3 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2 bg-[#fafbfe] border-t border-line flex flex-col gap-2.5">
          <Input value={subject} onChange={e => setSubject(e.target.value)} className="font-semibold" />
          <Textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className="text-[13px]" />
          <div className="flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={dismiss} loading={dismissing}>
              <X size={13} /> Dismiss
            </Button>
            <Button size="sm" onClick={send} loading={sending}>
              <Send size={13} /> Send email
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// FOLLOW-UPS DUE
// ════════════════════════════════════════════════════════════

function FollowUpsCard({ followUps }: { followUps: Lead[] }) {
  if (followUps.length === 0) return null
  const now = new Date()
  return (
    <Card>
      <CardHeader title="Follow-ups due" subtitle="Owner leads whose follow-up date has arrived" />
      <div className="px-6 pb-5 flex flex-col gap-2">
        {followUps.map(lead => {
          const overdueDays = lead.next_follow_up_at
            ? Math.floor((now.getTime() - new Date(lead.next_follow_up_at).getTime()) / 86400000)
            : 0
          return (
            <Link key={lead.id} href={`/crm/leads/${lead.id}`} className="no-underline">
              <div className="flex items-center gap-3 border border-line rounded-xl px-4 py-3 hover:border-accent/40 transition-colors">
                <Avatar name={lead.name} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-ink m-0 flex items-center gap-2">
                    {lead.name}
                    <Pill tone={STATUS_CONFIG[lead.status].tone} className="text-[10.5px] px-1.5 py-0.5">
                      {STATUS_CONFIG[lead.status].label}
                    </Pill>
                  </p>
                  <p className="text-[12px] text-ink-3 m-0">{formatPhone(lead.phone)}</p>
                </div>
                <Pill tone={overdueDays > 0 ? 'red' : 'yellow'} className="shrink-0">
                  <CalendarClock size={12} />
                  {overdueDays > 0 ? `${overdueDays}d overdue` : 'Due today'}
                </Pill>
              </div>
            </Link>
          )
        })}
      </div>
    </Card>
  )
}
