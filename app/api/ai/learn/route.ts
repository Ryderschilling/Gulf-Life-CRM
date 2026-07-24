// POST /api/ai/learn
// Manual / retry endpoint. Called when a rep sends an email that was edited
// from the AI draft. Analyzes the diff and stores it as style_correction
// memories. The actual work lives in lib/learn.ts (shared with the send path).
// Body: { draft_id: string }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { learnFromDraftEdit } from '@/lib/learn'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { draft_id } = await req.json() as { draft_id: string }
    if (!draft_id) return NextResponse.json({ error: 'draft_id required' }, { status: 400 })

    const result = await learnFromDraftEdit(supabase, draft_id)
    if ('error' in result) return NextResponse.json(result, { status: 500 })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[POST /api/ai/learn]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
