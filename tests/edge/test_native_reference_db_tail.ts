// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
/** Synthetic current-head/authority integration only. No real data or credentials. */
import { PinnedExistingDbReferenceTailSource } from "../../supabase/functions/_shared/jungsi/infrastructure/native_reference_db_tail.ts";
import {
  ExistingReferencePercentileDbReader,
  REFERENCE_CDF_BYTES_SQL,
  REFERENCE_DB_HEAD_SQL,
  REFERENCE_PK_METADATA_SQL,
} from "../../supabase/functions/_shared/jungsi/infrastructure/reference_percentile_postgres.ts";
import { RuntimeReadBudget } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import { Rational } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type { NativeSqlTransaction } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
const H = (s: string) => s.repeat(64), owner = "00000000-0000-0000-0000-000000000001";
async function sha(b: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(b)))].map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
}
async function denied(f: () => Promise<unknown>) {
  let ok = false;
  try {
    await f();
  } catch {
    ok = true;
  }
  assert(ok);
}
async function fixture() {
  const rows = [[100, "2"], [200, "3"], [300, "1"]],
    methodId = "estimated-whole-cohort-percentile:" + H("b"),
    release = "reference-percentile:" + H("c");
  const doc = {
    academic_year: 2027,
    exam_id: "exam",
    exam_type: "september_mock",
    source_rule_id: "rule",
    model_references: { pack: { sha256: H("a") } },
    engine_approved: false,
    production_allowed: false,
    data_kind: "fixed_mock_model_reference_not_actual_admission",
    actual_2027_csat_available: false,
    support_bin_count: 3,
    eligible_weight_units: "6",
    weight_decimal_scale: 0,
    whole_model_weight: "10",
    whole_model_weight_units: "10",
    score_denominator: 100,
    frequencies_numerator_integer_weight: rows,
  };
  const method: NativeObject = {
    method_id: methodId,
    metric: "estimated_upper_cumulative_percent_all_examinees",
    native_score_and_source_definition_metadata: {
      academic_year: 2027,
      source_rule_id: "rule",
      score_denominator: 100,
      engine_approved: false,
      reference_curve_id: "curve",
    },
    binding: {
      projection_arguments: {
        expected_curve_id: "curve",
        eligible_weight_units: "6",
        weight_decimal_scale: 0,
        whole_model_weight_decimal: "10",
      },
    },
  };
  const raw = new TextEncoder().encode(JSON.stringify(doc)),
    methodRaw = new TextEncoder().encode(JSON.stringify(method));
  const gzip = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")))
      .arrayBuffer(),
  );
  const cdf = await sha(raw),
    gz = await sha(gzip),
    methodSha = await sha(methodRaw),
    control = new AbortController();
  const head: unknown[] = [release, H("d"), H("e")];
  const row: unknown[] = [
    release,
    H("d"),
    H("e"),
    "2027",
    "db-pk",
    methodId,
    methodSha,
    cdf,
    new TextDecoder().decode(methodRaw),
    String(raw.length),
    gz,
    String(gzip.length),
    "gzip",
    H("c"),
  ];
  const state = {
    row,
    head,
    hasSelection: true,
    compatible: true,
    sourceRuleId: "rule" as string | null,
    sourceReads: 0,
    headReads: 0,
    metadataReads: 0,
  };
  const sql = {
    async read<T>(
      who: string,
      work: (tx: NativeSqlTransaction) => Promise<T>,
      signal?: AbortSignal,
    ) {
      if (who !== owner || signal?.aborted) throw Error("scope");
      return await work({
        async query(q, _params, s) {
          if (s?.aborted) throw Error("abort");
          if (q === REFERENCE_PK_METADATA_SQL) {
            state.metadataReads++;
            return [state.row];
          }
          if (q === REFERENCE_DB_HEAD_SQL) {
            state.headReads++;
            return [state.head];
          }
          if (q === REFERENCE_CDF_BYTES_SQL) {
            state.sourceReads++;
            return [[btoa(String.fromCharCode(...gzip))]];
          }
          throw Error("unknown");
        },
      });
    },
  };
  const budget = new RuntimeReadBudget({ maxRequests: 50, maxBytes: 100000 });
  const reader = new ExistingReferencePercentileDbReader(
    sql,
    { reserveExternalRead: (n) => budget.reserveExternal(n) },
    4096,
    8388608,
    100000,
  );
  const context: NativeObject = {
    academic_year: 2027,
    exam_id: "exam",
    exam_type: "september_mock",
    source_pack_version: "pack",
    rule_version: "rule",
    score_scale_id: "axis",
  };
  const pin = {
    key: "selected",
    sha256: H("4"),
    bytes: raw.length + 7,
    maxBytes: raw.length + 7,
    releaseSha256: H("1"),
    selectionSha256: H("2"),
    compatibilitySha256: H("3"),
    binding: { offering_id: "public", physical_offering_pk: "db-pk", academic_year: 2027 },
    context,
    evidence: { source_cdf_sha256: cdf },
  };
  const identity: NativeObject = { ...context, offering_id: "public" };
  const authority = {
    async select(id: string) {
      if (id !== "public") throw Error("id");
      return state.hasSelection ? pin : null;
    },
    async assertCurrent(_p: unknown, s: AbortSignal) {
      if (s.aborted) throw Error("abort");
    },
    async assertCompatible(_p: unknown, i: Readonly<NativeObject>, s: AbortSignal) {
      if (s.aborted || !state.compatible || i.offering_id !== "public") throw Error("mismatch");
    },
    async verifiedProvenance(_p: unknown, i: Readonly<NativeObject>, s: AbortSignal) {
      if (s.aborted || !state.compatible) throw Error("mismatch");
      return {
        ...i,
        release_sha256: H("1"),
        selection_sha256: H("2"),
        tail_sha256: cdf,
        compatibility_sha256: H("3"),
      };
    },
    modelExamPackSha256() {
      return H("a");
    },
    async sourceRuleId(_p: unknown, s: AbortSignal) {
      if (s.aborted) throw Error("abort");
      return state.sourceRuleId;
    },
  };
  const adapter = new PinnedExistingDbReferenceTailSource(
    owner,
    authority,
    reader,
    control.signal,
    (s) => s ?? control.signal,
    8,
    8388608,
  );
  return { adapter, authority, budget, control, identity, pin, state };
}
Deno.test("existing DB reference adapter binds physical PK and calculates with verified source", async () => {
  const f = await fixture(), v = await f.adapter.getNativeReferenceTail("public", f.control.signal);
  assert(v !== null);
  await v.assertCompatible(f.identity, f.control.signal);
  equal(
    (await v.projection.query(new Rational(2n), f.identity, f.control.signal))
      ?.estimated_upper_cumulative_percent_all_examinees,
    "40.000000000000",
  );
  const proof = await v.verifiedProvenance!(f.identity, f.control.signal);
  equal(proof.tail_sha256, f.pin.evidence.source_cdf_sha256);
  f.adapter.assertSettled(f.control.signal);
  equal(f.state.metadataReads, 1);
  equal(f.state.sourceReads, 1);
  equal(f.state.headReads, 1);
  assert(await f.adapter.getNativeReferenceTail("public", f.control.signal) === v);
});
Deno.test("missing selection is pending and mismatched CDF fails without reading source", async () => {
  const a = await fixture();
  a.state.hasSelection = false;
  equal(await a.adapter.getNativeReferenceTail("public", a.control.signal), null);
  equal(a.state.metadataReads, 0);
  const b = await fixture();
  b.pin.evidence.source_cdf_sha256 = H("f");
  await denied(() => b.adapter.getNativeReferenceTail("public", b.control.signal));
  equal(b.state.sourceReads, 0);
});
Deno.test("DB reference adapter rejects unverified model compatibility and aborted delivery", async () => {
  const f = await fixture(), v = await f.adapter.getNativeReferenceTail("public", f.control.signal);
  assert(v !== null);
  f.state.compatible = false;
  await denied(() => v.assertCompatible(f.identity, f.control.signal));
  f.control.abort();
  await denied(async () => f.adapter.assertSettled(f.control.signal));
});
Deno.test("DB head check rejects changed release after current receipt expires", async () => {
  const f = await fixture();
  const actual = performance.now.bind(performance);
  let now = 100;
  Object.defineProperty(performance, "now", { value: () => now, configurable: true });
  try {
    const v = await f.adapter.getNativeReferenceTail("public", f.control.signal);
    assert(v !== null);
    now += 1500;
    f.state.head[0] = "reference-percentile:" + H("f");
    await denied(() => v.assertCurrent(f.control.signal));
    equal(f.state.headReads, 2);
  } finally {
    Object.defineProperty(performance, "now", { value: actual, configurable: true });
  }
});

