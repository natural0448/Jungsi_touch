import { runtimeAnalysisDataPort } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
import type { NativeDataProvider } from "../../supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts";
import { assert, equal } from "./fixture.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
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
  const evidence = Object.fromEntries([
    "source_csv_sha256",
    "source_cdf_sha256",
    "definition_sha256",
    "shared_proof_sha256",
    "binder_sha256",
    "independent_sha256",
  ].map((k) => [k, "b".repeat(64)])) as NativeObject;
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
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))]
    .map((n) => n.toString(16).padStart(2, "0")).join("");
  let reads = 0, checks = 0, valid = true, compatible = true;
  const controller = new AbortController();
  const pin = (id: string): AuthorizedSavedTailPin => ({
    key: "synthetic/object",
    sha256,
    bytes: raw.length,
    maxBytes: 65536,
    releaseSha256: "c".repeat(64),
    selectionSha256: "e".repeat(64),
    compatibilitySha256: "d".repeat(64),
    context,
    evidence,
    binding: { offering_id: id, offering_pk: "physical-" + id },
  });
  const port = {
    async select(id: string) {
      await Promise.resolve();
      return id === "missing" ? null : pin(id);
    },
    async read(_key: string, _max: number, signal: AbortSignal) {
      await Promise.resolve();
      reads++;
      if (signal.aborted) throw new Error("cancelled");
      return raw;
    },
    async assertCurrent() {
      await Promise.resolve();
      checks++;
      if (!valid) throw new Error("revoked");
    },
    async assertCompatible(
      _p: AuthorizedSavedTailPin,
      identity: Readonly<NativeObject>,
    ) {
      await Promise.resolve();
      if (!compatible || identity.exam_id !== "SYNTHETIC-mock") {
        throw new Error("incompatible");
      }
    },
  };
  return {
    raw,
    pin,
    port,
    controller,
    reads: () => reads,
    checks: () => checks,
    revoke: () => {
      valid = false;
    },
    incompatible: () => {
      compatible = false;
    },
  };
}
async function rejects(f: () => Promise<unknown>) {
  try {
    await f();
  } catch {
    return;
  }
  throw new Error("expected rejection");
}
Deno.test("saved-tail provider shares immutable bytes only within its admitted request", async () => {
  const x = await fixture(),
    source = new PinnedSavedReferenceTailSource(
      x.port,
      x.controller.signal,
      2,
      131072,
    );
  const one = await source.getReferenceTail("one"),
    two = await source.getReferenceTail("two");
  assert(one && two);
  equal(x.reads(), 1);
  assert(x.checks() >= 4);
  equal(
    one.projection.query(exact(10), x.pin("one").context)!
      .estimated_upper_cumulative_percent_all_examinees,
    "50.000000000000",
  );
  equal(one.binding.offering_id, "one");
  equal(two.binding.offering_id, "two");
  equal(await source.getReferenceTail("missing"), null);
  await one.assertCompatible({ exam_id: "SYNTHETIC-mock" });
});
Deno.test("saved-tail provider rechecks revoked head and compatibility", async () => {
  const x = await fixture(),
    source = new PinnedSavedReferenceTailSource(
      x.port,
      x.controller.signal,
      2,
      131072,
    );
  const one = await source.getReferenceTail("one");
  assert(one);
  x.incompatible();
  await rejects(() => one.assertCompatible({ exam_id: "SYNTHETIC-mock" }));
  x.revoke();
  await rejects(() => one.assertCurrent());
});
Deno.test("saved-tail provider rejects a wrong hash or wrong offering binding", async () => {
  const x = await fixture(),
    badHash = {
      ...x.port,
      async select(id: string) {
        await Promise.resolve();
        return { ...x.pin(id), sha256: "0".repeat(64) };
      },
    };
  await rejects(() =>
    new PinnedSavedReferenceTailSource(badHash, x.controller.signal, 2, 131072)
      .getReferenceTail(
        "one",
      )
  );
  const wrongId = {
    ...x.port,
    async select(_id: string) {
      await Promise.resolve();
      return x.pin("other");
    },
  };
  await rejects(() =>
    new PinnedSavedReferenceTailSource(wrongId, x.controller.signal, 2, 131072)
      .getReferenceTail(
        "one",
      )
  );
});
Deno.test("saved-tail provider does not serve data after abort", async () => {
  const x = await fixture(),
    source = new PinnedSavedReferenceTailSource(
      x.port,
      x.controller.signal,
      2,
      131072,
    );
  const one = await source.getReferenceTail("one");
  assert(one);
  x.controller.abort();
  await rejects(() => one.assertCurrent());
  await rejects(() => source.getReferenceTail("two"));
});
Deno.test("saved-tail provider rejects differing metadata for the same object key", async () => {
  const x = await fixture(),
    port = {
      ...x.port,
      async select(id: string) {
        await Promise.resolve();
        return id === "one" ? x.pin(id) : { ...x.pin(id), compatibilitySha256: "e".repeat(64) };
      },
    };
  const source = new PinnedSavedReferenceTailSource(
    port,
    x.controller.signal,
    2,
    131072,
  );
  assert(await source.getReferenceTail("one"));
  await rejects(() => source.getReferenceTail("two"));
});
Deno.test("saved-tail provider enforces request cache object count", async () => {
  const x = await fixture(),
    port = {
      ...x.port,
      async select(id: string) {
        await Promise.resolve();
        return { ...x.pin(id), key: id };
      },
    };
  const source = new PinnedSavedReferenceTailSource(
    port,
    x.controller.signal,
    1,
    131072,
  );
  assert(await source.getReferenceTail("one"));
  await rejects(() => source.getReferenceTail("two"));
});
Deno.test("saved-tail provider enforces request byte budget before reading", async () => {
  const x = await fixture();
  const source = new PinnedSavedReferenceTailSource(
    x.port,
    x.controller.signal,
    2,
    x.raw.length - 1,
  );
  await rejects(() => source.getReferenceTail("one"));
  equal(x.reads(), 0);
});

