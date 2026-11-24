import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

// 전문가용 학생 수능 가채점 저장(2026-11-21 대표님 결정: 오픈 때 개인용과 함께). 실제 서버 동작 파일(pro/actions.ts)을
// 그대로 실행하고, 정시터치 서버 대신 기록만 하는 가짜 전문가용 소스를 끼운다. 모든 값은 지어낸 값이다.
const data = (code) => "data:text/javascript," + encodeURIComponent(code);
const classesUrl = new URL("../src/lib/api/source.ts", import.meta.url).href;
const mocks = new Map([
  ["server-only", data("export {}")],
  ["next/headers", data("export async function headers(){ return new Headers({ 'next-action': '1' }); }")],
  ["next/navigation", data("export function redirect(path){ const e = new Error('REDIRECT'); e.path = path; throw e; }")],
  // 개인용 소스(source)는 내보내지 않는다 — 학생 성적이 교사 본인 계정 경로로 가면 바로 실패한다
  ["@/lib/api", data(`export {AccessDenied, ConnectionError} from ${JSON.stringify(classesUrl)}; export async function getCaller(){ return { accessToken: 'invented' }; }`)],
  ["@/lib/api/pro-source", data("export const validId = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v); export function proSource(){ return globalThis.__proFake; }")],
  ["@/lib/pro-profile", new URL("../src/lib/pro-profile.ts", import.meta.url).href],
  ["@/lib/exam", new URL("../src/lib/exam.ts", import.meta.url).href],
  ["@/lib/provisional-report", new URL("../src/lib/provisional-report.ts", import.meta.url).href],
  ["@/lib/score-validity", new URL("../src/lib/score-validity.ts", import.meta.url).href],
]);
registerHooks({
  resolve(spec, ctx, next) {
    if (mocks.has(spec)) return next(mocks.get(spec), ctx);
    if (spec.startsWith(".") && !/\.[a-z]+$/.test(spec) && ctx.parentURL?.endsWith(".ts")) return { url: new URL(spec + ".ts", ctx.parentURL).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const exam = await import("../src/lib/exam.ts");
const actions = await import("../src/app/pro/actions.ts");

const CSAT = { JUNGSI_EXAM_ID: "2027-csat-provisional", JUNGSI_PACK_VERSION: "invented-csat-pack" };
async function withEnv(vars, fn) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
function fake(overrides = {}) {
  const calls = [];
  const f = {
    calls,
    async createScore(...args) { calls.push(["createScore", ...args]); return { ok: true, value: { profile: { profile_id: "invented-profile", profile_version: "invented-profile" } } }; },
    async analyzeOverall(...args) { calls.push(["analyzeOverall", ...args]); return { ok: true, value: { report: {} } }; },
    async candidates(...args) { calls.push(["candidates", ...args]); return { ok: true, value: {} }; },
    ...overrides,
  };
  globalThis.__proFake = f;
  return f;
}
function form(extra = {}) {
  const fd = new FormData();
  const v = {
    org_id: "invented-org", student_id: "invented-student", idem: "00000000-0000-4000-8000-000000000001", entry_version: "0",
    korean_choice: "화법과 작문", korean: "88", math_choice: "미적분", math: "84", english: "91", history: "45",
    inq1: "생활과 윤리", inq1_raw: "44", inq2: "사회·문화", inq2_raw: "42", sl_subject: "none", sl_raw: "", confirm: "on", ...extra,
  };
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
}
const OPEN = { JUNGSI_CSAT_OPENS_AT: "2000-01-01T00:00:00Z" };
const CLOSED = { JUNGSI_CSAT_OPENS_AT: "2999-01-01T00:00:00Z" };

test("proCsatEnabled opens only on exactly '1'", async () => {
  for (const [v, want] of [[undefined, false], ["", false], ["0", false], ["true", false], ["1", true]]) {
    await withEnv({ JUNGSI_PRO_CSAT_ENABLED: v }, () => assert.equal(exam.proCsatEnabled(), want, String(v)));
  }
});

test("switch off: nothing is sent to the server and no input right is used", async () => {
  const f = fake();
  await withEnv({ ...CSAT, ...OPEN, JUNGSI_PRO_CSAT_ENABLED: undefined }, async () => {
    const r = await actions.submitStudentProvisional(null, form());
    assert.match(r.error, /입력 횟수는 쓰이지 않았습니다/);
  });
  assert.equal(f.calls.length, 0);
});

test("before the cutover time nothing is sent even when switched on", async () => {
  const f = fake();
  await withEnv({ ...CSAT, ...CLOSED, JUNGSI_PRO_CSAT_ENABLED: "1" }, async () => {
    const r = await actions.submitStudentProvisional(null, form());
    assert.ok(r.error);
  });
  assert.equal(f.calls.length, 0);
});

// 2026-11-22 대표님 결정: 가채점도 저장 때 학교별 7단계 대학 찾기를 자동 1회(서버 dep_pro_r27). 같은 학생·같은 성적으로만
test("raw scores go to that student's pro.score.create (stage provisional), then overall, then candidates once", async () => {
  const f = fake();
  await withEnv({ ...CSAT, ...OPEN, JUNGSI_PRO_CSAT_ENABLED: "1" }, async () => {
    await assert.rejects(actions.submitStudentProvisional(null, form()), (e) => e.message === "REDIRECT" && e.path === "/pro/students/invented-student?org=invented-org");
  });
  assert.deepEqual(f.calls.map((c) => c[0]), ["createScore", "analyzeOverall", "candidates"]);
  const [, , org, student, body, key] = f.calls[0];
  assert.equal(org, "invented-org");
  assert.equal(student, "invented-student");
  assert.equal(body.stage, "provisional");
  assert.equal(body.exam_id, CSAT.JUNGSI_EXAM_ID);
  assert.equal(body.pack_version, CSAT.JUNGSI_PACK_VERSION);
  assert.equal(body.expected_entry_version, 0);
  assert.equal(key, "00000000-0000-4000-8000-000000000001:profile");
  // 서버 validateRawScoreStructure 와 같은 모양
  assert.deepEqual(body.scores, {
    exam_id: CSAT.JUNGSI_EXAM_ID,
    pack_version: CSAT.JUNGSI_PACK_VERSION,
    korean: { raw_score: 88, choice: "화법과 작문" },
    math: { raw_score: 84, choice: "미적분" },
    inquiry: [{ subject: "생활과 윤리", raw_score: 44 }, { subject: "사회·문화", raw_score: 42 }],
    english_raw: 91,
    korean_history_raw: 45,
    second_language: null,
  });
  const [, , o2, s2, profileId, version, key2] = f.calls[1];
  assert.deepEqual([o2, s2, profileId, version, key2], ["invented-org", "invented-student", "invented-profile", "invented-profile", "00000000-0000-4000-8000-000000000001:overall"]);
  const [, , o3, s3, p3, v3, key3] = f.calls[2];
  assert.deepEqual([o3, s3, p3, v3, key3], ["invented-org", "invented-student", "invented-profile", "invented-profile", "00000000-0000-4000-8000-000000000001:candidates"]);
});

test("form problems and a missing confirmation never reach the server", async () => {
  const f = fake();
  await withEnv({ ...CSAT, ...OPEN, JUNGSI_PRO_CSAT_ENABLED: "1" }, async () => {
    for (const extra of [{ korean_choice: "" }, { inq2: "생활과 윤리" }, { korean: "101" }, { sl_subject: "" }, { sl_subject: "일본어Ⅰ", sl_raw: "" }, { confirm: "" }, { student_id: "../x" }, { entry_version: "x" }]) {
      const r = await actions.submitStudentProvisional(null, form(extra));
      assert.ok(r?.error, JSON.stringify(extra));
      assert.equal(r.values.korean_choice, extra.korean_choice === "" ? undefined : "화법과 작문");
    }
  });
  assert.equal(f.calls.length, 0);
});

test("server refusal is explained and overall is not attempted", async () => {
  const f = fake({ async createScore(...args) { f.calls.push(["createScore", ...args]); return { ok: false, code: "invalid_choice", status: 422 }; } });
  await withEnv({ ...CSAT, ...OPEN, JUNGSI_PRO_CSAT_ENABLED: "1" }, async () => {
    const r = await actions.submitStudentProvisional(null, form());
    assert.match(r.error, /선택과목/);
  });
  assert.deepEqual(f.calls.map((c) => c[0]), ["createScore"]);
});

test("student page wires the provisional form only to the student save action behind the switch", () => {
  // 2026-11-23 탭 개편: 학생 화면 본문은 student-view.tsx(① 성적 입력·④ 정시 리포트가 함께 쓴다)
  const page = readFileSync(new URL("../src/app/pro/students/[studentId]/student-view.tsx", import.meta.url), "utf8");
  assert.match(page, /submit=\{submitStudentProvisional\}/);
  assert.doesNotMatch(page, /submitProvisional\b/);
  assert.match(page, /proCsatEnabled\(\) && csatOpen\(\)/);
  const acts = readFileSync(new URL("../src/app/pro/actions.ts", import.meta.url), "utf8");
  const body = acts.slice(acts.indexOf("export async function submitStudentProvisional"), acts.indexOf("export type ProActionState"));
  assert.doesNotMatch(body, /createScoreProfile|\bsource\(\)/);
  // 대학 찾기는 전문가용 pro.candidates(proSource)로 이 학생 성적만(개인용 source 를 쓰지 않는다)
  assert.match(body, /src\.candidates\(caller, orgId, studentId, p\.profile_id/);
});

// 2026-11-24 대표님 결정: ② 유리한 대학 찾기에 결과가 아예 없으면 열 때 한 번 자동으로 찾는다(버튼과 같은 계산, 화면 이동 없음)
function autoForm(extra = {}) {
  const fd = new FormData();
  const v = { org_id: "invented-org", student_id: "invented-student", profile_id: "invented-profile", profile_version: "invented-profile", idem: "00000000-0000-4000-8000-000000000002", ...extra };
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
}
test("auto find calls pro.candidates once for that student and stays on the page", async () => {
  const f = fake();
  const r = await actions.autoFindCandidates(null, autoForm());
  assert.deepEqual(r, { done: "찾음" });
  assert.deepEqual(f.calls, [["candidates", { accessToken: "invented" }, "invented-org", "invented-student", "invented-profile", "invented-profile", "00000000-0000-4000-8000-000000000002"]]);
});
test("auto find failure is explained with the button fallback and never throws", async () => {
  fake({ async candidates() { return { ok: false, code: "csat_provisional_unavailable", status: 503 }; } });
  const r = await actions.autoFindCandidates(null, autoForm());
  assert.match(r.error, /아래 버튼/);
  fake({ async candidates() { throw new Error("boom"); } });
  const r2 = await actions.autoFindCandidates(null, autoForm());
  assert.match(r2.error, /아래 버튼/);
  const f = fake();
  const r3 = await actions.autoFindCandidates(null, autoForm({ idem: "bad" }));
  assert.ok(r3.error);
  assert.equal(f.calls.length, 0);
});
test("favorable tab auto-finds only when the report has no candidates at all, for editors", () => {
  const page = readFileSync(new URL("../src/app/pro/students/[studentId]/favorable/page.tsx", import.meta.url), "utf8");
  assert.match(page, /v\.canEdit && provisionalOnly\(report\) && proCsatEnabled\(\) && report\.candidates == null \? \(\s*<AutoFind act=\{autoFindCandidates\}/);
  const comp = readFileSync(new URL("../src/app/pro/auto-find.tsx", import.meta.url), "utf8");
  // 같은 성적으로는 탭에서 한 번만(실패해도 되풀이하지 않는다)
  assert.match(comp, /sessionStorage\.getItem\(k\)/);
  assert.match(comp, /sessionStorage\.setItem\(k, "1"\)/);
});
