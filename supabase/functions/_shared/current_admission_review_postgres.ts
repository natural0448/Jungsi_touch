/** App-role, verified-TLS, read-only current review. Fixed views; one bounded payload statement. */
import './node_compat_bootstrap.ts';
import postgres from 'npm:postgres@3.4.5';
import { DisplayError, parseStrictJson, sameJson } from './official_history_display.ts';
import type { Row } from './official_history_display.ts';
import { loadPinnedDisplayDescriptor } from './official_history_postgres.ts';
import type { OfficialHistoryInfrastructureSettings } from './official_history_postgres.ts';
import { CURRENT_REVIEW_VIEW, validateCurrentKey } from './current_admission_display.ts';
import { CURRENT_WIRE_FIELDS, MEMBER_WIRE_FIELDS, POPULATION_WIRE_FIELDS, validateCurrentReviewDescriptor, validateCurrentReviewQuery, isLiveBoundedReview } from './current_admission_review.ts';
import type { CurrentReviewDescriptor, CurrentReviewPorts, CurrentReviewRawPage } from './current_admission_review.ts';

export type CurrentReviewInfrastructureSettings=OfficialHistoryInfrastructureSettings;
const fail=(code='current_review_db_unavailable')=>new DisplayError(code);
const JSONB_FIELDS=['recruit_group_raw','anchor_2027_pks','source_location','original_record_locator','field_presence_types','curation_fields','curation_evidence'];
const schema='jungsi_data_ingest';
const MEMBERS=schema+'.admission_result_source_members',POPULATION=schema+'.admission_result_population_links_current',COMMANDS=schema+'.admission_observation_commands';
function wireObject(alias:string,fields:string[]):string {
  return 'jsonb_build_object('+fields.map(k=>"'"+k+"',"+alias+'.'+k+(k==='metric_value_numeric'||JSONB_FIELDS.includes(k)?'::text':'')).join(',')+')';
}
/** Immutable source-only SQL. Every value below is a static field/view name, not a descriptor identifier. */
export const CURRENT_REVIEW_METADATA_SQL=`WITH RECURSIVE seeds(oid) AS (
 SELECT to_regclass(qualified_name) FROM unnest(ARRAY(SELECT value FROM jsonb_array_elements_text($1::text::jsonb))) AS s(qualified_name)
), closure(oid) AS (
 SELECT oid FROM seeds WHERE oid IS NOT NULL UNION
 SELECT d.refobjid FROM closure x JOIN pg_catalog.pg_rewrite rw ON rw.ev_class=x.oid
 JOIN pg_catalog.pg_depend d ON d.objid=rw.oid AND d.classid='pg_rewrite'::regclass AND d.refclassid='pg_class'::regclass
 JOIN pg_catalog.pg_class child ON child.oid=d.refobjid JOIN pg_catalog.pg_namespace ns ON ns.oid=child.relnamespace
 WHERE ns.nspname='jungsi_data_ingest' AND child.relkind IN ('r','v')
) SELECT ns.nspname AS schema,c.relname AS relation,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force,
 to_jsonb(c.reloptions) AS reloptions,c.relowner=r.oid AS owner,
 has_table_privilege(current_user,c.oid,'SELECT') AS readable,
 has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable,
 has_table_privilege('anon',c.oid,'SELECT') AS anon_read,has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_read,
 CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) ELSE NULL END AS definition,
 (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum)
  FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
 FROM closure x JOIN pg_catalog.pg_class c ON c.oid=x.oid JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
 JOIN pg_catalog.pg_roles r ON r.rolname=current_user ORDER BY ns.nspname,c.relname LIMIT 129`;

