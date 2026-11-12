/**
 * REVIEW ONLY: server-side one-student durable coordinator and immutable R2 staging.
 * No Durable Object class/binding, bucket, authority, user API or scheduler is installed.
 * Publication is HARD DISABLED until profile changes and publication are actually fenced
 * through the same trusted coordinator (or an equivalent atomic cross-system proof exists).
 * R2 ETags do not provide a DB-to-R2 transaction or protect against metadata-only ABA.
 */
import { AccessError } from "../application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type {
  StudentCachePrivateReadPort,
  StudentCacheReadGrant,
  StudentCacheReadHead,
} from "../application/student_score_cache_read_candidate.ts";
import { validateStudentCacheFiveFields } from "../application/student_score_cache_bounded_workflow_candidate.ts";
import { parseNativeJson } from "../domain/native_json.ts";

/** Structural subset of Durable Object transaction/storage APIs. */
export interface StudentDurableTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
export interface StudentDurableStorage {
  transaction<T>(closure: (txn: StudentDurableTransaction) => Promise<T>): Promise<T>;
}
export interface StudentDurableState {
  readonly id: { toString(): string };
  readonly storage: StudentDurableStorage;
}
export interface R2StoredObject {
  readonly key: string;
  readonly version: string;
  readonly size: number;
}
export interface R2StoredBody extends R2StoredObject {
  readonly body: ReadableStream<Uint8Array>;
}
export interface PrivateStudentR2 {
  put(key: string, value: Uint8Array, options: {
    readonly onlyIf: Headers;
    readonly customMetadata: Readonly<Record<string, string>>;
    readonly httpMetadata: Readonly<{ contentType: string; cacheControl: string }>;
  }): Promise<R2StoredObject | null>;
  get(key: string): Promise<R2StoredBody | null>;
}
/** These proofs must be independently implemented using the real server and data authority. */
export interface StudentPublicationAuthority {
  /** Verify actual user-to-student or institution permission, complete current profile/exam/
   * model/source pins, admission, cost budget, one-student DO identity, private R2 binding,
   * and that all student-cache writers use this same DO/fence. No caller-controlled ID proves it. */
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
    actor: StudentDurableState,
    bucket: PrivateStudentR2,
  ): Promise<void>;
  /** Trusted server directory: never derive a student's name from a URL or request body. */
  trustedName(grant: StudentCacheReadGrant, signal: AbortSignal): Promise<string>;
  /** Verify the exact complete approved 2027 scope in one bounded/batched operation. */
  verifyCoverage(
    grant: StudentCacheReadGrant,
    keys: readonly Readonly<{ 학교PK: string; 모집행PK: string }>[],
    signal: AbortSignal,
  ): Promise<string>;
}
export type StudentStageClaim = Readonly<
  { fence: number; claimId: string; expectedVersion: string | null }
>;
type ActiveClaim = Readonly<
  {
    fence: number;
    claimId: string;
    expectedVersion: string | null;
    grantDigest: string;
    status: "CLAIMED" | "WRITING" | "STAGED" | "UNKNOWN";
  }
>;
type InternalPointer = Readonly<
  { head: StudentCacheReadHead; objectKey: string; objectVersion: string; grantDigest: string }
>;
type CoordinatorState = Readonly<
  { sequence: number; current: InternalPointer | null; active: ActiveClaim | null }
>;
type StageReceipt = Readonly<
  {
    claim: StudentStageClaim;
    payloadSha256: string;
    payloadBytes: number;
    coverageSha256: string;
    objectKey: string;
    objectVersion: string;
    grantDigest: string;
  }
