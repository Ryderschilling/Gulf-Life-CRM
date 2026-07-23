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

// ════════════════════════════════════════════════════════════
// Campaigns — the CRM's /crm/campaigns page composes and sends
// email blasts through Mailchimp (audience, unsubscribe links,
// and deliverability stay Mailchimp's job; the CRM is the UI).
// ════════════════════════════════════════════════════════════

async function mc(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { 'Authorization': authHeader(), 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}

function mcError(data: unknown, fallback: string): string {
  const d = data as { detail?: string; title?: string } | null
  return d?.detail ?? d?.title ?? fallback
}

export interface MailchimpTag { id: number; name: string; memberCount: number }

/** Tags (static segments) in the audience — used as send-to filters. */
export async function listMailchimpTags(): Promise<{ ok: boolean; tags?: MailchimpTag[]; error?: string }> {
  if (!mailchimpConfigured()) return { ok: false, error: 'Not configured' }
  try {
    const r = await mc(`/lists/${process.env.MAILCHIMP_AUDIENCE_ID}/segments?type=static&count=60&fields=segments.id,segments.name,segments.member_count`)
    if (!r.ok) return { ok: false, error: mcError(r.data, `Mailchimp ${r.status}`) }
    const d = r.data as { segments?: { id: number; name: string; member_count: number }[] }
    return { ok: true, tags: (d.segments ?? []).map(s => ({ id: s.id, name: s.name, memberCount: s.member_count })) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'request failed' }
  }
}

export interface MailchimpCampaignSummary {
  id: string
  subject: string
  status: string
  sendTime: string | null
  createTime: string | null
  emailsSent: number
  openRate: number
  clickRate: number
  uniqueOpens: number
  subscriberClicks: number
  archiveUrl: string | null
}

/** Every campaign for this audience, newest first, with headline stats. */
export async function listMailchimpCampaigns(): Promise<{ ok: boolean; campaigns?: MailchimpCampaignSummary[]; error?: string }> {
  if (!mailchimpConfigured()) return { ok: false, error: 'Not configured' }
  try {
    const r = await mc(`/campaigns?list_id=${process.env.MAILCHIMP_AUDIENCE_ID}&count=200&sort_field=create_time&sort_dir=DESC&fields=campaigns.id,campaigns.status,campaigns.send_time,campaigns.create_time,campaigns.emails_sent,campaigns.archive_url,campaigns.settings.subject_line,campaigns.settings.title,campaigns.report_summary.open_rate,campaigns.report_summary.click_rate,campaigns.report_summary.unique_opens,campaigns.report_summary.subscriber_clicks`)
    if (!r.ok) return { ok: false, error: mcError(r.data, `Mailchimp ${r.status}`) }
    const d = r.data as { campaigns?: {
      id: string; status: string; send_time?: string; create_time?: string; emails_sent?: number; archive_url?: string
      settings?: { subject_line?: string; title?: string }
      report_summary?: { open_rate?: number; click_rate?: number; unique_opens?: number; subscriber_clicks?: number }
    }[] }
    return {
      ok: true,
      campaigns: (d.campaigns ?? []).map(c => ({
        id: c.id,
        subject: c.settings?.subject_line || c.settings?.title || '(no subject)',
        status: c.status,
        sendTime: c.send_time || null,
        createTime: c.create_time || null,
        emailsSent: c.emails_sent ?? 0,
        openRate: c.report_summary?.open_rate ?? 0,
        clickRate: c.report_summary?.click_rate ?? 0,
        uniqueOpens: c.report_summary?.unique_opens ?? 0,
        subscriberClicks: c.report_summary?.subscriber_clicks ?? 0,
        archiveUrl: c.archive_url ?? null,
      })),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'request failed' }
  }
}

export interface MailchimpCampaignReport {
  subject: string
  sendTime: string | null
  emailsSent: number
  opens: { total: number; unique: number; rate: number; last: string | null }
  clicks: { total: number; unique: number; rate: number; last: string | null }
  bounces: number
  unsubscribed: number
  abuseReports: number
  clickedLinks: { url: string; totalClicks: number; uniqueClicks: number; clickRate: number }[]
}

/** Full report for one sent campaign — headline numbers + which links got clicked. */
export async function getMailchimpCampaignReport(campaignId: string): Promise<{ ok: boolean; report?: MailchimpCampaignReport; error?: string }> {
  if (!mailchimpConfigured()) return { ok: false, error: 'Not configured' }
  try {
    const [rep, clicks] = await Promise.all([
      mc(`/reports/${campaignId}`),
      mc(`/reports/${campaignId}/click-details?count=20&sort_field=total_clicks&sort_dir=DESC`),
    ])
    if (!rep.ok) return { ok: false, error: mcError(rep.data, 'No stats yet — this campaign has not been sent') }
    const d = rep.data as {
      subject_line?: string; send_time?: string; emails_sent?: number
      opens?: { opens_total?: number; unique_opens?: number; open_rate?: number; last_open?: string }
      clicks?: { clicks_total?: number; unique_clicks?: number; click_rate?: number; last_click?: string }
      bounces?: { hard_bounces?: number; soft_bounces?: number; syntax_errors?: number }
      unsubscribed?: number
      abuse_reports?: number
    }
    const cd = (clicks.ok ? clicks.data : null) as { urls_clicked?: { url: string; total_clicks?: number; unique_clicks?: number; click_percentage?: number }[] } | null
    return {
      ok: true,
      report: {
        subject: d.subject_line ?? '',
        sendTime: d.send_time || null,
        emailsSent: d.emails_sent ?? 0,
        opens: {
          total: d.opens?.opens_total ?? 0,
          unique: d.opens?.unique_opens ?? 0,
          rate: d.opens?.open_rate ?? 0,
          last: d.opens?.last_open || null,
        },
        clicks: {
          total: d.clicks?.clicks_total ?? 0,
          unique: d.clicks?.unique_clicks ?? 0,
          rate: d.clicks?.click_rate ?? 0,
          last: d.clicks?.last_click || null,
        },
        bounces: (d.bounces?.hard_bounces ?? 0) + (d.bounces?.soft_bounces ?? 0) + (d.bounces?.syntax_errors ?? 0),
        unsubscribed: d.unsubscribed ?? 0,
        abuseReports: d.abuse_reports ?? 0,
        clickedLinks: (cd?.urls_clicked ?? []).map(u => ({
          url: u.url,
          totalClicks: u.total_clicks ?? 0,
          uniqueClicks: u.unique_clicks ?? 0,
          clickRate: u.click_percentage ?? 0,
        })),
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'request failed' }
  }
}

export interface SendCampaignInput {
  subject: string
  previewText?: string
  html: string
  /** Mailchimp static-segment (tag) id — omit to send to the whole audience */
  tagId?: number
  /** When set, only a test email is sent to this address; the campaign stays a draft in Mailchimp */
  testEmail?: string
}

/** Create a campaign (whole audience or one tag), set content, then send (or test-send). */
export async function sendMailchimpCampaign(input: SendCampaignInput): Promise<{ ok: boolean; campaignId?: string; error?: string }> {
  if (!mailchimpConfigured()) return { ok: false, error: 'Mailchimp is not configured' }
  const listId = process.env.MAILCHIMP_AUDIENCE_ID!
  const fromName = process.env.EMAIL_FROM_NAME ?? 'Gulf Life Concierge'
  const replyTo = (process.env.EMAIL_FROM_ADDRESS ?? 'host@livegulflife.com').toLowerCase()

  try {
    // 1. Create
    const create = await mc('/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        type: 'regular',
        recipients: {
          list_id: listId,
          ...(input.tagId ? { segment_opts: { saved_segment_id: input.tagId } } : {}),
        },
        settings: {
          subject_line: input.subject,
          preview_text: input.previewText ?? '',
          title: `CRM: ${input.subject}`,
          from_name: fromName,
          reply_to: replyTo,
          auto_footer: false,
        },
      }),
    })
    if (!create.ok) return { ok: false, error: mcError(create.data, 'Could not create campaign') }
    const campaignId = (create.data as { id?: string })?.id
    if (!campaignId) return { ok: false, error: 'Mailchimp returned no campaign id' }

    // 2. Content
    const content = await mc(`/campaigns/${campaignId}/content`, {
      method: 'PUT',
      body: JSON.stringify({ html: input.html }),
    })
    if (!content.ok) return { ok: false, campaignId, error: mcError(content.data, 'Could not set campaign content') }

    // 3. Send (or test)
    if (input.testEmail) {
      const test = await mc(`/campaigns/${campaignId}/actions/test`, {
        method: 'POST',
        body: JSON.stringify({ test_emails: [input.testEmail], send_type: 'html' }),
      })
      if (!test.ok) return { ok: false, campaignId, error: mcError(test.data, 'Test send failed') }
      return { ok: true, campaignId }
    }

    const send = await mc(`/campaigns/${campaignId}/actions/send`, { method: 'POST' })
    if (!send.ok) return { ok: false, campaignId, error: mcError(send.data, 'Send failed') }
    return { ok: true, campaignId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Mailchimp request failed' }
  }
}
