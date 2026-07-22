// POST /api/mailchimp/sync
// Body: { lead_ids: string[] }  or  { lead_type: 'guest' | 'owner' }
// Upserts leads into the Mailchimp audience with tags.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncLeadToMailchimp, mailchimpConfigured } from '@/lib/mailchimp'
import type { Lead } from '@/lib/types'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!mailchimpConfigured()) {
      return NextResponse.json({ error: 'Mailchimp is not set up yet — add the API key and audience ID in Settings.' }, { status: 400 })
    }

    const body = await req.json() as { lead_ids?: string[]; lead_type?: 'guest' | 'owner' }

    let leads: Lead[] = []
    if (body.lead_ids && body.lead_ids.length > 0) {
      const { data } = await supabase.from('leads').select('*').in('id', body.lead_ids.slice(0, 500))
      leads = (data ?? []) as Lead[]
    } else if (body.lead_type) {
      const { data } = await supabase.from('leads').select('*').eq('lead_type', body.lead_type).not('email', 'is', null).limit(500)
      leads = (data ?? []) as Lead[]
    } else {
      return NextResponse.json({ error: 'Provide lead_ids or lead_type' }, { status: 400 })
    }

    let synced = 0, failed = 0
    const failures: { name: string; error: string }[] = []

    for (const lead of leads) {
      if (!lead.email) { failed++; failures.push({ name: lead.name, error: 'No email' }); continue }
      const result = await syncLeadToMailchimp(lead)
      if (result.ok) {
        synced++
        await Promise.all([
          supabase.from('leads').update({ mailchimp_synced_at: new Date().toISOString(), mailchimp_status: 'synced' }).eq('id', lead.id),
          supabase.from('lead_activities').insert({
            lead_id: lead.id, user_id: user.id, type: 'mailchimp_sync', body: 'Synced to Mailchimp audience',
          }),
        ])
      } else {
        failed++
        failures.push({ name: lead.name, error: result.error ?? 'Unknown' })
        await supabase.from('leads').update({ mailchimp_status: 'failed' }).eq('id', lead.id)
      }
    }

    return NextResponse.json({ synced, failed, failures: failures.slice(0, 10) })
  } catch (err) {
    console.error('[POST /api/mailchimp/sync]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
