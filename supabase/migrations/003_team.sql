-- ============================================================
-- 003_team.sql — Multi-user team support (July 23, 2026)
-- Run AFTER 002_relationship.sql, in the Supabase SQL editor.
--
-- Adds: user deactivation, forced password change on first login,
-- to-do assignment, an 'assigned' timeline event type, team-wide
-- profile visibility, and column locks so nobody can change their
-- own role or reactivate themselves (admin API / service role only).
-- ============================================================

-- Deactivation + first-login password change
alter table profiles add column if not exists active boolean not null default true;
alter table profiles add column if not exists must_change_password boolean not null default false;

-- Assignable to-dos
alter table todos add column if not exists assigned_to uuid references profiles(id) on delete set null;

create index if not exists leads_assigned_to_idx on leads(assigned_to);
create index if not exists todos_assigned_to_idx on todos(assigned_to);

-- Lead assignment shows on the timeline
alter table lead_activities drop constraint if exists lead_activities_type_check;
alter table lead_activities add constraint lead_activities_type_check check (
  type in ('note', 'email_sent', 'email_received', 'sms_sent', 'sms_received',
           'call', 'status_change', 'ai_draft', 'ai_action', 'created',
           'imported', 'mailchimp_sync', 'assigned')
);

-- Everyone on the team can see the roster (names for timelines,
-- assignment dropdowns, "who did what")
drop policy if exists "own_profile_select" on profiles;
drop policy if exists "profiles_select_all" on profiles;
create policy "profiles_select_all" on profiles for select to authenticated using (true);

-- Own-row updates only — and only harmless columns. role + active are
-- locked at the database level: they only change through the admin API
-- (service role), so a rep can't promote or reactivate themselves even
-- with direct API access.
revoke update on profiles from authenticated;
grant update (full_name, avatar_url, must_change_password) on profiles to authenticated;
