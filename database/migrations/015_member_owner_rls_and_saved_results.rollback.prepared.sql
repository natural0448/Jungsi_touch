-- PREPARED ONLY. Rollback for part A of 015 (owner-bound row security).
-- Run as jungsi_backend_owner only if member reads or writes fail after 015.
-- Restores the reviewed USING(true)/WITH CHECK(true) runtime policies.
-- Part B (read_member_saved_results_v2) is not dropped: the server stops using it
-- when JUNGSI_MEMBER_RESULTS_READER is removed. schema_versions keeps the 015 row
-- and gets a separate rollback row so the history stays readable.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;
SELECT pg_catalog.pg_advisory_xact_lock(74961115015);

DO $rollback_owner_policies$
DECLARE
  target text;
  pol record;
  owner_expr constant text :=
    '(owner_id = current_setting(''request.jwt.claim.sub''::text, true))';
BEGIN
  IF current_user <> 'jungsi_backend_owner' THEN
    RAISE EXCEPTION 'existing backend owner required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jungsi_backend.schema_versions
                 WHERE version = '015_member_owner_rls_and_saved_results')
     OR EXISTS (SELECT 1 FROM jungsi_backend.schema_versions
                WHERE version = '015r_member_owner_rls_rollback') THEN
    RAISE EXCEPTION '015 is not applied or already rolled back';
  END IF;
  FOREACH target IN ARRAY ARRAY['profiles','reports','report_revisions','score_input_states','score_maps'] LOOP
    FOR pol IN SELECT p.polname, p.polcmd, p.polrelid,
                      pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS q,
                      pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS c
                 FROM pg_catalog.pg_policy p
                WHERE p.polrelid = pg_catalog.to_regclass('jungsi_backend.' || target)
                ORDER BY p.polname LOOP
      IF (pol.q IS NOT NULL AND pol.q <> owner_expr)
         OR (pol.c IS NOT NULL AND pol.c <> owner_expr) THEN
        RAISE EXCEPTION 'policy % on % differs from 015; preserve and review', pol.polname, target;
      END IF;
      IF pol.polcmd = 'a' THEN
        EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I WITH CHECK (true)',
          pol.polname, target);
      ELSIF pol.polcmd = 'r' OR pol.polcmd = 'd' THEN
        EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I USING (true)',
          pol.polname, target);
      ELSE
        EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I USING (true) WITH CHECK (true)',
          pol.polname, target);
      END IF;
    END LOOP;
  END LOOP;
END
$rollback_owner_policies$;

INSERT INTO jungsi_backend.schema_versions(version)
  VALUES ('015r_member_owner_rls_rollback');
COMMIT;
