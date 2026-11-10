import { referenceGroupsContain } from "./reference_group_merge.ts";
/** Server-only provenance transition for unchanged pre-evidence reference values. */
import { AccessError } from "./access.ts";
import type { StoredReport } from "./platform_repository.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";

function object(v: unknown): v is NativeObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function fail(): never {
  throw new AccessError("reference_evidence_unavailable", 503);
}
function same(a: unknown, b: unknown): boolean {
  try {
    return nativeJsonText(a as NativeObject, true) === nativeJsonText(b as NativeObject, true);
  } catch {
    return false;
  }
}
function analysis(body: Readonly<NativeObject>, id: string): NativeObject | null {
  return object(body.analyses) && object(body.analyses[id])
    ? body.analyses[id] as NativeObject
    : null;
}
function proof(
  body: Readonly<NativeObject>,
  owner: string,
  rid: string,
  pid: string,
): NativeObject | null {
  if (!Object.hasOwn(body, "_reference_evidence")) return null;
  const p = body._reference_evidence;
  if (
    !object(p) || p.format !== "jungsi.reference-result-provenance/v1" || p.owner_id !== owner ||
    p.report_id !== rid ||
    p.profile_id !== pid || !object(p.assessments) ||
    p.legacy_assessments !== undefined && !object(p.legacy_assessments) ||
    p.legacy_candidates !== undefined && !object(p.legacy_candidates)
  ) fail();
  return p;
}

/** Called only when a legacy report first receives newly issued server evidence. */
export async function captureUnchangedLegacyAssessments(
  previous: StoredReport,
  nextBody: Readonly<NativeObject>,
): Promise<NativeObject> {
  if (Object.hasOwn(previous.body, "_reference_evidence")) return {};
  const result: NativeObject = {};
  if (!object(previous.body.analyses)) return result;
  for (const [id, oldValue] of Object.entries(previous.body.analyses)) {
    const current = analysis(nextBody, id);
    if (
      !object(oldValue) || oldValue.offering_id !== id || !object(oldValue.reference_percentile) ||
      !current || !same(oldValue, current)
    ) continue;
    result[id] = {
      origin_revision: previous.revision,
      issued_revision: previous.revision + 1,
      assessment_sha256: await nativeJsonSha256(oldValue),
    };
  }
  return result;
}

/** Preserve only the unchanged pre-evidence reference groups; ordinary groups may change. */
export async function captureUnchangedLegacyCandidates(
  previous: StoredReport,
  nextBody: Readonly<NativeObject>,
): Promise<NativeObject | null> {
  const value = previous.body.candidates;
  if (
    Object.hasOwn(previous.body, "_reference_evidence") || !object(value) ||
    !Array.isArray(value.reference_university_groups) ||
    !value.reference_university_groups.length || !object(nextBody.candidates) ||
    !referenceGroupsContain(
      value.reference_university_groups,
      nextBody.candidates.reference_university_groups,
    )
  ) return null;
  return {
    origin_revision: previous.revision,
    issued_revision: previous.revision + 1,
    candidates_sha256: await nativeJsonSha256(value.reference_university_groups),
  };
}

/** Run under the existing owner-scoped report row lock, before inserting a new revision. */
export async function assertReferenceEvidenceTransition(
  previous: StoredReport | null,
  nextBody: Readonly<NativeObject>,
  owner: string,
  rid: string,
  pid: string,
  nextRevision: number,
): Promise<void> {
  const next = proof(nextBody, owner, rid, pid),
    old = previous ? proof(previous.body, owner, rid, previous.profile_id) : null;
  if (!previous) {
    if (
      next &&
      (object(next.legacy_assessments) && Object.keys(next.legacy_assessments).length ||
        next.legacy_candidates !== undefined)
    ) fail();
    return;
  }
  if (
    previous.owner_id !== owner || previous.report_id !== rid ||
    nextRevision !== previous.revision + 1 ||
    (old !== null || next !== null) && previous.profile_id !== pid
  ) fail();
  if (old && !next) fail();
  if (!next) return;
  const oldEvidence = old?.assessments as NativeObject | undefined,
    newEvidence = next.assessments as NativeObject;
  const oldLegacy = object(old?.legacy_assessments) ? old.legacy_assessments : {},
    newLegacy = object(next.legacy_assessments) ? next.legacy_assessments : {};
  for (const [id, mark] of Object.entries(newLegacy)) {
    if (
      !object(mark) ||
      Object.keys(mark).sort().join(",") !== "assessment_sha256,issued_revision,origin_revision" ||
      typeof mark.assessment_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(mark.assessment_sha256) ||
      Object.hasOwn(newEvidence, id)
    ) fail();
    if (old) {
      if (
        !Object.hasOwn(oldLegacy, id) || !same(oldLegacy[id], mark) ||
        Object.hasOwn(oldEvidence!, id)
      ) fail();
    } else {
      const before = analysis(previous.body, id), after = analysis(nextBody, id);
      if (
        mark.origin_revision !== previous.revision || mark.issued_revision !== nextRevision ||
        !before || !after ||
        !object(before.reference_percentile) || !same(before, after) ||
        await nativeJsonSha256(before) !== mark.assessment_sha256
      ) fail();
    }
  }
  if (next.legacy_candidates !== undefined) {
    const mark = next.legacy_candidates;
    if (
      !object(mark) ||
      Object.keys(mark).sort().join(",") !== "candidates_sha256,issued_revision,origin_revision" ||
      typeof mark.candidates_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(mark.candidates_sha256) || next.candidates !== undefined
    ) fail();
    if (old) { if (!same(old.legacy_candidates, mark) || old.candidates !== undefined) fail(); }
    else if (
      mark.origin_revision !== previous.revision || mark.issued_revision !== nextRevision ||
      !object(previous.body.candidates) ||
      !Array.isArray(previous.body.candidates.reference_university_groups) ||
      !previous.body.candidates.reference_university_groups.length ||
      !object(nextBody.candidates) ||
      !referenceGroupsContain(
        previous.body.candidates.reference_university_groups,
        nextBody.candidates.reference_university_groups,
      ) ||
      await nativeJsonSha256(previous.body.candidates.reference_university_groups) !==
        mark.candidates_sha256
    ) fail();
  }
  if (
    old?.candidates !== undefined && old.candidates !== null && object(previous.body.candidates) &&
    object(nextBody.candidates) &&
    same(
      previous.body.candidates.reference_university_groups,
      nextBody.candidates.reference_university_groups,
    ) && next.candidates === undefined
  ) fail();
  if (oldEvidence) {
    for (const id of Object.keys(oldEvidence)) {
      const before = analysis(previous.body, id), after = analysis(nextBody, id);
      if (
        before && after && object(before.reference_percentile) &&
        same(before.reference_percentile, after.reference_percentile) &&
        !Object.hasOwn(newEvidence, id)
      ) fail();
    }
  }
}
