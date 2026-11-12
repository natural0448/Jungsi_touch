import {
  observeAuthExchange,
  type SafeExchangeObservation,
} from "../../supabase/functions/_shared/jungsi/infrastructure/auth_exchange_observation.ts";
import {
  type SafeProfileLookupObservation,
  SupabaseNativeAuth,
} from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_auth.ts";
import { detailedAuthObserver } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts";
function assert(v: unknown): asserts v {
  if (!v) throw new Error("assertion_failed");
}
function syntheticPromise<T>(operation: () => T): Promise<T> {
  return new Promise((resolve) => resolve(operation()));
}
Deno.test("auth diagnostic records status and preserves result without logging input", async () => {
  const events: SafeExchangeObservation[] = [];
  const result = await observeAuthExchange("auth_lookup", async (_signal, recordStatus) => {
    await Promise.resolve();
    recordStatus(200);
    return "SYNTHETIC_SECRET";
  }, (event) => {
    events.push(event);
  });
  assert(result === "SYNTHETIC_SECRET" && events.length === 1);
  assert(events[0].outcome === "ok" && events[0].http_status === 200);
  assert(!JSON.stringify(events).includes("SYNTHETIC_SECRET"));
});
Deno.test("non-200 status is distinct from fast transport failure", async () => {
  const events: SafeExchangeObservation[] = [];
  for (const record of [true, false]) {
    try {
      await observeAuthExchange("profile_lookup", async (_signal, mark) => {
        await Promise.resolve();
        if (record) mark(503);
        throw new Error("SYNTHETIC_SECRET");
      }, (event) => {
        events.push(event);
      });
    } catch { /* expected */ }
  }
  assert(events[0].outcome === "http_status" && events[0].http_status === 503);
  assert(events[1].outcome === "request_failed" && events[1].http_status === null);
  assert(!JSON.stringify(events).includes("SYNTHETIC_SECRET"));
});
Deno.test("observer errors never change successful results", async () => {
  const result = await observeAuthExchange("auth_lookup", async (_signal, mark) => {
    await Promise.resolve();
    mark(200);
    return true;
  }, () => {
    throw new Error("SYNTHETIC_SECRET");
  });
  assert(result);
});
Deno.test("a successful operation with no recorded status is not labeled HTTP success", async () => {
  const events: SafeExchangeObservation[] = [];
  const result = await observeAuthExchange("profile_lookup", async () => {
    await Promise.resolve();
    return true;
  }, (event) => {
    events.push(event);
  });
  assert(result && events[0].outcome === "status_unobserved" && events[0].http_status === null);
});
Deno.test("five-second deadline is retained and classified as timeout", async () => {
  const events: SafeExchangeObservation[] = [];
  let caught = false;
  try {
    await observeAuthExchange("auth_lookup", (signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve("late-success"), { once: true });
      }), (event) => {
      events.push(event);
    });
  } catch {
    caught = true;
  }
  assert(caught && events.length === 1 && events[0].outcome === "timeout");
  assert(events[0].elapsed_ms >= 4900 && events[0].elapsed_ms <= 10000);
});
Deno.test("opt-in native auth diagnostic preserves 503 and does not read a profile", async () => {
  const events: SafeExchangeObservation[] = [];
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    await Promise.resolve();
    calls++;
    return new Response("SYNTHETIC_SECRET", { status: 503 });
  };
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    fetcher,
    undefined,
    (event) => {
      events.push(event);
    },
  );
  let failed = false;
  try {
    await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
  } catch {
    failed = true;
  }
  assert(failed && calls === 1 && events.length === 1);
  assert(
    events[0].kind === "auth_lookup" && events[0].outcome === "http_status" &&
      events[0].http_status === 503,
  );
  assert(!JSON.stringify(events).includes("SYNTHETIC_SECRET"));
});
Deno.test("opt-in profile diagnostic preserves fail-closed profile behavior", async () => {
  const events: SafeExchangeObservation[] = [];
  const fetcher: typeof fetch = async () => {
    await Promise.resolve();
    throw new Error("SYNTHETIC_SECRET");
  };
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    fetcher,
    undefined,
    (event) => {
      events.push(event);
    },
  );
  const result = await auth.readOwnStatus(
    "synthetic.token.value",
    "00000000-0000-0000-0000-000000000001",
  );
  assert(result === null && events.length === 1 && events[0].kind === "profile_lookup");
  assert(
    events[0].outcome === "request_failed" && !JSON.stringify(events).includes("SYNTHETIC_SECRET"),
  );
});
Deno.test("auth rejection statuses remain null and diagnostic identifies only the request", async () => {
  for (const status of [400, 401, 403]) {
    const events: Record<string, unknown>[] = [];
    const auth = new SupabaseNativeAuth(
      { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
      async () => {
        await Promise.resolve();
        return new Response("SYNTHETIC_SECRET", { status });
      },
      undefined,
      detailedAuthObserver("a".repeat(32), (event) => {
        events.push(event as unknown as Record<string, unknown>);
      }),
    );
    assert(await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n) === null);
    assert(
      events.length === 1 && events[0].request_id === "a".repeat(32) &&
        events[0].http_status === status,
    );
    assert(
      !JSON.stringify(events).includes("SYNTHETIC_SECRET") &&
        !JSON.stringify(events).includes("synthetic.token.value"),
    );
  }
});
Deno.test("invalid auth JSON fails closed and invalid profile shape remains null", async () => {
  const events: SafeExchangeObservation[] = [];
  const profiles: SafeProfileLookupObservation[] = [];
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    async (url) => {
      await Promise.resolve();
      return String(url).includes("/auth/v1/user")
        ? new Response("{invalid", { status: 200 })
        : Response.json([]);
    },
    (event) => {
      profiles.push(event);
    },
    (event) => {
      events.push(event);
    },
  );
  let authFailed = false;
  try {
    await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
  } catch {
    authFailed = true;
  }
  assert(authFailed && events[0].outcome === "request_failed" && events[0].http_status === 200);
  assert(
    await auth.readOwnStatus("synthetic.token.value", "00000000-0000-0000-0000-000000000001") ===
      null,
  );
  assert(events[1].kind === "profile_lookup" && events[1].outcome === "ok");
  assert(profiles.length === 1 && profiles[0].outcome === "invalid_shape");
});
Deno.test("slow diagnostic sink never blocks authentication result", async () => {
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    async () => {
      await Promise.resolve();
      return new Response("denied", { status: 401 });
    },
    undefined,
    () => new Promise<void>(() => {}),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      auth.verifyExactBearer("synthetic.token.value", 1700000000000000n),
      new Promise<"late">((resolve) => {
        timer = setTimeout(() => resolve("late"), 300);
      }),
    ]);
    assert(response === null);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
});
Deno.test("received bearer denial remains rejected when body cancellation crosses deadline", async () => {
  const events: SafeExchangeObservation[] = [];
  let cleanup: Promise<void> | undefined;
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    async () => {
      await Promise.resolve();
      return new Response(
        new ReadableStream({
          cancel: () => cleanup = new Promise<void>((resolve) => setTimeout(resolve, 5050)),
        }),
        { status: 401 },
      );
    },
    undefined,
    (event) => {
      events.push(event);
    },
  );
  assert(await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n) === null);
  assert(
    events.length === 1 && events[0].outcome === "http_status" && events[0].http_status === 401,
  );
  await cleanup;
});
Deno.test("profile timeout remains unverified and is classified separately", async () => {
  const events: SafeExchangeObservation[] = [];
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error("missing_signal"));
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    undefined,
    (event) => {
      events.push(event);
    },
  );
  assert(
    await auth.readOwnStatus("synthetic.token.value", "00000000-0000-0000-0000-000000000001") ===
      null,
  );
  assert(
    events.length === 1 && events[0].kind === "profile_lookup" && events[0].outcome === "timeout",
  );
});

