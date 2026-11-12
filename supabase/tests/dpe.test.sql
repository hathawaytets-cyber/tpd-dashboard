-- Daily Patrol Evaluation tests. Run by run-local.sh after rls.test.sql on the same throwaway database.
-- Fake Discord IDs and names only.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create function pg_temp.as_user(sub text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(sub, ''), false); end $$;
-- Expect an error whose SQLSTATE is `state`; anything else (or no error) fails the test.
create function pg_temp.expect_error(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'expected % for: %', state, label;
exception when others then
  if sqlstate <> state then raise exception '% (got % "%", wanted %)', label, sqlstate, sqlerrm, state; end if;
end $$;
grant execute on function pg_temp.expect_error(text, text, text) to authenticated;

-- People (inserted directly, as the roster sync would): s1, s2 Sergeants; l1 Lieutenant; c1 Captain; ch Chief; dc Deputy Chief;
-- o1 Officer; cp Corporal; po Probationary; s3 Sergeant who is no longer active.
insert into tpd.personnel (id, discord_id, name, callsign, rank, tier, district, status) values
  ('d0000000-0000-0000-0000-000000000001', '200000000000000001', 'S. One',   'X-401', 'Sergeant', 'Field Supervisory', 'North', 'active'),
  ('d0000000-0000-0000-0000-000000000002', '200000000000000002', 'S. Two',   'X-501', 'Sergeant', 'Field Supervisory', 'South', 'active'),
  ('d0000000-0000-0000-0000-000000000003', '200000000000000003', 'L. Three', 'X-313', 'Lieutenant', 'Field Supervisory', 'North', 'active'),
  ('d0000000-0000-0000-0000-000000000004', '200000000000000004', 'C. Four',  'X-309', 'Captain', 'Command Staff', null, 'active'),
  ('d0000000-0000-0000-0000-000000000005', '200000000000000005', 'H. Chief', 'X-100', 'Chief of Police', 'Office of the Chiefs', null, 'active'),
  ('d0000000-0000-0000-0000-000000000006', '200000000000000006', 'D. Dep',   'X-110', 'Deputy Chief', 'Office of the Chiefs', null, 'active'),
  ('d0000000-0000-0000-0000-000000000007', '200000000000000007', 'O. Seven', 'X-425', 'Officer', 'Patrol Bureau', 'North', 'active'),
  ('d0000000-0000-0000-0000-000000000008', '200000000000000008', 'K. Eight', 'X-412', 'Corporal', 'Patrol Bureau', 'North', 'active'),
  ('d0000000-0000-0000-0000-000000000009', '200000000000000009', 'P. Nine',  'X-445', 'Probationary Officer', 'Patrol Bureau', 'South', 'active'),
  ('d0000000-0000-0000-0000-000000000010', '200000000000000010', 'F. Ten',   'X-402', 'Sergeant', 'Field Supervisory', 'North', 'former');
insert into auth.users select ('e0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 10) n;
insert into auth.identities (user_id, provider, provider_id)
  select ('e0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'discord', '2000000000000000' || lpad(n::text, 2, '0') from generate_series(1, 10) n;

create function pg_temp.u(n int) returns text language sql as $$ select 'e0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0') $$;
create function pg_temp.p(n int) returns uuid language sql as $$ select ('d0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
grant execute on function pg_temp.u(int), pg_temp.p(int) to authenticated;
-- A completed patrol session at local wall time (America/New_York), inserted directly (the trigger still runs).
create function pg_temp.patrol(member int, local_start timestamp, minutes int) returns void language sql as $$
  insert into tpd.patrol_sessions (personnel_id, district, started_at, ended_at)
  values (pg_temp.p(member), 'North', local_start at time zone 'America/New_York', (local_start at time zone 'America/New_York') + make_interval(mins => minutes))
$$;

-- 1. Patrol-day boundary (04:00 to 04:00 America/New_York) and DST.
do $$ begin
  assert tpd.dpe_patrol_date('2026-11-12 03:59:59' :: timestamp at time zone 'America/New_York') = '2026-11-11', '03:59 belongs to previous day';
  assert tpd.dpe_patrol_date('2026-11-12 04:00:00' :: timestamp at time zone 'America/New_York') = '2026-11-12', '04:00 starts new day';
  assert tpd.dpe_patrol_date('2026-11-13 01:30:00' :: timestamp at time zone 'America/New_York') = '2026-11-12', 'after midnight stays on the patrol day';
  -- Clocks jump at 02:00 on 2026-03-08 and fall back on 2026-11-01, so the patrol days that START the evening before
  -- (2026-03-07 and 2026-10-31, 04:00 to 04:00) are 23 and 25 hours long.
  assert extract(epoch from tpd.dpe_day_end('2026-03-07') - tpd.dpe_day_start('2026-03-07')) = 23 * 3600, 'spring-forward day is 23h';
  assert extract(epoch from tpd.dpe_day_end('2026-10-31') - tpd.dpe_day_start('2026-10-31')) = 25 * 3600, 'fall-back day is 25h';
  assert tpd.dpe_day_start('2026-07-04') = '2026-07-04 08:00:00+00', 'summer: 04:00 EDT = 08:00 UTC';
  assert tpd.dpe_day_start('2026-12-04') = '2026-12-04 09:00:00+00', 'winter: 04:00 EST = 09:00 UTC';
  assert tpd.dpe_deadline('2026-11-12') = '2026-11-14 01:00:00+00', 'deadline 20:00 EST the next day';
end $$;

-- 2. Obligations from patrol logs: >= 15 minutes, attributed to the patrol day the session started in.
select pg_temp.patrol(1, (current_date - 3) + time '23:30', 120);   -- crosses midnight: one obligation on current_date-3
select pg_temp.patrol(1, (current_date - 1) + time '03:50', 30);    -- 03:50 belongs to current_date-2
select pg_temp.patrol(2, (current_date - 3) + time '20:00', 10);    -- 10 minutes: below the minimum
select pg_temp.patrol(7, (current_date - 3) + time '20:00', 90);    -- Officer: never an obligation
select pg_temp.patrol(4, (current_date - 3) + time '20:00', 90);    -- Captain: not required to report
select pg_temp.patrol(10, (current_date - 3) + time '20:00', 90);   -- former Sergeant: no obligation
do $$ begin
  assert (select count(*) from tpd.dpe_obligations where supervisor_id = pg_temp.p(1)) = 2, 'two patrol days for s1';
  assert exists (select 1 from tpd.dpe_obligations where supervisor_id = pg_temp.p(1) and patrol_date = current_date - 3 and source = 'patrol'), 'cross-midnight day';
  assert exists (select 1 from tpd.dpe_obligations where supervisor_id = pg_temp.p(1) and patrol_date = current_date - 2), '03:50 counted on previous day';
  assert not exists (select 1 from tpd.dpe_obligations where supervisor_id in (pg_temp.p(2), pg_temp.p(7), pg_temp.p(4), pg_temp.p(10))), 'no obligation for short, unranked or former';
end $$;
-- Two short sessions on the same day that add up to the minimum do create one.
select pg_temp.patrol(2, (current_date - 3) + time '21:00', 6);
do $$ begin assert (select count(*) from tpd.dpe_obligations where supervisor_id = pg_temp.p(2)) = 1, '10 + 6 minutes >= 15'; end $$;

-- 3. Assignments are authoritative: an assignment alone creates the obligation, with no patrol at all.
set role authenticated;
select pg_temp.as_user(pg_temp.u(4)); -- Captain
select tpd.dpe_assign(pg_temp.p(3), array[current_date - 4, current_date - 1, current_date + 2], 'District coverage');
do $$ begin
  perform pg_temp.expect_error($s$select tpd.dpe_assign(pg_temp.p(7), array[current_date], 'x')$s$, '22023', 'officers cannot be assigned');
  perform pg_temp.expect_error($s$select tpd.dpe_assign(pg_temp.p(3), array[current_date - 30], 'x')$s$, '22023', 'no deep back-dating');
end $$;
reset role;
do $$ begin
  assert (select count(*) from tpd.dpe_obligations where supervisor_id = pg_temp.p(3) and source = 'assignment') = 3, 'assignment creates obligations';
end $$;
-- A Sergeant cannot assign.
set role authenticated;
select pg_temp.as_user(pg_temp.u(1));
do $$ begin perform pg_temp.expect_error($s$select tpd.dpe_assign(pg_temp.p(2), array[current_date], 'x')$s$, '42501', 'sergeant assigns'); end $$;
reset role;

-- 4. Status: overdue, not started, upcoming; exactly at the deadline.
do $$ declare o tpd.dpe_obligations; begin
  select * into o from tpd.dpe_obligations where supervisor_id = pg_temp.p(3) and patrol_date = current_date - 4;
  assert tpd.dpe_status_at(o, null, false, tpd.dpe_deadline(o.patrol_date) - interval '1 second') = 'not_started', 'before deadline';
  assert tpd.dpe_status_at(o, null, false, tpd.dpe_deadline(o.patrol_date)) = 'overdue', 'at deadline';
  assert tpd.dpe_status_at(o, 'draft', false, tpd.dpe_deadline(o.patrol_date)) = 'overdue', 'draft past deadline is overdue';
  assert tpd.dpe_status_at(o, 'submitted', false, tpd.dpe_deadline(o.patrol_date)) = 'submitted', 'submitted stays submitted';
  assert tpd.dpe_status_at(o, null, true, tpd.dpe_deadline(o.patrol_date)) = 'excused', 'excused never overdue';
  select * into o from tpd.dpe_obligations where supervisor_id = pg_temp.p(3) and patrol_date = current_date + 2;
  assert tpd.dpe_status_at(o, null, false, now()) = 'upcoming', 'future assignment is upcoming';
end $$;

-- 5. Supervisor flow: no-observations submit, duplicate blocked, validation.
set role authenticated;
select pg_temp.as_user(pg_temp.u(1));
do $$ declare r jsonb; d date := current_date - 3; begin
  -- empty report without the explicit confirmation is refused
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'submit', false, '[]'::jsonb)$s$, d), '22023', 'empty report needs confirmation');
  -- no-observations with entries is contradictory
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'submit', true, '[{"officer_id":"%s","category":"exceeding","justification":"Excellent traffic stop work"}]'::jsonb)$s$, d, pg_temp.p(7)), '22023', 'no-obs with entries');
  r := tpd.dpe_save_report(d, 'submit', true, '[]'::jsonb);
  assert r ->> 'status' = 'submitted' and (r ->> 'version')::int = 1, 'no-observations report submitted';
  assert (r ->> 'late')::boolean, 'submitted after the deadline is flagged late';
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'submit', true, '[]'::jsonb)$s$, d), '23505', 'second submit blocked');
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'draft', true, '[]'::jsonb)$s$, d), '23505', 'draft over a submitted report blocked');
  -- a day with no obligation
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'submit', true, '[]'::jsonb)$s$, current_date - 10), '22023', 'no obligation, no report');
  -- self-evaluation and supervisors are not eligible
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'draft', false, '[{"officer_id":"%s","category":"exceeding","justification":"Very good shift"}]'::jsonb)$s$, current_date - 2, pg_temp.p(1)), '42501', 'self-evaluation');
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'draft', false, '[{"officer_id":"%s","category":"exceeding","justification":"Very good shift"}]'::jsonb)$s$, current_date - 2, pg_temp.p(2)), '42501', 'evaluating another sergeant');
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'draft', false, '[{"officer_id":"%s","category":"exceeding","justification":"Very good shift"}]'::jsonb)$s$, current_date - 2, pg_temp.p(10)), '42501', 'inactive officer');
end $$;
-- Draft, then submit with three officers and an award (free-text award while the official list is empty).
do $$ declare r jsonb; d date := current_date - 2; e jsonb; begin
  e := jsonb_build_array(
    jsonb_build_object('officer_id', pg_temp.p(7), 'category', 'exceeding', 'justification', ''),
    jsonb_build_object('officer_id', pg_temp.p(8), 'category', 'needs_improvement', 'justification', 'Radio discipline slipped during pursuit'));
  r := tpd.dpe_save_report(d, 'draft', false, e);
  assert r ->> 'status' = 'draft', 'draft saved with an incomplete justification';
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'submit', false, %L::jsonb)$s$, d, e), '22023', 'submit needs justifications');
  e := jsonb_build_array(
    jsonb_build_object('officer_id', pg_temp.p(7), 'category', 'exceeding', 'justification', 'Led a clean felony stop and briefed units'),
    jsonb_build_object('officer_id', pg_temp.p(8), 'category', 'needs_improvement', 'justification', 'Radio discipline slipped during pursuit'),
    jsonb_build_object('officer_id', pg_temp.p(9), 'category', 'award', 'justification', 'Rendered aid at a crash before EMS arrived'));
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'submit', false, %L::jsonb)$s$, d, e), '22023', 'award needs a named award');
  e := jsonb_set(e, '{2,award_text}', '"Lifesaving recognition"');
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(%L, 'submit', false, %L::jsonb)$s$, d, e || jsonb_build_array(e -> 0)), '22023', 'same officer twice in one category');
  r := tpd.dpe_save_report(d, 'submit', false, e);
  assert r ->> 'status' = 'submitted', 'full report submitted';
  assert (select count(*) from tpd.dpe_entries) = 3, 'three entries visible to the author';
  assert (select officer_callsign from tpd.dpe_entries where category = 'award') = 'X-445', 'officer call sign copied';
  assert (select author_rank || ' ' || author_name || ' ' || author_callsign from tpd.dpe_reports where patrol_date = d) = 'Sergeant S. One X-401', 'author copied from roster';