Deno.test("saved-tail provider forwards a narrow scope abort to the underlying read", async () => {
  const x = await fixture();
  const narrow = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let readSignal: AbortSignal | undefined;
  const port = {
    ...x.port,
    async read(_key: string, _max: number, signal: AbortSignal) {
      readSignal = signal;
      started();
      return await new Promise<Uint8Array>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
        if (signal.aborted) reject(new Error("cancelled"));
      });
    },
  };
  const source = new PinnedSavedReferenceTailSource(
    port,
    x.controller.signal,
    2,
    131072,
  );
  const read = source.getReferenceTail("one", narrow.signal);
  await ready;
  narrow.abort();
  await rejects(() => read);
  assert(readSignal?.aborted);
  assert(!x.controller.signal.aborted);
});
Deno.test("saved-tail provider rejects an already-aborted narrow scope before selection", async () => {
  const x = await fixture();
  let selected = false;
  const port = {
    ...x.port,
    select(id: string) {
      selected = true;
      return Promise.resolve(x.pin(id));
    },
  };
  const source = new PinnedSavedReferenceTailSource(
    port,
    x.controller.signal,
    2,
    131072,
  );
  const narrow = new AbortController();
  narrow.abort();
  await rejects(() => source.getReferenceTail("one", narrow.signal));
  assert(!selected);
});

Deno.test("runtime analysis adapter forwards scope abort before selecting tail", async () => {
  const x = await fixture();
  let selected = false;
  const source = {
    ...x.port,
    select(id: string) {
      selected = true;
      return Promise.resolve(x.pin(id));
    },
  };
  const provider = {
    referenceTailAuthority: () => source,
  } as unknown as NativeDataProvider;
  const data = runtimeAnalysisDataPort(
    { data: () => Promise.resolve(provider) },
    async (_stage, work) => await work(),
    x.controller.signal,
  );
  const narrow = new AbortController();
  narrow.abort();
  await rejects(() => data.getReferenceTail!("one", narrow.signal));
  assert(!selected);
});
