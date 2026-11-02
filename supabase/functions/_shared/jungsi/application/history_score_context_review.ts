/** REVIEW ONLY. Internal per-observation score context candidate; no route, writer,
 * source adapter or activation. A separately authenticated authority must independently
 * verify the existing source observation, target, group, population and formula against
 * pinned evidence. Caller-provided fields, equal labels and matching PK are not approval.
 * The source observations are never modified and every result remains non-publishable.
 */
import { nativeJsonSha256 } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";

type Obj = Record<string, unknown>;
type Pins = Readonly<{
  source_head_sha256: string;
  descriptor_sha256: string;
  scope_sha256: string;
  authority_sha256: string;
}>;
export interface TrustedScoreContextAuthority {
  assertLive(pins: Pins): Promise<void>;
  /** Verify independently from the already authorized bulk source, not by echoing subjects. */
  verifyBatch(pins: Pins, subjects: readonly Readonly<Obj>[]): Promise<unknown>;
}
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OBS = /^(?:observation|admission):[a-f0-9]{64}$/;
const PIN = ["source_head_sha256", "descriptor_sha256", "scope_sha256", "authority_sha256"];
const INPUT = [
  "observation_id",
  "p1_row_academic_year",
  "original_pk",
  "source_school_id",
  "target_school_id",
  "target_admission_year",
  "formula_school_id",
  "source_result_year",
  "score_basis_academic_year",
  "department_label_reference_year",
  "source_population_note",
  "source_group",
  "display_group",
  "production_allowed",
  "value",
];
const PROOF = [
  "subject_sha256",
  "source_head_sha256",
  "descriptor_sha256",
  "scope_sha256",
  "authority_sha256",
  "disposition",
  "source_observation_verified",
  "source_observation_sha256",
  "source_original_file_sha256",
  "source_original_cell_sha256",
  "source_cell_match_status",
  "target_identity_verified",
  "target_membership_verified",
  "target_membership_sha256",
  "source_population_verified",
  "source_population_sha256",
  "formula_source_verified",
  "formula_source_sha256",
  "department_label_year_verified",
  "department_label_evidence_sha256",
  "group_compatibility_verified",
  "group_evidence_sha256",
];
class ReviewError extends Error {}
const need = (v: unknown): void => {
  if (!v) throw new ReviewError("invalid");
};
function exact(raw: unknown, fields: readonly string[]): Obj {
  need(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  const proto = Object.getPrototypeOf(raw), keys = Reflect.ownKeys(raw as object);
  need(
    (proto === Object.prototype || proto === null) && keys.length === fields.length &&
      keys.every((k) => typeof k === "string" && fields.includes(k)),
  );
  const out: Obj = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    need(d && d.enumerable && "value" in d);
    Object.defineProperty(out, key, { value: d!.value, enumerable: true });
  }
  return Object.freeze(out);
}
function dense(raw: unknown, max: number): unknown[] {
  need(Array.isArray(raw));
  const d = Object.getOwnPropertyDescriptor(raw as object, "length"),
    keys = Reflect.ownKeys(raw as object);
  need(
    d && "value" in d && Number.isSafeInteger(d.value) && d.value >= 0 &&
      d.value <= max && keys.length === d.value + 1,
  );
  const out: unknown[] = [];
  for (let i = 0; i < d!.value; i++) {
    const item = Object.getOwnPropertyDescriptor(raw as object, String(i));
    need(item && item.enumerable && "value" in item);
    out.push(item!.value);
  }
  return out;
}
const hash = (v: unknown): v is string => typeof v === "string" && HASH.test(v);
const id = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const year = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 1 && Number(v) <= 9999;
function nullableText(v: unknown): boolean {
  return v === null || typeof v === "string" && v.length > 0 && v.length <= 2048;
}
function nativeValue(v: unknown): NativeJson {
  if (v === null || typeof v === "bigint") return v;
  if (typeof v === "string" && v.length <= 1024) return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0)) return v;
  if (v instanceof JsonFloat) {
    const d = Object.getOwnPropertyDescriptor(v, "lexeme");
    need(
      d && d.enumerable && "value" in d && typeof d.value === "string" &&
        /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(d.value),
    );
    return new JsonFloat(d!.value);
  }
  throw new ReviewError("unsupported_value");
}
function observation(raw: unknown): Obj {
  const r = exact(raw, INPUT);
  need(
    typeof r.observation_id === "string" && OBS.test(r.observation_id) &&
      year(r.p1_row_academic_year) && year(r.source_result_year) &&
      year(r.score_basis_academic_year) && year(r.department_label_reference_year) &&
      year(r.target_admission_year) && id(r.original_pk) && id(r.source_school_id) &&
      id(r.target_school_id) && id(r.formula_school_id) &&
      typeof r.source_population_note === "string" && r.source_population_note.trim().length > 0 &&
      r.source_population_note.length <= 2048 && nullableText(r.source_group) &&
      nullableText(r.display_group) && typeof r.production_allowed === "boolean",
  );
  need(r.source_result_year === r.p1_row_academic_year);
  return Object.freeze({ ...r, value: nativeValue(r.value) });
}
function preservedProduction(raw: unknown): boolean | undefined {
  try {
    if (raw === null || typeof raw !== "object") return undefined;
    const d = Object.getOwnPropertyDescriptor(raw, "production_allowed");
    return d && d.enumerable && "value" in d && typeof d.value === "boolean" ? d.value : undefined;
  } catch {
    return undefined;
  }
}
function hold(index: number, reason: string, production?: boolean): Obj {
  return Object.freeze({
    index,
    action: "HOLD",
    reason_code: reason,
    ...(production === undefined ? {} : { source_production_allowed: production }),
    publication_ready: false,
  });
}

