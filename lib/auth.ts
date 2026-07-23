// ============================================================
// lib/auth.ts — current-user + role helpers (server only).
// Roles: 'owner' = Admin (Ryder, John), 'sales_rep' = Member.
// Role checks are enforced here in the app layer; the DB locks
// the two dangerous columns (profiles.role / profiles.active)
// to the service role so nobody can self-promote.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/types'

export function isAdmin(profile: Profile | null | undefined): boolean {
  return profile?.role === 'owner'
}

/** The signed-in user's profile, or null when signed out. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  return (data as Profile | null) ?? null
}

/**
 * Everyone selectable for assignment: all profiles, deactivated filtered
 * out in JS (so this still works before migration 003 adds `active`).
 */
export async function getTeam(): Promise<Profile[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name', { ascending: true })
  return ((data ?? []) as Profile[]).filter(p => p.active !== false)
}

/**
 * For API routes: returns the caller's profile if they're an admin,
 * null otherwise (route should respond 403).
 */
export async function requireAdmin(): Promise<Profile | null> {
  const profile = await getCurrentProfile()
  return isAdmin(profile) && profile?.active !== false ? profile : null
}

/** First name for attribution lines ("Ryder moved to Proposal"). */
export function shortName(profile: Pick<Profile, 'full_name'> | null | undefined): string {
  const name = profile?.full_name?.trim()
  if (!name || name.includes('@')) return name?.split('@')[0] ?? 'Someone'
  return name.split(' ')[0]
}