const fold=(column:string)=>`translate(${column},'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')`;
export const CURRENT_REVIEW_PAYLOAD_SQL=`WITH latest AS MATERIALIZED (
 SELECT command_id,payload_sha256 FROM ${COMMANDS}
 WHERE COALESCE((receipt->>'management_events')::integer,0)>0 ORDER BY recorded_at DESC,command_id DESC LIMIT 1
), qualified AS MATERIALIZED (
 SELECT command_id,payload_sha256 FROM latest WHERE command_id=$12::text AND payload_sha256=$13::text
), filtered AS MATERIALIZED (
 SELECT v.canonical_result_id,v.academic_year,v.school_id,v.university_code FROM ${CURRENT_REVIEW_VIEW} v CROSS JOIN qualified
 WHERE v.active_service=true AND v.academic_year=ANY(ARRAY(SELECT value::integer FROM jsonb_array_elements_text($1::text::jsonb)))
 AND ($2::integer IS NULL OR v.academic_year=$2::integer)
 AND ($3::text='' OR strpos(${fold("COALESCE(v.university,'')")},$3::text)>0)
 AND ($4::text='' OR strpos(${fold("COALESCE(v.department,'')")},$4::text)>0)
 AND ($5::text='' OR ${fold("COALESCE(v.track,'')")}=$5::text)
 AND ($6::text='' OR ${fold("COALESCE(v.recruit_group,'')")}=$6::text)
 AND ($7::text='' OR ${fold("COALESCE(v.metric_kind,'')")}=$7::text)
 AND ($8::text='' OR ${fold("COALESCE(v.cohort,'')")}=$8::text)
), counts AS (
 SELECT count(*)::text AS observation_count,count(DISTINCT (school_id,university_code))::text AS school_count FROM filtered
), page_keys AS MATERIALIZED (
 SELECT f.canonical_result_id,f.academic_year FROM filtered f
 WHERE $9::integer IS NULL OR (f.academic_year,f.canonical_result_id COLLATE "C")>($9::integer,$10::text COLLATE "C")
 ORDER BY f.academic_year,f.canonical_result_id COLLATE "C" LIMIT $11::integer
), page_current AS MATERIALIZED (
 SELECT p.academic_year,p.canonical_result_id,${wireObject('v',CURRENT_WIRE_FIELDS)} AS current_wire
 FROM page_keys p JOIN ${CURRENT_REVIEW_VIEW} v ON v.canonical_result_id=p.canonical_result_id AND v.academic_year=p.academic_year
 WHERE v.canonical_result_id=ANY(ARRAY(SELECT k.canonical_result_id FROM page_keys k))
), members AS (
 SELECT m.canonical_result_id,jsonb_agg(${wireObject('m',MEMBER_WIRE_FIELDS)} ORDER BY m.release_id COLLATE "C",m.result_id COLLATE "C") AS member_wire
 FROM page_keys p JOIN ${MEMBERS} m ON m.canonical_result_id=p.canonical_result_id
 WHERE m.canonical_result_id=ANY(ARRAY(SELECT k.canonical_result_id FROM page_keys k)) GROUP BY m.canonical_result_id
), population AS (
 SELECT l.result_id,jsonb_agg(${wireObject('l',POPULATION_WIRE_FIELDS)} ORDER BY l.academic_year,l.population_reference_year,l.reference_offering_pk COLLATE "C",l.link_kind COLLATE "C",l.active_service,l.individual_offering_metric_inference_allowed) AS population_wire
 FROM page_keys p JOIN ${POPULATION} l ON l.result_id=p.canonical_result_id
 WHERE l.result_id=ANY(ARRAY(SELECT k.canonical_result_id FROM page_keys k)) GROUP BY l.result_id
), payload AS (
 SELECT p.academic_year,p.canonical_result_id,jsonb_build_object('current',p.current_wire,'members',COALESCE(m.member_wire,'[]'::jsonb),'population',COALESCE(l.population_wire,'[]'::jsonb)) AS observation
 FROM page_current p LEFT JOIN members m ON m.canonical_result_id=p.canonical_result_id LEFT JOIN population l ON l.result_id=p.canonical_result_id
) SELECT latest.command_id,latest.payload_sha256,counts.observation_count,counts.school_count,
 to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS as_of,
 COALESCE((SELECT jsonb_agg(observation ORDER BY academic_year,canonical_result_id COLLATE "C") FROM payload),'[]'::jsonb) AS observations
 FROM counts LEFT JOIN latest ON true`;

/** Live reviewer pages avoid a full matching-universe census on the raw current view.
 * Canonical rows are read once. Only that limit+1 selection joins provenance in bulk.
 * Null counts mean unknown; neither a page count nor catalog estimate is called exact.
 */
