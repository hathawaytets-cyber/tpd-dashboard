-- Internal Affairs: access isolation, intake, escalation and the SOP workflow.
-- Run by supabase/tests/run-local.sh on a fresh copy of the migrated database. Fake Discord IDs only.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- People. Letters double as auth user ids (…0a etc.) and Discord IDs (2000000000000000NN).
--  a Chief (X-101)  b Deputy Chief (X-102)  c Major Admin Ops (X-201)  d IA Director  e IA Deputy Director
--  f investigator   g investigator          h officer (accused)        i Captain, not IA  j Sergeant  k officer (complainant)
insert into auth.users select ('00000000-0000-0000-0000-0000000000' || x)::uuid from unnest(array['0a','0b','0c','0d','0e','0f','10','11','12','13','14','15']) x;
insert into auth.identities (user_id, provider, provider_id)
select ('00000000-0000-0000-0000-0000000000' || x)::uuid, 'discord', '2000000000000000' || lpad(n::text, 2, '0')
from unnest(array['0a','0b','0c','0d','0e','0f','10','11','12','13','14']) with ordinality as t(x, n);
-- 15 = a signed-in account without any roster record

insert into tpd.roster_sync_runs (trigger, status, finished_at) values ('manual', 'applied', now());
set role service_role;
select tpd.apply_roster_snapshot($j${
  "members": [
    {"discordId": "200000000000000001", "name": "A. Chief", "callsign": "X-101", "rank": "Chief of Police", "tier": "Office of the Chiefs"},
    {"discordId": "200000000000000002", "name": "B. Deputy", "callsign": "X-102", "rank": "Deputy Chief", "tier": "Office of the Chiefs"},
    {"discordId": "200000000000000003", "name": "C. Major", "callsign": "X-201", "rank": "Major", "tier": "Command Staff"},
    {"discordId": "200000000000000004", "name": "D. Director", "callsign": "X-303", "rank": "Captain", "tier": "Division Command"},
    {"discordId": "200000000000000005", "name": "E. Deputy Director", "callsign": "X-304", "rank": "Lieutenant", "tier": "Division Command"},
    {"discordId": "200000000000000006", "name": "F. Investigator", "callsign": "X-420", "rank": "Officer", "tier": "Patrol Bureau", "district": "North"},
    {"discordId": "200000000000000007", "name": "G. Investigator", "callsign": "X-421", "rank": "Officer", "tier": "Patrol Bureau", "district": "South"},
    {"discordId": "200000000000000008", "name": "H. Officer", "callsign": "X-422", "rank": "Officer", "tier": "Patrol Bureau", "district": "North"},
    {"discordId": "200000000000000009", "name": "I. Captain", "callsign": "X-204", "rank": "Captain", "tier": "Command Staff", "district": "North"},
    {"discordId": "200000000000000010", "name": "J. Sergeant", "callsign": "X-350", "rank": "Sergeant", "tier": "Field Supervisory", "district": "North"},
    {"discordId": "200000000000000011", "name": "K. Officer", "callsign": "X-423", "rank": "Officer", "tier": "Patrol Bureau", "district": "South"}
  ],
  "positions": [
    {"ord": 1, "callsign": "X-101", "rank": "Chief of Police", "appointment": "Overall Operations", "tier": "Office of the Chiefs", "discordId": "200000000000000001"},
    {"ord": 2, "callsign": "X-102", "rank": "Deputy Chief", "appointment": "Administrative Operations", "tier": "Office of the Chiefs", "discordId": "200000000000000002"},
    {"ord": 3, "callsign": "X-201", "rank": "Major", "appointment": "Administrative Operations (IA | OPA)", "tier": "Command Staff", "discordId": "200000000000000003"},
    {"ord": 4, "callsign": "X-204", "rank": "Captain", "appointment": "Patrol Operations (North District)", "tier": "Command Staff", "discordId": "200000000000000009"}
  ]
}$j$::jsonb, gen_random_uuid());
reset role;

-- Test-only read views (owned by the superuser) so assertions can inspect state while running as a member.
-- They exist only in this throwaway database; members never get table grants.
create schema tt;
grant usage on schema tt to public;
create view tt.ia_cases as select * from tpd.ia_cases;
create view tt.ia_allegations as select * from tpd.ia_allegations;
create view tt.ia_tasks as select * from tpd.ia_tasks;
create view tt.ia_appointments as select * from tpd.ia_appointments;
grant select on all tables in schema tt to public;

create temp table ids (k text primary key, v uuid);
grant all on ids to public;
insert into ids select 'p' || chr(96 + n::int), p.id from tpd.personnel p, generate_series(1, 11) n where p.discord_id = '2000000000000000' || lpad(n::text, 2, '0');
create function pg_temp.id(k text) returns uuid language sql as $$ select v from ids where ids.k = $1 $$;
create function pg_temp.as_user(letter text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', case when letter is null then '' else '00000000-0000-0000-0000-0000000000' ||
    case letter when 'a' then '0a' when 'b' then '0b' when 'c' then '0c' when 'd' then '0d' when 'e' then '0e' when 'f' then '0f'
      when 'g' then '10' when 'h' then '11' when 'i' then '12' when 'j' then '13' when 'k' then '14' when 'z' then '15' end end, false);
end $$;
-- Runs q and reports whether it failed (optionally with a message matching pattern).
create function pg_temp.fails(q text, pattern text default null) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  if pattern is not null and sqlerrm not ilike pattern then raise warning 'unexpected error for [%]: %', q, sqlerrm; return false; end if;
  return true;
