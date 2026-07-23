'use client'

// Team management — admins only (the Settings page doesn't render this
// for members). Add users, change roles, set passwords,
// deactivate/reactivate. No deleting: history stays attributed.
// Logins are simple + permanent: username + password work as-is until
// an ADMIN changes them here. No forced-change flow (Ryder's call).

import { useCallback, useEffect, useState } from 'react'
import { UserPlus, KeyRound, ShieldOff, ShieldCheck, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import type { TeamMember, UserRole } from '@/lib/types'
import { ROLE_LABELS } from '@/lib/types'
import { timeAgo, cn } from '@/lib/utils'
import { Card, CardHeader, Button, Pill, Avatar, Field, Input, Select, Modal, Spinner } from '@/components/ui/kit'

function generatePassword(): string {
  // Readable password: Gulf-xxxx-xxxx (no ambiguous chars)
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const chunk = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `Gulf-${chunk()}-${chunk()}`
}

export default function TeamCard({ meId }: { meId: string }) {
  const [team, setTeam] = useState<TeamMember[] | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/team')
      .then(r => r.json())
      .then(d => { if (d.team) setTeam(d.team) })
      .catch(() => toast.error('Failed to load team'))
  }, [])

  useEffect(() => { load() }, [load])

  async function patch(id: string, body: Record<string, unknown>, okMsg: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/team/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast.success(okMsg)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusyId(null)
    }
  }

  function resetPassword(member: TeamMember) {
    const pw = generatePassword()
    patch(member.id, { password: pw }, 'Password changed')
    // Show it in a persistent toast so the admin can copy + share it
    toast((
      <span className="text-[13px]">
        New password for <b>{member.full_name ?? member.email}</b>:{' '}
        <code className="font-mono bg-[#f7f4ed] px-1.5 py-0.5 rounded">{pw}</code>
        <br />This is their login from now on — share it with them.
      </span>
    ), { duration: 30000 })
  }

  return (
    <Card>
      <CardHeader
        title="Team"
        subtitle="Who can sign in, and what they can do — Admins manage everything, Members work leads"
        right={<Button size="sm" onClick={() => setAddOpen(true)}><UserPlus size={14} /> Add user</Button>}
      />
      <div className="px-6 pb-6 flex flex-col gap-2.5">
        {!team && (
          <div className="flex items-center gap-3 py-4">
            <Spinner /> <span className="text-[13px] text-ink-2">Loading team…</span>
          </div>
        )}
        {team?.map(m => {
          const inactive = m.active === false
          const isMe = m.id === meId
          return (
            <div key={m.id} className={cn('flex flex-wrap items-center gap-3 border border-line rounded-xl px-4 py-3', inactive && 'opacity-60 bg-[#f7f4ed]')}>
              <Avatar name={m.full_name ?? m.email ?? '?'} size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink m-0 flex items-center gap-2 flex-wrap">
                  {m.full_name ?? 'No name'}
                  {isMe && <span className="text-[11px] font-bold text-ink-3">(you)</span>}
                  {inactive && <Pill tone="red" className="text-[11px] px-2 py-0.5">Deactivated</Pill>}
                </p>
                <p className="text-[12.5px] text-ink-3 m-0 mt-0.5 truncate">
                  {m.email}{m.last_sign_in_at ? ` · signed in ${timeAgo(m.last_sign_in_at)}` : ' · never signed in'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Select
                  value={m.role}
                  disabled={busyId === m.id || (isMe && m.role === 'owner')}
                  onChange={e => patch(m.id, { role: e.target.value as UserRole }, `${m.full_name ?? 'User'} is now ${ROLE_LABELS[e.target.value as UserRole]}`)}
                  className="text-[13px] py-1.5"
                >
                  <option value="owner">Admin</option>
                  <option value="sales_rep">Member</option>
                </Select>
                <Button size="sm" variant="secondary" title="Set a new password" disabled={busyId === m.id} onClick={() => resetPassword(m)}>
                  <KeyRound size={13} />
                </Button>
                {!isMe && (
                  inactive ? (
                    <Button size="sm" variant="secondary" loading={busyId === m.id} onClick={() => patch(m.id, { active: true }, 'Reactivated')}>
                      <ShieldCheck size={13} /> Reactivate
                    </Button>
                  ) : (
                    <Button size="sm" variant="danger" loading={busyId === m.id} onClick={() => patch(m.id, { active: false }, 'Deactivated — their history stays')}>
                      <ShieldOff size={13} /> Deactivate
                    </Button>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load() }} />
    </Card>
  )
}

function AddUserModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', login: '', role: 'sales_rep' as UserRole, password: generatePassword() })

  async function save() {
    if (!form.name.trim() || !form.login.trim()) { toast.error('Name and email/username are required'); return }
    if (form.password.length < 8) { toast.error('Password needs at least 8 characters'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast.success(`${form.name} added`)
      toast((
        <span className="text-[13px]">
          Share these with <b>{form.name}</b>:<br />
          Login: <code className="font-mono bg-[#f7f4ed] px-1.5 py-0.5 rounded">{data.email}</code><br />
          Password: <code className="font-mono bg-[#f7f4ed] px-1.5 py-0.5 rounded">{form.password}</code><br />
          That&apos;s their permanent login until an admin changes it here.
        </span>
      ), { duration: 45000 })
      setForm({ name: '', login: '', role: 'sales_rep', password: generatePassword() })
      onAdded()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a team member">
      <div className="flex flex-col gap-4">
        <Field label="Full name">
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Sarah Mitchell" autoFocus />
        </Field>
        <Field label="Email or username" hint="A bare username (no @) becomes name@gulflife.crm — they sign in with just the name, like Ryder does">
          <Input value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="sarah@email.com — or just: sarah" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))} className="w-full">
              <option value="sales_rep">Member — works leads</option>
              <option value="owner">Admin — full control</option>
            </Select>
          </Field>
          <Field label="Password">
            <div className="flex gap-1.5">
              <Input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="font-mono text-[13px]" />
              <Button variant="ghost" size="sm" title="Generate new" onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}>
                <RefreshCw size={14} />
              </Button>
            </div>
          </Field>
        </div>
        <p className="text-[12.5px] text-ink-3 m-0 bg-[#f7f4ed] rounded-lg px-3 py-2.5">
          The account works immediately — no email needed. Text or tell them the login + password. It stays exactly as set until an admin changes it here.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}><UserPlus size={14} /> Create account</Button>
        </div>
      </div>
    </Modal>
  )
}