export const CURRENT_REVIEW_LIVE_PAYLOAD_SQL=`WITH latest AS MATERIALIZED (
 SELECT command_id,payload_sha256 FROM ${COMMANDS}
 WHERE COALESCE((receipt->>'management_events')::integer,0)>0 ORDER BY recorded_at DESC,command_id DESC LIMIT 1
), qualified AS MATERIALIZED (
 SELECT command_id,payload_sha256 FROM latest WHERE $12::text IS NULL AND $13::text IS NULL
), candidates AS MATERIALIZED (
 SELECT r.canonical_result_id FROM jungsi_data_ingest.admission_observation_registry r CROSS JOIN qualified
 WHERE r.is_representative=true AND ($9::integer IS NULL OR r.canonical_result_id COLLATE "C">$10::text COLLATE "C")
 ORDER BY r.canonical_result_id COLLATE "C" LIMIT 129
), scan_keys AS MATERIALIZED (
 SELECT canonical_result_id FROM candidates ORDER BY canonical_result_id COLLATE "C" LIMIT 128
), page_current AS MATERIALIZED (
 SELECT v.academic_year,v.canonical_result_id,v.offering_pk,v.curation_fields,v.active_service,${wireObject('v',CURRENT_WIRE_FIELDS)} AS current_wire
 FROM scan_keys k JOIN ${CURRENT_REVIEW_VIEW} v ON v.canonical_result_id=k.canonical_result_id
 WHERE v.canonical_result_id=ANY(ARRAY(SELECT canonical_result_id FROM scan_keys)) AND v.active_service=true AND v.academic_year=ANY(ARRAY(SELECT value::integer FROM jsonb_array_elements_text($1::text::jsonb)))
 AND ($2::integer IS NULL OR v.academic_year=$2::integer)
 AND ($3::text='' OR strpos(${fold("COALESCE(v.university,'')")},$3::text)>0)
 AND ($4::text='' OR strpos(${fold("COALESCE(v.department,'')")},$4::text)>0)
 AND ($5::text='' OR ${fold("COALESCE(v.track,'')")}=$5::text)
 AND ($6::text='' OR ${fold("COALESCE(v.recruit_group,'')")}=$6::text)
 AND ($7::text='' OR ${fold("COALESCE(v.metric_kind,'')")}=$7::text)
 AND ($8::text='' OR ${fold("COALESCE(v.cohort,'')")}=$8::text)
 AND ($9::integer IS NULL OR v.canonical_result_id COLLATE "C">$10::text COLLATE "C")
 ORDER BY v.canonical_result_id COLLATE "C" LIMIT $11::integer
), members AS (
 SELECT m.canonical_result_id,jsonb_agg(${wireObject('m',MEMBER_WIRE_FIELDS)} ORDER BY m.release_id COLLATE "C",m.result_id COLLATE "C") AS member_wire
 FROM page_current p JOIN ${MEMBERS} m ON m.canonical_result_id=p.canonical_result_id
 WHERE m.canonical_result_id=ANY(ARRAY(SELECT k.canonical_result_id FROM page_current k)) GROUP BY m.canonical_result_id
), page_links AS (
 SELECT p.canonical_result_id AS result_id,p.academic_year,p.academic_year AS population_reference_year,p.offering_pk AS reference_offering_pk,
 COALESCE(p.curation_fields->>'population_link_kind','same_year_offering') AS link_kind,p.active_service,false AS individual_offering_metric_inference_allowed
 FROM page_current p WHERE p.offering_pk IS NOT NULL
 UNION ALL
 SELECT p.canonical_result_id,p.academic_year,p.academic_year,x.pk,'verified_aggregate_offerings',p.active_service,false
 FROM page_current p CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN p.curation_fields->>'population_link_kind'='verified_aggregate_offerings' THEN p.curation_fields->'offering_pks' ELSE '[]'::jsonb END) x(pk)
 UNION ALL
 SELECT p.canonical_result_id,p.academic_year,(p.curation_fields->>'population_reference_year')::integer,x.pk,'official_reorganized_forward_reference',p.active_service,false
 FROM page_current p CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN p.curation_fields->>'population_link_kind'='official_reorganized_forward_reference' THEN p.curation_fields->'reference_offering_pks' ELSE '[]'::jsonb END) x(pk)
), population AS (
 SELECT l.result_id,jsonb_agg(${wireObject('l',POPULATION_WIRE_FIELDS)} ORDER BY l.academic_year,l.population_reference_year,l.reference_offering_pk COLLATE "C",l.link_kind COLLATE "C",l.active_service,l.individual_offering_metric_inference_allowed) AS population_wire
 FROM page_links l GROUP BY l.result_id
), payload AS (
 SELECT p.academic_year,p.canonical_result_id,jsonb_build_object('current',p.current_wire,'members',COALESCE(m.member_wire,'[]'::jsonb),'population',COALESCE(l.population_wire,'[]'::jsonb)) AS observation
 FROM page_current p LEFT JOIN members m ON m.canonical_result_id=p.canonical_result_id LEFT JOIN population l ON l.result_id=p.canonical_result_id
) SELECT latest.command_id,latest.payload_sha256,NULL::text AS observation_count,NULL::text AS school_count,
 CASE WHEN EXISTS(SELECT 1 FROM candidates OFFSET 128) THEN (SELECT canonical_result_id FROM scan_keys ORDER BY canonical_result_id COLLATE "C" DESC LIMIT 1) ELSE NULL END AS scan_after_canonical,
 to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS as_of,
 COALESCE((SELECT jsonb_agg(observation ORDER BY canonical_result_id COLLATE "C") FROM payload),'[]'::jsonb) AS observations
 FROM (SELECT true AS present) AS singleton LEFT JOIN latest ON true`;

