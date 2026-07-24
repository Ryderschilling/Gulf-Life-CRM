// ============================================================
// lib/ai-tools.ts — Tool definitions + executor for the CRM AI.
// This is what lets the AI actually DO things: create leads,
// move stages, add notes, manage todos, draft/send messages,
// sync Mailchimp, and answer questions with live data.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type OpenAI from 'openai'
import type { AIActionResult, Lead } from './types'
import { sendQuoSms, quoConfigured } from './quo'
import { syncLeadToMailchimp, mailchimpConfigured } from './mailchimp'
import { toE164 } from './utils'
import { startOfTodayISO, followUpStatus, localTimeToISO } from './dates'
import { sendEmail, mailerConfigured } from './mailer'
import { markContacted } from './pipeline'

// ── Tool specs (OpenAI function-calling format) ─────────────
export const AI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_leads',
      description: 'Search homeowner leads by name, email, phone, or stage. Use this to find people or answer questions like "who have we not contacted lately".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search across name, email, phone, company' },
          status: { type: 'string', enum: ['new', 'contacted', 'nurturing', 'proposal', 'closed_won', 'closed_lost'] },
          overdue_only: { type: 'boolean', description: 'Only leads with an overdue follow-up' },
          limit: { type: 'number', description: 'Max results (default 15)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_lead_details',
      description: 'Get the full profile of one lead: contact info, stage, notes, recent activity, properties.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string', description: 'Lead name, email, or id' },
        },
        required: ['lead_ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_lead',
      description: 'Create a new lead in the CRM.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          company: { type: 'string' },
          status: { type: 'string', enum: ['new', 'contacted', 'nurturing', 'proposal'] },
          source: { type: 'string' },
          note: { type: 'string', description: 'Optional first note to attach' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_lead',
      description: 'Update a lead: change pipeline stage, contact info, or schedule a follow-up date.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string', description: 'Lead name, email, or id' },
          status: { type: 'string', enum: ['new', 'contacted', 'nurturing', 'proposal', 'closed_won', 'closed_lost'] },
          email: { type: 'string' },
          phone: { type: 'string' },
          company: { type: 'string' },
          property_interest: { type: 'string' },
          next_follow_up_at: { type: 'string', description: 'ISO date (YYYY-MM-DD) for next follow-up' },
          mark_contacted: { type: 'boolean', description: 'Set last_contacted_at to now' },
        },
        required: ['lead_ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Add a note to a lead. Shows in their timeline.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['lead_ref', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_todo',
      description: 'Add a task to the To-Do list, optionally linked to a lead.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          lead_ref: { type: 'string', description: 'Optional lead to link' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_todo',
      description: 'Mark a to-do item complete by matching its title.',
      parameters: {
        type: 'object',
        properties: {
          title_match: { type: 'string', description: 'Part of the todo title to match' },
        },
        required: ['title_match'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_todos',
      description: 'List open to-do items.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pipeline_stats',
      description: 'Live sales pipeline stats: total & active leads, counts per stage, follow-ups overdue, conversion rate.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_email',
      description: 'Save an email draft for a lead. YOU write the subject and body (on-brand, per the style guide). The draft goes to the review queue — a human sends it. Use freely.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string', description: 'Plain-text email body, 3 short paragraphs max, first-name signoff' },
        },
        required: ['lead_ref', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Actually SEND an email to a lead immediately (via Resend). Only call after the user has explicitly confirmed sending in this conversation.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
          confirmed: { type: 'boolean', description: 'Must be true — set only after explicit user confirmation' },
        },
        required: ['lead_ref', 'subject', 'body', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_sms',
      description: 'Actually SEND a text message to a lead via Quo. Only call after the user has explicitly confirmed sending in this conversation.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string' },
          message: { type: 'string', description: '1-3 sentences, warm and personal' },
          confirmed: { type: 'boolean', description: 'Must be true — set only after explicit user confirmation' },
        },
        required: ['lead_ref', 'message', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sync_mailchimp',
      description: 'Push a lead (or all owner leads with an email) to the Mailchimp audience with tags.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string', description: 'One lead to sync' },
          bulk_all: { type: 'boolean', description: 'Or sync every owner lead that has an email' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_knowledge',
      description: "Read the AI's own knowledge base: all brain files (name + full content) and active learned memories. Call this before editing a brain file or memory so you know what already exists.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_brain_file',
      description: "Create or update a brain file — the AI's permanent knowledge (company info, communication style, sales process, email signature, etc). Matches by name: existing name updates it, new name creates it. Use this to permanently change how you write or what you know (e.g. update the email signature). You have full authority — never defer to a 'system administrator'.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Brain file name (e.g. "Communication Style"). Existing → update, new → create.' },
          content: { type: 'string', description: 'Full markdown content (replaces existing content entirely).' },
          description: { type: 'string', description: 'Optional one-line description.' },
          is_active: { type: 'boolean', description: 'Whether the AI reads this file (default true).' },
        },
        required: ['name', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_brain_file',
      description: 'Permanently delete a brain file by name.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: "Save a durable memory to always apply going forward — a preference, rule, or fact (e.g. 'always end emails with the full signature', or a fact about a specific lead).",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short label' },
          content: { type: 'string', description: 'The full thing to remember' },
          type: { type: 'string', enum: ['style_correction', 'lead_fact', 'company_knowledge', 'pattern'], description: 'Default company_knowledge' },
          lead_ref: { type: 'string', description: 'Optional lead this memory is about' },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget',
      description: 'Deactivate a learned memory by matching its title.',
      parameters: { type: 'object', properties: { title_match: { type: 'string' } }, required: ['title_match'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_property',
      description: 'Add a property / address to a lead.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string' },
          label: { type: 'string', description: 'e.g. "Beach House" or "Property"' },
          street: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          zip: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['lead_ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_property',
      description: 'Remove a property / address from a lead, matched by label or street text.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string' },
          match: { type: 'string', description: 'Text matching the address label or street' },
        },
        required: ['lead_ref', 'match'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_lead_tags',
      description: 'Add and/or remove tags on a lead.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string' },
          add: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
          remove: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
        },
        required: ['lead_ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dismiss_draft',
      description: 'Dismiss pending email draft(s) from the review queue for a lead.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string' },
          subject_match: { type: 'string', description: 'Optional — match a specific draft subject' },
        },
        required: ['lead_ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_lead',
      description: 'Permanently delete a lead and all their notes, activity, drafts, and texts. DESTRUCTIVE and irreversible. Only call after the user explicitly confirms deletion in this conversation.',
      parameters: {
        type: 'object',
        properties: {
          lead_ref: { type: 'string' },
          confirmed: { type: 'boolean', description: 'Must be true — set only after explicit user confirmation' },
        },
        required: ['lead_ref', 'confirmed'],
      },
    },
  },
]