Deno.test("existing DB CDF rejects a selected exam pack with a different content hash", async () => {
  const f = await fixture();
  f.authority.modelExamPackSha256 = () => H("f");
  await denied(() => f.adapter.getNativeReferenceTail("public", f.control.signal));
  equal(f.state.sourceReads, 1);
});

Deno.test("DB adapter uses selected source rule independently from calculator version", async () => {
  const f = await fixture();
  f.pin.context.rule_version = "calculator-v1";
  f.state.sourceRuleId = "rule";
  f.identity.rule_version = "calculator-v1";
  const v = await f.adapter.getNativeReferenceTail("public", f.control.signal);
  assert(v !== null);
  await v.assertCompatible(f.identity, f.control.signal);
  equal(
    (await v.projection.query(new Rational(2n), f.identity, f.control.signal))
      ?.estimated_upper_cumulative_percent_all_examinees,
    "40.000000000000",
  );
  const wrong = await fixture();
  wrong.state.sourceRuleId = "wrong-source";
  await denied(() => wrong.adapter.getNativeReferenceTail("public", wrong.control.signal));
  const missing = await fixture();
  missing.state.sourceRuleId = null;
  await denied(() => missing.adapter.getNativeReferenceTail("public", missing.control.signal));
  equal(missing.state.metadataReads, 0);
});
