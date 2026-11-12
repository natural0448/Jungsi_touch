-- REVIEW CANDIDATE ONLY. Never applied here. The final administrator runs it once as jungsi_backend_owner.
-- Additive per-student score map (3P '내 환산점수' precomputation). Existing profiles/reports are never changed.
-- One row per (owner, immutable confirmed profile, approved data pin, offering). Rows are insert-only:
-- a changed profile is a new profile_id and a changed approved release is a new data_pin.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog;
SELECT pg_catalog.pg_advisory_xact_lock(74961029072);
DO $preflight$
BEGIN
 IF current_user<>'jungsi_backend_owner' THEN RAISE EXCEPTION 'existing backend owner required'; END IF;
 IF current_setting('session_replication_role')<>'origin' THEN RAISE EXCEPTION 'origin trigger mode required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='003_runtime_role_access') THEN
  RAISE EXCEPTION 'existing 003 registration required'; END IF;
 IF pg_catalog.to_regclass('jungsi_backend.profiles') IS NULL THEN
  RAISE EXCEPTION 'existing profiles table required'; END IF;
 IF EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='score_maps_2026')
 OR pg_catalog.to_regclass('jungsi_backend.score_maps') IS NOT NULL THEN
  RAISE EXCEPTION 'existing registration must be preserved and independently reviewed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='jungsi_backend_app'
  AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb) THEN
  RAISE EXCEPTION 'existing runtime role unverified'; END IF;
END
$preflight$;
CREATE TABLE jungsi_backend.score_maps (
 owner_id text NOT NULL,
 profile_id text NOT NULL CHECK(profile_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 data_pin text NOT NULL CHECK(data_pin ~ '^[a-f0-9]{64}$'),
 offering_id text NOT NULL CHECK(offering_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 status text NOT NULL CHECK(status IN ('ready','reference','pending')),
 converted_score text CHECK(converted_score IS NULL OR converted_score ~ '^-?[0-9]{1,12}(\.[0-9]{1,30})?$'),
 official_max_score text CHECK(official_max_score IS NULL OR official_max_score ~ '^-?[0-9]{1,12}(\.[0-9]{1,30})?$'),
 reason_code text CHECK(reason_code IS NULL OR reason_code ~ '^[a-z0-9_]{1,80}$'),
 computed_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,profile_id,data_pin,offering_id),
 FOREIGN KEY(profile_id,owner_id) REFERENCES jungsi_backend.profiles(profile_id,owner_id),
 CHECK((status='pending')=(converted_score IS NULL)),
 CHECK(status<>'ready' OR reason_code IS NULL)
);
ALTER TABLE jungsi_backend.score_maps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jungsi_backend.score_maps FROM PUBLIC,anon,authenticated,jungsi_backend_app;
DO $optional_role$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN
  EXECUTE 'REVOKE ALL ON jungsi_backend.score_maps FROM service_role';
 END IF;
END
$optional_role$;
-- Same runtime pattern as 003: the server always adds owner_id=$1 for the verified subject.
CREATE POLICY "jungsi runtime select" ON jungsi_backend.score_maps
 FOR SELECT TO jungsi_backend_app USING(true);
CREATE POLICY "jungsi runtime insert" ON jungsi_backend.score_maps
 FOR INSERT TO jungsi_backend_app WITH CHECK(true);
GRANT SELECT,INSERT ON jungsi_backend.score_maps TO jungsi_backend_app;
DO $privilege_check$
BEGIN
 IF pg_catalog.has_table_privilege('jungsi_backend_app','jungsi_backend.score_maps','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 OR NOT pg_catalog.has_table_privilege('jungsi_backend_app','jungsi_backend.score_maps','SELECT')
 OR NOT pg_catalog.has_table_privilege('jungsi_backend_app','jungsi_backend.score_maps','INSERT') THEN
  RAISE EXCEPTION 'runtime must read and insert only'; END IF;
 IF pg_catalog.has_table_privilege('anon','jungsi_backend.score_maps','SELECT,INSERT,UPDATE,DELETE')
 OR pg_catalog.has_table_privilege('authenticated','jungsi_backend.score_maps','SELECT,INSERT,UPDATE,DELETE') THEN
  RAISE EXCEPTION 'browser roles must not reach score maps'; END IF;
END
$privilege_check$;
INSERT INTO jungsi_backend.schema_versions(version) VALUES('score_maps_2026');
COMMIT;
SELECT version FROM jungsi_backend.schema_versions WHERE version='score_maps_2026';
