// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
import { assert, equal, withMonotonic } from "./fixture.ts";
import { SYNTHETIC_RUNTIME_NOW, syntheticRuntimeBinding } from "./synthetic_runtime_binding.ts";
import { RuntimeReferenceLease } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_reference_lease.ts";
import {
  bindRuntimeReferencePorts,
  type RuntimeReferenceFactory,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_reference_ports.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type { NativeRuntimeRequest } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts";
import { PublishedReferenceTailIssuer } from "../../supabase/functions/_shared/jungsi/infrastructure/published_reference_tail_issuer.ts";
import {
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { exact } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  RuntimeReadBudget,
  SupabaseRuntimeControls,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import { acquireReferenceCandidateScope } from "../../supabase/functions/_shared/jungsi/application/reference_candidate_scope.ts";
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
      return id === "missing" ? null : pin(id);
    },
    async read(_key: string, _max: number, signal: AbortSignal) {
      reads++;
      if (signal.aborted) throw new Error("cancelled");
      return raw;
    },
    async assertCurrent() {
      checks++;
      if (!valid) throw new Error("revoked");
    },
    async assertCompatible(_p: AuthorizedSavedTailPin, identity: Readonly<NativeObject>) {
      if (!compatible || identity.exam_id !== "SYNTHETIC-mock") throw new Error("incompatible");
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
    source = new PinnedSavedReferenceTailSource(x.port, x.controller.signal, 2, 131072);
  const one = await source.getReferenceTail("one"), two = await source.getReferenceTail("two");
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
    source = new PinnedSavedReferenceTailSource(x.port, x.controller.signal, 2, 131072);
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
        return { ...x.pin(id), sha256: "0".repeat(64) };
      },
    };
  await rejects(() =>
    new PinnedSavedReferenceTailSource(badHash, x.controller.signal, 2, 131072).getReferenceTail(
      "one",
    )
  );
  const badVersion = {
    ...x.port,
    async select(id: string) {
      return { ...x.pin(id), version: "wrong" };
    },
  };
  await rejects(() =>
    new PinnedSavedReferenceTailSource(badVersion, x.controller.signal, 2, 131072).getReferenceTail(
      "one",
    )
  );
  const wrongId = {
    ...x.port,
    async select(_id: string) {
      return x.pin("other");
    },
  };
  await rejects(() =>
    new PinnedSavedReferenceTailSource(wrongId, x.controller.signal, 2, 131072).getReferenceTail(
      "one",
    )
  );
});
Deno.test("saved-tail provider does not serve data after abort", async () => {
  const x = await fixture(),
    source = new PinnedSavedReferenceTailSource(x.port, x.controller.signal, 2, 131072);
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
        return id === "one" ? x.pin(id) : { ...x.pin(id), compatibilitySha256: "e".repeat(64) };
      },
    };
  const source = new PinnedSavedReferenceTailSource(port, x.controller.signal, 2, 131072);
  assert(await source.getReferenceTail("one"));
  await rejects(() => source.getReferenceTail("two"));
});
Deno.test("saved-tail provider enforces request cache object count", async () => {
  const x = await fixture(),
    port = {
      ...x.port,
      async select(id: string) {
        return { ...x.pin(id), key: id };
      },
    };
  const source = new PinnedSavedReferenceTailSource(port, x.controller.signal, 1, 131072);
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

Deno.test("saved-tail provider forwards scope abort to selection and reads", async () => {
  const x = await fixture();
  for (const phase of ["select", "read"] as const) {
    const deadline = new AbortController();
    let observed = false, started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = (signal: AbortSignal): Promise<never> =>
      new Promise((_, reject) => {
        const abort = () => {
          observed = true;
          reject(new Error("scope stopped"));
        };
        signal.addEventListener("abort", abort, { once: true });
        started();
        if (signal.aborted) abort();
      });
    const port = {
      ...x.port,
      select: async (id: string, signal: AbortSignal) =>
        phase === "select" ? await wait(signal) : x.pin(id),
      read: async (_key: string, _max: number, signal: AbortSignal) =>
        phase === "read" ? await wait(signal) : x.raw,
    };
    const source = new PinnedSavedReferenceTailSource(port, x.controller.signal, 2, 131072);
    const pending = source.getReferenceTail("one", deadline.signal);
    await began;
    deadline.abort();
    await rejects(() => pending);
    assert(observed);
    assert(!x.controller.signal.aborted);
  }
});

Deno.test("budgeted synthetic storage fetch physically ends before aborted candidate scope settles", async () => {
  const x = await fixture(), outer = new AbortController();
  const budget = new RuntimeReadBudget({ maxRequests: 3, maxBytes: 65536 });
  let began!: () => void, stopped = false, inFlight: Promise<Response> | undefined;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const physical: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = init!.signal!;
      const abort = () => {
        stopped = true;
        reject(new Error("physical fetch stopped"));
      };
      signal.addEventListener("abort", abort, { once: true });
      began();
      if (signal.aborted) abort();
    });
  const fetcher = budget.fetch(physical);
  const port = {
    ...x.port,
    async read(_key: string, _maximum: number, signal: AbortSignal) {
      inFlight = fetcher("https://synthetic.invalid/never-sent", { signal });
      const response = await inFlight;
      return new Uint8Array(await response.arrayBuffer());
    },
  };
  const request = {
    subjectId: "synthetic",
    reportId: "synthetic",
    reportRevision: 1,
    profileId: "synthetic",
    academicYear: 2027,
    examId: "synthetic",
    scoreBasis: "synthetic",
    catalogVersion: "synthetic",
  };
  const scope = await acquireReferenceCandidateScope(request, {
    sourceSha256: "a".repeat(64),
    selectionSha256: "b".repeat(64),
    budgetPolicySha256: "c".repeat(64),
    consumerReceiptSha256: "d".repeat(64),
    maximumRows: 1,
    maximumEvidenceBytes: 1024,
    maximumRuntimeMilliseconds: 10000,
    async verifyAdmission() {},
    async readOfferingIds() {
      return ["one"];
    },
    async cancelAndWait() {
      if (inFlight) await inFlight.catch(() => {});
    },
  }, { signal: outer.signal, admission: {} });
  assert(scope);
  const source = new PinnedSavedReferenceTailSource(port, outer.signal, 2, 131072);
  const result = scope.run(source.getReferenceTail("one", scope.signal));
  await started;
  outer.abort();
  await rejects(() => result);
  assert(stopped);
  equal(budget.snapshot().physicalRequests, 1);
});

