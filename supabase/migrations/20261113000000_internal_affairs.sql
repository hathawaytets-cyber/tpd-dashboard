-- Internal Affairs: complaint intake, case management and the SOP workflow.
--
-- Source of procedure: "TPD Internal Affairs Division SOP" (cited below as IA §n).
-- Where the SOP is silent, the rule used here is an INTERIM default listed in
-- docs/POLICY_CONFLICTS.md (IA-01 … IA-xx). Nothing here imposes discipline
-- automatically, and nothing writes to the Google Sheets roster.
--
-- Confidentiality model (IA §11)
--   * Only IA appointees, the Major over Administrative Operations (X-201), the
--     Deputy Chief (X-102) and the Chief of Police (X-101) can read IA records, and
--     only through the SECURITY DEFINER functions below. No IA table is granted to
--     anon or authenticated at all, so there is nothing to read directly.
--   * The accused member and a member complainant never see the case file.
--   * Escalated cases (IA §5) narrow the audience further: a complaint against an IA
--     member is visible to the Director and oversight only; against the Director, to
--     the Deputy Chief and Chief; against the Deputy Chief, to the Chief.
--   * IA keeps its own append-only audit trail (tpd.ia_audit_events). tpd.audit_log
--     is readable by every Captain and above, so IA never writes case details there.
--   * Notifications carry no case content.
--
-- IA appointments are stored separately from ranks (IA §12: appointed and removed by
-- the Deputy Chief). Oversight posts come from the roster position the member holds
-- (X-101, X-102, X-201), never from rank alone, so no Lieutenant, Captain or other
-- supervisor gains IA access by rank.
--
-- Public intake runs only through the ia-intake Edge Function (service role). Anonymous
-- visitors have no grant on any IA table or function.
--
-- Shares a Supabase project with District Five: everything lives in schema tpd and the
-- private storage bucket tpd-ia-evidence. Nothing in public is read or changed.

-- ------------------------------------------------------------------ vocab

create or replace function tpd.ia_categories() returns text[]
language sql immutable set search_path = '' as $$
  -- IA §3 scope
  select array['use_of_force','deadly_force','dishonesty','abuse_of_authority','uof_policy','handbook_policy','public_conduct','other']
$$;

create or replace function tpd.ia_disciplines() returns text[]
language sql immutable set search_path = '' as $$
  -- HB §13 ladder ("Infraction" per PC-20 naming); 'none' = sustained but no discipline.
  select array['none','Infraction','Strike','Blackmark','Suspension','Demotion','Termination']
$$;

-- ------------------------------------------------------------- appointments

create table tpd.ia_appointments (
  id uuid primary key default gen_random_uuid(),
  personnel_id uuid not null references tpd.personnel (id) on delete restrict,
  role text not null check (role in ('director', 'deputy_director', 'investigator')),
  callsign text not null check (callsign ~ '^IA-0[1-6]$'),
  appointed_by uuid not null references tpd.personnel (id) on delete restrict,
  appointed_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  ended_at timestamptz,
  ended_by uuid references tpd.personnel (id) on delete restrict,
  end_reason text,
  constraint ia_appointment_callsign_role check (
    (role = 'director' and callsign = 'IA-01') or (role = 'deputy_director' and callsign = 'IA-02')
    or (role = 'investigator' and callsign in ('IA-03', 'IA-04', 'IA-05', 'IA-06'))),
  constraint ia_appointment_end check ((ended_at is null) = (ended_by is null) and (ended_at is null or length(btrim(end_reason)) >= 10))
);
create unique index ia_appointment_one_per_member on tpd.ia_appointments (personnel_id) where ended_at is null;
create unique index ia_appointment_one_per_callsign on tpd.ia_appointments (callsign) where ended_at is null;

-- ------------------------------------------------------------------- cases

create sequence tpd.ia_case_seq;

create table tpd.ia_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  received_at timestamptz not null default now(),
  source text not null check (source in ('public', 'member', 'supervisor_referral', 'ia_opened', 'use_of_force_review')),
  status text not null default 'intake' check (status in (
    'intake', 'unassigned', 'investigating', 'director_review', 'deputy_chief_review', 'chief_review', 'closed', 'referred_external')),
  -- IA §5 escalation. 'ia' = normal IA handling.
  handler text not null default 'ia' check (handler in ('ia', 'ia_director', 'deputy_chief', 'chief', 'external')),
  category text not null check (category = any (tpd.ia_categories())),
  incident_date date,
  incident_time_approx text check (length(incident_time_approx) <= 40),
  location text check (length(location) <= 200),
  summary text not null check (length(btrim(summary)) between 5 and 200),
  description text not null check (length(btrim(description)) between 20 and 8000),
  reported_officer text check (length(reported_officer) <= 120),   -- as the complainant wrote it; unverified
  accused_id uuid references tpd.personnel (id) on delete restrict, -- verified link (server-side only)
  witnesses text check (length(witnesses) <= 4000),
  evidence_links text[] not null default '{}',
  assigned_investigator_id uuid references tpd.personnel (id) on delete restrict,
  assigned_at timestamptz,
  due_at timestamptz,                                                -- IA §6: 7 days from assignment
  accused_notice text check (accused_notice in ('notified', 'delayed')),
  accused_notice_at timestamptz,
  accused_notice_note text,
  criminal_referral_at timestamptz,                                  -- IA §7: admin interview stopped, DC notified
  criminal_referral_note text,
  criminal_decision text check (criminal_decision in ('opened', 'not_opened')),
  criminal_decision_at timestamptz,
  closed_at timestamptz,
  findings_notice_at timestamptz,                                    -- IA §7: member told the finding at close
  findings_notice_method text,
  -- Confidential routing (IA §5, §11). A public complaint cannot link a member, so the officer the
  -- complainant named is matched (text only) against IA staff and the oversight posts at intake. Anyone
  -- matched is kept out of the case until the lead links the verified member at intake review, and the
  -- case starts at the narrowest handler any match would need. 'verified' = linked to a personnel record.
  routing_basis text not null default 'none' check (routing_basis in ('none', 'text_match', 'verified')),
  provisional_excluded uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint ia_case_assignment check ((assigned_investigator_id is null) = (assigned_at is null)),
  constraint ia_case_links check (cardinality(evidence_links) <= 10)
);
create index ia_cases_status on tpd.ia_cases (status, received_at desc);

-- Complainant details (IA §4: anonymous allowed). Separate so they can be withheld.
create table tpd.ia_complainants (
  case_id uuid primary key references tpd.ia_cases (id) on delete restrict,
  anonymous boolean not null,
  name text check (length(name) <= 120),
  contact text check (length(contact) <= 200),
  member_id uuid references tpd.personnel (id) on delete restrict,  -- set only from a verified session
  constraint ia_anonymous_has_no_identity check (not anonymous or (name is null and contact is null and member_id is null))
);

-- Private receipt for the complainant. The token is shown once and stored only as a hash.
create table tpd.ia_receipts (
  case_id uuid primary key references tpd.ia_cases (id) on delete restrict,
  reference text not null unique check (reference ~ '^TPD-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  token_hash bytea not null,
  created_at timestamptz not null default now()
);

create table tpd.ia_allegations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references tpd.ia_cases (id) on delete restrict,
  ord int not null,
  category text not null check (category = any (tpd.ia_categories())),
  description text not null check (length(btrim(description)) between 5 and 2000),
  finding text check (finding in ('sustained', 'not_sustained', 'exonerated', 'unfounded')), -- IA §8
  finding_rationale text,
  recommended_discipline text check (recommended_discipline = any (tpd.ia_disciplines())),       -- IA §9: recommendation only
  finding_by uuid references tpd.personnel (id) on delete restrict,
  finding_at timestamptz,
  created_by uuid references tpd.personnel (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (case_id, ord),
  constraint ia_finding_complete check ((finding is null) = (finding_at is null) and (finding is null or length(btrim(finding_rationale)) >= 20)),
  constraint ia_recommendation_only_if_sustained check (recommended_discipline is null or finding = 'sustained')
);

create table tpd.ia_conflicts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references tpd.ia_cases (id) on delete restrict,
  personnel_id uuid not null references tpd.personnel (id) on delete restrict,
  kind text not null check (kind in ('declared_conflict', 'no_conflict_attested')),
  note text not null check (length(btrim(note)) between 5 and 1000),
  recorded_at timestamptz not null default now()
);
create index on tpd.ia_conflicts (case_id, personnel_id);

create table tpd.ia_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references tpd.ia_cases (id) on delete restrict,
  kind text not null check (kind in ('bodycam', 'anchorcad_record', 'report', 'screenshot', 'video', 'recording', 'document', 'link', 'other')),
  description text not null check (length(btrim(description)) between 3 and 1000),
  external_ref text check (length(external_ref) <= 500),   -- link or AnchorCAD record reference (text only)
  storage_path text unique,                                -- object in the private tpd-ia-evidence bucket
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 26214400),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  submitted_by_public boolean not null default false,
  added_by uuid references tpd.personnel (id) on delete restrict,
  added_at timestamptz not null default now()
);
create index on tpd.ia_evidence (case_id, added_at);

create table tpd.ia_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references tpd.ia_cases (id) on delete restrict,
  kind text not null check (kind in ('bodycam_preservation', 'evidence_preservation', 'roster_record_update')),
  detail text not null,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references tpd.personnel (id) on delete restrict,
  completion_note text,
  constraint ia_task_completion check ((completed_at is null) = (completed_by is null) and (completed_at is null or length(btrim(completion_note)) >= 5))
);
create index on tpd.ia_tasks (case_id) where completed_at is null;

create table tpd.ia_interviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references tpd.ia_cases (id) on delete restrict,
  kind text not null check (kind in ('complainant', 'witness', 'accused')),
  interviewee text not null check (length(btrim(interviewee)) between 2 and 120),
  conducted_by uuid not null references tpd.personnel (id) on delete restrict,
  conducted_at timestamptz not null,
  garrity_read_at timestamptz,               -- IA §7, accused only
  observer text check (length(observer) <= 120),
  summary text not null check (length(btrim(summary)) between 20 and 8000),
  recorded_at timestamptz not null default now(),
  constraint ia_garrity_before_accused_interview check (kind <> 'accused' or (garrity_read_at is not null and garrity_read_at <= conducted_at))
);

create table tpd.ia_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references tpd.ia_cases (id) on delete restrict,
  author_id uuid not null references tpd.personnel (id) on delete restrict,
  body text not null check (length(btrim(body)) between 2 and 8000),
  created_at timestamptz not null default now()
);

