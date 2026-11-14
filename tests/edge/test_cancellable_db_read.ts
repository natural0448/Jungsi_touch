// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
/** Synthetic DB query cancellation and shared request-budget accounting. */
import { cancellableSqlQuery } from "../../supabase/functions/_shared/jungsi/infrastructure/cancellable_sql_query.ts";
import { RuntimeReadBudget } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
async function denied(f: () => unknown) {
  let e = false;
  try {
    await f();
  } catch {
    e = true;
  }
  assert(e);
}
Deno.test("cancelled SQL sends one driver cancellation and waits for query to settle", async () => {
  const ctrl = new AbortController();
  let cancelled = 0, finish: (v: number) => void = () => {};
  const q = Object.assign(
    new Promise<number>((resolve) => {
      finish = resolve;
    }),
    {
      cancel() {
        cancelled++;
      },
    },
  );
  let done = false;
  const result = cancellableSqlQuery(q, ctrl.signal).then(() => {
    done = true;
  }, () => {
    done = true;
  });
  ctrl.abort();
  await Promise.resolve();
  equal(cancelled, 1);
  equal(done, false);
  finish(5);
  await result;
  equal(done, true);
  equal(cancelled, 1);
});
Deno.test("already cancelled SQL is still awaited and cannot succeed", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let n = 0;
  const q = Object.assign(Promise.resolve(5), {
    cancel() {
      n++;
    },
  });
  await denied(() => cancellableSqlQuery(q, ctrl.signal));
  equal(n, 1);
});
Deno.test("external SQL reserves from the same request and byte budget", async () => {
  const budget = new RuntimeReadBudget({ maxRequests: 2, maxBytes: 10 }),
    settle = budget.reserveExternal(6);
  settle(3);
  const state = budget.snapshot();
  equal(state.requests, 1);
  equal(state.bytes, 6);
  equal(state.physicalBytes, 0);
  equal(budget.externalReadSnapshot(), { operations: 1, payloadBytes: 3 });
  await denied(() => budget.reserveExternal(5));
  await denied(() => settle(1));
  const second = budget.reserveExternal(4);
  second(4);
  await denied(() => budget.reserveExternal(1));
});
Deno.test("SQL transport passes request signal to every read-only setup and role query", async () => {
  const seen: (AbortSignal | undefined)[] = [], controller = new AbortController();
  const modes: boolean[] = [];
  const pool: NativeSqlPool = {
    async transaction(ro, work) {
      modes.push(ro);
      return await work({
        async query(statement, _params, signal) {
          seen.push(signal);
          if (statement === RUNTIME_ROLE_SQL) {
            return [["jungsi_backend_app", false, false, "on", "on", false, false, false, "UTC"]];
          }
          return [];
        },
      });
    },
    async close() {},
  };
  const sql = new SupabaseSqlTransport(pool), owner = "00000000-0000-0000-0000-000000000001";
  await sql.read(owner, async (tx) => {
    await tx.query("SELECT 1", [], controller.signal);
    return 1;
  }, controller.signal);
  assert(seen.length >= 6 && seen.every((s) => s === controller.signal));
  equal(modes, [true]);
  controller.abort();
  await denied(() => sql.read(owner, async () => 1, controller.signal));
  equal(modes.length, 1);
});