end $$;
create function pg_temp.key(n int) returns text language sql as $$ select encode(sha256(('client' || n)::bytea), 'hex') $$;
create function pg_temp.tok(t text) returns bytea language sql as $$ select sha256(t::bytea) $$;

-- 1. Appointments: only the Deputy Chief, no self-appointment, one holder per call sign.
set role authenticated;
select pg_temp.as_user('a');
do $$ begin assert pg_temp.fails(format('select tpd.ia_appoint(%L, %L, %L)', pg_temp.id('pd'), 'IA-01', 'Chief tries to appoint'), '%Deputy Chief%'), 'chief cannot appoint (IA §12)'; end $$;
select pg_temp.as_user('i');
do $$ begin assert pg_temp.fails(format('select tpd.ia_appoint(%L, %L, %L)', pg_temp.id('pd'), 'IA-01', 'Captain tries to appoint'), '%Deputy Chief%'), 'captain cannot appoint'; end $$;
select pg_temp.as_user('b');
do $$ begin
  assert pg_temp.fails(format('select tpd.ia_appoint(%L, %L, %L)', pg_temp.id('pb'), 'IA-01', 'Appointing myself here'), '%Self-appointment%'), 'no self-appointment';
  perform tpd.ia_appoint(pg_temp.id('pd'), 'IA-01', 'Director of IA Operations');
  perform tpd.ia_appoint(pg_temp.id('pe'), 'IA-02', 'Deputy Director of IA Operations');
  perform tpd.ia_appoint(pg_temp.id('pf'), 'IA-03', 'Internal Affairs Investigator');
  perform tpd.ia_appoint(pg_temp.id('pg'), 'IA-04', 'Internal Affairs Investigator');
  assert pg_temp.fails(format('select tpd.ia_appoint(%L, %L, %L)', pg_temp.id('ph'), 'IA-03', 'Second holder of IA-03'), '%already filled%'), 'one holder per call sign';
  assert pg_temp.fails(format('select tpd.ia_appoint(%L, %L, %L)', pg_temp.id('ph'), 'IA-09', 'Not an IA call sign'), '%IA-01 to IA-06%'), 'valid IA call signs only';
end $$;
reset role;

-- 2. Anonymous visitors: no table, no intake function, no dashboard.
set role anon;
do $$ begin
  assert pg_temp.fails('select count(*) from tpd.ia_cases', '%permission denied%'), 'anon reads cases';
  assert pg_temp.fails('select count(*) from tpd.ia_receipts', '%permission denied%'), 'anon reads receipts';
  assert pg_temp.fails($q$select tpd.ia_intake_submit('{}'::jsonb, repeat('a', 64), null, sha256('x'::bytea))$q$, '%permission denied%'), 'anon calls intake directly';
  assert pg_temp.fails($q$select tpd.ia_receipt_status('TPD-AAAA-AAAA', sha256('x'::bytea), repeat('a', 64))$q$, '%permission denied%'), 'anon calls receipt lookup directly';
  assert pg_temp.fails('select tpd.ia_dashboard()', '%permission denied%'), 'anon dashboard';
end $$;
reset role;

-- 3. Public intake (the Edge Function runs as the service role).
set role service_role;
do $$ declare r jsonb; c tpd.ia_cases; begin
  r := tpd.ia_intake_submit(jsonb_build_object('category', 'public_conduct', 'summary', 'Rude during a traffic stop',
        'description', 'The officer swore at me repeatedly during a traffic stop near the pier.', 'officer', 'X-422 maybe',
        'incidentDate', current_date::text, 'location', 'Pier, South District', 'anonymous', true, 'name', 'Should be dropped',
        'evidenceLinks', jsonb_build_array('https://example.test/clip')), pg_temp.key(1), null, pg_temp.tok('public-1'));
  assert r ->> 'reference' ~ '^TPD-[0-9A-Z]{4}-[0-9A-Z]{4}$', 'reference format';
  insert into ids values ('public1', (r ->> 'case_id')::uuid);
  select * into c from tpd.ia_cases where id = (r ->> 'case_id')::uuid;
  assert c.status = 'intake' and c.source = 'public' and c.accused_id is null and c.handler = 'ia', 'public case logged for intake review';
  assert c.case_number ~ '^IA-\d{4}-\d{4}$', 'internal case number';
  assert (select anonymous and name is null and contact is null from tpd.ia_complainants where case_id = c.id), 'anonymous complaint keeps no identity';
  assert (select count(*) from tpd.ia_tasks where case_id = c.id and kind = 'bodycam_preservation' and due_at <= now() + interval '24 hours') = 1, 'same-day bodycam preservation task';
  assert (select count(*) from tpd.ia_notifications where case_id = c.id and recipient_id in (pg_temp.id('pd'), pg_temp.id('pe'))) = 2, 'intake alert to Director and Deputy Director';
  assert (select count(*) from tpd.ia_notifications where case_id = c.id and recipient_id not in (pg_temp.id('pd'), pg_temp.id('pe'))) = 0, 'nobody else alerted';
  assert not exists (select 1 from tpd.audit_log where detail::text like '%' || c.id || '%' or target = c.id::text), 'nothing about the case in the command-visible audit log';
  -- A public payload cannot link a personnel record, use a bad link, or skip validation.
  assert pg_temp.fails(format($q$select tpd.ia_intake_submit(%L::jsonb, %L, null, sha256('t'::bytea))$q$,
    jsonb_build_object('category', 'other', 'summary', 'Linked officer', 'description', 'Trying to pass a personnel id from a public form.', 'officerId', pg_temp.id('ph')), pg_temp.key(2)), '%invalid officer%'), 'public officerId refused';
  assert pg_temp.fails(format($q$select tpd.ia_intake_submit(%L::jsonb, %L, null, sha256('t'::bytea))$q$,
    jsonb_build_object('category', 'other', 'summary', 'Bad link', 'description', 'Evidence link uses javascript scheme here.', 'evidenceLinks', jsonb_build_array('javascript:alert(1)')), pg_temp.key(2)), '%invalid link%'), 'non-https link refused';
  assert pg_temp.fails(format($q$select tpd.ia_intake_submit(%L::jsonb, %L, null, sha256('t'::bytea))$q$,
    jsonb_build_object('category', 'made_up', 'summary', 'Bad category', 'description', 'Category is not one of the IA scope items.'), pg_temp.key(2)), '%invalid category%'), 'category validated';
  -- Rate limit: 3 per client per hour.
  perform tpd.ia_intake_submit(jsonb_build_object('category', 'other', 'summary', 'Spam one', 'description', 'Repeated submission from one client number one.'), pg_temp.key(3), null, pg_temp.tok('s1'));
  perform tpd.ia_intake_submit(jsonb_build_object('category', 'other', 'summary', 'Spam two', 'description', 'Repeated submission from one client number two.'), pg_temp.key(3), null, pg_temp.tok('s2'));
  perform tpd.ia_intake_submit(jsonb_build_object('category', 'other', 'summary', 'Spam three', 'description', 'Repeated submission from one client number three.'), pg_temp.key(3), null, pg_temp.tok('s3'));
  assert pg_temp.fails(format($q$select tpd.ia_intake_submit(%L::jsonb, %L, null, sha256('t'::bytea))$q$,
    jsonb_build_object('category', 'other', 'summary', 'Spam four', 'description', 'Repeated submission from one client number four.'), pg_temp.key(3)), 'rate_limited'), 'fourth submission in an hour is refused';
