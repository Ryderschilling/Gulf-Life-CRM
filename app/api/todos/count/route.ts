// GET /api/todos/count — live sidebar badge count.
// The CRM layout computes the badge server-side on first render, but Next
// doesn't re-run layouts on soft navigation, so the Sidebar refetches this
// on every route change to stay accurate.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { countPendingTodoItems } from '@/lib/badge'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json({ count: await countPendingTodoItems(supabase) })
  } catch (err) {
    console.error('[GET /api/todos/count]', err)
    return NextResponse.json({ count: 0 })
  }
}
