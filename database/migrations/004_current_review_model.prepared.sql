-- PREPARED CANDIDATE ONLY. NOT APPLIED; NOT AN OPERATING SEAL/PUBLISHER.
-- Actual independent full census, source-state/fence registration, byte recipes, issuer policies,
-- budget/window approval and a seal verifier adapter remain required. No fallback or source GRANT.
-- Apply only under a separately approved Owner migration scope; CREATE DATABASE is not required.
-- Schema CREATE/OWNERSHIP and role provisioning require separate project Administrator authority.
BEGIN;
DO $preconditions$
BEGIN
  IF current_user <> 'jungsi_backend_owner' THEN
    RAISE EXCEPTION 'prepared review model requires separately approved migration owner';
  END IF;
  IF NOT has_database_privilege(current_user,current_database(),'CREATE') THEN
    RAISE EXCEPTION 'database CREATE privilege required for schema; not CREATEDB';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='jungsi_review_model_publisher'
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolcreaterole AND NOT rolcreatedb
      AND NOT pg_has_role(rolname,'jungsi_backend_owner','MEMBER')
      AND NOT pg_has_role(rolname,'jungsi_backend_owner','USAGE')
      AND NOT pg_has_role(rolname,'postgres','MEMBER')
      AND NOT pg_has_role(rolname,'postgres','USAGE')) THEN
    RAISE EXCEPTION 'NOLOGIN NOBYPASSRLS publisher role must be independently provisioned';
  END IF;
END $preconditions$;
CREATE SCHEMA IF NOT EXISTS jungsi_review_read_model AUTHORIZATION jungsi_backend_owner;
REVOKE ALL ON SCHEMA jungsi_review_read_model FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA jungsi_review_read_model TO jungsi_backend_app,jungsi_review_model_publisher;

CREATE TABLE jungsi_review_read_model.admission_review_batches(
 tenant_key text COLLATE "C" NOT NULL,
 batch_id uuid NOT NULL,
 batch_kind text NOT NULL CHECK(batch_kind IN ('baseline','delta')),
 parent_batch_id uuid,
 parent_manifest_sha256 text CHECK(parent_manifest_sha256 ~ '^[0-9a-f]{64}$'),
 manifest_bytes bytea NOT NULL,
 manifest_wire_sha256 text NOT NULL CHECK(manifest_wire_sha256=encode(pg_catalog.sha256(manifest_bytes),'hex')),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
 binding_bytes bytea NOT NULL,
 binding_wire_sha256 text NOT NULL CHECK(binding_wire_sha256=encode(pg_catalog.sha256(binding_bytes),'hex')),
 binding_sha256 text NOT NULL CHECK(binding_sha256 ~ '^[0-9a-f]{64}$'),
 ancestry_bytes bytea NOT NULL,
 ancestry_wire_sha256 text NOT NULL CHECK(ancestry_wire_sha256=encode(pg_catalog.sha256(ancestry_bytes),'hex')),
 source_state_bytes bytea NOT NULL,
 source_state_wire_sha256 text NOT NULL CHECK(source_state_wire_sha256=encode(pg_catalog.sha256(source_state_bytes),'hex')),
 staged_change_count bigint NOT NULL CHECK(staged_change_count>=0),
 expected_observation_count bigint NOT NULL CHECK(expected_observation_count>=0),
 expected_school_tuple_count bigint NOT NULL CHECK(expected_school_tuple_count>=0 AND expected_school_tuple_count<=expected_observation_count),
 producer_actor uuid NOT NULL,
 created_at timestamptz NOT NULL,
 sealed_at timestamptz,
 PRIMARY KEY(tenant_key,batch_id),
 UNIQUE(tenant_key,batch_id,manifest_sha256),
 UNIQUE(tenant_key,batch_id,binding_sha256),
 FOREIGN KEY(tenant_key,parent_batch_id,parent_manifest_sha256)
   REFERENCES jungsi_review_read_model.admission_review_batches(tenant_key,batch_id,manifest_sha256),
 CHECK((batch_kind='baseline' AND parent_batch_id IS NULL AND parent_manifest_sha256 IS NULL)
    OR (batch_kind='delta' AND parent_batch_id IS NOT NULL AND parent_manifest_sha256 IS NOT NULL)),
 CHECK(parent_batch_id IS DISTINCT FROM batch_id)
);
CREATE TABLE jungsi_review_read_model.admission_review_changes(
 tenant_key text COLLATE "C" NOT NULL,
 batch_id uuid NOT NULL,
 canonical_result_id text COLLATE "C" NOT NULL CHECK(length(canonical_result_id)>0),
 operation text NOT NULL CHECK(operation IN ('upsert','retract')),
 academic_year integer,
 school_id text COLLATE "C",
 university_code text COLLATE "C",
 active_service boolean,
 university text,department text,track text,recruit_group text,metric_kind text,cohort text,
 model_row_bytes bytea NOT NULL,
 model_row_wire_sha256 text NOT NULL CHECK(model_row_wire_sha256=encode(pg_catalog.sha256(model_row_bytes),'hex')),
 model_row_digest_sha256 text NOT NULL CHECK(model_row_digest_sha256 ~ '^[0-9a-f]{64}$'),
 leaf_index bigint NOT NULL CHECK(leaf_index>=0),
 proof_siblings bytea NOT NULL CHECK(octet_length(proof_siblings)%32=0),
 PRIMARY KEY(tenant_key,batch_id,canonical_result_id),
 UNIQUE(tenant_key,batch_id,leaf_index),
 FOREIGN KEY(tenant_key,batch_id) REFERENCES jungsi_review_read_model.admission_review_batches(tenant_key,batch_id),
 CHECK((operation='upsert' AND academic_year IS NOT NULL AND academic_year IN(2024,2025,2026,2027) AND active_service IS TRUE)
    OR (operation='retract' AND academic_year IS NULL AND school_id IS NULL AND university_code IS NULL
       AND active_service IS NULL AND university IS NULL AND department IS NULL AND track IS NULL
       AND recruit_group IS NULL AND metric_kind IS NULL AND cohort IS NULL))
 -- NULL school_id/university_code and empty text remain distinct. No coalesced tuple PK.
 -- Narrow display/raw/provenance content is only in exact MODEL_ROW wire; not a CURRENT35 fabrication.
);
CREATE INDEX admission_review_changes_page ON jungsi_review_read_model.admission_review_changes
 (tenant_key,batch_id,academic_year,canonical_result_id COLLATE "C");
