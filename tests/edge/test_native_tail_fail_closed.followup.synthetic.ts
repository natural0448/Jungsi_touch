// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
import { assert, equal } from "./fixture.ts";
import { PinnedExistingDbReferenceTailSource } from "../../supabase/functions/_shared/jungsi/infrastructure/native_reference_db_tail.ts";

Deno.test("a selected native tail rejects a missing calculator rule and a mismatched CDF hash", async () => {
  const signal = new AbortController().signal;
  let sourceRuleId: string | null = null, selects = 0, sourceReads = 0;
  const pin = {
    binding: { offering_id: "2027:1", physical_offering_pk: "1", academic_year: 2027 },
    context: {
      academic_year: 2027,
      exam_id: "synthetic",
      exam_type: "september_mock",
      source_pack_version: "pack",
      rule_version: "calculator",
      score_scale_id: "scale",
    },
    evidence: { source_cdf_sha256: "a".repeat(64) },
  };
  const authority = {
    async select() {
      return pin;
    },
    async assertCurrent() {},
    async assertCompatible() {},
    async verifiedProvenance() {
      return {};
    },
    modelExamPackSha256() {
      return "c".repeat(64);
    },
    async sourceRuleId() {
      return sourceRuleId;
    },
  };
  const reader = {
    async select() {
      selects++;
      return { cdfSha256: "b".repeat(64), academicYear: 2027, physicalOfferingPk: "1" };
    },
    async source() {
      sourceReads++;
      return new Uint8Array();
    },
    async assertCurrent() {},
    currentReceipt() {
      return { assertCurrent() {} };
    },
  };
  const adapter = new PinnedExistingDbReferenceTailSource(
    "synthetic-owner",
    authority as never,
    reader as never,
    signal,
    (s) => s ?? signal,
    2,
    65536,
  );
  assert(await adapter.getNativeReferenceTail("2027:1", signal).then(() => false, () => true));
  equal(selects, 0);
  sourceRuleId = "original-rule";
  assert(await adapter.getNativeReferenceTail("2027:1", signal).then(() => false, () => true));
  // A new scope avoids the deliberately cached failed selection.
  assert(
    await adapter.getNativeReferenceTail("2027:1", new AbortController().signal).then(
      () => false,
      () => true,
    ),
  );
  equal(selects, 1);
  equal(sourceReads, 0);
});
