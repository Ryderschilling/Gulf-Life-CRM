// GET  /api/todos?archived=true  — list todos (active or archived)
// POST /api/todos                — create a todo

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TodoInsert } from '@/lib/types'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const archived = req.nextUrl.searchParams.get('archived') === 'true'

    const { data, error } = await supabase
      .from('todos')
      .select('*, lead:leads(id, name, email, phone, status), draft:email_drafts(id, subject, status, to_email, to_name)')
      .eq('is_archived', archived)
      .order('is_completed', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ todos: data ?? [] })
  } catch (err) {
    console.error('[GET /api/todos]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json() as Partial<TodoInsert>

    if (!body.title?.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const insert: TodoInsert = {
      title: body.title.trim(),
      description: body.description ?? null,
      type: body.type ?? 'manual',
      linked_lead_id: body.linked_lead_id ?? null,
      linked_draft_id: body.linked_draft_id ?? null,
      is_completed: false,
      completed_at: null,
      is_archived: false,
      archived_at: null,
      sort_order: body.sort_order ?? 0,
      created_by: user.id,
      // Only include when provided — the column arrives with migration 003
      ...(body.assigned_to !== undefined ? { assigned_to: body.assigned_to } : {}),
    }

    const { data, error } = await supabase
      .from('todos')
      .insert(insert)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ todo: data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/todos]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
