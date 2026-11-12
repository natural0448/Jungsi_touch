/**
 * REVIEW ONLY: private R2 immutable generation + conditional control-object publication.
 * No R2 binding, student authority, API or durable scheduler is installed by this module.
 * Conditional object writes do NOT form a distributed transaction with the profile DB.
 * A changed fingerprint must make reads pending; control metadata is never a public DTO.
 */
import { AccessError } from "../application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type {
  StudentCachePrivateReadPort,
  StudentCacheReadGrant,
  StudentCacheReadHead,
} from "../application/student_score_cache_read_candidate.ts";
import {
  validateStudentCacheFiveFields,
  validateStudentCachePins,
} from "../application/student_score_cache_bounded_workflow_candidate.ts";
import { parseNativeJson } from "../domain/native_json.ts";

type Metadata = Readonly<{ key: string; version: string; size: number; httpEtag: string }>;
type Body = Metadata & Readonly<{ body: ReadableStream<Uint8Array> }>;
/** The subset of the documented Worker R2 API used by this server-only adapter. */
export interface StudentControlR2 {
  head(key: string): Promise<Metadata | null>;
  get(key: string): Promise<Body | null>;
  put(
    key: string,
    value: Uint8Array,
    options: Readonly<{
      onlyIf: Headers;
      httpMetadata: Readonly<{ contentType: string; cacheControl: string }>;
    }>,
  ): Promise<Metadata | null>;
}
/**
 * Must be implemented independently using the real verified session, RLS/server authority,
 * current student/profile, all 2027 source pins, requested scope and physical budget.
 * Student UUID is not assumed to equal the login subject. Caller input, names or hashes
 * alone are not authority; every promise must settle only after its physical I/O stops.
 */
export interface StudentControlAuthority {
  /** Return stale only after authenticating the user/student and proving a changed source;
   * permission failures and unavailable authority must throw rather than become pending. */
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
    bucket: StudentControlR2,
  ): Promise<"current" | "stale">;
  trustedName(grant: StudentCacheReadGrant, signal: AbortSignal): Promise<string>;
  /** Bounded whole-scope verification, never a per-offering DB query. */
  verifyCoverage(
    grant: StudentCacheReadGrant,
    keys: readonly Readonly<{ 학교PK: string; 모집행PK: string }>[],
    signal: AbortSignal,
  ): Promise<string>;
  /** Must prove all R2/authority I/O has stopped even on abort or uncertain responses. */
  awaitQuiescence(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
    bucket: StudentControlR2,
  ): Promise<boolean>;
}
type JobPhase = "captured" | "writing_payload" | "writing_control" | "committed";
type Job = Readonly<{
  format: "jungsi.student-cache-job/v1";
  jobId: string;
  nonce: string;
  studentId: string;
  phase: JobPhase;
  grantSha256: string;
  nameSha256: string;
  capturedControlEtag: string | null;
  capturedControlVersion: string | null;
  capturedControlNonce: string | null;
  generation: string | null;
  controlNonce: string | null;
  payloadKey: string | null;
  payloadVersion: string | null;
  payloadSha256: string | null;
  payloadBytes: number | null;
  coverageSha256: string | null;
}>;
type Control = Readonly<{
  format: "jungsi.student-cache-control/v1";
  nonce: string;
  generation: string;
  studentId: string;
  profileId: string;
  reportId: string | null;
  reportRevision: number | null;
  academicYear: 2027;
  payloadKey: string;
  payloadVersion: string;
  payloadSha256: string;
  payloadBytes: number;
  coverageSha256: string;
  totalRows: number;
  pins: StudentCacheReadGrant["pins"];
  nameSha256: string;
}>;
type Loaded<T> = Readonly<{ object: Metadata; value: T }>;
export type StudentCacheCaptureResult = Readonly<
  { state: "captured" | "pending" | "unknown"; jobId: string }
>;
export type StudentCacheCommitResult = Readonly<
  { state: "committed" | "pending" | "conflict" | "unknown" }
