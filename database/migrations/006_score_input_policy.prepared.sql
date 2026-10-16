-- Prepared only. No application/activation is performed by creating this file.
-- Adds immutable rights/correction/result-delivery ledgers. Existing pass/profile/report data is retained.
BEGIN;
SELECT pg_advisory_xact_lock(74961016006);
DO $preflight$
DECLARE target text;
BEGIN
 IF current_user <> 'jungsi_backend_owner' THEN RAISE EXCEPTION 'migration owner role required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='005_usage_budget') THEN
  RAISE EXCEPTION 'existing usage budget schema required'; END IF;
 IF EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='006_score_input_policy') THEN
  RAISE EXCEPTION 'already registered; preserve and verify instead of reapplying'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='jungsi_backend_app'
    AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb) THEN
  RAISE EXCEPTION 'runtime role unverified'; END IF;
 FOREACH target IN ARRAY ARRAY['score_input_states','score_input_attempts','score_input_corrections',
   'score_result_origins','paid_result_first_use','score_policy_rollouts','score_input_legacy_links'] LOOP
  IF to_regclass('jungsi_backend.'||target) IS NOT NULL THEN
   RAISE EXCEPTION 'unregistered relation exists; preserve and review'; END IF;
 END LOOP;
END
$preflight$;
CREATE TABLE jungsi_backend.score_policy_rollouts (
 rollout_id text PRIMARY KEY,
 policy_version text NOT NULL,
 approval_sha256 text NOT NULL CHECK(approval_sha256 ~ '^[a-f0-9]{64}$'),
 legacy_manifest_sha256 text NOT NULL CHECK(legacy_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 validated_legacy_profiles bigint NOT NULL CHECK(validated_legacy_profiles>=0),
 legacy_cutoff_at timestamptz NOT NULL,
 validated_at timestamptz NOT NULL,
 validated_by text NOT NULL,
 status text NOT NULL CHECK(status='validated')
);
CREATE TABLE jungsi_backend.score_input_states (
 owner_id text NOT NULL, input_scope text NOT NULL,
 stage text NOT NULL CHECK(stage IN ('mock','provisional','final')),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 initial_attempt_id text, correction_grant_id text, correction_attempt_id text,
 current_profile_id text, last_attempt_id text,
 last_outcome text CHECK(last_outcome IN ('accepted','rejected')),
 last_rejection_code text,
 policy_version text NOT NULL, rollout_id text NOT NULL REFERENCES jungsi_backend.score_policy_rollouts(rollout_id),
 approval_sha256 text NOT NULL CHECK(approval_sha256 ~ '^[a-f0-9]{64}$'),
 preview_exempt boolean NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,input_scope,stage,version),
 FOREIGN KEY(current_profile_id,owner_id) REFERENCES jungsi_backend.profiles(profile_id,owner_id),
 CHECK(correction_grant_id IS NULL OR initial_attempt_id IS NOT NULL),
 CHECK(correction_attempt_id IS NULL OR correction_grant_id IS NOT NULL),
 CHECK((last_attempt_id IS NULL AND last_outcome IS NULL AND last_rejection_code IS NULL)
    OR (last_attempt_id IS NOT NULL AND last_outcome IS NOT NULL AND last_outcome='accepted' AND current_profile_id IS NOT NULL AND last_rejection_code IS NULL)
    OR (last_attempt_id IS NOT NULL AND last_outcome IS NOT NULL AND last_outcome='rejected' AND last_rejection_code IS NOT NULL AND last_rejection_code ~ '^[a-z][a-z0-9_]{0,63}$'))
);
CREATE TABLE jungsi_backend.score_input_attempts (
 attempt_id text PRIMARY KEY,
 owner_id text NOT NULL, input_scope text NOT NULL, stage text NOT NULL,
 state_version bigint NOT NULL,
 exam_id text NOT NULL, pack_version text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('score-profile.create','overall.profile','legacy.register')),
 request_key text NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 outcome text NOT NULL CHECK(outcome IN ('accepted','rejected')),
 profile_id text, rejection_code text,
 origin_kind text NOT NULL CHECK(origin_kind IN ('new','legacy_registered')),
 preview_exempt boolean NOT NULL,
 policy_version text NOT NULL, occurred_at timestamptz NOT NULL,
 UNIQUE(owner_id,operation,request_key),
 UNIQUE(owner_id,input_scope,stage,attempt_id),
 UNIQUE(profile_id,owner_id),
 FOREIGN KEY(profile_id,owner_id) REFERENCES jungsi_backend.profiles(profile_id,owner_id),
 FOREIGN KEY(owner_id,input_scope,stage,state_version)
  REFERENCES jungsi_backend.score_input_states(owner_id,input_scope,stage,version)
  DEFERRABLE INITIALLY DEFERRED,
 CHECK((outcome='accepted' AND profile_id IS NOT NULL AND rejection_code IS NULL)
 OR (outcome='rejected' AND profile_id IS NULL AND rejection_code IS NOT NULL AND rejection_code IN (
 'unobserved_standard_score','invalid_score','invalid_integer','invalid_grade',
 'invalid_reported_grade','invalid_reported_percentile','reported_grade_conflict','reported_percentile_conflict'))),
 CHECK(origin_kind<>'legacy_registered' OR operation='legacy.register' AND outcome='accepted')
);
CREATE TABLE jungsi_backend.score_input_corrections (
 command_id text PRIMARY KEY,
 actor_id text NOT NULL, owner_id text NOT NULL, input_scope text NOT NULL, stage text NOT NULL,
 ticket_ref text NOT NULL UNIQUE,
 expected_version bigint NOT NULL CHECK(expected_version>=1),
 granted_version bigint NOT NULL CHECK(granted_version=expected_version+1),
 reason_code text NOT NULL CHECK(reason_code='score_correction'),
 request_key text NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 previous_attempt_id text NOT NULL,
 policy_version text NOT NULL, occurred_at timestamptz NOT NULL,
 UNIQUE(actor_id,request_key), UNIQUE(owner_id,input_scope,stage),
 UNIQUE(owner_id,input_scope,stage,command_id),
 FOREIGN KEY(owner_id,input_scope,stage,granted_version)
  REFERENCES jungsi_backend.score_input_states(owner_id,input_scope,stage,version)
  DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(owner_id,input_scope,stage,previous_attempt_id)
  REFERENCES jungsi_backend.score_input_attempts(owner_id,input_scope,stage,attempt_id)
  DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE jungsi_backend.score_input_states ADD FOREIGN KEY(owner_id,input_scope,stage,initial_attempt_id)
 REFERENCES jungsi_backend.score_input_attempts(owner_id,input_scope,stage,attempt_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE jungsi_backend.score_input_states ADD FOREIGN KEY(owner_id,input_scope,stage,correction_attempt_id)
 REFERENCES jungsi_backend.score_input_attempts(owner_id,input_scope,stage,attempt_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE jungsi_backend.score_input_states ADD FOREIGN KEY(owner_id,input_scope,stage,last_attempt_id)
 REFERENCES jungsi_backend.score_input_attempts(owner_id,input_scope,stage,attempt_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE jungsi_backend.score_input_states ADD FOREIGN KEY(owner_id,input_scope,stage,correction_grant_id)
 REFERENCES jungsi_backend.score_input_corrections(owner_id,input_scope,stage,command_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE jungsi_backend.score_result_origins (
 origin_id text PRIMARY KEY,
 owner_id text NOT NULL, report_id text NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 component_key text NOT NULL,
 source_operation text NOT NULL CHECK(source_operation IN ('overall.analyze','university.analyze','candidates.build')),
 pass_id bigint CHECK(pass_id>0),
 access_basis text NOT NULL CHECK(access_basis IN ('customer_pass','verified_admin')),
 created_at timestamptz NOT NULL,
 UNIQUE(report_id,revision,component_key),
 FOREIGN KEY(report_id,owner_id) REFERENCES jungsi_backend.reports(report_id,owner_id),
 FOREIGN KEY(report_id,revision) REFERENCES jungsi_backend.report_revisions(report_id,revision),
 CHECK((access_basis='customer_pass' AND pass_id IS NOT NULL) OR
       (access_basis='verified_admin' AND pass_id IS NULL))
);
CREATE TABLE jungsi_backend.paid_result_first_use (
 pass_id bigint PRIMARY KEY CHECK(pass_id>0),
 owner_id text NOT NULL,
 origin_id text NOT NULL REFERENCES jungsi_backend.score_result_origins(origin_id),
 source_operation text NOT NULL CHECK(source_operation IN ('overall.analyze','university.analyze','candidates.build')),
 access_operation text NOT NULL CHECK(access_operation IN ('overall.analyze','university.analyze','candidates.build','report.read','report.export')),
 usage_basis text NOT NULL CHECK(usage_basis IN ('current_paid_operation','pending_original_delivery')),
 delivery_request_id text NOT NULL CHECK(delivery_request_id ~ '^[a-f0-9]{32}$'),
 first_result_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE jungsi_backend.score_input_legacy_links (
 profile_id text NOT NULL, owner_id text NOT NULL, input_scope text NOT NULL, stage text NOT NULL,
 rollout_id text NOT NULL REFERENCES jungsi_backend.score_policy_rollouts(rollout_id),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 saved_snapshot_basis text NOT NULL CHECK(saved_snapshot_basis IN ('restricted','verified_admin','verified_customer_pass')),
 registered_at timestamptz NOT NULL, registered_by text NOT NULL,
 PRIMARY KEY(profile_id,owner_id),
 FOREIGN KEY(profile_id,owner_id) REFERENCES jungsi_backend.profiles(profile_id,owner_id)
);
CREATE INDEX score_profile_owner_exam ON jungsi_backend.profiles(owner_id,(scores->>'exam_id'));
CREATE INDEX score_report_owner_profile_recent ON jungsi_backend.reports(owner_id,profile_id,updated_at DESC,report_id DESC);
CREATE INDEX score_input_latest_state ON jungsi_backend.score_input_states(owner_id,input_scope,stage,version DESC);
CREATE INDEX score_input_profile_link ON jungsi_backend.score_input_attempts(owner_id,profile_id);
CREATE INDEX score_result_origin_lookup ON jungsi_backend.score_result_origins(owner_id,report_id,component_key,revision DESC);
CREATE FUNCTION jungsi_backend.reject_score_policy_mutation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'score policy records are immutable'; END
$immutable$;
DO $new_tables$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['score_input_states','score_input_attempts','score_input_corrections',
  'score_result_origins','paid_result_first_use','score_policy_rollouts','score_input_legacy_links'] LOOP
  EXECUTE format('ALTER TABLE jungsi_backend.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON jungsi_backend.%I FROM PUBLIC,anon,authenticated,jungsi_backend_app',name);
  EXECUTE format('CREATE POLICY "jungsi policy read" ON jungsi_backend.%I FOR SELECT TO jungsi_backend_app USING(true)',name);
  EXECUTE format('GRANT SELECT ON jungsi_backend.%I TO jungsi_backend_app',name);
  EXECUTE format('CREATE TRIGGER preserve_score_policy_records BEFORE UPDATE OR DELETE ON jungsi_backend.%I FOR EACH ROW EXECUTE FUNCTION jungsi_backend.reject_score_policy_mutation_v1()',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['score_input_states','score_input_attempts','score_input_corrections',
  'score_result_origins','paid_result_first_use'] LOOP
  EXECUTE format('CREATE POLICY "jungsi policy insert" ON jungsi_backend.%I FOR INSERT TO jungsi_backend_app WITH CHECK(true)',name);
  EXECUTE format('GRANT INSERT ON jungsi_backend.%I TO jungsi_backend_app',name);
 END LOOP;
END
$new_tables$;
-- Owner-side server RPC. No public/browser execution; existing source pass identity is checked.
CREATE FUNCTION jungsi_backend.read_paid_result_first_use_v1(target_subject text,target_pass_id bigint)
RETURNS TABLE(pass_id bigint,owner_id text,first_result_at timestamptz,source_operation text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,jungsi_backend,public AS $owner_read$
 SELECT u.pass_id,u.owner_id,u.first_result_at,u.source_operation
 FROM jungsi_backend.paid_result_first_use u
 JOIN public.jeongsi_passes p ON p.id=u.pass_id AND p.user_id::text=u.owner_id
 WHERE current_user='jungsi_backend_owner' AND u.owner_id=target_subject AND u.pass_id=target_pass_id
$owner_read$;
REVOKE ALL ON FUNCTION jungsi_backend.read_paid_result_first_use_v1(text,bigint) FROM PUBLIC,anon,authenticated,jungsi_backend_app;
GRANT EXECUTE ON FUNCTION jungsi_backend.read_paid_result_first_use_v1(text,bigint) TO jungsi_backend_owner;
REVOKE ALL ON FUNCTION jungsi_backend.reject_score_policy_mutation_v1() FROM PUBLIC,anon,authenticated;
INSERT INTO jungsi_backend.schema_versions(version) VALUES('006_score_input_policy');
-- No rollout, legacy mapping, profile, pass, report, result use, capacity or data rows are seeded here.
COMMIT;