/** One request-scoped evidence batch; invalid rows HOLD individually. Infrastructure must
 * enforce real source/head stability and physical limits. No result is an approval. */
export async function reviewHistoryScoreContexts(
  rawPins: unknown,
  rawRows: unknown,
  authority: TrustedScoreContextAuthority,
): Promise<readonly Obj[]> {
  const raw = dense(rawRows, 512);
  const p = exact(rawPins, PIN);
  need(PIN.every((key) => hash(p[key])));
  const pins = Object.freeze({ ...p }) as unknown as Pins;
  need(
    authority && typeof authority.assertLive === "function" &&
      typeof authority.verifyBatch === "function",
  );
  const live = authority.assertLive.bind(authority), verify = authority.verifyBatch.bind(authority);
  const rows: (Obj | null)[] = [], counts = new Map<string, number>();
  for (const item of raw) {
    try {
      const row = observation(item);
      rows.push(row);
      const key = JSON.stringify([row.observation_id, row.p1_row_academic_year, row.original_pk]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    } catch {
      rows.push(null);
    }
  }
  const subjects: Readonly<Obj>[] = [], indices: number[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (
      !row ||
      counts.get(
          JSON.stringify([row.observation_id, row.p1_row_academic_year, row.original_pk]),
        ) !== 1
    ) continue;
    const value = row.value;
    const subject = Object.freeze({
      codec: "jungsi.history-score-context-review/v1",
      ...pins,
      ...row,
      value_runtime_type: value === null
        ? "null"
        : value instanceof JsonFloat
        ? "json_float"
        : typeof value,
    });
    const subject_sha256 = await nativeJsonSha256(subject);
    subjects.push(Object.freeze({ ...subject, subject_sha256 }));
    indices.push(index);
  }
  need(await live(pins) === undefined);
  const proofs = subjects.length
    ? dense(await verify(pins, Object.freeze(subjects)), subjects.length)
    : [];
  need(proofs.length === subjects.length);
  const result: Obj[] = rows.map((row, index) =>
    hold(
      index,
      row ? "DUPLICATE_OBSERVATION_TARGET" : "SOURCE_CONTEXT_MISSING_OR_INVALID",
      row ? row.production_allowed as boolean : preservedProduction(raw[index]),
    )
  );
  for (let n = 0; n < indices.length; n++) {
    const index = indices[n], row = rows[index]!, subject = subjects[n];
    let proof: Obj;
    try {
      proof = exact(proofs[n], PROOF);
    } catch {
      result[index] = hold(index, "SOURCE_EVIDENCE_UNAVAILABLE", row.production_allowed as boolean);
      continue;
    }
    if (
      proof.disposition !== "approved" || proof.subject_sha256 !== subject.subject_sha256 ||
      proof.source_head_sha256 !== pins.source_head_sha256 ||
      proof.descriptor_sha256 !== pins.descriptor_sha256 ||
      proof.scope_sha256 !== pins.scope_sha256 ||
      proof.authority_sha256 !== pins.authority_sha256 ||
      proof.source_observation_verified !== true || !hash(proof.source_observation_sha256) ||
      !hash(proof.source_original_file_sha256) || !hash(proof.source_original_cell_sha256) ||
      proof.source_cell_match_status !== "matched_original_cell" ||
      proof.target_identity_verified !== true || proof.target_membership_verified !== true ||
      !hash(proof.target_membership_sha256) || proof.source_population_verified !== true ||
      !hash(proof.source_population_sha256) || proof.formula_source_verified !== true ||
      !hash(proof.formula_source_sha256) || proof.department_label_year_verified !== true ||
      !hash(proof.department_label_evidence_sha256) ||
      proof.group_compatibility_verified !== true || !hash(proof.group_evidence_sha256)
    ) {
      result[index] = hold(index, "SOURCE_OR_SCOPE_UNVERIFIED", row.production_allowed as boolean);
      continue;
    }
    if (row.value === null) {
      result[index] = hold(index, "SOURCE_VALUE_MISSING", row.production_allowed as boolean);
      continue;
    }
    const isReference = row.score_basis_academic_year !== row.source_result_year ||
      row.target_admission_year !== row.source_result_year ||
      row.formula_school_id !== row.source_school_id ||
      row.target_school_id !== row.source_school_id;
    if (!isReference) {
      result[index] = hold(
        index,
        row.production_allowed === false
          ? "SOURCE_PRODUCTION_NOT_ALLOWED"
          : "PUBLICATION_PURPOSE_OR_TARGET_SLOT_UNPROVEN",
        row.production_allowed as boolean,
      );
      continue;
    }
    const scoreRole = Number(row.score_basis_academic_year) > Number(row.source_result_year)
      ? "prior_year_recalculated_reference"
      : "unresolved";
    result[index] = Object.freeze({
      index,
      observation_id: row.observation_id,
      original_pk: row.original_pk,
      source_school_id: row.source_school_id,
      target_school_id: row.target_school_id,
      formula_school_id: row.formula_school_id,
      action: "REFERENCE_CANDIDATE",
      target_slot: "alternate",
      value: row.value,
      source_result_year: row.source_result_year,
      target_admission_year: row.target_admission_year,
      score_basis_academic_year: row.score_basis_academic_year,
      department_label_reference_year: row.department_label_reference_year,
      source_population_note: row.source_population_note,
      source_group: row.source_group,
      display_group: row.display_group,
      source_production_allowed: row.production_allowed,
      evidence: Object.freeze({
        source_observation_sha256: proof.source_observation_sha256,
        source_original_file_sha256: proof.source_original_file_sha256,
        source_original_cell_sha256: proof.source_original_cell_sha256,
        source_cell_match_status: proof.source_cell_match_status,
        target_membership_sha256: proof.target_membership_sha256,
        source_population_sha256: proof.source_population_sha256,
        formula_source_sha256: proof.formula_source_sha256,
        department_label_evidence_sha256: proof.department_label_evidence_sha256,
        group_evidence_sha256: proof.group_evidence_sha256,
      }),
      score_calculation_context: Object.freeze({
        source_result_year: row.source_result_year,
        score_calculation_year: row.score_basis_academic_year,
        observation_role: scoreRole,
      }),
      publication_context: Object.freeze({
        publication_role: "unresolved",
        simulation_target_academic_year: null,
      }),
      subject_sha256: subject.subject_sha256,
      publication_ready: false,
    });
  }
  // Only independently approved members contribute to same-observation consistency.
  const signatures = new Map<string, Set<string>>();
  const members = new Map<string, number[]>();
  for (let i = 0; i < result.length; i++) {
    if (result[i].action !== "REFERENCE_CANDIDATE") continue;
    const row = rows[i]!, evidence = result[i].evidence as Obj, obs = row.observation_id as string;
    const value = row.value;
    const fingerprint = await nativeJsonSha256({
      codec: "jungsi.history-score-source-facts/v1",
      observation_id: obs,
      source_school_id: row.source_school_id,
      source_result_year: row.source_result_year,
      formula_school_id: row.formula_school_id,
      score_basis_academic_year: row.score_basis_academic_year,
      department_label_reference_year: row.department_label_reference_year,
      source_population_note: row.source_population_note,
      source_group: row.source_group,
      production_allowed: row.production_allowed,
      value,
      value_runtime_type: value === null
        ? "null"
        : value instanceof JsonFloat
        ? "json_float"
        : typeof value,
      source_observation_sha256: evidence.source_observation_sha256,
      source_original_file_sha256: evidence.source_original_file_sha256,
      source_original_cell_sha256: evidence.source_original_cell_sha256,
      source_population_sha256: evidence.source_population_sha256,
      formula_source_sha256: evidence.formula_source_sha256,
      department_label_evidence_sha256: evidence.department_label_evidence_sha256,
    });
    const known = signatures.get(obs) ?? new Set<string>();
    known.add(fingerprint);
    signatures.set(obs, known);
    const targets = members.get(obs) ?? [];
    targets.push(i);
    members.set(obs, targets);
  }
  for (const [obs, known] of signatures) {
    if (known.size <= 1) continue;
    for (const i of members.get(obs)!) {
      result[i] = hold(
        i,
        "SOURCE_OBSERVATION_EVIDENCE_CONFLICT",
        rows[i]!.production_allowed as boolean,
      );
    }
  }
  need(await live(pins) === undefined);
  return Object.freeze(result);
}
