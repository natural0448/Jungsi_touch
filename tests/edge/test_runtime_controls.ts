import {
  RuntimeReadBudget,
  SupabaseRuntimeControls,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { SYNTHETIC_RUNTIME_NOW, syntheticRuntimeBinding } from "./synthetic_runtime_binding.ts";
import { agedChecks, assert, equal, withMonotonic } from "./fixture.ts";
import { STORAGE_CHECK_REUSE_MS } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
async function fixture(changeHead?: Parameters<typeof syntheticRuntimeBinding>[1]) {
  const f = await syntheticRuntimeBinding(undefined, changeHead), binding = await f.load();
  const calls: { url: string; init: RequestInit }[] = [];
  let now = SYNTHETIC_RUNTIME_NOW,
    responseChange: ((body: string, url: string) => string) | null = null;
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init! });
    let body = url.includes("/bucket/")
      ? '{"id":"synthetic-private","public":false,"file_size_limit":65536}'
      : f.body[url.split("/").at(-1)!.slice(0, -5)];
    if (responseChange) body = responseChange(body, url);
    const response = new Response(body);
    Object.defineProperty(response, "url", { value: url });
    return Promise.resolve(response);
  }) as typeof fetch;
  const controls = new SupabaseRuntimeControls(
    binding,
    { nowUtc: () => now },
    new RuntimeReadBudget(binding.readLimits),
    fetcher,
  );
  return {
    ...f,
    binding,
    calls,
    controls,
    fetcher,
    setTime: (value: bigint) => {
      now = value;
    },
    changeResponse: (change: (body: string, url: string) => string) => {
      responseChange = change;
    },
  };
}
async function denied(run: () => Promise<unknown>) {
  let error: unknown;
  try {
    await run();
  } catch (value) {
    error = value;
  }
  assert(error instanceof AccessError);
  equal(error.http, 503);
}
Deno.test("runtime concrete head rereads pinned private Storage with no cache before every return", () =>
  agedChecks(async () => {
    const f = await fixture();
    await f.controls.current();
    await f.controls.current();
    equal(f.calls.length, 4);
    for (const c of f.calls) {
      equal(c.init.method, "GET");
      equal(c.init.cache, "no-store");
      equal(c.init.redirect, "error");
    }
  }).then(() => {
    let clock = 1000;
    return withMonotonic(() => clock, async () => {
      // Inside one request a verified head/bucket answer is reused for under 1.5 s.
      const g = await fixture();
      await g.controls.current();
      clock += STORAGE_CHECK_REUSE_MS - 1;
      await g.controls.current();
      equal(g.calls.length, 2);
      g.changeResponse((body, url) =>
        url.includes("head.json") ? body.replace('"approved"', '"revoked"') : body
      );
      clock += 1;
      await denied(() => g.controls.current());
      equal(g.calls.length, 4);
      // Approval expiry is still checked on every reused answer.
      const h = await fixture();
      await h.controls.current();
      h.setTime(h.binding.expiresAtUtc);
      await denied(() => h.controls.current());
      equal(h.calls.length, 2);
    });
  }));
Deno.test("runtime concrete head rejects purpose status scope approval and source pin mismatches", async () => {
  for (
    const [key, value] of [
      ["purpose", "legacy-review"],
      ["status", "revoked"],
      ["scope_sha256", "b".repeat(64)],
      ["approval_reference_sha256", "b".repeat(64)],
      ["registry_sha256", "b".repeat(64)],
      ["usage_policy_sha256", "b".repeat(64)],
    ]
  ) {
    const f = await fixture((head) => {
      head[key] = value;
    });
    await denied(() => f.controls.current());
  }
});
Deno.test("runtime concrete head invalidates an old warm result after source changes or approval expiry", () =>
  agedChecks(async () => {
    const f = await fixture();
    await f.controls.current();
    f.changeResponse((body, url) =>
      url.includes("head.json") ? body.replace('"approved"', '"revoked"') : body
    );
    await denied(() => f.controls.current());
    const g = await fixture();
    await g.controls.current();
    g.setTime(g.binding.expiresAtUtc);
    await denied(() => g.controls.current());
    equal(g.calls.length, 2);
  }));
Deno.test("runtime control bucket must stay private and limits are native integers", async () => {
  for (
    const body of [
      '{"id":"synthetic-private","public":true,"file_size_limit":65536}',
      '{"id":"synthetic-private","public":false,"file_size_limit":65536e0}',
    ]
  ) {
    const f = await fixture();
    f.changeResponse((value, url) => url.includes("/bucket/") ? body : value);
    await denied(() => f.controls.current());
    equal(f.calls.length, 1);
  }
});
Deno.test("runtime read budget is shared by control and artifact fetch wrappers within one request", async () => {
  const f = await fixture(), budget = new RuntimeReadBudget({ maxRequests: 2, maxBytes: 65536 });
  const controls = new SupabaseRuntimeControls(
    f.binding,
    { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
    budget,
    f.fetcher,
  );
  await controls.current();
  await denied(() => budget.fetch(f.fetcher)("https://synthetic.invalid"));
  equal(f.calls.length, 2);
});
Deno.test("runtime read byte budget charges actual stream bytes and never resets at individual reads", async () => {
  const f = await fixture(), budget = new RuntimeReadBudget({ maxRequests: 8, maxBytes: 10 });
  const controls = new SupabaseRuntimeControls(
    f.binding,
    { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
    budget,
    f.fetcher,
  );
  await denied(() => controls.current());
  equal(f.calls.length, 1);
});

Deno.test("reused artifact keeps logical read charges separate from physical streamed IO", async () => {
  const budget = new RuntimeReadBudget({ maxRequests: 3, maxBytes: 20 });
  const fetcher = budget.fetch(() => Promise.resolve(new Response("abc")));
  await (await fetcher("https://synthetic.invalid")).arrayBuffer();
  budget.reuseArtifact(7);
  equal(budget.snapshot(), {
    requests: 2,
    bytes: 10,
    physicalRequests: 1,
    physicalBytes: 3,
    reusedArtifacts: 1,
  });
});
Deno.test("reused artifact cannot bypass the logical request cap", async () => {
  const budget = new RuntimeReadBudget({ maxRequests: 1, maxBytes: 20 });
  budget.reuseArtifact(7);
  await denied(() => Promise.resolve(budget.reuseArtifact(7)));
  equal(budget.snapshot().requests, 1);
  equal(budget.snapshot().bytes, 7);
});
Deno.test("reused artifact cannot bypass the logical byte cap or partially charge a failed reuse", async () => {
  const budget = new RuntimeReadBudget({ maxRequests: 3, maxBytes: 10 });
  budget.reuseArtifact(7);
  await denied(() => Promise.resolve(budget.reuseArtifact(7)));
  equal(budget.snapshot().requests, 1);
  equal(budget.snapshot().bytes, 7);
});
Deno.test("artifact reuse accounting requires a still live request binding", async () => {
  const f = await fixture();
  f.controls.reuseArtifact(1);
  f.setTime(f.binding.expiresAtUtc);
  await denied(() => Promise.resolve(f.controls.reuseArtifact(1)));
  equal(f.calls.length, 0);
});
