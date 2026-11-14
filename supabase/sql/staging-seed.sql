-- STAGING ONLY. Seeds a separate staging Supabase project (never the shared production project) so testers can
-- sign in with their own Discord accounts as fictional members of each rank and walk the Daily Patrol Evaluation.
--
-- 1. Replace each REPLACE_WITH_DISCORD_ID with a tester's Discord user ID (Discord: Developer Mode, right-click the
--    user, Copy User ID). Do this in the SQL editor only: never commit real Discord IDs (the repository is public).
--    One person can test several roles: run the "switch rank" statement at the bottom between rounds.
-- 2. Run the whole file. It refuses to run if a real roster import has ever been applied in this project.
do $$
begin
  if exists (select 1 from tpd.roster_sync_runs where status in ('applied', 'no_changes')) then
    raise exception 'This project has a real roster import. Staging seed refused.';
  end if;
  if exists (select 1 from tpd.personnel where discord_id !~ '^[0-9]{17,20}$') then
    raise exception 'Unexpected personnel rows. Staging seed refused.';
  end if;
end $$;

insert into tpd.personnel (discord_id, name, callsign, rank, tier, district, status) values
  ('REPLACE_WITH_DISCORD_ID_SERGEANT',   'Staging Sergeant',   'X-490', 'Sergeant',        'Field Supervisory',    'North', 'active'),
  ('REPLACE_WITH_DISCORD_ID_LIEUTENANT', 'Staging Lieutenant', 'X-390', 'Lieutenant',      'Field Supervisory',    'South', 'active'),
  ('REPLACE_WITH_DISCORD_ID_CAPTAIN',    'Staging Captain',    'X-290', 'Captain',         'Command Staff',        null,    'active'),
  ('REPLACE_WITH_DISCORD_ID_CHIEF',      'Staging Chief',      'X-190', 'Chief of Police', 'Office of the Chiefs', null,    'active')
on conflict (discord_id) do nothing;

-- Fictional officers to evaluate (Discord IDs that cannot sign in).
insert into tpd.personnel (discord_id, name, callsign, rank, tier, district, status) values
  ('100000000000000901', 'Staging Officer A', 'X-591', 'Officer',        'Patrol Bureau', 'North', 'active'),
  ('100000000000000902', 'Staging Officer B', 'X-592', 'Senior Officer', 'Patrol Bureau', 'South', 'active'),
  ('100000000000000903', 'Staging Corporal',  'X-593', 'Corporal',       'Patrol Bureau', 'North', 'active')
on conflict (discord_id) do nothing;

-- Switch rank between rounds (one tester covering several roles):
-- update tpd.personnel set rank = 'Captain', tier = 'Command Staff' where name = 'Staging Sergeant';
