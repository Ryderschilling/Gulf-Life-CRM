'use client'

// Gulf AI — global assistant. Floating orb + slide-over chat panel,
// available on every CRM page. On a lead page it automatically
// gets that lead's full context.

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { X, Send, Check, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AIActionResult, AIChatMessage } from '@/lib/types'
import { AIMark, AIThinking } from '@/components/ai/AIMark'

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

  // Esc closes the drawer
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

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
      {/* Floating orb */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="ai-orb ai-chip-in fixed bottom-6 right-6 z-[150] w-[54px] h-[54px] rounded-full flex items-center justify-center"
          title="Ask Gulf AI"
          style={{ bottom: 'max(24px, calc(env(safe-area-inset-bottom) + 66px))' }}
        >
          <AIMark size={30} variant="white" />
        </button>
      )}

      {/* Drawer */}
      {open && (
        <>
          <div className="ai-overlay z-[170]" onClick={() => setOpen(false)} />
          <div className="ai-panel fixed inset-y-0 right-0 z-[180] w-full max-w-[420px] bg-card border-l border-line shadow-pop flex flex-col">
            <div className="ai-hairline shrink-0" />

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <div className="flex items-center gap-3">
                <AIMark size={34} thinking={busy} />
                <div>
                  <p className="text-[14.5px] font-bold text-ink m-0 tracking-tight">Gulf AI</p>
                  <p className="text-[11.5px] text-ink-3 m-0">{leadId ? 'Has this lead\'s full context' : 'Knows your whole pipeline'}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={() => { setMessages([]); setConversationId(null) }}
                    className="text-[12px] font-semibold text-ink-3 hover:text-ink px-2 py-1 rounded-md hover:bg-[#f5f6fa] transition-colors"
                  >
                    New chat
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-3 hover:bg-[#f5f6fa] hover:text-ink transition-colors">
                  <X size={17} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="pt-8 flex flex-col items-center text-center px-2">
                  <AIMark size={52} breathe />
                  <p className="text-[15px] font-bold text-ink m-0 mt-4 mb-1 tracking-tight">What do you need?</p>
                  <p className="text-[12.5px] text-ink-2 m-0 mb-5">
                    Ask anything, or tell me to do something —<br />I can update leads, add to-dos, draft messages, and more.
                  </p>
                  <div className="flex flex-col gap-2 w-full">
                    {SUGGESTIONS.map((s, i) => (
                      <button
                        key={s}
                        onClick={() => s.endsWith(': ') ? setInput(s) : send(s)}
                        style={{ animationDelay: `${120 + i * 70}ms` }}
                        className="ai-rise ai-suggest text-left text-[13px] text-ink-2 bg-[#f7f8fb] border border-line rounded-xl px-3.5 py-2.5"
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

              {busy && <AIThinking />}
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
                  className="ai-btn w-[42px] h-[42px] rounded-xl flex items-center justify-center disabled:opacity-40 shrink-0"
                >
                  <Send size={17} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export function MessageBubble({ message }: { message: AIChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('mb-3 ai-msg-in', isUser ? 'flex justify-end' : 'flex items-start gap-2.5')}>
      {!isUser && <AIMark size={22} className="mt-1.5" />}
      <div className={cn('max-w-[88%]', isUser ? '' : 'flex-1 min-w-0')}>
        {/* Action chips */}
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-2">
            {message.actions.map((a, i) => (
              <div key={i} className="ai-chip-in" style={{ animationDelay: `${i * 80}ms` }}>
                <ActionChip action={a} />
              </div>
            ))}
          </div>
        )}
        <div
          className={cn(
            'px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap',
            isUser
              ? 'ai-msg-user text-white rounded-2xl rounded-br-md'
              : 'bg-[#f8f9fc] text-ink rounded-2xl rounded-tl-md border border-line'
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
