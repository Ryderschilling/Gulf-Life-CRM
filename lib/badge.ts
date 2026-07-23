// ============================================================
// lib/badge.ts — the sidebar To-Do badge count, computed in ONE
// place so the badge always matches what the To-Do page shows:
// open tasks + drafts to review + follow-ups due (today or earlier,
// CRM-local calendar — same rule as everywhere else).
// Used by the CRM layout (initial render) and /api/todos/count
// (client-side refresh on navigation).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { endOfTodayISO } from './dates'

export async function countPendingTodoItems(supabase: SupabaseClient): Promise<number> {
  const [todos, drafts, followUps] = await Promise.all([
    supabase.from('todos').select('id', { count: 'exact', head: true }).eq('is_completed', false).eq('is_archived', false),
    supabase.from('email_drafts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('lead_type', 'owner')
      .lte('next_follow_up_at', endOfTodayISO())
      .not('status', 'in', '("closed_won","closed_lost")'),
  ])
  return (todos.count ?? 0) + (drafts.count ?? 0) + (followUps.count ?? 0)
}