create table tpd.ia_reports (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references tpd.ia_cases (id) on delete restrict,
  version int not null,
  body text not null check (length(btrim(body)) between 100 and 30000),
  no_accused_interview_reason text,
  submitted_by uuid not null references tpd.personnel (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  unique (case_id, version)
);

create table tpd.ia_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references tpd.ia_cases (id) on delete restrict,
  stage text not null check (stage in ('director', 'chief_termination')),
  reviewer_id uuid not null references tpd.personnel (id) on delete restrict,
  outcome text not null check (outcome in ('approved', 'returned')),
  notes text not null check (length(btrim(notes)) between 10 and 4000),
  reviewed_at timestamptz not null default now()
);

-- IA §9: only the Deputy Chief decides; a termination also needs the Chief.
create table tpd.ia_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references tpd.ia_cases (id) on delete restrict,
  decided_by uuid not null references tpd.personnel (id) on delete restrict,
  decided_at timestamptz not null default now(),
  rationale text not null check (length(btrim(rationale)) between 10 and 4000),
  outcomes jsonb not null,   -- [{allegation_id, finding, discipline}] snapshot at decision time
  termination boolean not null,
  superseded_at timestamptz  -- set only when the Chief declines a termination and the DC must decide again
);

create table tpd.ia_disclosures (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references tpd.ia_cases (id) on delete restrict,
  audience text not null check (audience in ('complainant')),
  body text not null check (length(btrim(body)) between 10 and 1000),
  approved_by uuid not null references tpd.personnel (id) on delete restrict,
  approved_at timestamptz not null default now()
);

create table tpd.ia_notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references tpd.personnel (id) on delete restrict,
  kind text not null check (kind in ('new_complaint', 'assignment', 'review_due', 'decision_due', 'termination_approval', 'conflict_declared', 'roster_update_due', 'criminal_referral')),
  case_id uuid references tpd.ia_cases (id) on delete restrict,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index on tpd.ia_notifications (recipient_id, created_at desc);

create table tpd.ia_audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  case_id uuid references tpd.ia_cases (id) on delete restrict,
  actor_id uuid references tpd.personnel (id) on delete restrict,
  actor_label text not null, -- 'personnel', 'system:ia-intake', 'public'
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
create index on tpd.ia_audit_events (case_id, at);

