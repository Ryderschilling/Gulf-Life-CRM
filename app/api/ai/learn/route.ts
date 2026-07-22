// POST /api/ai/learn
// Called when a rep sends an email that was edited from the AI draft.
// Analyzes the diff and stores it as a style_correction memory.
// Body: { draft_id: string }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { draft_id } = await req.json() as { draft_id: string }
    if (!draft_id) return NextResponse.json({ error: 'draft_id required' }, { status: 400 })

    const { data: draft } = await supabase
      .from('email_drafts')
      .select('*, lead:leads(name)')
      .eq('id', draft_id)
      .single()

    if (!draft || draft.edit_learned) return NextResponse.json({ skipped: true })

    // No edits — nothing to learn
    if (!draft.original_body || draft.body === draft.original_body) {
      await supabase.from('email_drafts').update({ edit_learned: true }).eq('id', draft_id)
      return NextResponse.json({ skipped: true, reason: 'no edits' })
    }

    // Ask GPT to analyze what changed and what it means stylistically
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

    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.3,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    const { corrections = [] } = JSON.parse(raw) as { corrections: { title: string; content: string }[] }

    // Store each correction as a memory
    if (corrections.length > 0) {
      await supabase.from('ai_memories').insert(
        corrections.map((c: { title: string; content: string }) => ({
          type: 'style_correction',
          title: c.title,
          content: c.content,
          lead_id: draft.lead_id,
          source: 'draft_edit',
        }))
      )
    }

    // Mark as learned
    await supabase.from('email_drafts').update({ edit_learned: true }).eq('id', draft_id)

    return NextResponse.json({ learned: corrections.length, corrections })
  } catch (err) {
    console.error('[POST /api/ai/learn]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
