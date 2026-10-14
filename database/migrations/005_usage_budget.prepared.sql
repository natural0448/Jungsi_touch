-- Prepared additive service budget schema. Not applied by creating this file.
-- Actual capacities/operational values are private configuration and absent here.
-- Existing original/admission/Auth/public data and previous revisions are preserved.
BEGIN;
SELECT pg_advisory_xact_lock(74961014005);
DO $preflight$
DECLARE target text;
BEGIN
 IF current_user <> 'jungsi_backend_owner' THEN RAISE EXCEPTION 'migration owner role required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='003_runtime_role_access') THEN
  RAISE EXCEPTION 'existing service access migration required';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='jungsi_backend_app'
   AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb))
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='jungsi_backend_app') THEN
  RAISE EXCEPTION 'runtime role unverified';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON m.member=r.oid
   WHERE r.rolname='jungsi_backend_app') THEN RAISE EXCEPTION 'runtime membership changed'; END IF;
 IF EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='005_usage_budget') THEN
  RAISE EXCEPTION 'migration already registered; verify existing state instead of reapplying';
 END IF;
 FOREACH target IN ARRAY ARRAY['usage_budget_windows','usage_budget_leases','usage_budget_identities'] LOOP
  IF to_regclass('jungsi_backend.'||target) IS NOT NULL THEN
   RAISE EXCEPTION 'unregistered budget relation exists; preserve and review';
  END IF;
 END LOOP;
END
$preflight$;
CREATE TABLE jungsi_backend.usage_budget_windows (
 owner_id text NOT NULL,
 policy_version text NOT NULL,
 scope_key text NOT NULL,
 dimension text NOT NULL CHECK(dimension IN ('request_window','distinct_scores','calculation_cost','concurrent_jobs','result_volume')),
 period_seconds bigint NOT NULL CHECK(period_seconds>0),
 window_start timestamptz NOT NULL,
 window_end timestamptz NOT NULL,
 -- Stable approved tier ceiling. Runtime also enforces the verified current tier.
 capacity bigint NOT NULL CHECK(capacity>=0),
 used_units bigint NOT NULL DEFAULT 0 CHECK(used_units>=0),
 reserved_units bigint NOT NULL DEFAULT 0 CHECK(reserved_units>=0),
 PRIMARY KEY(owner_id,policy_version,scope_key,dimension,period_seconds,window_start),
 CHECK(window_end>window_start),
 CHECK(used_units+reserved_units<=capacity)
);
CREATE TABLE jungsi_backend.usage_budget_leases (
 lease_id uuid PRIMARY KEY,
 owner_id text NOT NULL,
 policy_version text NOT NULL,
 operation text NOT NULL,
 state text NOT NULL CHECK(state IN ('active','success','failure','expired','denied')),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 settled_at timestamptz,
 result_bytes bigint CHECK(result_bytes>=0),
 reserved_demands jsonb NOT NULL CHECK(jsonb_typeof(reserved_demands)='array'),
 denial_code text CHECK(denial_code IN ('rate_limit_exceeded','analysis_quota_exceeded')),
 CHECK(expires_at>=created_at),
 CHECK((state='active' AND settled_at IS NULL AND denial_code IS NULL)
   OR (state='denied' AND settled_at IS NOT NULL AND denial_code IS NOT NULL)
   OR (state IN ('success','failure','expired') AND settled_at IS NOT NULL AND denial_code IS NULL)),
 CHECK((state IN ('active','expired','denied') AND result_bytes IS NULL)
   OR (state='success' AND result_bytes IS NOT NULL)
   OR (state='failure' AND result_bytes IS NOT NULL AND result_bytes=0))
);
CREATE INDEX usage_budget_active_owner ON jungsi_backend.usage_budget_leases(owner_id,policy_version,expires_at)
 WHERE state='active';
CREATE TABLE jungsi_backend.usage_budget_identities (
 owner_id text NOT NULL,
 policy_version text NOT NULL,
 scope_key text NOT NULL,
 dimension text NOT NULL CHECK(dimension='distinct_scores'),
 period_seconds bigint NOT NULL,
 window_start timestamptz NOT NULL,
 fingerprint_sha256 text NOT NULL CHECK(fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,policy_version,scope_key,dimension,period_seconds,window_start,fingerprint_sha256),
 FOREIGN KEY(owner_id,policy_version,scope_key,dimension,period_seconds,window_start)
 REFERENCES jungsi_backend.usage_budget_windows(owner_id,policy_version,scope_key,dimension,period_seconds,window_start)
);
ALTER TABLE jungsi_backend.usage_budget_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.usage_budget_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.usage_budget_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jungsi_backend.usage_budget_windows,jungsi_backend.usage_budget_leases,
 jungsi_backend.usage_budget_identities FROM PUBLIC,anon,authenticated;
CREATE POLICY "jungsi budget select" ON jungsi_backend.usage_budget_windows FOR SELECT TO jungsi_backend_app USING(true);
CREATE POLICY "jungsi budget insert" ON jungsi_backend.usage_budget_windows FOR INSERT TO jungsi_backend_app WITH CHECK(true);
CREATE POLICY "jungsi budget update" ON jungsi_backend.usage_budget_windows FOR UPDATE TO jungsi_backend_app USING(true) WITH CHECK(true);
CREATE POLICY "jungsi budget select" ON jungsi_backend.usage_budget_leases FOR SELECT TO jungsi_backend_app USING(true);
CREATE POLICY "jungsi budget insert" ON jungsi_backend.usage_budget_leases FOR INSERT TO jungsi_backend_app WITH CHECK(true);
CREATE POLICY "jungsi budget update" ON jungsi_backend.usage_budget_leases FOR UPDATE TO jungsi_backend_app USING(true) WITH CHECK(true);
CREATE POLICY "jungsi budget select" ON jungsi_backend.usage_budget_identities FOR SELECT TO jungsi_backend_app USING(true);
CREATE POLICY "jungsi budget insert" ON jungsi_backend.usage_budget_identities FOR INSERT TO jungsi_backend_app WITH CHECK(true);
GRANT SELECT,INSERT ON jungsi_backend.usage_budget_windows,jungsi_backend.usage_budget_leases,
 jungsi_backend.usage_budget_identities TO jungsi_backend_app;
GRANT UPDATE(used_units,reserved_units) ON jungsi_backend.usage_budget_windows TO jungsi_backend_app;
GRANT UPDATE(state,settled_at,result_bytes) ON jungsi_backend.usage_budget_leases TO jungsi_backend_app;
INSERT INTO jungsi_backend.schema_versions(version) VALUES('005_usage_budget');
COMMIT;
