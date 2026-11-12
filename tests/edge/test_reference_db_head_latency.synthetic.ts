// Preserve the synchronous execution order of async test doubles.
// deno-lint-ignore-file require-await
/** Synthetic timing only; no actual DB, user data, timeout change or retry. */
import {
  type ExistingReferenceDbPin,
  ExistingReferencePercentileDbReader,
  REFERENCE_DB_HEAD_SQL,
} from "../../supabase/functions/_shared/jungsi/infrastructure/reference_percentile_postgres.ts";
import { RuntimeReadBudget } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import type { NativeSqlTransaction } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal, withMonotonic } from "./fixture.ts";
const H = (v: string) => v.repeat(64), owner = "00000000-0000-0000-0000-000000000001";
const pin = {
  releaseId: "reference-percentile:" + H("a"),
  readbackSha256: H("b"),
  datasetSha256: H("c"),
} as ExistingReferenceDbPin;
async function denied(f: () => Promise<unknown>) {
  let rejected = false;
  try {
    await f();
  } catch {
    rejected = true;
  }
  assert(rejected);
}
Deno.test("head query at 1499ms may pass but at 1500ms expires from read start", async () => {
  for (const elapsed of [1499, 1500, 1501]) {
    let now = 0, reads = 0;
    await withMonotonic(() => now, async () => {
      const budget = new RuntimeReadBudget({ maxRequests: 2, maxBytes: 4096 });
      const sql = {
        async read<T>(
          _owner: string,
          work: (tx: NativeSqlTransaction) => Promise<T>,
          signal?: AbortSignal,
        ) {
          return await work({
            async query(q, _p, s) {
              assert(q === REFERENCE_DB_HEAD_SQL && s === signal);
              reads++;
              now += elapsed;
              return [[pin.releaseId, pin.readbackSha256, pin.datasetSha256]];
            },
          });
        },
      };
      const reader = new ExistingReferencePercentileDbReader(
          sql,
          { reserveExternalRead: (n) => budget.reserveExternal(n) },
          1024,
          8192,
          4096,
        ),
        signal = new AbortController().signal;
      if (elapsed < 1500) {
        await reader.assertCurrent(owner, pin, signal);
        reader.currentReceipt(pin, signal).assertCurrent();
      } else {
        await denied(() => reader.assertCurrent(owner, pin, signal));
        let rejected = false;
        try {
          reader.currentReceipt(pin, signal);
        } catch {
          rejected = true;
        }
        assert(rejected);
      }
      equal(reads, 1);
      equal(budget.externalReadSnapshot().operations, 1);
    });
  }
});
Deno.test("a changed head is rejected on refresh and cannot yield a receipt", async () => {
  let now = 0, reads = 0, changed = false;
  await withMonotonic(() => now, async () => {
    const budget = new RuntimeReadBudget({ maxRequests: 2, maxBytes: 4096 });
    const sql = {
      async read<T>(
        _owner: string,
        work: (tx: NativeSqlTransaction) => Promise<T>,
        signal?: AbortSignal,
      ) {
        return await work({
          async query(q, _p, s) {
            assert(q === REFERENCE_DB_HEAD_SQL && s === signal);
            reads++;
            return [[
              changed ? "reference-percentile:" + H("f") : pin.releaseId,
              pin.readbackSha256,
              pin.datasetSha256,
            ]];
          },
        });
      },
    };
    const reader = new ExistingReferencePercentileDbReader(
        sql,
        { reserveExternalRead: (n) => budget.reserveExternal(n) },
        1024,
        8192,
        4096,
      ),
      signal = new AbortController().signal;
    await reader.assertCurrent(owner, pin, signal);
    const oldReceipt = reader.currentReceipt(pin, signal);
    changed = true;
    now = 1500;
    await denied(() => reader.assertCurrent(owner, pin, signal));
    let rejected = false;
    try {
      oldReceipt.assertCurrent();
    } catch {
      rejected = true;
    }
    assert(rejected);
    rejected = false;
    try {
      reader.currentReceipt(pin, signal);
    } catch {
      rejected = true;
    }
    assert(rejected);
    equal(reads, 2);
    equal(budget.externalReadSnapshot().operations, 2);
  });
});