CREATE INDEX admission_review_changes_identity ON jungsi_review_read_model.admission_review_changes
 (tenant_key,canonical_result_id COLLATE "C",batch_id);

CREATE TABLE jungsi_review_read_model.admission_review_seals(
 tenant_key text COLLATE "C" NOT NULL,batch_id uuid NOT NULL,
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
 binding_sha256 text NOT NULL CHECK(binding_sha256 ~ '^[0-9a-f]{64}$'),
 seal_bytes bytea NOT NULL,
 seal_wire_sha256 text NOT NULL CHECK(seal_wire_sha256=encode(pg_catalog.sha256(seal_bytes),'hex')),
 seal_sha256 text NOT NULL CHECK(seal_sha256 ~ '^[0-9a-f]{64}$'),
 producer_actor uuid NOT NULL,verifier_actor uuid NOT NULL,
 verification_receipt_sha256 text NOT NULL CHECK(verification_receipt_sha256 ~ '^[0-9a-f]{64}$'),
 approval_receipt_sha256 text NOT NULL CHECK(approval_receipt_sha256 ~ '^[0-9a-f]{64}$'),
 sealed_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_key,batch_id),
 UNIQUE(tenant_key,batch_id,manifest_sha256,binding_sha256,seal_sha256),
 FOREIGN KEY(tenant_key,batch_id,manifest_sha256) REFERENCES jungsi_review_read_model.admission_review_batches(tenant_key,batch_id,manifest_sha256),
 FOREIGN KEY(tenant_key,batch_id,binding_sha256) REFERENCES jungsi_review_read_model.admission_review_batches(tenant_key,batch_id,binding_sha256),
 CHECK(producer_actor<>verifier_actor)
);
CREATE TABLE jungsi_review_read_model.admission_review_lineage_members(
 tenant_key text COLLATE "C" NOT NULL,head_batch_id uuid NOT NULL,ancestor_batch_id uuid NOT NULL,
 depth integer NOT NULL CHECK(depth BETWEEN 0 AND 4),
 ancestor_manifest_sha256 text CHECK(ancestor_manifest_sha256 ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(tenant_key,head_batch_id,depth),
 UNIQUE(tenant_key,head_batch_id,ancestor_batch_id),
 FOREIGN KEY(tenant_key,head_batch_id) REFERENCES jungsi_review_read_model.admission_review_batches(tenant_key,batch_id),
 FOREIGN KEY(tenant_key,ancestor_batch_id) REFERENCES jungsi_review_read_model.admission_review_batches(tenant_key,batch_id),
 FOREIGN KEY(tenant_key,ancestor_batch_id,ancestor_manifest_sha256) REFERENCES jungsi_review_read_model.admission_review_batches(tenant_key,batch_id,manifest_sha256),
 CHECK((depth=0 AND head_batch_id=ancestor_batch_id AND ancestor_manifest_sha256 IS NULL)
   OR (depth>0 AND head_batch_id<>ancestor_batch_id AND ancestor_manifest_sha256 IS NOT NULL))
);
CREATE TABLE jungsi_review_read_model.admission_review_subject_grants(
 tenant_key text COLLATE "C" NOT NULL,grant_id uuid NOT NULL,head_batch_id uuid NOT NULL,subject_id uuid NOT NULL,
 approval_id text NOT NULL CHECK(length(approval_id)>0),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
 binding_sha256 text NOT NULL CHECK(binding_sha256 ~ '^[0-9a-f]{64}$'),
 seal_sha256 text NOT NULL CHECK(seal_sha256 ~ '^[0-9a-f]{64}$'),
 purpose text NOT NULL CHECK(purpose='current_admission_review'),
 operation text NOT NULL CHECK(operation='current.review.search'),
 approval_receipt_sha256 text NOT NULL CHECK(approval_receipt_sha256 ~ '^[0-9a-f]{64}$'),
 approver_actor uuid NOT NULL,
 not_before timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_key,grant_id),
 UNIQUE(tenant_key,head_batch_id,subject_id,approval_id),
 UNIQUE(tenant_key,head_batch_id,grant_id,subject_id),
 FOREIGN KEY(tenant_key,head_batch_id,manifest_sha256,binding_sha256,seal_sha256)
   REFERENCES jungsi_review_read_model.admission_review_seals(tenant_key,batch_id,manifest_sha256,binding_sha256,seal_sha256),
 FOREIGN KEY(tenant_key,head_batch_id) REFERENCES jungsi_review_read_model.admission_review_batches(tenant_key,batch_id),
 CHECK(expires_at>not_before AND expires_at-not_before<=interval '24 hours')
);
CREATE TABLE jungsi_review_read_model.admission_review_revocations(
 tenant_key text COLLATE "C" NOT NULL,revocation_id uuid NOT NULL,grant_id uuid NOT NULL,
 head_batch_id uuid NOT NULL,subject_id uuid NOT NULL,revoker_actor uuid NOT NULL,
 receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[0-9a-f]{64}$'),recorded_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_key,revocation_id),
 UNIQUE(tenant_key,grant_id),
 FOREIGN KEY(tenant_key,head_batch_id,grant_id,subject_id)
   REFERENCES jungsi_review_read_model.admission_review_subject_grants(tenant_key,head_batch_id,grant_id,subject_id),
 FOREIGN KEY(tenant_key,head_batch_id) REFERENCES jungsi_review_read_model.admission_review_batches(tenant_key,batch_id)
);
-- No rows, raw identifiers, dataset counts, operational keys or source grants are included.
-- Compact BYTEA siblings equal the ordered concatenation of exactly 32-byte hashes.
-- Actual storage/WAL/index overhead and finite-chunk timings remain NOT_MEASURED.

