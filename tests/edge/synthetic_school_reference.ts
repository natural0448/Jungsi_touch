/** Invented fixtures only. No real university rule, coefficient, score or approval. */
import { SyntheticUniversityData } from "./synthetic_university.ts";
import {
  cloneNativeJson,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type { SchoolScoreInputs } from "../../supabase/functions/_shared/jungsi/application/school_score_inputs.ts";
import type {
  SchoolReferenceBytesPort,
  SchoolReferenceSelection,
} from "../../supabase/functions/_shared/jungsi/infrastructure/school_reference_source.ts";
export class SyntheticReferenceBytes implements SchoolReferenceBytesPort {
  readonly university = new SyntheticUniversityData();
  body: NativeObject;
  raw = new Uint8Array();
  pin!: SchoolReferenceSelection;
  reads = 0;
  checks = 0;
  selected = true;
  changed = false;
  constructor() {
    const f = this.university, rule = cloneNativeJson(f.rawRule);
    Object.assign(rule, {
      review_status: "source_verified",
      engine_approved: false,
      production_allowed: false,
      score_axis: "native_csat_points",
      score_scale_id: "SYNTHETIC-native.v1",
      inputs: { inquiry_best_percentile: { type: "number", min: 0, max: 100, integer: true } },
      nodes: { total: { op: "input", field: "inquiry_best_percentile" } },
    });
    const b: NativeObject = {
      ...cloneNativeJson(f.offering),
      offering_pk: f.offering.offering_id,
      rule_version: rule.rule_version,
    };
    delete b.offering_id;
    this.body = {
      format: "jungsi.school-reference-conversion/v1",
      version: "SYNTHETIC-reference.v1",
      academic_year: 2027,
      exam_id: f.pack!.examId,
      source_pack_version: f.pack!.packVersion,
      exam_type: "csat",
      score_scale_id: "SYNTHETIC-native.v1",
      review: {
        source_sha256: "a".repeat(64),
        independent_sha256: "b".repeat(64),
        scope: "same_exam_mathematical_reference",
        production_allowed: false,
        applicant_eligibility_approved: false,
      },
      domain: {
        required_fields: ["korean_history_grade"],
        inquiry_categories: ["social", "science", "vocational"],
        minimum_inquiry: 1,
        positive_score_required: false,
        derivations: [{
          field: "inquiry_best_percentile",
          operation: "observed_max",
          inputs: ["inquiry1_percentile", "inquiry2_percentile"],
          minimum_present: 1,
        }],
      },
      rule,
      bindings: [b],
    };
  }
  async seal() {
    this.raw = new TextEncoder().encode(nativeJsonText(this.body));
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", this.raw))].map((v) =>
      v.toString(16).padStart(2, "0")
    ).join("");
    this.pin = {
      key: "SYNTHETIC-rule-shared",
      sha256: sha,
      bytes: this.raw.length,
      sourceSha256: "a".repeat(64),
      independentSha256: "b".repeat(64),
    };
    return this;
  }
  select(_id: string) {
    return this.selected ? this.pin : null;
  }
  read(_key: string) {
    this.reads++;
    return Promise.resolve(Uint8Array.from(this.raw));
  }
  assertCurrent() {
    this.checks++;
    return this.changed ? Promise.reject(new Error("SYNTHETIC_HEAD_CHANGED")) : Promise.resolve();
  }
  input(patch: NativeObject = {}): SchoolScoreInputs {
    return {
      academicYear: 2027,
      examId: this.university.pack!.examId,
      packVersion: this.university.pack!.packVersion,
      examType: "csat",
      profileVersion: "SYNTHETIC-profile",
      scoreBasis: "actual_exam",
      reportedSources: {},
      inquiryCategories: ["social", "science"],
      values: {
        korean_percentile: 91,
        math_percentile: 83,
        english_grade: 3,
        korean_history_grade: 1,
        inquiry1_subject: "SYNTHETIC-q1",
        inquiry2_subject: "SYNTHETIC-q2",
        inquiry1_percentile: 31,
        inquiry2_percentile: 17,
        ...patch,
      },
    };
  }
}
