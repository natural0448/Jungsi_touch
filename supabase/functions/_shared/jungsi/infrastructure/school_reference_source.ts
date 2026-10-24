/** Request-scoped pinned reference adapter. No Python execution, DB access or approval rewrite. */
import type {
  ReferenceDerivation,
  SchoolReferenceDataPort,
  SchoolReferenceFunction,
} from "../application/school_reference_scoring.ts";
import { NativeConversionRule } from "../domain/conversion_release.ts";
import { ContractError, requireContract as check } from "../domain/exact.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
export interface SchoolReferenceSelection {
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly sourceSha256: string;
  readonly independentSha256: string;
}
export interface SchoolReferenceBytesPort {
  /** Independently verified server selection, never supplied in a caller request. */
  select(offeringId: string): SchoolReferenceSelection | null;
  /** Existing private read/budget boundary; same key is shared by all matching offerings. */
  read(key: string): Promise<Uint8Array>;
  assertCurrent(): Promise<void>;
}
function object(v: unknown): NativeObject {
  check(
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat),
    "reference_package_invalid",
  );
  return v as NativeObject;
}
function closed(v: unknown, keys: readonly string[]): NativeObject {
  const o = object(v);
  check(
    Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k)),
    "reference_package_invalid",
  );
  return o;
}
function text(v: unknown): asserts v is string {
  check(
    typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v),
    "reference_package_invalid",
  );
}
function strings(v: unknown): string[] {
  check(
    Array.isArray(v) && v.length <= 32 &&
      v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 128) &&
      new Set(v).size === v.length,
    "reference_package_invalid",
  );
  return v as string[];
}
type Decoded = Omit<SchoolReferenceFunction, "binding"> & {
  readonly bindings: readonly NativeObject[];
};
/** Construct one adapter per existing analysis request; memoization never outlives its publication. */
export class PinnedSchoolReferenceSource implements SchoolReferenceDataPort {
  private readonly cache = new Map<string, { signature: string; value: Promise<Decoded> }>();
  constructor(private readonly source: SchoolReferenceBytesPort) {}
  async getReference(offeringId: string): Promise<SchoolReferenceFunction | null> {
    const pin = this.source.select(offeringId);
    if (pin === null) return null;
    text(pin.key);
    check(
      [pin.sha256, pin.sourceSha256, pin.independentSha256].every((v) =>
        /^[a-f0-9]{64}$/.test(v)
      ) &&
        Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= 131072,
      "reference_pin_invalid",
    );
    const signature = [pin.sha256, pin.bytes, pin.sourceSha256, pin.independentSha256].join(":");
    const prior = this.cache.get(pin.key);
    check(!prior || prior.signature === signature, "reference_pin_changed");
    if (!prior) this.cache.set(pin.key, { signature, value: this.load(pin) });
    const decoded = await this.cache.get(pin.key)!.value;
    const binding = decoded.bindings.find((v) => v.offering_pk === offeringId);
    check(binding, "reference_offering_context_mismatch");
    return Object.freeze({ ...decoded, binding });
  }
  private async load(pin: SchoolReferenceSelection): Promise<Decoded> {
    await this.source.assertCurrent();
    const raw = await this.source.read(pin.key);
    check(raw.length === pin.bytes, "reference_pin_invalid");
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(raw)))]
      .map((v) => v.toString(16).padStart(2, "0")).join("");
    check(sha === pin.sha256, "reference_pin_invalid");
    const decoded = decodeSchoolReferencePayload(
      parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
      pin,
    );
    await this.source.assertCurrent();
    return decoded;
  }
}

