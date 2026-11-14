-- Rollback for migration 20261112000000_daily_patrol_evaluations.sql. Not a migration: run by hand in the
-- Supabase SQL editor only if the feature must be withdrawn. Touches the tpd schema only.
--
-- STEP 1 (reversible, keeps every report): switch the feature off.
-- Restores the previous behaviour of the two existing tables the migration touched and closes the API.
-- Re-applying the migration file switches it back on with the data intact.
begin;
drop trigger if exists dpe_patrol_end on tpd.patrol_sessions;          -- ending a patrol no longer creates obligations
drop trigger if exists audit_log_append_only on tpd.audit_log;         -- audit_log returns to its previous (owner-editable) state
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'tpd' and p.proname like 'dpe\_%' loop
    execute format('revoke execute on function %s from authenticated, anon, public', f.sig);
  end loop;
end $$;
-- Note: RLS policies call dpe_me / dpe_is_* as the signed-in role, so reads of the dpe_* tables now fail
-- with a permission error instead of returning rows. That is intended while the feature is off.
commit;

-- STEP 2 (IRREVERSIBLE, deletes all evaluations): only after exporting the data and with dede's written approval.
-- Export first, as a Captain+ in the app (Command Center > Evaluations > Export CSV) or here:
--   copy (select * from tpd.dpe_reports) to stdout with csv header;   -- repeat per table
-- Then uncomment:
-- begin;
-- drop table if exists tpd.dpe_reviews, tpd.dpe_report_versions, tpd.dpe_entries, tpd.dpe_reports, tpd.dpe_excusals,
--   tpd.dpe_obligations, tpd.dpe_assignments, tpd.dpe_awards, tpd.dpe_settings cascade;
-- do $$ declare f record; begin
--   for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'tpd' and p.proname like 'dpe\_%' loop
--     execute format('drop function if exists %s cascade', f.sig);
--   end loop; end $$;
-- commit;
