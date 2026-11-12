import {
  RuntimeReadBudget,
  SupabaseRuntimeControls,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  SYNTHETIC_RUNTIME_NOW,
  syntheticRuntimeBinding,
} from "../edge/synthetic_runtime_binding.ts";
import { assert, equal, withMonotonic } from "../edge/fixture.ts";
async function fixture(
  changeHead?: Parameters<typeof syntheticRuntimeBinding>[1],
) {
  const f = await syntheticRuntimeBinding(undefined, changeHead),
    binding = await f.load();
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

Deno.test("same-scope in-flight bucket checks share work while every logical read remains charged", async () => {
  let clock = 1000;
  await withMonotonic(() => clock, async () => {
    const f = await fixture();
    const budget = new RuntimeReadBudget(f.binding.readLimits);
    const controls = new SupabaseRuntimeControls(
      f.binding,
      { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
      budget,
      f.fetcher,
    );
    await Promise.all([controls.read("head"), controls.read("usage_policy")]);
    clock += 100;
    equal(f.calls.filter((c) => c.url.includes("/bucket/")).length, 1);
    equal(f.calls.length, 3);
    equal(budget.snapshot().requests, 4);
    equal(budget.snapshot().physicalRequests, 3);
  });
});
Deno.test("completed bucket checks are not reused and binding expiry remains enforced", async () => {
  let clock = 1000;
  await withMonotonic(() => clock, async () => {
    const f = await fixture();
    await f.controls.read("head");
    f.changeResponse((body, url) =>
      url.includes("/bucket/")
        ? body.replace('"public":false', '"public":true')
        : body
    );
    clock += 1;
    await denied(() => f.controls.read("usage_policy"));
    equal(f.calls.filter((c) => c.url.includes("/bucket/")).length, 2);
    const g = await fixture();
    await g.controls.read("head");
    g.setTime(g.binding.expiresAtUtc);
    await denied(() => g.controls.read("usage_policy"));
  });
});
Deno.test("shared in-flight bucket metadata does not bypass the request budget", async () => {
  const f = await fixture();
  const budget = new RuntimeReadBudget({
    maxRequests: 3,
    maxBytes: f.binding.readLimits.maxBytes,
  });
  const controls = new SupabaseRuntimeControls(
    f.binding,
    { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
    budget,
    f.fetcher,
  );
  const results = await Promise.allSettled([
    controls.read("head"),
    controls.read("usage_policy"),
  ]);
  assert(results.some((r) => r.status === "rejected"));
  equal(budget.snapshot().requests, 3);
  assert(budget.snapshot().physicalRequests <= 3);
});
Deno.test("concurrent distinct cancellation scopes never share an in-flight bucket read", async () => {
  const f = await fixture(),
    waiting: Array<{ resolve: (r: Response) => void; url: string }> = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/bucket/")) return f.fetcher(input, init);
    return new Promise<Response>((resolve, reject) => {
      waiting.push({ resolve, url });
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  }) as typeof fetch;
  const controls = new SupabaseRuntimeControls(
    f.binding,
    { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
    new RuntimeReadBudget(f.binding.readLimits),
    fetcher,
  );
  const a = new AbortController(), b = new AbortController();
  const first = controls.read("head", a.signal),
    second = controls.read("usage_policy", b.signal);
  await Promise.resolve();
  equal(waiting.length, 2);
  a.abort();
  const r = new Response(
    '{"id":"synthetic-private","public":false,"file_size_limit":65536}',
  );
  Object.defineProperty(r, "url", { value: waiting[1].url });
  waiting[1].resolve(r);
  await denied(() => first);
  assert((await second).length > 0);
});
