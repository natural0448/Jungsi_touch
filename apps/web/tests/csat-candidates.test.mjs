import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 수능 가채점 리포트의 3번째 화면(유리한 대학 찾기): candidates.build 응답의 학교별 가채점 7단계(source g, dep_r22)
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith(".json")) return { ...next(specifier, context), importAttributes: { type: "json" } };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { csatCandidateGroupOf, csatCandidateView } = await import("../src/lib/provisional-view.ts");

// 가채점 참고 후보(2026-11-23 대표님 결정): 안정·하향 → 여유, 적정 → 핵심, 소신·상향 → 도전, 범위가 두 그룹에 걸치면 보류
const b = (code, upper) => ({ basis: "reference_threshold", code, label: code, source: "g", ...(upper ? { upper_code: upper } : {}) });
test("stage → group mapping and range hold", () => {
  assert.equal(csatCandidateGroupOf(b("stable")), "room");
  assert.equal(csatCandidateGroupOf(b("downward")), "room");
  assert.equal(csatCandidateGroupOf(b("target")), "core");
  assert.equal(csatCandidateGroupOf(b("aspirational")), "challenge");
  assert.equal(csatCandidateGroupOf(b("upward")), "challenge");
  assert.equal(csatCandidateGroupOf(b("challenge")), null);
  assert.equal(csatCandidateGroupOf(b("outside")), null);
  assert.equal(csatCandidateGroupOf(b("stable", "downward")), "room");
  assert.equal(csatCandidateGroupOf(b("aspirational", "upward")), "challenge");
  assert.equal(csatCandidateGroupOf(b("target", "aspirational")), null);
  assert.equal(csatCandidateGroupOf(b("upward", "challenge")), null);
});
test("view groups offerings and counts held ranges", () => {
  const o = (id, uni) => ({ offering_id: id, university_id: uni, university_name: uni, department: "d" + id, group: "가", academic_year: 2027 });
  const c = { reference_university_groups: [{ university_id: "u1", university_name: "u1", offerings: [
    { offering: o("1", "u1"), reference_band: b("target") },
    { offering: o("2", "u1"), reference_band: b("stable") },
    { offering: o("3", "u1"), reference_band: b("target", "aspirational") },
    { offering: o("4", "u1"), reference_band: b("upward") },
    { offering: o("5", "u1"), reference_band: { ...b("target"), source: "a" } },
  ] }] };
  const v = csatCandidateView(c);
  assert.deepEqual(v.counts, { challenge: 1, core: 1, room: 1 });
  assert.equal(v.held, 1);
  assert.equal(v.groups.core[0].university_id, "u1");
});
