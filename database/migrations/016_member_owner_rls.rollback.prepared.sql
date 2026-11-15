-- PREPARED ONLY. Rollback for 016. Apply as jungsi_backend_owner only if
-- member reads or writes fail after 016. It first verifies that exactly the same
-- eleven policies still carry the 016 owner condition (no policy added, renamed,
-- re-targeted or changed since), then restores USING(true)/WITH CHECK(true).
-- SECURITY NOTE: after rollback the database no longer blocks wrong-owner reads;
-- protection falls back to the server's owner_id=$1 conditions. Record the time,
-- reason and the plan/date to re-apply 016.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;
SELECT pg_catalog.pg_advisory_xact_lock(74961115016);
CREATE TEMP TABLE expected_016(t text, p text, c "char") ON COMMIT DROP;
INSERT INTO expected_016 VALUES
    ('profiles','jungsi runtime insert','a'),
    ('profiles','jungsi runtime select','r'),
    ('report_revisions','jungsi runtime insert','a'),
    ('report_revisions','jungsi runtime select','r'),
    ('reports','jungsi runtime insert','a'),
    ('reports','jungsi runtime select','r'),
    ('reports','jungsi runtime update','w'),
    ('score_input_states','jungsi policy insert','a'),
    ('score_input_states','jungsi policy read','r'),
    ('score_maps','jungsi runtime insert','a'),
    ('score_maps','jungsi runtime select','r');

DO $order$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jungsi_backend.schema_versions WHERE version = '016_member_owner_rls')
     OR EXISTS (SELECT 1 FROM jungsi_backend.schema_versions WHERE version = '016r_member_owner_rls_rollback') THEN
    RAISE EXCEPTION '016 is not applied or already rolled back';
  END IF;
END
$order$;

DO $exact_policies$
DECLARE
  runtime_role oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'jungsi_backend_app');
  owner_role oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'jungsi_backend_owner');
  bad text;
  want_q text := '(owner_id = current_setting(''request.jwt.claim.sub''::text, true))';
BEGIN
  IF current_user <> 'jungsi_backend_owner' THEN RAISE EXCEPTION 'existing backend owner required'; END IF;
  -- Exactly the eleven reviewed policies: same tables, names, commands, role, permissive.
  SELECT pg_catalog.string_agg(x, '; ') INTO bad FROM (
    SELECT 'missing ' || e.t || '/' || e.p AS x FROM expected_016 e
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = pg_catalog.to_regclass('jungsi_backend.' || e.t) AND p.polname = e.p AND p.polcmd = e.c)
    UNION ALL
    SELECT 'unexpected ' || c.relname || '/' || p.polname FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'jungsi_backend'::regnamespace
       AND c.relname IN ('profiles','reports','report_revisions','score_input_states','score_maps')
       AND NOT EXISTS (SELECT 1 FROM expected_016 e WHERE e.t = c.relname AND e.p = p.polname AND e.c = p.polcmd)
    UNION ALL
    SELECT 'shape ' || c.relname || '/' || p.polname FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'jungsi_backend'::regnamespace
       AND c.relname IN ('profiles','reports','report_revisions','score_input_states','score_maps')
       AND (NOT p.polpermissive OR p.polroles <> ARRAY[runtime_role]::oid[]
            OR (p.polcmd IN ('r','w') AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) IS DISTINCT FROM want_q)
            OR (p.polcmd = 'a' AND p.polqual IS NOT NULL)
            OR (p.polcmd IN ('a','w') AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) IS DISTINCT FROM want_q)
            OR (p.polcmd = 'r' AND p.polwithcheck IS NOT NULL))
    UNION ALL
    SELECT 'table ' || c.relname FROM pg_catalog.pg_class c
     WHERE c.relnamespace = 'jungsi_backend'::regnamespace
       AND c.relname IN ('profiles','reports','report_revisions','score_input_states','score_maps')
       AND (c.relowner <> owner_role OR NOT c.relrowsecurity OR c.relforcerowsecurity)
    UNION ALL
    SELECT 'grant ' || c.relname || '/' || pg_catalog.pg_get_userbyid(a.grantee) || '/' || a.privilege_type
      FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.relnamespace = 'jungsi_backend'::regnamespace
       AND c.relname IN ('profiles','reports','report_revisions','score_input_states','score_maps')
       AND a.grantee <> owner_role
       AND NOT (a.grantee = runtime_role AND a.privilege_type IN ('SELECT','INSERT'))
  ) z;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'policy scope differs from review: %', bad; END IF;
  IF (SELECT pg_catalog.count(*) FROM expected_016) <> 11 THEN RAISE EXCEPTION 'expected list'; END IF;
