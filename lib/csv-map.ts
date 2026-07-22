// ============================================================
// lib/csv-map.ts — Streamline CSV column mapping
// Auto-detects which CSV columns map to which CRM fields.
// Works with any Streamline export (reservations, guests,
// owners) — unmapped columns are preserved in `extra`.
// ============================================================

export interface TargetField {
  key: string
  label: string
  aliases: string[]
  guestOnly?: boolean
}

export const TARGET_FIELDS: TargetField[] = [
  { key: 'name',          label: 'Full Name',        aliases: ['name', 'fullname', 'guestname', 'guest', 'contactname', 'ownername', 'contact'] },
  { key: 'first_name',    label: 'First Name',       aliases: ['firstname', 'first', 'fname', 'guestfirstname', 'ownerfirstname'] },
  { key: 'last_name',     label: 'Last Name',        aliases: ['lastname', 'last', 'lname', 'surname', 'guestlastname', 'ownerlastname'] },
  { key: 'email',         label: 'Email',            aliases: ['email', 'emailaddress', 'guestemail', 'owneremail', 'mail', 'email1'] },
  { key: 'phone',         label: 'Phone',            aliases: ['phone', 'phonenumber', 'mobile', 'cell', 'cellphone', 'telephone', 'guestphone', 'homephone', 'mobilephone', 'phone1'] },
  { key: 'company',       label: 'Company',          aliases: ['company', 'business', 'organization'] },
  { key: 'street',        label: 'Street Address',   aliases: ['address', 'street', 'address1', 'streetaddress', 'addressline1'] },
  { key: 'city',          label: 'City',             aliases: ['city', 'town'] },
  { key: 'state',         label: 'State',            aliases: ['state', 'province', 'region', 'stateprovince'] },
  { key: 'zip',           label: 'Zip',              aliases: ['zip', 'zipcode', 'postalcode', 'postal'] },
  { key: 'last_property', label: 'Property / Unit',  aliases: ['property', 'propertyname', 'unit', 'unitname', 'unitcode', 'listing', 'home', 'condo', 'propertyunit'], guestOnly: true },
  { key: 'arrival',       label: 'Arrival / Check-in', aliases: ['arrival', 'arrivaldate', 'checkin', 'checkindate', 'startdate', 'datearrival'], guestOnly: true },
  { key: 'departure',     label: 'Departure / Check-out', aliases: ['departure', 'departuredate', 'checkout', 'checkoutdate', 'enddate'], guestOnly: true },
  { key: 'total_spent',   label: 'Total / Amount',   aliases: ['total', 'totalamount', 'amount', 'amountpaid', 'grandtotal', 'price', 'revenue', 'totalcost', 'bookingtotal', 'totalrent', 'rent'], guestOnly: true },
  { key: 'stay_count',    label: 'Number of Stays',  aliases: ['staycount', 'stays', 'reservations', 'bookings', 'numberofstays', 'timesstayed'], guestOnly: true },
  { key: 'notes',         label: 'Notes',            aliases: ['notes', 'comments', 'remarks', 'note', 'memo'] },
  { key: 'source',        label: 'Source',           aliases: ['source', 'leadsource', 'channel', 'referral', 'bookingsource'] },
]

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Auto-map CSV headers to CRM fields.
 * Returns { csvHeader: fieldKey | null } — null means "keep in extra".
 */
export function autoMapColumns(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {}
  const used = new Set<string>()

  for (const header of headers) {
    const norm = normalizeHeader(header)
    let matched: string | null = null

    // Exact alias match first, then substring match
    for (const field of TARGET_FIELDS) {
      if (used.has(field.key)) continue
      if (field.aliases.includes(norm)) { matched = field.key; break }
    }
    if (!matched) {
      for (const field of TARGET_FIELDS) {
        if (used.has(field.key)) continue
        if (field.aliases.some(a => norm.includes(a) && a.length >= 4)) { matched = field.key; break }
      }
    }

    if (matched) used.add(matched)
    mapping[header] = matched
  }

  return mapping
}

/** Parse "$4,250.00" → 4250 */
export function parseMoney(value: string | undefined | null): number | null {
  if (!value) return null
  const cleaned = String(value).replace(/[^0-9.\-]/g, '')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

/** Parse common date formats → YYYY-MM-DD or null */
export function parseCsvDate(value: string | undefined | null): string | null {
  if (!value) return null
  const s = String(value).trim()
  if (!s) return null
  // MM/DD/YYYY or M/D/YY
  const us = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (us) {
    let [, m, d, y] = us
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
    if (!isNaN(date.getTime())) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
  }
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
  }
  return null
}

