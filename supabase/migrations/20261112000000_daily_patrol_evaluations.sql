-- Daily Patrol Evaluations (DPE): one report per Sergeant or Lieutenant per assigned patrol day.
--
-- Replaces the Daily Patrol Report Google Doc. Field mapping to the old form:
--   Date                                -> dpe_obligations.patrol_date
--   Filing Supervisor (Rank and Name)   -> dpe_reports.author_rank / author_name (copied from the roster)
--   Call Sign                           -> dpe_reports.author_callsign (copied from the roster)
--   Exceeding Expectations              -> dpe_entries.category = 'exceeding'
--   Struggling / Needs Improvement      -> dpe_entries.category = 'needs_improvement'
--   Recommended for Award or Medal      -> dpe_entries.category = 'award'
--   Officer Name and Call Sign          -> dpe_entries.officer_name / officer_callsign (copied from the roster)
--   Recommended Award                   -> dpe_entries.award_id or award_text
--
-- Policy status: every value in tpd.dpe_settings is an INTERIM default (docs/POLICY_CONFLICTS.md PC-30..PC-37)
-- until leadership approves it. Nothing here issues or records discipline (HB §13.1); a "referral" only flags
-- an observation for the chain of command.
--
-- Security model, as in every other tpd migration:
--   * Signed-in users get SELECT only, filtered by RLS. All writes go through SECURITY DEFINER RPCs with a locked
--     search_path that derive the actor from Supabase Auth (never from the browser).
--   * Version history, review decisions and audit rows are append-only (trigger-enforced, also for the owner).
--   * Nothing here references the public schema (District Five).

-- ------------------------------------------------------------------ settings

create table if not exists tpd.dpe_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'America/New_York',
  day_start time not null default '04:00',
  deadline_day_offset int not null default 1 check (deadline_day_offset between 0 and 7),
  deadline_time time not null default '20:00',
  min_patrol_minutes int not null default 15 check (min_patrol_minutes between 1 and 720),
  amend_window_days int not null default 7 check (amend_window_days between 0 and 60),
  required_ranks text[] not null default array['Sergeant','Lieutenant'],
  eligible_ranks text[] not null default array['Corporal','Senior Officer','Officer','Reserve Officer','Probationary Officer'],
  interim boolean not null default true,
  updated_by uuid references tpd.personnel(id),
  updated_at timestamptz not null default now()
);
insert into tpd.dpe_settings (id) values (true) on conflict do nothing;

create or replace function tpd.dpe_cfg() returns tpd.dpe_settings
language sql stable security definer set search_path = '' as $$ select * from tpd.dpe_settings where id $$;

-- The patrol day a moment belongs to: local date in the configured zone, shifted by the day start.
-- 04:00 start: 2026-11-12 03:59 local -> 2026-11-11; 04:00 -> 2026-11-12.
create or replace function tpd.dpe_patrol_date(p_at timestamptz) returns date
language sql stable security definer set search_path = '' as $$
  select ((p_at at time zone c.timezone) - c.day_start::interval)::date from tpd.dpe_settings c where c.id
$$;

-- When the patrol day starts (inclusive) and ends (exclusive), as real instants. DST-safe: built from local wall time.
create or replace function tpd.dpe_day_start(p_date date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select (p_date + c.day_start) at time zone c.timezone from tpd.dpe_settings c where c.id
$$;
create or replace function tpd.dpe_day_end(p_date date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((p_date + 1) + c.day_start) at time zone c.timezone from tpd.dpe_settings c where c.id
$$;
create or replace function tpd.dpe_deadline(p_date date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((p_date + c.deadline_day_offset) + c.deadline_time) at time zone c.timezone from tpd.dpe_settings c where c.id
$$;

-- --------------------------------------------------------------- role helpers

create or replace function tpd.dpe_me() returns tpd.personnel
language sql stable security definer set search_path = '' as $$
  select p.* from tpd.personnel p where p.discord_id = tpd.current_discord_id() and p.status = 'active' and auth.uid() is not null
$$;

-- Must file daily reports (INTERIM PC-31: Sergeant and Lieutenant).
create or replace function tpd.dpe_is_reporter() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.rank = any(c.required_ranks) from tpd.dpe_me() m, tpd.dpe_settings c where c.id and m.id is not null), false)
$$;
-- Reviews reports, compliance and award endorsements (INTERIM PC-08/PC-34: Captain and above).
create or replace function tpd.dpe_is_reviewer() returns boolean
language sql stable security definer set search_path = '' as $$ select tpd.is_command() and auth.uid() is not null $$;
-- Final award approval (INTERIM PC-35: Office of the Chiefs).
create or replace function tpd.dpe_is_award_authority() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.rank in ('Chief of Police','Deputy Chief','Assistant Chief') from tpd.dpe_me() m where m.id is not null), false)
$$;

-- ------------------------------------------------------------------- tables

create table if not exists tpd.dpe_awards (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 2 and 80),
  description text not null default '' check (length(description) <= 500),
  active boolean not null default true,
  created_by uuid not null references tpd.personnel(id),
  created_at timestamptz not null default now()
);