end $$;
reset role;

-- 6. Concurrency: two sessions submitting the same day. The obligation row lock serializes them; the unique report
--    per obligation guarantees one. Simulated by a second submit inside the same transaction after the first.
set role authenticated;
select pg_temp.as_user(pg_temp.u(3)); -- Lieutenant, assigned current_date-1
do $$ begin
  perform tpd.dpe_save_report(current_date - 1, 'submit', true, '[]'::jsonb);
  perform pg_temp.expect_error($s$select tpd.dpe_save_report(current_date - 1, 'submit', true, '[]'::jsonb)$s$, '23505', 'duplicate final in same transaction');
  assert (select count(*) from tpd.dpe_reports where patrol_date = current_date - 1) = 1, 'exactly one report';
  -- A future assignment cannot be filed before the day starts.
  perform pg_temp.expect_error($s$select tpd.dpe_save_report(current_date + 2, 'submit', true, '[]'::jsonb)$s$, '22023', 'future day');
end $$;
reset role;

-- 7. Amendments keep every version; locked after review unless reopened.
set role authenticated;
select pg_temp.as_user(pg_temp.u(1));
do $$ declare r jsonb; begin
  perform pg_temp.expect_error($s$select tpd.dpe_save_report(current_date - 3, 'amend', false, '[]'::jsonb, 'x')$s$, '22023', 'amend needs a reason');
  r := tpd.dpe_save_report(current_date - 3, 'amend', false,
    jsonb_build_array(jsonb_build_object('officer_id', pg_temp.p(7), 'category', 'exceeding', 'justification', 'Remembered: excellent scene control')),
    'Forgot to include an observation');
  assert (r ->> 'version')::int = 2, 'amendment is version 2';
  assert (select count(*) from tpd.dpe_report_versions v join tpd.dpe_reports x on x.id = v.report_id where x.patrol_date = current_date - 3) = 2, 'both versions kept';
  assert (select content ->> 'no_observations' from tpd.dpe_report_versions v join tpd.dpe_reports x on x.id = v.report_id where x.patrol_date = current_date - 3 and v.version = 1) = 'true', 'original preserved';
  assert (select late from tpd.dpe_reports where patrol_date = current_date - 3), 'late flag survives amendment';
