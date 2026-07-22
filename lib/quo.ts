// ============================================================
// lib/quo.ts — SMS via Quo (formerly OpenPhone)
// John's number lives in Quo, so we use the Quo API, not Twilio.
// Docs: https://www.quo.com/docs  ·  Base: https://api.quo.com/v1
// Auth: `Authorization: <API_KEY>` (no Bearer prefix)
// ============================================================

const QUO_BASE = 'https://api.quo.com/v1'

export function quoConfigured(): boolean {
  return !!(process.env.QUO_API_KEY && process.env.QUO_FROM_NUMBER)
}

export function quoFromNumber(): string {
  return process.env.QUO_FROM_NUMBER ?? ''
}

interface QuoSendResult {
  ok: boolean
  id?: string
  error?: string
}

/**
 * Send an SMS through Quo.
 * `to` must be E.164 (+18505551234).
 */
export async function sendQuoSms(to: string, content: string): Promise<QuoSendResult> {
  const apiKey = process.env.QUO_API_KEY
  const from = process.env.QUO_FROM_NUMBER

  if (!apiKey || !from) {
    return { ok: false, error: 'Quo is not configured. Add QUO_API_KEY and QUO_FROM_NUMBER to the environment.' }
  }

  try {
    const res = await fetch(`${QUO_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content, from, to: [to] }),
    })

    if (res.status === 202 || res.ok) {
      const data = await res.json().catch(() => null) as { data?: { id?: string } } | null
      return { ok: true, id: data?.data?.id }
    }

    const errBody = await res.text().catch(() => '')
    return { ok: false, error: `Quo API error ${res.status}: ${errBody.slice(0, 300)}` }
  } catch (err) {
    return { ok: false, error: `Quo request failed: ${err instanceof Error ? err.message : 'unknown error'}` }
  }
}

/** List phone numbers on the Quo account (for the settings page). */
export async function listQuoNumbers(): Promise<{ ok: boolean; numbers?: { number: string; name?: string }[]; error?: string }> {
  const apiKey = process.env.QUO_API_KEY
  if (!apiKey) return { ok: false, error: 'QUO_API_KEY not set' }

  try {
    const res = await fetch(`${QUO_BASE}/phone-numbers`, {
      headers: { 'Authorization': apiKey },
    })
    if (!res.ok) {
      return { ok: false, error: `Quo API error ${res.status}` }
    }
    const data = await res.json() as { data?: { number?: string; formattedNumber?: string; name?: string }[] }
    return {
      ok: true,
      numbers: (data.data ?? []).map(n => ({ number: n.number ?? n.formattedNumber ?? '', name: n.name })),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' }
  }
}
