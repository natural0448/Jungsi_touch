/** Server-side P1 list composition candidate. No route or database writer is installed.
 * The caller supplies only a snapshot-backed server scope; a trusted provider must
 * independently bind the request, snapshot, catalogue head and per-target HOLD state. */
import { AccessError } from "./jungsi/application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./jungsi/application/api_dispatch.ts";
import { sessionDto } from "./jungsi/application/session_service.ts";
import { hasAsciiControl } from "./jungsi/domain/text.ts";
import { nativeJsonSha256, nativeJsonText } from "./jungsi/domain/json_value.ts";
import { JsonFloat, type NativeJson } from "./jungsi/domain/native_json.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import {
  type CurrentPublicCatalogPort,
  type PublicCatalogPublication,
  type PublicCatalogRecord,
  publicCatalogRecruitment,
} from "./current_public_catalog.ts";

const HASH = /^[a-f0-9]{64}$/;
const isHash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
// Match history_snapshot's snapshot_id contract; this is not a publication hash.
const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SOURCE = /^(2024|2025|2026|2027):[A-Za-z0-9][A-Za-z0-9._:-]{0,122}$/;
const TARGET = /^2027:[A-Za-z0-9][A-Za-z0-9._:-]{0,122}$/;
const fail = (code = "security_policy_unavailable"): never => {
  throw new AccessError(code, 503);
};
type Binding = Readonly<{
  subject: string;
  snapshot: string;
  snapshotPublication: string;
  snapshotSourceHead: string;
  snapshotPart: string | null;
  snapshotPartSha256: string;
  correspondenceSha256: string;
  publication: string;
  head: string;
  scopeRevision: string;
}>;
export type NativeQuotaValue = string | number | bigint;
type QuotaNativeType = "missing" | "null" | "string" | "number" | "bigint" | "other";
/** The provider must obtain this digest and type from an independent current
 * Guide record, rather than echoing the row supplied to classify(). */
export type VerifiedGuideEvidence = Readonly<{
  status: "verified";
  targetId: string;
  guideHead: string;
  guideRecordSha256: string;
  quotaNativeType: QuotaNativeType;
}>;
type GuideBoundEvidence = Readonly<{
  targetId: string;
  guideHead: string;
  guideRecordSha256: string;
}>;
export type VerifiedQuotaStage =
  & Readonly<{
    status: "verified";
    stage: "initial" | "final";
  }>
  & GuideBoundEvidence;
/** The trusted provider must independently bind this base-count evidence to the
 * same target and head. It is never inferred from an unknown condition alone. */
export type ConfirmedBaseRecruitment =
  & Readonly<{
    status: "confirmed";
    initialValue: NativeQuotaValue;
  }>
  & GuideBoundEvidence;
/** Independent evidence; ordinary condition text is not evidence of rollover. */
export type UnresolvedRolloverEvidence =
  & Readonly<{
    status: "verified";
    state: "unresolved";
  }>
  & GuideBoundEvidence;
export type SnapshotBatchDecision = Readonly<
  {
    sourceId: string;
    targetId: string;
    decision: "ALLOW" | "HOLD" | "EXCLUDE";
    relation: "ALLOW" | "HOLD";
    condition: "none" | "conditional" | "unknown";
    conditionText: string | null;
    targetEvidence?: VerifiedGuideEvidence;
    stageEvidence?: VerifiedQuotaStage;
    baseRecruitmentEvidence?: ConfirmedBaseRecruitment;
    rolloverEvidence?: UnresolvedRolloverEvidence;
  }
>;
/** Never supplied by the browser. Must verify each source ID belongs to the exact
 * selected snapshot part and independently bind the approved snapshot publication,
 * source head and part digest to the Guide head and correspondence proof. The two
 * heads and scopeRevision are distinct; none substitutes for another. Must check
 * admission and current target HOLD/exclusion and public condition evidence.
 * Target fingerprint and stage proof must be independently sourced; the canonical
 * digest in this candidate is not an existing DB fingerprint or source approval.
 * publication() precedes bind(); real I/O still requires an independent trusted
 * authorization and budget admission before that first port call. */
export interface SnapshotBatchTrust {
  bind(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    snapshot: string,
    partId: string | null,
    sourceIds: readonly string[],
    publication: PublicCatalogPublication,
  ): Promise<Binding>;
  classify(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    binding: Binding,
    records: readonly PublicCatalogRecord[],
  ): Promise<readonly SnapshotBatchDecision[]>;
}
/** Pending is a value/relation state, not proof that a verified recruitment row is absent.
 * The consumer must preserve independently verified current recruitment rows. */
