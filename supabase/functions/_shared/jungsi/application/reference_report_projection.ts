/** Saved reference fields are released only after independent server provenance verification. */
import { AccessError, authorizeReport } from "./access.ts";
import { ReferenceReceiptExpired } from "./access.ts";
import type { ApiExecution } from "./api_dispatch.ts";
import type { PlatformRepositoryPort, StoredReport } from "./platform_repository.ts";
import type { RequestClockPort } from "./ports.ts";
import type { ReferenceProjectionAuthority } from "./public_response.ts";
import type { ScoreInputWorkflowPort } from "./score_input_ports.ts";
import { sessionDto } from "./session_service.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";

/** Independent issuer must verify the immutable writer, source release, selected tail,
 * input/model/score axis and compatibility evidence, not merely match a stored hash.
 * verifyCandidates must also revalidate every group member against the current stored
 * assessment evidence and approved selection; a matching group hash alone is insufficient.
 * assertCurrent must check current owner/report revision and release/receipt revocation under
 * the existing request/read budget. No implementation or operating approval is supplied here. */
export interface ReferenceReportEvidenceVerifier {
  /** Independently approved bound, not a client-provided limit. */
  readonly maximumAssessments: number;
  verifyAssessment(
    record: StoredReport,
    offeringId: string,
    evidence: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<boolean>;
  verifyCandidates(
    record: StoredReport,
    evidence: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<boolean>;
  assertCurrent(record: StoredReport, signal: AbortSignal): Promise<void>;
}
function object(value: unknown): value is NativeObject {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    !(value instanceof JsonFloat);
}
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
const HASH = /^[a-f0-9]{64}$/;
function validEvidence(value: unknown, revision: number): value is NativeObject {
  return object(value) && typeof value.value_sha256 === "string" && HASH.test(value.value_sha256) &&
    typeof value.issued_revision === "number" && Number.isSafeInteger(value.issued_revision) &&
    value.issued_revision >= 1 && value.issued_revision <= revision;
}
function canonical(value: NativeObject): string {
  return nativeJsonText(value, true);
}

/** Accepts only server-owned report state and an independent verifier. It never fabricates a
 * receipt for old reports. A null result suppresses only the new reference fields. */
export async function resolveReferenceReportProjection(input: {
  readonly request: ApiExecution;
  readonly result: unknown;
  readonly signal: AbortSignal;
  readonly repository: Pick<PlatformRepositoryPort, "getReport" | "lookupAccess">;
  readonly workflow: Pick<ScoreInputWorkflowPort, "snapshotScope">;
  readonly clock: RequestClockPort;
  readonly verifier: ReferenceReportEvidenceVerifier;
  readonly assertActive: () => Promise<void>;
  readonly assertReceipt: () => void;
}): Promise<ReferenceProjectionAuthority | null> {
  const {
    request,
    result,
    signal,
    repository,
    workflow,
    clock,
    verifier,
    assertActive,
    assertReceipt,
  } = input;
  if (
    signal.aborted || !object(result) || typeof verifier?.assertCurrent !== "function" ||
    typeof verifier.verifyAssessment !== "function" ||
    typeof verifier.verifyCandidates !== "function" ||
    !Number.isSafeInteger(verifier.maximumAssessments) || verifier.maximumAssessments < 1
  ) fail();
  const root = result, visible = request.operation === "report.export" ? root.report : root;
  if (
    !object(visible) || visible.format !== "jungsi.persisted-report/v1" ||
    typeof visible.report_id !== "string" || typeof visible.profile_id !== "string" ||
    typeof visible.report_version !== "number" || !Number.isSafeInteger(visible.report_version) ||
    visible.report_version < 1 ||
    request.params.report_id !== undefined && request.params.report_id !== visible.report_id
  ) return null;
  const owner = request.session.user.subjectId, rid = visible.report_id;
  await assertActive();
  sessionDto(request.session, clock.nowUtc());
  await authorizeReport(request.session.user, rid, {
    find: (id) => repository.lookupAccess(owner, id),
  }, false);
  const record = await repository.getReport(owner, rid);
  if (
    !record || record.owner_id !== owner || record.report_id !== rid ||
    record.profile_id !== visible.profile_id ||
    record.revision !== visible.report_version || signal.aborted
  ) return null;
  const proof = record.body._reference_evidence;
  if (
    !object(proof) || proof.format !== "jungsi.reference-result-provenance/v1" ||
    proof.owner_id !== owner || proof.report_id !== rid || proof.profile_id !== record.profile_id ||
    !object(proof.assessments) || !object(record.body.analyses)
  ) return null;
  const saved = request.session.tier === "paid"
    ? null
    : await workflow.snapshotScope(owner, rid, record.revision);
  const allowed = new Map<string, { reference: string; assessment: string; visible: boolean }>();
  const ids = Object.keys(proof.assessments);
  if (ids.length > verifier.maximumAssessments) fail();
  for (const id of ids) {
    const evidence = proof.assessments[id], assessment = record.body.analyses[id];
    if (
      !validEvidence(evidence, record.revision) || !object(assessment) ||
      assessment.offering_id !== id || !object(assessment.reference_percentile)
    ) continue;
    const expectedReference = canonical(assessment.reference_percentile),
      expectedAssessment = canonical(assessment),
      expectedEvidence = canonical(evidence);
    if (await nativeJsonSha256(assessment.reference_percentile) !== evidence.value_sha256) continue;
    if (await verifier.verifyAssessment(record, id, evidence, signal) !== true) continue;
    if (signal.aborted) fail();
    if (
      canonical(assessment) !== expectedAssessment ||
      canonical(assessment.reference_percentile) !== expectedReference ||
      canonical(evidence) !== expectedEvidence
    ) fail();
    allowed.set(id, {
      reference: expectedReference,
      assessment: expectedAssessment,
      visible: !saved || saved.analysisIds.includes(id),
    });
  }
  let candidates: string | null = null, candidateRecord: string | null = null;
  if (
    validEvidence(proof.candidates, record.revision) && object(record.body.candidates) &&
    Array.isArray(record.body.candidates.reference_university_groups) &&
    (!saved || saved.candidates)
  ) {
    const groups = record.body.candidates.reference_university_groups;
    const declared = proof.candidates.offering_ids, selected = proof.candidates.selection_sha256;
    const fields = [
      "status",
      "estimated_upper_cumulative_percent_all_examinees",
      "metric",
      "calculation_review_scope",
      "production_allowed",
      "actual_admission_full_total_approved",
    ];
    const groupIds: string[] = [];
    let consistent = Array.isArray(declared) && typeof selected === "string" && HASH.test(selected);
    for (const group of groups) {
      if (!object(group) || !Array.isArray(group.offerings)) {
        consistent = false;
        break;
      }
      for (const entry of group.offerings) {
        if (
          !object(entry) || !object(entry.offering) ||
          typeof entry.offering.offering_id !== "string" ||
          !object(entry.reference_percentile)
        ) {
          consistent = false;
          break;
        }
        const id = entry.offering.offering_id,
          assessment = record.body.analyses[id],
          evidence = proof.assessments[id];
        if (
          !allowed.has(id) || !object(assessment) || !object(assessment.reference_percentile) ||
          !object(evidence) || !object(evidence.provenance) ||
          evidence.provenance.selection_sha256 !== selected
        ) {
          consistent = false;
          break;
        }
        const groupReference = entry.reference_percentile,
          savedReference = assessment.reference_percentile;
        if (
          Object.keys(groupReference).sort().join(",") !== [...fields].sort().join(",") ||
          fields.some((k) => groupReference[k] !== savedReference[k])
        ) {
          consistent = false;
          break;
        }
        groupIds.push(id);
      }
    }
    if (
      !groupIds.length || new Set(groupIds).size !== groupIds.length ||
      !Array.isArray(declared) || nativeJsonText(declared, true) !== nativeJsonText(groupIds, true)
    ) consistent = false;
    const expectedGroups = nativeJsonText(groups, true),
      expectedCandidates = canonical(record.body.candidates),
      expectedEvidence = canonical(proof.candidates);
    if (
      consistent && await nativeJsonSha256(groups) === proof.candidates.value_sha256 &&
      await verifier.verifyCandidates(record, proof.candidates, signal) === true
    ) {
      if (
        nativeJsonText(groups, true) !== expectedGroups ||
        canonical(record.body.candidates) !== expectedCandidates ||
        canonical(proof.candidates) !== expectedEvidence
      ) fail();
      candidates = expectedGroups;
      candidateRecord = expectedCandidates;
    }
  }
  if (signal.aborted) fail();
  await verifier.assertCurrent(record, signal);
  await assertActive();
  sessionDto(request.session, clock.nowUtc());
  if (signal.aborted) fail();
  if (![...allowed.values()].some((item) => item.visible) && candidates === null) return null;
  let verifiedAt = performance.now();
  return Object.freeze({
    async assertCurrent(currentSignal: AbortSignal) {
      if (currentSignal !== signal || signal.aborted) fail();
      await assertActive();
      await verifier.assertCurrent(record, signal);
      await assertActive();
      sessionDto(request.session, clock.nowUtc());
      if (signal.aborted) fail();
      verifiedAt = performance.now();
    },
    assertSettled(currentSignal: AbortSignal) {
      // Last external proof was taken inside the active reservation. After settlement
      // only local state may be checked, within the existing 1.5 s request reuse window.
      const now = performance.now();
      if (
        currentSignal !== signal || signal.aborted || !Number.isFinite(now) ||
        !Number.isFinite(verifiedAt) ||
        now < verifiedAt
      ) fail();
      if (now - verifiedAt >= 1500) throw new ReferenceReceiptExpired();
      assertReceipt();
      sessionDto(request.session, clock.nowUtc());
    },
    authorizes(check: Parameters<ReferenceProjectionAuthority["authorizes"]>[0]) {
      if (
        check.root !== root || check.operation !== request.operation ||
        check.tier !== request.session.tier || !object(check.value)
      ) return false;
      if (check.kind === "assessment") {
        const id = check.value.offering_id, item = check.value.reference_percentile;
        const match = typeof id === "string" ? allowed.get(id) : undefined;
        return !!match && match.visible && object(item) && match.reference === canonical(item) &&
          match.assessment === canonical(check.value);
      }
      return check.kind === "candidates" && candidates !== null &&
        Array.isArray(check.value.reference_university_groups) &&
        nativeJsonText(check.value.reference_university_groups, true) === candidates &&
        canonical(check.value) === candidateRecord;
    },
  });
}
