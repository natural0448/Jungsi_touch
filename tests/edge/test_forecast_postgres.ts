import { syncPromise } from "./fixture.ts";
/** Invented positional SQL protocol only. Positive native school authority QA is separate. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type {
  ManagementDecision,
  ManagementOperation,
} from "../../supabase/functions/_shared/jungsi/application/management_access.ts";
import {
  FORECAST_CURRENT_SCHOOL_SQL,
  FORECAST_DRAFT_INSERT_SQL,
  FORECAST_DRAFT_LIST_SQL,
  FORECAST_DRAFT_READ_SQL,
  FORECAST_DRAFT_UPDATE_SQL,
  FORECAST_PUBLISH_INSERT_SQL,
  FORECAST_PUBLISHED_MANY_SQL,
  FORECAST_REQUEST_INSERT_SQL,
  FORECAST_REQUEST_READ_SQL,
  FORECAST_REQUEST_SCOPE_SQL,
  FORECAST_REVISION_INSERT_SQL,
  SupabaseForecastRepository,
} from "../../supabase/functions/_shared/jungsi/infrastructure/forecast_postgres.ts";
import {
  FORECAST_AUTHORITY_SQL,
  FORECAST_SCOPE_SQL,
} from "../../supabase/functions/_shared/jungsi/infrastructure/management_postgres.ts";
import {
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcInstant } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { assert, equal } from "./fixture.ts";
const OWNER = "00000000-0000-0000-0000-000000000001",
  NOW = utcInstant("2026-10-14T00:00:00.123456Z"),
  TIME = "2026-10-14T00:00:00.123456Z",
  HASH = "a".repeat(64),
  DID = "SYNTHETIC-draft";
function decision(operation: ManagementOperation = "forecast.create"): ManagementDecision {
  return {
    operation,
    subjectId: OWNER,
    evaluatedAtUtc: NOW,
    capabilities: ["editor", "approver"],
    universityIds: ["SYNTHETIC-U"],
  };
}
function draft(revision = 1): NativeObject {
  return {
    draft_id: DID,
    revision,
    context: { university_id: "SYNTHETIC-U", offering_id: "SYNTHETIC-O" },
    updated_at: TIME,
  };
}
function scopeRow() {
  return [DID, "object", "object", "string", "SYNTHETIC-U", "string", DID];
}
type Handler = (s: string, p: readonly unknown[]) => unknown[][] | Promise<unknown[][]>;
function fixture(handler: Handler = () => []) {
  const calls: { s: string; p: readonly unknown[] }[] = [],
    modes: boolean[] = [],
    events: string[] = [];
  const sql = new SupabaseSqlTransport({
    async transaction(readOnly, work) {
      modes.push(readOnly);
      try {
        const result = await work({
          async query(s, p = []) {
            calls.push({ s, p });
            if (s === RUNTIME_ROLE_SQL) {
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
            return await handler(s, p);
          },
        });
        events.push("commit");
        return result;
      } catch (e) {
        events.push("rollback");
        throw e;
      }
    },
    async close() {},
  });
  return {
    calls,
    modes,
    events,
    repo: new SupabaseForecastRepository(sql, {
      maxRecordBytes: 100000,
      maxListRows: 10,
      maxBatchIds: 100,
    }),
  };
}
async function denied(run: () => Promise<unknown>, code: string, http = 503) {
  let e: unknown;
  try {
    await run();
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.code, code);
  equal(e.http, http);
}
Deno.test("forecast SQL current role flags preserve native booleans and inactive rows grant no scope", async () => {
  const f = fixture((s) =>
      s === FORECAST_AUTHORITY_SQL
        ? [["SYNTHETIC-U", true, false], ["SYNTHETIC-inactive", false, false]]
        : []
    ),
    state = await f.repo.readCurrent(OWNER, NOW);
  equal(state.edit, true);
  equal(state.approve, false);
  equal(state.universityIds, ["SYNTHETIC-U"]);
  equal(f.modes, [true]);
  const g = fixture((s) => s === FORECAST_AUTHORITY_SQL ? [["SYNTHETIC-U", 1, false]] : []);
  await denied(() => g.repo.readCurrent(OWNER, NOW), "invalid_repository_result");
});
Deno.test("forecast SQL scope reads only native identity tags before payload", async () => {
  const f = fixture((s) => s === FORECAST_SCOPE_SQL ? [scopeRow()] : []);
  equal(await f.repo.draftScope(OWNER, DID), { draftId: DID, universityId: "SYNTHETIC-U" });
  assert(!FORECAST_SCOPE_SQL.includes("body::text"));
});
Deno.test("forecast payload and list queries include current operation school flags and scalar JSON selected scope", async () => {
  const f = fixture((s) =>
      s === FORECAST_DRAFT_READ_SQL ? [[DID, "1", nativeJsonText(draft()), TIME]] : []
    ),
    r = await f.repo.get(OWNER, DID, decision("forecast.read"));
  equal(r!.revision, 1);
  const params = f.calls.find((c) => c.s === FORECAST_DRAFT_READ_SQL)!.p;
  equal(params, [DID, OWNER, '["SYNTHETIC-U"]', "read"]);
  assert(
    FORECAST_DRAFT_READ_SQL.includes("forecast_authorities") &&
      FORECAST_DRAFT_READ_SQL.includes("can_approve"),
  );
  assert(FORECAST_DRAFT_LIST_SQL.includes("jsonb_array_elements_text"));
});
Deno.test("forecast SQL cannot promote pre-parsed body or inconsistent native revision", async () => {
  const cases = [
    [draft(), "storage_result_invalid"],
    [nativeJsonText({ ...draft(), revision: 2 }), "forecast_release_invalid"],
  ] as const;
  for (const [value, expectedCode] of cases) {
    const f = fixture((s) => s === FORECAST_DRAFT_READ_SQL ? [[DID, "1", value, TIME]] : []);
    await denied(
      () => f.repo.get(OWNER, DID, decision("forecast.read")),
      expectedCode,
    );
  }
});
Deno.test("forecast SQL transaction authorizes before replay and appends native guarded draft revision receipt", async () => {
  const f = fixture((s) =>
    s === FORECAST_DRAFT_INSERT_SQL
      ? [[DID]]
      : s === FORECAST_REVISION_INSERT_SQL
      ? [["1"]]
      : s === FORECAST_REQUEST_INSERT_SQL
      ? [[HASH]]
      : []
  );
  let auth = 0;
  await f.repo.transact(
    OWNER,
    "forecast.create",
    "SYNTHETIC-key",
    HASH,
    NOW,
    () =>
      syncPromise(() => {
        auth++;
        return decision();
      }),
    async (store, d) => {
      await store.put(draft(), null, d);
      return { context: { university_id: "SYNTHETIC-U" }, draft_id: DID };
    },
  );
  equal(auth, 2);
  equal(f.modes, [false]);
  equal(f.events, ["commit"]);
  assert(
    f.calls.findIndex((c) => c.s === "SELECT pg_advisory_xact_lock($1::bigint)") <
      f.calls.findIndex((c) => c.s === FORECAST_REQUEST_SCOPE_SQL),
  );
  for (
    const s of [
      FORECAST_DRAFT_INSERT_SQL,
      FORECAST_REVISION_INSERT_SQL,
      FORECAST_REQUEST_INSERT_SQL,
    ]
  ) assert(s.includes("forecast_authorities") && s.includes("can_edit"));
});
Deno.test("forecast SQL replay checks saved scope and reauthorizes without calling mutation", async () => {
  const result = { context: { university_id: "SYNTHETIC-U" }, draft_id: DID },
    f = fixture((s) =>
      s === FORECAST_REQUEST_SCOPE_SQL
        ? [[HASH, "object", "object", "string", "SYNTHETIC-U"]]
        : s === FORECAST_REQUEST_READ_SQL
        ? [[nativeJsonText(result)]]
        : []
    );
  let auth = 0, mutations = 0;
  const r = await f.repo.transact(
    OWNER,
    "forecast.create",
    "SYNTHETIC-key",
    HASH,
    NOW,
    () =>
      syncPromise(() => {
        auth++;
        return decision();
      }),
    () =>
      syncPromise(() => {
        mutations++;
        return {};
      }),
  );
  equal(r, result);
  equal(auth, 2);
  equal(mutations, 0);
});
Deno.test("forecast SQL replay cannot read another school's saved body", async () => {
  const f = fixture((s) =>
    s === FORECAST_REQUEST_SCOPE_SQL
      ? [[HASH, "object", "object", "string", "SYNTHETIC-other"]]
      : []
  );
  await denied(
    () =>
      f.repo.transact(
        OWNER,
        "forecast.create",
        "SYNTHETIC-key",
        HASH,
        NOW,
        () => syncPromise(() => decision()),
        () => syncPromise(() => ({})),
      ),
    "forecast_not_found",
    404,
  );
  assert(!f.calls.some((c) => c.s === FORECAST_REQUEST_READ_SQL));
  equal(f.events, ["rollback"]);
});
Deno.test("forecast SQL changed request hash conflicts after current school authorization", async () => {
  const f = fixture((s) =>
    s === FORECAST_REQUEST_SCOPE_SQL
      ? [["b".repeat(64), "object", "object", "string", "SYNTHETIC-U"]]
      : []
  );
  await denied(
    () =>
      f.repo.transact(
        OWNER,
        "forecast.create",
        "SYNTHETIC-key",
        HASH,
        NOW,
        () => syncPromise(() => decision()),
        () => syncPromise(() => ({})),
      ),
    "idempotency_conflict",
    409,
  );
  assert(!f.calls.some((c) => c.s === FORECAST_REQUEST_READ_SQL));
});
Deno.test("forecast SQL denied school at write rolls back instead of granting role-table update", async () => {
  const f = fixture((s) => s === FORECAST_CURRENT_SCHOOL_SQL ? [[false]] : []);
  await denied(
    () =>
      f.repo.transact(
        OWNER,
        "forecast.create",
        "SYNTHETIC-key",
        HASH,
        NOW,
        () => syncPromise(() => decision()),
        async (store, d) => {
          await store.put(draft(), null, d);
          return {};
        },
      ),
    "forecast_forbidden",
    403,
  );
  equal(f.events, ["rollback"]);
  assert(!f.calls.some((c) => c.s.includes("UPDATE jungsi_backend.forecast_authorities")));
  assert(!f.calls.some((c) => c.s === FORECAST_REQUEST_INSERT_SQL));
});
Deno.test("forecast SQL CAS miss remains a revision conflict when current school authority is active", async () => {
  const f = fixture((s) => s === FORECAST_CURRENT_SCHOOL_SQL ? [[true]] : []);
  await denied(
    () =>
      f.repo.transact(
        OWNER,
        "forecast.validate",
        "SYNTHETIC-key",
        HASH,
        NOW,
        () => syncPromise(() => decision("forecast.validate")),
        async (store, d) => {
          await store.put(draft(2), 1, d);
          return {};
        },
      ),
    "revision_conflict",
    409,
  );
  assert(FORECAST_DRAFT_UPDATE_SQL.includes("d.revision=$5::bigint"));
  equal(f.events, ["rollback"]);
});
Deno.test("forecast SQL self-approval write rejects editor revocation while approver remains active", async () => {
  const f = fixture((s, p) => s === FORECAST_CURRENT_SCHOOL_SQL ? [[p[2] === "approve"]] : []);
  await denied(
    () =>
      f.repo.transact(
        OWNER,
        "forecast.approve",
        "SYNTHETIC-key",
        HASH,
        NOW,
        () => syncPromise(() => decision("forecast.approve")),
        async (store, d) => {
          await store.put({ ...draft(2), status: "approved", contributors: [OWNER] }, 1, d);
          return {};
        },
      ),
    "forecast_forbidden",
    403,
  );
  equal(f.events, ["rollback"]);
  assert(f.calls.some((c) => c.s === FORECAST_CURRENT_SCHOOL_SQL && c.p[2] === "edit"));
  assert(
    FORECAST_DRAFT_UPDATE_SQL.includes("contributors") &&
      FORECAST_DRAFT_UPDATE_SQL.includes("can_edit"),
  );
  assert(!f.calls.some((c) => c.s === FORECAST_REVISION_INSERT_SQL));
});
Deno.test("forecast publication SQL requires approved parent receipt and published reads validate native provenance", async () => {
  const body = {
    release_id: "SYNTHETIC-release",
    context: { offering_id: "SYNTHETIC-O" },
    published_at: TIME,
  };
  const f = fixture((s) =>
    s === FORECAST_PUBLISHED_MANY_SQL
      ? [["SYNTHETIC-O", "SYNTHETIC-release", nativeJsonText(body), TIME, true]]
      : []
  );
  const rows = await f.repo.publishedMany(OWNER, ["SYNTHETIC-O", "SYNTHETIC-missing"]);
  equal(rows.get("SYNTHETIC-O"), body);
  equal(rows.get("SYNTHETIC-missing"), null);
  assert(
    FORECAST_PUBLISH_INSERT_SQL.includes("forecast_revisions") &&
      FORECAST_PUBLISHED_MANY_SQL.includes("contributors"),
  );
  const g = fixture((s) =>
    s === FORECAST_PUBLISHED_MANY_SQL
      ? [["SYNTHETIC-O", "SYNTHETIC-release", nativeJsonText(body), TIME, false]]
      : []
  );
  assert(
    (await g.repo.publishedMany(OWNER, ["SYNTHETIC-O"])).get("SYNTHETIC-O") instanceof AccessError,
  );
});
Deno.test("forecast batch SQL distinguishes absent malformed null duplicate and wrong offering results", async () => {
  const f = fixture((s) =>
      s === FORECAST_PUBLISHED_MANY_SQL
        ? [["SYNTHETIC-O", "SYNTHETIC-release", "null", TIME, true]]
        : []
    ),
    r = await f.repo.publishedMany(OWNER, ["SYNTHETIC-O", "SYNTHETIC-absent"]);
  assert(r.get("SYNTHETIC-O") instanceof AccessError);
  equal(r.get("SYNTHETIC-absent"), null);
  const g = fixture((s) =>
    s === FORECAST_PUBLISHED_MANY_SQL
      ? [["SYNTHETIC-other", "SYNTHETIC-release", "{}", TIME, true]]
      : []
  );
  await denied(() => g.repo.publishedMany(OWNER, ["SYNTHETIC-O"]), "forecast_release_invalid");
});
