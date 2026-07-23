-- 002_relationship.sql
-- Split owner records into two sub-segments:
--   prospect = homeowner LEAD, lives in the sales pipeline (new→…→closed)
--   client   = CURRENT managed homeowner (imported from Streamline), not a sales record
-- Guests (lead_type='guest') ignore this field.
--
-- Existing owner rows default to 'prospect' (they were leads before this change),
-- which is exactly what we want. The Streamline homeowner CSV import tags 'client'.

alter table leads
  add column if not exists relationship text not null default 'prospect';

alter table leads
  drop constraint if exists leads_relationship_check;
alter table leads
  add constraint leads_relationship_check check (relationship in ('prospect', 'client'));

create index if not exists idx_leads_relationship on leads (relationship);

comment on column leads.relationship is
  'Owner sub-segment: prospect (sales pipeline) or client (current managed homeowner). Guests ignore this field.';
