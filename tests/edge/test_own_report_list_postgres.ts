import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  OWN_REPORT_LIST_SQL,
  SupabaseOwnReportList,
} from "../../supabase/functions/_shared/jungsi/infrastructure/own_report_list_postgres.ts";
import type { SupabaseSqlTransport } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
const OWNER = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002",
  NOW = 1700000000000000n;
function fixture(rows: unknown[][]) {
  const calls: { owner: string; sql: string; args: readonly unknown[] }[] = [];
  const sql = {
    read: async (
      owner: string,
      work: (
        tx: {
          query: (s: string, a: readonly unknown[]) => Promise<unknown[][]>;
        },
      ) => Promise<unknown>,
    ) =>
      await work({
        query: (statement, args) => {
          calls.push({ owner, sql: statement, args });
          return Promise.resolve(rows);
        },
      }),
  } as unknown as SupabaseSqlTransport;
  return { port: new SupabaseOwnReportList(sql), calls };
}
Deno.test("own report SQL uses existing owner joins, bounded scalar parameters and no report body", async () => {
  const f = fixture([[
    "SYNTHETIC-report",
    OWNER,
    OWNER,
    "SYNTHETIC-exam",
    "2",
    "2023-11-14T22:13:19.999999Z",
  ]]);
  const rows = await f.port.read({
    owner: OWNER,
    examId: "SYNTHETIC-exam",
    asOfUtc: NOW,
    after: null,
    take: 11,
  });
  equal(rows[0].revision, 2);
  assert(rows[0].updatedAtUtc === NOW - 1n);
  equal(f.calls.length, 1);
  equal(f.calls[0].owner, OWNER);
  equal(f.calls[0].sql, OWN_REPORT_LIST_SQL);
  equal(f.calls[0].args, [
    OWNER,
    "SYNTHETIC-exam",
    "2023-11-14T22:13:20Z",
    null,
    null,
    11,
  ]);
  assert(OWN_REPORT_LIST_SQL.includes("r.owner_id=$1 AND p.owner_id=$1"));
  assert(OWN_REPORT_LIST_SQL.includes("LIMIT $6"));
  assert(OWN_REPORT_LIST_SQL.includes('r.report_id COLLATE "C" DESC'));
  assert(OWN_REPORT_LIST_SQL.includes('$5::text COLLATE "C"'));
  assert(!/COUNT\s*\(|body::|scores::|SELECT\s+\*/i.test(OWN_REPORT_LIST_SQL));
});
Deno.test("own report SQL rejects foreign result owner and invalid bounded request", async () => {
  for (const kind of ["foreign", "too_many", "bad_take"]) {
    const rows = kind === "too_many"
      ? Array.from(
        { length: 3 },
        () => [
          "SYNTHETIC-report",
          OWNER,
          OWNER,
          "SYNTHETIC-exam",
          "2",
          "2023-11-14T22:13:19.999999Z",
        ],
      )
      : [[
        "SYNTHETIC-report",
        OWNER,
        OTHER,
        "SYNTHETIC-exam",
        "2",
        "2023-11-14T22:13:19.999999Z",
      ]];
    const f = fixture(rows);
    let rejected = false;
    try {
      await f.port.read({
        owner: OWNER,
        examId: null,
        asOfUtc: NOW,
        after: null,
        take: kind === "bad_take" ? 22 : 2,
      });
    } catch (e) {
      assert(e instanceof AccessError);
      equal(e.code, "storage_result_invalid");
      rejected = true;
    }
    assert(rejected);
    if (kind === "bad_take") equal(f.calls.length, 0);
  }
});
Deno.test("own report SQL preserves a missing legacy exam identifier as null", async () => {
  const f = fixture([["SYNTHETIC-legacy", OWNER, OWNER, null, "1", "2023-11-14T22:13:19.999999Z"]]);
  const rows = await f.port.read({
    owner: OWNER,
    examId: null,
    asOfUtc: NOW,
    after: null,
    take: 11,
  });
  equal(rows[0].examId, null);
});
