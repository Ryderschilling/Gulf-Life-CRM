// ============================================================
// POST /api/webhooks/resend — inbound email from Resend.
// Setup: Resend → Receiving (add MX on your receiving domain),
// then Webhooks → add this URL, event `email.received`.
// Outbound emails set Reply-To = RESEND_REPLY_TO so client
// replies route back here. Set RESEND_WEBHOOK_SECRET to verify.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// Svix signature verification (Resend uses Svix).
// signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
// header `svix-signature` = space-separated list of `v1,<base64sig>`.
function verifySvix(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get('svix-id')
  const ts = headers.get('svix-timestamp')
  const sigHeader = headers.get('svix-signature')
  if (!id || !ts || !sigHeader) return false
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64')
    return sigHeader.split(' ').some(part => {
      const sig = part.split(',')[1] ?? part
      const a = Buffer.from(sig)
      const b = Buffer.from(expected)
      return a.length === b.length && crypto.timingSafeEqual(a, b)
    })
  } catch {
    return false
  }
}

function parseAddress(addr: string): string {
  // "Name <email@x.com>" → email@x.com
  const m = addr.match(/<([^>]+)>/)
  return (m ? m[1] : addr).trim().toLowerCase()
}

async function fetchReceivedEmail(emailId: string): Promise<{ text?: string; html?: string; subject?: string; from?: string } | null> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()

  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (secret) {
    if (!verifySvix(raw, req.headers, secret)) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
    }
  }

  let evt: { type?: string; created_at?: string; data?: Record<string, unknown> }
  try {
    evt = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: true })
  }

  if (evt.type !== 'email.received') return NextResponse.json({ ok: true })

  const data = (evt.data ?? {}) as { email_id?: string; from?: string; subject?: string }
  const fromEmail = data.from ? parseAddress(String(data.from)) : ''
  if (!fromEmail) return NextResponse.json({ ok: true })

  try {
    const supabase = createServiceClient()

    // Pull the full body (webhook only carries metadata)
    const full = data.email_id ? await fetchReceivedEmail(data.email_id) : null
    const subject = full?.subject ?? data.subject ?? '(no subject)'
    const bodyText = (full?.text ?? '').trim() || (full?.html ? '[HTML email — open in Inbox]' : '')

    // Match to an existing lead by email, else capture as a new inbound lead
    let leadId: string | null = null
    const { data: match } = await supabase.from('leads').select('id').ilike('email', fromEmail).limit(1)
    if (match && match.length > 0) leadId = match[0].id

    if (!leadId) {
      const { data: created } = await supabase.from('leads').insert({
        lead_type: 'owner',
        name: fromEmail.split('@')[0],
        email: fromEmail,
        status: 'new',
        source: 'inbound_email',
        tags: ['inbound'],
      }).select('id').single()
      leadId = created?.id ?? null
    }

    if (leadId) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        type: 'email_received',
        body: `Email received — ${subject}\n\n${bodyText}`.slice(0, 4000),
        metadata: { subject, from: fromEmail, email_id: data.email_id ?? null },
      })
    }
  } catch (err) {
    console.error('[POST /api/webhooks/resend]', err)
  }

  return NextResponse.json({ ok: true })
}
