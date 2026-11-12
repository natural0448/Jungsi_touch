/**
 * 검토용 서버 내부 읽기 후보. 호출자는 인증·공유 예산·현재 head·뷰/RLS와
 * repeatable-read 읽기 전용 트랜잭션을 실제로 검증해야 한다. 이 파일은 승인 발급자,
 * DB 연결, 공개 DTO, 자료판 갱신 또는 서비스 배포를 만들지 않는다.
 */
import { exact } from "./jungsi/domain/exact.ts";
import { JsonFloat, parseNativeJson } from "./jungsi/domain/native_json.ts";
import { AccessError } from "./jungsi/application/access.ts";
import { matchesOriginalMethodAndCdf } from "./current_public_p1_reference_method.ts";

type Tx = { query(sql: string, parameters: readonly unknown[]): Promise<unknown> };
type Head = Readonly<{ releaseId: string; receiptSha256: string; fingerprint: string }>;
type Target = Readonly<{ canonicalResultId: string; academicYear: number; schoolId: string; offeringPk: string }>;
type Limits = Readonly<{ approved: true; maxTargets: number; maxMethodRecordBytes: number; maxMethodBatchBytes: number }>;
type Gate = {
  /** 실제 구현은 이 같은 tx의 사용자·공유 예산·read-only/RLS·snapshot head/뷰와 범위를 검사한다.
   * 같은 REPEATABLE READ tx 재조회만으로 tx 시작 이후 새 commit을 검출할 수 없다. */
  assertCurrent(tx: Tx, request: unknown, boundary: unknown, sourceHead: string, referenceHead: Head): Promise<Limits>;
};
type SourceProofPort = {
  /**
   * 기존 승인된 근거와 대상 reference release를 결속해 검증한 CID만 반환한다.
   * 원점수 core fingerprint 외 score component·축·cohort/통계 정의의 현재성도 확인해야 한다.
   * 미등록 locator나 과거 head만으로 verified를 생성하지 않는다.
   */
  readVerified(tx: Tx, request: unknown, boundary: unknown, sourceHead: string,
    referenceHead: Head, targets: readonly Target[]): Promise<unknown>;
};
type MethodClaim = Readonly<{methodId:string;academicYear:number;schoolId:string}>;
type MethodProofPort = {
  /** 동일 release의 기존 고정 method 원문·CDF 근거를 검증한 결과만 공급한다. */
  readVerified(tx:Tx,request:unknown,boundary:unknown,sourceHead:string,referenceHead:Head,
    claims:readonly MethodClaim[]):Promise<unknown>;
};
type Hold = Readonly<{ state: "hold"; canonicalResultId: string; reason: string }>;
type Candidate = Readonly<{
  state: "stored_reference_candidate"; canonicalResultId: string; academicYear: number;
  schoolId: string; offeringPk: string; methodId: string; percentileText: string;
  referenceReleaseId: string; engineApproved: false; productionAllowed: false;
  snapshotConsistency: "same_transaction_only"; freshHeadStatus: "not_verified";
}>;
export type ReferencePortResult = Hold | Candidate;

