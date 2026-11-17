// deno-lint-ignore-file no-explicit-any require-await
import { assert, equal } from "./fixture.ts";
import {
  cloneNativeJson,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import { SavedReferenceTailProjection } from "../../supabase/functions/_shared/jungsi/domain/saved_reference_projection.ts";
import { UniversityScoringService } from "../../supabase/functions/_shared/jungsi/application/university_scoring.ts";
import { SchoolReferenceScoringService } from "../../supabase/functions/_shared/jungsi/application/school_reference_scoring.ts";
import { PinnedSchoolReferenceSource } from "../../supabase/functions/_shared/jungsi/infrastructure/school_reference_source.ts";
import { SyntheticReferenceBytes } from "./synthetic_school_reference.ts";
import { ReferencePercentileService } from "../../supabase/functions/_shared/jungsi/application/reference_percentile.ts";
function fixture(): NativeObject {
  return {
    format: "jungsi.saved-reference-tail-projection/v1",
    version: "SYNTHETIC-tail.v1",
    context: {
      academic_year: 2027,
      exam_id: "SYNTHETIC-mock",
      exam_type: "september_mock",
      source_pack_version: "SYNTHETIC-pack",
      model_version: "SYNTHETIC-model",
      profile_sha256: "a".repeat(64),
      rule_version: "SYNTHETIC-rule",
      score_scale_id: "SYNTHETIC-native",
      reference_curve_id: "SYNTHETIC-curve",
      weight_encoding: "SYNTHETIC_EXPLICIT_ENCODING",
      source_scenario_field_present: false,
      source_scenario_value: null,
      resolved_model_scenario: "SYNTHETIC-fixed",
    },
    evidence: Object.fromEntries(
      [
        "source_csv_sha256",
        "source_cdf_sha256",
        "definition_sha256",
        "shared_proof_sha256",
        "binder_sha256",
        "independent_sha256",
      ].map((k) => [k, "b".repeat(64)]),
    ),
    projection: {
      derived_method_id: "estimated-whole-cohort-percentile:" + "d".repeat(64),
      weight_decimal_scale: 1,
      eligible_weight_units: "15",
      whole_mass_decimal: "3.00001",
      whole_mass_numerator: "300001",
      whole_mass_denominator: "100000",
      production_allowed: false,
      actual_admission_full_total_approved: false,
    },
    rows: [{
      score_numerator: "10",
      score_denominator: "1",
      strict_weight_units: "5",
      tie_weight_units: "10",
      inclusive_weight_units: "15",
    }, {
      score_numerator: "20",
      score_denominator: "1",
      strict_weight_units: "0",
      tie_weight_units: "5",
      inclusive_weight_units: "5",
    }],
  };
}
async function bind(p = fixture()) {
  const bytes = new TextEncoder().encode(nativeJsonText(p));
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
  const pin = {
    sha256,
    bytes: bytes.length,
    maxBytes: 65536,
    context: p.context as NativeObject,
    evidence: p.evidence as NativeObject,
  };
  return { curve: await SavedReferenceTailProjection.bind(bytes, pin), bytes, pin };
}

async function setup() {
  const b = new SyntheticReferenceBytes(), pack = cloneNativeJson(b.university.rawPack);
  (pack.exam as NativeObject).exam_type = "september_mock";
  b.university.pack = new NativeExamPack(pack);
  b.body.exam_type = "september_mock";
  await b.seal();
  b.university.bundle = null;
  const reference = new PinnedSchoolReferenceSource(b), profile = b.university.profile();
  (profile.scores.inquiry as NativeObject[])[0].percentile = 31;
  (profile.scores.inquiry as NativeObject[])[1].percentile = 17;
  const conversion = await new UniversityScoringService(
    b.university,
    new SchoolReferenceScoringService(reference),
  ).calculate(b.university.offering, profile);
  const p = fixture(), c = p.context as NativeObject;
  c.exam_id = b.university.pack.examId;
  c.source_pack_version = b.university.pack.packVersion;
  c.rule_version = (b.body.rule as NativeObject).rule_version;
  c.score_scale_id = b.body.score_scale_id;
  (p.rows as NativeObject[])[1].score_numerator = "50";
  const { curve } = await bind(p),
    binding: NativeObject = {
      ...cloneNativeJson((b.body.bindings as NativeObject[])[0]),
      offering_id: b.university.offering.offering_id,
    };
  let current = true;
  const source = {
    getExamPack: b.university.getExamPack.bind(b.university),
    getConversion: b.university.getConversion.bind(b.university),
    getReference: reference.getReference.bind(reference),
    async getReferenceTail() {
      return {
        projection: curve,
        binding,
        async assertCompatible() {},
        async assertCurrent() {
          if (!current) throw new Error("stale");
        },
      };
    },
  };
  return {
    b,
    profile,
    conversion,
    source,
    binding,
    stale() {
      current = false;
    },
  };
}
import {
  createScopedReferenceTailSources,
  PinnedChunkedReferenceTailSource,
} from "../../supabase/functions/_shared/jungsi/infrastructure/chunked_reference_tail_source.ts";
import {
  PinnedSavedReferenceTailSource,
  SavedTailRequestBudget,
} from "../../supabase/functions/_shared/jungsi/infrastructure/saved_reference_tail_source.ts";
import { Rational } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";

async function hashBytes(raw: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(raw)))]
    .map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function chunkFixture() {
  const x = await setup(),
    p = fixture(),
    c = p.context as NativeObject,
    a = p.projection as NativeObject;
  c.exam_id = x.b.university.pack!.examId;
  c.source_pack_version = x.b.university.pack!.packVersion;
  c.rule_version = (x.b.body.rule as NativeObject).rule_version;
  c.score_scale_id = x.b.body.score_scale_id;
  c.weight_encoding = "original_unit_weight_integer";
  a.weight_decimal_scale = 0;
  a.eligible_weight_units = "15";
  a.whole_mass_decimal = "30";
  a.whole_mass_numerator = "30";
  a.whole_mass_denominator = "1";
  const contextHash = await hashBytes(new TextEncoder().encode(nativeJsonText(c, true)));
  const items: any[] = [[[100, "10"]], [[500, "5"]]],
    objects = new Map<string, Uint8Array>(),
    descriptors: any[] = [];
  const enc = (v: NativeObject) => new TextEncoder().encode(nativeJsonText(v));
  for (let i = 0; i < 2; i++) {
    const key = "synthetic/chunk-" + i,
      raw = enc({
        format: "jungsi.saved-reference-tail-chunk/v1",
        version: "SYNTHETIC-tail.v1",
        ordinal: i,
        context_sha256: contextHash,
        score_denominator: 10,
        frequencies: items[i],
      });
    objects.set(key, raw);
    descriptors.push({
      ordinal: i,
      key,
      sha256: await hashBytes(raw),
      bytes: raw.length,
      row_count: 1,
      min_score_numerator: i ? 500 : 100,
      max_score_numerator: i ? 500 : 100,
      weight_units: i ? "5" : "10",
      strict_above_units: i ? "0" : "5",
    });
  }
  const index = enc({
    format: "jungsi.saved-reference-tail-index/v1",
    version: "SYNTHETIC-tail.v1",
    context: c,
    evidence: p.evidence,
    projection: a,
    context_sha256: contextHash,
    score_denominator: 10,
    chunks: descriptors,
  });
  objects.set("synthetic/index", index);
  const controller = new AbortController(), reads: string[] = [];
  let current = true, compatible = true, revokeOnChunk = false;
  const pin = (id: string) => ({
    key: "synthetic/index",
    sha256: indexSha,
    bytes: index.length,
    maxBytes: 8388608,
    releaseSha256: "c".repeat(64),
    selectionSha256: "a".repeat(64),
    compatibilitySha256: "d".repeat(64),
    context: c,
    evidence: p.evidence as NativeObject,
    binding: { ...x.binding, offering_id: id },
  });
  const indexSha = await hashBytes(index);
  const port = {
    select: async (id: string) => pin(id),
    selectChunked: async (id: string) => pin(id),
    readChunk: async (
      parent: ReturnType<typeof pin>,
      indexBytes: Uint8Array,
      key: string,
      max: number,
      signal: AbortSignal,
    ) => {
      if (
        signal.aborted || parent.sha256 !== await hashBytes(indexBytes) ||
        !key.startsWith("synthetic/chunk-")
      ) throw new Error("bad child");
      const raw = objects.get(key);
      if (!raw || raw.length !== max) throw new Error("bad child");
      reads.push(key);
      if (revokeOnChunk) current = false;
      return raw;
    },
    read: async (key: string, max: number, signal: AbortSignal) => {
      if (signal.aborted) throw new Error("cancelled");
      const raw = objects.get(key);
      if (!raw || raw.length !== max) throw new Error("invalid read");
      reads.push(key);
      if (revokeOnChunk && key.includes("chunk-")) current = false;
      return raw;
    },
    assertCurrent: async (_p: unknown, signal: AbortSignal) => {
      if (!current || signal.aborted) throw new Error("stale");
    },
    assertCompatible: async (
      selected: ReturnType<typeof pin>,
      identity: Readonly<NativeObject>,
      signal: AbortSignal,
    ) => {
      if (!compatible || signal.aborted || identity.offering_id !== selected.binding.offering_id) {
        throw new Error("incompatible");
      }
    },
  };
  return {
    x,
    c,
    index,
    objects,
    port,
    pin,
    controller,
    reads,
    stop: () => {
      current = false;
    },
    incompatible: () => {
      compatible = false;
    },
    revokeDuringChunk: () => {
      revokeOnChunk = true;
    },
  };
}
async function rejected(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error("expected fail");
}

