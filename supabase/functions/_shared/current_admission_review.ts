import { isOwnerCurrentReview, OWNER_REVIEW_FORMAT, OWNER_REVIEW_WIRE_RECIPE, OWNER_PERCENTILE_VIEW, ownerCurrentProjectionSha256, parseOwnerCurrentQuery, validateOwnerCurrentQuery, validatePercentileHead, closeOwnerCurrentPage } from './current_admission_owner.ts';
/** Reviewer-only current observations. No publication, engine, default-member or frozen-C transition. */
import { DB_FIELDS, DisplayError, nowMicros, sameJson, utcInstantMicros, utcText } from './official_history_display.ts';
import type { Json, Row, VerifiedReviewSession } from './official_history_display.ts';
import { CURRENT_REVIEW_VIEW, compareCurrentKeys, EncryptedCurrentCursor, validateCurrentKey } from './current_admission_display.ts';
import type { CurrentKey, CurrentPageBinding } from './current_admission_display.ts';

export const CURRENT_REVIEW_ROUTE='/api/v1/review/current-admissions';
export const CURRENT_REVIEW_PURPOSE='current_admission_review';
export const CURRENT_REVIEW_OPERATION='current.review.search';
export const CURRENT_WIRE_FIELDS=[...DB_FIELDS,'source_result_id','canonical_result_id','source_member_count','management_status','overlap_review_key','source_row_fingerprint'];
export const MEMBER_WIRE_FIELDS=[...DB_FIELDS,'canonical_result_id','source_all29_sha256','is_representative'];
export const POPULATION_WIRE_FIELDS=['result_id','academic_year','population_reference_year','reference_offering_pk','link_kind','active_service','individual_offering_metric_inference_allowed'];
export const REVIEW_QUERY_FIELDS=['academic_year','university_q','department_q','track','group','metric_kind','cohort','limit','cursor'];
export const CURRENT_REVIEW_FIELDS=['observation_token','academic_year','university','department','track','recruit_group','metric_kind','metric_value_literal','metric_value_json_type','metric_value_numeric_text','cohort','statistic_label','source_member_count','link_scopes','official_metadata','review_status','value_availability','hold_reasons'];
export const CURRENT_REVIEW_WIRE_RECIPE='current_review_wire_state_v1';
export const CURRENT_REVIEW_LIVE_WIRE_RECIPE='current_review_live_bounded_v2';
export function isLiveBoundedReview(d:CurrentReviewDescriptor):boolean { return (d.format==='jungsi.current-admission-review/v2'||isOwnerCurrentReview(d))&&d.query_mode==='live_bounded'; }
const JSONB_FIELDS=['recruit_group_raw','anchor_2027_pks','source_location','original_record_locator','field_presence_types','curation_fields','curation_evidence'];
const YEARS=[2024,2025,2026,2027];
const REQUIRED_RELATIONS=['admission_results_current','admission_result_source_members','admission_result_population_links_current','admission_observation_commands'];
const text=(v:unknown):v is string=>typeof v==='string';
const record=(v:unknown):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Row,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=(v:unknown):v is string=>text(v)&&/^[0-9a-f]{64}$/.test(v);
const uuid=(v:unknown):v is string=>text(v)&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const fail=(code='current_review_scope_unverified',status=503)=>new DisplayError(code,status);
const lower=(v:string)=>v.replace(/[A-Z]/g,c=>c.toLowerCase());

