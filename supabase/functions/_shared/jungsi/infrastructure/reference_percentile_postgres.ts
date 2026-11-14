/** Read an existing private reference-percentile head by year and physical offering PK.
 * This reader does not approve the model, grant report access, or write any data. */
import { AccessError } from "../application/access.ts";
import { ReferenceReceiptExpired, ReferenceReceiptInvalidated } from "../application/access.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import type { NativeObject } from "../domain/json_value.ts";
import type { NativeSqlTransaction } from "./transaction_sql.ts";
const HASH = /^[0-9a-f]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const METRIC = "estimated_upper_cumulative_percent_all_examinees";
export const REFERENCE_PK_METADATA_SQL =
  `SELECT h.release_id,h.full_readback_receipt_sha256,h.dataset_fingerprint,
 p.academic_year,p.offering_pk,p.method_id,m.method_row_sha256,m.cdf_source_sha256,m.method_json::text,
 c.source_bytes::text,c.gzip_sha256,c.gzip_bytes::text,c.compression,r.manifest_sha256
 FROM jungsi_data_ingest.reference_percentile_heads_v1 h
 JOIN jungsi_data_ingest.reference_percentile_releases_v1 r ON r.release_id=h.release_id
 JOIN jungsi_data_ingest.reference_percentile_pk_links_v1 p ON p.release_id=h.release_id
 JOIN jungsi_data_ingest.reference_percentile_methods_v1 m ON (m.release_id,m.method_id)=(p.release_id,p.method_id)
 JOIN jungsi_data_ingest.reference_percentile_cdfs_v1 c ON c.source_sha256=m.cdf_source_sha256
 WHERE h.head_name='current' AND p.academic_year=$1 AND p.offering_pk=$2
 AND r.metric='estimated_upper_cumulative_percent_all_examinees' AND NOT r.engine_approved AND NOT r.production_allowed
 AND octet_length(m.method_json) <= $3::integer LIMIT 2`;
export const REFERENCE_CDF_BYTES_SQL =
  `SELECT replace(replace(encode(c.gzip_content,'base64'),E'\\n',''),E'\\r','')
 FROM jungsi_data_ingest.reference_percentile_heads_v1 h
 JOIN jungsi_data_ingest.reference_percentile_pk_links_v1 p ON p.release_id=h.release_id
 JOIN jungsi_data_ingest.reference_percentile_methods_v1 m ON (m.release_id,m.method_id)=(p.release_id,p.method_id)
 JOIN jungsi_data_ingest.reference_percentile_cdfs_v1 c ON c.source_sha256=m.cdf_source_sha256
 WHERE h.head_name='current' AND h.release_id=$1 AND p.academic_year=$2 AND p.offering_pk=$3
 AND m.method_id=$4 AND c.source_sha256=$5 AND c.gzip_sha256=$6 AND c.gzip_bytes=$7::bigint
 AND h.full_readback_receipt_sha256=$8 AND h.dataset_fingerprint=$9 LIMIT 2`;
/** Head-only current check. It reads the existing single current row and never widens access. */
export const REFERENCE_DB_HEAD_SQL =
  `SELECT release_id,full_readback_receipt_sha256,dataset_fingerprint
 FROM jungsi_data_ingest.reference_percentile_heads_v1 WHERE head_name='current' LIMIT 2`;
