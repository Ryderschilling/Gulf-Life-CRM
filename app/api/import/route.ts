// POST /api/import
// Receives aggregated contacts from the CSV wizard (already parsed
// + column-mapped + grouped client-side) and writes them to the DB
// with dedupe against existing leads.
//
// Actions:
//   { action: 'start', filename, lead_type, mapping }        → { import_id }
//   { action: 'rows', import_id, lead_type, dedupe, contacts } → { imported, updated, skipped, errors }
//   { action: 'finish', import_id }                            → { summary }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncOutstandingLeads } from '@/lib/mailchimp'
import type { AggregatedContact } from '@/lib/csv-map'
import type { Lead } from '@/lib/types'

export const maxDuration = 60

interface RowError { row: number; message: string }

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()

    // ── START ──────────────────────────────────────────────
    if (body.action === 'start') {
      const { data, error } = await supabase.from('imports').insert({
        filename: String(body.filename ?? 'import.csv').slice(0, 200),
        lead_type: 'owner',
        column_mapping: body.mapping ?? null,
        row_count: Number(body.row_count) || 0,
        created_by: user.id,
      }).select('id').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ import_id: data.id })
    }

    // ── ROWS ───────────────────────────────────────────────
    if (body.action === 'rows') {
      const importId = String(body.import_id)
      const leadType: 'owner' | 'guest' = 'owner'
      // Homeowner CSVs come in as clients; explicit 'prospect' still supported.
      const relationship: 'prospect' | 'client' = body.relationship === 'client' ? 'client' : 'prospect'
      const dedupe: 'update' | 'skip' = body.dedupe === 'skip' ? 'skip' : 'update'
      const contacts = (body.contacts ?? []) as AggregatedContact[]

      if (contacts.length === 0) return NextResponse.json({ imported: 0, updated: 0, skipped: 0, errors: [] })
      if (contacts.length > 600) return NextResponse.json({ error: 'Chunk too large' }, { status: 400 })

      // Fetch potential duplicates in one shot
      const emails = contacts.map(c => c.email).filter(Boolean) as string[]
      const phones = contacts.map(c => c.phone?.replace(/\D/g, '')).filter(p => p && p.length >= 10) as string[]

      const existingByEmail = new Map<string, Lead>()
      const existingByPhone = new Map<string, Lead>()

      const LEAD_COLS = 'id, email, phone, company, extra, stay_count, total_spent, first_stay_at, last_stay_at, last_property'
      if (emails.length > 0) {
        const { data } = await supabase.from('leads').select(LEAD_COLS).in('email', emails).limit(1000)
        for (const l of (data ?? []) as Lead[]) if (l.email) existingByEmail.set(l.email.toLowerCase(), l)
      }
      if (phones.length > 0) {
        // Phone formats vary — normalize in memory against all leads with phones
        const { data } = await supabase.from('leads').select(LEAD_COLS).not('phone', 'is', null).limit(5000)
        for (const l of (data ?? []) as Lead[]) {
          const digits = l.phone?.replace(/\D/g, '')
          if (digits && digits.length >= 10) existingByPhone.set(digits.slice(-10), l)
        }
      }

      let imported = 0, updated = 0, skipped = 0
      const errors: RowError[] = []
      const newLeadIds: string[] = []

      for (let i = 0; i < contacts.length; i++) {
        const c = contacts[i]
        try {
          if (!c.name || !c.name.trim()) { skipped++; continue }

          const emailKey = c.email?.toLowerCase() ?? null
          const phoneKey = c.phone?.replace(/\D/g, '').slice(-10) ?? null
          const existing = (emailKey && existingByEmail.get(emailKey)) ||
                           (phoneKey && phoneKey.length === 10 && existingByPhone.get(phoneKey)) || null

          if (existing) {
            if (dedupe === 'skip') { skipped++; continue }

            // Merge update — fill blanks, aggregate stays idempotently
            const updates: Record<string, unknown> = {}
            if (!existing.email && c.email) updates.email = c.email
            if (!existing.phone && c.phone) updates.phone = c.phone
            if (!existing.company && c.company) updates.company = c.company
            if (Object.keys(c.extra).length > 0) updates.extra = { ...(existing.extra ?? {}), ...c.extra }

            if (Object.keys(updates).length > 0) {
              const { error } = await supabase.from('leads').update(updates).eq('id', existing.id)
              if (error) throw new Error(error.message)
              updated++
            } else {
              skipped++
            }
            continue
          }

          // Insert new lead
          const { data: lead, error } = await supabase.from('leads').insert({
            lead_type: leadType,
            relationship,
            name: c.name.trim().slice(0, 200),
            email: c.email,
            phone: c.phone,
            company: c.company,
            status: 'new',
            source: c.source ?? 'csv_import',
            extra: c.extra,
            import_id: importId,
          }).select('id').single()
          if (error) throw new Error(error.message)

          newLeadIds.push(lead.id)

          // Address
          if (c.street || c.city) {
            await supabase.from('lead_addresses').insert({
              lead_id: lead.id,
              label: 'Property',
              street: c.street, city: c.city, state: c.state ?? 'FL', zip: c.zip,
              is_primary: true,
            })
          }
          // Note
          if (c.notes) {
            await supabase.from('lead_notes').insert({ lead_id: lead.id, user_id: user.id, body: `From import: ${c.notes}` })
          }

          imported++
          // Track in maps so later chunks in-file dedupe correctly
          if (emailKey) existingByEmail.set(emailKey, { id: lead.id } as Lead)
          if (phoneKey && phoneKey.length === 10) existingByPhone.set(phoneKey, { id: lead.id } as Lead)
        } catch (err) {
          errors.push({ row: i, message: err instanceof Error ? err.message : 'Unknown error' })
        }
      }

      // Bulk activity log for new leads
      if (newLeadIds.length > 0) {
        await supabase.from('lead_activities').insert(
          newLeadIds.map(id => ({
            lead_id: id, user_id: user.id, type: 'imported',
            body: 'Imported from Streamline CSV',
            metadata: { import_id: importId },
          }))
        )
      }

      // Update running counts on the import row
      const { data: imp } = await supabase.from('imports').select('imported_count, updated_count, skipped_count, error_count, errors').eq('id', importId).single()
      await supabase.from('imports').update({
        imported_count: (imp?.imported_count ?? 0) + imported,
        updated_count: (imp?.updated_count ?? 0) + updated,
        skipped_count: (imp?.skipped_count ?? 0) + skipped,
        error_count: (imp?.error_count ?? 0) + errors.length,
        errors: [...((imp?.errors as RowError[] | null) ?? []), ...errors].slice(0, 100),
      }).eq('id', importId)

      return NextResponse.json({ imported, updated, skipped, errors })
    }

    // ── FINISH ─────────────────────────────────────────────
    if (body.action === 'finish') {
      const { data } = await supabase.from('imports').select('*').eq('id', body.import_id).single()
      // Auto-sync freshly imported leads into Mailchimp (demo excluded; non-fatal)
      let mailchimp: { synced: number; failed: number; skipped: number } | null = null
      try {
        mailchimp = await syncOutstandingLeads(supabase, 200)
      } catch (err) {
        console.error('[import finish] mailchimp sync failed', err)
      }
      return NextResponse.json({ summary: data, mailchimp })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[POST /api/import]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