/** Reuse the unchanged, approved live definitions after their metadata hashes/RLS
 * have been verified. Only fixed qualified relation names are substituted, once each.
 * Composite physical PK lookup + MATERIALIZED boundaries avoid barrier-view full scans.
 * No descriptor/request text is SQL, and no alternate canonical value is constructed.
 */
export function buildCurrentReviewLivePayloadSql(metadata:Row[]):string {
  const registry=schema+'.admission_observation_registry',physical=schema+'.admission_results';
  const effective=schema+'.admission_results_effective',source=schema+'.admission_results_source_current';
  const definition=(relation:string)=>{
    const row=metadata.find(r=>r.schema===schema&&r.relation===relation&&r.kind==='v');
    if(!row||typeof row.definition!=='string')throw fail('current_review_scope_unverified');
    const sql=row.definition.trim().replace(/;$/,'');
    if(!/^SELECT\s/i.test(sql)||sql.includes(';'))throw fail('current_review_scope_unverified');return sql;
  };
  const replace=(sql:string,qualified:string,bounded:string)=>{
    if(sql.split(qualified).length!==2)throw fail('current_review_scope_unverified');return sql.replace(qualified,bounded);
  };
  const boundedEffective=replace(definition('admission_results_effective'),physical,'bounded_physical_sources');
  const boundedSource=replace(replace(definition('admission_results_source_current'),registry,'bounded_source_registry'),effective,'bounded_effective_sources');
  const boundedCurrent=replace(replace(definition('admission_results_current'),source,'bounded_actual_sources'),registry,'bounded_actual_registry');
  const boundedMembers=replace(replace(definition('admission_result_source_members'),source,'bounded_original_sources'),registry,'bounded_source_registry');
  const ctes=`), bounded_source_registry AS MATERIALIZED (
 SELECT r.* FROM scan_keys k JOIN ${registry} r ON r.canonical_result_id=k.canonical_result_id
 WHERE r.canonical_result_id=ANY(ARRAY(SELECT canonical_result_id FROM scan_keys))
), bounded_actual_registry AS MATERIALIZED (
 SELECT * FROM bounded_source_registry WHERE is_representative=true
), bounded_physical_sources AS MATERIALIZED (
 SELECT b.* FROM bounded_source_registry d CROSS JOIN LATERAL (
  SELECT intake.* FROM ${physical} intake WHERE intake.release_id=d.source_release_id AND intake.result_id=d.source_result_id OFFSET 0
 ) b
), bounded_effective_sources AS MATERIALIZED (${boundedEffective}
), bounded_original_sources AS MATERIALIZED (${boundedSource}
), bounded_actual_sources AS MATERIALIZED (
 SELECT s.* FROM bounded_original_sources s JOIN bounded_actual_registry r ON r.source_result_id=s.result_id AND r.source_release_id=s.release_id
), bounded_current AS MATERIALIZED (${boundedCurrent}
), bounded_member_rows AS MATERIALIZED (${boundedMembers}
), page_current AS MATERIALIZED (`;
  return CURRENT_REVIEW_LIVE_PAYLOAD_SQL.replace('), page_current AS MATERIALIZED (',ctes)
    .replace('FROM scan_keys k JOIN '+CURRENT_REVIEW_VIEW+' v ON v.canonical_result_id=k.canonical_result_id','FROM bounded_current v')
    .replace('JOIN '+MEMBERS+' m ON m.canonical_result_id=p.canonical_result_id','JOIN bounded_member_rows m ON m.canonical_result_id=p.canonical_result_id');
}

