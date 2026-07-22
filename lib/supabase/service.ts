// ============================================================
// lib/supabase/service.ts — SERVICE-ROLE Supabase client.
// For server-to-server contexts with NO logged-in user (webhooks,
// cron). Bypasses RLS — NEVER import this into a client component.
// ============================================================

import { createClient } from '@supabase/supabase-js'

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase service env vars missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