const HEAD_REUSE_MS = 1500;
type HeadState = {
  signal: AbortSignal;
  startedMs: number;
  result: Promise<readonly unknown[]>;
  verified?: readonly unknown[];
};
type Sql = {
  read<T>(
    owner: string,
    work: (tx: NativeSqlTransaction) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
};
type Budget = { reserveExternalRead(maximumBytes: number): (actualBytes: number) => void };
export interface ExistingReferenceDbPin {
  readonly releaseId: string;
  readonly readbackSha256: string;
  readonly datasetSha256: string;
  readonly academicYear: number;
  readonly physicalOfferingPk: string;
  readonly methodId: string;
  readonly methodSha256: string;
  readonly cdfSha256: string;
  readonly gzipSha256: string;
  readonly sourceBytes: number;
  readonly gzipBytes: number;
  readonly method: NativeObject;
}
function fail(): never {
  throw new AccessError("reference_source_unavailable", 503);
}
function live(s: AbortSignal): void {
  if (!s || s.aborted) fail();
}
function object(v: unknown): v is NativeObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function int(v: unknown): number {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,15}$/.test(v)) fail();
  const n = Number(v);
  if (!Number.isSafeInteger(n)) fail();
  return n;
}
function hash(v: unknown): v is string {
  return typeof v === "string" && HASH.test(v);
}
async function digest(b: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(b)))].map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
}
function rowBytes(row: unknown[]): number {
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
/** Constructor values must be taken from the existing approved binding, not from the request. */
export class ExistingReferencePercentileDbReader {
  private recentHead?: HeadState;
  constructor(
    private readonly sql: Sql,
    private readonly budget: Budget,
    private readonly metadataLimit: number,
    private readonly sourceLimit: number,
    private readonly maxReadBytes: number,
  ) {
    if (
      !sql || typeof sql.read !== "function" || !budget ||
      typeof budget.reserveExternalRead !== "function" ||
      ![metadataLimit, sourceLimit, maxReadBytes].every((v) => Number.isSafeInteger(v) && v > 0) ||
      metadataLimit > maxReadBytes || sourceLimit > 8388608
    ) fail();
  }
  async select(
    owner: string,
    year: number,
    physicalPk: string,
    signal: AbortSignal,
  ): Promise<ExistingReferenceDbPin | null> {
    live(signal);
    if (
      !Number.isSafeInteger(year) || year < 2024 || year > 2027 || !ID.test(physicalPk) ||
      this.metadataLimit <= 2048
    ) fail();
    const settle = this.budget.reserveExternalRead(this.metadataLimit);
    const rows = await this.sql.read(
      owner,
      (tx) =>
        tx.query(REFERENCE_PK_METADATA_SQL, [
          String(year),
          physicalPk,
          String(this.metadataLimit - 2048),
        ], signal),
      signal,
    );
    live(signal);
    if (
      !Array.isArray(rows) || rows.length > 1 ||
      rows.some((r) => !Array.isArray(r) || r.length !== 14)
    ) fail();
    settle(rows.length ? rowBytes(rows[0]) : 0);
    if (!rows.length) return null;
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
    ] = rows[0];
    if (
      typeof release !== "string" || !/^reference-percentile:[0-9a-f]{64}$/.test(release) ||
      !hash(readback) || !hash(dataset) ||
      y !== String(year) || pk !== physicalPk || typeof methodId !== "string" ||
      !/^estimated-whole-cohort-percentile:[0-9a-f]{64}$/.test(methodId) ||
      !hash(methodSha) || !hash(cdfSha) || typeof methodText !== "string" || !hash(gzipSha) ||
      compression !== "gzip" || manifest !== release.slice(21)
    ) fail();
    const sourceBytes = int(sourceText), gzipBytes = int(gzipText);
    if (sourceBytes > this.sourceLimit || gzipBytes > this.sourceLimit) fail();
    const raw = new TextEncoder().encode(methodText);
    if (await digest(raw) !== methodSha) fail();
    live(signal);
    let method: unknown;
    try {
      method = parseNativeJson(methodText);
    } catch {
      fail();
    }
    if (
      !object(method) || method.method_id !== methodId || method.metric !== METRIC ||
      !object(method.native_score_and_source_definition_metadata) ||
      method.native_score_and_source_definition_metadata.academic_year !== year ||
      method.native_score_and_source_definition_metadata.engine_approved !== false
    ) fail();
    return Object.freeze({
      releaseId: release,
      readbackSha256: readback,
      datasetSha256: dataset,
      academicYear: year,
      physicalOfferingPk: physicalPk,
      methodId,
      methodSha256: methodSha,
      cdfSha256: cdfSha,
      gzipSha256: gzipSha,
      sourceBytes,
      gzipBytes,
      method: freezeDeep(method),
    });
  }
  /** Check the same physical head under the existing request budget. Reuse is bounded from the
   * ORIGINAL DB read start; cached reads never extend it. Only the same request signal may reuse. */
  async assertCurrent(
    owner: string,
    pin: ExistingReferenceDbPin,
    signal: AbortSignal,
  ): Promise<void> {
    live(signal);
    const now = performance.now();
    let row = this.recentHead;
    if (!Number.isFinite(now)) fail();
    if (
      !row || row.signal !== signal || now < row.startedMs || now - row.startedMs >= HEAD_REUSE_MS
    ) {
      const settle = this.budget.reserveExternalRead(1024);
      const result = this.sql.read(
        owner,
        (tx) => tx.query(REFERENCE_DB_HEAD_SQL, [], signal),
        signal,
      ).then((rows) => {
        if (
          !Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]) ||
          rows[0].length !== 3
        ) fail();
        settle(rowBytes(rows[0]));
        return rows[0] as readonly unknown[];
      });
      row = { signal, startedMs: now, result };
      this.recentHead = row;
    }
    let head: readonly unknown[];
    try {
      head = await row.result;
    } catch (error) {
      if (this.recentHead === row) this.recentHead = undefined;
      throw error;
    }
    live(signal);
    if (this.recentHead !== row || performance.now() - row.startedMs >= HEAD_REUSE_MS) fail();
    if (
      head[0] !== pin.releaseId || head[1] !== pin.readbackSha256 || head[2] !== pin.datasetSha256
    ) fail();
    row.verified = head;
  }
  /** No I/O after request settlement. Tied to the original successful head check. */
  currentReceipt(
    pin: ExistingReferenceDbPin,
    signal: AbortSignal,
  ): Readonly<{ assertCurrent(): void }> {
    live(signal);
    const row = this.recentHead;
    if (
      !row || row.signal !== signal || !row.verified || row.verified[0] !== pin.releaseId ||
      row.verified[1] !== pin.readbackSha256 || row.verified[2] !== pin.datasetSha256
    ) fail();
    const check = () => {
      live(signal);
      const now = performance.now();
      if (
        !Number.isFinite(now) || now < row.startedMs
      ) fail();
      if (this.recentHead !== row) throw new ReferenceReceiptInvalidated();
      if (now - row.startedMs >= HEAD_REUSE_MS) {
        throw new ReferenceReceiptExpired("reference_source_unavailable");
      }
    };
    check();
    return Object.freeze({ assertCurrent: check });
  }
  async source(
    owner: string,
    pin: ExistingReferenceDbPin,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    live(signal);
    if (
      !pin || !/^reference-percentile:[0-9a-f]{64}$/.test(pin.releaseId) ||
      !hash(pin.readbackSha256) || !hash(pin.datasetSha256) ||
      !Number.isSafeInteger(pin.academicYear) || pin.academicYear < 2024 ||
      pin.academicYear > 2027 || !ID.test(pin.physicalOfferingPk) ||
      !/^estimated-whole-cohort-percentile:[0-9a-f]{64}$/.test(pin.methodId) ||
      !hash(pin.cdfSha256) || !hash(pin.gzipSha256) ||
      !Number.isSafeInteger(pin.sourceBytes) || pin.sourceBytes < 1 ||
      !Number.isSafeInteger(pin.gzipBytes) || pin.gzipBytes < 1 ||
      pin.sourceBytes > this.sourceLimit || pin.gzipBytes > this.sourceLimit
    ) fail();
    const encodedLimit = Math.ceil(pin.gzipBytes / 3) * 4 + 1024;
    if (!Number.isSafeInteger(encodedLimit) || encodedLimit > this.maxReadBytes) fail();
    const settle = this.budget.reserveExternalRead(encodedLimit);
    const rows = await this.sql.read(
      owner,
      (tx) =>
        tx.query(REFERENCE_CDF_BYTES_SQL, [
          pin.releaseId,
          String(pin.academicYear),
          pin.physicalOfferingPk,
          pin.methodId,
          pin.cdfSha256,
          pin.gzipSha256,
          String(pin.gzipBytes),
          pin.readbackSha256,
          pin.datasetSha256,
        ], signal),
      signal,
    );
    live(signal);
    if (
      !Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]) ||
      rows[0].length !== 1 || typeof rows[0][0] !== "string"
    ) fail();
    const encoded = rows[0][0];
    settle(rowBytes(rows[0]));
    if (
      encoded.length !== Math.ceil(pin.gzipBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    ) fail();
    let gzip: Uint8Array;
    try {
      gzip = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    } catch {
      fail();
    }
    if (gzip.length !== pin.gzipBytes || await digest(gzip) !== pin.gzipSha256) fail();
    live(signal);
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
        live(signal);
        const x = await reader.read();
        live(signal);
        if (x.done) break;
        if (x.value.byteLength > pin.sourceBytes - total) fail();
        total += x.value.byteLength;
        chunks.push(x.value);
      }
    } finally {
      signal.removeEventListener("abort", abort);
      if (cancellation) await cancellation;
      reader.releaseLock();
    }
    if (total !== pin.sourceBytes) fail();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.length;
    }
    if (await digest(bytes) !== pin.cdfSha256) fail();
    live(signal);
    return bytes;
  }
}
