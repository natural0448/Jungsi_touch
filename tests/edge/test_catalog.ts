import { syncPromise } from "./fixture.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type {
  ApiExecution,
  ApiOperationId,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import {
  type CatalogRelease,
  CatalogService,
} from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  pythonTrim,
  unicodeCasefold,
} from "../../supabase/functions/_shared/jungsi/domain/text.ts";
import { syntheticCatalog } from "./synthetic_catalog.ts";
import { assert, equal } from "./fixture.ts";
const NOW = 1700000000000000n;
function req(
  op: ApiOperationId,
  query: Record<string, string> = {},
  paid = true,
  offering = "SYNTHETIC-a",
): ApiExecution {
  return {
    operation: op,
    session: {
      user: {
        subjectId: "00000000-0000-0000-0000-000000000001",
        expiresAtUtc: NOW + 1000000n,
      },
      evaluatedAtUtc: NOW,
      tier: paid ? "paid" : "standard",
      paidUntilUtc: paid ? NOW + 500000n : null,
    },
    management: null,
    body: {},
    query,
    params: { offering_id: offering },
    requestKey: null,
  };
}
function fixture(release: CatalogRelease | null = syntheticCatalog()) {
  let calls = 0;
  const data = {
    getCatalog() {
      return syncPromise(() => {
        calls++;
        return release;
      });
    },
  };
  return {
    service: new CatalogService(data, { nowUtc: () => NOW }),
    calls: () => calls,
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
Deno.test("catalog search retains all nonpractical offerings including nonpractical arts", async () => {
  const f = fixture(), r = await f.service.execute(req("offerings.search"));
  const rows = r.items as NativeObject[];
  equal(rows.map((r) => r.offering_id), [
    "SYNTHETIC-c",
    "SYNTHETIC-a",
    "SYNTHETIC-b",
  ]);
  equal(r.matching_offering_count, 3);
  equal(r.matching_school_count, 2);
  assert(rows.every((row) => !Object.hasOwn(row, "private_source")));
  assert(rows.some((row) => row.department === "가상예술 비실기"));
});
Deno.test("catalog history reads verified official states and preserves zero null original year and rank unit", async () => {
  const r = await fixture().service.execute(req("history.search", {}, false)),
    rows = r.items as NativeObject[];
  equal(rows.length, 4);
  assert(rows.some((row) => row.value === 0));
  assert(rows.some((row) => row.value === null));
  assert(rows.some((row) => row.academic_year === 2026));
  equal(rows.find((row) => row.metric_name === "SYNTHETIC-rank")!.unit, "번");
  assert(
    rows.every((row) =>
      !String(row.metric_name).includes("unverified") &&
      !String(row.metric_name).includes("practical")
    ),
  );
});
Deno.test("catalog Unicode casefold and Python whitespace preserve existing search meaning", async () => {
  equal(unicodeCasefold("Straße Σς İ"), "strasse σσ i̇");
  equal(pythonTrim("\u001c value \u001f"), "value");
  equal(pythonTrim("\ufeffvalue\ufeff"), "\ufeffvalue\ufeff");
  // CPython 3.12 str.isspace reference; include both neighbors and every BMP nonmember.
  const pythonSpaces = new Set([
    9,
    10,
    11,
    12,
    13,
    28,
    29,
    30,
    31,
    32,
    133,
    160,
    5760,
    8192,
    8193,
    8194,
    8195,
    8196,
    8197,
    8198,
    8199,
    8200,
    8201,
    8202,
    8232,
    8233,
    8239,
    8287,
    12288,
  ]);
  for (let code = 0; code <= 0xffff; code++) {
    const char = String.fromCharCode(code), value = char + "SYNTHETIC" + char;
    equal(pythonTrim(value), pythonSpaces.has(code) ? "SYNTHETIC" : value);
  }
  const r = await fixture().service.execute(
    req("offerings.search", {
      university_q: " STRASSE ",
      department_q: "가상간호",
    }),
  );
  equal((r.items as unknown[]).length, 2);
});
Deno.test("catalog pagination covers all matching rows with stable counts and allows limit changes", async () => {
  const f = fixture(),
    first = await f.service.execute(req("offerings.search", { limit: "1" }));
  assert(typeof first.next_cursor === "string");
  const second = await f.service.execute(
    req("offerings.search", { limit: "2", cursor: first.next_cursor }),
  );
  equal((first.items as unknown[]).length, 1);
  equal((second.items as unknown[]).length, 2);
  equal(second.next_cursor, null);
  equal(second.matching_offering_count, 3);
});
Deno.test("catalog cursor binds release and query without making missing rows zero", async () => {
  const first = await fixture().service.execute(
    req("offerings.search", { limit: "1" }),
  );
  const cursor = first.next_cursor as string;
  await denied(
    () =>
      fixture().service.execute(
        req("offerings.search", { cursor, department_q: "다른가상학과" }),
      ),
    "cursor_version_mismatch",
    409,
  );
  const r = syntheticCatalog();
  await denied(
    () =>
      fixture({ ...r, version: "SYNTHETIC-catalog.v2" }).service.execute(
        req("offerings.search", { cursor }),
      ),
    "cursor_version_mismatch",
    409,
  );
});
Deno.test("catalog cursor float index is rejected without integer coercion", async () => {
  const first = await fixture().service.execute(
    req("offerings.search", { limit: "1" }),
  );
  const raw = atob(
    (first.next_cursor as string).replaceAll("-", "+").replaceAll("_", "/"),
  );
  const cursor = btoa(raw.replace(", 1,", ", 1.0,"));
  await denied(
    () => fixture().service.execute(req("offerings.search", { cursor })),
    "invalid_cursor",
    422,
  );
});
Deno.test("catalog recruitment keeps true zero and unpublished null and converts instants only", async () => {
  const result = await fixture().service.execute(
      req("recruitment.read", {}, false),
    ),
    r = result.recruitment as NativeObject;
  equal(r.initial_count, 0);
  equal(r.rollover_change, null);
  equal(r.final_count, 0);
  equal(r.deadline, "2027-01-01");
  equal(r.deadline_at, "2027-01-01T00:00:00.123456Z");
  const c = (r.changes as NativeObject[])[0];
  equal(c.announced_date, "2026-10-14");
  equal(c.announced_at, "2026-10-14T00:00:00.123456Z");
  assert(!Object.hasOwn(c, "private_source"));
});
Deno.test("catalog absent recruitment and missing release stay pending with null values", async () => {
  const r = await fixture().service.execute(
    req("recruitment.read", {}, false, "SYNTHETIC-b"),
  );
  equal(r.status, "pending");
  equal(r.recruitment, null);
  const absent = await fixture(null).service.execute(req("history.search"));
  equal(absent.items, null);
  equal(absent.matching_offering_count, null);
  equal(absent.matching_school_count, null);
});
Deno.test("catalog read cannot turn unknown practical requirement or duplicate identity into approved data", async () => {
  const r = syntheticCatalog();
  r.offerings[0].practical_required = null;
  await denied(
    () => fixture(r).service.execute(req("offerings.search")),
    "catalog_scope_unverified",
  );
  const q = syntheticCatalog();
  q.offerings[1].offering_id = q.offerings[0].offering_id;
  await denied(
    () => fixture(q).service.execute(req("offerings.search")),
    "catalog_identity_conflict",
  );
});
Deno.test("catalog recruitment decimal count bool and private source URL fail safely", async () => {
  for (const v of [new JsonFloat("0.0"), false]) {
    const r = syntheticCatalog();
    (r.offerings[0].recruitment as NativeObject).initial_count = v;
    await denied(
      () => fixture(r).service.execute(req("recruitment.read")),
      "recruitment_count_invalid",
    );
  }
  const r = syntheticCatalog();
  (r.offerings[0].recruitment as NativeObject).source_url =
    "https://example.org/SYNTHETIC?token=private";
  await denied(
    () => fixture(r).service.execute(req("recruitment.read")),
    "public_source_invalid",
  );
});
Deno.test("catalog published metric boolean is invalid and unverified observations are not promoted", async () => {
  const r = syntheticCatalog();
  r.history[0].value = true;
  await denied(
    () => fixture(r).service.execute(req("history.search")),
    "published_metric_invalid",
  );
});
Deno.test("catalog unapproved data and service excluded offering remain distinct failures", async () => {
  const r = syntheticCatalog();
  await denied(
    () =>
      fixture({ ...r, status: "verified" }).service.execute(
        req("offerings.search"),
      ),
    "catalog_release_not_approved",
  );
  await denied(
    () => fixture().service.execute(req("offering.read", {}, true, "SYNTHETIC-d")),
    "offering_not_found",
    404,
  );
});
Deno.test("catalog paid and malformed query checks precede catalog data access", async () => {
  const f = fixture();
  await denied(
    () => f.service.execute(req("offerings.search", {}, false)),
    "paid_required",
    403,
  );
  for (
    const [query, code] of [[{ academic_year: "2023" }, "invalid_year"], [{
      limit: "0",
    }, "invalid_limit"], [{ unknown: "value" }, "invalid_request"]] as const
  ) {
    await denied(
      () => f.service.execute(req("offerings.search", query)),
      code,
      422,
    );
  }
  equal(f.calls(), 0);
});
