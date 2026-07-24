// ============================================================
// lib/pipeline.ts — Pipeline auto-advance rules.
// Single source of truth for what an outbound touch does to a lead's
// stage, so every send path (SMS route, email route, AI send tools)
// behaves identically.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Record an outbound message to a lead and auto-advance the pipeline.
 *
 * - Always stamps `last_contacted_at`.
 * - First-touch rule: if the lead is still in the `new` stage, advance it to
 *   `contacted` and log a `status_change` activity so the timeline and pipeline
 *   stay in sync. Never downgrades a lead that is already further along
 *   (nurturing / proposal) or closed.
 *
 * The stage bump is a guarded, atomic UPDATE (`.eq('status','new')`) so it is
 * race-safe under concurrent sends and can never clobber a later stage.
 *
 * Returns `{ advanced }` — true only when this call moved the lead new → contacted.
 */
export async function markContacted(
  supabase: SupabaseClient,
  leadId: string,
  userId?: string | null,
  at: string = new Date().toISOString(),
): Promise<{ advanced: boolean }> {
  // 1. Stamp contact time for EVERY lead, whatever stage they're in.
  await supabase.from('leads').update({ last_contacted_at: at }).eq('id', leadId)

  // 2. First-touch advance. Only rows still in 'new' match this filter, so a
  //    proposal/won/lost lead is untouched and concurrent sends can't double-move.
  const { data: advancedRows } = await supabase
    .from('leads')
    .update({ status: 'contacted' })
    .eq('id', leadId)
    .eq('status', 'new')
    .select('id')

  const advanced = !!(advancedRows && advancedRows.length > 0)

  // 3. Log the stage change the same way manual/AI stage moves do.
  if (advanced) {
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      user_id: userId ?? null,
      type: 'status_change',
      body: 'Stage changed: new → contacted (auto — first outbound message)',
      metadata: { from_status: 'new', to_status: 'contacted', auto: true },
    })
  }

  return { advanced }
}
