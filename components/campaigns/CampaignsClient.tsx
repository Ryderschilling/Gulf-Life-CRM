'use client'

// Campaigns — compose an email blast in the CRM, deliver it through
// Mailchimp (audience, unsubscribe compliance, and stats stay theirs).
// Below the composer: the full campaign history as a table — click any
// row for the in-depth report (opens, clicks, bounces, clicked links).

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Megaphone, Send, FlaskConical, ExternalLink, MousePointerClick } from 'lucide-react'
import { Card, CardHeader, Button, Input, Select, Textarea, Field, PageHeader, EmptyState, Modal, Pill, Spinner, Th, Td } from '@/components/ui/kit'
import type { PillTone } from '@/components/ui/kit'
import { cn } from '@/lib/utils'

interface Tag { id: number; name: string; memberCount: number }
interface Campaign {
  id: string; subject: string; status: string; sendTime: string | null; createTime: string | null
  emailsSent: number; openRate: number; clickRate: number; uniqueOpens: number; subscriberClicks: number
  archiveUrl: string | null
}
interface Report {
  subject: string; sendTime: string | null; emailsSent: number
  opens: { total: number; unique: number; rate: number; last: string | null }
  clicks: { total: number; unique: number; rate: number; last: string | null }
  bounces: number; unsubscribed: number; abuseReports: number
  clickedLinks: { url: string; totalClicks: number; uniqueClicks: number; clickRate: number }[]
}
interface Data {
  configured: boolean
  audience: { name: string; memberCount: number } | null
  ownerTag: { id: number; memberCount: number } | null
  tags: Tag[]
  campaigns: Campaign[]
  error?: string
}

const TEAL = '#0d9488'

const STATUS: Record<string, { label: string; tone: PillTone }> = {
  sent: { label: 'Sent', tone: 'green' },
  save: { label: 'Draft', tone: 'gray' },
  schedule: { label: 'Scheduled', tone: 'blue' },
  sending: { label: 'Sending', tone: 'yellow' },
  canceled: { label: 'Canceled', tone: 'red' },
}

