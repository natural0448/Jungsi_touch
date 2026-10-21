-- Prepared only: original-source owner (postgres) review/application is separate.
-- Adds explicit first-instrumented versions; never reconstructs historical versions from timestamps.
-- No institution/member/contract/exam approval is seeded. Existing 007 is not reapplied.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path=pg_catalog;
SELECT pg_catalog.pg_advisory_xact_lock(74961021008);
DO $preflight$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'original source owner required'; END IF;
 IF pg_catalog.to_regnamespace('jungsi_professional') IS NULL
 OR NOT pg_catalog.has_schema_privilege('jungsi_backend_app','public','USAGE')
 OR NOT pg_catalog.has_schema_privilege('postgres','public','CREATE') THEN
  RAISE EXCEPTION 'existing professional schema and app usage required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a
  WHERE a.attrelid IN('public.organization_contracts'::regclass,'public.organization_members'::regclass)
  AND a.attname='version' AND NOT a.attisdropped)
 OR pg_catalog.to_regclass('public.jeongsi_pro_exam_approvals') IS NOT NULL
 OR pg_catalog.to_regprocedure('public.jeongsi_pro_authority(uuid,text,text,text,timestamptz)') IS NOT NULL
 OR pg_catalog.to_regprocedure('public.jeongsi_pro_bump_authority_version()') IS NOT NULL THEN
  RAISE EXCEPTION 'preserve existing registration; verify instead of reapplying'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN
  ('public.organizations'::regclass,'public.organization_members'::regclass,'public.organization_contracts'::regclass)
  AND pg_catalog.pg_get_userbyid(c.relowner)='postgres' AND c.relrowsecurity)<>3 THEN
  RAISE EXCEPTION 'reviewed original source owner and RLS required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.jeongsi_pro_access()'::regprocedure
  AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.provolatile='s' AND p.prosecdef
  AND p.proconfig=ARRAY['search_path=public']
  AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=
   'b08bb8b0732773591e186bc9ad47bded29765c40898f7dfef4d7795bb9894d3b')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.org_active_contract(bigint)'::regprocedure
  AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.provolatile='s' AND p.prosecdef
  AND NOT p.proretset AND p.prorettype='public.organization_contracts'::regtype
  AND p.proconfig=ARRAY['search_path=public']
  AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=
   '83872d1fb8d40d7a3be4808bdcebc7e035c711ff7941b04c39b8377a415b1f7a') THEN
  RAISE EXCEPTION 'reviewed original access definitions required'; END IF;
END;
$preflight$;

ALTER TABLE public.organization_contracts ADD COLUMN version bigint NOT NULL DEFAULT 1
 CHECK(version BETWEEN 1 AND 9007199254740991);
ALTER TABLE public.organization_members ADD COLUMN version bigint NOT NULL DEFAULT 1
 CHECK(version BETWEEN 1 AND 9007199254740991);
CREATE FUNCTION public.jeongsi_pro_bump_authority_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $version$
BEGIN
 IF TG_OP='INSERT' THEN NEW.version:=1;
 ELSE
  IF OLD.version>=9007199254740991 THEN RAISE EXCEPTION 'authority version exhausted'; END IF;
  NEW.version:=OLD.version+1;
 END IF;
 RETURN NEW;
END;
$version$;
REVOKE ALL ON FUNCTION public.jeongsi_pro_bump_authority_version() FROM PUBLIC,anon,authenticated,service_role,jungsi_backend_app;
CREATE TRIGGER jeongsi_pro_contract_version BEFORE INSERT OR UPDATE ON public.organization_contracts
 FOR EACH ROW EXECUTE FUNCTION public.jeongsi_pro_bump_authority_version();
CREATE TRIGGER jeongsi_pro_member_version BEFORE INSERT OR UPDATE ON public.organization_members
 FOR EACH ROW EXECUTE FUNCTION public.jeongsi_pro_bump_authority_version();