export interface CurrentReviewQuery {
  academic_year:number|null;university_q:string;department_q:string;track:string;group:string;metric_kind:string;cohort:string;limit:number;cursor:string|null;activity?:string;offering_pk?:string;canonical_result_id?:string;
}
export interface CurrentReviewDescriptor extends Row {
  format:string;purpose:string;environment:string;scope:string;source_view:string;allowed_years:number[];
  source_definition:Row;projection:Row;qualified_state:Row;approval:Row;
  engine_approved:boolean;production_allowed:boolean;general_publication_allowed:boolean;nationwide_collection_complete:boolean;
}
export interface CurrentReviewObservation { current:Row;members:Row[];population:Row[];percentiles?:Row[];percentile_reviews?:Row[] }
export interface CurrentReviewRawPage {
  commandId:string;commandSha256:string;asOf:string;matchingObservationCount:string|null;matchingSourceSchoolCount:string|null;rows:CurrentReviewObservation[];scanNextKey?:CurrentKey|null;percentileHead?:Json;scannedRows?:number;
}
export interface CurrentReviewPorts {
  verifySession(token:string,now:number):Promise<VerifiedReviewSession|null>;
  loadDescriptor():Promise<CurrentReviewDescriptor>;
  search(descriptor:CurrentReviewDescriptor,query:CurrentReviewQuery,after:CurrentKey|null):Promise<CurrentReviewRawPage>;
}
export interface CurrentReviewTransport { relayToken:string;cursorKey:Uint8Array;pathPrefix:string;environment:'isolated_cloud_review'|'local_verification';now?:()=>number }

