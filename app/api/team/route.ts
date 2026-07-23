// GET  /api/team — list team members (profiles merged with auth emails)
// POST /api/team — create a user: { name, login, role, password }
//   `login` can be a full email OR a bare username (maps to
//   <name>@gulflife.crm — same rule as the login form).
// Admin only. Uses the service role for the Supabase auth admin API.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import type { Profile, TeamMember, UserRole } from '@/lib/types'

function loginToEmail(login: string): string {
  const trimmed = login.trim()
  return trimmed.includes('@') ? trimmed.toLowerCase() : `${trimmed.toLowerCase()}@gulflife.crm`
}

export async function GET() {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

    const service = createServiceClient()
    const [{ data: profiles, error: pErr }, { data: usersData, error: uErr }] = await Promise.all([
      service.from('profiles').select('*').order('created_at', { ascending: true }),
      service.auth.admin.listUsers({ page: 1, perPage: 200 }),
    ])
    if (pErr) throw pErr
    if (uErr) throw uErr

    const byId = new Map(usersData.users.map(u => [u.id, u]))
    const team: TeamMember[] = ((profiles ?? []) as Profile[]).map(p => ({
      ...p,
      email: byId.get(p.id)?.email ?? '',
      last_sign_in_at: byId.get(p.id)?.last_sign_in_at ?? null,
    }))

    return NextResponse.json({ team })
  } catch (err) {
    console.error('[GET /api/team]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

    const body = await req.json() as { name?: string; login?: string; role?: UserRole; password?: string }
    const name = body.name?.trim()
    const login = body.login?.trim()
    const role: UserRole = body.role === 'owner' ? 'owner' : 'sales_rep'
    const password = body.password ?? ''

    if (!name || !login) return NextResponse.json({ error: 'Name and email/username are required' }, { status: 400 })
    if (password.length < 8) return NextResponse.json({ error: 'Temporary password must be at least 8 characters' }, { status: 400 })

    const email = loginToEmail(login)
    const service = createServiceClient()

    const { data: created, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, role },
    })
    if (error) {
      const msg = /already/i.test(error.message)
        ? 'That email already has an account'
        : error.message
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    // The DB trigger created the profile from metadata. The password the
    // admin typed IS the login — permanent until an admin changes it in
    // Settings → Team (Ryder's call: no forced-change flow).
    return NextResponse.json({ id: created.user.id, email }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/team]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
