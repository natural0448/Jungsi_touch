/** Synthetic head and budget only. No live network or private settings. */
import {
  RuntimeReadBudget,
  SupabaseRuntimeControls,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { SYNTHETIC_RUNTIME_NOW, syntheticRuntimeBinding } from "./synthetic_runtime_binding.ts";
import { assert, equal } from "./fixture.ts";
function response(url: string, body: string | ReadableStream<Uint8Array>): Response {
  const r = new Response(body);
  Object.defineProperty(r, "url", { value: url });
  return r;
}
async function setup() {
  const f = await syntheticRuntimeBinding(),
    binding = await f.load(),
    state = { bucket: 0, head: 0, aborted: 0, cancelled: 0 };
  let mode = "ok";
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), signal = init?.signal;
    if (url.includes("/bucket/")) {
      state.bucket++;
      return response(url, '{"id":"synthetic-private","public":false,"file_size_limit":65536}');
    }
    state.head++;
    if (mode === "fetch") {
      return await new Promise<Response>((_resolve, reject) =>
        signal?.addEventListener("abort", () => {
          state.aborted++;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true })
      );
    }
    if (mode === "stream") {
      return response(
        url,
        new ReadableStream<Uint8Array>({
          pull() {
            return new Promise(() => {});
          },
          cancel() {
            state.cancelled++;
          },
        }),
      );
    }
    return response(url, f.body[url.split("/").at(-1)!.slice(0, -5)]);
  }) as typeof fetch;
  const budget = new RuntimeReadBudget(binding.readLimits),
    controls = new SupabaseRuntimeControls(
      binding,
      { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
      budget,
      fetcher,
    );
  return {
    controls,
    budget,
    state,
    mode: (v: string) => {
      mode = v;
    },
  };
}
async function denied(run: () => unknown) {
  let e: unknown;
  try {
    await run();
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.http, 503);
}
Deno.test("head scope abort reaches physical fetch and rejected pin is not reused", async () => {
  const f = await setup(), a = new AbortController();
  f.mode("fetch");
  const pending = f.controls.current(a.signal);
  while (f.state.head === 0) await Promise.resolve();
  a.abort();
  await denied(() => pending);
  equal(f.state.aborted, 1);
  f.mode("ok");
  await f.controls.current(new AbortController().signal);
  equal(f.state.head, 2);
});
Deno.test("head scope abort cancels already-open stream before settlement", async () => {
  const f = await setup(), a = new AbortController();
  f.mode("stream");
  const pending = f.controls.current(a.signal);
  while (f.state.head === 0) await Promise.resolve();
  await Promise.resolve();
  a.abort();
  await denied(() => pending);
  equal(f.state.cancelled, 1);
});
Deno.test("completed head may be reused across independently cancellable scopes", async () => {
  const f = await setup(), a = new AbortController(), b = new AbortController();
  await f.controls.current(a.signal);
  await f.controls.current(a.signal);
  equal(f.state.head, 1);
  await f.controls.current(b.signal);
  equal(f.state.head, 1);
  equal(f.budget.snapshot().physicalRequests, 2);
});
