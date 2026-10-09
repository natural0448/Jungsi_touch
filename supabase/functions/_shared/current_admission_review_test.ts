/** Synthetic reviewer, precise wire and SQL-port regressions. No real settings, JWT, DB or network. */
import { DisplayError, sameJson } from './official_history_display.ts';
import type { Row } from './official_history_display.ts';
import { EncryptedCurrentCursor } from './current_admission_display.ts';
import type { CurrentKey } from './current_admission_display.ts';
import { CURRENT_REVIEW_FIELDS, CURRENT_REVIEW_OPERATION, CURRENT_REVIEW_ROUTE, CURRENT_WIRE_FIELDS, MEMBER_WIRE_FIELDS, POPULATION_WIRE_FIELDS,
  closeCurrentReviewPage, createCurrentAdmissionReviewHandler, currentReviewBinding, currentReviewKey, currentReviewProjectionSha256, currentReviewSha256, currentReviewWireJson,
  parseCurrentReviewQuery, validateCurrentReviewDescriptor, validateCurrentScalar, validateCurrentWireJsonText } from './current_admission_review.ts';
import type { CurrentReviewDescriptor, CurrentReviewObservation, CurrentReviewPorts, CurrentReviewRawPage } from './current_admission_review.ts';
import { createCurrentReviewInfrastructure, CURRENT_REVIEW_METADATA_SQL, CURRENT_REVIEW_PAYLOAD_SQL } from './current_admission_review_postgres.ts';
const SUBJECT='00000000-0000-0000-0000-000000000001',OTHER='00000000-0000-0000-0000-000000000002';
const NOW=Date.parse('2026-10-09T00:00:00Z'),RELAY='SYNTHETIC-current-review-relay-not-real-0000',PREFIX='/functions/v1/current-admission-review';
const SECRET=new Uint8Array(32).fill(13);
const assert=(value:unknown,message='synthetic review assertion failed')=>{if(!value)throw new Error(message);};
const equal=(a:unknown,b:unknown)=>assert(sameJson(a,b),'synthetic typed equality failed');
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
async function rejects(action:()=>unknown|Promise<unknown>,code:string) {
  try {await action();}catch(e){if(!(e instanceof DisplayError))throw new Error('synthetic expected safe error');equal(e.code,code);return;}throw new Error('synthetic expected rejection');
}
const query=(q='')=>parseCurrentReviewQuery(new URL('https://example.org/synthetic'+q));
async function rawSha(text:string):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function descriptor():Promise<CurrentReviewDescriptor> {
  const metadata:Row[]=[];
  for(const [relation,kind]of [['admission_results_current','v'],['admission_result_source_members','v'],['admission_result_population_links_current','v'],['admission_observation_commands','r']]as const)
    metadata.push({schema:'jungsi_data_ingest',relation,kind,columns:[{name:'SYNTHETIC-column',type:'text',not_null:false}],reloptions:kind==='v'?['security_invoker=true','security_barrier=true']:null,
      view_definition_sha256:kind==='v'?await rawSha('SYNTHETIC definition '+relation):null});
  const definition={sha256:await currentReviewSha256(metadata),metadata};
  return {format:'jungsi.current-admission-review/v1',purpose:'current_admission_review',environment:'local_verification',scope:'all_current',source_view:'jungsi_data_ingest.admission_results_current',
    allowed_years:[2024,2025,2026,2027],source_definition:definition,projection:{version:'SYNTHETIC-current-review-v1',sha256:await currentReviewProjectionSha256(),wire_recipe:'current_review_wire_state_v1'},
    qualified_state:{command_id:'SYNTHETIC-qualified-command',payload_sha256:'b'.repeat(64),definition_sha256:definition.sha256,wire_recipe:'current_review_wire_state_v1'},
    approval:{status:'approved',approval_id:'SYNTHETIC-review-approval',issued_at:'2026-10-09T00:00:00Z',expires_at:'2026-10-09T01:00:00Z',revoked:false,review_subjects:[SUBJECT],operations:[CURRENT_REVIEW_OPERATION]},
    engine_approved:false,production_allowed:false,general_publication_allowed:false,nationwide_collection_complete:false};
}
function observation(i:number,literal='0.1000000000000000000010',type='number',numeric:Row['metric_value_numeric']=literal):CurrentReviewObservation {
  const current:Row=Object.fromEntries(CURRENT_WIRE_FIELDS.map(k=>[k,null]));
  Object.assign(current,{release_id:'SYNTHETIC-source-release',result_id:'SYNTHETIC-canonical-'+i,academic_year:2026,school_id:'SYNTHETIC-school',university_code:'SYNTHETIC-code',university:'SYNTHETIC University',
    recruit_group:'가',recruit_group_raw:'{"SYNTHETIC":9007199254740993}',department:'SYNTHETIC Department',track:'SYNTHETIC Track',offering_pk:'SYNTHETIC-private-PK',anchor_2027_pks:'[]',metric_kind:'SYNTHETIC metric',
    metric_value_literal:literal,metric_value_numeric:numeric,metric_value_json_type:type,cohort:'SYNTHETIC cohort',statistic_label:'SYNTHETIC statistic',active_service:true,
    source_path:'SYNTHETIC-private-path',source_sha256:'c'.repeat(64),source_location:'{"SYNTHETIC":0.1000000000000000000001}',source_review_status:'SYNTHETIC-reviewed',
    original_record_locator:'{}',field_presence_types:'{}',row_fingerprint:'d'.repeat(64),curation_release_id:'SYNTHETIC-revision',curation_fields:'{}',curation_evidence:'{}',
    source_result_id:'SYNTHETIC-original-'+i,canonical_result_id:'SYNTHETIC-canonical-'+i,source_member_count:1,management_status:'SYNTHETIC-management',overlap_review_key:'SYNTHETIC-private-overlap',source_row_fingerprint:'d'.repeat(64)});
  const member=Object.fromEntries(MEMBER_WIRE_FIELDS.map(k=>[k,Object.hasOwn(current,k)?current[k]:null])) as Row;
  Object.assign(member,{result_id:current.source_result_id,canonical_result_id:current.canonical_result_id,source_all29_sha256:'e'.repeat(64),is_representative:true});
  const population:Row={result_id:current.canonical_result_id,academic_year:2026,population_reference_year:2027,reference_offering_pk:'SYNTHETIC-private-forward-PK',link_kind:'official_reorganized_forward_reference',active_service:true,individual_offering_metric_inference_allowed:false};
  return {current,members:[member],population:[population]};
}
function raw(rows:CurrentReviewObservation[],extra:Partial<CurrentReviewRawPage>={}):CurrentReviewRawPage {
  return {commandId:'SYNTHETIC-qualified-command',commandSha256:'b'.repeat(64),asOf:'2026-10-09T00:00:00.123456+00:00',matchingObservationCount:String(rows.length),matchingSourceSchoolCount:rows.length?'1':'0',rows,...extra};
}
async function fixture() {
  const d=await descriptor(),rows=[observation(1),observation(2)],calls:string[]=[];let subject=SUBJECT,clock=NOW,changed=false;
  const ports:CurrentReviewPorts={async verifySession(token){calls.push('verify');return token==='SYNTHETIC-verified'?{subjectId:subject,expiresAt:NOW+7200000}:null;},async loadDescriptor(){calls.push('descriptor');return copy(d);},
    async search(_d,q,after){calls.push('search');const selected=rows.filter(r=>(q.academic_year===null||q.academic_year===r.current.academic_year)&&String(r.current.department).toLowerCase().includes(q.department_q));
      return raw(selected.filter(r=>after===null||String(r.current.canonical_result_id)>after[4]).slice(0,q.limit+1),{matchingObservationCount:String(selected.length),matchingSourceSchoolCount:selected.length?'1':'0',
        ...(changed?{commandId:'SYNTHETIC-unapproved-command'}:{})});}};
  const handler=createCurrentAdmissionReviewHandler(ports,{relayToken:RELAY,cursorKey:SECRET,pathPrefix:PREFIX,environment:'local_verification',now:()=>clock});
  const request=(suffix='',headers:Record<string,string>={},method='GET',route=CURRENT_REVIEW_ROUTE)=>handler(new Request('https://example.org'+PREFIX+route+suffix,{method,headers:{'X-Jungsi-Relay-Token':RELAY,Authorization:'Bearer SYNTHETIC-verified',...headers}}));
  return {d,rows,calls,ports,request,setSubject:(v:string)=>{subject=v;},setTime:(v:number)=>{clock=v;},setChanged:()=>{changed=true;}};
}
Deno.test('review descriptor requires explicit current scope purpose fields years and no publication flags',async()=>{
  const d=await descriptor();await validateCurrentReviewDescriptor(d,'local_verification',NOW);
  const cases:[string,Row[string]][]=[['purpose','official_history_display'],['scope','selected_records'],['source_view','jungsi_data_ingest.admission_results_curated_v21_1'],
      ['engine_approved',true],['general_publication_allowed',true],['production_allowed',true],['nationwide_collection_complete',true],['allowed_years',[2027]]];
  for(const [field,value]of cases) {
    const x=copy(d);x[field]=value;await rejects(()=>validateCurrentReviewDescriptor(x,'local_verification',NOW),'current_review_scope_unverified');
  }
});
Deno.test('review approval preserves exact UTC issue expiry and maximum twenty four hours',async()=>{
  for(const mode of ['expired','future','over24h','revoked','subjects','operation']) {
    const d=await descriptor();if(mode==='expired')d.approval.expires_at='2026-10-09T00:00:00Z';if(mode==='future')d.approval.issued_at='2026-10-09T00:00:01Z';
    if(mode==='over24h')d.approval.expires_at='2026-10-10T00:00:00.000001Z';if(mode==='revoked')d.approval.revoked=true;
    if(mode==='subjects')d.approval.review_subjects=[SUBJECT,SUBJECT];if(mode==='operation')d.approval.operations=['history.search'];
    await rejects(()=>validateCurrentReviewDescriptor(d,'local_verification',NOW),'current_review_scope_unverified');
  }
  const d=await descriptor();d.approval.expires_at='2026-10-10T00:00:00+00:00';await validateCurrentReviewDescriptor(d,'local_verification',NOW);
});
Deno.test('review descriptor pins source schema projection and qualified command without native32 alias',async()=>{
  const d=await descriptor();for(const mode of ['definition','projection','wire','state','extra']) {
    const x=copy(d);if(mode==='definition')x.source_definition.sha256='f'.repeat(64);if(mode==='projection')x.projection.sha256='f'.repeat(64);
    if(mode==='wire')x.projection.wire_recipe='native32';if(mode==='state')x.qualified_state.definition_sha256='f'.repeat(64);if(mode==='extra')x.extra='SYNTHETIC-private';
    await rejects(()=>validateCurrentReviewDescriptor(x,'local_verification',NOW),'current_review_scope_unverified');
  }
});
Deno.test('review query accepts only declared normalized fields bounded year and keyset cursor',async()=>{
  const q=query('?university_q=%20SYNTHETIC%20&track=ABC&group=%EA%B0%80&metric_kind=XYZ&cohort=ABC&limit=100&academic_year=2027');
  equal(q.university_q,'synthetic');equal(q.track,'abc');equal(q.limit,100);equal(q.academic_year,2027);
  for(const [q,code]of [['?region=SEOUL','invalid_query'],['?limit=1&limit=2','duplicate_query_field'],['?limit=101','invalid_limit'],['?academic_year=2028','invalid_year'],['?cohort=%00','invalid_query']])await rejects(()=>query(q),code);
});
Deno.test('review JSONB wire validator retains large and fractional lexemes and rejects duplicate malformed JSON',async()=>{
  for(const v of ['{"large":9007199254740993,"tiny":0.100000000000000000000001}','{"nested":[1e400,null,true]}'])validateCurrentWireJsonText(v);
  for(const v of ['{"a":1,"a":2}','{"a":NaN}','[1,]','{"a":1}trailing','{"a":"bad\nstring"}'])await rejects(()=>validateCurrentWireJsonText(v),'current_review_scope_unverified');
  const a={numeric:'77.2500',jsonb:'{"decimal":0.100000000000000000001}'};assert(currentReviewWireJson(a).includes('77.2500'));
  assert(await currentReviewSha256(a)!==await currentReviewSha256({...a,numeric:'77.25'}));
});
Deno.test('review precise scalar validation preserves JSON type decimals exponent large integers null and zero',()=>{
  for(const [literal,type,numeric]of [['0','number','0.000'],['9007199254740993','number','9007199254740993'],['0.1000000000000000000010','number','0.100000000000000000001'],
      ['1e3','number','1000'],['"001.20"','string','1.20']]as const)equal(validateCurrentScalar(literal,type,numeric),{availability:'present',reasons:[]});
  equal(validateCurrentScalar('null','null',null),{availability:'actual_null',reasons:[]});equal(validateCurrentScalar(null,null,null),{availability:'missing',reasons:['value_missing']});
  equal(validateCurrentScalar('0.100000000000000000001','number','0.1').availability,'held');equal(validateCurrentScalar('{}','object',null).availability,'held');
});
Deno.test('review relay authentication bearer and subject occur before query and any data call',async()=>{
  for(const [headers,expected,calls]of [[{'X-Jungsi-Relay-Token':''},403,[]],[{Authorization:''},401,[]],[{Authorization:'Bearer SYNTHETIC-invalid'},401,['verify']]]as const) {
    const f=await fixture(),r=await f.request('',headers);equal(r.status,expected);equal(f.calls,calls);
  }
  const f=await fixture();f.setSubject(OTHER);equal((await f.request()).status,403);equal(f.calls,['verify','descriptor']);
});
Deno.test('review unknown write paid and C routes do not grant access or enter a data query',async()=>{
  for(const [method,route]of [['POST',CURRENT_REVIEW_ROUTE],['GET','/api/v1/me'],['GET','/api/v1/offerings/search'],['GET','/api/v1/admission-history']]) {
    const f=await fixture();equal((await f.request('',{},method,route)).status,503);equal(f.calls,[]);
  }
});
Deno.test('review response is recursive closed no-store and hides all original IDs paths fingerprints and raw PK',async()=>{
  const f=await fixture(),r=await f.request('?limit=1'),body=await r.json(),text=JSON.stringify(body);
  equal(r.status,200);equal(f.calls,['verify','descriptor','search']);equal(Object.keys(body.items[0]).sort(),[...CURRENT_REVIEW_FIELDS].sort());
  assert(r.headers.get('cache-control')?.includes('no-store'));equal(body.items[0].official_metadata,{metric_definition:null,unit:null,original_scale:null,source_url:null,source_as_of:null,publication_status:null});
  equal(body.items[0].review_status,'review_only');equal(body.publication_status,'not_published');equal(body.items[0].metric_value_literal,'0.1000000000000000000010');
  for(const secret of ['SYNTHETIC-canonical','SYNTHETIC-original','SYNTHETIC-private','SYNTHETIC-qualified-command','row_fingerprint','source_all29_sha256','source_path'])assert(!text.includes(secret));
  equal(body.matching_observation_count,2);equal(body.matching_source_school_count,1);
});
Deno.test('review held nested value is not returned while explicit type missing null and reasons remain',async()=>{
  const f=await fixture();Object.assign(f.rows[0].current,{metric_value_literal:'{"secret":"SYNTHETIC-sensitive"}',metric_value_json_type:'object',metric_value_numeric:null});
  const body=await(await f.request('?limit=1')).json();equal(body.items[0].value_availability,'held');equal(body.items[0].metric_value_literal,null);
  equal(body.items[0].metric_value_json_type,'object');assert(!JSON.stringify(body).includes('SYNTHETIC-sensitive'));assert(body.items[0].hold_reasons.includes('value_type_unqualified'));
});
Deno.test('review link scopes preserve duplicate multiset and forward references never create another admission year',async()=>{
  const f=await fixture();const second=copy(f.rows[0].population[0]);second.reference_offering_pk='SYNTHETIC-private-other-PK';f.rows[0].population.push(second);
  const body=await(await f.request('?limit=1')).json();equal(body.items[0].link_scopes.length,2);equal(body.items[0].link_scopes[0],body.items[0].link_scopes[1]);
  equal(body.items[0].academic_year,2026);equal(body.items[0].link_scopes[0].population_reference_year,2027);assert(body.items[0].hold_reasons.includes('aggregate_or_forward_reference'));
});
Deno.test('review membership count representative source composite and fingerprint must agree exactly',async()=>{
  for(const mode of ['missing','count','two_representatives','composite','fingerprint','duplicate']) {
    const f=await fixture(),row=f.rows[0];if(mode==='missing')row.members=[];if(mode==='count')row.current.source_member_count=2;
    if(mode==='two_representatives'){const x=copy(row.members[0]);x.result_id='SYNTHETIC-other';row.members.push(x);row.current.source_member_count=2;}
    if(mode==='composite')row.members[0].release_id='SYNTHETIC-other';if(mode==='fingerprint')row.members[0].row_fingerprint='f'.repeat(64);
    if(mode==='duplicate'){row.members.push(copy(row.members[0]));row.current.source_member_count=2;}
    equal((await f.request('?limit=1')).status,503);
  }
});
Deno.test('review snapshot unknown first request is503 while changed next cursor is409 with no fallback',async()=>{
  const f=await fixture(),first=await(await f.request('?limit=1')).json();f.setChanged();
  const fresh=await f.request('?limit=1'),next=await f.request('?limit=1&cursor='+first.next_cursor);equal(fresh.status,503);equal((await fresh.json()).error.code,'current_review_state_unapproved');
  equal(next.status,409);equal((await next.json()).error.code,'cursor_version_mismatch');
});
Deno.test('review cursor binds exact source query subject and resumes canonical keyset without gap',async()=>{
  const f=await fixture(),first=await(await f.request('?limit=1')).json(),second=await(await f.request('?limit=1&cursor='+first.next_cursor)).json();
  equal(second.items.length,1);equal(second.next_cursor,null);equal(second.matching_observation_count,2);
  equal((await f.request('?limit=1&cohort=changed&cursor='+first.next_cursor)).status,409);
  equal((await f.request('?limit=1&cursor='+first.items[0].observation_token)).status,400);
});
Deno.test('review approval expiring during data call fails closed at response instead of returning rows',async()=>{
  const f=await fixture(),original=f.ports.search;f.ports.search=async(...args)=>{const result=await original(...args);f.setTime(NOW+3600000);return result;};
  equal((await f.request()).status,503);
});
Deno.test('review rejects bad count page limits order keys and private wire extras rather than inventing ready data',async()=>{
  const d=await descriptor(),q=query('?limit=1'),b=await currentReviewBinding(d,q,SUBJECT,NOW+7200000);
  for(const mode of ['count','largecount','overfetch','unordered','extra','duplicate']) {
    const p=raw([observation(1),observation(2)]);if(mode==='count')p.matchingObservationCount='1';if(mode==='largecount')p.matchingObservationCount='9007199254740993';
    if(mode==='overfetch')p.rows.push(observation(3));if(mode==='unordered')p.rows.reverse();if(mode==='extra')p.rows[0].current.extra='SYNTHETIC-private';if(mode==='duplicate')p.rows[1]=copy(p.rows[0]);
    await rejects(()=>closeCurrentReviewPage(p,d,q,b,null,SECRET),'current_review_scope_unverified');
  }
});
async function sqlFixture() {
  const d=await descriptor(),calls:{sql:string;parameters:unknown[]}[]=[],commands:string[]=[];
  const role:Row={current_user:'jungsi_backend_app',rolsuper:false,rolbypassrls:false,row_security:'on',read_only:'on',owner_member:false,owner_usage:false,postgres_member:false};
  const metadata:Row[]=(d.source_definition.metadata as Row[]).map(m=>({...m,rls:m.kind==='r',force:m.kind==='r',owner:false,readable:true,writable:false,anon_read:false,authenticated_read:false,
    definition:m.kind==='v'?'SYNTHETIC definition '+m.relation:null}));
  const data={command_id:d.qualified_state.command_id,payload_sha256:d.qualified_state.payload_sha256,observation_count:'2',school_count:'1',as_of:'2026-10-09T00:00:00Z',observations:[observation(1),observation(2)]};
  const tx={async unsafe(sql:string,parameters:unknown[]=[]){calls.push({sql,parameters});if(sql.startsWith('SET LOCAL'))return [];
    if(sql.includes('SELECT current_user'))return [role];if(sql===CURRENT_REVIEW_METADATA_SQL)return metadata;if(sql===CURRENT_REVIEW_PAYLOAD_SQL)return [data];throw new Error('synthetic unexpected SQL');}};
  let options:unknown;
  const factory=(_url:string,o:unknown)=>{options=o;return {async begin(mode:string,work:(t:typeof tx)=>Promise<unknown>){commands.push(mode);return await work(tx);}};};
  const settings={databaseUrl:'postgresql://SYNTHETIC-only',databaseCa:'-----BEGIN CERTIFICATE-----\nSYNTHETIC\n-----END CERTIFICATE-----',supabaseUrl:'https://example.org',publishableKey:'SYNTHETIC-public',storageSecret:'SYNTHETIC-private',descriptorBucket:'SYNTHETIC-private-bucket',descriptorPath:'SYNTHETIC-review.json',descriptorSha256:'a'.repeat(64),descriptorBytes:100};
  const ports=createCurrentReviewInfrastructure(settings,{sqlFactory:factory as unknown as NonNullable<Parameters<typeof createCurrentReviewInfrastructure>[1]>['sqlFactory'],environment:'local_verification',now:()=>NOW});
  return {d,calls,commands,role,metadata,data,ports,options:()=>options};
}
Deno.test('review SQL port uses one bounded payload statement and same-snapshot exact counts with scalar parameters',async()=>{
  const f=await sqlFixture(),q=query('?limit=1');await f.ports.search(f.d,q,null);
  equal(f.commands,['isolation level repeatable read read only']);equal(f.calls.filter(c=>c.sql===CURRENT_REVIEW_PAYLOAD_SQL).length,1);equal(f.calls.filter(c=>c.sql===CURRENT_REVIEW_METADATA_SQL).length,1);
  const params=f.calls.find(c=>c.sql===CURRENT_REVIEW_PAYLOAD_SQL)!.parameters;equal(params.length,13);equal(params[0],'[2024,2025,2026,2027]');equal(params[10],2);assert(params.every(p=>p===null||['number','string'].includes(typeof p)));
  const opts=f.options() as {ssl:{rejectUnauthorized:boolean};fetch_types:boolean};equal(opts.ssl.rejectUnauthorized,true);equal(opts.fetch_types,false);
  assert(CURRENT_REVIEW_PAYLOAD_SQL.includes('count(DISTINCT (school_id,university_code))'));assert(CURRENT_REVIEW_PAYLOAD_SQL.includes('CROSS JOIN qualified'));assert(!CURRENT_REVIEW_PAYLOAD_SQL.includes('curated_v21_1'));
  assert(CURRENT_REVIEW_PAYLOAD_SQL.includes('jsonb_agg(')&&!CURRENT_REVIEW_PAYLOAD_SQL.includes('jsonb_agg(DISTINCT'));assert(CURRENT_REVIEW_PAYLOAD_SQL.includes('$1::text::jsonb'));
});
Deno.test('review SQL bounds all three payload expansions to page keys before provenance aggregation',()=>{
  const sql=CURRENT_REVIEW_PAYLOAD_SQL;
  const current=sql.slice(sql.indexOf('page_current AS MATERIALIZED ('),sql.indexOf('), members AS ('));
  const members=sql.slice(sql.indexOf('members AS ('),sql.indexOf('), population AS ('));
  const population=sql.slice(sql.indexOf('population AS ('),sql.indexOf('), payload AS ('));
  for(const [part,key]of [[current,'v.canonical_result_id'],[members,'m.canonical_result_id'],[population,'l.result_id']]) {
    assert(part.includes('WHERE '+key+'=ANY(ARRAY(SELECT k.canonical_result_id FROM page_keys k))'));
    assert(part.includes('FROM page_keys p JOIN '));
  }
  assert(sql.includes("($3::text='' OR strpos(")&&sql.includes("($4::text='' OR strpos("));
  assert(sql.includes('count(DISTINCT (school_id,university_code))::text'));
  assert(sql.includes('FROM filtered f')&&sql.includes('LIMIT $11::integer'));
  assert(!population.includes('DISTINCT')&&!members.includes('DISTINCT'));
});
Deno.test('review SQL port rejects raw privileged role nullable RLS owner type view options and definition drift',async()=>{
  for(const mode of ['role','RLS','owner','public','type','options','definition']) {
    const f=await sqlFixture();if(mode==='role')f.role.rolbypassrls=true;if(mode==='RLS')f.metadata.find(m=>m.kind==='r')!.force=false;
    if(mode==='owner')f.metadata[0].owner=true;if(mode==='public')f.metadata[0].authenticated_read=true;if(mode==='type')f.metadata[0].columns=[];
    if(mode==='options')f.metadata[0].reloptions=null;if(mode==='definition')f.metadata[0].definition='SYNTHETIC altered view';
    let rejected=false;try{await f.ports.search(f.d,query(),null);}catch(e){assert(e instanceof DisplayError);rejected=true;}assert(rejected);equal(f.calls.filter(c=>c.sql===CURRENT_REVIEW_PAYLOAD_SQL).length,0);
  }
});
Deno.test('review SQL adapter also validates direct query bounds and encrypted key namespace before any DB call',async()=>{
  const f=await sqlFixture();await rejects(()=>f.ports.search(f.d,{...query(),limit:1000},null),'current_review_scope_unverified');equal(f.calls.length,0);
  await rejects(()=>f.ports.search(f.d,query(),[2026,'SYNTHETIC-U','SYNTHETIC-O','','SYNTHETIC-canonical']),'invalid_cursor');equal(f.calls.length,0);
});
Deno.test('review SQL adapter transports latest state rejection as safe dedicated failure without data fallback',async()=>{
  const f=await sqlFixture();f.data.command_id='SYNTHETIC-unknown';await rejects(()=>f.ports.search(f.d,query(),null),'current_review_state_unapproved');
  equal(f.calls.filter(c=>c.sql===CURRENT_REVIEW_PAYLOAD_SQL).length,1);
});
Deno.test('review page opaque namespace is distinct from public IDs and the frozen C cursor',()=>{
  const key=currentReviewKey(observation(1).current);equal(key,[2026,'CURRENT_REVIEW','CANONICAL_OBSERVATIONS','','SYNTHETIC-canonical-1']);
  equal(POPULATION_WIRE_FIELDS.length,7);equal(CURRENT_WIRE_FIELDS.length,35);equal(MEMBER_WIRE_FIELDS.length,32);
});
