// lib/learn.ts
// Shared "learn from an edited draft" logic.
// When a rep edits an AI-written email draft before sending it, we diff the
// original vs the sent version and store 1-3 reusable style corrections as
// ai_memories (type 'style_correction', source 'draft_edit'). These then feed
// back into future drafts via the AI context.
//
// Called from:
//   - POST /api/emails/send   (fire-and-forget, right after a review-queue send)
//   - POST /api/ai/learn      (manual / retry endpoint)
//
// Idempotent: guarded by email_drafts.edit_learned so a draft is only ever
// analyzed once.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getOpenAI } from './openai'

export type LearnResult =
  | { learned: number; corrections: { title: string; content: string }[] }
  | { skipped: true; reason?: string }
  | { error: string }

export async function learnFromDraftEdit(
  supabase: SupabaseClient,
  draftId: string
): Promise<LearnResult> {
  const { data: draft, error } = await supabase
    .from('email_drafts')
    .select('id, lead_id, subject, body, original_subject, original_body, edit_learned')
    .eq('id', draftId)
    .single()

  if (error || !draft) return { error: error?.message ?? 'Draft not found' }
  if (draft.edit_learned) return { skipped: true, reason: 'already learned' }

  // No original to diff against, or nothing actually changed → nothing to learn.
  if (!draft.original_body || draft.body === draft.original_body) {
    await supabase.from('email_drafts').update({ edit_learned: true }).eq('id', draftId)
    return { skipped: true, reason: 'no edits' }
  }

  const analysisPrompt = `An email draft was edited by a human before sending. Analyze the edit and extract 1-3 specific, reusable style preferences.

ORIGINAL AI DRAFT:
Subject: ${draft.original_subject}
${draft.original_body}

EDITED VERSION THAT WAS SENT:
Subject: ${draft.subject}
${draft.body}

Extract concrete, reusable style corrections in this JSON format:
{
  "corrections": [
    {
      "title": "Short label for this preference (< 10 words)",
      "content": "Specific instruction for future drafts (1-2 sentences)"
    }
  ]
}

Only include meaningful changes. If the edits are trivial (fixing a typo), return empty corrections array.`

  let corrections: { title: string; content: string }[] = []
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.3,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    })
    const raw = completion.choices[0]?.message?.content ?? '{}'
    corrections = (JSON.parse(raw) as { corrections?: { title: string; content: string }[] }).corrections ?? []
  } catch (err) {
    // Don't burn the edit_learned flag if the model/parse failed — allow a retry.
    return { error: err instanceof Error ? err.message : 'Analysis failed' }
  }

  if (corrections.length > 0) {
    await supabase.from('ai_memories').insert(
      corrections.map((c) => ({
        type: 'style_correction',
        title: c.title,
        content: c.content,
        lead_id: draft.lead_id,
        source: 'draft_edit',
        is_active: true,
      }))
    )
  }

  await supabase.from('email_drafts').update({ edit_learned: true }).eq('id', draftId)
  return { learned: corrections.length, corrections }
}
