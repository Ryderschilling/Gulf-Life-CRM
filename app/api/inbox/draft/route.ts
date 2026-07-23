// ============================================================
// POST /api/inbox/draft — { lead_id, channel: 'sms' | 'email' }
// The Inbox "AI draft" button. Reads the ENTIRE conversation
// (texts + emails), the full lead profile (stage, source, notes,
// recent activity), and the company brain (knowledge base, tone,
// style corrections, lead memories) — then drafts the next reply
// in Gulf Life's voice. Returned text lands in the compose box
// for the human to edit and send; nothing is sent automatically.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { buildAIContext } from '@/lib/ai-context'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface ThreadItem { at: string; channel: 'text' | 'email'; dir: 'in' | 'out'; body: string; subject?: string }

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'AI is not configured (OPENAI_API_KEY missing)' }, { status: 400 })
    }

    const { lead_id, channel } = await req.json() as { lead_id?: string; channel?: 'sms' | 'email' }
    if (!lead_id || (channel !== 'sms' && channel !== 'email')) {
      return NextResponse.json({ error: 'lead_id and channel (sms|email) are required' }, { status: 400 })
    }

    // ── Lead profile + conversation, in parallel ─────────────
    const [{ data: lead }, { data: sms }, { data: emails }, { data: notes }, aiContext] = await Promise.all([
      supabase.from('leads').select('*').eq('id', lead_id).single(),
      supabase.from('sms_messages').select('body, direction, created_at').eq('lead_id', lead_id).order('created_at', { ascending: true }).limit(80),
      supabase.from('lead_activities').select('type, body, metadata, created_at').eq('lead_id', lead_id).in('type', ['email_sent', 'email_received']).order('created_at', { ascending: true }).limit(40),
      supabase.from('lead_notes').select('body, created_at').eq('lead_id', lead_id).order('created_at', { ascending: false }).limit(10),
      buildAIContext(supabase, { lead_id, include_pipeline: false }),
    ])
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // ── Merge the two channels into one chronological thread ─
    const thread: ThreadItem[] = [
      ...(sms ?? []).map(m => ({
        at: m.created_at, channel: 'text' as const,
        dir: m.direction === 'inbound' ? 'in' as const : 'out' as const,
        body: m.body,
      })),
      ...(emails ?? []).map(e => {
        const meta = (e.metadata ?? {}) as { subject?: string }
        return {
          at: e.created_at, channel: 'email' as const,
          dir: e.type === 'email_received' ? 'in' as const : 'out' as const,
          body: e.body, subject: meta.subject,
        }
      }),
    ].sort((a, b) => a.at.localeCompare(b.at))

    const transcript = thread.length === 0
      ? '(no messages yet — this is the first outreach)'
      : thread.map(t => {
          const who = t.dir === 'in' ? lead.name : 'Us (Gulf Life)'
          const tag = t.channel === 'email' ? `EMAIL${t.subject ? ` "${t.subject}"` : ''}` : 'TEXT'
          return `[${new Date(t.at).toLocaleString('en-US')}] ${who} (${tag}): ${t.body}`
        }).join('\n')

    const profile = [
      `Name: ${lead.name}`,
      lead.company ? `Company: ${lead.company}` : null,
      `Pipeline stage: ${lead.status}`,
      lead.source ? `Source: ${lead.source}` : null,
      lead.property_interest ? `Property interest: ${lead.property_interest}` : null,
      lead.last_contacted_at ? `Last contacted: ${new Date(lead.last_contacted_at).toLocaleDateString('en-US')}` : null,
      (notes ?? []).length > 0 ? `Notes:\n${(notes ?? []).map(n => `- ${n.body}`).join('\n')}` : null,
    ].filter(Boolean).join('\n')

    const channelRules = channel === 'sms'
      ? `Draft the next TEXT MESSAGE reply. Rules: conversational texting register, warm but professional, under 320 characters, no signature, no greeting like "Dear", match the energy of the thread.`
      : `Draft the next EMAIL reply. Rules: proper email with a natural greeting and sign-off per the communication style in the knowledge base. Plain text only. Also produce a fitting subject line (use "Re: ..." if replying within an existing email thread).`

    const openai = getOpenAI()
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${aiContext}\n\nYou draft replies for Gulf Life Concierge that a team member will review, edit, and send. Never invent facts, prices, or commitments not supported by the knowledge base or conversation. If the right next step is unclear, draft something helpful that moves the relationship forward.\n\n${channelRules}\n\nRespond with JSON: {"body": "..."${channel === 'email' ? ', "subject": "..."' : ''}}`,
        },
        {
          role: 'user',
          content: `LEAD PROFILE\n${profile}\n\nFULL CONVERSATION (oldest first)\n${transcript}\n\nDraft our next ${channel === 'sms' ? 'text' : 'email'} reply to ${lead.name}.`,
        },
      ],
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    let parsed: { body?: string; subject?: string } = {}
    try { parsed = JSON.parse(raw) } catch { parsed = { body: raw } }
    if (!parsed.body?.trim()) {
      return NextResponse.json({ error: 'The AI came back empty — try again' }, { status: 502 })
    }

    return NextResponse.json({ body: parsed.body.trim(), subject: parsed.subject?.trim() || undefined })
  } catch (err) {
    console.error('[POST /api/inbox/draft]', err)
    return NextResponse.json({ error: 'Draft failed' }, { status: 500 })
  }
}