-- Command-recorded patrol assignments: the authoritative source of reporting obligations.
create table if not exists tpd.dpe_assignments (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references tpd.personnel(id) on delete restrict,
  patrol_date date not null,
  note text not null default '' check (length(note) <= 500),
  created_by uuid not null references tpd.personnel(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references tpd.personnel(id),
  cancel_reason text,
  check ((cancelled_at is null and cancelled_by is null and cancel_reason is null)
      or (cancelled_at is not null and cancelled_by is not null and length(btrim(cancel_reason)) >= 10))
);
create unique index if not exists dpe_one_active_assignment on tpd.dpe_assignments(supervisor_id, patrol_date) where cancelled_at is null;

-- One row per supervisor per patrol day that requires a report. Never deleted; voided when its basis is withdrawn.
create table if not exists tpd.dpe_obligations (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references tpd.personnel(id) on delete restrict,
  patrol_date date not null,
  source text not null check (source in ('assignment','patrol')),
  supervisor_name text not null,
  supervisor_rank text not null,
  supervisor_callsign text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  unique (supervisor_id, patrol_date)
);
create index if not exists dpe_obligations_date on tpd.dpe_obligations(patrol_date desc);

create table if not exists tpd.dpe_excusals (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references tpd.personnel(id) on delete restrict,
  patrol_date date not null,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  granted_by uuid not null references tpd.personnel(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references tpd.personnel(id),
  revoke_reason text,
  check ((revoked_at is null and revoked_by is null and revoke_reason is null)
      or (revoked_at is not null and revoked_by is not null and length(btrim(revoke_reason)) >= 10))
);
create unique index if not exists dpe_one_active_excusal on tpd.dpe_excusals(supervisor_id, patrol_date) where revoked_at is null;

-- Exactly one report per obligation (draft, then submitted). The unique key is what blocks duplicate finals.
create table if not exists tpd.dpe_reports (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null unique references tpd.dpe_obligations(id) on delete restrict,
  supervisor_id uuid not null references tpd.personnel(id) on delete restrict,
  patrol_date date not null,
  status text not null default 'draft' check (status in ('draft','submitted')),
  no_observations boolean not null default false,
  version int not null default 0,
  author_name text not null,
  author_rank text not null,
  author_callsign text,
  first_submitted_at timestamptz,
  submitted_at timestamptz,
  late boolean not null default false,
  reopened_at timestamptz,
  reopened_by uuid references tpd.personnel(id),
  reviewed_at timestamptz,
  reviewed_by uuid references tpd.personnel(id),
  updated_at timestamptz not null default now(),
  check ((status = 'draft' and version = 0 and submitted_at is null) or (status = 'submitted' and version >= 1 and submitted_at is not null and first_submitted_at is not null))
);
create index if not exists dpe_reports_date on tpd.dpe_reports(patrol_date desc);

create table if not exists tpd.dpe_entries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references tpd.dpe_reports(id) on delete cascade,
  position int not null,
  officer_id uuid not null references tpd.personnel(id) on delete restrict,
  officer_name text not null,
  officer_rank text not null,
  officer_callsign text,
  category text not null check (category in ('exceeding','needs_improvement','award')),
  justification text not null default '' check (length(justification) <= 2000),
  award_id uuid references tpd.dpe_awards(id),
  award_text text check (award_text is null or length(award_text) <= 120),
  unique (report_id, officer_id, category),
  check (category = 'award' or (award_id is null and award_text is null))
);
create index if not exists dpe_entries_officer on tpd.dpe_entries(officer_id);

-- Append-only: the exact content of every submission and amendment.
create table if not exists tpd.dpe_report_versions (
  id bigint generated always as identity primary key,
  report_id uuid not null references tpd.dpe_reports(id) on delete restrict,
  version int not null,
  kind text not null check (kind in ('submitted','amended')),
  reason text,
  content jsonb not null,
  actor_id uuid not null references tpd.personnel(id),
  at timestamptz not null default now(),
  unique (report_id, version)
);

-- Append-only command decisions. Keyed by (report, officer, category) so they survive amendments.
create table if not exists tpd.dpe_reviews (
  id bigint generated always as identity primary key,
  report_id uuid not null references tpd.dpe_reports(id) on delete restrict,
  officer_id uuid references tpd.personnel(id),
  category text check (category in ('needs_improvement','award')),
  stage text not null check (stage in ('report','concern','award_endorsement','award_final','reopen')),
  decision text not null check (decision in ('reviewed','noted','referred','endorsed','declined','approved','reopened')),
  reason text not null check (length(btrim(reason)) between 10 and 2000),
  actor_id uuid not null references tpd.personnel(id),
  actor_name text not null,
  actor_rank text not null,
  at timestamptz not null default now()
);
create index if not exists dpe_reviews_report on tpd.dpe_reviews(report_id, at);

create or replace function tpd.dpe_forbid_change() returns trigger language plpgsql set search_path = '' as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
drop trigger if exists dpe_versions_append_only on tpd.dpe_report_versions;
create trigger dpe_versions_append_only before update or delete on tpd.dpe_report_versions for each row execute function tpd.dpe_forbid_change();
drop trigger if exists dpe_reviews_append_only on tpd.dpe_reviews;
create trigger dpe_reviews_append_only before update or delete on tpd.dpe_reviews for each row execute function tpd.dpe_forbid_change();
-- Audit events are written only by RPCs and the roster sync, never changed.
drop trigger if exists audit_log_append_only on tpd.audit_log;
create trigger audit_log_append_only before update or delete on tpd.audit_log for each row execute function tpd.dpe_forbid_change();

-- --------------------------------------------------------------------- RLS

alter table tpd.dpe_settings enable row level security;
alter table tpd.dpe_awards enable row level security;
alter table tpd.dpe_assignments enable row level security;
alter table tpd.dpe_obligations enable row level security;
alter table tpd.dpe_excusals enable row level security;
alter table tpd.dpe_reports enable row level security;
alter table tpd.dpe_entries enable row level security;
alter table tpd.dpe_report_versions enable row level security;
alter table tpd.dpe_reviews enable row level security;
revoke all on tpd.dpe_settings, tpd.dpe_awards, tpd.dpe_assignments, tpd.dpe_obligations, tpd.dpe_excusals,
  tpd.dpe_reports, tpd.dpe_entries, tpd.dpe_report_versions, tpd.dpe_reviews from public, anon, authenticated;
grant select on tpd.dpe_settings, tpd.dpe_awards, tpd.dpe_assignments, tpd.dpe_obligations, tpd.dpe_excusals,
  tpd.dpe_reports, tpd.dpe_entries, tpd.dpe_report_versions, tpd.dpe_reviews to authenticated;

drop policy if exists dpe_settings_read on tpd.dpe_settings;
create policy dpe_settings_read on tpd.dpe_settings for select to authenticated using (tpd.is_active_member());
drop policy if exists dpe_awards_read on tpd.dpe_awards;
create policy dpe_awards_read on tpd.dpe_awards for select to authenticated using (tpd.dpe_is_reporter() or tpd.dpe_is_reviewer());
drop policy if exists dpe_assignments_read on tpd.dpe_assignments;
create policy dpe_assignments_read on tpd.dpe_assignments for select to authenticated
  using (supervisor_id = (select m.id from tpd.dpe_me() m) or tpd.dpe_is_reviewer());
drop policy if exists dpe_obligations_read on tpd.dpe_obligations;
create policy dpe_obligations_read on tpd.dpe_obligations for select to authenticated
  using (supervisor_id = (select m.id from tpd.dpe_me() m) or tpd.dpe_is_reviewer());
drop policy if exists dpe_excusals_read on tpd.dpe_excusals;
create policy dpe_excusals_read on tpd.dpe_excusals for select to authenticated
  using (supervisor_id = (select m.id from tpd.dpe_me() m) or tpd.dpe_is_reviewer());
drop policy if exists dpe_reports_read on tpd.dpe_reports;
create policy dpe_reports_read on tpd.dpe_reports for select to authenticated
  using (supervisor_id = (select m.id from tpd.dpe_me() m) or tpd.dpe_is_reviewer());
drop policy if exists dpe_entries_read on tpd.dpe_entries;
create policy dpe_entries_read on tpd.dpe_entries for select to authenticated using (exists (
  select 1 from tpd.dpe_reports r where r.id = report_id
  and (r.supervisor_id = (select m.id from tpd.dpe_me() m) or tpd.dpe_is_reviewer())));
drop policy if exists dpe_versions_read on tpd.dpe_report_versions;
create policy dpe_versions_read on tpd.dpe_report_versions for select to authenticated using (exists (
  select 1 from tpd.dpe_reports r where r.id = report_id
  and (r.supervisor_id = (select m.id from tpd.dpe_me() m) or tpd.dpe_is_reviewer())));
-- Command decisions are visible to command only; evaluated officers never see entries about them.
drop policy if exists dpe_reviews_read on tpd.dpe_reviews;
create policy dpe_reviews_read on tpd.dpe_reviews for select to authenticated using (tpd.dpe_is_reviewer());

-- ------------------------------------------------------- obligation engine

-- Completed patrol minutes a member logged in one patrol day (sessions are attributed to the day they started).
create or replace function tpd.dpe_patrol_minutes(p_member uuid, p_date date) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(floor(sum(extract(epoch from (least(s.ended_at, s.started_at + interval '12 hours') - s.started_at))) / 60), 0)::int
  from tpd.patrol_sessions s
  where s.personnel_id = p_member and s.ended_at is not null
    and s.started_at >= tpd.dpe_day_start(p_date) and s.started_at < tpd.dpe_day_end(p_date)
$$;

-- Create (or restore) the obligation for one member and day when an active assignment exists, or, failing that,
-- when they patrolled at least the minimum. Only members whose current rank must report get obligations.
-- Returns the obligation id or null. Idempotent.
create or replace function tpd.dpe_ensure_obligation(p_member uuid, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c tpd.dpe_settings := tpd.dpe_cfg();
  m tpd.personnel;
  basis text;
  result uuid;
begin
  select * into m from tpd.personnel where id = p_member;
  if not found or m.status <> 'active' or not (m.rank = any(c.required_ranks)) then return null; end if;
  if exists (select 1 from tpd.dpe_assignments a where a.supervisor_id = p_member and a.patrol_date = p_date and a.cancelled_at is null) then
    basis := 'assignment';
  elsif tpd.dpe_patrol_minutes(p_member, p_date) >= c.min_patrol_minutes then
    basis := 'patrol';
  else
    return null;
  end if;
  insert into tpd.dpe_obligations (supervisor_id, patrol_date, source, supervisor_name, supervisor_rank, supervisor_callsign)
  values (p_member, p_date, basis, m.name, m.rank, m.callsign)
  on conflict (supervisor_id, patrol_date) do update
    set source = case when tpd.dpe_obligations.voided_at is not null or excluded.source = 'assignment' then excluded.source else tpd.dpe_obligations.source end,
        voided_at = null, void_reason = null
  returning id into result;
  return result;
end $$;
revoke all on function tpd.dpe_ensure_obligation(uuid, date) from public, anon, authenticated;

-- A finished patrol session may create the day's obligation. Runs inside end_patrol (already SECURITY DEFINER).
create or replace function tpd.dpe_after_patrol_end() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ended_at is not null and (tg_op = 'INSERT' or old.ended_at is null) then
    perform tpd.dpe_ensure_obligation(new.personnel_id, tpd.dpe_patrol_date(new.started_at));
  end if;
  return new;
end $$;
drop trigger if exists dpe_patrol_end on tpd.patrol_sessions;
create trigger dpe_patrol_end after insert or update of ended_at on tpd.patrol_sessions
  for each row execute function tpd.dpe_after_patrol_end();

-- Is the obligation excused (command excusal or approved leave of absence, HB §5.4)? Returns the reason or null.
create or replace function tpd.dpe_excuse_reason(p_member uuid, p_date date) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select 'Excused by command: ' || e.reason from tpd.dpe_excusals e
      where e.supervisor_id = p_member and e.patrol_date = p_date and e.revoked_at is null limit 1),
    (select 'Approved leave of absence' from tpd.member_requests r
      where r.requester_id = p_member and r.kind = 'Leave of absence' and r.status = 'approved'
        and p_date between r.leave_start and r.leave_end limit 1))
