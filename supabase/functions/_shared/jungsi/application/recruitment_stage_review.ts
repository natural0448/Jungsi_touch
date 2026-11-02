/**
 * Internal application DTO candidate. No route, DB, writer, issuer verifier or publisher.
 * Source approval labels are data-port assertions, never independently verified authority.
 * Public/operating integration stays unavailable until the existing source/consumer gates bind.
 */
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { hasAsciiControl } from "../domain/text.ts";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, HASH = /^[a-f0-9]{64}$/;
const IDENTITY = [
  "academic_year",
  "school_id",
  "original_pk",
  "campus",
  "admission_track",
  "group",
] as const;
function need(v: unknown, code: string): asserts v {
  if (!v) throw Error(code);
}
function object(
  raw: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): NativeObject {
  need(
    raw !== null && typeof raw === "object" && !Array.isArray(raw),
    "invalid_object",
  );
  need(
    [Object.prototype, null].includes(Object.getPrototypeOf(raw)),
    "invalid_prototype",
  );
  for (const key of Reflect.ownKeys(raw)) {
    need(
      typeof key === "string" &&
        (required.includes(key) || optional.includes(key)),
      "unknown_field",
    );
    const p = Object.getOwnPropertyDescriptor(raw, key);
    need(p && p.enumerable && "value" in p, "invalid_property");
  }
  for (const key of required) need(Object.hasOwn(raw, key), "missing_field");
  return raw as NativeObject;
}
function text(v: unknown, max = 4096): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max &&
    !hasAsciiControl(v) &&
    /[^\p{White_Space}\p{Cf}\p{Mn}\p{Me}\p{Cc}]/u.test(v);
}
function identity(raw: unknown): NativeObject {
  const x = object(raw, IDENTITY);
  need(
    x.academic_year === 2027 && typeof x.school_id === "string" &&
      ID.test(x.school_id) && typeof x.original_pk === "string" &&
      ID.test(x.original_pk),
    "invalid_identity",
  );
  for (const k of ["campus", "admission_track", "group"]) {
    need(text(x[k], 256), "incomplete_scope");
  }
  return cloneNativeJson(x);
}
function count(v: unknown): boolean {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ||
    typeof v === "bigint" && v >= 0n ||
    typeof v === "string" && /^\d{1,1024}$/.test(v);
}
function sameIdentity(a: NativeObject, b: NativeObject): boolean {
  return nativeJsonText(a, true) === nativeJsonText(b, true);
}
function proof(raw: unknown, id: NativeObject, revision: string): boolean {
  const p = object(raw, [
    "identity",
    "source_revision_sha256",
    "source_sha256",
    "source_ref",
    "approval_disposition",
  ]);
  need(sameIdentity(identity(p.identity), id), "source_scope_mismatch");
  need(
    p.source_revision_sha256 === revision &&
      typeof p.source_sha256 === "string" && HASH.test(p.source_sha256) &&
      text(p.source_ref),
    "source_binding_mismatch",
  );
  need(
    ["approved_public_source", "review_pending"].includes(
      p.approval_disposition as string,
    ),
    "invalid_source_disposition",
  );
  return p.approval_disposition === "approved_public_source";
}
export function assembleRecruitmentStageReview(raw: unknown) {
  const input = object(raw, [
    "format",
    "identity",
    "source_revision_sha256",
    "legacy_quota",
    "release_disposition",
    "facts",
    "condition",
  ]);
  need(
    input.format === "jungsi.recruitment-stage-source-review/v1",
    "invalid_format",
  );
  const id = identity(input.identity), revision = input.source_revision_sha256;
  need(
    typeof revision === "string" && HASH.test(revision),
    "invalid_source_revision",
  );
  need(
    input.release_disposition === "hold" ||
      input.release_disposition === "not_requested",
    "release_cannot_be_approved_here",
  );
  const legacy = object(input.legacy_quota, [], [
    "quota_value",
    "quota_stage",
    "quota_literal_state",
    "quota_condition_text",
    "quota_cell",
  ]);
  need(
    Array.isArray(input.facts) && input.facts.length <= 2,
    "invalid_fact_list",
  );
  const stages = new Map<string, NativeObject>();
  let sourceApproved = input.facts.length > 0 || input.condition !== null;
  for (const item of input.facts) {
    const f = object(item, ["stage", "state", "proof", "value", "unit"]);
    need(f.stage === "initial" || f.stage === "final", "invalid_stage");
    need(!stages.has(f.stage), "duplicate_stage");
    need(f.state === "reported" || f.state === "pending", "invalid_fact_state");
    const hasValue = Object.hasOwn(f, "value");
    if (f.state === "reported") {
      need(
        hasValue && count(f.value) && f.unit === "명",
        "invalid_reported_count",
      );
    } else {need(
        hasValue && f.value === null && (f.unit === null || f.unit === "명"),
        "pending_requires_explicit_null",
      );}
    sourceApproved = proof(f.proof, id, revision) && sourceApproved;
    stages.set(f.stage, {
      state: f.state,
      value_present: true,
      value: f.value,
      unit: f.unit,
    });
  }
  let condition: NativeObject | null = null;
  if (input.condition !== null) {
    const c = object(input.condition, ["text", "proof"]);
    need(text(c.text), "invalid_condition");
    sourceApproved = proof(c.proof, id, revision) && sourceApproved;
    condition = { text: c.text };
  }
  if (
    (legacy.quota_stage === "initial" || legacy.quota_stage === "final") &&
    Object.hasOwn(legacy, "quota_value")
  ) {
    const fact = stages.get(legacy.quota_stage);
    if (fact) {
      need(
        typeof fact.value === typeof legacy.quota_value &&
          nativeJsonText(fact.value) === nativeJsonText(legacy.quota_value),
        "legacy_stage_conflict",
      );
    }
  }
  // Review dispositions never become a public-ready flag. Unapproved source material is withheld.
  const result: NativeObject = {
    format: "jungsi.recruitment-stage-contract-review/v1",
    identity: id,
    release_disposition: input.release_disposition,
    source_disposition: sourceApproved
      ? "source_port_asserted_approved_NOT_AUTHORITY_VERIFIED"
      : "review_pending",
    stages: null,
    condition: null,
    public_payload: null,
    calculation_quota: null,
    publication_allowed: false,
  };
  if (sourceApproved) {
    const absent = () => ({
      state: "not_supplied",
      value_present: false,
      unit: null,
    });
    result.stages = {
      initial: stages.get("initial") ?? absent(),
      final: stages.get("final") ?? absent(),
    };
    result.condition = condition;
  }
  return result;
}
export function readOperatingRecruitmentStages(
  ..._args: unknown[]
): Promise<never> {
  // No approval/facts reader has been installed; neither caller flags nor this pure DTO activate it.
  return Promise.reject(Error("STAGE_SOURCE_AND_CONSUMER_NOT_BOUND"));
}