Deno.test("chunk selector reaches existing reference service and reuses exact conversion", async () => {
  const f = await chunkFixture(), budget = new SavedTailRequestBudget(4, 1048576);
  const reader = new PinnedChunkedReferenceTailSource(
    f.port,
    f.controller.signal,
    4,
    1048576,
    (s) => s ?? f.controller.signal,
    budget,
  );
  const source = {
    ...f.x.source,
    getReferenceTail: async () => null,
    getChunkedReferenceTail: reader.getChunkedReferenceTail.bind(reader),
  };
  const service = new ReferencePercentileService(source);
  const result = await service.calculate(f.x.b.university.offering, f.x.conversion, f.x.profile);
  equal(result.status, "reference_estimated");
  equal(result.estimated_upper_cumulative_percent_all_examinees, "16.666666666667");
  equal(result.production_allowed, false);
  equal(result.actual_admission_full_total_approved, false);
  assert(!Object.hasOwn(result, "reference_curve_id"));
  assert(!Object.hasOwn(result, "derived_method_id"));
  equal(f.reads, ["synthetic/index", "synthetic/chunk-1"]);
  const again = await service.calculate(f.x.b.university.offering, f.x.conversion, f.x.profile);
  equal(again.status, "reference_estimated");
  equal(f.reads.length, 2);
});
Deno.test("chunk selector absence preserves the existing v1 service", async () => {
  const f = await chunkFixture(), budget = new SavedTailRequestBudget(4, 1048576);
  const port = { ...f.port, selectChunked: async (_id: string) => null };
  const reader = new PinnedChunkedReferenceTailSource(
    port,
    f.controller.signal,
    4,
    1048576,
    (s) => s ?? f.controller.signal,
    budget,
  );
  const source = {
    ...f.x.source,
    getChunkedReferenceTail: reader.getChunkedReferenceTail.bind(reader),
  };
  const result = await new ReferencePercentileService(source).calculate(
    f.x.b.university.offering,
    f.x.conversion,
    f.x.profile,
  );
  equal(result.estimated_upper_cumulative_percent_all_examinees, "16.666611111296");
  equal(f.reads.length, 0);
});
Deno.test("chunk service fails closed on compatibility and revoked head", async () => {
  let f = await chunkFixture(), budget = new SavedTailRequestBudget(4, 1048576);
  let reader = new PinnedChunkedReferenceTailSource(
    f.port,
    f.controller.signal,
    4,
    1048576,
    (s) => s ?? f.controller.signal,
    budget,
  );
  f.incompatible();
  let source = {
    ...f.x.source,
    getReferenceTail: async () => null,
    getChunkedReferenceTail: reader.getChunkedReferenceTail.bind(reader),
  };
  let r = await new ReferencePercentileService(source).calculate(
    f.x.b.university.offering,
    f.x.conversion,
    f.x.profile,
  );
  equal(r.status, "pending");
  equal(f.reads, ["synthetic/index"]);
  f = await chunkFixture();
  budget = new SavedTailRequestBudget(4, 1048576);
  reader = new PinnedChunkedReferenceTailSource(
    f.port,
    f.controller.signal,
    4,
    1048576,
    (s) => s ?? f.controller.signal,
    budget,
  );
  f.revokeDuringChunk();
  source = {
    ...f.x.source,
    getReferenceTail: async () => null,
    getChunkedReferenceTail: reader.getChunkedReferenceTail.bind(reader),
  };
  r = await new ReferencePercentileService(source).calculate(
    f.x.b.university.offering,
    f.x.conversion,
    f.x.profile,
  );
  equal(r.status, "pending");
  equal(f.reads.length, 2);
});
Deno.test("chunk and existing v1 reader share one request object budget", async () => {
  const f = await chunkFixture(), budget = new SavedTailRequestBudget(2, 1048576);
  const chunks = new PinnedChunkedReferenceTailSource(
    f.port,
    f.controller.signal,
    2,
    1048576,
    (s) => s ?? f.controller.signal,
    budget,
  );
  const chosen = await chunks.getChunkedReferenceTail("one");
  assert(chosen);
  await chosen.projection.query(new Rational(50n), { ...f.c, offering_id: "one" });
  const old = await bind(),
    oldPin = {
      ...old.pin,
      key: "synthetic/old",
      releaseSha256: "e".repeat(64),
      selectionSha256: "a".repeat(64),
      compatibilitySha256: "f".repeat(64),
      binding: { offering_id: "one" },
    };
  let oldReads = 0;
  const oldPort = {
    select: async (_id: string) => oldPin,
    read: async () => {
      oldReads++;
      return old.bytes;
    },
    assertCurrent: async () => {},
    assertCompatible: async () => {},
  };
  const v1 = new PinnedSavedReferenceTailSource(
    oldPort,
    f.controller.signal,
    2,
    1048576,
    undefined,
    budget,
  );
  await rejected(() => v1.getReferenceTail("one"));
  equal(oldReads, 0);
  equal(f.reads.length, 2);
});
Deno.test("chunk byte and offering binding limits fail before unbudgeted read", async () => {
  const f = await chunkFixture(),
    part = f.objects.get("synthetic/chunk-1")!,
    limit = f.index.length + part.length - 1;
  const budget = new SavedTailRequestBudget(4, limit),
    reader = new PinnedChunkedReferenceTailSource(
      f.port,
      f.controller.signal,
      4,
      limit,
      (s) => s ?? f.controller.signal,
      budget,
    );
  const selected = await reader.getChunkedReferenceTail("one");
  assert(selected);
  await rejected(() =>
    selected.projection.query(new Rational(50n), { ...f.c, offering_id: "one" })
  );
  equal(f.reads, ["synthetic/index"]);
  const aborted = new AbortController();
  aborted.abort();
  await rejected(() => reader.getChunkedReferenceTail("one", aborted.signal));
});
Deno.test("separate offerings have separate bound chunk projections under shared budget", async () => {
  const f = await chunkFixture(), budget = new SavedTailRequestBudget(4, 1048576);
  const reader = new PinnedChunkedReferenceTailSource(
    f.port,
    f.controller.signal,
    4,
    1048576,
    (s) => s ?? f.controller.signal,
    budget,
  );
  const one = await reader.getChunkedReferenceTail("one"),
    two = await reader.getChunkedReferenceTail("two");
  assert(one && two);
  await one.projection.query(new Rational(50n), { ...f.c, offering_id: "one" });
  await two.projection.query(new Rational(50n), { ...f.c, offering_id: "two" });
  // 2026-11-17 운영 CPU 초과 수정: 같은 요청 범위에서는 색인과 해석된 조각을 학과끼리 나눠 쓴다(색인 1 + 조각 1).
  // 학과별 결속은 그대로 분리되어 다른 학과 식별자로는 질의할 수 없다(아래).
  equal(f.reads.length, 2);
  await rejected(() => one.projection.query(new Rational(50n), { ...f.c, offering_id: "two" }));
});

