/** Invented independent subject marginals and complete totals; never a source publication. */
import {
  NativeBridgePolicy,
  NativeRankDistribution,
  type RankBundle,
} from "../../supabase/functions/_shared/jungsi/domain/year_equating.ts";
import { OVERALL_POPULATION_ID } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
export function syntheticRankRaw(
  exam = "SYNTHETIC-source",
  year = 2027,
  subject = "국어",
  total = false,
): NativeObject {
  return {
    exam_id: exam,
    academic_year: year,
    subject_id: total ? "total" : subject,
    version: "SYNTHETIC-" + String(year),
    population_id: total ? OVERALL_POPULATION_ID : "official_subject_population:" + subject,
    counts: total
      ? { "20": 3, "30": 4, "36": 2 }
      : Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), 1])),
    expected_total: 9,
    kind: "observed_counts",
    status: total ? "validated" : "source_verified",
    source_refs: ["SYNTHETIC-CONTROL-FLOW-ONLY"],
    reported_scores: total ? {} : Object.fromEntries(
      Array.from(
        { length: 9 },
        (_, i) => [String(i + 1), { grade: 9 - i, source_ref: "SYNTHETIC" }],
      ),
    ),
  };
}
export function syntheticRankBundle(exam = "SYNTHETIC-source", year = 2027): RankBundle {
  return Object.fromEntries(
    Object.entries({ korean: "국어", math: "수학", inquiry1: "가상탐구가", inquiry2: "가상탐구나" })
      .map(([a, s]) => [a, new NativeRankDistribution(syntheticRankRaw(exam, year, s))]),
  ) as unknown as RankBundle;
}
export function syntheticBridgeFixture() {
  const source = syntheticRankBundle(),
    target = syntheticRankBundle("SYNTHETIC-target", 2024),
    sourceTotal = new NativeRankDistribution(
      syntheticRankRaw("SYNTHETIC-source", 2027, "total", true),
    ),
    targetTotal = new NativeRankDistribution(
      syntheticRankRaw("SYNTHETIC-target", 2024, "total", true),
    ),
    policy = new NativeBridgePolicy({
      version: "SYNTHETIC-bridge.v1",
      status: "validated",
      validation_ref: "SYNTHETIC-validation",
      max_subject_rank_shift: "0.2",
    });
  return {
    source,
    target,
    sourceTotal,
    targetTotal,
    policy,
    scores: { korean: 9, math: 8, inquiry1: 7, inquiry2: 6 } as NativeObject,
  };
}
