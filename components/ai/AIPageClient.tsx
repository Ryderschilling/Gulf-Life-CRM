'use client'

// AI page — full-screen assistant with three tabs:
//   Chat        — conversation history + agentic chat (can DO things)
//   Brain Files — editable knowledge the AI reads before every reply
//   Memory      — what the AI has learned over time

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Plus, Trash2, MessageSquare, BookOpen, Brain, Pencil, X, Check } from 'lucide-react'
import { AIMark, AIThinking } from '@/components/ai/AIMark'
import toast from 'react-hot-toast'
import type { AIChatMessage, AIContextFile, AIMemory } from '@/lib/types'
import { cn, timeAgo } from '@/lib/utils'
import { Card, Button, PageHeader, Segmented, Spinner, EmptyState, Textarea, Input, Field, Pill, Modal } from '@/components/ui/kit'
import { MessageBubble } from '@/components/ai/AIDrawer'

type Tab = 'chat' | 'brain' | 'memory'

const STARTERS = [
  'Who should I follow up with today?',
  'Summarize the pipeline for me',
  'Draft follow-up emails for everyone in Proposal',
  'Which leads have gone cold and need a nudge?',
]

export default function AIPageClient() {
  const [tab, setTab] = useState<Tab>('chat')

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] min-h-[480px]">
      <PageHeader
        title="Gulf AI"
        subtitle="It knows your whole CRM — and it can take action"
        right={
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'chat', label: 'Chat' },
              { value: 'brain', label: 'Brain Files' },
              { value: 'memory', label: 'Memory' },
            ]}
          />
        }
      />
      {tab === 'chat' && <ChatTab />}
      {tab === 'brain' && <BrainTab />}
      {tab === 'memory' && <MemoryTab />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// CHAT
// ════════════════════════════════════════════════════════════

interface ConvListItem { id: string; title: string | null; updated_at: string }

function ChatTab() {
  const router = useRouter()
  const [conversations, setConversations] = useState<ConvListItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AIChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingConv, setLoadingConv] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadConversations() }, [])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  async function loadConversations() {
    const res = await fetch('/api/ai/conversations')
    const data = await res.json()
    if (data.conversations) setConversations(data.conversations)
  }

  async function openConversation(id: string) {
    setActiveId(id)
    setLoadingConv(true)
    try {
      const res = await fetch(`/api/ai/conversations/${id}`)
      const data = await res.json()
      setMessages((data.conversation?.messages ?? []) as AIChatMessage[])
    } finally {
      setLoadingConv(false)
    }
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    await fetch(`/api/ai/conversations?id=${id}`, { method: 'DELETE' })
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) { setActiveId(null); setMessages([]) }
  }

  function newChat() {
    setActiveId(null)
    setMessages([])
  }

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
        body: JSON.stringify({ message: content, conversation_id: activeId ?? undefined }),
      })
      const data = await res.json()
      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Something went wrong: ${data.error}` }])
      } else {
        if (!activeId && data.conversation_id) {
          setActiveId(data.conversation_id)
          loadConversations()
        }
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply, actions: data.actions }])
        if (data.actions?.length > 0) router.refresh()
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Network error — try again.' }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      {/* Conversation list */}
      <Card className="w-[240px] shrink-0 hidden lg:flex flex-col overflow-hidden">
        <div className="p-3">
          <Button variant="secondary" className="w-full" onClick={newChat}><Plus size={15} /> New chat</Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {conversations.map(c => (
            <div
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={cn(
                'group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer mb-0.5 transition-colors',
                activeId === c.id ? 'bg-accent-soft' : 'hover:bg-[#f5f6fa]'
              )}
            >
              <MessageSquare size={13} className={activeId === c.id ? 'text-accent shrink-0' : 'text-ink-3 shrink-0'} />
              <div className="min-w-0 flex-1">
                <p className={cn('text-[12.5px] font-medium m-0 truncate', activeId === c.id ? 'text-accent' : 'text-ink')}>
                  {c.title ?? 'Untitled'}
                </p>
                <p className="text-[10.5px] text-ink-3 m-0">{timeAgo(c.updated_at)}</p>
              </div>
              <button
                onClick={e => deleteConversation(c.id, e)}
                className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad transition-opacity"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="text-[12px] text-ink-3 text-center pt-6">No conversations yet</p>
          )}
        </div>
      </Card>

      {/* Chat area */}
      <Card className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
          {loadingConv ? (
            <div className="flex justify-center pt-10"><Spinner /></div>
          ) : messages.length === 0 ? (
            <div className="max-w-md mx-auto pt-8">
              <div className="flex justify-center mb-4"><AIMark size={56} breathe /></div>
              <p className="text-[15px] font-semibold text-ink text-center m-0 mb-1">What do you need?</p>
              <p className="text-[13px] text-ink-2 text-center m-0 mb-5">
                Ask questions about your pipeline, or tell me to do things — I can create leads, move stages, add notes and to-dos, draft emails, and send texts (with your OK).
              </p>
              <div className="flex flex-col gap-2">
                {STARTERS.map((s, i) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    style={{ animationDelay: `${120 + i * 70}ms` }}
                    className="ai-rise ai-suggest text-left text-[13px] text-ink-2 bg-[#f7f8fb] border border-line rounded-xl px-4 py-2.5"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto">
              {messages.map((m, i) => <MessageBubble key={i} message={m} />)}
              {busy && <AIThinking />}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-line">
          <div className="max-w-2xl mx-auto flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              rows={1}
              placeholder="Ask or instruct…"
              className="flex-1 bg-[#f7f8fb] border border-line-strong rounded-xl px-4 py-2.5 text-[14px] text-ink resize-none max-h-36"
              style={{ minHeight: 44 }}
            />
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              className="ai-btn w-[44px] h-[44px] rounded-xl flex items-center justify-center disabled:opacity-40 shrink-0"
            >
              <Send size={17} />
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// BRAIN FILES
// ════════════════════════════════════════════════════════════

function BrainTab() {
  const [files, setFiles] = useState<AIContextFile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AIContextFile | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/context')
      const data = await res.json()
      if (data.files) setFiles(data.files)
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(file: AIContextFile) {
    await fetch('/api/ai/context', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: file.id, is_active: !file.is_active }),
    })
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, is_active: !f.is_active } : f))
  }

  if (loading) return <div className="flex justify-center pt-16"><Spinner size={24} /></div>

  return (
    <div className="overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] text-ink-2 m-0">
          The AI reads every active file before it replies or drafts anything. Edit these to teach it your business.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}><Plus size={14} /> New file</Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4 pb-6">
        {files.map(file => (
          <Card key={file.id} className={cn('p-5 transition-opacity', !file.is_active && 'opacity-55')}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-grape-soft text-grape flex items-center justify-center shrink-0">
                  <BookOpen size={15} />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-ink m-0 truncate">{file.name}</p>
                  <p className="text-[11.5px] text-ink-3 m-0">Updated {timeAgo(file.updated_at)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleActive(file)}
                  className={cn(
                    'text-[11px] font-bold px-2 py-1 rounded-md transition-colors',
                    file.is_active ? 'bg-good-soft text-good' : 'bg-[#f2f4f7] text-ink-3'
                  )}
                >
                  {file.is_active ? 'Active' : 'Off'}
                </button>
                <button onClick={() => setEditing(file)} className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:bg-[#f2f4f7] hover:text-ink">
                  <Pencil size={13} />
                </button>
              </div>
            </div>
            {file.description && <p className="text-[12.5px] text-ink-2 m-0 mb-2">{file.description}</p>}
            <p className="text-[12px] text-ink-3 m-0 line-clamp-3 whitespace-pre-wrap">{file.content.slice(0, 240)}…</p>
          </Card>
        ))}
      </div>

      <BrainFileModal
        file={editing}
        open={!!editing || creating}
        onClose={() => { setEditing(null); setCreating(false) }}
        onSaved={() => { setEditing(null); setCreating(false); load() }}
      />
    </div>
  )
}

function BrainFileModal({ file, open, onClose, onSaved }: {
  file: AIContextFile | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(file?.name ?? '')
    setDescription(file?.description ?? '')
    setContent(file?.content ?? '')
  }, [file, open])

  async function save() {
    if (!name.trim()) { toast.error('Name required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/ai/context', {
        method: file ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(file
          ? { id: file.id, name, description, content }
          : { name, description, content, is_active: true, sort_order: 99 }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast.success('Saved — the AI knows this now')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={file ? 'Edit brain file' : 'New brain file'} wide>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pricing & Fees" />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this teaches the AI" />
          </Field>
        </div>
        <Field label="Content">
          <Textarea value={content} onChange={e => setContent(e.target.value)} rows={14} className="font-mono text-[13px]" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}><Check size={15} /> Save</Button>
        </div>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════
// MEMORY
// ════════════════════════════════════════════════════════════

const MEMORY_TYPE_LABEL: Record<string, { label: string; tone: 'indigo' | 'green' | 'yellow' | 'violet' }> = {
  style_correction: { label: 'Style', tone: 'violet' },
  lead_fact: { label: 'Lead Fact', tone: 'indigo' },
  company_knowledge: { label: 'Knowledge', tone: 'green' },
  pattern: { label: 'Pattern', tone: 'yellow' },
}

function MemoryTab() {
  const [memories, setMemories] = useState<(AIMemory & { lead?: { name: string } | null })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/memory')
      const data = await res.json()
      if (data.memories) setMemories(data.memories)
    } finally {
      setLoading(false)
    }
  }

  async function forget(id: string) {
    await fetch(`/api/ai/memory?id=${id}`, { method: 'DELETE' })
    setMemories(prev => prev.filter(m => m.id !== id))
    toast.success('Forgotten')
  }

  if (loading) return <div className="flex justify-center pt-16"><Spinner size={24} /></div>

  return (
    <div className="overflow-y-auto pb-6">
      <p className="text-[13px] text-ink-2 m-0 mb-4">
        Things the AI has learned — from edited drafts, chats, and what you tell it. It applies these automatically.
      </p>
      {memories.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Brain size={22} />}
            title="Nothing learned yet"
            subtitle="When you edit AI drafts or teach it in chat, what it learns shows up here."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {memories.map(m => {
            const t = MEMORY_TYPE_LABEL[m.type] ?? { label: m.type, tone: 'indigo' as const }
            return (
              <Card key={m.id} className="px-4 py-3.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Pill tone={t.tone} className="text-[11px] px-2 py-0.5">{t.label}</Pill>
                    {m.lead?.name && <span className="text-[12px] font-semibold text-ink-2">{m.lead.name}</span>}
                    <span className="text-[11.5px] text-ink-3">{timeAgo(m.created_at)}</span>
                  </div>
                  <p className="text-[13.5px] font-semibold text-ink m-0">{m.title}</p>
                  <p className="text-[12.5px] text-ink-2 m-0 mt-0.5">{m.content}</p>
                </div>
                <button onClick={() => forget(m.id)} title="Forget this" className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:bg-bad-soft hover:text-bad shrink-0">
                  <X size={14} />
                </button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