CREATE FUNCTION jungsi_review_read_model.has_live_review_grant(tenant text,head uuid,subject uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
 SET search_path=pg_catalog,jungsi_review_read_model
 AS $grant$
 SELECT EXISTS(SELECT 1 FROM jungsi_review_read_model.admission_review_subject_grants g
  WHERE g.tenant_key=tenant AND g.head_batch_id=head AND g.subject_id=subject
   AND g.purpose='current_admission_review' AND g.operation='current.review.search'
   AND g.not_before<=transaction_timestamp() AND transaction_timestamp()<g.expires_at
   AND NOT EXISTS(SELECT 1 FROM jungsi_review_read_model.admission_review_revocations r
       WHERE r.tenant_key=g.tenant_key AND r.grant_id=g.grant_id))
 $grant$;
REVOKE ALL ON FUNCTION jungsi_review_read_model.has_live_review_grant(text,uuid,uuid) FROM PUBLIC,anon,authenticated,jungsi_review_model_publisher;
GRANT EXECUTE ON FUNCTION jungsi_review_read_model.has_live_review_grant(text,uuid,uuid) TO jungsi_backend_app;

CREATE FUNCTION jungsi_review_read_model.reject_mutation()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,jungsi_review_read_model
 AS $immutable$ BEGIN RAISE EXCEPTION 'review model artifacts are append-only; no UPDATE or DELETE'; END $immutable$;
REVOKE ALL ON FUNCTION jungsi_review_read_model.reject_mutation() FROM PUBLIC,anon,authenticated,jungsi_backend_app,jungsi_review_model_publisher;
CREATE FUNCTION jungsi_review_read_model.lock_unsealed_batch()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,jungsi_review_read_model
 AS $lock$
 DECLARE frozen timestamptz;
 BEGIN
  SELECT sealed_at INTO frozen FROM jungsi_review_read_model.admission_review_batches
    WHERE tenant_key=NEW.tenant_key AND batch_id=NEW.batch_id FOR UPDATE;
  IF NOT FOUND OR frozen IS NOT NULL THEN RAISE EXCEPTION 'missing or sealed batch'; END IF;
  RETURN NEW;
 END $lock$;
REVOKE ALL ON FUNCTION jungsi_review_read_model.lock_unsealed_batch() FROM PUBLIC,anon,authenticated,jungsi_backend_app,jungsi_review_model_publisher;
CREATE TRIGGER changes_freeze BEFORE INSERT ON jungsi_review_read_model.admission_review_changes
 FOR EACH ROW EXECUTE FUNCTION jungsi_review_read_model.lock_unsealed_batch();

-- Independent verification adapter deliberately unavailable. A producer actor/hash is not approval.
-- Future adoption must implement exact full census/dependency closure, finite chunk checkpoint,
-- source before/after/fence registration, parent locks, leaf/root proofs, independent receipt/issuer
-- and revocation policies before a narrowly privileged transition can seal or grant any batch.
CREATE FUNCTION jungsi_review_read_model.seal_review_batch(tenant text,head uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,jungsi_review_read_model
 AS $deny$ BEGIN RAISE EXCEPTION 'NOT_READY: independent sealing/freshness/complete-census verifier adapter absent'; END $deny$;
REVOKE ALL ON FUNCTION jungsi_review_read_model.seal_review_batch(text,uuid) FROM PUBLIC,anon,authenticated,jungsi_backend_app,jungsi_review_model_publisher;
CREATE FUNCTION jungsi_review_read_model.require_independent_control()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,jungsi_review_read_model
 AS $deny$ BEGIN RAISE EXCEPTION 'NOT_READY: independent control/admission adapter absent'; END $deny$;
REVOKE ALL ON FUNCTION jungsi_review_read_model.require_independent_control() FROM PUBLIC,anon,authenticated,jungsi_backend_app,jungsi_review_model_publisher;
CREATE TRIGGER seal_not_ready BEFORE INSERT ON jungsi_review_read_model.admission_review_seals
 FOR EACH ROW EXECUTE FUNCTION jungsi_review_read_model.require_independent_control();
CREATE TRIGGER lineage_not_ready BEFORE INSERT ON jungsi_review_read_model.admission_review_lineage_members
 FOR EACH ROW EXECUTE FUNCTION jungsi_review_read_model.require_independent_control();
CREATE TRIGGER grant_not_ready BEFORE INSERT ON jungsi_review_read_model.admission_review_subject_grants
 FOR EACH ROW EXECUTE FUNCTION jungsi_review_read_model.require_independent_control();

DO $security$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['admission_review_batches','admission_review_changes','admission_review_seals',
   'admission_review_lineage_members','admission_review_subject_grants','admission_review_revocations']
 LOOP
  EXECUTE format('ALTER TABLE jungsi_review_read_model.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE jungsi_review_read_model.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON TABLE jungsi_review_read_model.%I FROM PUBLIC,anon,authenticated,jungsi_backend_app,jungsi_review_model_publisher',tab);
  EXECUTE format('GRANT SELECT ON TABLE jungsi_review_read_model.%I TO jungsi_backend_app',tab);
  EXECUTE format('CREATE TRIGGER immutable_review_artifact BEFORE UPDATE OR DELETE ON jungsi_review_read_model.%I FOR EACH ROW EXECUTE FUNCTION jungsi_review_read_model.reject_mutation()',tab);
  -- Owner RLS policy permits only separately approved preparation. Control inserts remain denied above.
  EXECUTE format('CREATE POLICY review_owner ON jungsi_review_read_model.%I TO jungsi_backend_owner USING(true) WITH CHECK(true)',tab);
 END LOOP;
END $security$;
CREATE POLICY reviewer_grants ON jungsi_review_read_model.admission_review_subject_grants FOR SELECT TO jungsi_backend_app
 USING(tenant_key=current_setting('jungsi_review.tenant',true) AND head_batch_id::text=current_setting('jungsi_review.head',true)
   AND subject_id::text=current_setting('jungsi_review.subject',true));
CREATE POLICY reviewer_revocations ON jungsi_review_read_model.admission_review_revocations FOR SELECT TO jungsi_backend_app
 USING(tenant_key=current_setting('jungsi_review.tenant',true) AND head_batch_id::text=current_setting('jungsi_review.head',true)
   AND subject_id::text=current_setting('jungsi_review.subject',true));
CREATE POLICY reviewer_lineage ON jungsi_review_read_model.admission_review_lineage_members FOR SELECT TO jungsi_backend_app
 USING(tenant_key=current_setting('jungsi_review.tenant',true) AND head_batch_id::text=current_setting('jungsi_review.head',true)
   AND jungsi_review_read_model.has_live_review_grant(tenant_key,head_batch_id,current_setting('jungsi_review.subject',true)::uuid));
CREATE POLICY reviewer_batches ON jungsi_review_read_model.admission_review_batches FOR SELECT TO jungsi_backend_app
 USING(tenant_key=current_setting('jungsi_review.tenant',true)
   AND batch_id IN(SELECT ancestor_batch_id FROM jungsi_review_read_model.admission_review_lineage_members
      WHERE tenant_key=current_setting('jungsi_review.tenant',true) AND head_batch_id::text=current_setting('jungsi_review.head',true)));
CREATE POLICY reviewer_changes ON jungsi_review_read_model.admission_review_changes FOR SELECT TO jungsi_backend_app
 USING(tenant_key=current_setting('jungsi_review.tenant',true)
   AND batch_id IN(SELECT ancestor_batch_id FROM jungsi_review_read_model.admission_review_lineage_members
      WHERE tenant_key=current_setting('jungsi_review.tenant',true) AND head_batch_id::text=current_setting('jungsi_review.head',true)));
CREATE POLICY reviewer_seals ON jungsi_review_read_model.admission_review_seals FOR SELECT TO jungsi_backend_app
 USING(tenant_key=current_setting('jungsi_review.tenant',true)
   AND batch_id IN(SELECT ancestor_batch_id FROM jungsi_review_read_model.admission_review_lineage_members
      WHERE tenant_key=current_setting('jungsi_review.tenant',true) AND head_batch_id::text=current_setting('jungsi_review.head',true)));
-- Tenant/job/head GUC values are hints, never authorization. Until an independently approved
-- finite job/batch/lease admission adapter is present, publisher SELECT/INSERT stays fail-closed.
CREATE FUNCTION jungsi_review_read_model.has_admitted_publisher_job(tenant text,head uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
 SET search_path=pg_catalog,jungsi_review_read_model
 AS $not_ready$ SELECT false $not_ready$;
REVOKE ALL ON FUNCTION jungsi_review_read_model.has_admitted_publisher_job(text,uuid) FROM PUBLIC,anon,authenticated,jungsi_backend_app;
GRANT EXECUTE ON FUNCTION jungsi_review_read_model.has_admitted_publisher_job(text,uuid) TO jungsi_review_model_publisher;
-- Publisher has no UPDATE/DELETE/lineage/seal/grant privilege; operational job admission is NOT_READY.
GRANT SELECT,INSERT ON jungsi_review_read_model.admission_review_batches,jungsi_review_read_model.admission_review_changes TO jungsi_review_model_publisher;
CREATE POLICY publisher_batches ON jungsi_review_read_model.admission_review_batches TO jungsi_review_model_publisher
 USING(tenant_key=current_setting('jungsi_review.publisher_tenant',true)
   AND batch_id::text=current_setting('jungsi_review.publisher_batch',true)
   AND jungsi_review_read_model.has_admitted_publisher_job(tenant_key,batch_id))
 WITH CHECK(tenant_key=current_setting('jungsi_review.publisher_tenant',true)
   AND batch_id::text=current_setting('jungsi_review.publisher_batch',true) AND sealed_at IS NULL
   AND jungsi_review_read_model.has_admitted_publisher_job(tenant_key,batch_id));
CREATE POLICY publisher_changes ON jungsi_review_read_model.admission_review_changes TO jungsi_review_model_publisher
 USING(tenant_key=current_setting('jungsi_review.publisher_tenant',true)
   AND batch_id::text=current_setting('jungsi_review.publisher_batch',true)
   AND jungsi_review_read_model.has_admitted_publisher_job(tenant_key,batch_id))
 WITH CHECK(tenant_key=current_setting('jungsi_review.publisher_tenant',true)
   AND batch_id::text=current_setting('jungsi_review.publisher_batch',true)
   AND jungsi_review_read_model.has_admitted_publisher_job(tenant_key,batch_id));
ALTER DEFAULT PRIVILEGES FOR ROLE jungsi_backend_owner IN SCHEMA jungsi_review_read_model REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
-- This candidate cannot activate any model. It does not change source tables/views/RLS/default provider.
COMMIT;
