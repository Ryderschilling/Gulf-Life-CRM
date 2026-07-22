# Gulf Life CRM — Project Context

> Full context for any AI session or developer picking this up.
> Built July 21–22, 2026 by Ryder (builtbyRyder) for John O'Hanlan, Gulf Life Concierge — a vacation rental property management company on 30A, Florida. Sold at $2k.

## What This Is

A sales + guest-marketing CRM with AI that can take actions. Two record types live in ONE `leads` table, split by `lead_type`:

- **`owner`** — homeowners on 30A who might hire Gulf Life to manage their rental property. These go through the sales pipeline: `new → contacted → nurturing → proposal → closed_won / closed_lost`.
- **`guest`** — past renters imported from Streamline (John's booking platform) via CSV. Marketing database: stay history, lifetime spend, last property. NOT pipeline records.

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript + Tailwind v3
- **Supabase** — Postgres, auth (email/password), RLS on
- **OpenAI `gpt-4o`** — agentic AI chat (function calling), email drafts, daily briefing
- **Gmail (Gulf Life mailbox)** — 1:1 email as `Host@LiveGulfLife.com` (Google Workspace). Outbound: Gmail SMTP w/ app password (`lib/mailer.ts`). Inbound: `/api/email/poll` reads the mailbox over IMAP (last 7 days, lead-matched only, Message-ID deduped, never marks mail read) — triggered by the Inbox UI on open + every 60s. Replies also stay in the real Gmail inbox/Sent, so John sees everything there too. NO third-party email service; never send Gulf Life mail from another client's domain (Resend/thriveco.net was removed Jul 22 for exactly that reason).
- **Quo** (formerly OpenPhone) — SMS. John's number lives in Quo, so we use the Quo API (`https://api.quo.com/v1`, header `Authorization: <API_KEY>` — no Bearer prefix), NOT raw Twilio
- **Mailchimp** — marketing audience sync (member upsert + tags by type/stage)
- **papaparse** — client-side CSV parsing for the import wizard

Design: light "WhiteUI"-style theme — `#f6f7fb` page, white cards (16px radius), indigo accent `#6366f1`, soft status pills. Tokens in `tailwind.config.ts` + `app/globals.css`. Shared primitives in `components/ui/kit.tsx`.

## Pages

| Route | What |
|---|---|
| `/login` | Email/password (Supabase auth) |
| `/crm` | Overview — 4 stat cards + all leads/guests table (tabs, stage chips, search, pagination) |
| `/crm/pipeline` | Kanban, drag owner leads between stages (auto-logs stage_change activity) |
| `/crm/todo` | AI daily briefing (`/api/digest`), tasks, email-draft review queue, follow-ups due |
| `/crm/analytics` | Win rate, sources donut, weekly volume, guest revenue, top properties (pure SVG charts) |
| `/crm/ai` | Chat (tool-calling) + Brain Files (editable AI knowledge) + Memory (learned facts) |
| `/crm/import` | CSV wizard: drop file → auto-map columns → dedupe → import as guests or owner leads |
| `/crm/leads/[id]` | Lead detail: timeline, notes, quick actions (AI draft, SMS, follow-up, Mailchimp sync) |
| `/crm/settings` | Profile + live integration status (checks env + pings APIs) |

Global: floating AI drawer on every page (`components/ai/AIDrawer.tsx`); on a lead page it auto-loads that lead's context.

## The AI (most important feature)

`lib/ai-tools.ts` defines 13 tools the chat AI can execute: search_leads, get_lead_details, create_lead, update_lead (incl. stage moves), add_note, create_todo, complete_todo, list_todos, get_pipeline_stats, draft_email, send_email, send_sms, sync_mailchimp.

- Agentic loop in `app/api/ai/chat/route.ts` (max 6 tool rounds). Executed actions return as green chips in the UI and log to the lead timeline (`ai_action` / `ai_draft` activity types).
- **Safety model:** drafting is unrestricted (drafts land in a human review queue on To-Do). `send_email` / `send_sms` require `confirmed: true`, which the system prompt only allows after the user explicitly says to send in that conversation.
- Context per call: brain files (`ai_context_files`) + learned memories (`ai_memories`) + live pipeline snapshot (`lib/ai-context.ts`).

## CSV Import (Streamline)

Client (`components/import/ImportWizard.tsx`): papaparse → `lib/csv-map.ts` auto-maps headers via alias lists → user fixes mapping → rows grouped per person (`aggregateRows` — one guest can have many reservation rows; aggregates stay_count, total_spent, first/last stay, last property) → chunks of 400 POSTed to `/api/import`.

Server (`app/api/import/route.ts`): 3 actions (start/rows/finish). Dedupes by email then last-10-digits phone. `update` strategy merges + aggregates stays idempotently (only counts stays newer than `last_stay_at`); `skip` skips. Unmapped CSV columns preserved in `leads.extra` jsonb → shown on lead detail under "More from import". Import runs audited in `imports` table.

## Database (Supabase)

- Project: `gulf-life-crm`, ref **ysspwvimwhydyjklhljo**, in the dedicated **"Gulf Life" org (Pro, $25/mo)** — intentionally separate from Ryder's other org (FOUND) so the whole org can be transferred to John later.
- Schema: `supabase/migrations/000_init.sql` (everything) + `001_seed_brain.sql` (4 AI brain files). Both applied 2026-07-22.
- Tables: profiles, imports, leads, lead_addresses, lead_notes, lead_activities, email_drafts, sms_messages, daily_digests, todos, ai_context_files, ai_memories, ai_conversations. RLS: any authenticated user (single-tenant).
- Demo data seeded (9 owner leads + 12 guests), all tagged `demo`. Purge: `delete from leads where 'demo' = any(tags);` and clear todos.
- Users: two accounts, both role `owner`:
  - **Username login: `Ryder` / `123456`** — the login form maps a bare username to `<name>@gulflife.crm` under the hood (account: ryder@gulflife.crm). Supabase requires email-format accounts and 6-char minimum passwords, hence the mapping and 123456 instead of 1234.
  - Ryderscott33@icloud.com / GulfLife2026! (original).
  - ⚠ Before deploying publicly or giving John access, set a real password — 123456 on an owner account is trivially guessable once the app is on the internet.
  - John's login not yet created (need his email). Add via Supabase → Authentication → Add user; profile auto-creates via trigger. A bare-username account for John = create `john@gulflife.crm`.

## Environment (`.env.local` — never commit)

Set: Supabase URL/anon/service-role, OPENAI_API_KEY, `QUO_API_KEY` + `QUO_FROM_NUMBER` (+ optional `QUO_WEBHOOK_SECRET`), `MAILCHIMP_API_KEY` + `MAILCHIMP_AUDIENCE_ID`. Email: `GMAIL_USER` + `GMAIL_APP_PASSWORD` (Google app password for the Gulf Life mailbox; requires 2-Step Verification) + optional `EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME`. All integrations degrade gracefully when unconfigured; Settings page shows live status. Mirror everything into Vercel env (Next reads env at boot — restart dev / redeploy after changes).

## Remaining To Launch

1. Deploy to Vercel (import repo/folder, paste `.env.local` vars, deploy) so John can use it anywhere
2. Quo + Mailchimp keys → env → texting + marketing sync go live
3. Create John's login when his email is known
4. Purge demo data when real data arrives
5. Business: bill John monthly hosting/AI/support (~$75–100/mo; Supabase $25 + OpenAI usage). Future upsell: live Streamline API sync ($6–10k, blocked on Streamline partner approval)

## Known Issues & History

- **Local dev on Ryder's Mac (July 21):** login form cleared on submit → root cause: a stray `~/package-lock.json` made Turbopack pick the wrong workspace root, breaking client JS. Fixed: removed stray lockfile + pinned `turbopack.root` in `next.config.ts` + login form has `action="javascript:void(0)"` guard. Follow-on error ("module not found in React Client Manifest") = stale `.next` built under the old root → fix: `rm -rf .next && npm run dev`. If that ever recurs, suspect the apostrophe in the folder path (`John's Project`) — rename to `Johns-CRM` as last resort.
- Old v1 CRM + old `.next` archived in `John's Project/_to_delete/` — safe to trash.
- The Supabase MCP connection in Ryder's Claude sessions only sees the FOUND org — manage this DB via the dashboard (SQL editor) or service-role REST.
- `middleware.ts` triggers a Next 16 deprecation warning (rename to `proxy` eventually — harmless).

## Verification Done (cloud, July 22)

Full Playwright pass against the live DB: login, all 8 pages screenshotted pixel-clean, zero console errors, and an end-to-end AI test where chat created a lead + linked to-do and answered with live stats (then test data was deleted). Production `next build` compiles clean.