create table tpd.ia_intake_throttle (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

-- -------------------------------------------------------- immutability

create or replace function tpd.ia_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Internal Affairs records are append-only (%)', tg_table_name using errcode = '42501';
end $$;

create trigger ia_audit_append_only before update or delete on tpd.ia_audit_events for each row execute function tpd.ia_append_only();
create trigger ia_notes_append_only before update or delete on tpd.ia_notes for each row execute function tpd.ia_append_only();
create trigger ia_interviews_append_only before update or delete on tpd.ia_interviews for each row execute function tpd.ia_append_only();
create trigger ia_reports_append_only before update or delete on tpd.ia_reports for each row execute function tpd.ia_append_only();
create trigger ia_reviews_append_only before update or delete on tpd.ia_reviews for each row execute function tpd.ia_append_only();
create trigger ia_disclosures_append_only before update or delete on tpd.ia_disclosures for each row execute function tpd.ia_append_only();
create trigger ia_evidence_append_only before update or delete on tpd.ia_evidence for each row execute function tpd.ia_append_only();
create trigger ia_conflicts_append_only before update or delete on tpd.ia_conflicts for each row execute function tpd.ia_append_only();
create trigger ia_complainants_append_only before update or delete on tpd.ia_complainants for each row execute function tpd.ia_append_only();
create trigger ia_receipts_append_only before update or delete on tpd.ia_receipts for each row execute function tpd.ia_append_only();
create trigger ia_cases_no_delete before delete on tpd.ia_cases for each row execute function tpd.ia_append_only();     -- IA §11: kept for the life of the department
create trigger ia_allegations_no_delete before delete on tpd.ia_allegations for each row execute function tpd.ia_append_only();
create trigger ia_tasks_no_delete before delete on tpd.ia_tasks for each row execute function tpd.ia_append_only();
create trigger ia_appointments_no_delete before delete on tpd.ia_appointments for each row execute function tpd.ia_append_only();

-- A decision may only gain superseded_at (Chief declined a termination); nothing else changes.
create or replace function tpd.ia_decisions_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'IA decisions cannot be deleted' using errcode = '42501'; end if;
  if (new.case_id, new.decided_by, new.decided_at, new.rationale, new.outcomes, new.termination)
     is distinct from (old.case_id, old.decided_by, old.decided_at, old.rationale, old.outcomes, old.termination)
     or old.superseded_at is not null or new.superseded_at is null then
    raise exception 'IA decisions are final' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger ia_decisions_final before update or delete on tpd.ia_decisions for each row execute function tpd.ia_decisions_guard();

-- Findings change only while the case is under investigation (a returned report reopens it).
create or replace function tpd.ia_allegations_guard() returns trigger
language plpgsql set search_path = '' as $$
declare s text;
begin
  select status into s from tpd.ia_cases where id = new.case_id;
  if (new.finding, new.finding_rationale, new.recommended_discipline, new.description, new.category)
     is distinct from (old.finding, old.finding_rationale, old.recommended_discipline, old.description, old.category)
     and s not in ('intake', 'unassigned', 'investigating') then
    raise exception 'Findings are locked once the report is submitted' using errcode = '42501';
  end if;
  if new.case_id <> old.case_id or new.id <> old.id then raise exception 'Allegations cannot move' using errcode = '42501'; end if;
  return new;
end $$;
create trigger ia_allegations_locked before update on tpd.ia_allegations for each row execute function tpd.ia_allegations_guard();

-- A closed case never reopens or changes, except the post-closure notice fields.
create or replace function tpd.ia_cases_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status in ('closed', 'referred_external') then
    if (to_jsonb(new) - array['findings_notice_at', 'findings_notice_method', 'updated_at'])
       is distinct from (to_jsonb(old) - array['findings_notice_at', 'findings_notice_method', 'updated_at']) then
      raise exception 'Closed IA cases are read-only' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger ia_cases_closed_readonly before update on tpd.ia_cases for each row execute function tpd.ia_cases_guard();

-- ------------------------------------------------------------- identity

-- Active personnel id of the signed-in user, or null.
create or replace function tpd.ia_me() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from tpd.personnel p where p.discord_id = tpd.current_discord_id() and p.status = 'active' and auth.uid() is not null
$$;

create or replace function tpd.ia_role_of(p_personnel uuid) returns text
language sql stable security definer set search_path = '' as $$
  select a.role from tpd.ia_appointments a join tpd.personnel p on p.id = a.personnel_id
  where a.personnel_id = p_personnel and a.ended_at is null and p.status = 'active'
$$;

-- Oversight post held on the verified roster (IA §2). Rank alone never qualifies.
create or replace function tpd.ia_post_of(p_personnel uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from tpd.positions x join tpd.personnel p on p.id = x.personnel_id where x.callsign = 'X-101' and p.id = p_personnel and p.status = 'active') then 'chief'
    when exists (select 1 from tpd.positions x join tpd.personnel p on p.id = x.personnel_id where x.callsign = 'X-102' and p.id = p_personnel and p.status = 'active') then 'deputy_chief'
    when exists (select 1 from tpd.positions x join tpd.personnel p on p.id = x.personnel_id where x.callsign = 'X-201' and p.id = p_personnel and p.status = 'active') then 'major_admin'
  end
$$;

create or replace function tpd.ia_holder(p_post text) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from tpd.positions x join tpd.personnel p on p.id = x.personnel_id
  where p.status = 'active' and x.callsign = case p_post when 'chief' then 'X-101' when 'deputy_chief' then 'X-102' when 'major_admin' then 'X-201' end
  limit 1
$$;

create or replace function tpd.ia_appointee(p_role text) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.personnel_id from tpd.ia_appointments a join tpd.personnel p on p.id = a.personnel_id
  where a.role = p_role and a.ended_at is null and p.status = 'active' limit 1
$$;

-- Who leads IA right now: the Director, or the Deputy Director while the Director post is vacant (IA §2).
create or replace function tpd.ia_acting_director() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(tpd.ia_appointee('director'), tpd.ia_appointee('deputy_director'))
$$;

-- IA §5 escalation: who handles a complaint against this member.
create or replace function tpd.ia_handler_for(p_accused uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_accused is null then 'ia'
    when tpd.ia_post_of(p_accused) = 'chief' then 'external'
    when tpd.ia_post_of(p_accused) = 'deputy_chief' then 'chief'
    -- IA-09 (interim): IA reports to the Major X-201 (IA §2), so IA staff would be investigating their own
    -- supervisor, which IA §5 forbids. The Deputy Chief, who oversees IA, handles it, as for the Director.
    when tpd.ia_post_of(p_accused) = 'major_admin' then 'deputy_chief'
    when tpd.ia_role_of(p_accused) = 'director' then 'deputy_chief'
    when tpd.ia_role_of(p_accused) is not null then 'ia_director'
    else 'ia'
  end
$$;

-- The person who leads the case for a given handler level.
create or replace function tpd.ia_lead_for(p_handler text) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_handler
    when 'ia' then tpd.ia_acting_director()
    when 'ia_director' then tpd.ia_appointee('director')
    when 'deputy_chief' then tpd.ia_holder('deputy_chief')
    when 'chief' then tpd.ia_holder('chief')
    when 'external' then tpd.ia_holder('deputy_chief') -- records the referral only (IA-07)
  end
$$;

-- Can this member read this case? (IA §11 + §5)
create or replace function tpd.ia_can_view_as(p_personnel uuid, p_case uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare c tpd.ia_cases; post text; role text;
begin
  if p_personnel is null then return false; end if;
  select * into c from tpd.ia_cases where id = p_case;
  if not found then return false; end if;
  if c.accused_id = p_personnel then return false; end if;
  if p_personnel = any (c.provisional_excluded) then return false; end if;
  if exists (select 1 from tpd.ia_complainants k where k.case_id = p_case and k.member_id = p_personnel) then return false; end if;
  post := tpd.ia_post_of(p_personnel);
  role := tpd.ia_role_of(p_personnel);
  return coalesce(case c.handler
    when 'ia' then (post is not null or role is not null)
      and not exists (select 1 from tpd.ia_conflicts f where f.case_id = p_case and f.personnel_id = p_personnel and f.kind = 'declared_conflict')
    when 'ia_director' then post is not null or role = 'director'
    when 'deputy_chief' then post in ('deputy_chief', 'chief')
    when 'chief' then post = 'chief'
    when 'external' then post = 'deputy_chief'
    else false
  end, false);
end $$;

create or replace function tpd.ia_can_view(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select tpd.ia_can_view_as(tpd.ia_me(), p_case)
$$;

-- Lead of this case: may assign, extend, add allegations, link the accused.
create or replace function tpd.ia_is_lead(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select tpd.ia_me() is not null and tpd.ia_can_view(p_case)
    and tpd.ia_me() = (select tpd.ia_lead_for(c.handler) from tpd.ia_cases c where c.id = p_case)
$$;

-- Case worker: the assigned investigator, or the lead.
create or replace function tpd.ia_is_worker(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select tpd.ia_can_view(p_case) and (
    tpd.ia_is_lead(p_case)
    or tpd.ia_me() = (select c.assigned_investigator_id from tpd.ia_cases c where c.id = p_case))
$$;

-- --------------------------------------------------------------- helpers

create or replace function tpd.ia_log(p_case uuid, p_action text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into tpd.ia_audit_events (case_id, actor_id, actor_label, action, detail)
  values (p_case, tpd.ia_me(), case when tpd.ia_me() is null then 'system:ia-intake' else 'personnel' end, p_action, coalesce(p_detail, '{}'::jsonb))
$$;

create or replace function tpd.ia_notify(p_recipient uuid, p_kind text, p_case uuid) returns void
language sql security definer set search_path = '' as $$
  insert into tpd.ia_notifications (recipient_id, kind, case_id)
  select p_recipient, p_kind, p_case
  where p_recipient is not null and tpd.ia_can_view_as(p_recipient, p_case)
$$;

-- Generic intake alert to whoever handles the case; oversight is told if that post is vacant.
create or replace function tpd.ia_alert_intake(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases; lead uuid;
begin
  select * into c from tpd.ia_cases where id = p_case;
  lead := tpd.ia_lead_for(c.handler);
  if c.handler = 'ia' then
    perform tpd.ia_notify(tpd.ia_appointee('director'), 'new_complaint', p_case);
    perform tpd.ia_notify(tpd.ia_appointee('deputy_director'), 'new_complaint', p_case);
  else
    perform tpd.ia_notify(lead, 'new_complaint', p_case);
  end if;
  if lead is null then
    perform tpd.ia_notify(tpd.ia_holder('major_admin'), 'new_complaint', p_case);
    perform tpd.ia_notify(tpd.ia_holder('deputy_chief'), 'new_complaint', p_case);
  end if;
end $$;

create or replace function tpd.ia_require(p_ok boolean, p_message text, p_code text default '42501') returns void
language plpgsql volatile set search_path = '' as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_message using errcode = p_code; end if;
end $$;

-- Crockford base32 reference like TPD-7KQ3-M9PX (40 random bits; the token is what protects it).
create or replace function tpd.ia_new_reference() returns text
language plpgsql volatile set search_path = '' as $$
declare alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex'); s text := ''; i int;
begin
  for i in 0..7 loop s := s || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
  return 'TPD-' || substr(s, 1, 4) || '-' || substr(s, 5, 4);
end $$;

-- Members with IA access (appointees and oversight posts) whose name, roster call sign or IA call sign
-- appears in the complainant's free text. Matching only ever narrows who can see a case.
create or replace function tpd.ia_text_matches(p_text text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  with staff as (
    select p.id, p.name, p.callsign, a.callsign as ia_callsign
    from tpd.personnel p left join tpd.ia_appointments a on a.personnel_id = p.id and a.ended_at is null
    where p.status = 'active' and (a.id is not null or tpd.ia_post_of(p.id) is not null)
  ), terms as (
    select id, t from staff, lateral (values (name), (callsign), (ia_callsign),
      -- surname of "J. Example" style roleplay names, if it is long enough to be meaningful
      (nullif(regexp_replace(name, '^.*[\s.]', ''), ''))) v(t)
    where t is not null and length(t) >= 3
  )
  select coalesce(array_agg(distinct id), '{}') from terms
  where nullif(btrim(p_text), '') is not null
    and p_text ~* ('(^|[^[:alnum:]])' || regexp_replace(t, '([.*+?^${}()|\[\]\\-])', '\\\1', 'g') || '($|[^[:alnum:]])')
$$;

-- Narrowest IA §5 handler needed for any of these members.
create or replace function tpd.ia_narrowest_handler(p_members uuid[]) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select h from unnest(p_members) m, lateral (select tpd.ia_handler_for(m) as h) x
    order by array_position(array['ia', 'ia_director', 'deputy_chief', 'chief', 'external'], h) desc limit 1), 'ia')
$$;

-- ------------------------------------------------------------ intake

-- Called only by the ia-intake Edge Function (service role) after it validated the
-- request shape. Everything is validated again here. p_client_key is an HMAC of the
-- caller's address computed in the function (no raw IPs stored). p_user is the
-- verified Supabase user id of a signed-in member, or null for a public complaint.
create or replace function tpd.ia_intake_submit(p jsonb, p_client_key text, p_user uuid, p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member tpd.personnel;
  accused uuid;
  src text := 'public';
  v_case uuid;
  ref text;
  v_hits int;
  v_hour timestamptz := date_trunc('hour', now());
  v_anon boolean := coalesce((p ->> 'anonymous')::boolean, false);
  cat text := p ->> 'category';
  links text[];
  incident date;
  bodycam_due timestamptz;
  matched uuid[] := '{}';
  v_handler text;
begin
  perform tpd.ia_require(p_client_key ~ '^[0-9a-f]{64}$', 'invalid client key', '22023');
  perform tpd.ia_require(octet_length(p_token_hash) = 32, 'invalid token hash', '22023');
  -- Rate limits: 3 per client per hour, 8 per client per day, 60 overall per hour.
  insert into tpd.ia_intake_throttle (bucket, window_start, hits) values ('c:' || p_client_key, v_hour, 1)
    on conflict (bucket, window_start) do update set hits = tpd.ia_intake_throttle.hits + 1 returning tpd.ia_intake_throttle.hits into v_hits;
  if v_hits > 3 or (select coalesce(sum(t.hits), 0) from tpd.ia_intake_throttle t where t.bucket = 'c:' || p_client_key and t.window_start > now() - interval '24 hours') > 8 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  insert into tpd.ia_intake_throttle (bucket, window_start, hits) values ('all', v_hour, 1)
    on conflict (bucket, window_start) do update set hits = tpd.ia_intake_throttle.hits + 1 returning tpd.ia_intake_throttle.hits into v_hits;
  if v_hits > 60 then raise exception 'rate_limited' using errcode = 'PT429'; end if;
  delete from tpd.ia_intake_throttle where window_start < now() - interval '2 days';

  perform tpd.ia_require(cat = any (tpd.ia_categories()), 'invalid category', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p ->> 'summary', ''))) between 5 and 200, 'invalid summary', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p ->> 'description', ''))) between 20 and 8000, 'invalid description', '22023');
  perform tpd.ia_require(length(coalesce(p ->> 'location', '')) <= 200 and length(coalesce(p ->> 'incidentTime', '')) <= 40
    and length(coalesce(p ->> 'officer', '')) <= 120 and length(coalesce(p ->> 'witnesses', '')) <= 4000
    and length(coalesce(p ->> 'name', '')) <= 120 and length(coalesce(p ->> 'contact', '')) <= 200, 'field too long', '22023');
  if p ? 'incidentDate' and nullif(p ->> 'incidentDate', '') is not null then
    begin incident := (p ->> 'incidentDate')::date; exception when others then raise exception 'invalid date' using errcode = '22023'; end;
    perform tpd.ia_require(incident <= current_date + 1 and incident >= current_date - 365, 'invalid date', '22023');
  end if;
  select coalesce(array_agg(btrim(v)), '{}') into links from jsonb_array_elements_text(coalesce(p -> 'evidenceLinks', '[]'::jsonb)) v where btrim(v) <> '';
  perform tpd.ia_require(cardinality(links) <= 10, 'too many links', '22023');
  perform tpd.ia_require(not exists (select 1 from unnest(links) l where (l !~ '^https://[^\s/$.?#][^\s]*$' or length(l) > 500)), 'invalid link', '22023');

  -- Signed-in member: identity comes from Supabase Auth, never from the payload.
  if p_user is not null then
    select pr.* into member from tpd.personnel pr join auth.identities i on i.provider_id = pr.discord_id and i.provider = 'discord'
    where i.user_id = p_user and pr.status = 'active' limit 1;
    if found then
      src := case when coalesce((p ->> 'referral')::boolean, false) and tpd.rank_at_least(member.rank, 'Sergeant') then 'supervisor_referral' else 'member' end;
      if nullif(p ->> 'officerId', '') is not null then
        begin accused := (p ->> 'officerId')::uuid; exception when others then raise exception 'invalid officer' using errcode = '22023'; end;
        perform tpd.ia_require(exists (select 1 from tpd.personnel x where x.id = accused and x.status = 'active'), 'invalid officer', '22023');
        perform tpd.ia_require(accused <> member.id, 'invalid officer', '22023');
      end if;
    end if;
  end if;
  -- A public payload can never link a personnel record; IA links it after review.
  if src = 'public' and nullif(p ->> 'officerId', '') is not null then raise exception 'invalid officer' using errcode = '22023'; end if;

  -- Confidential routing: with no verified member, match the named officer against IA staff and oversight.
  if accused is null then
    matched := tpd.ia_text_matches(coalesce(p ->> 'officer', '') || ' ' || coalesce(p ->> 'summary', ''));
  end if;
  v_handler := case when accused is not null then tpd.ia_handler_for(accused) else tpd.ia_narrowest_handler(matched) end;
  if cardinality(matched) > 0 then
    -- The person who must lead the case is never locked out of it (they outrank everyone matched).
    matched := array_remove(matched, tpd.ia_lead_for(v_handler));
  end if;

  insert into tpd.ia_cases (case_number, source, handler, category, incident_date, incident_time_approx, location, summary, description,
                            reported_officer, accused_id, witnesses, evidence_links, routing_basis, provisional_excluded)
  values ('IA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('tpd.ia_case_seq')::text, 4, '0'), src, v_handler, cat,
          incident, nullif(btrim(coalesce(p ->> 'incidentTime', '')), ''), nullif(btrim(coalesce(p ->> 'location', '')), ''),
          btrim(p ->> 'summary'), btrim(p ->> 'description'), nullif(btrim(coalesce(p ->> 'officer', '')), ''), accused,
          nullif(btrim(coalesce(p ->> 'witnesses', '')), ''), links,
          case when accused is not null then 'verified' when cardinality(matched) > 0 or v_handler <> 'ia' then 'text_match' else 'none' end, matched)
  returning id into v_case;

  insert into tpd.ia_complainants (case_id, anonymous, name, contact, member_id)
  values (v_case, v_anon,
    case when v_anon then null else nullif(btrim(coalesce(p ->> 'name', '')), '') end,
    case when v_anon then null else nullif(btrim(coalesce(p ->> 'contact', '')), '') end,
    case when v_anon then null else member.id end);

  insert into tpd.ia_allegations (case_id, ord, category, description)
  values (v_case, 1, cat, left(btrim(p ->> 'summary'), 2000));

  -- IA §4: bodycam is kept 7 days, so preservation is requested the day the complaint is logged.
  bodycam_due := least(now() + interval '24 hours', coalesce(incident::timestamptz + interval '7 days', now() + interval '24 hours'));
  insert into tpd.ia_tasks (case_id, kind, detail, due_at) values
    (v_case, 'bodycam_preservation', 'Request and save bodycam footage the same day the complaint is logged (IA §4). Footage is kept 7 days.', greatest(bodycam_due, now())),
    (v_case, 'evidence_preservation', 'Preserve AnchorCAD logs, reports, screenshots and recordings (IA §6).', now() + interval '48 hours');

  loop
    ref := tpd.ia_new_reference();
    begin
      insert into tpd.ia_receipts (case_id, reference, token_hash) values (v_case, ref, p_token_hash);
      exit;
    exception when unique_violation then null;
    end;
  end loop;

  insert into tpd.ia_audit_events (case_id, actor_id, actor_label, action, detail)
  values (v_case, null, 'system:ia-intake', 'case.received',
          jsonb_build_object('source', src, 'anonymous', v_anon, 'links', cardinality(links), 'verified_officer', accused is not null,
                             'handler', v_handler, 'provisional_exclusions', cardinality(matched)));
  perform tpd.ia_alert_intake(v_case);

  return jsonb_build_object('case_id', v_case, 'reference', ref);
end $$;

-- Evidence file registered by the Edge Function after it stored the object.
create or replace function tpd.ia_intake_attach(p_case uuid, p_path text, p_mime text, p_size bigint, p_sha256 text, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare eid uuid;
begin
  perform tpd.ia_require((select count(*) from tpd.ia_evidence where case_id = p_case and submitted_by_public) < 5, 'too many files', '22023');
  perform tpd.ia_require((select received_at from tpd.ia_cases where id = p_case) > now() - interval '30 minutes', 'upload window closed', '22023');
  perform tpd.ia_require(p_mime in ('image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf'), 'file type not allowed', '22023');
  insert into tpd.ia_evidence (case_id, kind, description, storage_path, mime_type, size_bytes, sha256, submitted_by_public)
  values (p_case, case when p_mime like 'video/%' then 'video' when p_mime = 'application/pdf' then 'document' else 'screenshot' end,
          coalesce(nullif(btrim(p_description), ''), 'Submitted with the complaint'), p_path, p_mime, p_size, p_sha256, true)
  returning id into eid;
  insert into tpd.ia_audit_events (case_id, actor_label, action, detail)
  values (p_case, 'system:ia-intake', 'evidence.received', jsonb_build_object('evidence_id', eid, 'mime', p_mime, 'size', p_size));
  return eid;
end $$;

-- Private receipt lookup. Returns only coarse status and any approved disclosure.
create or replace function tpd.ia_receipt_status(p_reference text, p_token_hash bytea, p_client_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r tpd.ia_receipts; c tpd.ia_cases; v_hits int;
begin
  perform tpd.ia_require(p_client_key ~ '^[0-9a-f]{64}$', 'invalid client key', '22023');
  insert into tpd.ia_intake_throttle (bucket, window_start, hits) values ('s:' || p_client_key, date_trunc('hour', now()), 1)
    on conflict (bucket, window_start) do update set hits = tpd.ia_intake_throttle.hits + 1 returning tpd.ia_intake_throttle.hits into v_hits;
  if v_hits > 20 then raise exception 'rate_limited' using errcode = 'PT429'; end if;
  select * into r from tpd.ia_receipts where reference = upper(btrim(p_reference));
  -- Same answer for an unknown reference and a wrong token: nothing to enumerate.
  if not found or r.token_hash <> p_token_hash then return jsonb_build_object('found', false); end if;
  select * into c from tpd.ia_cases where id = r.case_id;
  return jsonb_build_object(
    'found', true,
    'reference', r.reference,
    'received_on', to_char(c.received_at at time zone 'America/New_York', 'YYYY-MM-DD'),
    'status', case when c.status in ('closed', 'referred_external') then 'closed' when c.status = 'intake' then 'received' else 'under_review' end,
    'statement', (select d.body from tpd.ia_disclosures d where d.case_id = c.id and d.audience = 'complainant' order by d.approved_at desc limit 1));
end $$;

-- --------------------------------------------------------- staff reads

create or replace function tpd.ia_my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'personnel_id', tpd.ia_me(),
    'ia_role', tpd.ia_role_of(tpd.ia_me()),
    'post', tpd.ia_post_of(tpd.ia_me()),
    'can_appoint', tpd.ia_post_of(tpd.ia_me()) = 'deputy_chief',
    'has_access', tpd.ia_me() is not null and (tpd.ia_role_of(tpd.ia_me()) is not null or tpd.ia_post_of(tpd.ia_me()) is not null),
    'unread', (select count(*) from tpd.ia_notifications n where n.recipient_id = tpd.ia_me() and n.read_at is null))
$$;

create or replace function tpd.ia_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := tpd.ia_me();
begin
  perform tpd.ia_require(me is not null and (tpd.ia_role_of(me) is not null or tpd.ia_post_of(me) is not null), 'Internal Affairs access required');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'case_number', c.case_number, 'status', c.status, 'handler', c.handler, 'category', c.category,
      'summary', c.summary, 'received_at', c.received_at, 'source', c.source,
      'accused', case when a.id is null then c.reported_officer else coalesce(a.callsign || ' ', '') || a.name end,
      'accused_verified', a.id is not null,
      'investigator', case when i.id is null then null else coalesce(i.callsign || ' ', '') || i.name end,
      'assigned_to_me', c.assigned_investigator_id = me,
      'due_at', c.due_at,
      'overdue', c.status = 'investigating' and c.due_at < now(),
      'open_preservation', (select count(*) from tpd.ia_tasks t where t.case_id = c.id and t.completed_at is null and t.kind <> 'roster_record_update'),
      'preservation_overdue', exists (select 1 from tpd.ia_tasks t where t.case_id = c.id and t.completed_at is null and t.kind <> 'roster_record_update' and t.due_at < now()),
      'roster_update_pending', exists (select 1 from tpd.ia_tasks t where t.case_id = c.id and t.completed_at is null and t.kind = 'roster_record_update'),
      'criminal_pending', c.criminal_referral_at is not null and c.criminal_decision is null
    ) order by c.received_at desc)
    from tpd.ia_cases c
    left join tpd.personnel a on a.id = c.accused_id
    left join tpd.personnel i on i.id = c.assigned_investigator_id
    where tpd.ia_can_view_as(me, c.id)), '[]'::jsonb);