Deno.test("scoped provider factory shares one enforced budget across both encodings", async () => {
  const f = await chunkFixture(),
    old = await bind(),
    oldPin = {
      ...old.pin,
      key: "synthetic/old-factory",
      releaseSha256: "e".repeat(64),
      selectionSha256: "a".repeat(64),
      compatibilitySha256: "f".repeat(64),
      binding: { offering_id: "one" },
    };
  let oldReads = 0;
  const port = {
    ...f.port,
    select: async (_id: string) => oldPin,
    read: async (key: string, max: number, signal: AbortSignal) => {
      if (key === "synthetic/old-factory") {
        oldReads++;
        return old.bytes;
      }
      return await f.port.read(key, max, signal);
    },
  };
  const shared = createScopedReferenceTailSources(
    port,
    f.controller.signal,
    2,
    1048576,
    (s) => s ?? f.controller.signal,
  );
  const selected = await shared.getChunkedReferenceTail("one");
  assert(selected);
  await selected.projection.query(new Rational(50n), { ...f.c, offering_id: "one" });
  await rejected(() => shared.getReferenceTail("one"));
  equal(oldReads, 0);
  equal(f.reads.length, 2);
});

Deno.test("chunk selection reuses canonical scope signal through issuer and cancellation", async () => {
  const f = await chunkFixture(), branch = new AbortController();
  const canonical = AbortSignal.any([f.controller.signal, branch.signal]), seen: AbortSignal[] = [];
  const port = {
    ...f.port,
    selectChunked: async (id: string, s: AbortSignal) => {
      seen.push(s);
      return await f.port.selectChunked(id);
    },
    readChunk: async (
      p: ReturnType<typeof f.pin>,
      idx: Uint8Array,
      k: string,
      n: number,
      s: AbortSignal,
    ) => {
      seen.push(s);
      return await f.port.readChunk(p, idx, k, n, s);
    },
    assertCurrent: async (p: unknown, s: AbortSignal) => {
      seen.push(s);
      return await f.port.assertCurrent(p, s);
    },
    assertCompatible: async (
      p: ReturnType<typeof f.pin>,
      i: Readonly<NativeObject>,
      s: AbortSignal,
    ) => {
      seen.push(s);
      return await f.port.assertCompatible(p, i, s);
    },
  };
  const budget = new SavedTailRequestBudget(4, 1048576),
    resolver = (s?: AbortSignal) => {
      if (s !== branch.signal) throw new Error("wrong scope");
      return canonical;
    };
  const reader = new PinnedChunkedReferenceTailSource(
    port,
    f.controller.signal,
    4,
    1048576,
    resolver,
    budget,
  );
  const selected = await reader.getChunkedReferenceTail("one", branch.signal);
  assert(selected);
  await selected.projection.query(new Rational(50n), { ...f.c, offering_id: "one" });
  assert(seen.length >= 4 && seen.every((x) => x === canonical));
  branch.abort();
  await rejected(() =>
    selected.projection.query(new Rational(50n), { ...f.c, offering_id: "one" })
  );
});
Deno.test("chunk issuer is passed the selected parent index and rejects wrong provenance", async () => {
  const f = await chunkFixture(), budget = new SavedTailRequestBudget(4, 1048576);
  let invalid = false;
  const port = {
    ...f.port,
    verifiedProvenance: async (
      pin: ReturnType<typeof f.pin>,
      identity: Readonly<NativeObject>,
      signal: AbortSignal,
    ) => {
      if (signal.aborted) throw new Error("cancelled");
      return {
        release_sha256: pin.releaseSha256,
        selection_sha256: invalid ? "0".repeat(64) : pin.selectionSha256,
        tail_sha256: pin.sha256,
        compatibility_sha256: pin.compatibilitySha256,
        academic_year: identity.academic_year,
        exam_id: identity.exam_id,
        source_pack_version: identity.source_pack_version,
        rule_version: identity.rule_version,
        score_scale_id: identity.score_scale_id,
        offering_id: identity.offering_id,
      };
    },
  };
  const reader = new PinnedChunkedReferenceTailSource(
    port,
    f.controller.signal,
    4,
    1048576,
    (s) => s ?? f.controller.signal,
    budget,
  );
  const selected = await reader.getChunkedReferenceTail("one");
  assert(selected && selected.verifiedProvenance);
  const identity = { ...f.c, offering_id: "one" };
  await selected.projection.query(new Rational(50n), identity);
  const proof = await selected.verifiedProvenance(identity);
  equal(proof.selection_sha256, "a".repeat(64));
  invalid = true;
  await rejected(() => selected.verifiedProvenance!(identity));
});
Deno.test("abort stops an in-flight chunk read using the scoped signal", async () => {
  const f = await chunkFixture(),
    branch = new AbortController(),
    canonical = AbortSignal.any([f.controller.signal, branch.signal]);
  let started: () => void = () => {};
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const port = {
    ...f.port,
    readChunk: async (
      _p: ReturnType<typeof f.pin>,
      _i: Uint8Array,
      _k: string,
      _n: number,
      signal: AbortSignal,
    ) => {
      started();
      return await new Promise<Uint8Array>((_resolve, reject) => {
        if (signal.aborted) reject(new Error("aborted"));
        else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  };
  const budget = new SavedTailRequestBudget(4, 1048576),
    reader = new PinnedChunkedReferenceTailSource(
      port,
      f.controller.signal,
      4,
      1048576,
      () => canonical,
      budget,
    );
  const selected = await reader.getChunkedReferenceTail("one", branch.signal);
  assert(selected);
  const pending = selected.projection.query(new Rational(50n), { ...f.c, offering_id: "one" });
  await ready;
  branch.abort();
  await rejected(() => pending);
});
