/** Current-review application ports and bounded page/cursor utilities.
 * No live factory/approval/SQL composition: private projection/state adoption remains separate.
 * The frozen official-history C handler and its settings/cursor are unchanged.
 */
import { DisplayError, HISTORY_FIELDS, OFFERING_FIELDS, parseStrictJson, utcText } from './official_history_display.ts';
import type { Json, Row } from './official_history_display.ts';

export const CURRENT_REVIEW_VIEW = 'jungsi_data_ingest.admission_results_current';
export const CURRENT_REVIEW_YEARS = [2024, 2025, 2026, 2027] as const;
export type CurrentSearchOperation = 'history.search' | 'offerings.search' | 'current.review.search';
export type CurrentKey = [number, string, string, string, string];
export interface CurrentSearchQuery {
  university_q: string; department_q: string; region: string; group: string;
  academic_year: number | null; limit: number; cursor: string | null;
}
export interface CurrentPageBinding {
  subjectId: string; sourceVersion: string; sourceStateSha256: string;
  projectionSha256: string; operation: CurrentSearchOperation; querySha256: string;
  expiresAtMs: number;
}
export interface CurrentProjectedRow { publicFields: Row; key: CurrentKey }
export interface CurrentPortPage {
  sourceVersion: string; sourceStateSha256: string; projectionSha256: string;
  rows: CurrentProjectedRow[]; matchingOfferingCount: number; matchingSchoolCount: number;
}
/** Data implementations must use one fixed-view bounded data statement per invocation.
 * Exact aggregate counts and the limit+1 page share that READ ONLY snapshot.
 * Source membership must be aggregated before the page: never one query per observation.
 */
