import { syncPromise } from "./fixture.ts";
/** Invented rule/pack release only. Approval flags exercise guards, never authorize a publication. */
import type {
  UniversityConversionRelease,
  UniversityScoringDataPort,
} from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { NativeConversionRelease } from "../../supabase/functions/_shared/jungsi/domain/conversion_release.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import {
  cloneNativeJson,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { syntheticNativePackData } from "./synthetic_exam_pack.ts";
export class SyntheticUniversityData implements UniversityScoringDataPort {
  readonly productionAllowed = false;
  calls: string[] = [];
  pack: NativeExamPack | null;
  rawPack: NativeObject;
  offering: NativeObject = {
    offering_id: "SYNTHETIC-A-2027",
    academic_year: 2027,
    university_id: "SYNTHETIC-A",
    campus: "가상캠퍼스",
    department: "가상분석",
    track: "가상일반",
    group: "가",
  };
  rawRule: NativeObject;
  bundle: UniversityConversionRelease | null;
  constructor() {
    const raw = syntheticNativePackData() as NativeObject;
    Object.assign(raw.exam as NativeObject, {
      exam_id: "SYNTHETIC-current-csat",
      exam_type: "csat",
    });
    this.rawPack = cloneNativeJson(raw);
    this.pack = new NativeExamPack(raw);
    const fields = [
      "korean_standard_score",
      "math_standard_score",
      "inquiry1_standard_score",
      "inquiry2_standard_score",
    ];
    this.rawRule = {
      format: "jungsi.university-rule/v1",
      academic_year: 2027,
      rule_id: "SYNTHETIC-A",
      rule_version: "SYNTHETIC-A-2027",
      review_status: "calculation_verified",
      data_kind: "official_rule",
      score_scope: "csat_component",
      source_refs: ["SYNTHETIC-CONTROL-FLOW-ONLY"],
      inputs: Object.fromEntries(
        fields.map(
          (f) => [f, { type: "number", min: 1, max: 9, integer: true }],
        ),
      ),
      tables: {},
      nodes: {
        total: {
          op: "sum",
          args: fields.map((field) => ({ op: "input", field })),
        },
      },
      output_node: "total",
      display_places: 2,
      official_max_score: 36,
      non_csat_components: [],
    };
    this.bundle = this.release();
  }
  release(rule = this.rawRule): UniversityConversionRelease {
    const raw = cloneNativeJson(rule), pack = this.pack!;
    Object.assign(raw, {
      exam_id: pack.examId,
      source_pack_version: pack.packVersion,
    });
    const binding = {
      ...cloneNativeJson(this.offering),
      offering_pk: this.offering.offering_id,
      rule_version: raw.rule_version,
    };
    return {
      version: "SYNTHETIC-release.v1",
      status: "approved",
      academicYear: 2027,
      examId: pack.examId,
      sourcePackVersion: pack.packVersion,
      examType: "csat",
      release: new NativeConversionRelease("SYNTHETIC-release.v1", [raw], [
        binding,
      ]),
      bindings: [binding],
      mockCompatibility: null,
    };
  }
  scores(): NativeObject {
    return {
      exam_id: this.pack!.examId,
      pack_version: this.pack!.packVersion,
      korean: { standard_score: 9, choice: "가상국어선택" },
      math: { standard_score: 8, choice: "가상수학선택" },
      inquiry: [{ subject: "가상탐구가", standard_score: 7 }, {
        subject: "가상탐구나",
        standard_score: 6,
      }],
      english_grade: 3,
      korean_history_grade: 2,
    };
  }
  profile() {
    return { profile_id: "SYNTHETIC-profile", scores: this.scores() };
  }
  getExamPack(_id: string) {
    return syncPromise(() => {
      this.calls.push("pack");
      return this.pack;
    });
  }
  getConversion(id: string) {
    return syncPromise(() => {
      this.calls.push("conversion");
      return id === this.offering.offering_id ? this.bundle : null;
    });
  }
}
