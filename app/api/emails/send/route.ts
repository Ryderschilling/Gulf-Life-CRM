// POST /api/emails/send
// Two modes:
//   1. Review-queue send:  { draft_id, subject?, body? }  → sends an existing draft
//   2. Direct send:        { lead_id, subject, body }     → composes + sends now
// Reply-To is set to RESEND_REPLY_TO so client replies route back to the CRM.
// The email body is sent as-is (the drafted/typed body already contains the
// signature from the Communication Style brain file — no auto-append here).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getResend, FROM, REPLY_TO } from '@/lib/resend'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await req.json() as {
      draft_id?: string
      lead_id?: string
      subject?: string
      body?: string
    }

    const resend = getResend()
    if (!resend) {
      return NextResponse.json({ error: 'Email sending is not configured (RESEND_API_KEY missing)' }, { status: 400 })
    }

    const now = new Date().toISOString()

    // ── Mode 2: direct compose + send (used by the Inbox reply box) ──
    if (!payload.draft_id) {
      const { lead_id, subject, body } = payload
      if (!lead_id || !subject?.trim() || !body?.trim()) {
        return NextResponse.json({ error: 'lead_id, subject and body are required' }, { status: 400 })
      }
      const { data: lead } = await supabase.from('leads').select('id, name, email').eq('id', lead_id).single()
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      if (!lead.email) return NextResponse.json({ error: `${lead.name} has no email address` }, { status: 422 })

      const { data: sent, error: sendError } = await resend.emails.send({
        from: FROM,
        to: [lead.email],
        subject: subject.trim(),
        text: body.trim(),
        ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
      })
      if (sendError) {
        return NextResponse.json({ error: 'Failed to send email', details: sendError }, { status: 502 })
      }

      await Promise.all([
        supabase.from('leads').update({ last_contacted_at: now }).eq('id', lead_id),
        supabase.from('lead_activities').insert({
          lead_id, type: 'email_sent', user_id: user.id,
          body: `Email sent: "${subject.trim()}"`,
          metadata: { resend_id: sent?.id },
        }),
      ])
      return NextResponse.json({ success: true, resend_id: sent?.id })
    }

    // ── Mode 1: send an existing draft from the review queue ──
    const { draft_id, subject: editedSubject, body: editedBody } = payload

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

    const { data: sent, error: sendError } = await resend.emails.send({
      from: FROM,
      to: [draft.to_email],
      subject: finalSubject,
      text: finalBody,
      ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    })

    if (sendError) {
      console.error('Resend error:', sendError)
      return NextResponse.json({ error: 'Failed to send email', details: sendError }, { status: 502 })
    }

    await supabase
      .from('email_drafts')
      .update({ status: 'sent', subject: finalSubject, body: finalBody, sent_at: now, sent_by: user.id })
      .eq('id', draft_id)

    await supabase.from('leads').update({ last_contacted_at: now }).eq('id', draft.lead_id)

    await supabase.from('lead_activities').insert({
      lead_id: draft.lead_id,
      type: 'email_sent',
      body: `Email sent: "${finalSubject}"`,
      metadata: { draft_id, resend_id: sent?.id },
      user_id: user.id,
    })

    await supabase
      .from('todos')
      .update({ is_completed: true, completed_at: now, is_archived: true, archived_at: now })
      .eq('linked_draft_id', draft_id)
      .eq('is_completed', false)

    return NextResponse.json({ success: true, resend_id: sent?.id })
  } catch (err) {
    console.error('[POST /api/emails/send]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
