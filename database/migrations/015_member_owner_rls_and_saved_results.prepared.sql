-- PREPARED ONLY. The DB owner applies this as jungsi_backend_owner after the
-- screen Owner's local equivalence receipt. Two independent parts:
--   A. owner-bound row security for the member tables the saved-results read
--      touches (policies change from USING(true) to the verified JWT subject);
--   B. read_member_saved_results_v2, which returns exactly the 11 columns of the
--      server's current MEMBER_RESULTS_SQL (including member_school_results_refs)
--      so the server can switch by one setting and back without a deploy.
-- Part B alone changes nothing until JUNGSI_MEMBER_RESULTS_READER=fn_v2.
-- Part A takes effect immediately for every query; keep the rollback file ready.
-- 014 (read_member_2027_saved_results) is left untouched.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;
SELECT pg_catalog.pg_advisory_xact_lock(74961115015);

DO $preflight$
DECLARE
  runtime_role oid;
  owner_role oid;
  private_schema oid;
  target text;
  mixed_case bigint;
  bad_policy text;
BEGIN
  IF current_user <> 'jungsi_backend_owner' THEN
    RAISE EXCEPTION 'existing backend owner required';
  END IF;
  SELECT oid INTO runtime_role FROM pg_catalog.pg_roles
    WHERE rolname = 'jungsi_backend_app'
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole;
  SELECT oid INTO owner_role FROM pg_catalog.pg_roles WHERE rolname = current_user;
  SELECT oid INTO private_schema FROM pg_catalog.pg_namespace WHERE nspname = 'jungsi_backend';
  IF runtime_role IS NULL
     OR pg_catalog.pg_has_role('jungsi_backend_app', 'jungsi_backend_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('jungsi_backend_app', 'postgres', 'MEMBER')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members
                WHERE member = runtime_role OR roleid = runtime_role)
     OR NOT pg_catalog.has_schema_privilege('jungsi_backend_app', 'jungsi_backend', 'USAGE') THEN
    RAISE EXCEPTION 'existing application role is not verified';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
    WHERE d.defaclrole = owner_role AND d.defaclobjtype = 'f'
      AND d.defaclnamespace IN (0, private_schema)
      AND a.privilege_type = 'EXECUTE'
      AND a.grantee NOT IN (0, owner_role, runtime_role)
  ) THEN
    RAISE EXCEPTION 'unexpected function default ACL; preserve and review';
  END IF;
  IF pg_catalog.to_regprocedure(
       'jungsi_backend.read_member_saved_results_v2(text,text,jsonb,text,bigint)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM jungsi_backend.schema_versions
                WHERE version = '015_member_owner_rls_and_saved_results') THEN
    RAISE EXCEPTION 'existing registration must be preserved and independently reviewed';
  END IF;
  FOREACH target IN ARRAY ARRAY['profiles','reports','report_revisions','score_input_states','score_maps'] LOOP
    IF pg_catalog.to_regclass('jungsi_backend.' || target) IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                      WHERE c.oid = pg_catalog.to_regclass('jungsi_backend.' || target)
                        AND c.relrowsecurity)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                      WHERE a.attrelid = pg_catalog.to_regclass('jungsi_backend.' || target)
                        AND a.attname = 'owner_id' AND NOT a.attisdropped
                        AND a.atttypid = 'pg_catalog.text'::regtype)
       OR NOT pg_catalog.has_table_privilege('jungsi_backend_app', 'jungsi_backend.' || target, 'SELECT') THEN
      RAISE EXCEPTION 'existing member table, row security or owner_id missing: %', target;
    END IF;
    -- The server lower-cases the verified UUID subject before set_config. A UUID
    -- stored with upper-case letters would become invisible to its member; other
    -- non-UUID synthetic owners are already unreachable by the server and are allowed.
    EXECUTE pg_catalog.format(
      'SELECT pg_catalog.count(*) FROM jungsi_backend.%I WHERE owner_id <> pg_catalog.lower(owner_id) '
      'AND owner_id ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''',
      target) INTO mixed_case;
    IF mixed_case <> 0 THEN
      RAISE EXCEPTION 'owner_id is not lower-case in %; review before binding policies', target;
    END IF;
    -- Every runtime policy must still be the reviewed permissive true policy.
    SELECT pg_catalog.string_agg(p.polname, ',') INTO bad_policy
      FROM pg_catalog.pg_policy p
     WHERE p.polrelid = pg_catalog.to_regclass('jungsi_backend.' || target)
       AND (NOT p.polpermissive
            OR p.polroles <> ARRAY[runtime_role]::oid[]
            OR (p.polqual IS NOT NULL
                AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) <> 'true')
            OR (p.polwithcheck IS NOT NULL
                AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) <> 'true'));
    IF bad_policy IS NOT NULL THEN
      RAISE EXCEPTION 'unexpected policy on %: %; preserve and review', target, bad_policy;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
                   WHERE p.polrelid = pg_catalog.to_regclass('jungsi_backend.' || target)
                     AND p.polcmd = 'r') THEN
      RAISE EXCEPTION 'runtime select policy missing on %', target;
    END IF;
  END LOOP;
