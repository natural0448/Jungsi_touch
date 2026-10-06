-- REVIEW CANDIDATE: execution requires planning adoption and fresh preflight.
-- Preserve public/Auth tables, roles, owners, policies and existing grants.
-- Trusted backend policies: service queries enforce verified caller scope.
-- No future default grants; later tables/sequences require explicit review.
BEGIN;
SELECT pg_advisory_xact_lock(74961006003);
DO $runtime_access$
DECLARE
  runtime_oid oid; schema_oid oid; table_oid oid;
  table_name text; action_name text; policy_name text; policy_command "char";
  existing_policy record; statements text;
  all_tables text[] := ARRAY['schema_versions','profiles','reports','report_revisions',
    'requests','entitlements','audit_events','artifact_releases','forecast_authorities',
    'forecast_drafts','forecast_revisions','forecast_releases','forecast_requests'];
  insert_tables text[] := ARRAY['profiles','reports','report_revisions','requests',
    'audit_events','forecast_drafts','forecast_revisions',
    'forecast_releases','forecast_requests'];
  update_tables text[] := ARRAY['reports','forecast_drafts'];
BEGIN
  IF current_user <> 'jungsi_backend_owner' THEN RAISE EXCEPTION 'migration owner role required'; END IF;
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles WHERE rolname='jungsi_backend_app'
    AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb;
  IF runtime_oid IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=runtime_oid) THEN
    RAISE EXCEPTION 'dedicated runtime role or membership mismatch';
  END IF;
  SELECT oid INTO schema_oid FROM pg_catalog.pg_namespace WHERE nspname='jungsi_backend'
    AND pg_get_userbyid(nspowner)=current_user;
  IF schema_oid IS NULL THEN RAISE EXCEPTION 'private schema owner mismatch'; END IF;
  IF has_schema_privilege('anon',schema_oid,'USAGE,CREATE')
     OR has_schema_privilege('authenticated',schema_oid,'USAGE,CREATE')
     OR has_schema_privilege(runtime_oid,schema_oid,'CREATE') THEN
    RAISE EXCEPTION 'unexpected private schema access';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='001_pre_data_platform')
     OR NOT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='002_forecast_policy') THEN
    RAISE EXCEPTION 'required migrations missing';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace=schema_oid AND relkind='r') <> 13 THEN
    RAISE EXCEPTION 'private table scope changed';
  END IF;
  FOREACH table_name IN ARRAY all_tables LOOP
    SELECT oid INTO table_oid FROM pg_catalog.pg_class WHERE relnamespace=schema_oid
      AND relname=table_name AND relkind='r' AND pg_get_userbyid(relowner)=current_user
      AND relrowsecurity AND NOT relforcerowsecurity;
    IF table_oid IS NULL THEN RAISE EXCEPTION 'private table owner or RLS mismatch'; END IF;
    IF has_table_privilege(runtime_oid,table_oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(runtime_oid,table_oid,'REFERENCES') THEN
      RAISE EXCEPTION 'unexpected runtime destructive privilege';
    END IF;
    IF table_name=ANY(update_tables) AND (
      has_table_privilege(runtime_oid,table_oid,'UPDATE') OR EXISTS(
        SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=table_oid
          AND a.attnum>0 AND NOT a.attisdropped
          AND has_column_privilege(runtime_oid,table_oid,a.attnum,'UPDATE')
          AND NOT a.attname=ANY(CASE table_name WHEN 'reports'
            THEN ARRAY['revision','profile_id','updated_at']
            ELSE ARRAY['revision','body','updated_at'] END))) THEN
      RAISE EXCEPTION 'table-wide or outside-column update privilege; preserve and review';
    END IF;
    IF NOT table_name=ANY(update_tables) AND has_any_column_privilege(runtime_oid,table_oid,'UPDATE') THEN
      RAISE EXCEPTION 'append or read-only table already writable';
    END IF;
    IF NOT table_name=ANY(insert_tables) AND has_any_column_privilege(runtime_oid,table_oid,'INSERT') THEN
      RAISE EXCEPTION 'read-only table already insertable';
    END IF;
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=table_oid
      AND (polname NOT IN ('jungsi runtime select','jungsi runtime insert','jungsi runtime update')
        OR (polname='jungsi runtime insert' AND NOT table_name=ANY(insert_tables))
        OR (polname='jungsi runtime update' AND NOT table_name=ANY(update_tables)))) THEN
      RAISE EXCEPTION 'unknown existing private policy; preserve and review';
    END IF;
    FOREACH action_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
      IF action_name='INSERT' AND NOT table_name=ANY(insert_tables) THEN CONTINUE; END IF;
      IF action_name='UPDATE' AND NOT table_name=ANY(update_tables) THEN CONTINUE; END IF;
      policy_name := 'jungsi runtime ' || lower(action_name);
      policy_command := CASE action_name WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a' ELSE 'w' END;
      SELECT * INTO existing_policy FROM pg_catalog.pg_policy WHERE polrelid=table_oid AND polname=policy_name;
      IF FOUND THEN
        IF existing_policy.polcmd<>policy_command OR NOT existing_policy.polpermissive
          OR existing_policy.polroles<>ARRAY[runtime_oid]::oid[]
          OR (action_name='INSERT' AND existing_policy.polqual IS NOT NULL)
          OR (action_name<>'INSERT' AND pg_get_expr(existing_policy.polqual,table_oid) IS DISTINCT FROM 'true')
          OR (action_name='SELECT' AND existing_policy.polwithcheck IS NOT NULL)
          OR (action_name<>'SELECT' AND pg_get_expr(existing_policy.polwithcheck,table_oid) IS DISTINCT FROM 'true') THEN
          RAISE EXCEPTION 'existing runtime policy differs; preserve and review';
        END IF;
      ELSE
        statements := CASE action_name WHEN 'SELECT' THEN 'USING (true)'
          WHEN 'INSERT' THEN 'WITH CHECK (true)' ELSE 'USING (true) WITH CHECK (true)' END;
        EXECUTE format('CREATE POLICY %I ON jungsi_backend.%I FOR %s TO jungsi_backend_app %s',
          policy_name,table_name,action_name,statements);
      END IF;
      IF action_name='UPDATE' THEN
        statements := CASE table_name WHEN 'reports' THEN 'revision,profile_id,updated_at'
          ELSE 'revision,body,updated_at' END;
        EXECUTE format('GRANT UPDATE (%s) ON TABLE jungsi_backend.%I TO jungsi_backend_app',statements,table_name);
      ELSE
        EXECUTE format('GRANT %s ON TABLE jungsi_backend.%I TO jungsi_backend_app',action_name,table_name);
      END IF;
    END LOOP;
  END LOOP;
END
$runtime_access$;
GRANT USAGE ON SCHEMA jungsi_backend TO jungsi_backend_app;
INSERT INTO jungsi_backend.schema_versions(version) VALUES('003_runtime_role_access')
  ON CONFLICT(version) DO NOTHING;
COMMIT;
