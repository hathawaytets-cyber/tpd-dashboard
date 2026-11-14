-- Internal Affairs release preflight. READ-ONLY: one SELECT, safe to run in the live SQL editor.
-- Returns check / value rows. No names, Discord IDs or case content are returned.
set transaction read only;
select * from (values
  ('postgres version', current_setting('server_version')),
  ('tpd tables', (select count(*)::text from pg_tables where schemaname = 'tpd')),
  ('IA tables already present (expect 0)', (select count(*)::text from pg_tables where schemaname = 'tpd' and tablename like 'ia\_%')),
  ('IA functions already present (expect 0)', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'tpd' and p.proname like 'ia\_%')),
  ('Daily Patrol Evaluation (PR #2) applied', (select (to_regclass('tpd.daily_patrol_evaluations') is not null)::text)),
  ('last applied TPD migration object: list_member_directory()', (select (to_regprocedure('tpd.list_member_directory()') is not null)::text)),
  ('active personnel', (select count(*)::text from tpd.personnel where status = 'active')),
  ('X-101 Chief post filled', (select (count(*) > 0)::text from tpd.positions where callsign = 'X-101' and personnel_id is not null)),
  ('X-102 Deputy Chief post filled (needed to appoint IA)', (select (count(*) > 0)::text from tpd.positions where callsign = 'X-102' and personnel_id is not null)),
  ('X-201 Major post filled', (select (count(*) > 0)::text from tpd.positions where callsign = 'X-201' and personnel_id is not null)),
  ('X-102 holder has signed in with Discord', (select (count(*) > 0)::text from tpd.positions x join tpd.personnel p on p.id = x.personnel_id join auth.identities i on i.provider = 'discord' and i.provider_id = p.discord_id where x.callsign = 'X-102')),
  ('bucket tpd-ia-evidence exists (expect false)', (select (count(*) > 0)::text from storage.buckets where id = 'tpd-ia-evidence')),
  ('all buckets (id:public)', (select coalesce(string_agg(id || ':' || public::text, ', ' order by id), 'none') from storage.buckets)),
  ('storage.objects policies (name/cmd/roles/permissive)', (select coalesce(string_agg(polname || '/' || polcmd::text || '/' || array_to_string(array(select rolname from pg_roles where oid = any (polroles)), '+') || '/' || polpermissive::text, '; '), 'none') from pg_policy where polrelid = 'storage.objects'::regclass)),
  ('storage.objects policies with no bucket filter (would expose any bucket)', (select coalesce(string_agg(polname, ', '), 'none') from pg_policy where polrelid = 'storage.objects'::regclass and polpermissive and coalesce(pg_get_expr(polqual, polrelid), '') !~ 'bucket_id')),
  ('pg_cron installed', (select (count(*) > 0)::text from pg_extension where extname = 'pg_cron'))
) as t(check_name, value);