end $$;
reset role;

-- 8. Visibility: authors see only their own; officers and other ranks see nothing; command sees all.
set role authenticated;
select pg_temp.as_user(pg_temp.u(2)); -- other Sergeant
do $$ begin
  assert (select count(*) from tpd.dpe_reports) = 0, 'sergeant sees no one else''s reports';
  assert (select count(*) from tpd.dpe_entries) = 0, 'sergeant sees no one else''s entries';
  assert (select count(*) from tpd.dpe_report_versions) = 0, 'no versions of others';
  perform pg_temp.expect_error($s$select tpd.dpe_compliance(current_date - 7, current_date)$s$, '42501', 'sergeant compliance');
  perform pg_temp.expect_error($s$select tpd.dpe_export(current_date - 7, current_date)$s$, '42501', 'sergeant export');
end $$;
select pg_temp.as_user(pg_temp.u(3)); -- Lieutenant: own only
do $$ begin
  assert (select count(*) from tpd.dpe_reports) = 1, 'lieutenant sees only own report';
  perform pg_temp.expect_error($s$select tpd.dpe_review((select id from tpd.dpe_reports limit 1), 'report', 'reviewed', 'Looks complete and accurate')$s$, '42501', 'lieutenant reviews');
end $$;
select pg_temp.as_user(pg_temp.u(7)); -- Officer, named in reports
do $$ begin
  assert (select count(*) from tpd.dpe_reports) = 0 and (select count(*) from tpd.dpe_entries) = 0, 'officer sees no evaluations, even about them';
  assert (select count(*) from tpd.dpe_obligations) = 0, 'officer sees no obligations';
  perform pg_temp.expect_error($s$select tpd.dpe_eligible_officers(current_date)$s$, '42501', 'officer lists officers');
