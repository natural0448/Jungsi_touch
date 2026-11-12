/**
 * REVIEW ONLY: private current-cache read boundary. No runtime, storage adapter, head issuer,
 * actual file path, bucket or approval is installed. The private payload is a UTF-8 JSON array;
 * each row has exactly the five fields enforced by validateStudentCacheFiveFields.
 */
import { AccessError } from "./access.ts";
import { requireReferenceDurableFence } from "./reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { parseNativeJson } from "../domain/native_json.ts";
import {
  type StudentCacheFiveFields,
  type StudentCacheKey,
  type StudentCachePins,
  validateStudentCacheFiveFields,
  validateStudentCachePins,
} from "./student_score_cache_bounded_workflow_candidate.ts";

export type StudentCacheReadGrant = Readonly<{
  studentId: string;
  profileId: string;
  /** Optional: a confirmed profile without a report is a valid subject. */
  reportId: string | null;
  reportRevision: number | null;
  academicYear: 2027;
  totalRows: number;
  maxRows: number;
  maxBytes: number;
  pins: StudentCachePins;
}>;
export type StudentCacheReadHead = Readonly<{
  studentId: string;
  profileId: string;
  reportId: string | null;
  reportRevision: number | null;
  academicYear: 2027;
  version: string;
  payloadSha256: string;
  payloadBytes: number;
  coverageSha256: string;
  totalRows: number;
  pins: StudentCachePins;
}>;
export type StudentCacheReadResult =
  | Readonly<{ state: "ready"; rows: readonly StudentCacheFiveFields[] }>
  | Readonly<{ state: "pending"; rows: null }>;

/**
 * Trusted, independent server authority. issue() authenticates the actual request and proves
 * user↔student permission, confirmed profile, exact optional report revision, 2027 scope,
 * data/engine/rule/exam/CDF/tie/relationship pins, source availability and physical budget.
 * A caller-controlled UUID, name, header or digest is not proof. issue() must not settle until
 * any physical I/O it starts has stopped, including on failure/abort.
 */