end $$;

create or replace function tpd.ia_case_detail(p_case uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := tpd.ia_me(); c tpd.ia_cases; result jsonb;
begin
  perform tpd.ia_require(tpd.ia_can_view(p_case), 'Case unavailable');
  select * into c from tpd.ia_cases where id = p_case;
  insert into tpd.ia_audit_events (case_id, actor_id, actor_label, action) values (p_case, me, 'personnel', 'case.viewed');
  select jsonb_build_object(
    'case', to_jsonb(c) || jsonb_build_object(
      'accused', (select jsonb_build_object('id', p.id, 'name', p.name, 'callsign', p.callsign, 'rank', p.rank) from tpd.personnel p where p.id = c.accused_id),
      'investigator', (select jsonb_build_object('id', p.id, 'name', p.name, 'callsign', p.callsign) from tpd.personnel p where p.id = c.assigned_investigator_id),
      'overdue', c.status = 'investigating' and c.due_at < now()),
    'complainant', (select to_jsonb(k) - 'case_id' || jsonb_build_object('member_name', (select p.name from tpd.personnel p where p.id = k.member_id)) from tpd.ia_complainants k where k.case_id = p_case),
    'receipt_reference', (select r.reference from tpd.ia_receipts r where r.case_id = p_case),
    'allegations', coalesce((select jsonb_agg(to_jsonb(a) order by a.ord) from tpd.ia_allegations a where a.case_id = p_case), '[]'),
    'evidence', coalesce((select jsonb_agg(to_jsonb(e) - 'storage_path' || jsonb_build_object('has_file', e.storage_path is not null) order by e.added_at) from tpd.ia_evidence e where e.case_id = p_case), '[]'),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from tpd.ia_tasks t where t.case_id = p_case), '[]'),
    'interviews', coalesce((select jsonb_agg(to_jsonb(v) || jsonb_build_object('conducted_by_name', (select p.name from tpd.personnel p where p.id = v.conducted_by)) order by v.conducted_at) from tpd.ia_interviews v where v.case_id = p_case), '[]'),
    'notes', coalesce((select jsonb_agg(to_jsonb(n) || jsonb_build_object('author_name', (select p.name from tpd.personnel p where p.id = n.author_id)) order by n.created_at) from tpd.ia_notes n where n.case_id = p_case), '[]'),
    'conflicts', coalesce((select jsonb_agg(to_jsonb(f) || jsonb_build_object('name', (select p.name from tpd.personnel p where p.id = f.personnel_id)) order by f.recorded_at) from tpd.ia_conflicts f where f.case_id = p_case), '[]'),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('author_name', (select p.name from tpd.personnel p where p.id = r.submitted_by)) order by r.version) from tpd.ia_reports r where r.case_id = p_case), '[]'),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('reviewer_name', (select p.name from tpd.personnel p where p.id = r.reviewer_id)) order by r.reviewed_at) from tpd.ia_reviews r where r.case_id = p_case), '[]'),
    'decisions', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('decided_by_name', (select p.name from tpd.personnel p where p.id = d.decided_by)) order by d.decided_at) from tpd.ia_decisions d where d.case_id = p_case), '[]'),
    'disclosures', coalesce((select jsonb_agg(to_jsonb(d) order by d.approved_at) from tpd.ia_disclosures d where d.case_id = p_case), '[]'),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'actor', coalesce((select p.name from tpd.personnel p where p.id = e.actor_id), e.actor_label), 'detail', e.detail) order by e.at, e.id) from tpd.ia_audit_events e where e.case_id = p_case), '[]'),
    'me', jsonb_build_object(
      'is_lead', tpd.ia_is_lead(p_case), 'is_worker', tpd.ia_is_worker(p_case),
      'is_assigned', c.assigned_investigator_id = me,
      'can_review', tpd.ia_role_of(me) in ('director', 'deputy_director') and c.handler = 'ia',
      'can_decide', me = tpd.ia_decider_for(c.handler),
      'can_approve_termination', tpd.ia_post_of(me) = 'chief',
      'can_confirm_roster', tpd.ia_post_of(me) in ('deputy_chief', 'chief'))
  ) into result;
  return result;