end $$;
do $$ begin assert jsonb_array_length(tpd.dpe_my_overview() -> 'rows') = 0 and not (tpd.dpe_my_overview() ->> 'required')::boolean, 'officer has no duties'; end $$;
select pg_temp.as_user(null);
do $$ begin
  assert (select count(*) from tpd.dpe_reports) = 0, 'signed out sees nothing';
  perform pg_temp.expect_error($s$select tpd.dpe_my_overview()$s$, '42501', 'signed out overview');
end $$;
reset role;
set role anon;
do $$ begin perform pg_temp.expect_error($s$select count(*) from tpd.dpe_reports$s$, '42501', 'anon table access'); end $$;
reset role;
set role authenticated;
select pg_temp.as_user(pg_temp.u(4)); -- Captain
do $$ declare c jsonb; begin
  assert (select count(*) from tpd.dpe_reports) = 3, 'command reads all reports';
  c := tpd.dpe_compliance(current_date - 7, current_date + 7);
  assert exists (select 1 from jsonb_array_elements(c -> 'rows') x where x ->> 'supervisor_id' = pg_temp.p(3)::text and x ->> 'patrol_date' = (current_date - 4)::text and x ->> 'status' = 'overdue'), 'missing past report is overdue';
  assert exists (select 1 from jsonb_array_elements(c -> 'rows') x where x ->> 'supervisor_id' = pg_temp.p(2)::text and x ->> 'status' = 'overdue'), 's2 patrol day overdue';
  assert not exists (select 1 from jsonb_array_elements(c -> 'rows') x where x ->> 'supervisor_id' in (pg_temp.p(7)::text, pg_temp.p(4)::text)), 'no rows for unassigned officers';
  -- Direct writes are refused even for command.
  perform pg_temp.expect_error($s$update tpd.dpe_reports set late = false$s$, '42501', 'command direct update');
  perform pg_temp.expect_error($s$delete from tpd.dpe_report_versions$s$, '42501', 'command direct delete');
