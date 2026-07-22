// PATCH /api/todos/[id] — complete, archive, or update a todo

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface Params { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json() as {
      is_completed?: boolean
      is_archived?: boolean
      title?: string
      description?: string
    }

    const now = new Date().toISOString()
    const updates: Record<string, unknown> = {}

    if (body.title !== undefined) updates.title = body.title.trim()
    if (body.description !== undefined) updates.description = body.description

    if (body.is_completed !== undefined) {
      updates.is_completed = body.is_completed
      updates.completed_at = body.is_completed ? now : null
      // Auto-archive when completed
      if (body.is_completed) {
        updates.is_archived = true
        updates.archived_at = now
      }
    }

    if (body.is_archived !== undefined && !updates.is_archived) {
      updates.is_archived = body.is_archived
      updates.archived_at = body.is_archived ? now : null
    }

    const { data, error } = await supabase
      .from('todos')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ todo: data })
  } catch (err) {
    console.error('[PATCH /api/todos/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const { error } = await supabase.from('todos').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/todos/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
