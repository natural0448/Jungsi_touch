-- Additive Supabase PostgreSQL migration. UTC instants; calendar dates stay date.
BEGIN;
CREATE SCHEMA IF NOT EXISTS jungsi_backend;
REVOKE ALL ON SCHEMA jungsi_backend FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS jungsi_backend.schema_versions (
 version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jungsi_backend.profiles (
 profile_id text PRIMARY KEY, owner_id text NOT NULL, scores jsonb NOT NULL,
 confirmed boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(profile_id,owner_id)
);
CREATE TABLE IF NOT EXISTS jungsi_backend.reports (
 report_id text PRIMARY KEY, owner_id text NOT NULL, profile_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(report_id,owner_id), FOREIGN KEY(profile_id,owner_id) REFERENCES jungsi_backend.profiles(profile_id,owner_id)
);
CREATE TABLE IF NOT EXISTS jungsi_backend.report_revisions (
 report_id text NOT NULL, owner_id text NOT NULL, profile_id text NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(report_id,revision),
 FOREIGN KEY(report_id,owner_id) REFERENCES jungsi_backend.reports(report_id,owner_id),
 FOREIGN KEY(profile_id,owner_id) REFERENCES jungsi_backend.profiles(profile_id,owner_id)
);
CREATE TABLE IF NOT EXISTS jungsi_backend.requests (
 owner_id text NOT NULL, operation text NOT NULL, request_key text NOT NULL,
 digest text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,operation,request_key)
);
CREATE TABLE IF NOT EXISTS jungsi_backend.entitlements (
 entitlement_id text PRIMARY KEY, owner_id text NOT NULL, active boolean NOT NULL,
 starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at>starts_at)
);
CREATE TABLE IF NOT EXISTS jungsi_backend.audit_events (
 event_id text PRIMARY KEY, owner_id text NOT NULL, operation text NOT NULL,
 resource_id text NOT NULL, revision bigint NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jungsi_backend.artifact_releases (
 release_id text PRIMARY KEY, artifact_kind text NOT NULL, release_version text NOT NULL, content_sha256 text NOT NULL,
 review_status text NOT NULL CHECK(review_status IN ('draft','verified','approved')),
 source_timezone text, source_as_of date, original_source_time text, published_at timestamptz, metadata jsonb NOT NULL,
 UNIQUE(artifact_kind,release_version)
);
ALTER TABLE jungsi_backend.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.report_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.artifact_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.schema_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA jungsi_backend FROM PUBLIC, anon, authenticated;
INSERT INTO jungsi_backend.schema_versions(version) VALUES('001_pre_data_platform') ON CONFLICT(version) DO NOTHING;
-- No direct user policies. The configured private backend DB owner runs server
-- queries with explicit owner predicates after verified authentication.
-- Add later migrations; retain all revisions and never reset the database.
COMMIT;
