'use client'

// Global AI assistant — floating button + slide-over chat panel.
// Available on every CRM page. On a lead page it automatically
// gets that lead's full context.

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { Sparkles, X, Send, Check, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AIActionResult, AIChatMessage } from '@/lib/types'

const SUGGESTIONS = [
  'Who should I follow up with today?',
  'Draft a follow-up email for my proposal-stage leads',
  'Add a lead: ',
  'How is the pipeline looking?',
]

export default function AIDrawer() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AIChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const pathname = usePathname()
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Pull the lead id from the URL when on a lead detail page
  const leadMatch = pathname.match(/^\/crm\/leads\/([0-9a-f-]{36})/)
  const leadId = leadMatch?.[1]

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || busy) return
    setInput('')
    setBusy(true)
    setMessages(prev => [...prev, { role: 'user', content }])

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          conversation_id: conversationId ?? undefined,
          lead_id: leadId ?? undefined,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Something went wrong: ${data.error}` }])
      } else {
        setConversationId(data.conversation_id ?? null)
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply, actions: data.actions }])
        // Refresh server components if the AI changed data
        if (data.actions?.length > 0) router.refresh()
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Network error — try again.' }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-[150] w-[52px] h-[52px] rounded-full bg-accent text-white flex items-center justify-center shadow-pop hover:bg-accent-dark transition-colors"
          title="Ask AI"
          style={{ bottom: 'max(24px, calc(env(safe-area-inset-bottom) + 66px))' }}
        >
          <Sparkles size={22} />
        </button>
      )}

      {/* Drawer */}
      {open && (
        <div className="fixed inset-y-0 right-0 z-[180] w-full max-w-[420px] bg-card border-l border-line shadow-pop flex flex-col slide-in-right">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center">
                <Sparkles size={16} />
              </div>
              <div>
                <p className="text-[14.5px] font-semibold text-ink m-0">AI Assistant</p>
                <p className="text-[11.5px] text-ink-3 m-0">{leadId ? 'Has this lead\'s full context' : 'Knows your whole pipeline'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={() => { setMessages([]); setConversationId(null) }}
                  className="text-[12px] font-semibold text-ink-3 hover:text-ink px-2 py-1 rounded-md hover:bg-[#f5f6fa]"
                >
                  New chat
                </button>
              )}
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-3 hover:bg-[#f5f6fa] hover:text-ink">
                <X size={17} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="pt-6">
                <p className="text-[13.5px] text-ink-2 text-center mb-4">
                  Ask anything, or tell me to do something —<br />I can update leads, add to-dos, draft messages, and more.
                </p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => s.endsWith(': ') ? setInput(s) : send(s)}
                      className="text-left text-[13px] text-ink-2 bg-[#f7f8fb] hover:bg-accent-soft hover:text-accent border border-line rounded-xl px-3.5 py-2.5 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}

            {busy && (
              <div className="flex items-center gap-1.5 px-3 py-2">
                <span className="typing-dot w-1.5 h-1.5 bg-accent rounded-full inline-block" />
                <span className="typing-dot w-1.5 h-1.5 bg-accent rounded-full inline-block" />
                <span className="typing-dot w-1.5 h-1.5 bg-accent rounded-full inline-block" />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-4 py-3.5 border-t border-line">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                }}
                rows={1}
                placeholder="Ask or instruct…"
                className="flex-1 bg-[#f7f8fb] border border-line-strong rounded-xl px-3.5 py-2.5 text-[14px] text-ink resize-none max-h-32"
                style={{ minHeight: 42 }}
              />
              <button
                onClick={() => send()}
                disabled={busy || !input.trim()}
                className="w-[42px] h-[42px] rounded-xl bg-accent text-white flex items-center justify-center disabled:opacity-40 hover:bg-accent-dark transition-colors shrink-0"
              >
                <Send size={17} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function MessageBubble({ message }: { message: AIChatMessage }) {
  return (
    <div className={cn('mb-3 fade-up', message.role === 'user' ? 'flex justify-end' : '')}>
      <div className={cn('max-w-[88%]', message.role === 'user' ? '' : 'w-full')}>
        {/* Action chips */}
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-2">
            {message.actions.map((a, i) => (
              <ActionChip key={i} action={a} />
            ))}
          </div>
        )}
        <div
          className={cn(
            'px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap',
            message.role === 'user'
              ? 'bg-accent text-white rounded-2xl rounded-br-md'
              : 'bg-[#f7f8fb] text-ink rounded-2xl rounded-bl-md border border-line'
          )}
        >
          {message.content}
        </div>
      </div>
    </div>
  )
}

function ActionChip({ action }: { action: AIActionResult }) {
  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold w-fit',
      action.ok ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'
    )}>
      {action.ok ? <Check size={13} strokeWidth={3} /> : <AlertCircle size={13} />}
      {action.summary}
    </div>
  )
}
