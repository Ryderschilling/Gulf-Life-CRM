// POST /api/ai/chat
// Agentic AI chat with tool calling — the AI can read AND act:
// create/update leads, notes, todos, drafts, sends (confirm-gated),
// Mailchimp sync. Returns the reply + a log of actions taken.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { buildAIContext, AI_SYSTEM_BASE } from '@/lib/ai-context'
import { AI_TOOLS, executeAITool } from '@/lib/ai-tools'
import type { AIActionResult, AIChatMessage } from '@/lib/types'
import type OpenAI from 'openai'

export const maxDuration = 60

const MAX_TOOL_ROUNDS = 6

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { message, conversation_id, lead_id } = await req.json() as {
      message: string
      conversation_id?: string
      lead_id?: string
    }

    if (!message?.trim()) return NextResponse.json({ error: 'Message required' }, { status: 400 })

    // Load conversation history
    let history: AIChatMessage[] = []
    let convId = conversation_id

    if (convId) {
      const { data: conv } = await supabase
        .from('ai_conversations')
        .select('messages')
        .eq('id', convId)
        .single()
      if (conv?.messages) history = conv.messages as AIChatMessage[]
    }

    // Build full context (brain files, memories, pipeline, lead if provided)
    const context = await buildAIContext(supabase, { lead_id, include_pipeline: true })
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Chicago' })

    const systemPrompt = `${AI_SYSTEM_BASE}

TODAY: ${today}

TOOL RULES:
- You have tools that take real actions in the CRM. Use them proactively for anything the user asks you to DO (create, update, note, todo, draft, sync).
- Drafting emails is always safe — drafts go to a human review queue.
- send_email and send_sms actually deliver messages. NEVER call them with confirmed:true unless the user explicitly confirmed sending in this conversation (e.g. "yes send it"). If not yet confirmed, show them the message text and ask.
- When a lookup returns candidates instead of a single lead, ask the user which one they meant.
- After acting, summarize briefly what you did. Don't repeat full tool output.
- If a tool errors because an integration isn't configured, say so plainly and continue.

${context}`

    // Build OpenAI message array from history (last 20 turns)
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-20).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ]

    const actions: AIActionResult[] = []
    let reply = ''

    // Agentic loop
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const completion = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        messages,
        tools: AI_TOOLS,
        temperature: 0.6,
        max_tokens: 1400,
      })

      const choice = completion.choices[0]
      const msg = choice?.message
      if (!msg) break

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg)
        for (const call of msg.tool_calls) {
          if (call.type !== 'function') continue
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(call.function.arguments || '{}') } catch { /* leave empty */ }
          const { result, action } = await executeAITool(supabase, user.id, call.function.name, args)
          if (action) actions.push(action)
          messages.push({ role: 'tool', tool_call_id: call.id, content: result })
        }
        continue
      }

      reply = msg.content ?? ''
      break
    }

    if (!reply) reply = actions.length > 0
      ? 'Done — see the actions above.'
      : 'Sorry, I could not generate a response.'

    // Persist conversation
    const newHistory: AIChatMessage[] = [
      ...history,
      { role: 'user', content: message },
      { role: 'assistant', content: reply, ...(actions.length ? { actions } : {}) },
    ]

    if (convId) {
      await supabase.from('ai_conversations').update({
        messages: newHistory,
        updated_at: new Date().toISOString(),
      }).eq('id', convId)
    } else {
      const title = message.length > 60 ? message.substring(0, 57) + '...' : message
      const { data: newConv } = await supabase
        .from('ai_conversations')
        .insert({ messages: newHistory, title })
        .select('id')
        .single()
      convId = newConv?.id
    }

    return NextResponse.json({ reply, actions, conversation_id: convId })
  } catch (err) {
    console.error('[POST /api/ai/chat]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