end $$;

-- 9. Excusals and approved LOA: excused days are never overdue; revocation restores the obligation.
do $$ declare x uuid; c jsonb; begin
  x := tpd.dpe_excuse(pg_temp.p(3), current_date - 4, 'Approved court appearance out of game');
  perform pg_temp.expect_error(format($s$select tpd.dpe_excuse(%L, %L, 'Duplicate excuse attempt')$s$, pg_temp.p(3), current_date - 4), '23505', 'double excuse');
  perform pg_temp.expect_error(format($s$select tpd.dpe_excuse(%L, %L, 'no')$s$, pg_temp.p(2), current_date - 3), '22023', 'excuse needs reason');
  perform pg_temp.expect_error(format($s$select tpd.dpe_excuse(%L, %L, 'Excusing myself for testing')$s$, pg_temp.p(4), current_date - 3), '42501', 'self-excuse');
  c := tpd.dpe_compliance(current_date - 7, current_date);
  assert (select x2 ->> 'status' from jsonb_array_elements(c -> 'rows') x2 where x2 ->> 'supervisor_id' = pg_temp.p(3)::text and x2 ->> 'patrol_date' = (current_date - 4)::text) = 'excused', 'excused day not overdue';
  perform tpd.dpe_revoke_excusal(x, 'Court appearance was cancelled');
  c := tpd.dpe_compliance(current_date - 7, current_date);
  assert (select x2 ->> 'status' from jsonb_array_elements(c -> 'rows') x2 where x2 ->> 'supervisor_id' = pg_temp.p(3)::text and x2 ->> 'patrol_date' = (current_date - 4)::text) = 'overdue', 'revoked excusal is overdue again';
