-- Row-level security and snapshot tests. Run by supabase/tests/run-local.sh
-- against a throwaway PostgreSQL. Fake Discord IDs only.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Users: chief (Captain+), officer, stranger (not on roster), nodiscord (no Discord identity)
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');
insert into auth.identities (user_id, provider, provider_id) values
  ('00000000-0000-0000-0000-00000000000a', 'discord', '100000000000000001'),
  ('00000000-0000-0000-0000-00000000000b', 'discord', '100000000000000002'),
  ('00000000-0000-0000-0000-00000000000c', 'discord', '100000000000000099'),
  ('00000000-0000-0000-0000-00000000000d', 'email', 'someone@example.test');

create function pg_temp.as_user(sub text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), false);
end $$;

-- 1. Before any import: membership is "unavailable", not "unrecognized" or verified.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (tpd.my_membership() ->> 'state') = 'unavailable', 'state before import'; end $$;
reset role;

-- 2. Apply a snapshot as the sync function would.
insert into tpd.roster_sync_runs (id, trigger, status, finished_at) values ('00000000-0000-0000-0000-0000000000f1', 'manual', 'applied', now());
set role service_role;
select tpd.apply_roster_snapshot($j${
  "members": [
    {"discordId": "100000000000000001", "name": "A. Chief", "callsign": "X-101", "rank": "Chief of Police", "appointment": "Overall Operations", "tier": "Office of the Chiefs", "district": null, "timezone": "EST"},
    {"discordId": "100000000000000002", "name": "B. Officer", "callsign": "X-425", "rank": "Officer", "appointment": "Patrol Bureau", "tier": "Patrol Bureau", "district": "North", "timezone": "PST"},
    {"discordId": "100000000000000003", "name": "C. Leaving", "callsign": "X-426", "rank": "Officer", "appointment": "Patrol Bureau", "tier": "Patrol Bureau", "district": "North", "timezone": null}
  ],
  "positions": [
    {"ord": 1, "callsign": "X-101", "rank": "Chief of Police", "appointment": "Overall Operations", "tier": "Office of the Chiefs", "district": null, "discordId": "100000000000000001"},
    {"ord": 2, "callsign": "X-425", "rank": "Officer", "appointment": "Patrol Bureau", "tier": "Patrol Bureau", "district": "North", "discordId": "100000000000000002"},
    {"ord": 3, "callsign": "X-426", "rank": "Officer", "appointment": "Patrol Bureau", "tier": "Patrol Bureau", "district": "North", "discordId": "100000000000000003"},
    {"ord": 4, "callsign": "X-427", "rank": "Officer", "appointment": "Patrol Bureau", "tier": "Patrol Bureau", "district": "North", "discordId": null}
  ],
  "divisionSlots": [{"callsign": "W-12", "division": "waterfront", "role": "Officer", "title": "Waterfront Unit", "discordId": "100000000000000002"}]
}$j$::jsonb, '00000000-0000-0000-0000-0000000000f1');
reset role;
do $$ begin
  assert (select count(*) from tpd.personnel) = 3, 'vacant slot must not create personnel';
  assert (select count(*) from tpd.positions where personnel_id is null) = 1, 'vacant slot kept';
end $$;

-- 3. Anonymous visitors read nothing.
set role anon;
do $$ declare n int; begin
  begin select count(*) into n from tpd.personnel; raise exception 'anon read personnel'; exception when insufficient_privilege then null; end;
  begin select count(*) into n from tpd.audit_log; raise exception 'anon read audit'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 4. An officer sees only their own full record; directory has no Discord IDs.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from tpd.personnel) = 1, 'officer sees only self';
  assert (select discord_id from tpd.personnel) = '100000000000000002', 'own row';
  -- The directory is served only by the audited RPC (migration 20261105071000 retired the view).
  assert (select count(*) from tpd.list_member_directory()) = 3, 'directory visible to members';
  assert not exists (select 1 from pg_proc p, unnest(p.proargnames) a where p.proname = 'list_member_directory' and a in ('discord_id', 'timezone')), 'directory leaks identifiers';
  begin perform count(*) from tpd.personnel_directory; raise exception 'retired directory view still readable'; exception when insufficient_privilege then null; end;
  assert not exists (select 1 from information_schema.columns where table_name = 'personnel_directory' and column_name in ('discord_id', 'timezone')), 'directory leaks identifiers';
  assert (select count(*) from tpd.roster_sync_runs) = 0, 'officer reads sync runs';
  assert (select count(*) from tpd.audit_log) = 0, 'officer reads audit';
  assert (select count(*) from tpd.integration_status) = 0, 'officer reads integration status';
  assert not tpd.is_command(), 'officer is not command';
  assert (tpd.my_membership() ->> 'state') = 'verified', 'officer verified';
  assert (tpd.my_membership() -> 'member' -> 'divisions' -> 0 ->> 'callsign') = 'W-12', 'division membership';