Deno.test("cancelled HTTP request aborts auth exchange without being reported as timeout", async () => {
  const controller = new AbortController(), events: SafeExchangeObservation[] = [];
  let observed = false, failed = false;
  try {
    await observeAuthExchange("auth_lookup", (signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          observed = true;
          resolve("late");
        }, { once: true });
        controller.abort();
      }), (event) => {
      events.push(event);
    }, controller.signal);
  } catch {
    failed = true;
  }
  assert(failed && observed && events.length === 1 && events[0].outcome === "request_failed");
});
Deno.test("request cancellation reaches native auth and own profile transport", async () => {
  for (const kind of ["auth", "profile"] as const) {
    const controller = new AbortController(), events: SafeExchangeObservation[] = [];
    let stopped = false;
    const fetcher: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        assert(signal && !signal.aborted);
        signal.addEventListener("abort", () => {
          stopped = true;
          reject(new Error("SYNTHETIC-CANCELLED"));
        }, { once: true });
        controller.abort();
      });
    const auth = new SupabaseNativeAuth(
      { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
      fetcher,
      undefined,
      (event) => {
        events.push(event);
      },
      controller.signal,
    );
    if (kind === "auth") {
      let failed = false;
      try {
        await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
      } catch {
        failed = true;
      }
      assert(failed);
    } else {
      let failed = false;
      try {
        await auth.readOwnStatus("synthetic.token.value", "00000000-0000-0000-0000-000000000001");
      } catch {
        failed = true;
      }
      assert(failed);
    }
    assert(stopped && events.length === 1 && events[0].outcome === "request_failed");
    assert(!JSON.stringify(events).includes("SYNTHETIC-CANCELLED"));
  }
});
Deno.test("already cancelled request never starts the auth operation", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false, failed = false;
  try {
    await observeAuthExchange(
      "auth_lookup",
      () =>
        syntheticPromise(() => {
          called = true;
          return true;
        }),
      undefined,
      controller.signal,
    );
  } catch {
    failed = true;
  }
  assert(failed && !called);
});

