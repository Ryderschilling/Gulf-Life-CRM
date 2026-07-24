// POST /api/sms/send
// Sends a text via Quo (formerly OpenPhone) and logs it.
// Body: { lead_id: string, body: string }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendQuoSms, quoConfigured } from '@/lib/quo'
import { toE164 } from '@/lib/utils'
import { markContacted } from '@/lib/pipeline'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { lead_id, body } = await req.json() as { lead_id: string; body: string }
    if (!lead_id || !body?.trim()) {
      return NextResponse.json({ error: 'lead_id and body are required' }, { status: 400 })
    }

    if (!quoConfigured()) {
      return NextResponse.json({ error: 'Texting is not set up yet — add the Quo API key in Settings.' }, { status: 400 })
    }

    const { data: lead } = await supabase.from('leads').select('id, name, phone').eq('id', lead_id).single()
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const to = toE164(lead.phone)
    if (!to) return NextResponse.json({ error: `${lead.name} doesn't have a valid phone number` }, { status: 400 })

    const result = await sendQuoSms(to, body.trim())

    // Log regardless of outcome
    await supabase.from('sms_messages').insert({
      lead_id,
      to_phone: to,
      body: body.trim(),
      status: result.ok ? 'sent' : 'failed',
      provider: 'quo',
      provider_id: result.id ?? null,
      sent_at: result.ok ? new Date().toISOString() : null,
      created_by: user.id,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Send failed' }, { status: 502 })
    }

    await Promise.all([
      // Stamps last_contacted_at AND advances new → contacted on first outbound text.
      markContacted(supabase, lead_id, user.id),
      supabase.from('lead_activities').insert({
        lead_id, user_id: user.id, type: 'sms_sent',
        body: `Text sent: "${body.trim().slice(0, 100)}"`,
      }),
    ])

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[POST /api/sms/send]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
