// POST /api/emails/draft-batch
// Generate AI drafts for all active leads that don't have a pending draft.
// Body: { max?: number } (default 10)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI, CONCIERGE_SYSTEM_PROMPT } from '@/lib/openai'
import { buildAIContext } from '@/lib/ai-context'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { max = 10 } = await req.json().catch(() => ({})) as { max?: number }

    // Find active leads without pending drafts that have email addresses
    const { data: leads } = await supabase
      .from('leads')
      .select('id, name, email, phone, status, source, property_interest, budget_range, move_in_timeline, last_contacted_at, next_follow_up_at')
      .not('status', 'in', '("closed_won","closed_lost")')
      .not('email', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50)

    if (!leads || leads.length === 0) {
      return NextResponse.json({ generated: 0, message: 'No eligible leads found' })
    }

    // Get leads that already have pending drafts
    const { data: existingDrafts } = await supabase
      .from('email_drafts')
      .select('lead_id')
      .eq('status', 'pending')

    const leadsWithDrafts = new Set((existingDrafts ?? []).map(d => d.lead_id))
    const eligibleLeads = leads.filter(l => !leadsWithDrafts.has(l.id)).slice(0, max)

    if (eligibleLeads.length === 0) {
      return NextResponse.json({ generated: 0, message: 'All leads already have pending drafts' })
    }

    // Build global context once (without pipeline since we're iterating leads)
    const globalContext = await buildAIContext(supabase, { include_pipeline: false })

    const results = []
    for (const lead of eligibleLeads) {
      try {
        const daysSince = lead.last_contacted_at
          ? Math.floor((Date.now() - new Date(lead.last_contacted_at).getTime()) / 86400000)
          : null

        const trigger = lead.next_follow_up_at && new Date(lead.next_follow_up_at) < new Date()
          ? 'follow_up_due'
          : lead.last_contacted_at === null
          ? 'never_contacted'
          : 'follow_up_due'

        const prompt = `${globalContext}

---

Write a follow-up email for this lead.

LEAD: ${lead.name}
Email: ${lead.email}
Stage: ${lead.status}
Source: ${lead.source ?? 'unknown'}
Budget: ${lead.budget_range ?? 'not specified'}
Timeline: ${lead.move_in_timeline ?? 'not specified'}
Days since last contact: ${daysSince ?? 'never contacted'}
${trigger === 'never_contacted' ? '\nThis lead has never been contacted. Write a warm first-touch outreach.' : '\nThis lead needs a follow-up. Keep it brief and personal.'}

Format your response as:
Subject: [subject line]

[email body — 3 short paragraphs max]`

        const completion = await getOpenAI().chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: CONCIERGE_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 500,
        })

        const raw = completion.choices[0]?.message?.content ?? ''
        const subjectMatch = raw.match(/^Subject:\s*(.+)$/m)
        const subject = subjectMatch ? subjectMatch[1].trim() : `Following up — ${lead.name}`
        const body = raw.replace(/^Subject:.*$/m, '').trim()

        const { data: draft } = await supabase.from('email_drafts').insert({
          lead_id: lead.id,
          to_email: lead.email,
          to_name: lead.name,
          subject,
          body,
          original_subject: subject,
          original_body: body,
          trigger_type: trigger,
          trigger_context: { days_since_contact: daysSince },
          status: 'pending',
          ai_generated: true,
        }).select().single()

        if (draft) results.push({ lead_name: lead.name, draft_id: draft.id })
      } catch (err) {
        console.error(`Failed draft for ${lead.name}:`, err)
      }
    }

    return NextResponse.json({ generated: results.length, drafts: results })
  } catch (err) {
    console.error('[POST /api/emails/draft-batch]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
