import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// 2026-11-23 0시 KST 9월 모의평가 → 수능 가채점 전환(대표님 확정). 실제 TypeScript 모듈을 그대로 실행한다.
const data = (code) => "data:text/javascript," + encodeURIComponent(code);
const classesUrl = new URL("../src/lib/api/source.ts", import.meta.url).href;
const mocks = new Map([
  ["server-only", data("export {}")],
  ["@/lib/api", data(`export {AccessDenied, ConnectionError} from ${JSON.stringify(classesUrl)};`)],
  ["@/lib/report-ref", data("export async function currentReportId(){return null};export const screenReport=(c,r)=>r;")],
  ["@/lib/connection-text", new URL("../src/lib/connection-text.ts", import.meta.url).href],
  ["./format", new URL("../src/lib/format.ts", import.meta.url).href],
  ["next/cache", data("export function revalidatePath(){}")],
]);
registerHooks({
  resolve(spec, ctx, next) {
    if (mocks.has(spec)) return next(mocks.get(spec), ctx);
    // TypeScript 원본은 같은 폴더 모듈을 확장자 없이 부른다
    if (spec.startsWith(".") && !/\.[a-z]+$/.test(spec) && ctx.parentURL?.endsWith(".ts")) return { url: new URL(spec + ".ts", ctx.parentURL).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const exam = await import("../src/lib/exam.ts");
const pr = await import("../src/lib/provisional-report.ts");
const { isProvisionalOverall } = await import("../src/lib/dto.ts");
const ops = await import("../src/lib/report-ops.ts");

function withEnv(vars, fn) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

const PROD = {
  JUNGSI_EXAM_ID: "2027-csat-provisional",
  JUNGSI_PACK_VERSION: "20261121.csat-provisional-v51.v1",
  JUNGSI_PAST_EXAM_ID: "2027-september-mock",
  JUNGSI_PAST_PACK_VERSION: "20260930.v1",
};

test("cutover instant: 2026-11-23 00:00 KST by default, start inclusive", () => {
  withEnv({ JUNGSI_CSAT_OPENS_AT: undefined }, () => {
    assert.equal(exam.csatOpensAt().toISOString(), "2026-11-22T15:00:00.000Z");
    assert.equal(exam.csatOpen(new Date("2026-11-22T14:59:59.999Z")), false); // 11-22 23:59:59 KST
    assert.equal(exam.csatOpen(new Date("2026-11-22T15:00:00.000Z")), true); // 11-23 00:00 KST
    assert.equal(exam.csatOpen(new Date("2026-12-01T00:00:00Z")), true);
  });
  // 잘못된 값이면 확정 시각으로 돌아간다(전환이 앞당겨지거나 영영 안 되지 않게)
  withEnv({ JUNGSI_CSAT_OPENS_AT: "not-a-date" }, () => assert.equal(exam.csatOpensAt().toISOString(), "2026-11-22T15:00:00.000Z"));
  withEnv({ JUNGSI_CSAT_OPENS_AT: "2026-11-20T00:00:00Z" }, () => assert.equal(exam.csatOpen(new Date("2026-11-21T00:00:00Z")), true));
});

test("current exam is September mock before the cutover and CSAT provisional after; past exam stays September", () => {
  withEnv({ ...PROD, JUNGSI_CSAT_OPENS_AT: "2999-01-01T00:00:00Z" }, () => {
    assert.equal(exam.EXAM.exam_id, "2027-september-mock");
    assert.equal(exam.EXAM.pack_version, "20260930.v1");
    assert.equal(exam.EXAM.label, "2027학년도 9월 모의평가");
  });
  withEnv({ ...PROD, JUNGSI_CSAT_OPENS_AT: "2000-01-01T00:00:00Z" }, () => {
    assert.equal(exam.EXAM.exam_id, "2027-csat-provisional");
    assert.equal(exam.EXAM.pack_version, "20261121.csat-provisional-v51.v1");
    assert.equal(exam.MOCK_EXAM.exam_id, "2027-september-mock");
    assert.equal(exam.MOCK_EXAM.pack_version, "20260930.v1");
    assert.equal(exam.examTitle("mock", 2027), "2027학년도 9월 모의평가");
    assert.equal(exam.examTitle("provisional", 2027), "2027학년도 대학수학능력시험 가채점");
  });
});

const full = { korean_choice: "언어와 매체", korean: 88, math_choice: "미적분", math: 84, inq1: "물리학Ⅰ", inq1_raw: 44, inq2: "화학Ⅰ", inq2_raw: 42, english: 91, history: 45, sl_subject: "none" };
const ex = { exam_id: "2027-csat-provisional", pack_version: "20261121.csat-provisional-v51.v1" };

test("provisional payload matches the server raw-score shape (choices required)", () => {
  const r = pr.buildProvisionalScores(full, ex);
  assert.equal(r.ok, true);
  assert.deepEqual(r.scores, {
    ...ex,
    korean: { raw_score: 88, choice: "언어와 매체" },
    math: { raw_score: 84, choice: "미적분" },
    inquiry: [{ subject: "물리학Ⅰ", raw_score: 44 }, { subject: "화학Ⅰ", raw_score: 42 }],
    english_raw: 91,
    korean_history_raw: 45,
    second_language: null,
  });
  // 서버 validateRawScoreStructure 의 허용 키 밖으로 보내지 않는다
  assert.deepEqual(Object.keys(r.scores).sort(), ["english_raw", "exam_id", "inquiry", "korean", "korean_history_raw", "math", "pack_version", "second_language"]);
  const sl = pr.buildProvisionalScores({ ...full, sl_subject: "한문Ⅰ", sl_raw: 47 }, ex);
  assert.deepEqual(sl.scores.second_language, { subject: "한문Ⅰ", raw_score: 47 });
});

test("provisional payload rejects missing choices, duplicate inquiry and out-of-range raw scores", () => {
  const err = (v) => pr.buildProvisionalScores(v, ex);
  assert.match(err({ ...full, korean_choice: undefined }).error, /선택과목/);
  assert.match(err({ ...full, math_choice: "수학Ⅰ" }).error, /선택과목/);
  assert.match(err({ ...full, inq2: "물리학Ⅰ" }).error, /서로 달라야/);
  assert.match(err({ ...full, korean: 101 }).error, /0~100/);
  assert.match(err({ ...full, inq1_raw: 51 }).error, /0~50/);
  assert.match(err({ ...full, history: 2.5 }).error, /0~50/);
  assert.match(err({ ...full, sl_subject: "한문Ⅰ", sl_raw: undefined }).error, /선택한 과목의 원점수/);
  // 제2외국어/한문을 고르지 않으면 미응시로 보지 않는다(2026-11-22 대표님 결정)
  assert.match(err({ ...full, sl_subject: undefined }).error, /'미응시'를 골라/);
});

test("range text: 0.01% overall range as given, integer spans, single value when ends meet", () => {
  assert.equal(pr.topRangeText({ best: "3.25", worst: "4.10" }), "3.25~4.10");
  assert.equal(pr.topRangeText({ best: "3.25", worst: "3.25" }), "3.25");
  assert.equal(pr.topRangeText({ best: "x", worst: "4.10" }), null);
  assert.equal(pr.topRangeText(null), null);
  assert.equal(pr.tripleText({ low: 128, central: 130, high: 133 }), "128~133");
  assert.equal(pr.spanText({ low: 2, high: 2 }), "2");
  assert.equal(pr.spanText(null), null);
});

const provisionalReport = {
  format: "jungsi.persisted-report/v1", report_id: "r1", report_version: 1, profile_id: "p1", updated_at: "2026-11-23T01:00:00Z",
  overall: {
    format: "jungsi.overall-analysis/v1", exam: { exam_id: "2027-csat-provisional", academic_year: 2027, exam_type: "csat_provisional" }, pack_version: ex.pack_version,
    score_basis: "provisional_estimate", input_kind: "provisional_raw", total_standard_score: null, total_standard_range: { low: 380, central: 386, high: 392 },
    subjects: [
      { area: "korean", subject: "언어와 매체", choice: "언어와 매체", raw_score: 88, standard_score: null, standard_score_range: { low: 128, central: 130, high: 132 }, percentile_range: { low: 92, high: 95 }, grade_range: { low: 2, high: 2 }, basis: "provisional_raw_conversion" },
      { area: "math", subject: "미적분", choice: "미적분", raw_score: 84, standard_score: null, standard_score_range: null, percentile_range: null, grade_range: null, basis: "provisional_raw_conversion" },
      { area: "inquiry1", subject: "물리학Ⅰ", choice: null, raw_score: 44, standard_score: null, standard_score_range: { low: 64, central: 65, high: 66 }, percentile_range: null, grade_range: null, basis: "provisional_raw_conversion" },
      { area: "inquiry2", subject: "화학Ⅰ", choice: null, raw_score: 42, standard_score: null, standard_score_range: { low: 62, central: 63, high: 64 }, percentile_range: null, grade_range: null, basis: "provisional_raw_conversion" },
    ],
    absolute_grades: { 영어: 1, 한국사: 1 }, second_language: null,
    overall: { status: "pending", reason_code: "provisional_conversion_unavailable", top_percent: null, top_percent_range: null, exclusive_top_percent_range: null },
  },
};

test("a raw-score report is recognised; the reason for no overall position is a plain sentence", () => {
  assert.equal(pr.isProvisionalReport(provisionalReport), true);
  assert.equal(isProvisionalOverall(provisionalReport.overall), true);
  assert.equal(isProvisionalOverall({ ...provisionalReport.overall, score_basis: "mock_exam", input_kind: undefined }), false);
  assert.match(pr.provisionalReason("provisional_conversion_unavailable"), /표준점수 추정이 없는 점수/);
  assert.match(pr.provisionalReason("provisional_total_outside_axis"), /범위 밖/);
  assert.doesNotMatch(pr.provisionalReason("anything_else"), /확인 중/);
  assert.equal(pr.provisionalTopText(provisionalReport.overall), null);
  const ready = { ...provisionalReport.overall, overall: { status: "estimated_range", reason_code: null, top_percent_range: { best: "2.31", worst: "3.08" } } };
  assert.equal(pr.provisionalTopText(ready), "2.31~3.08");
});

test("correction form is filled from the saved raw scores", () => {
  assert.deepEqual(pr.provisionalDefaults(provisionalReport), {
    korean_choice: "언어와 매체", korean: 88, math_choice: "미적분", math: 84, inq1: "물리학Ⅰ", inq1_raw: 44, inq2: "화학Ⅰ", inq2_raw: 42,
  });
});

test("raw-score report: university.analyze stays blocked, candidates.build is sent (dep_r22 school judgments)", async () => {
  const calls = [];
  const built = { ...provisionalReport, report_version: 2, candidates: { status: "ready", reason_code: null, basic_university_groups: [], wildcards: [] } };
  const src = new Proxy({}, {
    get: (_t, name) => async () => {
      calls.push(name);
      if (name === "buildCandidates") return { ok: true, value: built };
      if (name === "readReport") return built;
      throw new Error(`unexpected ${String(name)}`);
    },
  });
  assert.equal(ops.provisionalOnly(provisionalReport), true);
  assert.deepEqual(await ops.ensureAnalyses(src, {}, provisionalReport, ["2027:1"]), { kind: "ready", report: provisionalReport });
  assert.equal(await ops.settleAnalyses(src, {}, provisionalReport, ["2027:1"]), provisionalReport);
  assert.deepEqual(calls, []);
  assert.equal((await ops.ensureCandidates(src, {}, provisionalReport)).report.report_version, 2);
  assert.deepEqual(calls, ["buildCandidates"]);
  assert.equal((await ops.settleCandidates(src, {}, provisionalReport)).report_version, 2);
  assert.deepEqual(calls, ["buildCandidates", "buildCandidates", "readReport"]);
  assert.equal(ops.provisionalOnly({ ...provisionalReport, overall: { ...provisionalReport.overall, score_basis: "mock_exam", input_kind: undefined } }), false);
});
