'use client'

// ============================================================
// components/todo/ActionModals.tsx — focused action popups for
// the To-Do queue. One modal per action (Text / Email / Call):
// do the thing and you're done. No questions after — the next
// follow-up is scheduled silently by stage cadence, so the
// queue drains itself and refills when leads are due again.
// ============================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy, Send, Check, ArrowUpRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import type { EmailDraft, LeadStatus } from '@/lib/types'
import { formatPhone, leadDisplayName, cn } from '@/lib/utils'
import { todayStr } from '@/lib/dates'
import { Modal, Button, Input, Textarea } from '@/components/ui/kit'
import { AIMark, AIThinking } from '@/components/ai/AIMark'

// One queue entry the modals can act on — built by TodoPageClient
// from needs-reply conversations, digest priority leads, due
// follow-ups, and pending drafts.
export interface QueueLead {
  lead_id: string
  name: string
  email: string | null
  phone: string | null
  status: LeadStatus
  reason: string
  /** Digest's suggested message — '' when the item didn't come from the briefing */
  message: string
  urgency: 'high' | 'medium' | 'low' | null
  overdueDays: number | null
  action: 'text' | 'email' | 'call' | 'none'
  /** True when this row exists because THEY messaged US last */
  needsReply?: boolean
}

function firstName(name: string): string {
  const display = leadDisplayName(name)
  return /[a-zA-Z]/.test(display) ? display.split(' ')[0] : display
}

