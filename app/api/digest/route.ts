// GET  /api/digest          — fetch today's digest (generates if missing)
// POST /api/digest          — force regenerate today's digest
// Both return: { digest: DailyDigest }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI, CONCIERGE_SYSTEM_PROMPT } from '@/lib/openai'
import { todayStr, endOfTodayISO, startOfMonthISO, followUpStatus, daysOverdue, timeOfDayGreeting } from '@/lib/dates'
import type { Lead, DigestContent, DigestStats } from '@/lib/types'

/** Swap any "[Your Name]"-style placeholder in generated copy for the real
 *  signed-in user so the suggested messages are paste-ready. */
function fillName(text: string, userName: string): string {
  return text.replace(/\[\s*(your\s*name|name|first\s*name|sender(\s*name)?)\s*\]/gi, userName)
}

async function generateDigest(supabase: Awaited<ReturnType<typeof createClient>>, userName: string) {
  const now = new Date()
  const oneWeekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
  const startOfMonth = startOfMonthISO() // CRM-local calendar month — same rule as the Won This Month stat cards
  const greeting = timeOfDayGreeting()

  // Pull all the data we need in parallel
  const [
    allLeadsResult,
    followUpDueResult,
    pendingDraftsResult,
    wonThisMonthResult,
    newThisWeekResult,
  ] = await Promise.all([
    supabase.from('leads').select('*').eq('lead_type', 'owner').eq('relationship', 'prospect').not('status', 'in', '("closed_won","closed_lost")'),
    supabase.from('leads').select('*').eq('lead_type', 'owner').eq('relationship', 'prospect').lte('next_follow_up_at', endOfTodayISO()).not('status', 'in', '("closed_won","closed_lost")').order('next_follow_up_at', { ascending: true }),
    supabase.from('email_drafts').select('count').eq('status', 'pending').single(),
    supabase.from('leads').select('count').eq('lead_type', 'owner').eq('relationship', 'prospect').eq('status', 'closed_won').gte('updated_at', startOfMonth).single(),
    supabase.from('leads').select('count').eq('lead_type', 'owner').eq('relationship', 'prospect').gte('created_at', oneWeekAgo).single(),
  ])

  const allLeads = (allLeadsResult.data ?? []) as Lead[]
  const followUpLeads = (followUpDueResult.data ?? []) as Lead[]
  const pendingDraftCount = (pendingDraftsResult.data as { count: number } | null)?.count ?? 0
  const wonThisMonth = (wonThisMonthResult.data as { count: number } | null)?.count ?? 0
  const newThisWeek = (newThisWeekResult.data as { count: number } | null)?.count ?? 0

  const stats: DigestStats = {
    total_leads: allLeads.length,
    new_this_week: newThisWeek,
    pending_follow_ups: followUpLeads.length,
    pending_email_drafts: pendingDraftCount,
    proposals_out: allLeads.filter(l => l.status === 'proposal').length,
    won_this_month: wonThisMonth,
  }

  // Select top priority leads for the AI
  // Sort by: overdue follow-ups first, then proposals, then nurturing, then new
  const priorityOrder: Record<string, number> = {
    proposal: 0,
    nurturing: 1,
    contacted: 2,
    new: 3,
  }

  const topLeads = [...allLeads]
    .filter(l => !['closed_won', 'closed_lost'].includes(l.status))
    .sort((a, b) => {
      const aOverdue = followUpStatus(a.next_follow_up_at) === 'overdue' ? -1 : 0
      const bOverdue = followUpStatus(b.next_follow_up_at) === 'overdue' ? -1 : 0
      if (aOverdue !== bOverdue) return aOverdue - bOverdue
      return (priorityOrder[a.status] ?? 9) - (priorityOrder[b.status] ?? 9)
    })
    .slice(0, 8) // Send top 8 to AI, it picks 5

  if (topLeads.length === 0) {
    // No leads — return a simple digest
    const emptyContent: DigestContent = {
      greeting: `${greeting}! Here's your overview for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' })}.`,
      summary: 'No active leads in the pipeline right now. Great time to prospect and add new leads.',
      priority_leads: [],
      stats,
      action_items: ['Add new leads to the pipeline', 'Check in with past clients for referrals'],
    }
    return emptyContent
  }

  const leadsForAI = topLeads.map(l => {
    const daysSince = l.last_contacted_at
      ? Math.floor((now.getTime() - new Date(l.last_contacted_at).getTime()) / 86400000)
      : null
    const followUpOverdue = l.next_follow_up_at && followUpStatus(l.next_follow_up_at) === 'overdue'
      ? daysOverdue(l.next_follow_up_at)
      : null
    return {
      id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      status: l.status,
      property_interest: l.property_interest,
      budget_range: l.budget_range,
      move_in_timeline: l.move_in_timeline,
      days_since_last_contact: daysSince,
      follow_up_overdue_days: followUpOverdue,
    }
  })

  const aiPrompt = `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' })}.

This briefing is for ${userName}. Sign each "suggested_message" as ${userName} — do not leave a name placeholder in the copy.

Here are the top leads that need attention today for Gulf Life Concierge. Pick the 5 most important and create a structured daily briefing.

PIPELINE STATS:
- Total active leads: ${stats.total_leads}
- New this week: ${stats.new_this_week}
- Follow-ups overdue: ${stats.pending_follow_ups}
- Pending email drafts: ${stats.pending_email_drafts}
- Proposals out: ${stats.proposals_out}
- Won this month: ${stats.won_this_month}

LEADS TO PRIORITIZE:
${JSON.stringify(leadsForAI, null, 2)}

Return a JSON object with this exact structure (no markdown, just raw JSON):
{
  "greeting": "${greeting}! [1 sentence overview of the day]",
  "summary": "[2-3 sentence summary of what needs attention today and the overall pipeline health]",
  "priority_leads": [
    {
      "lead_id": "uuid",
      "lead_name": "Name",
      "lead_email": "email or null",
      "lead_phone": "phone or null",
      "current_status": "status",
      "reason": "Why this person needs attention today (1 sentence)",
      "suggested_action": "Call / Send email / Text / Schedule tour",
      "suggested_message": "The exact thing to say or write to this person (2-4 sentences, warm Gulf Life tone)",
      "urgency": "high | medium | low",
      "days_since_contact": number or null
    }
  ],
  "action_items": ["Action 1", "Action 2", "Action 3"]
}`

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: CONCIERGE_SYSTEM_PROMPT },
      { role: 'user', content: aiPrompt },
    ],
    temperature: 0.5,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  })

  const rawJson = completion.choices[0]?.message?.content ?? '{}'
  const aiContent = JSON.parse(rawJson) as Partial<DigestContent>

  const content: DigestContent = {
    greeting: fillName(aiContent.greeting ?? `${greeting}! Here's your briefing for today.`, userName),
    summary: fillName(aiContent.summary ?? '', userName),
    priority_leads: (aiContent.priority_leads ?? []).map(pl => ({
      ...pl,
      suggested_message: fillName(pl.suggested_message ?? '', userName),
    })),
    stats,
    action_items: (aiContent.action_items ?? []).map(a => fillName(a, userName)),
  }

  return content
}

