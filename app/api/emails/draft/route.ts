// POST /api/emails/draft
// Generates an AI email draft for a lead and saves it to email_drafts table.
// Body: { lead_id: string, trigger_type?: string, trigger_context?: object }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI, CONCIERGE_SYSTEM_PROMPT } from '@/lib/openai'
import type { Lead, LeadAddress, LeadActivity, EmailDraftTrigger } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const reqBody = await req.json()
    const { lead_id, trigger_type, trigger_context } = reqBody as {
      lead_id: string
      trigger_type?: EmailDraftTrigger
      trigger_context?: Record<string, unknown>
    }

    if (!lead_id) {
      return NextResponse.json({ error: 'lead_id is required' }, { status: 400 })
    }

    // Fetch lead with addresses + recent activities
    const [leadResult, addressResult, activityResult] = await Promise.all([
      supabase.from('leads').select('*').eq('id', lead_id).single(),
      supabase.from('lead_addresses').select('*').eq('lead_id', lead_id).order('is_primary', { ascending: false }),
      supabase.from('lead_activities').select('*').eq('lead_id', lead_id).order('created_at', { ascending: false }).limit(5),
    ])

    if (leadResult.error || !leadResult.data) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const lead = leadResult.data as Lead
    const addresses = (addressResult.data ?? []) as LeadAddress[]
    const recentActivities = (activityResult.data ?? []) as LeadActivity[]

    // Build context string for the AI
    const addressSummary = addresses.length > 0
      ? addresses.map(a =>
          `${a.label}: ${[a.street, a.city, a.state, a.zip].filter(Boolean).join(', ')}${a.notes ? ` (${a.notes})` : ''}`
        ).join('\n')
      : 'No specific properties on file'

    const activitySummary = recentActivities.length > 0
      ? recentActivities.map(a => `- ${a.type}: ${a.body ?? ""}`).join('\n')
      : 'No recent activity'

    const daysSinceContact = lead.last_contacted_at
      ? Math.floor((Date.now() - new Date(lead.last_contacted_at).getTime()) / 86400000)
      : null

    const triggerDescription: string = ({
      follow_up_due: `Their follow-up was due ${daysSinceContact ? `${daysSinceContact} days ago` : 'recently'}.`,
      stage_change: `They just moved to the "${lead.status}" stage.`,
      manual: 'The rep requested a manual draft.',
      sequence: 'This is part of an automated sequence.',
      ai_chat: 'The AI assistant suggested this outreach.',
    } as Record<string, string>)[trigger_type ?? 'manual'] ?? ''

    const userPrompt = `Write a follow-up email for this lead.

LEAD DETAILS:
- Name: ${lead.name}
- Email: ${lead.email ?? 'unknown'}
- Phone: ${lead.phone ?? 'not provided'}
- Current stage: ${lead.status}
- Source: ${lead.source ?? 'unknown'}
- Property interest: ${lead.property_interest ?? 'not specified'}
- Budget range: ${lead.budget_range ?? 'not specified'}
- Move-in/visit timeline: ${lead.move_in_timeline ?? 'not specified'}
- Days since last contact: ${daysSinceContact ?? 'never contacted'}

PROPERTIES THEY'VE MENTIONED:
${addressSummary}

RECENT ACTIVITY:
${activitySummary}

REASON FOR THIS EMAIL:
${triggerDescription}
${trigger_context ? `\nADDITIONAL CONTEXT:\n${JSON.stringify(trigger_context, null, 2)}` : ''}

Write the email in plain text (no HTML). Format as:
Subject: [subject line]

[email body]

Keep it warm, personal, concise — 3 short paragraphs max. End with an easy next step. Do not include a signature — that will be added separately.`

    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: CONCIERGE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 600,
    })

    const rawOutput = completion.choices[0]?.message?.content ?? ''

    // Parse subject line and body from output
    const subjectMatch = rawOutput.match(/^Subject:\s*(.+)$/m)
    const subject = subjectMatch ? subjectMatch[1].trim() : `Following up — ${lead.name}`
    const body = rawOutput.replace(/^Subject:.*$/m, '').trim()

    // Save draft to DB
    const { data: draft, error: insertError } = await supabase
      .from('email_drafts')
      .insert({
        lead_id,
        to_email: lead.email ?? '',
        to_name: lead.name,
        subject,
        body,
        // Snapshot the AI's original so edits made before sending can be
        // diffed and learned from (see lib/learn.ts).
        original_subject: subject,
        original_body: body,
        trigger_type: trigger_type ?? 'manual',
        trigger_context: trigger_context ?? null,
        status: 'pending',
        ai_generated: true,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Failed to save email draft:', insertError)
      return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
    }

    // Log activity
    await supabase.from('lead_activities').insert({
      lead_id,
      type: 'ai_draft',
      body: `AI draft created: "${subject}"`,
      metadata: { draft_id: draft.id, trigger_type },
      user_id: user.id,
    })

    return NextResponse.json({ draft }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/emails/draft]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