Deno.test("request abort during a diagnostic observer cannot return native receipts", async () => {
  const uid = "00000000-0000-0000-0000-000000000001";
  const config = {
    url: "https://synthetic.supabase.co",
    publishableKey: "sb_publishable_SYNTHETIC",
  };
  const payload = btoa(
    JSON.stringify({ iss: config.url + "/auth/v1", sub: uid, exp: 1700000060, aal: "aal2" }),
  ).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const bearer = "e30." + payload + ".SYNTHETIC";
  for (const kind of ["auth", "profile"] as const) {
    const controller = new AbortController();
    const auth = new SupabaseNativeAuth(
      config,
      () =>
        syntheticPromise(() =>
          kind === "auth"
            ? Response.json({ id: uid })
            : Response.json([{ role: "admin", status: "active" }])
        ),
      kind === "profile" ? () => controller.abort() : undefined,
      kind === "auth" ? () => controller.abort() : undefined,
      controller.signal,
    );
    let failed = false;
    try {
      if (kind === "auth") await auth.verifyExactBearer(bearer, 1700000000000000n);
      else await auth.readOwnStatus(bearer, uid);
    } catch {
      failed = true;
    }
    assert(failed);
  }
});
Deno.test("request abort remains first cause even if the local deadline also fires", async () => {
  const original = AbortSignal.timeout,
    request = new AbortController(),
    deadline = new AbortController();
  const events: SafeExchangeObservation[] = [];
  try {
    AbortSignal.timeout = () => deadline.signal;
    try {
      await observeAuthExchange("auth_lookup", () =>
        syntheticPromise(() => {
          request.abort(new Error("SYNTHETIC-request"));
          deadline.abort(new Error("SYNTHETIC-deadline"));
          return true;
        }), (event) => {
        events.push(event);
      }, request.signal);
    } catch { /* expected cancellation */ }
  } finally {
    AbortSignal.timeout = original;
  }
  assert(events.length === 1 && events[0].outcome === "request_failed");
});

Deno.test("request abort does not wait indefinitely for rejected response body cleanup", async () => {
  for (const kind of ["auth", "profile"] as const) {
    const request = new AbortController();
    let cancelStarted = false;
    const auth = new SupabaseNativeAuth(
      { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
      () =>
        syntheticPromise(() =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelStarted = true;
                queueMicrotask(() => request.abort());
                return new Promise<void>(() => {});
              },
            }),
            { status: 401 },
          )
        ),
      undefined,
      undefined,
      request.signal,
    );
    let rejected = false;
    try {
      if (kind === "auth") await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
      else {await auth.readOwnStatus(
          "synthetic.token.value",
          "00000000-0000-0000-0000-000000000001",
        );}
    } catch {
      rejected = true;
    }
    assert(cancelStarted && rejected);
  }
});
Deno.test("known bearer denial stays denied when body cleanup exceeds the existing deadline", async () => {
  const original = AbortSignal.timeout, deadline = new AbortController();
  const events: SafeExchangeObservation[] = [];
  try {
    AbortSignal.timeout = () => deadline.signal;
    const auth = new SupabaseNativeAuth(
      { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
      () =>
        syntheticPromise(() =>
          new Response(
            new ReadableStream({
              cancel() {
                queueMicrotask(() => deadline.abort());
                return new Promise<void>(() => {});
              },
            }),
            { status: 401 },
          )
        ),
      undefined,
      (event) => {
        events.push(event);
      },
    );
    assert(await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n) === null);
    assert(
      events.length === 1 && events[0].http_status === 401 && events[0].outcome === "http_status",
    );
  } finally {
    AbortSignal.timeout = original;
  }
});