>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATE_KEY = "student-cache-coordinator/v1";
// This is intentionally not configurable. A review must replace it only after the real
// student-profile writer is proven to participate in the same persistent fence.
const PROFILE_PUBLICATION_FENCE_IMPLEMENTED: boolean = false;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function check(signal: AbortSignal): void {
  if (!signal || signal.aborted) fail();
}
async function sha(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))].map((
    v,
  ) => v.toString(16).padStart(2, "0")).join("");
}
function prefixOf(prefix: string): string {
  if (
    typeof prefix !== "string" || !prefix.endsWith("/") || prefix.startsWith("/") ||
    prefix.length > 256 ||
    prefix.slice(0, -1).split("/").some((x) => !/^[A-Za-z0-9_-]+$/.test(x))
  ) fail();
  return prefix;
}
function nameOf(id: string, name: string): string {
  if (
    !UUID.test(id) || typeof name !== "string" || !name || name.length > 100 ||
    containsUnsafeAscii(name, "\\/")
  ) fail();
  try {
    encodeURIComponent(name);
  } catch {
    return fail();
  }
  return `${id}_${name}.json`;
}
function grantBytes(grant: StudentCacheReadGrant): Uint8Array {
  const names = [
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
  if (
    !grant || !UUID.test(grant.studentId) || !ID.test(grant.profileId) ||
    grant.academicYear !== 2027 ||
    !Number.isSafeInteger(grant.totalRows) || grant.totalRows < 1 || grant.totalRows > 100000 ||
    !Number.isSafeInteger(grant.maxRows) || grant.maxRows < grant.totalRows ||
    grant.maxRows > 100000 ||
    !Number.isSafeInteger(grant.maxBytes) || grant.maxBytes < 1 || grant.maxBytes > 67108864 ||
    !(grant.reportId === null && grant.reportRevision === null ||
      typeof grant.reportId === "string" &&
        ID.test(grant.reportId) && Number.isSafeInteger(grant.reportRevision) &&
        (grant.reportRevision as number) >= 1) ||
    !grant.pins || names.some((n) => !HASH.test(grant.pins[n]))
  ) fail();
  const pins = names.map((n) => [n, grant.pins[n]]);
  return new TextEncoder().encode(
    JSON.stringify([
      grant.studentId,
      grant.profileId,
      grant.reportId,
      grant.reportRevision,
      grant.academicYear,
      grant.totalRows,
      grant.maxRows,
      grant.maxBytes,
      pins,
    ]),
  );
}
function claimMatches(
  active: ActiveClaim | null,
  claim: StudentStageClaim,
  digest: string,
): boolean {
  return !!active && active.fence === claim.fence && active.claimId === claim.claimId &&
    active.expectedVersion === claim.expectedVersion && active.grantDigest === digest;
}
/** Bound stream read; wait for cancellation to finish rather than detaching it. */
async function readExactBody(
  object: R2StoredBody,
  expected: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!object.body || !Number.isSafeInteger(expected) || expected < 1 || object.size !== expected) {
    fail();
  }
  const reader = object.body.getReader(), chunks: Uint8Array[] = [];
  let count = 0, complete = false, cancel: Promise<boolean> | null = null;
  const onAbort = () => {
    cancel ??= reader.cancel().then(() => true, () => false);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    for (;;) {
      check(signal);
      const part = await reader.read();
      check(signal);
      if (part.done) {
        complete = true;
        break;
      }
      if (
        !(part.value instanceof Uint8Array) || !part.value.byteLength ||
        (count += part.value.byteLength) > expected
      ) fail();
      chunks.push(Uint8Array.from(part.value));
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!complete) onAbort();
    if (cancel && !await cancel) fail();
    reader.releaseLock();
  }
  if (count !== expected) fail();
  const output = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
/** No log statements, direct browser methods, public URL or deletion operations. */
export class StudentCacheR2DurableCoordinatorCandidate {
  private readonly prefix: string;
  constructor(
    private readonly actor: StudentDurableState,
    private readonly bucket: PrivateStudentR2,
    private readonly authority: StudentPublicationAuthority,
    prefix: string,
  ) {
    if (
      !actor?.id || typeof actor.id.toString !== "function" || !actor.storage ||
      typeof actor.storage.transaction !== "function" || !bucket ||
      typeof bucket.put !== "function" ||
      typeof bucket.get !== "function" || !authority ||
      typeof authority.assertCurrent !== "function" ||
      typeof authority.trustedName !== "function" || typeof authority.verifyCoverage !== "function"
    ) fail();
    this.prefix = prefixOf(prefix);
  }
  private async current(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
  ): Promise<void> {
    if (!request || !boundary?.admission || !boundary.signal) fail();
    const signal = boundary.signal, admission = boundary.admission;
    check(signal);
    await this.authority.assertCurrent(request, boundary, grant, this.actor, this.bucket);
    if (boundary.signal !== signal || boundary.admission !== admission) fail();
    check(signal);
  }
  /**
   * Request-scoped adapter for the existing private-cache application reader. The pointer,
   * private key and R2 upload version never enter the returned DTO. Application-level
   * authority still verifies current profile, ownership, content and complete coverage.
   */
  readPort(request: ApiExecution, boundary: ApiExecutionBoundary): StudentCachePrivateReadPort {
    let selected:
      | Readonly<{ grant: StudentCacheReadGrant; digest: string; pointer: InternalPointer }>
      | null = null;
    return Object.freeze({
      head: async (
        grant: StudentCacheReadGrant,
        signal: AbortSignal,
      ): Promise<StudentCacheReadHead | null> => {
        if (signal !== boundary.signal) fail();
        selected = null;
        await this.current(request, boundary, grant);
        const digest = await sha(grantBytes(grant));
        const pointer = await this.actor.storage.transaction(async (tx) =>
          (await tx.get<CoordinatorState>(STATE_KEY))?.current ?? null
        );
        await this.current(request, boundary, grant);
        if (digest !== await sha(grantBytes(grant))) fail();
        if (pointer === null) return null;
        if (
          pointer.grantDigest !== digest || pointer.head.studentId !== grant.studentId ||
          pointer.head.profileId !== grant.profileId || pointer.head.reportId !== grant.reportId ||
          pointer.head.reportRevision !== grant.reportRevision ||
          pointer.head.academicYear !== 2027 ||
          pointer.head.totalRows !== grant.totalRows || !ID.test(pointer.head.version) ||
          !HASH.test(pointer.head.payloadSha256) || !HASH.test(pointer.head.coverageSha256) ||
          typeof pointer.objectVersion !== "string" || !ID.test(pointer.objectVersion) ||
          typeof pointer.objectKey !== "string" ||
          !pointer.objectKey.startsWith(this.prefix + grant.studentId + "/") ||
          !Number.isSafeInteger(pointer.head.payloadBytes) || pointer.head.payloadBytes < 1 ||
          pointer.head.payloadBytes > grant.maxBytes
        ) fail();
        selected = Object.freeze({ grant, digest, pointer });
        return pointer.head;
      },
      bytes: async (
        grant: StudentCacheReadGrant,
        head: StudentCacheReadHead,
        signal: AbortSignal,
      ): Promise<Uint8Array> => {
        if (
          signal !== boundary.signal || !selected || selected.grant !== grant ||
          selected.pointer.head.version !== head.version ||
          selected.pointer.head.payloadSha256 !== head.payloadSha256
        ) fail();
        const prior = selected;
        await this.current(request, boundary, grant);
        if (prior.digest !== await sha(grantBytes(grant))) fail();
        const object = await this.bucket.get(prior.pointer.objectKey);
        if (
          !object || object.key !== prior.pointer.objectKey ||
          object.version !== prior.pointer.objectVersion ||
          object.size !== head.payloadBytes
        ) {
          if (object?.body) await object.body.cancel();
          fail();
        }
        const bytes = await readExactBody(object, head.payloadBytes, signal);
        if (await sha(bytes) !== head.payloadSha256) fail();
        await this.current(request, boundary, grant);
        const latest = await this.actor.storage.transaction(async (tx) =>
          (await tx.get<CoordinatorState>(STATE_KEY))?.current ?? null
        );
        if (
          !latest || latest.head.version !== head.version || latest.grantDigest !== prior.digest ||
          latest.objectVersion !== prior.pointer.objectVersion ||
          prior.digest !== await sha(grantBytes(grant))
        ) fail();
        await this.current(request, boundary, grant);
        return bytes;
      },
    });
  }
  /** A lost claim response requires explicit durable reconciliation. No lease-expiry retry. */
  async claim(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
  ): Promise<StudentStageClaim> {
    // Keep even claim/staging disabled until an actual profile-writer fence exists; otherwise
    // a candidate could create unpublishable private objects that the user asked us to preserve.
    if (!PROFILE_PUBLICATION_FENCE_IMPLEMENTED) return fail();
    await this.current(request, boundary, grant);
    const digest = await sha(grantBytes(grant));
    await this.current(request, boundary, grant);
    const claimId = crypto.randomUUID();
    return await this.actor.storage.transaction(async (tx) => {
      const old = await tx.get<CoordinatorState>(STATE_KEY) ??
        { sequence: 0, current: null, active: null };
      if (
        !Number.isSafeInteger(old.sequence) || old.sequence < 0 ||
        old.sequence >= Number.MAX_SAFE_INTEGER || old.active !== null
      ) fail();
      const fence = old.sequence + 1, expectedVersion = old.current?.head.version ?? null;
      const claim = Object.freeze({ fence, claimId, expectedVersion });
      await tx.put(STATE_KEY, {
        sequence: fence,
        current: old.current,
        active: { ...claim, grantDigest: digest, status: "CLAIMED" },
      });
      return claim;
    });
  }
  /**
   * Stage a complete immutable private object only; never changes the current pointer.
   * A failed or unconfirmed R2 PUT/readback marks the claim UNKNOWN and blocks new work.
   * The caller must independently hold the request reservation until all physical I/O stops.
   */
  async stage(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
    claim: StudentStageClaim,
    raw: Uint8Array,
  ): Promise<"staged" | "unknown"> {
    if (!PROFILE_PUBLICATION_FENCE_IMPLEMENTED) return fail();
    await this.current(request, boundary, grant);
    if (
      !(raw instanceof Uint8Array) || raw.byteLength < 1 || raw.byteLength > grant.maxBytes ||
      !claim || !UUID.test(claim.claimId) || !Number.isSafeInteger(claim.fence) ||
      claim.fence < 1 ||
      !(claim.expectedVersion === null || ID.test(claim.expectedVersion))
    ) fail();
    const body = Uint8Array.from(raw),
      digest = await sha(grantBytes(grant)),
      bodySha = await sha(body);
    let parsed: unknown;
    try {
      parsed = parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      return fail();
    }
    if (
      !Array.isArray(parsed) || parsed.length !== grant.totalRows || parsed.length > grant.maxRows
    ) fail();
    const rows = parsed.map(validateStudentCacheFiveFields);
    const keys = Object.freeze(rows.map((row) => row.학교및학교PK값));
    if (new Set(keys.map((k) => JSON.stringify([k.학교PK, k.모집행PK]))).size !== keys.length) {
      fail();
    }
    const coverage = await this.authority.verifyCoverage(grant, keys, boundary.signal);
    if (typeof coverage !== "string" || !HASH.test(coverage)) fail();
    const name = await this.authority.trustedName(grant, boundary.signal);
    const basename = nameOf(grant.studentId, name);
    const objectKey = `${this.prefix}${grant.studentId}/${claim.claimId}/${basename}`;
    if (new TextEncoder().encode(objectKey).length > 1024) fail();
    await this.current(request, boundary, grant);
    await this.actor.storage.transaction(async (tx) => {
      const old = await tx.get<CoordinatorState>(STATE_KEY);
      if (!old || !claimMatches(old.active, claim, digest) || old.active?.status !== "CLAIMED") {
        fail();
      }
      await tx.put(STATE_KEY, { ...old, active: { ...old.active, status: "WRITING" } });
    });
    const markUnknown = async () => {
      await this.actor.storage.transaction(async (tx) => {
        const old = await tx.get<CoordinatorState>(STATE_KEY);
        if (!old || !claimMatches(old.active, claim, digest)) fail();
        await tx.put(STATE_KEY, { ...old, active: { ...old.active, status: "UNKNOWN" } });
      });
    };
    try {
      check(boundary.signal);
      const onlyIf = new Headers();
      onlyIf.set("If-None-Match", "*");
      const saved = await this.bucket.put(objectKey, body, {
        onlyIf,
        customMetadata: { "payload-sha256": bodySha, "coverage-sha256": coverage },
        httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
      });
      if (
        !saved || saved.key !== objectKey || !ID.test(saved.version) ||
        saved.size !== body.byteLength
      ) {
        await markUnknown();
        return "unknown";
      }
      check(boundary.signal);
      const readback = await this.bucket.get(objectKey);
      if (
        !readback || readback.key !== objectKey || readback.version !== saved.version ||
        readback.size !== body.byteLength || !readback.body
      ) {
        await markUnknown();
        return "unknown";
      }
      const actual = await readExactBody(readback, body.byteLength, boundary.signal);
      const count = actual.byteLength;
      if (await sha(actual) !== bodySha) {
        await markUnknown();
        return "unknown";
      }
      await this.current(request, boundary, grant);
      if (digest !== await sha(grantBytes(grant))) {
        await markUnknown();
        return "unknown";
      }
      const receipt: StageReceipt = Object.freeze({
        claim: Object.freeze({ ...claim }),
        payloadSha256: bodySha,
        payloadBytes: count,
        coverageSha256: coverage,
        objectKey,
        objectVersion: saved.version,
        grantDigest: digest,
      });
      await this.actor.storage.transaction(async (tx) => {
        const old = await tx.get<CoordinatorState>(STATE_KEY);
        if (!old || !claimMatches(old.active, claim, digest) || old.active?.status !== "WRITING") {
          fail();
        }
        // Immutable receipt is server-only; do not return its path to the API caller.
        await tx.put(`receipt/${claim.fence}`, receipt);
        await tx.put(STATE_KEY, { ...old, active: { ...old.active, status: "STAGED" } });
      });
      return "staged";
    } catch {
      try {
        await markUnknown();
      } catch { /* WRITING remains a blocking uncertain claim. */ }
      return "unknown";
    }
  }
  /**
   * Publication is NOT executable until the real profile writer and this coordinator share a
   * proven fence. Merely checking DB profile before/after an R2 write cannot guarantee that.
   * No current pointer is touched while this constant remains false.
   */
  async publish(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: StudentCacheReadGrant,
    claim: StudentStageClaim,
  ): Promise<"published"> {
    if (!PROFILE_PUBLICATION_FENCE_IMPLEMENTED) return fail();
    await this.current(request, boundary, grant);
    const digest = await sha(grantBytes(grant));
    return await this.actor.storage.transaction(async (tx) => {
      const old = await tx.get<CoordinatorState>(STATE_KEY),
        receipt = await tx.get<StageReceipt>(`receipt/${claim.fence}`);
      if (
        !old || !receipt || !claimMatches(old.active, claim, digest) ||
        old.active?.status !== "STAGED" ||
        receipt.grantDigest !== digest || receipt.claim.claimId !== claim.claimId ||
        (old.current?.head.version ?? null) !== claim.expectedVersion
      ) fail();
      const version = `f${claim.fence}-${claim.claimId}`;
      const head: StudentCacheReadHead = Object.freeze({
        studentId: grant.studentId,
        profileId: grant.profileId,
        reportId: grant.reportId,
        reportRevision: grant.reportRevision,
        academicYear: 2027,
        version,
        payloadSha256: receipt.payloadSha256,
        payloadBytes: receipt.payloadBytes,
        coverageSha256: receipt.coverageSha256,
        totalRows: grant.totalRows,
        pins: grant.pins,
      });
      await tx.put(`published/${claim.fence}`, {
        head,
        objectKey: receipt.objectKey,
        objectVersion: receipt.objectVersion,
        grantDigest: digest,
      });
      await tx.put(STATE_KEY, {
        sequence: old.sequence,
        current: {
          head,
          objectKey: receipt.objectKey,
          objectVersion: receipt.objectVersion,
          grantDigest: digest,
        },
        active: null,
      });
      return "published" as const;
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