export interface CurrentAdmissionSearchPort {
  searchHistory(binding: CurrentPageBinding, query: CurrentSearchQuery, after: CurrentKey | null): Promise<CurrentPortPage>;
  searchOfferings(binding: CurrentPageBinding, query: CurrentSearchQuery, after: CurrentKey | null): Promise<CurrentPortPage>;
}
const scopeFailure = () => new DisplayError('official_history_scope_unverified');
const fields = ['university_q','department_q','region','group','academic_year','limit','cursor'];
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const text = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const record = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Row, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v,k));
const jsonText = (v: Json) => JSON.stringify(v);
const encode = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function decode(v: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(v) || v.length % 4 === 1) throw new Error('invalid encoding');
  const bytes=Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  if(encode(bytes)!==v)throw new Error('noncanonical encoding');
  return bytes;
}
export function parseCurrentSearch(url: URL): CurrentSearchQuery {
  const q: Record<string,string> = Object.create(null);
  for (const [name,value] of url.searchParams) {
    if (!fields.includes(name)) throw new DisplayError('invalid_query',400);
    if (Object.hasOwn(q,name)) throw new DisplayError('duplicate_query_field',422);
    q[name] = value;
  }
  const clean: Record<string,string> = {};
  for (const name of ['university_q','department_q','region','group']) {
    const v = q[name] ?? '';
    if (v.length > 100 || /[\x00-\x1f\x7f]/.test(v)) throw new DisplayError('invalid_query',400);
    clean[name] = v.toLocaleLowerCase('und').trim();
  }
  const year = q.academic_year === undefined ? null : /^[0-9]+$/.test(q.academic_year) ? Number(q.academic_year) : NaN;
  if (year !== null && !CURRENT_REVIEW_YEARS.includes(year as typeof CURRENT_REVIEW_YEARS[number])) throw new DisplayError('invalid_year',400);
  const limit = q.limit === undefined ? 50 : /^[0-9]+$/.test(q.limit) ? Number(q.limit) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new DisplayError('invalid_limit',400);
  const cursor = q.cursor ?? null;
  if (cursor !== null && (!cursor || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor))) throw new DisplayError('invalid_cursor',400);
  return {university_q:clean.university_q,department_q:clean.department_q,region:clean.region,group:clean.group,academic_year:year,limit,cursor};
}
export async function currentQuerySha256(query: CurrentSearchQuery): Promise<string> {
  validateQuery(query);
  const value = [query.university_q,query.department_q,query.region,query.group,query.academic_year];
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(jsonText(value)).buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function validateQuery(query: CurrentSearchQuery) {
  if(!record(query)||!exact(query as unknown as Row,fields)||
     !['university_q','department_q','region','group'].every(k=>{
       const v=query[k as keyof CurrentSearchQuery];return text(v,100)&&v===v.toLocaleLowerCase('und').trim();
     })||query.academic_year!==null&&!CURRENT_REVIEW_YEARS.includes(query.academic_year as typeof CURRENT_REVIEW_YEARS[number])||
     !Number.isSafeInteger(query.limit)||query.limit<1||query.limit>100||
     query.cursor!==null&&(!text(query.cursor,4096)||!query.cursor||!/^[A-Za-z0-9_-]+$/.test(query.cursor)))throw scopeFailure();
}
export function validateCurrentKey(key: unknown): CurrentKey {
  if (!Array.isArray(key) || key.length !== 5 || typeof key[0] !== 'number' || !CURRENT_REVIEW_YEARS.includes(key[0] as typeof CURRENT_REVIEW_YEARS[number]) ||
      !key.slice(1).every(v=>text(v)) || !key[1] || !key[2] || !key[4]) throw scopeFailure();
  return [...key] as CurrentKey;
}
/** Bytewise text order matches explicit PostgreSQL COLLATE "C", including non-BMP text. */
export function compareCurrentKeys(a: CurrentKey,b: CurrentKey): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  const encoder = new TextEncoder();
  for (let i=1;i<5;i++) {
    const left=encoder.encode(a[i] as string),right=encoder.encode(b[i] as string);
    for(let j=0;j<Math.min(left.length,right.length);j++) if(left[j]!==right[j])return left[j]<right[j]?-1:1;
    if(left.length!==right.length)return left.length<right.length?-1:1;
  }
  return 0;
}
function bindingObject(binding: CurrentPageBinding): Row {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(binding.subjectId) || !text(binding.sourceVersion) || !binding.sourceVersion ||
      ![binding.sourceStateSha256,binding.projectionSha256,binding.querySha256].every(hash) ||
      !['history.search','offerings.search','current.review.search'].includes(binding.operation) || !Number.isSafeInteger(binding.expiresAtMs)) throw scopeFailure();
  return {subject:binding.subjectId,version:binding.sourceVersion,state:binding.sourceStateSha256,projection:binding.projectionSha256,
    operation:binding.operation,query:binding.querySha256,expires:binding.expiresAtMs};
}
export type CurrentCursorMismatchReason = 'binding_version_changed'|'binding_projection_changed'|'binding_operation_changed'|'binding_query_changed'|'binding_expiry_changed'|'source_heads_changed'|'source_state_unapproved';
/** Bounded stage/field enum only; never includes cursor, subject, claims or head values. */
export class CurrentCursorVersionError extends DisplayError {
  constructor(readonly reason:CurrentCursorMismatchReason){super('cursor_version_mismatch',409);}
}
export class EncryptedCurrentCursor {
  private readonly key: Promise<CryptoKey>;
  constructor(secret: Uint8Array,private readonly mode:'cursor'|'observation'='cursor') {
    if (!(secret instanceof Uint8Array) || secret.byteLength !== 32 || !['cursor','observation'].includes(mode)) throw new DisplayError('security_policy_unavailable');
    this.key = crypto.subtle.importKey('raw',new Uint8Array(secret).buffer,{name:'AES-GCM'},false,['encrypt','decrypt']);
  }
  async seal(binding: CurrentPageBinding,after: CurrentKey): Promise<string> {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const plaintext=new TextEncoder().encode(jsonText({format:'jungsi.current-review-'+this.mode+'/v1',binding:bindingObject(binding),after:validateCurrentKey(after)}));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(CURRENT_REVIEW_VIEW+'|'+this.mode)},await this.key,plaintext.buffer);
    const body=new Uint8Array(12+encrypted.byteLength);body.set(iv);body.set(new Uint8Array(encrypted),12);
    const token=encode(body);if(token.length>4096)throw scopeFailure();return token;
  }
  /** V2 reviewer cursors retain the prior head while validating every other encrypted
   * binding field. The caller must compare this head with the actual same-snapshot DB head.
   * This method cannot open a public/C cursor or an observation token.
   */
  async openLiveSnapshot(token:string,binding:CurrentPageBinding,now:number):Promise<{after:CurrentKey;sourceStateSha256:string}> {
    try {
      if(this.mode!=='cursor'||binding.operation!=='current.review.search'||!token||token.length>4096||!Number.isSafeInteger(now))throw new Error('invalid cursor');
      const bytes=decode(token);if(bytes.byteLength<29)throw new Error('invalid cursor');
      const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:new TextEncoder().encode(CURRENT_REVIEW_VIEW+'|'+this.mode)},await this.key,bytes.slice(12).buffer);
      const body=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));
      if(!record(body)||!exact(body,['format','binding','after'])||body.format!=='jungsi.current-review-cursor/v1'||!record(body.binding))throw new Error('invalid cursor');
      const expected=bindingObject(binding),actual=body.binding;
      if(!exact(actual,Object.keys(expected))||actual.subject!==expected.subject||typeof actual.expires!=='number'||actual.expires<=now||!hash(actual.state))throw new Error('invalid cursor');
      const mismatch=Object.keys(expected).find(k=>k!=='state'&&actual[k]!==expected[k]);
      if(mismatch){const reasons:Record<string,CurrentCursorMismatchReason>={version:'binding_version_changed',projection:'binding_projection_changed',operation:'binding_operation_changed',query:'binding_query_changed',expires:'binding_expiry_changed'};
        const reason=reasons[mismatch];if(!reason)throw new Error('invalid cursor');throw new CurrentCursorVersionError(reason);} 
      const after=validateCurrentKey(body.after);
      if(after[0]!==2024||after[1]!=='CURRENT_REVIEW_LIVE'||after[2]!=='CANONICAL_OBSERVATIONS'||after[3]!=='')throw new Error('invalid cursor');
      return {after,sourceStateSha256:actual.state};
    } catch(e) {
      if(e instanceof DisplayError&&e.code==='cursor_version_mismatch')throw e;
      throw new DisplayError('invalid_cursor',400);
    }
  }
  async open(token: string,binding: CurrentPageBinding,now: number): Promise<CurrentKey> {
    try {
      if(!token || token.length>4096 || !Number.isSafeInteger(now))throw new Error('invalid cursor');
      const bytes=decode(token);if(bytes.byteLength<29)throw new Error('invalid cursor');
      const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:new TextEncoder().encode(CURRENT_REVIEW_VIEW+'|'+this.mode)},await this.key,bytes.slice(12).buffer);
      const body=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));
      if(!record(body)||!exact(body,['format','binding','after'])||body.format!=='jungsi.current-review-'+this.mode+'/v1'||!record(body.binding))throw new Error('invalid cursor');
      const expected=bindingObject(binding),actual=body.binding;
      if(!exact(actual,Object.keys(expected))||actual.subject!==expected.subject||typeof actual.expires!=='number'||actual.expires<=now)throw new Error('invalid cursor');
      if(Object.keys(expected).some(k=>actual[k]!==expected[k]))throw new DisplayError('cursor_version_mismatch',409);
      return validateCurrentKey(body.after);
    } catch(e) {
      if(e instanceof DisplayError&&e.code==='cursor_version_mismatch')throw e;
      throw new DisplayError('invalid_cursor',400);
    }
  }
}
function closePublic(row: Row,operation: CurrentSearchOperation): Row {
  const allowed=operation==='history.search'?HISTORY_FIELDS:OFFERING_FIELDS;
  if(!record(row)||!allowed.every(k=>Object.hasOwn(row,k)))throw scopeFailure();
  const closed=Object.fromEntries(allowed.map(k=>[k,row[k]])) as Row;
  if(typeof closed.academic_year!=='number'||!CURRENT_REVIEW_YEARS.includes(closed.academic_year as typeof CURRENT_REVIEW_YEARS[number]))throw scopeFailure();
  for(const [k,v] of Object.entries(closed)) {
    if(k==='academic_year')continue;
    if(k==='value') { if(!(v===null||typeof v==='string'||typeof v==='number'&&Number.isSafeInteger(v)))throw scopeFailure(); }
    else if(v!==null&&typeof v!=='string')throw scopeFailure();
  }
  if(operation==='history.search') {
    const source=closed.source_url;
    if(source!==null) {
      try {
        const url=new URL(source as string);
        if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||[...url.searchParams.keys()].some(k=>
          /(?:^|[_-])(?:token|signature|authorization|credential|sig)(?:$|[_-])/i.test(k)||/^(?:api[_-]?key)$/i.test(k)))throw scopeFailure();
      } catch { throw scopeFailure(); }
    }
    const date=closed.source_as_of;
    try { if(date!==null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))throw scopeFailure(); }
    catch { throw scopeFailure(); }
  }
  return closed;
}
/** Assemble only the bounded port page; never fetch/filter a full catalog in memory. */
export async function closeCurrentPage(page: CurrentPortPage,binding: CurrentPageBinding,query: CurrentSearchQuery,
    after: CurrentKey|null,cursor: EncryptedCurrentCursor,asOf: string): Promise<Row> {
  bindingObject(binding);
  if(!['history.search','offerings.search'].includes(binding.operation))throw scopeFailure();
  validateQuery(query);
  if(await currentQuerySha256(query)!==binding.querySha256)throw scopeFailure();
  let stamp:string;
  try { stamp=utcText(asOf); } catch { throw scopeFailure(); }
  if(page.sourceVersion!==binding.sourceVersion||page.sourceStateSha256!==binding.sourceStateSha256||page.projectionSha256!==binding.projectionSha256||
      !Array.isArray(page.rows)||page.rows.length>query.limit+1||![page.matchingOfferingCount,page.matchingSchoolCount].every(v=>Number.isSafeInteger(v)&&v>=0))throw scopeFailure();
  if(page.matchingSchoolCount>page.matchingOfferingCount)throw scopeFailure();
  const seen=new Set<string>();let last=after===null?null:validateCurrentKey(after);const closed:Row[]=[];
  for(const row of page.rows) {
    const key=validateCurrentKey(row.key);
    if(last&&compareCurrentKeys(last,key)>=0||seen.has(key[4]))throw scopeFailure();
    seen.add(key[4]);last=key;
    const item=closePublic(row.publicFields,binding.operation);
    if(item.academic_year!==key[0]||item.university_id!==key[1]||item.offering_id!==key[2]||(binding.operation==='history.search'?String(item.metric_name??''):'')!==key[3])throw scopeFailure();
    if((query.academic_year!==null&&item.academic_year!==query.academic_year)||
       !(String(item.university_name??'')+' '+String(item.campus??'')).toLocaleLowerCase('und').includes(query.university_q)||
       !String(item.department??'').toLocaleLowerCase('und').includes(query.department_q)||
       query.region&&query.region!==String(item.region??'').toLocaleLowerCase('und')||
       query.group&&query.group!==String(item.group??'').toLocaleLowerCase('und'))throw scopeFailure();
    closed.push(item);
  }
  if(new Set(closed.map(r=>r.offering_id)).size>page.matchingOfferingCount||new Set(closed.map(r=>r.university_id)).size>page.matchingSchoolCount)throw scopeFailure();
  const hasMore=page.rows.length>query.limit;
  const next=hasMore?await cursor.seal(binding,page.rows[query.limit-1].key):null;
  return {status:'ready',reason_code:null,items:closed.slice(0,query.limit),matching_offering_count:page.matchingOfferingCount,
    matching_school_count:page.matchingSchoolCount,catalog_version:binding.sourceVersion,as_of:stamp,next_cursor:next};
}