export type SnapshotBatchItem = Readonly<
  { sourceId: string; status: "pending" | "excluded" } | {
    sourceId: string;
    status: "reference";
    value: NativeQuotaValue;
    displayValue: string;
    stage: "initial" | "final" | "unknown";
    conditionText: string | null;
    carryoverStatus?: "unresolved";
  }
>;
function checkedBinding(
  raw: Binding,
  subject: string,
  snapshot: string,
  partId: string | null,
  pub: PublicCatalogPublication,
): Binding {
  const b = Object.freeze({
    subject: ownData(raw, "subject"),
    snapshot: ownData(raw, "snapshot"),
    snapshotPublication: ownData(raw, "snapshotPublication"),
    snapshotSourceHead: ownData(raw, "snapshotSourceHead"),
    snapshotPart: ownData(raw, "snapshotPart"),
    snapshotPartSha256: ownData(raw, "snapshotPartSha256"),
    correspondenceSha256: ownData(raw, "correspondenceSha256"),
    publication: ownData(raw, "publication"),
    head: ownData(raw, "head"),
    scopeRevision: ownData(raw, "scopeRevision"),
  }) as Binding;
  if (
    b.subject !== subject || b.snapshot !== snapshot || b.snapshotPart !== partId ||
    b.publication !== pub.sha256 || !isHash(b.head) || !isHash(b.scopeRevision) ||
    !isHash(b.snapshotPublication) || !isHash(b.snapshotSourceHead) ||
    !isHash(b.snapshotPartSha256) || !isHash(b.correspondenceSha256)
  ) return fail();
  return b;
}
function same(a: Binding, b: Binding): boolean {
  return a.subject === b.subject && a.snapshot === b.snapshot && a.publication === b.publication &&
    a.head === b.head && a.scopeRevision === b.scopeRevision &&
    a.snapshotPublication === b.snapshotPublication &&
    a.snapshotSourceHead === b.snapshotSourceHead &&
    a.snapshotPart === b.snapshotPart && a.snapshotPartSha256 === b.snapshotPartSha256 &&
    a.correspondenceSha256 === b.correspondenceSha256;
}
// Preserve native number and bigint types while creating a defensive copy.
// The shared JSON round trip normalizes safe bigint values to number.
function clonePreservingNative<T extends NativeJson>(value: T): T {
  const seen = new Set<object>();
  function copy(v: unknown, depth: number): NativeJson {
    if (depth > 128) return fail();
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "bigint") {
      return v;
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))) return fail();
      return v;
    }
    if (v instanceof JsonFloat) {
      nativeJsonText(v);
      return new JsonFloat(v.lexeme);
    }
    if (typeof v !== "object" || seen.has(v)) return fail();
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      return fail();
    }
    seen.add(v);
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) return fail();
      const out: NativeJson[] = [];
      for (let i = 0; i < v.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(v, String(i));
        if (!descriptor || !("value" in descriptor)) return fail();
        out.push(copy(descriptor.value, depth + 1));
      }
      seen.delete(v);
      return out;
    }
    const out: { [key: string]: NativeJson } = Object.create(null);
    for (const key of Object.keys(v)) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (!descriptor || !("value" in descriptor)) return fail();
      out[key] = copy(descriptor.value, depth + 1);
    }
    seen.delete(v);
    return out;
  }
  return copy(value, 0) as T;
}
function freezeNative<T extends NativeJson>(v: T): T {
  if (v !== null && typeof v === "object") {
    for (const child of Array.isArray(v) ? v : Object.values(v)) freezeNative(child);
    Object.freeze(v);
  }
  return v;
}
function numberText(v: unknown): string | null {
  if (typeof v === "bigint") {
    return v >= 0n && v <= BigInt(Number.MAX_SAFE_INTEGER) ? String(v) : null;
  }
  if (typeof v === "number") {
    return Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0) ? String(v) : null;
  }
  if (
    typeof v === "string" && /^(?:0|[1-9][0-9]{0,15})$/.test(v) &&
    Number.isSafeInteger(Number(v))
  ) return v;
  return null;
}
function quotaNativeType(guide: NonNullable<PublicCatalogRecord["guide"]>): QuotaNativeType {
  if (!Object.hasOwn(guide, "quota_value")) return "missing";
  const value = guide.quota_value;
  if (value === null) return "null";
  const kind = typeof value;
  return kind === "string" || kind === "number" || kind === "bigint" ? kind : "other";
}
function nativeKey(v: unknown): string {
  if (v === undefined) return "missing";
  if (typeof v === "number" && Object.is(v, -0)) return "number:-0";
  return `${typeof v}:${nativeJsonText(v, true)}`;
}
function exactOwnData(value: unknown, fields: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (Reflect.ownKeys(value).length !== fields.length) return false;
  return fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return !!descriptor && "value" in descriptor;
  });
}
function ownData(value: unknown, field: string, optional = false): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const d = Object.getOwnPropertyDescriptor(value, field);
  if (!d) return optional ? undefined : fail();
  if (!("value" in d)) return fail();
  return d.value;
}
function freezeEvidence(value: unknown, fields: readonly string[]): unknown {
  if (value === undefined) return undefined;
  if (!exactOwnData(value, fields)) return fail();
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = ownData(value, field);
  return Object.freeze(out);
}
// Snapshot every data property synchronously before any following await.
function freezeDecision(value: unknown): SnapshotBatchDecision {
  const target = freezeEvidence(ownData(value, "targetEvidence", true), [
    "status",
    "targetId",
    "guideHead",
    "guideRecordSha256",
    "quotaNativeType",
  ]);
  const stage = freezeEvidence(ownData(value, "stageEvidence", true), [
    "status",
    "stage",
    "targetId",
    "guideHead",
    "guideRecordSha256",
  ]);
  const base = freezeEvidence(ownData(value, "baseRecruitmentEvidence", true), [
    "status",
    "initialValue",
    "targetId",
    "guideHead",
    "guideRecordSha256",
  ]);
  const rollover = freezeEvidence(ownData(value, "rolloverEvidence", true), [
    "status",
    "state",
    "targetId",
    "guideHead",
    "guideRecordSha256",
  ]);
  return Object.freeze({
    sourceId: ownData(value, "sourceId"),
    targetId: ownData(value, "targetId"),
    decision: ownData(value, "decision"),
    relation: ownData(value, "relation"),
    condition: ownData(value, "condition"),
    conditionText: ownData(value, "conditionText"),
    ...(target === undefined ? {} : { targetEvidence: target }),
    ...(stage === undefined ? {} : { stageEvidence: stage }),
    ...(base === undefined ? {} : { baseRecruitmentEvidence: base }),
    ...(rollover === undefined ? {} : { rolloverEvidence: rollover }),
  }) as SnapshotBatchDecision;
}
function guideStage(record: PublicCatalogRecord): "initial" | "final" | null {
  const metadata = record.guide?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const stage = "quota_stage" in metadata ? metadata.quota_stage : null;
  return stage === "initial" || stage === "final" ? stage : null;
}
function conditionalLiteral(record: PublicCatalogRecord): boolean {
  return !!record.guide && ["conditional_transfer", "conditional_carryover"].includes(
    String(record.guide.quota_literal_state),
  );
}
type QuotaProjection = {
  value: NativeQuotaValue;
  displayValue: string;
  stage: "initial" | "final" | "unknown";
};
function quotaProjection(v: unknown, stage: QuotaProjection["stage"]): QuotaProjection | null {
  const displayValue = numberText(v);
  return displayValue === null ? null : { value: v as NativeQuotaValue, displayValue, stage };
}
/** Map only when composing the existing snapshot DTO, which calls this state unspecified. */
export function snapshotRecruitmentStage(
  stage: QuotaProjection["stage"],
): "initial" | "final" | "unspecified" {
  return stage === "unknown" ? "unspecified" : stage;
}
function valueFor(
  record: PublicCatalogRecord,
  hasRolloverEvidence: boolean,
): QuotaProjection | null {
  if (!record.guide) return null;
  const q = publicCatalogRecruitment(record.guide);
  // Conditional literals need separately verified rollover evidence. Ordinary
  // condition text is independent and cannot establish that evidence.
  const conditional = ["conditional_transfer", "conditional_carryover"].includes(
    String(q.quota_literal_state),
  );
  if (
    q.quota_literal_state !== "numeric_literal" &&
    !(conditional && hasRolloverEvidence)
  ) return null;
  if (q.count_status === "verified_stage") {
    if (q.final_count !== null) {
      if (conditional) return null;
      const v = quotaProjection(q.final_count, "final");
      return v && v.displayValue !== "0" ? v : null;
    }
    return quotaProjection(q.initial_count, "initial");
  }
  if (
    (q.count_status === "quota_stage_unqualified" || q.count_status === "quota_not_numeric") &&
    (q.quota_literal_state === "numeric_literal" ||
      (conditional && hasRolloverEvidence))
  ) {
    const metadata = record.guide.metadata;
    const stage = metadata && typeof metadata === "object" && !Array.isArray(metadata) &&
        "quota_stage" in metadata
      ? metadata.quota_stage
      : null;
    if (stage === "initial") return quotaProjection(record.guide.quota_value, "initial");
    if (stage === "final" && conditional) return null;
    const v = quotaProjection(record.guide.quota_value, stage === "final" ? "final" : "unknown");
    return v && v.displayValue !== "0" ? v : null;
  }
  return null;
}
/** At most 100 unique IDs, divided into groups of 12 to respect the existing
 * key-index shard limit. Missing/held targets remain pending; explicit exclusions
 * are identified for the server caller. No new scope decision is created. */
