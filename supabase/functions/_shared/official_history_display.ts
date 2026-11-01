import { admissionMillis } from "./jungsi/application/service_end_admission.ts";
/** Application-owned ports and closed DTO mapping. No SQL, Auth SDK or env imports. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Row = Record<string, Json>;
export interface DisplayDescriptor extends Row {
  format: string; purpose: string; environment: string; source_view: string;
  engine_approved: false; production_allowed: false; nationwide_collection_complete: false;
  approval: Row; catalog: Row; bindings: Row[];
}
export interface VerifiedReviewSession { subjectId: string; expiresAt: number }
export interface OfficialHistoryPorts {
  loadDescriptor(): Promise<DisplayDescriptor>;
  verifySession(token: string, now: number): Promise<VerifiedReviewSession | null>;
  paidUntil(subjectId: string, now: number): Promise<string | null>;
  readRows(descriptor: DisplayDescriptor): Promise<Row[]>;
}
export interface DisplayTransport {
  relayToken: string; environment: 'local_verification' | 'isolated_cloud_review';
  pathPrefix: string; now?: () => number;
}
export class DisplayError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(code); }
}
export const VIEW = 'jungsi_data_ingest.admission_results_curated_v21_1';
export const OPERATIONS = ['history.search', 'offerings.search', 'offering.read', 'recruitment.read', 'session.read'] as const;
export const OFFERING_FIELDS = ['offering_id', 'academic_year', 'university_id', 'university_name', 'campus', 'department', 'track', 'group', 'region', 'wildcard_group'];
export const HISTORY_FIELDS = [...OFFERING_FIELDS, 'metric_name', 'metric_definition', 'value', 'unit', 'original_scale', 'publication_status', 'source_url', 'source_as_of'];
export const DB_FIELDS = ['release_id', 'result_id', 'academic_year', 'school_id', 'university_code', 'university', 'recruit_group', 'recruit_group_raw', 'department', 'track', 'offering_pk', 'anchor_2027_pks', 'metric_kind', 'metric_value_literal', 'metric_value_numeric', 'metric_value_json_type', 'cohort', 'statistic_label', 'active_service', 'source_path', 'source_sha256', 'source_location', 'source_review_status', 'original_record_locator', 'field_presence_types', 'row_fingerprint', 'curation_release_id', 'curation_fields', 'curation_evidence'];
export const GUARD_FIELDS = ['guard_active_curation_release_id','guard_school_source_school_id','guard_school_after_row_fingerprint'];
const SAFE_ERRORS: Record<string, number> = {
  service_ended:403,
  official_history_scope_unverified:503,official_history_db_unavailable:503,official_history_runtime_role_unverified:503,
  review_subject_not_allowed:403,display_operation_not_supported:503,security_policy_unavailable:503,
  relay_authentication_failed:403,authentication_required:401,auth_unavailable:503,entitlement_unavailable:503,
  paid_required:403,backend_dependency_unavailable:503,duplicate_query_field:422,invalid_request:400,
  invalid_query:400,invalid_year:400,invalid_limit:400,invalid_cursor:400,invalid_identifier:400,cursor_version_mismatch:409,offering_not_found:404,
};
const invalid = () => new DisplayError('official_history_scope_unverified');
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const record = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Row, fields: string[]) => Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
const clone = <T extends Json>(v: T): T => JSON.parse(JSON.stringify(v));
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === null || b === null || typeof a !== typeof b) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  if (record(a) && record(b)) return keys(a, Object.keys(b)) && Object.keys(a).every(k => sameJson(a[k], b[k]));
  return a === b;
}
/** Unique keys, finite numbers, bounded depth; no silent duplicate overwrite. */
export function parseStrictJson(text: string): Json {
  let i = 0, nodes = 0;
  const ws = () => { while (i < text.length && /[\x20\t\r\n]/.test(text[i])) i++; };
  function string(): string {
    const start = i++; let escaped = false;
    while (i < text.length) {
      const c = text[i++];
      if (!escaped && c === '"') return JSON.parse(text.slice(start, i));
      if (!escaped && c === '\\') escaped = true; else escaped = false;
    }
    throw invalid();
  }
  function value(depth: number): Json {
    if (++nodes > 150_000 || depth > 64) throw invalid();
    ws(); const c = text[i];
    if (c === '"') return string();
    if (c === '{') {
      i++; ws(); const out: Row = Object.create(null);
      if (text[i] === '}') { i++; return out; }
      while (true) {
        ws(); if (text[i] !== '"') throw invalid(); const key = string();
        if (Object.hasOwn(out, key)) throw invalid(); ws(); if (text[i++] !== ':') throw invalid();
        out[key] = value(depth + 1); ws(); const next = text[i++];
        if (next === '}') return out; if (next !== ',') throw invalid();
      }
    }
    if (c === '[') {
      i++; ws(); const out: Json[] = []; if (text[i] === ']') { i++; return out; }
      while (true) { out.push(value(depth + 1)); ws(); const next = text[i++]; if (next === ']') return out; if (next !== ',') throw invalid(); }
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(token, i)) { i += token.length; return result; }
    }
    const token = text.slice(i).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!token) throw invalid(); i += token[0].length; const n = Number(token[0]);
    if (!Number.isFinite(n) || (!/[.eE]/.test(token[0]) && !Number.isSafeInteger(n))) throw invalid();
    return n;
  }
  try { const result = value(0); ws(); if (i !== text.length) throw invalid(); return result; }
  catch { throw invalid(); }
}
export function canonicalDecimal(value: Json): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[+-]?(?:[0-9]+)(?:\.[0-9]+)?$/.test(value)) throw invalid();
  const negative = value.startsWith('-'); const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const integer = whole.replace(/^0+(?=[0-9])/, ''), tail = fraction.replace(/0+$/, '');
  const magnitude = integer + (tail ? '.' + tail : '');
  return (negative && magnitude !== '0' ? '-' : '') + magnitude;
}
export function utcInstantMicros(value: Json | undefined): bigint {
  if (typeof value !== 'string') throw invalid();
  const match = value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|\+00:00)$/);
  if (!match) throw invalid();
  const n = Date.parse(value.slice(0, 19) + 'Z'); if (!Number.isFinite(n)) throw invalid();
  if (new Date(n).toISOString().slice(0, 19) !== value.slice(0, 19)) throw invalid();
  return BigInt(n) * 1000n + BigInt((match[1] ?? '').padEnd(6, '0'));
}
export function nowMicros(value: number): bigint {
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.trunc(value * 1000))) throw invalid();
  return BigInt(Math.trunc(value * 1000));
}
export function utcText(value: string): string {
  utcInstantMicros(value); const fraction = value.match(/\.(\d+)(?:Z|\+00:00)$/)?.[1] ?? '';
  return value.slice(0, 19) + (/[1-9]/.test(fraction) ? '.' + fraction.padEnd(6, '0') : '') + 'Z';
}
function publicSource(value: Json) {
  if (value === null) return;
  if (typeof value !== 'string') throw invalid();
  const u = new URL(value);
  if (!['https:', 'http:'].includes(u.protocol) || !u.hostname || u.username || u.password ||
      [...u.searchParams.keys()].some(k => ['token','access_token','refresh_token','authorization','api_key'].includes(k))) throw invalid();
}
function dateOnly(value: Json) {
  if (value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw invalid();
}
export function validateDisplayScope(body: DisplayDescriptor, environment: string, now: number): DisplayDescriptor {
  try {
    const a = body.approval, cat = body.catalog;
    if (!record(body) || body.format !== 'jungsi.official-history-display/v1' || body.purpose !== 'official_history_display' ||
        body.source_view !== VIEW || !['local_verification','isolated_cloud_review'].includes(environment) || body.environment !== environment ||
        body.engine_approved !== false || body.production_allowed !== false || body.nationwide_collection_complete !== false ||
        !record(a) || a.status !== 'approved' || a.revoked !== false || typeof a.approval_id !== 'string' || !a.approval_id.trim() ||
        !Array.isArray(a.operations) || a.operations.length !== OPERATIONS.length || new Set(a.operations).size !== OPERATIONS.length ||
        !OPERATIONS.every(v => a.operations instanceof Array && a.operations.includes(v))) throw invalid();
    const issued = utcInstantMicros(a.issued_at), expires = utcInstantMicros(a.expires_at), current = nowMicros(now);
    if (issued > current || expires <= current || expires - issued > 86_400_000_000n ||
        !Array.isArray(a.review_subjects) || a.review_subjects.length < 1 || a.review_subjects.length > 20 ||
        !a.review_subjects.every(uuid) || new Set(a.review_subjects).size !== a.review_subjects.length) throw invalid();
    if (!record(cat) || cat.format !== 'jungsi.catalog-release/v1' || cat.status !== 'approved' || !identifier(cat.version) ||
        cat.nationwide_collection_complete !== false || cat.admission_probability_provided !== false) throw invalid();
    if (!record(body.source_evidence) || !['metric_lineage_sha256','offering_boundary_receipt_sha256'].every(k => sha((body.source_evidence as Row)[k]))) throw invalid();
    utcInstantMicros(cat.as_of);
    if (!Array.isArray(cat.offerings) || cat.offerings.length < 1 || cat.offerings.length > 100 ||
        !Array.isArray(cat.history) || cat.history.length < 1 || cat.history.length > 200 ||
        !Array.isArray(body.bindings) || body.bindings.length !== cat.history.length) throw invalid();
    const offers = new Map<string, Row>();
    for (const r of cat.offerings) {
      if (!record(r) || !keys(r, [...OFFERING_FIELDS, 'practical_required']) || r.practical_required !== false ||
          typeof r.academic_year !== 'number' || !Number.isInteger(r.academic_year) || ![2024,2025,2026,2027].includes(r.academic_year) ||
          !identifier(r.offering_id) || offers.has(r.offering_id) ||
          OFFERING_FIELDS.some(k => k !== 'academic_year' && r[k] !== null && typeof r[k] !== 'string')) throw invalid();
      offers.set(r.offering_id, r);
    }
    const indexes = new Set(), ids = new Set(), seenOffers = new Set();
    for (const b of body.bindings) {
      if (!record(b) || typeof b.native_history_index !== 'number' || !Number.isInteger(b.native_history_index) ||
          b.native_history_index < 0 || b.native_history_index >= cat.history.length || indexes.has(b.native_history_index) ||
          !record(b.expected_db_row) || !keys(b.expected_db_row, DB_FIELDS)) throw invalid();
      indexes.add(b.native_history_index); const expected = b.expected_db_row;
      const key = JSON.stringify([expected.release_id, expected.result_id]);
      if (typeof expected.release_id !== 'string' || !expected.release_id || typeof expected.result_id !== 'string' || !expected.result_id ||
          ids.has(key) || expected.active_service !== true || !sha(expected.source_sha256) || !sha(expected.row_fingerprint)) throw invalid();
      ids.add(key); const row = cat.history[b.native_history_index], offer = typeof b.offering_id === 'string' ? offers.get(b.offering_id) : undefined;
      if (!record(row) || !offer || !keys(row, [...HISTORY_FIELDS, 'verification_status']) || row.verification_status !== 'verified_official' ||
          typeof b.source_offering_pk !== 'string' || !b.source_offering_pk || !sameJson(expected.offering_pk, b.source_offering_pk) ||
          b.offering_id !== String(expected.academic_year) + ':' + b.source_offering_pk || row.offering_id !== b.offering_id || expected.academic_year !== row.academic_year ||
          OFFERING_FIELDS.some(k => !sameJson(row[k], offer[k])) ||
          !(row.value === null || typeof row.value === 'string' || typeof row.value === 'number' && Number.isSafeInteger(row.value)) ||
          HISTORY_FIELDS.some(k => !['academic_year', 'value'].includes(k) && row[k] !== null && typeof row[k] !== 'string')) throw invalid();
      publicSource(row.source_url); dateOnly(row.source_as_of); seenOffers.add(b.offering_id);
      if (expected.metric_value_numeric !== canonicalDecimal(expected.metric_value_numeric)) throw invalid();
    }
    if (offers.size !== seenOffers.size) throw invalid();
    const strategy=body.read_strategy;
    if(environment==='isolated_cloud_review'&&(!record(strategy)||strategy.name!=='uncurated_pk_equivalent'))throw invalid();
    if(strategy!==undefined) {
      if(!record(strategy)||!['curated_view','uncurated_pk_equivalent'].includes(String(strategy.name)))throw invalid();
      if(strategy.name==='uncurated_pk_equivalent') {
        if(!['equivalence_receipt_sha256','rls_receipt_sha256','join_receipt_sha256'].every(k=>sha(strategy[k]))||
          strategy.snapshot_revision!=='v21_1'||!Array.isArray(strategy.active_view_chain)||!strategy.active_view_chain.length||strategy.active_view_chain.length>32||
          !Array.isArray(strategy.active_curation_release_ids)||!strategy.active_curation_release_ids.length||strategy.active_curation_release_ids.length>32||
          strategy.active_curation_release_ids.some(v=>typeof v!=='string'||!v)||new Set(strategy.active_curation_release_ids).size!==strategy.active_curation_release_ids.length)throw invalid();
        const names=new Set();
        for(const view of strategy.active_view_chain) {
          if(!record(view)||view.schema!=='jungsi_data_ingest'||typeof view.relation!=='string'||!/^admission_results_(?:effective|curated_v[0-9]+(?:_[0-9]+)?)$/.test(view.relation)||
            names.has(view.relation)||!sha(view.view_definition_sha256)||!Array.isArray(view.reloptions)||!view.reloptions.includes('security_invoker=true'))throw invalid();
          names.add(view.relation);
        }
        if(!names.has('admission_results_curated_v21_1')||new Set(body.bindings.map(b=>(b.expected_db_row as Row).release_id)).size!==1||
          body.bindings.some(b=>{const e=b.expected_db_row as Row;return e.curation_release_id!==null||e.curation_fields!==null||e.curation_evidence!==null;}))throw invalid();
      }
    }
    return clone(body);
  } catch { throw invalid(); }
}
export function mapScopedCatalog(body: DisplayDescriptor, rows: Row[]): Row {
  try {
    if (!Array.isArray(rows) || rows.length !== body.bindings.length) throw invalid();
    const actual = new Map<string, Row>();
    const pk=record(body.read_strategy)&&body.read_strategy.name==='uncurated_pk_equivalent';
    for (const raw of rows) {
      if (!record(raw) || !keys(raw, pk?[...DB_FIELDS,...GUARD_FIELDS]:DB_FIELDS)) throw invalid();
      if(pk&&(raw.guard_active_curation_release_id!==null||!(raw.guard_school_source_school_id===null&&raw.guard_school_after_row_fingerprint===null||
        sameJson(raw.guard_school_source_school_id,raw.school_id)&&sameJson(raw.guard_school_after_row_fingerprint,raw.row_fingerprint))))throw invalid();
      const row = Object.fromEntries(DB_FIELDS.map(k=>[k,clone(raw[k])])) as Row; row.metric_value_numeric = canonicalDecimal(row.metric_value_numeric);
      const key = JSON.stringify([row.release_id, row.result_id]); if (actual.has(key)) throw invalid(); actual.set(key, row);
    }
    const cat = clone(body.catalog), history = cat.history as Row[];
    for (const b of body.bindings) {
      const e = b.expected_db_row as Row, row = actual.get(JSON.stringify([e.release_id, e.result_id]));
      if (!row || !sameJson(row, e) || typeof row.metric_value_literal !== 'string') throw invalid();
      const value = parseStrictJson(row.metric_value_literal);
      const kind = value === null ? 'null' : typeof value === 'string' ? 'string' : typeof value === 'number' && Number.isSafeInteger(value) ? 'number' : undefined;
      const index = b.native_history_index as number;
      if (kind !== row.metric_value_json_type || !sameJson(value, history[index].value)) throw invalid();
      if (row.metric_value_numeric !== null && canonicalDecimal(String(value)) !== row.metric_value_numeric) throw invalid();
      history[index].value = value;
    }
    return cat;
  } catch { throw invalid(); }
}
const pick = (row: Row, fields: string[]): Row => Object.fromEntries(fields.map(k => [k, clone(row[k])])) as Row;
/** Python json.dumps(default separators, sort_keys=True, ensure_ascii=True) for cursors. */
function pythonJson(value: Json): string {
  if (typeof value === 'string') return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4,'0'));
  if (Array.isArray(value)) return '[' + value.map(pythonJson).join(', ') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(k => pythonJson(k) + ': ' + pythonJson(value[k])).join(', ') + '}';
  return JSON.stringify(value);
}
async function digest(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2,'0')).join(''); }
function queryObject(url: URL, allowed: string[]) {
  const pairs = [...url.searchParams.entries()];
  if (new Set(pairs.map(p => p[0])).size !== pairs.length) throw new DisplayError('duplicate_query_field',422);
  if (pairs.some(([k]) => !allowed.includes(k))) throw new DisplayError('invalid_request',400);
  return Object.fromEntries(pairs);
}
async function search(cat: Row, operation: string, url: URL): Promise<Row> {
  const q = queryObject(url, ['academic_year','university_q','department_q','region','group','cursor','limit']);
  const clean: Row = {};
  for (const k of ['university_q','department_q','region','group']) {
    const v = q[k] ?? ''; if (v.length > 100) throw new DisplayError('invalid_query',400); clean[k] = v.toLocaleLowerCase('und').trim();
  }
  const year = q.academic_year === undefined ? null : /^[0-9]+$/.test(q.academic_year) ? Number(q.academic_year) : NaN;
  if (year !== null && ![2024,2025,2026,2027].includes(year)) throw new DisplayError('invalid_year',400);
  const limit = q.limit === undefined ? 50 : /^[0-9]+$/.test(q.limit) ? Number(q.limit) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new DisplayError('invalid_limit',400);
  const fields = operation === 'history.search' ? HISTORY_FIELDS : OFFERING_FIELDS;
  let rows = (operation === 'history.search' ? cat.history : cat.offerings) as Row[];
  rows = rows.filter(r => (year === null || year === r.academic_year) &&
    (String(r.university_name ?? '') + ' ' + String(r.campus ?? '')).toLocaleLowerCase('und').includes(clean.university_q as string) &&
    String(r.department ?? '').toLocaleLowerCase('und').includes(clean.department_q as string) &&
    (!clean.region || clean.region === String(r.region ?? '').toLocaleLowerCase('und')) &&
    (!clean.group || clean.group === String(r.group ?? '').toLocaleLowerCase('und')));
  const cmp = (a: Json, b: Json) => a === b ? 0 : a! < b! ? -1 : 1;
  rows.sort((a,b) => cmp(a.academic_year,b.academic_year) || cmp(a.university_id,b.university_id) || cmp(a.offering_id,b.offering_id) || cmp(a.metric_name ?? '', b.metric_name ?? ''));
  const signature = (await digest(pythonJson([operation, clean, year]))).slice(0,16); let start = 0;
  if (q.cursor) {
    try {
      if (q.cursor.length > 1024 || !/^[A-Za-z0-9_-]+={0,2}$/.test(q.cursor)) throw new Error();
      const cursor = parseStrictJson(atob(q.cursor.replace(/-/g,'+').replace(/_/g,'/')));
      if (!Array.isArray(cursor) || cursor.length !== 3) throw new Error();
      if (cursor[0] !== cat.version || cursor[2] !== signature) throw new DisplayError('cursor_version_mismatch',409);
      if (typeof cursor[1] !== 'number' || !Number.isSafeInteger(cursor[1]) || cursor[1] < 0 || cursor[1] > rows.length) throw new Error(); start = cursor[1];
    } catch (e) { if (e instanceof DisplayError && e.code === 'cursor_version_mismatch') throw e; throw new DisplayError('invalid_cursor',400); }
  }
  const end = start + limit;
  return {status:'ready',reason_code:null,items:rows.slice(start,end).map(r => pick(r,fields)),matching_offering_count:new Set(rows.map(r => r.offering_id)).size,
    matching_school_count:new Set(rows.map(r => r.university_id)).size,catalog_version:cat.version,as_of:utcText(cat.as_of as string),
    next_cursor:end < rows.length ? btoa(pythonJson([cat.version,end,signature])).replace(/\+/g,'-').replace(/\//g,'_') : null};
}
function relay(value: string | null) { return value !== null && /^[\x21-\x2b\x2d-\x7e]{32,512}$/.test(value); }
async function sameRelay(a: string, b: string) { const [x,y] = await Promise.all([digest(a),digest(b)]); let n = 0; for (let i=0;i<x.length;i++) n |= x.charCodeAt(i) ^ y.charCodeAt(i); return n === 0 && a.length === b.length; }
export function createOfficialHistoryDisplayHandler(ports: OfficialHistoryPorts, transport: DisplayTransport): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = crypto.randomUUID().replace(/-/g,'');
    const response = (body: Row, status = 200, beforeSend?: () => void) => { const encoded=JSON.stringify(body); beforeSend?.(); return new Response(encoded, {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Request-ID':requestId,'X-Content-Type-Options':'nosniff'}}); };
    try {
      if (!relay(transport.relayToken) || !/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(transport.pathPrefix)) throw new DisplayError('security_policy_unavailable');
      const actualRelay = request.headers.get('X-Jungsi-Relay-Token');
      if (!relay(actualRelay) || !await sameRelay(actualRelay!,transport.relayToken)) throw new DisplayError('relay_authentication_failed',403);
      const url = new URL(request.url);
      if (!url.pathname.startsWith(transport.pathPrefix + '/')) throw new DisplayError('display_operation_not_supported');
      const path = url.pathname.slice(transport.pathPrefix.length);
      let operation: typeof OPERATIONS[number] | undefined, offeringId: string | undefined;
      if (path === '/api/v1/me') operation='session.read';
      else if (path === '/api/v1/admission-history') operation='history.search';
      else if (path === '/api/v1/offerings/search') operation='offerings.search';
      else {
        const m=path.match(/^\/api\/v1\/offerings\/([^/]+)(\/recruitment)?$/);
        if(m) {
          try { offeringId=decodeURIComponent(m[1]); } catch { throw new DisplayError('invalid_identifier',400); }
          if(!identifier(offeringId))throw new DisplayError('invalid_identifier',400);
          operation=m[2]?'recruitment.read':'offering.read';
        }
      }
      if (request.method !== 'GET' || !operation) throw new DisplayError('display_operation_not_supported');
      const now=(transport.now??Date.now)(), admission=admissionMillis(now);
      if(admission==='invalid_clock')throw new DisplayError('security_policy_unavailable');
      if(admission==='ended')throw new DisplayError('service_ended',403);
      const authorization = request.headers.get('Authorization');
      if (!authorization?.startsWith('Bearer ') || !/^[^\s,]{1,16384}$/.test(authorization.slice(7))) throw new DisplayError('authentication_required',401);
      const verified = await ports.verifySession(authorization.slice(7),now);
      if (!verified || !uuid(verified.subjectId) || !Number.isFinite(verified.expiresAt) || verified.expiresAt <= now) throw new DisplayError('authentication_required',401);
      const descriptor = validateDisplayScope(await ports.loadDescriptor(), transport.environment, now);
      if (!(descriptor.approval.review_subjects as string[]).includes(verified.subjectId)) throw new DisplayError('review_subject_not_allowed',403);
      const until = await ports.paidUntil(verified.subjectId,now);
      if (until !== null && utcInstantMicros(until) <= nowMicros(now)) throw new DisplayError('entitlement_unavailable');
      const complete = (body: Row) => response(body, 200, () => {
        const current = () => {
          let value: number;
          try { value=(transport.now??Date.now)(); } catch { throw new DisplayError('security_policy_unavailable'); }
          if(!Number.isSafeInteger(value)||!Number.isSafeInteger(value*1000)||value<now||value<0)throw new DisplayError('security_policy_unavailable');
          return value;
        };
        const checked=current();
        if(verified.expiresAt<=checked)throw new DisplayError('authentication_required',401);
        validateDisplayScope(descriptor,transport.environment,checked);
        const sending=current();
        if(sending<checked)throw new DisplayError('security_policy_unavailable');
        if(verified.expiresAt<=sending)throw new DisplayError('authentication_required',401);
        const approval=descriptor.approval, micros=nowMicros(sending);
        if(!record(approval)||approval.status!=='approved'||approval.revoked!==false||
           !Array.isArray(approval.review_subjects)||!approval.review_subjects.includes(verified.subjectId)||
           utcInstantMicros(approval.issued_at)>micros||utcInstantMicros(approval.expires_at)<=micros)throw invalid();
        if(until!==null&&utcInstantMicros(until)<=micros)throw new DisplayError('entitlement_unavailable');
      });
      if (operation === 'session.read') { queryObject(url,[]); return complete({format:'jungsi.session/v1',member_tier:until === null?'standard':'paid',entitlement_expires_at:until === null?null:utcText(until)}); }
      if (['offerings.search','offering.read'].includes(operation) && until === null) throw new DisplayError('paid_required',403);
      const catalog = mapScopedCatalog(descriptor, await ports.readRows(descriptor));
      if (operation === 'history.search' || operation === 'offerings.search') return complete(await search(catalog,operation,url));
      queryObject(url,[]); const offering = (catalog.offerings as Row[]).find(r => r.offering_id === offeringId);
      if (!offering) throw new DisplayError('offering_not_found',404);
      if (operation === 'offering.read') return complete({status:'ready',reason_code:null,offering:pick(offering,OFFERING_FIELDS),catalog_version:catalog.version});
      return complete({status:'pending',reason_code:'recruitment_not_published',offering:pick(offering,OFFERING_FIELDS),recruitment:null});
    } catch (e) {
      const failure = e instanceof DisplayError && Object.hasOwn(SAFE_ERRORS,e.code) && SAFE_ERRORS[e.code]===e.status ? e : new DisplayError('backend_dependency_unavailable');
      return response({status:'error',error:{code:failure.code},request_id:requestId},failure.status);
    }
  };
}
