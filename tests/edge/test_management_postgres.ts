import { syncPromise } from "./fixture.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { CatalogService } from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import {
  authorizeManagement,
  requireManagementUniversity,
} from "../../supabase/functions/_shared/jungsi/application/management_access.ts";
import {
  FORECAST_AUTHORITY_SQL,
  FORECAST_SCOPE_SQL,
  SupabaseForecastAuthorities,
  SupabaseManagementResources,
} from "../../supabase/functions/_shared/jungsi/infrastructure/management_postgres.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { syntheticCatalog } from "./synthetic_catalog.ts";
import { assert, equal } from "./fixture.ts";
const SUBJECT = "00000000-0000-0000-0000-000000000001", NOW = 1700000000000000n;
function fixture(authorityRows: unknown[][] = [], draftRows: unknown[][] = []) {
  const calls: { s: string; p: readonly unknown[] }[] = [];
  const pool: NativeSqlPool = {
    async transaction(readOnly, work) {
      assert(readOnly);
      return await work({
        query(s, p = []) {
          return syncPromise(() => {
            calls.push({ s, p });
            return s === RUNTIME_ROLE_SQL
              ? [["jungsi_backend_app", false, false, "on", "on", false, false, false, "UTC"]]
              : s === FORECAST_AUTHORITY_SQL
              ? authorityRows
              : s === FORECAST_SCOPE_SQL
              ? draftRows
              : [];
          });
        },
      });
    },
    async close() {},
  };
  const sql = new SupabaseSqlTransport(pool),
    catalog = new CatalogService({
      getCatalog() {
        return syncPromise(() => {
          return syntheticCatalog();
        });
      },
    }, { nowUtc: () => NOW });
  return {
    calls,
    authorities: new SupabaseForecastAuthorities(sql),
    resources: new SupabaseManagementResources(sql, catalog, { maxDraftBytes: 100000 }),
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
Deno.test("management SQL exact native permissions bind verified subject and active scope union", async () => {
  const f = fixture([["SYNTHETIC-edit", true, false], ["SYNTHETIC-approve", false, true], [
      "SYNTHETIC-none",
      false,
      false,
    ]]),
    s = await f.authorities.readCurrent(SUBJECT, NOW);
  equal(s.universityIds, ["SYNTHETIC-edit", "SYNTHETIC-approve"]);
  equal(s.editUniversityIds, ["SYNTHETIC-edit"]);
  equal(s.approveUniversityIds, ["SYNTHETIC-approve"]);
  equal(f.calls.find((c) => c.s === FORECAST_AUTHORITY_SQL)!.p, [SUBJECT]);
  assert(Object.isFrozen(s));
});
Deno.test("management SQL missing and inactive-only rows yield no staff capability", async () => {
  for (const rows of [[], [["SYNTHETIC-none", false, false]]]) {
    const f = fixture(rows), s = await f.authorities.readCurrent(SUBJECT, NOW);
    equal(s.edit, false);
    equal(s.approve, false);
    equal(s.universityIds, []);
  }
});
Deno.test("management SQL cannot coerce numeric string null flags or duplicate school rows", async () => {
  for (
    const rows of [[["SYNTHETIC-a", 1, false]], [["SYNTHETIC-a", "true", false]], [[
      "SYNTHETIC-a",
      true,
      null,
    ]], [["SYNTHETIC-a", true, false], ["SYNTHETIC-a", false, true]]]
  ) {
    await denied(
      () => fixture(rows).authorities.readCurrent(SUBJECT, NOW),
      "invalid_repository_result",
    );
  }
});
Deno.test("management SQL current roles still require AAL2 and do not grant another school", async () => {
  const f = fixture([["SYNTHETIC-edit", true, false]]),
    user = {
      subjectId: SUBJECT,
      expiresAtUtc: NOW + 1000000n,
      assuranceLevel: "aal1" as const,
      accountStatus: "active",
    };
  await denied(
    () => authorizeManagement(user, f.authorities, NOW, "forecast.create"),
    "management_mfa_required",
    403,
  );
  const d = await authorizeManagement(
    { ...user, assuranceLevel: "aal2" },
    f.authorities,
    NOW,
    "forecast.create",
  );
  let e: unknown;
  try {
    requireManagementUniversity(d, "SYNTHETIC-other");
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.http, 404);
});
Deno.test("management draft scope reads only identity and validates native JSON type tags", async () => {
  const f = fixture([], [[
    "SYNTHETIC-draft",
    "object",
    "object",
    "string",
    "SYNTHETIC-u1",
    "string",
    "SYNTHETIC-draft",
  ]]);
  equal(await f.resources.readScope("draft", "SYNTHETIC-draft", SUBJECT), {
    kind: "draft",
    id: "SYNTHETIC-draft",
    universityId: "SYNTHETIC-u1",
  });
  assert(FORECAST_SCOPE_SQL.includes("jsonb_typeof"));
  assert(!FORECAST_SCOPE_SQL.includes("body::text"));
  equal(f.calls.find((c) => c.s === FORECAST_SCOPE_SQL)!.p, ["SYNTHETIC-draft"]);
});
Deno.test("management draft numeric array unknown and mismatched scope identities close scope", async () => {
  for (
    const value of [
      ["SYNTHETIC-draft", "object", "object", "number", "2", "string", "SYNTHETIC-draft"],
      ["SYNTHETIC-draft", "object", "object", "array", "[]", "string", "SYNTHETIC-draft"],
      [
        "SYNTHETIC-draft",
        "object",
        "object",
        "string",
        "SYNTHETIC-u1",
        "string",
        "SYNTHETIC-different",
      ],
      ["SYNTHETIC-draft", "object", "object", null, null, "string", "SYNTHETIC-draft"],
    ]
  ) {
    await denied(
      () =>
        fixture([], [value]).resources.readScope(
          "draft",
          "SYNTHETIC-draft",
          SUBJECT,
        ),
      "invalid_repository_result",
    );
  }
});
Deno.test("management resource offering scope uses approved nonpractical catalog and preserves missing draft", async () => {
  const f = fixture();
  equal(await f.resources.readScope("offering", "SYNTHETIC-a", SUBJECT), {
    kind: "offering",
    id: "SYNTHETIC-a",
    universityId: "SYNTHETIC-u1",
  });
  equal(await f.resources.readScope("offering", "SYNTHETIC-d", SUBJECT), null);
  equal(await f.resources.readScope("draft", "SYNTHETIC-missing", SUBJECT), null);
});
