'use client'

// Unified inbox — every SMS + email conversation in one place.
// Read, reply (text or email), and jump to the full lead — without
// leaving the CRM. Inbound messages are captured by the Quo / Resend
// webhooks; this view merges them per lead into a two-way thread.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { MessageSquare, Mail, Send, Search, Inbox as InboxIcon, ExternalLink, Sparkles, MoreHorizontal, Trash2, CheckCheck, Circle } from 'lucide-react'
import { Card, Button, Input, Textarea, PageHeader, Avatar, EmptyState, Segmented, Pill, Spinner, Modal } from '@/components/ui/kit'
import { createClient } from '@/lib/supabase/client'
import { cn, timeAgo, formatPhone } from '@/lib/utils'

// Channel colors — texts are indigo (brand accent), emails are teal.
// One glance at any bubble, thread, or list row tells you which is which.
const EMAIL = {
  solid: 'bg-[#0d9488] text-white',        // outbound bubble
  border: 'border-[#99f6e4]',              // inbound bubble edge
  soft: 'bg-[#f0fdfa] text-[#0d9488]',     // chips / badges
  text: 'text-[#0d9488]',
}

interface LeadLite { id: string; name: string; phone: string | null; email: string | null }
interface SmsRow { id: string; lead_id: string; body: string; direction: string; status: string; created_at: string; lead: LeadLite | null }
interface EmailRow { id: string; lead_id: string; type: string; body: string; created_at: string; metadata: Record<string, unknown> | null; lead: LeadLite | null }

interface Item { key: string; kind: 'sms' | 'email'; dir: 'in' | 'out'; text: string; at: string; subject?: string; status?: string }
interface Convo { leadId: string; name: string; phone: string | null; email: string | null; items: Item[]; last: Item; needsReply: boolean }

type Filter = 'all' | 'unresponded'
type Channel = 'all' | 'sms' | 'email'

