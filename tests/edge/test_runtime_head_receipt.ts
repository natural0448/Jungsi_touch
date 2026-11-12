/** Exact physical-head freshness receipt; synthetic fetch only. */
import {
  RuntimeReadBudget,
  SupabaseRuntimeControls,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import { STORAGE_CHECK_REUSE_MS } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_artifacts.ts";
import { SYNTHETIC_RUNTIME_NOW, syntheticRuntimeBinding } from "./synthetic_runtime_binding.ts";
import { assert, equal, withMonotonic } from "./fixture.ts";
function denied(f: () => unknown) {
  let bad = false;
  try {
    f();
  } catch {
    bad = true;
  }
  assert(bad);
}
async function fixture() {
  const f = await syntheticRuntimeBinding(), binding = await f.load();
  let calls = 0, now = SYNTHETIC_RUNTIME_NOW;
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    calls++;
    const body = url.includes("/bucket/")
      ? '{"id":"synthetic-private","public":false,"file_size_limit":65536}'
      : f.body[url.split("/").at(-1)!.slice(0, -5)];
    const r = new Response(body);
    Object.defineProperty(r, "url", { value: url });
    return Promise.resolve(r);
  }) as typeof fetch;
  return {
    controls: new SupabaseRuntimeControls(
      binding,
      { nowUtc: () => now },
      new RuntimeReadBudget(binding.readLimits),
      fetcher,
    ),
    calls: () => calls,
    setTime: (n: bigint) => {
      now = n;
    },
    binding,
  };
}
Deno.test("cached head receipt expires from original physical start, not reuse time", async () => {
  let time = 1000;
  await withMonotonic(() => time, async () => {
    const f = await fixture(), s = new AbortController().signal;
    denied(() => f.controls.currentReceipt(s));
    await f.controls.current(s);
    time += STORAGE_CHECK_REUSE_MS - 1;
    await f.controls.current(s);
    const receipt = f.controls.currentReceipt(s);
    receipt.assertCurrent();
    equal(f.calls(), 2);
    time++;
    denied(() => receipt.assertCurrent());
    denied(() => f.controls.currentReceipt(s));
    equal(f.calls(), 2);
  });
});
Deno.test("receipt is tied to each live signal and the unchanged physical read start", async () => {
  let time = 1000;
  await withMonotonic(() => time, async () => {
    const f = await fixture(), a = new AbortController(), b = new AbortController();
    await f.controls.current(a.signal);
    const old = f.controls.currentReceipt(a.signal);
    denied(() => f.controls.currentReceipt(b.signal));
    await f.controls.current(b.signal);
    old.assertCurrent();
    const fresh = f.controls.currentReceipt(b.signal);
    b.abort();
    denied(() => fresh.assertCurrent());
    old.assertCurrent();
    equal(f.calls(), 2);
    time += STORAGE_CHECK_REUSE_MS;
    const c = new AbortController();
    await f.controls.current(c.signal);
    denied(() => old.assertCurrent());
    f.controls.currentReceipt(c.signal).assertCurrent();
    equal(f.calls(), 4);
  });
});
Deno.test("expired binding prevents a formerly valid receipt", async () => {
  const time = 1000;
  await withMonotonic(() => time, async () => {
    const f = await fixture(), s = new AbortController().signal;
    await f.controls.current(s);
    const receipt = f.controls.currentReceipt(s);
    f.setTime(f.binding.expiresAtUtc);
    denied(() => receipt.assertCurrent());
  });
});
