// GET /api/integrations/status
// Live status of every integration — shown on the Settings page.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { quoConfigured, listQuoNumbers, quoFromNumber } from '@/lib/quo'
import { mailchimpConfigured, getMailchimpAudienceInfo } from '@/lib/mailchimp'
import { resendConfigured, FROM_EMAIL } from '@/lib/resend'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Quo — verify key live when configured
  let quo: { configured: boolean; detail: string; ok: boolean } = {
    configured: quoConfigured(),
    detail: 'Add QUO_API_KEY and QUO_FROM_NUMBER',
    ok: false,
  }
  if (process.env.QUO_API_KEY) {
    const numbers = await listQuoNumbers()
    if (numbers.ok) {
      const from = quoFromNumber()
      quo = {
        configured: quoConfigured(),
        ok: quoConfigured(),
        detail: quoConfigured()
          ? `Sending from ${from} · ${numbers.numbers?.length ?? 0} number(s) on account`
          : `Key works (${numbers.numbers?.length ?? 0} numbers found) — set QUO_FROM_NUMBER`,
      }
    } else {
      quo = { configured: false, ok: false, detail: `Key rejected: ${numbers.error}` }
    }
  }

  // Mailchimp — verify audience live when configured
  let mailchimp: { configured: boolean; detail: string; ok: boolean } = {
    configured: mailchimpConfigured(),
    detail: 'Add MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID',
    ok: false,
  }
  if (mailchimpConfigured()) {
    const info = await getMailchimpAudienceInfo()
    mailchimp = info.ok
      ? { configured: true, ok: true, detail: `Audience "${info.name}" · ${info.memberCount ?? 0} members` }
      : { configured: true, ok: false, detail: `Configured but failing: ${info.error}` }
  }

  return NextResponse.json({
    supabase: { configured: true, ok: true, detail: 'Database + login connected' },
    openai: {
      configured: !!process.env.OPENAI_API_KEY,
      ok: !!process.env.OPENAI_API_KEY,
      detail: process.env.OPENAI_API_KEY ? 'AI drafts, chat & digest enabled' : 'Add OPENAI_API_KEY',
    },
    resend: {
      configured: resendConfigured(),
      ok: resendConfigured(),
      detail: resendConfigured() ? `Sending from ${FROM_EMAIL}` : 'Add RESEND_API_KEY',
    },
    quo,
    mailchimp,
  })
}