end $$;

-- Deciding authority (IA §9): the Deputy Chief, or the Chief when the Deputy Chief is the subject.
create or replace function tpd.ia_decider_for(p_handler text) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_handler when 'chief' then tpd.ia_holder('chief') when 'external' then null else tpd.ia_holder('deputy_chief') end
$$;

-- IA staff for the assignment picker (IA appointees only, never the whole roster).
create or replace function tpd.ia_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform tpd.ia_require(tpd.ia_role_of(tpd.ia_me()) is not null or tpd.ia_post_of(tpd.ia_me()) is not null, 'Internal Affairs access required');
  return coalesce((select jsonb_agg(jsonb_build_object('appointment_id', a.id, 'personnel_id', p.id, 'name', p.name, 'callsign', p.callsign,
      'rank', p.rank, 'role', a.role, 'ia_callsign', a.callsign, 'appointed_at', a.appointed_at) order by a.callsign)
    from tpd.ia_appointments a join tpd.personnel p on p.id = a.personnel_id where a.ended_at is null and p.status = 'active'), '[]');
end $$;

create or replace function tpd.ia_my_notifications() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'case_id', n.case_id, 'created_at', n.created_at, 'read', n.read_at is not null) order by n.created_at desc), '[]')
  from (select * from tpd.ia_notifications where recipient_id = tpd.ia_me() order by created_at desc limit 50) n
  where n.case_id is null or tpd.ia_can_view(n.case_id)
$$;

create or replace function tpd.ia_mark_notifications_read() returns int
language sql security definer set search_path = '' as $$
  with u as (update tpd.ia_notifications set read_at = now() where recipient_id = tpd.ia_me() and read_at is null returning 1) select count(*)::int from u
$$;

-- ------------------------------------------------------- appointments

create or replace function tpd.ia_appoint(p_personnel uuid, p_callsign text, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := tpd.ia_me(); new_id uuid; r text;
begin
  perform tpd.ia_require(tpd.ia_post_of(me) = 'deputy_chief', 'Only the Deputy Chief appoints IA members (IA §12)');
  perform tpd.ia_require(p_personnel <> me, 'Self-appointment is not permitted');
  perform tpd.ia_require(exists (select 1 from tpd.personnel where id = p_personnel and status = 'active'), 'Active member required', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_reason, ''))) between 10 and 1000, 'Record the reason for the appointment', '22023');
  -- IA §12: no sustained findings for dishonesty.
  perform tpd.ia_require(not exists (
    select 1 from tpd.ia_allegations a join tpd.ia_cases c on c.id = a.case_id
    where c.accused_id = p_personnel and c.status = 'closed' and a.finding = 'sustained' and a.category = 'dishonesty'),
    'This member has a sustained dishonesty finding and cannot serve in IA (IA §12)', '22023');
  r := case when p_callsign = 'IA-01' then 'director' when p_callsign = 'IA-02' then 'deputy_director'
            when p_callsign in ('IA-03', 'IA-04', 'IA-05', 'IA-06') then 'investigator' end;
  perform tpd.ia_require(r is not null, 'Choose IA-01 to IA-06', '22023');
  perform pg_advisory_xact_lock(hashtextextended('ia_appointments', 7));
  perform tpd.ia_require(not exists (select 1 from tpd.ia_appointments where callsign = p_callsign and ended_at is null), 'That IA call sign is already filled', '22023');
  perform tpd.ia_require(not exists (select 1 from tpd.ia_appointments where personnel_id = p_personnel and ended_at is null), 'This member already holds an IA appointment', '22023');
  insert into tpd.ia_appointments (personnel_id, role, callsign, appointed_by, reason) values (p_personnel, r, p_callsign, me, btrim(p_reason)) returning id into new_id;
  perform tpd.ia_log(null, 'appointment.created', jsonb_build_object('appointment_id', new_id, 'personnel_id', p_personnel, 'callsign', p_callsign));
  return new_id;
end $$;

create or replace function tpd.ia_end_appointment(p_appointment uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := tpd.ia_me(); a tpd.ia_appointments;
begin
  perform tpd.ia_require(tpd.ia_post_of(me) = 'deputy_chief', 'Only the Deputy Chief removes IA members (IA §12)');
  perform tpd.ia_require(length(btrim(coalesce(p_reason, ''))) between 10 and 1000, 'Record the reason', '22023');
  select * into a from tpd.ia_appointments where id = p_appointment and ended_at is null for update;
  perform tpd.ia_require(found, 'Appointment not active', '22023');
  update tpd.ia_appointments set ended_at = now(), ended_by = me, end_reason = btrim(p_reason) where id = p_appointment;
  perform tpd.ia_log(null, 'appointment.ended', jsonb_build_object('appointment_id', p_appointment, 'personnel_id', a.personnel_id));
  return true;
end $$;

create or replace function tpd.ia_appointments_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform tpd.ia_require(tpd.ia_role_of(tpd.ia_me()) is not null or tpd.ia_post_of(tpd.ia_me()) is not null, 'Internal Affairs access required');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'callsign', a.callsign, 'role', a.role, 'name', p.name, 'member_callsign', p.callsign,
      'appointed_at', a.appointed_at, 'ended_at', a.ended_at, 'reason', a.reason, 'end_reason', a.end_reason,
      'roster_slot_holder', (select h.name from tpd.division_slots s join tpd.personnel h on h.id = s.personnel_id where s.callsign = a.callsign)) order by a.ended_at nulls first, a.callsign)
    from tpd.ia_appointments a join tpd.personnel p on p.id = a.personnel_id), '[]');
end $$;

-- ----------------------------------------------------------- workflow

-- Staff-opened case, e.g. the mandatory review of any deadly force (IA §10) or a matter assigned by command (IA §3).
create or replace function tpd.ia_open_case(p_source text, p_category text, p_accused uuid, p_summary text, p_description text, p_incident_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := tpd.ia_me(); cid uuid;
begin
  perform tpd.ia_require(tpd.ia_role_of(me) in ('director', 'deputy_director') or tpd.ia_post_of(me) in ('deputy_chief', 'chief'), 'IA leadership or the Office of the Chiefs opens cases');
  perform tpd.ia_require(p_source in ('ia_opened', 'use_of_force_review'), 'invalid source', '22023');
  perform tpd.ia_require(p_accused is null or (p_accused <> me and exists (select 1 from tpd.personnel where id = p_accused and status = 'active')), 'invalid member', '22023');
  insert into tpd.ia_cases (case_number, source, status, handler, category, incident_date, summary, description, accused_id)
  values ('IA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('tpd.ia_case_seq')::text, 4, '0'), p_source, 'unassigned', tpd.ia_handler_for(p_accused),
          p_category, p_incident_date, btrim(p_summary), btrim(p_description), p_accused)
  returning id into cid;
  insert into tpd.ia_complainants (case_id, anonymous) values (cid, true);
  insert into tpd.ia_allegations (case_id, ord, category, description, created_by) values (cid, 1, p_category, left(btrim(p_summary), 2000), me);
  insert into tpd.ia_tasks (case_id, kind, detail, due_at) values
    (cid, 'bodycam_preservation', 'Request and save bodycam footage the same day the case is logged (IA §4).', now() + interval '24 hours'),
    (cid, 'evidence_preservation', 'Preserve AnchorCAD logs, reports, screenshots and recordings (IA §6).', now() + interval '48 hours');
  perform tpd.ia_log(cid, 'case.opened', jsonb_build_object('source', p_source));
  perform tpd.ia_alert_intake(cid);
  return cid;
end $$;

-- Intake review: link the verified member (if identifiable) and accept the complaint for assignment.
create or replace function tpd.ia_accept_intake(p_case uuid, p_accused uuid, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases; h text;
begin
  perform tpd.ia_require(tpd.ia_is_lead(p_case), 'The case lead reviews intake');
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(c.status = 'intake', 'Intake already reviewed', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_note, ''))) >= 10, 'Record an intake note', '22023');
  if p_accused is not null then
    perform tpd.ia_require(p_accused <> tpd.ia_me() and exists (select 1 from tpd.personnel where id = p_accused and status in ('active', 'inactive', 'suspended')), 'invalid member', '22023');
  end if;
  h := tpd.ia_handler_for(coalesce(p_accused, c.accused_id));
  -- Escalation only ever narrows the audience; it never widens it back. The one exception: a case routed
  -- provisionally from free text may be re-routed once the lead (who outranks everyone matched) links the
  -- verified member; the text-based exclusions then give way to the verified accused.
  if array_position(array['ia', 'ia_director', 'deputy_chief', 'chief', 'external'], h) < array_position(array['ia', 'ia_director', 'deputy_chief', 'chief', 'external'], c.handler)
     and not (c.routing_basis = 'text_match' and p_accused is not null) then
    h := c.handler;
  end if;
  update tpd.ia_cases set accused_id = coalesce(p_accused, accused_id), handler = h,
    routing_basis = case when coalesce(p_accused, c.accused_id) is not null then 'verified' else c.routing_basis end,
    provisional_excluded = case when c.routing_basis = 'text_match' and p_accused is not null then '{}' else c.provisional_excluded end,
    status = case when h = 'external' then 'referred_external' else 'unassigned' end,
    closed_at = case when h = 'external' then now() end
  where id = p_case;
  insert into tpd.ia_notes (case_id, author_id, body) values (p_case, tpd.ia_me(), 'Intake review: ' || btrim(p_note));
  perform tpd.ia_log(p_case, 'intake.accepted', jsonb_build_object('handler', h, 'from_handler', c.handler, 'accused_linked', coalesce(p_accused, c.accused_id) is not null,
                    'provisional_cleared', c.routing_basis = 'text_match' and p_accused is not null));
  if h <> c.handler then perform tpd.ia_alert_intake(p_case); end if;
  return h;