const CID = /^(?:observation|admission):[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RELEASE = /^reference-percentile:[a-f0-9]{64}$/;
const METRIC = "estimated_upper_cumulative_percent_all_examinees";
const STATUS = "CALCULATED_WHOLE_COHORT_MODEL_ESTIMATE";
const MISSING = Symbol("missing");
function fail(): never { throw new AccessError("backend_dependency_unavailable",503); }
function hold(cid: string, reason: string): Hold { return Object.freeze({state:"hold",canonicalResultId:cid,reason}); }
function obj(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v!=="object" || Array.isArray(v) || v instanceof JsonFloat) return false;
  const p=Object.getPrototypeOf(v); return p===null || p===Object.prototype;
}
function own(v: Record<string,unknown>, key: string): unknown {
  const d=Object.getOwnPropertyDescriptor(v,key); return d?.enumerable && "value" in d ? d.value : MISSING;
}
function textId(v: unknown): v is string { return typeof v==="string" && ID.test(v); }
function integer(v: unknown): v is number { return typeof v==="number" && Number.isSafeInteger(v) && v>0; }
function count(v: unknown): bigint | null {
  if (typeof v==="bigint" && v>=0n) return v;
  if (typeof v==="number" && Number.isSafeInteger(v) && v>=0) return BigInt(v);
  if (typeof v==="string" && /^(?:0|[1-9][0-9]*)$/.test(v) && v.length<=19) return BigInt(v);
  return null;
}
/** 기존 historical-cutoff-reference 계약과 같은 0~100 문자열 범위다. */
function percentile(v: unknown): v is string {
  if (typeof v!=="string" || v.length>128 || !/^-?(?:0|[1-9][0-9]*)(?:[.][0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(v)) return false;
  try {const n=exact(v);return n.compare(exact(0))>=0 && n.compare(exact(100))<=0;} catch {return false;}
}

/** CID 배열 바인딩만 사용하며 값이나 식별자를 SQL 문자열에 보간하지 않는다. */
export const REFERENCE_EVIDENCE_EDGE_SQL = `
WITH requested AS MATERIALIZED (
 SELECT value AS cid,ordinality::integer AS ordinal
 FROM jsonb_array_elements_text($1::jsonb) WITH ORDINALITY AS t(value,ordinality)
)
SELECT q.ordinal,a.canonical_result_id,a.academic_year::text,a.school_id,a.offering_pk,
 a.source_result_id,a.row_fingerprint,a.source_row_fingerprint,a.active_service,
 v.canonical_result_id,v.release_id,v.academic_year::text,v.school_id,v.offering_pk,v.method_id,
 v.estimated_upper_cumulative_percent_all_examinees::text,v.metric,v.status,v.engine_approved,v.production_allowed,
 p.release_id,p.school_id,p.academic_year::text,p.offering_pk,p.method_id
FROM requested q
LEFT JOIN LATERAL (SELECT * FROM jungsi_data_ingest.admission_results_current x
 WHERE x.canonical_result_id=q.cid LIMIT 2) a ON true
LEFT JOIN LATERAL (SELECT * FROM jungsi_data_ingest.reference_cutoff_percentiles_current x
 WHERE x.canonical_result_id=q.cid AND x.release_id=$2 LIMIT 2) v ON true
LEFT JOIN LATERAL (SELECT * FROM jungsi_data_ingest.reference_percentile_pk_links_current x
 WHERE x.release_id=$2 AND x.school_id=v.school_id AND x.academic_year=v.academic_year
   AND x.offering_pk=v.offering_pk LIMIT 2) p ON true
ORDER BY q.ordinal LIMIT $3::bigint`;

/** 중복 method를 묶어 읽고 승인 예산 밖의 본문은 DB가 전송하지 않는다.
 * 개별 예산을 초과해 전송하지 않을 본문은 배치 전송량에 포함하지 않는다.
 * 배치 총량 때문에 보류된 나머지의 별도 이어읽기는 이 후보에서 구현하지 않는다. */
export const REFERENCE_EVIDENCE_METHOD_SQL = `
WITH requested AS MATERIALIZED (
 SELECT DISTINCT value AS requested_id FROM jsonb_array_elements_text($1::jsonb) AS t(value)
), methods AS MATERIALIZED (
 SELECT q.requested_id,m.release_id,m.method_id,m.method_row_sha256,m.cdf_source_sha256,
   m.method_json,m.source_CDF_reference::text AS cdf_reference,
   CASE WHEN m.method_id IS NULL THEN NULL ELSE
     COALESCE(octet_length(m.method_json),0)::bigint+COALESCE(octet_length(m.source_CDF_reference::text),0)::bigint END AS body_bytes
 FROM requested q LEFT JOIN LATERAL (
   SELECT * FROM jungsi_data_ingest.reference_percentile_methods_current x
   WHERE x.release_id=$2 AND x.method_id=q.requested_id LIMIT 2
 ) m ON true
), bounded AS MATERIALIZED (
 SELECT *,sum(CASE WHEN body_bytes<=$3::bigint THEN COALESCE(body_bytes,0) ELSE 0 END) OVER (ORDER BY requested_id COLLATE "C") AS running_bytes FROM methods
)
SELECT requested_id,release_id,method_id,method_row_sha256,cdf_source_sha256,body_bytes,
 CASE WHEN body_bytes<=$3::bigint AND running_bytes<=$4::bigint THEN method_json ELSE NULL END,
 CASE WHEN body_bytes<=$3::bigint AND running_bytes<=$4::bigint THEN cdf_reference ELSE NULL END
FROM bounded ORDER BY requested_id COLLATE "C" LIMIT $5::bigint`;

type Proof = Readonly<{cid:string;release:string;year:number;school:string;pk:string;sourceId:string;rowHash:string;sourceHash:string;axis:string}>;
function proof(raw: unknown): Proof | null {
  if (!obj(raw)) return null;
  const p={cid:own(raw,"canonicalResultId"),release:own(raw,"referenceReleaseId"),year:own(raw,"academicYear"),
    school:own(raw,"schoolId"),pk:own(raw,"offeringPk"),sourceId:own(raw,"sourceResultId"),
    rowHash:own(raw,"rowFingerprint"),sourceHash:own(raw,"sourceRowFingerprint"),axis:own(raw,"axisStatus")};
  if (typeof p.cid!=="string" || !CID.test(p.cid) || typeof p.release!=="string" || !RELEASE.test(p.release) ||
      typeof p.year!=="number" || ![2024,2025,2026].includes(p.year) || !textId(p.school) || !textId(p.pk) ||
      !textId(p.sourceId) || typeof p.rowHash!=="string" || !HASH.test(p.rowHash) ||
      typeof p.sourceHash!=="string" || !HASH.test(p.sourceHash) || p.axis!=="verified") return null;
  return Object.freeze(p as Proof);
}
type MethodProof = Readonly<{release:string;methodId:string;year:number;school:string;rowHash:string;cdfHash:string}>;
function methodKey(methodId:string,year:number,school:string):string {return JSON.stringify([methodId,year,school]);}
function methodProof(raw:unknown):MethodProof|null {
  if (!obj(raw)) return null;
  const p={release:own(raw,"referenceReleaseId"),methodId:own(raw,"methodId"),year:own(raw,"academicYear"),
    school:own(raw,"schoolId"),rowHash:own(raw,"methodRowSha256"),cdfHash:own(raw,"cdfSourceSha256")};
  if (typeof p.release!=="string" || !RELEASE.test(p.release) || !textId(p.methodId) ||
      typeof p.year!=="number" || ![2024,2025,2026].includes(p.year) || !textId(p.school) ||
      typeof p.rowHash!=="string" || !HASH.test(p.rowHash) || typeof p.cdfHash!=="string" || !HASH.test(p.cdfHash)) return null;
  return Object.freeze(p as MethodProof);
}
function limits(raw: unknown): Limits {
  if (!obj(raw)) return fail();
  if (own(raw,"approved")!==true) return fail();
  const maxTargets=own(raw,"maxTargets"),maxMethodRecordBytes=own(raw,"maxMethodRecordBytes"),maxMethodBatchBytes=own(raw,"maxMethodBatchBytes");
  if (!integer(maxTargets) || !integer(maxMethodRecordBytes) || !integer(maxMethodBatchBytes) || maxMethodRecordBytes>maxMethodBatchBytes) return fail();
  return Object.freeze({approved:true as const,maxTargets,maxMethodRecordBytes,maxMethodBatchBytes});
}
function target(raw: unknown): Target {
  if (!obj(raw)) return fail();
  const canonicalResultId=own(raw,"canonicalResultId"),academicYear=own(raw,"academicYear"),schoolId=own(raw,"schoolId"),offeringPk=own(raw,"offeringPk");
  if (typeof canonicalResultId!=="string" || !CID.test(canonicalResultId) || typeof academicYear!=="number" ||
      ![2024,2025,2026].includes(academicYear) || !textId(schoolId) || !textId(offeringPk)) return fail();
  return Object.freeze({canonicalResultId,academicYear,schoolId,offeringPk});
}
function head(raw: unknown): Head {
  if (!obj(raw)) return fail();
  const releaseId=own(raw,"releaseId"),receiptSha256=own(raw,"receiptSha256"),fingerprint=own(raw,"fingerprint");
  if (typeof releaseId!=="string" || !RELEASE.test(releaseId) || typeof receiptSha256!=="string" || !HASH.test(receiptSha256) ||
      typeof fingerprint!=="string" || !HASH.test(fingerprint)) return fail();
  return Object.freeze({releaseId,receiptSha256,fingerprint});
}
function sameLimits(a:Limits,b:Limits):boolean {
  return a.maxTargets===b.maxTargets && a.maxMethodRecordBytes===b.maxMethodRecordBytes && a.maxMethodBatchBytes===b.maxMethodBatchBytes;
}
/** 이 wrapper는 검증된 현재 methods view가 계산한 source_CDF_reference를 서버 내부에서만 전달한다. */
function methodAssets(raw: string, refText: string): Record<string,unknown> | null {
  let parsed: unknown, ref: unknown;
  try {parsed=parseNativeJson(raw);ref=parseNativeJson(refText);} catch {return null;}
  if (!obj(parsed) || !obj(ref)) return null;
  const source=own(parsed,"source_CDF"); if (!obj(source)) return null;
  const key=own(source,"$asset_ref"); if (typeof key!=="string" || !key) return null;
  const assets:Record<string,unknown>=Object.create(null);
  Object.defineProperty(assets,key,{value:Object.freeze({file_reference:ref}),enumerable:true});
  return Object.freeze(assets);
}

/**
 * 반환은 서버 내부 후보이며 공개/엔진 승인이 아니다. Gate·source port는 신뢰된 내부 구현만 주입한다.
 * 어떤 API/DB/승인 오류도 임의로 0·성공으로 바꾸지 않으며 특히 429는 그대로 전달한다.
 */
async function readReferenceMethodEvidenceInner(
  tx:Tx,request:unknown,boundary:unknown,sourceHead:string,referenceHead:Head,
  targets:readonly Target[],gate:Gate,sourcePort:SourceProofPort|null,methodPort:MethodProofPort|null,
):Promise<readonly ReferencePortResult[]> {
  if (!tx || typeof tx.query!=="function" || !request || !boundary || typeof sourceHead!=="string" || !HASH.test(sourceHead) ||
      !Array.isArray(targets) || !gate || typeof gate.assertCurrent!=="function") return fail();
  const query=tx.query.bind(tx),h=head(referenceHead),items=Object.freeze(targets.map(target));
  const first=limits(await gate.assertCurrent(tx,request,boundary,sourceHead,h));
  if (items.length>first.maxTargets) return fail();

  const unique=new Map<string,Target>(),conflicts=new Set<string>();
  for (const x of items) {
    const old=unique.get(x.canonicalResultId);
    if (old && (old.academicYear!==x.academicYear || old.schoolId!==x.schoolId || old.offeringPk!==x.offeringPk)) conflicts.add(x.canonicalResultId);
    else if (!old) unique.set(x.canonicalResultId,x);
  }
  const pending=new Map<string,ReferencePortResult>();
  for (const cid of conflicts) pending.set(cid,hold(cid,"conflicting_observation_identity"));
  const requested=Object.freeze([...unique.values()].filter((x)=>!conflicts.has(x.canonicalResultId)));
  const allowed=new Set(requested.map((x)=>x.canonicalResultId));
  const source=new Map<string,Proof>(),badProof=new Set<string>();
  if (sourcePort!==null) {
    if (!sourcePort || typeof sourcePort.readVerified!=="function") return fail();
    const raw=await sourcePort.readVerified(tx,request,boundary,sourceHead,h,requested);
    if (!Array.isArray(raw)) return fail();
    for (const value of raw) {
      if (!obj(value)) return fail();
      const cid=own(value,"canonicalResultId");
      if (typeof cid!=="string" || !allowed.has(cid)) return fail();
      if (source.has(cid) || badProof.has(cid)) {source.delete(cid);badProof.add(cid);continue;}
      const p=proof(value);if (!p) {badProof.add(cid);continue;}source.set(cid,p);
    }
  }
  const selected=requested.filter((x)=>{
    const p=source.get(x.canonicalResultId);
    const ok=p && p.release===h.releaseId && p.year===x.academicYear && p.school===x.schoolId && p.pk===x.offeringPk;
    if (!ok) pending.set(x.canonicalResultId,hold(x.canonicalResultId,"source_revision_or_axis_unverified"));
    return !!ok;
  });
  type Bound={item:Target;methodId:string;value:string};
  const bound:Bound[]=[];
  if (selected.length) {
    const limit=selected.length*8+1;if (!Number.isSafeInteger(limit)) return fail();
    const raw=await query(REFERENCE_EVIDENCE_EDGE_SQL,[JSON.stringify(selected.map((x)=>x.canonicalResultId)),h.releaseId,limit]);
    if (!Array.isArray(raw) || raw.length>=limit) return fail();
    const groups:unknown[][][]=selected.map(()=>[]);
    for (const r of raw) {
      if (!Array.isArray(r) || r.length!==25 || !Number.isSafeInteger(Number(r[0])) || Number(r[0])<1 || Number(r[0])>selected.length) return fail();
      groups[Number(r[0])-1].push(r.slice());
    }
    for (let i=0;i<selected.length;i++) {
      const x=selected[i],cid=x.canonicalResultId,p=source.get(cid)!,g=groups[i];
      if (g.length!==1) {pending.set(cid,hold(cid,"source_or_reference_ambiguous"));continue;}
      const r=g[0];
      if (r[1]!==cid || r[2]!==String(x.academicYear) || r[3]!==x.schoolId || r[4]!==x.offeringPk ||
          r[5]!==p.sourceId || r[6]!==p.rowHash || r[7]!==p.sourceHash || r[8]!==true ||
          r[9]!==cid || r[10]!==h.releaseId || r[11]!==String(x.academicYear) || r[12]!==x.schoolId || r[13]!==x.offeringPk ||
          !textId(r[14]) || !percentile(r[15]) || r[16]!==METRIC || r[17]!==STATUS || r[18]!==false || r[19]!==false ||
          r[20]!==h.releaseId || r[21]!==x.schoolId || r[22]!==String(x.academicYear) || r[23]!==x.offeringPk || r[24]!==r[14]) {
        pending.set(cid,hold(cid,"current_identity_or_reference_mismatch"));continue;
      }
      bound.push(Object.freeze({item:x,methodId:r[14],value:r[15]}));
    }
  }

  const claimMap=new Map<string,MethodClaim>();
  for (const x of bound) {
    const key=methodKey(x.methodId,x.item.academicYear,x.item.schoolId);
    if (!claimMap.has(key)) claimMap.set(key,Object.freeze({methodId:x.methodId,academicYear:x.item.academicYear,schoolId:x.item.schoolId}));
  }
  const methodProofs=new Map<string,MethodProof>(),badMethodProofs=new Set<string>();
  if (methodPort!==null && claimMap.size) {
    if (!methodPort || typeof methodPort.readVerified!=="function") return fail();
    const claims=Object.freeze([...claimMap.values()]);
    const raw=await methodPort.readVerified(tx,request,boundary,sourceHead,h,claims);
    if (!Array.isArray(raw)) return fail();
    for (const value of raw) {
      if (!obj(value)) return fail();
      const mid=own(value,"methodId"),year=own(value,"academicYear"),school=own(value,"schoolId");
      if (typeof mid!=="string" || typeof year!=="number" || typeof school!=="string") return fail();
      const key=methodKey(mid,year,school);
      if (!claimMap.has(key)) return fail();
      if (methodProofs.has(key) || badMethodProofs.has(key)) {methodProofs.delete(key);badMethodProofs.add(key);continue;}
      const p=methodProof(value);
      if (!p || p.release!==h.releaseId) {badMethodProofs.add(key);continue;}
      methodProofs.set(key,p);
    }
  }
  const eligible=bound.filter((x)=>{
    const key=methodKey(x.methodId,x.item.academicYear,x.item.schoolId);
    const ok=methodProofs.has(key) && !badMethodProofs.has(key);
    if (!ok) pending.set(x.item.canonicalResultId,hold(x.item.canonicalResultId,"method_reference_unverified"));
    return ok;
  });
  const methodIds=[...new Set(eligible.map((x)=>x.methodId))];
  const methods=new Map<string,readonly unknown[]>(),badMethods=new Set<string>();
  if (methodIds.length) {
    const limit=methodIds.length*2+1;if (!Number.isSafeInteger(limit)) return fail();
    const raw=await query(REFERENCE_EVIDENCE_METHOD_SQL,[JSON.stringify(methodIds),h.releaseId,first.maxMethodRecordBytes,first.maxMethodBatchBytes,limit]);
    if (!Array.isArray(raw) || raw.length>=limit) return fail();
    const allowedMethods=new Set(methodIds);
    let transferred=0n;
    for (const row of raw) {
      if (!Array.isArray(row) || row.length!==8 || typeof row[0]!=="string" || !allowedMethods.has(row[0])) return fail();
      const mid=row[0];
      const rawBytes=typeof row[6]==="string" ? new TextEncoder().encode(row[6]).byteLength : 0;
      const referenceBytes=typeof row[7]==="string" ? new TextEncoder().encode(row[7]).byteLength : 0;
      const actual=BigInt(rawBytes)+BigInt(referenceBytes);
      transferred+=actual;
      if (transferred>BigInt(first.maxMethodBatchBytes)) return fail();
      if (methods.has(mid) || badMethods.has(mid)) {methods.delete(mid);badMethods.add(mid);continue;}
      const declared=count(row[5]);
      if (typeof row[6]!=="string" || typeof row[7]!=="string" || declared===null ||
          actual!==declared || actual>BigInt(first.maxMethodRecordBytes)) {badMethods.add(mid);continue;}
      methods.set(mid,Object.freeze(row.slice()));
    }
  }
  const checked=new Map<string,Promise<boolean>>();
  for (const x of eligible) {
    const key=methodKey(x.methodId,x.item.academicYear,x.item.schoolId);
    if (checked.has(key)) continue;
    const row=methods.get(x.methodId),len=row ? count(row[5]) : null,expected=methodProofs.get(key)!;
    if (!row || badMethods.has(x.methodId) || row[1]!==h.releaseId || row[2]!==x.methodId ||
        typeof row[3]!=="string" || !HASH.test(row[3]) || typeof row[4]!=="string" || !HASH.test(row[4]) ||
        row[3]!==expected.rowHash || row[4]!==expected.cdfHash ||
        len===null || len>BigInt(first.maxMethodRecordBytes) || typeof row[6]!=="string" || typeof row[7]!=="string") {
      checked.set(key,Promise.resolve(false));continue;
    }
    const actual=new TextEncoder().encode(row[6]).byteLength+new TextEncoder().encode(row[7]).byteLength;
    if (BigInt(actual)!==len) {checked.set(key,Promise.resolve(false));continue;}
    const assets=methodAssets(row[6],row[7]);
    if (!assets) {checked.set(key,Promise.resolve(false));continue;}
    checked.set(key,matchesOriginalMethodAndCdf(row[6],Object.freeze({methodId:x.methodId,methodRowSha256:row[3],cdfSourceSha256:row[4],
      academicYear:x.item.academicYear,sourceSchoolId:x.item.schoolId,manifestAssets:assets})));
  }
  const verdicts=await Promise.all([...checked.entries()].map(async ([key,value])=>[key,await value] as const));
  const verified=new Map(verdicts);
  for (const x of eligible) {
    const cid=x.item.canonicalResultId,key=methodKey(x.methodId,x.item.academicYear,x.item.schoolId);
    if (verified.get(key)!==true) {pending.set(cid,hold(cid,"method_evidence_unverified"));continue;}
    pending.set(cid,Object.freeze({state:"stored_reference_candidate",canonicalResultId:cid,academicYear:x.item.academicYear,
      schoolId:x.item.schoolId,offeringPk:x.item.offeringPk,methodId:x.methodId,percentileText:x.value,
      referenceReleaseId:h.releaseId,engineApproved:false,productionAllowed:false,
      snapshotConsistency:"same_transaction_only",freshHeadStatus:"not_verified"}));
  }
  const last=limits(await gate.assertCurrent(tx,request,boundary,sourceHead,h));
  if (!sameLimits(first,last)) return fail();
  return Object.freeze(items.map((x)=>pending.get(x.canonicalResultId) ?? fail()));
}

/** 미지 의존성 예외는 고정 오류로 감싸고 기존 AccessError/RequestLimitError는 보존한다. */
export async function readReferenceMethodEvidence(
  tx:Tx,request:unknown,boundary:unknown,sourceHead:string,referenceHead:Head,
  targets:readonly Target[],gate:Gate,sourcePort:SourceProofPort|null,methodPort:MethodProofPort|null,
):Promise<readonly ReferencePortResult[]> {
  try {return await readReferenceMethodEvidenceInner(tx,request,boundary,sourceHead,referenceHead,targets,gate,sourcePort,methodPort);}
  catch (error) {if (error instanceof AccessError) throw error;return fail();}
}
