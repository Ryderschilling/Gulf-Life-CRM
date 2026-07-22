// ============================================================
// POST /api/email/poll — pull new inbound email from the Gulf Life
// mailbox (Gmail IMAP) into the CRM.
//
// Called by the Inbox UI on load + every 60s while open. Safe to
// call as often as you like:
//   - only reads the last 7 days of INBOX
//   - only ingests mail whose From matches a lead's email
//     (a shared mailbox gets newsletters/spam — those never
//      become CRM records, and we never auto-create leads here)
//   - dedupes on Message-ID, and never flags/moves anything in
//     the real mailbox, so Gmail unread state is untouched.
// ============================================================

import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createClient } from '@/lib/supabase/server'
import { mailerConfigured } from '@/lib/mailer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const WINDOW_DAYS = 7
const MAX_PER_POLL = 25

function addr(a?: string | null): string {
  return (a ?? '').trim().toLowerCase()
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!mailerConfigured()) {
    return NextResponse.json({ ok: false, reason: 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD)' })
  }

  // Leads we can match inbound mail to
  const { data: leads } = await supabase
    .from('leads').select('id, email').not('email', 'is', null).limit(5000)
  const byEmail = new Map<string, string>()
  for (const l of leads ?? []) {
    const e = addr(l.email)
    if (e && !byEmail.has(e)) byEmail.set(e, l.id)
  }
  if (byEmail.size === 0) return NextResponse.json({ ok: true, ingested: 0 })

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER!, pass: process.env.GMAIL_APP_PASSWORD! },
    logger: false,
  })

  let ingested = 0
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
      const uids = await client.search({ since }, { uid: true })
      if (!uids || uids.length === 0) return NextResponse.json({ ok: true, ingested: 0 })

      // Pass 1 — envelopes only: find mail from known leads
      const candidates: { uid: number; leadId: string; messageId: string; date: Date | undefined; subject: string; from: string }[] = []
      for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
        const from = addr(msg.envelope?.from?.[0]?.address)
        const leadId = from ? byEmail.get(from) : undefined
        if (!leadId) continue
        candidates.push({
          uid: msg.uid,
          leadId,
          messageId: msg.envelope?.messageId ?? `imap-uid-${msg.uid}`,
          date: msg.envelope?.date ?? undefined,
          subject: msg.envelope?.subject ?? '',
          from,
        })
      }
      if (candidates.length === 0) return NextResponse.json({ ok: true, ingested: 0 })

      // Dedupe against already-ingested Message-IDs
      const ids = candidates.map(c => c.messageId)
      const { data: existing } = await supabase
        .from('lead_activities')
        .select('metadata')
        .eq('type', 'email_received')
        .in('metadata->>message_id', ids)
      const seen = new Set((existing ?? []).map(r => (r.metadata as Record<string, unknown> | null)?.message_id as string))
      const fresh = candidates.filter(c => !seen.has(c.messageId)).slice(0, MAX_PER_POLL)

      // Pass 2 — download + parse only the new ones
      for (const c of fresh) {
        const dl = await client.download(String(c.uid), undefined, { uid: true })
        if (!dl?.content) continue
        const parsed = await simpleParser(dl.content)
        const text = (parsed.text ?? '').trim().slice(0, 5000)
        const { error } = await supabase.from('lead_activities').insert({
          lead_id: c.leadId,
          type: 'email_received',
          body: text || '[no text body]',
          metadata: { subject: c.subject, from: c.from, message_id: c.messageId },
          created_at: (c.date ?? new Date()).toISOString(),
        })
        if (!error) ingested++
      }
    } finally {
      lock.release()
    }
  } catch (err) {
    console.error('[POST /api/email/poll]', err)
    return NextResponse.json({ ok: false, reason: err instanceof Error ? err.message : 'IMAP error' })
  } finally {
    try { await client.logout() } catch { /* already closed */ }
  }

  return NextResponse.json({ ok: true, ingested })
}