>;
/** Read-only observation, not a retry authorization or proof that another worker stopped. */
export type StudentCacheReceiptResult = Readonly<{
  state:
    | "captured"
    | "payload_observed"
    | "control_observed_current"
    | "committed_not_current"
    | "pending"
    | "unknown";
}>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ETAG = /^"[\x21\x23-\x7e]{1,200}"$/;
const PIN_FIELDS = [
  "profileSha256",
  "examSha256",
  "sourceSha256",
  "ruleSha256",
  "engineSha256",
  "cdfSha256",
  "tiePolicySha256",
  "relationSha256",
  "attendanceSha256",
  "policySha256",
  "scopeSha256",
] as const;
const JOB_FIELDS = [
  "format",
  "jobId",
  "nonce",
  "studentId",
  "phase",
  "grantSha256",
  "nameSha256",
  "capturedControlEtag",
  "capturedControlVersion",
  "capturedControlNonce",
  "generation",
  "controlNonce",
  "payloadKey",
  "payloadVersion",
  "payloadSha256",
  "payloadBytes",
  "coverageSha256",
] as const;
const CONTROL_FIELDS = [
  "format",
  "nonce",
  "generation",
  "studentId",
  "profileId",
  "reportId",
  "reportRevision",
  "academicYear",
  "payloadKey",
  "payloadVersion",
  "payloadSha256",
  "payloadBytes",
  "coverageSha256",
  "totalRows",
  "pins",
  "nameSha256",
] as const;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
class StudentCacheSourceStale extends Error {}
function active(signal: AbortSignal): void {
  if (!signal || signal.aborted) fail();
}
function data(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) fail();
  const own = Reflect.ownKeys(value);
  if (
    own.length !== fields.length || own.some((k) => typeof k !== "string" || !fields.includes(k))
  ) fail();
  for (const k of own) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d || !d.enumerable || !("value" in d)) fail();
  }
  return value as Record<string, unknown>;
}
function prefixOf(prefix: string): string {
  if (
    typeof prefix !== "string" || prefix.length > 256 || prefix.startsWith("/") ||
    !prefix.endsWith("/") ||
    prefix.slice(0, -1).split("/").some((v) => !/^[A-Za-z0-9_-]+$/.test(v))
  ) fail();
  return prefix;
}
function filename(studentId: string, name: string): string {
  if (
    !UUID.test(studentId) || typeof name !== "string" || !name || name.length > 100 ||
    containsUnsafeAscii(name, "\\/")
  ) fail();
  try {
    encodeURIComponent(name);
  } catch {
    return fail();
  }
  return `${studentId}_${name}.json`;
}
function grantCopy(value: StudentCacheReadGrant): StudentCacheReadGrant {
  if (
    !value || !UUID.test(value.studentId) || typeof value.profileId !== "string" ||
    !ID.test(value.profileId) ||
    !(value.reportId === null && value.reportRevision === null ||
      typeof value.reportId === "string" &&
        ID.test(value.reportId) && Number.isSafeInteger(value.reportRevision) &&
        (value.reportRevision as number) >= 1) ||
    value.academicYear !== 2027 || !Number.isSafeInteger(value.totalRows) || value.totalRows < 1 ||
    !Number.isSafeInteger(value.maxRows) || value.maxRows < value.totalRows ||
    value.maxRows > 100000 ||
    !Number.isSafeInteger(value.maxBytes) || value.maxBytes < 1 || value.maxBytes > 67108864
  ) fail();
  return Object.freeze({
    studentId: value.studentId,
    profileId: value.profileId,
    reportId: value.reportId,
    reportRevision: value.reportRevision,
    academicYear: 2027,
    totalRows: value.totalRows,
    maxRows: value.maxRows,
    maxBytes: value.maxBytes,
    pins: validateStudentCachePins(value.pins),
  });
}
async function sha(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))].map((
    v,
  ) => v.toString(16).padStart(2, "0")).join("");
}
async function grantHash(grant: StudentCacheReadGrant): Promise<string> {
  return await sha(
    new TextEncoder().encode(
      JSON.stringify([
        grant.studentId,
        grant.profileId,
        grant.reportId,
        grant.reportRevision,
        grant.academicYear,
        grant.totalRows,
        grant.maxRows,
        grant.maxBytes,
        PIN_FIELDS.map((name) => [name, grant.pins[name]]),
      ]),
    ),
  );
}
function ensureMetadata(obj: Metadata, key: string, limit: number): void {
  if (
    !obj || obj.key !== key || typeof obj.version !== "string" || !ID.test(obj.version) ||
    typeof obj.httpEtag !== "string" || !ETAG.test(obj.httpEtag) ||
    !Number.isSafeInteger(obj.size) || obj.size < 1 || obj.size > limit
  ) fail();
}
async function bytesOf(
  obj: Body,
  key: string,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  try {
    ensureMetadata(obj, key, limit);
  } catch {
    // An unusable R2 response can still hold an open body; stop it before returning.
    if (obj?.body) await obj.body.cancel();
    return fail();
  }
  if (!obj.body || typeof obj.body.getReader !== "function") fail();
  const reader = obj.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, complete = false, cancel: Promise<boolean> | null = null;
  const abort = () => {
    cancel ??= reader.cancel().then(() => true, () => false);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    for (;;) {
      active(signal);
      const item = await reader.read();
      active(signal);
      if (item.done) {
        complete = true;
        break;
      }
      if (
        !(item.value instanceof Uint8Array) || !item.value.byteLength ||
        (size += item.value.byteLength) > obj.size || size > limit
      ) fail();
      chunks.push(Uint8Array.from(item.value));
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (!complete) abort();
    if (cancel && !await cancel) fail();
    reader.releaseLock();
  }
  if (size !== obj.size) fail();
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
function decode(bytes: Uint8Array): unknown {
  try {
    return parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail();
  }
}
function parseJob(value: unknown, studentId: string, jobId: string, prefix: string): Job {
  const o = data(value, JOB_FIELDS);
  if (
    o.format !== "jungsi.student-cache-job/v1" || o.jobId !== jobId || !UUID.test(jobId) ||
    o.studentId !== studentId || typeof o.nonce !== "string" || !UUID.test(o.nonce) ||
    !["captured", "writing_payload", "writing_control", "committed"].includes(String(o.phase)) ||
    typeof o.grantSha256 !== "string" || !HASH.test(o.grantSha256) ||
    typeof o.nameSha256 !== "string" || !HASH.test(o.nameSha256) ||
    !(o.capturedControlEtag === null ||
      typeof o.capturedControlEtag === "string" && ETAG.test(o.capturedControlEtag)) ||
    !(o.capturedControlVersion === null ||
      typeof o.capturedControlVersion === "string" && ID.test(o.capturedControlVersion)) ||
    !(o.capturedControlNonce === null ||
      typeof o.capturedControlNonce === "string" && UUID.test(o.capturedControlNonce)) ||
    ((o.capturedControlEtag === null) !== (o.capturedControlVersion === null)) ||
    ((o.capturedControlEtag === null) !== (o.capturedControlNonce === null))
  ) fail();
  if (o.phase === "captured") {
    if (
      [
        o.generation,
        o.controlNonce,
        o.payloadKey,
        o.payloadVersion,
        o.payloadSha256,
        o.payloadBytes,
        o.coverageSha256,
      ].some((v) => v !== null)
    ) fail();
  } else {
    if (
      typeof o.generation !== "string" || !UUID.test(o.generation) ||
      typeof o.controlNonce !== "string" || !UUID.test(o.controlNonce) ||
      typeof o.payloadKey !== "string" ||
      (o.phase === "writing_payload"
        ? o.payloadVersion !== null
        : typeof o.payloadVersion !== "string" || !ID.test(o.payloadVersion)) ||
      typeof o.payloadSha256 !== "string" || !HASH.test(o.payloadSha256) ||
      !Number.isSafeInteger(o.payloadBytes) || (o.payloadBytes as number) < 1 ||
      typeof o.coverageSha256 !== "string" || !HASH.test(o.coverageSha256)
    ) fail();
    const directory = `${prefix}students/${studentId}/generations/${o.generation}/`;
    if (!(o.payloadKey as string).startsWith(directory)) fail();
    const basename = (o.payloadKey as string).slice(directory.length);
    if (
      !basename.startsWith(`${studentId}_`) || !basename.endsWith(".json") ||
      basename.includes("/") ||
      containsUnsafeAscii(basename, "\\")
    ) fail();
  }
  return Object.freeze(o) as unknown as Job;
}
function parseControl(value: unknown, studentId: string, prefix: string): Control {
  const o = data(value, CONTROL_FIELDS);
  if (
    o.format !== "jungsi.student-cache-control/v1" || typeof o.nonce !== "string" ||
    !UUID.test(o.nonce) ||
    typeof o.generation !== "string" || !UUID.test(o.generation) || o.studentId !== studentId ||
    typeof o.profileId !== "string" || !ID.test(o.profileId) ||
    !(o.reportId === null && o.reportRevision === null ||
      typeof o.reportId === "string" && ID.test(o.reportId) &&
        Number.isSafeInteger(o.reportRevision) && (o.reportRevision as number) >= 1) ||
    o.academicYear !== 2027 ||
    typeof o.payloadKey !== "string" ||
    !o.payloadKey.startsWith(`${prefix}students/${studentId}/generations/${o.generation}/`) ||
    !o.payloadKey.endsWith(".json") || containsUnsafeAscii(o.payloadKey, "\\") ||
    typeof o.payloadVersion !== "string" || !ID.test(o.payloadVersion) ||
    typeof o.payloadSha256 !== "string" || !HASH.test(o.payloadSha256) ||
    !Number.isSafeInteger(o.payloadBytes) || (o.payloadBytes as number) < 1 ||
    (o.payloadBytes as number) > 67108864 ||
    typeof o.coverageSha256 !== "string" || !HASH.test(o.coverageSha256) ||
    !Number.isSafeInteger(o.totalRows) || (o.totalRows as number) < 1 ||
    (o.totalRows as number) > 100000 ||
    typeof o.nameSha256 !== "string" || !HASH.test(o.nameSha256)
  ) fail();
  const directory = `${prefix}students/${studentId}/generations/${o.generation}/`;
  const basename = (o.payloadKey as string).slice(directory.length);
  if (
    !basename.startsWith(`${studentId}_`) || basename.includes("/") ||
    basename.length <= studentId.length + 6
  ) fail();
  return Object.freeze({ ...o, pins: validateStudentCachePins(o.pins) }) as unknown as Control;
}
/** Exactly one request/worker invocation owns each instance; never expose its paths or jobs. */
export class StudentCacheR2ControlCandidate {
  private readonly prefix: string;
  constructor(
    private readonly bucket: StudentControlR2,
    private readonly authority: StudentControlAuthority,
    prefix: string,
  ) {
    if (
      !bucket || typeof bucket.get !== "function" || typeof bucket.head !== "function" ||
      typeof bucket.put !== "function" ||
      !authority || typeof authority.assertCurrent !== "function" ||
      typeof authority.trustedName !== "function" ||
      typeof authority.verifyCoverage !== "function" ||
      typeof authority.awaitQuiescence !== "function"
    ) fail();
    this.prefix = prefixOf(prefix);
  }
  private controlKey(studentId: string): string {
    return `${this.prefix}students/${studentId}/control.json`;
  }
  /** Each phase is a distinct create-only private receipt. No previous receipt is overwritten. */
  private jobKey(studentId: string, jobId: string, phase: JobPhase): string {
    return `${this.prefix}students/${studentId}/jobs/${jobId}/${phase}.json`;
  }
  private async current(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
  ): Promise<void> {
    if (!request || !boundary?.admission || !boundary.signal) fail();
    const signal = boundary.signal,
      admission = boundary.admission,
      session = request.session,
      subject = session?.user?.subjectId;
    if (typeof subject !== "string" || !UUID.test(subject)) fail();
    active(signal);
    const state = await this.authority.assertCurrent(request, boundary, grant, this.bucket);
    if (
      boundary.signal !== signal || boundary.admission !== admission ||
      request.session !== session ||
      request.session.user.subjectId !== subject
    ) fail();
    active(signal);
    if (state === "stale") throw new StudentCacheSourceStale();
    if (state !== "current") fail();
  }
  private async done(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
  ): Promise<void> {
    try {
      if (await this.authority.awaitQuiescence(request, boundary, grant, this.bucket) === true) {
        return;
      }
    } catch { /* Unproved physical termination cannot release the request budget. */ }
    await new Promise<never>(() => {});
  }
  private async load<T>(
    key: string,
    parse: (v: unknown) => T,
    signal: AbortSignal,
  ): Promise<Loaded<T> | null> {
    active(signal);
    const obj = await this.bucket.get(key);
    if (obj === null) {
      active(signal);
      return null;
    }
    const bytes = await bytesOf(obj, key, 32768, signal);
    return Object.freeze({
      object: Object.freeze({
        key: obj.key,
        version: obj.version,
        size: obj.size,
        httpEtag: obj.httpEtag,
      }),
      value: parse(decode(bytes)),
    });
  }
  private async putJson(
    key: string,
    value: Job | Control,
    previous: string | null,
  ): Promise<Metadata | null> {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.byteLength < 1 || bytes.byteLength > 32768) fail();
    const onlyIf = new Headers();
    if (previous === null) onlyIf.set("If-None-Match", "*");
    else {
      if (!ETAG.test(previous)) fail();
      onlyIf.set("If-Match", previous);
    }
    const saved = await this.bucket.put(key, bytes, {
      onlyIf,
      httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    });
    if (saved !== null) ensureMetadata(saved, key, 32768);
    return saved;
  }
  /** Capture control ETag BEFORE calculation and persist it in a private create-once job. */
  async capture(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    input: StudentCacheReadGrant,
  ): Promise<StudentCacheCaptureResult> {
    if (!request || !boundary?.admission || !boundary.signal) fail();
    const grant = grantCopy(input), signal = boundary.signal, jobId = crypto.randomUUID();
    try {
      await this.current(request, boundary, grant);
      const name = await this.authority.trustedName(grant, signal);
      filename(grant.studentId, name);
      const nameSha256 = await sha(new TextEncoder().encode(name)),
        grantSha256 = await grantHash(grant);
      const previous = await this.load(
        this.controlKey(grant.studentId),
        (v) => parseControl(v, grant.studentId, this.prefix),
        signal,
      );
      await this.current(request, boundary, grant);
      if (await grantHash(grantCopy(input)) !== grantSha256) fail();
      const job: Job = Object.freeze({
        format: "jungsi.student-cache-job/v1",
        jobId,
        nonce: crypto.randomUUID(),
        studentId: grant.studentId,
        phase: "captured",
        grantSha256,
        nameSha256,
        capturedControlEtag: previous?.object.httpEtag ?? null,
        capturedControlVersion: previous?.object.version ?? null,
        capturedControlNonce: previous?.value.nonce ?? null,
        generation: null,
        controlNonce: null,
        payloadKey: null,
        payloadVersion: null,
        payloadSha256: null,
        payloadBytes: null,
        coverageSha256: null,
      });
      try {
        const saved = await this.putJson(
          this.jobKey(grant.studentId, jobId, "captured"),
          job,
          null,
        );
        return Object.freeze({ state: saved ? "captured" : "unknown", jobId });
      } catch {
        return Object.freeze({ state: "unknown", jobId });
      }
    } catch (error) {
      if (error instanceof StudentCacheSourceStale) {
        return Object.freeze({ state: "pending", jobId });
      }
      throw error;
    } finally {
      await this.done(request, boundary, grant);
    }
  }
  /**
   * Only a persisted `captured` job may complete. A journal in writing_payload or
   * writing_control is UNKNOWN; inspect its durable receipt before any retry. The original
   * control ETag is never recaptured and no stale control is overwritten unconditionally.
   */
  async complete(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    input: StudentCacheReadGrant,
    jobId: string,
    raw: Uint8Array,
  ): Promise<StudentCacheCommitResult> {
    if (!request || !boundary?.admission || !boundary.signal) fail();
    const grant = grantCopy(input), signal = boundary.signal;
    if (
      !UUID.test(jobId) || !(raw instanceof Uint8Array) || raw.byteLength < 1 ||
      raw.byteLength > grant.maxBytes
    ) fail();
    const jobKey = this.jobKey(grant.studentId, jobId, "captured"), body = Uint8Array.from(raw);
    try {
      await this.current(request, boundary, grant);
      const grantSha256 = await grantHash(grant),
        loaded = await this.load(
          jobKey,
          (v) => parseJob(v, grant.studentId, jobId, this.prefix),
          signal,
        );
      if (!loaded) return Object.freeze({ state: "pending" });
      const old = loaded.value;
      if (old.phase !== "captured") {
        return Object.freeze({ state: old.phase === "committed" ? "pending" : "unknown" });
      }
      if (old.grantSha256 !== grantSha256) return Object.freeze({ state: "pending" });
      const name = await this.authority.trustedName(grant, signal),
        logicalName = filename(grant.studentId, name);
      if (await sha(new TextEncoder().encode(name)) !== old.nameSha256) {
        return Object.freeze({ state: "pending" });
      }
      const parsed = decode(body);
      if (
        !Array.isArray(parsed) || parsed.length !== grant.totalRows || parsed.length > grant.maxRows
      ) fail();
      const rows = parsed.map(validateStudentCacheFiveFields),
        keys = Object.freeze(rows.map((row) => row.학교및학교PK값));
      if (new Set(keys.map((k) => JSON.stringify([k.학교PK, k.모집행PK]))).size !== keys.length) {
        fail();
      }
      const coverage = await this.authority.verifyCoverage(grant, keys, signal);
      if (typeof coverage !== "string" || !HASH.test(coverage)) fail();
      const payloadSha256 = await sha(body);
      await this.current(request, boundary, grant);
      if (await grantHash(grantCopy(input)) !== grantSha256) {
        return Object.freeze({ state: "pending" });
      }
      // Persist the exact immutable destination and planned hash BEFORE attempting its PUT.
      // On a lost response, the owner can inspect this exact key without guessing or retrying.
      const generation = crypto.randomUUID(), controlNonce = crypto.randomUUID();
      if (
        controlNonce === old.capturedControlNonce || generation === jobId ||
        controlNonce === generation
      ) fail();
      const payloadKey =
        `${this.prefix}students/${grant.studentId}/generations/${generation}/${logicalName}`;
      if (new TextEncoder().encode(payloadKey).length > 1024) fail();
      const writing: Job = Object.freeze({
        ...old,
        nonce: crypto.randomUUID(),
        phase: "writing_payload",
        generation,
        controlNonce,
        payloadKey,
        payloadVersion: null,
        payloadSha256,
        payloadBytes: body.byteLength,
        coverageSha256: coverage,
      });
      let journal: Metadata | null;
      // Create-once marker is both the durable target receipt and the single-completion claim.
      try {
        journal = await this.putJson(
          this.jobKey(grant.studentId, jobId, "writing_payload"),
          writing,
          null,
        );
      } catch {
        return Object.freeze({ state: "unknown" });
      }
      if (!journal) return Object.freeze({ state: "conflict" });
      let payload: Metadata | null;
      try {
        const onlyIf = new Headers();
        onlyIf.set("If-None-Match", "*");
        payload = await this.bucket.put(payloadKey, body, {
          onlyIf,
          httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
        });
      } catch {
        return Object.freeze({ state: "unknown" });
      }
      if (!payload) return Object.freeze({ state: "unknown" });
      try {
        ensureMetadata(payload, payloadKey, grant.maxBytes);
      } catch {
        return Object.freeze({ state: "unknown" });
      }
      if (payload.size !== body.byteLength) return Object.freeze({ state: "unknown" });
      let readback: Body | null;
      try {
        readback = await this.bucket.get(payloadKey);
      } catch {
        return Object.freeze({ state: "unknown" });
      }
      if (
        !readback || readback.version !== payload.version || readback.httpEtag !== payload.httpEtag
      ) {
        if (readback?.body) await readback.body.cancel();
        return Object.freeze({ state: "unknown" });
      }
      let confirmed: Uint8Array;
      try {
        confirmed = await bytesOf(readback, payloadKey, grant.maxBytes, signal);
      } catch {
        return Object.freeze({ state: "unknown" });
      }
      if (confirmed.byteLength !== body.byteLength || await sha(confirmed) !== payloadSha256) {
        return Object.freeze({ state: "unknown" });
      }
      await this.current(request, boundary, grant);
      if (await grantHash(grantCopy(input)) !== grantSha256) {
        return Object.freeze({ state: "pending" });
      }
      const control: Control = Object.freeze({
        format: "jungsi.student-cache-control/v1",
        nonce: controlNonce,
        generation,
        studentId: grant.studentId,
        profileId: grant.profileId,
        reportId: grant.reportId,
        reportRevision: grant.reportRevision,
        academicYear: 2027,
        payloadKey,
        payloadVersion: payload.version,
        payloadSha256,
        payloadBytes: body.byteLength,
        coverageSha256: coverage,
        totalRows: grant.totalRows,
        pins: grant.pins,
        nameSha256: old.nameSha256,
      });
      const beforeControl: Job = Object.freeze({
        ...writing,
        nonce: crypto.randomUUID(),
        phase: "writing_control",
        generation,
        controlNonce,
        payloadKey,
        payloadVersion: payload.version,
        payloadSha256,
        payloadBytes: body.byteLength,
        coverageSha256: coverage,
      });
      try {
        journal = await this.putJson(
          this.jobKey(grant.studentId, jobId, "writing_control"),
          beforeControl,
          null,
        );
      } catch {
        return Object.freeze({ state: "unknown" });
      }
      if (!journal) return Object.freeze({ state: "unknown" });
      await this.current(request, boundary, grant);
      if (await grantHash(grantCopy(input)) !== grantSha256) {
        return Object.freeze({ state: "pending" });
      }
      // Compare the original captured version/nonce as well; never replace the captured ETag.
      let before: Loaded<Control> | null;
      try {
        before = await this.load(
          this.controlKey(grant.studentId),
          (v) => parseControl(v, grant.studentId, this.prefix),
          signal,
        );
      } catch {
        return Object.freeze({ state: "unknown" });
      }
      if (
        old.capturedControlEtag === null ? before !== null : !before ||
          before.object.httpEtag !== old.capturedControlEtag ||
          before.object.version !== old.capturedControlVersion ||
          before.value.nonce !== old.capturedControlNonce
      ) {
        return Object.freeze({ state: "conflict" });
      }
      await this.current(request, boundary, grant);
      if (await grantHash(grantCopy(input)) !== grantSha256) {
        return Object.freeze({ state: "pending" });
      }
      let savedControl: Metadata | null;
      try {
        savedControl = await this.putJson(
          this.controlKey(grant.studentId),
          control,
          old.capturedControlEtag,
        );
      } catch {
        return Object.freeze({ state: "unknown" });
      }
      if (!savedControl) return Object.freeze({ state: "conflict" });
      // Fresh control nonce changes the body on every publication. Reused ETag is not accepted
      // as proof of a new generation; require manual receipt reconciliation if encountered.
      if (old.capturedControlEtag !== null && savedControl.httpEtag === old.capturedControlEtag) {
        return Object.freeze({ state: "unknown" });
      }
      let readControl: Loaded<Control> | null;
      try {
        readControl = await this.load(
          this.controlKey(grant.studentId),
          (v) => parseControl(v, grant.studentId, this.prefix),
          signal,
        );
      } catch {
        return Object.freeze({ state: "unknown" });
      }
      if (
        !readControl || readControl.object.version !== savedControl.version ||
        readControl.object.httpEtag !== savedControl.httpEtag ||
        readControl.value.nonce !== controlNonce ||
        readControl.value.generation !== generation ||
        readControl.value.studentId !== grant.studentId ||
        readControl.value.profileId !== grant.profileId ||
        readControl.value.reportId !== grant.reportId ||
        readControl.value.reportRevision !== grant.reportRevision ||
        readControl.value.academicYear !== 2027 ||
        readControl.value.payloadKey !== payloadKey ||
        readControl.value.payloadBytes !== body.byteLength ||
        readControl.value.coverageSha256 !== coverage ||
        readControl.value.totalRows !== grant.totalRows ||
        readControl.value.nameSha256 !== old.nameSha256 ||
        readControl.value.payloadSha256 !== payloadSha256 ||
        readControl.value.payloadVersion !== payload.version ||
        PIN_FIELDS.some((field) => readControl!.value.pins[field] !== grant.pins[field])
      ) {
        return Object.freeze({ state: "unknown" });
      }
      const committed: Job = Object.freeze({
        ...beforeControl,
        nonce: crypto.randomUUID(),
        phase: "committed",
      });
      try {
        journal = await this.putJson(
          this.jobKey(grant.studentId, jobId, "committed"),
          committed,
          null,
        );
      } catch {
        return Object.freeze({ state: "unknown" });
      }
      if (!journal) return Object.freeze({ state: "unknown" });
      // A profile change can happen after the atomic R2 CAS: never return the resulting
      // data until current source/ownership is rechecked. DB↔R2 atomicity is not claimed.
      await this.current(request, boundary, grant);
      if (await grantHash(grantCopy(input)) !== grantSha256) {
        return Object.freeze({ state: "pending" });
      }
      return Object.freeze({ state: "committed" });
    } catch (error) {
      if (error instanceof StudentCacheSourceStale) return Object.freeze({ state: "pending" });
      throw error;
    } finally {
      await this.done(request, boundary, grant);
    }
  }
  /**
   * Inspect a durable job without changing it or retrying a write. An absent object or a
   * control that no longer matches does not prove whether an earlier PUT committed: the
   * original worker may still be running or a newer generation may have superseded it.
   * Resuming/releasing an uncertain job requires separate proof of physical termination.
   */
  async inspectReceipt(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    input: StudentCacheReadGrant,
    jobId: string,
  ): Promise<StudentCacheReceiptResult> {
    if (!request || !boundary?.admission || !boundary.signal || !UUID.test(jobId)) fail();
    const grant = grantCopy(input), signal = boundary.signal;
    try {
      await this.current(request, boundary, grant);
      const digest = await grantHash(grant);
      const loadPhase = async (phase: JobPhase): Promise<Loaded<Job> | null> => {
        const result = await this.load(
          this.jobKey(grant.studentId, jobId, phase),
          (v) => parseJob(v, grant.studentId, jobId, this.prefix),
          signal,
        );
        if (result && result.value.phase !== phase) fail();
        return result;
      };
      const captured = await loadPhase("captured");
      if (!captured || captured.value.grantSha256 !== digest) {
        return Object.freeze({ state: "pending" });
      }
      // Later phases never overwrite earlier evidence. A snapshot can advance while this
      // inspection runs, so all results remain observations, never permission to retry.
      const committed = await loadPhase("committed"),
        writingControl = await loadPhase("writing_control"),
        writingPayload = await loadPhase("writing_payload");
      if (committed && (!writingControl || !writingPayload) || writingControl && !writingPayload) {
        fail();
      }
      const sameTarget = (a: Job, b: Job) =>
        a.generation === b.generation && a.controlNonce === b.controlNonce &&
        a.payloadKey === b.payloadKey &&
        a.payloadSha256 === b.payloadSha256 && a.payloadBytes === b.payloadBytes &&
        a.coverageSha256 === b.coverageSha256;
      if (
        writingControl && writingPayload &&
          !sameTarget(writingControl.value, writingPayload.value) ||
        committed && writingControl && (!sameTarget(committed.value, writingControl.value) ||
            committed.value.payloadVersion !== writingControl.value.payloadVersion)
      ) fail();
      const job = (committed ?? writingControl ?? writingPayload ?? captured).value;
      if (
        job.grantSha256 !== captured.value.grantSha256 ||
        job.nameSha256 !== captured.value.nameSha256 ||
        job.capturedControlEtag !== captured.value.capturedControlEtag ||
        job.capturedControlVersion !== captured.value.capturedControlVersion ||
        job.capturedControlNonce !== captured.value.capturedControlNonce
      ) fail();
      const name = await this.authority.trustedName(grant, signal);
      filename(grant.studentId, name);
      if (job.nameSha256 !== await sha(new TextEncoder().encode(name))) {
        return Object.freeze({ state: "pending" });
      }
      await this.current(request, boundary, grant);
      if (await grantHash(grantCopy(input)) !== digest) return Object.freeze({ state: "pending" });
      if (job.phase === "captured") return Object.freeze({ state: "captured" });
      if (job.phase === "writing_payload") {
        if (!job.payloadKey || !job.payloadSha256 || !job.payloadBytes) fail();
        const object = await this.bucket.get(job.payloadKey);
        if (!object) return Object.freeze({ state: "unknown" });
        const bytes = await bytesOf(object, job.payloadKey, grant.maxBytes, signal);
        if (bytes.byteLength !== job.payloadBytes || await sha(bytes) !== job.payloadSha256) {
          return Object.freeze({ state: "unknown" });
        }
        await this.current(request, boundary, grant);
        if (await grantHash(grantCopy(input)) !== digest) {
          return Object.freeze({ state: "pending" });
        }
        return Object.freeze({ state: "payload_observed" });
      }
      const current = await this.load(
        this.controlKey(grant.studentId),
        (v) => parseControl(v, grant.studentId, this.prefix),
        signal,
      );
      const matches = !!current && current.value.nonce === job.controlNonce &&
        current.value.generation === job.generation &&
        current.value.payloadKey === job.payloadKey &&
        current.value.payloadVersion === job.payloadVersion &&
        current.value.payloadSha256 === job.payloadSha256;
      if (matches) {
        const latest = await this.bucket.head(this.controlKey(grant.studentId));
        if (!latest) return Object.freeze({ state: "unknown" });
        ensureMetadata(latest, this.controlKey(grant.studentId), 32768);
        if (
          latest.version !== current!.object.version || latest.httpEtag !== current!.object.httpEtag
        ) {
          return Object.freeze({ state: "unknown" });
        }
        await this.current(request, boundary, grant);
        if (await grantHash(grantCopy(input)) !== digest) {
          return Object.freeze({ state: "pending" });
        }
        return Object.freeze({ state: "control_observed_current" });
      }
      // A committed journal is a durable prior-success receipt, not evidence of currentness.
      return Object.freeze({
        state: job.phase === "committed" ? "committed_not_current" : "unknown",
      });
    } catch (error) {
      if (error instanceof StudentCacheSourceStale) return Object.freeze({ state: "pending" });
      throw error;
    } finally {
      await this.done(request, boundary, grant);
    }
  }
  /** Existing 5-field application reader re-verifies content SHA, full scope and authority. */
  readPort(request: ApiExecution, boundary: ApiExecutionBoundary): StudentCachePrivateReadPort {
    if (!request || !boundary?.admission || !boundary.signal) fail();
    let selected:
      | Readonly<{ grant: StudentCacheReadGrant; digest: string; control: Loaded<Control> }>
      | null = null;
    return Object.freeze({
      head: async (
        input: StudentCacheReadGrant,
        signal: AbortSignal,
      ): Promise<StudentCacheReadHead | null> => {
        if (signal !== boundary.signal) fail();
        selected = null;
        const grant = grantCopy(input);
        await this.current(request, boundary, grant);
        const digest = await grantHash(grant),
          name = await this.authority.trustedName(grant, signal);
        const logicalName = filename(grant.studentId, name);
        const current = await this.load(
          this.controlKey(grant.studentId),
          (v) => parseControl(v, grant.studentId, this.prefix),
          signal,
        );
        await this.current(request, boundary, grant);
        if (await grantHash(grantCopy(input)) !== digest) fail();
        if (!current || current.value.nameSha256 !== await sha(new TextEncoder().encode(name))) {
          return null;
        }
        const c = current.value;
        if (
          c.profileId !== grant.profileId || c.reportId !== grant.reportId ||
          c.reportRevision !== grant.reportRevision ||
          c.totalRows !== grant.totalRows || c.payloadBytes > grant.maxBytes ||
          c.payloadKey !==
            `${this.prefix}students/${grant.studentId}/generations/${c.generation}/${logicalName}` ||
          PIN_FIELDS.some((field) => c.pins[field] !== grant.pins[field])
        ) return null;
        const head: StudentCacheReadHead = Object.freeze({
          studentId: grant.studentId,
          profileId: grant.profileId,
          reportId: grant.reportId,
          reportRevision: grant.reportRevision,
          academicYear: 2027,
          version: current.object.version,
          payloadSha256: c.payloadSha256,
          payloadBytes: c.payloadBytes,
          coverageSha256: c.coverageSha256,
          totalRows: c.totalRows,
          pins: c.pins,
        });
        selected = Object.freeze({ grant: input, digest, control: current });
        return head;
      },
      bytes: async (
        input: StudentCacheReadGrant,
        head: StudentCacheReadHead,
        signal: AbortSignal,
      ): Promise<Uint8Array> => {
        if (
          signal !== boundary.signal || !selected || selected.grant !== input ||
          selected.control.object.version !== head.version ||
          selected.control.value.payloadSha256 !== head.payloadSha256
        ) fail();
        const prior = selected, grant = grantCopy(input);
        await this.current(request, boundary, grant);
        if (await grantHash(grant) !== prior.digest) fail();
        const payload = await this.bucket.get(prior.control.value.payloadKey);
        if (
          !payload || payload.version !== prior.control.value.payloadVersion ||
          payload.size !== head.payloadBytes
        ) {
          if (payload?.body) await payload.body.cancel();
          fail();
        }
        const result = await bytesOf(
          payload,
          prior.control.value.payloadKey,
          grant.maxBytes,
          signal,
        );
        if (await sha(result) !== head.payloadSha256) fail();
        const controlKey = this.controlKey(grant.studentId),
          latest = await this.bucket.head(controlKey);
        if (!latest) fail();
        ensureMetadata(latest, controlKey, 32768);
        if (
          latest.version !== prior.control.object.version ||
          latest.httpEtag !== prior.control.object.httpEtag
        ) fail();
        await this.current(request, boundary, grant);
        if (await grantHash(grantCopy(input)) !== prior.digest) fail();
        return result;
      },
    });
  }
}

/** Reject ASCII controls and the path delimiters relevant to this field. */
function containsUnsafeAscii(value: string, extra: string, rejectSpace = false): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= (rejectSpace ? 0x20 : 0x1f) || code === 0x7f || extra.includes(ch)) return true;
  }
  return false;
}
