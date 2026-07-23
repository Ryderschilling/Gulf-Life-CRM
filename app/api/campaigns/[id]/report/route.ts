// GET /api/campaigns/:id/report — full Mailchimp stats for one campaign,
// shown in the Campaigns page detail popup (opens, clicks, bounces,
// unsubscribes, and which links were clicked).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMailchimpCampaignReport, mailchimpConfigured } from '@/lib/mailchimp'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!mailchimpConfigured()) {
    return NextResponse.json({ error: 'Mailchimp is not configured' }, { status: 400 })
  }

  const { id } = await params
  if (!/^[a-z0-9]+$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })
  }

  const result = await getMailchimpCampaignReport(id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 })
  return NextResponse.json({ report: result.report })
}
