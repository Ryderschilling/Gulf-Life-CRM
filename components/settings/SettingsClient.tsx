'use client'

// Settings — profile + live integration status.
// API keys live in environment variables (Vercel → Settings →
// Environment Variables), never in the database.

import { useEffect, useState } from 'react'
import { Database, Bot, Mail, MessageSquare, Megaphone, CheckCircle2, XCircle, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Card, CardHeader, PageHeader, Field, Input, Button, Spinner, Avatar } from '@/components/ui/kit'

interface IntegrationStatus {
  configured: boolean
  ok: boolean
  detail: string
}

interface StatusMap {
  supabase: IntegrationStatus
  openai: IntegrationStatus
  gmail: IntegrationStatus
  quo: IntegrationStatus
  mailchimp: IntegrationStatus
}

const INTEGRATIONS: { key: keyof StatusMap; name: string; what: string; icon: React.ReactNode; env: string }[] = [
  { key: 'supabase', name: 'Database', what: 'Stores all leads, notes, and activity', icon: <Database size={17} />, env: 'NEXT_PUBLIC_SUPABASE_URL' },
  { key: 'openai', name: 'AI (OpenAI)', what: 'Powers the assistant, drafts, and daily briefing', icon: <Bot size={17} />, env: 'OPENAI_API_KEY' },
  { key: 'gmail', name: 'Email (Gulf Life mailbox)', what: 'Sends + receives as Host@LiveGulfLife.com via Gmail', icon: <Mail size={17} />, env: 'GMAIL_USER + GMAIL_APP_PASSWORD' },
  { key: 'quo', name: 'Texting (Quo)', what: "Sends texts from John's Quo number", icon: <MessageSquare size={17} />, env: 'QUO_API_KEY + QUO_FROM_NUMBER' },
  { key: 'mailchimp', name: 'Mailchimp', what: 'Syncs homeowner leads into the campaign audience', icon: <Megaphone size={17} />, env: 'MAILCHIMP_API_KEY + MAILCHIMP_AUDIENCE_ID' },
]

export default function SettingsClient({ email, profile }: { email: string; profile: Profile | null }) {
  const [status, setStatus] = useState<StatusMap | null>(null)
  const [name, setName] = useState(profile?.full_name ?? '')
  const [savingName, setSavingName] = useState(false)

  useEffect(() => {
    fetch('/api/integrations/status')
      .then(r => r.json())
      .then(data => { if (!data.error) setStatus(data) })
      .catch(() => {})
  }, [])

  async function saveName() {
    if (!profile) { toast.error('Profile not loaded yet'); return }
    setSavingName(true)
    const supabase = createClient()
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile.id)
    setSavingName(false)
    if (error) toast.error('Failed to save')
    else toast.success('Saved')
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your profile and connected services" />

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        {/* Profile */}
        <Card>
          <CardHeader title="Profile" />
          <div className="px-6 pb-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar name={name || email} size={44} />
              <div>
                <p className="text-[14px] font-semibold text-ink m-0">{name || 'No name set'}</p>
                <p className="text-[12.5px] text-ink-3 m-0">{email}</p>
              </div>
            </div>
            <Field label="Display name">
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            </Field>
            <Button size="sm" onClick={saveName} loading={savingName} className="self-start">
              <User size={14} /> Save
            </Button>
          </div>
        </Card>

        {/* Integrations */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Integrations"
            subtitle="Keys are set as environment variables on the server — paste them in Vercel, then redeploy"
          />
          <div className="px-6 pb-6 flex flex-col gap-3">
            {!status && (
              <div className="flex items-center gap-3 py-4">
                <Spinner /> <span className="text-[13px] text-ink-2">Checking connections…</span>
              </div>
            )}
            {status && INTEGRATIONS.map(intg => {
              const s = status[intg.key]
              return (
                <div key={intg.key} className="flex items-start gap-3.5 border border-line rounded-xl px-4 py-3.5">
                  <div className={cn(
                    'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                    s.ok ? 'bg-good-soft text-good' : 'bg-[#f2f4f7] text-ink-3'
                  )}>
                    {intg.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-ink m-0 flex items-center gap-2">
                      {intg.name}
                      {s.ok
                        ? <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-good"><CheckCircle2 size={13} /> Connected</span>
                        : <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-ink-3"><XCircle size={13} /> Not connected</span>}
                    </p>
                    <p className="text-[12.5px] text-ink-2 m-0 mt-0.5">{intg.what}</p>
                    <p className={cn('text-[12px] m-0 mt-1', s.ok ? 'text-ink-3' : 'text-warn font-medium')}>
                      {s.detail}
                    </p>
                    {!s.ok && (
                      <p className="text-[11.5px] text-ink-3 m-0 mt-1 font-mono bg-[#f7f8fb] rounded px-2 py-1 inline-block">
                        {intg.env}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
