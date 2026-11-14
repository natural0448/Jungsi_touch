// deno-lint-ignore-file require-await
import { assert } from "./fixture.ts";
import type {
  ApiExecution,
  ApiExecutionBoundary,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type { NativeRuntimeRequest } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts";
import { RuntimeReferenceLease } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_reference_lease.ts";
import {
  bindRuntimeReferencePorts,
  type RuntimeReferenceFactory,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_reference_ports.ts";

function fixture() {
  let now = 10n, valid = true, checks = 0, created = 0;
  const clock = { nowUtc: () => now };
  const request = {
    operation: "university.analyze",
    session: {
      user: { subjectId: "owner", expiresAtUtc: 100n },
      evaluatedAtUtc: 1n,
      tier: "standard",
      paidUntilUtc: null,
    },
    body: {},
    query: {},
    params: {},
    management: null,
    requestKey: null,
  } as unknown as ApiExecution;
  const signal = new AbortController();
  const admission = { lease: { owner: "owner", expiresAtUtc: 50n } };
  const boundary: ApiExecutionBoundary = { signal: signal.signal, admission };
  const lease = new RuntimeReferenceLease(clock, async () => {
    checks++;
    if (!valid) throw new Error("head revoked");
  }, async () => ({ assertCurrent() {} }));
  const runtime = {} as Pick<NativeRuntimeRequest, "binding" | "controls" | "data">;
  const services = {} as Pick<
    Parameters<RuntimeReferenceFactory["create"]>[0],
    "repository" | "catalog" | "clock" | "workflow"
  >;
  const factory: RuntimeReferenceFactory = {
    async create(input) {
      created++;
      await input.assertActive();
      return {
        tail: {
          async getReferenceTail() {
            return null;
          },
        },
        candidateScope: null,
        projectionAuthority: {
          async resolve() {
            return {
              async assertCurrent(s) {
                if (s.aborted || !valid) throw new Error("revoked");
              },
              authorizes() {
                return true;
              },
            };
          },
        },
      };
    },
  };
  return {
    request,
    boundary,
    admission,
    signal,
    lease,
    runtime,
    services,
    factory,
    tick: (value: bigint) => {
      now = value;
    },
    revoke: () => {
      valid = false;
    },
    checks: () => checks,
    created: () => created,
  };
}
async function rejects(run: () => Promise<unknown>) {
  try {
    await run();
  } catch {
    return;
  }
  throw new Error("expected rejection");
}

import type { ChunkedReferenceTailProjection } from "../../supabase/functions/_shared/jungsi/domain/chunked_reference_projection.ts";

Deno.test("runtime wrapper forwards chunk selection and rechecks lease and scoped signal", async () => {
  const x = fixture(), scope = new AbortController();
  let currentChecks = 0, compatChecks = 0;
  const selected = {
    projection: {} as ChunkedReferenceTailProjection,
    binding: { offering_id: "synthetic" },
    assertCurrent: async (s?: AbortSignal) => {
      if (s?.aborted) throw new Error("aborted");
      currentChecks++;
    },
    assertCompatible: async (_i: Readonly<Record<string, never>>, s?: AbortSignal) => {
      if (s?.aborted) throw new Error("aborted");
      compatChecks++;
    },
  };
  const factory = {
    async create(input: Parameters<RuntimeReferenceFactory["create"]>[0]) {
      const base = await x.factory.create(input);
      assert(base);
      return {
        ...base,
        tail: {
          ...base.tail,
          getChunkedReferenceTail: async (_id: string, _s?: AbortSignal) => selected,
        },
      };
    },
  } as unknown as RuntimeReferenceFactory;
  await x.lease.enter(x.request, x.admission, x.signal.signal, async () => {
    const ports = await bindRuntimeReferencePorts(
      factory,
      x.lease,
      x.runtime,
      x.services,
      x.request,
      x.boundary,
    );
    assert(ports);
    const found = await ports.tail.getChunkedReferenceTail!("synthetic", scope.signal);
    assert(found);
    await found.assertCurrent(scope.signal);
    await found.assertCompatible({}, scope.signal);
    assert(currentChecks === 1 && compatChecks === 1);
    scope.abort();
    await rejects(() => found.assertCurrent(scope.signal));
    await rejects(() => ports.tail.getChunkedReferenceTail!("synthetic", scope.signal));
  });
});
