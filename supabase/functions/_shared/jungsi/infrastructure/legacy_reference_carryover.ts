import {
  referenceGroupIndex,
  referenceGroupsContain,
} from "../application/reference_group_merge.ts";
/** Verify unchanged pre-evidence assessments against immutable owner-scoped revisions. */
import type { StoredReport } from "../application/platform_repository.ts";
import type { ReferenceProjectionAuthority } from "../application/public_response.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";

function object(v: unknown): v is NativeObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function same(a: unknown, b: unknown): boolean {
  try {
    return nativeJsonText(a as NativeObject, true) === nativeJsonText(b as NativeObject, true);
  } catch {
    return false;
  }
}
function proof(r: StoredReport): NativeObject | null {
  const p = r.body._reference_evidence;
  return object(p) && p.format === "jungsi.reference-result-provenance/v1" &&
      p.owner_id === r.owner_id &&
      p.report_id === r.report_id && p.profile_id === r.profile_id && object(p.assessments) &&
      object(p.legacy_assessments)
    ? p
    : null;
}
function validRecord(
  value: StoredReport | null,
  current: StoredReport,
  n: number,
): value is StoredReport {
  return !!value && value.owner_id === current.owner_id && value.report_id === current.report_id &&
    value.profile_id === current.profile_id && value.revision === n && object(value.body);
}
/** Read-only attestation. Failure or exhausted budget authorizes no legacy values. */
export async function verifiedLegacyAssessments(
  record: StoredReport,
  signal: AbortSignal,
  read: (revision: number, signal: AbortSignal) => Promise<StoredReport | null>,
): Promise<ReadonlyMap<string, string>> {
  const allowed = new Map<string, string>(), p = proof(record);
  if (!p || !object(record.body.analyses) || signal.aborted) return allowed;
  const markers = p.legacy_assessments as NativeObject, newEvidence = p.assessments as NativeObject;
  const cache = new Map<number, Promise<StoredReport | null>>();
  const load = (n: number) => {
    let value = cache.get(n);
    if (!value) {
      value = read(n, signal);
      cache.set(n, value);
    }
    return value;
  };
  for (const [id, mark] of Object.entries(markers)) {
    if (signal.aborted) throw Error("reference scope cancelled");
    if (
      !object(mark) ||
      Object.keys(mark).sort().join(",") !== "assessment_sha256,issued_revision,origin_revision" ||
      typeof mark.origin_revision !== "number" || !Number.isSafeInteger(mark.origin_revision) ||
      mark.origin_revision < 1 ||
      typeof mark.issued_revision !== "number" ||
      mark.issued_revision !== mark.origin_revision + 1 || mark.issued_revision > record.revision ||
      typeof mark.assessment_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(mark.assessment_sha256) || Object.hasOwn(newEvidence, id)
    ) continue;
    const current = record.body.analyses[id];
    if (!object(current) || current.offering_id !== id || !object(current.reference_percentile)) {
      continue;
    }
    const origin = await load(mark.origin_revision),
      introduced = await load(mark.issued_revision),
      previous = await load(record.revision - 1);
    if (signal.aborted) throw Error("reference scope cancelled");
    if (
      !validRecord(origin, record, mark.origin_revision) ||
      !validRecord(introduced, record, mark.issued_revision) ||
      !validRecord(previous, record, record.revision - 1) ||
      Object.hasOwn(origin.body, "_reference_evidence")
    ) continue;
    const originAnalyses = origin.body.analyses,
      introAnalyses = introduced.body.analyses,
      introProof = proof(introduced);
    if (
      !object(originAnalyses) || !object(introAnalyses) || !introProof ||
      !object(introProof.legacy_assessments) ||
      !same(introProof.legacy_assessments[id], mark) ||
      Object.hasOwn(introProof.assessments as NativeObject, id) ||
      !same(originAnalyses[id], current) || !same(introAnalyses[id], current) ||
      await nativeJsonSha256(current) !== mark.assessment_sha256
    ) continue;
    if (record.revision > mark.issued_revision) {
      const prevProof = proof(previous);
      if (
        !prevProof || !same((prevProof.legacy_assessments as NativeObject)[id], mark) ||
        Object.hasOwn(prevProof.assessments as NativeObject, id)
      ) continue;
    }
    allowed.set(id, nativeJsonText(current, true));
  }
  return allowed;
}

