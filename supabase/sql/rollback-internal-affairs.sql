-- Rollback for supabase/migrations/20261113000000_internal_affairs.sql (Internal Affairs).
-- Hand-run in the SQL editor ONLY with dede's approval. Touches schema tpd, the storage bucket
-- tpd-ia-evidence and the policy tpd_ia_evidence_service_only on storage.objects. Nothing else.
--
-- Two levels. Run level 1 first; level 2 only if IA must be removed entirely.
--
-- LEVEL 1: switch IA off, keep every record (safe at any time, reversible by re-running the
-- migration's grant section). Members and the intake function lose access; data stays intact.
-- Pair it with: unset or delete the ia-intake / ia-evidence functions and rebuild the site.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'tpd' and p.proname like 'ia\_%' loop
    execute format('revoke execute on function %s from authenticated, service_role', f.sig);
  end loop;
end $$;
-- End of level 1. Stop here unless level 2 is approved.

-- LEVEL 2: remove IA completely. Refuses to run if any complaint was ever received, because IA
-- records are kept for the life of the department (IA §11). Export them first if that is ever needed.
do $$ begin
  if to_regclass('tpd.ia_cases') is not null and exists (select 1 from tpd.ia_cases) then
    raise exception 'tpd.ia_cases holds records; IA rollback level 2 refused (IA §11). Use level 1.';
  end if;
  if exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
    if exists (select 1 from storage.objects where bucket_id = 'tpd-ia-evidence') then
      raise exception 'tpd-ia-evidence holds files; IA rollback level 2 refused.';
    end if;
    -- Supabase blocks direct deletes from storage tables (storage.protect_delete), so the empty private bucket stays.
    -- Delete it in Dashboard > Storage if wanted. The restrictive policy stays too: it only ever denies access to that
    -- bucket and keeps it sealed while it exists.
  end if;
end $$;

drop table if exists tpd.ia_audit_events, tpd.ia_notifications, tpd.ia_disclosures, tpd.ia_decisions, tpd.ia_reviews,
  tpd.ia_reports, tpd.ia_notes, tpd.ia_interviews, tpd.ia_tasks, tpd.ia_evidence, tpd.ia_conflicts, tpd.ia_allegations,
  tpd.ia_receipts, tpd.ia_complainants, tpd.ia_cases, tpd.ia_appointments, tpd.ia_intake_throttle cascade;
drop sequence if exists tpd.ia_case_seq;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'tpd' and p.proname like 'ia\_%' loop
    execute format('drop function %s', f.sig);
  end loop;
end $$;
