// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
import { assert, equal } from "./fixture.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  type AuthorizedSavedTailPin,
  PinnedSavedReferenceTailSource,
} from "../../supabase/functions/_shared/jungsi/infrastructure/saved_reference_tail_source.ts";

async function fixture() {
  const context: NativeObject = {
    academic_year: 2027,
    exam_id: "SYNTHETIC-mock",
    exam_type: "september_mock",
    source_pack_version: "SYNTHETIC-pack",
    model_version: "SYNTHETIC-model",
    profile_sha256: "a".repeat(64),
    rule_version: "SYNTHETIC-rule",
    score_scale_id: "SYNTHETIC-native",
    reference_curve_id: "SYNTHETIC-curve",
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
  ) as NativeObject;
  const data: NativeObject = {
    format: "jungsi.saved-reference-tail-projection/v1",
    version: "SYNTHETIC.v1",
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
  const raw = new TextEncoder().encode(nativeJsonText(data));
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))].map((n) =>
    n.toString(16).padStart(2, "0")
  ).join("");
  const pin: AuthorizedSavedTailPin = {
    key: "synthetic/object",
    sha256,
    bytes: raw.length,
    maxBytes: 65536,
    releaseSha256: "c".repeat(64),
    selectionSha256: "e".repeat(64),
    compatibilitySha256: "d".repeat(64),
    context,
    evidence,
    binding: { offering_id: "synthetic", offering_pk: "physical-synthetic" },
  };
  return { raw, pin };
}

Deno.test("different scope signals do not share an unfinished saved-tail read", async () => {
  const x = await fixture(),
    request = new AbortController(),
    first = new AbortController(),
    second = new AbortController();
  let reads = 0, release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    both = new Promise<void>((resolve) => {
      started = resolve;
    });
  const port = {
    async select() {
      return x.pin;
    },
    async assertCurrent() {},
    async assertCompatible() {},
    async read(_key: string, _max: number, signal: AbortSignal) {
      reads++;
      if (reads === 2) started();
      await Promise.race([
        gate,
        new Promise<never>((_, reject) => {
          if (signal.aborted) reject(new Error("aborted"));
          else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      ]);
      if (signal.aborted) throw new Error("aborted");
      return x.raw;
    },
  };
  const source = new PinnedSavedReferenceTailSource(port, request.signal, 3, 131072);
  const one = source.getReferenceTail("synthetic", first.signal).then(() => false, () => true);
  const two = source.getReferenceTail("synthetic", second.signal);
  await both;
  first.abort();
  release();
  assert(await one);
  assert(await two);
  equal(reads, 2);
  assert(await source.getReferenceTail("synthetic", new AbortController().signal));
  equal(reads, 2);
});

Deno.test("independent scope reads are each charged to the existing object budget", async () => {
  const x = await fixture(),
    request = new AbortController(),
    first = new AbortController(),
    second = new AbortController();
  let release!: () => void, started!: () => void, reads = 0;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    began = new Promise<void>((resolve) => {
      started = resolve;
    });
  const port = {
    async select() {
      return x.pin;
    },
    async assertCurrent() {},
    async assertCompatible() {},
    async read() {
      reads++;
      started();
      await gate;
      return x.raw;
    },
  };
  const source = new PinnedSavedReferenceTailSource(port, request.signal, 1, 131072);
  const one = source.getReferenceTail("synthetic", first.signal);
  await began;
  const rejected = await source.getReferenceTail("synthetic", second.signal).then(
    () => false,
    () => true,
  );
  assert(rejected);
  equal(reads, 1);
  release();
  assert(await one);
});

Deno.test("a legacy pin without a selection digest cannot issue new provenance", async () => {
  const x = await fixture(), request = new AbortController();
  const { selectionSha256: _unused, ...legacyPin } = x.pin;
  const port = {
    async select() {
      return legacyPin;
    },
    async assertCurrent() {},
    async assertCompatible() {},
    async read() {
      return x.raw;
    },
    async verifiedProvenance() {
      return {} as NativeObject;
    },
  };
  const source = new PinnedSavedReferenceTailSource(port, request.signal, 1, 131072);
  const selection = await source.getReferenceTail("synthetic");
  assert(selection?.verifiedProvenance);
  const rejected = await selection.verifiedProvenance({ offering_id: "synthetic" }).then(
    () => false,
    () => true,
  );
  assert(rejected);
});