end $$;
reset role;
insert into tpd.member_requests (requester_id, kind, summary, detail, leave_start, leave_end, status, reviewer_id, decision_reason, decided_at)
values (pg_temp.p(2), 'Leave of absence', 'Family travel week', 'Travelling with family, no access to a PC', current_date - 5, current_date - 2, 'approved', pg_temp.p(4), 'Approved: within two weeks', now());
set role authenticated;
select pg_temp.as_user(pg_temp.u(4));
do $$ declare c jsonb; begin
  c := tpd.dpe_compliance(current_date - 7, current_date);
  assert (select x ->> 'status' from jsonb_array_elements(c -> 'rows') x where x ->> 'supervisor_id' = pg_temp.p(2)::text) = 'excused', 'approved LOA excuses';
  assert (select x ->> 'excuse_reason' from jsonb_array_elements(c -> 'rows') x where x ->> 'supervisor_id' = pg_temp.p(2)::text) = 'Approved leave of absence', 'LOA reason';
end $$;

-- 10. Cancelling an assignment voids an untouched obligation, but keeps one with a report or a qualifying patrol.
do $$ begin
  perform tpd.dpe_cancel_assignment(pg_temp.p(3), current_date + 2, 'Shift moved to another supervisor');
  assert (select voided_at is not null from tpd.dpe_obligations where supervisor_id = pg_temp.p(3) and patrol_date = current_date + 2), 'untouched obligation voided';
  perform tpd.dpe_cancel_assignment(pg_temp.p(3), current_date - 1, 'Recorded in error by command');
  assert (select voided_at is null from tpd.dpe_obligations where supervisor_id = pg_temp.p(3) and patrol_date = current_date - 1), 'obligation with a report kept';
end $$;