end $$;
reset role;

-- 4. Member intake: identity and officer come from verified records, never from the payload.
set role service_role;
do $$ declare r jsonb; begin
  r := tpd.ia_intake_submit(jsonb_build_object('category', 'abuse_of_authority', 'summary', 'Threatened a civilian',
        'description', 'During a call on 5th street the officer threatened to arrest a civilian without cause.', 'officerId', pg_temp.id('ph'),
        'name', 'Pretend name', 'contact', 'discord dm'), pg_temp.key(10), '00000000-0000-0000-0000-000000000014', pg_temp.tok('member-1'));
  insert into ids values ('case1', (r ->> 'case_id')::uuid);
  assert (select source = 'member' and accused_id = pg_temp.id('ph') and handler = 'ia' from tpd.ia_cases where id = pg_temp.id('case1')), 'member complaint with verified officer';
  assert (select member_id = pg_temp.id('pk') from tpd.ia_complainants where case_id = pg_temp.id('case1')), 'complainant identity from the session';
  -- Sergeant referral (IA §3) vs. an officer asking for one.
  r := tpd.ia_intake_submit(jsonb_build_object('category', 'handbook_policy', 'summary', 'Repeated late reports', 'referral', true,
        'description', 'Supervisor referral after repeated late reports despite coaching on three occasions.', 'officerId', pg_temp.id('ph')), pg_temp.key(11), '00000000-0000-0000-0000-000000000013', pg_temp.tok('ref-1'));
  assert (select source from tpd.ia_cases where id = (r ->> 'case_id')::uuid) = 'supervisor_referral', 'sergeant referral';
  r := tpd.ia_intake_submit(jsonb_build_object('category', 'other', 'summary', 'Not a supervisor', 'referral', true,
        'description', 'An officer marks this as a referral but is not a supervisor.'), pg_temp.key(12), '00000000-0000-0000-0000-000000000014', pg_temp.tok('ref-2'));
  assert (select source from tpd.ia_cases where id = (r ->> 'case_id')::uuid) = 'member', 'referral flag ignored below Sergeant';
  -- Unknown officer id and naming yourself are refused.
  assert pg_temp.fails(format($q$select tpd.ia_intake_submit(%L::jsonb, %L, '00000000-0000-0000-0000-000000000014', sha256('t'::bytea))$q$,
    jsonb_build_object('category', 'other', 'summary', 'Self complaint', 'description', 'Complaining about myself should not work.', 'officerId', pg_temp.id('pk')), pg_temp.key(13)), '%invalid officer%'), 'cannot name yourself';
  assert pg_temp.fails(format($q$select tpd.ia_intake_submit(%L::jsonb, %L, '00000000-0000-0000-0000-000000000014', sha256('t'::bytea))$q$,
    jsonb_build_object('category', 'other', 'summary', 'Ghost officer', 'description', 'This officer id does not exist on the roster.', 'officerId', gen_random_uuid()), pg_temp.key(13)), '%invalid officer%'), 'unknown officer refused';
  -- Escalation targets (IA §5).
  r := tpd.ia_intake_submit(jsonb_build_object('category', 'dishonesty', 'summary', 'Investigator lied', 'description', 'Complaint naming an IA investigator directly.', 'officerId', pg_temp.id('pf')), pg_temp.key(14), '00000000-0000-0000-0000-000000000014', pg_temp.tok('esc-ia'));
  insert into ids values ('case_ia', (r ->> 'case_id')::uuid);
  r := tpd.ia_intake_submit(jsonb_build_object('category', 'dishonesty', 'summary', 'Director lied', 'description', 'Complaint naming the IA Director directly.', 'officerId', pg_temp.id('pd')), pg_temp.key(15), '00000000-0000-0000-0000-000000000014', pg_temp.tok('esc-dir'));
  insert into ids values ('case_dir', (r ->> 'case_id')::uuid);
  r := tpd.ia_intake_submit(jsonb_build_object('category', 'abuse_of_authority', 'summary', 'Deputy Chief abuse', 'description', 'Complaint naming the Deputy Chief directly.', 'officerId', pg_temp.id('pb')), pg_temp.key(16), '00000000-0000-0000-0000-000000000014', pg_temp.tok('esc-dc'));
  insert into ids values ('case_dc', (r ->> 'case_id')::uuid);
  r := tpd.ia_intake_submit(jsonb_build_object('category', 'abuse_of_authority', 'summary', 'Chief abuse', 'description', 'Complaint naming the Chief of Police directly.', 'officerId', pg_temp.id('pa')), pg_temp.key(17), '00000000-0000-0000-0000-000000000014', pg_temp.tok('esc-chief'));
  insert into ids values ('case_chief', (r ->> 'case_id')::uuid);
  assert (select handler from tpd.ia_cases where id = pg_temp.id('case_ia')) = 'ia_director', 'IA member → Director';
  assert (select handler from tpd.ia_cases where id = pg_temp.id('case_dir')) = 'deputy_chief', 'Director → Deputy Chief';
  assert (select handler from tpd.ia_cases where id = pg_temp.id('case_dc')) = 'chief', 'Deputy Chief → Chief';
  assert (select handler from tpd.ia_cases where id = pg_temp.id('case_chief')) = 'external', 'Chief → outside authority';
  assert not exists (select 1 from tpd.ia_notifications where case_id = pg_temp.id('case_dir') and recipient_id = pg_temp.id('pd')), 'accused Director not alerted';
  assert exists (select 1 from tpd.ia_notifications where case_id = pg_temp.id('case_dir') and recipient_id = pg_temp.id('pb')), 'Deputy Chief alerted for a Director complaint';
