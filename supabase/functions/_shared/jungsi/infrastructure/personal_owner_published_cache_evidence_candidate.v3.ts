/** REVIEW ONLY: no score or CDF calculation on an already published personal-owner cache hit. */
import { AccessError } from "../application/access.ts";
import {
  type PersonalOwnerStorageIdentity,
  type PersonalOwnerStorageScopePorts,
  withVerifiedPersonalOwnerStorageScope,
} from "../application/personal_owner_storage_scope_candidate.ts";
import {
  type PersonalSelfStudentNameAuthority,
  withPersonalSelfStudentFilename,
} from "../application/personal_self_student_filename_candidate.ts";
import {
  type PersonalOwnerCacheReadAuthority,
  type PersonalOwnerPrivateReadPort,
  readCurrentPersonalOwnerCache,
} from "../application/personal_owner_cache_read_candidate.ts";
import {
  PersonalOwnerNamedR2Reader,
  type PrivateR2Bucket,
} from "./personal_owner_named_cache_r2_read_candidate.ts";
import type { StudentCacheFiveFields } from "../application/student_score_cache_bounded_workflow_candidate.ts";
import { nativeJsonSha256 } from "../domain/json_value.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type {
  ReferenceBatchEvidenceAuthority,
  ReferenceBatchScope,
} from "./student_reference_batch_provider_candidate.ts";

export type PublishedPersonalRowProof = Readonly<
  {
    offeringId: string;
    schoolId: string;
    rowSha256: string;
    resultSha256: string;
    ruleSha256: string;
    cdfSha256: string;
    methodSha256: string;
  }
>;
export type PublishedPersonalEvidence = Readonly<
  {
    ownerUuid: string;
    profileId: string;
    reportId: string;
    reportRevision: number;
    examSha256: string;
    profileSha256: string;
    sourceHeadSha256: string;
    referenceManifestSha256: string;
    objectVersion: string;
    payloadSha256: string;
    generation: string;
    rows: readonly PublishedPersonalRowProof[];
    receipt: object;
  }
>;
/** Real server control/writer issuer, NOT implemented here. It must authenticate the active
 * owner/admission and current protected control, immutable payload/version, writer receipt,
 * head, exam, rule/CDF, generation, exact row/result digests and revocation before returning.
 * Never accept a client claim, flag or digest as evidence. Batch I/O and physical quiescence
 * must be within the actual request budget; stale/unknown publication must remain unavailable. */
export interface PersonalPublishedCacheAuthority {
  /** Must prove this exact inner provider only reads issued evidence and does not recompute
   * school scores, CDF or initiate unbudgeted I/O on cache hits. */
  assertReadOnlySource(
    scope: ReferenceBatchScope,
    inner: ReferenceBatchEvidenceAuthority,
  ): Promise<void>;
  issue(
    scope: ReferenceBatchScope,
    identity: PersonalOwnerStorageIdentity,
    rows: readonly StudentCacheFiveFields[],
  ): Promise<PublishedPersonalEvidence>;
  assertCurrent(
    scope: ReferenceBatchScope,
    identity: PersonalOwnerStorageIdentity,
    rows: readonly StudentCacheFiveFields[],
    evidence: PublishedPersonalEvidence,
  ): Promise<void>;
  awaitQuiescence(signal: AbortSignal): Promise<void>;
}
type OwnerStorage =
  | Readonly<{ kind: "owner_code"; storage: PersonalOwnerPrivateReadPort }>
  | Readonly<
    {
      kind: "verified_self_student_name";
      names: PersonalSelfStudentNameAuthority;
      bucket: PrivateR2Bucket;
      prefix: string;
    }
  >;
export type PublishedPersonalCacheInputs = Readonly<
  {
    scope: PersonalOwnerStorageScopePorts;
    cacheAuthority: PersonalOwnerCacheReadAuthority;
    storage: OwnerStorage;
    publication: PersonalPublishedCacheAuthority;
    awaitQuiescence(signal: AbortSignal): Promise<void>;
  }
>;
type Issued = Awaited<ReturnType<ReferenceBatchEvidenceAuthority["issue"]>>;
type State = Readonly<
  {
    scope: ReferenceBatchScope;
    issued: Issued;
    innerIssued: Issued;
    rows: readonly StudentCacheFiveFields[];
    evidence: PublishedPersonalEvidence;
  }
