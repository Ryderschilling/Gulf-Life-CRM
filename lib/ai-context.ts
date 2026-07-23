// ============================================================
// lib/ai-context.ts
// Builds the full AI context string from:
// 1. Active context files (brain files)
// 2. Recent style corrections (what the AI has learned)
// 3. Lead-specific memories (if a lead_id is provided)
// 4. Current pipeline snapshot
// This is prepended to EVERY AI call in the CRM.
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js'

export async function buildAIContext(
  supabase: SupabaseClient,
  options: {
    lead_id?: string
    include_pipeline?: boolean
    max_memories?: number
  } = {}
): Promise<string> {
  const { lead_id, include_pipeline = true, max_memories = 20 } = options

  const sections: string[] = []

  // ── 1. Active context files ──────────────────────────────
  const { data: contextFiles } = await supabase
    .from('ai_context_files')
    .select('name, content')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (contextFiles && contextFiles.length > 0) {
    sections.push('# COMPANY KNOWLEDGE BASE\n' +
      contextFiles.map(f => `## ${f.name}\n${f.content}`).join('\n\n')
    )
  }

  // ── 2. Style corrections (global) ────────────────────────
  const { data: styleMemories } = await supabase
    .from('ai_memories')
    .select('title, content')
    .eq('type', 'style_correction')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(10)

  if (styleMemories && styleMemories.length > 0) {
    sections.push('# WRITING STYLE CORRECTIONS\n' +
      'The team has edited AI drafts in the past. Apply these learned preferences:\n\n' +
      styleMemories.map(m => `- ${m.title}: ${m.content}`).join('\n')
    )
  }

  // ── 3. Pattern memories (global insights) ────────────────
  const { data: patternMemories } = await supabase
    .from('ai_memories')
    .select('title, content')
    .eq('type', 'pattern')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(5)

  if (patternMemories && patternMemories.length > 0) {
    sections.push('# WHAT\'S WORKING IN THE PIPELINE\n' +
      patternMemories.map(m => `- ${m.title}: ${m.content}`).join('\n')
    )
  }

  // ── 4. Lead-specific memories ────────────────────────────
  if (lead_id) {
    const [leadResult, leadMemories] = await Promise.all([
      supabase
        .from('leads')
        .select('*, lead_addresses(*), lead_notes(*), lead_activities(*)')
        .eq('id', lead_id)
        .single(),
      supabase
        .from('ai_memories')
        .select('title, content, created_at')
        .eq('lead_id', lead_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(max_memories),
    ])

    if (leadResult.data) {
      const l = leadResult.data
      const addresses = (l.lead_addresses ?? []) as Array<{label: string; street: string | null; city: string | null; state: string | null; zip: string | null; notes: string | null}>
      const notes = (l.lead_notes ?? []) as Array<{content: string; created_at: string}>
      const activities = (l.lead_activities ?? []) as Array<{type: string; description: string; created_at: string}>

      let leadSection = `# LEAD PROFILE: ${l.name}\n`
      leadSection += `- Status: ${l.status}\n`
      leadSection += `- Email: ${l.email ?? 'not provided'}\n`
      leadSection += `- Phone: ${l.phone ?? 'not provided'}\n`
      leadSection += `- Source: ${l.source ?? 'unknown'}\n`
      leadSection += `- Budget: ${l.budget_range ?? 'not specified'}\n`
      leadSection += `- Timeline: ${l.move_in_timeline ?? 'not specified'}\n`
      leadSection += `- Company: ${l.company ?? 'not specified'}\n`
      leadSection += `- Last contacted: ${l.last_contacted_at ? new Date(l.last_contacted_at).toLocaleDateString() : 'never'}\n`

      if (addresses.length > 0) {
        leadSection += `\n## Properties of Interest\n`
        addresses.forEach(a => {
          const addr = [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ')
          leadSection += `- ${a.label}: ${addr || 'address pending'}${a.notes ? ` (${a.notes})` : ''}\n`
        })
      }

      if (notes.length > 0) {
        leadSection += `\n## Notes from Team\n`
        notes.slice(0, 5).forEach(n => {
          leadSection += `- ${n.content}\n`
        })
      }

      if (activities.length > 0) {
        leadSection += `\n## Recent Activity\n`
        activities.slice(0, 8).forEach(a => {
          leadSection += `- [${new Date(a.created_at).toLocaleDateString()}] ${a.description}\n`
        })
      }

      sections.push(leadSection)
    }

    if (leadMemories?.data && leadMemories.data.length > 0) {
      sections.push('# WHAT AI KNOWS ABOUT THIS LEAD\n' +
        leadMemories.data.map((m: {title: string; content: string}) => `- ${m.title}: ${m.content}`).join('\n')
      )
    }
  }

  // ── 5. Pipeline snapshot (for chat/digest) ────────────────
  if (include_pipeline && !lead_id) {
    const { data: leads } = await supabase
      .from('leads')
      .select('name, status, email, phone, last_contacted_at, next_follow_up_at, source')
      .eq('lead_type', 'owner')
      .eq('relationship', 'prospect')
      .not('status', 'in', '("closed_won","closed_lost")')
      .order('created_at', { ascending: false })
      .limit(25)

    if (leads && leads.length > 0) {
      const pipelineText = leads.map(l => {
        const daysSince = l.last_contacted_at
          ? Math.floor((Date.now() - new Date(l.last_contacted_at).getTime()) / 86400000)
          : null
        const overdue = l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date()
        return `- ${l.name} | ${l.status} | ${l.source ?? 'source unknown'} | Last contact: ${daysSince != null ? `${daysSince}d ago` : 'never'}${overdue ? ' ⚠️ FOLLOW-UP OVERDUE' : ''}`
      }).join('\n')

      sections.push(`# CURRENT OWNER PIPELINE (${leads.length} active leads)\n${pipelineText}`)
    }
  }

  return sections.join('\n\n---\n\n')
}

export const AI_SYSTEM_BASE = `You are the AI brain of Gulf Life Concierge CRM — an intelligent assistant embedded directly into the sales and management system.

You have access to the company's full knowledge base, communication style guides, sales process, and complete lead history. You know every lead, every interaction, and every preference the team has expressed.

YOUR CAPABILITIES — you can directly DO almost anything in this CRM, not just advise:
- Create, update, and delete leads; move pipeline stages; add notes; manage properties/addresses and tags
- Create and complete to-dos
- Draft emails (unrestricted) and manage the review queue (dismiss drafts)
- Edit your OWN knowledge: create/update/delete brain files (company info, communication style, sales process, email signature) and save or forget memories with edit_brain_file / remember / forget
- Analyze the pipeline, answer questions, and suggest actions

YOUR AUTHORITY (important):
You have full authority over this CRM's knowledge, settings, and data. If asked to change how you write, what you know, or the email signature, DO IT YOURSELF with edit_brain_file (or remember) — then confirm you did it. There is NO "system administrator" or "IT department" to defer to; inventing one is wrong. The user runs this business and you act on their behalf.

THE ONLY ACTIONS THAT REQUIRE EXPLICIT CONFIRMATION FIRST:
- Sending an email or text to a client (send_email / send_sms) — only after the user says to send in this conversation.
- Permanently deleting a lead (delete_lead) — only after the user confirms.
Everything else: just do it when asked, then report what you did.

YOUR STANDARDS:
- Always warm, personal, and on-brand (never corporate or pushy)
- Always reference specific lead details when drafting communications
- Be direct and actionable — the team needs clear next steps
- When drafting emails: 3 short paragraphs max, end with a low-pressure CTA
- When analyzing: be honest, flag risks, suggest concrete actions`
