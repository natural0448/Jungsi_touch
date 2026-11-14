/** Internal P1 recruitment final-stage qualification/publisher candidate.
 * No DB, SQL, route, Guide write, observation creation or actual publication.
 * TrustedQualificationAuthority is an injected independent server boundary, not
 * a caller assertion; the synthetic stub proves neither issuer nor production.
 * Uses the project native JSON hash; this envelope is an unapproved review contract.
 * The data team's original row SHA is separately bound, never recomputed.
 */
import { nativeJsonSha256 } from "../domain/json_value.ts";
type Obj = Record<string, unknown>;
type NativeValue = string | number | bigint | null;
const HASH = /^[a-f0-9]{64}$/,
  CID = /^(?:observation|admission):[a-f0-9]{64}$/,
  ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX = 2048;
export class RecruitmentQualificationError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "RecruitmentQualificationError";
  }
}
function need(x: unknown, code: string): asserts x {
  if (!x) throw new RecruitmentQualificationError(code);
}
function record(x: unknown, fields: readonly string[]): Obj {
  need(x !== null && typeof x === "object" && !Array.isArray(x), "shape");
  const proto = Object.getPrototypeOf(x);
  need(proto === Object.prototype || proto === null, "shape");
  const keys = Reflect.ownKeys(x), out: Obj = {};
  need(
    keys.length === fields.length && keys.every((k) => typeof k === "string" && fields.includes(k)),
    "keys",
  );
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(x, k);
    need(d && d.enumerable && "value" in d, "property");
    Object.defineProperty(out, k, {
      value: d.value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(out);
}
function proofRecord(x: unknown, fields: readonly string[]): Obj {
  need(x !== null && typeof x === "object" && !Array.isArray(x), "shape");
  const proto = Object.getPrototypeOf(x);
  need(proto === Object.prototype || proto === null, "shape");
  const keys = Reflect.ownKeys(x), out: Obj = {};
  need(keys.every((k) => typeof k === "string" && fields.includes(k)), "keys");
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(x, k);
    need(d && d.enumerable && "value" in d, "property");
    Object.defineProperty(out, k, {
      value: d.value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(out);
}
function dense(x: unknown, max: number): unknown[] {
  need(Array.isArray(x), "array_shape");
  const n = Object.getOwnPropertyDescriptor(x, "length"), keys = Reflect.ownKeys(x);
  need(
    n && "value" in n && Number.isSafeInteger(n.value) && n.value >= 0 && n.value <= max &&
      keys.length === n.value + 1,
    "array_shape",
  );
  const out: unknown[] = [];
  for (let i = 0; i < n.value; i++) {
    const d = Object.getOwnPropertyDescriptor(x, String(i));
    need(d && d.enumerable && "value" in d, "array_property");
    out.push(d.value);
  }
  return out;
}
/** Freeze the issuer's complete group set; malformed evidence holds only that row. */
function sourceGroups(x: unknown): readonly string[] | null {
  try {
    const a = dense(x, 16);
    if (
      a.length === 0 || a.some((v) => typeof v !== "string" || !nullableText(v)) ||
      new Set(a).size !== a.length
    ) return null;
    return Object.freeze(a as string[]);
  } catch {
    return null;
  }
}
function hash(x: unknown): x is string {
  return typeof x === "string" && HASH.test(x);
}
function id(x: unknown): x is string {
  return typeof x === "string" && ID.test(x);
}
function nullableText(x: unknown): x is string | null {
  return x === null ||
    typeof x === "string" && x.length > 0 && x.length <= 1024 &&
      ![...x].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
}
function count(x: unknown): x is string | number | bigint {
  return typeof x === "string" && /^\d{1,1024}$/.test(x) ||
    typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0) ||
    typeof x === "bigint" && x >= 0n;
}
const VALUE_CODEC = "jungsi.p1-recruitment-native-json-envelope/v1",
  SUBJECT_CODEC = "jungsi.p1-recruitment-subject-native-json/v1",
  PRIOR_CODEC = "jungsi.p1-recruitment-prior-cell-native-json/v1";
function jsonType(v: NativeValue): "null" | "string" | "number" {
  return v === null ? "null" : typeof v === "string" ? "string" : "number";
}
export async function nativeValueSha256(v: NativeValue): Promise<string> {
  return await nativeJsonSha256({
    codec: VALUE_CODEC,
    json_type: jsonType(v),
    runtime_type: v === null ? "null" : typeof v,
    value: v,
  });
}
/** Syntax only: independent issuer must prove the URL is official. */
function publicUrl(x: unknown): x is string {
  if (typeof x !== "string" || !nullableText(x)) return false;
  try {
    const u = new URL(x),
      path = decodeURIComponent(u.pathname).toLowerCase(),
      h = u.hostname.toLowerCase();
    return ["http:", "https:"].includes(u.protocol) && !!h && !u.username && !u.password &&
      !h.endsWith(".supabase.co") && !/\/storage\/v1\//.test(path) && h !== "localhost" &&
      !/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(h) &&
      !h.includes(":") &&
      ![...u.searchParams.keys()].some((k) =>
        /token|authorization|api[_-]?key|signature|credential|secret|password|cookie|^x-amz-|^x-goog-/i
          .test(k)
      ) && !/token|api[_-]?key|signature|secret/i.test(u.hash);
  } catch {
    return false;
  }
}
/** Contract accepts a valid calendar date only: never use observation date instead. */
function calendarDate(x: unknown): x is string {
  if (typeof x !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1 || y > 9999 || mo < 1 || mo > 12) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0),
    days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d >= 1 && d <= days[mo - 1];
}
const PIN_FIELDS = [
  "source_head_sha256",
  "approved_scope_sha256",
  "authority_sha256",
  "previous_manifest_sha256",
] as const;
const INPUT_FIELDS = [
  "observation_id",
  "academic_year",
  "school_id",
  "offering_pk",
  "admission_track",
  "recruit_group",
  "identity_variant_index",
  "metric_kind",
  "active_service",
  "value",
  "expected_native_value_sha256",
  "raw_source_row_sha256",
  "previous_cell",
] as const;
const CELL_FIELDS = [
  "value",
  "unit",
  "status",
  "reason_code",
  "source_url",
  "source_as_of",
  "statistic_label",
  "cohort",
  "source_context",
  "stage",
] as const;
const PROOF_FIELDS = [
  "subject_sha256",
  "source_head_sha256",
  "approved_scope_sha256",
  "authority_sha256",
  "previous_manifest_sha256",
  "previous_cell_sha256",
  "previous_cell_binding",
  "identity_variant_index",
  "target_cell_group_sha256",
  "target_cell_selection",
  "target_cell_selected_observation_id",
  "native_value_sha256",
  "native_value_type",
  "native_value_json_type",
  "native_value_codec",
  "raw_source_row_sha256",
  "source_snapshot_confirmed",
  "stage",
  "unit",
  "source_sha256",
  "source_ref",
  "source_url",
  "source_as_of",
  "source_as_of_kind",
  "source_metric_binding",
  "source_production_allowed",
  "source_cohort_sha256",
  "source_cohort_binding",
  "source_announced_groups",
  "source_announced_groups_binding",
  "target_membership_sha256",
  "target_membership_binding",
  "disposition",
] as const;
type Pins = Readonly<
  {
    source_head_sha256: string;
    approved_scope_sha256: string;
    authority_sha256: string;
    previous_manifest_sha256: string;
  }
>;
export interface TrustedQualificationAuthority {
  /** An independent issuer must verify each subject at the same pinned source/head:
   * raw row and native value/codec as the final recruitment count (never a score);
   * unchanged source production permission; prior cell or its explicit absence in the pinned
   * manifest; complete target-cell group and its one selected observation even for
   * a singleton; published source cohort and its complete announced group set; and
   * this exact subject's membership (year, school, original PK, track, group and
   * variant). Cohort evidence is independent of target year and any score formula
   * year. Caller echoes and synthetic stubs are never independent issuer evidence.
   */
  verifyBatch(pins: Pins, subjects: readonly Obj[]): Promise<unknown>;
  assertLive(pins: Pins): Promise<void>;
}
function previous(raw: unknown): Obj | null {
  if (raw === null) return null;
  const r = record(raw, CELL_FIELDS);
  need(
    r.value === null || typeof r.value === "string" || typeof r.value === "number" ||
      typeof r.value === "bigint",
    "prior_value",
  );
  for (
    const k of ["unit", "reason_code", "source_url", "source_as_of", "statistic_label", "cohort"]
  ) need(nullableText(r[k]), "prior_metadata");
  need(
    [
      "verified_official",
      "pending_metadata",
      "pending_value_type",
      "pending_value_missing",
      "not_published",
    ].includes(r.status as string) &&
      ["initial", "carryover", "final", "unspecified"].includes(r.stage as string),
    "prior_state",
  );
  let context: null | Obj = null;
  if (r.source_context !== null) {
    const c = record(r.source_context, [
      "observation_id",
      "identity_variant_index",
      "scope_status",
    ]);
    need(
      typeof c.observation_id === "string" && CID.test(c.observation_id) &&
        Number.isSafeInteger(c.identity_variant_index) && Number(c.identity_variant_index) >= 0 &&
        Number(c.identity_variant_index) <= 15 &&
        ["source_consistent", "review_pending"].includes(c.scope_status as string),
      "prior_context",
    );
    context = Object.freeze({ ...c });
  }
  return Object.freeze({ ...r, source_context: context });
}
async function previousCellSha256(p: Obj | null): Promise<string | null> {
  if (p === null) return null;
  const value = p.value as NativeValue;
  return await nativeJsonSha256({
    codec: PRIOR_CODEC,
    value_json_type: jsonType(value),
    value_runtime_type: value === null ? "null" : typeof value,
    cell: p,
  });
}
function emptyPrevious(p: Obj | null): boolean {
  return p === null ||
    p.value === null && p.unit === null && p.status === "pending_metadata" &&
      p.reason_code === "SOURCE_SELECTION_PENDING" && p.source_url === null &&
      p.source_as_of === null && p.statistic_label === null && p.cohort === null &&
      p.source_context === null && p.stage === "unspecified";
}
/** Synthetic shape, constrained to the existing numeric-year P1 boundary. */
function input(raw: unknown): Obj {
  const x = record(raw, INPUT_FIELDS);
  need(
    typeof x.observation_id === "string" && CID.test(x.observation_id) &&
      Number.isSafeInteger(x.academic_year) &&
      [2024, 2025, 2026, 2027].includes(Number(x.academic_year)),
    "identity",
  );
  need(
    id(x.school_id) && id(x.offering_pk) && nullableText(x.admission_track) &&
      nullableText(x.recruit_group),
    "identity",
  );
  need(
    Number.isSafeInteger(x.identity_variant_index) && Number(x.identity_variant_index) >= 0 &&
      Number(x.identity_variant_index) <= 15 && typeof x.active_service === "boolean",
    "identity",
  );
  need(
    typeof x.metric_kind === "string" && id(x.metric_kind) &&
      hash(x.expected_native_value_sha256) &&
      (x.raw_source_row_sha256 === null || hash(x.raw_source_row_sha256)),
    "source_shape",
  );
  need(
    x.value === null || typeof x.value === "string" || typeof x.value === "number" ||
      typeof x.value === "bigint",
    "native_value",
  );
  return Object.freeze({ ...x, previous_cell: previous(x.previous_cell) });
}
export async function prepareRecruitmentFinalCandidates(
  rawPins: unknown,
  rawInputs: unknown,
  authority: TrustedQualificationAuthority,
): Promise<unknown> {
  const p = record(rawPins, PIN_FIELDS);
  need(PIN_FIELDS.every((k) => hash(p[k])), "pins");
  const pins = Object.freeze({ ...p }) as unknown as Pins;
  const rows = dense(rawInputs, MAX).map(input);
  need(rows.length > 0, "empty_scope");
  need(
    authority && typeof authority.assertLive === "function" &&
      typeof authority.verifyBatch === "function",
    "authority",
  );
  const live = authority.assertLive.bind(authority), verify = authority.verifyBatch.bind(authority);
  // Mapped historical P1 v1/v2 2024-2026 identity is year + original_pk.
  // School/track/group and variant remain separately verified subject evidence.
  const groups = new Map<string, { indices: number[]; sha256: string }>();
  const cellKey = (x: Obj) => JSON.stringify([x.academic_year, x.offering_pk]);
  for (let i = 0; i < rows.length; i++) {
    const key = cellKey(rows[i]), g = groups.get(key) ?? { indices: [], sha256: "" };
    g.indices.push(i);
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    const ids = g.indices.map((i) => rows[i].observation_id as string).sort();
    g.sha256 = await nativeJsonSha256({
      codec: "jungsi.p1-recruitment-target-cell-group/v2",
      cell: JSON.parse(key),
      observation_ids: ids,
    });
  }
  const seen = new Set<string>(),
    subjects: Obj[] = [],
    nativeHashes: string[] = [],
    priorHashes: (string | null)[] = [];
  for (const x of rows) {
    // One canonical aggregate observation may have several P1 target rows.
    const observationCell = JSON.stringify([x.observation_id, x.academic_year, x.offering_pk]);
    need(!seen.has(observationCell), "duplicate_observation");
    seen.add(observationCell);
    const value = x.value as NativeValue,
      vh = await nativeValueSha256(value),
      ph = await previousCellSha256(x.previous_cell as Obj | null);
    nativeHashes.push(vh);
    priorHashes.push(ph);
    const subject = Object.freeze({
      observation_id: x.observation_id,
      academic_year: x.academic_year,
      school_id: x.school_id,
      offering_pk: x.offering_pk,
      admission_track: x.admission_track,
      recruit_group: x.recruit_group,
      identity_variant_index: x.identity_variant_index,
      metric_kind: x.metric_kind,
      active_service: x.active_service,
      native_value_type: value === null ? "null" : typeof value,
      native_value_json_type: jsonType(value),
      native_value_codec: VALUE_CODEC,
      native_value_sha256: vh,
      raw_source_row_sha256: x.raw_source_row_sha256,
      source_head_sha256: pins.source_head_sha256,
      approved_scope_sha256: pins.approved_scope_sha256,
      previous_manifest_sha256: pins.previous_manifest_sha256,
      previous_cell_sha256: ph,
      target_cell_group_sha256: groups.get(cellKey(x))!.sha256,
      target_cell_group_size: groups.get(cellKey(x))!.indices.length,
    });
    const subjectSha = await nativeJsonSha256({ codec: SUBJECT_CODEC, subject });
    subjects.push(Object.freeze({ ...subject, subject_sha256: subjectSha }));
  }
  need(await live(pins) === undefined, "authority_protocol");
  const proofs = dense(await verify(pins, Object.freeze(subjects)), rows.length).map((v) => {
    try {
      return proofRecord(v, PROOF_FIELDS);
    } catch {
      return Object.freeze({}) as Obj;
    }
  });
  need(proofs.length === rows.length, "proof_count");
  const publishedGroups = proofs.map((v) => sourceGroups(v.source_announced_groups));
  const groupSelections = new Map<string, string | null>();
  for (const [key, g] of groups) {
    if (g.indices.length < 2) continue;
    let selected: string | null = null, valid = true;
    for (const i of g.indices) {
      const proof = proofs[i], subject = subjects[i];
      if (
        proof.target_cell_group_sha256 !== g.sha256 ||
        proof.target_cell_selection !== "single_selection_approved" ||
        typeof proof.target_cell_selected_observation_id !== "string" ||
        proof.subject_sha256 !== subject.subject_sha256 ||
        proof.authority_sha256 !== pins.authority_sha256 ||
        proof.source_head_sha256 !== pins.source_head_sha256 ||
        proof.approved_scope_sha256 !== pins.approved_scope_sha256 ||
        proof.previous_manifest_sha256 !== pins.previous_manifest_sha256 ||
        proof.previous_cell_sha256 !== priorHashes[i] ||
        priorHashes[i] !== priorHashes[g.indices[0]]
      ) {
        valid = false;
        continue;
      }
      if (selected === null) selected = proof.target_cell_selected_observation_id as string;
      else if (selected !== proof.target_cell_selected_observation_id) valid = false;
    }
    if (!g.indices.some((i) => rows[i].observation_id === selected)) valid = false;
    groupSelections.set(key, valid ? selected : null);
  }
  const out: Obj[] = [];
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i],
      subject = subjects[i],
      v = proofs[i],
      prior = x.previous_cell as Obj | null;
    let reason: string | null = null;
    const group = groups.get(cellKey(x))!, selected = groupSelections.get(cellKey(x));
    if (x.academic_year === 2027) reason = "P1_2027_SCOPE_UNSUPPORTED";
    else if (group.indices.length > 1 && !selected) reason = "DUPLICATE_CELL_SELECTION_REQUIRED";
    else if (group.indices.length > 1 && selected !== x.observation_id) {
      reason = "OTHER_OBSERVATION_SELECTED";
    } else if (!x.active_service) reason = "INACTIVE_OBSERVATION";
    else if (
      !["recruitment_quota_published_stage_unspecified", "recruitment_quota_final"].includes(
        x.metric_kind as string,
      )
    ) reason = "METRIC_UNSUPPORTED";
    else if (
      !nullableText(x.admission_track) || x.admission_track === null ||
      !nullableText(x.recruit_group) || x.recruit_group === null
    ) reason = "IDENTITY_INCOMPLETE";
    else if (!count(x.value)) reason = "VALUE_UNRESOLVED";
    else if (x.expected_native_value_sha256 !== nativeHashes[i]) {
      reason = "CURRENT_VALUE_HASH_MISMATCH";
    } else if (!hash(x.raw_source_row_sha256)) reason = "RAW_SOURCE_ROW_FINGERPRINT_MISSING";
    else if (v.disposition !== "approved") reason = "EVIDENCE_UNAPPROVED";
    else if (
      v.subject_sha256 !== subject.subject_sha256 ||
      v.source_head_sha256 !== pins.source_head_sha256 ||
      v.approved_scope_sha256 !== pins.approved_scope_sha256 ||
      v.authority_sha256 !== pins.authority_sha256 ||
      v.previous_manifest_sha256 !== pins.previous_manifest_sha256 ||
      v.previous_cell_sha256 !== priorHashes[i]
    ) reason = "EVIDENCE_SCOPE_OR_HEAD_MISMATCH";
    else if (
      v.target_cell_group_sha256 !== subject.target_cell_group_sha256 ||
      v.target_cell_selection !== "single_selection_approved" ||
      v.target_cell_selected_observation_id !== x.observation_id
    ) reason = "TARGET_CELL_SELECTION_UNCONFIRMED";
    else if (
      prior === null && v.previous_cell_binding !== "absent_previous_cell_verified" ||
      prior !== null && emptyPrevious(prior) &&
        v.previous_cell_binding !== "empty_selection_cell_verified"
    ) reason = "PREVIOUS_CELL_BINDING_UNAPPROVED";
    else if (v.identity_variant_index !== x.identity_variant_index) {
      reason = "IDENTITY_VARIANT_UNAPPROVED";
    } else if (
      v.native_value_sha256 !== nativeHashes[i] ||
      v.native_value_type !== subject.native_value_type ||
      v.native_value_json_type !== subject.native_value_json_type ||
      v.native_value_codec !== VALUE_CODEC
    ) reason = "EVIDENCE_VALUE_MISMATCH";
    else if (
      v.raw_source_row_sha256 !== x.raw_source_row_sha256 || v.source_snapshot_confirmed !== true
    ) reason = "RAW_ROW_OR_SNAPSHOT_UNCONFIRMED";
    else if (v.source_metric_binding !== "approved_recruitment_final_count") {
      reason = "SOURCE_MEASUREMENT_UNAPPROVED";
    } else if (typeof v.source_production_allowed !== "boolean") {
      reason = "SOURCE_PRODUCTION_STATE_UNKNOWN";
    } else if (v.source_cohort_binding !== "approved" || !hash(v.source_cohort_sha256)) {
      reason = "SOURCE_COHORT_UNAPPROVED";
    } else if (
      v.source_announced_groups_binding !== "approved" || publishedGroups[i] === null ||
      typeof x.recruit_group !== "string" || !publishedGroups[i]!.includes(x.recruit_group)
    ) reason = "SOURCE_GROUP_UNAPPROVED_OR_MISMATCH";
    else if (v.target_membership_binding !== "approved" || !hash(v.target_membership_sha256)) {
      reason = "TARGET_MEMBERSHIP_UNAPPROVED";
    } else if (v.stage !== "final") reason = "STAGE_NOT_APPROVED_FINAL";
    else if (v.unit !== "명") reason = "SOURCE_UNIT_UNAPPROVED";
    else if (
      !hash(v.source_sha256) || !id(v.source_ref) || !publicUrl(v.source_url) ||
      (v.source_as_of !== null && v.source_as_of !== undefined && !calendarDate(v.source_as_of))
    ) reason = "SOURCE_EVIDENCE_INCOMPLETE";
    else if (
      calendarDate(v.source_as_of) && v.source_as_of_kind !== "official_announcement_date" ||
      (v.source_as_of === null || v.source_as_of === undefined) && v.source_as_of_kind !== null &&
        v.source_as_of_kind !== undefined
    ) reason = "SOURCE_DATE_MEANING_UNAPPROVED";
    let action = "HOLD", cell: Obj | null = prior;
    let mayPropose = reason === null && emptyPrevious(prior);
    if (reason === null && prior && !emptyPrevious(prior)) {
      const c = prior.source_context as Obj | null,
        priorHash = await nativeValueSha256(prior.value as NativeValue);
      const contextIdentity = c === null ||
        c.observation_id === x.observation_id &&
          c.identity_variant_index === x.identity_variant_index;
      const binding = c === null
        ? "missing_context_verified"
        : c.scope_status === "review_pending"
        ? "existing_context_review_pending_verified"
        : "source_consistent_verified";
      const same = ["verified_official", "pending_metadata"].includes(prior.status as string) &&
        prior.unit === "명" && contextIdentity && v.previous_cell_binding === binding &&
        priorHash === nativeHashes[i];
      const sourceMatches = (prior.source_url === null || prior.source_url === v.source_url) &&
        (prior.source_as_of === null || prior.source_as_of === v.source_as_of);
      const validVerified = prior.status !== "verified_official" ||
        prior.source_url !== null && prior.source_as_of !== null;
      if (
        same && sourceMatches && validVerified && prior.stage === "final" &&
        prior.status === "verified_official" && c !== null && c.scope_status === "source_consistent"
      ) action = "PRESERVED";
      else if (
        same && sourceMatches && validVerified &&
        (prior.stage === "final" || prior.stage === "unspecified")
      ) mayPropose = true;
      else reason = "EXISTING_CELL_CONFLICT";
    }
    if (mayPropose) {
      const dated = calendarDate(v.source_as_of);
      action = "PROPOSED";
      cell = Object.freeze({
        value: x.value,
        unit: "명",
        status: dated ? "verified_official" : "pending_metadata",
        reason_code: dated ? null : "SOURCE_AS_OF_UNCONFIRMED",
        source_url: v.source_url,
        source_as_of: dated ? v.source_as_of : null,
        statistic_label: prior?.statistic_label ?? null,
        cohort: prior?.cohort ?? null,
        source_context: Object.freeze({
          observation_id: x.observation_id,
          identity_variant_index: x.identity_variant_index,
          scope_status: "source_consistent",
        }),
        stage: "final",
      });
    }
    const provenance = reason === null
      ? Object.freeze({
        subject_sha256: subject.subject_sha256,
        source_head_sha256: pins.source_head_sha256,
        approved_scope_sha256: pins.approved_scope_sha256,
        authority_sha256: pins.authority_sha256,
        previous_manifest_sha256: pins.previous_manifest_sha256,
        previous_cell_sha256: priorHashes[i],
        source_sha256: v.source_sha256,
        source_ref: v.source_ref,
        source_as_of_kind: v.source_as_of_kind ?? null,
        raw_source_row_sha256: x.raw_source_row_sha256,
        native_value_sha256: nativeHashes[i],
        native_value_type: subject.native_value_type,
        native_value_json_type: subject.native_value_json_type,
        native_value_codec: VALUE_CODEC,
        previous_cell_binding: v.previous_cell_binding ?? null,
        identity_variant_index: x.identity_variant_index,
        target_cell_group_sha256: subject.target_cell_group_sha256,
        target_cell_selection: v.target_cell_selection ?? null,
        target_cell_selected_observation_id: v.target_cell_selected_observation_id ?? null,
        source_metric_binding: v.source_metric_binding,
        source_production_allowed: v.source_production_allowed,
        source_cohort_sha256: v.source_cohort_sha256,
        source_announced_groups: publishedGroups[i],
        target_membership_sha256: v.target_membership_sha256,
      })
      : null;
    out.push(Object.freeze({
      observation_id: x.observation_id,
      academic_year: x.academic_year,
      school_id: x.school_id,
      offering_pk: x.offering_pk,
      action,
      reason_code: reason,
      recruitment_count_with_stage: cell,
      private_qualification_reference: provenance,
    }));
  }
  // A rejected member must not suppress an independently qualified member.
  const sourceSignatures = new Map<string, Set<string>>();
  const eligibleMembers = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    if (out[i].action === "HOLD") continue;
    const x = rows[i], v = proofs[i], announced = publishedGroups[i]!;
    const obs = x.observation_id as string,
      signatures = sourceSignatures.get(obs) ?? new Set<string>();
    signatures.add(
      JSON.stringify([
        x.academic_year,
        x.school_id,
        v.source_cohort_sha256,
        v.source_production_allowed,
        [...announced].sort(),
        nativeHashes[i],
        subjects[i].native_value_type,
        subjects[i].native_value_json_type,
        x.raw_source_row_sha256,
      ]),
    );
    sourceSignatures.set(obs, signatures);
    const members = eligibleMembers.get(obs) ?? [];
    members.push(i);
    eligibleMembers.set(obs, members);
  }
  for (const [obs, signatures] of sourceSignatures) {
    if (signatures.size <= 1) continue;
    for (const i of eligibleMembers.get(obs)!) {
      out[i] = Object.freeze({
        ...out[i],
        action: "HOLD",
        reason_code: "SOURCE_OBSERVATION_EVIDENCE_CONFLICT",
        recruitment_count_with_stage: rows[i].previous_cell,
        private_qualification_reference: null,
      });
    }
  }
  need(await live(pins) === undefined, "authority_protocol");
  return Object.freeze({
    status: out.some((x) => x.action === "HOLD") ? "PARTIAL_REVIEW_ONLY" : "REVIEW_ONLY",
    publication_ready: false,
    created_observations: 0,
    guide_writes: 0,
    results: Object.freeze(out),
  });
}