export default function InboxClient({ sms, emails }: { sms: SmsRow[]; emails: EmailRow[] }) {
  const router = useRouter()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [channel, setChannel] = useState<Channel>('all')
  const [search, setSearch] = useState('')

  // Live refresh — new inbound texts/emails appear without a manual reload.
  // router.refresh() refetches the server component; typed drafts survive.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, 10_000)
    return () => clearInterval(t)
  }, [router])

  // Inbound email — ask the server to pull new mail from the Gulf Life
  // mailbox (Gmail IMAP) on open + every 60s. Cheap + idempotent.
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === 'visible') fetch('/api/email/poll', { method: 'POST' }).catch(() => {})
    }
    poll()
    const t = setInterval(poll, 60_000)
    return () => clearInterval(t)
  }, [])

  // Read state — per browser (this device = this user). A conversation is
  // unread while it has inbound messages newer than the last time it was
  // open on screen; opening it clears the dot.
  const [reads, setReads] = useState<Record<string, string>>({})
  useEffect(() => {
    try { setReads(JSON.parse(localStorage.getItem('glc_inbox_reads') ?? '{}')) } catch { /* fresh browser */ }
  }, [])
  const markRead = useCallback((leadId: string) => {
    setReads(prev => {
      if (prev[leadId] && prev[leadId] >= new Date().toISOString()) return prev
      const next = { ...prev, [leadId]: new Date().toISOString() }
      try { localStorage.setItem('glc_inbox_reads', JSON.stringify(next)) } catch { /* storage full/blocked */ }
      return next
    })
  }, [])
  const isUnread = useCallback(
    (c: Convo) => c.items.some(i => i.dir === 'in' && i.at > (reads[c.leadId] ?? '')),
    [reads],
  )
  const markUnread = useCallback((leadId: string) => {
    setReads(prev => {
      const next = { ...prev }
      delete next[leadId]
      try { localStorage.setItem('glc_inbox_reads', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  // ⋯ menu + delete-conversation confirm
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [deleteFor, setDeleteFor] = useState<Convo | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function deleteConversation() {
    if (!deleteFor || deleting) return
    setDeleting(true)
    try {
      const supabase = createClient()
      // Remove the messages themselves; the lead + its timeline stay intact
      const { error: e1 } = await supabase.from('sms_messages').delete().eq('lead_id', deleteFor.leadId)
      const { error: e2 } = await supabase.from('lead_activities').delete().eq('lead_id', deleteFor.leadId).in('type', ['email_sent', 'email_received'])
      if (e1 || e2) throw new Error((e1 ?? e2)!.message)
      if (activeId === deleteFor.leadId) setActiveId(null)
      toast.success('Conversation deleted')
      setDeleteFor(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const convos = useMemo(() => {
    const map = new Map<string, Convo>()
    const push = (leadId: string, lead: LeadLite | null, item: Item) => {
      if (!leadId) return
      let c = map.get(leadId)
      if (!c) {
        c = { leadId, name: lead?.name ?? 'Unknown', phone: lead?.phone ?? null, email: lead?.email ?? null, items: [], last: item, needsReply: false }
        map.set(leadId, c)
      }
      if (lead?.name) c.name = lead.name
      if (lead?.phone) c.phone = lead.phone
      if (lead?.email) c.email = lead.email
      c.items.push(item)
    }
    for (const s of sms) {
      push(s.lead_id, s.lead, { key: 's' + s.id, kind: 'sms', dir: s.direction === 'inbound' ? 'in' : 'out', text: s.body, at: s.created_at, status: s.status })
    }
    for (const e of emails) {
      const meta = e.metadata ?? {}
      push(e.lead_id, e.lead, { key: 'e' + e.id, kind: 'email', dir: e.type === 'email_received' ? 'in' : 'out', text: e.body, at: e.created_at, subject: typeof meta.subject === 'string' ? meta.subject : undefined })
    }
    const list = Array.from(map.values())
    for (const c of list) {
      c.items.sort((a, b) => a.at.localeCompare(b.at))
      c.last = c.items[c.items.length - 1]
      c.needsReply = c.last.dir === 'in'
    }
    list.sort((a, b) => b.last.at.localeCompare(a.last.at))
    return list
  }, [sms, emails])

  const filtered = useMemo(() => {
    let list = convos
    if (filter === 'unresponded') list = list.filter(c => c.needsReply)
    if (channel !== 'all') list = list.filter(c => c.items.some(i => i.kind === channel))
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q) || (c.phone ?? '').includes(q))
    }
    return list
  }, [convos, filter, channel, search])

  const active = convos.find(c => c.leadId === activeId) ?? filtered[0] ?? null
  const unresponded = convos.filter(c => c.needsReply).length

  // The open thread counts as read — including when a new message arrives
  // while it's on screen.
  const activeLeadId = active?.leadId
  const activeLastAt = active?.last.at
  useEffect(() => {
    if (activeLeadId) markRead(activeLeadId)
  }, [activeLeadId, activeLastAt, markRead])
  const smsCount = convos.filter(c => c.items.some(i => i.kind === 'sms')).length
  const emailCount = convos.filter(c => c.items.some(i => i.kind === 'email')).length

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle="Every text and email, in one place"
        right={convos.length > 0 ? (
          <Segmented<Channel>
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'all', label: 'All', count: convos.length },
              { value: 'sms', label: 'Texts', count: smsCount },
              { value: 'email', label: 'Emails', count: emailCount },
            ]}
          />
        ) : undefined}
      />

      {convos.length === 0 ? (
        <Card>
          <EmptyState
            icon={<InboxIcon size={22} />}
            title="No conversations yet"
            subtitle="Inbound texts and email replies show up here automatically once a lead messages you back."
          />
        </Card>
      ) : (
        <div className="flex gap-4 h-[calc(100vh-190px)] min-h-[460px]">
          {/* Conversation list */}
          <Card className="w-[300px] shrink-0 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-line flex flex-col gap-2.5">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations…" className="pl-9" />
              </div>
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All', count: convos.length },
                  { value: 'unresponded', label: 'Needs reply', count: unresponded },
                ]}
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.map(c => {
                const isActive = active?.leadId === c.leadId
                const unread = isUnread(c)
                return (
                  <div
                    key={c.leadId}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveId(c.leadId)}
                    onKeyDown={e => { if (e.key === 'Enter') setActiveId(c.leadId) }}
                    className={cn('group w-full text-left px-3.5 py-3 border-b border-line flex items-start gap-3 transition-colors cursor-pointer', isActive ? 'bg-accent-soft' : 'hover:bg-[#f7f8fb]')}
                  >
                    <Avatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn('text-[13.5px] font-semibold m-0 truncate', isActive ? 'text-accent' : 'text-ink')}>{c.name}</p>
                        <span className="text-[11px] text-ink-3 shrink-0">{timeAgo(c.last.at)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {c.last.kind === 'sms' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[9.5px] font-bold uppercase tracking-wide bg-accent-soft text-accent shrink-0"><MessageSquare size={9} /> Text</span>
                        ) : (
                          <span className={cn('inline-flex items-center gap-1 px-1.5 py-px rounded text-[9.5px] font-bold uppercase tracking-wide shrink-0', EMAIL.soft)}><Mail size={9} /> Email</span>
                        )}
                        <p className="text-[12px] text-ink-3 m-0 truncate">
                          {c.last.dir === 'out' ? 'You: ' : ''}{c.last.text.replace(/\s+/g, ' ').slice(0, 46)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                      {unread && <span className="w-2 h-2 rounded-full bg-accent" title="Unread" />}
                      <div className="relative" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setMenuFor(menuFor === c.leadId ? null : c.leadId)}
                          title="Conversation options"
                          className={cn('w-6 h-6 rounded-md flex items-center justify-center text-ink-3 hover:bg-[#e9ebf2] hover:text-ink transition-all',
                            menuFor === c.leadId ? 'opacity-100 bg-[#e9ebf2]' : 'opacity-0 group-hover:opacity-100 focus:opacity-100')}
                        >
                          <MoreHorizontal size={15} />
                        </button>
                        {menuFor === c.leadId && (
                          <>
                            <div className="fixed inset-0 z-[110]" onClick={() => setMenuFor(null)} />
                            <div className="absolute right-0 top-7 z-[120] w-[190px] bg-card border border-line rounded-xl shadow-lg py-1 overflow-hidden">
                              <MenuItem
                                icon={unread ? <CheckCheck size={14} /> : <Circle size={12} />}
                                label={unread ? 'Mark as read' : 'Mark as unread'}
                                onClick={() => { if (unread) markRead(c.leadId); else markUnread(c.leadId); setMenuFor(null) }}
                              />
                              <MenuItem
                                icon={<ExternalLink size={14} />}
                                label="Open lead"
                                onClick={() => { setMenuFor(null); router.push(`/crm/leads/${c.leadId}`) }}
                              />
                              <div className="border-t border-line my-1" />
                              <MenuItem
                                danger
                                icon={<Trash2 size={14} />}
                                label="Delete conversation"
                                onClick={() => { setMenuFor(null); setDeleteFor(c) }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {filtered.length === 0 && <p className="text-[12.5px] text-ink-3 text-center pt-8">Nothing matches</p>}
            </div>
          </Card>

          {/* Thread */}
          {active ? (
            <Thread key={active.leadId} convo={active} onSent={() => router.refresh()} />
          ) : (
            <Card className="flex-1 flex items-center justify-center">
              <p className="text-[13px] text-ink-3">Select a conversation</p>
            </Card>
          )}
        </div>
      )}

      {/* Delete conversation confirm */}
      <Modal open={!!deleteFor} onClose={() => !deleting && setDeleteFor(null)} title="Delete this conversation?">
        <div className="flex flex-col gap-3">
          <p className="text-[13.5px] text-ink-2 m-0 leading-relaxed">
            This removes all {deleteFor?.items.length ?? 0} message{(deleteFor?.items.length ?? 0) === 1 ? '' : 's'} with{' '}
            <strong className="text-ink">{deleteFor?.name}</strong> from the inbox. The lead and their timeline notes stay —
            only the messages are deleted. This can&rsquo;t be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteFor(null)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={deleteConversation} loading={deleting}>
              <Trash2 size={14} /> Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn('w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] font-medium text-left transition-colors',
        danger ? 'text-bad hover:bg-[#fef2f2]' : 'text-ink-2 hover:bg-[#f5f6fa] hover:text-ink')}
    >
      {icon} {label}
    </button>
  )
}

function Thread({ convo, onSent }: { convo: Convo; onSent: () => void }) {
  const [channel, setChannel] = useState<'sms' | 'email'>(convo.phone ? 'sms' : 'email')
  const [text, setText] = useState('')
  const lastSubject = [...convo.items].reverse().find(i => i.kind === 'email' && i.subject)?.subject
  const [subject, setSubject] = useState(lastSubject ? (lastSubject.startsWith('Re:') ? lastSubject : `Re: ${lastSubject}`) : '')
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)

  // "AI draft" — the server reads the whole conversation + everything on
  // the lead + the company brain, then drops a draft here to edit & send.
  async function aiDraft() {
    if (drafting) return
    setDrafting(true)
    try {
      const res = await fetch('/api/inbox/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: convo.leadId, channel }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setText(d.body)
      if (channel === 'email' && d.subject && !subject.trim()) setSubject(d.subject)
      toast.success('Draft ready — edit and send')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }

  async function send() {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      if (channel === 'sms') {
        const res = await fetch('/api/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: convo.leadId, body: text.trim() }) })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        toast.success('Text sent')
      } else {
        if (!subject.trim()) { toast.error('Add a subject'); setSending(false); return }
        const res = await fetch('/api/emails/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: convo.leadId, subject: subject.trim(), body: text.trim() }) })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        toast.success('Email sent')
      }
      setText('')
      onSent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={convo.name} />
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold text-ink m-0 truncate">{convo.name}</p>
            <p className="text-[12px] text-ink-3 m-0 truncate">
              {convo.phone ? formatPhone(convo.phone) : ''}{convo.phone && convo.email ? ' · ' : ''}{convo.email ?? ''}
            </p>
          </div>
        </div>
        <Link href={`/crm/leads/${convo.leadId}`}>
          <Button variant="secondary" size="sm"><ExternalLink size={14} /> Open lead</Button>
        </Link>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 bg-[#fafbfe]">
        {convo.items.map(m => (
          <div key={m.key} className={cn('flex flex-col max-w-[76%]', m.dir === 'out' ? 'self-end items-end' : 'self-start items-start')}>
            {m.kind === 'email' && m.subject && (
              <span className={cn('text-[11px] font-semibold mb-1 flex items-center gap-1', EMAIL.text)}><Mail size={11} /> {m.subject}</span>
            )}
            <div className={cn('rounded-2xl px-3.5 py-2.5 text-[13.5px] whitespace-pre-wrap break-words',
              m.dir === 'out'
                ? cn(m.kind === 'sms' ? 'bg-accent' : EMAIL.solid, 'text-white rounded-br-sm')
                : cn('bg-white border text-ink rounded-bl-sm', m.kind === 'sms' ? 'border-[#c7d2fe]' : EMAIL.border))}>
              {m.text}
            </div>
            <span className="text-[10.5px] mt-1 flex items-center gap-1">
              {m.kind === 'sms' ? (
                <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide text-accent"><MessageSquare size={10} /> Text</span>
              ) : (
                <span className={cn('inline-flex items-center gap-1 font-bold uppercase tracking-wide', EMAIL.text)}><Mail size={10} /> Email</span>
              )}
              <span className="text-ink-3">· {timeAgo(m.at)}{m.status === 'failed' ? ' · failed' : ''}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Reply composer */}
      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          {convo.phone && (
            <ChannelBtn tone="sms" active={channel === 'sms'} onClick={() => setChannel('sms')} icon={<MessageSquare size={13} />} label="Text" />
          )}
          {convo.email && (
            <ChannelBtn tone="email" active={channel === 'email'} onClick={() => setChannel('email')} icon={<Mail size={13} />} label="Email" />
          )}
          {!convo.phone && !convo.email && <Pill tone="gray">No phone or email on file</Pill>}
          {(convo.phone || convo.email) && (
            <button
              onClick={aiDraft}
              disabled={drafting || sending}
              className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12.5px] font-semibold border border-accent/30 bg-accent-soft text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-60 disabled:hover:bg-accent-soft disabled:hover:text-accent"
              title="AI reads the whole conversation and this lead's profile, then drafts a reply for you to edit"
            >
              {drafting ? <Spinner size={13} /> : <Sparkles size={13} />} {drafting ? 'Drafting…' : 'AI draft'}
            </button>
          )}
        </div>
        {channel === 'email' && convo.email && (
          <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className="mb-2" />
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
            placeholder={channel === 'sms' ? 'Text your reply… (⌘↵ to send)' : 'Write your email… (⌘↵ to send)'}
            rows={2}
            className="flex-1 min-h-[46px]"
            disabled={!convo.phone && !convo.email}
          />
          <Button onClick={send} loading={sending} disabled={!text.trim() || (!convo.phone && !convo.email)}>
            <Send size={15} /> Send
          </Button>
        </div>
      </div>
    </Card>
  )
}

function ChannelBtn({ tone, active, onClick, icon, label }: { tone: 'sms' | 'email'; active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12.5px] font-semibold border transition-colors',
        active
          ? tone === 'sms' ? 'bg-accent-soft text-accent border-accent/30' : cn(EMAIL.soft, 'border-[#0d9488]/30')
          : 'bg-card text-ink-2 border-line hover:text-ink')}
    >
      {icon} {label}
    </button>
  )
}
