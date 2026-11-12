/**
 * Candidate request-local reader for PinnedExistingDbReferenceTailSource.
 * One existing 2027 PK metadata batch, then one bounded SQL read per DISTINCT CDF set.
 * No operational SQL connection, authorization, publication, route or budget is installed.
 */
import { AccessError } from "../application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type { NativeObject } from "../domain/json_value.ts";
import type { ExistingReferenceDbPin } from "./reference_percentile_postgres.ts";
import { PinnedExistingDbReferenceTailSource } from "./native_reference_db_tail.ts";
import type { SavedTailRequestBudget } from "./saved_reference_tail_source.ts";
import {
  type BatchExamContext,
  type BatchExpectedHead,
  type BatchMetadataAuthority,
  type BatchMetadataBounds,
  type BatchMetadataBudget,
  type BatchMetadataKey,
  type BatchMetadataPin,
  read2027ReferenceMetadataBatch,
  type ReadonlyBatchSql,
} from "./reference_percentile_metadata_batch.review-only.ts";

/** SQL binds every selected CDF to a requested, current head PK+method and the existing app role.
 * Guard sentinel distinguishes a missing result from a failed role/RLS check. Variable-length bytes
 * are encoded only after exact gzip size and maximum size constraints. No future tables/rights. */
export const DISTINCT_REFERENCE_CDF_BATCH_SQL = `
WITH guard AS MATERIALIZED (
 SELECT current_user::text AS role_name, current_setting('transaction_read_only') AS tx_read_only,
 current_setting('row_security') AS row_security, role.rolsuper, role.rolbypassrls,
 pg_has_role(current_user,'jungsi_backend_owner','MEMBER') AS owner_member,
 pg_has_role(current_user,'jungsi_backend_owner','USAGE') AS owner_usage,
 pg_has_role(current_user,'postgres','MEMBER') AS postgres_member
 FROM pg_catalog.pg_roles role WHERE role.rolname=current_user
), requested AS MATERIALIZED (
 SELECT * FROM jsonb_to_recordset($1::jsonb) AS q(pk text,method_id text,cdf_sha text,
   gzip_sha text,gzip_bytes bigint,source_bytes bigint)
), selected AS MATERIALIZED (
 SELECT c.source_sha256 AS cdf_sha,c.gzip_sha256 AS gzip_sha,
   c.gzip_bytes::text AS gzip_bytes,c.source_bytes::text AS source_bytes,
   replace(replace(encode(c.gzip_content,'base64'),E'\\n',''),E'\\r','') AS content
 FROM guard g CROSS JOIN requested q
 JOIN jungsi_data_ingest.reference_percentile_heads_v1 h ON h.head_name='current'
 JOIN jungsi_data_ingest.reference_percentile_releases_v1 r ON r.release_id=h.release_id
 JOIN jungsi_data_ingest.reference_percentile_pk_links_v1 p ON p.release_id=h.release_id
   AND p.academic_year=2027 AND p.offering_pk=q.pk
 JOIN jungsi_data_ingest.reference_percentile_methods_v1 m ON (m.release_id,m.method_id)=(p.release_id,p.method_id)
   AND m.method_id=q.method_id AND m.cdf_source_sha256=q.cdf_sha
 JOIN jungsi_data_ingest.reference_percentile_cdfs_v1 c ON c.source_sha256=m.cdf_source_sha256
   AND c.gzip_sha256=q.gzip_sha AND c.gzip_bytes=q.gzip_bytes AND c.source_bytes=q.source_bytes
 WHERE g.role_name='jungsi_backend_app' AND g.tx_read_only='on' AND g.row_security='on'
   AND NOT g.rolsuper AND NOT g.rolbypassrls AND NOT g.owner_member AND NOT g.owner_usage AND NOT g.postgres_member
   AND h.release_id=$2 AND h.full_readback_receipt_sha256=$3 AND h.dataset_fingerprint=$4
   AND r.manifest_sha256=$5 AND r.metric='estimated_upper_cumulative_percent_all_examinees'
   AND NOT r.engine_approved AND NOT r.production_allowed AND c.compression='gzip'
   AND c.gzip_bytes > 0 AND c.gzip_bytes <= $6::bigint AND octet_length(c.gzip_content)=c.gzip_bytes
 LIMIT $7::integer
)
SELECT g.role_name,g.tx_read_only,g.row_security,g.rolsuper,g.rolbypassrls,
 g.owner_member,g.owner_usage,g.postgres_member,s.cdf_sha,s.gzip_sha,s.gzip_bytes,s.source_bytes,s.content
 FROM guard g LEFT JOIN selected s ON true`;

