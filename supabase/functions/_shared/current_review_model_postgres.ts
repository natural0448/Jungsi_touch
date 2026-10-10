/** Explicit RM v2 SQL candidate: app-owned narrow ports; frozen v1/C are unchanged. */
import './node_compat_bootstrap.ts';
import postgres from 'npm:postgres@3.4.5';
import { loadPinnedDisplayDescriptor } from './official_history_postgres.ts';
import type { OfficialHistoryInfrastructureSettings } from './official_history_postgres.ts';
import { parseStrictJson } from './official_history_display.ts';
import type { Row,Json } from './official_history_display.ts';
import { CURRENT_REVIEW_VIEW, validateCurrentKey } from './current_admission_display.ts';
import { currentReviewSha256, validateCurrentReviewQuery } from './current_admission_review.ts';
import { ANCESTRY,BINDING,CodecBudget,decodeRecord,digestRecord,encodeRecord,compareBytes,hexBytes,ReadModelError,ROOT,SEAL,SOURCE_STATE } from './current_review_model_codec.ts';
import { createPinnedEvidenceVerifier,validateReadModelDescriptor } from './current_review_model_validation.ts';
import type { EvidenceTrustPolicy,ReadModelDescriptor,ReadModelRawPage,ReadModelReviewPorts } from './current_review_model_validation.ts';
type Obj=Record<string,unknown>;
const fail=(code='current_review_model_not_ready')=>new ReadModelError(code);
export const REVIEW_MODEL_SCHEMA='jungsi_review_read_model';
export const REVIEW_MODEL_RELATIONS=['admission_review_batches','admission_review_changes','admission_review_seals','admission_review_lineage_members','admission_review_subject_grants','admission_review_revocations'] as const;
export const READ_MODEL_METADATA_SQL=`WITH RECURSIVE seeds AS (
 SELECT to_regclass(value)::oid AS oid FROM jsonb_array_elements_text($1::text::jsonb)
), closure(oid) AS (
 SELECT oid FROM seeds WHERE oid IS NOT NULL UNION
 SELECT d.refobjid FROM closure c JOIN pg_catalog.pg_rewrite rw ON rw.ev_class=c.oid
 JOIN pg_catalog.pg_depend d ON d.objid=rw.oid AND d.classid='pg_rewrite'::regclass AND d.refclassid='pg_class'::regclass WHERE d.refobjid<>c.oid
) SELECT n.nspname AS schema,c.relname AS relation,c.relkind::text AS kind,
 (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
 to_jsonb(c.reloptions) AS reloptions,CASE WHEN c.relkind='v' THEN pg_catalog.pg_get_viewdef(c.oid,true) ELSE NULL END AS definition,
 c.relrowsecurity AS rls,c.relforcerowsecurity AS force,pg_has_role(current_user,c.relowner,'MEMBER') AS owner,
 has_table_privilege(current_user,c.oid,'SELECT') AS readable,
 (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE')) AS writable,
 has_table_privilege('anon',c.oid,'SELECT') AS anon_read,has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_read,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled::text,'function',pg_catalog.pg_get_functiondef(t.tgfoid)) ORDER BY t.tgname COLLATE "C"),'[]'::jsonb) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'command',p.polcmd::text,'roles',to_jsonb(p.polroles),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname COLLATE "C"),'[]'::jsonb) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid) AS policies,
 (SELECT jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'security_definer',p.prosecdef,'config',to_jsonb(p.proconfig),'owner',pg_has_role(current_user,p.proowner,'MEMBER'),'app_execute',has_function_privilege(current_user,p.oid,'EXECUTE'),'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'))
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace WHERE p.oid=to_regprocedure('jungsi_review_read_model.has_live_review_grant(text,uuid,uuid)')) AS grant_helper
 FROM closure cl JOIN pg_catalog.pg_class c ON c.oid=cl.oid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('jungsi_data_ingest','jungsi_review_read_model') AND c.relkind IN ('r','v')
 ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C" LIMIT 129`;
const fold=(column:string)=>`translate(${column},'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')`;
/** Latest upsert/retract resolution precedes corrected filters; exact counts share the page snapshot.
 * Only bounded page bytes/proofs are joined. Source raw/member/population rows are never fetched.
 */
