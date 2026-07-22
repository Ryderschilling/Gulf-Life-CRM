// GET  /api/ai/memory           — list memories (optional ?type=&lead_id=)
// POST /api/ai/memory           — add a memory manually
// DELETE /api/ai/memory?id=xx   — deactivate a memory

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const lead_id = searchParams.get('lead_id')

  let query = supabase
    .from('ai_memories')
    .select('*, lead:leads(name)')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(100)

  if (type) query = query.eq('type', type)
  if (lead_id) query = query.eq('lead_id', lead_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ memories: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { data, error } = await supabase
    .from('ai_memories')
    .insert({ ...body, source: body.source ?? 'manual' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ memory: data }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await supabase.from('ai_memories').update({ is_active: false }).eq('id', id)
  return NextResponse.json({ success: true })
}
