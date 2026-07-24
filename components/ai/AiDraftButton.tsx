'use client'

// ============================================================
// Reusable "AI draft" button. Drop it next to ANY message compose box to fill
// that box with a context-aware draft — Gulf AI reads the full conversation,
// the lead profile, and the company brand voice (via /api/inbox/draft), then
// writes the next message. The human always edits and sends; nothing goes out
// automatically. For email boxes, onDraft also receives a suggested subject.
// ============================================================

import { useState } from 'react'
import { AIMark } from '@/components/ai/AIMark'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

interface Props {
  leadId: string
  channel: 'sms' | 'email'
  onDraft: (body: string, subject?: string) => void
  disabled?: boolean
  label?: string
  className?: string
}

export default function AiDraftButton({
  leadId,
  channel,
  onDraft,
  disabled,
  label = 'AI draft',
  className,
}: Props) {
  const [loading, setLoading] = useState(false)

  async function run() {
    if (loading || disabled) return
    setLoading(true)
    try {
      const res = await fetch('/api/inbox/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, channel }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Draft failed')
      if (!data.body?.trim()) throw new Error('The AI came back empty — try again')
      onDraft(data.body.trim(), data.subject?.trim() || undefined)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={disabled || loading}
      title="Let Gulf AI draft this from the full conversation"
      className={cn(
        'inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent hover:text-accent-dark disabled:opacity-40 disabled:cursor-default transition-colors',
        className,
      )}
    >
      <AIMark size={13} thinking={loading} /> {loading ? 'Drafting…' : label}
    </button>
  )
}
