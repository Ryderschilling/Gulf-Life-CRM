// ============================================================
// Gmail mailer — Gulf Life's own mailbox (Host@LiveGulfLife.com
// on Google Workspace). Sends over Gmail SMTP with an app
// password; replies land straight back in the real inbox AND are
// pulled into the CRM by /api/email/poll (IMAP). No third-party
// email service, no foreign domains.
//
// Env:
//   GMAIL_USER          account we log in as (e.g. host@livegulflife.com)
//   GMAIL_APP_PASSWORD  16-char Google app password (needs 2-Step Verification)
//   EMAIL_FROM_ADDRESS  identity on outgoing mail (default: GMAIL_USER).
//                       If it differs from GMAIL_USER, Gmail must have it
//                       configured as a verified "Send mail as" alias.
//   EMAIL_FROM_NAME     display name (default: Gulf Life Concierge)
// ============================================================

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

let _tx: Transporter | null = null

export function mailerConfigured(): boolean {
  return !!process.env.GMAIL_USER && !!process.env.GMAIL_APP_PASSWORD
}

function getTransport(): Transporter | null {
  if (!mailerConfigured()) return null
  if (!_tx) {
    _tx = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    })
  }
  return _tx
}

export const FROM_EMAIL = process.env.EMAIL_FROM_ADDRESS ?? process.env.GMAIL_USER ?? 'host@livegulflife.com'
export const FROM_NAME = process.env.EMAIL_FROM_NAME ?? 'Gulf Life Concierge'
export const FROM = `${FROM_NAME} <${FROM_EMAIL}>`

export async function sendEmail(opts: { to: string; subject: string; text: string }): Promise<{ id?: string; error?: string }> {
  const tx = getTransport()
  if (!tx) return { error: 'Email is not configured yet (set GMAIL_USER + GMAIL_APP_PASSWORD)' }
  try {
    const info = await tx.sendMail({ from: FROM, to: opts.to, subject: opts.subject, text: opts.text })
    return { id: info.messageId ?? undefined }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Email send failed' }
  }
}