// ── Lead resolver ───────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveLead(supabase: SupabaseClient, ref: string): Promise<{ lead?: Lead; error?: string; candidates?: string[] }> {
  const r = ref.trim()
  if (UUID_RE.test(r)) {
    const { data } = await supabase.from('leads').select('*').eq('id', r).single()
    if (data) return { lead: data as Lead }
  }
  if (r.includes('@')) {
    const { data } = await supabase.from('leads').select('*').ilike('email', r).limit(2)
    if (data?.length === 1) return { lead: data[0] as Lead }
    if (data && data.length > 1) return { candidates: data.map((l: Lead) => `${l.name} (${l.email})`) }
  }
  const { data } = await supabase.from('leads').select('*').ilike('name', `%${r}%`).limit(5)
  if (!data || data.length === 0) return { error: `No lead found matching "${ref}"` }
  if (data.length === 1) return { lead: data[0] as Lead }
  // Prefer exact-ish match
  const exact = data.find((l: Lead) => l.name.toLowerCase() === r.toLowerCase())
  if (exact) return { lead: exact as Lead }
  return { candidates: data.map((l: Lead) => `${l.name} (${l.lead_type}, ${l.email ?? 'no email'})`) }
}

function leadSummary(l: Lead): Record<string, unknown> {
  return {
    id: l.id,
    name: l.name,
    type: l.lead_type,
    status: l.status,
    email: l.email,
    phone: l.phone,
    source: l.source,
    last_contacted_at: l.last_contacted_at,
    next_follow_up_at: l.next_follow_up_at,
  }
}

