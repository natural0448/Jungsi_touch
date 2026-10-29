/** Synthetic-only: no network, DB, user data or file access. */
import assert from "node:assert/strict";
import { SearchFailureCorrelation } from "../../supabase/functions/_shared/jungsi/infrastructure/search503_correlation.ts";

const id = "a".repeat(32);
const event = Object.freeze({
  event: "current_public_search_failure_v1",
  operation: "offerings.search",
  phase: "catalog_read",
  failure: "state_unapproved",
});
const encoder = new TextEncoder();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await pause(10);
  }
  throw new Error("SYNTHETIC_TIMEOUT_WAITING_FOR_CLEANUP");
}
function correlate(response, sink) {
  const c = new SearchFailureCorrelation(sink);
  c.capture(event);
  // finish is synchronous and must not wait for body reads, cancellation or sinks.
  assert.equal(c.finish(response), undefined);
}
function nativeResponse(body) {
  return new Response(body, {
    status: 503,
    headers: { "X-Request-ID": id, "Content-Type": "application/json" },
  });
}
function observeCloneReader(response, failCancel = false) {
  const clone = response.clone.bind(response);
  const calls = { cancel: 0, release: 0 };
  response.clone = () => {
    const body = clone().body;
    assert.ok(body);
    return {
      body: {
        getReader() {
          const reader = body.getReader();
          return {
            read: () => reader.read(),
            cancel() {
              calls.cancel++;
              if (failCancel === "throw") throw new Error("SYNTHETIC_CANCEL_THROW");
              if (failCancel === "reject") {
                return Promise.reject(new Error("SYNTHETIC_CANCEL_REJECT"));
              }
              return reader.cancel();
            },
            releaseLock() {
              calls.release++;
              return reader.releaseLock();
            },
          };
        },
      },
    };
  };
  return calls;
}
function successBody(pad = "") {
  return JSON.stringify({
    status: "error",
    error: { code: "backend_dependency_unavailable" },
    request_id: id,
    pad,
  });
}
Deno.test("normal valid clone releases its lock, emits one event, and leaves original body intact", async () => {
  const text = successBody(),
    response = nativeResponse(text),
    calls = observeCloneReader(response),
    seen = [];
  correlate(response, (entry) => seen.push(entry));
  await until(() => calls.release === 1 && seen.length === 1);
  assert.equal(calls.cancel, 0);
  assert.equal(await response.text(), text);
  assert.equal(seen[0].request_id, id);
  assert.equal(seen[0].final_error_class, "backend_dependency_unavailable");
  assert.equal(seen[0].event, "current_public_search_failure_v2");
  assert.deepEqual(Object.keys(seen[0]).sort(), [
    "event",
    "failure",
    "final_error_class",
    "operation",
    "phase",
    "request_id",
  ]);
});
Deno.test("oversized clone cancels and releases without changing the original bytes", async () => {
  const text = successBody("z".repeat(3000)),
    response = nativeResponse(text),
    calls = observeCloneReader(response),
    seen = [];
  correlate(response, (entry) => seen.push(entry));
  await until(() => calls.release === 1);
  assert.equal(calls.cancel, 1);
  assert.deepEqual(seen, []);
  assert.equal(await response.text(), text);
});
Deno.test("too many clone chunks cancel and release while the original retains every chunk", async () => {
  const chunks = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i));
  const stream = new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(encoder.encode(chunk));
      c.close();
    },
  });
  const response = nativeResponse(stream), calls = observeCloneReader(response), seen = [];
  correlate(response, (entry) => seen.push(entry));
  await until(() => calls.release === 1);
  assert.equal(calls.cancel, 1);
  assert.deepEqual(seen, []);
  assert.equal(await response.text(), chunks.join(""));
});
Deno.test("stalled clone times out and unlocks; original may finish afterward unchanged", async () => {
  const full = successBody();
  let controller;
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      c.enqueue(encoder.encode(full.slice(0, 1)));
    },
  });
  const response = nativeResponse(stream), calls = observeCloneReader(response), seen = [];
  correlate(response, (entry) => seen.push(entry));
  await until(() => calls.release === 1);
  assert.equal(calls.cancel, 1);
  assert.deepEqual(seen, []);
  controller.enqueue(encoder.encode(full.slice(1)));
  controller.close();
  assert.equal(await response.text(), full);
  await pause(10);
  assert.deepEqual(seen, []);
});
Deno.test("synchronous cancel failure still attempts unlock and preserves original", async () => {
  const text = successBody("z".repeat(3000)),
    response = nativeResponse(text),
    calls = observeCloneReader(response, "throw"),
    seen = [];
  correlate(response, (entry) => seen.push(entry));
  await until(() => calls.release === 1);
  assert.equal(calls.cancel, 1);
  assert.deepEqual(seen, []);
  assert.equal(await response.text(), text);
});
Deno.test("sink throw, rejection or pending promise never changes the original response", async () => {
  for (
    const sink of [
      () => {
        throw new Error("SYNTHETIC_SINK_ERROR");
      },
      () => Promise.reject(new Error("SYNTHETIC_SINK_ERROR")),
      () => new Promise(() => {}),
    ]
  ) {
    const text = successBody(),
      response = nativeResponse(text),
      calls = observeCloneReader(response);
    correlate(response, sink);
    await until(() => calls.release === 1);
    assert.equal(calls.cancel, 0);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), text);
  }
});
Deno.test("rejected cancel remains best effort and unlocks without unhandled rejection", async () => {
  const text = successBody("z".repeat(3000)),
    response = nativeResponse(text),
    calls = observeCloneReader(response, "reject"),
    seen = [];
  correlate(response, (entry) => seen.push(entry));
  await until(() => calls.release === 1);
  assert.equal(calls.cancel, 1);
  assert.deepEqual(seen, []);
  assert.equal(await response.text(), text);
  await pause(10);
});