end $$;

-- IA §5: assignment after a conflict-of-interest check.
create or replace function tpd.ia_assign(p_case uuid, p_investigator uuid, p_conflict_check text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases;
begin
  perform tpd.ia_require(tpd.ia_is_lead(p_case), 'Only the Director assigns cases (IA §5)');
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(c.status in ('unassigned', 'investigating'), 'This case cannot be assigned now', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_conflict_check, ''))) >= 10, 'Record the conflict-of-interest check', '22023');
  if c.handler = 'ia' then
    perform tpd.ia_require(tpd.ia_role_of(p_investigator) is not null, 'Assign an appointed IA member', '22023');
  else
    -- Escalated: the handling authority investigates (IA §5).
    perform tpd.ia_require(p_investigator = tpd.ia_lead_for(c.handler), 'This complaint is handled by the designated authority (IA §5)', '22023');
  end if;
  -- Automatic checks; supervisory and personal relationships are attested by the Director and the investigator.
  perform tpd.ia_require(p_investigator is distinct from c.accused_id, 'An investigator cannot investigate themselves (IA §5)', '22023');
  perform tpd.ia_require(not exists (select 1 from tpd.ia_complainants k where k.case_id = p_case and k.member_id = p_investigator), 'The complainant cannot investigate', '22023');
  perform tpd.ia_require(not exists (select 1 from tpd.ia_conflicts f where f.case_id = p_case and f.personnel_id = p_investigator and f.kind = 'declared_conflict'), 'This investigator declared a conflict on this case', '22023');
  -- Anyone the case is hidden from (accused, complainant, provisionally excluded) can never be assigned to it.
  perform tpd.ia_require(tpd.ia_can_view_as(p_investigator, p_case), 'This member cannot be assigned to this case (IA §5, §11)', '22023');
  update tpd.ia_cases set assigned_investigator_id = p_investigator, assigned_at = now(),
    due_at = coalesce(case when c.assigned_investigator_id is not null then c.due_at end, now() + interval '7 days'), status = 'investigating'
  where id = p_case;
  insert into tpd.ia_conflicts (case_id, personnel_id, kind, note) values (p_case, tpd.ia_me(), 'no_conflict_attested', 'Assignment conflict check: ' || btrim(p_conflict_check));
  perform tpd.ia_log(p_case, 'case.assigned', jsonb_build_object('investigator', p_investigator));
  perform tpd.ia_notify(p_investigator, 'assignment', p_case);
  return true;
end $$;