-- Explicit owner-managed mapping. Empty/withdrawn approvals do not open any exam.
CREATE TABLE public.jeongsi_pro_exam_approvals (
 academic_year integer NOT NULL CHECK(academic_year BETWEEN 2026 AND 2100),
 exam_id text NOT NULL CHECK(exam_id~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 approved boolean NOT NULL DEFAULT false,
 approval_ref text CHECK(approval_ref IS NULL OR char_length(approval_ref) BETWEEN 1 AND 256),
 approved_at timestamptz,
 PRIMARY KEY(academic_year,exam_id),
 CHECK(NOT approved OR (approval_ref IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE public.jeongsi_pro_exam_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jeongsi_pro_exam_approvals FROM PUBLIC,anon,authenticated,service_role,jungsi_backend_app,jungsi_backend_owner;

CREATE FUNCTION public.jeongsi_pro_authority(
 p_subject uuid,p_org_id text,p_mode text,p_ticket_ref text,p_evaluated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $authority$
DECLARE
 v_result jsonb;
 v_duplicate_org boolean;
 v_ambiguous_members boolean;
 v_exam_limit boolean;
BEGIN
 IF p_subject IS NULL OR p_evaluated_at IS NULL OR p_mode IS NULL
 OR p_mode NOT IN('list','member','support','retention')
 OR pg_catalog.current_setting('request.jwt.claim.sub',true) IS DISTINCT FROM p_subject::text
 OR (p_mode='list' AND (p_org_id IS NOT NULL OR p_ticket_ref IS NOT NULL))
 OR (p_mode='member' AND (p_org_id IS NULL OR p_ticket_ref IS NOT NULL)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='professional_authority_request_invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.jeongsi_pro_access()')
  AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.provolatile='s' AND p.prosecdef
  AND p.proconfig=ARRAY['search_path=public']
  AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=
   'b08bb8b0732773591e186bc9ad47bded29765c40898f7dfef4d7795bb9894d3b')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.org_active_contract(bigint)')
  AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.provolatile='s' AND p.prosecdef
  AND NOT p.proretset AND p.prorettype='public.organization_contracts'::regtype
  AND p.proconfig=ARRAY['search_path=public']
  AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=
   '83872d1fb8d40d7a3be4808bdcebc7e035c711ff7941b04c39b8377a415b1f7a') THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='professional_authority_source_unverified'; END IF;
 -- One set-based source statement: materialize the existing access function once,
 -- aggregate current members and approved exams once per source set, then join.
 -- No per-organization procedural query or guessed replacement contract selector.
 WITH account AS MATERIALIZED (
  SELECT CASE WHEN p.status='active' AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=p_evaluated_at) THEN 'active' ELSE 'inactive' END AS status,
   CASE WHEN p.status='active' AND p.role='admin' AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=p_evaluated_at) THEN 'admin' ELSE 'member' END AS role
  FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=p_subject
 ), account_state AS MATERIALIZED (
  SELECT coalesce((SELECT status FROM account),'inactive') AS status,
   coalesce((SELECT role FROM account),'member') AS role
 ), original_access AS MATERIALIZED (
  SELECT a.* FROM public.jeongsi_pro_access() a WHERE p_mode IN('list','member')
 ), source_access AS MATERIALIZED (
  SELECT a.*,c.version AS contract_version FROM original_access a
  JOIN public.organization_contracts c ON c.id=a.contract_id AND c.org_id=a.org_id
  CROSS JOIN account_state s WHERE s.status='active' AND (p_mode='list' OR a.org_id::text=p_org_id)
 ), org_ids AS MATERIALIZED (
  SELECT DISTINCT org_id FROM source_access
 ), academic_years AS MATERIALIZED (
  SELECT DISTINCT academic_year FROM source_access
 ), member_groups AS MATERIALIZED (
  SELECT m.org_id,count(*)<>count(DISTINCT m.user_id) AS ambiguous,
   pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('org_id',m.org_id::text,
   'member_id',m.id::text,'subject_id',m.user_id::text,'role',m.role,'version',m.version,'active',true)
   ORDER BY m.user_id,m.id) AS members
  FROM public.organization_members m JOIN org_ids o ON o.org_id=m.org_id
  WHERE m.status='active' GROUP BY m.org_id
 ), exam_groups AS MATERIALIZED (
  SELECT a.academic_year,count(*)>2000 AS exceeded,
   pg_catalog.jsonb_agg(a.exam_id ORDER BY a.exam_id) AS exams,
   pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('exam_id',a.exam_id,
    'approval_ref',a.approval_ref,'approved_at',a.approved_at) ORDER BY a.exam_id) AS approvals
  FROM public.jeongsi_pro_exam_approvals a JOIN academic_years y ON y.academic_year=a.academic_year
  WHERE a.approved GROUP BY a.academic_year
 ), dated_access AS (
  SELECT a.*,a.starts_on::timestamp AT TIME ZONE 'Asia/Seoul' AS starts_at,
   least((a.ends_on+1)::timestamp AT TIME ZONE 'Asia/Seoul',a.purge_on::timestamp AT TIME ZONE 'Asia/Seoul') AS expires_at
  FROM source_access a
 ), projected AS (
  SELECT a.org_id,coalesce(m.members,'[]'::jsonb) AS members,coalesce(e.approvals,'[]'::jsonb) AS approvals,
   pg_catalog.jsonb_build_object('org_id',a.org_id::text,'org_name',a.org_name,
   'contract_id',a.contract_id::text,'academic_year',a.academic_year,'version',a.contract_version,
   'status','active','starts_at_utc',pg_catalog.to_char(a.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'expires_at_utc',pg_catalog.to_char(a.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'contracted_student_count',a.seats,'approved_exam_ids',coalesce(e.exams,'[]'::jsonb)) AS contract
  FROM dated_access a LEFT JOIN member_groups m ON m.org_id=a.org_id
  LEFT JOIN exam_groups e ON e.academic_year=a.academic_year
  WHERE p_evaluated_at>=a.starts_at AND p_evaluated_at<a.expires_at
 ), finished AS (
  SELECT p.org_id,pg_catalog.jsonb_build_object('contract',p.contract,'members',p.members,
   'source_version','pa1:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('format','jungsi.professional-authority-source/v1',
    'contract',p.contract,'members',p.members,'account_role',s.role,'exam_approvals',p.approvals)::text,'UTF8')),'hex')) AS organization
  FROM projected p CROSS JOIN account_state s
 )
 SELECT pg_catalog.jsonb_build_object('format','jungsi.professional-authority/v1','subject_id',p_subject::text,
   'account_status',s.status,'account_role',s.role,'organizations',
   coalesce((SELECT pg_catalog.jsonb_agg(f.organization ORDER BY f.org_id) FROM finished f),'[]'::jsonb)),
  EXISTS(SELECT 1 FROM source_access GROUP BY org_id HAVING count(*)>1),
  EXISTS(SELECT 1 FROM member_groups WHERE ambiguous),EXISTS(SELECT 1 FROM exam_groups WHERE exceeded)
 INTO v_result,v_duplicate_org,v_ambiguous_members,v_exam_limit FROM account_state s;
 -- support/retention have no source_access rows and no manufactured authorized_mode.
 IF v_duplicate_org THEN RAISE EXCEPTION 'duplicate original active membership'; END IF;
 IF v_ambiguous_members THEN RAISE EXCEPTION 'ambiguous original active membership'; END IF;
 IF v_exam_limit THEN RAISE EXCEPTION 'authority exam result limit'; END IF;
 IF pg_catalog.octet_length(v_result::text)>1048576 THEN RAISE EXCEPTION 'authority result byte limit'; END IF;
 RETURN v_result;
END;
$authority$;
REVOKE ALL ON FUNCTION public.jeongsi_pro_authority(uuid,text,text,text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role,jungsi_backend_owner;
GRANT EXECUTE ON FUNCTION public.jeongsi_pro_authority(uuid,text,text,text,timestamptz) TO jungsi_backend_app;
-- Owner must read pg_get_functiondef and verify body/metadata/ACL before emitting the binding.
-- Its normalized definitionSha256 is intentionally NOT guessed in this file.
COMMIT;
