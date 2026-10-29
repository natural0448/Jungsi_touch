-- REVIEW CANDIDATE ONLY. Never applied here. Assign a final migration number separately.
-- Additive one-off period renewal. Existing ledgers, rollouts and legacy links are never changed.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog;
SELECT pg_catalog.pg_advisory_xact_lock(74961029071);
DO $preflight$
DECLARE target text;
BEGIN
 IF current_user<>'jungsi_backend_owner' THEN RAISE EXCEPTION 'existing backend owner required'; END IF;
 IF current_setting('session_replication_role')<>'origin' THEN RAISE EXCEPTION 'origin trigger mode required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='006_score_input_policy') THEN
  RAISE EXCEPTION 'existing 006 registration required'; END IF;
 IF EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='score_policy_period_renewal_2026')
 OR pg_catalog.to_regclass('jungsi_backend.score_policy_period_renewals') IS NOT NULL
 OR pg_catalog.to_regprocedure('jungsi_backend.validate_score_policy_period_renewal_v1()') IS NOT NULL THEN
  RAISE EXCEPTION 'existing registration must be preserved and independently reviewed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='jungsi_backend_app'
  AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles app
  JOIN pg_catalog.pg_roles manager ON manager.rolname='postgres'
  JOIN pg_catalog.pg_auth_members m ON m.roleid=app.oid AND m.member=manager.oid
  WHERE app.rolname='jungsi_backend_app'
   AND m.admin_option IS TRUE AND m.inherit_option IS FALSE AND m.set_option IS FALSE
   AND (SELECT count(*) FROM pg_catalog.pg_auth_members e
        WHERE e.member=app.oid OR e.roleid=app.oid)=1) THEN
  RAISE EXCEPTION 'existing runtime role or membership unverified'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
  WHERE p.oid=pg_catalog.to_regprocedure('jungsi_backend.reject_score_policy_mutation_v1()')
  AND pg_catalog.pg_get_userbyid(p.proowner)='jungsi_backend_owner' AND NOT p.prosecdef
  AND p.proconfig=ARRAY['search_path=pg_catalog']
  AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='300e48db59bb97a54fd696804fa9fada37382499355c281a73e131e59a77f165') THEN
  RAISE EXCEPTION 'existing immutable trigger function unverified'; END IF;
 FOREACH target IN ARRAY ARRAY['score_policy_rollouts','score_input_states','score_input_attempts',
  'score_input_corrections','score_input_legacy_links','score_result_origins','paid_result_first_use'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid=pg_catalog.to_regclass('jungsi_backend.'||target)
    AND t.tgname='preserve_score_policy_records' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
    AND t.tgfoid=pg_catalog.to_regprocedure('jungsi_backend.reject_score_policy_mutation_v1()')
    AND (t.tgtype & 1)=1 AND (t.tgtype & 2)=2 AND (t.tgtype & 4)=0
    AND (t.tgtype & 8)=8 AND (t.tgtype & 16)=16 AND (t.tgtype & 32)=0 AND (t.tgtype & 64)=0) THEN
   RAISE EXCEPTION 'existing immutable trigger unverified'; END IF;
 END LOOP;