Deno.test("36 candidate reads reuse one scope signal while different scopes remain isolated", async () => {
  const x = await fixture(),
    one = new AbortController(),
    two = new AbortController(),
    seen = new WeakSet<AbortSignal>();
  let metadata = 0,
    first: AbortSignal | undefined,
    second: AbortSignal | undefined,
    direct: AbortSignal | undefined;
  const port = {
    ...x.port,
    async select(id: string, signal: AbortSignal) {
      if (!seen.has(signal)) {
        seen.add(signal);
        metadata++;
      }
      if (id === "direct") direct = signal;
      else if (id === "second") second = signal;
      else if (!first) first = signal;
      else assert(signal === first);
      return null;
    },
  };
  const source = new PinnedSavedReferenceTailSource(port, x.controller.signal, 2, 131072);
  await source.getReferenceTail("direct");
  assert(direct === x.controller.signal);
  await source.getReferenceTail("direct", x.controller.signal);
  equal(metadata, 1);
  for (let i = 0; i < 36; i++) await source.getReferenceTail("one", one.signal);
  equal(metadata, 2);
  assert(first && first !== x.controller.signal);
  await source.getReferenceTail("second", two.signal);
  equal(metadata, 3);
  assert(second && second !== first);
  one.abort();
  assert(first.aborted);
  assert(!second.aborted);
  assert(!x.controller.signal.aborted);
  x.controller.abort();
  assert(second.aborted);
});

Deno.test("saved tail provenance requires current compatible selection and exact issuer pins", async () => {
  const x = await fixture(),
    scope = new AbortController(),
    identity: NativeObject = {
      academic_year: 2027,
      exam_id: "SYNTHETIC-mock",
      source_pack_version: "SYNTHETIC-pack",
      rule_version: "SYNTHETIC-rule",
      score_scale_id: "SYNTHETIC-native",
      offering_id: "one",
    };
  let compatible = 0, issued = 0, invalid = false;
  const port = {
    ...x.port,
    async assertCompatible(
      _pin: AuthorizedSavedTailPin,
      id: Readonly<NativeObject>,
      signal: AbortSignal,
    ) {
      assert(id.exam_id === "SYNTHETIC-mock" && !signal.aborted);
      compatible++;
    },
    async verifiedProvenance(
      pin: AuthorizedSavedTailPin,
      id: Readonly<NativeObject>,
      signal: AbortSignal,
    ) {
      assert(!signal.aborted);
      assert(pin.selectionSha256);
      issued++;
      return {
        release_sha256: pin.releaseSha256,
        selection_sha256: invalid ? "0".repeat(64) : pin.selectionSha256,
        tail_sha256: pin.sha256,
        compatibility_sha256: pin.compatibilitySha256,
        academic_year: id.academic_year,
        exam_id: id.exam_id,
        source_pack_version: id.source_pack_version,
        rule_version: id.rule_version,
        score_scale_id: id.score_scale_id,
        offering_id: id.offering_id,
      };
    },
  };
  const source = new PinnedSavedReferenceTailSource(port, x.controller.signal, 2, 131072),
    selected = await source.getReferenceTail("one", scope.signal);
  assert(selected?.verifiedProvenance);
  const proof = await selected.verifiedProvenance(identity, scope.signal);
  equal(proof.selection_sha256, "e".repeat(64));
  equal(compatible, 1);
  equal(issued, 1);
  assert(Object.isFrozen(proof));
  invalid = true;
  await rejects(() => selected.verifiedProvenance!(identity, scope.signal));
  await rejects(() =>
    selected.verifiedProvenance!({ ...identity, offering_id: "other" }, scope.signal)
  );
  scope.abort();
  await rejects(() => selected.verifiedProvenance!(identity, scope.signal));
});
Deno.test("an unissued saved tail exposes no provenance method", async () => {
  const x = await fixture(),
    selected = await new PinnedSavedReferenceTailSource(x.port, x.controller.signal, 2, 131072)
      .getReferenceTail("one");
  assert(selected);
  assert(!selected.verifiedProvenance);
});

