# Gulf Life CRM

Sales + guest marketing CRM for Gulf Life Concierge (30A property management).
Next.js 16 · Supabase · OpenAI · Resend · Quo (SMS) · Mailchimp.

## What it does

| Page | What |
|------|------|
| **Overview** (`/crm`) | Stat cards + every lead & guest in one filterable table |
| **Pipeline** (`/crm/pipeline`) | Kanban — drag owner leads through New → Contacted → Nurturing → Proposal → Won/Lost |
| **To-Do** (`/crm/todo`) | AI morning briefing, tasks, email drafts to review, follow-ups due |
| **Analytics** (`/crm/analytics`) | Win rate, sources, weekly volume, guest revenue, top properties |
| **AI Assistant** (`/crm/ai`) | Chat that can DO things: create/update leads, notes, todos, drafts, sends. Brain files + memory |
| **Import** (`/crm/import`) | Drop any Streamline CSV → auto-maps columns → dedupes → imports as guests or owner leads |
| **Settings** (`/crm/settings`) | Profile + live integration status |

Two record types, one table: **owner leads** (homeowners = sales pipeline) and
**guests** (past renters from Streamline = marketing database for Mailchimp/SMS).

## Setup

1. `npm install`
2. Create a Supabase project → SQL Editor → run `supabase/migrations/000_init.sql`, then `001_seed_brain.sql`
3. Copy `.env.example` → `.env.local`, fill in keys (Quo + Mailchimp optional — features gracefully disable)
4. Supabase → Authentication → Add user (email + password) for each person
5. `npm run dev`

## Deploy (Vercel)

Push to GitHub → import in Vercel → paste the same env vars → deploy.
Add new env vars anytime in Vercel → Settings → Environment Variables → redeploy.

## AI safety model

- The AI freely creates **drafts** (human reviews + sends from To-Do)
- `send_email` / `send_sms` only fire after the user explicitly confirms in chat
- Every AI action is logged on the lead timeline