end $$;

-- 5. Writes are refused for signed-in users, including self-promotion.
do $$ begin
  begin update tpd.personnel set rank = 'Chief of Police'; raise exception 'self promotion allowed'; exception when insufficient_privilege then null; end;
  begin insert into tpd.audit_log (actor, action) values ('x', 'y'); raise exception 'audit insert allowed'; exception when insufficient_privilege then null; end;
  begin perform tpd.apply_roster_snapshot('{}'::jsonb, gen_random_uuid()); raise exception 'apply allowed'; exception when insufficient_privilege then null; end;
end $$;

-- 6. Command sees everything readable; no write rights either.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert tpd.is_command(), 'chief is command';
  assert (select count(*) from tpd.personnel) = 3, 'command reads personnel';
  assert (select count(*) from tpd.roster_sync_runs) = 1, 'command reads sync runs';
  begin delete from tpd.personnel; raise exception 'command delete allowed'; exception when insufficient_privilege then null; end;
end $$;

-- 7. Unrecognized and identity-less users get no member access.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (tpd.my_membership() ->> 'state') = 'unrecognized', 'stranger state';
  begin perform count(*) from tpd.list_member_directory(); raise exception 'stranger reads directory'; exception when insufficient_privilege then null; end;
  assert (select count(*) from tpd.positions) = 0, 'stranger reads positions';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ begin assert (tpd.my_membership() ->> 'state') = 'pending_verification', 'no discord identity'; end $$;
select pg_temp.as_user(null);
do $$ begin assert (tpd.my_membership() ->> 'state') = 'signed_out', 'signed out'; end $$;
reset role;

-- 8. Removal safeguards. A member missing from a snapshot stays active; they become former only after explicit
--    approval, or after 3 separate applied snapshots at least 6 hours apart. Updates still apply meanwhile.
create function pg_temp.snap(with3 boolean, with4 boolean) returns jsonb language sql as $f$
  select jsonb_build_object(
    'members', jsonb_build_array(
      jsonb_build_object('discordId', '100000000000000001', 'name', 'A. Chief', 'callsign', 'X-101', 'rank', 'Chief of Police', 'appointment', 'Overall Operations', 'tier', 'Office of the Chiefs', 'district', null, 'timezone', 'EST'),
      jsonb_build_object('discordId', '100000000000000002', 'name', 'B. Officer', 'callsign', 'X-426', 'rank', 'Corporal', 'appointment', 'Patrol Aide', 'tier', 'Patrol Bureau', 'district', 'South', 'timezone', 'PST'))
    || case when with3 then jsonb_build_array(jsonb_build_object('discordId', '100000000000000003', 'name', 'C. Officer', 'callsign', 'X-430', 'rank', 'Officer', 'appointment', 'Patrol', 'tier', 'Patrol Bureau', 'district', 'North', 'timezone', 'EST')) else '[]'::jsonb end
    || case when with4 then jsonb_build_array(jsonb_build_object('discordId', '100000000000000004', 'name', 'D. Officer', 'callsign', 'X-431', 'rank', 'Officer', 'appointment', 'Patrol', 'tier', 'Patrol Bureau', 'district', 'North', 'timezone', 'EST')) else '[]'::jsonb end,
    'positions', jsonb_build_array(jsonb_build_object('ord', 1, 'callsign', 'X-101', 'rank', 'Chief of Police', 'appointment', 'Overall Operations', 'tier', 'Office of the Chiefs', 'district', null, 'discordId', '100000000000000001')))
