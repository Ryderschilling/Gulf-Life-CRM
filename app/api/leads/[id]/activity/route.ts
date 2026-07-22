// POST /api/leads/[id]/activity
// Universal activity logger for a lead. Called from kanban, emails, SMS, anywhere.
// All lead actions hit this endpoint so the timeline is always complete.
//
// Body: { type, description, metadata? }
// Types: stage_change | note_added | email_sent | sms_sent | call_logged | email_draft_created

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ActivityType } from '@/lib/types'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: lead_id } = await params
    const body = await req.json() as {
      type: ActivityType
      description: string
      metadata?: Record<string, unknown>
    }

    if (!body.type || !body.description) {
      return NextResponse.json({ error: 'type and description are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('lead_activities')
      .insert({
        lead_id,
        type: body.type,
        body: body.description,
        metadata: body.metadata ?? null,
        user_id: user.id,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ activity: data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leads/[id]/activity]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
