// ============================================================
// lib/mailchimp.ts — Mailchimp Marketing API sync
// Pushes leads/guests into a Mailchimp audience with tags so
// John can run campaigns from Mailchimp itself.
// Env: MAILCHIMP_API_KEY (ends in -usXX), MAILCHIMP_AUDIENCE_ID
// ============================================================

import { createHash } from 'crypto'
import type { Lead } from './types'
import { STATUS_CONFIG } from './utils'

function serverPrefix(): string | null {
  const key = process.env.MAILCHIMP_API_KEY
  if (!key || !key.includes('-')) return null
  return key.split('-').pop() ?? null
}

export function mailchimpConfigured(): boolean {
  return !!(process.env.MAILCHIMP_API_KEY && process.env.MAILCHIMP_AUDIENCE_ID && serverPrefix())
}

function baseUrl(): string {
  return `https://${serverPrefix()}.api.mailchimp.com/3.0`
}

function authHeader(): string {
  // Mailchimp uses HTTP basic auth: any username + API key
  return 'Basic ' + Buffer.from(`crm:${process.env.MAILCHIMP_API_KEY}`).toString('base64')
}

function subscriberHash(email: string): string {
  return createHash('md5').update(email.toLowerCase().trim()).digest('hex')
}

export interface MailchimpSyncResult {
  ok: boolean
  error?: string
}

/** Upsert one lead as an audience member + apply tags. */
export async function syncLeadToMailchimp(lead: Lead): Promise<MailchimpSyncResult> {
  if (!mailchimpConfigured()) {
    return { ok: false, error: 'Mailchimp is not configured. Add MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID.' }
  }
  if (!lead.email) {
    return { ok: false, error: 'Lead has no email address' }
  }

  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID!
  const hash = subscriberHash(lead.email)
  const [firstName, ...rest] = lead.name.split(' ')

  try {
    // 1. Upsert member
    const memberRes = await fetch(`${baseUrl()}/lists/${audienceId}/members/${hash}`, {
      method: 'PUT',
      headers: { 'Authorization': authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_address: lead.email,
        status_if_new: 'subscribed',
        merge_fields: {
          FNAME: firstName ?? '',
          LNAME: rest.join(' '),
          ...(lead.phone ? { PHONE: lead.phone } : {}),
        },
      }),
    })

    if (!memberRes.ok) {
      const err = await memberRes.json().catch(() => null) as { detail?: string } | null
      return { ok: false, error: `Mailchimp ${memberRes.status}: ${err?.detail ?? 'member upsert failed'}` }
    }

    // 2. Apply tags (owner lead + pipeline stage + custom tags)
    const tags: { name: string; status: 'active' }[] = [
      { name: 'Owner Lead', status: 'active' },
      { name: `Stage: ${STATUS_CONFIG[lead.status].label}`, status: 'active' },
    ]
    for (const t of lead.tags ?? []) {
      if (t && t !== 'demo') tags.push({ name: t, status: 'active' })
    }

    const tagRes = await fetch(`${baseUrl()}/lists/${audienceId}/members/${hash}/tags`, {
      method: 'POST',
      headers: { 'Authorization': authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags }),
    })

    // Tag endpoint returns 204 on success; treat tag failure as soft error
    if (!tagRes.ok && tagRes.status !== 204) {
      return { ok: true } // member synced, tags failed silently
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Mailchimp request failed' }
  }
}

/** Get audience name + member count for the settings page. */
export async function getMailchimpAudienceInfo(): Promise<{ ok: boolean; name?: string; memberCount?: number; error?: string }> {
  if (!mailchimpConfigured()) return { ok: false, error: 'Not configured' }
  try {
    const res = await fetch(`${baseUrl()}/lists/${process.env.MAILCHIMP_AUDIENCE_ID}`, {
      headers: { 'Authorization': authHeader() },
    })
    if (!res.ok) return { ok: false, error: `Mailchimp ${res.status}` }
    const data = await res.json() as { name?: string; stats?: { member_count?: number } }
    return { ok: true, name: data.name, memberCount: data.stats?.member_count }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'request failed' }
  }
}
