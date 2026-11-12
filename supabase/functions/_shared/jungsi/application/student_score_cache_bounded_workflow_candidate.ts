/**
 * REVIEW ONLY: bounded, durable student-cache orchestration contract.
 * No actual scheduler, claim store, provider, storage, publisher, or runtime is installed.
 * A user request or worker turn processes at most one page of 100 offerings. Full-result
 * publication is a separately claimed turn and requires a real atomic publisher/receipt.
 */
import { AccessError } from "./access.ts";
import { requireReferenceDurableFence } from "./reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import { exact } from "../domain/exact.ts";

export type StudentCacheKey = Readonly<{ 학교PK: string; 모집행PK: string }>;
/** The published data row has exactly these five fields; protected metadata is separate. */
export type StudentCacheFiveFields = Readonly<{
  학교및학교PK값: StudentCacheKey;
  학교명: string;
  학과: string;
  환산점수: string | null;
  추정상위누적백분위: string | null;
}>;
export type StudentCachePins = Readonly<{
  profileSha256: string;
  examSha256: string;
  sourceSha256: string;
  ruleSha256: string;
  engineSha256: string;
  cdfSha256: string;
  tiePolicySha256: string;
  relationSha256: string;
  attendanceSha256: string;
  policySha256: string;
  scopeSha256: string;
}>;
export type StudentCacheWorkGrant = Readonly<{
  studentId: string;
  studentName: string;
  profileId: string;
  /** A report is optional; if present the same confirmed profile and revision must be bound. */
  reportId: string | null;
  reportRevision: number | null;
  academicYear: 2027;
  commandId: string;
  totalRows: number;
  pins: StudentCachePins;
}>;
export type StudentCacheClaim = Readonly<{
  jobId: string;
  claimId: string;
  phase: "BUILDING" | "READY_TO_PUBLISH";
  completedRows: number;
  nextCursor: string | null;
  /** Captured by the trusted work store; null means there was no previous publication. */
  expectedVersion: string | null;
}>;
export type StudentItemFingerprint = Readonly<{ key: StudentCacheKey; fingerprint: string }>;
export type StudentCacheChunkItem = Readonly<{
  fingerprint: string;
  row: StudentCacheFiveFields;
}>;

/**
 * Independently binds the actual request/admission to the user↔student permission and the
 * current immutable profile/report, complete 2027 scope, exam, rule, CDF, tie policy,
 * relationship, code, attendance and policy pins. Verify physical budgets and the exact
 * provider identities; a caller-supplied UUID or hash is never authority. Per-item protected
 * fingerprints must cover every row input affecting ANY of the five output fields, including
 * source names/identity, user scores, applicable rules, engine/CDF/ties and relationship.
 * They may stay equal across a global version change only when those inputs really match.
 * issue() executes before a durable claim exists: it must not settle on success, failure or
 * abort until all of its physical I/O has stopped. Never log student names, paths or scores.
 */