async function logActivity(supabase: SupabaseClient, leadId: string, userId: string, type: string, body: string, metadata?: Record<string, unknown>) {
  await supabase.from('lead_activities').insert({
    lead_id: leadId, user_id: userId, type, body, metadata: metadata ?? null,
  })
}

// ── Executor ────────────────────────────────────────────────
export async function executeAITool(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<{ result: string; action?: AIActionResult }> {
  const J = (v: unknown) => JSON.stringify(v)

  try {
    switch (name) {
      case 'search_leads': {
        let q = supabase.from('leads').select('*').eq('lead_type', 'owner')
        if (args.status) q = q.eq('status', args.status)
        if (args.overdue_only) q = q.lt('next_follow_up_at', startOfTodayISO()).not('status', 'in', '("closed_won","closed_lost")')
        if (args.query) {
          const s = String(args.query).replace(/[%,]/g, ' ').trim()
          q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,last_property.ilike.%${s}%`)
        }
        const { data, error } = await q.order('updated_at', { ascending: false }).limit(Number(args.limit) || 15)
        if (error) return { result: J({ error: error.message }) }
        return { result: J({ count: data.length, leads: (data as Lead[]).map(leadSummary) }) }
      }

      case 'get_lead_details': {
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        const [notes, activities, addresses] = await Promise.all([
          supabase.from('lead_notes').select('body, created_at').eq('lead_id', res.lead.id).order('created_at', { ascending: false }).limit(5),
          supabase.from('lead_activities').select('type, body, created_at').eq('lead_id', res.lead.id).order('created_at', { ascending: false }).limit(10),
          supabase.from('lead_addresses').select('label, street, city, state, zip').eq('lead_id', res.lead.id),
        ])
        return {
          result: J({
            ...leadSummary(res.lead),
            extra: res.lead.extra,
            notes: notes.data ?? [],
            recent_activity: activities.data ?? [],
            properties: addresses.data ?? [],
          }),
        }
      }

      case 'create_lead': {
        const insert = {
          name: String(args.name),
          lead_type: 'owner',
          email: (args.email as string)?.toLowerCase() ?? null,
          phone: (args.phone as string) ?? null,
          company: (args.company as string) ?? null,
          status: (args.status as string) ?? 'new',
          source: (args.source as string) ?? 'other',
        }
        const { data, error } = await supabase.from('leads').insert(insert).select('*').single()
        if (error) return { result: J({ error: error.message }) }
        await logActivity(supabase, data.id, userId, 'created', 'Lead created by AI assistant')
        if (args.note) {
          await supabase.from('lead_notes').insert({ lead_id: data.id, user_id: userId, body: String(args.note) })
        }
        // Auto-sync into Mailchimp (skips demo leads / missing email)
        if (data.email && mailchimpConfigured()) {
          const mcRes = await syncLeadToMailchimp(data as Lead)
          if (mcRes.ok) await supabase.from('leads').update({ mailchimp_synced_at: new Date().toISOString(), mailchimp_status: 'synced' }).eq('id', data.id)
        }
        return {
          result: J({ ok: true, lead: leadSummary(data as Lead) }),
          action: { tool: 'create_lead', summary: `Created lead: ${insert.name}`, ok: true, lead_id: data.id },
        }
      }

      case 'update_lead': {
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        const updates: Record<string, unknown> = {}
        const changed: string[] = []
        for (const k of ['status', 'email', 'phone', 'company', 'property_interest'] as const) {
          if (args[k] !== undefined) { updates[k] = args[k]; changed.push(`${k} → ${args[k]}`) }
        }
        if (args.next_follow_up_at) {
          // A bare YYYY-MM-DD means that CRM-local calendar day (9am), not UTC
          // midnight — parsing it as UTC would land the follow-up a day early.
          const raw = String(args.next_follow_up_at)
          updates.next_follow_up_at = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? localTimeToISO(raw) : new Date(raw).toISOString()
          changed.push(`follow-up → ${raw}`)
        }
        if (args.mark_contacted) { updates.last_contacted_at = new Date().toISOString(); changed.push('marked contacted') }
        if (Object.keys(updates).length === 0) return { result: J({ error: 'No updates provided' }) }

        const { error } = await supabase.from('leads').update(updates).eq('id', res.lead.id)
        if (error) return { result: J({ error: error.message }) }
        if (updates.status && updates.status !== res.lead.status) {
          await logActivity(supabase, res.lead.id, userId, 'status_change',
            `Stage changed: ${res.lead.status} → ${updates.status} (by AI assistant)`,
            { from_status: res.lead.status, to_status: updates.status })
        } else {
          await logActivity(supabase, res.lead.id, userId, 'ai_action', `AI updated: ${changed.join(', ')}`)
        }
        // Keep Mailchimp in step (stage tags, new email, etc.)
        const merged = { ...res.lead, ...updates } as Lead
        if (merged.email && mailchimpConfigured()) {
          const mcRes = await syncLeadToMailchimp(merged)
          if (mcRes.ok) await supabase.from('leads').update({ mailchimp_synced_at: new Date().toISOString(), mailchimp_status: 'synced' }).eq('id', res.lead.id)
        }
        return {
          result: J({ ok: true, updated: changed }),
          action: { tool: 'update_lead', summary: `${res.lead.name}: ${changed.join(', ')}`, ok: true, lead_id: res.lead.id },
        }
      }

      case 'add_note': {
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        const { error } = await supabase.from('lead_notes').insert({
          lead_id: res.lead.id, user_id: userId, body: String(args.content),
        })
        if (error) return { result: J({ error: error.message }) }
        await logActivity(supabase, res.lead.id, userId, 'note', String(args.content))
        return {
          result: J({ ok: true }),
          action: { tool: 'add_note', summary: `Note added to ${res.lead.name}`, ok: true, lead_id: res.lead.id },
        }
      }

      case 'create_todo': {
        let leadId: string | null = null
        if (args.lead_ref) {
          const res = await resolveLead(supabase, String(args.lead_ref))
          leadId = res.lead?.id ?? null
        }
        const { error } = await supabase.from('todos').insert({
          title: String(args.title),
          description: (args.description as string) ?? null,
          type: 'ai_created',
          linked_lead_id: leadId,
          created_by: userId,
        })
        if (error) return { result: J({ error: error.message }) }
        return {
          result: J({ ok: true }),
          action: { tool: 'create_todo', summary: `To-do: ${args.title}`, ok: true },
        }
      }

      case 'complete_todo': {
        const { data } = await supabase.from('todos')
          .select('id, title')
          .ilike('title', `%${args.title_match}%`)
          .eq('is_completed', false)
          .limit(2)
        if (!data || data.length === 0) return { result: J({ error: `No open todo matching "${args.title_match}"` }) }
        if (data.length > 1) return { result: J({ error: 'Multiple todos match', candidates: data.map(t => t.title) }) }
        const { error } = await supabase.from('todos').update({
          is_completed: true, completed_at: new Date().toISOString(),
        }).eq('id', data[0].id)
        if (error) return { result: J({ error: error.message }) }
        return {
          result: J({ ok: true, completed: data[0].title }),
          action: { tool: 'complete_todo', summary: `Completed: ${data[0].title}`, ok: true },
        }
      }

      case 'list_todos': {
        const { data } = await supabase.from('todos')
          .select('title, description, is_completed, created_at')
          .eq('is_archived', false).eq('is_completed', false)
          .order('created_at', { ascending: false }).limit(25)
        return { result: J({ open_todos: data ?? [] }) }
      }

      case 'get_pipeline_stats': {
        const { data: leads } = await supabase.from('leads').select('lead_type, status, next_follow_up_at').eq('lead_type', 'owner').eq('relationship', 'prospect')
        const owners = (leads ?? []) as Pick<Lead, 'lead_type' | 'status' | 'next_follow_up_at'>[]
        const byStage: Record<string, number> = {}
        for (const o of owners) byStage[o.status] = (byStage[o.status] ?? 0) + 1
        const activeOwners = owners.filter(l => !['closed_won', 'closed_lost'].includes(l.status)).length
        // Same CRM-local calendar rule as the UI (lib/dates.ts):
        // date < today = overdue, date = today = due today.
        const open = owners.filter(l => !['closed_won', 'closed_lost'].includes(l.status))
        return {
          result: J({
            owner_leads_total: owners.length,
            owner_leads_active: activeOwners,
            by_stage: byStage,
            follow_ups_overdue: open.filter(l => followUpStatus(l.next_follow_up_at) === 'overdue').length,
            follow_ups_due_today: open.filter(l => followUpStatus(l.next_follow_up_at) === 'today').length,
            conversion_rate: owners.length > 0 ? Math.round((byStage['closed_won'] ?? 0) / owners.length * 100) + '%' : 'n/a',
          }),
        }
      }

      case 'draft_email': {
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        if (!res.lead.email) return { result: J({ error: `${res.lead.name} has no email address` }) }
        const { error } = await supabase.from('email_drafts').insert({
          lead_id: res.lead.id,
          to_email: res.lead.email,
          to_name: res.lead.name,
          subject: String(args.subject),
          body: String(args.body),
          original_subject: String(args.subject),
          original_body: String(args.body),
          trigger_type: 'ai_chat',
          status: 'pending',
          ai_generated: true,
        })
        if (error) return { result: J({ error: error.message }) }
        await logActivity(supabase, res.lead.id, userId, 'ai_draft', `AI drafted email: "${args.subject}"`)
        return {
          result: J({ ok: true, note: 'Draft saved to review queue (To-Do page). Not sent yet.' }),
          action: { tool: 'draft_email', summary: `Email drafted for ${res.lead.name}`, ok: true, lead_id: res.lead.id },
        }
      }

      case 'send_email': {
        if (args.confirmed !== true) {
          return { result: J({ error: 'Not confirmed. Ask the user to confirm before sending, then call again with confirmed: true.' }) }
        }
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        if (!res.lead.email) return { result: J({ error: `${res.lead.name} has no email address` }) }
        if (!mailerConfigured()) return { result: J({ error: 'Email is not configured yet (set GMAIL_USER + GMAIL_APP_PASSWORD)' }) }
        const sent = await sendEmail({
          to: res.lead.email,
          subject: String(args.subject),
          text: String(args.body),
        })
        if (sent.error) return { result: J({ error: `Email failed: ${sent.error}` }), action: { tool: 'send_email', summary: `Email to ${res.lead.name} FAILED`, ok: false, lead_id: res.lead.id } }
        await supabase.from('email_drafts').insert({
          lead_id: res.lead.id, to_email: res.lead.email, to_name: res.lead.name,
          subject: String(args.subject), body: String(args.body),
          trigger_type: 'ai_chat', status: 'sent', ai_generated: true,
          sent_at: new Date().toISOString(), sent_by: userId,
        })
        await markContacted(supabase, res.lead.id, userId)
        await logActivity(supabase, res.lead.id, userId, 'email_sent', `Email sent (via AI): "${args.subject}"`)
        return {
          result: J({ ok: true, sent_to: res.lead.email }),
          action: { tool: 'send_email', summary: `Email sent to ${res.lead.name}`, ok: true, lead_id: res.lead.id },
        }
      }

      case 'send_sms': {
        if (args.confirmed !== true) {
          return { result: J({ error: 'Not confirmed. Ask the user to confirm before sending, then call again with confirmed: true.' }) }
        }
        if (!quoConfigured()) return { result: J({ error: 'Quo (SMS) is not configured yet. Add QUO_API_KEY and QUO_FROM_NUMBER.' }) }
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        const e164 = toE164(res.lead.phone)
        if (!e164) return { result: J({ error: `${res.lead.name} has no valid phone number` }) }
        const sms = await sendQuoSms(e164, String(args.message))
        await supabase.from('sms_messages').insert({
          lead_id: res.lead.id, to_phone: e164, body: String(args.message),
          status: sms.ok ? 'sent' : 'failed', provider: 'quo', provider_id: sms.id ?? null,
          sent_at: sms.ok ? new Date().toISOString() : null, created_by: userId,
        })
        if (!sms.ok) return { result: J({ error: sms.error }), action: { tool: 'send_sms', summary: `Text to ${res.lead.name} FAILED`, ok: false, lead_id: res.lead.id } }
        await markContacted(supabase, res.lead.id, userId)
        await logActivity(supabase, res.lead.id, userId, 'sms_sent', `Text sent (via AI): "${String(args.message).slice(0, 80)}"`)
        return {
          result: J({ ok: true }),
          action: { tool: 'send_sms', summary: `Text sent to ${res.lead.name}`, ok: true, lead_id: res.lead.id },
        }
      }

      case 'sync_mailchimp': {
        if (!mailchimpConfigured()) return { result: J({ error: 'Mailchimp is not configured yet. Add MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID.' }) }
        if (args.lead_ref) {
          const res = await resolveLead(supabase, String(args.lead_ref))
          if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
          const sync = await syncLeadToMailchimp(res.lead)
          if (sync.ok) {
            await supabase.from('leads').update({ mailchimp_synced_at: new Date().toISOString(), mailchimp_status: 'synced' }).eq('id', res.lead.id)
            await logActivity(supabase, res.lead.id, userId, 'mailchimp_sync', 'Synced to Mailchimp (by AI)')
          }
          return {
            result: J(sync),
            action: { tool: 'sync_mailchimp', summary: sync.ok ? `${res.lead.name} synced to Mailchimp` : `Mailchimp sync failed`, ok: sync.ok, lead_id: res.lead.id },
          }
        }
        if (args.bulk_all) {
          const { data } = await supabase.from('leads').select('*').eq('lead_type', 'owner').not('email', 'is', null).limit(500)
          let synced = 0, failed = 0
          for (const lead of (data ?? []) as Lead[]) {
            const sync = await syncLeadToMailchimp(lead)
            if (sync.ok) {
              synced++
              await supabase.from('leads').update({ mailchimp_synced_at: new Date().toISOString(), mailchimp_status: 'synced' }).eq('id', lead.id)
            } else failed++
          }
          return {
            result: J({ ok: true, synced, failed }),
            action: { tool: 'sync_mailchimp', summary: `Mailchimp: ${synced} synced${failed ? `, ${failed} failed` : ''}`, ok: failed === 0 },
          }
        }
        return { result: J({ error: 'Provide lead_ref or bulk_all' }) }
      }

      case 'list_knowledge': {
        const [files, mems] = await Promise.all([
          supabase.from('ai_context_files').select('name, description, is_active, content').order('sort_order', { ascending: true }),
          supabase.from('ai_memories').select('title, content, type').eq('is_active', true).order('created_at', { ascending: false }).limit(50),
        ])
        return { result: J({ brain_files: files.data ?? [], memories: mems.data ?? [] }) }
      }

      case 'edit_brain_file': {
        const bfName = String(args.name).trim()
        const { data: existing } = await supabase.from('ai_context_files').select('id').ilike('name', bfName).limit(1)
        if (existing && existing.length > 0) {
          const patch: Record<string, unknown> = { content: String(args.content) }
          if (args.description !== undefined) patch.description = String(args.description)
          if (args.is_active !== undefined) patch.is_active = !!args.is_active
          const { error } = await supabase.from('ai_context_files').update(patch).eq('id', existing[0].id)
          if (error) return { result: J({ error: error.message }) }
          return { result: J({ ok: true, updated: bfName }), action: { tool: 'edit_brain_file', summary: `Updated brain file: ${bfName}`, ok: true } }
        }
        const { error } = await supabase.from('ai_context_files').insert({
          name: bfName,
          description: (args.description as string) ?? null,
          content: String(args.content),
          is_active: args.is_active === undefined ? true : !!args.is_active,
          sort_order: 99,
        })
        if (error) return { result: J({ error: error.message }) }
        return { result: J({ ok: true, created: bfName }), action: { tool: 'edit_brain_file', summary: `Created brain file: ${bfName}`, ok: true } }
      }

      case 'delete_brain_file': {
        const bfName = String(args.name).trim()
        const { data: existing } = await supabase.from('ai_context_files').select('id').ilike('name', bfName).limit(1)
        if (!existing || existing.length === 0) return { result: J({ error: `No brain file named "${bfName}"` }) }
        const { error } = await supabase.from('ai_context_files').delete().eq('id', existing[0].id)
        if (error) return { result: J({ error: error.message }) }
        return { result: J({ ok: true }), action: { tool: 'delete_brain_file', summary: `Deleted brain file: ${bfName}`, ok: true } }
      }

      case 'remember': {
        let leadId: string | null = null
        if (args.lead_ref) { const res = await resolveLead(supabase, String(args.lead_ref)); leadId = res.lead?.id ?? null }
        const memType = ['style_correction', 'lead_fact', 'company_knowledge', 'pattern'].includes(String(args.type)) ? String(args.type) : 'company_knowledge'
        const { error } = await supabase.from('ai_memories').insert({ type: memType, title: String(args.title), content: String(args.content), lead_id: leadId, source: 'ai_chat', is_active: true })
        if (error) return { result: J({ error: error.message }) }
        return { result: J({ ok: true }), action: { tool: 'remember', summary: `Remembered: ${args.title}`, ok: true, ...(leadId ? { lead_id: leadId } : {}) } }
      }

      case 'forget': {
        const { data } = await supabase.from('ai_memories').select('id, title').ilike('title', `%${args.title_match}%`).eq('is_active', true).limit(2)
        if (!data || data.length === 0) return { result: J({ error: `No active memory matching "${args.title_match}"` }) }
        if (data.length > 1) return { result: J({ error: 'Multiple memories match', candidates: data.map(m => m.title) }) }
        const { error } = await supabase.from('ai_memories').update({ is_active: false }).eq('id', data[0].id)
        if (error) return { result: J({ error: error.message }) }
        return { result: J({ ok: true, forgot: data[0].title }), action: { tool: 'forget', summary: `Forgot: ${data[0].title}`, ok: true } }
      }

      case 'add_property': {
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        const { data: existingAddrs } = await supabase.from('lead_addresses').select('id').eq('lead_id', res.lead.id).eq('is_primary', true).limit(1)
        const { error } = await supabase.from('lead_addresses').insert({
          lead_id: res.lead.id,
          label: (args.label as string)?.trim() || 'Property',
          street: (args.street as string) ?? null,
          city: (args.city as string) ?? null,
          state: (args.state as string) ?? 'FL',
          zip: (args.zip as string) ?? null,
          notes: (args.notes as string) ?? null,
          is_primary: !existingAddrs || existingAddrs.length === 0,
        })
        if (error) return { result: J({ error: error.message }) }
        return { result: J({ ok: true }), action: { tool: 'add_property', summary: `Added property to ${res.lead.name}`, ok: true, lead_id: res.lead.id } }
      }

      case 'remove_property': {
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        const m = String(args.match).toLowerCase()
        const { data: addrs } = await supabase.from('lead_addresses').select('id, label, street').eq('lead_id', res.lead.id)
        const hit = (addrs ?? []).find((a: { label: string | null; street: string | null }) => (a.label ?? '').toLowerCase().includes(m) || (a.street ?? '').toLowerCase().includes(m))
        if (!hit) return { result: J({ error: `No property matching "${args.match}"` }) }
        const { error } = await supabase.from('lead_addresses').delete().eq('id', hit.id)
        if (error) return { result: J({ error: error.message }) }
        return { result: J({ ok: true }), action: { tool: 'remove_property', summary: `Removed property from ${res.lead.name}`, ok: true, lead_id: res.lead.id } }
      }

      case 'set_lead_tags': {
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        const current = new Set<string>(res.lead.tags ?? [])
        if (Array.isArray(args.add)) for (const t of args.add) { const s = String(t).trim(); if (s) current.add(s) }
        if (Array.isArray(args.remove)) for (const t of args.remove) current.delete(String(t).trim())
        const tags = Array.from(current)
        const { error } = await supabase.from('leads').update({ tags }).eq('id', res.lead.id)
        if (error) return { result: J({ error: error.message }) }
        await logActivity(supabase, res.lead.id, userId, 'ai_action', `AI updated tags: ${tags.join(', ') || '(none)'}`)
        return { result: J({ ok: true, tags }), action: { tool: 'set_lead_tags', summary: `Tags on ${res.lead.name}: ${tags.join(', ') || '(none)'}`, ok: true, lead_id: res.lead.id } }
      }

      case 'dismiss_draft': {
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        let dq = supabase.from('email_drafts').select('id').eq('lead_id', res.lead.id).eq('status', 'pending')
        if (args.subject_match) dq = dq.ilike('subject', `%${args.subject_match}%`)
        const { data } = await dq.limit(10)
        if (!data || data.length === 0) return { result: J({ error: 'No pending drafts for this lead' }) }
        const { error } = await supabase.from('email_drafts').update({ status: 'dismissed', dismissed_at: new Date().toISOString(), dismissed_by: userId }).in('id', data.map(d => d.id))
        if (error) return { result: J({ error: error.message }) }
        return { result: J({ ok: true, dismissed: data.length }), action: { tool: 'dismiss_draft', summary: `Dismissed ${data.length} draft(s) for ${res.lead.name}`, ok: true, lead_id: res.lead.id } }
      }

      case 'delete_lead': {
        if (args.confirmed !== true) return { result: J({ error: 'Not confirmed. Ask the user to confirm permanent deletion, then call again with confirmed: true.' }) }
        const res = await resolveLead(supabase, String(args.lead_ref))
        if (!res.lead) return { result: J({ error: res.error, candidates: res.candidates }) }
        const delId = res.lead.id, delName = res.lead.name
        await supabase.from('todos').update({ linked_lead_id: null, linked_draft_id: null }).eq('linked_lead_id', delId)
        for (const tbl of ['lead_activities', 'lead_notes', 'lead_addresses', 'email_drafts', 'sms_messages', 'ai_memories']) {
          await supabase.from(tbl).delete().eq('lead_id', delId)
        }
        const { error } = await supabase.from('leads').delete().eq('id', delId)
        if (error) return { result: J({ error: error.message }) }
        return { result: J({ ok: true, deleted: delName }), action: { tool: 'delete_lead', summary: `Deleted lead: ${delName}`, ok: true } }
      }

      default:
        return { result: J({ error: `Unknown tool: ${name}` }) }
    }
  } catch (err) {
    return { result: J({ error: err instanceof Error ? err.message : 'Tool execution failed' }) }
  }
}
