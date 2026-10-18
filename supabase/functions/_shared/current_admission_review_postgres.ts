import { isOwnerCurrentReview, validatePercentileHead } from './current_admission_owner.ts';
import { buildOwnerCurrentReviewPayloadSql, OWNER_CURRENT_REVIEW_METADATA_SEEDS } from './current_admission_owner_sql.ts';
/** App-role, verified-TLS, read-only current review. Fixed views; one bounded payload statement. */
import './node_compat_bootstrap.ts';
import { CURRENT_REVIEW_METADATA_SQL, CURRENT_REVIEW_PAYLOAD_SQL, CURRENT_REVIEW_LIVE_PAYLOAD_SQL, buildCurrentReviewLivePayloadSql } from './current_admission_review_sql.ts';
export { CURRENT_REVIEW_METADATA_SQL, CURRENT_REVIEW_PAYLOAD_SQL, CURRENT_REVIEW_LIVE_PAYLOAD_SQL, buildCurrentReviewLivePayloadSql } from './current_admission_review_sql.ts';

import postgres from 'npm:postgres@3.4.5';
import { DisplayError, parseStrictJson, sameJson } from './official_history_display.ts';
import type { Row } from './official_history_display.ts';
import { loadPinnedDisplayDescriptor } from './official_history_postgres.ts';
import type { OfficialHistoryInfrastructureSettings } from './official_history_postgres.ts';
import { CURRENT_REVIEW_VIEW, validateCurrentKey } from './current_admission_display.ts';
import { validateCurrentReviewDescriptor, validateCurrentReviewQuery, isLiveBoundedReview } from './current_admission_review.ts';
import type { CurrentReviewDescriptor, CurrentReviewPorts, CurrentReviewRawPage } from './current_admission_review.ts';

export type CurrentReviewInfrastructureSettings=OfficialHistoryInfrastructureSettings;
const fail=(code='current_review_db_unavailable')=>new DisplayError(code);
const schema='jungsi_data_ingest';
const MEMBERS=schema+'.admission_result_source_members',POPULATION=schema+'.admission_result_population_links_current',COMMANDS=schema+'.admission_observation_commands';
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
      const owner=isOwnerCurrentReview(descriptor);if(owner!==(query.activity!==undefined))throw fail('invalid_query');
      if(after!==null){validateCurrentKey(after);if(after[1]!==(isLiveBoundedReview(descriptor)?'CURRENT_REVIEW_LIVE':'CURRENT_REVIEW')||after[2]!=='CANONICAL_OBSERVATIONS'||after[3]!==''||isLiveBoundedReview(descriptor)&&after[0]!==2024)throw fail('invalid_cursor');}
      try {return (await sql.begin('isolation level repeatable read read only',async tx=>{
        await tx.unsafe("SET LOCAL TIME ZONE 'UTC'");await tx.unsafe("SET LOCAL statement_timeout='5000ms'");await tx.unsafe("SET LOCAL jit=off");
        const role=await tx.unsafe("SELECT current_user,r.rolsuper,r.rolbypassrls,current_setting('row_security') AS row_security,current_setting('transaction_read_only') AS read_only,pg_has_role(current_user,'jungsi_backend_owner','MEMBER') AS owner_member,pg_has_role(current_user,'jungsi_backend_owner','USAGE') AS owner_usage,pg_has_role(current_user,'postgres','MEMBER') AS postgres_member FROM pg_catalog.pg_roles r WHERE r.rolname=current_user");
        if(role.length!==1||role[0].current_user!=='jungsi_backend_app'||role[0].rolsuper!==false||role[0].rolbypassrls!==false||role[0].row_security!=='on'||role[0].read_only!=='on'||
          role[0].owner_member!==false||role[0].owner_usage!==false||role[0].postgres_member!==false)throw fail('current_review_runtime_role_unverified');
        const seeds=owner?[...OWNER_CURRENT_REVIEW_METADATA_SEEDS]:[CURRENT_REVIEW_VIEW,MEMBERS,POPULATION,COMMANDS];
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
        if(owner)parameters.push(query.activity??'all',query.canonical_result_id??'',query.offering_pk??'');
        const live=isLiveBoundedReview(descriptor);
        const rows=await tx.unsafe(owner?buildOwnerCurrentReviewPayloadSql(metadata as Row[]):live?buildCurrentReviewLivePayloadSql(metadata as Row[]):CURRENT_REVIEW_PAYLOAD_SQL,parameters);
        if(rows.length!==1)throw fail('current_review_scope_unverified');const r=rows[0];
        if(live?(typeof r.command_id!=='string'||!r.command_id||typeof r.payload_sha256!=='string'||!/^[0-9a-f]{64}$/.test(r.payload_sha256)):(r.command_id!==descriptor.qualified_state.command_id||r.payload_sha256!==descriptor.qualified_state.payload_sha256))throw fail('current_review_state_unapproved');
        if((live?(r.observation_count!==null||r.school_count!==null||(r.scan_after_canonical!==null&&typeof r.scan_after_canonical!=='string')):(typeof r.observation_count!=='string'||typeof r.school_count!=='string'))||typeof r.as_of!=='string'||!Array.isArray(r.observations))throw fail('current_review_scope_unverified');
        if(owner){validatePercentileHead(r.percentile_head);if(!Number.isSafeInteger(r.scanned_rows)||r.scanned_rows<0||r.scanned_rows>128)throw fail('current_review_scope_unverified');}
        return {...(owner?{percentileHead:r.percentile_head,scannedRows:r.scanned_rows}:{}),commandId:r.command_id,commandSha256:r.payload_sha256,asOf:r.as_of,matchingObservationCount:r.observation_count,matchingSourceSchoolCount:r.school_count,rows:r.observations,...(live?{scanNextKey:r.scan_after_canonical===null?null:validateCurrentKey([2024,'CURRENT_REVIEW_LIVE','CANONICAL_OBSERVATIONS','',r.scan_after_canonical])}:{})} as CurrentReviewRawPage;
      }));}catch(e){if(e instanceof DisplayError)throw e;throw fail();}
    },
  };
}
