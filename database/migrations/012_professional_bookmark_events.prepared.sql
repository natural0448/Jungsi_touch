-- Prepared only. Apply once as the existing jungsi_backend_owner after server acceptance.
-- The server serializes add/remove for each org/student/report before reading or appending.
-- Existing bookmarks are the baseline. The latest event_seq, when present, overrides it.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog;
SELECT pg_catalog.pg_advisory_xact_lock(74961021012);
DO $preflight$
BEGIN
 IF current_user<>'jungsi_backend_owner' THEN RAISE EXCEPTION 'existing schema owner required'; END IF;
 IF NOT EXISTS (SELECT 1 FROM jungsi_backend.schema_versions WHERE version='007_professional_platform')
 OR pg_catalog.to_regclass('jungsi_professional.bookmarks') IS NULL
 OR pg_catalog.to_regprocedure('jungsi_professional.reject_mutation_v1()') IS NULL THEN
  RAISE EXCEPTION 'existing 007 ledger required'; END IF;
 IF pg_catalog.to_regclass('jungsi_professional.bookmark_events') IS NOT NULL
 OR EXISTS (SELECT 1 FROM jungsi_backend.schema_versions WHERE version='012_professional_bookmark_events') THEN
  RAISE EXCEPTION 'preserve existing registration and verify instead of reapplying'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='jungsi_backend_app'
  AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole)
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname='jungsi_backend_app') THEN
  RAISE EXCEPTION 'existing runtime role unverified'; END IF;
END
$preflight$;

CREATE TABLE jungsi_professional.bookmark_events (
 org_id text NOT NULL,
 student_id text NOT NULL,
 report_id text NOT NULL,
 offering_id text NOT NULL CHECK(offering_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 event_id text NOT NULL CHECK(event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 event_seq bigint GENERATED ALWAYS AS IDENTITY (CACHE 1) UNIQUE,
 action text NOT NULL CHECK(action IN('add','remove')),
 actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 PRIMARY KEY(org_id,student_id,report_id,offering_id,event_id),
 FOREIGN KEY(org_id,student_id,report_id) REFERENCES jungsi_professional.reports(org_id,student_id,report_id)
);
CREATE INDEX pro_bookmark_event_latest ON jungsi_professional.bookmark_events
 (org_id,student_id,report_id,offering_id,event_seq DESC);

ALTER TABLE jungsi_professional.bookmark_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jungsi_professional.bookmark_events FROM PUBLIC,anon,authenticated,service_role,jungsi_backend_app;
CREATE POLICY pro_scoped_read ON jungsi_professional.bookmark_events FOR SELECT TO jungsi_backend_app
 USING(org_id=pg_catalog.current_setting('jungsi.pro.org_id',true));
CREATE POLICY pro_scoped_insert ON jungsi_professional.bookmark_events FOR INSERT TO jungsi_backend_app
 WITH CHECK(org_id=pg_catalog.current_setting('jungsi.pro.org_id',true));
GRANT SELECT ON jungsi_professional.bookmark_events TO jungsi_backend_app;
GRANT INSERT(org_id,student_id,report_id,offering_id,event_id,action,actor_id)
 ON jungsi_professional.bookmark_events TO jungsi_backend_app;
CREATE TRIGGER pro_preserve_ledger BEFORE UPDATE OR DELETE ON jungsi_professional.bookmark_events
 FOR EACH ROW EXECUTE FUNCTION jungsi_professional.reject_mutation_v1();
CREATE TRIGGER pro_preserve_ledger_truncate BEFORE TRUNCATE ON jungsi_professional.bookmark_events
 FOR EACH STATEMENT EXECUTE FUNCTION jungsi_professional.reject_mutation_v1();

INSERT INTO jungsi_backend.schema_versions(version) VALUES('012_professional_bookmark_events');
COMMIT;