Deno.test("36 tail selections reuse completed bounded head metadata across live scopes", async () => {
  await withMonotonic(() => 1000, async () => {
    const x = await fixture(),
      runtime = await syntheticRuntimeBinding(),
      binding = await runtime.load();
    let head = 0, bucket = 0;
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      let body: string;
      if (url.includes("/bucket/")) {
        bucket++;
        body = '{"id":"synthetic-private","public":false,"file_size_limit":65536}';
      } else {
        head++;
        body = runtime.body[url.split("/").at(-1)!.slice(0, -5)];
      }
      const response = new Response(body);
      Object.defineProperty(response, "url", { value: url });
      return response;
    }) as typeof fetch;
    const controls = new SupabaseRuntimeControls(
      binding,
      { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
      new RuntimeReadBudget(binding.readLimits),
      fetcher,
    );
    const port = {
      ...x.port,
      async assertCurrent(_pin: AuthorizedSavedTailPin, signal: AbortSignal) {
        await controls.current(signal);
      },
    };
    const source = new PinnedSavedReferenceTailSource(port, x.controller.signal, 2, 131072),
      scope = new AbortController();
    for (let i = 0; i < 36; i++) {
      assert(await source.getReferenceTail("offering-" + i, scope.signal));
    }
    equal(head, 1);
    equal(bucket, 1);
    equal(x.reads(), 1);
    scope.abort();
    await rejects(() => source.getReferenceTail("another", scope.signal));
    const other = new AbortController();
    assert(await source.getReferenceTail("other", other.signal));
    equal(head, 1);
    equal(bucket, 1);
  });
});

Deno.test("lease and tail share one actual head scope for all 36 selections", async () => {
  await withMonotonic(() => 1000, async () => {
    const x = await fixture(),
      runtime = await syntheticRuntimeBinding(),
      binding = await runtime.load();
    let head = 0, bucket = 0;
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      let body: string;
      if (url.includes("/bucket/")) {
        bucket++;
        body = '{"id":"synthetic-private","public":false,"file_size_limit":65536}';
      } else {
        head++;
        body = runtime.body[url.split("/").at(-1)!.slice(0, -5)];
      }
      const response = new Response(body);
      Object.defineProperty(response, "url", { value: url });
      return response;
    }) as typeof fetch;
    const clock = { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
      controls = new SupabaseRuntimeControls(
        binding,
        clock,
        new RuntimeReadBudget(binding.readLimits),
        fetcher,
      );
    let assertIssuerAccess: ((signal?: AbortSignal) => Promise<void>) | undefined;
    const port = {
      ...x.port,
      async assertCurrent(_pin: AuthorizedSavedTailPin, signal: AbortSignal) {
        assert(assertIssuerAccess);
        await assertIssuerAccess(signal);
        await controls.current(signal);
      },
    };
    const request = {
      operation: "candidates.build",
      session: {
        user: { subjectId: "synthetic-owner", expiresAtUtc: SYNTHETIC_RUNTIME_NOW + 9000000000n },
        evaluatedAtUtc: SYNTHETIC_RUNTIME_NOW,
        tier: "standard",
        paidUntilUtc: null,
      },
      params: {},
      query: {},
      body: {},
      management: null,
      requestKey: null,
    } as unknown as ApiExecution;
    const admission = {
        lease: { owner: "synthetic-owner", expiresAtUtc: SYNTHETIC_RUNTIME_NOW + 9000000000n },
      },
      boundary = { signal: x.controller.signal, admission };
    const lease = new RuntimeReferenceLease(clock, async (signal) => {
      await controls.current(signal);
    }, async (signal) => controls.currentReceipt(signal));
    const factory: RuntimeReferenceFactory = {
      async create(context) {
        assertIssuerAccess = context.assertActive;
        return {
          tail: new PinnedSavedReferenceTailSource(
            port,
            context.boundary.signal,
            2,
            131072,
            context.scopeSignal,
          ),
          candidateScope: null,
          projectionAuthority: {
            async resolve() {
              return null;
            },
          },
        };
      },
    };
    const fakeRuntime = {} as Pick<NativeRuntimeRequest, "binding" | "controls" | "data">;
    const services = {} as Pick<
      Parameters<RuntimeReferenceFactory["create"]>[0],
      "repository" | "catalog" | "clock" | "workflow"
    >;
    const scope = new AbortController();
    await lease.enter(request, admission, x.controller.signal, async () => {
      const wired = await bindRuntimeReferencePorts(
        factory,
        lease,
        fakeRuntime,
        services,
        request,
        boundary,
      );
      assert(wired);
      for (let i = 0; i < 36; i++) {
        assert(await wired.tail.getReferenceTail!("offering-" + i, scope.signal));
      }
      equal(head, 1);
      equal(bucket, 1);
      equal(x.reads(), 1);
    });
  });
});

