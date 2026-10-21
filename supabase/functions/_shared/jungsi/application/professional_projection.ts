/** Closed professional envelopes with the existing recursive approved result schemas. */
import { AccessError } from "./access.ts";
import type { ProfessionalContract, ProfessionalResponse } from "./professional_ports.ts";
import { PublicResponseProjection } from "./public_response.ts";
import { proObject } from "./professional_policy.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";

type Schema = Record<string, unknown>;
const scalar = (type: string, nullable = false, extra: Schema = {}): Schema => ({
  type,
  nullable,
  ...extra,
});
const ref = (name: string, nullable = false): Schema => ({ ref: name, nullable });
const array = (items: Schema): Schema => scalar("array", false, { items });
const object = (properties: Record<string, Schema>): Schema =>
  scalar("object", false, { properties, required: Object.keys(properties), optional: [] });
const map = (values: Schema): Schema => scalar("map", false, { keys: ref("identifier"), values });
function unavailable(): never {
  throw new AccessError("professional_response_invalid", 503);
}
const TIP_CODES = [
  "subject_weight_strength",
  "comparable_historical_cut_delta",
  "admission_capacity_change",
  "historical_cut_spread",
  "english_deduction",
  "history_deduction",
];
export class ProfessionalProjection {
  private readonly projection: PublicResponseProjection;
  private readonly routes = new Map<string, ProfessionalContract["routes"][number]>();
  constructor(contract: ProfessionalContract, existingRegistry: unknown) {
    const original = proObject(existingRegistry),
      schemas: Schema = { ...proObject(original.schemas) };
    const safeCodes = proObject(schemas.safe_code).enum;
    if (!Array.isArray(safeCodes)) unavailable();
    schemas.pro_reason_code = scalar("string", false, {
      enum: [...safeCodes, "counseling_basis_not_connected"],
    });
    const id = ref("identifier"),
      text = scalar("string"),
      nullableText = scalar("string", true),
      integer = scalar("integer"),
      nullableInteger = scalar("integer", true),
      boolean = scalar("boolean");
    const definitions: Record<string, Schema> = {
      organization_item: object({
        org_id: id,
        org_name: text,
        contract_id: id,
        academic_year: integer,
        contract_version: integer,
        role: scalar("string", false, { enum: ["teacher", "org_admin", "viewer"] }),
        contract_status: scalar("string", false, { enum: ["active"] }),
        contract_expires_at: text,
        contracted_student_count: integer,
        used_student_count: integer,
        remaining_student_count: integer,
      }),
      member_item: object({
        member_id: id,
        subject_id: id,
        role: scalar("string", false, { enum: ["teacher", "org_admin", "viewer"] }),
        status: scalar("string", false, { enum: ["active", "inactive"] }),
        version: integer,
      }),
      pro_session: object({
        organizations: array(ref("pro_organization_item")),
        org_id: ref("identifier", true),
        role: scalar("string", true, { enum: ["teacher", "org_admin", "viewer"] }),
        contract_status: scalar("string", false, { enum: ["active", "selection_required"] }),
        contract_expires_at: nullableText,
        contracted_student_count: nullableInteger,
        used_student_count: nullableInteger,
        remaining_student_count: nullableInteger,
      }),
      student: object({
        org_id: id,
        student_id: id,
        display_name: text,
        class_label: nullableText,
        class_number: nullableText,
        tags: array(text),
        memo: nullableText,
        archived: boolean,
        version: integer,
        assigned_teacher_ids: array(id),
        created_at_utc: text,
      }),
      student_page: object({
        items: array(ref("pro_student")),
        next_cursor: nullableText,
        has_more: boolean,
      }),
      member_page: object({
        org_id: id,
        items: array(ref("pro_member_item")),
        next_cursor: nullableText,
        has_more: boolean,
      }),
      assignment: object({
        org_id: id,
        student_id: id,
        assigned_teacher_ids: array(id),
        version: integer,
      }),
      student_score_status: object({
        org_id: id,
        student_id: id,
        exam_id: id,
        pack_version: id,
        stage: scalar("string", false, { enum: ["mock", "provisional", "final"] }),
        initial_used: integer,
        initial_remaining: integer,
        correction_granted: integer,
        correction_used: integer,
        entry_version: integer,
        current_profile_id: ref("identifier", true),
        current_report_id: ref("identifier", true),
        last_rejection_code: ref("safe_code", true),
      }),
      student_profile: object({ org_id: id, student_id: id, profile: ref("profile") }),
      student_overall: object({ org_id: id, student_id: id, report: ref("report_paid") }),
      student_university_result: object({
        org_id: id,
        student_id: id,
        assessment: ref("assessment"),
      }),
      student_candidates: object({ org_id: id, student_id: id, candidates: ref("candidates") }),
      student_bookmarks: object({ org_id: id, student_id: id, shortlist: map(ref("shortlist")) }),
      reason_value: object({
        name: ref("safe_code"),
        value: ref("decimal_or_integer"),
        unit: text,
      }),
      comparison_context: object({
        academic_year: integer,
        reference_year: nullableInteger,
        metric: ref("safe_code"),
        score_scale: ref("safe_code"),
        population_id: id,
      }),
      public_basis: object({
        title: text,
        url: scalar("string", false, { pattern: "https://[^\\s]+" }),
        source_year: nullableInteger,
      }),
      reason: object({
        code: scalar("string", false, { enum: TIP_CODES }),
        status: scalar("string", false, { enum: ["ready"] }),
        academic_year: integer,
        comparison_context: ref("pro_comparison_context"),
        values: array(ref("pro_reason_value")),
        public_basis: array(ref("pro_public_basis")),
        missing_reason: scalar("string", true),
      }),
      student_report: object({
        org_id: id,
        student_id: id,
        report_id: id,
        revision_id: integer,
        exam_id: id,
        stage: scalar("string", false, { enum: ["mock", "provisional", "final"] }),
        profile_id: id,
        published_result: ref("report_paid"),
        counseling_reasons: array(ref("pro_reason")),
        created_at_utc: text,
      }),
      student_report_page: object({
        org_id: id,
        student_id: id,
        items: array(ref("pro_student_report")),
        next_cursor: nullableText,
        has_more: boolean,
      }),
      watermark: object({
        organization_name: text,
        teacher_code: id,
        printed_at_seoul: text,
        student_name: text,
      }),
      student_print_projection: object({
        org_id: id,
        student_id: id,
        snapshot: ref("snapshot_paid"),
        watermark: ref("pro_watermark"),
      }),
      retention_fingerprints: object({
        students: array(
          object({ student_id: id, version: integer, preservation_ciphertext_md5: text }),
        ),
        profiles: array(object({ student_id: id, profile_id: id, sha256: text })),
        revisions: array(
          object({ student_id: id, report_id: id, revision: integer, sha256: text }),
        ),
      }),
      retention_manifest: object({
        org_id: id,
        contract_id: id,
        academic_year: integer,
        official_deadline_reference: text,
        cutoff_at_utc: text,
        manifest_sha256: text,
        counts: object({ students: integer, profiles: integer, report_revisions: integer }),
        expected_previous_fingerprints: ref("pro_retention_fingerprints"),
        approval_required: scalar("boolean", false, { enum: [true] }),
      }),
      retention_notice_targets: object({
        org_id: id,
        contract_id: id,
        due_at_utc: text,
        notice_days_before: scalar("integer", false, { enum: [14, 3] }),
        authorized_member_ids: array(id),
        counts: object({ students: integer }),
      }),
    };
    for (const [name, definition] of Object.entries(definitions)) {
      schemas["pro_" + name] = definition;
      const fields = contract.DTOs[name];
      if (
        Array.isArray(fields) &&
        (fields.length !== Object.keys(definition.properties as Schema).length ||
          fields.some((k) => !Object.hasOwn(definition.properties as Schema, k)))
      ) unavailable();
    }
    const operations: unknown[] = [], expected: { id: string; contract_ref: string }[] = [];
    for (const route of contract.routes) {
      if (this.routes.has(route.id) || !definitions[route.response_schema]) unavailable();
      this.routes.set(route.id, route);
      const name = "pro_envelope_" + route.id.replaceAll(".", "_"),
        contractRef = "professional_service_contract.DTOs." + route.response_schema;
      schemas[name] = object({
        format: scalar("string", false, { enum: ["jungsi.professional-response/v1"] }),
        status: scalar("string", false, { enum: ["ready", "pending"] }),
        org_id: ref("identifier", true),
        student_id: ref("identifier", true),
        data: ref("pro_" + route.response_schema),
        reason_codes: array(ref("pro_reason_code")),
        request_id: scalar("string", false, { pattern: "[a-f0-9]{32}" }),
      });
      operations.push({
        id: route.id,
        contract_ref: contractRef,
        roots: { standard: ref(name), paid: ref(name) },
      });
      expected.push({ id: route.id, contract_ref: contractRef });
    }
    this.projection = new PublicResponseProjection({
      format: "jungsi.public-response-schemas/v1",
      schemas,
      operations,
      auxiliary_roots: original.auxiliary_roots,
    }, expected);
  }
  private scope(value: unknown, orgId: string | null, studentId: string | null): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const row = value as Record<string, unknown>;
    if (
      Object.hasOwn(row, "org_id") && row.org_id !== orgId ||
      Object.hasOwn(row, "student_id") && row.student_id !== studentId
    ) unavailable();
  }
  private cleanReasons(value: unknown): NativeObject[] {
    if (!Array.isArray(value)) unavailable();
    const result: NativeObject[] = [];
    for (const raw of value) {
      const r = proObject(raw);
      if (
        r.status !== "ready" || !Array.isArray(r.values) || !r.values.length ||
        !Array.isArray(r.public_basis) || !r.public_basis.length
      ) continue;
      for (const rawBasis of r.public_basis) {
        const basis = proObject(rawBasis);
        try {
          if (typeof basis.url !== "string") unavailable();
          const u = new URL(basis.url);
          if (
            u.protocol !== "https:" || u.username || u.password ||
            /(?:^|\.)(?:supabase\.co|googleusercontent\.com)$/.test(u.hostname) ||
            u.hostname === "drive.google.com"
          ) unavailable();
        } catch {
          unavailable();
        }
      }
      result.push(r);
    }
    return result;
  }
  project(operation: string, response: ProfessionalResponse, requestId: string): NativeObject {
    const route = this.routes.get(operation);
    if (!route) unavailable();
    const data = cloneNativeJson(proObject(response.data));
    if (operation !== "pro.session") this.scope(data, response.orgId, response.studentId);
    if (route.response_schema === "student_page" && Array.isArray(data.items)) {
      for (const row of data.items) {
        this.scope(row, response.orgId, proObject(row).student_id as string);
      }
    }
    if (route.response_schema === "student_report_page" && Array.isArray(data.items)) {
      for (const row of data.items) this.scope(row, response.orgId, response.studentId);
    }
    if (route.response_schema === "student_report") {
      data.counseling_reasons = this.cleanReasons(data.counseling_reasons);
    }
    if (route.response_schema === "student_report_page" && Array.isArray(data.items)) {
      for (const row of data.items) {
        const item = proObject(row);
        item.counseling_reasons = this.cleanReasons(item.counseling_reasons);
      }
    }
    const projected = proObject(
      this.projection.project(operation, "standard", {
        format: "jungsi.professional-response/v1",
        status: "ready",
        org_id: response.orgId,
        student_id: response.studentId,
        data,
        reason_codes: [...response.reasons],
        request_id: requestId,
      }),
    );
    const reasons = new Set<string>(response.reasons);
    if (
      [
        "student_overall",
        "student_university_result",
        "student_candidates",
        "student_report",
        "student_report_page",
        "student_print_projection",
      ].includes(route.response_schema)
    ) reasons.add("counseling_basis_not_connected");
    const pending = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(pending);
        return;
      }
      if (!value || typeof value !== "object") return;
      const row = value as Record<string, unknown>;
      if (
        row.status === "pending" && typeof row.reason_code === "string" &&
        /^[a-z][a-z0-9_]{0,63}$/.test(row.reason_code)
      ) reasons.add(row.reason_code);
      Object.values(row).forEach(pending);
    };
    pending(projected.data);
    projected.status = reasons.size ? "pending" : "ready";
    projected.reason_codes = [...reasons];
    return proObject(this.projection.project(operation, "standard", projected));
  }
}
