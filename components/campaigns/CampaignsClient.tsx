'use client'

// Campaigns — compose an email blast in the CRM, deliver it through
// Mailchimp (audience, unsubscribe compliance, and stats stay theirs).
// Flow: write → send yourself a test → confirm → blast. Fancy designed
// newsletters still belong in Mailchimp itself (link below the composer).

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Megaphone, Send, FlaskConical, ExternalLink, Users } from 'lucide-react'
import { Card, CardHeader, Button, Input, Select, Textarea, Field, PageHeader, EmptyState, Modal, Pill, Spinner } from '@/components/ui/kit'
import { timeAgo } from '@/lib/utils'

interface Tag { id: number; name: string; memberCount: number }
interface Campaign {
  id: string; subject: string; status: string; sendTime: string | null
  emailsSent: number; openRate: number; clickRate: number; archiveUrl: string | null
}
interface Data {
  configured: boolean
  audience: { name: string; memberCount: number } | null
  tags: Tag[]
  campaigns: Campaign[]
  error?: string
}

const TEAL = '#0d9488'

export default function CampaignsClient({ userEmail }: { userEmail: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  const [subject, setSubject] = useState('')
  const [preview, setPreview] = useState('')
  const [tagId, setTagId] = useState('')
  const [body, setBody] = useState('')
  const [testEmail, setTestEmail] = useState(userEmail)
  const [sending, setSending] = useState<'test' | 'send' | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const load = useCallback(() => {
    fetch('/api/campaigns')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const selectedTag = data?.tags.find(t => String(t.id) === tagId)
  const recipientCount = selectedTag ? selectedTag.memberCount : (data?.audience?.memberCount ?? 0)
  const ready = subject.trim().length > 0 && body.trim().length > 0

  async function submit(mode: 'test' | 'send') {
    if (!ready || sending) return
    if (mode === 'test' && !testEmail.trim()) { toast.error('Enter an email for the test'); return }
    setSending(mode)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          preview_text: preview.trim() || undefined,
          body: body.trim(),
          tag_id: tagId ? Number(tagId) : undefined,
          mode,
          test_email: mode === 'test' ? testEmail.trim() : undefined,
        }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      if (mode === 'test') {
        toast.success(`Test sent to ${testEmail.trim()}`)
      } else {
        toast.success(`Campaign sent to ${recipientCount} ${recipientCount === 1 ? 'person' : 'people'}`)
        setSubject(''); setPreview(''); setBody(''); setTagId('')
        setConfirmOpen(false)
        load()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
      setConfirmOpen(false)
    } finally {
      setSending(null)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Campaigns" subtitle="Email blasts to your whole list, powered by Mailchimp" />
        <Card className="flex items-center justify-center h-40"><Spinner /></Card>
      </div>
    )
  }

  if (!data?.configured) {
    return (
      <div>
        <PageHeader title="Campaigns" subtitle="Email blasts to your whole list, powered by Mailchimp" />
        <Card>
          <EmptyState
            icon={<Megaphone size={22} />}
            title="Mailchimp isn't connected"
            subtitle="Add MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID, then restart — campaigns send through your Mailchimp audience."
          />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="Email blasts to your whole list, powered by Mailchimp"
        right={
          <a href="https://admin.mailchimp.com/campaigns/" target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm"><ExternalLink size={14} /> Open Mailchimp</Button>
          </a>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_330px] items-start">
        {/* Composer */}
        <Card>
          <CardHeader
            title="New campaign"
            subtitle={data.audience ? `Audience: ${data.audience.name.trim()} · ${data.audience.memberCount} contacts` : undefined}
          />
          <div className="flex flex-col gap-3.5 p-5 pt-1">
            <Field label="Send to">
              <Select value={tagId} onChange={e => setTagId(e.target.value)}>
                <option value="">Everyone ({data.audience?.memberCount ?? 0})</option>
                {data.tags.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.memberCount})</option>
                ))}
              </Select>
            </Field>
            <Field label="Subject">
              <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Get your home summer-ready with Gulf Life" />
            </Field>
            <Field label="Preview text" hint="The grey line shown next to the subject in inboxes — optional">
              <Input value={preview} onChange={e => setPreview(e.target.value)} placeholder="A short teaser for the inbox" />
            </Field>
            <Field label="Message" hint="Plain writing is fine — it's wrapped in the Gulf Life branded layout with the unsubscribe footer added automatically. Type *|FNAME|* to insert each person's first name.">
              <Textarea value={body} onChange={e => setBody(e.target.value)} rows={10} placeholder={'Hi *|FNAME|*,\n\nWrite your campaign like a normal email. Blank line = new paragraph, links become clickable.'} />
            </Field>

            <div className="flex flex-wrap items-end justify-between gap-3 pt-1 border-t border-line mt-1">
              <div className="flex items-end gap-2">
                <Field label="Test address">
                  <Input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="you@email.com" className="w-[210px]" />
                </Field>
                <Button variant="secondary" onClick={() => submit('test')} loading={sending === 'test'} disabled={!ready}>
                  <FlaskConical size={14} /> Send test
                </Button>
              </div>
              <Button onClick={() => setConfirmOpen(true)} disabled={!ready || recipientCount === 0} style={{ background: TEAL }}>
                <Send size={14} /> Send to {recipientCount}
              </Button>
            </div>
          </div>
        </Card>

        {/* Recent campaigns */}
        <Card>
          <CardHeader title="Recent campaigns" />
          <div className="p-2 pb-3">
            {data.campaigns.length === 0 && (
              <p className="text-[12.5px] text-ink-3 text-center py-6 m-0">Nothing sent yet</p>
            )}
            {data.campaigns.map(c => (
              <div key={c.id} className="px-3 py-2.5 border-b border-line last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold text-ink m-0 leading-snug">{c.subject}</p>
                  {c.status === 'sent'
                    ? <Pill tone="green">Sent</Pill>
                    : <Pill tone="gray">{c.status === 'save' ? 'Draft' : c.status}</Pill>}
                </div>
                <p className="text-[11.5px] text-ink-3 m-0 mt-1 flex items-center gap-2 flex-wrap">
                  {c.sendTime && <span>{timeAgo(c.sendTime)}</span>}
                  {c.status === 'sent' && (
                    <>
                      <span className="inline-flex items-center gap-1"><Users size={11} /> {c.emailsSent}</span>
                      <span style={{ color: TEAL }} className="font-semibold">{Math.round(c.openRate * 100)}% opened</span>
                      <span>{Math.round(c.clickRate * 100)}% clicked</span>
                    </>
                  )}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Confirm real send */}
      <Modal open={confirmOpen} onClose={() => !sending && setConfirmOpen(false)} title="Send this campaign?">
        <div className="flex flex-col gap-3">
          <p className="text-[13.5px] text-ink-2 m-0 leading-relaxed">
            <strong className="text-ink">&ldquo;{subject.trim()}&rdquo;</strong> will go to{' '}
            <strong className="text-ink">{recipientCount} {recipientCount === 1 ? 'person' : 'people'}</strong>
            {selectedTag ? <> (tag: {selectedTag.name})</> : <> (your whole audience)</>} from Gulf Life Concierge.
            This can&rsquo;t be undone — consider a test send first.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={sending === 'send'}>Cancel</Button>
            <Button onClick={() => submit('send')} loading={sending === 'send'} style={{ background: TEAL }}>
              <Send size={14} /> Send now
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
