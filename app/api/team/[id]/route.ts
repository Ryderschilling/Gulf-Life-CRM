// PATCH /api/team/[id] — update a team member. Admin only.
// Body (any subset): { role, active, password, full_name }
//   role     — 'owner' | 'sales_rep' (can't demote yourself)
//   active   — false deactivates: bans the auth user + flags the profile.
//              History (notes, sends, assignments) stays intact.
//   password — sets the account's new password (permanent — no forced change)
// Deliberately no DELETE — deactivate instead, so attribution survives.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import type { UserRole } from '@/lib/types'

interface Params { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

    const { id } = await params
    const body = await req.json() as {
      role?: UserRole
      active?: boolean
      password?: string
      full_name?: string
    }

    const isSelf = id === admin.id
    if (isSelf && body.role === 'sales_rep') {
      return NextResponse.json({ error: "You can't demote yourself — ask the other admin" }, { status: 400 })
    }
    if (isSelf && body.active === false) {
      return NextResponse.json({ error: "You can't deactivate your own account" }, { status: 400 })
    }

    const service = createServiceClient()

    // Profile fields
    const profileUpdate: Record<string, unknown> = {}
    if (body.role === 'owner' || body.role === 'sales_rep') profileUpdate.role = body.role
    if (typeof body.active === 'boolean') profileUpdate.active = body.active
    if (typeof body.full_name === 'string' && body.full_name.trim()) profileUpdate.full_name = body.full_name.trim()

    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await service.from('profiles').update(profileUpdate).eq('id', id)
      if (error) throw error
    }

    // Auth-side changes
    if (typeof body.active === 'boolean') {
      // Ban blocks new sign-ins immediately; the layout kicks out any
      // live session as soon as it sees active=false.
      const { error } = await service.auth.admin.updateUserById(id, {
        ban_duration: body.active ? 'none' : '87600h', // ~10 years
      })
      if (error) throw error
    }

    if (body.password) {
      if (body.password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
      }
      const { error } = await service.auth.admin.updateUserById(id, { password: body.password })
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/team/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