end $$;
reset role;

-- 5. Access isolation (IA §11, §5).
create function pg_temp.sees(letter text, case_key text) returns boolean language plpgsql as $$
begin perform pg_temp.as_user(letter); return tpd.ia_can_view(pg_temp.id(case_key)); end $$;
-- ia_can_view is internal (no grant to authenticated); evaluated here as the owner with each user's session.
do $$ begin
  assert pg_temp.fails('set local role authenticated; select tpd.ia_can_view(gen_random_uuid())', '%permission denied%'), 'case existence cannot be probed';
  -- Ordinary case: IA and oversight only; never rank alone, never the accused or the complainant.
  assert pg_temp.sees('d', 'case1') and pg_temp.sees('e', 'case1') and pg_temp.sees('f', 'case1') and pg_temp.sees('g', 'case1'), 'IA members see ordinary cases';
  assert pg_temp.sees('a', 'case1') and pg_temp.sees('b', 'case1') and pg_temp.sees('c', 'case1'), 'Chief, Deputy Chief and Major see ordinary cases';
  assert not pg_temp.sees('i', 'case1'), 'a Captain without an IA role sees nothing';
  assert not pg_temp.sees('j', 'case1'), 'a Sergeant sees nothing';
  assert not pg_temp.sees('h', 'case1'), 'the accused never sees the file';
  assert not pg_temp.sees('k', 'case1'), 'a member complainant never sees the file';
  -- Escalated cases narrow the audience.
  assert pg_temp.sees('d', 'case_ia') and not pg_temp.sees('e', 'case_ia') and not pg_temp.sees('g', 'case_ia') and not pg_temp.sees('f', 'case_ia'), 'IA-member complaint: Director only within IA';
  assert pg_temp.sees('c', 'case_ia') and pg_temp.sees('b', 'case_ia'), 'IA-member complaint: oversight sees it';
  assert not pg_temp.sees('d', 'case_dir') and not pg_temp.sees('e', 'case_dir') and not pg_temp.sees('c', 'case_dir'), 'Director complaint hidden from IA and the Major';
  assert pg_temp.sees('b', 'case_dir') and pg_temp.sees('a', 'case_dir'), 'Director complaint: Deputy Chief and Chief';
  assert not pg_temp.sees('b', 'case_dc') and pg_temp.sees('a', 'case_dc') and not pg_temp.sees('d', 'case_dc'), 'Deputy Chief complaint: Chief only';
  assert not pg_temp.sees('a', 'case_chief') and pg_temp.sees('b', 'case_chief'), 'Chief complaint: referral recorded by the Deputy Chief only';
end $$;
create temp table expect as select count(*)::int as ordinary from tpd.ia_cases where handler = 'ia';
grant select on expect to public;
set role authenticated;
-- Non-IA users: no direct table access, no dashboard, no case detail.
select pg_temp.as_user('i');
do $$ begin
  assert pg_temp.fails('select count(*) from tpd.ia_cases', '%permission denied%'), 'authenticated reads ia_cases directly';
  assert pg_temp.fails('select count(*) from tpd.ia_audit_events', '%permission denied%'), 'authenticated reads ia audit';
  assert pg_temp.fails('select count(*) from tpd.ia_evidence', '%permission denied%'), 'authenticated reads evidence';
  assert pg_temp.fails('select tpd.ia_dashboard()', '%Internal Affairs access required%'), 'captain dashboard';
  assert pg_temp.fails(format('select tpd.ia_case_detail(%L)', pg_temp.id('case1')), '%Case unavailable%'), 'captain case detail';
  assert not (tpd.ia_my_access() ->> 'has_access')::boolean, 'captain has no IA access';
  assert pg_temp.fails($q$select tpd.ia_intake_submit('{}'::jsonb, repeat('a', 64), null, sha256('x'::bytea))$q$, '%permission denied%'), 'members cannot bypass the intake function';
