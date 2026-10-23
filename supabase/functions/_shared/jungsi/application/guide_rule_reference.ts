/** Internal counseling reference read. Call only after the existing tenant/paid authorization. */
import { AccessError } from "./access.ts";
import { publicSourceUrl } from "./catalog.ts";
import type { RequestClockPort } from "./ports.ts";
import type { ProfessionalScope } from "./professional_ports.ts";
import type { ProfessionalPolicy } from "./professional_policy.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";

export const GUIDE_REFERENCE_FIELDS = [
  "korean_ratio",
  "math_ratio",
  "english_ratio",
  "inquiry_ratio",
  "history_ratio",
  "english_grade_points",
  "history_grade_points",
  "math_bonus",
  "inquiry_bonus",
  "inquiry_subject_count",
  "inquiry_subject_count_range",
  "inquiry_selection_method",
  "inquiry_score_basis",
  "required_exam_areas",
  "required_exam_areas_normalized",
  "required_subject_choices",
  "reflected_areas",
  "score_metrics_by_area",
  "reflection_combination",
  "selection_groups",
  "weighted_subjects",
  "selection_method",
  "csat_ratio",
  "csat_minimum",
] as const;
export interface GuideRuleQuery {
  readonly academicYear: number;
  readonly offeringPk: string;
}
export interface GuideRuleSourceResult {
  readonly version: string;
  readonly sourcePointerSha256: string;
  readonly row: NativeObject | null;
  readonly lineage: readonly NativeObject[];
}
/** Data adapter returns one exact year/PK; no client-selected relation, file, SQL or release. */
export interface GuideRuleReferencePort {
  readCurrent(subjectId: string, query: GuideRuleQuery): Promise<GuideRuleSourceResult>;
}
const object = (v: unknown): v is NativeObject =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
function unavailable(): never {
  throw new AccessError("current_catalog_unavailable", 503);
}
export function guideRuleQuery(academicYear: unknown, offeringPk: unknown): GuideRuleQuery {
  if (
    typeof academicYear !== "number" || !Number.isSafeInteger(academicYear) ||
    academicYear < 2024 || academicYear > 2027 || typeof offeringPk !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(offeringPk)
  ) throw new AccessError("invalid_request", 422);
  return Object.freeze({ academicYear, offeringPk });
}
const PRIVATE_KEYS = new Set([
  "path",
  "source_path",
  "evidence_path",
  "private_path",
  "download_url",
  "storage_key",
  "object_key",
  "source_location",
  "trace",
  "nodes",
  "model",
  "model_weights",
  "population_weights",
  "distribution",
  "curves",
  "coefficients",
  "private_metadata",
  "record_locator",
  "source_document",
  "source_cache",
  "profiles",
  "student_scores",
  "dsn",
  "password",
  "secret",
  "token",
]);
/** Preserve admissible native values. Withhold an entire unsafe field rather than rewrite its meaning. */
function safeValue(value: unknown, depth = 0, count = { n: 0 }): value is NativeJson {
  if (depth > 16 || ++count.n > 4096) return false;
  if (value === null || typeof value === "boolean" || typeof value === "bigint") return true;
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (value instanceof JsonFloat) return true;
  if (typeof value === "string") {
    return value.length <= 32768 &&
      !/(?:\b[A-Za-z]:[\\/]|\\\\|(?:file|project-file|library-file):|postgres(?:ql)?:\/\/|Bearer\s+|eyJ[A-Za-z0-9_-]+\.|(?:password|access_token|api_key)=)/i
        .test(value);
  }
  if (Array.isArray(value)) {
    return value.length <= 512 && value.every((v) => safeValue(v, depth + 1, count));
  }
  return object(value) && Object.keys(value).length <= 128 &&
    Object.entries(value).every(([key, v]) =>
      !PRIVATE_KEYS.has(key.toLowerCase()) && safeValue(v, depth + 1, count)
    );
}
function publicUrl(value: unknown): string | null {
  try {
    return publicSourceUrl(value);
  } catch {
    return null;
  }
}
const QUALIFICATION_FIELDS = [
  "status",
  "qualification_status",
  "publication_status",
  "source_status",
  "missing_reason",
  "reason",
  "conditions",
  "exceptions",
  "original_label",
  "original_text",
  "unit",
  "basis",
  "method",
  "kind",
  "source_year",
  "academic_year",
  "source_as_of",
  "page",
  "pages",
  "pdf_page",
  "document_version",
] as const;
function qualification(value: unknown): NativeObject {
  if (!object(value)) return {};
  const out: NativeObject = {};
  let withheld = false;
  for (const key of QUALIFICATION_FIELDS) {
    if (!Object.hasOwn(value, key)) continue;
    if (safeValue(value[key])) out[key] = cloneNativeJson(value[key]);
    else withheld = true;
  }
  if (Object.hasOwn(value, "source_url")) {
    out.source_url = publicUrl(value.source_url);
    if (value.source_url !== null && out.source_url === null) withheld = true;
  }
  if (withheld) {
    out.projection_status = "withheld";
    out.missing_reason = "unsafe_qualification_metadata";
  }
  return out;
}
function metadataText(value: unknown, identifier = false): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string" || value.length > 256 || !safeValue(value) ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    identifier && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) unavailable();
  return value;
}
function fieldReference(raw: NativeObject, name: string): NativeObject {
  const definitions = raw.definition, evidence = raw.evidence;
  if (!object(definitions) || !object(evidence)) unavailable();
  const present = Object.hasOwn(definitions, name);
  const types = definitions.field_presence_types;
  const originalType = metadataText(object(types) ? types[name] : null, true);
  const columns = evidence.column_export_information;
  const qualified = qualification(object(columns) ? columns[name] : null);
  const uncertainties = evidence.field_uncertainties ?? [];
  if (!Array.isArray(uncertainties) || uncertainties.length > 128) unavailable();
  const sourceUncertainties = uncertainties.filter((v) => object(v) && v.field === name)
    .map(qualification);
  const out: NativeObject = {
    present,
    original_field_type: originalType,
    qualification: qualified,
    source_uncertainties: sourceUncertainties,
    verification_status: "pending_independent_qualification",
    projection_status: present ? "preserved" : "absent",
  };
  if (present) {
    if (
      qualified.projection_status === "withheld" ||
      sourceUncertainties.some((v) => v.projection_status === "withheld")
    ) {
      out.projection_status = "withheld";
      out.missing_reason = "unsafe_required_qualification";
    } else if (safeValue(definitions[name])) out.value = cloneNativeJson(definitions[name]);
    else {
      out.projection_status = "withheld";
      out.missing_reason = "private_or_unbounded_field_metadata";
    }
  }
  return out;
}
function lineage(rows: readonly NativeObject[], query: GuideRuleQuery): NativeObject[] {
  if (rows.length > 64) unavailable();
  const seen = new Set<string>();
  return rows.map((row) => {
    if (
      row.from_year !== 2026 || row.to_year !== 2027 ||
      typeof row.from_pk !== "string" || typeof row.to_pk !== "string" ||
      typeof row.kind !== "string" ||
      typeof row.relation_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.relation_sha256) ||
      row.lineage_button_link_allowed !== true ||
      row.endpoint_status !== "both_current_offerings" ||
      !(query.academicYear === 2026 && row.from_pk === query.offeringPk ||
        query.academicYear === 2027 && row.to_pk === query.offeringPk)
    ) unavailable();
    const key = row.relation_sha256;
    if (seen.has(key)) unavailable();
    seen.add(key);
    const result: NativeObject = {};
    for (
      const field of [
        "from_year",
        "from_pk",
        "to_year",
        "to_pk",
        "kind",
        "relation_type",
        "relation_detail_type",
        "relation_sha256",
        "lineage_button_link_allowed",
        "endpoint_status",
      ]
    ) {
      if (Object.hasOwn(row, field)) {
        if (!safeValue(row[field])) unavailable();
        result[field] = cloneNativeJson(row[field]);
      }
    }
    const constraints = row.constraints ?? {};
    if (!object(constraints) || !safeValue(constraints)) unavailable();
    result.constraints = cloneNativeJson(constraints);
    return result;
  });
}
/** No engine call, cross-year score calculation, comparison sentence or new HTTP operation. */
export class GuideRuleReferenceService {
  constructor(
    private readonly source: GuideRuleReferencePort,
    private readonly clock: RequestClockPort,
    private readonly policy: ProfessionalPolicy,
  ) {}
  async read(
    scope: ProfessionalScope,
    academicYear: unknown,
    offeringPk: unknown,
  ): Promise<NativeObject> {
    const query = guideRuleQuery(academicYear, offeringPk);
    // Existing licensed-org, current member, assigned student and expiry policy; no personal alias.
    this.policy.assertStudent(
      scope.authority,
      scope.student,
      "pro.report.read",
      this.clock.nowUtc(),
    );
    const user = scope.authority.user;
    const result = await this.source.readCurrent(user.subjectId, query);
    this.policy.assertStudent(
      scope.authority,
      scope.student,
      "pro.report.read",
      this.clock.nowUtc(),
    );
    if (
      !/^[a-f0-9]{64}$/.test(result.sourcePointerSha256) ||
      metadataText(result.version, true) === null
    ) {
      unavailable();
    }
    const base: NativeObject = {
      format: "jungsi.guide-rule-reference/v1",
      status: result.row === null ? "pending" : "collected_reference",
      academic_year: query.academicYear,
      offering_pk: query.offeringPk,
      version: result.version,
      source_pointer_sha256: result.sourcePointerSha256,
      engine_approved: false,
      engine_activation: false,
    };
    if (result.row === null) return { ...base, missing_reason: "guide_rule_not_available" };
    const raw = result.row;
    if (
      raw.academic_year !== query.academicYear || raw.offering_pk !== query.offeringPk ||
      typeof raw.rule_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.rule_sha256) ||
      raw.engine_approved !== false || !object(raw.definition) || !object(raw.evidence)
    ) unavailable();
    const fields: NativeObject = {};
    for (const field of GUIDE_REFERENCE_FIELDS) fields[field] = fieldReference(raw, field);
    const source = object(raw.source) ? raw.source : {};
    const census = raw.evidence.original_source_census_complete;
    if (census !== undefined && census !== null && typeof census !== "boolean") unavailable();
    const canonicalStatus = raw.evidence.canonical_rule_status ?? null;
    if (!safeValue(canonicalStatus)) unavailable();
    const out: NativeObject = {
      ...base,
      release_id: metadataText(raw.release_id, true),
      rule_sha256: raw.rule_sha256,
      rule_id: metadataText(raw.definition.score_rule_id),
      qualification_status: metadataText(raw.definition.score_rule_status),
      source_qualification: {
        canonical_rule_status: cloneNativeJson(canonicalStatus),
        original_source_census_complete: census ?? null,
        verification_status: "pending_independent_qualification",
      },
      fields,
      source: { ...qualification(source), source_url: publicUrl(source.source_url) },
      approved_lineage: lineage(result.lineage, query),
    };
    if (new TextEncoder().encode(nativeJsonText(out)).length > 65536) unavailable();
    return out;
  }
}
