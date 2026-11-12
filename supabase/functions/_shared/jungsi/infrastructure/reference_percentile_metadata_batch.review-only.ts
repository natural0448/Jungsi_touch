/**
 * REVIEW ONLY. 2027 metadata batch, not a CDF fetcher, issuer, public API or runtime binding.
 * The injected request authority, read-only SQL transport and budget have no implementation here.
 */
import { AccessError } from "../application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import type { NativeObject } from "../domain/json_value.ts";
import type { NativeSqlTransaction } from "./transaction_sql.ts";
import type { ExistingReferenceDbPin } from "./reference_percentile_postgres.ts";

/** One metadata query in one read-only transaction. No CDF content is selected.
 * CASE limits all variable-width values before they cross the DB boundary. An oversized
 * method is not returned and remains pending; LIMIT permits duplicate detection. */
export const REFERENCE_2027_BATCH_METADATA_SQL = `
WITH guard AS MATERIALIZED (
 SELECT current_user::text AS role_name, current_setting('transaction_read_only') AS tx_read_only,
 current_setting('row_security') AS row_security, role.rolsuper, role.rolbypassrls,
 pg_has_role(current_user,'jungsi_backend_owner','MEMBER') AS owner_member,
 pg_has_role(current_user,'jungsi_backend_owner','USAGE') AS owner_usage,
 pg_has_role(current_user,'postgres','MEMBER') AS postgres_member
 FROM pg_catalog.pg_roles role WHERE role.rolname=current_user
), requested AS MATERIALIZED (
 SELECT value AS offering_pk FROM jsonb_array_elements_text($1::jsonb)
), selected AS MATERIALIZED (
 SELECT CASE WHEN octet_length(h.release_id)<=128 THEN h.release_id END AS release_id,
 CASE WHEN octet_length(h.full_readback_receipt_sha256)<=64 THEN h.full_readback_receipt_sha256 END AS readback,
 CASE WHEN octet_length(h.dataset_fingerprint)<=64 THEN h.dataset_fingerprint END AS dataset,
 p.academic_year::text AS academic_year,
 CASE WHEN octet_length(p.offering_pk)<=128 THEN p.offering_pk END AS offering_pk,
 CASE WHEN octet_length(p.method_id)<=128 THEN p.method_id END AS method_id,
 CASE WHEN octet_length(m.method_row_sha256)<=64 THEN m.method_row_sha256 END AS method_sha,
 CASE WHEN octet_length(m.cdf_source_sha256)<=64 THEN m.cdf_source_sha256 END AS cdf_sha,
 m.method_json::text AS method_text, c.source_bytes::text AS source_bytes,
 CASE WHEN octet_length(c.gzip_sha256)<=64 THEN c.gzip_sha256 END AS gzip_sha,
 c.gzip_bytes::text AS gzip_bytes,
 CASE WHEN octet_length(c.compression)<=16 THEN c.compression END AS compression,
 CASE WHEN octet_length(r.manifest_sha256)<=64 THEN r.manifest_sha256 END AS manifest,
 r.engine_approved,r.production_allowed
 FROM guard g CROSS JOIN requested q
 JOIN jungsi_data_ingest.reference_percentile_heads_v1 h ON h.head_name='current'
 JOIN jungsi_data_ingest.reference_percentile_releases_v1 r ON r.release_id=h.release_id
 JOIN jungsi_data_ingest.reference_percentile_pk_links_v1 p ON p.release_id=h.release_id
   AND p.academic_year=2027 AND p.offering_pk=q.offering_pk
 JOIN jungsi_data_ingest.reference_percentile_methods_v1 m ON (m.release_id,m.method_id)=(p.release_id,p.method_id)
 JOIN jungsi_data_ingest.reference_percentile_cdfs_v1 c ON c.source_sha256=m.cdf_source_sha256
 WHERE g.role_name='jungsi_backend_app' AND g.tx_read_only='on' AND g.row_security='on'
 AND NOT g.rolsuper AND NOT g.rolbypassrls AND NOT g.owner_member AND NOT g.owner_usage AND NOT g.postgres_member
 AND r.metric='estimated_upper_cumulative_percent_all_examinees' AND NOT r.engine_approved AND NOT r.production_allowed
 AND octet_length(m.method_json) <= $2::integer
 LIMIT $3::integer
)
SELECT g.role_name,g.tx_read_only,g.row_security,g.rolsuper,g.rolbypassrls,
 g.owner_member,g.owner_usage,g.postgres_member,
 s.release_id,s.readback,s.dataset,s.academic_year,s.offering_pk,s.method_id,s.method_sha,s.cdf_sha,
 s.method_text,s.source_bytes,s.gzip_sha,s.gzip_bytes,s.compression,s.manifest,s.engine_approved,s.production_allowed
 FROM guard g LEFT JOIN selected s ON true`;