export interface StudentCacheWorkAuthority {
  issue(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<StudentCacheWorkGrant>;
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheWorkGrant,
    claim: StudentCacheClaim,
    ports: StudentCacheWorkPorts,
  ): Promise<void>;
  fingerprints(
    grant: StudentCacheWorkGrant,
    claim: StudentCacheClaim,
    keys: readonly StudentCacheKey[],
    signal: AbortSignal,
  ): Promise<readonly StudentItemFingerprint[]>;
  /**
   * Resolves only after all work started by this turn has physically stopped. It must also
   * work with an already-aborted signal. A rejected stop check is not proof of termination.
   */
  awaitQuiescence(
    grant: StudentCacheWorkGrant,
    claim: StudentCacheClaim,
    signal: AbortSignal,
  ): Promise<void>;
}
export interface StudentCacheScopePages {
  /** One approved page, at most 100 keys; never enumerate all offerings inside one turn. */
  page(
    grant: StudentCacheWorkGrant,
    claim: StudentCacheClaim,
    limit: 100,
    signal: AbortSignal,
  ): Promise<Readonly<{ keys: readonly StudentCacheKey[]; next: string | null }>>;
}
export interface StudentCacheBatchCalculator {
  /** Reuse the approved school engine/CDF; unknown results are null, never fabricated zero. */
  calculate(
    grant: StudentCacheWorkGrant,
    claim: StudentCacheClaim,
    keys: readonly StudentCacheKey[],
    signal: AbortSignal,
  ): Promise<readonly StudentCacheFiveFields[]>;
}
export interface StudentCacheDurableWork {
  /**
   * Real implementation must durably and exclusively claim this exact owner/student/command,
   * pin set and complete scope. It must protect immutable chunk references, progress and expected
   * prior publication version. A previous unknown result or expired claim MUST be reconciled
   * against durable receipts and proof of physical termination before issuing another claim.
   * Claim expiry alone is not evidence that a worker physically stopped. claim() itself may
   * settle only after physical I/O stops; a lost claim response must also be reconciled rather
   * than granting a second worker. No implementation may log student names, paths or scores.
   */
  claim(grant: StudentCacheWorkGrant, signal: AbortSignal): Promise<StudentCacheClaim>;
  /** Private, owner-checked read: return only rows whose protected per-item fingerprint matches. */
  reusable(
    grant: StudentCacheWorkGrant,
    claim: StudentCacheClaim,
    fingerprints: readonly StudentItemFingerprint[],
    signal: AbortSignal,
  ): Promise<readonly StudentCacheChunkItem[]>;
  /**
   * Persist an immutable private chunk, then atomically record exact claim/cursor, global key
   * uniqueness, progress and pins. Same command+identical content is idempotent; no partially
   * recorded page or duplicate key is permitted. Unknown commit results require a durable
   * receipt; do not replay a page or compute work automatically. Mark READY_TO_PUBLISH only
   * when the terminal page is durably recorded and the full declared count has been reached.
   */
  appendChunkIfClaimed(
    grant: StudentCacheWorkGrant,
    claim: StudentCacheClaim,
    items: readonly StudentCacheChunkItem[],
    next: string | null,
    signal: AbortSignal,
  ): Promise<"committed" | "already_committed" | "conflict">;
  /**
   * Real publisher must assemble a private complete JSON file containing exactly the five
   * fields per row; atomically revalidate the authority, ALL pins, full scope/coverage, unique
   * keys and the expected previous version before one current-pointer CAS. Incomplete chunks
   * are never visible. Preserve prior files and the separate existing member shortlist. Same
   * command+content must resolve through a durable receipt, including interrupted commits.
   * logicalFilename is sensitive; never log or expose it. An independent storage adapter may
   * reversibly encode it to an ASCII object key; changing this logical name is not allowed.
   */
  publishCompleteIfCurrent(
    grant: StudentCacheWorkGrant,
    claim: StudentCacheClaim,
    logicalFilename: string,
    signal: AbortSignal,
  ): Promise<"committed" | "already_committed" | "conflict">;
  /**
   * After acknowledged physical quiescence, durably mark UNKNOWN when requested before
   * releasing this claim; never permit a new claim until its durable receipt is reconciled.
   * On failure, retain the claim rather than silently releasing it. Must work after abort;
   * no task/file deletion is permitted.
   */
  finishTurn(
    grant: StudentCacheWorkGrant,
    claim: StudentCacheClaim,
    disposition: "safe" | "unknown",
    signal: AbortSignal,
  ): Promise<void>;
}
export type StudentCacheWorkPorts = Readonly<{
  scope: StudentCacheScopePages;
  calculator: StudentCacheBatchCalculator;
  work: StudentCacheDurableWork;
}>;
export type StudentCacheTurnResult = Readonly<{
  state: "progress" | "published" | "conflict" | "unknown";
  completedRows: number;
  totalRows: number;
}>;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
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
const DATA_FIELDS = ["학교및학교PK값", "학교명", "학과", "환산점수", "추정상위누적백분위"] as const;
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
function key(v: unknown): StudentCacheKey {
  const r = object(v, ["학교PK", "모집행PK"]);
  if (
    typeof r.학교PK !== "string" || !ID.test(r.학교PK) ||
    typeof r.모집행PK !== "string" || !ID.test(r.모집행PK)
  ) fail();
  return Object.freeze({ 학교PK: r.학교PK, 모집행PK: r.모집행PK });
}
function token(k: StudentCacheKey): string {
  return JSON.stringify([k.학교PK, k.모집행PK]);
}
function value(v: unknown, percentile: boolean): string | null {
  if (v === null) return null;
  if (typeof v !== "string" || v.length > 128 || !DECIMAL.test(v)) fail();
  try {
    if (percentile && (exact(v).compare(exact(0)) < 0 || exact(v).compare(exact(100)) > 0)) fail();
  } catch {
    fail();
  }
  return v;
}
export function validateStudentCacheFiveFields(v: unknown): StudentCacheFiveFields {
  const r = object(v, DATA_FIELDS);
  if (
    typeof r.학교명 !== "string" || !r.학교명 || r.학교명.length > 512 ||
    typeof r.학과 !== "string" || !r.학과 || r.학과.length > 512
  ) fail();
  return Object.freeze({
    학교및학교PK값: key(r.학교및학교PK값),
    학교명: r.학교명,
    학과: r.학과,
    환산점수: value(r.환산점수, false),
    추정상위누적백분위: value(r.추정상위누적백분위, true),
  });
}
export function validateStudentCachePins(v: unknown): StudentCachePins {
  const p = object(v, PIN_FIELDS);
  if (PIN_FIELDS.some((f) => typeof p[f] !== "string" || !HASH.test(p[f] as string))) fail();
  return Object.freeze(Object.fromEntries(PIN_FIELDS.map((f) => [f, p[f]]))) as StudentCachePins;
}
function grantOf(v: unknown): StudentCacheWorkGrant {
  const r = object(v, [
    "studentId",
    "studentName",
    "profileId",
    "reportId",
    "reportRevision",
    "academicYear",
    "commandId",
    "totalRows",
    "pins",
  ]);
  const pins = validateStudentCachePins(r.pins);
  if (
    typeof r.studentId !== "string" || !UUID.test(r.studentId) ||
    typeof r.studentName !== "string" || !r.studentName || r.studentName.length > 100 ||
    Array.from(r.studentName).some((char) =>
      char === "\\" || char === "/" || char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127
    ) ||
    typeof r.profileId !== "string" || !ID.test(r.profileId) ||
    !((r.reportId === null && r.reportRevision === null) ||
      (typeof r.reportId === "string" && ID.test(r.reportId) &&
        Number.isSafeInteger(r.reportRevision) && (r.reportRevision as number) >= 1)) ||
    typeof r.commandId !== "string" || !ID.test(r.commandId) ||
    r.academicYear !== 2027 || !Number.isSafeInteger(r.totalRows) ||
    (r.totalRows as number) < 1 || (r.totalRows as number) > 100_000
  ) fail();
  try {
    encodeURIComponent(r.studentName);
  } catch {
    fail();
  }
  return Object.freeze({
    studentId: r.studentId,
    studentName: r.studentName,
    profileId: r.profileId,
    reportId: r.reportId as string | null,
    reportRevision: r.reportRevision as number | null,
    academicYear: 2027,
    commandId: r.commandId,
    totalRows: r.totalRows as number,
    pins,
  });
}
function claimOf(v: unknown, total: number): StudentCacheClaim {
  const r = object(v, [
    "jobId",
    "claimId",
    "phase",
    "completedRows",
    "nextCursor",
    "expectedVersion",
  ]);
  if (
    typeof r.jobId !== "string" || !ID.test(r.jobId) || typeof r.claimId !== "string" ||
    !ID.test(r.claimId) ||
    !["BUILDING", "READY_TO_PUBLISH"].includes(String(r.phase)) ||
    !Number.isSafeInteger(r.completedRows) || (r.completedRows as number) < 0 ||
    (r.completedRows as number) > total ||
    !(r.nextCursor === null ||
      typeof r.nextCursor === "string" && r.nextCursor.length > 0 && r.nextCursor.length <= 1024) ||
    !(r.expectedVersion === null ||
      typeof r.expectedVersion === "string" && ID.test(r.expectedVersion)) ||
    r.phase === "BUILDING" && r.completedRows === total ||
    r.phase === "READY_TO_PUBLISH" && (r.completedRows !== total || r.nextCursor !== null)
  ) fail();
  return Object.freeze({
    jobId: r.jobId,
    claimId: r.claimId,
    phase: r.phase as StudentCacheClaim["phase"],
    completedRows: r.completedRows as number,
    nextCursor: r.nextCursor as string | null,
    expectedVersion: r.expectedVersion as string | null,
  });
}

