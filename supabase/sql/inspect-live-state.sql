-- READ-ONLY inspection of the live tpd schema before any migration is applied.
-- Paste into the Supabase SQL editor and run. It only SELECTs; it creates, changes and grants nothing,
-- and it reads no District Five (public schema) data. The result is one row per repository migration.
with fn as (
  select p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'tpd'
)
select m.migration, m.applied, m.evidence from (values
  ('20261104000000_personnel_and_integrations', to_regclass('tpd.personnel') is not null and to_regprocedure('tpd.is_command()') is not null, 'tpd.personnel, tpd.is_command()'),
  ('20261105000000_patrol_sessions',            to_regclass('tpd.patrol_sessions') is not null, 'tpd.patrol_sessions'),
  ('20261105000000_roster_apply_hardening',     exists (select 1 from fn where proname = 'my_membership' and def like '%''id'', me.id%'), 'my_membership returns the member id'),
  ('20261105000100_roster_removal_safeguards',  to_regclass('tpd.removal_candidates') is not null, 'tpd.removal_candidates'),
  ('20261105010000_patrol_reviews',             to_regclass('tpd.patrol_corrections') is not null, 'tpd.patrol_corrections'),
  ('20261105030000_member_requests',            to_regclass('tpd.member_requests') is not null, 'tpd.member_requests'),
  ('20261105040000_training_signoffs',          to_regclass('tpd.training_signoffs') is not null, 'tpd.training_signoffs'),
  ('20261105050000_phase6_clearance_personnel', to_regclass('tpd.personnel_change_proposals') is not null, 'tpd.personnel_change_proposals'),
  ('20261105051000_clearance_revocation_hardening', exists (select 1 from fn where proname = 'record_independent_clearance' and def like '%closed_count%'), 'record_independent_clearance closes active duty'),
  ('20261105060000_command_operational_report', to_regprocedure('tpd.command_operational_report()') is not null, 'tpd.command_operational_report()'),
  ('20261105070000_safe_member_directory_rpc',  to_regprocedure('tpd.list_member_directory()') is not null, 'tpd.list_member_directory()'),
  ('20261105071000_retire_definer_directory_view', to_regclass('tpd.personnel_directory') is null
      or not has_table_privilege('authenticated', 'tpd.personnel_directory', 'select'), 'personnel_directory closed to signed-in users'),
  ('20261112000000_daily_patrol_evaluations',   to_regclass('tpd.dpe_reports') is not null, 'tpd.dpe_reports')
) as m(migration, applied, evidence)
order by m.migration;

-- Readiness facts (counts only, no names).
select 'personnel by status and rank' as fact, coalesce(jsonb_object_agg(k, n), '{}'::jsonb) as value
  from (select status || ' / ' || rank as k, count(*) as n from tpd.personnel group by 1) s
union all select 'TPD members who have signed in with Discord', to_jsonb((select count(*) from tpd.personnel p
    where exists (select 1 from auth.identities i where i.provider = 'discord' and i.provider_id = p.discord_id)))
union all select 'extensions', to_jsonb(array(select extname from pg_extension where extname in ('pg_cron', 'pg_net', 'pgcrypto') order by 1))
union all select 'default privileges', to_jsonb(array(select defaclrole::regrole::text || ' ' || coalesce(defaclnamespace::regnamespace::text, '(all schemas)') || ' ' || defaclobjtype::text || ' ' || defaclacl::text from pg_default_acl))
union all select 'server version', to_jsonb(current_setting('server_version'))
union all select 'America/New_York known', to_jsonb(exists (select 1 from pg_timezone_names where name = 'America/New_York'));
