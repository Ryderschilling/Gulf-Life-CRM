-- ============================================================
-- Demo data — everything tagged 'demo' so it can be purged:
--   delete from leads where 'demo' = any(tags);
--   delete from todos where title like '[demo]%' or true; -- adjust as needed
-- ============================================================

-- Owner leads across the pipeline
WITH inserted AS (
  INSERT INTO leads (lead_type, name, email, phone, status, source, property_interest, last_contacted_at, next_follow_up_at, tags, created_at) VALUES
  ('owner', 'Sarah Mitchell',  'sarah.mitchell@example.com',  '850-555-0101', 'new',        'website',   '4BR Gulf-front in Rosemary Beach', NULL,                       now() + interval '1 day',  '{demo}', now() - interval '2 days'),
  ('owner', 'Tom Reynolds',    'tom.reynolds@example.com',    '850-555-0102', 'new',        'referral',  '3BR with pool in WaterColor',      NULL,                       now(),                     '{demo}', now() - interval '1 day'),
  ('owner', 'Jennifer Walsh',  'jen.walsh@example.com',       '850-555-0103', 'contacted',  'social',    '5BR in WaterSound Origins',        now() - interval '3 days',  now() - interval '1 day',  '{demo}', now() - interval '9 days'),
  ('owner', 'Mike Davidson',   'mike.davidson@example.com',   '850-555-0104', 'contacted',  'cold_call', 'Townhome in Seaside',              now() - interval '2 days',  now() + interval '2 days', '{demo}', now() - interval '12 days'),
  ('owner', 'Lisa Chen',       'lisa.chen@example.com',       '850-555-0105', 'nurturing',  'referral',  '4BR in Alys Beach',                now() - interval '6 days',  now() - interval '2 days', '{demo}', now() - interval '25 days'),
  ('owner', 'Robert Keller',   'rob.keller@example.com',      '850-555-0106', 'nurturing',  'website',   '2 cottages in Grayton Beach',      now() - interval '8 days',  now() + interval '3 days', '{demo}', now() - interval '31 days'),
  ('owner', 'Amanda Foster',   'amanda.foster@example.com',   '850-555-0107', 'proposal',   'referral',  '6BR estate, Gulf-front Rosemary',  now() - interval '1 day',   now() + interval '1 day',  '{demo}', now() - interval '40 days'),
  ('owner', 'David Nguyen',    'david.nguyen@example.com',    '850-555-0108', 'closed_won', 'website',   '4BR in WaterColor Phase III',      now() - interval '5 days',  NULL,                      '{demo}', now() - interval '55 days'),
  ('owner', 'Karen Bradley',   'karen.bradley@example.com',   '850-555-0109', 'closed_lost','cold_call', '3BR in Blue Mountain Beach',       now() - interval '20 days', NULL,                      '{demo}', now() - interval '60 days')
  RETURNING id, name, status
)
INSERT INTO lead_activities (lead_id, type, body, created_at)
SELECT id, 'created', 'Lead created', now() - interval '1 day' FROM inserted;