/** The candidate object is carried as one unit and still needs current legacy authority. */
export async function verifiedLegacyCandidates(
  record: StoredReport,
  signal: AbortSignal,
  read: (revision: number, signal: AbortSignal) => Promise<StoredReport | null>,
): Promise<NativeObject[] | null> {
  const p = proof(record), mark = p?.legacy_candidates, current = record.body.candidates;
  if (
    !p || !object(mark) ||
    Object.keys(mark).sort().join(",") !== "candidates_sha256,issued_revision,origin_revision" ||
    typeof mark.origin_revision !== "number" || !Number.isSafeInteger(mark.origin_revision) ||
    mark.origin_revision < 1 ||
    typeof mark.issued_revision !== "number" || mark.issued_revision !== mark.origin_revision + 1 ||
    mark.issued_revision > record.revision ||
    typeof mark.candidates_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(mark.candidates_sha256) ||
    p.candidates !== undefined ||
    !object(current) || !Array.isArray(current.reference_university_groups) ||
    !current.reference_university_groups.length || signal.aborted
  ) return null;
  const [origin, introduced, previous] = await Promise.all([
    read(mark.origin_revision, signal),
    read(mark.issued_revision, signal),
    read(record.revision - 1, signal),
  ]);
  if (signal.aborted) throw Error("reference scope cancelled");
  if (
    !validRecord(origin, record, mark.origin_revision) ||
    !validRecord(introduced, record, mark.issued_revision) ||
    !validRecord(previous, record, record.revision - 1) ||
    Object.hasOwn(origin.body, "_reference_evidence")
  ) return null;
  const introducedProof = proof(introduced);
  if (
    !introducedProof || introducedProof.candidates !== undefined ||
    !same(introducedProof.legacy_candidates, mark) ||
    !object(origin.body.candidates) || !object(introduced.body.candidates) ||
    !Array.isArray(origin.body.candidates.reference_university_groups) ||
    !referenceGroupsContain(
      origin.body.candidates.reference_university_groups,
      current.reference_university_groups,
    ) ||
    !referenceGroupsContain(
      origin.body.candidates.reference_university_groups,
      introduced.body.candidates.reference_university_groups,
    ) ||
    await nativeJsonSha256(origin.body.candidates.reference_university_groups) !==
      mark.candidates_sha256
  ) return null;
  if (record.revision > mark.issued_revision) {
    const prior = proof(previous);
    if (!prior || prior.candidates !== undefined || !same(prior.legacy_candidates, mark)) {
      return null;
    }
  }
  return origin.body.candidates.reference_university_groups as NativeObject[];
}

export function combineLegacyAndProven(
  legacy: ReferenceProjectionAuthority,
  proven: ReferenceProjectionAuthority | null,
  allowed: ReadonlyMap<string, string>,
  allowedCandidates: NativeObject[] | null,
): ReferenceProjectionAuthority {
  return Object.freeze({
    async assertCurrent(signal: AbortSignal) {
      await legacy.assertCurrent(signal);
      if (proven) await proven.assertCurrent(signal);
    },
    assertSettled(signal: AbortSignal) {
      if (!legacy.assertSettled) throw Error("legacy receipt missing");
      legacy.assertSettled(signal);
      if (proven) {
        if (!proven.assertSettled) throw Error("proven receipt missing");
        proven.assertSettled(signal);
      }
    },
    authorizes(check: Parameters<ReferenceProjectionAuthority["authorizes"]>[0]) {
      if (proven?.authorizes(check)) return true;
      if (check.kind === "candidates") {
        try {
          if (
            !allowedCandidates || !object(check.value) ||
            !referenceGroupsContain(allowedCandidates, check.value.reference_university_groups) ||
            !legacy.authorizes(check)
          ) return false;
          const originals = referenceGroupIndex(allowedCandidates),
            current = referenceGroupIndex(check.value.reference_university_groups);
          if (!originals || !current || !object(check.root)) return false;
          const visible = object(check.root.report) ? check.root.report : check.root;
          const views = [
            visible,
            ...(object(visible.read_only_snapshot) ? [visible.read_only_snapshot] : []),
          ];
          const fields = [
            "status",
            "estimated_upper_cumulative_percent_all_examinees",
            "metric",
            "calculation_review_scope",
            "production_allowed",
            "actual_admission_full_total_approved",
          ];
          for (const [id, entry] of current) {
            const old = originals.get(id);
            if (
              old && old.row === entry.row && old.group === entry.group &&
              old.metadata === entry.metadata
            ) continue;
            const groups = check.value.reference_university_groups as NativeObject[];
            const group = groups.find((g) => object(g) && g.university_id === entry.group);
            const row = object(group) && Array.isArray(group.offerings)
              ? group.offerings.find((v) =>
                object(v) && object(v.offering) && v.offering.offering_id === id
              )
              : null;
            const analysis = views.map((v) => object(v.analyses) ? v.analyses[id] : null).find(
              object,
            );
            const compared = object(row) && object(row.reference_percentile) &&
                Object.hasOwn(
                  row.reference_percentile,
                  "estimated_upper_cumulative_percent_upper_bound",
                )
              ? [...fields, "estimated_upper_cumulative_percent_upper_bound"]
              : fields;
            if (
              !object(row) || !object(row.reference_percentile) || !object(analysis) ||
              !object(analysis.reference_percentile) ||
              Object.keys(row.reference_percentile).sort().join(",") !==
                [...compared].sort().join(",") ||
              compared.some((k) =>
                (row.reference_percentile as NativeObject)[k] !==
                  (analysis.reference_percentile as NativeObject)[k]
              ) ||
              !proven?.authorizes({ ...check, kind: "assessment", value: analysis })
            ) return false;
          }
          return true;
        } catch {
          return false;
        }
      }
      if (
        check.kind !== "assessment" || !object(check.value) ||
        typeof check.value.offering_id !== "string"
      ) return false;
      const expected = allowed.get(check.value.offering_id);
      try {
        return expected !== undefined && nativeJsonText(check.value, true) === expected &&
          legacy.authorizes(check);
      } catch {
        return false;
      }
    },
  });
}