/** Safe native scalars / raw wire strings only. This is never the old Decimal/native32 codec. */
export function currentReviewWireJson(value:Json):string {
  if(value===null||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number') { if(!Number.isSafeInteger(value))throw fail();return String(value); }
  if(typeof value==='string')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(currentReviewWireJson).join(',')+']';
  if(!record(value))throw fail();
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+currentReviewWireJson(value[k])).join(',')+'}';
}
export async function currentReviewSha256(value:Json):Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(currentReviewWireJson(value)).buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function currentReviewProjectionSha256(mode:'exact'|'live_bounded'='exact'):Promise<string> {
  return currentReviewSha256({format:'jungsi.current-review-projection/v1',recipe:mode==='exact'?CURRENT_REVIEW_WIRE_RECIPE:CURRENT_REVIEW_LIVE_WIRE_RECIPE,
    current_fields:CURRENT_WIRE_FIELDS,member_fields:MEMBER_WIRE_FIELDS,population_fields:POPULATION_WIRE_FIELDS,public_fields:CURRENT_REVIEW_FIELDS,
    query_fields:REVIEW_QUERY_FIELDS,key_order:mode==='exact'?['academic_year','canonical_result_id']:['canonical_result_id'],normalization:'ASCII_case_fold_and_trim',
    ...(mode==='live_bounded'?{pagination:'finite_canonical_scan_then_current_filters',scan_rows:128,totals:'unknown',source_resolution:'pinned_definition_composite_key_v1'}:{})});
}
export async function validateCurrentReviewDescriptor(d:CurrentReviewDescriptor,environment:string,now:number):Promise<CurrentReviewDescriptor> {
  try {
    const owner=record(d)&&isOwnerCurrentReview(d),live=record(d)&&isLiveBoundedReview(d),recipe=owner?OWNER_REVIEW_WIRE_RECIPE:live?CURRENT_REVIEW_LIVE_WIRE_RECIPE:CURRENT_REVIEW_WIRE_RECIPE;
    if(!record(d)||!exact(d,['format','purpose','environment','scope','source_view','allowed_years','source_definition','projection','qualified_state','approval',
        'engine_approved','production_allowed','general_publication_allowed','nationwide_collection_complete',...(live?['query_mode']:[]),...(owner?['percentile_view']:[])])||
       d.format!==(owner?OWNER_REVIEW_FORMAT:live?'jungsi.current-admission-review/v2':'jungsi.current-admission-review/v1')||owner&&d.percentile_view!==OWNER_PERCENTILE_VIEW||d.purpose!==CURRENT_REVIEW_PURPOSE||d.environment!==environment||
       !['isolated_cloud_review','local_verification'].includes(environment)||d.scope!=='all_current'||d.source_view!==CURRENT_REVIEW_VIEW||
       !sameJson(d.allowed_years,YEARS)||d.engine_approved!==false||d.production_allowed!==false||d.general_publication_allowed!==false||d.nationwide_collection_complete!==false)throw fail();
    const a=d.approval,definition=d.source_definition,p=d.projection,state=d.qualified_state;
    if(!record(a)||!exact(a,['status','approval_id','issued_at','expires_at','revoked','review_subjects','operations'])||a.status!=='approved'||!text(a.approval_id)||!a.approval_id||a.revoked!==false||
       !Array.isArray(a.review_subjects)||!a.review_subjects.length||!a.review_subjects.every(uuid)||new Set(a.review_subjects).size!==a.review_subjects.length||
       !sameJson(a.operations,[CURRENT_REVIEW_OPERATION]))throw fail();
    const issued=utcInstantMicros(a.issued_at),expires=utcInstantMicros(a.expires_at),instant=nowMicros(now);
    if(issued>instant||instant>=expires||expires<=issued||expires-issued>86_400_000_000n)throw fail();
    if(!record(definition)||!exact(definition,['sha256','metadata'])||!hash(definition.sha256)||!Array.isArray(definition.metadata)||
       definition.metadata.length<REQUIRED_RELATIONS.length||definition.metadata.length>128||await currentReviewSha256(definition.metadata)!==definition.sha256)throw fail();
    const names=new Set<string>();
    for(const entry of definition.metadata) {
      if(!record(entry)||!exact(entry,['schema','relation','kind','columns','reloptions','view_definition_sha256'])||entry.schema!=='jungsi_data_ingest'||
         !text(entry.relation)||!/^admission_[a-z0-9_]+$|^(?:curation_overlays|school_scope_overlays)$/.test(entry.relation)||names.has(entry.relation)||
         !['v','r'].includes(entry.kind as string)||!Array.isArray(entry.columns)||!entry.columns.length)throw fail();
      names.add(entry.relation);
      const columnNames=new Set<string>();for(const column of entry.columns) {
        if(!record(column)||!exact(column,['name','type','not_null'])||!text(column.name)||!text(column.type)||typeof column.not_null!=='boolean'||columnNames.has(column.name))throw fail();
        columnNames.add(column.name);
      }
      if(entry.kind==='v') { if(!hash(entry.view_definition_sha256)||!Array.isArray(entry.reloptions)||
        !entry.reloptions.includes('security_invoker=true')||(!(owner&&entry.relation==='admission_result_percentiles_current')&&!entry.reloptions.includes('security_barrier=true')))throw fail(); }
      else if(entry.view_definition_sha256!==null||entry.reloptions!==null)throw fail();
    }
    if(!(owner?[...REQUIRED_RELATIONS,'admission_result_percentiles_current','admission_percentile_heads_v1','admission_percentile_releases_v1','admission_percentile_reviews_v1','admission_percentile_members_v1','admission_percentile_values_v1','admission_percentile_methods_v1']:REQUIRED_RELATIONS).every(name=>names.has(name))||!record(p)||!exact(p,['version','sha256','wire_recipe'])||!text(p.version)||!p.version||p.version.length>128||
       p.wire_recipe!==recipe||p.sha256!==(owner?await ownerCurrentProjectionSha256():await currentReviewProjectionSha256(live?'live_bounded':'exact'))||!record(state)||
       !exact(state,live?['mode','definition_sha256','wire_recipe']:['command_id','payload_sha256','definition_sha256','wire_recipe'])||
       (live?state.mode!=='live_current_head':(!text(state.command_id)||!state.command_id||!hash(state.payload_sha256)))||
       state.definition_sha256!==definition.sha256||state.wire_recipe!==recipe)throw fail();
    return d;
  } catch { throw fail(); }
}
export function parseCurrentReviewQuery(url:URL,owner=false):CurrentReviewQuery {
  if(owner)return parseOwnerCurrentQuery(url);
  const q:Record<string,string>=Object.create(null);
  for(const [k,v]of url.searchParams) {
    if(!REVIEW_QUERY_FIELDS.includes(k))throw fail('invalid_query',400);
    if(Object.hasOwn(q,k))throw fail('duplicate_query_field',422);q[k]=v;
  }
  const filter:Record<string,string>={};
  for(const k of ['university_q','department_q','track','group','metric_kind','cohort']) {
    const v=q[k]??'';if(v.length>100||/[\x00-\x1f\x7f]/.test(v))throw fail('invalid_query',400);filter[k]=lower(v).trim();
  }
  const year=q.academic_year===undefined?null:/^[0-9]+$/.test(q.academic_year)?Number(q.academic_year):NaN;
  if(year!==null&&!YEARS.includes(year))throw fail('invalid_year',400);
  const limit=q.limit===undefined?50:/^[0-9]+$/.test(q.limit)?Number(q.limit):NaN;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw fail('invalid_limit',400);
  const cursor=q.cursor??null;if(cursor!==null&&(!cursor||cursor.length>4096||!/^[A-Za-z0-9_-]+$/.test(cursor)))throw fail('invalid_cursor',400);
  return {academic_year:year,university_q:filter.university_q,department_q:filter.department_q,track:filter.track,group:filter.group,metric_kind:filter.metric_kind,cohort:filter.cohort,limit,cursor};
}
export function validateCurrentReviewQuery(q:CurrentReviewQuery):void {
  if(record(q)&&Object.hasOwn(q,"activity")){validateOwnerCurrentQuery(q);return;}
  if(!record(q)||!exact(q as unknown as Row,REVIEW_QUERY_FIELDS)||q.academic_year!==null&&!YEARS.includes(q.academic_year)||
    !Number.isSafeInteger(q.limit)||q.limit<1||q.limit>100||
    !['university_q','department_q','track','group','metric_kind','cohort'].every(k=>{const v=q[k as keyof CurrentReviewQuery];return text(v)&&v.length<=100&&v===lower(v).trim()&&!/[\x00-\x1f\x7f]/.test(v);})||
    q.cursor!==null&&(!text(q.cursor)||!q.cursor||q.cursor.length>4096||!/^[A-Za-z0-9_-]+$/.test(q.cursor)))throw fail();
}
export async function currentReviewBinding(d:CurrentReviewDescriptor,q:CurrentReviewQuery,subject:string,sessionExpires:number,head?:Pick<CurrentReviewRawPage,'commandId'|'commandSha256'|'percentileHead'>):Promise<CurrentPageBinding> {
  validateCurrentReviewQuery(q);if(!uuid(subject)||!Number.isSafeInteger(sessionExpires))throw fail();
  const query={academic_year:q.academic_year,university_q:q.university_q,department_q:q.department_q,track:q.track,group:q.group,metric_kind:q.metric_kind,cohort:q.cohort,...(isOwnerCurrentReview(d)?{activity:q.activity,offering_pk:q.offering_pk,canonical_result_id:q.canonical_result_id}:{})};
  const revision=await currentReviewHeadSha256(d,head);
  return {subjectId:subject,sourceVersion:d.projection.version as string,sourceStateSha256:revision,projectionSha256:d.projection.sha256 as string,
    operation:CURRENT_REVIEW_OPERATION,querySha256:await currentReviewSha256(query),expiresAtMs:Math.min(sessionExpires,Number(utcInstantMicros(d.approval.expires_at)/1000n))};
}
/** Dynamic head is authorized only by the explicit live v2 descriptor. The catalog recipe,
 * role/schema/purpose/subject/expiry remain pinned while each page adopts its actual DB head.
 */