end $$;
select pg_temp.as_user('z');
do $$ begin assert pg_temp.fails('select tpd.ia_dashboard()', '%Internal Affairs access required%'), 'unrostered account'; end $$;
select pg_temp.as_user('g');
do $$ begin
  assert jsonb_array_length(tpd.ia_dashboard()) = (select ordinary from expect), 'investigator dashboard lists only ordinary cases';
  assert pg_temp.fails(format('select tpd.ia_case_detail(%L)', pg_temp.id('case_dir')), '%Case unavailable%'), 'investigator cannot open the Director case';
end $$;
reset role;

-- 6. Workflow on case1 (complaint by K against H).
set role authenticated;
select pg_temp.as_user('g');
do $$ begin assert pg_temp.fails(format('select tpd.ia_accept_intake(%L, null, %L)', pg_temp.id('case1'), 'Investigator tries intake'), '%case lead%'), 'investigators do not run intake'; end $$;
select pg_temp.as_user('d');
do $$ begin
  assert tpd.ia_accept_intake(pg_temp.id('case1'), null, 'Within IA scope; accused verified.') = 'ia';
  assert pg_temp.fails(format('select tpd.ia_assign(%L, %L, %L)', pg_temp.id('case1'), pg_temp.id('ph'), 'Checked relationships'), '%appointed IA member%'), 'cannot assign a non-IA member';
  assert pg_temp.fails(format('select tpd.ia_assign(%L, %L, %L)', pg_temp.id('case1'), pg_temp.id('pf'), 'short'), '%conflict-of-interest%'), 'conflict check required';
  perform tpd.ia_assign(pg_temp.id('case1'), pg_temp.id('pf'), 'No supervisory or personal relationship with H.');
  assert (select status = 'investigating' and due_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute' from tt.ia_cases where id = pg_temp.id('case1')), '7-day target from assignment (IA §6)';
end $$;
-- F has a conflict, tells the Director, the case returns to the queue and F cannot be reassigned or read it.
select pg_temp.as_user('f');
do $$ begin perform tpd.ia_declare_conflict(pg_temp.id('case1'), 'H is my field training partner.'); end $$;
do $$ begin assert pg_temp.fails(format('select tpd.ia_case_detail(%L)', pg_temp.id('case1')), '%Case unavailable%'), 'conflicted investigator loses access'; end $$;
select pg_temp.as_user('d');
do $$ begin
  assert (select status from tt.ia_cases where id = pg_temp.id('case1')) = 'unassigned', 'conflict returns the case for reassignment';
  assert pg_temp.fails(format('select tpd.ia_assign(%L, %L, %L)', pg_temp.id('case1'), pg_temp.id('pf'), 'Trying F again anyway'), '%declared a conflict%'), 'conflicted investigator cannot be reassigned';
  perform tpd.ia_assign(pg_temp.id('case1'), pg_temp.id('pg'), 'G has no relationship with H or K.');
end $$;
select pg_temp.as_user('g');
do $$ declare a1 uuid; a2 uuid; begin
  assert pg_temp.fails(format($q$select tpd.ia_record_interview(%L, 'accused', 'H. Officer', now(), now() - interval '1 minute', null, %L)$q$, pg_temp.id('case1'), 'Interview summary long enough to pass.'), '%notice to the member%'), 'notice before accused interview';
  assert pg_temp.fails(format('select tpd.ia_record_notice(%L, true, %L)', pg_temp.id('case1'), 'short'), '%compromise evidence%'), 'delay needs a reason';
  perform tpd.ia_record_notice(pg_temp.id('case1'), false, 'Written notice sent by department mail with the allegation.');
  perform tpd.ia_record_interview(pg_temp.id('case1'), 'complainant', 'K. Officer', now() - interval '2 hours', null, null, 'Complainant described the threat and named two witnesses.');
  perform tpd.ia_record_interview(pg_temp.id('case1'), 'witness', 'Witness One', now() - interval '1 hour', null, null, 'Witness confirmed the officer raised his voice and threatened arrest.');
  assert pg_temp.fails(format($q$select tpd.ia_record_interview(%L, 'accused', 'H. Officer', now(), null, null, %L)$q$, pg_temp.id('case1'), 'Interview summary long enough to pass.'), '%Garrity%'), 'Garrity required (IA §7)';
  assert pg_temp.fails(format($q$select tpd.ia_record_interview(%L, 'accused', 'H. Officer', now() - interval '10 minutes', now(), null, %L)$q$, pg_temp.id('case1'), 'Interview summary long enough to pass.'), '%Garrity%'), 'Garrity must come before the interview';
  -- A possible crime stops administrative interviews until the Deputy Chief decides.
  perform tpd.ia_criminal_referral(pg_temp.id('case1'), 'Statement suggests possible unlawful detention; referring.');
  assert pg_temp.fails(format($q$select tpd.ia_record_interview(%L, 'accused', 'H. Officer', now(), now() - interval '1 minute', null, %L)$q$, pg_temp.id('case1'), 'Interview summary long enough to pass.'), '%criminal referral%'), 'interviews stop on referral';
  assert pg_temp.fails(format('select tpd.ia_criminal_decision(%L, false, %L)', pg_temp.id('case1'), 'Investigator decides alone'), '%Deputy Chief%'), 'investigator cannot decide the referral';
end $$;
select pg_temp.as_user('b');
do $$ begin perform tpd.ia_criminal_decision(pg_temp.id('case1'), false, 'No criminal investigation; administrative case continues.'); end $$;
select pg_temp.as_user('g');
do $$ declare a1 uuid; a2 uuid; begin
  perform tpd.ia_record_interview(pg_temp.id('case1'), 'accused', 'H. Officer', now() - interval '5 minutes', now() - interval '6 minutes', 'Sgt. Observer', 'Member admitted raising his voice and denied threatening arrest.');
  a2 := tpd.ia_add_allegation(pg_temp.id('case1'), 'public_conduct', 'Discourteous language toward the complainant.');
  select id into a1 from tt.ia_allegations where case_id = pg_temp.id('case1') and ord = 1;
  insert into ids values ('a1', a1), ('a2', a2);
  assert pg_temp.fails(format('select tpd.ia_submit_report(%L, %L, null)', pg_temp.id('case1'), repeat('Report body. ', 12)), '%own finding%'), 'every allegation needs a finding';
  assert pg_temp.fails(format($q$select tpd.ia_record_finding(%L, 'guilty', %L, null)$q$, a1, 'The evidence shows the threat was made.'), '%four findings%'), 'only the four SOP findings';
  assert pg_temp.fails(format($q$select tpd.ia_record_finding(%L, 'unfounded', %L, 'Strike')$q$, a2, 'The evidence shows it did not happen.'), '%sustained finding%'), 'no discipline on non-sustained findings';
  perform tpd.ia_record_finding(a1, 'sustained', 'Two witnesses and the bodycam confirm the threat.', 'Strike');
  perform tpd.ia_record_finding(a2, 'unfounded', 'Bodycam shows no discourteous language was used.', null);
  assert pg_temp.fails(format('select tpd.ia_submit_report(%L, %L, null)', pg_temp.id('case1'), repeat('Report body. ', 12)), '%evidence-preservation%'), 'preservation tasks must be closed first';
  perform tpd.ia_complete_task(t.id, 'Footage saved to the case evidence locker.') from tt.ia_tasks t where t.case_id = pg_temp.id('case1');
  perform tpd.ia_submit_report(pg_temp.id('case1'), repeat('Report body describing allegations, evidence and witness statements. ', 3), null);
  assert (select status from tt.ia_cases where id = pg_temp.id('case1')) = 'director_review', 'report goes to Director review';
  assert pg_temp.fails(format($q$select tpd.ia_record_finding(%L, 'not_sustained', %L, null)$q$, a1, 'Changing my mind after submitting.'), '%during the investigation%'), 'findings locked after submission';
  assert pg_temp.fails(format('select tpd.ia_director_review(%L, true, %L)', pg_temp.id('case1'), 'Reviewing my own report'), '%Director or Deputy Director%'), 'investigator cannot review';
end $$;
-- Even the service role cannot change a submitted finding.
reset role;
do $$ begin assert pg_temp.fails(format($q$update tpd.ia_allegations set finding = 'exonerated' where id = %L$q$, pg_temp.id('a1')), '%locked%'), 'trigger locks findings'; end $$;
set role authenticated;
select pg_temp.as_user('e');
do $$ begin perform tpd.ia_director_review(pg_temp.id('case1'), false, 'Add the dispatch log reference before approval.'); end $$;
select pg_temp.as_user('g');
do $$ begin
  assert (select status from tt.ia_cases where id = pg_temp.id('case1')) = 'investigating', 'returned for more work';
  perform tpd.ia_add_evidence(pg_temp.id('case1'), 'anchorcad_record', 'Dispatch log for the 5th street call', 'Incident #4471');
  perform tpd.ia_submit_report(pg_temp.id('case1'), repeat('Revised report with the dispatch log reference added to the evidence. ', 3), null);
end $$;
select pg_temp.as_user('c');
do $$ begin assert pg_temp.fails(format('select tpd.ia_director_review(%L, true, %L)', pg_temp.id('case1'), 'Major tries to review'), '%Director or Deputy Director%'), 'oversight does not replace the IA review'; end $$;
select pg_temp.as_user('d');
do $$ begin perform tpd.ia_director_review(pg_temp.id('case1'), true, 'Findings supported; forwarding to the Deputy Chief.'); end $$;
-- Only the Deputy Chief decides (IA §9).
select pg_temp.as_user('d');
do $$ begin assert pg_temp.fails(format('select tpd.ia_decide(%L, %L::jsonb, %L)', pg_temp.id('case1'), jsonb_build_object(pg_temp.id('a1'), 'Strike'), 'IA imposing discipline'), '%Deputy Chief%'), 'IA cannot impose discipline'; end $$;
select pg_temp.as_user('c');
do $$ begin assert pg_temp.fails(format('select tpd.ia_decide(%L, %L::jsonb, %L)', pg_temp.id('case1'), jsonb_build_object(pg_temp.id('a1'), 'Strike'), 'Major deciding'), '%Deputy Chief%'), 'the Major cannot decide'; end $$;
select pg_temp.as_user('a');
do $$ begin assert pg_temp.fails(format('select tpd.ia_decide(%L, %L::jsonb, %L)', pg_temp.id('case1'), jsonb_build_object(pg_temp.id('a1'), 'Strike'), 'Chief deciding instead'), '%Deputy Chief%'), 'the Chief does not take the Deputy Chief decision'; end $$;
select pg_temp.as_user('b');
do $$ begin
  assert pg_temp.fails(format('select tpd.ia_decide(%L, %L::jsonb, %L)', pg_temp.id('case1'), jsonb_build_object(pg_temp.id('a2'), 'Strike'), 'Discipline on unfounded'), '%only to sustained%'), 'no discipline for unfounded (IA §9)';
  assert pg_temp.fails(format('select tpd.ia_decide(%L, %L::jsonb, %L)', pg_temp.id('case1'), '{}', 'Missing an outcome'), '%every sustained%'), 'each sustained allegation needs an outcome';
  assert tpd.ia_decide(pg_temp.id('case1'), jsonb_build_object(pg_temp.id('a1'), 'Termination'), 'Threat of unlawful arrest; second offense.') = 'chief_review', 'termination waits for the Chief';
end $$;
select pg_temp.as_user('a');
do $$ begin
  assert tpd.ia_chief_termination(pg_temp.id('case1'), false, 'Not a termination; Deputy Chief to reconsider.') = 'deputy_chief_review';
end $$;
select pg_temp.as_user('b');
do $$ begin assert tpd.ia_decide(pg_temp.id('case1'), jsonb_build_object(pg_temp.id('a1'), 'Blackmark'), 'Reconsidered: Blackmark.') = 'closed'; end $$;
reset role;
do $$ begin
  assert (select count(*) from tpd.ia_decisions where case_id = pg_temp.id('case1')) = 2, 'both decisions kept';
  assert (select count(*) from tpd.ia_decisions where case_id = pg_temp.id('case1') and superseded_at is not null) = 1, 'declined termination superseded, not deleted';
  assert (select count(*) from tpd.ia_tasks where case_id = pg_temp.id('case1') and kind = 'roster_record_update' and completed_at is null) = 1, 'one pending roster task for the sustained allegation only';
  assert (select detail like '%Blackmark%' from tpd.ia_tasks where case_id = pg_temp.id('case1') and kind = 'roster_record_update'), 'task names the decided discipline';
  assert not exists (select 1 from tpd.personnel where id = pg_temp.id('ph') and status <> 'active'), 'nothing changes the member automatically';
  -- Closed records and decisions are immutable, even for the service role.
  assert pg_temp.fails(format($q$update tpd.ia_cases set status = 'investigating' where id = %L$q$, pg_temp.id('case1')), '%read-only%'), 'closed case cannot reopen';
  assert pg_temp.fails(format($q$update tpd.ia_decisions set rationale = 'edited' where case_id = %L$q$, pg_temp.id('case1')), '%final%'), 'decisions are final';
  assert pg_temp.fails(format($q$delete from tpd.ia_cases where id = %L$q$, pg_temp.id('case1')), '%append-only%'), 'cases are never deleted (IA §11)';
  assert pg_temp.fails('update tpd.ia_audit_events set action = ''x''', '%append-only%'), 'audit is append-only';
  assert pg_temp.fails('delete from tpd.ia_audit_events', '%append-only%'), 'audit cannot be deleted';
  assert (select count(*) from tpd.ia_audit_events where case_id = pg_temp.id('case1') and action = 'case.viewed') = 0, 'no detail views yet';
end $$;
-- Roster record update is a human-confirmed task, by the Deputy Chief or Chief only.
set role authenticated;
select pg_temp.as_user('g');
do $$ begin assert pg_temp.fails(format('select tpd.ia_complete_task(%L, %L)', (select id from tt.ia_tasks where case_id = pg_temp.id('case1') and kind = 'roster_record_update'), 'Entered on the sheet'), '%Deputy Chief or Chief%'), 'investigator cannot confirm a roster entry'; end $$;
reset role;
set role authenticated;
select pg_temp.as_user('b');
do $$ begin
  perform tpd.ia_complete_task((select id from tt.ia_tasks where case_id = pg_temp.id('case1') and kind = 'roster_record_update'), 'Entered Blackmark on Records tab, points updated.');
  perform tpd.ia_approve_disclosure(pg_temp.id('case1'), 'Your complaint has been reviewed and the investigation is closed.');
  perform tpd.ia_case_detail(pg_temp.id('case1'));
end $$;
select pg_temp.as_user('d');
do $$ begin
  perform tpd.ia_record_findings_notice(pg_temp.id('case1'), 'Findings letter delivered to H. by the Director.');
  assert (tpd.ia_case_detail(pg_temp.id('case1')) -> 'case' ->> 'findings_notice_method') like 'Findings letter%';
end $$;
reset role;
do $$ begin assert (select count(*) from tpd.ia_audit_events where case_id = pg_temp.id('case1') and action = 'case.viewed') = 2, 'every detail view is audited'; end $$;

-- 7. Receipt lookup: coarse status and the approved statement only; wrong token reveals nothing.
set role service_role;
do $$ declare r jsonb; ref text; begin
  select reference into ref from tpd.ia_receipts where case_id = pg_temp.id('case1');
  r := tpd.ia_receipt_status(ref, pg_temp.tok('member-1'), pg_temp.key(50));
  assert (r ->> 'found')::boolean and r ->> 'status' = 'closed' and r ->> 'statement' like 'Your complaint%', 'receipt shows closed + approved statement';
  assert not (r ?| array['finding', 'accused', 'investigator', 'case_number', 'discipline']), 'receipt reveals no investigation details';
  assert tpd.ia_receipt_status(ref, pg_temp.tok('wrong'), pg_temp.key(50)) = '{"found": false}'::jsonb, 'wrong token';
  assert tpd.ia_receipt_status('TPD-0000-0000', pg_temp.tok('member-1'), pg_temp.key(50)) = '{"found": false}'::jsonb, 'unknown reference looks the same';
  select reference into ref from tpd.ia_receipts where case_id = pg_temp.id('public1');
  assert tpd.ia_receipt_status(lower(ref), pg_temp.tok('public-1'), pg_temp.key(51)) ->> 'status' = 'received', 'public receipt (case-insensitive reference)';
  for i in 1..17 loop perform tpd.ia_receipt_status('TPD-0000-0000', pg_temp.tok('x'), pg_temp.key(50)); end loop;
  assert pg_temp.fails(format($q$select tpd.ia_receipt_status('TPD-0000-0000', sha256('x'::bytea), %L)$q$, pg_temp.key(50)), 'rate_limited'), 'lookups are rate limited';
end $$;
reset role;

-- 8. Non-sustained outcomes close without any discipline task; escalated cases go to the handling authority.
set role authenticated;
select pg_temp.as_user('b');
do $$ declare a uuid; begin
  -- Director complaint: the Deputy Chief investigates and decides (IA §5).
  perform tpd.ia_accept_intake(pg_temp.id('case_dir'), null, 'Handled by the Deputy Chief under IA §5.');
  assert pg_temp.fails(format('select tpd.ia_assign(%L, %L, %L)', pg_temp.id('case_dir'), pg_temp.id('pe'), 'Deputy Director has no link'), '%designated authority%'), 'escalated case cannot go back to IA';
  perform tpd.ia_assign(pg_temp.id('case_dir'), pg_temp.id('pb'), 'Deputy Chief handles; no conflict.');
  perform tpd.ia_record_notice(pg_temp.id('case_dir'), false, 'Written notice delivered to the Director.');
  select id into a from tt.ia_allegations where case_id = pg_temp.id('case_dir');
  perform tpd.ia_record_finding(a, 'exonerated', 'The act happened but was lawful and within policy.', null);
  perform tpd.ia_complete_task(t.id, 'Preserved.') from tt.ia_tasks t where t.case_id = pg_temp.id('case_dir');
  perform tpd.ia_submit_report(pg_temp.id('case_dir'), repeat('Deputy Chief report on the Director complaint with evidence summary. ', 3), 'The member was unavailable; written statement received.');
  assert (select status from tt.ia_cases where id = pg_temp.id('case_dir')) = 'deputy_chief_review', 'escalated report goes to the decider';
  assert tpd.ia_decide(pg_temp.id('case_dir'), '{}'::jsonb, 'Exonerated; no further action.') = 'closed';
end $$;
reset role;
do $$ begin assert not exists (select 1 from tpd.ia_tasks where case_id = pg_temp.id('case_dir') and kind = 'roster_record_update'), 'exonerated finding creates no discipline entry'; end $$;

-- 9. IA §12: a sustained dishonesty finding bars appointment.
set role authenticated;
select pg_temp.as_user('b');
do $$ declare cid uuid; a uuid; begin
  cid := tpd.ia_open_case('ia_opened', 'dishonesty', pg_temp.id('pj'), 'False statement in report', 'Opened by the Deputy Chief after a false statement in a written report.', current_date);
  insert into ids values ('case_j', cid);
end $$;
select pg_temp.as_user('d');
do $$ declare a uuid; begin
  perform tpd.ia_assign(pg_temp.id('case_j'), pg_temp.id('pg'), 'No relationship with J.');
end $$;
select pg_temp.as_user('g');
do $$ declare a uuid; begin
  perform tpd.ia_record_notice(pg_temp.id('case_j'), false, 'Written notice delivered to Sgt. J.');
  perform tpd.ia_record_interview(pg_temp.id('case_j'), 'accused', 'J. Sergeant', now() - interval '1 minute', now() - interval '2 minutes', null, 'Member acknowledged the report contained a false statement.');
  select id into a from tt.ia_allegations where case_id = pg_temp.id('case_j');
  perform tpd.ia_record_finding(a, 'sustained', 'Report contradicts bodycam and CAD timestamps.', 'Strike');
  perform tpd.ia_complete_task(t.id, 'Preserved.') from tt.ia_tasks t where t.case_id = pg_temp.id('case_j');
  perform tpd.ia_submit_report(pg_temp.id('case_j'), repeat('Report on the false statement allegation with bodycam and CAD evidence. ', 3), null);
end $$;
select pg_temp.as_user('d');
do $$ begin perform tpd.ia_director_review(pg_temp.id('case_j'), true, 'Approved and forwarded to the Deputy Chief.'); end $$;
select pg_temp.as_user('b');
do $$ declare a uuid; begin
  select id into a from tt.ia_allegations where case_id = pg_temp.id('case_j');
  perform tpd.ia_decide(pg_temp.id('case_j'), jsonb_build_object(a, 'Strike'), 'Strike per HB §13.');
  assert pg_temp.fails(format('select tpd.ia_appoint(%L, %L, %L)', pg_temp.id('pj'), 'IA-05', 'Appoint J as investigator'), '%dishonesty%'), 'sustained dishonesty bars IA service';
  perform tpd.ia_end_appointment((select id from tt.ia_appointments where callsign = 'IA-04' and ended_at is null), 'Rotation back to patrol duties.');
end $$;
select pg_temp.as_user('g');
do $$ begin
  assert pg_temp.fails('select tpd.ia_dashboard()', '%Internal Affairs access required%'), 'ending the appointment ends access';
  assert pg_temp.fails(format('select tpd.ia_case_detail(%L)', pg_temp.id('case1')), '%Case unavailable%'), 'former investigator loses case access';
end $$;
reset role;

-- 10. Notifications carry no case content, and nothing reaches tpd.audit_log.
do $$ begin
  assert not exists (select 1 from information_schema.columns where table_schema = 'tpd' and table_name = 'ia_notifications' and column_name in ('summary', 'body', 'message', 'detail')), 'notifications have no content column';
  assert not exists (select 1 from tpd.audit_log where action like 'ia%' or action like 'case.%'), 'IA never writes to the command-visible audit log';
end $$;

select 'ALL IA TESTS PASSED' as result;