Deno.test("known bearer denial is preserved when response cleanup rejects", async () => {
  const events: SafeExchangeObservation[] = [];
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    () =>
      syntheticPromise(() =>
        new Response(
          new ReadableStream({
            cancel() {
              return Promise.reject(new Error("SYNTHETIC-cancel-failure"));
            },
          }),
          { status: 401 },
        )
      ),
    undefined,
    (event) => {
      events.push(event);
    },
  );
  assert(await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n) === null);
  assert(
    events.length === 1 && events[0].outcome === "http_status" && events[0].http_status === 401,
  );
  assert(!JSON.stringify(events).includes("SYNTHETIC-cancel-failure"));
});
Deno.test("caller abort takes priority when denied response cleanup rejects", async () => {
  const request = new AbortController();
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    () =>
      syntheticPromise(() =>
        new Response(
          new ReadableStream({
            cancel() {
              request.abort();
              return Promise.reject(new Error("SYNTHETIC-cancel-failure"));
            },
          }),
          { status: 401 },
        )
      ),
    undefined,
    undefined,
    request.signal,
  );
  let rejected = false;
  try {
    await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
  } catch {
    rejected = true;
  }
  assert(rejected);
});

Deno.test("caller abort bounds a fetch that ignores its signal", async () => {
  for (const kind of ["auth", "profile"] as const) {
    const controller = new AbortController();
    const auth = new SupabaseNativeAuth(
      { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
      () => {
        queueMicrotask(() => controller.abort());
        return new Promise<Response>(() => {});
      },
      undefined,
      undefined,
      controller.signal,
    );
    let rejected = false;
    try {
      if (kind === "auth") await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
      else {await auth.readOwnStatus(
          "synthetic.token.value",
          "00000000-0000-0000-0000-000000000001",
        );}
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});
Deno.test("caller abort bounds a successful response body that ignores cancellation", async () => {
  for (const kind of ["auth", "profile"] as const) {
    const controller = new AbortController();
    const auth = new SupabaseNativeAuth(
      { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
      () =>
        syntheticPromise(() =>
          new Response(
            new ReadableStream({
              pull() {
                queueMicrotask(() => controller.abort());
                return new Promise<void>(() => {});
              },
              cancel() {
                return new Promise<void>(() => {});
              },
            }),
            { status: 200 },
          )
        ),
      undefined,
      undefined,
      controller.signal,
    );
    let rejected = false;
    try {
      if (kind === "auth") await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
      else {await auth.readOwnStatus(
          "synthetic.token.value",
          "00000000-0000-0000-0000-000000000001",
        );}
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});
Deno.test("caller abort bounds cleanup of an oversized declared response", async () => {
  const controller = new AbortController();
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    () =>
      syntheticPromise(() =>
        new Response(
          new ReadableStream({
            cancel() {
              queueMicrotask(() => controller.abort());
              return new Promise<void>(() => {});
            },
          }),
          { status: 200, headers: { "content-length": "65537" } },
        )
      ),
    undefined,
    undefined,
    controller.signal,
  );
  let rejected = false;
  try {
    await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
  } catch {
    rejected = true;
  }
  assert(rejected);
});

Deno.test("late successful auth fetch cannot authenticate after caller abort", async () => {
  const controller = new AbortController();
  let finish: ((response: Response) => void) | undefined;
  let lateBodyCancelled = false;
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
        queueMicrotask(() => controller.abort());
      }),
    undefined,
    undefined,
    controller.signal,
  );
  let rejected = false;
  try {
    await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
  } catch {
    rejected = true;
  }
  assert(rejected && finish);
  finish(
    new Response(
      new ReadableStream({
        cancel() {
          lateBodyCancelled = true;
        },
      }),
      { status: 200 },
    ),
  );
  await Promise.resolve();
  assert(lateBodyCancelled);
});
Deno.test("deadline bounds a fetch that ignores cancellation and reports timeout", async () => {
  const original = AbortSignal.timeout,
    deadline = new AbortController(),
    events: SafeExchangeObservation[] = [];
  try {
    AbortSignal.timeout = () => deadline.signal;
    const auth = new SupabaseNativeAuth(
      { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
      () => {
        queueMicrotask(() => deadline.abort());
        return new Promise<Response>(() => {});
      },
      undefined,
      (event) => {
        events.push(event);
      },
    );
    let rejected = false;
    try {
      await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
    } catch {
      rejected = true;
    }
    assert(rejected && events.length === 1 && events[0].outcome === "timeout");
  } finally {
    AbortSignal.timeout = original;
  }
});

Deno.test("late transport rejection after request abort is observed", async () => {
  const controller = new AbortController();
  let rejectLate: ((error: Error) => void) | undefined;
  const auth = new SupabaseNativeAuth(
    { url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_SYNTHETIC" },
    () =>
      new Promise<Response>((_resolve, reject) => {
        rejectLate = reject;
        queueMicrotask(() => controller.abort());
      }),
    undefined,
    undefined,
    controller.signal,
  );
  let rejected = false;
  try {
    await auth.verifyExactBearer("synthetic.token.value", 1700000000000000n);
  } catch {
    rejected = true;
  }
  assert(rejected && rejectLate);
  rejectLate(new Error("SYNTHETIC-late-rejection"));
  await new Promise((resolve) => setTimeout(resolve, 0));
});
