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

/** Turn bare URLs in already-escaped text into gold links. */
function linkify(escaped: string): string {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const clean = url.replace(/[.,)]+$/, '')
    const trail = url.slice(clean.length)
    return `<a href="${clean}" style="color:#907240;text-decoration:underline;">${clean}</a>${trail}`
  })
}

// Gulf Life brand — pulled from the live site's design system.
const BRAND = {
  gold: '#AB9055',
  goldDark: '#907240',
  navy: '#2B354E',
  ink: '#3a4150',
  cream: '#F7F4EE',
  hairline: '#e7e0d2',
  logoUrl: 'https://mcusercontent.com/ff99ff66f8cadca06efbbb426/images/e729702a-2419-6d69-e45b-77b61bdcdca1.png',
}

/** Plain typed text → Gulf Life-branded, email-client-safe HTML.
 *  Mailchimp merge tags typed by the author (e.g. *|FNAME|*) pass through. */
function buildHtml(bodyText: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:15.5px;line-height:1.75;color:${BRAND.ink};">${linkify(esc(p.trim())).replace(/\n/g, '<br/>')}</p>`)
    .join('')

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:${BRAND.cream};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};padding:36px 12px 24px;">
    <tr><td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:6px;overflow:hidden;border-top:3px solid ${BRAND.gold};">
        <tr><td align="center" style="padding:36px 40px 26px;">
          <img src="${BRAND.logoUrl}" alt="Gulf Life Concierge" width="132" style="display:block;width:132px;height:auto;" />
        </td></tr>
        <tr><td style="padding:0 44px;">
          <div style="border-top:1px solid ${BRAND.hairline};font-size:0;line-height:0;">&nbsp;</div>
        </td></tr>
        <tr><td style="padding:26px 44px 10px;">
          ${paragraphs}
        </td></tr>
        <tr><td align="center" style="padding:8px 44px 34px;">
          <div style="border-top:1px solid ${BRAND.hairline};font-size:0;line-height:0;margin-bottom:22px;">&nbsp;</div>
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:3px;color:${BRAND.gold};text-transform:uppercase;">Gulf Life Concierge</p>
          <p style="margin:6px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:1px;color:${BRAND.navy};">Scenic Highway 30A &middot; Florida</p>
        </td></tr>
      </table>
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">
        <tr><td style="padding:18px 16px;text-align:center;font-family:Helvetica,Arial,sans-serif;">
          <p style="margin:0;font-size:11px;line-height:1.7;color:#a8a397;">
            *|LIST:ADDRESSLINE|*<br/>
            You're receiving this because you're connected with Gulf Life Concierge.
            <a href="*|UNSUB|*" style="color:#a8a397;text-decoration:underline;">Unsubscribe</a>
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
