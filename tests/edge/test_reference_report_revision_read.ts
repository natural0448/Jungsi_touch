// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
/** Synthetic owner-scoped immutable report read; no production DB access. */
import {
  REPORT_READ_REVISION_SQL,
  SupabasePlatformRepository,
} from "../../supabase/functions/_shared/jungsi/infrastructure/platform_postgres.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
const OWNER = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002";
function setup(row: unknown[][]) {
  const calls: { sql: string; params: readonly unknown[] }[] = [], modes: boolean[] = [];
  const pool: NativeSqlPool = {
    async transaction(readOnly, work) {
      modes.push(readOnly);
      return await work({
        async query(sql, params = []) {
          calls.push({ sql, params });
          if (sql === RUNTIME_ROLE_SQL) {
            return [[
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
          }
          if (sql === REPORT_READ_REVISION_SQL) return row;
          return [];
        },
      });
    },
    async close() {},
  };
  return {
    repo: new SupabasePlatformRepository(new SupabaseSqlTransport(pool), { maxRecordBytes: 4096 }),
    calls,
    modes,
  };
}
async function denied(f: () => Promise<unknown>) {
  let failed = false;
  try {
    await f();
  } catch {
    failed = true;
  }
  assert(failed);
}
Deno.test("historical report is selected by authenticated owner and exact revision in read-only role", async () => {
  const f = setup([[
    "synthetic-report",
    OWNER,
    "synthetic-profile",
    "2",
    '{"synthetic":true}',
    "2026-11-09T00:00:00.000000Z",
  ]]);
  const r = await f.repo.getReportRevision(OWNER, "synthetic-report", 2);
  assert(r !== null);
  equal(r.owner_id, OWNER);
  equal(r.revision, 2);
  equal(f.calls.find((x) => x.sql === REPORT_READ_REVISION_SQL)?.params, [
    "synthetic-report",
    OWNER,
    "2",
  ]);
  equal(f.modes, [true]);
  assert(
    REPORT_READ_REVISION_SQL.includes("v.owner_id=$2") &&
      REPORT_READ_REVISION_SQL.includes("v.revision=$3"),
  );
  assert(
    REPORT_READ_REVISION_SQL.includes("has_any_column_privilege") &&
      REPORT_READ_REVISION_SQL.includes("relrowsecurity"),
  );
});
Deno.test("historical reader rejects different owner, wrong revision, invalid input and duplicate rows", async () => {
  const row = [
    "synthetic-report",
    OTHER,
    "synthetic-profile",
    "2",
    "{}",
    "2026-11-09T00:00:00.000000Z",
  ];
  await denied(() => setup([row]).repo.getReportRevision(OWNER, "synthetic-report", 2));
  await denied(() =>
    setup([[...row.slice(0, 1), OWNER, ...row.slice(2)]]).repo.getReportRevision(
      OWNER,
      "synthetic-report",
      3,
    )
  );
  await denied(() => setup([]).repo.getReportRevision(OWNER, "synthetic-report", 0));
  await denied(() => setup([row, row]).repo.getReportRevision(OWNER, "synthetic-report", 2));
  equal(await setup([]).repo.getReportRevision(OWNER, "synthetic-report", 2), null);
});
