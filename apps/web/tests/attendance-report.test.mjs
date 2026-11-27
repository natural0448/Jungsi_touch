import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const lib = new URL("../src/lib/", import.meta.url);
registerHooks({ resolve(id, context, next) {
  if (id === "server-only") return next("data:text/javascript,export%20{}", context);
  if (id === "@/lib/api") return next(new URL("api/source.ts", lib).href, context);
  if (id.startsWith("@/lib/")) return next(new URL(id.slice(6) + ".ts", lib).href, context);
  if (id.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(id)) {
    const path = new URL(id + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(path))) return next(path.href, context);
  }
  const resolved = next(id, context);
  return id.endsWith(".json") ? { ...resolved, importAttributes: { type: "json" } } : resolved;
} });

const { provisionalBands, settleCandidates } = await import(new URL("report-ops.ts", lib));
const { requiredUnmet, formal105Notice, withRequiredUnmet } = await import(new URL("eligibility-conditions.ts", lib));
const { setEligibilityTablesForTest } = await import(new URL("eligibility-tables.ts", lib));
const { csatCandidateView } = await import(new URL("provisional-view.ts", lib));
const PK = "2027:9000000101";
const caller = { accessToken: "synthetic-no-account" };
const subjects = [
  { area: "math", choice: "미적분", subject: "수학" },
  { area: "inquiry1", subject: "생활과 윤리" },
  { area: "inquiry2", subject: "사회·문화" },
];
const offering = { offering_id: PK, university_id: "u", university_name: "합성대", department: "검사용 학과" };
const band = { basis: "reference_threshold", source: "g", code: "stable", label: "안정", school_score: { central: "267", low: "267", high: "267" } };
const candidates = { catalog_version: "same", reference_university_groups: [{ university_id: "u", offerings: [{ offering, reference_band: band }] }] };
const report = (id, patch = {}) => ({ report_id: id, profile_id: "synthetic-profile", report_version: 9,
  candidates_stale: false, overall: { score_basis: "provisional_estimate", subjects }, candidates, ...patch });
const listed = r => csatCandidateView(r.candidates, true).counts.room;

test("explicit ineligibility on the same report overrides stale positive recommendations", async () => {
  const saved = report("recommended", { analyses: { [PK]: { offering_id: PK, status: "ready", reference_band: band } } });
  setEligibilityTablesForTest({ required: { [PK]: { d: ["사회", "과학"], n: 2, s: 1 } }, formal105: {} });
  try {
    const reread = withRequiredUnmet(saved);
    const src = { buildCandidates: async () => ({ ok: true, value: saved }), readReport: async () => reread };
    const fixed = await settleCandidates(src, caller, saved);
    assert.equal(fixed.analyses[PK].status, "ineligible");
    assert.equal(listed(fixed), 0);
    assert.equal(saved.analyses[PK].status, "ready");
  } finally { setEligibilityTablesForTest(null); }
});

test("a CSAT recommendation cache cannot mask changed eligibility on the opened report (2026-11-27: 미충족 지문 열쇠)", async () => {
  const old = report("rebuild");
  const current = { ...old, candidates: { ...candidates, csat_condition_unmet: [PK] } };
  let builds = 0;
  const src = { buildCandidates: async () => ({ ok: true, value: ++builds === 1 ? old : current }), readReport: async () => builds === 1 ? old : current };
  assert.equal(listed(await settleCandidates(src, caller, old, { shared: true })), 1);
  // 연 리포트에서 이 학과가 지원 조건 미충족으로 확정되면 지문이 바뀌어 다시 만든다
  const reread = { ...old, analyses: { [PK]: { offering_id: PK, status: "ineligible", reason_code: "eligibility_not_met" } }, candidates: { ...candidates, reference_university_groups: [] } };
  assert.equal(listed(await settleCandidates(src, caller, reread, { shared: true, reuse: true })), 0);
  assert.equal(builds, 2);
});

test("empty or failed fresh build cannot restore old automatic candidates", async () => {
  const saved = report("no-fresh-candidates");
  const error = { buildCandidates: async () => ({ ok: false, code: "backend_dependency_unavailable", status: 503 }) };
  const empty = { buildCandidates: async () => ({ ok: true, value: { ...saved, candidates: { ...candidates, reference_university_groups: [] } } }),
    readReport: async () => saved };
  assert.equal(listed(await settleCandidates(error, caller, saved)), 0);
  assert.equal(listed(await settleCandidates(empty, caller, saved)), 0);
});

test("provisional details reread changed eligibility and preserve the university score", async () => {
  const saved = report("details");
  const now = { ...saved, candidates: { ...candidates, csat_condition_unmet: [PK] } };
  let analysisCount = 0;
  const src = { analyzeUniversities: async () => ({ ok: true, value: ++analysisCount === 1 ? saved : now }) };
  const old = await provisionalBands(src, caller, saved, [PK]);
  assert.equal(old.bands[PK].held, undefined);
  // 연 리포트의 미충족 확정 목록이 바뀌면 다시 받는다
  const changed = { ...saved, analyses: { [PK]: { offering_id: PK, status: "ineligible", reason_code: "eligibility_not_met" } } };
  const result = await provisionalBands(src, caller, changed, [PK]);
  assert.equal(analysisCount, 2);
  assert.equal(result.min[PK], "condition");
  assert.equal(result.bands[PK].held, true);
  assert.equal(result.bands[PK].school_score.central, "267");
});

test("official assessment needs two distinct recognized science subjects", () => {
  setEligibilityTablesForTest({ required: {}, formal105: { [PK]: { d: ["과학"], n: 2 } } });
  try {
    const [math] = subjects;
    const one = { area: "inquiry1", subject: "물리학Ⅰ" };
    const two = { area: "inquiry2", subject: "화학Ⅰ" };
    const cases = [[math], [math, one], [math, one, { ...one, area: "inquiry2" }], [math, one, { ...two, subject: "미정" }]];
    for (const c of cases) assert.equal(formal105Notice(PK, "csat_final", c).score, "unverified");
    assert(requiredUnmet(PK, cases[1]));
    assert.equal(formal105Notice(PK, "csat_final", [math, one, two]).score, "met");
  } finally { setEligibilityTablesForTest(null); }
});
