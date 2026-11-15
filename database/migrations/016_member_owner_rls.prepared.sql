-- PREPARED ONLY. Apply as jungsi_backend_owner, and only after:
--   1. 015b is registered,
--   2. the server runs with JUNGSI_MEMBER_RESULTS_READER=fn_v2 (statistics.read
--      reads through read_member_statistics_rows_v1), and that was observed.
-- Before step 2, statistics.read still reads every member's report directly and
-- owner-bound RLS would make every member rank 1 of 1.
-- Binds exactly the eleven reviewed runtime policies of the five member tables to
-- the verified JWT subject. Any other policy, role, command, owner, FORCE flag or
-- table grant difference stops the transaction. Rollback: 016 rollback file.
-- Limits: the subject is set by the server per transaction; this is an extra
-- guard against wrong-owner queries, not an independent authentication of a
-- compromised server or database credential.
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
  IF pg_catalog.to_regprocedure('jungsi_backend.read_member_statistics_rows_v1(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM jungsi_backend.schema_versions WHERE version = '015b_member_reader_functions')
     OR EXISTS (SELECT 1 FROM jungsi_backend.schema_versions WHERE version = '016_member_owner_rls') THEN
    RAISE EXCEPTION '015b must be registered first and 016 must not be registered yet';
  END IF;
  IF EXISTS (SELECT 1 FROM jungsi_backend.profiles WHERE owner_id <> pg_catalog.lower(owner_id)
               AND owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR EXISTS (SELECT 1 FROM jungsi_backend.reports WHERE owner_id <> pg_catalog.lower(owner_id)
               AND owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR EXISTS (SELECT 1 FROM jungsi_backend.report_revisions WHERE owner_id <> pg_catalog.lower(owner_id)
               AND owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR EXISTS (SELECT 1 FROM jungsi_backend.score_input_states WHERE owner_id <> pg_catalog.lower(owner_id)
               AND owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR EXISTS (SELECT 1 FROM jungsi_backend.score_maps WHERE owner_id <> pg_catalog.lower(owner_id)
               AND owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'upper-case UUID owner would become invisible to its member';
  END IF;
END
$order$;

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

DO $owner_policies$
DECLARE e record;
BEGIN
  FOR e IN SELECT t, p, c FROM expected_016 ORDER BY t, p LOOP
    IF e.c = 'a' THEN
      EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I WITH CHECK (owner_id = current_setting(''request.jwt.claim.sub''::text, true))', e.p, e.t);
    ELSIF e.c = 'r' THEN
      EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I USING (owner_id = current_setting(''request.jwt.claim.sub''::text, true))', e.p, e.t);
    ELSE
      EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I USING (owner_id = current_setting(''request.jwt.claim.sub''::text, true)) WITH CHECK (owner_id = current_setting(''request.jwt.claim.sub''::text, true))', e.p, e.t);
    END IF;
  END LOOP;
END
$owner_policies$;

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

INSERT INTO jungsi_backend.schema_versions(version) VALUES ('016_member_owner_rls');
COMMIT;