async function bytes(response:Response,max:number):Promise<Uint8Array> {
  if(!response.body)throw fail('auth_unavailable');const declared=response.headers.get('content-length');
  if(declared&&(!/^[0-9]+$/.test(declared)||Number(declared)>max))throw fail('auth_unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try {while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>max)throw fail('auth_unavailable');chunks.push(part.value);}}
  finally {reader.releaseLock();}const body=new Uint8Array(total);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return body;
}
function origin(s:CurrentReviewInfrastructureSettings):string {
  try {const u=new URL(s.supabaseUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port)throw fail();return u.origin;}
  catch {throw fail('security_policy_unavailable');}
}
async function sha256(text:string):Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text).buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function createCurrentReviewInfrastructure(settings:CurrentReviewInfrastructureSettings,options:{fetcher?:typeof fetch;sqlFactory?:(url:string,options:postgres.Options<{}>)=>postgres.Sql<{}>;environment?:'isolated_cloud_review'|'local_verification';now?:()=>number}={}):CurrentReviewPorts {
  origin(settings);
  if(!settings.databaseUrl||!settings.databaseCa.includes('-----BEGIN CERTIFICATE-----')||!settings.publishableKey||!settings.storageSecret||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(settings.descriptorBucket)||!settings.descriptorPath||
    !/^[0-9a-f]{64}$/.test(settings.descriptorSha256)||!Number.isSafeInteger(settings.descriptorBytes)||settings.descriptorBytes<1||settings.descriptorBytes>2_000_000)throw fail('security_policy_unavailable');
  const fetcher=options.fetcher??fetch,sql=(options.sqlFactory??postgres)(settings.databaseUrl,{ssl:{rejectUnauthorized:true,ca:settings.databaseCa},prepare:false,max:1,connect_timeout:5,idle_timeout:5,max_lifetime:60,
    fetch_types:false,debug:false,backoff:()=>0.1,keep_alive:60,onnotice:()=>{},connection:{application_name:'jungsi-current-admission-review'}});
  return {
    async loadDescriptor() {return await loadPinnedDisplayDescriptor(settings,fetcher) as unknown as CurrentReviewDescriptor;},
    async verifySession(token,now) {
      try {
        const response=await fetcher(origin(settings)+'/auth/v1/user',{headers:{apikey:settings.publishableKey,Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(5000)});
        if([400,401,403].includes(response.status))return null;if(!response.ok)throw fail('auth_unavailable');
        const user=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(response,65_536))) as Row;
        const pieces=token.split('.');if(pieces.length!==3||typeof user.id!=='string')return null;
        const raw=atob(pieces[1].replace(/-/g,'+').replace(/_/g,'/'));
        const claims=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0)))) as Row;
        if(claims.sub!==user.id||typeof claims.exp!=='number'||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=now)return null;
        return {subjectId:user.id,expiresAt:claims.exp*1000};
      } catch(e) {if(e instanceof DisplayError)throw e;throw fail('auth_unavailable');}
    },
    async search(descriptor,query,after) {
      descriptor=await validateCurrentReviewDescriptor(descriptor,options.environment??'isolated_cloud_review',(options.now??Date.now)());
      validateCurrentReviewQuery(query);
      if(after!==null){validateCurrentKey(after);if(after[1]!==(isLiveBoundedReview(descriptor)?'CURRENT_REVIEW_LIVE':'CURRENT_REVIEW')||after[2]!=='CANONICAL_OBSERVATIONS'||after[3]!==''||isLiveBoundedReview(descriptor)&&after[0]!==2024)throw fail('invalid_cursor');}
      try {return (await sql.begin('isolation level repeatable read read only',async tx=>{
        await tx.unsafe("SET LOCAL TIME ZONE 'UTC'");await tx.unsafe("SET LOCAL statement_timeout='5000ms'");await tx.unsafe("SET LOCAL jit=off");
        const role=await tx.unsafe("SELECT current_user,r.rolsuper,r.rolbypassrls,current_setting('row_security') AS row_security,current_setting('transaction_read_only') AS read_only,pg_has_role(current_user,'jungsi_backend_owner','MEMBER') AS owner_member,pg_has_role(current_user,'jungsi_backend_owner','USAGE') AS owner_usage,pg_has_role(current_user,'postgres','MEMBER') AS postgres_member FROM pg_catalog.pg_roles r WHERE r.rolname=current_user");
        if(role.length!==1||role[0].current_user!=='jungsi_backend_app'||role[0].rolsuper!==false||role[0].rolbypassrls!==false||role[0].row_security!=='on'||role[0].read_only!=='on'||
          role[0].owner_member!==false||role[0].owner_usage!==false||role[0].postgres_member!==false)throw fail('current_review_runtime_role_unverified');
        const seeds=[CURRENT_REVIEW_VIEW,MEMBERS,POPULATION,COMMANDS];
        const metadata=await tx.unsafe(CURRENT_REVIEW_METADATA_SQL,[JSON.stringify(seeds)]);
        const expected=descriptor.source_definition.metadata as Row[];
        if(metadata.length!==expected.length||metadata.length>128)throw fail('current_review_scope_unverified');
        for(const m of metadata) {
          const pinned=expected.find(p=>p.schema===m.schema&&p.relation===m.relation);
          if(!pinned||m.owner!==false||m.readable!==true||m.writable!==false||m.anon_read!==false||m.authenticated_read!==false)throw fail('current_review_runtime_role_unverified');
          if(m.kind!==pinned.kind||!sameJson(m.columns,pinned.columns)||!sameJson(m.reloptions,pinned.reloptions))throw fail('current_review_scope_unverified');
          if(m.kind==='v') {if(typeof m.definition!=='string'||await sha256(m.definition)!==pinned.view_definition_sha256)throw fail('current_review_scope_unverified');}
          else if(m.kind!=='r'||m.rls!==true||m.force!==true)throw fail('current_review_runtime_role_unverified');
        }
        const parameters=[JSON.stringify(descriptor.allowed_years),query.academic_year,query.university_q,query.department_q,query.track,query.group,query.metric_kind,query.cohort,
          after===null?null:after[0],after===null?null:after[4],query.limit+1,isLiveBoundedReview(descriptor)?null:descriptor.qualified_state.command_id,isLiveBoundedReview(descriptor)?null:descriptor.qualified_state.payload_sha256] as postgres.ParameterOrJSON<never>[];
        const live=isLiveBoundedReview(descriptor);
        const rows=await tx.unsafe(live?buildCurrentReviewLivePayloadSql(metadata as Row[]):CURRENT_REVIEW_PAYLOAD_SQL,parameters);
        if(rows.length!==1)throw fail('current_review_scope_unverified');const r=rows[0];
        if(live?(typeof r.command_id!=='string'||!r.command_id||typeof r.payload_sha256!=='string'||!/^[0-9a-f]{64}$/.test(r.payload_sha256)):(r.command_id!==descriptor.qualified_state.command_id||r.payload_sha256!==descriptor.qualified_state.payload_sha256))throw fail('current_review_state_unapproved');
        if((live?(r.observation_count!==null||r.school_count!==null||(r.scan_after_canonical!==null&&typeof r.scan_after_canonical!=='string')):(typeof r.observation_count!=='string'||typeof r.school_count!=='string'))||typeof r.as_of!=='string'||!Array.isArray(r.observations))throw fail('current_review_scope_unverified');
        return {commandId:r.command_id,commandSha256:r.payload_sha256,asOf:r.as_of,matchingObservationCount:r.observation_count,matchingSourceSchoolCount:r.school_count,rows:r.observations,...(live?{scanNextKey:r.scan_after_canonical===null?null:validateCurrentKey([2024,'CURRENT_REVIEW_LIVE','CANONICAL_OBSERVATIONS','',r.scan_after_canonical])}:{})} as CurrentReviewRawPage;
      }));}catch(e){if(e instanceof DisplayError)throw e;throw fail();}
    },
  };
}
