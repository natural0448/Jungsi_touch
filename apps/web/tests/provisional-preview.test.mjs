import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const { loadConverter, PreviewError } = await import("../src/lib/provisional-preview.ts");

// 합성 변환표(지어낸 숫자). 실제 담당자 표는 화면 서버 KV 에만 둔다
const rows = (max, f) => Array.from({ length: max + 1 }, (_, raw) => f(raw));
const rel = (area, choice, max) => ({
  area, choice, raw_max: max,
  rows: rows(max, (raw) => raw < 10
    ? { raw, standard: null, percentile: null, grade: { low: 9, high: 9 } }
    : { raw, standard: { low: 50 + raw, central: 51 + raw, high: 52 + raw }, percentile: { low: Math.min(raw, 99), high: Math.min(raw + 1, 100) }, grade: { low: 1, high: 2 } }),
});
const doc = {
  format: "jungsi.csat-provisional-raw-conversion/v1", exam_id: "2027-csat-provisional", academic_year: 2027, version: "test.v1",
  anchor_pack_sha256: "a".repeat(64),
  subjects: { "화법과 작문": rel("korean", "화법과 작문", 100), "미적분": rel("math", "미적분", 100), "물리학Ⅰ": rel("inquiry", "물리학Ⅰ", 50) },
  absolute: { english: [{ raw_min: 90, grade: 1 }, { raw_min: 80, grade: 2 }, { raw_min: 0, grade: 9 }], korean_history: [{ raw_min: 40, grade: 1 }, { raw_min: 0, grade: 9 }] },
};
const bytes = new TextEncoder().encode(JSON.stringify(doc));
const pin = { examId: "2027-csat-provisional", version: "test.v1", sha256: createHash("sha256").update(bytes).digest("hex"), anchorSha256: "a".repeat(64) };

test("가채점 미리보기: 원점수 → 예상 표준점수·백분위·등급 범위, 낮은 점수는 등급만", async () => {
  const conv = await loadConverter(bytes, pin);
  assert.deepEqual(conv({ area: "korean", choice: "화법과 작문", raw: 80 }), { standard: { low: 130, central: 131, high: 132 }, percentile: { low: 80, high: 81 }, grade: { low: 1, high: 2 } });
  assert.deepEqual(conv({ area: "inquiry", choice: "물리학Ⅰ", raw: 5 }), { standard: null, percentile: null, grade: { low: 9, high: 9 } });
  assert.deepEqual(conv({ area: "english", raw: 85 }).grade, { low: 2, high: 2 });
  assert.deepEqual(conv({ area: "korean_history", raw: 45 }).grade, { low: 1, high: 1 });
});

test("가채점 미리보기: 지문·판·과목·범위가 어긋나면 쓰지 않는다", async () => {
  await assert.rejects(loadConverter(bytes, { ...pin, sha256: "0".repeat(64) }), PreviewError);
  await assert.rejects(loadConverter(bytes, { ...pin, version: "other" }), PreviewError);
  const conv = await loadConverter(bytes, pin);
  assert.throws(() => conv({ area: "korean", choice: "언어와 매체", raw: 80 }), PreviewError);
  assert.throws(() => conv({ area: "inquiry", choice: "물리학Ⅰ", raw: 51 }), PreviewError);
  assert.throws(() => conv({ area: "math", choice: "물리학Ⅰ", raw: 30 }), PreviewError);
  assert.throws(() => conv({ area: "second_foreign_language_or_classical_chinese", raw: 30 }), PreviewError);
});