export const READ_MODEL_PAGE_SQL=`WITH latest_source AS MATERIALIZED (
 SELECT command_id,payload_sha256 FROM jungsi_data_ingest.admission_observation_commands
 WHERE COALESCE((receipt->>'management_events')::integer,0)>0 ORDER BY recorded_at DESC,command_id DESC LIMIT 1
), live_grant AS MATERIALIZED (
 SELECT min(g.not_before) AS not_before,min(g.expires_at) AS expires_at
 FROM jungsi_review_read_model.admission_review_subject_grants g
 WHERE g.tenant_key=$1::text AND g.head_batch_id=$2::uuid AND g.subject_id=$8::uuid
 AND g.manifest_sha256=$3::text AND g.binding_sha256=$4::text AND g.seal_sha256=$5::text
 AND g.approval_id=$20::text AND g.purpose='current_admission_review' AND g.operation='current.review.search'
 AND g.not_before<=transaction_timestamp() AND transaction_timestamp()<g.expires_at
 AND NOT EXISTS(SELECT 1 FROM jungsi_review_read_model.admission_review_revocations r WHERE r.tenant_key=g.tenant_key AND r.grant_id=g.grant_id)
), head AS MATERIALIZED (
 SELECT b.*,s.seal_bytes,s.seal_sha256,g.not_before AS grant_not_before,g.expires_at AS grant_expires_at FROM jungsi_review_read_model.admission_review_batches b
 JOIN jungsi_review_read_model.admission_review_seals s USING(tenant_key,batch_id)
 CROSS JOIN latest_source j CROSS JOIN live_grant g WHERE g.not_before IS NOT NULL AND g.expires_at IS NOT NULL AND b.tenant_key=$1::text AND b.batch_id=$2::uuid
 AND b.manifest_sha256=$3::text AND b.binding_sha256=$4::text AND s.seal_sha256=$5::text
 AND b.sealed_at IS NOT NULL AND j.command_id=$6::text AND j.payload_sha256=$7::text
 AND jungsi_review_read_model.has_live_review_grant(b.tenant_key,b.batch_id,$8::uuid)
), admitted AS MATERIALIZED (
 SELECT l.depth,l.ancestor_batch_id,l.ancestor_manifest_sha256,a.manifest_bytes,a.manifest_sha256
 FROM head h JOIN jungsi_review_read_model.admission_review_lineage_members l ON l.tenant_key=h.tenant_key AND l.head_batch_id=h.batch_id
 JOIN jungsi_review_read_model.admission_review_batches a ON a.tenant_key=l.tenant_key AND a.batch_id=l.ancestor_batch_id
 WHERE a.sealed_at IS NOT NULL AND l.depth BETWEEN 0 AND 4
), latest AS MATERIALIZED (
 SELECT DISTINCT ON (c.canonical_result_id COLLATE "C") c.tenant_key,c.batch_id,c.canonical_result_id,c.operation,c.academic_year,c.school_id,c.university_code,c.active_service,c.university,c.department,c.track,c.recruit_group,c.metric_kind,c.cohort
 FROM admitted a JOIN jungsi_review_read_model.admission_review_changes c ON c.tenant_key=$1::text AND c.batch_id=a.ancestor_batch_id
 ORDER BY c.canonical_result_id COLLATE "C",a.depth
), filtered AS MATERIALIZED (
 SELECT * FROM latest v WHERE v.operation='upsert' AND v.active_service=true
 AND v.academic_year=ANY(ARRAY(SELECT value::integer FROM jsonb_array_elements_text($9::text::jsonb)))
 AND ($10::integer IS NULL OR v.academic_year=$10::integer)
 AND ($11::text='' OR strpos(${fold("COALESCE(v.university,'')")},$11::text)>0)
 AND ($12::text='' OR strpos(${fold("COALESCE(v.department,'')")},$12::text)>0)
 AND ($13::text='' OR ${fold("COALESCE(v.track,'')")}=$13::text)
 AND ($14::text='' OR ${fold("COALESCE(v.recruit_group,'')")}=$14::text)
 AND ($15::text='' OR ${fold("COALESCE(v.metric_kind,'')")}=$15::text)
 AND ($16::text='' OR ${fold("COALESCE(v.cohort,'')")}=$16::text)
), counts AS (
 SELECT count(*)::text AS observation_count,count(DISTINCT (school_id,university_code))::text AS school_count FROM filtered
), page_keys AS MATERIALIZED (
 SELECT tenant_key,batch_id,academic_year,canonical_result_id FROM filtered
 WHERE $17::integer IS NULL OR (academic_year,canonical_result_id COLLATE "C")>($17::integer,$18::text COLLATE "C")
 ORDER BY academic_year,canonical_result_id COLLATE "C" LIMIT $19::integer
), payload AS (
 SELECT k.academic_year,k.canonical_result_id,jsonb_build_object('model_row_hex',encode(c.model_row_bytes,'hex'),'leaf_index',c.leaf_index::text,'proof_hex',encode(c.proof_siblings,'hex')) AS row
 FROM page_keys k JOIN jungsi_review_read_model.admission_review_changes c USING(tenant_key,batch_id,canonical_result_id)
) SELECT
 (SELECT encode(manifest_bytes,'hex') FROM head) AS root_hex,
 (SELECT encode(binding_bytes,'hex') FROM head) AS binding_hex,
 (SELECT encode(seal_bytes,'hex') FROM head) AS seal_hex,
 (SELECT encode(ancestry_bytes,'hex') FROM head) AS ancestry_hex,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('depth',depth,'batch_id',ancestor_batch_id::text,'manifest_sha256',ancestor_manifest_sha256,'root_hex',encode(manifest_bytes,'hex')) ORDER BY depth),'[]'::jsonb) FROM admitted) AS admitted,
 (SELECT command_id FROM latest_source) AS command_id,(SELECT payload_sha256 FROM latest_source) AS payload_sha256,
 (SELECT to_char(grant_not_before AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM head) AS grant_not_before,
 (SELECT to_char(grant_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM head) AS grant_expires_at,
 counts.observation_count,counts.school_count,to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS as_of,
 COALESCE((SELECT jsonb_agg(row ORDER BY academic_year,canonical_result_id COLLATE "C") FROM payload),'[]'::jsonb) AS rows FROM counts`;