export type BatchMetadataKey = Readonly<{ schoolId: string; offeringPk: string }>;
export type BatchExpectedHead = Readonly<{
  releaseId: string;
  readbackSha256: string;
  datasetSha256: string;
  manifestSha256: string;
}>;
export type BatchExamContext = Readonly<{
  academicYear: 2027;
  examId: string;
  examType: "september_mock";
  packVersion: string;
}>;
export type BatchMetadataBounds = Readonly<{
  maxBatchBytes: number;
  maxMethodBytes: number;
  maxSourceBytes: number;
}>;
/** Must be a trusted request-scoped transport; this code additionally checks actual tx/role in SQL. */
export interface ReadonlyBatchSql {
  read<T>(
    owner: string,
    work: (tx: NativeSqlTransaction) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T>;
}
export interface BatchMetadataBudget {
  reserveExternalRead(maximumBytes: number): (actualBytes: number) => void;
}
/**
 * Separate runtime authority is NOT supplied. Its synchronous, request-local receipt must already
 * independently prove the actual subject/student ownership, admission/budget, provider identities,
 * selected 2027 exam/pack, school-to-PK scope and approved exact head. It must re-check cancellation,
 * freshness and the same SQL transaction without new I/O; a client string or TypeScript shape is
 * not proof. SQL transport must stop physical work before resolving or rejecting.
 */
export interface BatchMetadataAuthority {
  assertCurrent(
    scope: Readonly<{
      request: ApiExecution;
      boundary: ApiExecutionBoundary;
      owner: string;
      keys: readonly BatchMetadataKey[];
      exam: BatchExamContext;
      head: BatchExpectedHead;
      sql: ReadonlyBatchSql;
      budget: BatchMetadataBudget;
      bounds: BatchMetadataBounds;
      transaction: NativeSqlTransaction | null;
    }>,
  ): true;
}
export type BatchMetadataPin = Readonly<{
  schoolId: string;
  offeringPk: string;
  academicYear: 2027;
  releaseId: string;
  readbackSha256: string;
  datasetSha256: string;
  manifestSha256: string;
  methodId: string;
  methodSha256: string;
  cdfSha256: string;
  gzipSha256: string;
  sourceBytes: number;
  gzipBytes: number;
  method: Readonly<NativeObject>;
  /** The requested stage was authorized independently; CDF bytes have NOT proved its identity. */
  requestedExam: BatchExamContext;
  examAndCdfBindingStatus: "not_verified_until_cdf";
  /** School-to-PK mapping is authority checked; SQL does not select school ID. */
  schoolPkEvidence: "authority_required_not_verified_by_sql";
  /** Metadata was read at a transaction snapshot; later head freshness is not implied. */
  headFreshness: "transaction_snapshot_only";
  engineApproved: false;
  productionAllowed: false;
}>;
export type BatchMetadataResult = Readonly<{
  key: BatchMetadataKey;
  status: "metadata_available" | "pending";
  reason: "reference_metadata_missing_or_bounded" | null;
  pin: BatchMetadataPin | null;
}>;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const METRIC = "estimated_upper_cumulative_percent_all_examinees";
type MetadataOrigin = Readonly<
  {
    request: ApiExecution;
    boundary: ApiExecutionBoundary;
    owner: string;
    signal: AbortSignal;
    admission: unknown;
    budget: BatchMetadataBudget;
    assertActive(): void;
  }
>;
const pinOrigins = new WeakMap<BatchMetadataPin, MetadataOrigin>();
const RELEASE = /^reference-percentile:[0-9a-f]{64}$/;
const METHOD = /^estimated-whole-cohort-percentile:[0-9a-f]{64}$/;
function fail(): never {
  throw new AccessError("reference_source_unavailable", 503);
}
function object(v: unknown): v is NativeObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function integer(v: unknown): number {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,15}$/.test(v)) fail();
  const n = Number(v);
  if (!Number.isSafeInteger(n)) fail();
  return n;
}
function rowBytes(row: readonly unknown[]): number {
  return row.reduce<number>(
    (n, v) => n + (typeof v === "string" ? new TextEncoder().encode(v).byteLength : 0) + 16,
    0,
  );
}
function freezeDeep<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const child of Object.values(v as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(v);
  }
  return v;
}
async function digest(b: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(b)))].map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
}
/** Authority inputs, limits and expected head are server-issued, never copied from client DTOs. */
export async function read2027ReferenceMetadataBatch(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  owner: string,
  input: readonly BatchMetadataKey[],
  examInput: BatchExamContext,
  headInput: BatchExpectedHead,
  bounds: BatchMetadataBounds,
  sql: ReadonlyBatchSql,
  budget: BatchMetadataBudget,
  authority: BatchMetadataAuthority,
): Promise<readonly BatchMetadataResult[]> {
  if (
    !request || !boundary || !boundary.admission || !boundary.signal || boundary.signal.aborted ||
    !UUID.test(owner) || owner !== request.session.user.subjectId || !Array.isArray(input) ||
    !input.length || input.length > 100 ||
    !examInput || examInput.academicYear !== 2027 || examInput.examType !== "september_mock" ||
    !ID.test(examInput.examId) || !ID.test(examInput.packVersion) || !headInput ||
    !RELEASE.test(headInput.releaseId) || !HASH.test(headInput.readbackSha256) ||
    !HASH.test(headInput.datasetSha256) || !HASH.test(headInput.manifestSha256) ||
    headInput.releaseId.slice(21) !== headInput.manifestSha256 || !bounds ||
    !Number.isSafeInteger(bounds.maxBatchBytes) || bounds.maxBatchBytes < 4096 ||
    bounds.maxBatchBytes > 8388608 ||
    !Number.isSafeInteger(bounds.maxMethodBytes) || bounds.maxMethodBytes < 1 ||
    !Number.isSafeInteger(bounds.maxSourceBytes) || bounds.maxSourceBytes < 1 ||
    bounds.maxSourceBytes > 8388608 ||
    !sql || typeof sql.read !== "function" || !budget ||
    typeof budget.reserveExternalRead !== "function" ||
    !authority || typeof authority.assertCurrent !== "function"
  ) fail();
  const seen = new Set<string>();
  const keys = Object.freeze(input.map((k) => {
    if (
      !k || typeof k.schoolId !== "string" || !ID.test(k.schoolId) ||
      typeof k.offeringPk !== "string" || !ID.test(k.offeringPk) || seen.has(k.offeringPk)
    ) fail();
    seen.add(k.offeringPk);
    return Object.freeze({ schoolId: k.schoolId, offeringPk: k.offeringPk });
  }));
  const exam: BatchExamContext = Object.freeze({
    academicYear: 2027,
    examId: examInput.examId,
    examType: "september_mock",
    packVersion: examInput.packVersion,
  });
  const head: BatchExpectedHead = Object.freeze({
    releaseId: headInput.releaseId,
    readbackSha256: headInput.readbackSha256,
    datasetSha256: headInput.datasetSha256,
    manifestSha256: headInput.manifestSha256,
  });
  const limits: BatchMetadataBounds = Object.freeze({
    maxBatchBytes: bounds.maxBatchBytes,
    maxMethodBytes: bounds.maxMethodBytes,
    maxSourceBytes: bounds.maxSourceBytes,
  });
  const signal = boundary.signal,
    admission = boundary.admission,
    subject = request.session.user.subjectId;
  const sqlRead = sql.read, budgetReserve = budget.reserveExternalRead;
  const active = (transaction: NativeSqlTransaction | null) => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.session.user.subjectId !== subject || sql.read !== sqlRead ||
      budget.reserveExternalRead !== budgetReserve
    ) fail();
    if (
      authority.assertCurrent(
        Object.freeze({
          request,
          boundary,
          owner,
          keys,
          exam,
          head,
          sql,
          budget,
          bounds: limits,
          transaction,
        }),
      ) !== true
    ) fail();
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.session.user.subjectId !== subject || sql.read !== sqlRead ||
      budget.reserveExternalRead !== budgetReserve
    ) fail();
  };
  const maxRows = keys.length + 1, perRow = Math.floor(limits.maxBatchBytes / maxRows);
  const methodBound = Math.min(limits.maxMethodBytes, perRow - 2048);
  if (methodBound < 1) fail();
  active(null);
  const settle = budget.reserveExternalRead(limits.maxBatchBytes);
  const rows = await sql.read(owner, async (tx) => {
    active(tx);
    const out = await tx.query(REFERENCE_2027_BATCH_METADATA_SQL, [
      JSON.stringify(keys.map((k) => k.offeringPk)),
      String(methodBound),
      String(maxRows),
    ], signal);
    active(tx);
    return out;
  }, signal);
  active(null);
  if (
    !Array.isArray(rows) || rows.length < 1 || rows.length > maxRows ||
    rows.some((row) => !Array.isArray(row) || row.length !== 24)
  ) fail();
  const used = rows.reduce((sum, row) => sum + rowBytes(row), 0);
  if (!Number.isSafeInteger(used) || used > limits.maxBatchBytes) fail();
  settle(used);
  const byPk = new Map<string, BatchMetadataPin>();
  const byRequest = new Map(keys.map((k) => [k.offeringPk, k]));
  for (const row of rows) {
    if (
      row[0] !== "jungsi_backend_app" || row[1] !== "on" || row[2] !== "on" ||
      row[3] !== false || row[4] !== false || row[5] !== false || row[6] !== false ||
      row[7] !== false
    ) fail();
    const [
      release,
      readback,
      dataset,
      y,
      pk,
      methodId,
      methodSha,
      cdfSha,
      methodText,
      sourceText,
      gzipSha,
      gzipText,
      compression,
      manifest,
      engineApproved,
      productionAllowed,
    ] = row.slice(8);
    // Only the single SQL LEFT JOIN sentinel is accepted as no metadata.
    if (release === null && row.slice(8).every((v) => v === null)) {
      if (rows.length !== 1) fail();
      continue;
    }
    if (
      release !== head.releaseId || readback !== head.readbackSha256 ||
      dataset !== head.datasetSha256 ||
      manifest !== head.manifestSha256 || y !== "2027" || typeof pk !== "string" ||
      !byRequest.has(pk) || byPk.has(pk) ||
      typeof methodId !== "string" || !METHOD.test(methodId) || typeof methodSha !== "string" ||
      !HASH.test(methodSha) ||
      typeof cdfSha !== "string" || !HASH.test(cdfSha) || typeof methodText !== "string" ||
      typeof gzipSha !== "string" || !HASH.test(gzipSha) || compression !== "gzip" ||
      engineApproved !== false || productionAllowed !== false
    ) fail();
    const sourceBytes = integer(sourceText), gzipBytes = integer(gzipText);
    if (sourceBytes > limits.maxSourceBytes || gzipBytes > limits.maxSourceBytes) fail();
    const raw = new TextEncoder().encode(methodText);
    if (raw.length > methodBound || await digest(raw) !== methodSha) fail();
    active(null);
    let method: unknown;
    try {
      method = parseNativeJson(methodText);
    } catch {
      fail();
    }
    if (
      !object(method) || method.method_id !== methodId || method.metric !== METRIC ||
      !object(method.native_score_and_source_definition_metadata) ||
      method.native_score_and_source_definition_metadata.academic_year !== 2027 ||
      method.native_score_and_source_definition_metadata.engine_approved !== false
    ) fail();
    const pin: BatchMetadataPin = Object.freeze({
      schoolId: byRequest.get(pk)!.schoolId,
      offeringPk: pk,
      academicYear: 2027,
      releaseId: head.releaseId,
      readbackSha256: head.readbackSha256,
      datasetSha256: head.datasetSha256,
      manifestSha256: head.manifestSha256,
      methodId,
      methodSha256: methodSha,
      cdfSha256: cdfSha,
      gzipSha256: gzipSha,
      sourceBytes,
      gzipBytes,
      method: freezeDeep(method),
      requestedExam: exam,
      examAndCdfBindingStatus: "not_verified_until_cdf",
      schoolPkEvidence: "authority_required_not_verified_by_sql",
      headFreshness: "transaction_snapshot_only",
      engineApproved: false,
      productionAllowed: false,
    });
    pinOrigins.set(
      pin,
      Object.freeze({
        request,
        boundary,
        owner,
        signal,
        admission,
        budget,
        assertActive: () => active(null),
      }),
    );
    byPk.set(pk, pin);
  }
  active(null);
  return Object.freeze(keys.map((key) => {
    const pin = byPk.get(key.offeringPk);
    return pin
      ? Object.freeze({ key, status: "metadata_available" as const, reason: null, pin })
      : Object.freeze({
        key,
        status: "pending" as const,
        reason: "reference_metadata_missing_or_bounded" as const,
        pin: null,
      });
  }));
}
/** The existing reader must retain the original request budget and signal. */
export interface ExistingCdfHeadCurrentPort {
  assertCurrent(owner: string, pin: ExistingReferenceDbPin, signal: AbortSignal): Promise<void>;
  currentReceipt(
    pin: ExistingReferenceDbPin,
    signal: AbortSignal,
  ): Readonly<{ assertCurrent(): void }>;
}
/** Independent server-only authority. It must prove that this exact head port uses the same
 * request, student, admission, physical budget and approved source; object shape is not proof. */
