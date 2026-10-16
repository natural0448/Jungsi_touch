-- Owner preparation only. Separate approval is required for this public function DDL.
-- Intended caller: EduTouch backend with its server-only Supabase service_role key.
-- Existing private owner RPC is preserved. No browser, anonymous or member execute.
BEGIN;
DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'project Owner database role required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='006_score_input_policy') THEN
  RAISE EXCEPTION 'prepared 006 must be separately approved and applied first'; END IF;
 IF to_regprocedure('public.jungsi_paid_result_first_use_v1(uuid,bigint)') IS NOT NULL THEN
  RAISE EXCEPTION 'existing function preserved; inspect instead of replacing'; END IF;
END
$preflight$;
CREATE FUNCTION public.jungsi_paid_result_first_use_v1(target_subject uuid,target_pass_id bigint)
RETURNS TABLE(pass_id bigint,owner_id text,evidence_status text,first_result_at timestamptz,
 source_operation text,access_operation text,usage_basis text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $server_read$
 SELECT p.id,p.user_id::text,
  CASE WHEN u.pass_id IS NULL THEN 'no_record' ELSE 'recorded' END,
  u.first_result_at,u.source_operation,u.access_operation,u.usage_basis
 FROM public.jeongsi_passes p
 LEFT JOIN jungsi_backend.paid_result_first_use u ON u.pass_id=p.id AND u.owner_id=p.user_id::text
 WHERE (SELECT auth.role())='service_role'
  AND p.id=target_pass_id AND p.user_id=target_subject AND target_pass_id>0
$server_read$;
REVOKE ALL ON FUNCTION public.jungsi_paid_result_first_use_v1(uuid,bigint)
 FROM PUBLIC,anon,authenticated,jungsi_backend_app,jungsi_backend_owner;
GRANT EXECUTE ON FUNCTION public.jungsi_paid_result_first_use_v1(uuid,bigint) TO service_role;
-- no_record means no registered delivery evidence; it is not an automatic refund/unused verdict.
-- New immutable table rollout and legacy evidence acceptance remain separate gates.
COMMIT;