/** Payload already raw-SHA verified by the selected source or this byte adapter. */
export function decodeSchoolReferencePayload(
  value: unknown,
  pin: Pick<SchoolReferenceSelection, "sourceSha256" | "independentSha256">,
): Decoded {
  const p = closed(value, [
    "format",
    "version",
    "academic_year",
    "exam_id",
    "source_pack_version",
    "exam_type",
    "score_scale_id",
    "review",
    "domain",
    "rule",
    "bindings",
  ]);
  check(p.format === "jungsi.school-reference-conversion/v1", "reference_package_invalid");
  for (const k of ["version", "exam_id", "source_pack_version", "score_scale_id"]) text(p[k]);
  check(
    typeof p.academic_year === "number" && Number.isSafeInteger(p.academic_year) &&
      p.academic_year >= 2024 &&
      p.academic_year <= 2027 &&
      ["csat", "june_mock", "september_mock"].includes(String(p.exam_type)),
    "reference_package_invalid",
  );
  const review = closed(p.review, [
    "source_sha256",
    "independent_sha256",
    "scope",
    "production_allowed",
    "applicant_eligibility_approved",
  ]);
  check(
    review.source_sha256 === pin.sourceSha256 &&
      review.independent_sha256 === pin.independentSha256 &&
      review.scope === "same_exam_mathematical_reference" && review.production_allowed === false &&
      review.applicant_eligibility_approved === false,
    "reference_review_scope_invalid",
  );
  const rawDomain = object(p.domain);
  const domain = closed(rawDomain, [
    "required_fields",
    "inquiry_categories",
    "minimum_inquiry",
    "positive_score_required",
    "derivations",
    ...(Object.hasOwn(rawDomain, "mixed_social_science_allowed")
      ? ["mixed_social_science_allowed"]
      : []),
    ...(Object.hasOwn(rawDomain, "math_choices") ? ["math_choices"] : []),
    ...(Object.hasOwn(rawDomain, "inquiry_subjects") ? ["inquiry_subjects"] : []),
  ]);
  check(
    !Object.hasOwn(domain, "mixed_social_science_allowed") ||
      typeof domain.mixed_social_science_allowed === "boolean",
    "reference_package_invalid",
  );
  const mathChoices = Object.hasOwn(domain, "math_choices")
    ? Object.freeze(strings(domain.math_choices))
    : undefined;
  const inquirySubjects = Object.hasOwn(domain, "inquiry_subjects")
    ? Object.freeze(strings(domain.inquiry_subjects))
    : undefined;
  check(
    (!mathChoices || mathChoices.length > 0) && (!inquirySubjects || inquirySubjects.length > 0),
    "reference_package_invalid",
  );
  const requiredFields = strings(domain.required_fields),
    categories = strings(domain.inquiry_categories);
  check(
    categories.every((v) => ["social", "science", "vocational"].includes(v)) &&
      typeof domain.minimum_inquiry === "number" && Number.isSafeInteger(domain.minimum_inquiry) &&
      domain.minimum_inquiry >= 0 && domain.minimum_inquiry <= 2 &&
      typeof domain.positive_score_required === "boolean" &&
      Array.isArray(domain.derivations) && domain.derivations.length <= 4,
    "reference_package_invalid",
  );
  const derivations = domain.derivations.map((v) => {
    const d = closed(v, ["field", "operation", "inputs", "minimum_present"]);
    text(d.field);
    check(
      ["observed_max", "observed_sum", "observed_average"].includes(String(d.operation)) &&
        typeof d.minimum_present === "number" && Number.isSafeInteger(d.minimum_present),
      "reference_package_invalid",
    );
    return Object.freeze({
      field: d.field,
      operation: d.operation as ReferenceDerivation["operation"],
      inputs: Object.freeze(strings(d.inputs)),
      minimumPresent: d.minimum_present,
    });
  });
  check(
    Array.isArray(p.bindings) && p.bindings.length > 0 && p.bindings.length <= 256,
    "reference_package_invalid",
  );
  const seen = new Set<string>();
  const bindings = p.bindings.map((v) => {
    const b = cloneNativeJson(
      closed(v, [
        "academic_year",
        "offering_pk",
        "university_id",
        "campus",
        "department",
        "track",
        "group",
        "rule_version",
      ]),
    );
    check(
      typeof b.offering_pk === "string" && !seen.has(b.offering_pk) &&
        b.academic_year === p.academic_year &&
        Object.values(b).every((x) =>
          x === null || typeof x === "string" || typeof x === "number" && Number.isSafeInteger(x)
        ),
      "reference_package_invalid",
    );
    seen.add(b.offering_pk);
    return Object.freeze(b);
  });
  let rule: NativeConversionRule;
  try {
    rule = new NativeConversionRule(p.rule);
  } catch (e) {
    if (e instanceof ContractError) throw new ContractError("reference_rule_unsupported");
    throw e;
  }
  check(
    bindings.every((b) => b.rule_version === rule.data.rule_version),
    "reference_rule_context_mismatch",
  );
  return Object.freeze({
    version: p.version as string,
    academicYear: p.academic_year as number,
    examId: p.exam_id as string,
    packVersion: p.source_pack_version as string,
    examType: p.exam_type as string,
    scoreScaleId: p.score_scale_id as string,
    sourceSha256: pin.sourceSha256,
    independentSha256: pin.independentSha256,
    requiredFields: Object.freeze(requiredFields),
    inquiryCategories: Object.freeze(categories),
    minimumInquiry: domain.minimum_inquiry as number,
    positiveScoreRequired: domain.positive_score_required as boolean,
    derivations: Object.freeze(derivations),
    ...(mathChoices ? { mathChoices } : {}),
    ...(inquirySubjects ? { inquirySubjects } : {}),
    ...(Object.hasOwn(domain, "mixed_social_science_allowed")
      ? { mixedSocialScienceAllowed: domain.mixed_social_science_allowed as boolean }
      : {}),
    bindings: Object.freeze(bindings),
    rule,
  });
}
