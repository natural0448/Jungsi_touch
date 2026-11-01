/** Confirm actual cloned WHATWG streams are unlocked without touching original responses. */
import assert from "node:assert/strict";
import { SearchFailureCorrelation } from "../../supabase/functions/_shared/jungsi/infrastructure/search503_correlation.ts";
const id = "a".repeat(32), encoder = new TextEncoder();
const event = {
  event: "current_public_search_failure_v1",
  operation: "offerings.search",
  phase: "catalog_read",
  failure: "state_unapproved",
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await pause(10);
  }
  throw new Error("SYNTHETIC_UNLOCK_TIMEOUT");
}
function response(body) {
  return new Response(body, { status: 503, headers: { "X-Request-ID": id } });
}
function start(value) {
  let copy;
  const clone = value.clone.bind(value);
  value.clone = () => {
    copy = clone();
    return copy;
  };
  const seen = [], correlation = new SearchFailureCorrelation((item) => seen.push(item));
  correlation.capture(event);
  correlation.finish(value);
  assert.ok(copy);
  assert.equal(copy.body.locked, true);
  return { copy, seen };
}
Deno.test("complete cloned body really releases its reader lock", async () => {
  const text = JSON.stringify({
      status: "error",
      error: { code: "backend_dependency_unavailable" },
      request_id: id,
    }),
    r = response(text),
    { copy, seen } = start(r);
  await until(() => !copy.body.locked && seen.length === 1);
  assert.equal(await r.text(), text);
  assert.equal(seen[0].request_id, id);
  assert.equal(seen[0].final_error_class, "backend_dependency_unavailable");
  assert.equal(seen[0].event, "current_public_search_failure_v2");
});
Deno.test("byte-limited cloned body really releases its reader lock", async () => {
  const text = "x".repeat(3000), r = response(text), { copy, seen } = start(r);
  await until(() => !copy.body.locked);
  assert.deepEqual(seen, []);
  assert.equal(await r.text(), text);
});
Deno.test("chunk-limited cloned body really releases its reader lock", async () => {
  const chunks = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i));
  const stream = new ReadableStream({
    start(c) {
      for (const x of chunks) c.enqueue(encoder.encode(x));
      c.close();
    },
  });
  const r = response(stream), { copy, seen } = start(r);
  await until(() => !copy.body.locked);
  assert.deepEqual(seen, []);
  assert.equal(await r.text(), chunks.join(""));
});
Deno.test("stalled cloned body times out and unlocks before original stream finishes", async () => {
  let control;
  const text = JSON.stringify({
    status: "error",
    error: { code: "backend_dependency_unavailable" },
    request_id: id,
  });
  const stream = new ReadableStream({
    start(c) {
      control = c;
      c.enqueue(encoder.encode(text.slice(0, 1)));
    },
  });
  const r = response(stream), { copy, seen } = start(r);
  await until(() => !copy.body.locked);
  assert.deepEqual(seen, []);
  control.enqueue(encoder.encode(text.slice(1)));
  control.close();
  assert.equal(await r.text(), text);
});