export interface AggregatedContact {
  name: string
  email: string | null
  phone: string | null
  company: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  notes: string | null
  source: string | null
  extra: Record<string, string>
  stay_count: number
  total_spent: number
  first_stay_at: string | null
  last_stay_at: string | null
  last_property: string | null
}

/**
 * Group mapped rows by person (email → phone → name) and aggregate
 * stay data. A Streamline reservations export often has one row per
 * booking — the same guest can appear many times.
 */
export function aggregateRows(rows: MappedRow[]): AggregatedContact[] {
  const byKey = new Map<string, AggregatedContact>()

  for (const r of rows) {
    if (!r.name && !r.email) continue // unusable row
    const key = r.email ?? (r.phone ? `p:${r.phone.replace(/\D/g, '')}` : `n:${(r.name ?? '').toLowerCase()}`)

    let c = byKey.get(key)
    if (!c) {
      c = {
        name: r.name ?? r.email ?? 'Unknown',
        email: r.email, phone: r.phone, company: r.company,
        street: r.street, city: r.city, state: r.state, zip: r.zip,
        notes: r.notes, source: r.source, extra: { ...r.extra },
        stay_count: 0, total_spent: 0,
        first_stay_at: null, last_stay_at: null, last_property: null,
      }
      byKey.set(key, c)
    } else {
      // Fill blanks from later rows
      c.phone = c.phone ?? r.phone
      c.company = c.company ?? r.company
      c.street = c.street ?? r.street
      c.city = c.city ?? r.city
      c.state = c.state ?? r.state
      c.zip = c.zip ?? r.zip
      c.notes = c.notes ?? r.notes
      Object.assign(c.extra, r.extra)
    }

    // Stay aggregation
    const isStayRow = !!(r.arrival || r.total_spent != null || r.last_property)
    if (isStayRow) {
      c.stay_count += 1
      if (r.total_spent != null) c.total_spent += r.total_spent
      if (r.arrival) {
        if (!c.first_stay_at || r.arrival < c.first_stay_at) c.first_stay_at = r.arrival
        if (!c.last_stay_at || r.arrival >= c.last_stay_at) {
          c.last_stay_at = r.arrival
          if (r.last_property) c.last_property = r.last_property
        }
      } else if (r.last_property && !c.last_property) {
        c.last_property = r.last_property
      }
    }
    // Explicit stay_count column overrides row counting
    if (r.stay_count != null && r.stay_count > c.stay_count) c.stay_count = r.stay_count
  }

  return Array.from(byKey.values())
}

export interface MappedRow {
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  last_property: string | null
  arrival: string | null
  departure: string | null
  total_spent: number | null
  stay_count: number | null
  notes: string | null
  source: string | null
  extra: Record<string, string>
}

/** Apply a column mapping to one CSV row. */
export function mapRow(row: Record<string, string>, mapping: Record<string, string | null>): MappedRow {
  const get = (field: string): string | null => {
    for (const [header, mapped] of Object.entries(mapping)) {
      if (mapped === field) {
        const v = (row[header] ?? '').trim()
        if (v) return v
      }
    }
    return null
  }

  const first = get('first_name')
  const last = get('last_name')
  let name = get('name')
  if (!name && (first || last)) name = [first, last].filter(Boolean).join(' ')

  const extra: Record<string, string> = {}
  for (const [header, mapped] of Object.entries(mapping)) {
    if (mapped === null) {
      const v = (row[header] ?? '').trim()
      if (v) extra[header] = v
    }
  }

  const stayCountRaw = get('stay_count')
  const stayCount = stayCountRaw ? parseInt(stayCountRaw.replace(/\D/g, ''), 10) : null

  return {
    name,
    email: get('email')?.toLowerCase() ?? null,
    phone: get('phone'),
    company: get('company'),
    street: get('street'),
    city: get('city'),
    state: get('state'),
    zip: get('zip'),
    last_property: get('last_property'),
    arrival: parseCsvDate(get('arrival')),
    departure: parseCsvDate(get('departure')),
    total_spent: parseMoney(get('total_spent')),
    stay_count: stayCount && !isNaN(stayCount) ? stayCount : null,
    notes: get('notes'),
    source: get('source'),
    extra,
  }
}