/** YYYY-MM-DD, `days` CRM-local calendar days from today. */
function addDays(days: number): string {
  const [y, m, d] = todayStr().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// ── Auto-cadence ────────────────────────────────────────────
// After any completed touch, the next follow-up is scheduled
// silently by pipeline stage — nobody gets asked "when?".
// Closed leads never re-enter the queue automatically.
const CADENCE_DAYS: Partial<Record<LeadStatus, number>> = {
  new: 3,
  contacted: 3,
  nurturing: 7,
  proposal: 2,
}

/**
 * Marks a touch complete: stamps last_contacted_at (when asked) and
 * silently schedules the next follow-up by stage cadence.
 * Returns a human tail for the toast ("back on your list in 3 days").
 */
async function completeTouch(
  lead: QueueLead,
  opts: { retry?: boolean; stampContact?: boolean } = {},
): Promise<string> {
  const supabase = createClient()
  const closed = lead.status === 'closed_won' || lead.status === 'closed_lost'
  const days = opts.retry ? 1 : CADENCE_DAYS[lead.status] ?? 3

  const updates: Record<string, unknown> = {
    next_follow_up_at: closed ? null : addDays(days),
  }
  if (opts.stampContact) updates.last_contacted_at = new Date().toISOString()

  const { error } = await supabase.from('leads').update(updates).eq('id', lead.lead_id)
  if (error || closed) return ''
  return days === 1 ? 'back on your list tomorrow' : `back on your list in ${days} days`
}

function OpenLeadLink({ leadId }: { leadId: string }) {
  return (
    <Link
      href={`/crm/leads/${leadId}`}
      className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-3 hover:text-ink no-underline"
    >
      Open lead <ArrowUpRight size={12} />
    </Link>
  )
}

// ────────────────────────────────────────────────────────────
// TEXT — prefilled from the briefing (or Gulf AI drafts one —
// for replies it reads the whole conversation), sends through
// Quo, logs to the lead timeline automatically.
// ────────────────────────────────────────────────────────────

export function TextActionModal({ lead, onClose, onDone }: {
  lead: QueueLead
  onClose: () => void
  onDone: () => void
}) {
  const [body, setBody] = useState(lead.message)
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!lead.message.trim()) void draft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function draft() {
    setDrafting(true)
    try {
      const res = await fetch('/api/inbox/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.lead_id, channel: 'sms' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setBody(data.body)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }

  async function send() {
    setSending(true)
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.lead_id, body: body.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const tail = await completeTouch(lead)
      toast.success(`Text sent to ${firstName(lead.name)}${tail ? ` — ${tail}` : ''}`)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={lead.needsReply ? `Reply to ${firstName(lead.name)}` : `Text ${firstName(lead.name)}`}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] text-ink-2 m-0">
            To <strong className="text-ink">{leadDisplayName(lead.name)}</strong> · {formatPhone(lead.phone)}
          </p>
          <OpenLeadLink leadId={lead.lead_id} />
        </div>
        {lead.reason && (
          <p className="text-[12.5px] text-ink-2 m-0 bg-[#f7f4ed] rounded-lg px-3 py-2">{lead.reason}</p>
        )}
        {drafting && !body ? (
          <div className="py-4"><AIThinking label="Gulf AI is writing…" /></div>
        ) : (
          <Textarea value={body} onChange={e => setBody(e.target.value)} rows={5} className="text-[13.5px]" />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button size="sm" className="ai-btn" onClick={draft} loading={drafting}>
              <AIMark size={14} variant="white" thinking={drafting} /> {body ? 'Rewrite' : 'Draft'}
            </Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => { navigator.clipboard.writeText(body); toast.success('Copied') }}
              disabled={!body.trim()}
            >
              <Copy size={13} /> Copy
            </Button>
          </div>
          <Button size="sm" onClick={send} loading={sending} disabled={!body.trim() || drafting}>
            <Send size={13} /> Send text
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ────────────────────────────────────────────────────────────
// EMAIL — reviews an existing AI draft when one is pending for
// the lead, otherwise composes fresh (Gulf AI drafts on open).
// ────────────────────────────────────────────────────────────

export function EmailActionModal({ lead, draft, onClose, onDone }: {
  lead: QueueLead
  draft: EmailDraft | null
  onClose: () => void
  onDone: () => void
}) {
  const hasSeed = !!draft || !!lead.message.trim()
  const [subject, setSubject] = useState(draft?.subject ?? (lead.message.trim() ? 'Following up — Gulf Life Concierge' : ''))
  const [body, setBody] = useState(draft?.body ?? lead.message)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    if (!hasSeed) void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/inbox/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.lead_id, channel: 'email' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setBody(data.body)
      if (data.subject) setSubject(data.subject)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setGenerating(false)
    }
  }

  async function send() {
    setSending(true)
    try {
      const payload = draft
        ? { draft_id: draft.id, subject, body }
        : { lead_id: lead.lead_id, subject, body }
      const res = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const tail = await completeTouch(lead)
      toast.success(`Email sent to ${firstName(lead.name)}${tail ? ` — ${tail}` : ''}`)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function dismiss() {
    if (!draft) return
    setDismissing(true)
    try {
      await fetch('/api/emails/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draft.id }),
      })
      toast.success('Draft dismissed')
      onDone()
    } finally {
      setDismissing(false)
    }
  }

  const toEmail = draft?.to_email ?? lead.email

  return (
    <Modal open onClose={onClose} title={lead.needsReply ? `Reply to ${firstName(lead.name)}` : `Email ${firstName(lead.name)}`} wide>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] text-ink-2 m-0">
            To <strong className="text-ink">{leadDisplayName(lead.name)}</strong> · {toEmail ?? 'no email on file'}
          </p>
          <OpenLeadLink leadId={lead.lead_id} />
        </div>
        {lead.reason && (
          <p className="text-[12.5px] text-ink-2 m-0 bg-[#f7f4ed] rounded-lg px-3 py-2">{lead.reason}</p>
        )}
        {generating && !body ? (
          <div className="py-6"><AIThinking label="Gulf AI is writing…" /></div>
        ) : (
          <>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className="font-semibold" />
            <Textarea value={body} onChange={e => setBody(e.target.value)} rows={9} className="text-[13.5px]" />
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="ai-btn" onClick={generate} loading={generating}>
              <AIMark size={14} variant="white" thinking={generating} /> {body ? 'Rewrite' : 'Draft'}
            </Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => { navigator.clipboard.writeText(subject ? `${subject}\n\n${body}` : body); toast.success('Copied') }}
              disabled={!body.trim()}
            >
              <Copy size={13} /> Copy
            </Button>
            {draft && (
              <Button size="sm" variant="ghost" onClick={dismiss} loading={dismissing}>
                Dismiss draft
              </Button>
            )}
          </div>
          <Button size="sm" onClick={send} loading={sending} disabled={!subject.trim() || !body.trim() || generating || !toEmail}>
            <Send size={13} /> Send email
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ────────────────────────────────────────────────────────────
// CALL — number front and center, talking points, one-tap
// outcome logging straight to the lead timeline. No-answer /
// voicemail auto-requeues the lead for tomorrow.
// ────────────────────────────────────────────────────────────

const OUTCOMES = [
  { key: 'connected', label: 'Connected' },
  { key: 'voicemail', label: 'Left voicemail' },
  { key: 'no_answer', label: 'No answer' },
] as const

type OutcomeKey = typeof OUTCOMES[number]['key']

export function CallActionModal({ lead, onClose, onDone }: {
  lead: QueueLead
  onClose: () => void
  onDone: () => void
}) {
  const [outcome, setOutcome] = useState<OutcomeKey | null>(null)
  const [note, setNote] = useState('')
  const [logging, setLogging] = useState(false)

  const talkingPoints = lead.message.trim() || lead.reason

  async function log() {
    if (!outcome) return
    setLogging(true)
    try {
      const label = OUTCOMES.find(o => o.key === outcome)!.label
      const res = await fetch(`/api/leads/${lead.lead_id}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'call',
          description: `Call — ${label}${note.trim() ? ` — ${note.trim()}` : ''}`,
        }),
      })
      if (!res.ok) throw new Error('Could not log the call')
      const tail = await completeTouch(lead, { retry: outcome !== 'connected', stampContact: true })
      toast.success(`Call logged${tail ? ` — ${firstName(lead.name)} ${tail.replace('back on your list', 'is back on your list')}` : ''}`)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not log the call')
    } finally {
      setLogging(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Call ${firstName(lead.name)}`}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] text-ink-2 m-0">
            <strong className="text-ink">{leadDisplayName(lead.name)}</strong>
          </p>
          <OpenLeadLink leadId={lead.lead_id} />
        </div>

        <a
          href={lead.phone ? `tel:${lead.phone}` : undefined}
          className="block text-center bg-[#f7f4ed] border border-line rounded-xl py-4 no-underline hover:border-accent/40 transition-colors"
        >
          <span className="text-[22px] font-bold text-ink tracking-tight">
            {lead.phone ? formatPhone(lead.phone) : 'No phone on file'}
          </span>
        </a>

        {talkingPoints && (
          <div>
            <p className="text-[11.5px] font-bold text-ink-3 uppercase tracking-wide m-0 mb-1.5">Talking points</p>
            <p className="text-[13px] text-ink m-0 bg-card border border-line rounded-lg px-3.5 py-2.5 whitespace-pre-wrap">
              {talkingPoints}
            </p>
          </div>
        )}

        <div>
          <p className="text-[11.5px] font-bold text-ink-3 uppercase tracking-wide m-0 mb-1.5">How did it go?</p>
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map(o => (
              <button
                key={o.key}
                onClick={() => setOutcome(o.key)}
                className={cn(
                  'px-3 py-1.5 rounded-btn text-[13px] font-semibold border transition-colors',
                  outcome === o.key
                    ? 'bg-accent-soft border-accent/40 text-accent-dark'
                    : 'bg-card border-line-strong text-ink-2 hover:text-ink'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {outcome && (
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="Anything worth remembering? (optional)"
            className="text-[13px]"
          />
        )}

        <div className="flex justify-end">
          <Button size="sm" onClick={log} loading={logging} disabled={!outcome}>
            <Check size={14} /> Log call
          </Button>
        </div>
      </div>
    </Modal>
  )
}
