// ============================================================
// POST /api/webhooks/quo — inbound SMS + delivery receipts from Quo.
// Register in Quo → Settings → Webhooks (events: message.received,
// message.delivered) pointing at https://<domain>/api/webhooks/quo.
// Set QUO_WEBHOOK_SECRET (Quo "Reveal signing secret") to verify.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// Quo (OpenPhone) signature: header `openphone-signature`
// format `<scheme>;<version>;<timestamp>;<base64-signature>`
// signedData = `${timestamp}.${rawBody}` · HMAC-SHA256 with base64-decoded key.
function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false
  const parts = header.split(';')
  if (parts.length < 4) return false
  const timestamp = parts[2]
  const provided = parts[3]
  try {
    const key = Buffer.from(secret, 'base64')
    const digest = crypto.createHmac('sha256', key).update(`${timestamp}.${rawBody}`).digest('base64')
    const a = Buffer.from(digest)
    const b = Buffer.from(provided)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function last10(p?: string | null): string | null {
  if (!p) return null
  const d = String(p).replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

function formatPhone(p: string): string {
  const d = p.replace(/\D/g, '')
  const t = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : p
}

export async function POST(req: NextRequest) {
  const raw = await req.text()

  const secret = process.env.QUO_WEBHOOK_SECRET
  if (secret) {
    if (!verifySignature(raw, req.headers.get('openphone-signature'), secret)) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
    }
  }

  let evt: { type?: string; createdAt?: string; data?: { object?: Record<string, unknown> } }
  try {
    evt = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: true }) // ack malformed bodies, don't retry
  }

  const type = evt.type
  const obj = (evt.data?.object ?? {}) as {
    id?: string; from?: string; to?: string; body?: string
    direction?: string; media?: { url: string; type: string }[]
  }

  try {
    const supabase = createServiceClient()

    // ── Inbound text ─────────────────────────────────────────
    if (type === 'message.received' && obj.direction === 'incoming') {
      const from = String(obj.from ?? '')
      const text = String(obj.body ?? '')
      if (!from) return NextResponse.json({ ok: true })

      const key = last10(from)
      let leadId: string | null = null

      if (key) {
        const { data } = await supabase.from('leads').select('id, phone').not('phone', 'is', null).limit(5000)
        const hit = (data ?? []).find((l: { phone: string | null }) => last10(l.phone) === key)
        if (hit) leadId = hit.id
      }

      // Unknown number → capture it as a new inbound lead so nothing is lost
      if (!leadId) {
        const { data: created } = await supabase.from('leads').insert({
          lead_type: 'owner',
          name: formatPhone(from),
          phone: from,
          status: 'new',
          source: 'inbound_sms',
          tags: ['inbound'],
        }).select('id').single()
        leadId = created?.id ?? null
      }

      if (leadId) {
        await supabase.from('sms_messages').insert({
          lead_id: leadId,
          to_phone: from,
          body: text || (obj.media?.length ? '[media attachment]' : ''),
          status: 'received',
          provider: 'quo',
          provider_id: obj.id ?? null,
          direction: 'inbound',
          created_at: evt.createdAt ?? new Date().toISOString(),
        })
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          type: 'sms_received',
          body: `Text received: "${text.slice(0, 120)}"`,
        })
      }
    }

    // ── Delivery receipt for an outbound text ────────────────
    else if (type === 'message.delivered' && obj.id) {
      await supabase.from('sms_messages').update({ status: 'delivered' }).eq('provider_id', obj.id)
    }
  } catch (err) {
    console.error('[POST /api/webhooks/quo]', err)
    // Still 200 so Quo doesn't hammer retries; we logged it.
  }

  return NextResponse.json({ ok: true })
}