export async function readSnapshotRecruitmentBatch(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  snapshot: string,
  rawIds: readonly string[],
  catalog: CurrentPublicCatalogPort,
  clock: RequestClockPort,
  trust: SnapshotBatchTrust | null,
): Promise<readonly SnapshotBatchItem[]> {
  if (
    !request || request.operation !== "history.snapshot.read" || !request.session?.user ||
    !boundary || !(boundary.signal instanceof AbortSignal) || boundary.signal.aborted ||
    !boundary.admission || !trust || typeof trust.bind !== "function" ||
    typeof trust.classify !== "function"
  ) return fail();
  const requestParams = request.params;
  if (!requestParams || typeof requestParams !== "object" || Array.isArray(requestParams)) {
    throw new AccessError("invalid_request", 422);
  }
  const paramKeys = Reflect.ownKeys(requestParams),
    snapshotDescriptor = Object.getOwnPropertyDescriptor(requestParams, "snapshot_id");
  if (
    paramKeys.length !== 1 || paramKeys[0] !== "snapshot_id" || !snapshotDescriptor ||
    !("value" in snapshotDescriptor) || typeof snapshotDescriptor.value !== "string" ||
    !SNAPSHOT_ID.test(snapshotDescriptor.value)
  ) {
    throw new AccessError("invalid_request", 422);
  }
  const requestedSnapshot: string = snapshotDescriptor.value;
  if (typeof snapshot !== "string" || !SNAPSHOT_ID.test(snapshot)) return fail();
  if (requestedSnapshot !== snapshot) throw new AccessError("publication_changed", 409);
  const query = request.query;
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw new AccessError("invalid_request", 422);
  }
  const queryKeys = Reflect.ownKeys(query),
    partDescriptor = Object.getOwnPropertyDescriptor(query, "part_id");
  if (
    queryKeys.some((key) => key !== "part_id") ||
    (partDescriptor && (!("value" in partDescriptor) ||
      typeof partDescriptor.value !== "string" || !SNAPSHOT_ID.test(partDescriptor.value)))
  ) throw new AccessError("invalid_request", 422);
  const partId: string | null = partDescriptor ? partDescriptor.value : null;
  if (
    !Array.isArray(rawIds) || rawIds.length < 1 ||
    rawIds.length > 100 ||
    rawIds.some((x) => typeof x !== "string" || !SOURCE.test(x)) ||
    new Set(rawIds).size !== rawIds.length
  ) return fail();
  const ids = Object.freeze([...rawIds]),
    session = request.session,
    user = session.user,
    subject = user.subjectId;
  const signal = boundary.signal, admission = boundary.admission;
  const check = () => {
    const currentPart = Object.getOwnPropertyDescriptor(query, "part_id");
    const currentSnapshot = Object.getOwnPropertyDescriptor(requestParams, "snapshot_id");
    const currentParamKeys = Reflect.ownKeys(requestParams);
    if (
      request.operation !== "history.snapshot.read" ||
      request.session !== session || session.user !== user || user.subjectId !== subject ||
      request.params !== requestParams || currentParamKeys.length !== 1 ||
      currentParamKeys[0] !== "snapshot_id" || !currentSnapshot || !("value" in currentSnapshot) ||
      currentSnapshot.value !== requestedSnapshot ||
      request.query !== query || Reflect.ownKeys(query).some((key) => key !== "part_id") ||
      (!!currentPart !== !!partDescriptor) ||
      (currentPart && (!("value" in currentPart) || currentPart.value !== partId)) ||
      boundary.signal !== signal || signal.aborted || boundary.admission !== admission
    ) return fail();
    sessionDto(session, clock.nowUtc());
  };
  check();
  const pub = await catalog.publication();
  check();
  if (
    !pub || !isHash(pub.sha256) || typeof pub.version !== "string" ||
    typeof pub.expiresAtUtc !== "bigint" || pub.expiresAtUtc <= clock.nowUtc()
  ) return fail("current_catalog_publication_unapproved");
  const pinned = Object.freeze({
    version: pub.version,
    sha256: pub.sha256,
    expiresAtUtc: pub.expiresAtUtc,
  });
  const first = checkedBinding(
    await trust.bind(request, boundary, snapshot, partId, ids, pinned),
    subject,
    snapshot,
    partId,
    pinned,
  );
  check();
  const loaded: PublicCatalogRecord[] = [];
  // Each group can touch at most 12 shards. The trust provider must authorize
  // and budget the complete set and all bounded reads before this point.
  for (let offset = 0; offset < ids.length; offset += 12) {
    const part = Object.freeze(ids.slice(offset, offset + 12));
    const page = await catalog.lookup(subject, part, true);
    check();
    if (
      !page || page.version !== pinned.version || page.head !== first.head ||
      typeof page.asOfUtc !== "bigint" ||
      !Array.isArray(page.rows) || page.rows.length > part.length || page.nextAfter
    ) return fail("current_catalog_state_unapproved");
    for (const raw of page.rows) {
      const r = freezeNative(
        clonePreservingNative(raw as unknown as NativeJson),
      ) as unknown as PublicCatalogRecord;
      const claimed = r?.row?.lookup_requested_id ?? r?.row?.offering_id;
      if (typeof claimed !== "string" || !part.includes(claimed)) {
        return fail("current_catalog_identity_conflict");
      }
      loaded.push(r);
    }
  }
  const records = Object.freeze(loaded);
  const seen = new Map<string, PublicCatalogRecord>(), returned = new Set<string>();
  for (const r of records) {
    const target = r?.row?.offering_id, g = r?.guide;
    const source = r?.row?.lookup_requested_id ??
      (typeof target === "string" && ids.includes(target) ? target : null);
    if (typeof source !== "string" || !ids.includes(source) || returned.has(source)) {
      return fail("current_catalog_identity_conflict");
    }
    returned.add(source);
    // An unqualified source relation stays pending and does not hide other rows.
    if (!g || g.recruitment_link_status !== "verified") continue;
    if (
      typeof target !== "string" || !TARGET.test(target) || r.row.academic_year !== 2027 ||
      g.offering_id !== target ||
      typeof r.row.offering_pk !== "string" || target !== "2027:" + r.row.offering_pk ||
      g.offering_pk !== r.row.offering_pk || typeof r.row.school_id !== "string" ||
      g.school_id !== r.row.school_id || g.academic_year !== 2027 ||
      r.row.active_service === false || g.active_service === false ||
      r.row.practical_required === true || g.practical_required === true
    ) return fail("current_catalog_identity_conflict");
    seen.set(source, r);
  }
  const qualified = Object.freeze([...seen.values()]);
  const suppliedDecisions = await trust.classify(request, boundary, first, qualified);
  check();
  if (!Array.isArray(suppliedDecisions) || suppliedDecisions.length !== qualified.length) {
    return fail();
  }
  const decisions: SnapshotBatchDecision[] = [];
  for (let i = 0; i < suppliedDecisions.length; i++) {
    const element = Object.getOwnPropertyDescriptor(suppliedDecisions, String(i));
    if (!element || !("value" in element)) return fail();
    decisions.push(freezeDecision(element.value));
  }
  Object.freeze(decisions);
  const bySource = new Map<string, SnapshotBatchDecision>();
  const targetDecisions = new Map<string, string>();
  const targetConditions = new Map<string, string>();
  const targetGuides = new Map<string, string>();
  const targetProofs = new Map<string, string>();
  const targetStages = new Map<string, string>();
  const targetBases = new Map<string, string>();
  const targetsWithUnresolvedRollover = new Set<string>();
  const targetsWithFinalStage = new Set<string>();
  const verifiedTarget = new Map<string, boolean>();
  const unboundEvidence = new Set<string>();
  const conflicts = new Set<string>();
  const compare = (claims: Map<string, string>, target: string, value: string) => {
    if (claims.has(target) && claims.get(target) !== value) conflicts.add(target);
    claims.set(target, value);
  };
  for (const d of decisions) {
    const r = seen.get(d?.sourceId);
    const base = d?.baseRecruitmentEvidence,
      target = d?.targetEvidence,
      stage = d?.stageEvidence,
      rollover = d?.rolloverEvidence;
    if (
      !d || !r || !r.guide || bySource.has(d.sourceId) || d.targetId !== r.row.offering_id ||
      !["ALLOW", "HOLD", "EXCLUDE"].includes(d.decision) ||
      !["ALLOW", "HOLD"].includes(d.relation) ||
      !["none", "conditional", "unknown"].includes(d.condition) ||
      (d.condition === "conditional"
        ? typeof d.conditionText !== "string" || !d.conditionText.trim() ||
          d.conditionText.length > 200 || hasAsciiControl(d.conditionText)
        : d.conditionText !== null) ||
      (base !== undefined &&
        (!exactOwnData(base, [
          "status",
          "initialValue",
          "targetId",
          "guideHead",
          "guideRecordSha256",
        ]) ||
          base.status !== "confirmed" || numberText(base.initialValue) === null ||
          typeof base.targetId !== "string" || !isHash(base.guideHead) ||
          !isHash(base.guideRecordSha256))) ||
      (rollover !== undefined &&
        (!exactOwnData(rollover, [
          "status",
          "state",
          "targetId",
          "guideHead",
          "guideRecordSha256",
        ]) ||
          rollover.status !== "verified" || rollover.state !== "unresolved" ||
          typeof rollover.targetId !== "string" || !isHash(rollover.guideHead) ||
          !isHash(rollover.guideRecordSha256))) ||
      (target !== undefined &&
        (!exactOwnData(target, [
          "status",
          "targetId",
          "guideHead",
          "guideRecordSha256",
          "quotaNativeType",
        ]) ||
          target.status !== "verified" || typeof target.guideRecordSha256 !== "string" ||
          typeof target.targetId !== "string" || !isHash(target.guideHead) ||
          !isHash(target.guideRecordSha256) ||
          !["missing", "null", "string", "number", "bigint", "other"].includes(
            target.quotaNativeType,
          ))) ||
      (stage !== undefined &&
        (!exactOwnData(stage, ["status", "stage", "targetId", "guideHead", "guideRecordSha256"]) ||
          stage.status !== "verified" || !["initial", "final"].includes(stage.stage) ||
          typeof stage.targetId !== "string" || !isHash(stage.guideHead) ||
          !isHash(stage.guideRecordSha256)))
    ) return fail();
    const guideHash = await nativeJsonSha256(r.guide), guideType = quotaNativeType(r.guide);
    check();
    const sameGuide = (e: GuideBoundEvidence | undefined) =>
      !!e && e.targetId === d.targetId &&
      e.guideHead === first.head && e.guideRecordSha256 === guideHash;
    const boundTarget = !!target && sameGuide(target) && target.quotaNativeType === guideType;
    const boundStage = boundTarget && sameGuide(stage) ? stage : undefined;
    const boundBase = boundTarget && sameGuide(base) ? base : undefined;
    const boundRollover = boundTarget && sameGuide(rollover) ? rollover : undefined;
    if ((stage && !boundStage) || (base && !boundBase) || (rollover && !boundRollover)) {
      unboundEvidence.add(d.sourceId);
    }
    verifiedTarget.set(d.sourceId, boundTarget);
    // Only independently target-bound claims can affect other source relations.
    if (boundTarget && target) {
      compare(targetDecisions, d.targetId, d.decision);
      // A verified recruitment claim contradicts exclusion for this target only.
      if (boundBase && d.decision === "EXCLUDE") conflicts.add(d.targetId);
      // Unknown on a held relation is not a claim that the target condition is unknown.
      if (d.relation === "ALLOW" || d.condition !== "unknown") {
        compare(targetConditions, d.targetId, JSON.stringify([d.condition, d.conditionText]));
      }
      const recordedStage = guideStage(r);
      if (boundStage && recordedStage && boundStage.stage !== recordedStage) {
        conflicts.add(d.targetId);
      }
      if (recordedStage === "final" || boundStage?.stage === "final") {
        targetsWithFinalStage.add(d.targetId);
      }
      if (boundRollover) targetsWithUnresolvedRollover.add(d.targetId);
      compare(targetGuides, d.targetId, JSON.stringify([guideHash, guideType]));
      compare(
        targetProofs,
        d.targetId,
        JSON.stringify([target.guideRecordSha256, target.quotaNativeType]),
      );
      if (boundStage) compare(targetStages, d.targetId, boundStage.stage);
      if (boundBase) compare(targetBases, d.targetId, nativeKey(boundBase.initialValue));
    }
    bySource.set(
      d.sourceId,
      Object.freeze({
        sourceId: d.sourceId,
        targetId: d.targetId,
        decision: d.decision,
        relation: d.relation,
        condition: d.condition,
        conditionText: d.conditionText,
        ...(target ? { targetEvidence: Object.freeze({ ...target }) } : {}),
        ...(stage ? { stageEvidence: Object.freeze({ ...stage }) } : {}),
        ...(base ? { baseRecruitmentEvidence: Object.freeze({ ...base }) } : {}),
        ...(rollover ? { rolloverEvidence: Object.freeze({ ...rollover }) } : {}),
      }),
    );
  }
  for (const target of targetsWithUnresolvedRollover) {
    if (targetsWithFinalStage.has(target)) conflicts.add(target);
  }
  const latest = await catalog.publication();
  check();
  if (
    !latest || latest.version !== pinned.version || latest.sha256 !== pinned.sha256 ||
    latest.expiresAtUtc !== pinned.expiresAtUtc || latest.expiresAtUtc <= clock.nowUtc()
  ) return fail("current_catalog_state_unapproved");
  const last = checkedBinding(
    await trust.bind(request, boundary, snapshot, partId, ids, latest),
    subject,
    snapshot,
    partId,
    latest,
  );
  check();
  if (!same(first, last)) return fail("current_catalog_state_unapproved");
  return Object.freeze(ids.map((sourceId) => {
    const record = seen.get(sourceId), decision = bySource.get(sourceId);
    if (decision && conflicts.has(decision.targetId)) {
      return Object.freeze({ sourceId, status: "pending" as const });
    }
    // A target's exclusion is not evidence that this source relation is valid.
    if (decision?.relation === "HOLD") {
      return Object.freeze({ sourceId, status: "pending" as const });
    }
    if (verifiedTarget.get(sourceId) !== true) {
      return Object.freeze({ sourceId, status: "pending" as const });
    }
    if (unboundEvidence.has(sourceId)) {
      return Object.freeze({ sourceId, status: "pending" as const });
    }
    if (decision?.decision === "EXCLUDE") {
      return Object.freeze({ sourceId, status: "excluded" as const });
    }
    if (
      !record || decision?.decision !== "ALLOW" || decision.relation !== "ALLOW"
    ) {
      return Object.freeze({ sourceId, status: "pending" as const });
    }
    if (
      targetsWithUnresolvedRollover.has(decision.targetId) && !decision.rolloverEvidence
    ) return Object.freeze({ sourceId, status: "pending" as const });
    if (
      decision.condition === "unknown" || conditionalLiteral(record) ||
      decision.baseRecruitmentEvidence || decision.rolloverEvidence
    ) {
      const proof = decision.baseRecruitmentEvidence;
      const initial = valueFor(record, !!decision.rolloverEvidence);
      if (
        !proof || !initial || initial.stage !== "initial" ||
        decision.stageEvidence?.stage !== "initial" ||
        typeof initial.value !== typeof proof.initialValue ||
        !Object.is(initial.value, proof.initialValue)
      ) return Object.freeze({ sourceId, status: "pending" as const });
      return Object.freeze({
        sourceId,
        status: "reference" as const,
        ...initial,
        conditionText: decision.conditionText,
        ...(decision.rolloverEvidence ? { carryoverStatus: "unresolved" as const } : {}),
      });
    }
    let value = valueFor(record, false);
    if (value && value.stage !== "unknown" && decision.stageEvidence?.stage !== value.stage) {
      value = decision.stageEvidence || value.displayValue === "0"
        ? null
        : { ...value, stage: "unknown" };
    }
    return value
      ? Object.freeze({
        sourceId,
        status: "reference" as const,
        ...value,
        conditionText: decision.conditionText,
      })
      : Object.freeze({ sourceId, status: "pending" as const });
  }));
}
