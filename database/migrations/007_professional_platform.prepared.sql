-- Prepared additive schema only. No institutions, members, students, contracts or rights are seeded.
-- Apply only the reviewed exact bytes as existing jungsi_backend_owner; never as the runtime role.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL TIME ZONE 'UTC';
SELECT pg_advisory_xact_lock(74961021007);
DO $preflight$
BEGIN
 IF current_user<>'jungsi_backend_owner' THEN RAISE EXCEPTION 'existing schema owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='006_score_input_policy') THEN
  RAISE EXCEPTION 'existing 006 schema required'; END IF;
 IF EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='007_professional_platform')
 OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='jungsi_professional') THEN
  RAISE EXCEPTION 'preserve existing professional schema and verify instead of reapplying'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='jungsi_backend_app'
  AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole) THEN
  RAISE EXCEPTION 'runtime role unverified'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
  WHERE r.rolname='jungsi_backend_app') THEN RAISE EXCEPTION 'unexpected runtime membership'; END IF;
END
$preflight$;
CREATE SCHEMA jungsi_professional AUTHORIZATION jungsi_backend_owner;
REVOKE ALL ON SCHEMA jungsi_professional FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA jungsi_professional TO jungsi_backend_app;

CREATE TABLE jungsi_professional.students (
 org_id text NOT NULL,student_id text NOT NULL,contract_id text NOT NULL,
 academic_year integer NOT NULL CHECK(academic_year>0),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 sealed_metadata text NOT NULL CHECK(octet_length(sealed_metadata) BETWEEN 1 AND 2097152),
 archived boolean NOT NULL DEFAULT false,created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,student_id),UNIQUE(org_id,contract_id,student_id)
);
CREATE TABLE jungsi_professional.seat_allocations (
 org_id text NOT NULL,contract_id text NOT NULL,student_id text NOT NULL,
 contract_version bigint NOT NULL CHECK(contract_version>0),
 allocation_no bigint NOT NULL CHECK(allocation_no>0),
 capacity_snapshot bigint NOT NULL CHECK(capacity_snapshot>=allocation_no),
 actor_id text NOT NULL,request_key text NOT NULL,digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,contract_id,student_id),UNIQUE(org_id,contract_id,allocation_no),
 FOREIGN KEY(org_id,student_id) REFERENCES jungsi_professional.students(org_id,student_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE jungsi_professional.students ADD FOREIGN KEY(org_id,contract_id,student_id)
 REFERENCES jungsi_professional.seat_allocations(org_id,contract_id,student_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE jungsi_professional.assignments (
 org_id text NOT NULL,student_id text NOT NULL,version bigint NOT NULL CHECK(version>0),
 subject_ids text[] NOT NULL CHECK((cardinality(subject_ids)=0 OR array_ndims(subject_ids)=1) AND cardinality(subject_ids) BETWEEN 0 AND 64
  AND array_position(subject_ids,NULL) IS NULL),
 actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,student_id,version),
 FOREIGN KEY(org_id,student_id) REFERENCES jungsi_professional.students(org_id,student_id)
);
CREATE TABLE jungsi_professional.profiles (
 org_id text NOT NULL,student_id text NOT NULL,profile_id text NOT NULL,
 input_scope text NOT NULL,stage text NOT NULL CHECK(stage IN('mock','provisional','final')),
 state_version bigint NOT NULL CHECK(state_version>0),version bigint NOT NULL CHECK(version=1),
 exam_id text NOT NULL,pack_version text NOT NULL,
 scores jsonb NOT NULL CHECK(jsonb_typeof(scores)='object'),
 scores_sha256 text NOT NULL CHECK(scores_sha256~'^[a-f0-9]{64}$'),
 confirmed boolean NOT NULL CHECK(confirmed),actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,student_id,profile_id),UNIQUE(org_id,student_id,input_scope,stage,profile_id),UNIQUE(org_id,student_id,profile_id,exam_id,stage),
 FOREIGN KEY(org_id,student_id) REFERENCES jungsi_professional.students(org_id,student_id)
);
CREATE TABLE jungsi_professional.reports (
 org_id text NOT NULL,student_id text NOT NULL,report_id text NOT NULL,profile_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,student_id,report_id),UNIQUE(org_id,student_id,profile_id),UNIQUE(org_id,student_id,report_id,profile_id),
 FOREIGN KEY(org_id,student_id,profile_id) REFERENCES jungsi_professional.profiles(org_id,student_id,profile_id)
);
CREATE TABLE jungsi_professional.report_revisions (
 org_id text NOT NULL,student_id text NOT NULL,report_id text NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 profile_id text NOT NULL,exam_id text NOT NULL,stage text NOT NULL CHECK(stage IN('mock','provisional','final')),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
 reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array'),
 body_sha256 text NOT NULL CHECK(body_sha256~'^[a-f0-9]{64}$'),
 actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,student_id,report_id,revision),
 FOREIGN KEY(org_id,student_id,report_id,profile_id) REFERENCES jungsi_professional.reports(org_id,student_id,report_id,profile_id),
 FOREIGN KEY(org_id,student_id,profile_id,exam_id,stage) REFERENCES jungsi_professional.profiles(org_id,student_id,profile_id,exam_id,stage)
);
ALTER TABLE jungsi_professional.reports ADD FOREIGN KEY(org_id,student_id,report_id,revision)
 REFERENCES jungsi_professional.report_revisions(org_id,student_id,report_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE jungsi_professional.input_states (
 org_id text NOT NULL,student_id text NOT NULL,input_scope text NOT NULL,
 stage text NOT NULL CHECK(stage IN('mock','provisional','final')),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 initial_attempt_id text,correction_grant_id text,correction_attempt_id text,current_profile_id text,
 last_attempt_id text,last_outcome text CHECK(last_outcome IN('accepted','rejected')),last_rejection_code text,
 policy_version text NOT NULL,approval_sha256 text NOT NULL CHECK(approval_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,student_id,input_scope,stage,version),
 FOREIGN KEY(org_id,student_id) REFERENCES jungsi_professional.students(org_id,student_id),
 FOREIGN KEY(org_id,student_id,input_scope,stage,current_profile_id) REFERENCES jungsi_professional.profiles(org_id,student_id,input_scope,stage,profile_id),
 CHECK(correction_grant_id IS NULL OR initial_attempt_id IS NOT NULL),
 CHECK(correction_attempt_id IS NULL OR correction_grant_id IS NOT NULL),
 CHECK((last_attempt_id IS NULL AND last_outcome IS NULL AND last_rejection_code IS NULL)
  OR(last_attempt_id IS NOT NULL AND last_outcome='accepted' AND current_profile_id IS NOT NULL AND last_rejection_code IS NULL)
  OR(last_attempt_id IS NOT NULL AND last_outcome='rejected' AND last_rejection_code~'^[a-z][a-z0-9_]{0,63}$'))
);
CREATE TABLE jungsi_professional.input_attempts (
 org_id text NOT NULL,student_id text NOT NULL,attempt_id text NOT NULL,input_scope text NOT NULL,
 stage text NOT NULL,state_version bigint NOT NULL,exam_id text NOT NULL,pack_version text NOT NULL,
 actor_id text NOT NULL,operation text NOT NULL CHECK(operation='pro.score.create'),request_key text NOT NULL,
 request_digest text NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 outcome text NOT NULL CHECK(outcome IN('accepted','rejected')),profile_id text,rejection_code text,
 policy_version text NOT NULL,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,student_id,attempt_id),UNIQUE(org_id,student_id,actor_id,operation,request_key),UNIQUE(org_id,student_id,input_scope,stage,attempt_id),
 UNIQUE(org_id,student_id,profile_id),
 FOREIGN KEY(org_id,student_id,input_scope,stage,state_version)
  REFERENCES jungsi_professional.input_states(org_id,student_id,input_scope,stage,version) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(org_id,student_id,input_scope,stage,profile_id) REFERENCES jungsi_professional.profiles(org_id,student_id,input_scope,stage,profile_id),
 CHECK((outcome='accepted' AND profile_id IS NOT NULL AND rejection_code IS NULL)
  OR(outcome='rejected' AND profile_id IS NULL AND rejection_code IN('unobserved_standard_score','invalid_score','invalid_integer','invalid_grade','invalid_reported_grade','invalid_reported_percentile','reported_grade_conflict','reported_percentile_conflict')))
);
CREATE TABLE jungsi_professional.corrections (
 org_id text NOT NULL,student_id text NOT NULL,command_id text NOT NULL,input_scope text NOT NULL,stage text NOT NULL,
 support_actor_id text NOT NULL,ticket_ref text NOT NULL,
 expected_version bigint NOT NULL CHECK(expected_version>0),granted_version bigint NOT NULL CHECK(granted_version=expected_version+1),
 previous_attempt_id text NOT NULL,request_key text NOT NULL,digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),
 policy_version text NOT NULL,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,student_id,command_id),UNIQUE(org_id,student_id,input_scope,stage),UNIQUE(org_id,student_id,input_scope,stage,command_id),
 UNIQUE(org_id,support_actor_id,request_key),UNIQUE(org_id,ticket_ref),
 FOREIGN KEY(org_id,student_id,input_scope,stage,granted_version)
  REFERENCES jungsi_professional.input_states(org_id,student_id,input_scope,stage,version) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(org_id,student_id,input_scope,stage,previous_attempt_id) REFERENCES jungsi_professional.input_attempts(org_id,student_id,input_scope,stage,attempt_id)
);
ALTER TABLE jungsi_professional.profiles ADD FOREIGN KEY(org_id,student_id,input_scope,stage,state_version)
 REFERENCES jungsi_professional.input_states(org_id,student_id,input_scope,stage,version) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE jungsi_professional.input_states ADD FOREIGN KEY(org_id,student_id,input_scope,stage,initial_attempt_id)
 REFERENCES jungsi_professional.input_attempts(org_id,student_id,input_scope,stage,attempt_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE jungsi_professional.input_states ADD FOREIGN KEY(org_id,student_id,input_scope,stage,last_attempt_id)
 REFERENCES jungsi_professional.input_attempts(org_id,student_id,input_scope,stage,attempt_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE jungsi_professional.input_states ADD FOREIGN KEY(org_id,student_id,input_scope,stage,correction_attempt_id)
 REFERENCES jungsi_professional.input_attempts(org_id,student_id,input_scope,stage,attempt_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE jungsi_professional.input_states ADD FOREIGN KEY(org_id,student_id,input_scope,stage,correction_grant_id)
 REFERENCES jungsi_professional.corrections(org_id,student_id,input_scope,stage,command_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE jungsi_professional.bookmarks (
 org_id text NOT NULL,student_id text NOT NULL,report_id text NOT NULL,offering_id text NOT NULL,
 actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,student_id,report_id,offering_id),
 FOREIGN KEY(org_id,student_id,report_id) REFERENCES jungsi_professional.reports(org_id,student_id,report_id)
);
CREATE TABLE jungsi_professional.operation_requests (
 org_id text NOT NULL,actor_id text NOT NULL,operation text NOT NULL,resource_key text NOT NULL,
 request_key text NOT NULL,digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),
 sealed_result text NOT NULL CHECK(octet_length(sealed_result) BETWEEN 1 AND 16777216),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,actor_id,operation,resource_key,request_key)
);
CREATE TABLE jungsi_professional.usage_windows (
 org_id text NOT NULL,contract_id text NOT NULL,policy_version text NOT NULL,scope_key text NOT NULL,
 dimension text NOT NULL CHECK(dimension IN('request_window','calculation_cost','concurrent_jobs','result_volume')),
 period_seconds bigint NOT NULL CHECK(period_seconds>0),window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 capacity bigint NOT NULL CHECK(capacity>=0),used_units bigint NOT NULL DEFAULT 0 CHECK(used_units>=0),
 reserved_units bigint NOT NULL DEFAULT 0 CHECK(reserved_units>=0),
 PRIMARY KEY(org_id,contract_id,policy_version,scope_key,dimension,period_seconds,window_start),
 CHECK(window_end>window_start),CHECK(used_units+reserved_units<=capacity)
);
CREATE TABLE jungsi_professional.usage_leases (
 org_id text NOT NULL,contract_id text NOT NULL,lease_id text NOT NULL,actor_id text NOT NULL,student_id text,
 policy_version text NOT NULL,operation text NOT NULL,shared_lease_id text NOT NULL,
 state text NOT NULL CHECK(state IN('active','success','failure','expired')),demands jsonb NOT NULL CHECK(jsonb_typeof(demands)='array'),
 expires_at timestamptz NOT NULL,result_bytes bigint CHECK(result_bytes>=0),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),settled_at timestamptz,
 PRIMARY KEY(org_id,lease_id),
 CHECK((state='active' AND settled_at IS NULL AND result_bytes IS NULL)
  OR(state<>'active' AND settled_at IS NOT NULL)),
 FOREIGN KEY(org_id,student_id) REFERENCES jungsi_professional.students(org_id,student_id)
);
CREATE TABLE jungsi_professional.audit_events (
 org_id text NOT NULL,event_id text NOT NULL,student_id text,actor_id text NOT NULL,
 operation text NOT NULL,request_id text NOT NULL CHECK(request_id~'^[a-f0-9]{32}$'),
 result text NOT NULL CHECK(result IN('success','rejected')),ticket_ref text,
 occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(org_id,event_id),
 FOREIGN KEY(org_id,student_id) REFERENCES jungsi_professional.students(org_id,student_id)
);
CREATE TABLE jungsi_professional.retention_previews (
 org_id text NOT NULL,preview_id text NOT NULL,contract_id text NOT NULL,academic_year integer NOT NULL,
 official_deadline_reference text NOT NULL,cutoff_at timestamptz NOT NULL,
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256~'^[a-f0-9]{64}$'),actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),PRIMARY KEY(org_id,preview_id)
);
CREATE INDEX pro_student_contract ON jungsi_professional.students(org_id,contract_id,student_id);
CREATE INDEX pro_assignment_latest ON jungsi_professional.assignments(org_id,student_id,version DESC);
CREATE INDEX pro_profile_scope ON jungsi_professional.profiles(org_id,student_id,input_scope,stage);
CREATE INDEX pro_state_latest ON jungsi_professional.input_states(org_id,student_id,input_scope,stage,version DESC);
CREATE INDEX pro_report_student ON jungsi_professional.reports(org_id,student_id,updated_at DESC,report_id);
CREATE INDEX pro_active_usage ON jungsi_professional.usage_leases(org_id,contract_id,policy_version,expires_at) WHERE state='active';
CREATE FUNCTION jungsi_professional.reject_mutation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'professional ledger records are immutable'; END
$immutable$;
REVOKE ALL ON FUNCTION jungsi_professional.reject_mutation_v1() FROM PUBLIC,anon,authenticated,jungsi_backend_app;
DO $permissions$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['students','seat_allocations','assignments','profiles','reports','report_revisions','input_states','input_attempts','corrections','bookmarks','operation_requests','usage_windows','usage_leases','audit_events','retention_previews'] LOOP
  EXECUTE format('ALTER TABLE jungsi_professional.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON jungsi_professional.%I FROM PUBLIC,anon,authenticated,jungsi_backend_app',name);
  EXECUTE format('CREATE POLICY pro_scoped_read ON jungsi_professional.%I FOR SELECT TO jungsi_backend_app USING(org_id=current_setting(''jungsi.pro.org_id'',true))',name);
  EXECUTE format('CREATE POLICY pro_scoped_insert ON jungsi_professional.%I FOR INSERT TO jungsi_backend_app WITH CHECK(org_id=current_setting(''jungsi.pro.org_id'',true))',name);
  EXECUTE format('GRANT SELECT,INSERT ON jungsi_professional.%I TO jungsi_backend_app',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['students','reports','usage_windows','usage_leases'] LOOP
  EXECUTE format('CREATE POLICY pro_scoped_update ON jungsi_professional.%I FOR UPDATE TO jungsi_backend_app USING(org_id=current_setting(''jungsi.pro.org_id'',true)) WITH CHECK(org_id=current_setting(''jungsi.pro.org_id'',true))',name);
  EXECUTE format('GRANT UPDATE ON jungsi_professional.%I TO jungsi_backend_app',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['seat_allocations','assignments','profiles','report_revisions','input_states','input_attempts','corrections','bookmarks','operation_requests','audit_events','retention_previews'] LOOP
  EXECUTE format('CREATE TRIGGER pro_preserve_ledger BEFORE UPDATE OR DELETE ON jungsi_professional.%I FOR EACH ROW EXECUTE FUNCTION jungsi_professional.reject_mutation_v1()',name);
 END LOOP;
END
$permissions$;
INSERT INTO jungsi_backend.schema_versions(version) VALUES('007_professional_platform');
COMMIT;
-- No changes to existing personal relations, roles, source data, passes, counters or operating policy.
-- EduTouch authority tables, member grants and live policy are not created or guessed here.
