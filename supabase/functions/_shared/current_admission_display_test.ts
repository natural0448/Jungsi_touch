/** Synthetic current-review application boundary only; no settings, DB, network or live approval. */
import { DisplayError, HISTORY_FIELDS, OFFERING_FIELDS, sameJson } from './official_history_display.ts';
import type { Row } from './official_history_display.ts';
import { closeCurrentPage, compareCurrentKeys, currentQuerySha256, EncryptedCurrentCursor, parseCurrentSearch, validateCurrentKey } from './current_admission_display.ts';
import type { CurrentKey, CurrentPageBinding, CurrentPortPage, CurrentProjectedRow, CurrentSearchQuery } from './current_admission_display.ts';
const SUBJECT='00000000-0000-0000-0000-000000000001',OTHER='00000000-0000-0000-0000-000000000002';
const NOW=Date.parse('2026-10-09T00:00:00Z'),STAMP='2026-10-09T00:00:00.123456+00:00';
const assert=(value:unknown,message='synthetic current assertion failed')=>{if(!value)throw new Error(message);};
const equal=(a:unknown,b:unknown)=>assert(sameJson(a,b),'synthetic typed equality failed');
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
async function rejects(action:()=>unknown|Promise<unknown>,code:string,status?:number) {
  try { await action(); } catch(error) {
    if(!(error instanceof DisplayError))throw new Error('exception must be a safe DisplayError');
    equal(error.code,code);if(status!==undefined)equal(error.status,status);return;
  }
  throw new Error('synthetic expected rejection missing');
}
const search=(query='')=>parseCurrentSearch(new URL('https://example.org/synthetic'+query));
const cipher=()=>new EncryptedCurrentCursor(new Uint8Array(32).fill(7));
async function binding(query:CurrentSearchQuery,extra:Partial<CurrentPageBinding>={}):Promise<CurrentPageBinding> {
  return {subjectId:SUBJECT,sourceVersion:'SYNTHETIC-current-v1',sourceStateSha256:'a'.repeat(64),projectionSha256:'b'.repeat(64),
    operation:'history.search',querySha256:await currentQuerySha256(query),expiresAtMs:NOW+3600000,...extra};
}
function projected(i:number,value:Row['value']=i):CurrentProjectedRow {
  const publicFields:Row={offering_id:'2026:SYNTHETIC-O',academic_year:2026,university_id:'SYNTHETIC-U',university_name:'SYNTHETIC University',
    campus:'SYNTHETIC Campus',department:'SYNTHETIC Department',track:'SYNTHETIC Track',group:'가',region:'SYNTHETIC Region',wildcard_group:null,
    metric_name:'SYNTHETIC metric',metric_definition:'SYNTHETIC official metric definition',value,unit:'SYNTHETIC unit',original_scale:'SYNTHETIC scale',
    publication_status:'published',source_url:'https://example.org/synthetic',source_as_of:null};
  return {publicFields,key:[2026,'SYNTHETIC-U','2026:SYNTHETIC-O','SYNTHETIC metric','SYNTHETIC-private-canonical-'+String(i).padStart(4,'0')]};
}
function page(rows:CurrentProjectedRow[],extra:Partial<CurrentPortPage>={}):CurrentPortPage {
  return {sourceVersion:'SYNTHETIC-current-v1',sourceStateSha256:'a'.repeat(64),projectionSha256:'b'.repeat(64),
    rows,matchingOfferingCount:1,matchingSchoolCount:1,...extra};
}
Deno.test('current query preserves existing normalized filters and bounded defaults',()=>{
  equal(search('?university_q=%20SYNTHETIC%20&department_q=ABC&region=ABC&group=%EA%B0%80&academic_year=2024'),
    {university_q:'synthetic',department_q:'abc',region:'abc',group:'가',academic_year:2024,limit:50,cursor:null});
  equal(search('?academic_year=2027&limit=100').academic_year,2027);
});
Deno.test('current query rejects duplicate injected unknown and invalid bounded fields',async()=>{
  for(const [query,code,status]of [['?limit=1&limit=2','duplicate_query_field',422],['?member_tier=paid','invalid_query',400],
      ['?academic_year=2023','invalid_year',400],['?academic_year=2028','invalid_year',400],['?limit=0','invalid_limit',400],
      ['?limit=101','invalid_limit',400],['?limit=1.5','invalid_limit',400],['?cursor=','invalid_cursor',400],
      ['?cursor=a%3D','invalid_cursor',400],['?university_q=%00','invalid_query',400]]as const)
    await rejects(()=>search(query),code,status);
});
Deno.test('current query rejects oversized filters and cursor while hash ignores page size',async()=>{
  await rejects(()=>search('?department_q='+'a'.repeat(101)),'invalid_query',400);
  await rejects(()=>search('?cursor='+'a'.repeat(4097)),'invalid_cursor',400);
  equal(await currentQuerySha256(search('?limit=1')),await currentQuerySha256(search('?limit=100&cursor=synthetic')));
  assert(await currentQuerySha256(search('?academic_year=2024'))!==await currentQuerySha256(search('?academic_year=2025')));
});
Deno.test('current application port refuses malformed direct query instead of trusting TypeScript',async()=>{
  const q=search();for(const key of ['limit','region','academic_year']) {
    const changed=copy(q);(changed as unknown as Record<string,unknown>)[key]=key==='limit'?0:key==='region'?'SYNTHETIC':2030;
    await rejects(()=>currentQuerySha256(changed),'official_history_scope_unverified',503);
  }
});
Deno.test('current key order uses UTF8 C collation and requires canonical tie breaker',async()=>{
  const a:CurrentKey=[2026,'SYNTHETIC-\uE000','SYNTHETIC-O','','SYNTHETIC-C'],b:CurrentKey=[2026,'SYNTHETIC-\u{10000}','SYNTHETIC-O','','SYNTHETIC-C'];
  assert(compareCurrentKeys(a,b)<0);assert(compareCurrentKeys([2025,...a.slice(1)] as CurrentKey,b)<0);
  equal(validateCurrentKey(a),a);await rejects(()=>validateCurrentKey([2026,'SYNTHETIC-U','SYNTHETIC-O','',null]),'official_history_scope_unverified',503);
});
Deno.test('AES current cursor hides private canonical IDs and returns their exact key only server-side',async()=>{
  const q=search(),b=await binding(q),c=cipher(),key=projected(1).key,t1=await c.seal(b,key),t2=await c.seal(b,key);
  equal(await c.open(t1,b,NOW),key);assert(t1!==t2);
  const bytes=Uint8Array.from(atob(t1.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
  assert(!new TextDecoder().decode(bytes).includes('SYNTHETIC-private-canonical'));assert(!t1.includes(SUBJECT));
});
Deno.test('AES current cursor rejects tampering wrong key subject and exact expiration',async()=>{
  const q=search(),b=await binding(q),c=cipher(),token=await c.seal(b,projected(1).key);
  await rejects(()=>c.open((token[0]==='A'?'B':'A')+token.slice(1),b,NOW),'invalid_cursor',400);
  await rejects(()=>new EncryptedCurrentCursor(new Uint8Array(32).fill(8)).open(token,b,NOW),'invalid_cursor',400);
  await rejects(()=>c.open(token,{...b,subjectId:OTHER},NOW),'invalid_cursor',400);
  equal(await c.open(token,b,b.expiresAtMs-1),projected(1).key);
  await rejects(()=>c.open(token,b,b.expiresAtMs),'invalid_cursor',400);
});
Deno.test('AES current cursor binds query source version state projection operation and expiry',async()=>{
  const q=search(),b=await binding(q),c=cipher(),token=await c.seal(b,projected(1).key);
  for(const [key,value]of [['querySha256','c'.repeat(64)],['sourceVersion','SYNTHETIC-current-v2'],['sourceStateSha256','c'.repeat(64)],
      ['projectionSha256','c'.repeat(64)],['operation','offerings.search'],['expiresAtMs',b.expiresAtMs+1]]as const)
    await rejects(()=>c.open(token,{...b,[key]:value},NOW),'cursor_version_mismatch',409);
});
Deno.test('AES current cursor rejects malformed token binding and incorrect key length',async()=>{
  const q=search(),b=await binding(q),c=cipher();
  for(const token of ['a','AAAA','a='.repeat(10),'A'.repeat(4097)])await rejects(()=>c.open(token,b,NOW),'invalid_cursor',400);
  await rejects(()=>new EncryptedCurrentCursor(new Uint8Array(31)),'security_policy_unavailable',503);
  await rejects(()=>c.seal({...b,subjectId:'SYNTHETIC-not-UUID'},projected(1).key),'official_history_scope_unverified',503);
});
Deno.test('current bounded page returns closed existing DTO exact counts and canonical UTC',async()=>{
  const q=search('?limit=2'),b=await binding(q),rows=[projected(1,'77.25'),projected(2,0),projected(3,null)];
  rows[0].publicFields.private_metadata={path:'SYNTHETIC-private-path'};
  const result=await closeCurrentPage(page(rows,{matchingOfferingCount:40,matchingSchoolCount:20}),b,q,null,cipher(),STAMP);
  equal(Object.keys(result).sort(),['status','reason_code','items','matching_offering_count','matching_school_count','catalog_version','as_of','next_cursor'].sort());
  equal((result.items as Row[]).map(r=>r.value),['77.25',0]);equal(Object.keys((result.items as Row[])[0]).sort(),[...HISTORY_FIELDS].sort());
  equal(result.matching_offering_count,40);equal(result.matching_school_count,20);equal(result.as_of,'2026-10-09T00:00:00.123456Z');
  assert(!JSON.stringify(result).includes('SYNTHETIC-private-path'));assert(!JSON.stringify(result).includes('SYNTHETIC-private-canonical'));
});
Deno.test('current keyset uses the last returned key and resumes without gap or repeat',async()=>{
  const q=search('?limit=2'),b=await binding(q),c=cipher(),first=await closeCurrentPage(page([projected(1),projected(2),projected(3)]),b,q,null,c,STAMP);
  const after=await c.open(first.next_cursor as string,b,NOW);equal(after,projected(2).key);
  const second=await closeCurrentPage(page([projected(3,null)]),b,q,after,c,STAMP);equal((second.items as Row[]).map(r=>r.value),[null]);equal(second.next_cursor,null);
});
Deno.test('current bounded page rejects overfetch unordered duplicate and before-cursor records',async()=>{
  const q=search('?limit=2'),b=await binding(q),c=cipher();
  for(const rows of [[projected(1),projected(2),projected(3),projected(4)],[projected(2),projected(1)],
      [projected(1),projected(1)]])await rejects(()=>closeCurrentPage(page(rows),b,q,null,c,STAMP),'official_history_scope_unverified',503);
  await rejects(()=>closeCurrentPage(page([projected(2)]),b,q,projected(2).key,c,STAMP),'official_history_scope_unverified',503);
});
Deno.test('current bounded page rejects stale port binding and changed request query',async()=>{
  const q=search(),b=await binding(q),c=cipher();
  for(const [key,value]of [['sourceVersion','SYNTHETIC-current-v2'],['sourceStateSha256','c'.repeat(64)],['projectionSha256','c'.repeat(64)]]as const)
    await rejects(()=>closeCurrentPage(page([projected(1)],{[key]:value}),b,q,null,c,STAMP),'official_history_scope_unverified',503);
  await rejects(()=>closeCurrentPage(page([projected(1)]),b,search('?department_q=changed'),null,c,STAMP),'official_history_scope_unverified',503);
});
Deno.test('current counts cannot be missing fractional smaller than page or page-count substitute',async()=>{
  const q=search(),b=await binding(q),c=cipher();
  for(const extra of [{matchingOfferingCount:undefined},{matchingSchoolCount:null},{matchingSchoolCount:0},{matchingOfferingCount:0},
      {matchingOfferingCount:1.5},{matchingOfferingCount:1,matchingSchoolCount:2}])
    await rejects(()=>closeCurrentPage(page([projected(1)],extra as Partial<CurrentPortPage>),b,q,null,c,STAMP),'official_history_scope_unverified',503);
  const empty=await closeCurrentPage(page([],{matchingOfferingCount:0,matchingSchoolCount:0}),b,q,null,c,STAMP);
  equal(empty.items,[]);equal(empty.matching_offering_count,0);equal(empty.next_cursor,null);
});
Deno.test('current bounded page rejects wrong public key identity or row outside year/filter',async()=>{
  for(const suffix of ['?academic_year=2024','?university_q=missing','?department_q=missing','?region=missing','?group=missing']) {
    const q=search(suffix),b=await binding(q);await rejects(()=>closeCurrentPage(page([projected(1)]),b,q,null,cipher(),STAMP),'official_history_scope_unverified',503);
  }
  const q=search(),b=await binding(q),row=projected(1);row.publicFields.offering_id='SYNTHETIC-wrong';
  await rejects(()=>closeCurrentPage(page([row]),b,q,null,cipher(),STAMP),'official_history_scope_unverified',503);
});
Deno.test('current scalar values preserve null zero literal decimal and reject unsafe numeric coercion',async()=>{
  const q=search(),b=await binding(q);
  for(const value of [null,0,'77.2500','9007199254740993'])equal((await closeCurrentPage(page([projected(1,value)]),b,q,null,cipher(),STAMP)).items,[projected(1,value).publicFields]);
  for(const value of [0.1,Number.MAX_SAFE_INTEGER+1,true,{secret:'SYNTHETIC-private'},['SYNTHETIC-private']])
    await rejects(()=>closeCurrentPage(page([projected(1,value as Row['value'])]),b,q,null,cipher(),STAMP),'official_history_scope_unverified',503);
});
Deno.test('current public projection refuses nested missing signed source or invalid date metadata',async()=>{
  const q=search(),b=await binding(q);
  for(const [key,value]of [['department',{private:'SYNTHETIC-path'}],['source_url','not a URL'],['source_url','https://example.org/?X-Amz-Signature=SYNTHETIC'],
      ['source_url','https://user:pass@example.org/'],['source_as_of','2026-02-30'],['source_as_of','9999-99-99']]as const) {
    const row=projected(1);row.publicFields[key]=value;
    await rejects(()=>closeCurrentPage(page([row]),b,q,null,cipher(),STAMP),'official_history_scope_unverified',503);
  }
  const row=projected(1);delete row.publicFields.metric_definition;
  await rejects(()=>closeCurrentPage(page([row]),b,q,null,cipher(),STAMP),'official_history_scope_unverified',503);
  await rejects(()=>closeCurrentPage(page([projected(1)]),b,q,null,cipher(),'not a timestamp'),'official_history_scope_unverified',503);
});
Deno.test('current offering page uses the same existing offering DTO and keyset with no history fields',async()=>{
  const q=search(),b=await binding(q,{operation:'offerings.search'}),row=projected(1);row.key[3]='';
  const result=await closeCurrentPage(page([row]),b,q,null,cipher(),STAMP);
  equal(Object.keys((result.items as Row[])[0]).sort(),[...OFFERING_FIELDS].sort());assert(!JSON.stringify(result).includes('metric_name'));
});
Deno.test('current official URL allows ordinary menuKey while rejecting actual credential parameters',async()=>{
  const q=search(),b=await binding(q),row=projected(1);row.publicFields.source_url='https://example.org/synthetic?menuKey=public';
  equal(((await closeCurrentPage(page([row]),b,q,null,cipher(),STAMP)).items as Row[])[0].source_url,row.publicFields.source_url);
  for(const key of ['access_token','ApiKey','x-amz-credential','x-goog-signature','authorization','sig']) {
    const changed=copy(row);changed.publicFields.source_url='https://example.org/synthetic?'+key+'=SYNTHETIC';
    await rejects(()=>closeCurrentPage(page([changed]),b,q,null,cipher(),STAMP),'official_history_scope_unverified',503);
  }
});