END
$exact_policies$;

DO $restore$
DECLARE e record;
BEGIN
  FOR e IN SELECT t, p, c FROM expected_016 ORDER BY t, p LOOP
    IF e.c = 'a' THEN
      EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I WITH CHECK (true)', e.p, e.t);
    ELSIF e.c = 'r' THEN
      EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I USING (true)', e.p, e.t);
    ELSE
      EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I USING (true) WITH CHECK (true)', e.p, e.t);
    END IF;
  END LOOP;
END
$restore$;

DO $exact_policies$
DECLARE
  runtime_role oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'jungsi_backend_app');
  owner_role oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'jungsi_backend_owner');
  bad text;
  want_q text := 'true';
BEGIN
  IF current_user <> 'jungsi_backend_owner' THEN RAISE EXCEPTION 'existing backend owner required'; END IF;
  -- Exactly the eleven reviewed policies: same tables, names, commands, role, permissive.
  SELECT pg_catalog.string_agg(x, '; ') INTO bad FROM (
    SELECT 'missing ' || e.t || '/' || e.p AS x FROM expected_016 e
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = pg_catalog.to_regclass('jungsi_backend.' || e.t) AND p.polname = e.p AND p.polcmd = e.c)
    UNION ALL
    SELECT 'unexpected ' || c.relname || '/' || p.polname FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'jungsi_backend'::regnamespace
       AND c.relname IN ('profiles','reports','report_revisions','score_input_states','score_maps')
       AND NOT EXISTS (SELECT 1 FROM expected_016 e WHERE e.t = c.relname AND e.p = p.polname AND e.c = p.polcmd)
    UNION ALL
    SELECT 'shape ' || c.relname || '/' || p.polname FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'jungsi_backend'::regnamespace
       AND c.relname IN ('profiles','reports','report_revisions','score_input_states','score_maps')
       AND (NOT p.polpermissive OR p.polroles <> ARRAY[runtime_role]::oid[]
            OR (p.polcmd IN ('r','w') AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) IS DISTINCT FROM want_q)
            OR (p.polcmd = 'a' AND p.polqual IS NOT NULL)
            OR (p.polcmd IN ('a','w') AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) IS DISTINCT FROM want_q)
            OR (p.polcmd = 'r' AND p.polwithcheck IS NOT NULL))
    UNION ALL
    SELECT 'table ' || c.relname FROM pg_catalog.pg_class c
     WHERE c.relnamespace = 'jungsi_backend'::regnamespace
       AND c.relname IN ('profiles','reports','report_revisions','score_input_states','score_maps')
       AND (c.relowner <> owner_role OR NOT c.relrowsecurity OR c.relforcerowsecurity)
    UNION ALL
    SELECT 'grant ' || c.relname || '/' || pg_catalog.pg_get_userbyid(a.grantee) || '/' || a.privilege_type
      FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.relnamespace = 'jungsi_backend'::regnamespace
       AND c.relname IN ('profiles','reports','report_revisions','score_input_states','score_maps')
       AND a.grantee <> owner_role
       AND NOT (a.grantee = runtime_role AND a.privilege_type IN ('SELECT','INSERT'))
  ) z;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'policy scope differs from review: %', bad; END IF;
  IF (SELECT pg_catalog.count(*) FROM expected_016) <> 11 THEN RAISE EXCEPTION 'expected list'; END IF;
END
$exact_policies$;

INSERT INTO jungsi_backend.schema_versions(version) VALUES ('016r_member_owner_rls_rollback');
COMMIT;