$f$;
set role service_role;
select tpd.apply_roster_snapshot(pg_temp.snap(false, false), '00000000-0000-0000-0000-0000000000f1');
reset role;
do $$ begin
  assert (select status from tpd.personnel where discord_id = '100000000000000003') = 'active', 'a missing member is NOT removed by one snapshot';
  assert (select observations from tpd.removal_candidates where discord_id = '100000000000000003') = 1, 'missing member tracked as a candidate';
  assert (select rank || '/' || callsign || '/' || district from tpd.personnel where discord_id = '100000000000000002') = 'Corporal/X-426/South', 'rank, callsign, district change applied meanwhile';
end $$;
-- A second snapshot straight away (inside the 6 hour gap) is not an independent observation.
set role service_role;
select tpd.apply_roster_snapshot(pg_temp.snap(false, false), '00000000-0000-0000-0000-0000000000f2');
reset role;
do $$ begin assert (select observations from tpd.removal_candidates where discord_id = '100000000000000003') = 1, 'no double counting inside the gap'; end $$;
-- Second independent observation.
update tpd.removal_candidates set last_absent_at = now() - interval '7 hours';
set role service_role;
select tpd.apply_roster_snapshot(pg_temp.snap(false, false), '00000000-0000-0000-0000-0000000000f3');
reset role;
do $$ begin assert (select observations from tpd.removal_candidates where discord_id = '100000000000000003') = 2, 'second observation counted'; end $$;
-- Reappearing resets the streak.
set role service_role;
select tpd.apply_roster_snapshot(pg_temp.snap(true, false), '00000000-0000-0000-0000-0000000000f4');
reset role;
do $$ begin assert not exists (select 1 from tpd.removal_candidates), 'candidate cleared when the member is listed again'; end $$;
set role service_role;
select tpd.apply_roster_snapshot(pg_temp.snap(false, false), '00000000-0000-0000-0000-0000000000f5');
reset role;
do $$ begin assert (select observations from tpd.removal_candidates where discord_id = '100000000000000003') = 1, 'streak restarted at 1'; end $$;
-- Third consecutive independent observation marks the member former and frees the call sign.
update tpd.removal_candidates set last_absent_at = now() - interval '7 hours';
set role service_role;
select tpd.apply_roster_snapshot(pg_temp.snap(false, false), '00000000-0000-0000-0000-0000000000f6');
reset role;
update tpd.removal_candidates set last_absent_at = now() - interval '7 hours';
set role service_role;
select tpd.apply_roster_snapshot(pg_temp.snap(false, false), '00000000-0000-0000-0000-0000000000f7');
reset role;
do $$ begin
  assert (select status from tpd.personnel where discord_id = '100000000000000003') = 'former', 'removed after 3 independent snapshots';
  assert (select callsign from tpd.personnel where discord_id = '100000000000000003') is null, 'callsign freed';
  assert not exists (select 1 from tpd.removal_candidates), 'candidate record cleaned up';
end $$;
-- Explicit approval removes immediately, but only the approved member.
set role service_role;
select tpd.apply_roster_snapshot(pg_temp.snap(false, true), '00000000-0000-0000-0000-0000000000f8');
select tpd.apply_roster_snapshot(pg_temp.snap(false, false), '00000000-0000-0000-0000-0000000000f9', array['100000000000000099']);
reset role;
do $$ begin assert (select status from tpd.personnel where discord_id = '100000000000000004') = 'active', 'approving someone else removes nobody'; end $$;
set role service_role;
select tpd.apply_roster_snapshot(pg_temp.snap(false, false), '00000000-0000-0000-0000-0000000000fa', array['100000000000000004']);
reset role;
do $$ begin
  assert (select status from tpd.personnel where discord_id = '100000000000000004') = 'former', 'approved removal applied at once';
  assert (select status from tpd.personnel where discord_id = '100000000000000001') = 'active', 'others untouched';