export interface CdfHeadRecheckAuthority {
  assertAllowed(
    scope: Readonly<
      {
        request: ApiExecution;
        boundary: ApiExecutionBoundary;
        owner: string;
        pin: BatchMetadataPin;
        budget: BatchMetadataBudget;
        headPort: ExistingCdfHeadCurrentPort;
      }
    >,
  ): true;
}
export type RecheckedCdfMetadata = Readonly<{
  pin: BatchMetadataPin;
  /** A short-lived check, not permanent head freshness or approval of CDF/exam bytes. */
  assertCurrent(): void;
}>;
/**
 * Mandatory gate candidate before handing a selected metadata pin to an existing CDF reader.
 * Calls the existing budgeted head-current port and obtains its same-signal expiring receipt.
 * This function does not read CDF bytes, verify exam/CDF compatibility or grant production status.
 * Runtime wiring is not installed: future consumers must explicitly require this gate and still
 * perform the existing CDF hash, pack, score-axis and provenance checks.
 */
export async function recheckMetadataHeadBeforeCdf(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  owner: string,
  pin: BatchMetadataPin,
  headPort: ExistingCdfHeadCurrentPort,
  authority: CdfHeadRecheckAuthority,
): Promise<RecheckedCdfMetadata> {
  const origin = pin && pinOrigins.get(pin);
  if (
    !origin || request !== origin.request || boundary !== origin.boundary ||
    owner !== origin.owner ||
    boundary.signal !== origin.signal || boundary.admission !== origin.admission ||
    boundary.signal.aborted ||
    !headPort || typeof headPort.assertCurrent !== "function" ||
    typeof headPort.currentReceipt !== "function" ||
    !authority || typeof authority.assertAllowed !== "function"
  ) fail();
  const assertAllowed = authority.assertAllowed,
    checkHead = headPort.assertCurrent,
    makeReceipt = headPort.currentReceipt;
  const scope = Object.freeze({ request, boundary, owner, pin, budget: origin.budget, headPort });
  const active = () => {
    if (
      boundary.signal.aborted || boundary.signal !== origin.signal ||
      boundary.admission !== origin.admission ||
      authority.assertAllowed !== assertAllowed || headPort.assertCurrent !== checkHead ||
      headPort.currentReceipt !== makeReceipt
    ) fail();
    origin.assertActive();
    if (authority.assertAllowed(scope) !== true) fail();
    if (boundary.signal.aborted) fail();
  };
  const readerPin: ExistingReferenceDbPin = Object.freeze({
    releaseId: pin.releaseId,
    readbackSha256: pin.readbackSha256,
    datasetSha256: pin.datasetSha256,
    academicYear: pin.academicYear,
    physicalOfferingPk: pin.offeringPk,
    methodId: pin.methodId,
    methodSha256: pin.methodSha256,
    cdfSha256: pin.cdfSha256,
    gzipSha256: pin.gzipSha256,
    sourceBytes: pin.sourceBytes,
    gzipBytes: pin.gzipBytes,
    method: pin.method as NativeObject,
  });
  active();
  await headPort.assertCurrent(owner, readerPin, origin.signal);
  active();
  const receipt = headPort.currentReceipt(readerPin, origin.signal);
  if (!receipt || typeof receipt.assertCurrent !== "function") fail();
  const assertReceipt = receipt.assertCurrent;
  const guarded = () => {
    active();
    if (receipt.assertCurrent !== assertReceipt) fail();
    receipt.assertCurrent();
    active();
  };
  guarded();
  return Object.freeze({ pin, assertCurrent: guarded });
}
