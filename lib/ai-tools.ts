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
import { getResend, RESEND_FROM } from './resend'

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
        if (args.overdue_only) q = q.lt('next_follow_up_at', new Date().toISOString()).not('status', 'in', '("closed_won","closed_lost")')
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
          updates.next_follow_up_at = new Date(String(args.next_follow_up_at)).toISOString()
          changed.push(`follow-up → ${args.next_follow_up_at}`)
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
        const { data: leads } = await supabase.from('leads').select('lead_type, status, next_follow_up_at').eq('lead_type', 'owner')
        const owners = (leads ?? []) as Pick<Lead, 'lead_type' | 'status' | 'next_follow_up_at'>[]
        const now = new Date().toISOString()
        const byStage: Record<string, number> = {}
        for (const o of owners) byStage[o.status] = (byStage[o.status] ?? 0) + 1
        const activeOwners = owners.filter(l => !['closed_won', 'closed_lost'].includes(l.status)).length
        return {
          result: J({
            owner_leads_total: owners.length,
            owner_leads_active: activeOwners,
            by_stage: byStage,
            follow_ups_overdue: owners.filter(l => l.next_follow_up_at && l.next_follow_up_at < now && !['closed_won', 'closed_lost'].includes(l.status)).length,
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
        const resend = getResend()
        if (!resend) return { result: J({ error: 'Resend (email) is not configured' }) }
        const { error: sendErr } = await resend.emails.send({
          from: RESEND_FROM,
          to: res.lead.email,
          subject: String(args.subject),
          text: String(args.body),
        })
        if (sendErr) return { result: J({ error: `Email failed: ${sendErr.message}` }), action: { tool: 'send_email', summary: `Email to ${res.lead.name} FAILED`, ok: false, lead_id: res.lead.id } }
        await supabase.from('email_drafts').insert({
          lead_id: res.lead.id, to_email: res.lead.email, to_name: res.lead.name,
          subject: String(args.subject), body: String(args.body),
          trigger_type: 'ai_chat', status: 'sent', ai_generated: true,
          sent_at: new Date().toISOString(), sent_by: userId,
        })
        await supabase.from('leads').update({ last_contacted_at: new Date().toISOString() }).eq('id', res.lead.id)
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
        await supabase.from('leads').update({ last_contacted_at: new Date().toISOString() }).eq('id', res.lead.id)
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

      default:
        return { result: J({ error: `Unknown tool: ${name}` }) }
    }
  } catch (err) {
    return { result: J({ error: err instanceof Error ? err.message : 'Tool execution failed' }) }
  }
}
