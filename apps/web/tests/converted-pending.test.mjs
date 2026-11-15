import test from "node:test";
import assert from "node:assert/strict";
const { convertedPending } = await import("../src/lib/converted-pending.ts");

test("only analysis-missing offerings with a ready official conversion become 'converted, judgement pending'", () => {
  const conv = (status, converted_score) => ({ conversion: { status, converted_score } });
  const report = {
    candidates: { pending_offerings: [
      { offering_id: "a", category: "pending", reason_code: "analysis_release_missing" },
      { offering_id: "b", category: "pending", reason_code: "analysis_release_missing" },
      { offering_id: "c", category: "pending", reason_code: "reference_conversion_not_production_approved" },
      { offering_id: "d", category: "pending", reason_code: "analysis_release_missing" },
      { offering_id: "e", category: "pending", reason_code: "analysis_release_missing" },
    ] },
    analyses: { a: conv("ready", "612.5"), b: conv("pending", null), c: conv("ready", "500"), d: conv("reference_calculated", "400"), e: conv("ready", " ") },
  };
  assert.deepEqual(convertedPending(report), [{ offeringId: "a", score: "612.5" }]);
  assert.deepEqual(convertedPending({ candidates: null, analyses: undefined }), []);
});