export interface ReadModelSqlSettings extends OfficialHistoryInfrastructureSettings {budget:CodecBudget}
/** Explicit independent adapter is mandatory. Verify actual coverage/fence/registration state
 * in this RR snapshot, not journal-only equality or a cached approved descriptor.
 * expectedApprovedState is an approval hint, never an observed/cached state. The adapter must
 * read independent current source registration/fence, including out-of-command completeness.
 * No copied model STATE, expected echo, whole source scan, or journal-only implementation is allowed.
 * Its operational implementation and actual registration evidence are separate NOT_READY gates.
 */
export interface ReadModelSourceStateQualificationPort {
 qualifySnapshot(tx:postgres.TransactionSql<{}>,expectedApprovedState:Obj):Promise<Obj>;
}
export interface ReadModelSqlOptions {
 issuerKeys:ReadonlyMap<string,CryptoKey>;resolveEvidenceBatch:(references:readonly Obj[])=>Promise<readonly Uint8Array[]>;
 evidenceTrust:EvidenceTrustPolicy;sourceState:ReadModelSourceStateQualificationPort;
 sqlFactory?:(url:string,options:postgres.Options<{}>)=>postgres.Sql<{}>;
 fetcher?:typeof fetch;now?:()=>number;environment?:ReadModelDescriptor['environment'];
}
const roleSQL="SELECT current_user,r.rolsuper,r.rolbypassrls,current_setting('row_security') AS row_security,current_setting('transaction_read_only') AS read_only,pg_has_role(current_user,'jungsi_backend_owner','MEMBER') AS owner_member,pg_has_role(current_user,'jungsi_backend_owner','USAGE') AS owner_usage,pg_has_role(current_user,'postgres','MEMBER') AS postgres_member FROM pg_catalog.pg_roles r WHERE r.rolname=current_user";
async function boundedBody(response:Response):Promise<Uint8Array>{
 if(!response.body)throw fail('auth_unavailable');const chunks:Uint8Array[]=[];let size=0;const reader=response.body.getReader();
 try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>65_536)throw fail('auth_unavailable');chunks.push(p.value);}}finally{reader.releaseLock();}
 const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;
}
export function createReadModelSqlInfrastructure(settings:ReadModelSqlSettings,options:ReadModelSqlOptions):ReadModelReviewPorts {
 if(!settings.databaseUrl||!settings.databaseCa.includes('-----BEGIN CERTIFICATE-----')||!settings.supabaseUrl||!settings.publishableKey||!options.sourceState||typeof options.sourceState.qualifySnapshot!=='function'||!options.evidenceTrust)throw fail('current_review_model_trust_unavailable');
 const base=new URL(settings.supabaseUrl);if(base.protocol!=='https:'||base.pathname!=='/'||base.username||base.password||base.port||base.search||base.hash)throw fail();
 const fetcher=options.fetcher??fetch,now=options.now??Date.now,environment=options.environment??'isolated_cloud_review';
 const evidence=createPinnedEvidenceVerifier(options.issuerKeys,options.resolveEvidenceBatch,settings.budget,options.evidenceTrust);
 const sql=(options.sqlFactory??postgres)(settings.databaseUrl,{ssl:{rejectUnauthorized:true,ca:settings.databaseCa},prepare:false,max:1,connect_timeout:5,idle_timeout:5,max_lifetime:60,fetch_types:false,debug:false,onnotice:()=>{},backoff:()=>0.1,connection:{application_name:'jungsi-current-review-read-model'}});
 return {evidence,
  async loadDescriptor(){return await loadPinnedDisplayDescriptor(settings,fetcher) as unknown as ReadModelDescriptor;},
  async verifySession(token,instant){
   try{const response=await fetcher(base.origin+'/auth/v1/user',{headers:{apikey:settings.publishableKey,Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(5000)});
    if([400,401,403].includes(response.status))return null;if(!response.ok)throw fail('auth_unavailable');
    const user=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBody(response))) as Row;
    const pieces=token.split('.');if(pieces.length!==3)return null;
    const claimBytes=Uint8Array.from(atob(pieces[1].replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)),claims=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(claimBytes)) as Row;
    if(typeof user.id!=='string'||claims.sub!==user.id||typeof claims.exp!=='number'||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=instant)return null;return {subjectId:user.id,expiresAt:claims.exp*1000};
   }catch(e){if(e instanceof ReadModelError)throw e;throw fail('auth_unavailable');}
  },
  async readPage(d,q,after,subject){
   await validateReadModelDescriptor(d,environment,now(),settings.budget);validateCurrentReviewQuery(q);
   if(!d.approval.review_subjects.includes(subject))throw fail('review_subject_not_allowed');
   if(after!==null){validateCurrentKey(after);if(after[1]!=='CURRENT_REVIEW'||after[2]!=='CANONICAL_OBSERVATIONS'||after[3]!=='')throw fail('invalid_cursor');}
   try{return await sql.begin('isolation level repeatable read read only',async tx=>{
    await tx.unsafe("SET LOCAL TIME ZONE 'UTC'");await tx.unsafe("SET LOCAL statement_timeout='5000ms'");
    const role=await tx.unsafe(roleSQL);if(role.length!==1||role[0].current_user!=='jungsi_backend_app'||role[0].rolsuper!==false||role[0].rolbypassrls!==false||role[0].row_security!=='on'||role[0].read_only!=='on'||role[0].owner_member!==false||role[0].owner_usage!==false||role[0].postgres_member!==false)throw fail('current_review_runtime_role_unverified');
    await tx.unsafe("SELECT set_config('jungsi_review.tenant',$1::text,true),set_config('jungsi_review.subject',$2::text,true),set_config('jungsi_review.head',$3::text,true)",[d.root.tenant_key,subject,d.root.batch_id] as postgres.ParameterOrJSON<never>[]);
    const seeds=[CURRENT_REVIEW_VIEW,'jungsi_data_ingest.admission_result_source_members','jungsi_data_ingest.admission_result_population_links_current','jungsi_data_ingest.admission_observation_commands',...REVIEW_MODEL_RELATIONS.map(n=>REVIEW_MODEL_SCHEMA+'.'+n)];
    const metadata=await tx.unsafe(READ_MODEL_METADATA_SQL,[JSON.stringify(seeds)]);
    if(metadata.length<seeds.length||metadata.length>128||seeds.some(name=>!metadata.some(m=>m.schema+'.'+m.relation===name)))throw fail('current_review_model_metadata_unverified');
    for(const m of metadata){if(m.owner!==false||m.readable!==true||m.writable!==false||m.anon_read!==false||m.authenticated_read!==false)throw fail('current_review_runtime_role_unverified');if(m.kind==='r'&&(m.rls!==true||m.force!==true)||m.kind==='v'&&(!Array.isArray(m.reloptions)||!m.reloptions.includes('security_invoker=true')||!m.reloptions.includes('security_barrier=true')))throw fail();}
    for(const m of metadata){const helper=m.grant_helper;if(!helper||helper.security_definer!==false||helper.owner!==false||helper.app_execute!==true||helper.anon_execute!==false||helper.authenticated_execute!==false||!Array.isArray(helper.config)||!helper.config.some((s:unknown)=>typeof s==='string'&&s.startsWith('search_path=')))throw fail('current_review_model_metadata_unverified');}
    if(await currentReviewSha256(metadata as unknown as Json)!==d.model_metadata_sha256)throw fail('current_review_model_metadata_unverified');
    const state=d.binding.source_state as Obj;
    const currentState=await options.sourceState.qualifySnapshot(tx,state);
    if(compareBytes(encodeRecord(SOURCE_STATE,currentState,settings.budget),encodeRecord(SOURCE_STATE,state,settings.budget)))throw fail('current_review_model_state_unapproved');
    const sealDigest=await digestRecord('current_review_validation_seal_v2',SEAL,d.seal,settings.budget);
    const parameters=[d.root.tenant_key,d.root.batch_id,d.binding.head_manifest_sha256,d.seal.binding_sha256,sealDigest,state.command_id,state.payload_sha256,subject,JSON.stringify(d.allowed_years),q.academic_year,q.university_q,q.department_q,q.track,q.group,q.metric_kind,q.cohort,after===null?null:after[0],after===null?null:after[4],q.limit+1,d.approval.approval_id] as postgres.ParameterOrJSON<never>[];
    const records=await tx.unsafe(READ_MODEL_PAGE_SQL,parameters);if(records.length!==1)throw fail();const r=records[0];
    if(r.command_id!==state.command_id||r.payload_sha256!==state.payload_sha256)throw fail('current_review_model_state_unapproved');
    if(!['root_hex','binding_hex','seal_hex','ancestry_hex','grant_not_before','grant_expires_at','as_of','observation_count','school_count'].every(k=>typeof r[k]==='string')||!Array.isArray(r.admitted)||!Array.isArray(r.rows))throw fail('current_review_model_control_unverified');
    const ancestry=decodeRecord(ANCESTRY,hexBytes(r.ancestry_hex),settings.budget),entries=ancestry.entries as Obj[];
    if(r.admitted.length!==entries.length||r.admitted.some((a:Obj,i:number)=>Number(a.depth)!==i||a.batch_id!==entries[i].batch_id||a.manifest_sha256!==entries[i].manifest_sha256||typeof a.root_hex!=='string'))throw fail();
    const roots=(r.admitted as Obj[]).map(a=>decodeRecord(ROOT,hexBytes(a.root_hex as string),settings.budget));
    return {root:decodeRecord(ROOT,hexBytes(r.root_hex),settings.budget),binding:decodeRecord(BINDING,hexBytes(r.binding_hex),settings.budget),seal:decodeRecord(SEAL,hexBytes(r.seal_hex),settings.budget),ancestry,ancestorRoots:roots.slice(1),currentSourceState:currentState,grantNotBefore:r.grant_not_before,grantExpiresAt:r.grant_expires_at,asOf:r.as_of,matchingObservationCount:r.observation_count,matchingSourceSchoolCount:r.school_count,rows:r.rows} as ReadModelRawPage;
   });}catch(e){if(e instanceof ReadModelError)throw e;throw fail('current_review_model_dependency_unavailable');}
  }
 };
}

