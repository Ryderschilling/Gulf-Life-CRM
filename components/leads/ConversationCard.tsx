'use client'

// ============================================================
// components/leads/ConversationCard.tsx — the lead's inbox,
// embedded on their page. Full merged thread (texts + emails,
// sent and received) in brand colors — texts gold, email navy —
// newest at the bottom, with a quick text composer so a reply
// never requires leaving the lead.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageSquare, Send, ArrowUpRight } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Lead, LeadActivity, SmsMessage } from '@/lib/types'
import { formatPhone, timeAgo, cn } from '@/lib/utils'
import { Card, Button, Textarea } from '@/components/ui/kit'
import { AIMark } from '@/components/ai/AIMark'

interface Msg {
  id: string
  at: string
  dir: 'in' | 'out'
  channel: 'text' | 'email'
  body: string
  subject?: string
  failed?: boolean
}

export default function ConversationCard({ lead, smsMessages, activities }: {
  lead: Lead
  smsMessages: SmsMessage[]
  activities: LeadActivity[]
}) {
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)

  const msgs = useMemo<Msg[]>(() => {
    const fromSms: Msg[] = smsMessages.map(s => ({
      id: `s-${s.id}`,
      at: s.created_at,
      dir: s.direction === 'inbound' ? 'in' : 'out',
      channel: 'text',
      body: s.body,
      failed: s.status === 'failed',
    }))
    const fromEmail: Msg[] = activities
      .filter(a => a.type === 'email_sent' || a.type === 'email_received')
      .map(a => {
        const meta = (a.metadata ?? {}) as { subject?: string }
        return {
          id: `e-${a.id}`,
          at: a.created_at,
          dir: a.type === 'email_received' ? 'in' as const : 'out' as const,
          channel: 'email' as const,
          body: a.body ?? '',
          subject: meta.subject,
        }
      })
    return [...fromSms, ...fromEmail].sort((a, b) => a.at.localeCompare(b.at))
  }, [smsMessages, activities])

  // Keep the newest message in view
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs.length])

  // Nothing to show and no way to start one → skip the card entirely
  if (msgs.length === 0 && !lead.phone) return null

  const textCount = msgs.filter(m => m.channel === 'text').length
  const emailCount = msgs.length - textCount

  async function draft() {
    setDrafting(true)
    try {
      const res = await fetch('/api/inbox/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, channel: 'sms' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setText(data.body)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }

  async function send() {
    if (!text.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, body: text.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setText('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
        <div>
          <h2 className="text-[16px] font-semibold text-ink m-0">Conversation</h2>
          <p className="text-[13px] text-ink-2 mt-0.5 m-0">
            {msgs.length === 0
              ? 'No messages yet'
              : [textCount > 0 ? `${textCount} text${textCount === 1 ? '' : 's'}` : null, emailCount > 0 ? `${emailCount} email${emailCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Link
          href="/crm/inbox"
          className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-3 hover:text-ink no-underline shrink-0"
        >
          Open Inbox <ArrowUpRight size={13} />
        </Link>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="px-6 pb-2 max-h-[420px] overflow-y-auto">
        {msgs.length === 0 ? (
          <p className="text-[13px] text-ink-3 text-center py-6 m-0">
            Nothing yet — send the first text below.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5 py-1">
            {msgs.map(m => (
              <div key={m.id} className={cn('max-w-[78%] flex flex-col', m.dir === 'out' ? 'self-end items-end' : 'self-start items-start')}>
                <div
                  className={cn(
                    'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words',
                    m.dir === 'out'
                      ? m.channel === 'text'
                        ? 'bg-accent-soft border border-[#e6d9bd] text-ink rounded-br-md'   // our texts — gold
                        : 'bg-info-soft text-ink rounded-br-md'                              // our emails — navy soft
                      : 'bg-card border border-line text-ink rounded-bl-md'                  // theirs
                  )}
                >
                  {m.subject && <p className="text-[12px] font-bold m-0 mb-1">{m.subject}</p>}
                  {m.body || <span className="italic text-ink-3">(empty message)</span>}
                </div>
                <p className="text-[10.5px] text-ink-3 m-0 mt-1 px-1">
                  {m.channel === 'text' ? 'Text' : 'Email'} · {timeAgo(m.at)}{m.failed ? ' · ⚠ failed' : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick text composer */}
      {lead.phone ? (
        <div className="px-6 pb-5 pt-2 border-t border-line">
          <div className="flex items-end gap-2">
            <Textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
              placeholder={`Text ${formatPhone(lead.phone)}…`}
              rows={2}
              className="min-h-[44px] text-[13px]"
            />
            <div className="flex flex-col gap-1.5 shrink-0">
              <Button size="sm" className="ai-btn" onClick={draft} loading={drafting} title="Gulf AI drafts the next message from this conversation">
                <AIMark size={14} variant="white" thinking={drafting} />
              </Button>
              <Button size="sm" onClick={send} loading={sending} disabled={!text.trim()}>
                <Send size={13} />
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-ink-3 m-0 mt-1.5 flex items-center gap-1">
            <MessageSquare size={11} /> Sends as a text via your Quo line · ⌘↩ to send
          </p>
        </div>
      ) : (
        <div className="px-6 pb-5" />
      )}
    </Card>
  )
}