-- 11. Command review, referrals and the two-step award approval.
do $$ declare rid uuid; begin
  select id into rid from tpd.dpe_reports where patrol_date = current_date - 2 and supervisor_id = pg_temp.p(1);
  perform tpd.dpe_review(rid, 'concern', 'referred', 'Refer to district lieutenant for coaching', pg_temp.p(8));
  perform pg_temp.expect_error(format($s$select tpd.dpe_review(%L, 'concern', 'referred', 'Not in this report at all', %L)$s$, rid, pg_temp.p(7)), '22023', 'concern must exist');
  perform pg_temp.expect_error(format($s$select tpd.dpe_review(%L, 'award_final', 'approved', 'Approving before endorsement', %L)$s$, rid, pg_temp.p(9)), '42501', 'captain cannot give final approval');
  perform tpd.dpe_review(rid, 'award_endorsement', 'endorsed', 'Strong lifesaving recommendation', pg_temp.p(9));
  perform pg_temp.expect_error(format($s$select tpd.dpe_review(%L, 'award_endorsement', 'endorsed', 'Endorsing a second time', %L)$s$, rid, pg_temp.p(9)), '23505', 'double endorsement');
  perform tpd.dpe_review(rid, 'report', 'reviewed', 'Report reviewed, actions recorded');
end $$;
select pg_temp.as_user(pg_temp.u(5)); -- Chief: final approval
do $$ declare rid uuid; begin
  select id into rid from tpd.dpe_reports where patrol_date = current_date - 2 and supervisor_id = pg_temp.p(1);
  perform pg_temp.expect_error(format($s$select tpd.dpe_review(%L, 'award_final', 'approved', 'Approved without naming the officer')$s$, rid), '22023', 'award decision needs the officer');
  perform tpd.dpe_review(rid, 'award_final', 'approved', 'Approved for the lifesaving recognition', pg_temp.p(9));
  assert (select count(*) from tpd.dpe_reviews where stage = 'award_final' and decision = 'approved') = 1, 'final approval recorded';
  perform pg_temp.expect_error(format($s$select tpd.dpe_review(%L, 'award_final', 'declined', 'Changing my mind later', %L)$s$, rid, pg_temp.p(9)), '23505', 'one final decision');
end $$;
-- The endorser cannot also give the final approval.
select pg_temp.as_user(pg_temp.u(1));
do $$ begin
  perform tpd.dpe_save_report(current_date - 3, 'amend', false,
    jsonb_build_array(jsonb_build_object('officer_id', pg_temp.p(7), 'category', 'award', 'justification', 'Talked down an armed subject safely', 'award_text', 'Commendation')),
    'Upgrading the observation to an award');
end $$;
select pg_temp.as_user(pg_temp.u(6)); -- Deputy Chief endorses
do $$ declare rid uuid; begin
  select id into rid from tpd.dpe_reports where patrol_date = current_date - 3 and supervisor_id = pg_temp.p(1);
  perform tpd.dpe_review(rid, 'award_endorsement', 'endorsed', 'Endorsed by the deputy chief', pg_temp.p(7));
  perform pg_temp.expect_error(format($s$select tpd.dpe_review(%L, 'award_final', 'approved', 'Approving my own endorsement', %L)$s$, rid, pg_temp.p(7)), '42501', 'endorser approves');
end $$;
select pg_temp.as_user(pg_temp.u(5));
do $$ begin
  perform tpd.dpe_review((select id from tpd.dpe_reports where patrol_date = current_date - 3 and supervisor_id = pg_temp.p(1)), 'award_final', 'declined', 'Declined: insufficient detail for a commendation', pg_temp.p(7));
end $$;

-- 12. Locks: a reviewed report cannot be amended by the author until command reopens it; reopening allows one amendment.
select pg_temp.as_user(pg_temp.u(1));
do $$ begin
  perform pg_temp.expect_error($s$select tpd.dpe_save_report(current_date - 2, 'amend', true, '[]'::jsonb, 'Trying to rewrite after review')$s$, '42501', 'reviewed report locked');
