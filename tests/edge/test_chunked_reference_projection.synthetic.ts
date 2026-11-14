// deno-lint-ignore-file no-explicit-any require-await
/** Invented scores and weights only. No production data or deployment. */
import { ChunkedReferenceTailProjection } from "../../supabase/functions/_shared/jungsi/domain/chunked_reference_projection.ts";
import { Rational } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

function eq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error("synthetic mismatch");
  }
}
async function rejects(f: () => Promise<unknown>) {
  try {
    await f();
  } catch {
    return;
  }
  throw new Error("expected rejection");
}
const bytes = (o: NativeObject) => new TextEncoder().encode(nativeJsonText(o) + "\n");
async function hash(b: Uint8Array) {
  return [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b))),
  ].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function fixture(
  changeIndex?: (x: any) => void,
  changeParts?: (x: any[]) => void,
) {
  const context: NativeObject = {
    academic_year: 2027,
    exam_id: "SYNTHETIC-mock",
    exam_type: "september_mock",
    source_pack_version: "SYNTHETIC-pack",
    model_version: "SYNTHETIC-model",
    profile_sha256: "a".repeat(64),
    rule_version: "SYNTHETIC-rule",
    score_scale_id: "SYNTHETIC-scale",
    reference_curve_id: "SYNTHETIC-curve",
    weight_encoding: "original_unit_weight_integer",
    source_scenario_field_present: false,
    source_scenario_value: null,
    resolved_model_scenario: "base",
  };
  const evidence: NativeObject = Object.fromEntries(
    [
      "source_csv_sha256",
      "source_cdf_sha256",
      "definition_sha256",
      "shared_proof_sha256",
      "binder_sha256",
      "independent_sha256",
    ].map((x) => [x, "b".repeat(64)]),
  );
  const contextSha = await hash(
    new TextEncoder().encode(nativeJsonText(context, true)),
  );
  const parts: any[] = [[[10, "2"], [20, "1"]], [[40, "2"]]];
  if (changeParts) changeParts(parts);
  const objects = new Map<string, Uint8Array>(), descriptors: any[] = [];
  for (let i = 0; i < 2; i++) {
    const key = "synthetic/chunk" + i;
    const raw = bytes({
      format: "jungsi.saved-reference-tail-chunk/v1",
      version: "SYNTHETIC-v1",
      ordinal: i,
      context_sha256: contextSha,
      score_denominator: 10,
      frequencies: parts[i],
    });
    objects.set(key, raw);
    descriptors.push({
      ordinal: i,
      key,
      sha256: await hash(raw),
      bytes: raw.length,
      row_count: i === 0 ? 2 : 1,
      min_score_numerator: i === 0 ? 10 : 40,
      max_score_numerator: i === 0 ? 20 : 40,
      weight_units: i === 0 ? "3" : "2",
      strict_above_units: i === 0 ? "2" : "0",
    });
  }
  const index: any = {
    format: "jungsi.saved-reference-tail-index/v1",
    version: "SYNTHETIC-v1",
    context,
    evidence,
    projection: {
      derived_method_id: "estimated-whole-cohort-percentile:" + "c".repeat(64),
      weight_decimal_scale: 0,
      eligible_weight_units: "5",
      whole_mass_decimal: "10",
      whole_mass_numerator: "10",
      whole_mass_denominator: "1",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    },
    context_sha256: contextSha,
    score_denominator: 10,
    chunks: descriptors,
  };
  if (changeIndex) changeIndex(index);
  const root = bytes(index);
  objects.set("synthetic/index", root);
  const pin = {
    key: "synthetic/index",
    sha256: await hash(root),
    bytes: root.length,
    maxBytes: 8388608,
    releaseSha256: "d".repeat(64),
    selectionSha256: "f".repeat(64),
    compatibilitySha256: "e".repeat(64),
    context,
    evidence,
    binding: { offering_id: "SYNTHETIC-one" },
  };
  return { pin, root, objects, context };
}