-- Guests (Streamline-style)
INSERT INTO leads (lead_type, name, email, phone, status, source, first_stay_at, last_stay_at, stay_count, total_spent, last_property, tags, created_at) VALUES
('guest', 'Emily Harper',    'emily.harper@example.com',    '404-555-0201', 'new', 'streamline', '2024-06-12', '2026-06-20', 3, 21400, 'Seas the Day — Rosemary Beach',    '{demo}', now() - interval '20 days'),
('guest', 'James Whitfield', 'james.whitfield@example.com', '615-555-0202', 'new', 'streamline', '2025-03-18', '2026-03-22', 2, 9800,  'Gulf Haven — WaterColor',          '{demo}', now() - interval '20 days'),
('guest', 'Olivia Sanders',  'olivia.sanders@example.com',  '205-555-0203', 'new', 'streamline', '2026-07-01', '2026-07-01', 1, 6400,  'Endless Summer — Seaside',         '{demo}', now() - interval '20 days'),
('guest', 'Chris Delgado',   'chris.delgado@example.com',   '512-555-0204', 'new', 'streamline', '2023-08-04', '2026-06-28', 4, 30200, 'Barefoot Bungalow — Grayton',      '{demo}', now() - interval '20 days'),
('guest', 'Megan Riley',     'megan.riley@example.com',     '318-555-0205', 'new', 'streamline', '2025-10-09', '2025-10-09', 1, 4200,  'Salt & Light — WaterSound',        '{demo}', now() - interval '20 days'),
('guest', 'Brian Castillo',  'brian.castillo@example.com',  '901-555-0206', 'new', 'streamline', '2024-04-15', '2026-04-19', 3, 18750, 'Seas the Day — Rosemary Beach',    '{demo}', now() - interval '20 days'),
('guest', 'Natalie Brooks',  'natalie.brooks@example.com',  '678-555-0207', 'new', 'streamline', '2026-05-23', '2026-05-23', 1, 7300,  'Gulf Haven — WaterColor',          '{demo}', now() - interval '20 days'),
('guest', 'Kevin O''Neal',   'kevin.oneal@example.com',     '225-555-0208', 'new', 'streamline', '2022-07-11', '2026-07-04', 5, 41800, 'Endless Summer — Seaside',         '{demo}', now() - interval '20 days'),
('guest', 'Rachel Kim',      'rachel.kim@example.com',      '972-555-0209', 'new', 'streamline', '2025-12-28', '2025-12-28', 1, 5100,  'Winter Waves — Alys Beach',        '{demo}', now() - interval '20 days'),
('guest', 'Steven Park',     'steven.park@example.com',     '407-555-0210', 'new', 'streamline', '2024-09-02', '2026-06-14', 2, 12600, 'Barefoot Bungalow — Grayton',      '{demo}', now() - interval '20 days'),
('guest', 'Laura Bennett',   'laura.bennett@example.com',   '256-555-0211', 'new', 'streamline', '2026-04-05', '2026-04-05', 1, 8900,  'Salt & Light — WaterSound',        '{demo}', now() - interval '20 days'),
('guest', 'Daniel Cruz',     'daniel.cruz@example.com',     '504-555-0212', 'new', 'streamline', '2023-06-30', '2026-07-02', 4, 27300, 'Seas the Day — Rosemary Beach',    '{demo}', now() - interval '20 days');

-- Notes + addresses for a few owner leads
INSERT INTO lead_notes (lead_id, body, created_at)
SELECT id, 'Referred by David Nguyen — they golf together. Property currently self-managed, frustrated with turnover cleanings.', now() - interval '1 day'
FROM leads WHERE email = 'amanda.foster@example.com';

INSERT INTO lead_notes (lead_id, body, created_at)
SELECT id, 'Bought the WaterSound house in March. Asked specifically about net revenue after fees.', now() - interval '3 days'
FROM leads WHERE email = 'jen.walsh@example.com';

INSERT INTO lead_addresses (lead_id, label, street, city, state, zip, is_primary, notes)
SELECT id, 'Rental Property', '128 Rosemary Ave', 'Rosemary Beach', 'FL', '32461', true, '6BR, Gulf-front, private pool'
FROM leads WHERE email = 'amanda.foster@example.com';

INSERT INTO lead_addresses (lead_id, label, street, city, state, zip, is_primary, notes)
SELECT id, 'Rental Property', '45 Origins Pkwy', 'Watersound', 'FL', '32461', true, '5BR, community pool access'
FROM leads WHERE email = 'jen.walsh@example.com';

-- Stage-change history for the proposal lead
INSERT INTO lead_activities (lead_id, type, body, metadata, created_at)
SELECT id, 'status_change', 'Moved from Nurturing → Proposal', '{"from_status":"nurturing","to_status":"proposal"}', now() - interval '2 days'
FROM leads WHERE email = 'amanda.foster@example.com';

-- Todos
INSERT INTO todos (title, description, type, linked_lead_id) VALUES
('Send Amanda the revenue projection PDF', 'She asked for numbers on the Rosemary estate before signing', 'manual', (SELECT id FROM leads WHERE email = 'amanda.foster@example.com')),
('Call Lisa Chen — check on Alys Beach decision', NULL, 'follow_up_task', (SELECT id FROM leads WHERE email = 'lisa.chen@example.com')),
('Post July availability to the owner newsletter', NULL, 'manual', NULL);