>;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function frozenData(value: unknown): boolean {
  if (
    !value || typeof value !== "object" || Array.isArray(value) || !Object.isFrozen(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) return false;
  return Reflect.ownKeys(value).every((k) =>
    typeof k === "string" && !!Object.getOwnPropertyDescriptor(value, k) &&
    "value" in Object.getOwnPropertyDescriptor(value, k)!
  );
}
export class PersonalOwnerPublishedCacheEvidence implements ReferenceBatchEvidenceAuthority {
  private state: State | null = null;
  private started = false;
  constructor(
    private readonly inner: ReferenceBatchEvidenceAuthority,
    private readonly inputs: PublishedPersonalCacheInputs,
  ) {
    if (
      !inner || !inputs?.scope || !inputs.cacheAuthority || !inputs.storage ||
      !inputs.publication ||
      typeof inputs.publication.issue !== "function" ||
      typeof inputs.publication.assertReadOnlySource !== "function" ||
      typeof inputs.publication.assertCurrent !== "function" ||
      typeof inputs.publication.awaitQuiescence !== "function" ||
      typeof inputs.awaitQuiescence !== "function"
    ) fail();
  }
  assertContext(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    rows: ReferenceBatchScope["rows"],
  ): Promise<void> {
    return this.inner.assertContext(request, boundary, rows);
  }
  assertMetadataHead(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    head: Parameters<ReferenceBatchEvidenceAuthority["assertMetadataHead"]>[2],
  ): Promise<void> {
    return this.inner.assertMetadataHead(request, boundary, head);
  }
  private params(scope: ReferenceBatchScope) {
    const body = scope.request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) fail();
    const profile = Object.getOwnPropertyDescriptor(body, "profile_id")?.value;
    const expected = Object.getOwnPropertyDescriptor(body, "expected_version")?.value;
    const revision = typeof expected === "bigint" && expected <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(expected)
      : expected;
    if (
      typeof profile !== "string" || typeof scope.request.params.report_id !== "string" ||
      typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1
    ) fail();
    return Object.freeze({
      reportId: scope.request.params.report_id,
      profileId: profile,
      reportRevision: revision,
    });
  }
  private async read(scope: ReferenceBatchScope, identity: PersonalOwnerStorageIdentity) {
    const s = this.inputs.storage;
    if (s.kind === "owner_code") {
      return await readCurrentPersonalOwnerCache(
        scope.request,
        scope.boundary,
        identity,
        this.inputs.cacheAuthority,
        s.storage,
      );
    }
    if (s.kind !== "verified_self_student_name") fail();
    return await withPersonalSelfStudentFilename(
      scope.request,
      scope.boundary,
      identity,
      s.names,
      async (name) => {
        if (name.state !== "ready") return Object.freeze({ state: "pending" as const, rows: null });
        const storage = new PersonalOwnerNamedR2Reader(s.bucket, s.prefix, name);
        return await readCurrentPersonalOwnerCache(
          scope.request,
          scope.boundary,
          identity,
          this.inputs.cacheAuthority,
          storage,
        );
      },
    );
  }
  async issue(scope: ReferenceBatchScope): Promise<Issued> {
    if (this.started || !scope || !scope.boundary?.admission || scope.boundary.signal.aborted) {
      fail();
    }
    this.started = true;
    const { request, boundary } = scope;
    const holder: {
      rows: readonly StudentCacheFiveFields[] | null;
      evidence: PublishedPersonalEvidence | null;
    } = { rows: null, evidence: null };
    await withVerifiedPersonalOwnerStorageScope(
      request,
      boundary,
      this.params(scope),
      this.inputs.scope,
      async (identity) => {
        const cache = await this.read(scope, identity);
        if (cache.state !== "ready") fail();
        const byKey = new Map(
          cache.rows.map(
            (
              row,
            ) => [JSON.stringify([row.학교및학교PK값.학교PK, row.학교및학교PK값.모집행PK]), row],
          ),
        );
        if (
          byKey.size !== cache.rows.length || !Array.isArray(scope.rows) ||
          !Object.isFrozen(scope.rows) || scope.rows.length > 100
        ) fail();
        const selected: StudentCacheFiveFields[] = [];
        for (const row of scope.rows) {
          const key = JSON.stringify([row.학교및학교PK값.학교PK, row.학교및학교PK값.모집행PK]),
            current = byKey.get(key);
          if (!current || await nativeJsonSha256(current) !== await nativeJsonSha256(row)) fail();
          selected.push(current);
        }
        const rows = Object.freeze(selected),
          evidence = await this.inputs.publication.issue(scope, identity, rows);
        if (
          !frozenData(evidence) || evidence.ownerUuid !== identity.ownerUuid ||
          evidence.profileId !== identity.profileId ||
          evidence.reportId !== identity.reportId ||
          evidence.reportRevision !== identity.reportRevision ||
          !HASH.test(evidence.examSha256) || !HASH.test(evidence.profileSha256) ||
          !HASH.test(evidence.sourceHeadSha256) ||
          evidence.sourceHeadSha256 !== scope.publication.sourceHeadSha256 ||
          !HASH.test(evidence.referenceManifestSha256) ||
          !HASH.test(evidence.payloadSha256) || !ID.test(evidence.objectVersion) ||
          !ID.test(evidence.generation) ||
          !Array.isArray(evidence.rows) || !Object.isFrozen(evidence.rows) ||
          evidence.rows.length > rows.length ||
          !evidence.receipt || typeof evidence.receipt !== "object" ||
          !Object.isFrozen(evidence.receipt)
        ) fail();
        const ids = new Set<string>();
        for (const e of evidence.rows) {
          if (
            !frozenData(e) || !ID.test(e.offeringId) || !ID.test(e.schoolId) ||
            ids.has(e.offeringId) ||
            ![e.rowSha256, e.resultSha256, e.ruleSha256, e.cdfSha256, e.methodSha256].every((h) =>
              HASH.test(h)
            )
          ) fail();
          const row = rows.find((x) =>
            "2027:" + x.학교및학교PK값.모집행PK === e.offeringId &&
            x.학교및학교PK값.학교PK === e.schoolId
          );
          const metadata = scope.metadata.find((x) =>
            "2027:" + x.key.offeringPk === e.offeringId && x.key.schoolId === e.schoolId
          );
          if (
            !row || await nativeJsonSha256(row) !== e.rowSha256 || !metadata ||
            metadata.status !== "metadata_available" ||
            !metadata.pin || metadata.pin.cdfSha256 !== e.cdfSha256 ||
            metadata.pin.methodSha256 !== e.methodSha256 ||
            metadata.pin.manifestSha256 !== evidence.referenceManifestSha256
          ) fail();
          ids.add(e.offeringId);
        }
        await this.inputs.publication.assertCurrent(scope, identity, rows, evidence);
        holder.rows = rows;
        holder.evidence = evidence;
      },
    );
    if (!holder.rows || !holder.evidence || boundary.signal.aborted) fail();
    const allowed = new Set(holder.evidence.rows.map((x) => x.offeringId));
    await this.inputs.publication.assertReadOnlySource(scope, this.inner);
    const innerIssued = await this.inner.issue(scope);
    await this.inputs.publication.assertReadOnlySource(scope, this.inner);
    if (
      !innerIssued || !Object.isFrozen(innerIssued) || !Array.isArray(innerIssued.items) ||
      !Object.isFrozen(innerIssued.items) || !innerIssued.proof ||
      !Object.isFrozen(innerIssued.proof) ||
      !innerIssued.receipt || typeof innerIssued.receipt !== "object" ||
      !Object.isFrozen(innerIssued.receipt)
    ) fail();
    const issued: Issued = Object.freeze({
      ...innerIssued,
      items: Object.freeze(innerIssued.items.filter((item) => allowed.has(item.offeringId))),
    });
    this.state = Object.freeze({
      scope,
      issued,
      innerIssued,
      rows: holder.rows,
      evidence: holder.evidence,
    });
    await this.assertIssued(scope, issued);
    return issued;
  }
  async assertIssued(scope: ReferenceBatchScope, issued: Issued): Promise<void> {
    const s = this.state;
    if (!s || s.scope !== scope || s.issued !== issued || scope.boundary.signal.aborted) fail();
    await this.inputs.publication.assertReadOnlySource(scope, this.inner);
    await this.inner.assertIssued(scope, s.innerIssued);
    await withVerifiedPersonalOwnerStorageScope(
      scope.request,
      scope.boundary,
      this.params(scope),
      this.inputs.scope,
      async (identity) => {
        if (
          identity.ownerUuid !== s.evidence.ownerUuid ||
          identity.profileId !== s.evidence.profileId ||
          identity.reportId !== s.evidence.reportId ||
          identity.reportRevision !== s.evidence.reportRevision
        ) fail();
        await this.inputs.publication.assertCurrent(scope, identity, s.rows, s.evidence);
      },
    );
  }
  async awaitQuiescence(signal: AbortSignal): Promise<void> {
    const done = await Promise.allSettled([
      this.inner.awaitQuiescence(signal),
      this.inputs.awaitQuiescence(signal),
      this.inputs.publication.awaitQuiescence(signal),
    ]);
    if (done.some((x) => x.status !== "fulfilled")) fail();
  }
}
