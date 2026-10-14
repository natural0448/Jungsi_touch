import { syncPromise } from "./fixture.ts";
/** Transaction and positional-row boundaries; no database or network calls. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { PASS_STATE_SQL } from "../../supabase/functions/_shared/jungsi/infrastructure/public_passes.ts";
import {
  type NativeSqlPool,
  type NativeSqlTransaction,
  RUNTIME_ROLE_SQL,
  SUBJECT_CONTEXT_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";

const UID = "00000000-0000-0000-0000-000000000001";
const WHEN = "2026-10-14T00:00:00.000001Z";
const PASS = [true, ["columns"], ["constraints"], [true, false], ["policies"], null];
function fixture(transform?: (rows: unknown[][]) => unknown[][]) {
  const calls: { statement: string; parameters: readonly unknown[] }[] = [], modes: boolean[] = [];
  let closed = 0;
  const pool: NativeSqlPool = {
    async transaction<T>(readOnly: boolean, work: (tx: NativeSqlTransaction) => Promise<T>) {
      modes.push(readOnly);
      return await work({
        query(statement, parameters = []) {
          return syncPromise(() => {
            calls.push({ statement, parameters });
            if (statement === RUNTIME_ROLE_SQL) {
              const rows = [[
                "jungsi_backend_app",
                false,
                false,
                "on",
                readOnly ? "on" : "off",
                false,
                false,
                false,
                "UTC",
              ]];
              return transform ? transform(rows) : rows;
            }
            if (statement.startsWith("WITH runtime_guard")) {
              return [
                PASS.map((value, index) =>
                  index >= 1 && index <= 4 ? JSON.stringify(value) : value
                ),
              ];
            }
            return [];
          });
        },
      });
    },
    close() {
      return syncPromise(() => {
        closed++;
      });
    },
  };
  return { port: new SupabaseSqlTransport(pool), calls, modes, closed: () => closed };
}
async function errorCode(run: () => Promise<unknown>, code: string, status = 503) {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, code);
  equal(error.http, status);
}
Deno.test("SQL pass metadata role guard and MAX use one positional data query", async () => {
  const f = fixture();
  equal(await f.port.readOnlyOne(PASS_STATE_SQL, ["jungsi_backend_app", UID, WHEN, WHEN]), PASS);
  equal(f.modes, [true]);
  equal(f.calls.slice(0, 3).map((x) => x.statement), [
    "SET LOCAL TIME ZONE 'UTC'",
    "SET LOCAL row_security='on'",
    "SET LOCAL statement_timeout='5000ms'",
  ]);
  const data = f.calls.filter((x) => x.statement.startsWith("WITH runtime_guard"));
  equal(data.length, 1);
  equal(data[0].parameters, ["jungsi_backend_app", UID, WHEN, WHEN]);
  assert(data[0].statement.includes(PASS_STATE_SQL));
  assert(data[0].statement.includes("pg_has_role(current_user,'jungsi_backend_owner','MEMBER')"));
});
Deno.test("SQL null-subject metadata probe does not fabricate an authenticated subject", async () => {
  const f = fixture();
  await f.port.readOnlyOne(PASS_STATE_SQL, ["jungsi_backend_app", null, WHEN, WHEN]);
  equal(f.calls.filter((x) => x.statement === SUBJECT_CONTEXT_SQL).length, 0);
});
Deno.test("SQL pass rejects arbitrary SQL role subject and split evaluation times", async () => {
  const f = fixture();
  await errorCode(() => f.port.readOnlyOne("SELECT private", []), "entitlement_unavailable");
  for (
    const p of [
      ["postgres", UID, WHEN, WHEN],
      ["jungsi_backend_app", "client", WHEN, WHEN],
      ["jungsi_backend_app", UID, WHEN, "2026-10-15T00:00:00Z"],
      ["jungsi_backend_app", UID, "2026-02-30T00:00:00Z", "2026-02-30T00:00:00Z"],
    ]
  ) await errorCode(() => f.port.readOnlyOne(PASS_STATE_SQL, p), "entitlement_unavailable");
  equal(f.modes, []);
});
Deno.test("SQL transactions bind server subject locally before protected work", async () => {
  const f = fixture();
  let work = 0;
  await f.port.write(UID, () =>
    syncPromise(() => {
      work++;
      return "ok";
    }));
  equal(f.modes, [false]);
  equal(work, 1);
  const claim = f.calls.find((x) => x.statement === SUBJECT_CONTEXT_SQL);
  assert(claim);
  equal(claim.parameters, [UID, JSON.stringify({ sub: UID, role: "authenticated" })]);
  assert(f.calls.findIndex((x) => x.statement === RUNTIME_ROLE_SQL) > f.calls.indexOf(claim));
});
Deno.test("SQL read mode and exact runtime role are verified for every transaction", async () => {
  const f = fixture();
  equal(await f.port.read(UID, () => syncPromise(() => "ok")), "ok");
  equal(f.modes, [true]);
});
Deno.test("SQL wrong identity superuser bypass membership RLS mode and timezone close work", async () => {
  const mutations: [number, unknown][] = [
    [0, "postgres"],
    [1, true],
    [2, true],
    [3, "off"],
    [4, "off"],
    [5, true],
    [6, true],
    [7, true],
    [8, "Asia/Seoul"],
  ];
  for (const [index, value] of mutations) {
    const f = fixture((rows) => {
      rows[0][index] = value;
      return rows;
    });
    let work = 0;
    await errorCode(() =>
      f.port.read(UID, () =>
        syncPromise(() => {
          work++;
        })), "storage_runtime_role_unverified");
    equal(work, 0);
  }
});
Deno.test("SQL invalid subject fails before any transaction", async () => {
  const f = fixture();
  await errorCode(
    () => f.port.write("client", () => syncPromise(() => null)),
    "storage_identity_invalid",
  );
  equal(f.modes, []);
});
Deno.test("SQL business conflict survives transaction rollback boundary", async () => {
  const f = fixture();
  await errorCode(
    () =>
      f.port.write(UID, () => {
        throw new AccessError("revision_conflict", 409);
      }),
    "revision_conflict",
    409,
  );
});
Deno.test("SQL native dependency exception exposes only safe storage failure", async () => {
  const f = fixture();
  await errorCode(() =>
    f.port.write(UID, () => {
      throw new Error("SYNTHETIC-PRIVATE-DB");
    }), "storage_unavailable");
});
Deno.test("SQL close releases the injected pool without filesystem cleanup", async () => {
  const f = fixture();
  await f.port.close();
  equal(f.closed(), 1);
});