$$;

-- Status at a given moment: upcoming | not_started | draft | submitted | overdue | excused (+ late flag on reports).
create or replace function tpd.dpe_status_at(p_obligation tpd.dpe_obligations, p_report_status text, p_excused boolean, p_at timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_report_status = 'submitted' then 'submitted'
    when p_excused then 'excused'
    when p_at < tpd.dpe_day_start(p_obligation.patrol_date) then 'upcoming'
    when p_at >= tpd.dpe_deadline(p_obligation.patrol_date) then 'overdue'
    when p_report_status = 'draft' then 'draft'
    else 'not_started' end
$$;

-- One row per live (not voided) obligation in a date range, with computed status. Internal; callers check access.
create or replace function tpd.dpe_rows(p_from date, p_to date, p_member uuid, p_at timestamptz)
returns table (obligation_id uuid, supervisor_id uuid, patrol_date date, source text, supervisor_name text, supervisor_rank text,
  supervisor_callsign text, status text, deadline timestamptz, day_start timestamptz, report_id uuid, report_status text,
  no_observations boolean, entry_count int, submitted_at timestamptz, first_submitted_at timestamptz, late boolean,
  version int, reviewed_at timestamptz, excuse_reason text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.supervisor_id, o.patrol_date, o.source, o.supervisor_name, o.supervisor_rank, o.supervisor_callsign,
    tpd.dpe_status_at(o, r.status, x.reason is not null, p_at),
    tpd.dpe_deadline(o.patrol_date), tpd.dpe_day_start(o.patrol_date),
    r.id, r.status, r.no_observations, (select count(*)::int from tpd.dpe_entries e where e.report_id = r.id),
    r.submitted_at, r.first_submitted_at, coalesce(r.late, false), coalesce(r.version, 0), r.reviewed_at, x.reason
  from tpd.dpe_obligations o
  left join tpd.dpe_reports r on r.obligation_id = o.id
  cross join lateral (select tpd.dpe_excuse_reason(o.supervisor_id, o.patrol_date) as reason) x
  where o.voided_at is null and o.patrol_date between p_from and p_to
    and (p_member is null or o.supervisor_id = p_member)
  order by o.patrol_date desc, o.supervisor_name
$$;
revoke all on function tpd.dpe_rows(date, date, uuid, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------ supervisor RPCs

create or replace function tpd.dpe_my_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_me(); c tpd.dpe_settings := tpd.dpe_cfg(); today date := tpd.dpe_patrol_date(now());
begin
  if me.id is null then raise exception 'Active TPD membership required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'required', me.rank = any(c.required_ranks),
    'today', today,
    'now', now(),
    'settings', jsonb_build_object('timezone', c.timezone, 'day_start', c.day_start, 'deadline_day_offset', c.deadline_day_offset,
      'deadline_time', c.deadline_time, 'min_patrol_minutes', c.min_patrol_minutes, 'amend_window_days', c.amend_window_days, 'interim', c.interim),
    'supervisor', jsonb_build_object('id', me.id, 'name', me.name, 'rank', me.rank, 'callsign', me.callsign),
    'today_minutes', tpd.dpe_patrol_minutes(me.id, today),
    'rows', coalesce((select jsonb_agg(to_jsonb(r)) from tpd.dpe_rows(today - 60, today + 14, me.id, now()) r), '[]'::jsonb));
end $$;
revoke all on function tpd.dpe_my_overview() from public, anon;
grant execute on function tpd.dpe_my_overview() to authenticated;

-- A supervisor may open today's report before any patrol has been logged: the explicit start creates nothing unless
-- an assignment or qualifying patrol exists. Returns the obligation for the given day or raises.
create or replace function tpd.dpe_own_obligation(p_date date) returns tpd.dpe_obligations
language plpgsql security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_me(); o tpd.dpe_obligations;
begin
  if me.id is null then raise exception 'Active TPD membership required' using errcode = '42501'; end if;
  if not tpd.dpe_is_reporter() then raise exception 'Daily evaluations are filed by Sergeants and Lieutenants' using errcode = '42501'; end if;
  perform tpd.dpe_ensure_obligation(me.id, p_date);
  select * into o from tpd.dpe_obligations where supervisor_id = me.id and patrol_date = p_date and voided_at is null for update;
  if not found then raise exception 'No report is required for this patrol day' using errcode = '22023'; end if;
  return o;
end $$;
revoke all on function tpd.dpe_own_obligation(date) from public, anon, authenticated;

-- Officers a supervisor may evaluate: active, eligible (non-supervisory) rank, never the supervisor.
create or replace function tpd.dpe_eligible_officers(p_date date) returns table (id uuid, name text, callsign text, rank text, district text, patrolled boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_me(); c tpd.dpe_settings := tpd.dpe_cfg();
begin
  if me.id is null or not (tpd.dpe_is_reporter() or tpd.dpe_is_reviewer()) then
    raise exception 'Supervisor rank required' using errcode = '42501';
  end if;
  return query
    select p.id, p.name, p.callsign, p.rank, p.district,
      exists (select 1 from tpd.patrol_sessions s where s.personnel_id = p.id
        and s.started_at >= tpd.dpe_day_start(p_date) and s.started_at < tpd.dpe_day_end(p_date))
    from tpd.personnel p
    where p.status = 'active' and p.id <> me.id and p.rank = any(c.eligible_ranks)
    order by 6 desc, p.name;
end $$;
revoke all on function tpd.dpe_eligible_officers(date) from public, anon;
grant execute on function tpd.dpe_eligible_officers(date) to authenticated;

-- Validates and stores entries for a report (replacing the previous set). p_final enforces submission rules.
create or replace function tpd.dpe_write_entries(p_report tpd.dpe_reports, p_entries jsonb, p_final boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c tpd.dpe_settings := tpd.dpe_cfg();
  e jsonb; i int := 0; off tpd.personnel; aw tpd.dpe_awards; cat text; just text; atext text;
  snapshot jsonb := '[]'::jsonb;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception 'Entries must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_entries) > 40 then raise exception 'A report holds at most 40 observations' using errcode = '22023'; end if;
  delete from tpd.dpe_entries where report_id = p_report.id;
  for e in select * from jsonb_array_elements(p_entries) loop
    i := i + 1;
    cat := e ->> 'category';
    if cat is null or cat not in ('exceeding','needs_improvement','award') then raise exception 'Observation %: choose a category', i using errcode = '22023'; end if;
    select * into off from tpd.personnel where id = (e ->> 'officer_id')::uuid;
    if not found then raise exception 'Observation %: officer not found', i using errcode = '22023'; end if;
    if off.id = p_report.supervisor_id then raise exception 'Supervisors cannot evaluate themselves' using errcode = '42501'; end if;
    if off.status <> 'active' or not (off.rank = any(c.eligible_ranks)) then
      raise exception 'Observation %: % is not an eligible non-supervisory officer', i, off.name using errcode = '42501';
    end if;
    just := btrim(coalesce(e ->> 'justification', ''));
    if length(just) > 2000 then raise exception 'Observation %: justification is too long', i using errcode = '22023'; end if;
    if p_final and length(just) < 10 then raise exception 'Observation %: write a justification of at least 10 characters', i using errcode = '22023'; end if;
    aw := null; atext := nullif(btrim(coalesce(e ->> 'award_text', '')), '');
    if cat = 'award' then
      if nullif(e ->> 'award_id', '') is not null then
        select * into aw from tpd.dpe_awards where id = (e ->> 'award_id')::uuid and active;
        if not found then raise exception 'Observation %: that award is not available', i using errcode = '22023'; end if;
        atext := null;
      end if;
      if p_final and aw.id is null and atext is null then raise exception 'Observation %: choose or name the recommended award', i using errcode = '22023'; end if;
    else
      atext := null;
    end if;
    begin
      insert into tpd.dpe_entries (report_id, position, officer_id, officer_name, officer_rank, officer_callsign, category, justification, award_id, award_text)
      values (p_report.id, i, off.id, off.name, off.rank, off.callsign, cat, just, aw.id, atext);
    exception when unique_violation then
      raise exception 'Observation %: % is already listed in this category', i, off.name using errcode = '22023';
    end;
    snapshot := snapshot || jsonb_build_object('officer_id', off.id, 'officer_name', off.name, 'officer_rank', off.rank,
      'officer_callsign', off.callsign, 'category', cat, 'justification', just, 'award_id', aw.id, 'award', coalesce(aw.name, atext));
  end loop;
  return snapshot;
end $$;
revoke all on function tpd.dpe_write_entries(tpd.dpe_reports, jsonb, boolean) from public, anon, authenticated;

-- Save a draft, submit, or amend the caller's own report for one patrol day.
--   p_mode 'draft'  : creates/updates the draft (never touches a submitted report)
--   p_mode 'submit' : finalizes; a second submit for the same day is rejected
--   p_mode 'amend'  : replaces a submitted report's content with a recorded reason (author, within the window or after reopen)
create or replace function tpd.dpe_save_report(p_patrol_date date, p_mode text, p_no_observations boolean, p_entries jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me tpd.personnel := tpd.dpe_me();
  c tpd.dpe_settings := tpd.dpe_cfg();
  o tpd.dpe_obligations;
  r tpd.dpe_reports;
  snap jsonb;
  n int := coalesce(jsonb_array_length(case when jsonb_typeof(p_entries) = 'array' then p_entries end), 0);
begin
  if p_mode is null or p_mode not in ('draft','submit','amend') then raise exception 'Unknown action' using errcode = '22023'; end if;
  o := tpd.dpe_own_obligation(p_patrol_date); -- locks the obligation row: concurrent saves for one day serialize here
  if now() < tpd.dpe_day_start(o.patrol_date) then raise exception 'This patrol day has not started yet' using errcode = '22023'; end if;
  if p_no_observations and n > 0 then raise exception 'Remove the observations or untick "No notable observations"' using errcode = '22023'; end if;
  if p_mode <> 'draft' and not coalesce(p_no_observations, false) and n = 0 then
    raise exception 'Add at least one observation, or confirm "No notable observations"' using errcode = '22023';
  end if;

  select * into r from tpd.dpe_reports where obligation_id = o.id for update;
  if not found then
    if p_mode = 'amend' then raise exception 'There is no submitted report to amend' using errcode = '22023'; end if;
    insert into tpd.dpe_reports (obligation_id, supervisor_id, patrol_date, author_name, author_rank, author_callsign)
    values (o.id, me.id, o.patrol_date, me.name, me.rank, me.callsign) returning * into r;
  end if;

  if r.status = 'submitted' and p_mode <> 'amend' then
    raise exception 'A report for this patrol day has already been submitted. Use an amendment to correct it.' using errcode = '23505';
  end if;
  if p_mode = 'amend' then
    if r.status <> 'submitted' then raise exception 'Only a submitted report can be amended' using errcode = '22023'; end if;
    if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'An amendment needs a reason of at least 10 characters' using errcode = '22023'; end if;
    if r.reopened_at is null and (r.reviewed_at is not null or now() > r.first_submitted_at + make_interval(days => c.amend_window_days)) then
      raise exception 'This report is locked. Ask command staff to reopen it for an amendment.' using errcode = '42501';
    end if;
  end if;

  snap := tpd.dpe_write_entries(r, coalesce(p_entries, '[]'::jsonb), p_mode <> 'draft');

  if p_mode = 'draft' then
    update tpd.dpe_reports set no_observations = coalesce(p_no_observations, false), updated_at = now(),
      author_name = me.name, author_rank = me.rank, author_callsign = me.callsign
    where id = r.id returning * into r;
    return jsonb_build_object('report_id', r.id, 'status', r.status, 'version', r.version);
  end if;

  update tpd.dpe_reports set
    status = 'submitted', no_observations = coalesce(p_no_observations, false), version = r.version + 1,
    author_name = me.name, author_rank = me.rank, author_callsign = me.callsign,
    first_submitted_at = coalesce(r.first_submitted_at, now()), submitted_at = now(),
    late = case when r.first_submitted_at is null then now() >= tpd.dpe_deadline(o.patrol_date) else r.late end,
    reopened_at = null, reopened_by = null, updated_at = now()
  where id = r.id returning * into r;

  insert into tpd.dpe_report_versions (report_id, version, kind, reason, content, actor_id)
  values (r.id, r.version, case when p_mode = 'amend' then 'amended' else 'submitted' end,
    case when p_mode = 'amend' then btrim(p_reason) end,
    jsonb_build_object('patrol_date', r.patrol_date, 'author_name', r.author_name, 'author_rank', r.author_rank,
      'author_callsign', r.author_callsign, 'no_observations', r.no_observations, 'entries', snap),
    me.id);
  insert into tpd.audit_log (actor, action, target, detail)
  values (tpd.current_discord_id(), case when p_mode = 'amend' then 'dpe.report_amended' else 'dpe.report_submitted' end, r.id::text,
    jsonb_build_object('patrol_date', r.patrol_date, 'version', r.version, 'late', r.late, 'entries', n));
  return jsonb_build_object('report_id', r.id, 'status', r.status, 'version', r.version, 'late', r.late, 'submitted_at', r.submitted_at);
end $$;
revoke all on function tpd.dpe_save_report(date, text, boolean, jsonb, text) from public, anon;
grant execute on function tpd.dpe_save_report(date, text, boolean, jsonb, text) to authenticated;

-- -------------------------------------------------------------- command RPCs

create or replace function tpd.dpe_require_reviewer() returns tpd.personnel
language plpgsql stable security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_me();
begin
  if me.id is null or not tpd.dpe_is_reviewer() then raise exception 'Command authorization required' using errcode = '42501'; end if;
  return me;
end $$;
revoke all on function tpd.dpe_require_reviewer() from public, anon, authenticated;

create or replace function tpd.dpe_compliance(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_require_reviewer();
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'Choose a range of up to one year' using errcode = '22023'; end if;
  return jsonb_build_object('now', now(), 'today', tpd.dpe_patrol_date(now()),
    'rows', coalesce((select jsonb_agg(to_jsonb(r)) from tpd.dpe_rows(p_from, p_to, null, now()) r), '[]'::jsonb));
end $$;
revoke all on function tpd.dpe_compliance(date, date) from public, anon;
grant execute on function tpd.dpe_compliance(date, date) to authenticated;

-- Record patrol assignments for a supervisor (creates the obligations immediately).
create or replace function tpd.dpe_assign(p_supervisor uuid, p_dates date[], p_note text default '') returns int
language plpgsql security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_require_reviewer(); c tpd.dpe_settings := tpd.dpe_cfg(); s tpd.personnel; d date; n int := 0;
begin
  select * into s from tpd.personnel where id = p_supervisor and status = 'active';
  if not found or not (s.rank = any(c.required_ranks)) then raise exception 'Assignments are for active Sergeants and Lieutenants' using errcode = '22023'; end if;
  if p_dates is null or cardinality(p_dates) = 0 or cardinality(p_dates) > 62 then raise exception 'Choose between 1 and 62 days' using errcode = '22023'; end if;
  foreach d in array p_dates loop
    if d < tpd.dpe_patrol_date(now()) - 7 then raise exception 'Assignments cannot be back-dated more than 7 days' using errcode = '22023'; end if;
    insert into tpd.dpe_assignments (supervisor_id, patrol_date, note, created_by)
    values (s.id, d, left(coalesce(p_note, ''), 500), me.id) on conflict do nothing;
    if found then n := n + 1; end if;
    perform tpd.dpe_ensure_obligation(s.id, d);
  end loop;
  insert into tpd.audit_log (actor, action, target, detail)
  values (tpd.current_discord_id(), 'dpe.assigned', s.id::text, jsonb_build_object('dates', to_jsonb(p_dates), 'created', n));
  return n;
end $$;
revoke all on function tpd.dpe_assign(uuid, date[], text) from public, anon;
grant execute on function tpd.dpe_assign(uuid, date[], text) to authenticated;

-- Cancel an assignment. The obligation is voided only if nothing was written and no qualifying patrol exists.
create or replace function tpd.dpe_cancel_assignment(p_supervisor uuid, p_date date, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_require_reviewer(); c tpd.dpe_settings := tpd.dpe_cfg(); o tpd.dpe_obligations;
begin
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  update tpd.dpe_assignments set cancelled_at = now(), cancelled_by = me.id, cancel_reason = btrim(p_reason)
  where supervisor_id = p_supervisor and patrol_date = p_date and cancelled_at is null;
  if not found then raise exception 'No active assignment for that day' using errcode = '22023'; end if;
  select * into o from tpd.dpe_obligations where supervisor_id = p_supervisor and patrol_date = p_date for update;
  if found and o.voided_at is null then
    if tpd.dpe_patrol_minutes(p_supervisor, p_date) >= c.min_patrol_minutes then
      update tpd.dpe_obligations set source = 'patrol' where id = o.id;
    elsif not exists (select 1 from tpd.dpe_reports r where r.obligation_id = o.id) then
      update tpd.dpe_obligations set voided_at = now(), void_reason = 'Assignment cancelled: ' || btrim(p_reason) where id = o.id;
    end if;
  end if;
  insert into tpd.audit_log (actor, action, target, detail)
  values (tpd.current_discord_id(), 'dpe.assignment_cancelled', p_supervisor::text, jsonb_build_object('patrol_date', p_date, 'reason', btrim(p_reason)));
  return true;
end $$;
revoke all on function tpd.dpe_cancel_assignment(uuid, date, text) from public, anon;
grant execute on function tpd.dpe_cancel_assignment(uuid, date, text) to authenticated;

create or replace function tpd.dpe_excuse(p_supervisor uuid, p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_require_reviewer(); result uuid;
begin
  if p_supervisor = me.id then raise exception 'You cannot excuse your own reporting obligation' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  if not exists (select 1 from tpd.personnel where id = p_supervisor) then raise exception 'Supervisor not found' using errcode = '22023'; end if;
  insert into tpd.dpe_excusals (supervisor_id, patrol_date, reason, granted_by) values (p_supervisor, p_date, btrim(p_reason), me.id)
  returning id into result;
  insert into tpd.audit_log (actor, action, target, detail)
  values (tpd.current_discord_id(), 'dpe.excused', p_supervisor::text, jsonb_build_object('patrol_date', p_date, 'excusal_id', result));
  return result;
exception when unique_violation then
  raise exception 'That day is already excused' using errcode = '23505';
end $$;
revoke all on function tpd.dpe_excuse(uuid, date, text) from public, anon;
grant execute on function tpd.dpe_excuse(uuid, date, text) to authenticated;

create or replace function tpd.dpe_revoke_excusal(p_excusal uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_require_reviewer();
begin
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  update tpd.dpe_excusals set revoked_at = now(), revoked_by = me.id, revoke_reason = btrim(p_reason) where id = p_excusal and revoked_at is null;
  if not found then raise exception 'Excusal not found or already revoked' using errcode = '22023'; end if;
  insert into tpd.audit_log (actor, action, target, detail)
  values (tpd.current_discord_id(), 'dpe.excusal_revoked', p_excusal::text, jsonb_build_object('reason', btrim(p_reason)));
  return true;
end $$;
revoke all on function tpd.dpe_revoke_excusal(uuid, text) from public, anon;
grant execute on function tpd.dpe_revoke_excusal(uuid, text) to authenticated;

-- Command decisions on a submitted report. Separate stages, separate people, always with a reason.
--   report             : 'reviewed'                (Captain+)
--   concern            : 'noted' | 'referred'      (Captain+; a referral is NOT a disciplinary finding)
--   award_endorsement  : 'endorsed' | 'declined'   (Captain+)
--   award_final        : 'approved' | 'declined'   (Office of the Chiefs; must differ from the endorser)
--   reopen             : 'reopened'                (Captain+; lets the author amend once more)
create or replace function tpd.dpe_review(p_report uuid, p_stage text, p_decision text, p_reason text, p_officer uuid default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  me tpd.personnel := tpd.dpe_require_reviewer();
  r tpd.dpe_reports; cat text; result bigint; last_endorse tpd.dpe_reviews;
begin
  select * into r from tpd.dpe_reports where id = p_report for update;
  if not found or r.status <> 'submitted' then raise exception 'Only submitted reports can be reviewed' using errcode = '22023'; end if;
  if r.supervisor_id = me.id then raise exception 'You cannot review your own report' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  if p_officer = me.id then raise exception 'You cannot decide on an observation about yourself' using errcode = '42501'; end if;

  if p_stage = 'report' and p_decision = 'reviewed' then
    cat := null; p_officer := null;
    update tpd.dpe_reports set reviewed_at = now(), reviewed_by = me.id where id = r.id;
  elsif p_stage = 'reopen' and p_decision = 'reopened' then
    cat := null; p_officer := null;
    update tpd.dpe_reports set reopened_at = now(), reopened_by = me.id where id = r.id;
  elsif p_stage = 'concern' and p_decision in ('noted','referred') then
    cat := 'needs_improvement';
  elsif p_stage = 'award_endorsement' and p_decision in ('endorsed','declined') then
    cat := 'award';
    if exists (select 1 from tpd.dpe_reviews v where v.report_id = r.id and v.officer_id = p_officer and v.stage in ('award_endorsement','award_final')) then
      raise exception 'This recommendation already has a command decision' using errcode = '23505';
    end if;
  elsif p_stage = 'award_final' and p_decision in ('approved','declined') then
    cat := 'award';
    if not tpd.dpe_is_award_authority() then raise exception 'Final award decisions are made by the Office of the Chiefs' using errcode = '42501'; end if;
    select * into last_endorse from tpd.dpe_reviews v where v.report_id = r.id and v.officer_id = p_officer and v.stage = 'award_endorsement' order by v.at desc limit 1;
    if last_endorse.id is null or last_endorse.decision <> 'endorsed' then raise exception 'The recommendation must be endorsed first' using errcode = '22023'; end if;
    if last_endorse.actor_id = me.id then raise exception 'The final decision must come from someone other than the endorser' using errcode = '42501'; end if;
    if exists (select 1 from tpd.dpe_reviews v where v.report_id = r.id and v.officer_id = p_officer and v.stage = 'award_final') then
      raise exception 'This recommendation already has a final decision' using errcode = '23505';
    end if;
  else
    raise exception 'Unknown review decision' using errcode = '22023';
  end if;
  if cat is not null and not exists (select 1 from tpd.dpe_entries e where e.report_id = r.id and e.officer_id = p_officer and e.category = cat) then
    raise exception 'That observation is not in the current version of the report' using errcode = '22023';
  end if;

  insert into tpd.dpe_reviews (report_id, officer_id, category, stage, decision, reason, actor_id, actor_name, actor_rank)
  values (r.id, p_officer, cat, p_stage, p_decision, btrim(p_reason), me.id, me.name, me.rank) returning id into result;
  insert into tpd.audit_log (actor, action, target, detail)
  values (tpd.current_discord_id(), 'dpe.review_' || p_decision, r.id::text, jsonb_build_object('stage', p_stage, 'officer_id', p_officer));
  return result;
end $$;
revoke all on function tpd.dpe_review(uuid, text, text, text, uuid) from public, anon;
grant execute on function tpd.dpe_review(uuid, text, text, text, uuid) to authenticated;

-- Export authorized records for a date range. The export itself is an audit event.
create or replace function tpd.dpe_export(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_require_reviewer(); out jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'Choose a range of up to one year' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'patrol_date', r.patrol_date, 'supervisor', r.author_rank || ' ' || r.author_name, 'callsign', r.author_callsign,
    'submitted_at', r.submitted_at, 'late', r.late, 'version', r.version, 'no_observations', r.no_observations,
    'category', e.category, 'officer', e.officer_name, 'officer_callsign', e.officer_callsign, 'officer_rank', e.officer_rank,
    'award', coalesce(a.name, e.award_text), 'justification', e.justification) order by r.patrol_date, r.author_name, e.position), '[]'::jsonb)
  into out
  from tpd.dpe_reports r left join tpd.dpe_entries e on e.report_id = r.id left join tpd.dpe_awards a on a.id = e.award_id
  where r.status = 'submitted' and r.patrol_date between p_from and p_to;
  insert into tpd.audit_log (actor, action, target, detail)
  values (tpd.current_discord_id(), 'dpe.exported', null, jsonb_build_object('from', p_from, 'to', p_to, 'rows', jsonb_array_length(out)));
  return out;
end $$;
revoke all on function tpd.dpe_export(date, date) from public, anon;
grant execute on function tpd.dpe_export(date, date) to authenticated;

-- Award list maintenance. Leadership supplies the official list; it starts empty (nothing invented).
create or replace function tpd.dpe_save_award(p_name text, p_description text default '', p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_require_reviewer(); result uuid;
begin
  if p_name is null or length(btrim(p_name)) not between 2 and 80 then raise exception 'Award name must be 2 to 80 characters' using errcode = '22023'; end if;
  insert into tpd.dpe_awards (name, description, active, created_by) values (btrim(p_name), coalesce(p_description, ''), coalesce(p_active, true), me.id)
  on conflict (name) do update set description = excluded.description, active = excluded.active
  returning id into result;
  insert into tpd.audit_log (actor, action, target, detail)
  values (tpd.current_discord_id(), 'dpe.award_saved', result::text, jsonb_build_object('name', btrim(p_name), 'active', coalesce(p_active, true)));
  return result;
end $$;
revoke all on function tpd.dpe_save_award(text, text, boolean) from public, anon;
grant execute on function tpd.dpe_save_award(text, text, boolean) to authenticated;

-- Interim settings, editable by command with a recorded reason. Changing them does not rewrite submitted reports.
create or replace function tpd.dpe_update_settings(p jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_require_reviewer(); before jsonb; after tpd.dpe_settings;
begin
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  select to_jsonb(s) into before from tpd.dpe_settings s where s.id;
  update tpd.dpe_settings set
    timezone = coalesce(p ->> 'timezone', timezone),
    day_start = coalesce((p ->> 'day_start')::time, day_start),
    deadline_day_offset = coalesce((p ->> 'deadline_day_offset')::int, deadline_day_offset),
    deadline_time = coalesce((p ->> 'deadline_time')::time, deadline_time),
    min_patrol_minutes = coalesce((p ->> 'min_patrol_minutes')::int, min_patrol_minutes),
    amend_window_days = coalesce((p ->> 'amend_window_days')::int, amend_window_days),
    interim = coalesce((p ->> 'interim')::boolean, interim),
    updated_by = me.id, updated_at = now()
  where id returning * into after;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = after.timezone) then raise exception 'Unknown time zone' using errcode = '22023'; end if;
  insert into tpd.audit_log (actor, action, target, detail)
  values (tpd.current_discord_id(), 'dpe.settings_changed', null, jsonb_build_object('before', before, 'after', to_jsonb(after), 'reason', btrim(p_reason)));
  return to_jsonb(after);
end $$;
revoke all on function tpd.dpe_update_settings(jsonb, text) from public, anon;
grant execute on function tpd.dpe_update_settings(jsonb, text) to authenticated;

-- Recompute patrol-based obligations for a range (e.g. after activation, for sessions logged before this migration).
create or replace function tpd.dpe_refresh_obligations(p_from date, p_to date) returns int
language plpgsql security definer set search_path = '' as $$
declare me tpd.personnel := tpd.dpe_require_reviewer(); c tpd.dpe_settings := tpd.dpe_cfg(); s record; n int := 0;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then raise exception 'Choose a range of up to 62 days' using errcode = '22023'; end if;
  for s in select distinct p.id, tpd.dpe_patrol_date(ps.started_at) as d from tpd.patrol_sessions ps join tpd.personnel p on p.id = ps.personnel_id
    where ps.ended_at is not null and p.status = 'active' and p.rank = any(c.required_ranks)
      and ps.started_at >= tpd.dpe_day_start(p_from) and ps.started_at < tpd.dpe_day_end(p_to) loop
    if tpd.dpe_ensure_obligation(s.id, s.d) is not null then n := n + 1; end if;
  end loop;
  insert into tpd.audit_log (actor, action, target, detail)
  values (tpd.current_discord_id(), 'dpe.obligations_refreshed', null, jsonb_build_object('from', p_from, 'to', p_to, 'obligations', n));
  return n;
end $$;
revoke all on function tpd.dpe_refresh_obligations(date, date) from public, anon;
grant execute on function tpd.dpe_refresh_obligations(date, date) to authenticated;

-- Helper functions that only read settings are safe to expose; the internals above stay private.
revoke all on function tpd.dpe_cfg(), tpd.dpe_patrol_date(timestamptz), tpd.dpe_day_start(date), tpd.dpe_day_end(date), tpd.dpe_deadline(date),
  tpd.dpe_me(), tpd.dpe_is_reporter(), tpd.dpe_is_reviewer(), tpd.dpe_is_award_authority(), tpd.dpe_patrol_minutes(uuid, date),
  tpd.dpe_excuse_reason(uuid, date), tpd.dpe_status_at(tpd.dpe_obligations, text, boolean, timestamptz), tpd.dpe_forbid_change(),
  tpd.dpe_after_patrol_end() from public, anon;
grant execute on function tpd.dpe_patrol_date(timestamptz), tpd.dpe_day_start(date), tpd.dpe_day_end(date), tpd.dpe_deadline(date),
  tpd.dpe_is_reporter(), tpd.dpe_is_reviewer(), tpd.dpe_is_award_authority() to authenticated;
-- RLS policies call these as the signed-in role.
grant execute on function tpd.dpe_me() to authenticated;
