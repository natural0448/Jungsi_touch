// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
import { assert, equal } from "./fixture.ts";
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
              assertSettled(s) {
                if (s.aborted) throw new Error("aborted");
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
Deno.test("reference wiring is usable only inside the real budget callback and after successful settlement", async () => {
  const x = fixture();
  await rejects(() =>
    bindRuntimeReferencePorts(x.factory, x.lease, x.runtime, x.services, x.request, x.boundary)
  );
  const { ports, proof } = await x.lease.enter(
    x.request,
    x.admission,
    x.signal.signal,
    async () => {
      const ports = await bindRuntimeReferencePorts(
        x.factory,
        x.lease,
        x.runtime,
        x.services,
        x.request,
        x.boundary,
      );
      assert(ports);
      equal(await ports.tail.getReferenceTail!("synthetic"), null);
      const proof = await ports.projectionAuthority.resolve(
        x.request,
        {},
        x.admission,
        x.signal.signal,
      );
      assert(proof);
      await proof.assertCurrent(x.signal.signal);
      return { ports, proof };
    },
  );
  await rejects(() => ports!.tail.getReferenceTail!("synthetic"));
  await rejects(() => proof!.assertCurrent(x.signal.signal));
  x.lease.markSettled();
  proof.assertSettled!(x.signal.signal);
  await rejects(() => proof.assertCurrent(x.signal.signal));
  await rejects(() => ports!.tail.getReferenceTail!("synthetic"));
  equal(x.created(), 1);
  assert(x.checks() >= 6);
});
Deno.test("reference wiring rejects another request, admission, owner and stale lease", async () => {
  for (const mode of ["request", "admission", "owner", "expired"] as const) {
    const x = fixture();
    if (mode === "owner") {
      await rejects(() =>
        x.lease.enter(
          x.request,
          { lease: { owner: "other", expiresAtUtc: 50n } },
          x.signal.signal,
          async () => {},
        )
      );
      continue;
    }
    await x.lease.enter(x.request, x.admission, x.signal.signal, async () => {
      if (mode === "expired") x.tick(50n);
      const req = mode === "request" ? { ...x.request } : x.request;
      const boundary = mode === "admission" ? { ...x.boundary, admission: {} } : x.boundary;
      await rejects(() => x.lease.assert(req, boundary));
      if (mode === "expired") x.tick(10n);
    });
  }
});
Deno.test("reference proof is denied after head revocation, cancellation or failed settlement", async () => {
  for (const mode of ["head", "abort", "failure"] as const) {
    const x = fixture();
    await x.lease.enter(x.request, x.admission, x.signal.signal, async () => {
      await x.lease.assert(x.request, x.boundary);
    });
    if (mode === "failure") x.lease.fail();
    else x.lease.markSettled();
    if (mode === "head") x.revoke();
    if (mode === "abort") x.signal.abort();
    await rejects(() => x.lease.assert(x.request, x.boundary));
  }
});
Deno.test("reference factory cannot run with an unrelated budget admission or return a partial issuer", async () => {
  const x = fixture();
  await x.lease.enter(x.request, x.admission, x.signal.signal, async () => {
    await rejects(() =>
      bindRuntimeReferencePorts(x.factory, x.lease, x.runtime, x.services, x.request, {
        signal: x.signal.signal,
        admission: {},
      })
    );
    equal(x.created(), 0);
    const bad = {
      create: async () => ({ tail: {}, candidateScope: null, projectionAuthority: {} }),
    } as unknown as RuntimeReferenceFactory;
    await rejects(() =>
      bindRuntimeReferencePorts(bad, x.lease, x.runtime, x.services, x.request, x.boundary)
    );
  });
});

Deno.test("reference head check receives the same abort signal and stops before settlement", async () => {
  const x = fixture();
  let started!: () => void, stopped = false;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const lease = new RuntimeReferenceLease({ nowUtc: () => 10n }, async (signal) => {
    assert(signal === x.signal.signal);
    await new Promise<void>((_resolve, reject) => {
      const abort = () => {
        stopped = true;
        reject(new Error("head stopped"));
      };
      signal.addEventListener("abort", abort, { once: true });
      started();
      if (signal.aborted) abort();
    });
  }, async () => ({ assertCurrent() {} }));
  const execution = lease.enter(x.request, x.admission, x.signal.signal, async () => {
    const pending = lease.assert(x.request, x.boundary);
    await began;
    x.signal.abort();
    await rejects(() => pending);
  });
  await rejects(() => execution);
  assert(stopped);
});

Deno.test("candidate deadline aborts the physical head check before budget callback returns", async () => {
  const x = fixture(), scope = new AbortController();
  let started!: () => void, stopped = false;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const lease = new RuntimeReferenceLease({ nowUtc: () => 10n }, async (signal) => {
    await new Promise<void>((_resolve, reject) => {
      const abort = () => {
        stopped = true;
        reject(new Error("scope head stopped"));
      };
      signal.addEventListener("abort", abort, { once: true });
      started();
      if (signal.aborted) abort();
    });
  }, async () => ({ assertCurrent() {} }));
  const work = lease.enter(
    x.request,
    x.admission,
    x.signal.signal,
    () => lease.assert(x.request, x.boundary, scope.signal),
  );
  await began;
  scope.abort();
  await rejects(() => work);
  assert(stopped);
  assert(!x.signal.signal.aborted);
});
Deno.test("head checks reuse the same signal within one scope but not across scopes", async () => {
  const x = fixture(),
    one = new AbortController(),
    two = new AbortController(),
    seen: AbortSignal[] = [];
  const lease = new RuntimeReferenceLease({ nowUtc: () => 10n }, async (signal) => {
    seen.push(signal);
  }, async () => ({ assertCurrent() {} }));
  await lease.enter(x.request, x.admission, x.signal.signal, async () => {
    for (let i = 0; i < 36; i++) await lease.assert(x.request, x.boundary, one.signal);
    await lease.assert(x.request, x.boundary, two.signal);
  });
  assert(seen.slice(0, 36).every((signal) => signal === seen[0]));
  assert(seen[36] !== seen[0]);
  one.abort();
  assert(seen[0].aborted && !seen[36].aborted);
});

Deno.test("settled reference delivery rechecks the original receipt without I/O", async () => {
  const x = fixture();
  let receiptLive = true, reads = 0;
  const lease = new RuntimeReferenceLease({ nowUtc: () => 10n }, async () => {
    reads++;
  }, async () => ({
    assertCurrent() {
      if (!receiptLive) throw Error("receipt expired");
    },
  }));
  await lease.enter(x.request, x.admission, x.signal.signal, async () => {
    await lease.assert(x.request, x.boundary);
  });
  lease.markSettled();
  lease.assertSettled(x.request, x.boundary);
  equal(reads, 1);
  receiptLive = false;
  await rejects(async () => lease.assertSettled(x.request, x.boundary));
  equal(reads, 1);
});
