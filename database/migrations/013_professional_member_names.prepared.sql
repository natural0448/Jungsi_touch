-- Prepared only. Apply once as postgres, the existing public authority function owner.
-- The server sends current page member IDs from the authorized roster only.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog;
SELECT pg_catalog.pg_advisory_xact_lock(74961021013);
DO $preflight$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'original source owner required'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
  WHERE p.oid=pg_catalog.to_regprocedure('public.jeongsi_pro_authority(uuid,text,text,text,timestamptz)')
  AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
  AND p.prosecdef AND p.provolatile='s' AND NOT p.proretset
  AND p.prorettype='pg_catalog.jsonb'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog']) THEN
  RAISE EXCEPTION 'existing 008 authority required'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
  WHERE attrelid=pg_catalog.to_regclass('public.profiles') AND attname='name' AND NOT attisdropped) THEN
  RAISE EXCEPTION 'profile name source required'; END IF;
 IF pg_catalog.to_regprocedure('public.jeongsi_pro_member_names(uuid,text)') IS NOT NULL
 OR pg_catalog.to_regprocedure('public.jeongsi_pro_member_names(uuid,text,text[])') IS NOT NULL
 OR EXISTS (SELECT 1 FROM jungsi_backend.schema_versions WHERE version='013_professional_member_names') THEN
  RAISE EXCEPTION 'preserve existing registration and verify instead of reapplying'; END IF;
END
$preflight$;

CREATE FUNCTION public.jeongsi_pro_member_names(p_subject uuid, p_org_id text, p_member_ids text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $names$
DECLARE
 v_authority jsonb;
 v_org jsonb;
 v_result jsonb;
BEGIN
 IF p_subject IS NULL OR p_org_id IS NULL OR p_org_id !~ '^[0-9]{1,18}$'
 OR pg_catalog.current_setting('request.jwt.claim.sub',true) IS DISTINCT FROM p_subject::text
 OR p_member_ids IS NULL OR pg_catalog.cardinality(p_member_ids)>100
 OR (pg_catalog.cardinality(p_member_ids)>0 AND pg_catalog.array_ndims(p_member_ids)<>1)
 OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_member_ids) AS ids(id)
  WHERE ids.id IS NULL OR ids.id !~ '^[0-9]{1,18}$') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='professional_member_names_request_invalid'; END IF;

 v_authority := public.jeongsi_pro_authority(
  p_subject,p_org_id,'member',NULL,pg_catalog.statement_timestamp());
 IF v_authority->>'account_status' IS DISTINCT FROM 'active'
 OR v_authority->>'subject_id' IS DISTINCT FROM p_subject::text
 OR pg_catalog.jsonb_array_length(v_authority->'organizations') IS DISTINCT FROM 1 THEN
  RETURN '{}'::jsonb; END IF;
 v_org := v_authority->'organizations'->0;
 IF v_org->'contract'->>'org_id' IS DISTINCT FROM p_org_id
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_org->'members') AS caller(member)
  WHERE caller.member->>'subject_id'=p_subject::text
   AND caller.member->>'role'='org_admin' AND caller.member->'active'='true'::jsonb) THEN
  RETURN '{}'::jsonb; END IF;

 SELECT COALESCE(pg_catalog.jsonb_object_agg(
  m.id::text,pg_catalog.left(pg_catalog.btrim(p.name),40) ORDER BY m.id),'{}'::jsonb)
 INTO v_result
 FROM pg_catalog.jsonb_array_elements(v_org->'members') AS roster(member)
 JOIN public.organization_members m ON m.id::text=roster.member->>'member_id'
  AND m.user_id::text=roster.member->>'subject_id' AND m.org_id::text=p_org_id
 JOIN public.profiles p ON p.id=m.user_id
 JOIN auth.users u ON u.id=m.user_id
 WHERE roster.member->'active'='true'::jsonb AND m.status='active'
  AND m.id::text=ANY(p_member_ids) AND p.status='active' AND u.deleted_at IS NULL
  AND (u.banned_until IS NULL OR u.banned_until<=pg_catalog.statement_timestamp())
  AND pg_catalog.btrim(p.name)<>'';
 RETURN v_result;
END
$names$;
REVOKE ALL ON FUNCTION public.jeongsi_pro_member_names(uuid,text,text[])
 FROM PUBLIC,anon,authenticated,service_role,jungsi_backend_owner;
GRANT EXECUTE ON FUNCTION public.jeongsi_pro_member_names(uuid,text,text[]) TO jungsi_backend_app;

INSERT INTO jungsi_backend.schema_versions(version) VALUES('013_professional_member_names');
COMMIT;