end $$;
-- The safeguard cannot be weakened from outside: min_observations below 2 is refused; signed-in users cannot call apply.
set role service_role;
do $$ begin
  begin perform tpd.apply_roster_snapshot(pg_temp.snap(false, false), gen_random_uuid(), '{}', 1); raise exception 'weak setting accepted';
  exception when raise_exception then if sqlerrm like '%accepted%' then raise; end if; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  begin perform tpd.apply_roster_snapshot(pg_temp.snap(false, false), gen_random_uuid()); raise exception 'apply allowed';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from tpd.removal_candidates) = 0, 'no candidates visible to non-command (none exist or RLS)';
end $$;
reset role;
delete from tpd.personnel where discord_id = '100000000000000004';

-- 9. A malformed or empty snapshot is refused and nothing changes.
set role service_role;
do $$ begin
  begin perform tpd.apply_roster_snapshot('{"members": [], "positions": []}'::jsonb, gen_random_uuid()); raise exception 'empty snapshot applied'; exception when raise_exception then
    if sqlerrm like '%empty snapshot applied%' then raise; end if; end;
  begin perform tpd.apply_roster_snapshot($j${"members": [{"discordId": "not-an-id", "name": "X", "rank": "Officer", "tier": "Patrol Bureau"}], "positions": [{"ord": 1, "rank": "Officer", "appointment": "x", "tier": "Patrol Bureau"}]}$j$::jsonb, gen_random_uuid());
    raise exception 'bad id applied'; exception when check_violation then null; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from tpd.personnel where status = 'active') = 2, 'failed apply preserved previous snapshot';
  assert (select count(*) from tpd.positions) = 1, 'positions preserved';
end $$;

-- 10. A former member signing in is told so and gets no member access.
insert into auth.users values ('00000000-0000-0000-0000-00000000000e');
insert into auth.identities (user_id, provider, provider_id) values ('00000000-0000-0000-0000-00000000000e', 'discord', '100000000000000003');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
do $$ begin
  assert (tpd.my_membership() ->> 'state') = 'former', 'former state';
  assert not tpd.is_active_member(), 'former is not active';
  begin perform count(*) from tpd.list_member_directory(); raise exception 'former reads directory'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 11. Hardened apply: duplicate Discord ID and member-less snapshots are refused; unqualified-delete safe (WHERE true);
--     my_membership carries the member's own id; a Captain's own verification row is never someone else's.
set role service_role;
do $$ begin
  begin perform tpd.apply_roster_snapshot($j${"members": [
      {"discordId": "100000000000000001", "name": "A", "callsign": "X-101", "rank": "Chief of Police", "tier": "Office of the Chiefs"},
      {"discordId": "100000000000000001", "name": "B", "callsign": "X-102", "rank": "Deputy Chief", "tier": "Office of the Chiefs"}],
    "positions": [{"ord": 1, "rank": "Officer", "appointment": "x", "tier": "Patrol Bureau"}]}$j$::jsonb, gen_random_uuid());
    raise exception 'duplicate id applied'; exception when raise_exception then if sqlerrm like '%applied%' then raise; end if; end;
  begin perform tpd.apply_roster_snapshot('{"members": [], "positions": [{"ord": 1, "rank": "Officer", "appointment": "x", "tier": "Patrol Bureau"}]}'::jsonb, gen_random_uuid());
    raise exception 'memberless applied'; exception when raise_exception then if sqlerrm like '%applied%' then raise; end if; end;
end $$;
reset role;
do $$ begin assert (select count(*) from tpd.personnel where status = 'active') = 2, 'refused snapshots changed nothing'; end $$;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (tpd.my_membership() -> 'member' ->> 'id')::uuid = (select id from tpd.personnel where discord_id = '100000000000000002'), 'own id returned'; end $$;
-- A command user's "own record" query must be filtered by Discord ID: unfiltered it returns everyone (discord-verify relied on row 0).
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from tpd.personnel) = 3, 'command reads all rows, so callers must filter by discord_id';
  assert (select count(*) from tpd.personnel where discord_id = tpd.current_discord_id()) = 1, 'filtered own record';
end $$;
reset role;

select 'ALL RLS TESTS PASSED' as result;