end $$;
select pg_temp.as_user(pg_temp.u(4));
do $$ begin perform tpd.dpe_review((select id from tpd.dpe_reports where patrol_date = current_date - 2 and supervisor_id = pg_temp.p(1)), 'reopen', 'reopened', 'Author asked to fix a call sign'); end $$;
select pg_temp.as_user(pg_temp.u(1));
do $$ declare e jsonb; begin
  select jsonb_agg(jsonb_build_object('officer_id', officer_id, 'category', category, 'justification', justification, 'award_text', award_text) order by position)
    into e from tpd.dpe_entries where report_id = (select id from tpd.dpe_reports where patrol_date = current_date - 2 and supervisor_id = pg_temp.p(1));
  perform tpd.dpe_save_report(current_date - 2, 'amend', false, e, 'Corrected wording after reopen');
  perform pg_temp.expect_error(format($s$select tpd.dpe_save_report(current_date - 2, 'amend', false, %L::jsonb, 'Second amendment needs a new reopen')$s$, e), '42501', 'reopen allows one amendment');
end $$;
reset role;

-- 13. Append-only: versions, reviews and audit events cannot be changed even by the table owner.
do $$ begin
  perform pg_temp.expect_error($s$update tpd.dpe_report_versions set reason = 'tampered'$s$, '42501', 'versions immutable');
  perform pg_temp.expect_error($s$delete from tpd.dpe_reviews$s$, '42501', 'reviews immutable');
  perform pg_temp.expect_error($s$update tpd.audit_log set action = 'tampered'$s$, '42501', 'audit immutable');
  assert (select count(*) from tpd.audit_log where action like 'dpe.%') >= 10, 'audit events written';
  assert exists (select 1 from tpd.audit_log where action = 'dpe.report_amended'), 'amendment audited';
end $$;

-- 14. History survives roster changes: renaming or promoting an officer does not change filed reports.
update tpd.personnel set name = 'O. Renamed', rank = 'Corporal' where id = pg_temp.p(7);
update tpd.personnel set rank = 'Captain' where id = pg_temp.p(1);
do $$ begin
  assert exists (select 1 from tpd.dpe_entries where officer_id = pg_temp.p(7) and officer_name = 'O. Seven' and officer_rank = 'Officer'), 'officer details kept as filed';
  assert (select count(*) from tpd.dpe_obligations where supervisor_id = pg_temp.p(1)) = 2, 'obligations kept after promotion';
  assert (select supervisor_rank from tpd.dpe_obligations where supervisor_id = pg_temp.p(1) limit 1) = 'Sergeant', 'rank at the time kept';
end $$;

-- 15. Export is command-only and audited; settings are interim and validated.
set role authenticated;
select pg_temp.as_user(pg_temp.u(4));
do $$ declare x jsonb; begin
  x := tpd.dpe_export(current_date - 7, current_date);
  assert jsonb_array_length(x) >= 4, 'export rows';
  perform pg_temp.expect_error($s$select tpd.dpe_update_settings('{"timezone":"Mars/Olympus"}', 'Testing an invalid zone')$s$, '22023', 'bad timezone');
  perform pg_temp.expect_error($s$select tpd.dpe_update_settings('{"min_patrol_minutes":30}', 'x')$s$, '22023', 'settings need a reason');
  assert (tpd.dpe_update_settings('{"min_patrol_minutes":30}', 'Leadership asked for 30 minutes') ->> 'interim')::boolean, 'still interim';
  perform tpd.dpe_update_settings('{"min_patrol_minutes":15}', 'Back to the interim default');
end $$;
reset role;
do $$ begin assert exists (select 1 from tpd.audit_log where action = 'dpe.exported'), 'export audited'; end $$;

select 'ALL DPE TESTS PASSED' as result;
