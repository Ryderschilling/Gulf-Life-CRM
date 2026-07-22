import { Resend } from 'resend'

// Lazy init — avoids module-level throw that breaks Vercel build
let _resend: Resend | null = null

export function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

export function resendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'noreply@livegulflife.com'
export const FROM_NAME = process.env.RESEND_FROM_NAME ?? 'Gulf Life Concierge'
export const FROM = `${FROM_NAME} <${FROM_EMAIL}>`
export const RESEND_FROM = FROM

// Where client replies should land. Set this to an address on a Resend
// receiving domain (MX configured) so inbound replies hit /api/webhooks/resend.
export const REPLY_TO = process.env.RESEND_REPLY_TO || undefined