-- IA §5: an investigator with a conflict must tell the Director, who reassigns.
create or replace function tpd.ia_declare_conflict(p_case uuid, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := tpd.ia_me(); c tpd.ia_cases;
begin
  perform tpd.ia_require(tpd.ia_can_view(p_case), 'Case unavailable');
  perform tpd.ia_require(length(btrim(coalesce(p_note, ''))) >= 5, 'Describe the conflict', '22023');
  select * into c from tpd.ia_cases where id = p_case for update;
  insert into tpd.ia_conflicts (case_id, personnel_id, kind, note) values (p_case, me, 'declared_conflict', btrim(p_note));
  if c.assigned_investigator_id = me and c.status = 'investigating' then
    update tpd.ia_cases set assigned_investigator_id = null, assigned_at = null, status = 'unassigned' where id = p_case;
  end if;
  insert into tpd.ia_audit_events (case_id, actor_id, actor_label, action) values (p_case, me, 'personnel', 'conflict.declared');
  perform tpd.ia_notify(tpd.ia_lead_for(c.handler), 'conflict_declared', p_case);
  return true;
end $$;

create or replace function tpd.ia_attest_no_conflict(p_case uuid, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform tpd.ia_require(tpd.ia_is_worker(p_case), 'Case unavailable');
  perform tpd.ia_require(length(btrim(coalesce(p_note, ''))) >= 5, 'Add a short attestation', '22023');
  insert into tpd.ia_conflicts (case_id, personnel_id, kind, note) values (p_case, tpd.ia_me(), 'no_conflict_attested', btrim(p_note));
  perform tpd.ia_log(p_case, 'conflict.none_attested');
  return true;
end $$;

-- IA §6: the Director may extend the 7-day target for complex cases, with the reason in the file.
create or replace function tpd.ia_extend(p_case uuid, p_new_due timestamptz, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases;
begin
  perform tpd.ia_require(tpd.ia_is_lead(p_case), 'Only the Director extends deadlines (IA §6)');
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(c.status = 'investigating' and p_new_due > coalesce(c.due_at, now()) and p_new_due < now() + interval '60 days', 'Choose a later due date', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_reason, ''))) >= 10, 'Record why the case needs more time', '22023');
  update tpd.ia_cases set due_at = p_new_due where id = p_case;
  insert into tpd.ia_notes (case_id, author_id, body) values (p_case, tpd.ia_me(), 'Deadline extended to ' || to_char(p_new_due at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') || ': ' || btrim(p_reason));
  perform tpd.ia_log(p_case, 'deadline.extended', jsonb_build_object('from', c.due_at, 'to', p_new_due));
  return true;
end $$;

create or replace function tpd.ia_add_allegation(p_case uuid, p_category text, p_description text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare aid uuid; s text;
begin
  perform tpd.ia_require(tpd.ia_is_worker(p_case), 'Case unavailable');
  select status into s from tpd.ia_cases where id = p_case;
  perform tpd.ia_require(s in ('intake', 'unassigned', 'investigating'), 'Allegations are locked', '22023');
  perform tpd.ia_require(p_category = any (tpd.ia_categories()), 'invalid category', '22023');
  insert into tpd.ia_allegations (case_id, ord, category, description, created_by)
  values (p_case, (select coalesce(max(ord), 0) + 1 from tpd.ia_allegations where case_id = p_case), p_category, btrim(p_description), tpd.ia_me())
  returning id into aid;
  perform tpd.ia_log(p_case, 'allegation.added', jsonb_build_object('allegation_id', aid));
  return aid;
end $$;

-- IA §6: written notice to the accused, unless notice would compromise evidence (then the delay is recorded).
create or replace function tpd.ia_record_notice(p_case uuid, p_delayed boolean, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases;
begin
  perform tpd.ia_require(tpd.ia_is_worker(p_case), 'Case unavailable');
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(c.status = 'investigating', 'The case is not under investigation', '22023');
  perform tpd.ia_require(c.accused_notice is distinct from 'notified', 'The member was already notified', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_note, ''))) >= 10,
    case when p_delayed then 'Explain how notice would compromise evidence' else 'Record how the written notice was delivered' end, '22023');
  update tpd.ia_cases set accused_notice = case when p_delayed then 'delayed' else 'notified' end, accused_notice_at = now(), accused_notice_note = btrim(p_note) where id = p_case;
  perform tpd.ia_log(p_case, case when p_delayed then 'notice.delayed' else 'notice.delivered' end);
  return true;
end $$;

create or replace function tpd.ia_add_evidence(p_case uuid, p_kind text, p_description text, p_external_ref text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare eid uuid;
begin
  perform tpd.ia_require(tpd.ia_is_worker(p_case), 'Case unavailable');
  perform tpd.ia_require((select status from tpd.ia_cases where id = p_case) in ('intake', 'unassigned', 'investigating'), 'Evidence is locked', '22023');
  perform tpd.ia_require(p_external_ref is null or length(p_external_ref) <= 500, 'Reference too long', '22023');
  perform tpd.ia_require(p_kind <> 'link' or p_external_ref ~ '^https://', 'Links must use https', '22023');
  insert into tpd.ia_evidence (case_id, kind, description, external_ref, added_by) values (p_case, p_kind, btrim(p_description), nullif(btrim(p_external_ref), ''), tpd.ia_me())
  returning id into eid;
  perform tpd.ia_log(p_case, 'evidence.added', jsonb_build_object('evidence_id', eid, 'kind', p_kind));
  return eid;
end $$;

-- Called by the ia-evidence Edge Function with the caller's own token before it stores or signs a file.
create or replace function tpd.ia_evidence_upload_check(p_case uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform tpd.ia_require(tpd.ia_is_worker(p_case), 'Case unavailable');
  perform tpd.ia_require((select status from tpd.ia_cases where id = p_case) in ('intake', 'unassigned', 'investigating'), 'Evidence is locked', '22023');
  return true;
end $$;

create or replace function tpd.ia_evidence_staff_attach(p_case uuid, p_path text, p_mime text, p_size bigint, p_sha256 text, p_description text, p_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare eid uuid;
begin
  perform tpd.ia_evidence_upload_check(p_case);
  perform tpd.ia_require(p_path like 'cases/' || p_case::text || '/%', 'invalid path', '22023');
  insert into tpd.ia_evidence (case_id, kind, description, storage_path, mime_type, size_bytes, sha256, added_by)
  values (p_case, p_kind, btrim(p_description), p_path, p_mime, p_size, p_sha256, tpd.ia_me()) returning id into eid;
  perform tpd.ia_log(p_case, 'evidence.file_added', jsonb_build_object('evidence_id', eid, 'mime', p_mime, 'size', p_size));
  return eid;
end $$;

create or replace function tpd.ia_evidence_download_check(p_evidence uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare e tpd.ia_evidence;
begin
  select * into e from tpd.ia_evidence where id = p_evidence;
  perform tpd.ia_require(found and e.storage_path is not null and tpd.ia_can_view(e.case_id), 'Evidence unavailable');
  perform tpd.ia_log(e.case_id, 'evidence.downloaded', jsonb_build_object('evidence_id', p_evidence));
  return e.storage_path;
end $$;

create or replace function tpd.ia_complete_task(p_task uuid, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare t tpd.ia_tasks;
begin
  select * into t from tpd.ia_tasks where id = p_task for update;
  perform tpd.ia_require(found and t.completed_at is null, 'Task unavailable', '22023');
  if t.kind = 'roster_record_update' then
    -- Human attestation that the Records tab was updated by hand; the site never writes the sheet.
    perform tpd.ia_require(tpd.ia_can_view(t.case_id) and tpd.ia_post_of(tpd.ia_me()) in ('deputy_chief', 'chief'), 'The Deputy Chief or Chief confirms roster record entries');
  else
    perform tpd.ia_require(tpd.ia_is_worker(t.case_id), 'Case unavailable');
  end if;
  perform tpd.ia_require(length(btrim(coalesce(p_note, ''))) >= 5, 'Record what was done', '22023');
  update tpd.ia_tasks set completed_at = now(), completed_by = tpd.ia_me(), completion_note = btrim(p_note) where id = p_task;
  perform tpd.ia_log(t.case_id, 'task.completed', jsonb_build_object('task_id', p_task, 'kind', t.kind));
  return true;
end $$;

create or replace function tpd.ia_record_interview(p_case uuid, p_kind text, p_interviewee text, p_conducted_at timestamptz,
  p_garrity_read_at timestamptz, p_observer text, p_summary text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases; vid uuid;
begin
  perform tpd.ia_require(tpd.ia_is_worker(p_case), 'Case unavailable');
  select * into c from tpd.ia_cases where id = p_case;
  perform tpd.ia_require(c.status = 'investigating', 'The case is not under investigation', '22023');
  perform tpd.ia_require(p_conducted_at <= now() + interval '5 minutes' and p_conducted_at >= c.received_at - interval '1 day', 'invalid interview time', '22023');
  if p_kind = 'accused' then
    perform tpd.ia_require(p_garrity_read_at is not null and p_garrity_read_at <= p_conducted_at, 'Record that the Garrity warning was read before the interview (IA §7)', '22023');
    perform tpd.ia_require(c.accused_notice is not null, 'Record the notice to the member first (IA §6)', '22023');
    perform tpd.ia_require(c.criminal_referral_at is null or c.criminal_decision = 'not_opened', 'Administrative interviews stay stopped until the Deputy Chief decides on the criminal referral (IA §7)', '22023');
  end if;
  insert into tpd.ia_interviews (case_id, kind, interviewee, conducted_by, conducted_at, garrity_read_at, observer, summary)
  values (p_case, p_kind, btrim(p_interviewee), tpd.ia_me(), p_conducted_at, case when p_kind = 'accused' then p_garrity_read_at end, nullif(btrim(coalesce(p_observer, '')), ''), btrim(p_summary))
  returning id into vid;
  perform tpd.ia_log(p_case, 'interview.recorded', jsonb_build_object('interview_id', vid, 'kind', p_kind, 'garrity', p_kind = 'accused'));
  return vid;
end $$;

create or replace function tpd.ia_add_note(p_case uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nid uuid;
begin
  perform tpd.ia_require(tpd.ia_is_worker(p_case) or (tpd.ia_can_view(p_case) and tpd.ia_role_of(tpd.ia_me()) in ('director', 'deputy_director')), 'Case unavailable');
  insert into tpd.ia_notes (case_id, author_id, body) values (p_case, tpd.ia_me(), btrim(p_body)) returning id into nid;
  perform tpd.ia_log(p_case, 'note.added', jsonb_build_object('note_id', nid));
  return nid;
end $$;

-- IA §7: a possible crime stops the administrative interview; the Deputy Chief decides on a criminal investigation.
create or replace function tpd.ia_criminal_referral(p_case uuid, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases;
begin
  perform tpd.ia_require(tpd.ia_is_worker(p_case), 'Case unavailable');
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(c.criminal_referral_at is null, 'Already referred', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_note, ''))) >= 10, 'Describe what was observed (not a legal conclusion)', '22023');
  update tpd.ia_cases set criminal_referral_at = now(), criminal_referral_note = btrim(p_note) where id = p_case;
  perform tpd.ia_log(p_case, 'criminal.referred');
  perform tpd.ia_notify(tpd.ia_decider_for(c.handler), 'criminal_referral', p_case);
  return true;
end $$;

create or replace function tpd.ia_criminal_decision(p_case uuid, p_opened boolean, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases;
begin
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(found and tpd.ia_can_view(p_case) and tpd.ia_me() = tpd.ia_decider_for(c.handler), 'The Deputy Chief decides whether a criminal investigation is opened (IA §7)');
  perform tpd.ia_require(c.criminal_referral_at is not null and c.criminal_decision is null, 'No referral is waiting', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_note, ''))) >= 10, 'Record the decision', '22023');
  update tpd.ia_cases set criminal_decision = case when p_opened then 'opened' else 'not_opened' end, criminal_decision_at = now() where id = p_case;
  insert into tpd.ia_notes (case_id, author_id, body) values (p_case, tpd.ia_me(), 'Criminal referral decision: ' || btrim(p_note));
  perform tpd.ia_log(p_case, case when p_opened then 'criminal.opened' else 'criminal.not_opened' end);
  return true;
end $$;

create or replace function tpd.ia_record_finding(p_allegation uuid, p_finding text, p_rationale text, p_recommended text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare a tpd.ia_allegations;
begin
  select * into a from tpd.ia_allegations where id = p_allegation for update;
  perform tpd.ia_require(found and tpd.ia_is_worker(a.case_id), 'Case unavailable');
  perform tpd.ia_require((select status from tpd.ia_cases where id = a.case_id) = 'investigating', 'Findings are recorded during the investigation', '22023');
  perform tpd.ia_require(p_finding in ('sustained', 'not_sustained', 'exonerated', 'unfounded'), 'Choose one of the four findings (IA §8)', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_rationale, ''))) >= 20, 'Explain the finding from the evidence', '22023');
  perform tpd.ia_require(p_recommended is null or (p_finding = 'sustained' and p_recommended = any (tpd.ia_disciplines())), 'Discipline can only be recommended for a sustained finding (IA §9)', '22023');
  update tpd.ia_allegations set finding = p_finding, finding_rationale = btrim(p_rationale), recommended_discipline = p_recommended,
    finding_by = tpd.ia_me(), finding_at = now() where id = p_allegation;
  perform tpd.ia_log(a.case_id, 'finding.recorded', jsonb_build_object('allegation_id', p_allegation, 'finding', p_finding));
  return true;
end $$;

create or replace function tpd.ia_submit_report(p_case uuid, p_body text, p_no_accused_interview_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases; v int;
begin
  perform tpd.ia_require(tpd.ia_is_worker(p_case), 'Case unavailable');
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(c.status = 'investigating', 'The case is not under investigation', '22023');
  perform tpd.ia_require(not exists (select 1 from tpd.ia_allegations where case_id = p_case and finding is null), 'Every allegation needs its own finding (IA §8)', '22023');
  perform tpd.ia_require(c.accused_notice is not null or c.accused_id is null, 'Record the notice to the member (IA §6)', '22023');
  perform tpd.ia_require(exists (select 1 from tpd.ia_interviews where case_id = p_case and kind = 'accused') or length(btrim(coalesce(p_no_accused_interview_reason, ''))) >= 10,
    'Interview the accused member or explain why it was not possible (IA §6)', '22023');
  perform tpd.ia_require(c.criminal_referral_at is null or c.criminal_decision is not null, 'The Deputy Chief has not decided the criminal referral yet', '22023');
  perform tpd.ia_require(not exists (select 1 from tpd.ia_tasks where case_id = p_case and completed_at is null and kind in ('bodycam_preservation', 'evidence_preservation')), 'Close out the evidence-preservation tasks first', '22023');
  v := (select coalesce(max(version), 0) + 1 from tpd.ia_reports where case_id = p_case);
  insert into tpd.ia_reports (case_id, version, body, no_accused_interview_reason, submitted_by)
  values (p_case, v, btrim(p_body), nullif(btrim(coalesce(p_no_accused_interview_reason, '')), ''), tpd.ia_me());
  -- Normal cases go to the Director or Deputy Director; escalated cases go straight to the deciding authority (IA-08).
  update tpd.ia_cases set status = case when c.handler = 'ia' then 'director_review' else 'deputy_chief_review' end where id = p_case;
  perform tpd.ia_log(p_case, 'report.submitted', jsonb_build_object('version', v));
  if c.handler = 'ia' then
    perform tpd.ia_notify(tpd.ia_appointee('director'), 'review_due', p_case);
    perform tpd.ia_notify(tpd.ia_appointee('deputy_director'), 'review_due', p_case);
  else
    perform tpd.ia_notify(tpd.ia_decider_for(c.handler), 'decision_due', p_case);
  end if;
  return v;
end $$;

-- IA §6: the Director or Deputy Director reviews the report before it goes to the Deputy Chief.
create or replace function tpd.ia_director_review(p_case uuid, p_approve boolean, p_notes text) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := tpd.ia_me(); c tpd.ia_cases; author uuid;
begin
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(found and tpd.ia_can_view(p_case) and c.handler = 'ia' and tpd.ia_role_of(me) in ('director', 'deputy_director'), 'The Director or Deputy Director reviews reports (IA §6)');
  perform tpd.ia_require(c.status = 'director_review', 'No report is waiting for review', '22023');
  select submitted_by into author from tpd.ia_reports where case_id = p_case order by version desc limit 1;
  perform tpd.ia_require(author <> me, 'The report author cannot review their own report', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_notes, ''))) >= 10, 'Record review notes', '22023');
  insert into tpd.ia_reviews (case_id, stage, reviewer_id, outcome, notes) values (p_case, 'director', me, case when p_approve then 'approved' else 'returned' end, btrim(p_notes));
  update tpd.ia_cases set status = case when p_approve then 'deputy_chief_review' else 'investigating' end where id = p_case;
  perform tpd.ia_log(p_case, case when p_approve then 'review.approved' else 'review.returned' end);
  if p_approve then perform tpd.ia_notify(tpd.ia_decider_for(c.handler), 'decision_due', p_case);
  else perform tpd.ia_notify(c.assigned_investigator_id, 'assignment', p_case); end if;
  return case when p_approve then 'deputy_chief_review' else 'investigating' end;
end $$;

