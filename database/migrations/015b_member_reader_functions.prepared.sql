-- PREPARED ONLY. Apply as jungsi_backend_owner. Adds two server-only reader
-- functions and changes no table, policy or row:
--   read_member_saved_results_v2  same 11 columns as MEMBER_RESULTS_SQL;
--   read_member_statistics_rows_v1  the rows statistics.read needs from every
--     member, reduced to analyses status/versions/converted_score, candidate
--     offering IDs and shortlist selected/profile_id/assessment_status. Other
--     members' owner IDs are replaced by a one-way UUID-shaped key.
-- The server uses both only when JUNGSI_MEMBER_RESULTS_READER=fn_v2. Register
-- 016 (owner-bound RLS) only after the server has been switched and observed,
-- because the current multi-member statistics query needs USING(true).
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
     -- The app role must not inherit or switch into any other role.
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_role)
     -- Only the observed creator entry may exist on the app role: member
     -- 'postgres', ADMIN only (PostgreSQL 16+ adds it at CREATE ROLE), no
     -- INHERIT, no SET. ADMIN can grant the role onward, so any other member,
     -- or this member with INHERIT/SET, stops for an explicit review.
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
                WHERE m.roleid = runtime_role
                  AND (m.member <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres')
                       OR m.inherit_option OR m.set_option))
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
     OR pg_catalog.to_regprocedure(
       'jungsi_backend.read_member_statistics_rows_v1(text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM jungsi_backend.schema_versions
                WHERE version IN ('015_member_owner_rls_and_saved_results',
                                  '015b_member_reader_functions')) THEN
    RAISE EXCEPTION 'existing registration must be preserved and independently reviewed';
  END IF;
  -- The statistics function runs as the table owner; it must not be subject to RLS.
  FOREACH target IN ARRAY ARRAY['profiles','reports','report_revisions','score_input_states'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                   WHERE c.oid = pg_catalog.to_regclass('jungsi_backend.' || target)
                     AND c.relowner = owner_role AND c.relrowsecurity
                     AND NOT c.relforcerowsecurity)
       OR NOT pg_catalog.has_table_privilege('jungsi_backend_app', 'jungsi_backend.' || target, 'SELECT') THEN
      RAISE EXCEPTION 'member table owner, row security or SELECT changed: %', target;
    END IF;
  END LOOP;
END
$preflight$;

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



