// ============================================================
// /api/campaigns — the CRM's campaign composer backend.
//   GET  → audience info + tags + recent campaigns w/ stats
//   POST → { subject, preview_text?, body, tag_id?, mode, test_email? }
//          mode 'test' sends only to test_email (campaign stays a
//          Mailchimp draft); mode 'send' sends the real blast.
// Mailchimp does the actual delivery: unsubscribe handling, list
// compliance, and stats stay theirs. Body text is wrapped in a
// clean branded template with the legally-required footer tags.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  mailchimpConfigured, getMailchimpAudienceInfo, listMailchimpTags,
  listMailchimpCampaigns, sendMailchimpCampaign,
} from '@/lib/mailchimp'

export const dynamic = 'force-dynamic'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Plain typed text → simple, email-client-safe branded HTML. */
function buildHtml(bodyText: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#2b2f36;">${esc(p.trim()).replace(/\n/g, '<br/>')}</p>`)
    .join('')

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f2f4f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f8;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#0d9488;padding:20px 32px;">
          <p style="margin:0;font-family:Georgia,serif;font-size:19px;color:#ffffff;letter-spacing:0.3px;">Gulf Life Concierge</p>
        </td></tr>
        <tr><td style="padding:30px 32px 18px;font-family:Helvetica,Arial,sans-serif;">
          ${paragraphs}
        </td></tr>
        <tr><td style="padding:0 32px 26px;font-family:Helvetica,Arial,sans-serif;">
          <p style="margin:0;font-size:13px;color:#7a8089;">Gulf Life Concierge · 30A, Florida</p>
        </td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:16px 12px;text-align:center;font-family:Helvetica,Arial,sans-serif;">
          <p style="margin:0;font-size:11.5px;line-height:1.6;color:#9aa0a8;">
            *|LIST:ADDRESSLINE|*<br/>
            You're receiving this because you're connected with Gulf Life Concierge.
            <a href="*|UNSUB|*" style="color:#9aa0a8;">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!mailchimpConfigured()) {
    return NextResponse.json({ configured: false })
  }

  const [audience, tags, campaigns] = await Promise.all([
    getMailchimpAudienceInfo(),
    listMailchimpTags(),
    listMailchimpCampaigns(),
  ])

  return NextResponse.json({
    configured: true,
    audience: audience.ok ? { name: audience.name, memberCount: audience.memberCount ?? 0 } : null,
    tags: tags.tags ?? [],
    campaigns: campaigns.campaigns ?? [],
    error: audience.ok ? undefined : audience.error,
  })
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!mailchimpConfigured()) {
      return NextResponse.json({ error: 'Mailchimp is not configured' }, { status: 400 })
    }

    const payload = await req.json() as {
      subject?: string
      preview_text?: string
      body?: string
      tag_id?: number
      mode?: 'send' | 'test'
      test_email?: string
    }

    const subject = payload.subject?.trim()
    const body = payload.body?.trim()
    const mode = payload.mode ?? 'test'

    if (!subject || !body) {
      return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 })
    }
    if (mode === 'test' && !payload.test_email?.trim()) {
      return NextResponse.json({ error: 'A test email address is required' }, { status: 400 })
    }

    const result = await sendMailchimpCampaign({
      subject,
      previewText: payload.preview_text?.trim() || undefined,
      html: buildHtml(body),
      tagId: payload.tag_id || undefined,
      testEmail: mode === 'test' ? payload.test_email!.trim() : undefined,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Campaign failed' }, { status: 502 })
    }
    return NextResponse.json({ success: true, mode, campaign_id: result.campaignId })
  } catch (err) {
    console.error('[POST /api/campaigns]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