-- IA §9: the Deputy Chief decides the outcome per allegation. p_outcomes = {"<allegation id>": "<discipline>"} for sustained allegations only.
create or replace function tpd.ia_decide(p_case uuid, p_outcomes jsonb, p_rationale text) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := tpd.ia_me(); c tpd.ia_cases; a record; snapshot jsonb := '[]'; d text; term boolean := false; result text;
begin
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(found and tpd.ia_can_view(p_case) and me = tpd.ia_decider_for(c.handler), 'Only the Deputy Chief decides IA outcomes (IA §9)');
  perform tpd.ia_require(c.status = 'deputy_chief_review', 'This case is not awaiting a decision', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_rationale, ''))) >= 10, 'Record the rationale', '22023');
  perform tpd.ia_require(jsonb_typeof(coalesce(p_outcomes, '{}'::jsonb)) = 'object', 'invalid outcomes', '22023');
  perform tpd.ia_require(not exists (select 1 from jsonb_object_keys(coalesce(p_outcomes, '{}'::jsonb)) k
    where k not in (select id::text from tpd.ia_allegations where case_id = p_case and finding = 'sustained')),
    'Discipline applies only to sustained allegations (IA §9)', '22023');
  for a in select * from tpd.ia_allegations where case_id = p_case order by ord loop
    d := null;
    if a.finding = 'sustained' then
      d := p_outcomes ->> a.id::text;
      perform tpd.ia_require(d = any (tpd.ia_disciplines()), 'Choose an outcome for every sustained allegation', '22023');
      term := term or d = 'Termination';
    end if;
    snapshot := snapshot || jsonb_build_array(jsonb_build_object('allegation_id', a.id, 'ord', a.ord, 'finding', a.finding, 'discipline', d));
  end loop;
  insert into tpd.ia_decisions (case_id, decided_by, rationale, outcomes, termination) values (p_case, me, btrim(p_rationale), snapshot, term);
  -- IA §9: a termination also needs the Chief's approval, unless the Chief is the one deciding.
  if term and tpd.ia_post_of(me) <> 'chief' then
    update tpd.ia_cases set status = 'chief_review' where id = p_case;
    perform tpd.ia_notify(tpd.ia_holder('chief'), 'termination_approval', p_case);
    result := 'chief_review';
  else
    perform tpd.ia_close(p_case, snapshot);
    result := 'closed';
  end if;
  perform tpd.ia_log(p_case, 'decision.recorded', jsonb_build_object('termination', term));
  return result;
end $$;

create or replace function tpd.ia_close(p_case uuid, p_outcomes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare o jsonb;
begin
  -- Pending roster tasks: the website cannot write the Records tab, so it never claims it did (IA §9).
  for o in select * from jsonb_array_elements(p_outcomes) loop
    if o ->> 'finding' = 'sustained' and coalesce(o ->> 'discipline', 'none') <> 'none' then
      insert into tpd.ia_tasks (case_id, kind, detail, due_at)
      values (p_case, 'roster_record_update', 'Enter "' || (o ->> 'discipline') || '" for allegation ' || (o ->> 'ord') || ' on the Records tab of the TPD Roster and update points (IA §9).', now() + interval '72 hours');
    end if;
  end loop;
  update tpd.ia_cases set status = 'closed', closed_at = now() where id = p_case;
  if exists (select 1 from tpd.ia_tasks where case_id = p_case and kind = 'roster_record_update') then
    perform tpd.ia_notify(tpd.ia_holder('deputy_chief'), 'roster_update_due', p_case);
  end if;
  perform tpd.ia_log(p_case, 'case.closed');
end $$;
revoke all on function tpd.ia_close(uuid, jsonb) from public, anon, authenticated;

create or replace function tpd.ia_chief_termination(p_case uuid, p_approve boolean, p_notes text) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := tpd.ia_me(); c tpd.ia_cases; dec tpd.ia_decisions;
begin
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(found and tpd.ia_can_view(p_case) and tpd.ia_post_of(me) = 'chief', 'Terminations need the Chief of Police (IA §9)');
  perform tpd.ia_require(c.status = 'chief_review', 'No termination is waiting for approval', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_notes, ''))) >= 10, 'Record the approval notes', '22023');
  select * into dec from tpd.ia_decisions where case_id = p_case and superseded_at is null order by decided_at desc limit 1;
  insert into tpd.ia_reviews (case_id, stage, reviewer_id, outcome, notes) values (p_case, 'chief_termination', me, case when p_approve then 'approved' else 'returned' end, btrim(p_notes));
  if p_approve then
    perform tpd.ia_close(p_case, dec.outcomes);
    perform tpd.ia_log(p_case, 'termination.approved');
    return 'closed';
  end if;
  update tpd.ia_decisions set superseded_at = now() where id = dec.id;
  update tpd.ia_cases set status = 'deputy_chief_review' where id = p_case;
  perform tpd.ia_notify(tpd.ia_decider_for(c.handler), 'decision_due', p_case);
  perform tpd.ia_log(p_case, 'termination.declined');
  return 'deputy_chief_review';
end $$;

-- IA §7: members are told the finding when the case closes (delivery is recorded, not automated).
create or replace function tpd.ia_record_findings_notice(p_case uuid, p_method text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases;
begin
  select * into c from tpd.ia_cases where id = p_case for update;
  perform tpd.ia_require(found and (tpd.ia_is_lead(p_case) or tpd.ia_me() = tpd.ia_decider_for(c.handler)), 'Case unavailable');
  perform tpd.ia_require(c.status = 'closed' and c.findings_notice_at is null, 'Nothing to record', '22023');
  perform tpd.ia_require(length(btrim(coalesce(p_method, ''))) >= 10, 'Record how the member was told', '22023');
  update tpd.ia_cases set findings_notice_at = now(), findings_notice_method = btrim(p_method) where id = p_case;
  perform tpd.ia_log(p_case, 'findings.member_notified');
  return true;
end $$;

-- IA §11: details are released only with the Deputy Chief's approval.
create or replace function tpd.ia_approve_disclosure(p_case uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c tpd.ia_cases; did uuid;
begin
  select * into c from tpd.ia_cases where id = p_case;
  perform tpd.ia_require(found and tpd.ia_can_view(p_case) and tpd.ia_me() = tpd.ia_decider_for(c.handler), 'Only the Deputy Chief approves what is disclosed (IA §11)');
  insert into tpd.ia_disclosures (case_id, audience, body, approved_by) values (p_case, 'complainant', btrim(p_body), tpd.ia_me()) returning id into did;
  perform tpd.ia_log(p_case, 'disclosure.approved', jsonb_build_object('disclosure_id', did));
  return did;
end $$;

-- ------------------------------------------------------------ grants

alter table tpd.ia_appointments enable row level security;
alter table tpd.ia_cases enable row level security;
alter table tpd.ia_complainants enable row level security;
alter table tpd.ia_receipts enable row level security;
alter table tpd.ia_allegations enable row level security;
alter table tpd.ia_conflicts enable row level security;
alter table tpd.ia_evidence enable row level security;
alter table tpd.ia_tasks enable row level security;
alter table tpd.ia_interviews enable row level security;
alter table tpd.ia_notes enable row level security;
alter table tpd.ia_reports enable row level security;
alter table tpd.ia_reviews enable row level security;
alter table tpd.ia_decisions enable row level security;
alter table tpd.ia_disclosures enable row level security;
alter table tpd.ia_notifications enable row level security;
alter table tpd.ia_audit_events enable row level security;
alter table tpd.ia_intake_throttle enable row level security;

-- No policies and no grants for anon/authenticated: IA data is reachable only through the functions above.
revoke all on tpd.ia_appointments, tpd.ia_cases, tpd.ia_complainants, tpd.ia_receipts, tpd.ia_allegations, tpd.ia_conflicts,
  tpd.ia_evidence, tpd.ia_tasks, tpd.ia_interviews, tpd.ia_notes, tpd.ia_reports, tpd.ia_reviews, tpd.ia_decisions,
  tpd.ia_disclosures, tpd.ia_notifications, tpd.ia_audit_events, tpd.ia_intake_throttle from public, anon, authenticated;
revoke all on sequence tpd.ia_case_seq from public, anon, authenticated;
grant all on tpd.ia_appointments, tpd.ia_cases, tpd.ia_complainants, tpd.ia_receipts, tpd.ia_allegations, tpd.ia_conflicts,
  tpd.ia_evidence, tpd.ia_tasks, tpd.ia_interviews, tpd.ia_notes, tpd.ia_reports, tpd.ia_reviews, tpd.ia_decisions,
  tpd.ia_disclosures, tpd.ia_notifications, tpd.ia_audit_events, tpd.ia_intake_throttle to service_role;
grant usage on sequence tpd.ia_case_seq to service_role;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'tpd' and p.proname like 'ia\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Signed-in members may call these; each checks IA access itself.
grant execute on function
  tpd.ia_my_access(), tpd.ia_dashboard(), tpd.ia_case_detail(uuid), tpd.ia_staff(), tpd.ia_my_notifications(), tpd.ia_mark_notifications_read(),
  tpd.ia_appoint(uuid, text, text), tpd.ia_end_appointment(uuid, text), tpd.ia_appointments_list(),
  tpd.ia_open_case(text, text, uuid, text, text, date), tpd.ia_accept_intake(uuid, uuid, text), tpd.ia_assign(uuid, uuid, text),
  tpd.ia_declare_conflict(uuid, text), tpd.ia_attest_no_conflict(uuid, text), tpd.ia_extend(uuid, timestamptz, text),
  tpd.ia_add_allegation(uuid, text, text), tpd.ia_record_notice(uuid, boolean, text), tpd.ia_add_evidence(uuid, text, text, text),
  tpd.ia_evidence_upload_check(uuid), tpd.ia_evidence_staff_attach(uuid, text, text, bigint, text, text, text), tpd.ia_evidence_download_check(uuid),
  tpd.ia_complete_task(uuid, text), tpd.ia_record_interview(uuid, text, text, timestamptz, timestamptz, text, text), tpd.ia_add_note(uuid, text),
  tpd.ia_criminal_referral(uuid, text), tpd.ia_criminal_decision(uuid, boolean, text), tpd.ia_record_finding(uuid, text, text, text),
  tpd.ia_submit_report(uuid, text, text), tpd.ia_director_review(uuid, boolean, text), tpd.ia_decide(uuid, jsonb, text),
  tpd.ia_chief_termination(uuid, boolean, text), tpd.ia_record_findings_notice(uuid, text), tpd.ia_approve_disclosure(uuid, text)
to authenticated;
-- Intake, receipt lookup and file registration stay service-role only (ia-intake Edge Function).

-- ------------------------------------------------------------ storage

-- Private bucket for evidence files. No storage policies are created for anon or
-- authenticated, so only the service role (inside the Edge Functions, after the
-- checks above) can read or write objects; downloads use 60-second signed URLs.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('tpd-ia-evidence', 'tpd-ia-evidence', false, 26214400,
            array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- Defence in depth for the shared project: storage.objects may carry permissive policies written for
-- another app (District Five). A RESTRICTIVE policy is ANDed with every permissive one, so no anon or
-- signed-in client can list, read, sign, write or delete IA evidence whatever else exists. The Edge
-- Functions use the service role, which bypasses RLS.
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
    drop policy if exists tpd_ia_evidence_service_only on storage.objects;
    create policy tpd_ia_evidence_service_only on storage.objects as restrictive for all to anon, authenticated
      using (bucket_id is distinct from 'tpd-ia-evidence') with check (bucket_id is distinct from 'tpd-ia-evidence');
  end if;
end $$;
