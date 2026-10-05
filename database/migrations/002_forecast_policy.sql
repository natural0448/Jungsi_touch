-- Additive forecast policy schema. No existing rows or revisions are removed.
BEGIN;
CREATE TABLE IF NOT EXISTS jungsi_backend.forecast_authorities (
 subject_id text NOT NULL, university_id text NOT NULL,
 can_edit boolean NOT NULL, can_approve boolean NOT NULL,
 PRIMARY KEY(subject_id,university_id)
);
CREATE TABLE IF NOT EXISTS jungsi_backend.forecast_drafts (
 draft_id text PRIMARY KEY, revision bigint NOT NULL CHECK(revision>0),
 body jsonb NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS jungsi_backend.forecast_revisions (
 draft_id text NOT NULL REFERENCES jungsi_backend.forecast_drafts(draft_id),
 revision bigint NOT NULL CHECK(revision>0), body jsonb NOT NULL,
 created_at timestamptz NOT NULL, PRIMARY KEY(draft_id,revision)
);
CREATE TABLE IF NOT EXISTS jungsi_backend.forecast_releases (
 release_id text PRIMARY KEY, offering_id text NOT NULL, body jsonb NOT NULL,
 published_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS jungsi_backend.forecast_requests (
 subject_id text NOT NULL, operation text NOT NULL, request_key text NOT NULL,
 request_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(subject_id,operation,request_key)
);
ALTER TABLE jungsi_backend.forecast_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.forecast_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.forecast_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.forecast_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE jungsi_backend.forecast_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jungsi_backend.forecast_authorities,jungsi_backend.forecast_drafts,
 jungsi_backend.forecast_revisions,jungsi_backend.forecast_releases,jungsi_backend.forecast_requests
 FROM PUBLIC,anon,authenticated;
INSERT INTO jungsi_backend.schema_versions(version) VALUES('002_forecast_policy') ON CONFLICT(version) DO NOTHING;
COMMIT;