function pct(rate: number): string {
  const v = rate * 100
  return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CampaignsClient({ userEmail }: { userEmail: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  const [subject, setSubject] = useState('')
  const [preview, setPreview] = useState('')
  const [audienceSel, setAudienceSel] = useState('all') // 'all' | 'crm' | 'mconly' | 'tag:<id>'
  const [body, setBody] = useState('')
  const [testEmail, setTestEmail] = useState(userEmail)
  const [sending, setSending] = useState<'test' | 'send' | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Detail popup
  const [detail, setDetail] = useState<Campaign | null>(null)
  const [reports, setReports] = useState<Record<string, Report | { error: string }>>({})

  const load = useCallback(() => {
    fetch('/api/campaigns')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const openDetail = useCallback((c: Campaign) => {
    setDetail(c)
    if (c.status !== 'sent' || reports[c.id]) return
    fetch(`/api/campaigns/${c.id}/report`)
      .then(r => r.json())
      .then(d => setReports(prev => ({ ...prev, [c.id]: d.report ?? { error: d.error ?? 'No stats available' } })))
      .catch(() => setReports(prev => ({ ...prev, [c.id]: { error: 'Could not load stats' } })))
  }, [reports])

  const totalCount = data?.audience?.memberCount ?? 0
  const crmCount = data?.ownerTag?.memberCount ?? 0
  const selectedTag = audienceSel.startsWith('tag:') ? data?.tags.find(t => `tag:${t.id}` === audienceSel) : undefined
  const recipientCount =
    audienceSel === 'crm' ? crmCount
    : audienceSel === 'mconly' ? Math.max(0, totalCount - crmCount)
    : selectedTag ? selectedTag.memberCount
    : totalCount
  const audienceLabel =
    audienceSel === 'crm' ? 'CRM homeowner leads'
    : audienceSel === 'mconly' ? 'Mailchimp-only contacts (not from the CRM)'
    : selectedTag ? `tag: ${selectedTag.name}`
    : 'everyone in Mailchimp'
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
          audience: audienceSel === 'crm' ? 'crm' : audienceSel === 'mconly' ? 'mailchimp_only' : selectedTag ? 'tag' : 'all',
          tag_id: selectedTag?.id,
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
        setSubject(''); setPreview(''); setBody(''); setAudienceSel('all')
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

  const detailReport = detail ? reports[detail.id] : undefined

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

      {/* Composer */}
      <Card className="mb-4">
        <CardHeader
          title="New campaign"
          subtitle={data.audience ? `Audience: ${data.audience.name.trim()} · ${data.audience.memberCount} contacts` : undefined}
        />
        <div className="flex flex-col gap-3.5 p-5 pt-1">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Send to" hint="CRM leads are tagged in Mailchimp automatically when they sync — pipeline-stage tags show up here too">
              <Select value={audienceSel} onChange={e => setAudienceSel(e.target.value)}>
                <option value="all">Everyone in Mailchimp ({totalCount})</option>
                <option value="crm">CRM homeowner leads ({crmCount})</option>
                <option value="mconly">Mailchimp-only — not from the CRM ({Math.max(0, totalCount - crmCount)})</option>
                {data.tags.length > 0 && (
                  <optgroup label="Tags">
                    {data.tags.map(t => (
                      <option key={t.id} value={`tag:${t.id}`}>{t.name} ({t.memberCount})</option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Field>
            <Field label="Preview text" hint="The grey teaser line shown next to the subject — optional">
              <Input value={preview} onChange={e => setPreview(e.target.value)} placeholder="A short teaser for the inbox" />
            </Field>
          </div>
          <Field label="Subject">
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Get your home summer-ready with Gulf Life" />
          </Field>
          <Field label="Message" hint="Plain writing is fine — it's wrapped in the Gulf Life branded layout with the unsubscribe footer added automatically. Type *|FNAME|* to insert each person's first name.">
            <Textarea value={body} onChange={e => setBody(e.target.value)} rows={9} placeholder={'Hi *|FNAME|*,\n\nWrite your campaign like a normal email. Blank line = new paragraph, links become clickable.'} />
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

      {/* Campaign history */}
      <Card>
        <CardHeader title="Campaign history" subtitle={`${data.campaigns.length} total · click a row for the full report`} />
        {data.campaigns.length === 0 ? (
          <p className="text-[12.5px] text-ink-3 text-center py-8 m-0">Nothing sent yet</p>
        ) : (
          <div className="overflow-x-auto pb-1">
            <table className="w-full border-collapse min-w-[680px]">
              <thead>
                <tr className="border-b border-line">
                  <Th className="pl-5">Campaign</Th>
                  <Th>Status</Th>
                  <Th>Sent</Th>
                  <Th className="text-right">Recipients</Th>
                  <Th className="text-right">Opened</Th>
                  <Th className="text-right pr-5">Clicked</Th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map(c => {
                  const s = STATUS[c.status] ?? { label: c.status, tone: 'gray' as PillTone }
                  const sent = c.status === 'sent'
                  return (
                    <tr
                      key={c.id}
                      onClick={() => openDetail(c)}
                      className="border-b border-line last:border-b-0 cursor-pointer transition-colors hover:bg-[#f7f8fb]"
                    >
                      <Td className="pl-5">
                        <span className="font-semibold text-ink text-[13px]">{c.subject}</span>
                      </Td>
                      <Td><Pill tone={s.tone}>{s.label}</Pill></Td>
                      <Td className="text-ink-2 whitespace-nowrap">{fmtDate(c.sendTime)}</Td>
                      <Td className="text-right text-ink-2">{sent ? c.emailsSent : '—'}</Td>
                      <Td className="text-right">
                        {sent ? <span className="font-semibold" style={{ color: TEAL }}>{pct(c.openRate)}</span> : <span className="text-ink-3">—</span>}
                        {sent && <span className="text-ink-3 text-[11.5px]"> · {c.uniqueOpens}</span>}
                      </Td>
                      <Td className="text-right pr-5">
                        {sent ? <span className="font-semibold text-ink">{pct(c.clickRate)}</span> : <span className="text-ink-3">—</span>}
                        {sent && <span className="text-ink-3 text-[11.5px]"> · {c.subscriberClicks}</span>}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Detail popup */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.subject ?? ''} wide>
        {detail && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 flex-wrap text-[12.5px] text-ink-3">
              {(() => { const s = STATUS[detail.status] ?? { label: detail.status, tone: 'gray' as PillTone }; return <Pill tone={s.tone}>{s.label}</Pill> })()}
              {detail.sendTime && <span>Sent {fmtDate(detail.sendTime)} at {new Date(detail.sendTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
              {detail.archiveUrl && (
                <a href={detail.archiveUrl} target="_blank" rel="noreferrer" className="text-accent font-semibold no-underline hover:underline inline-flex items-center gap-1">
                  <ExternalLink size={12} /> View email
                </a>
              )}
            </div>

            {detail.status !== 'sent' ? (
              <p className="text-[13px] text-ink-3 m-0 py-4 text-center">No stats yet — this campaign hasn&rsquo;t been sent. Finish or delete it in Mailchimp.</p>
            ) : !detailReport ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : 'error' in detailReport ? (
              <p className="text-[13px] text-ink-3 m-0 py-4 text-center">{detailReport.error}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {[
                    { label: 'Delivered', value: String(detailReport.emailsSent - detailReport.bounces), sub: `${detailReport.bounces} bounced` },
                    { label: 'Open rate', value: pct(detailReport.opens.rate), sub: `${detailReport.opens.unique} people · ${detailReport.opens.total} total opens`, hi: true },
                    { label: 'Click rate', value: pct(detailReport.clicks.rate), sub: `${detailReport.clicks.unique} people · ${detailReport.clicks.total} total clicks`, hi: true },
                    { label: 'Unsubscribed', value: String(detailReport.unsubscribed), sub: detailReport.abuseReports ? `${detailReport.abuseReports} spam reports` : 'from this send' },
                    { label: 'Last opened', value: detailReport.opens.last ? fmtDate(detailReport.opens.last) : '—', sub: '' },
                    { label: 'Last clicked', value: detailReport.clicks.last ? fmtDate(detailReport.clicks.last) : '—', sub: '' },
                  ].map(t => (
                    <div key={t.label} className="rounded-xl border border-line px-3.5 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-3 m-0">{t.label}</p>
                      <p className={cn('text-[20px] font-bold m-0 mt-0.5', t.hi ? '' : 'text-ink')} style={t.hi ? { color: TEAL } : undefined}>{t.value}</p>
                      {t.sub && <p className="text-[11.5px] text-ink-3 m-0 mt-0.5">{t.sub}</p>}
                    </div>
                  ))}
                </div>

                <div>
                  <p className="text-[12px] font-bold uppercase tracking-wide text-ink-3 m-0 mb-2 flex items-center gap-1.5">
                    <MousePointerClick size={13} /> What people clicked
                  </p>
                  {detailReport.clickedLinks.length === 0 ? (
                    <p className="text-[12.5px] text-ink-3 m-0">No link clicks recorded for this campaign.</p>
                  ) : (
                    <div className="border border-line rounded-xl overflow-hidden">
                      {detailReport.clickedLinks.map((l, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-line last:border-b-0">
                          <a href={l.url} target="_blank" rel="noreferrer" className="text-[12.5px] text-accent no-underline hover:underline truncate max-w-[70%]">{l.url}</a>
                          <span className="text-[12.5px] text-ink-2 shrink-0">
                            <strong className="text-ink">{l.totalClicks}</strong> clicks · {l.uniqueClicks} people
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Confirm real send */}
      <Modal open={confirmOpen} onClose={() => !sending && setConfirmOpen(false)} title="Send this campaign?">
        <div className="flex flex-col gap-3">
          <p className="text-[13.5px] text-ink-2 m-0 leading-relaxed">
            <strong className="text-ink">&ldquo;{subject.trim()}&rdquo;</strong> will go to{' '}
            <strong className="text-ink">{recipientCount} {recipientCount === 1 ? 'person' : 'people'}</strong>
            {' '}({audienceLabel}) from Gulf Life Concierge.
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
