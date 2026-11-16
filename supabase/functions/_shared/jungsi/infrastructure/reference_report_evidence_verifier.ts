/** Private read-side verification against the server's immutable issuing revision. */
import { AccessError } from "../application/access.ts";
import type { StoredReport } from "../application/platform_repository.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import type { IssuedTailPin } from "./published_reference_tail_issuer.ts";
type RevisionReader = (
  owner: string,
  id: string,
  revision: number,
  signal?: AbortSignal,
) => Promise<StoredReport | null>;
type Issuer = {
  select(id: string, signal: AbortSignal): Promise<IssuedTailPin | null>;
  verifiedProvenance(
    pin: IssuedTailPin,
    identity: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<Readonly<NativeObject>>;
};
const HASH = /^[0-9a-f]{64}$/;
const CONTEXT = [
  "academic_year",
  "exam_id",
  "exam_type",
  "source_pack_version",
  "rule_version",
  "score_scale_id",
] as const;
function object(v: unknown): v is NativeObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function fail(): never {
  throw new AccessError("reference_evidence_unavailable", 503);
}
function live(signal: AbortSignal): void {
  if (!signal || signal.aborted) fail();
}
function same(a: unknown, b: unknown): boolean {
  try {
    return nativeJsonText(a as NativeObject, true) === nativeJsonText(b as NativeObject, true);
  } catch {
    return false;
  }
}
function revision(e: NativeObject, current: number): number | null {
  const n = e.issued_revision;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= current ? n : null;
}
function sourceProof(record: StoredReport): NativeObject | null {
  const proof = record.body._reference_evidence;
  return object(proof) && proof.format === "jungsi.reference-result-provenance/v1" &&
      proof.owner_id === record.owner_id && proof.report_id === record.report_id &&
      proof.profile_id === record.profile_id
    ? proof
    : null;
}
/** Deployment must first verify that the runtime role cannot modify old revision rows and
 * that all report writers create proof server-side. Queries must stay inside the existing
 * bounded request; no new DB/Storage reads may occur after that budget settles. */
export class ImmutableReferenceReportVerifier {
  private readonly reads = new WeakMap<AbortSignal, Map<string, Promise<StoredReport | null>>>();
  constructor(
    readonly maximumAssessments: number,
    private readonly readRevision: RevisionReader,
    issuer: Issuer | readonly Issuer[],
    private readonly assertOwnedCurrent: (
      record: StoredReport,
      signal: AbortSignal,
    ) => Promise<void>,
  ) {
    const sources = Array.isArray(issuer) ? issuer : [issuer];
    if (
      !Number.isSafeInteger(maximumAssessments) || maximumAssessments < 1 ||
      maximumAssessments > 1000 ||
      typeof readRevision !== "function" || sources.length < 1 || sources.length > 2 ||
      sources.some((source) =>
        !source || typeof source.select !== "function" ||
        typeof source.verifiedProvenance !== "function"
      ) ||
      typeof assertOwnedCurrent !== "function"
    ) fail();
    this.issuers = Object.freeze([...sources]);
  }
  private readonly issuers: readonly Issuer[];
  async assertCurrent(record: StoredReport, signal: AbortSignal): Promise<void> {
    live(signal);
    await this.assertOwnedCurrent(record, signal);
    live(signal);
  }
  private async original(
    record: StoredReport,
    n: number,
    signal: AbortSignal,
  ): Promise<StoredReport | null> {
    live(signal);
    let rows = this.reads.get(signal);
    if (!rows) {
      rows = new Map();
      this.reads.set(signal, rows);
    }
    const key = JSON.stringify([record.owner_id, record.report_id, n]);
    let task = rows.get(key);
    if (!task) {
      task = this.readRevision(record.owner_id, record.report_id, n, signal);
      rows.set(key, task);
    }
    const result = await task;
    live(signal);
    if (!result) return null;
    if (
      result.owner_id !== record.owner_id || result.report_id !== record.report_id ||
      result.profile_id !== record.profile_id || result.revision !== n
    ) fail();
    return result;
  }
  async verifyAssessment(
    record: StoredReport,
    id: string,
    evidence: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<boolean> {
    live(signal);
    if (
      typeof id !== "string" || !id || !object(evidence) ||
      typeof evidence.value_sha256 !== "string" || !HASH.test(evidence.value_sha256) ||
      !object(evidence.provenance)
    ) return false;
    const n = revision(evidence, record.revision), currentProof = sourceProof(record);
    if (
      n === null || !currentProof || !object(currentProof.assessments) ||
      !same(currentProof.assessments[id], evidence) || !object(record.body.analyses)
    ) return false;
    const current = record.body.analyses[id];
    if (!object(current) || !object(current.reference_percentile) || current.offering_id !== id) {
      return false;
    }
    const source = await this.original(record, n, signal);
    if (!source) return false;
    const originalProof = sourceProof(source), analyses = source.body.analyses;
    if (
      !originalProof || !object(originalProof.assessments) ||
      !same(originalProof.assessments[id], evidence) || !object(analyses)
    ) return false;
    const original = analyses[id];
    if (
      !object(original) || original.offering_id !== id || !object(original.reference_percentile) ||
      !same(original.reference_percentile, current.reference_percentile) ||
      await nativeJsonSha256(current.reference_percentile) !== evidence.value_sha256
    ) return false;
    for (const issuer of this.issuers) {
      const pin = await issuer.select(id, signal);
      live(signal);
      if (!pin) continue;
      const identity: NativeObject = { offering_id: id };
      for (const k of CONTEXT) identity[k] = pin.context[k];
      const provenance = await issuer.verifiedProvenance(pin, identity, signal);
      live(signal);
      if (same(provenance, evidence.provenance)) return true;
    }
    return false;
  }
  async verifyCandidates(
    record: StoredReport,
    evidence: Readonly<NativeObject>,
    signal: AbortSignal,
  ): Promise<boolean> {
    live(signal);
    if (
      !object(evidence) || !Array.isArray(evidence.offering_ids) || !object(record.body.candidates)
    ) return false;
    const ids = evidence.offering_ids;
    if (
      !ids.length || ids.length > this.maximumAssessments ||
      ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length
    ) return false;
    const n = revision(evidence, record.revision), proof = sourceProof(record);
    if (n === null || !proof || !same(proof.candidates, evidence) || !object(proof.assessments)) {
      return false;
    }
    const source = await this.original(record, n, signal);
    if (!source) return false;
    const prior = sourceProof(source),
      old = source.body.candidates,
      groups = record.body.candidates.reference_university_groups;
    if (
      !prior || !same(prior.candidates, evidence) || !object(old) || !Array.isArray(groups) ||
      !same(old.reference_university_groups, groups) ||
      typeof evidence.value_sha256 !== "string" ||
      await nativeJsonSha256(groups) !== evidence.value_sha256
    ) return false;
    if (
      !object(record.body.analyses) || typeof evidence.selection_sha256 !== "string" ||
      !HASH.test(evidence.selection_sha256)
    ) return false;
    const actual: string[] = [];
    for (const group of groups) {
      if (!object(group) || !Array.isArray(group.offerings)) return false;
      for (const item of group.offerings) {
        if (
          actual.length >= this.maximumAssessments || !object(item) || !object(item.offering) ||
          typeof item.offering.offering_id !== "string"
        ) return false;
        const id = item.offering.offering_id,
          assessment = record.body.analyses[id],
          proofRow = proof.assessments[id];
        const keys = [
          "status",
          "estimated_upper_cumulative_percent_all_examinees",
          "metric",
          "calculation_review_scope",
          "production_allowed",
          "actual_admission_full_total_approved",
        ];
        if (
          !object(assessment) || !object(proofRow) || !object(proofRow.provenance) ||
          proofRow.provenance.selection_sha256 !== evidence.selection_sha256 ||
          !object(assessment.reference_percentile) || !object(item.reference_percentile)
        ) return false;
        const candidateRef = item.reference_percentile,
          assessmentRef = assessment.reference_percentile;
        const compared =
          Object.hasOwn(candidateRef, "estimated_upper_cumulative_percent_upper_bound")
            ? [...keys, "estimated_upper_cumulative_percent_upper_bound"]
            : keys;
        if (
          Object.keys(candidateRef).sort().join(",") !== [...compared].sort().join(",") ||
          compared.some((k) => candidateRef[k] !== assessmentRef[k])
        ) return false;
        actual.push(id);
      }
    }
    if (!same(actual, ids)) return false;
    for (const value of ids) {
      const id = value as string, e = proof.assessments[id];
      if (!object(e) || !await this.verifyAssessment(record, id, e, signal)) return false;
    }
    return true;
  }
}
