'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import type { LeadStatus } from '@/lib/types'
import { STATUS_CONFIG } from '@/lib/utils'
import { localTimeToISO } from '@/lib/dates'
import { Modal, Field, Input, Select, Textarea, Button } from '@/components/ui/kit'

const OWNER_STAGES: LeadStatus[] = ['new', 'contacted', 'nurturing', 'proposal']

export default function NewLeadModal({ open, onClose, relationship = 'prospect' }: { open: boolean; onClose: () => void; relationship?: 'prospect' | 'client' }) {
  const router = useRouter()
  const isClient = relationship === 'client'
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', phone: '', company: '',
    status: 'new' as LeadStatus, source: 'referral',
    property_interest: '', next_follow_up_at: '', note: '',
  })

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    const supabase = createClient()
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: lead, error } = await supabase.from('leads').insert({
        name: form.name.trim(),
        lead_type: 'owner',
        relationship,
        email: form.email.trim().toLowerCase() || null,
        phone: form.phone.trim() || null,
        company: form.company.trim() || null,
        status: form.status,
        source: form.source,
        property_interest: form.property_interest.trim() || null,
        next_follow_up_at: form.next_follow_up_at ? localTimeToISO(form.next_follow_up_at) : null, // 9am CRM-local on the chosen day
        assigned_to: user?.id ?? null, // whoever adds a lead owns it until reassigned
      }).select('id').single()

      if (error) throw error

      await supabase.from('lead_activities').insert({
        lead_id: lead.id, user_id: user?.id ?? null, type: 'created', body: 'Lead created manually',
      })
      if (form.note.trim()) {
        await supabase.from('lead_notes').insert({
          lead_id: lead.id, user_id: user?.id ?? null, body: form.note.trim(),
        })
      }

      // Auto-sync the new lead into Mailchimp (fire-and-forget; demo excluded server-side)
      fetch('/api/mailchimp/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'outstanding' }) }).catch(() => {})

      toast.success(`${form.name} added`)
      setForm({ name: '', email: '', phone: '', company: '', status: 'new', source: 'referral', property_interest: '', next_follow_up_at: '', note: '' })
      onClose()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save lead')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isClient ? 'New Homeowner' : 'New Lead'}>
      <div className="flex flex-col gap-4">
        <Field label="Full name *">
          <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Sarah Mitchell" autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="sarah@email.com" />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(850) 555-0101" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Stage">
            <Select value={form.status} onChange={e => set('status', e.target.value as LeadStatus)} className="w-full">
              {OWNER_STAGES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
            </Select>
          </Field>
          <Field label="Source">
            <Select value={form.source} onChange={e => set('source', e.target.value)} className="w-full">
              <option value="referral">Referral</option>
              <option value="website">Website</option>
              <option value="cold_call">Cold Call</option>
              <option value="social">Social Media</option>
              <option value="email">Email</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Property / area" hint="e.g. 4BR in WaterSound">
            <Input value={form.property_interest} onChange={e => set('property_interest', e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Next follow-up">
            <Input type="date" value={form.next_follow_up_at} onChange={e => set('next_follow_up_at', e.target.value)} />
          </Field>
        </div>

        <Field label="First note">
          <Textarea value={form.note} onChange={e => set('note', e.target.value)} placeholder="Optional — anything worth remembering" rows={2} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>{isClient ? 'Add Homeowner' : 'Add Lead'}</Button>
        </div>
      </div>
    </Modal>
  )
}