export interface StudentCacheReadAuthority {
  issue(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<StudentCacheReadGrant>;
  /** Independently verify the same request/admission, provider, current pins and atomic head. */
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
    head: StudentCacheReadHead | null,
    storage: StudentCachePrivateReadPort,
  ): Promise<void>;
  /**
   * Independently bind the exact payload hash and unique key set to the approved COMPLETE
   * source scope and its protected coverage commitment. A row count alone is not coverage.
   * Verification must be bounded/batched; it must not issue one DB request per offering.
   */
  verifyCoverage(
    grant: StudentCacheReadGrant,
    head: StudentCacheReadHead,
    keys: readonly StudentCacheKey[],
    signal: AbortSignal,
  ): Promise<boolean>;
  /**
   * Physically stop all started reads, then independently confirm the same requester,
   * admission, source pins and atomic head immediately before settling. Return false when
   * stopped but stale/unauthorized. Resolve only after even the final verification I/O has
   * stopped, including on abort; rejection is not proof of physical termination.
   */
  awaitReadQuiescence(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
    head: StudentCacheReadHead | null,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export interface StudentCachePrivateReadPort {
  /** Read only a verified private atomic current head. Do not return a filename/path to callers. */
  head(grant: StudentCacheReadGrant, signal: AbortSignal): Promise<StudentCacheReadHead | null>;
  /** Read the exact immutable private payload pinned by the head; never log its contents or path. */
  bytes(
    grant: StudentCacheReadGrant,
    head: StudentCacheReadHead,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
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
const PENDING: StudentCacheReadResult = Object.freeze({ state: "pending", rows: null });
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function object(v: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !v || typeof v !== "object" || Array.isArray(v) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  ) fail();
  const keys = Reflect.ownKeys(v);
  if (
    keys.length !== fields.length || keys.some((k) => typeof k !== "string" || !fields.includes(k))
  ) fail();
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !("value" in d) || !d.enumerable) fail();
  }
  return v as Record<string, unknown>;
}
function reportPair(id: unknown, revision: unknown): boolean {
  return id === null && revision === null || typeof id === "string" && ID.test(id) &&
      Number.isSafeInteger(revision) && (revision as number) >= 1;
}
function grantOf(v: unknown): StudentCacheReadGrant {
  const x = object(v, [
    "studentId",
    "profileId",
    "reportId",
    "reportRevision",
    "academicYear",
    "totalRows",
    "maxRows",
    "maxBytes",
    "pins",
  ]);
  if (
    typeof x.studentId !== "string" || !UUID.test(x.studentId) ||
    typeof x.profileId !== "string" || !ID.test(x.profileId) ||
    !reportPair(x.reportId, x.reportRevision) ||
    x.academicYear !== 2027 || !Number.isSafeInteger(x.totalRows) || (x.totalRows as number) < 1 ||
    !Number.isSafeInteger(x.maxRows) || (x.maxRows as number) < (x.totalRows as number) ||
    (x.maxRows as number) > 100_000 || !Number.isSafeInteger(x.maxBytes) ||
    (x.maxBytes as number) < 1 || (x.maxBytes as number) > 67_108_864
  ) fail();
  return Object.freeze({
    studentId: x.studentId,
    profileId: x.profileId,
    reportId: x.reportId as string | null,
    reportRevision: x.reportRevision as number | null,
    academicYear: 2027,
    totalRows: x.totalRows as number,
    maxRows: x.maxRows as number,
    maxBytes: x.maxBytes as number,
    pins: validateStudentCachePins(x.pins),
  });
}
function headOf(v: unknown, grant: StudentCacheReadGrant): StudentCacheReadHead {
  const x = object(v, [
    "studentId",
    "profileId",
    "reportId",
    "reportRevision",
    "academicYear",
    "version",
    "payloadSha256",
    "payloadBytes",
    "coverageSha256",
    "totalRows",
    "pins",
  ]);
  const pins = validateStudentCachePins(x.pins);
  if (
    x.studentId !== grant.studentId || x.profileId !== grant.profileId ||
    x.reportId !== grant.reportId ||
    x.reportRevision !== grant.reportRevision || x.academicYear !== 2027 ||
    x.totalRows !== grant.totalRows ||
    typeof x.version !== "string" || !ID.test(x.version) ||
    typeof x.payloadSha256 !== "string" || !HASH.test(x.payloadSha256) ||
    typeof x.coverageSha256 !== "string" || !HASH.test(x.coverageSha256) ||
    !Number.isSafeInteger(x.payloadBytes) || (x.payloadBytes as number) < 1 ||
    (x.payloadBytes as number) > grant.maxBytes || PIN_FIELDS.some((f) => pins[f] !== grant.pins[f])
  ) fail();
  return Object.freeze({
    studentId: grant.studentId,
    profileId: grant.profileId,
    reportId: grant.reportId,
    reportRevision: grant.reportRevision,
    academicYear: 2027,
    version: x.version,
    payloadSha256: x.payloadSha256,
    payloadBytes: x.payloadBytes as number,
    coverageSha256: x.coverageSha256,
    totalRows: grant.totalRows,
    pins,
  });
}
function token(k: StudentCacheKey): string {
  return JSON.stringify([k.학교PK, k.모집행PK]);
}
async function sha(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Stale, absent or unconfirmed data is pending. A ready response contains exactly the allowed
 * five fields per row and no filename, student name, path or storage details. This does not
 * start calculation, create a report, write, retry or publish.
 */
export async function readCurrentStudentCache(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  authority: StudentCacheReadAuthority,
  storage: StudentCachePrivateReadPort,
): Promise<StudentCacheReadResult> {
  requireReferenceDurableFence();
  if (
    !request || !boundary?.admission || !boundary.signal || boundary.signal.aborted ||
    !authority || typeof authority.issue !== "function" ||
    typeof authority.assertCurrent !== "function" ||
    typeof authority.verifyCoverage !== "function" ||
    typeof authority.awaitReadQuiescence !== "function" ||
    !storage || typeof storage.head !== "function" || typeof storage.bytes !== "function"
  ) fail();
  const signal = boundary.signal, admission = boundary.admission;
  const grant = grantOf(await authority.issue(request, boundary));
  let checkedHead: StudentCacheReadHead | null = null;
  const current = async (head: StudentCacheReadHead | null) => {
    if (signal.aborted || boundary.signal !== signal || boundary.admission !== admission) fail();
    await authority.assertCurrent(request, boundary, grant, head, storage);
    if (signal.aborted || boundary.signal !== signal || boundary.admission !== admission) fail();
  };
  try {
    await current(null);
    const rawHead = await storage.head(grant, signal);
    await current(null);
    if (rawHead === null) return PENDING;
    const head = headOf(rawHead, grant);
    checkedHead = head;
    await current(head);
    const raw = await storage.bytes(grant, head, signal);
    if (signal.aborted || !(raw instanceof Uint8Array) || raw.byteLength !== head.payloadBytes) {
      fail();
    }
    // Copy before awaiting a digest so the provider cannot mutate validated bytes.
    const bytes = Uint8Array.from(raw);
    if (await sha(bytes) !== head.payloadSha256) fail();
    await current(head);
    const parsed = parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (
      !Array.isArray(parsed) || parsed.length !== head.totalRows || parsed.length > grant.maxRows
    ) fail();
    const rows = parsed.map(validateStudentCacheFiveFields);
    const keys = Object.freeze(rows.map((r) => r.학교및학교PK값));
    if (new Set(keys.map(token)).size !== keys.length) fail();
    if (await authority.verifyCoverage(grant, head, keys, signal) !== true) fail();
    await current(head);
    return Object.freeze({ state: "ready", rows: Object.freeze(rows) });
  } catch {
    return PENDING;
  } finally {
    let currentAtStop = false;
    try {
      currentAtStop = await authority.awaitReadQuiescence(
        request,
        boundary,
        grant,
        checkedHead,
        signal,
      );
    } catch {
      // Do not let a request reservation finish while the underlying read may still be active.
      await new Promise<never>(() => {});
    }
    if (
      !currentAtStop || signal.aborted || boundary.signal !== signal ||
      boundary.admission !== admission
    ) {
      // Cancellation or an expired admission must override an otherwise ready result.
      // deno-lint-ignore no-unsafe-finally
      return PENDING;
    }
  }
}
