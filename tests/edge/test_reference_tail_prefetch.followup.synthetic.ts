// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
import { assert, equal } from "./fixture.ts";
import {
  prefetchSelectedSavedTails,
  preservePrefetchFailures,
} from "../../supabase/functions/_shared/jungsi/infrastructure/reference_tail_prefetch.ts";

Deno.test("factory prefetch uses the same source, scope and at most four concurrent workers", async () => {
  const request = new AbortController(), scope = new AbortController();
  let active = 0, maximum = 0, calls = 0, release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    firstFour = new Promise<void>((resolve) => {
      started = resolve;
    });
  const tail = {
    async getReferenceTail(_id: string, signal?: AbortSignal) {
      assert(signal === scope.signal);
      calls++;
      active++;
      maximum = Math.max(maximum, active);
      if (calls === 4) started();
      await gate;
      active--;
      return null;
    },
  };
  const work = prefetchSelectedSavedTails(
    tail,
    ["a", "b", "c", "d", "e", "a"],
    request.signal,
    scope.signal,
  );
  await firstFour;
  equal(calls, 4);
  equal(maximum, 4);
  release();
  await work;
  equal(calls, 5);
});
Deno.test("abort waits for in-flight workers and does not start another selected read", async () => {
  const request = new AbortController(), scope = new AbortController();
  let calls = 0, release!: () => void, started!: () => void, settled = false;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    firstFour = new Promise<void>((resolve) => {
      started = resolve;
    });
  const tail = {
    async getReferenceTail(_id: string) {
      calls++;
      if (calls === 4) started();
      await gate;
      if (scope.signal.aborted) throw Error("aborted");
      return null;
    },
  };
  const work = prefetchSelectedSavedTails(
    tail,
    ["a", "b", "c", "d", "e"],
    request.signal,
    scope.signal,
  ).then(() => false, () => true).then((v) => {
    settled = true;
    return v;
  });
  await firstFour;
  scope.abort();
  await Promise.resolve();
  assert(!settled);
  equal(calls, 4);
  release();
  assert(await work);
  equal(calls, 4);
});
Deno.test("a selected-source failure is propagated after active workers settle", async () => {
  const request = new AbortController();
  let calls = 0;
  const tail = {
    async getReferenceTail() {
      calls++;
      throw Error("synthetic integrity failure");
    },
  };
  assert(
    await prefetchSelectedSavedTails(tail, ["a", "b"], request.signal).then(
      () => false,
      () => true,
    ),
  );
  assert(calls >= 1);
});
Deno.test("one 3P selection failure does not stop other rows or disappear on retry", async () => {
  const request = new AbortController(),
    failures = new Map<string, unknown>(),
    calls: string[] = [];
  const tail = {
    async getReferenceTail(id: string) {
      calls.push(id);
      if (id === "bad" && calls.filter((v) => v === "bad").length === 1) {
        throw Error(
          "synthetic invalid selection",
        );
      }
      return null;
    },
  };
  await prefetchSelectedSavedTails(tail, ["bad", "good"], request.signal, undefined, failures);
  assert(failures.has("bad"));
  assert(calls.includes("good"));
  const guarded = preservePrefetchFailures(tail, failures);
  assert(await guarded.getReferenceTail!("bad").then(() => false, () => true));
  equal(calls.filter((v) => v === "bad").length, 1);
  equal(await guarded.getReferenceTail!("good"), null);
});