export async function currentReviewHeadSha256(d:CurrentReviewDescriptor,head?:Pick<CurrentReviewRawPage,'commandId'|'commandSha256'|'percentileHead'>):Promise<string> {
  if(head&&(!text(head.commandId)||!head.commandId||head.commandId.length>256||!hash(head.commandSha256)))throw fail('current_review_state_unapproved');
  if(isOwnerCurrentReview(d)&&head)validatePercentileHead(head.percentileHead);
  return currentReviewSha256({...(isOwnerCurrentReview(d)&&head?{percentile_head:head.percentileHead??null}:{}),format:isOwnerCurrentReview(d)?'jungsi.current-review-wire-revision/v3':isLiveBoundedReview(d)?'jungsi.current-review-wire-revision/v2':'jungsi.current-review-wire-revision/v1',
    qualified_state:d.qualified_state,projection_sha256:d.projection.sha256,...(isLiveBoundedReview(d)&&head?{current_head:{command_id:head.commandId,payload_sha256:head.commandSha256}}:{})});
}
/** Syntax validation retains numeric lexemes; nested JSONB is never parsed into JS floating point. */
export function validateCurrentWireJsonText(value:string):void {
  let i=0;
  const ws=()=>{while(/\s/.test(value[i]??'')&&i<value.length)i++;};
  const string=()=>{const start=i++;let escaped=false;for(;i<value.length;i++) {
    const c=value[i];if(!escaped&&c==='"'){i++;return JSON.parse(value.slice(start,i)) as string;}
    if(!escaped&&c==='\\'){escaped=true;continue;}escaped=false;
  }throw fail();};
  const walk=(depth:number)=>{
    if(depth>64)throw fail();ws();const c=value[i];
    if(c==='"'){string();return;}
    if(c==='{'||c==='[') {
      const end=c==='{'?'}':']',object=c==='{',seen=new Set<string>();i++;ws();if(value[i]===end){i++;return;}
      while(true){ws();if(object){if(value[i]!=='"')throw fail();const k=string();if(seen.has(k))throw fail();seen.add(k);ws();if(value[i++]!==':')throw fail();}
        walk(depth+1);ws();if(value[i]===end){i++;return;}if(value[i++]!==',')throw fail();}
    }
    const m=value.slice(i).match(/^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
    if(!m)throw fail();i+=m[0].length;
  };
  try { walk(0);ws();if(i!==value.length)throw fail(); } catch { throw fail(); }
}
function decimal(value:string):string|null {
  const m=value.match(/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/);if(!m)return null;
  let digits=(m[2]+(m[3]??'')).replace(/^0+/,'');if(!digits)return '0';
  let exponent=BigInt(m[4]??'0')-BigInt((m[3]??'').length);const tail=digits.match(/0+$/)?.[0].length??0;
  if(tail){digits=digits.slice(0,-tail);exponent+=BigInt(tail);}return m[1]+digits+'e'+exponent;
}
export function validateCurrentScalar(literal:Json,type:Json,numeric:Json):{availability:string;reasons:string[]} {
  if(literal===null||type===null)return {availability:'missing',reasons:['value_missing']};
  if(!text(literal)||!text(type)||numeric!==null&&!text(numeric))return {availability:'held',reasons:['value_type_unqualified']};
  if(type==='null')return literal==='null'&&numeric===null?{availability:'actual_null',reasons:[]}:{availability:'held',reasons:['value_type_mismatch']};
  if(type==='string') {
    try {if(typeof JSON.parse(literal)!=='string')throw fail();return {availability:'present',reasons:[]};}catch{return {availability:'held',reasons:['value_type_mismatch']};}
  }
  if(['number','integer','decimal'].includes(type)) {
    const lhs=decimal(literal),rhs=text(numeric)?decimal(numeric):null;
    if(lhs===null||rhs===null||lhs!==rhs||type==='integer'&&!/^-?(?:0|[1-9][0-9]*)$/.test(literal))return {availability:'held',reasons:['value_numeric_mismatch']};
    return {availability:'present',reasons:[]};
  }
  return {availability:'held',reasons:['value_type_unqualified']};
}
export function currentReviewWireRow(row:Row,keys:string[],member=false,population=false):Row {
  if(!record(row)||!exact(row,keys))throw fail();
  for(const [k,v]of Object.entries(row)) {
    if(['academic_year','population_reference_year','source_member_count'].includes(k)) {if(v!==null&&(!Number.isSafeInteger(v)||typeof v!=='number'))throw fail();}
    else if(['active_service','is_representative','individual_offering_metric_inference_allowed'].includes(k)) {if(typeof v!=='boolean')throw fail();}
    else if(v!==null&&!text(v))throw fail();
    if(JSONB_FIELDS.includes(k)&&v!==null)validateCurrentWireJsonText(v as string);
  }
  if(!text(row.result_id)||!row.result_id||(!population&&!text(row.canonical_result_id))||
    member&&(!hash(row.source_all29_sha256)||!hash(row.row_fingerprint)))throw fail();
  return row;
}
export function currentReviewKey(row:Row,live=false):CurrentKey {
  return validateCurrentKey([live?2024:row.academic_year,live?'CURRENT_REVIEW_LIVE':'CURRENT_REVIEW','CANONICAL_OBSERVATIONS','',row.canonical_result_id]);
}
function matches(row:Row,q:CurrentReviewQuery):boolean {
  return (q.academic_year===null||row.academic_year===q.academic_year)&&lower(String(row.university??'')).includes(q.university_q)&&lower(String(row.department??'')).includes(q.department_q)&&
    ['track','group','metric_kind','cohort'].every(k=>!q[k as keyof CurrentReviewQuery]||lower(String(row[k==='group'?'recruit_group':k]??''))===q[k as keyof CurrentReviewQuery]);
}
function exactCount(value:string):number {
  if(!/^(?:0|[1-9][0-9]*)$/.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))throw fail();return Number(value);
}
/** Validate only page-selected private wire. Membership/link raw values remain server-only. */
export async function closeCurrentReviewPage(raw:CurrentReviewRawPage,d:CurrentReviewDescriptor,q:CurrentReviewQuery,b:CurrentPageBinding,after:CurrentKey|null,secret:Uint8Array):Promise<Row> {
  if(isOwnerCurrentReview(d))return await closeOwnerCurrentPage(raw,d,q,b,after,secret);
  validateCurrentReviewQuery(q);
  const live=isLiveBoundedReview(d);
  if(live?await currentReviewHeadSha256(d,raw)!==b.sourceStateSha256:(raw.commandId!==d.qualified_state.command_id||raw.commandSha256!==d.qualified_state.payload_sha256))throw fail('current_review_state_unapproved');
  if(live&&(raw.matchingObservationCount!==null||raw.matchingSourceSchoolCount!==null)||!live&&(raw.matchingObservationCount===null||raw.matchingSourceSchoolCount===null))throw fail();
  const obs=live?null:exactCount(raw.matchingObservationCount as string),schools=live?null:exactCount(raw.matchingSourceSchoolCount as string);
  if(obs!==null&&schools!==null&&schools>obs||!Array.isArray(raw.rows)||raw.rows.length>q.limit+1||obs!==null&&raw.rows.length>obs)throw fail();
  let previous=after;const seen=new Set<string>(),items:Row[]=[],keys:CurrentKey[]=[];
  const observationCipher=new EncryptedCurrentCursor(secret,'observation');
  for(const selected of raw.rows) {
    const c=currentReviewWireRow(selected.current,CURRENT_WIRE_FIELDS),key=currentReviewKey(c,live);
    if(!YEARS.includes(c.academic_year as number)||c.active_service!==true||c.result_id!==c.canonical_result_id||!matches(c,q)||
       previous&&compareCurrentKeys(previous,key)>=0||seen.has(c.canonical_result_id as string)||!Array.isArray(selected.members)||!Array.isArray(selected.population))throw fail();
    seen.add(c.canonical_result_id as string);previous=key;keys.push(key);
    const memberKeys=new Set<string>();let representative:Row|null=null;
    for(const source of selected.members) {
      currentReviewWireRow(source,MEMBER_WIRE_FIELDS,true);const composite=currentReviewWireJson([source.release_id,source.result_id]);
      if(source.canonical_result_id!==c.canonical_result_id||memberKeys.has(composite))throw fail();memberKeys.add(composite);
      if(source.is_representative===true){if(representative!==null)throw fail();representative=source;}
    }
    if(c.source_member_count!==selected.members.length||selected.members.length<1||representative===null||
       representative.result_id!==c.source_result_id||representative.release_id!==c.release_id||representative.row_fingerprint!==c.source_row_fingerprint)throw fail();
    const scopes:Row[]=[];
    for(const link of selected.population) {
      currentReviewWireRow(link,POPULATION_WIRE_FIELDS,false,true);
      if(link.result_id!==c.canonical_result_id||link.academic_year!==c.academic_year||!text(link.link_kind)||typeof link.population_reference_year!=='number')throw fail();
      scopes.push({link_kind:link.link_kind,population_reference_year:link.population_reference_year,individual_offering_metric_inference_allowed:link.individual_offering_metric_inference_allowed});
    }
    // Hash exact declared wire strings and preserve population multiplicity. This record
    // digest is bound inside the observation token, never called native32/source-all29.
    const orderedMembers=[...selected.members].sort((a,b)=>compareCurrentKeys([0,a.release_id as string,a.result_id as string,'',''],[0,b.release_id as string,b.result_id as string,'','']));
    const orderedPopulation=[...selected.population].sort((a,b)=>compareCurrentKeys([0,currentReviewWireJson(a),'','',''],[0,currentReviewWireJson(b),'','','']));
    const recordDigest=await currentReviewSha256({recipe:live?CURRENT_REVIEW_LIVE_WIRE_RECIPE:CURRENT_REVIEW_WIRE_RECIPE,scope_state_sha256:b.sourceStateSha256,current:c,members:orderedMembers,population:orderedPopulation});
    const value=validateCurrentScalar(c.metric_value_literal,c.metric_value_json_type,c.metric_value_numeric);
    const reasons=['review_only_not_published','public_offering_mapping_not_qualified','official_metadata_not_qualified',...value.reasons];
    if(scopes.some(s=>s.individual_offering_metric_inference_allowed===false))reasons.push('aggregate_or_forward_reference');
    const held=['held','missing'].includes(value.availability);
    items.push({observation_token:await observationCipher.seal({...b,sourceStateSha256:recordDigest},key),academic_year:c.academic_year,university:c.university,department:c.department,track:c.track,recruit_group:c.recruit_group,
      metric_kind:c.metric_kind,metric_value_literal:held?null:c.metric_value_literal,metric_value_json_type:c.metric_value_json_type,
      metric_value_numeric_text:held?null:c.metric_value_numeric,cohort:c.cohort,statistic_label:c.statistic_label,source_member_count:c.source_member_count,
      link_scopes:scopes,official_metadata:{metric_definition:null,unit:null,original_scale:null,source_url:null,source_as_of:null,publication_status:null},
      review_status:'review_only',value_availability:value.availability,hold_reasons:reasons});
  }
  if(schools!==null&&new Set(raw.rows.map(r=>currentReviewWireJson([r.current.school_id,r.current.university_code]))).size>schools)throw fail();
  let scanNext:CurrentKey|null=null;
  if(live) {
    if(!Object.hasOwn(raw,'scanNextKey'))throw fail();
    if(raw.scanNextKey!==null) {
      scanNext=validateCurrentKey(raw.scanNextKey);
      if(scanNext[0]!==2024||scanNext[1]!=='CURRENT_REVIEW_LIVE'||scanNext[2]!=='CANONICAL_OBSERVATIONS'||scanNext[3]!==''||
        after&&compareCurrentKeys(after,scanNext)>=0||keys.length&&compareCurrentKeys(keys[keys.length-1],scanNext)>0)throw fail();
    }
  }
  const resume=raw.rows.length>q.limit?keys[q.limit-1]:scanNext;
  const next=resume===null?null:await new EncryptedCurrentCursor(secret).seal(b,resume);
  return {format:live?'jungsi.current-admission-review-page/v2':'jungsi.current-admission-review-page/v1',...(live?{query_mode:'live_bounded',count_status:'unknown'}:{}),status:'review',items:items.slice(0,q.limit),matching_observation_count:obs,matching_source_school_count:schools,
    review_version:d.projection.version,as_of:utcText(raw.asOf),next_cursor:next,publication_status:'not_published'};
}
export function createCurrentAdmissionReviewHandler(ports:CurrentReviewPorts,t:CurrentReviewTransport):(request:Request)=>Promise<Response> {
  const cursor=new EncryptedCurrentCursor(t.cursorKey);
  return async request=>{
    const id=crypto.randomUUID().replace(/-/g,'');
    const response=(body:Row,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Request-ID':id}});
    try {
      const relay=(v:string|null)=>v!==null&&/^[\x21-\x2b\x2d-\x7e]{32,512}$/.test(v);
      if(!relay(t.relayToken)||!/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(t.pathPrefix))throw fail('security_policy_unavailable');
      const actual=request.headers.get('X-Jungsi-Relay-Token');
      if(!relay(actual))throw fail('relay_authentication_failed',403);
      const a=await currentReviewSha256(actual),b=await currentReviewSha256(t.relayToken);let xor=0;for(let i=0;i<a.length;i++)xor|=a.charCodeAt(i)^b.charCodeAt(i);
      if(xor!==0||actual!.length!==t.relayToken.length)throw fail('relay_authentication_failed',403);
      const url=new URL(request.url);
      if(request.method!=='GET'||url.pathname!==t.pathPrefix+CURRENT_REVIEW_ROUTE)throw fail('display_operation_not_supported');
      const auth=request.headers.get('Authorization');if(!auth?.startsWith('Bearer ')||!/^[^\s,]{1,16384}$/.test(auth.slice(7)))throw fail('authentication_required',401);
      const now=(t.now??Date.now)(),session=await ports.verifySession(auth.slice(7),now);
      if(!session||!uuid(session.subjectId)||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=now)throw fail('authentication_required',401);
      const descriptor=await validateCurrentReviewDescriptor(await ports.loadDescriptor(),t.environment,now);
      if(!(descriptor.approval.review_subjects as string[]).includes(session.subjectId))throw fail('review_subject_not_allowed',403);
      const q=parseCurrentReviewQuery(url,isOwnerCurrentReview(descriptor)),live=isLiveBoundedReview(descriptor);
      let binding=await currentReviewBinding(descriptor,q,session.subjectId,session.expiresAt),after:CurrentKey|null=null,adoptedHead:string|null=null;
      if(q.cursor!==null) {
        if(live){const saved=await cursor.openLiveSnapshot(q.cursor,binding,now);after=saved.after;adoptedHead=saved.sourceStateSha256;}
        else after=await cursor.open(q.cursor,binding,now);
      }
      let raw:CurrentReviewRawPage;
      try {raw=await ports.search(descriptor,q,after);}catch(e){if(q.cursor&&e instanceof DisplayError&&e.code==='current_review_state_unapproved')throw fail('cursor_version_mismatch',409);throw e;}
      if(live){binding=await currentReviewBinding(descriptor,q,session.subjectId,session.expiresAt,raw);if(adoptedHead!==null&&adoptedHead!==binding.sourceStateSha256)throw fail('cursor_version_mismatch',409);}
      else if(q.cursor&&(raw.commandId!==descriptor.qualified_state.command_id||raw.commandSha256!==descriptor.qualified_state.payload_sha256))throw fail('cursor_version_mismatch',409);
      const completed=(t.now??Date.now)();
      if(session.expiresAt<=completed)throw fail('authentication_required',401);
      await validateCurrentReviewDescriptor(descriptor,t.environment,completed);
      const page=await closeCurrentReviewPage(raw,descriptor,q,binding,after,t.cursorKey);
      const sending=(t.now??Date.now)();
      if(session.expiresAt<=sending)throw fail('authentication_required',401);
      await validateCurrentReviewDescriptor(descriptor,t.environment,sending);
      return response(page);
    } catch(e) {
      const error=e instanceof DisplayError?e:fail('backend_dependency_unavailable');
      return response({status:'error',error:{code:error.code},request_id:id},error.status);
    }
  };
}
