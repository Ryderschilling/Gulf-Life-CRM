-- ============================================================
-- Gulf Life CRM — Consolidated Schema (v2)
-- Fresh install: run once on a new Supabase project.
-- Owner-lead sales pipeline + guest marketing database,
-- Streamline CSV imports, AI brain, todos, email/SMS logs.
-- ============================================================

-- -------------------------------------------------------
-- PROFILES (extends auth.users)
-- -------------------------------------------------------
create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text,
  role text not null check (role in ('owner', 'sales_rep')) default 'sales_rep',
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'sales_rep')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -------------------------------------------------------
-- IMPORTS (one row per CSV import run)
-- -------------------------------------------------------
create table if not exists imports (
  id uuid default gen_random_uuid() primary key,
  filename text not null,
  lead_type text not null check (lead_type in ('owner', 'guest')),
  row_count int not null default 0,
  imported_count int not null default 0,
  updated_count int not null default 0,
  skipped_count int not null default 0,
  error_count int not null default 0,
  column_mapping jsonb,
  errors jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now() not null
);

-- -------------------------------------------------------
-- LEADS (owner leads = sales pipeline; guests = marketing db)
-- -------------------------------------------------------
create table if not exists leads (
  id uuid default gen_random_uuid() primary key,
  -- Type
  lead_type text not null check (lead_type in ('owner', 'guest')) default 'owner',
  -- Core info
  name text not null,
  email text,
  phone text,
  company text,
  -- Pipeline (meaningful for owner leads)
  status text not null check (
    status in ('new', 'contacted', 'nurturing', 'proposal', 'closed_won', 'closed_lost')
  ) default 'new',
  source text,
  assigned_to uuid references profiles(id) on delete set null,
  -- Owner-lead context
  property_interest text,
  budget_range text,
  move_in_timeline text,
  -- Guest context (from Streamline imports)
  first_stay_at date,
  last_stay_at date,
  stay_count int not null default 0,
  total_spent numeric(12,2) not null default 0,
  last_property text,
  -- Anything from a CSV that didn't map to a column
  extra jsonb not null default '{}'::jsonb,
  -- Import provenance
  import_id uuid references imports(id) on delete set null,
  -- Marketing sync
  mailchimp_synced_at timestamptz,
  mailchimp_status text,
  tags text[] not null default '{}',
  -- Tracking
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  -- Meta
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create trigger leads_updated_at
  before update on leads
  for each row execute procedure update_updated_at();

-- -------------------------------------------------------
-- LEAD ADDRESSES (properties they own / stayed at)
-- -------------------------------------------------------
create table if not exists lead_addresses (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  label text not null default 'Property',
  street text,
  city text,
  state text default 'FL',
  zip text,
  notes text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lead_addresses_primary_idx
  on lead_addresses(lead_id) where is_primary = true;

create trigger lead_addresses_updated_at
  before update on lead_addresses
  for each row execute procedure update_updated_at();

-- -------------------------------------------------------
-- LEAD NOTES
-- -------------------------------------------------------
create table if not exists lead_notes (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references leads(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete set null,
  body text not null,
  created_at timestamptz default now() not null
);

-- -------------------------------------------------------
-- LEAD ACTIVITIES (timeline)
-- -------------------------------------------------------
create table if not exists lead_activities (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references leads(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete set null,
  type text not null check (
    type in ('note', 'email_sent', 'email_received', 'sms_sent', 'sms_received',
             'call', 'status_change', 'ai_draft', 'ai_action', 'created', 'imported', 'mailchimp_sync')
  ),
  body text,
  metadata jsonb,
  created_at timestamptz default now() not null
);

-- -------------------------------------------------------
-- EMAIL DRAFTS (AI-generated, review before send)
-- -------------------------------------------------------
create table if not exists email_drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  to_email text not null,
  to_name text,
  subject text not null,
  body text not null,
  original_body text,
  original_subject text,
  edit_learned boolean default false,
  trigger_type text,
  trigger_context jsonb,
  status text not null default 'pending',
  ai_generated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references profiles(id),
  dismissed_at timestamptz,
  dismissed_by uuid references profiles(id)
);

create trigger email_drafts_updated_at
  before update on email_drafts
  for each row execute procedure update_updated_at();

-- -------------------------------------------------------
-- SMS MESSAGES (sent via Quo)
-- -------------------------------------------------------
create table if not exists sms_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  to_phone text not null,
  body text not null,
  status text not null default 'pending',
  provider text not null default 'quo',
  provider_id text,
  direction text not null default 'outbound',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  created_by uuid references profiles(id)
);

-- -------------------------------------------------------
-- DAILY DIGESTS
-- -------------------------------------------------------
create table if not exists daily_digests (
  id uuid primary key default gen_random_uuid(),
  digest_date date not null default current_date,
  digest_type text not null default 'sales_rep',
  content jsonb not null,
  generated_at timestamptz not null default now(),
  unique(digest_date, digest_type)
);

-- -------------------------------------------------------
-- TODOS
-- -------------------------------------------------------
create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type text not null default 'manual',
  linked_lead_id uuid references leads(id) on delete set null,
  linked_draft_id uuid references email_drafts(id) on delete set null,
  is_completed boolean not null default false,
  completed_at timestamptz,
  is_archived boolean not null default false,
  archived_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger todos_updated_at
  before update on todos
  for each row execute procedure update_updated_at();

-- -------------------------------------------------------
-- AI BRAIN
-- -------------------------------------------------------
create table if not exists ai_context_files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  content text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ai_context_files_updated_at
  before update on ai_context_files
  for each row execute procedure update_updated_at();

create table if not exists ai_memories (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  content text not null,
  lead_id uuid references leads(id) on delete cascade,
  source text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists ai_conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ai_conversations_updated_at
  before update on ai_conversations
  for each row execute procedure update_updated_at();

-- -------------------------------------------------------
-- ROW LEVEL SECURITY (single-tenant: any authed user)
-- -------------------------------------------------------
alter table profiles enable row level security;
alter table imports enable row level security;
alter table leads enable row level security;
alter table lead_addresses enable row level security;
alter table lead_notes enable row level security;
alter table lead_activities enable row level security;
alter table email_drafts enable row level security;
alter table sms_messages enable row level security;
alter table daily_digests enable row level security;
alter table todos enable row level security;
alter table ai_context_files enable row level security;
alter table ai_memories enable row level security;
alter table ai_conversations enable row level security;

create policy "own_profile_select" on profiles for select using (auth.uid() = id);
create policy "own_profile_update" on profiles for update using (auth.uid() = id);

create policy "auth_all_imports" on imports for all to authenticated using (true) with check (true);
create policy "auth_all_leads" on leads for all to authenticated using (true) with check (true);
create policy "auth_all_lead_addresses" on lead_addresses for all to authenticated using (true) with check (true);
create policy "auth_all_lead_notes" on lead_notes for all to authenticated using (true) with check (true);
create policy "auth_all_lead_activities" on lead_activities for all to authenticated using (true) with check (true);
create policy "auth_all_email_drafts" on email_drafts for all to authenticated using (true) with check (true);
create policy "auth_all_sms_messages" on sms_messages for all to authenticated using (true) with check (true);
create policy "auth_all_daily_digests" on daily_digests for all to authenticated using (true) with check (true);
create policy "auth_all_todos" on todos for all to authenticated using (true) with check (true);
create policy "auth_all_ai_context_files" on ai_context_files for all to authenticated using (true) with check (true);
create policy "auth_all_ai_memories" on ai_memories for all to authenticated using (true) with check (true);
create policy "auth_all_ai_conversations" on ai_conversations for all to authenticated using (true) with check (true);

-- -------------------------------------------------------
-- INDEXES
-- -------------------------------------------------------
create index if not exists leads_status_idx on leads(status);
create index if not exists leads_lead_type_idx on leads(lead_type);
create index if not exists leads_email_idx on leads(lower(email));
create index if not exists leads_phone_idx on leads(phone);
create index if not exists leads_created_at_idx on leads(created_at desc);
create index if not exists leads_next_follow_up_idx on leads(next_follow_up_at);
create index if not exists leads_import_id_idx on leads(import_id);
create index if not exists lead_addresses_lead_id_idx on lead_addresses(lead_id);
create index if not exists lead_notes_lead_id_idx on lead_notes(lead_id);
create index if not exists lead_activities_lead_id_idx on lead_activities(lead_id);
create index if not exists lead_activities_created_at_idx on lead_activities(created_at desc);
create index if not exists email_drafts_lead_id_idx on email_drafts(lead_id);
create index if not exists email_drafts_status_idx on email_drafts(status);
create index if not exists sms_messages_lead_id_idx on sms_messages(lead_id);
create index if not exists todos_is_completed_idx on todos(is_completed);
create index if not exists todos_is_archived_idx on todos(is_archived);
create index if not exists ai_memories_type_idx on ai_memories(type);
create index if not exists ai_memories_lead_id_idx on ai_memories(lead_id);
