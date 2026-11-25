import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-11-25 실채점 전환 준비(대표님 11-24: 12-14 0시 KST 공개, 담당자 안내: 실채점은 별도 시험 ID). 실제 모듈을 그대로 실행한다
const exam = await import("../src/lib/exam.ts");

function withEnv(vars, fn) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
const IDS = { JUNGSI_PAST_EXAM_ID: "mock-x", JUNGSI_EXAM_ID: "csat-prov-x", JUNGSI_FINAL_EXAM_ID: "csat-final-x", JUNGSI_CSAT_OPENS_AT: "2000-01-01T00:00:00Z" };
const after = new Date("2026-12-13T15:00:00Z"), before = new Date("2026-12-13T14:59:59Z");

test("switch off: even after 12-14 0시 the current exam stays 수능 가채점", () => {
  withEnv({ ...IDS, JUNGSI_FINAL_ENABLED: undefined, JUNGSI_FINAL_OPENS_AT: undefined }, () => {
    assert.equal(exam.finalOpen(after), false);
    assert.equal(exam.EXAM.exam_id, "csat-prov-x");
  });
});

test("switch on: opens exactly at the default 12-14 00:00 KST", () => {
  withEnv({ ...IDS, JUNGSI_FINAL_ENABLED: "1", JUNGSI_FINAL_OPENS_AT: undefined }, () => {
    assert.equal(exam.finalOpensAt().toISOString(), "2026-12-13T15:00:00.000Z");
    assert.equal(exam.finalOpen(before), false);
    assert.equal(exam.finalOpen(after), true);
  });
});

test("switch on and time passed: current exam is 실채점 with its own ID, label and pack", () => {
  withEnv({ ...IDS, JUNGSI_FINAL_ENABLED: "1", JUNGSI_FINAL_OPENS_AT: "2000-01-02T00:00:00Z", JUNGSI_FINAL_PACK_VERSION: "final-pack-x" }, () => {
    assert.equal(exam.EXAM.exam_id, "csat-final-x");
    assert.equal(exam.EXAM.pack_version, "final-pack-x");
    assert.equal(exam.EXAM.label, "2027학년도 대학수학능력시험");
    assert.equal(exam.CSAT_EXAM.exam_id, "csat-prov-x");
  });
});

test("실채점 needs 가채점 cutover first and ignores anything but '1'", () => {
  withEnv({ ...IDS, JUNGSI_CSAT_OPENS_AT: "2999-01-01T00:00:00Z", JUNGSI_FINAL_ENABLED: "1", JUNGSI_FINAL_OPENS_AT: "2000-01-02T00:00:00Z" }, () => {
    assert.equal(exam.finalOpen(), false);
  });
  withEnv({ ...IDS, JUNGSI_FINAL_ENABLED: "true", JUNGSI_FINAL_OPENS_AT: "2000-01-02T00:00:00Z" }, () => {
    assert.equal(exam.finalOpen(), false);
  });
});

test("inputs: standard-score save reopens and 가채점 saves close after the final switch", () => {
  const std = readFileSync(new URL("../src/app/reports/me/actions.ts", import.meta.url), "utf8");
  assert.match(std, /if \(csatOpen\(\) && !finalOpen\(\)\) return fail\("9월 모의평가 성적 입력은/);
  const prov = readFileSync(new URL("../src/app/reports/me/provisional-actions.ts", import.meta.url), "utf8");
  assert.match(prov, /if \(finalOpen\(\)\) return fail\("수능 가채점 입력은 실채점 전환과 함께 끝났습니다/);
  const pro = readFileSync(new URL("../src/app/pro/actions.ts", import.meta.url), "utf8");
  assert.match(pro, /if \(!proCsatEnabled\(\) \|\| !csatOpen\(\) \|\| finalOpen\(\)\) return fail/);
});

test("past records: 가채점 reports become 지난 기록 only after the final switch", () => {
  const page = readFileSync(new URL("../src/app/reports/me/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(csat && pastKind && \(pastKind === "mock" \|\| fin\)\)/);
  assert.match(page, /fin \? hasPastMock\(src, caller, "csat"\) : false/);
  const past = readFileSync(new URL("../src/app/reports/me/past-records.tsx", import.meta.url), "utf8");
  assert.match(past, /isProvisionalOverall\(report\.overall\) !== \(kind === "csat"\)/);
});
