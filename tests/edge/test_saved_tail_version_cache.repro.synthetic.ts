// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
import {
  type AuthorizedSavedTailPin,
  PinnedSavedReferenceTailSource,
} from "../../supabase/functions/_shared/jungsi/infrastructure/saved_reference_tail_source.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
Deno.test("cached tail cannot accept a second selection with a different version", async () => {
  const context: NativeObject = {
    academic_year: 2027,
    exam_id: "e",
    exam_type: "september_mock",
    source_pack_version: "p",
    model_version: "m",
    profile_sha256: "a".repeat(64),
    rule_version: "r",
    score_scale_id: "s",
    reference_curve_id: "c",
    weight_encoding: "synthetic",
    source_scenario_field_present: false,
    source_scenario_value: null,
    resolved_model_scenario: "base",
  };
  const evidence = Object.fromEntries(
    [
      "source_csv_sha256",
      "source_cdf_sha256",
      "definition_sha256",
      "shared_proof_sha256",
      "binder_sha256",
      "independent_sha256",
    ].map((k) => [k, "b".repeat(64)]),
  );
  const content: NativeObject = {
    format: "jungsi.saved-reference-tail-projection/v1",
    version: "v1",
    context,
    evidence,
    projection: {
      derived_method_id: "estimated-whole-cohort-percentile:" + "d".repeat(64),
      weight_decimal_scale: 0,
      eligible_weight_units: "10",
      whole_mass_decimal: "20",
      whole_mass_numerator: "20",
      whole_mass_denominator: "1",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    },
    rows: [{
      score_numerator: "10",
      score_denominator: "1",
      strict_weight_units: "0",
      tie_weight_units: "10",
      inclusive_weight_units: "10",
    }],
  };
  const raw = new TextEncoder().encode(nativeJsonText(content));
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))].map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
  const port = {
    async select(id: string): Promise<AuthorizedSavedTailPin> {
      return {
        key: "synthetic/shared",
        sha256: digest,
        version: id === "one" ? "v1" : "wrong",
        bytes: raw.length,
        maxBytes: 65536,
        releaseSha256: "c".repeat(64),
        selectionSha256: "e".repeat(64),
        compatibilitySha256: "d".repeat(64),
        context,
        evidence,
        binding: { offering_id: id, offering_pk: "physical-" + id },
      };
    },
    async read() {
      return raw;
    },
    async assertCurrent() {},
    async assertCompatible() {},
  };
  const source = new PinnedSavedReferenceTailSource(port, new AbortController().signal, 2, 131072);
  if (!await source.getReferenceTail("one")) throw Error("first missing");
  let rejected = false;
  try {
    await source.getReferenceTail("two");
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error("cached projection ignored a mismatching selected version");
});