/** The signed-in user's display name (same fallback chain as the sidebar). */
async function getUserName(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, email?: string | null): Promise<string> {
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).single()
  const rawName = (profile?.full_name ?? '') as string
  if (rawName && !rawName.includes('@')) return rawName
  const fromEmail = email?.split('@')[0] ?? ''
  return fromEmail ? fromEmail.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'The Gulf Life Team'
}

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if today's digest already exists
    const { data: existing } = await supabase
      .from('daily_digests')
      .select('*')
      .eq('digest_date', todayStr())
      .eq('digest_type', 'sales_rep')
      .single()

    if (existing) {
      return NextResponse.json({ digest: existing })
    }

    // Generate and cache
    const userName = await getUserName(supabase, user.id, user.email)
    const content = await generateDigest(supabase, userName)

    const { data: digest, error } = await supabase
      .from('daily_digests')
      .upsert({
        digest_date: todayStr(),
        digest_type: 'sales_rep',
        content,
      }, { onConflict: 'digest_date,digest_type' })
      .select()
      .single()

    if (error) {
      console.error('Failed to save digest:', error)
      return NextResponse.json({ error: 'Failed to generate digest' }, { status: 500 })
    }

    return NextResponse.json({ digest })
  } catch (err) {
    console.error('[GET /api/digest]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // Force regenerate — deletes existing and creates fresh
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Delete existing digest for today
    await supabase
      .from('daily_digests')
      .delete()
      .eq('digest_date', todayStr())
      .eq('digest_type', 'sales_rep')

    const userName = await getUserName(supabase, user.id, user.email)
    const content = await generateDigest(supabase, userName)

    const { data: digest, error } = await supabase
      .from('daily_digests')
      .insert({
        digest_date: todayStr(),
        digest_type: 'sales_rep',
        content,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: 'Failed to save digest' }, { status: 500 })
    }

    return NextResponse.json({ digest })
  } catch (err) {
    console.error('[POST /api/digest]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