function authority(
  f: Awaited<ReturnType<typeof fixture>>,
  options: { budget?: number; head?: boolean; compatible?: boolean } = {},
) {
  const controller = new AbortController(), reads: string[] = [];
  let used = 0;
  const port = {
    select: async (_id: string) => f.pin,
    read: async (key: string, maximum: number, signal: AbortSignal) => {
      const b = f.objects.get(key);
      if (
        signal.aborted || !b || b.length !== maximum ||
        used + maximum > (options.budget ?? 1e9)
      ) throw new Error("budget");
      used += maximum;
      reads.push(key);
      return b;
    },
    assertCurrent: async (_pin: unknown, signal: AbortSignal) => {
      if (signal.aborted || options.head === false) throw new Error("head");
    },
    assertCompatible: async (
      _pin: unknown,
      _i: Readonly<NativeObject>,
      signal: AbortSignal,
    ) => {
      if (signal.aborted || options.compatible === false) {
        throw new Error("compatibility");
      }
    },
  };
  const open = async (id = "SYNTHETIC-one") => {
    const raw = await port.read(f.pin.key, f.pin.bytes, controller.signal);
    return await ChunkedReferenceTailProjection.bind(
      raw,
      f.pin,
      port,
      controller.signal,
      4 * 1024 * 1024,
      id,
    );
  };
  return { port, reads, controller, open };
}
function pct(x: NativeObject | null) {
  return x?.estimated_upper_cumulative_percent_all_examinees ?? null;
}

Deno.test("chunked values preserve points, ties, gaps and bounds", async () => {
  const f = await fixture(), a = authority(f), p = await a.open();
  for (
    const [n, d, want] of [
      [0, 1, null],
      [1, 1, "50.000000000000"],
      [3, 2, "30.000000000000"],
      [2, 1, "30.000000000000"],
      [3, 1, "20.000000000000"],
      [4, 1, "20.000000000000"],
      [5, 1, null],
    ] as const
  ) {
    eq(pct(await p.query(new Rational(BigInt(n), BigInt(d)), f.context)), want);
  }
  eq(a.reads, ["synthetic/index", "synthetic/chunk0", "synthetic/chunk1"]);
});
Deno.test("a point reads only index and its one chunk", async () => {
  const f = await fixture(), a = authority(f), p = await a.open();
  eq(pct(await p.query(new Rational(4n), f.context)), "20.000000000000");
  eq(a.reads, ["synthetic/index", "synthetic/chunk1"]);
  await p.query(new Rational(4n), f.context);
  eq(a.reads, ["synthetic/index", "synthetic/chunk1"]);
});
Deno.test("outside support reads only the index", async () => {
  const f = await fixture(), a = authority(f), p = await a.open();
  eq(await p.query(new Rational(0n), f.context), null);
  eq(a.reads, ["synthetic/index"]);
});
Deno.test("tampered chunk is rejected despite unchanged length", async () => {
  const f = await fixture(), a = authority(f), p = await a.open();
  const raw = f.objects.get("synthetic/chunk0")!.slice();
  raw[raw.length - 3] ^= 1;
  f.objects.set("synthetic/chunk0", raw);
  await rejects(() => p.query(new Rational(1n), f.context));
});
Deno.test("index structural guards reject invalid ranges, mass, size and release", async () => {
  const changes = [
    (x: any) => x.chunks[1].ordinal = 0,
    (x: any) => x.chunks[1].min_score_numerator = 20,
    (x: any) => x.chunks[0].strict_above_units = "3",
    (x: any) => x.chunks[0].row_count = 100001,
    (x: any) => x.projection.production_allowed = true,
    (x: any) => x.context_sha256 = "f".repeat(64),
    (x: any) => x.chunks[0].key = x.chunks[1].key,
  ];
  for (const change of changes) {
    const f = await fixture(change), a = authority(f);
    await rejects(() => a.open());
  }
});
Deno.test("binding, head, compatibility, abort and budget remain mandatory", async () => {
  const f = await fixture();
  await rejects(() => authority(f).open("SYNTHETIC-other"));
  await rejects(() => authority(f, { head: false }).open());
  await rejects(() => authority(f, { budget: 1 }).open());
  const a = authority(f, { compatible: false }), p = await a.open();
  await rejects(() => p.query(new Rational(1n), f.context));
  const b = authority(f), q = await b.open();
  b.controller.abort();
  await rejects(() => q.query(new Rational(1n), f.context));
  const c = authority(f, { budget: f.pin.bytes }), r = await c.open();
  await rejects(() => r.query(new Rational(1n), f.context));
});
Deno.test("chunk native types and distinct ascending scores are enforced", async () => {
  const changes = [
    (x: any[]) => x[0][0][0] = "10",
    (x: any[]) => x[0][0][1] = 2,
    (x: any[]) => x[0][1][0] = 10,
    (x: any[]) => x[0][0][1] = "0",
  ];
  for (const change of changes) {
    const f = await fixture(undefined, change),
      a = authority(f),
      p = await a.open();
    await rejects(() => p.query(new Rational(1n), f.context));
  }
});
