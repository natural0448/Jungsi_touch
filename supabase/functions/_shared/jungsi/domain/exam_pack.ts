/** Same-exam official marginals and four-component total. No marginal-curve joining. */
import { ContractError, displayExact, exact, Rational, requireContract as check } from "./exact.ts";
import { JsonFloat, parseNativeJson } from "./native_json.ts";

export const OVERALL_METRIC_ID = "korean_math_inquiry2_standard_sum";
export const OVERALL_POPULATION_ID = "all_examinees_with_korean_math_two_inquiry_scores";
export type ExamRow = Record<string, unknown>;
function row(value: unknown): ExamRow {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      !(value instanceof JsonFloat),
    "invalid_schema",
  );
  return value as ExamRow;
}
function list(value: unknown): unknown[] {
  check(Array.isArray(value), "invalid_schema");
  return value;
}
function text(value: unknown): string {
  check(typeof value === "string" && value.trim(), "invalid_text");
  return value;
}
function integer(value: unknown, minimum = 0n): bigint {
  check(
    typeof value === "bigint" || typeof value === "number" && Number.isSafeInteger(value),
    "invalid_integer",
  );
  const n = BigInt(value);
  check(n >= minimum, "invalid_integer");
  return n;
}
function score(value: unknown, code = "invalid_integer"): number {
  let n: bigint;
  try {
    n = integer(value);
  } catch {
    throw new ContractError(code);
  }
  check(n <= BigInt(Number.MAX_SAFE_INTEGER), "invalid_integer");
  return Number(n);
}
function copy(value: unknown): unknown {
  if (value instanceof JsonFloat) return new JsonFloat(value.lexeme);
  if (Array.isArray(value)) return value.map(copy);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(row(value)).map(([k, v]) => [k, copy(v)]));
  }
  return value;
}
function decimal(value: unknown): Rational {
  return exact(value instanceof JsonFloat ? value.lexeme : value);
}
function sum(values: unknown[]): bigint {
  return values.reduce<bigint>((a, b) => a + integer(b), 0n);
}
export function examSubjectKey(value: unknown): string {
  return text(value).normalize("NFKC").replace(/\s+/gu, "");
}
function emptyGrade(r: ExamRow): boolean {
  return r.empty_grade_verified === true && r.reported_count_state === "published_dash" &&
    r.count === null && r.lower_score === null && r.upper_exclusive === null &&
    r.published_percent === null &&
    (r.derived_count_from_frequency === 0 || r.derived_count_from_frequency === 0n) &&
    Number.isSafeInteger(r.grade) && (r.grade as number) > 1 && (r.grade as number) <= 9;
}
function gradeCount(r: ExamRow): bigint {
  return emptyGrade(r) ? 0n : integer(r.count);
}
function grade(s: ExamRow, value: number): number {
  for (const item of list(s.grades)) {
    const r = row(item);
    if (emptyGrade(r)) continue;
    if (r.grade === 9 || value >= score(r.lower_score)) return r.grade as number;
  }
  throw new ContractError("grade_not_found");
}
export interface NativeExamAnalysis {
  readonly exam: ExamRow;
  readonly packVersion: string;
  readonly scoreBasis: "mock_exam" | "actual_csat";
  readonly totalStandardScore: number;
  readonly subjects: readonly ExamRow[];
  readonly absoluteGrades: ExamRow;
}
export class NativeExamPack {
  private readonly data: ExamRow;
  readonly examId: string;
  readonly packVersion: string;
  readonly academicYear: number;
  constructor(raw: unknown) {
    this.data = row(copy(raw));
    const d = this.data;
    check(d.format === "jungsi.exam-pack/v1", "invalid_format");
    const exam = row(d.exam), subjects = row(d.subjects), participants = row(d.participants);
    this.examId = text(exam.exam_id);
    this.packVersion = text(d.pack_version);
    this.academicYear = score(exam.academic_year);
    check(this.academicYear >= 1, "invalid_integer");
    text(exam.label);
    check(
      ["september_mock", "june_mock", "csat"].includes(exam.exam_type as string),
      "invalid_exam_type",
    );
    check(
      ["국어", "수학", "영어", "한국사"].every((k) => Object.hasOwn(subjects, k)),
      "missing_subject",
    );
    const total = integer(participants.total, 1n), bySubject = row(participants.by_subject);
    check(
      Object.keys(subjects).length === Object.keys(bySubject).length &&
        Object.keys(subjects).every((k) => Object.hasOwn(bySubject, k)),
      "subject_coverage_mismatch",
    );
    const sources = list(d.sources).map(row),
      sourceIds = new Set(sources.map((s) => text(s.source_id)));
    check(sourceIds.size > 0 && sourceIds.size === sources.length, "invalid_sources");
    for (const source of sources) {
      check(
        typeof source.sha256 === "string" && /^[a-f0-9]{64}$/.test(source.sha256),
        "invalid_source_hash",
      );
    }
    const sourceRef = (value: unknown) =>
      check(typeof value === "string" && sourceIds.has(value.split(":")[0]), "invalid_source_ref");
    for (const [sid, rawSubject] of Object.entries(subjects)) {
      const s = row(rawSubject), denominator = integer(s.denominator, 1n);
      check(examSubjectKey(s.label) === sid, "subject_key_mismatch");
      check(
        denominator === integer(bySubject[sid]) && denominator <= total,
        "denominator_mismatch",
      );
      const grades = list(s.grades).map(row);
      check(grades.length === 9 && grades.every((r, i) => r.grade === i + 1), "invalid_grades");
      const bounds: bigint[] = [];
      for (const r of grades) {
        gradeCount(r);
        sourceRef(r.source_ref);
        if (emptyGrade(r)) {
          check(s.assessment === "standard_score", "invalid_empty_grade");
          continue;
        }
        if ((r.grade as number) < 9) bounds.push(integer(r.lower_score));
        else {check(
            r.lower_score === null && integer(r.upper_exclusive) === bounds[bounds.length - 1],
            "invalid_grade_boundary",
          );}
      }
      check(bounds.every((b, i) => i === 0 || bounds[i - 1] >= b), "invalid_grade_boundary");
      check(grades.reduce((n, r) => n + gradeCount(r), 0n) === denominator, "grade_total_mismatch");
      for (const r of grades) {
        if (!emptyGrade(r)) {
          check(
            decimal(r.published_percent).compare(
              exact(displayExact(new Rational(gradeCount(r) * 100n, denominator), 2)),
            ) === 0,
            "grade_percent_mismatch",
          );
        }
      }
      if (s.assessment === "standard_score") {
        const frequency = list(s.frequencies).map(row), gradeCounts = new Map<number, bigint>();
        check(frequency.length > 0, "empty_distribution");
        let cumulative = 0n, previous: number | null = null;
        const observed = new Set<number>();
        for (const f of frequency) {
          const point = score(f.standard_score), count = integer(f.count, 1n);
          check(previous === null || point < previous, "duplicate_or_unsorted_score");
          previous = point;
          observed.add(point);
          cumulative += count;
          check(cumulative === integer(f.cumulative_count), "cumulative_mismatch");
          check(integer(f.male_count) + integer(f.female_count) <= count, "gender_count_mismatch");
          sourceRef(f.source_ref);
          const g = grade(s, point);
          gradeCounts.set(g, (gradeCounts.get(g) ?? 0n) + count);
        }
        check(
          cumulative === denominator && cumulative === integer(s.published_total),
          "frequency_total_mismatch",
        );
        check(
          grades.every((r) => (gradeCounts.get(r.grade as number) ?? 0n) === gradeCount(r)),
          "grade_frequency_mismatch",
        );
        const reported = row(s.reported_scores ?? {});
        for (const [key, value] of Object.entries(reported)) {
          check(
            /^(?:0|[1-9][0-9]*)$/.test(key) && observed.has(Number(key)) &&
              String(Number(key)) === key,
            "invalid_reported_mapping",
          );
          const mapped = row(value), keys = Object.keys(mapped);
          check(
            keys.length > 1 && Object.hasOwn(mapped, "source_ref") &&
              keys.every((k) => ["percentile", "grade", "source_ref"].includes(k)),
            "invalid_reported_mapping",
          );
          sourceRef(mapped.source_ref);
          for (const [field, lo, hi] of [["percentile", 0, 100], ["grade", 1, 9]] as const) {
            if (Object.hasOwn(mapped, field)) {
              const n = score(mapped[field], "invalid_reported_mapping");
              check(n >= lo && n <= hi, "invalid_reported_mapping");
            }
          }
          if (Object.hasOwn(mapped, "grade")) {
            check(mapped.grade === grade(s, Number(key)), "reported_grade_conflict");
          }
        }
      } else {check(
          s.assessment === "absolute_grade" && !Object.hasOwn(s, "frequencies"),
          "invalid_assessment",
        );}
    }
    const choices = row(participants.choice_counts);
    for (const sid of ["국어", "수학"]) {
      check(
        sum(Object.values(row(choices[sid]))) === integer(row(subjects[sid]).denominator),
        "choice_total_mismatch",
      );
    }
    const groups = row(participants.inquiry_groups),
      groupNames = ["social_only", "science_only", "mixed_social_science", "vocational"];
    check(
      Object.keys(groups).length === 4 && groupNames.every((k) => Object.hasOwn(groups, k)),
      "inquiry_groups_mismatch",
    );
    check(
      sum(Object.values(groups)) === integer(participants.inquiry_total),
      "inquiry_total_mismatch",
    );
    const unique = sum(groupNames.slice(0, 3).map((k) => groups[k]));
    const subjectValues = Object.values(subjects).map(row);
    const twoSocial = sum(
      subjectValues.filter((s) => ["social", "science"].includes(s.category as string)).map((s) =>
        s.denominator
      ),
    ) - unique;
    const vocational = integer(groups.vocational),
      twoVocational = sum(
        subjectValues.filter((s) => s.category === "vocational").map((s) => s.denominator),
      ) - vocational;
    const derived = row(participants.two_inquiry_derived);
    check(
      twoSocial >= 0n && twoSocial <= unique && twoVocational >= 0n &&
        twoVocational <= vocational && integer(derived.social_science) === twoSocial &&
        integer(derived.vocational) === twoVocational &&
        integer(derived.total) === twoSocial + twoVocational,
      "two_inquiry_count_mismatch",
    );
    const target = row(participants.target_population),
      k = integer(row(subjects["국어"]).denominator),
      m = integer(row(subjects["수학"]).denominator);
    check(target.population_id === OVERALL_POPULATION_ID, "population_mismatch");
    const computedLower = k + m + integer(derived.total) - 2n * total;
    const lower = computedLower > 0n ? computedLower : 0n,
      upper = [k, m, integer(derived.total)].reduce((a, b) => a < b ? a : b);
    check(
      integer(target.count_lower_bound) === lower && integer(target.count_upper_bound) === upper,
      "population_bounds_mismatch",
    );
    check(lower <= upper && upper <= total, "invalid_population_bounds");
    if (target.count !== null) {
      const count = integer(target.count, 1n);
      check(count >= lower && count <= upper, "invalid_population_count");
    }
  }
  static fromJson(text: string): NativeExamPack {
    return new NativeExamPack(parseNativeJson(text));
  }
  populationBounds(): { lower: bigint; upper: bigint; count: bigint | null } {
    const target = row(row(this.data.participants).target_population);
    return {
      lower: integer(target.count_lower_bound),
      upper: integer(target.count_upper_bound),
      count: target.count === null ? null : integer(target.count),
    };
  }
  officialParticipantTotal(): bigint {
    return integer(row(this.data.participants).total, 1n);
  }
  subjectResult(subject: unknown, standardScore: unknown): ExamRow {
    const rawSubject = row(this.data.subjects)[examSubjectKey(subject)];
    check(rawSubject !== undefined, "invalid_subject");
    const s = row(rawSubject);
    check(s.assessment === "standard_score", "invalid_subject");
    const point = score(standardScore),
      f = list(s.frequencies).map(row).find((r) => r.standard_score === point);
    check(f, "unobserved_standard_score");
    const n = integer(s.denominator),
      equal = integer(f.count),
      inclusive = integer(f.cumulative_count),
      above = inclusive - equal;
    return {
      subject: s.label,
      standard_score: point,
      grade: grade(s, point),
      denominator: n,
      above_count: above,
      equal_count: equal,
      top_percent_exclusive: displayExact(new Rational(above * 100n, n), 6),
      top_percent_inclusive: displayExact(new Rational(inclusive * 100n, n), 6),
      source_ref: f.source_ref,
      basis: "official_subject_population",
    };
  }
  reportedScore(subject: unknown, standardScore: unknown): ExamRow {
    const result = this.subjectResult(subject, standardScore),
      s = row(row(this.data.subjects)[examSubjectKey(subject)]);
    const mapped = row(copy(row(s.reported_scores ?? {})[String(result.standard_score)] ?? {}));
    if (!Object.hasOwn(mapped, "grade")) mapped.grade = result.grade;
    return mapped;
  }
  analyze(payload: unknown): NativeExamAnalysis {
    const p = row(payload),
      subjects = row(this.data.subjects),
      participants = row(this.data.participants);
    check(p.exam_id === this.examId, "exam_mismatch");
    const inquiry = list(p.inquiry).map(row);
    check(inquiry.length === 2, "two_inquiry_required");
    const keys = inquiry.map((r) => examSubjectKey(r.subject));
    check(new Set(keys).size === 2, "duplicate_inquiry");
    const categories = keys.map((k) => {
      check(Object.hasOwn(subjects, k), "invalid_inquiry");
      const s = row(subjects[k]);
      check(["social", "science", "vocational"].includes(s.category as string), "invalid_inquiry");
      return s.category;
    });
    check(
      !categories.includes("vocational") || categories.every((x) => x === "vocational"),
      "inquiry_domain_mismatch",
    );
    for (const [area, sid] of [["korean", "국어"], ["math", "수학"]]) {
      const choice = row(p[area]).choice;
      if (choice !== undefined && choice !== null) {
        check(
          Object.hasOwn(row(row(participants.choice_counts)[sid]), examSubjectKey(choice)),
          "invalid_choice",
        );
      }
    }
    const entered = [row(p.korean), row(p.math), ...inquiry];
    const results = [
      this.subjectResult("국어", entered[0].standard_score),
      this.subjectResult("수학", entered[1].standard_score),
      ...inquiry.map((r) => this.subjectResult(r.subject, r.standard_score)),
    ];
    for (let i = 0; i < entered.length; i++) {
      const mapped = this.reportedScore(results[i].subject, results[i].standard_score);
      for (const [field, lo, hi] of [["percentile", 0, 100], ["grade", 1, 9]] as const) {
        if (!Object.hasOwn(entered[i], field)) continue;
        const n = score(entered[i][field], "invalid_reported_" + field);
        check(n >= lo && n <= hi, "invalid_reported_" + field);
        if (Object.hasOwn(mapped, field)) {
          check(mapped[field] === entered[i][field], "reported_" + field + "_conflict");
        }
      }
    }
    const absolute: ExamRow = {};
    for (const [field, name] of [["english_grade", "영어"], ["korean_history_grade", "한국사"]]) {
      const value = p[field];
      if (value === null || value === undefined) continue;
      integer(value, 1n);
      const n = score(value);
      check(n <= 9, "invalid_grade");
      absolute[name] = n;
    }
    const total = results.reduce((n, r) => n + (r.standard_score as number), 0);
    check(Number.isSafeInteger(total), "invalid_integer");
    return {
      exam: row(copy(this.data.exam)),
      packVersion: this.packVersion,
      scoreBasis: row(this.data.exam).exam_type === "csat" ? "actual_csat" : "mock_exam",
      totalStandardScore: total,
      subjects: results,
      absoluteGrades: absolute,
    };
  }
}