Deno.test("current selection issuer reaches exact saved-tail provenance through real adapter", async () => {
  const x = await fixture(),
    original = x.pin("one"),
    context = original.context as NativeObject,
    evidence = original.evidence as NativeObject;
  const binding: NativeObject = {
    offering_id: "one",
    physical_offering_pk: "synthetic-physical",
    academic_year: context.academic_year,
    rule_version: context.rule_version,
  };
  const tail: NativeObject = {
    key: "synthetic-tail",
    sha256: original.sha256,
    bytes: x.raw.length,
    compatibility_key: "synthetic-compat",
    reference_bindings: [binding],
    reference_context: context,
    reference_evidence: evidence,
    model_exam_pack_sha256: "9".repeat(64),
    source_review_sha256: "a".repeat(64),
    independent_review_sha256: "b".repeat(64),
  };
  const compatibility: NativeObject = {
    key: "synthetic-compat",
    sha256: "c".repeat(64),
    version: "synthetic-v1",
  };
  const examSha = "d".repeat(64), registrySha = "e".repeat(64), selectionSha = "f".repeat(64);
  const receipt: NativeObject = {
    format: "jungsi.reference-model-compatibility/v1",
    version: "synthetic-v1",
    status: "verified_reference",
    scope: "same_exam_mathematical_reference",
    tail_sha256: original.sha256,
    exam_pack_sha256: examSha,
    model_exam_pack_sha256: "9".repeat(64),
    academic_year: context.academic_year,
    exam_id: context.exam_id,
    exam_type: context.exam_type,
    source_pack_version: context.source_pack_version,
    rule_version: context.rule_version,
    score_scale_id: context.score_scale_id,
    context_sha256: await nativeJsonSha256(context),
    evidence_sha256: await nativeJsonSha256(evidence),
    source_review_sha256: tail.source_review_sha256,
    independent_review_sha256: tail.independent_review_sha256,
  };
  let approved = true, reads = 0;
  const provider = {
    async referenceSelection() {
      if (!approved) throw new Error("revoked");
      return {
        registrySha256: registrySha,
        selectionSha256: selectionSha,
        approvalReferenceSha256: "8".repeat(64),
        tails: [{ key: "synthetic-tail", entry: tail }],
        compatibilities: [{ key: "synthetic-compat", entry: compatibility }],
      };
    },
    async referenceExamPin() {
      return {
        key: String(context.exam_id),
        sha256: examSha,
        version: String(context.source_pack_version),
      };
    },
    async loadReferenceTail() {
      reads++;
      return { entry: tail, bytes: x.raw };
    },
    async loadReferenceCompatibility() {
      return { entry: compatibility, payload: receipt };
    },
  };
  const issuer = new PublishedReferenceTailIssuer(provider, async (signal) => {
    if (signal.aborted) throw new Error("abort");
  });
  const source = new PinnedSavedReferenceTailSource(issuer, x.controller.signal, 2, 131072),
    selected = await source.getReferenceTail("one");
  assert(selected?.verifiedProvenance);
  const identity: NativeObject = {
    academic_year: context.academic_year,
    exam_id: context.exam_id,
    exam_type: context.exam_type,
    source_pack_version: context.source_pack_version,
    rule_version: context.rule_version,
    score_scale_id: context.score_scale_id,
    offering_id: "one",
  };
  const proof = await selected.verifiedProvenance(identity);
  equal(proof.selection_sha256, selectionSha);
  equal(proof.tail_sha256, original.sha256);
  equal(reads, 1);
  approved = false;
  await rejects(() => selected.verifiedProvenance!(identity));
});
