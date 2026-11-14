/** Closed public DTO extension for the explicit member JSON candidate. */
import { AccessError } from "./access.ts";
import type { ApiRoutePolicy } from "./api_dispatch.ts";
import {
  MEMBER_SHORTLIST_OPERATION_IDS,
  MEMBER_SHORTLIST_ROUTE_PATHS,
  REGISTERED_API_OPERATION_IDS,
} from "./api_dispatch.ts";
type Row = Record<string, unknown>;
const record = (x: unknown): x is Row => x !== null && typeof x === "object" && !Array.isArray(x);
/** A registered30 catalog must not silently activate two new routes in old read-view entries. */
export function legacyReadViewRegistration<T extends ApiRoutePolicy>(
  policies: readonly T[],
  input: unknown,
) {
  if (
    policies.length !== 30 || new Set(policies.map((p) => p.id)).size !== 30 ||
    policies.some((p) => !(REGISTERED_API_OPERATION_IDS as readonly string[]).includes(p.id))
  ) throw new AccessError("security_policy_unavailable", 503);
  for (const id of MEMBER_SHORTLIST_OPERATION_IDS) {
    const p = policies.find((p) => p.id === id)!;
    if (
      p.path !== MEMBER_SHORTLIST_ROUTE_PATHS[id] ||
      p.method !== (id === "member-shortlist.read" ? "GET" : "PUT") ||
      p.member_tiers.length !== 1 || p.member_tiers[0] !== "paid" || p.report_owner !== false ||
      p.confirmed_score_profile !== false
    ) throw new AccessError("security_policy_unavailable", 503);
  }
  const responseSchemas = structuredClone(input);
  if (
    !record(responseSchemas) || !Array.isArray(responseSchemas.operations) ||
    responseSchemas.operations.length !== 30 ||
    new Set(responseSchemas.operations.map((o: Row) => o.id)).size !== 30 ||
    responseSchemas.operations.some((o: Row) =>
      !(REGISTERED_API_OPERATION_IDS as readonly string[]).includes(o.id as ApiRoutePolicy["id"])
    )
  ) throw new AccessError("security_policy_unavailable", 503);
  responseSchemas.operations = responseSchemas.operations.filter((o: Row) =>
    !MEMBER_SHORTLIST_OPERATION_IDS.some((id) => id === o.id)
  );
  return {
    policies: policies.filter((p) => !MEMBER_SHORTLIST_OPERATION_IDS.some((id) => id === p.id)),
    responseSchemas,
  };
}
export function memberShortlistPolicies(
  base: readonly ApiRoutePolicy[],
): readonly ApiRoutePolicy[] {
  const present = MEMBER_SHORTLIST_OPERATION_IDS.filter((id) => base.some((p) => p.id === id));
  if (present.length === 2) return base;
  if (present.length) throw new AccessError("security_policy_unavailable", 503);
  return [
    ...base,
    ...MEMBER_SHORTLIST_OPERATION_IDS.map((id) => ({
      id,
      contract_ref: "backend_platform_contract.dto_schemas.member_shortlist",
      method: id === "member-shortlist.read" ? "GET" as const : "PUT" as const,
      path: MEMBER_SHORTLIST_ROUTE_PATHS[id],
      member_tiers: ["paid"] as const,
      report_owner: false,
      confirmed_score_profile: false,
    })),
  ];
}
export function memberShortlistResponseSchemas(input: unknown): unknown {
  const r = structuredClone(input);
  if (!record(r) || !record(r.schemas) || !Array.isArray(r.operations)) {
    throw new AccessError("security_policy_unavailable", 503);
  }
  const schemas = r.schemas;
  if (!record(schemas.safe_code) || !Array.isArray(schemas.safe_code.enum)) {
    throw new AccessError("security_policy_unavailable", 503);
  }
  schemas.safe_code.enum = [
    ...new Set([
      ...schemas.safe_code.enum,
      "catalog_offering_missing",
      "saved_assessment_missing",
      "current_saved_assessment_missing",
      "shortlist_limit_exceeded",
    ]),
  ].sort();
  if (!record(schemas.safe_error_code) || !Array.isArray(schemas.safe_error_code.enum)) {
    throw new AccessError("security_policy_unavailable", 503);
  }
  schemas.safe_error_code.enum = [
    ...new Set([...schemas.safe_error_code.enum, "shortlist_limit_exceeded"]),
  ].sort();
  const ref = (name: string, nullable = false) => ({ ref: name, nullable });
  const string = (nullable = false) => ({ type: "string", nullable });
  const integer = { type: "integer", nullable: false };
  const object = (properties: Row, optional: string[] = []) => ({
    type: "object",
    nullable: false,
    properties,
    required: Object.keys(properties).filter((k) => !optional.includes(k)),
    optional,
  });
  schemas.member_shortlist_legacy = object({
    report_id: ref("identifier"),
    report_version: integer,
  });
  schemas.member_shortlist_assessment_context = object({
    report_id: ref("identifier"),
    report_version: integer,
    profile_id: ref("identifier"),
    exam_id: ref("identifier"),
    pack_version: ref("identifier"),
    academic_year: integer,
    source: { type: "string", nullable: false, enum: ["selected_report", "current_profile"] },
  });
  schemas.member_shortlist_display = object({
    university_name: string(true),
    department: string(true),
    group: string(true),
    track: string(true),
    campus: string(true),
  });
  schemas.member_shortlist_item = object({
    offering_id: ref("identifier"),
    selected: { type: "boolean", nullable: false },
    changed_at: string(),
    display: ref("member_shortlist_display", true),
    catalog_status: { type: "string", nullable: false, enum: ["available", "missing"] },
    assessment: ref("assessment", true),
    assessment_status: {
      type: "string",
      nullable: false,
      enum: ["ready", "pending", "ineligible", "missing"],
    },
    assessment_reason_code: ref("safe_code", true),
  });
  schemas.member_shortlist = object({
    format: { type: "string", nullable: false, enum: ["jungsi.member-shortlist/v1"] },
    year: integer,
    revision: integer,
    updated_at: string(true),
    origin: { type: "string", nullable: false, enum: ["member_json", "legacy_report", "empty"] },
    legacy_source: ref("member_shortlist_legacy", true),
    assessment_context: ref("member_shortlist_assessment_context", true),
    items: { type: "array", nullable: false, items: ref("member_shortlist_item") },
  });
  for (const id of MEMBER_SHORTLIST_OPERATION_IDS) {
    const old = r.operations.find((p: unknown) => record(p) && p.id === id);
    if (!old) {
      r.operations.push({
        id,
        contract_ref: "backend_platform_contract.dto_schemas.member_shortlist",
        roots: { standard: ref("member_shortlist"), paid: ref("member_shortlist") },
      });
    }
  }
  const paid = schemas.snapshot_paid;
  if (!record(paid) || !record(paid.properties) || !Array.isArray(paid.optional)) {
    throw new AccessError("security_policy_unavailable", 503);
  }
  paid.properties.shortlist_revision = integer;
  paid.properties.member_shortlist = ref("member_shortlist");
  paid.optional = [...new Set([...paid.optional, "shortlist_revision", "member_shortlist"])];
  return r;
}
