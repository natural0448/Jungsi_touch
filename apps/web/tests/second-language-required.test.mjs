import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// 제2외국어/한문 필수 선택(2026-11-22 대표님 결정). 화면 확인 창과 서버 액션이 같이 쓰는 TypeScript 모듈을 그대로 실행한다.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[a-z]+$/.test(spec) && ctx.parentURL?.endsWith(".ts")) return { url: new URL(spec + ".ts", ctx.parentURL).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const { checkSecondLanguage, SL_NONE, SL_MESSAGE, slHint } = await import("../src/lib/second-language.ts");
const { buildProvisionalScores } = await import("../src/lib/provisional-report.ts");

const EXAM = { exam_id: "2027-csat-provisional", pack_version: "test.v1" };
const BASE = {
  korean_choice: "화법과 작문", korean: 88, math_choice: "미적분", math: 84,
  inq1: "물리학Ⅰ", inq1_raw: 44, inq2: "화학Ⅰ", inq2_raw: 42, english: 90, history: 45,
};

test("제2외국어/한문: 아무것도 고르지 않으면 미응시로 보지 않고 막는다", () => {
  for (const s of [undefined, null, "", "  "]) {
    const r = checkSecondLanguage(s, undefined, "raw");
    assert.equal(r.ok, false);
    assert.equal(r.error, SL_MESSAGE.choose);
    assert.equal(r.field, "sl_subject");
  }
  assert.equal(checkSecondLanguage("", 3, "grade").ok, false);
  const built = buildProvisionalScores({ ...BASE }, EXAM);
  assert.deepEqual(built, { ok: false, error: "제2외국어/한문을 응시하지 않았으면 '미응시'를 골라 주세요.", field: "sl_subject" });
  assert.equal(slHint("sl_subject", "raw"), "안 봤으면 '미응시' 선택");
});

test("제2외국어/한문: '미응시'를 직접 고르면 저장되고 서버로는 null 로 보낸다", () => {
  assert.deepEqual(checkSecondLanguage(SL_NONE, undefined, "raw"), { ok: true, taken: null });
  // 미응시인데 원점수가 남아 있어도(닫힌 칸) 보내지 않는다
  assert.deepEqual(checkSecondLanguage(SL_NONE, 40, "grade"), { ok: true, taken: null });
  const built = buildProvisionalScores({ ...BASE, sl_subject: SL_NONE }, EXAM);
  assert.equal(built.ok, true);
  assert.equal(built.scores.second_language, null);
});

test("제2외국어/한문: 과목과 점수가 있으면 그대로 보낸다(가채점 원점수 · 9월·실채점 등급)", () => {
  assert.deepEqual(checkSecondLanguage("일본어Ⅰ", 41, "raw"), { ok: true, taken: { subject: "일본어Ⅰ", value: 41 } });
  assert.deepEqual(checkSecondLanguage("한문Ⅰ", 0, "raw"), { ok: true, taken: { subject: "한문Ⅰ", value: 0 } });
  assert.deepEqual(checkSecondLanguage("한문Ⅰ", 2, "grade"), { ok: true, taken: { subject: "한문Ⅰ", value: 2 } });
  const built = buildProvisionalScores({ ...BASE, sl_subject: "일본어Ⅰ", sl_raw: 41 }, EXAM);
  assert.equal(built.ok, true);
  assert.deepEqual(built.scores.second_language, { subject: "일본어Ⅰ", raw_score: 41 });
});

test("제2외국어/한문: 과목만 고르고 점수가 없으면 막는다", () => {
  const raw = checkSecondLanguage("일본어Ⅰ", undefined, "raw");
  assert.deepEqual(raw, { ok: false, error: "선택한 과목의 원점수를 입력해 주세요.", field: "sl_value" });
  assert.equal(checkSecondLanguage("일본어Ⅰ", NaN, "raw").ok, false);
  const grade = checkSecondLanguage("중국어Ⅰ", undefined, "grade");
  assert.deepEqual(grade, { ok: false, error: "선택한 과목의 등급을 입력해 주세요.", field: "sl_value" });
  assert.equal(slHint("sl_value", "grade"), "등급을 골라 주세요");
  const built = buildProvisionalScores({ ...BASE, sl_subject: "일본어Ⅰ" }, EXAM);
  assert.deepEqual(built, { ok: false, error: "선택한 과목의 원점수를 입력해 주세요.", field: "sl_value" });
});

test("제2외국어/한문: 범위 밖 점수·목록에 없는 과목도 서버로 보내기 전에 막는다", () => {
  assert.deepEqual(checkSecondLanguage("일본어Ⅰ", 51, "raw"), { ok: false, error: SL_MESSAGE.rawRange, field: "sl_value" });
  assert.equal(checkSecondLanguage("일본어Ⅰ", 40.5, "raw").ok, false);
  assert.equal(checkSecondLanguage("일본어Ⅰ", 0, "grade").ok, false);
  assert.equal(checkSecondLanguage("일본어Ⅰ", 10, "grade").ok, false);
  assert.deepEqual(checkSecondLanguage("라틴어Ⅰ", 40, "raw"), { ok: false, error: SL_MESSAGE.subject, field: "sl_subject" });
});
