// POST /api/emails/dismiss
// Rep dismisses a draft they don't want to send.
// Body: { draft_id: string }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { draft_id } = await req.json() as { draft_id: string }

    if (!draft_id) {
      return NextResponse.json({ error: 'draft_id is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('email_drafts')
      .update({
        status: 'dismissed',
        dismissed_at: new Date().toISOString(),
        dismissed_by: user.id,
      })
      .eq('id', draft_id)
      .eq('status', 'pending') // Only dismiss pending drafts

    if (error) {
      return NextResponse.json({ error: 'Failed to dismiss draft' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[POST /api/emails/dismiss]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