export interface CdfBatchHeadPort {
  assertCurrent(owner: string, pin: ExistingReferenceDbPin, signal: AbortSignal): Promise<void>;
  currentReceipt(
    pin: ExistingReferenceDbPin,
    signal: AbortSignal,
  ): Readonly<{ assertCurrent(): void }>;
}
/** A trusted request-local authority verifies ownership, request admission, real budget/transport,
 * scope, exact metadata/head and same examined model. Return true synchronously only after its
 * separately verified authority receipt is issued. No input hash or shape is authority. */
export interface CdfBatchAuthority {
  assertCurrent(
    scope: Readonly<
      {
        request: ApiExecution;
        boundary: ApiExecutionBoundary;
        owner: string;
        pins: readonly BatchMetadataPin[];
        head: BatchExpectedHead;
        sql: ReadonlyBatchSql;
        budget: BatchMetadataBudget;
        headPort: CdfBatchHeadPort;
      }
    >,
  ): true;
}
export type CdfBatchLimits = Readonly<{
  maxDistinctCdfs: number;
  maxGzipBytes: number;
  maxDecodedBytes: number;
  maxEncodedReadBytes: number;
}>;
export type CdfBatchInputs = Readonly<{
  request: ApiExecution;
  boundary: ApiExecutionBoundary;
  owner: string;
  keys: readonly BatchMetadataKey[];
  exam: BatchExamContext;
  head: BatchExpectedHead;
  metadataBounds: BatchMetadataBounds;
  limits: CdfBatchLimits;
  sql: ReadonlyBatchSql;
  budget: BatchMetadataBudget;
  metadataAuthority: BatchMetadataAuthority;
  headPort: CdfBatchHeadPort;
  authority: CdfBatchAuthority;
}>;
const HASH = /^[a-f0-9]{64}$/;
function fail(): never {
  throw new AccessError("reference_source_unavailable", 503);
}
async function sha(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))].map((
    b,
  ) => b.toString(16).padStart(2, "0")).join("");
}
function byteCount(row: readonly unknown[]): number {
  return row.reduce<number>(
    (n, v) => n + (typeof v === "string" ? new TextEncoder().encode(v).byteLength : 0) + 16,
    0,
  );
}
function integer(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/.test(value)) fail();
  const n = Number(value);
  if (!Number.isSafeInteger(n)) fail();
  return n;
}
async function inflate(
  gzip: Uint8Array,
  pin: BatchMetadataPin,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (signal.aborted) fail();
  const reader = new Blob([Uint8Array.from(gzip)]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  ).getReader();
  let cancellation: Promise<unknown> | undefined;
  const abort = () => {
    cancellation ??= reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) fail();
      const v = await reader.read();
      if (signal.aborted) fail();
      if (v.done) break;
      if (v.value.byteLength > pin.sourceBytes - total) fail();
      total += v.value.byteLength;
      chunks.push(v.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (cancellation) await cancellation;
    reader.releaseLock();
  }
  if (total !== pin.sourceBytes) fail();
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    result.set(part, offset);
    offset += part.length;
  }
  if (await sha(result) !== pin.cdfSha256 || signal.aborted) fail();
  return result;
}
/** Structural method signatures match PinnedExistingDbReferenceTailSource's existing Reader port. */
export class BatchedExistingReferenceDbReader {
  private readonly byPk = new Map<string, ExistingReferenceDbPin>();
  private readonly origins = new WeakMap<ExistingReferenceDbPin, BatchMetadataPin>();
  private readonly pins: readonly BatchMetadataPin[];
  private readonly representatives: readonly BatchMetadataPin[];
  private readonly scope: Parameters<CdfBatchAuthority["assertCurrent"]>[0];
  private readonly signal: AbortSignal;
  private readonly admission: unknown;
  private readonly session: ApiExecution["session"];
  private readonly user: ApiExecution["session"]["user"];
  private readonly assertAuthority: CdfBatchAuthority["assertCurrent"];
  private contentFlight: Promise<ReadonlyMap<string, Uint8Array>> | undefined;
  private constructor(private readonly input: CdfBatchInputs, pins: readonly BatchMetadataPin[]) {
    this.signal = input.boundary.signal;
    this.admission = input.boundary.admission;
    this.session = input.request.session;
    this.user = this.session.user;
    this.assertAuthority = input.authority.assertCurrent;
    this.pins = Object.freeze([...pins]);
    const unique = new Map<string, BatchMetadataPin>();
    for (const pin of this.pins) {
      if (!HASH.test(pin.cdfSha256) || !HASH.test(pin.gzipSha256)) fail();
      const old = unique.get(pin.cdfSha256);
      if (
        old &&
        (old.gzipSha256 !== pin.gzipSha256 || old.gzipBytes !== pin.gzipBytes ||
          old.sourceBytes !== pin.sourceBytes)
      ) fail();
      if (!old) unique.set(pin.cdfSha256, pin);
      const db: ExistingReferenceDbPin = Object.freeze({
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
      if (this.byPk.has(pin.offeringPk)) fail();
      this.byPk.set(pin.offeringPk, db);
      this.origins.set(db, pin);
    }
    this.representatives = Object.freeze([...unique.values()]);
    if (this.representatives.length > input.limits.maxDistinctCdfs) fail();
    this.scope = Object.freeze({
      request: input.request,
      boundary: input.boundary,
      owner: input.owner,
      pins: this.pins,
      head: input.head,
      sql: input.sql,
      budget: input.budget,
      headPort: input.headPort,
    });
    this.active();
  }
  static async create(input: CdfBatchInputs): Promise<BatchedExistingReferenceDbReader> {
    const l = input?.limits;
    if (
      !input || !l || ![l.maxDistinctCdfs, l.maxGzipBytes, l.maxDecodedBytes, l.maxEncodedReadBytes]
        .every((v) => Number.isSafeInteger(v) && v > 0) ||
      l.maxDistinctCdfs > 100 ||
      l.maxGzipBytes > 8388608 || l.maxDecodedBytes > 40 * 1024 * 1024 ||
      l.maxEncodedReadBytes > 40 * 1024 * 1024 ||
      !input.headPort || typeof input.headPort.assertCurrent !== "function" ||
      typeof input.headPort.currentReceipt !== "function" || !input.authority ||
      typeof input.authority.assertCurrent !== "function"
    ) fail();
    const stable: CdfBatchInputs = Object.freeze({
      ...input,
      keys: Object.freeze(
        input.keys.map((k) => Object.freeze({ schoolId: k.schoolId, offeringPk: k.offeringPk })),
      ),
      exam: Object.freeze({ ...input.exam }),
      head: Object.freeze({ ...input.head }),
      metadataBounds: Object.freeze({ ...input.metadataBounds }),
      limits: Object.freeze({ ...input.limits }),
    });
    const rows = await read2027ReferenceMetadataBatch(
      stable.request,
      stable.boundary,
      stable.owner,
      stable.keys,
      stable.exam,
      stable.head,
      stable.metadataBounds,
      stable.sql,
      stable.budget,
      stable.metadataAuthority,
    );
    return new BatchedExistingReferenceDbReader(stable, rows.flatMap((r) => r.pin ? [r.pin] : []));
  }
  private active(): void {
    if (
      !this.input.boundary || !this.admission || !this.signal || this.signal.aborted ||
      this.input.boundary.admission !== this.admission ||
      this.input.boundary.signal !== this.signal ||
      this.input.request.session !== this.session || this.session.user !== this.user ||
      this.user.subjectId !== this.input.owner ||
      this.input.authority.assertCurrent !== this.assertAuthority ||
      this.input.authority.assertCurrent(this.scope) !== true || this.signal.aborted
    ) fail();
  }
  private original(
    owner: string,
    pin: ExistingReferenceDbPin,
    signal: AbortSignal,
  ): BatchMetadataPin {
    this.active();
    const original = this.origins.get(pin);
    if (owner !== this.input.owner || signal !== this.signal || !original) fail();
    return original;
  }
  select(
    owner: string,
    year: number,
    pk: string,
    signal: AbortSignal,
  ): Promise<ExistingReferenceDbPin | null> {
    return guardedPromise(() => {
      this.active();
      if (owner !== this.input.owner || year !== 2027 || signal !== this.signal) fail();
      return this.byPk.get(pk) ?? null;
    });
  }
  async assertCurrent(
    owner: string,
    pin: ExistingReferenceDbPin,
    signal: AbortSignal,
  ): Promise<void> {
    this.original(owner, pin, signal);
    await this.input.headPort.assertCurrent(owner, pin, signal);
    this.active();
  }
  currentReceipt(
    pin: ExistingReferenceDbPin,
    signal: AbortSignal,
  ): Readonly<{ assertCurrent(): void }> {
    this.original(this.input.owner, pin, signal);
    const receipt = this.input.headPort.currentReceipt(pin, signal);
    if (!receipt || typeof receipt.assertCurrent !== "function") fail();
    return Object.freeze({
      assertCurrent: () => {
        this.original(this.input.owner, pin, signal);
        receipt.assertCurrent();
        this.active();
      },
    });
  }
  async source(
    owner: string,
    pin: ExistingReferenceDbPin,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    this.original(owner, pin, signal);
    this.contentFlight ??= this.loadDistinct();
    const all = await this.contentFlight;
    this.original(owner, pin, signal);
    const value = all.get(pin.cdfSha256);
    if (!value) fail();
    await this.assertCurrent(owner, pin, signal);
    this.original(owner, pin, signal);
    return Uint8Array.from(value);
  }
  private async loadDistinct(): Promise<ReadonlyMap<string, Uint8Array>> {
    this.active();
    const pins = this.representatives;
    if (!pins.length) return new Map();
    const encodedLimit = pins.reduce((n, p) => n + Math.ceil(p.gzipBytes / 3) * 4 + 1024, 0);
    const decodedLimit = pins.reduce((n, p) => n + p.sourceBytes, 0);
    if (
      !Number.isSafeInteger(encodedLimit) || !Number.isSafeInteger(decodedLimit) ||
      encodedLimit > this.input.limits.maxEncodedReadBytes ||
      decodedLimit > this.input.limits.maxDecodedBytes ||
      pins.some((p) => p.gzipBytes > this.input.limits.maxGzipBytes)
    ) fail();
    const first = this.byPk.get(pins[0].offeringPk)!;
    await this.assertCurrent(this.input.owner, first, this.signal);
    this.active();
    const selected = pins.map((p) => ({
      pk: p.offeringPk,
      method_id: p.methodId,
      cdf_sha: p.cdfSha256,
      gzip_sha: p.gzipSha256,
      gzip_bytes: p.gzipBytes,
      source_bytes: p.sourceBytes,
    }));
    const settle = this.input.budget.reserveExternalRead(encodedLimit);
    const rows = await this.input.sql.read(
      this.input.owner,
      (tx) =>
        tx.query(DISTINCT_REFERENCE_CDF_BATCH_SQL, [
          JSON.stringify(selected),
          this.input.head.releaseId,
          this.input.head.readbackSha256,
          this.input.head.datasetSha256,
          this.input.head.manifestSha256,
          String(this.input.limits.maxGzipBytes),
          String(pins.length + 1),
        ], this.signal),
      this.signal,
    );
    this.active();
    if (
      !Array.isArray(rows) || rows.length !== pins.length ||
      rows.some((r) => !Array.isArray(r) || r.length !== 13)
    ) fail();
    const used = rows.reduce((n, r) => n + byteCount(r), 0);
    if (!Number.isSafeInteger(used) || used > encodedLimit) fail();
    settle(used);
    const bySha = new Map(pins.map((p) => [p.cdfSha256, p]));
    const found = new Map<string, Uint8Array>();
    for (const row of rows) {
      if (
        row[0] !== "jungsi_backend_app" || row[1] !== "on" || row[2] !== "on" ||
        row[3] !== false || row[4] !== false || row[5] !== false || row[6] !== false ||
        row[7] !== false
      ) fail();
      const [cdf, gzipSha, gzipText, sourceText, encoded] = row.slice(8);
      if (
        typeof cdf !== "string" || !bySha.has(cdf) || found.has(cdf) || typeof encoded !== "string"
      ) fail();
      const pin = bySha.get(cdf)!;
      if (
        gzipSha !== pin.gzipSha256 || integer(gzipText) !== pin.gzipBytes ||
        integer(sourceText) !== pin.sourceBytes ||
        encoded.length !== Math.ceil(pin.gzipBytes / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
      ) fail();
      let gzip: Uint8Array;
      try {
        gzip = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      } catch {
        fail();
      }
      if (gzip.length !== pin.gzipBytes || await sha(gzip) !== pin.gzipSha256) fail();
      this.active();
      found.set(cdf, await inflate(gzip, pin, this.signal));
      this.active();
    }
    await this.assertCurrent(this.input.owner, first, this.signal);
    this.active();
    return found;
  }
}
/**
 * Concrete adapter to the existing NativeReferenceTailSelection consumer. All selections still
 * pass the existing issuer's source digest, per-offering method, identity, compatibility and
 * currentness checks. SQL reads are batched; the external selection authority may have its own
 * I/O, which this factory does not claim to batch. No issuer is created or trusted by its shape.
 */
export async function createBatchedExistingReferenceTailSource(
  input: CdfBatchInputs,
  authority: ConstructorParameters<typeof PinnedExistingDbReferenceTailSource>[1],
  maxObjects: number,
  maxBytes: number,
  sharedBudget?: SavedTailRequestBudget,
): Promise<
  Readonly<{ reader: BatchedExistingReferenceDbReader; tail: PinnedExistingDbReferenceTailSource }>
> {
  const reader = await BatchedExistingReferenceDbReader.create(input);
  const signal = input.boundary.signal;
  const resolve = (candidate?: AbortSignal) => {
    if (signal.aborted || candidate && candidate !== signal || candidate?.aborted) fail();
    return signal;
  };
  const tail = new PinnedExistingDbReferenceTailSource(
    input.owner,
    authority,
    reader,
    signal,
    resolve,
    maxObjects,
    maxBytes,
    sharedBudget,
  );
  return Object.freeze({ reader, tail });
}

/** Execute synchronous guards immediately while retaining Promise rejection semantics. */
function guardedPromise<T>(work: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      resolve(work());
    } catch (error) {
      reject(error);
    }
  });
}
