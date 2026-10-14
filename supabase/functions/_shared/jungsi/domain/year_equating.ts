/** Exact cross-year rank alignment. No same-percentile subject synthesis or eligibility promotion. */
import { ContractError, displayExact, exact, Rational, requireContract as check } from "./exact.ts";
import { OVERALL_POPULATION_ID } from "./exam_pack.ts";
import { cloneNativeJson, type NativeObject } from "./json_value.ts";
import { canonicalIntegerKeys, JsonFloat, type NativeJson } from "./native_json.ts";
import { pythonTrim } from "./text.ts";
import { universityNumber } from "./university_distribution.ts";
export const EQUATING_AREAS = ["korean", "math", "inquiry1", "inquiry2"] as const;
export const EQUATING_YEARS = [2024, 2025, 2026, 2027] as const;
function record(v: unknown, code = "INVALID_METADATA"): NativeObject {
  check(
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat),
    code,
  );
  return v as NativeObject;
}
function freeze<T extends NativeJson>(v: T): T {
  if (v !== null && typeof v === "object") {
    if (Array.isArray(v)) v.forEach(freeze);
    else if (!(v instanceof JsonFloat)) Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function absolute(v: Rational): Rational {
  return v.compare(exact(0)) < 0 ? exact(0).subtract(v) : v;
}
function ratio(v: Rational): NativeObject {
  return { numerator: v.numerator, denominator: v.denominator };
}
function truthy(v: NativeJson | undefined): boolean {
  return v !== null && v !== undefined && v !== false && v !== "" && v !== 0 && v !== 0n &&
    (!(v instanceof JsonFloat) || universityNumber(v).numerator !== 0n) &&
    (!Array.isArray(v) || v.length > 0) &&
    (typeof v !== "object" || Array.isArray(v) || v instanceof JsonFloat ||
      Object.keys(v).length > 0);
}
export class TailRank {
  constructor(readonly exclusive: Rational, readonly inclusive: Rational) {
    Object.freeze(this);
  }
  get midpoint(): Rational {
    return this.exclusive.add(this.inclusive).divide(exact(2));
  }
  overlaps(b: TailRank): boolean {
    const lo = this.exclusive.compare(b.exclusive) > 0 ? this.exclusive : b.exclusive,
      hi = this.inclusive.compare(b.inclusive) < 0 ? this.inclusive : b.inclusive;
    return lo.compare(hi) < 0;
  }
  dto(): NativeObject {
    return {
      top_percent_exclusive: displayExact(this.exclusive.multiply(exact(100))),
      top_percent_inclusive: displayExact(this.inclusive.multiply(exact(100))),
      top_percent_midpoint: displayExact(this.midpoint.multiply(exact(100))),
      meaning: "동점자 위치 구간이며 예측 신뢰구간이 아님",
    };
  }
}
export class NativeRankDistribution {
  readonly data: Readonly<NativeObject>;
  readonly scores: readonly number[];
  readonly total: Rational;
  private readonly ranks: ReadonlyMap<number, TailRank>;
  private readonly reported: ReadonlyMap<number, NativeObject>;
  constructor(value: unknown) {
    try {
      const d = cloneNativeJson(record(value));
      for (const key of ["exam_id", "subject_id", "version", "population_id"]) {
        check(
          typeof d[key] === "string" && pythonTrim(d[key] as string) !== "",
          "INVALID_METADATA",
        );
      }
      check(
        typeof d.academic_year === "number" && Number.isSafeInteger(d.academic_year) &&
          EQUATING_YEARS.includes(d.academic_year as 2024),
        "INVALID_YEAR",
      );
      check(
        ["observed_counts", "estimated_weights", "synthetic"].includes(d.kind as string),
        "INVALID_KIND",
      );
      check(
        ["source_verified", "validated", "research_only"].includes(d.status as string),
        "INVALID_STATUS",
      );
      check(
        Array.isArray(d.source_refs) && d.source_refs.length > 0 &&
          d.source_refs.every((v) => typeof v === "string" && v !== ""),
        "SOURCE_REQUIRED",
      );
      const counts = canonicalIntegerKeys(d.counts);
      check(counts.size > 0, "EMPTY_DISTRIBUTION");
      const values = new Map<number, Rational>();
      for (const [raw, native] of counts) {
        check(raw >= 0n && raw <= BigInt(Number.MAX_SAFE_INTEGER), "INVALID_SCORE");
        const n = universityNumber(native);
        check(n.compare(exact(0)) > 0, "INVALID_COUNT");
        check(d.kind !== "observed_counts" || n.denominator === 1n, "FRACTIONAL_COUNT");
        values.set(Number(raw), n);
      }
      this.total = [...values.values()].reduce((a, b) => a.add(b), exact(0));
      check(this.total.compare(universityNumber(d.expected_total)) === 0, "COUNT_MISMATCH");
      this.scores = Object.freeze([...values.keys()].sort((a, b) => a - b));
      const ranks = new Map<number, TailRank>();
      let above = exact(0);
      for (const score of [...this.scores].reverse()) {
        const n = values.get(score)!;
        ranks.set(score, new TailRank(above.divide(this.total), above.add(n).divide(this.total)));
        above = above.add(n);
      }
      this.ranks = ranks;
      const reported = new Map<number, NativeObject>();
      if (d.reported_scores !== null && d.reported_scores !== undefined) {
        for (const [raw, value] of canonicalIntegerKeys(d.reported_scores)) {
          check(
            raw <= BigInt(Number.MAX_SAFE_INTEGER) && values.has(Number(raw)),
            "INVALID_REPORTED_SCORE",
          );
          const row = record(value, "INVALID_REPORTED_SCORE"), clean: NativeObject = {};
          for (const [key, lo, hi] of [["percentile", 0, 100], ["grade", 1, 9]] as const) {
            if (Object.hasOwn(row, key)) {
              const v = row[key];
              check(
                typeof v === "number" && Number.isSafeInteger(v) && v >= lo && v <= hi,
                "INVALID_REPORTED_SCORE",
              );
              clean[key] = v;
            }
          }
          check(truthy(row.source_ref), "SOURCE_REQUIRED");
          clean.source_ref = row.source_ref;
          reported.set(Number(raw), freeze(clean));
        }
      }
      this.reported = reported;
      this.data = freeze(d);
      Object.freeze(this);
    } catch (e) {
      if (e instanceof ContractError) throw e;
      throw new ContractError("INVALID_DISTRIBUTION");
    }
  }
  get examId(): string {
    return this.data.exam_id as string;
  }
  get academicYear(): number {
    return this.data.academic_year as number;
  }
  get subjectId(): string {
    return this.data.subject_id as string;
  }
  get version(): string {
    return this.data.version as string;
  }
  get populationId(): string {
    return this.data.population_id as string;
  }
  get kind(): string {
    return this.data.kind as string;
  }
  get status(): string {
    return this.data.status as string;
  }
  rank(score: unknown): TailRank {
    check(
      typeof score === "number" && Number.isSafeInteger(score) && this.ranks.has(score),
      "SCORE_NOT_IN_DISTRIBUTION",
    );
    return this.ranks.get(score)!;
  }
  inverse(rank: TailRank): NativeObject {
    check(
      rank instanceof TailRank && rank.exclusive.compare(exact(0)) >= 0 &&
        rank.exclusive.compare(rank.inclusive) < 0 && rank.inclusive.compare(exact(1)) <= 0,
      "INVALID_RANK",
    );
    const candidates = this.scores.filter((s) => this.rank(s).overlaps(rank));
    check(candidates.length > 0, "RANK_UNSUPPORTED");
    let center = candidates[0], cost = absolute(this.rank(center).midpoint.subtract(rank.midpoint));
    for (const s of candidates.slice(1)) {
      const n = absolute(this.rank(s).midpoint.subtract(rank.midpoint));
      if (n.compare(cost) < 0) {
        center = s;
        cost = n;
      }
    }
    return {
      score: center,
      candidate_scores: [...candidates],
      score_min: candidates[0],
      score_max: candidates.at(-1)!,
      target_rank: this.rank(center).dto(),
    };
  }
  reportedScore(score: number): NativeObject | null {
    const r = this.reported.get(score);
    return r ? cloneNativeJson(r) : null;
  }
  provenance(): NativeObject {
    return {
      exam_id: this.examId,
      academic_year: this.academicYear,
      subject_id: this.subjectId,
      version: this.version,
      population_id: this.populationId,
      kind: this.kind,
      status: this.status,
      source_refs: cloneNativeJson(this.data.source_refs),
    };
  }
}
export class NativeBridgePolicy {
  readonly version: string;
  readonly status: string;
  readonly validationRef: NativeJson;
  readonly maxSubjectRankShift: Rational;
  readonly absoluteGradePolicy: string;
  constructor(value: unknown) {
    const d = record(value, "INVALID_POLICY");
    check(typeof d.version === "string" && d.version !== "", "INVALID_POLICY");
    this.version = d.version;
    const status = Object.hasOwn(d, "status") ? d.status : "research_only",
      validation = Object.hasOwn(d, "validation_ref") ? d.validation_ref : null,
      shift = Object.hasOwn(d, "max_subject_rank_shift") ? d.max_subject_rank_shift : "0.01",
      grade = Object.hasOwn(d, "absolute_grade_policy")
        ? d.absolute_grade_policy
        : "hold_observed_grade";
    check(status === "research_only" || status === "validated", "INVALID_POLICY");
    check(status !== "validated" || truthy(validation), "VALIDATION_REQUIRED");
    const max = universityNumber(shift);
    check(max.compare(exact(0)) >= 0 && max.compare(exact(1)) <= 0, "INVALID_POLICY");
    check(grade === "hold_observed_grade", "UNSUPPORTED_POLICY");
    this.status = status;
    this.validationRef = freeze(cloneNativeJson(validation));
    this.maxSubjectRankShift = max;
    this.absoluteGradePolicy = grade;
    Object.freeze(this);
  }
}
export type RankBundle = Readonly<Record<typeof EQUATING_AREAS[number], NativeRankDistribution>>;
function checkedBundle(raw: unknown): RankBundle {
  check(
    raw !== null && typeof raw === "object" && !Array.isArray(raw) &&
      Object.keys(raw).sort().join(",") === [...EQUATING_AREAS].sort().join(","),
    "FOUR_SUBJECTS_REQUIRED",
  );
  const b = raw as RankBundle;
  check(Object.values(b).every((d) => d instanceof NativeRankDistribution), "INVALID_DISTRIBUTION");
  check(
    new Set(Object.values(b).map((d) => d.examId + "\0" + String(d.academicYear))).size === 1,
    "MIXED_EXAMS",
  );
  check(b.korean.subjectId === "국어" && b.math.subjectId === "수학", "SUBJECT_MISMATCH");
  check(b.inquiry1.subjectId !== b.inquiry2.subjectId, "DUPLICATE_INQUIRY");
  return b;
}
function scoresBefore(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
function fitToTotal(
  source: Readonly<Record<string, TailRank>>,
  target: RankBundle,
  allowed: readonly number[],
  maxShift: Rational,
): { scores: NativeObject; total: number; cost: Rational } | null {
  type State = { cost: Rational; scores: readonly number[] };
  let states = new Map<number, State>([[0, { cost: exact(0), scores: [] }]]);
  const max = allowed.reduce((a, b) => Math.max(a, b), 0);
  for (const area of EQUATING_AREAS) {
    const rank = source[area],
      candidates = target[area].scores.map((score) => ({
        score,
        cost: absolute(target[area].rank(score).midpoint.subtract(rank.midpoint)),
      }))
        .filter((c) => target[area].rank(c.score).overlaps(rank) || c.cost.compare(maxShift) <= 0);
    const next = new Map<number, State>();
    for (const [subtotal, state] of states) {
      for (const c of candidates) {
        const sum = subtotal + c.score;
        check(Number.isSafeInteger(sum), "INVALID_SCORE");
        if (sum > max) continue;
        const candidate = { cost: state.cost.add(c.cost), scores: [...state.scores, c.score] },
          old = next.get(sum);
        if (
          !old || candidate.cost.compare(old.cost) < 0 ||
          candidate.cost.compare(old.cost) === 0 && scoresBefore(candidate.scores, old.scores)
        ) next.set(sum, candidate);
      }
    }
    states = next;
  }
  let best: State | null = null, total = 0;
  for (const t of allowed) {
    const s = states.get(t);
    if (
      s &&
      (!best || s.cost.compare(best.cost) < 0 ||
        s.cost.compare(best.cost) === 0 && scoresBefore(s.scores, best.scores))
    ) {
      best = s;
      total = t;
    }
  }
  return best
    ? {
      scores: Object.fromEntries(EQUATING_AREAS.map((a, i) => [a, best!.scores[i]])),
      total,
      cost: best.cost,
    }
    : null;
}
export function estimateYear(
  scores: NativeObject,
  sourceRaw: RankBundle,
  targetRaw: RankBundle,
  policy: NativeBridgePolicy,
  sourceTotal: NativeRankDistribution | null = null,
  targetTotal: NativeRankDistribution | null = null,
): NativeObject {
  const source = checkedBundle(sourceRaw), target = checkedBundle(targetRaw);
  check(policy instanceof NativeBridgePolicy, "INVALID_POLICY");
  check(
    Object.keys(scores).sort().join(",") === [...EQUATING_AREAS].sort().join(","),
    "FOUR_SUBJECTS_REQUIRED",
  );
  check(
    EQUATING_AREAS.every((a) => source[a].subjectId === target[a].subjectId),
    "SUBJECT_MISMATCH",
  );
  const ranks = Object.fromEntries(
    EQUATING_AREAS.map((a) => [a, source[a].rank(scores[a])]),
  ) as Record<string, TailRank>;
  const projected = Object.fromEntries(EQUATING_AREAS.map((a) => [a, target[a].inverse(ranks[a])]));
  const out: NativeObject = {
    academic_year: target.korean.academicYear,
    source_exam_id: source.korean.examId,
    target_exam_id: target.korean.examId,
    bridge_version: policy.version,
    score_basis: "year_equated_estimate",
    status: "calibration_required",
    public_eligible: false,
    subject_projection: Object.fromEntries(
      EQUATING_AREAS.map(
        (a) => [a, {
          ...projected[a],
          source_rank: ranks[a].dto(),
          source_version: source[a].version,
          target_version: target[a].version,
        }],
      ),
    ),
    estimated_standard_scores: null,
    total_standard_score: null,
    reason_codes: [],
    absolute_grade_policy: policy.absoluteGradePolicy,
    meaning: "연도별 상대 위치 대응 추정. 해당 연도 실제 응시 성적 또는 합격 판정이 아님.",
  };
  const reasons = out.reason_codes as NativeJson[];
  if (sourceTotal === null || targetTotal === null) {
    reasons.push("TOTAL_CURVE_REQUIRED");
    return out;
  }
  for (const [bundle, total] of [[source, sourceTotal], [target, targetTotal]] as const) {
    check(total instanceof NativeRankDistribution && total.subjectId === "total", "INVALID_TOTAL");
    check(
      total.examId === bundle.korean.examId && total.academicYear === bundle.korean.academicYear,
      "TOTAL_EXAM_MISMATCH",
    );
    check(total.populationId === OVERALL_POPULATION_ID, "TOTAL_POPULATION_MISMATCH");
  }
  const sourceScore = EQUATING_AREAS.reduce((n, a) => n + (scores[a] as number), 0);
  check(Number.isSafeInteger(sourceScore), "INVALID_SCORE");
  const totalRank = sourceTotal.rank(sourceScore), match = targetTotal.inverse(totalRank);
  Object.assign(out, {
    source_total_rank: totalRank.dto(),
    target_total_window: match,
    source_total_version: sourceTotal.version,
    target_total_version: targetTotal.version,
  });
  const fit = fitToTotal(
    ranks,
    target,
    match.candidate_scores as number[],
    policy.maxSubjectRankShift,
  );
  if (!fit) {
    out.status = "profile_alignment_required";
    reasons.push("NO_PROFILE_WITHIN_RANK_LIMIT");
    return out;
  }
  Object.assign(out, {
    estimated_standard_scores: fit.scores,
    total_standard_score: fit.total,
    rank_fit_error: ratio(fit.cost),
    target_total_rank: targetTotal.rank(fit.total).dto(),
    estimated_reported_scores: Object.fromEntries(
      EQUATING_AREAS.map((a) => [a, target[a].reportedScore(fit.scores[a] as number)]),
    ),
    status: "research_estimate",
  });
  const marginals = [...Object.values(source), ...Object.values(target)].every((d) =>
    d.kind !== "synthetic" &&
    (d.status === "validated" || d.kind === "observed_counts" && d.status === "source_verified")
  );
  const totals = [sourceTotal, targetTotal].every((d) =>
    d.kind !== "synthetic" && d.status === "validated"
  );
  if (policy.status === "validated" && marginals && totals) {
    out.status = "estimated";
    out.public_eligible = true;
  } else reasons.push("BRIDGE_OR_DISTRIBUTION_NOT_VALIDATED");
  reasons.push("ABSOLUTE_GRADES_HELD_CONSTANT");
  return out;
}
export function prepareEquatedProfile(
  profileVersion: string,
  result: Readonly<NativeObject>,
  englishGrade: NativeJson,
  koreanHistoryGrade: NativeJson,
  choices: Readonly<NativeObject> = {},
): NativeObject {
  check(
    ["estimated", "research_estimate"].includes(result.status as string),
    "YEAR_BRIDGE_REQUIRED",
  );
  check(result.public_eligible === true, "YEAR_BRIDGE_NOT_VALIDATED");
  check(result.absolute_grade_policy === "hold_observed_grade", "UNSUPPORTED_GRADE_BRIDGE");
  const scores = record(result.estimated_standard_scores, "INVALID_BRIDGE_RESULT"),
    reported = result.estimated_reported_scores == null
      ? {}
      : record(result.estimated_reported_scores, "INVALID_BRIDGE_RESULT");
  check(
    Object.keys(scores).sort().join(",") === [...EQUATING_AREAS].sort().join(","),
    "INVALID_BRIDGE_RESULT",
  );
  const values: NativeObject = {};
  for (const a of EQUATING_AREAS) {
    values[a + "_standard_score"] = scores[a];
    const row = reported[a] == null ? {} : record(reported[a], "INVALID_BRIDGE_RESULT");
    for (const f of ["percentile", "grade"]) values[a + "_" + f] = row[f] ?? null;
  }
  for (
    const [field, value] of [["english_grade", englishGrade], [
      "korean_history_grade",
      koreanHistoryGrade,
    ]] as const
  ) {
    if (value !== null) {
      check(
        typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 9,
        "INVALID_GRADE",
      );
    }
    values[field] = value;
  }
  for (const [field, value] of Object.entries(choices)) {
    check(
      ["korean_choice", "math_choice", "inquiry1_subject", "inquiry2_subject"].includes(field),
      "INVALID_CHOICE_FIELD",
    );
    values[field] = value;
  }
  return {
    academic_year: result.academic_year,
    exam_id: result.target_exam_id,
    profile_version: profileVersion,
    score_basis: "year_equated_estimate",
    source_exam_id: result.source_exam_id,
    bridge_version: result.bridge_version,
    bridge_validated: result.public_eligible === true,
    values,
  };
}