-- C. Rows for statistics.read: one row per report at its current revision, the
-- same rows as the server's REPORT_SELECT, with a reduced body. Non-UUID owners
-- (synthetic fixtures, never a service member) are excluded.
CREATE FUNCTION jungsi_backend.read_member_statistics_rows_v1(p_subject text)
RETURNS TABLE (
  report_id text,
  owner_key text,
  profile_id text,
  report_revision text,
  body text,
  revision_created_at text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $stats$
#variable_conflict use_column
BEGIN
  IF p_subject IS NULL OR p_subject !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR pg_catalog.current_setting('request.jwt.claim.sub', true) IS DISTINCT FROM p_subject THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'member_statistics_subject_mismatch';
  END IF;
  RETURN QUERY
  SELECT r.report_id,
    CASE WHEN r.owner_id = p_subject THEN r.owner_id ELSE (
      SELECT pg_catalog.substr(h, 1, 8) || '-' || pg_catalog.substr(h, 9, 4) || '-' ||
             pg_catalog.substr(h, 13, 4) || '-' || pg_catalog.substr(h, 17, 4) || '-' ||
             pg_catalog.substr(h, 21, 12)
        FROM (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
               'jungsi-statistics-owner:' || r.owner_id, 'UTF8')), 'hex') AS h) k)
    END,
    v.profile_id,
    r.revision::text,
    (pg_catalog.jsonb_build_object(
       'analyses', CASE WHEN pg_catalog.jsonb_typeof(v.body->'analyses') = 'object' THEN (
         SELECT COALESCE(pg_catalog.jsonb_object_agg(e.k, CASE WHEN pg_catalog.jsonb_typeof(e.v) = 'object'
           THEN pg_catalog.jsonb_build_object('status', e.v->'status', 'versions', e.v->'versions',
                                              'converted_score', e.v->'converted_score')
           ELSE 'null'::jsonb END), '{}'::jsonb)
           FROM pg_catalog.jsonb_each(v.body->'analyses') AS e(k, v)) ELSE 'false'::jsonb END,
       'shortlist', CASE WHEN pg_catalog.jsonb_typeof(v.body->'shortlist') = 'object' THEN (
         SELECT COALESCE(pg_catalog.jsonb_object_agg(e.k, CASE WHEN pg_catalog.jsonb_typeof(e.v) = 'object'
           THEN pg_catalog.jsonb_build_object('selected', e.v->'selected', 'profile_id', e.v->'profile_id',
                                              'assessment_status', e.v->'assessment_status')
           ELSE 'null'::jsonb END), '{}'::jsonb)
           FROM pg_catalog.jsonb_each(v.body->'shortlist') AS e(k, v)) ELSE 'false'::jsonb END)
     || CASE
          WHEN v.body->'candidates' IS NULL OR v.body->'candidates' = 'null'::jsonb THEN '{}'::jsonb
          WHEN pg_catalog.jsonb_typeof(v.body->'candidates') <> 'object'
            THEN '{"candidates":false}'::jsonb
          WHEN v.body->'candidates'->'basic_university_groups' IS NULL
            OR v.body->'candidates'->'basic_university_groups' = 'null'::jsonb
            THEN '{"candidates":{}}'::jsonb
          WHEN pg_catalog.jsonb_typeof(v.body->'candidates'->'basic_university_groups') <> 'array'
            THEN '{"candidates":{"basic_university_groups":false}}'::jsonb
          ELSE pg_catalog.jsonb_build_object('candidates', pg_catalog.jsonb_build_object(
            'basic_university_groups', (
              SELECT COALESCE(pg_catalog.jsonb_agg(
                CASE WHEN pg_catalog.jsonb_typeof(g.x) = 'object'
                      AND pg_catalog.jsonb_typeof(g.x->'offerings') = 'array'
                  THEN pg_catalog.jsonb_build_object('offerings', (
                    SELECT COALESCE(pg_catalog.jsonb_agg(
                      CASE WHEN pg_catalog.jsonb_typeof(o.y) = 'object'
                            AND pg_catalog.jsonb_typeof(o.y->'offering') = 'object'
                        THEN pg_catalog.jsonb_build_object('offering',
                          pg_catalog.jsonb_build_object('offering_id', o.y->'offering'->'offering_id'))
                        ELSE 'false'::jsonb END ORDER BY o.n), '[]'::jsonb)
                      FROM pg_catalog.jsonb_array_elements(g.x->'offerings') WITH ORDINALITY AS o(y, n)))
                  ELSE 'false'::jsonb END ORDER BY g.n), '[]'::jsonb)
                FROM pg_catalog.jsonb_array_elements(v.body->'candidates'->'basic_university_groups')
                     WITH ORDINALITY AS g(x, n))))
        END)::text,
    pg_catalog.to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  FROM jungsi_backend.reports r
  JOIN jungsi_backend.report_revisions v
    ON (r.report_id, r.revision, r.owner_id) = (v.report_id, v.revision, v.owner_id)
  WHERE r.owner_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
END
$stats$;

REVOKE ALL ON FUNCTION jungsi_backend.read_member_saved_results_v2(text,text,jsonb,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION jungsi_backend.read_member_statistics_rows_v1(text) FROM PUBLIC;
DO $optional_roles$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION jungsi_backend.read_member_saved_results_v2(text,text,jsonb,text,bigint) FROM %I', role_name);
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION jungsi_backend.read_member_statistics_rows_v1(text) FROM %I', role_name);
    END IF;
  END LOOP;
END
$optional_roles$;
GRANT EXECUTE ON FUNCTION jungsi_backend.read_member_saved_results_v2(text,text,jsonb,text,bigint) TO jungsi_backend_app;
GRANT EXECUTE ON FUNCTION jungsi_backend.read_member_statistics_rows_v1(text) TO jungsi_backend_app;

DO $check_effective_access$
DECLARE
  fn oid;
  other_role record;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    pg_catalog.to_regprocedure('jungsi_backend.read_member_saved_results_v2(text,text,jsonb,text,bigint)'),
    pg_catalog.to_regprocedure('jungsi_backend.read_member_statistics_rows_v1(text)')] LOOP
    FOR other_role IN SELECT oid, rolname FROM pg_catalog.pg_roles
      WHERE NOT rolsuper AND rolname NOT IN ('jungsi_backend_owner', 'jungsi_backend_app')
    LOOP
      IF pg_catalog.has_schema_privilege(other_role.oid, 'jungsi_backend', 'USAGE')
         AND pg_catalog.has_function_privilege(other_role.oid, fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'unexpected effective function access; preserve and review';
      END IF;
    END LOOP;
  END LOOP;
END
$check_effective_access$;

INSERT INTO jungsi_backend.schema_versions(version) VALUES ('015b_member_reader_functions');
COMMIT;