END
$preflight$;
CREATE TABLE jungsi_backend.score_policy_period_renewals (
 renewal_id text PRIMARY KEY CHECK(renewal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 rollout_id text NOT NULL REFERENCES jungsi_backend.score_policy_rollouts(rollout_id),
 policy_version text NOT NULL CHECK(policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 previous_approval_sha256 text NOT NULL CHECK(previous_approval_sha256 ~ '^[a-f0-9]{64}$'),
 new_approval_sha256 text NOT NULL CHECK(new_approval_sha256 ~ '^[a-f0-9]{64}$'),
 policy_semantics_sha256 text NOT NULL CHECK(policy_semantics_sha256 ~ '^[a-f0-9]{64}$'),
 previous_policy_artifact_sha256 text NOT NULL CHECK(previous_policy_artifact_sha256 ~ '^[a-f0-9]{64}$'),
 new_policy_artifact_sha256 text NOT NULL CHECK(new_policy_artifact_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 previous_expires_at timestamptz NOT NULL,
 effective_at timestamptz NOT NULL,
 new_expires_at timestamptz NOT NULL,
 validated_at timestamptz NOT NULL,
 validated_by text NOT NULL CHECK(validated_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 status text NOT NULL CHECK(status='validated'),
 UNIQUE(rollout_id,policy_version,previous_approval_sha256),
 CHECK(previous_approval_sha256<>new_approval_sha256),
 CHECK(validated_at<=effective_at AND effective_at<previous_expires_at),
 CHECK(previous_expires_at<new_expires_at),
 CHECK(new_expires_at=TIMESTAMPTZ '2026-12-31 15:00:00+00')
);
CREATE FUNCTION jungsi_backend.validate_score_policy_period_renewal_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $renewal$
BEGIN
 IF current_user<>'jungsi_backend_owner' OR NEW.validated_at>transaction_timestamp()
 OR transaction_timestamp()>=NEW.previous_expires_at THEN
  RAISE EXCEPTION 'validated owner and unexpired prior policy required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jungsi_backend.score_policy_rollouts r
  WHERE r.rollout_id=NEW.rollout_id AND r.policy_version=NEW.policy_version
  AND r.approval_sha256=NEW.previous_approval_sha256 AND r.status='validated') THEN
  RAISE EXCEPTION 'previous validated rollout binding required'; END IF;
 RETURN NEW;
END
$renewal$;
REVOKE ALL ON FUNCTION jungsi_backend.validate_score_policy_period_renewal_v1() FROM PUBLIC,anon,authenticated,jungsi_backend_app;
CREATE TRIGGER validate_score_policy_period_renewal BEFORE INSERT ON jungsi_backend.score_policy_period_renewals
 FOR EACH ROW EXECUTE FUNCTION jungsi_backend.validate_score_policy_period_renewal_v1();
CREATE TRIGGER preserve_score_policy_records BEFORE UPDATE OR DELETE ON jungsi_backend.score_policy_period_renewals
 FOR EACH ROW EXECUTE FUNCTION jungsi_backend.reject_score_policy_mutation_v1();
ALTER TABLE jungsi_backend.score_policy_period_renewals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jungsi_backend.score_policy_period_renewals FROM PUBLIC,anon,authenticated,jungsi_backend_app;
DO $optional_role$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN
  EXECUTE 'REVOKE ALL ON jungsi_backend.score_policy_period_renewals FROM service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION jungsi_backend.validate_score_policy_period_renewal_v1() FROM service_role';
 END IF;
END
$optional_role$;
CREATE POLICY "period renewal runtime read" ON jungsi_backend.score_policy_period_renewals
 FOR SELECT TO jungsi_backend_app USING(true);
GRANT SELECT(rollout_id,policy_version,previous_approval_sha256,new_approval_sha256,
 policy_semantics_sha256,previous_expires_at,effective_at,new_expires_at,status)
 ON jungsi_backend.score_policy_period_renewals TO jungsi_backend_app;
DO $privilege_check$
DECLARE name text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  WHERE c.oid='jungsi_backend.score_policy_period_renewals'::regclass
   AND a.grantee<>c.relowner AND a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jungsi_backend_app'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute col ON col.attrelid=c.oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
  WHERE c.oid='jungsi_backend.score_policy_period_renewals'::regclass AND col.attacl IS NOT NULL
   AND a.grantee<>c.relowner AND a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jungsi_backend_app'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE p.oid='jungsi_backend.validate_score_policy_period_renewal_v1()'::regprocedure AND a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'unexpected renewal relation or function grants'; END IF;
 IF pg_catalog.has_table_privilege('jungsi_backend_app','jungsi_backend.score_policy_period_renewals',
  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
 OR pg_catalog.has_any_column_privilege('jungsi_backend_app','jungsi_backend.score_policy_period_renewals',
  'INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'runtime table-wide or write privilege forbidden'; END IF;
 FOREACH name IN ARRAY ARRAY['rollout_id','policy_version','previous_approval_sha256','new_approval_sha256',
  'policy_semantics_sha256','previous_expires_at','effective_at','new_expires_at','status'] LOOP
  IF NOT pg_catalog.has_column_privilege('jungsi_backend_app','jungsi_backend.score_policy_period_renewals',name,'SELECT') THEN
   RAISE EXCEPTION 'runtime projected read privilege required'; END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['renewal_id','previous_policy_artifact_sha256','new_policy_artifact_sha256',
  'evidence_sha256','validated_at','validated_by'] LOOP
  IF pg_catalog.has_column_privilege('jungsi_backend_app','jungsi_backend.score_policy_period_renewals',name,'SELECT') THEN
   RAISE EXCEPTION 'private renewal metadata must remain owner-only'; END IF;
 END LOOP;
END
$privilege_check$;
INSERT INTO jungsi_backend.schema_versions(version) VALUES('score_policy_period_renewal_2026');
COMMIT;
