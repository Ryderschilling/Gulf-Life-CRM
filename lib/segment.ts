// ============================================================
// lib/segment.ts — global Prospect | Client segment.
// Backed by a cookie so the choice sticks across every page and
// survives refresh. Server components read it with getSegment();
// the Sidebar toggle writes it and calls router.refresh().
// ============================================================

import { cookies } from 'next/headers'
import type { Relationship } from './types'

export type Segment = Relationship

export const SEGMENT_COOKIE = 'crm_seg'
export const SEGMENTS: Segment[] = ['prospect', 'client']

export const SEGMENT_CONFIG: Record<Segment, { label: string; noun: string; nounPlural: string }> = {
  prospect: { label: 'Prospects', noun: 'lead', nounPlural: 'leads' },
  client:   { label: 'Clients',   noun: 'homeowner', nounPlural: 'homeowners' },
}

/** Read the active segment from the request cookie. Defaults to 'prospect'. */
export async function getSegment(): Promise<Segment> {
  const store = await cookies()
  return store.get(SEGMENT_COOKIE)?.value === 'client' ? 'client' : 'prospect'
}
