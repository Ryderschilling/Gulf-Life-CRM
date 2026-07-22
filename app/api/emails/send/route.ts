// POST /api/emails/send
// Rep has reviewed and edited the draft — send it via Resend.
// Body: { draft_id: string, subject?: string, body?: string }
// Auto-completes any linked todo when the email is sent.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getResend, FROM } from '@/lib/resend'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { draft_id, subject: editedSubject, body: editedBody } = body as {
      draft_id: string
      subject?: string
      body?: string
    }

    if (!draft_id) {
      return NextResponse.json({ error: 'draft_id is required' }, { status: 400 })
    }

    // Fetch the draft
    const { data: draft, error: fetchError } = await supabase
      .from('email_drafts')
      .select('*, lead:leads(*)')
      .eq('id', draft_id)
      .single()

    if (fetchError || !draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    if (draft.status !== 'pending') {
      return NextResponse.json({ error: `Draft already ${draft.status}` }, { status: 409 })
    }

    if (!draft.to_email) {
      return NextResponse.json({ error: 'Lead has no email address' }, { status: 422 })
    }

    const finalSubject = editedSubject ?? draft.subject
    const finalBody = editedBody ?? draft.body

    // Build plain-text email with a simple signature
    const emailText = `${finalBody}

---
Gulf Life Concierge
📞 Contact us anytime
🌊 livegulflife.com`

    // Send via Resend
    const resend = getResend()
    if (!resend) {
      return NextResponse.json({ error: 'Email sending is not configured (RESEND_API_KEY missing)' }, { status: 400 })
    }
    const { data: sent, error: sendError } = await resend.emails.send({
      from: FROM,
      to: [draft.to_email],
      subject: finalSubject,
      text: emailText,
    })

    if (sendError) {
      console.error('Resend error:', sendError)
      return NextResponse.json({ error: 'Failed to send email', details: sendError }, { status: 502 })
    }

    const now = new Date().toISOString()

    // Mark draft as sent
    await supabase
      .from('email_drafts')
      .update({
        status: 'sent',
        subject: finalSubject,
        body: finalBody,
        sent_at: now,
        sent_by: user.id,
      })
      .eq('id', draft_id)

    // Update lead's last_contacted_at
    await supabase
      .from('leads')
      .update({ last_contacted_at: now })
      .eq('id', draft.lead_id)

    // Log activity
    await supabase.from('lead_activities').insert({
      lead_id: draft.lead_id,
      type: 'email_sent',
      body: `Email sent: "${finalSubject}"`,
      metadata: { draft_id, resend_id: sent?.id },
      user_id: user.id,
    })

    // Auto-complete any todos linked to this draft
    await supabase
      .from('todos')
      .update({
        is_completed: true,
        completed_at: now,
        is_archived: true,
        archived_at: now,
      })
      .eq('linked_draft_id', draft_id)
      .eq('is_completed', false)

    return NextResponse.json({ success: true, resend_id: sent?.id })
  } catch (err) {
    console.error('[POST /api/emails/send]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