END
$preflight$;

-- A. Owner-bound row security. NULL subject (no set_config) sees and writes nothing.
DO $owner_policies$
DECLARE
  target text;
  pol record;
  owner_expr constant text :=
    '(owner_id = pg_catalog.current_setting(''request.jwt.claim.sub'', true))';
BEGIN
  FOREACH target IN ARRAY ARRAY['profiles','reports','report_revisions','score_input_states','score_maps'] LOOP
    FOR pol IN SELECT p.polname, p.polcmd FROM pg_catalog.pg_policy p
               WHERE p.polrelid = pg_catalog.to_regclass('jungsi_backend.' || target)
               ORDER BY p.polname LOOP
      IF pol.polcmd = 'a' THEN
        EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I WITH CHECK %s',
          pol.polname, target, owner_expr);
      ELSIF pol.polcmd = 'r' OR pol.polcmd = 'd' THEN
        EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I USING %s',
          pol.polname, target, owner_expr);
      ELSE
        EXECUTE pg_catalog.format('ALTER POLICY %I ON jungsi_backend.%I USING %s WITH CHECK %s',
          pol.polname, target, owner_expr, owner_expr);
      END IF;
    END LOOP;
  END LOOP;
END
$owner_policies$;

-- B. Same 11 columns, same order and text formats as MEMBER_RESULTS_SQL.
CREATE FUNCTION jungsi_backend.read_member_saved_results_v2(
  p_subject text,
  p_year text,
  p_offering_ids jsonb,
  p_report_id text,
  p_report_revision bigint
) RETURNS TABLE (
  report_id text,
  report_revision text,
  profile_id text,
  exam_id text,
  pack_version text,
  analyses text,
  body text,
  scores text,
  confirmed boolean,
  profile_created_at text,
  revision_created_at text
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
#variable_conflict use_column
BEGIN
  IF p_subject IS NULL
     OR p_subject !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR pg_catalog.current_setting('request.jwt.claim.sub', true) IS DISTINCT FROM p_subject THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'member_result_subject_mismatch';
  END IF;
  IF p_year IS NULL OR p_year !~ '^[0-9]{4}$'
     OR (p_report_id IS NOT NULL AND p_report_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
     OR (p_report_revision IS NOT NULL AND p_report_revision < 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'member_result_request_invalid';
  END IF;
  IF p_offering_ids IS NULL OR pg_catalog.jsonb_typeof(p_offering_ids) <> 'array'
     OR pg_catalog.jsonb_array_length(p_offering_ids) > 100
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_offering_ids) AS q(v)
                WHERE pg_catalog.jsonb_typeof(q.v) <> 'string'
                   OR (q.v #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
     OR pg_catalog.jsonb_array_length(p_offering_ids) <>
       (SELECT pg_catalog.count(DISTINCT (q.v #>> '{}') COLLATE "C")
          FROM pg_catalog.jsonb_array_elements(p_offering_ids) AS q(v)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'member_result_offerings_invalid';
  END IF;

  RETURN QUERY
  SELECT r.report_id, v.revision::text, v.profile_id,
    p.scores->>'exam_id', p.scores->>'pack_version',
    (SELECT COALESCE(pg_catalog.jsonb_object_agg(i.id, v.body->'analyses'->i.id), '{}'::jsonb)::text
       FROM pg_catalog.jsonb_array_elements_text(p_offering_ids) i(id)
      WHERE (v.body->'analyses') ? i.id),
    CASE WHEN v.body ? 'member_school_results_refs' THEN v.body::text ELSE NULL END,
    CASE WHEN v.body ? 'member_school_results_refs' THEN p.scores::text ELSE NULL END,
    CASE WHEN v.body ? 'member_school_results_refs' THEN p.confirmed ELSE NULL END,
    CASE WHEN v.body ? 'member_school_results_refs'
      THEN pg_catalog.to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ELSE NULL END,
    CASE WHEN v.body ? 'member_school_results_refs'
      THEN pg_catalog.to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ELSE NULL END
  FROM jungsi_backend.reports r
  JOIN jungsi_backend.report_revisions v
    ON (r.report_id, r.owner_id) = (v.report_id, v.owner_id)
   AND v.revision = COALESCE(p_report_revision, r.revision)
  JOIN jungsi_backend.profiles p
    ON (v.profile_id, v.owner_id) = (p.profile_id, p.owner_id)
  WHERE r.owner_id = p_subject AND v.owner_id = p_subject AND p.owner_id = p_subject
    AND v.body #>> '{overall,exam,academic_year}' = p_year
    AND (p_report_id IS NULL OR r.report_id = p_report_id)
    AND (p_report_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM jungsi_backend.score_input_states s
       WHERE s.owner_id = p_subject AND s.current_profile_id = v.profile_id))
  ORDER BY r.updated_at DESC, r.report_id COLLATE "C" DESC
  LIMIT 1;
END
$function$;

REVOKE ALL ON FUNCTION jungsi_backend.read_member_saved_results_v2(text,text,jsonb,text,bigint)
  FROM PUBLIC;
DO $optional_roles$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION jungsi_backend.read_member_saved_results_v2(text,text,jsonb,text,bigint) FROM %I',
        role_name);
    END IF;
  END LOOP;
END
$optional_roles$;
GRANT EXECUTE ON FUNCTION jungsi_backend.read_member_saved_results_v2(text,text,jsonb,text,bigint)
  TO jungsi_backend_app;

DO $check_effective_access$
DECLARE
  fn oid := pg_catalog.to_regprocedure(
    'jungsi_backend.read_member_saved_results_v2(text,text,jsonb,text,bigint)');
  other_role record;
  target text;
BEGIN
  FOR other_role IN SELECT oid, rolname FROM pg_catalog.pg_roles
    WHERE NOT rolsuper AND rolname NOT IN ('jungsi_backend_owner', 'jungsi_backend_app')
  LOOP
    IF pg_catalog.has_schema_privilege(other_role.oid, 'jungsi_backend', 'USAGE')
       AND pg_catalog.has_function_privilege(other_role.oid, fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'unexpected effective function access; preserve and review';
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['profiles','reports','report_revisions','score_input_states','score_maps'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
               WHERE p.polrelid = pg_catalog.to_regclass('jungsi_backend.' || target)
                 AND (pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
                      OR pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) = 'true')) THEN
      RAISE EXCEPTION 'owner policy was not applied on %', target;
    END IF;
  END LOOP;
END
$check_effective_access$;

INSERT INTO jungsi_backend.schema_versions(version)
  VALUES ('015_member_owner_rls_and_saved_results');
COMMIT;