/** One bounded turn. No result rows, filename, name, owner or token are logged or returned. */
export async function runStudentCacheBoundedTurn(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  authority: StudentCacheWorkAuthority,
  ports: StudentCacheWorkPorts,
): Promise<StudentCacheTurnResult> {
  requireReferenceDurableFence();
  if (
    !request || !boundary?.admission || !boundary.signal || boundary.signal.aborted ||
    !authority || typeof authority.issue !== "function" ||
    typeof authority.assertCurrent !== "function" ||
    typeof authority.fingerprints !== "function" ||
    typeof authority.awaitQuiescence !== "function" ||
    !ports?.scope || typeof ports.scope.page !== "function" || !ports.calculator ||
    typeof ports.calculator.calculate !== "function" || !ports.work ||
    typeof ports.work.claim !== "function" ||
    typeof ports.work.reusable !== "function" ||
    typeof ports.work.appendChunkIfClaimed !== "function" ||
    typeof ports.work.publishCompleteIfCurrent !== "function" ||
    typeof ports.work.finishTurn !== "function"
  ) fail();
  const signal = boundary.signal, admission = boundary.admission;
  const stablePorts = Object.freeze({
    scope: ports.scope,
    calculator: ports.calculator,
    work: ports.work,
  });
  const issued = grantOf(await authority.issue(request, boundary));
  if (signal.aborted || boundary.signal !== signal || boundary.admission !== admission) fail();
  const claim = claimOf(await stablePorts.work.claim(issued, signal), issued.totalRows);
  const active = async () => {
    if (signal.aborted || boundary.signal !== signal || boundary.admission !== admission) fail();
    await authority.assertCurrent(request, boundary, issued, claim, stablePorts);
    if (signal.aborted || boundary.signal !== signal || boundary.admission !== admission) fail();
  };
  const result = (state: StudentCacheTurnResult["state"], count: number) =>
    Object.freeze({ state, completedRows: count, totalRows: issued.totalRows });
  let disposition: "safe" | "unknown" = "safe";
  try {
    await active();
    if (claim.phase === "READY_TO_PUBLISH") {
      let published: "committed" | "already_committed" | "conflict";
      try {
        // This is a logical name only; a separate private storage layer chooses the object key.
        const filename = `${issued.studentId}_${issued.studentName}.json`;
        published = await stablePorts.work.publishCompleteIfCurrent(
          issued,
          claim,
          filename,
          signal,
        );
      } catch {
        // The publisher might have committed before losing its response. A durable receipt is
        // required before any next action; never start a second publish here.
        disposition = "unknown";
        return result("unknown", claim.completedRows);
      }
      if (published === "conflict") return result("conflict", claim.completedRows);
      if (published !== "committed" && published !== "already_committed") {
        disposition = "unknown";
        return result("unknown", claim.completedRows);
      }
      try {
        await active();
      } catch {
        disposition = "unknown";
        return result("unknown", claim.completedRows);
      }
      return result("published", claim.completedRows);
    }
    const page = await stablePorts.scope.page(issued, claim, 100, signal);
    await active();
    if (
      !page || !Array.isArray(page.keys) || page.keys.length < 1 || page.keys.length > 100 ||
      !(page.next === null ||
        typeof page.next === "string" && page.next.length > 0 && page.next.length <= 1024) ||
      page.next !== null && page.next === claim.nextCursor ||
      claim.completedRows + page.keys.length > issued.totalRows ||
      (page.next === null) !== (claim.completedRows + page.keys.length === issued.totalRows)
    ) fail();
    const next = page.next;
    const keys = Object.freeze(page.keys.map(key)), allowed = new Set(keys.map(token));
    if (allowed.size !== keys.length) fail();
    const rawPrints = await authority.fingerprints(issued, claim, keys, signal);
    await active();
    if (!Array.isArray(rawPrints) || rawPrints.length !== keys.length) fail();
    const prints: StudentItemFingerprint[] = [];
    for (let i = 0; i < keys.length; i++) {
      const item = object(rawPrints[i], ["key", "fingerprint"]), k = key(item.key);
      if (
        token(k) !== token(keys[i]) || typeof item.fingerprint !== "string" ||
        !HASH.test(item.fingerprint)
      ) fail();
      prints.push(Object.freeze({ key: k, fingerprint: item.fingerprint }));
    }
    const stablePrints = Object.freeze(prints);
    const reusable = await stablePorts.work.reusable(issued, claim, stablePrints, signal);
    await active();
    if (!Array.isArray(reusable) || reusable.length > keys.length) fail();
    const byKey = new Map<string, StudentCacheChunkItem>(),
      expected = new Map(prints.map((p) => [token(p.key), p.fingerprint]));
    for (const raw of reusable) {
      const item = object(raw, ["fingerprint", "row"]),
        data = validateStudentCacheFiveFields(item.row),
        k = token(data.학교및학교PK값);
      if (!allowed.has(k) || byKey.has(k) || item.fingerprint !== expected.get(k)) fail();
      byKey.set(k, Object.freeze({ fingerprint: item.fingerprint as string, row: data }));
    }
    const missing = Object.freeze(keys.filter((k) => !byKey.has(token(k))));
    if (missing.length) {
      const calculated = await stablePorts.calculator.calculate(issued, claim, missing, signal);
      await active();
      if (!Array.isArray(calculated) || calculated.length !== missing.length) fail();
      const needed = new Set(missing.map(token));
      for (const raw of calculated) {
        const data = validateStudentCacheFiveFields(raw),
          k = token(data.학교및학교PK값),
          fingerprint = expected.get(k);
        if (!needed.has(k) || byKey.has(k) || !fingerprint) fail();
        byKey.set(k, Object.freeze({ fingerprint, row: data }));
      }
    }
    const ordered = Object.freeze(keys.map((k) => {
      const found = byKey.get(token(k));
      if (!found) fail();
      return found;
    }));
    await active();
    let appended: "committed" | "already_committed" | "conflict";
    try {
      appended = await stablePorts.work.appendChunkIfClaimed(issued, claim, ordered, next, signal);
    } catch {
      disposition = "unknown";
      return result("unknown", claim.completedRows);
    }
    if (appended === "conflict") return result("conflict", claim.completedRows);
    if (appended !== "committed" && appended !== "already_committed") {
      disposition = "unknown";
      return result("unknown", claim.completedRows);
    }
    try {
      await active();
    } catch {
      disposition = "unknown";
      return result("unknown", claim.completedRows);
    }
    return result("progress", claim.completedRows + ordered.length);
  } finally {
    try {
      await authority.awaitQuiescence(issued, claim, signal);
    } catch {
      // Never release a concurrency reservation when physical termination is unproved.
      await new Promise<never>(() => {});
    }
    await stablePorts.work.finishTurn(issued, claim, disposition, signal);
  }
}
