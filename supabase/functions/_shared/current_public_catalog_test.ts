/** Synthetic only. No network/DB/env permissions or original admission values. */
import { AccessError } from "./jungsi/application/access.ts";
import type { ApiExecution } from "./jungsi/application/api_dispatch.ts";
import type { CatalogRelease } from "./jungsi/application/catalog.ts";
import { nativeJsonText, type NativeObject } from "./jungsi/domain/json_value.ts";
import { JsonFloat } from "./jungsi/domain/native_json.ts";
import { utcInstant } from "./jungsi/domain/time.ts";
import { publicJsonText, PublicResponseProjection } from "./jungsi/application/public_response.ts";
import { SyntheticUniversityData } from "../../../tests/edge/synthetic_university.ts";
import { UniversityScoringService } from "./jungsi/application/university_scoring.ts";
import {
  type MyScore,
  myScore,
  scoreMapPin,
  ScoreMapService,
  type ScoreMapStore,
} from "./jungsi/application/score_map.ts";
import {
  SCORE_MAP_INSERT_SQL,
  SCORE_MAP_PROFILE_SQL,
  SCORE_MAP_READ_SQL,
} from "./jungsi/infrastructure/score_map_postgres.ts";
import routeCatalog from "../../../src/jungsi_touch/application/route_catalog.json" with {
  type: "json",
};
import schemas from "../../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import {
  comparePublicCatalogKeys,
  CurrentPublicCatalogCursor,
  type CurrentPublicCatalogPort,
  CurrentPublicCatalogService,
  currentPublicResponseSchemas,
  parsePublicCatalogQuery,
  publicCatalogHistory,
  publicCatalogOffering,
  publicCatalogOfferingId,
  type PublicCatalogRecord,
  publicCatalogRecruitment,
} from "./current_public_catalog.ts";
import {
  CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS,
  CURRENT_PUBLIC_HISTORY_SQL,
  CURRENT_PUBLIC_LOOKUP_SQL,
  CURRENT_PUBLIC_OFFERINGS_SQL,
  CURRENT_PUBLIC_SOURCE_VIEWS,
  verifyPublicCatalogDescriptor,
} from "./current_public_catalog_sql.ts";
Deno.test("current DB address preserves native PK while distinguishing its actual academic year", async () => {
  const base = {
    academic_year: 2024,
    offering_pk: "SYNTHETIC-PK",
    offering_id: "2024:SYNTHETIC-PK",
  };
  equal(await publicCatalogOfferingId(base), "2024:SYNTHETIC-PK");
  equal(
    await publicCatalogOfferingId({
      ...base,
      academic_year: 2025,
      offering_id: "2025:SYNTHETIC-PK",
    }),
    "2025:SYNTHETIC-PK",
  );
  let error: unknown;
  try {
    await publicCatalogOfferingId({ ...base, offering_id: "2027:SYNTHETIC-PK" });
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(base.offering_pk, "SYNTHETIC-PK");
});
Deno.test("current empty native PK uses the same observation address with an explicit SQL null", async () => {
  const base = {
    academic_year: 2024,
    offering_pk: null,
    canonical_result_id: "SYNTHETIC-OBSERVATION",
  };
  const id = await publicCatalogOfferingId(base);
  assert(/^observation:[0-9a-f]{64}$/.test(id));
  equal(await publicCatalogOfferingId({ ...base, offering_id: null }), id);
  equal(await publicCatalogOfferingId({ ...base, offering_id: id }), id);
  let error: unknown;
  try {
    await publicCatalogOfferingId({ ...base, offering_id: "2024:invented" });
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
});
function assert(v: unknown, message = "assertion_failed"): asserts v {
  if (!v) throw new Error(message);
}
function equal(a: unknown, b: unknown) {
  assert(
    nativeJsonText(a, true) === nativeJsonText(b, true),
    "equality_failed: " + nativeJsonText(a, true) + " != " +
      nativeJsonText(b, true),
  );
}
async function denied(run: () => Promise<unknown>, code: string, http = 503) {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal([error.code, error.http], [code, http]);
}
const NOW = utcInstant("2026-10-19T00:00:00Z");
type MutableRequest = { -readonly [K in keyof ApiExecution]: ApiExecution[K] };
function request(
  op: ApiExecution["operation"] = "history.search",
  q: Record<string, string> = {},
  paid = true,
  id = "2024:SYNTHETIC-A",
): MutableRequest {
  return {
    operation: op,
    session: {
      user: {
        subjectId: "00000000-0000-0000-0000-000000000001",
        expiresAtUtc: NOW + 3_600_000_000n,
      },
      evaluatedAtUtc: NOW,
      tier: paid ? "paid" : "standard",
      paidUntilUtc: paid ? NOW + 3_600_000_000n : null,
    },
    management: null,
    body: {},
    query: q,
    params: { offering_id: id },
    requestKey: null,
  };
}
function row(
  id = "SYNTHETIC-OBS-A",
  year = 2024,
  pk = "2024:SYNTHETIC-A",
): PublicCatalogRecord {
  const value: NativeObject = {
    academic_year: year,
    school_id: "SYNTHETIC-SCHOOL",
    offering_pk: pk,
    university_code: "SYNTHETIC-UNI",
    university: "가상대학교",
    department: "가상모집단위",
    track: null,
    recruit_group: null,
    active_service: true,
    canonical_result_id: id,
    metric_kind: "final_waitlist_rank",
    metric_value_literal: "0",
    metric_value_json_type: "integer",
    metric_value_numeric: "0",
    curation_fields: { private: "SYNTHETIC-PRIVATE" },
    source_location: { source_path: "SYNTHETIC-PRIVATE-PATH" },
  };
  const guide: NativeObject = {
    academic_year: year,
    school_id: "SYNTHETIC-SCHOOL",
    offering_pk: pk,
    release_id: "SYNTHETIC-GUIDE",
    university_code: "SYNTHETIC-UNI",
    university: "가상대학교",
    department: "가상모집단위",
    track: null,
    recruit_group: null,
    location: "가상지역",
    active_service: true,
    quota_value: null,
    metadata: {},
    recruitment_link_status: "unrequested",
  };
  return {
    key: [year, "SYNTHETIC-SCHOOL", pk, "final_waitlist_rank", id],
    row: value,
    guide,
  };
}
function fixture(
  seed: PublicCatalogRecord[] = [row()],
  old: CatalogRelease | null = null,
) {
  let now = NOW,
    head = "b".repeat(64),
    expires = NOW + 43_200_000_000n,
    publication = "a".repeat(64),
    artifactCalls = 0,
    searchCalls = 0,
    lookupCalls = 0,
    publicationCalls = 0;
  const current: CurrentPublicCatalogPort = {
    publication: async () => {
      await Promise.resolve(); // Simulate the asynchronous data-port boundary.
      publicationCalls++;
      return {
        version: "SYNTHETIC-CURRENT",
        sha256: publication,
        expiresAtUtc: expires,
      };
    },
    search: async (_subject, kind, q, after) => {
      await Promise.resolve(); // Simulate the asynchronous data-port boundary.
      searchCalls++;
      const rows = seed.filter((r) =>
        (q.academic_year === null || r.row.academic_year === q.academic_year) &&
        (!after || comparePublicCatalogKeys(r.key, after) > 0)
      ).sort((a, b) => comparePublicCatalogKeys(a.key, b.key)).slice(
        0,
        q.limit + 1,
      );
      return {
        version: "SYNTHETIC-CURRENT",
        head,
        asOfUtc: now,
        rows: kind === "history" ? rows : rows.map((r) => ({
          row: r.guide!,
          guide: r.guide,
          key: [r.key[0], r.key[1], r.key[2], "", "SYNTHETIC-GUIDE"],
        })),
      };
    },
    lookup: async (_subject, ids) => {
      lookupCalls++;
      const rows: PublicCatalogRecord[] = [];
      for (const r of seed) {
        if (ids.includes(await publicCatalogOfferingId(r.row))) rows.push(r);
      }
      return {
        version: "SYNTHETIC-CURRENT",
        head,
        asOfUtc: now,
        rows: rows.sort((a, b) => comparePublicCatalogKeys(a.key, b.key)),
      };
    },
  };
  const service = new CurrentPublicCatalogService(
    {
      getCatalog: async () => {
        await Promise.resolve(); // Simulate the asynchronous data-port boundary.
        artifactCalls++;
        return old;
      },
    },
    current,
    { nowUtc: () => now },
    new CurrentPublicCatalogCursor(new Uint8Array(32).fill(7)),
  );
  return {
    service,
    current,
    setNow: (v: bigint) => now = v,
    setHead: (v: string) => head = v,
    setExpiry: (v: bigint) => expires = v,
    setPublication: (v: string) => publication = v,
    calls: () => ({
      artifactCalls,
      searchCalls,
      lookupCalls,
      publicationCalls,
    }),
  };
}
Deno.test("current public history reads DB port without loading frozen arrays and retains missing track group", async () => {
  const f = fixture();
  const r = await f.service.execute(request("history.search", {}, false));
  equal(f.calls().artifactCalls, 0);
  equal(f.calls().searchCalls, 1);
  equal((r.items as NativeObject[])[0].track, null);
  equal((r.items as NativeObject[])[0].group, null);
  equal(r.matching_offering_count, null);
  equal(r.matching_school_count, null);
});
Deno.test("current public paid-only offering routes reject before publication and any data call", async () => {
  for (const op of ["offerings.search", "offering.read"] as const) {
    const f = fixture();
    await denied(
      () => f.service.execute(request(op, {}, false)),
      "paid_required",
      403,
    );
    equal(f.calls(), {
      artifactCalls: 0,
      searchCalls: 0,
      lookupCalls: 0,
      publicationCalls: 0,
    });
  }
});
Deno.test("current public expired user rejects before any DB or artifact call", async () => {
  const f = fixture();
  f.setNow(NOW + 3_600_000_000n);
  await denied(
    () => f.service.execute(request()),
    "authentication_required",
    401,
  );
  equal(f.calls().searchCalls, 0);
});
Deno.test("current public incomplete metadata retains observation and actual zero without claiming verified source", async () => {
  const r = await fixture().service.execute(request());
  const v = (r.items as NativeObject[])[0];
  equal(v.value, 0);
  equal(v.publication_status, "pending_metadata");
  equal(v.source_url, null);
  equal(v.unit, null);
  equal(v.department, "가상모집단위");
  assert(!publicJsonText(r).includes("SYNTHETIC-PRIVATE"));
  assert(!publicJsonText(r).includes("canonical_result_id"));
});
Deno.test("current public lexical decimals huge integers and original strings preserve native types", async () => {
  for (
    const [literal, type, numeric, expected] of [
      [
        "0.10000000000000000001",
        "number",
        "0.10000000000000000001",
        new JsonFloat("0.10000000000000000001"),
      ],
      ["9007199254740993", "integer", "9007199254740993", 9007199254740993n],
      ['"미공개"', "string", null, "미공개"],
    ] as const
  ) {
    const r = row();
    Object.assign(r.row, {
      metric_value_literal: literal,
      metric_value_json_type: type,
      metric_value_numeric: numeric,
    });
    const v = await publicCatalogHistory(r);
    equal(v.value, expected);
  }
});
Deno.test("current public null missing nested and numeric mismatch remain held without zero imputation", async () => {
  for (
    const [literal, type, numeric, status] of [
      [null, null, null, "pending_value_missing"],
      ["null", "null", null, "pending_metadata"],
      ['{"private":"SYNTHETIC-PRIVATE"}', "object", null, "pending_value_type"],
      ["[1,2]", "array", null, "pending_value_type"],
      ["1", "number", "2", "pending_value_type"],
    ] as const
  ) {
    const r = row();
    Object.assign(r.row, {
      metric_value_literal: literal,
      metric_value_json_type: type,
      metric_value_numeric: numeric,
    });
    const v = await publicCatalogHistory(r);
    equal(v.value, null);
    equal(v.publication_status, status);
    assert(!publicJsonText(v).includes("SYNTHETIC-PRIVATE"));
  }
});
Deno.test("current public same offering year and metric retains multiple canonical observations", async () => {
  const rows = [row("SYNTHETIC-OBS-A"), row("SYNTHETIC-OBS-B")],
    f = fixture(rows),
    r = await f.service.execute(request());
  equal((r.items as NativeObject[]).length, 2);
  equal((r.items as NativeObject[]).map((x) => x.offering_id), [
    "2024:SYNTHETIC-A",
    "2024:SYNTHETIC-A",
  ]);
});
Deno.test("current public keyset resumes same-offering variants without gap after elapsed clock time", async () => {
  const f = fixture([
      row("SYNTHETIC-OBS-A"),
      row("SYNTHETIC-OBS-B"),
      row("SYNTHETIC-OBS-C"),
    ]),
    first = await f.service.execute(request("history.search", { limit: "1" }));
  assert(typeof first.next_cursor === "string");
  f.setNow(NOW + 14_000_000n);
  const next = await f.service.execute(
    request("history.search", { limit: "1", cursor: first.next_cursor }),
  );
  equal((next.items as NativeObject[]).length, 1);
  assert(
    typeof next.next_cursor === "string" &&
      next.next_cursor !== first.next_cursor,
  );
});
Deno.test("current public actual head or publication change rejects next page with 409", async () => {
  for (const change of ["head", "publication"]) {
    const f = fixture([row(), row("SYNTHETIC-OBS-B")]),
      first = await f.service.execute(
        request("history.search", { limit: "1" }),
      );
    if (change === "head") f.setHead("c".repeat(64));
    else f.setPublication("c".repeat(64));
    await denied(
      () =>
        f.service.execute(
          request("history.search", {
            limit: "1",
            cursor: first.next_cursor as string,
          }),
        ),
      "cursor_version_mismatch",
      409,
    );
  }
});
Deno.test("current public fresh same-subject JWT refresh is accepted while query subject and token tampering are rejected", async () => {
  const f = fixture([row(), row("SYNTHETIC-OBS-B")]),
    first = await f.service.execute(request("history.search", { limit: "1" })),
    cursor = first.next_cursor as string;
  await denied(
    () =>
      f.service.execute(
        request("history.search", { limit: "1", cursor, group: "가" }),
      ),
    "cursor_version_mismatch",
    409,
  );
  const changed = request("history.search", { limit: "1", cursor });
  changed.session = {
    ...changed.session,
    user: {
      ...changed.session.user,
      subjectId: "00000000-0000-0000-0000-000000000002",
    },
  };
  await denied(() => f.service.execute(changed), "invalid_cursor", 400);
  const expiry = request("history.search", { limit: "1", cursor });
  expiry.session = {
    ...expiry.session,
    user: { ...expiry.session.user, expiresAtUtc: NOW + 3_500_000_000n },
  };
  const refreshed = await f.service.execute(expiry);
  equal(refreshed.status, "ready");
  await denied(
    () =>
      f.service.execute(
        request("history.search", {
          limit: "1",
          cursor: (cursor[0] === "A" ? "B" : "A") + cursor.slice(1),
        }),
      ),
    "invalid_cursor",
    400,
  );
});
Deno.test("current public approval expiry is rechecked after awaited read and closed projection", async () => {
  const f = fixture();
  const old = f.current.search;
  f.current.search = async (...args) => {
    const result = await old(...args);
    f.setExpiry(NOW);
    return result;
  };
  await denied(
    () => f.service.execute(request()),
    "current_catalog_publication_unapproved",
  );
});
Deno.test("current public history cannot turn 2027 guide into a historical admission outcome", async () => {
  await denied(
    () => fixture([row("SYNTHETIC-OBS-A", 2027)]).service.execute(request()),
    "current_catalog_page_invalid",
  );
});
Deno.test("current public invalid bounds extra fields and nested public value inputs fail closed", async () => {
  const queries: Record<string, string>[] = [
    { limit: "101" },
    { academic_year: "2023" },
    { cursor: "***" },
    { private: "x" },
  ];
  for (const q of queries) {
    let caught = false;
    try {
      parsePublicCatalogQuery(q);
    } catch (e) {
      caught = e instanceof AccessError;
    }
    assert(caught);
  }
  await denied(
    () =>
      fixture([{ ...row(), row: { ...row().row, active_service: false } }])
        .service.execute(request()),
    "current_catalog_page_invalid",
  );
});
Deno.test("current public unknown quota stage is not initial final zero or invented rollover", () => {
  const r = publicCatalogRecruitment({
    ...row().guide!,
    quota_value: 25,
    metadata: {},
  });
  equal([r.initial_count, r.final_count, r.rollover_change], [
    null,
    null,
    null,
  ]);
  equal(r.count_status, "quota_stage_unqualified");
  const z = publicCatalogRecruitment({
    ...row().guide!,
    quota_value: 0,
    metadata: { quota_stage: "final" },
  });
  equal(z.final_count, 0);
  equal(z.initial_count, null);
  equal(z.changes, []);
});
Deno.test("current public recruitment follows only explicit verified link state", async () => {
  const r = row();
  r.guide!.recruitment_link_status = "unqualified";
  let out = await fixture([r]).service.execute(request("recruitment.read"));
  equal(out.status, "pending");
  equal(out.recruitment, null);
  r.guide!.recruitment_link_status = "verified";
  r.guide!.quota_value = 0;
  r.guide!.metadata = { quota_stage: "final" };
  out = await fixture([r]).service.execute(request("recruitment.read"));
  equal(out.status, "ready");
  equal((out.recruitment as NativeObject).final_count, 0);
});
Deno.test("current selected analysis reuses old catalog and does not read current DB on saved-id path", async () => {
  const oldOffering = await publicCatalogOffering(row().row, row().guide),
    old: CatalogRelease = {
      version: "SYNTHETIC-OLD",
      status: "approved",
      asOfUtc: NOW,
      offerings: [{ ...oldOffering, practical_required: false }],
      history: [],
    },
    f = fixture([row()], old),
    r = request("university.analyze");
  r.body = { expected_version: 1, offering_ids: ["2024:SYNTHETIC-A"] };
  await f.service.prepareSelection(r);
  equal(f.calls().lookupCalls, 0);
  const catalog = await f.service.catalog();
  equal(catalog!.version, "SYNTHETIC-OLD");
  equal(f.calls().lookupCalls, 0);
});
Deno.test("current selected offering outside old catalog is available for analysis and missing conversion stays pending", async () => {
  const r = row("SYNTHETIC-NEW", 2027, "2027:SYNTHETIC-NEW-PK"),
    f = fixture([r], {
      version: "SYNTHETIC-OLD",
      status: "approved",
      asOfUtc: NOW,
      offerings: [],
      history: [],
    }),
    req = request("university.analyze");
  req.body = { expected_version: 1, offering_ids: ["2027:SYNTHETIC-NEW-PK"] };
  await f.service.prepareSelection(req);
  equal(f.calls().lookupCalls, 0);
  const catalog = await f.service.catalog(),
    offering = f.service.offering(catalog!, "2027:SYNTHETIC-NEW-PK");
  equal(offering.department, "가상모집단위");
  equal(offering.practical_required, null);
  equal(f.calls().lookupCalls, 1);
  const synthetic = new SyntheticUniversityData();
  const scoring = new UniversityScoringService({
    getConversion: () => Promise.resolve(null),
    getExamPack: (id) => synthetic.getExamPack(id),
  });
  const result = await scoring.calculate(offering, synthetic.profile());
  equal(result.state.reason_code, "conversion_release_missing");
  equal(result.dto().converted_score, null);
});
Deno.test("current public separate history and recruitment schemas preserve original registry and unrelated roots", async () => {
  const before = JSON.stringify(schemas),
    extended = currentPublicResponseSchemas(schemas) as typeof schemas;
  equal(JSON.stringify(schemas), before);
  for (const op of schemas.operations) {
    if (!["history.search", "recruitment.read", "offerings.search"].includes(op.id)) {
      equal(extended.operations.find((x) => x.id === op.id), op);
    }
  }
  const projection = new PublicResponseProjection(
      extended,
      routeCatalog.operations,
    ),
    result = await fixture().service.execute(request());
  (result.items as NativeObject[])[0].value = new JsonFloat(
    "0.10000000000000000001",
  );
  const dto = projection.project("history.search", "paid", result);
  assert(publicJsonText(dto).includes("0.10000000000000000001"));
  const legacy = new PublicResponseProjection(schemas, routeCatalog.operations);
  let deniedLegacy = false;
  try {
    legacy.project("history.search", "paid", result);
  } catch (e) {
    deniedLegacy = e instanceof AccessError;
  }
  assert(deniedLegacy);
});
Deno.test("current public SQL filters before limits binds canonical tie and uses no whole-universe result count", () => {
  assert(
    CURRENT_PUBLIC_HISTORY_SQL.indexOf("v.active_service=true") <
      CURRENT_PUBLIC_HISTORY_SQL.indexOf("LIMIT $11"),
  );
  assert(CURRENT_PUBLIC_HISTORY_SQL.includes("v.canonical_result_id"));
  assert(
    CURRENT_PUBLIC_HISTORY_SQL.includes(
      "v.academic_year=ANY(ARRAY[2024,2025,2026])",
    ),
  );
  assert(!/count\(DISTINCT[^)]*canonical/i.test(CURRENT_PUBLIC_HISTORY_SQL));
  assert(
    !/\b(?:DELETE|INSERT|UPDATE|TRUNCATE|CREATE|DROP)\b/.test(
      CURRENT_PUBLIC_HISTORY_SQL,
    ),
  );
  assert(CURRENT_PUBLIC_OFFERINGS_SQL.includes("LIMIT $11::integer"));
  assert(
    CURRENT_PUBLIC_LOOKUP_SQL.includes("r.lineage_button_link_allowed=true"),
  );
  assert(CURRENT_PUBLIC_LOOKUP_SQL.includes("r.to_year>r.from_year"));
  assert(!CURRENT_PUBLIC_LOOKUP_SQL.includes("DISTINCT ON"));
});
Deno.test("current public descriptor requires separate explicit national publication and rejects engine activation", async () => {
  const d = {
    format: "jungsi.current-public-catalog-publication/v2",
    version: "SYNTHETIC-CURRENT",
    issued_at: "2026-10-18T00:00:00Z",
    expires_at: "2026-10-20T00:00:00Z",
    approval_reference_sha256: "a".repeat(64),
    consumer_binding_sha256: "c".repeat(64),
    metadata_sha256: "b".repeat(64),
    operations: [
      "history.search",
      "offerings.search",
      "offering.read",
      "recruitment.read",
    ],
    source_views: CURRENT_PUBLIC_SOURCE_VIEWS,
    general_publication_allowed: true,
    nationwide_current: true,
    active_service_only: true,
    incomplete_metadata: "hold_per_observation",
    order: "academic_year_school_offering_metric_canonical_C",
    counts: "unknown",
    engine_activation: false,
    max_page_rows: 101,
    key_index: {
      object_key: "SYNTHETIC/keys/root.json",
      bytes: 100,
      sha256: "d".repeat(64),
    },
    coverage_receipt_sha256: "e".repeat(64),
    admission_head: {
      command_id: "SYNTHETIC-HEAD",
      payload_sha256: "f".repeat(64),
    },
    guide_command_state: Object.fromEntries(
      CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map(
        (name) => [name, {
          count: 0,
          sha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        }],
      ),
    ),
  };
  for (
    const variant of [d, { ...d, general_publication_allowed: false }, {
      ...d,
      engine_activation: true,
    }]
  ) {
    const bytes = new TextEncoder().encode(JSON.stringify(variant)),
      digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (x) => x.toString(16).padStart(2, "0"),
      ).join("");
    if (variant === d) {
      equal(
        (await verifyPublicCatalogDescriptor(bytes, digest, {
          nowUtc: () => NOW,
        })).publication.version,
        "SYNTHETIC-CURRENT",
      );
    } else {await denied(() =>
        verifyPublicCatalogDescriptor(bytes, digest, {
          nowUtc: () => NOW,
        }), "current_catalog_publication_unapproved");}
  }
});
Deno.test("current public preserves original statistic labels and cohorts as additive fields", async () => {
  const a = row("SYNTHETIC-OBS-A"), b = row("SYNTHETIC-OBS-B");
  a.row.statistic_label = "70%";
  a.row.cohort = "최종등록자";
  b.row.statistic_label = "50%";
  b.row.cohort = "최초합격자";
  const out = await fixture([a, b]).service.execute(request());
  equal(
    (out.items as NativeObject[]).map(
      (r) => [r.metric_name, r.statistic_label, r.cohort],
    ),
    [["final_waitlist_rank", "70%", "최종등록자"], [
      "final_waitlist_rank",
      "50%",
      "최초합격자",
    ]],
  );
  // An exact definition can change one service item while raw value, label and qualification stay intact.
  const c = row("SYNTHETIC-ALIAS");
  c.row.offering_pk = "SYNTHETIC-A";
  c.row.metric_kind = "충원인원";
  c.row.statistic_label = "충원인원";
  c.row.cohort = "최종등록자";
  const scope = {
    observation_id: "SYNTHETIC-ALIAS",
    academic_year: 2024,
    offering_id: null as string | null,
    cohort: "최종등록자",
    score_basis: null,
    score_scope: null,
    source_round: null,
    statistic_percent: null,
  };
  const before = await publicCatalogHistory(c);
  equal(before.metric_name, "충원인원");
  // A missing selected public offering address cannot authorize a semantic reclassification.
  (c.row.curation_fields as NativeObject).metric_alias_evidence = {
    status: "meaning_verified",
    definition_sha256: "a".repeat(64),
    source_label: "충원인원",
    family: "final_waitlist_rank",
    scope,
  };
  equal((await publicCatalogHistory(c)).metric_name, "충원인원");
  c.row.offering_id = "2024:SYNTHETIC-A";
  scope.offering_id = c.row.offering_id as string;
  const aliased = await publicCatalogHistory(c);
  equal(aliased.metric_name, "final_waitlist_rank");
  equal(aliased.statistic_label, "충원인원");
  equal(aliased.value, 0);
  equal(aliased.publication_status, "pending_metadata");
  equal(c.row.canonical_result_id, "SYNTHETIC-ALIAS");
});
Deno.test("current public only explicit qualified official missing publication is not_published", async () => {
  const a = row();
  a.row.metric_value_literal = null;
  a.row.metric_value_json_type = null;
  a.row.metric_value_numeric = null;
  equal(
    (await publicCatalogHistory(a)).publication_status,
    "pending_value_missing",
  );
  a.row.curation_fields = {
    publication_status: "not_published",
    qualification_status: "verified_official",
    source_url: "https://admission.synthetic.example/notice",
    source_as_of: "2026-10-18",
  };
  equal((await publicCatalogHistory(a)).publication_status, "not_published");
});
Deno.test("current public unqualified new offering suppresses conversion and judgment provider calls", async () => {
  const r = row("SYNTHETIC-NEW", 2027, "2027:SYNTHETIC-NEW-PK"),
    f = fixture([r], {
      version: "SYNTHETIC-OLD",
      status: "approved",
      asOfUtc: NOW,
      offerings: [],
      history: [],
    }),
    req = request("university.analyze");
  req.body = { expected_version: 1, offering_ids: ["2027:SYNTHETIC-NEW-PK"] };
  let calls = 0;
  const native = {
    getReference: (_id: string) => {
      calls++;
      return Promise.resolve(null);
    },
    getExamPack: () => Promise.resolve(null),
    getConversion: async (_id: string) => {
      await Promise.resolve(); // Simulate the asynchronous data-port boundary.
      calls++;
      return null;
    },
    getPercentile: () => Promise.resolve(null),
    getAnalysis: async (_id: string) => {
      await Promise.resolve(); // Simulate the asynchronous data-port boundary.
      calls++;
      return null;
    },
  };
  f.service.restrictAnalysisData(native);
  await f.service.prepareSelection(req);
  const release = await f.service.catalog();
  equal(
    f.service.offering(release!, "2027:SYNTHETIC-NEW-PK").practical_required,
    null,
  );
  equal(await native.getConversion("2027:SYNTHETIC-NEW-PK"), null);
  equal(await native.getReference("2027:SYNTHETIC-NEW-PK"), null);
  equal(await native.getAnalysis("2027:SYNTHETIC-NEW-PK"), null);
  equal(calls, 0);
});

Deno.test("current public exact source PK stays native ID without prepending a year", async () => {
  const r = row("SYNTHETIC-OBS-A", 2027, "SYNTHETIC-EXACT-NATIVE");
  equal(await publicCatalogOfferingId(r.row), "SYNTHETIC-EXACT-NATIVE");
  const prefixed = row("SYNTHETIC-OBS-A", 2027, "2027:SYNTHETIC-EXACT-NATIVE");
  equal(
    await publicCatalogOfferingId(prefixed.row),
    "2027:SYNTHETIC-EXACT-NATIVE",
  );
});
Deno.test("current selected shortlist can look up a new offering in a fresh request without old-catalog404", async () => {
  const r = row("SYNTHETIC-NEW", 2027, "2027:SYNTHETIC-NEW-PK"),
    f = fixture([r], {
      version: "SYNTHETIC-OLD",
      status: "approved",
      asOfUtc: NOW,
      offerings: [],
      history: [],
    }),
    req = request("shortlist.update", {}, true, "2027:SYNTHETIC-NEW-PK");
  req.body = { selected: true, expected_version: 1 };
  await f.service.prepareSelection(req);
  equal(f.calls().lookupCalls, 0);
  const release = await f.service.catalog();
  equal(
    f.service.offering(release!, "2027:SYNTHETIC-NEW-PK").offering_id,
    "2027:SYNTHETIC-NEW-PK",
  );
  equal(f.calls().lookupCalls, 1);
});

Deno.test("current multi-year sparse page retains approved continuation instead of claiming global no-match", async () => {
  const f = fixture([]);
  let seen: unknown = null;
  f.current.search = async (_s, _k, _q, after) => {
    await Promise.resolve(); // Simulate the asynchronous data-port boundary.
    seen = after;
    return {
      version: "SYNTHETIC-CURRENT",
      head: "b".repeat(64),
      asOfUtc: NOW,
      rows: [],
      nextAfter: after ? null : [2025, "", "", "", ""],
    };
  };
  const first = await f.service.execute(request());
  equal(first.items, []);
  assert(typeof first.next_cursor === "string");
  await f.service.execute(
    request("history.search", { cursor: first.next_cursor }),
  );
  equal(seen, [2025, "", "", "", ""]);
});

Deno.test("current partial page can continue exclusively after its last returned tuple", async () => {
  const r = row(), f = fixture([r]);
  f.current.search = () =>
    Promise.resolve({
      version: "SYNTHETIC-CURRENT",
      head: "b".repeat(64),
      asOfUtc: NOW,
      rows: [r],
      nextAfter: r.key,
    });
  const result = await f.service.execute(request());
  equal((result.items as NativeObject[]).length, 1);
  assert(typeof result.next_cursor === "string");
});

Deno.test("current recruitment keeps conditional text and literal state through the closed DTO", async () => {
  const r = row();
  r.guide!.recruitment_link_status = "verified";
  r.guide!.quota_value = "-";
  r.guide!.quota_literal_state = "conditional_rollover";
  const result = await fixture([r]).service.execute(request("recruitment.read"));
  const projection = new PublicResponseProjection(
    currentPublicResponseSchemas(schemas),
    routeCatalog.operations,
  );
  const out = projection.project("recruitment.read", "paid", result) as NativeObject;
  equal(out.status, "pending");
  const recruitment = out.recruitment as NativeObject;
  equal(recruitment.quota_value, "-");
  equal(recruitment.quota_literal_state, "conditional_rollover");
  equal(recruitment.initial_count, null);
  equal(recruitment.final_count, null);
});

Deno.test("current unrepresentable value or scale is held per observation through the strict DTO", async () => {
  const projection = new PublicResponseProjection(
    currentPublicResponseSchemas(schemas),
    routeCatalog.operations,
  );
  for (const literal of ["1e400", "-1e400", null]) {
    const r = row();
    r.row.curation_fields = {
      qualification_status: "verified_official",
      metric_definition: "SYNTHETIC-DEFINITION",
      unit: "SYNTHETIC-UNIT",
      source_url: "https://admission.synthetic.example/notice",
      source_as_of: "2026-10-18",
      original_scale: literal === null ? new JsonFloat("1e400") : null,
    };
    if (literal !== null) {
      r.row.metric_value_literal = literal;
      r.row.metric_value_numeric = literal;
      r.row.metric_value_json_type = "decimal";
    }
    const response = await fixture([r]).service.execute(request());
    const dto = projection.project("history.search", "paid", response) as NativeObject;
    const displayed = (dto.items as NativeObject[])[0];
    equal(
      displayed.publication_status,
      literal === null ? "pending_metadata" : "pending_value_type",
    );
    equal(displayed.value, literal === null ? 0 : null);
    equal(displayed.original_scale, null);
  }
});

Deno.test("current known practical or inactive guide cannot escape through an active admission row", async () => {
  for (const field of ["practical_required", "active_service"] as const) {
    const r = row();
    r.guide![field] = field === "practical_required";
    await denied(() => fixture([r]).service.execute(request()), "current_catalog_page_invalid");
  }
});

import {
  currentCatalogCompositionFixture,
  currentCatalogCompositionValues,
} from "../../../tests/edge/test_current_catalog_composition.ts";
// Real runtime/factory regression; the common fixture has synthetic external ports only.
{
  const { OWNER, OTHER, RID, OLD, IDS } = currentCatalogCompositionValues;
  const fixture = () =>
    currentCatalogCompositionFixture(
      (data, clock, current) =>
        new CurrentPublicCatalogService(
          data,
          current,
          clock,
          new CurrentPublicCatalogCursor(new Uint8Array(32).fill(7)),
        ),
      routeCatalog as {
        operations:
          readonly import("./jungsi/infrastructure/runtime_composition.ts").RuntimeRoutePolicy[];
      },
      schemas,
    );
  const error = async (response: Response, status: number, code: string) => {
    const body = await response.json();
    assert(
      response.status === status,
      JSON.stringify({ expected: { status, code }, actual: { status: response.status, body } }),
    );
    equal(body.error.code, code);
  };
  Deno.test("current catalog composition supplements eight exact IDs through NativeRuntimeApi and leaves missing formulas pending", async () => {
    const f = await fixture();
    await f.run(async () => {
      const response = await f.api.fetch(f.request());
      equal(response.status, 200);
      const body = await response.json();
      equal(Object.keys(body.analyses).sort(), IDS);
      equal(f.calls.lookups, [{ owner: OWNER, ids: IDS }]);
      equal(f.calls.restrict, 1);
      equal(f.calls.prepare, 1);
      equal(f.repo.reports.get(RID)!.revision, 2);
      equal(f.calls.profileSave, 0);
      equal(f.inputStates.get(OWNER)!.version, 1);
      for (const id of IDS) {
        equal(body.analyses[id].conversion.status, "pending");
        equal(body.analyses[id].conversion.reason_code, "conversion_release_missing");
      }
    });
  });
  Deno.test("current catalog composition unknown exact ID keeps whole-batch404 without partial revision", async () => {
    const f = await fixture();
    await f.run(async () => {
      await error(
        await f.api.fetch(f.request([IDS[0], "2027:SYNTHETIC-UNKNOWN"])),
        404,
        "offering_not_found",
      );
      equal(f.repo.reports.get(RID)!.revision, 1);
      equal(f.calls.profileSave, 0);
    });
  });
  Deno.test("current catalog composition unqualified metadata blocks conversion reference and model reads", async () => {
    const f = await fixture();
    f.state.qualified = false;
    await f.run(async () => {
      const response = await f.api.fetch(f.request([IDS[0]]));
      equal(response.status, 200);
      equal([f.calls.conversion, f.calls.reference, f.calls.analysis], [0, 0, 0]);
      const body = await response.json();
      equal(body.analyses[IDS[0]].conversion.status, "pending");
    });
  });
  Deno.test("current catalog composition known practical row is refused before any calculation", async () => {
    const f = await fixture();
    f.state.practical = true;
    await f.run(async () => {
      await error(await f.api.fetch(f.request([IDS[0]])), 503, "backend_dependency_unavailable");
      equal([f.calls.conversion, f.calls.reference, f.calls.analysis], [0, 0, 0]);
      equal(f.repo.reports.get(RID)!.revision, 1);
    });
  });
  Deno.test("current catalog composition access and current revision reject before exact lookup", async () => {
    for (const kind of ["owner", "revision", "paid", "relay", "auth", "budget"]) {
      const f = await fixture();
      await f.run(async () => {
        if (kind === "paid") f.state.paid = false;
        if (kind === "auth") f.state.auth = false;
        if (kind === "budget") f.state.denyBudget = true;
        const response = await f.api.fetch(
          f.request(
            IDS,
            kind === "revision" ? 2 : 1,
            "SYNTHETIC-key",
            OWNER,
            kind === "owner" ? RID + "-other" : RID,
            kind !== "relay",
          ),
        );
        const expected = {
          owner: [404, "report_not_found"],
          revision: [409, "revision_conflict"],
          paid: [403, "paid_required"],
          relay: [403, "relay_authentication_failed"],
          auth: [401, "authentication_required"],
          budget: [429, "rate_limit_exceeded"],
        }[kind]!;
        if (kind === "budget") equal(response.headers.get("Retry-After"), "7");
        await error(response, expected[0] as number, expected[1] as string);
        equal(f.calls.lookups.length, 0);
        equal(f.calls.catalog, 0);
        equal(f.repo.reports.get(RID)!.revision, 1);
      });
    }
  });
  Deno.test("current catalog composition exact replay and conflict preserve lookup and revision semantics", async () => {
    const f = await fixture();
    await f.run(async () => {
      const first = await f.api.fetch(f.request([IDS[0]]));
      equal(first.status, 200);
      const result = await first.json();
      const reads = f.calls.lookups.length;
      equal(await (await f.api.fetch(f.request([IDS[0]]))).json(), result);
      equal(f.calls.lookups.length, reads);
      equal(f.repo.reports.get(RID)!.revision, 2);
      await error(await f.api.fetch(f.request([IDS[1]])), 409, "idempotency_conflict");
      equal(f.calls.lookups.length, reads);
      equal(f.repo.reports.get(RID)!.revision, 2);
    });
  });
  Deno.test("current catalog composition selection and qualification guards stay request-local", async () => {
    const f = await fixture();
    await f.run(async () => {
      f.state.qualified = false;
      equal((await f.api.fetch(f.request([IDS[0]]))).status, 200);
      equal(f.calls.conversion, 0);
      f.state.qualified = true;
      const response = await f.api.fetch(
        f.request([IDS[1]], 1, "SYNTHETIC-other-key", OTHER, RID + "-other"),
      );
      equal(response.status, 200);
      equal(f.calls.lookups.map((r) => r.owner), [OWNER, OTHER]);
      assert(f.calls.conversion > 0);
      equal(f.calls.profileSave, 0);
    });
  });
  Deno.test("current catalog composition base approved offering needs no current-public supplementation", async () => {
    const f = await fixture();
    await f.run(async () => {
      const response = await f.api.fetch(f.request([OLD]));
      equal(response.status, 200);
      equal(f.calls.lookups.length, 0);
      assert(f.calls.conversion > 0);
      equal(f.repo.reports.get(RID)!.revision, 2);
    });
  });
  Deno.test("current catalog composition expired publication fails closed without saved result", async () => {
    const f = await fixture();
    f.state.publicationExpired = true;
    await f.run(async () => {
      await error(await f.api.fetch(f.request([IDS[0]])), 503, "backend_dependency_unavailable");
      equal(f.repo.reports.get(RID)!.revision, 1);
      equal(f.calls.profileSave, 0);
    });
  });
  Deno.test("current catalog composition shortlist uses exact current selection without calculating or saving scores", async () => {
    const f = await fixture();
    await f.run(async () => {
      const response = await f.api.fetch(f.reportRequest("shortlist.update"));
      equal(response.status, 200);
      const result = await response.json();
      equal(result.shortlist[IDS[0]].selected, true);
      equal(result.shortlist[IDS[0]].assessment_status, "pending");
      equal(f.calls.lookups, [{ owner: OWNER, ids: [IDS[0]] }]);
      equal(f.calls.prepare, 1);
      equal([f.calls.conversion, f.calls.reference, f.calls.analysis, f.calls.profileSave], [
        0,
        0,
        0,
        0,
      ]);
      equal(f.repo.reports.get(RID)!.revision, 2);
      equal(await (await f.api.fetch(f.reportRequest("shortlist.update"))).json(), result);
      equal(f.calls.lookups.length, 1);
      equal(f.repo.reports.get(RID)!.revision, 2);
    });
  });
  Deno.test("current catalog composition shortlist unknown ID and stale revision preserve the report", async () => {
    const f = await fixture();
    await f.run(async () => {
      await error(
        await f.api.fetch(f.reportRequest("shortlist.update", "2027:SYNTHETIC-UNKNOWN")),
        404,
        "offering_not_found",
      );
      equal(f.repo.reports.get(RID)!.revision, 1);
      await error(
        await f.api.fetch(f.reportRequest("shortlist.update", IDS[0], 2, "SYNTHETIC-stale")),
        409,
        "revision_conflict",
      );
      equal(f.calls.lookups.length, 1);
      equal(f.repo.reports.get(RID)!.revision, 1);
    });
  });
  Deno.test("current catalog composition candidates keep the existing approved catalog scope", async () => {
    const f = await fixture();
    await f.run(async () => {
      const response = await f.api.fetch(f.reportRequest("candidates.build"));
      equal(response.status, 200);
      equal(f.calls.prepare, 0);
      equal(f.calls.lookups.length, 0);
      equal(f.calls.publication, 0);
      equal(Object.keys(f.repo.reports.get(RID)!.body.analyses as NativeObject), [OLD]);
      equal(f.calls.profileSave, 0);
      equal(f.inputStates.get(OWNER)!.version, 1);
    });
  });
}

const SCORE_OWNER = "00000000-0000-4000-8000-000000000001";
function scoreMapFixture(options: { profile?: boolean; fail?: boolean } = {}) {
  const synthetic = new SyntheticUniversityData();
  const saved = new Map<string, MyScore>(), inserts: number[] = [];
  const store: ScoreMapStore = {
    latestProfile: (owner) => {
      if (options.fail) return Promise.reject(new Error("synthetic storage failure"));
      equal(owner, SCORE_OWNER);
      return Promise.resolve(options.profile === false ? null : synthetic.profile());
    },
    read: (_owner, profileId, pin, ids) => {
      equal(profileId, "SYNTHETIC-profile");
      assert(/^[a-f0-9]{64}$/.test(pin));
      return Promise.resolve(
        new Map(ids.filter((id) => saved.has(id)).map((id) => [id, saved.get(id)!])),
      );
    },
    insert: (_owner, _profileId, _pin, rows) => {
      inserts.push(rows.length);
      for (const row of rows) saved.set(row.offering_id, myScore(row));
      return Promise.resolve();
    },
  };
  const data = Object.assign(synthetic, {
    getCatalog: () =>
      Promise.resolve({
        version: "synthetic",
        status: "approved",
        asOfUtc: 0n,
        offerings: [synthetic.offering],
        history: [],
      } as CatalogRelease),
  });
  const pin = () =>
    scoreMapPin({ registry: { sha256: "a".repeat(64) }, selection: { sha256: "b".repeat(64) } });
  const items = [
    { offering_id: "SYNTHETIC-A-2027", department: "가상분석" },
    { offering_id: "SYNTHETIC-B-2027", department: "가상검색전용" },
  ];
  return { synthetic, saved, inserts, store, data, pin, items };
}
Deno.test("score map attaches the same score as analysis, stores it once and reuses it", async () => {
  const f = scoreMapFixture();
  const clock = { nowUtc: () => utcInstant("2026-11-10T00:00:00Z") };
  const first = await new ScoreMapService(f.store, f.data, f.pin, clock).attach(
    SCORE_OWNER,
    f.items,
  );
  equal(first.state, "complete");
  const expected = (await new UniversityScoringService(new SyntheticUniversityData()).calculate(
    f.synthetic.offering,
    f.synthetic.profile(),
  )).state.converted_score;
  assert(expected !== null);
  const a = first.items[0].my_score as NativeObject, b = first.items[1].my_score as NativeObject;
  equal(a.status, "ready");
  equal(a.converted_score, expected);
  equal(a.reason_code, null);
  equal(b.status, "pending");
  equal(b.reason_code, "analysis_catalog_missing");
  equal(first.items[1].department, "가상검색전용");
  equal(f.inserts, [1]);
  const conversions = f.synthetic.calls.filter((c) => c === "conversion").length;
  const second = await new ScoreMapService(f.store, f.data, f.pin, clock).attach(
    SCORE_OWNER,
    f.items,
  );
  equal(second.state, "complete");
  equal((second.items[0].my_score as NativeObject).converted_score, expected);
  equal(f.synthetic.calls.filter((c) => c === "conversion").length, conversions);
  equal(f.inserts, [1]);
});
Deno.test("score map never fails a search: no profile, storage failure and budget stay explicit", async () => {
  const clock = { nowUtc: () => utcInstant("2026-11-10T00:00:00Z") };
  const none = scoreMapFixture({ profile: false });
  const a = await new ScoreMapService(none.store, none.data, none.pin, clock).attach(
    SCORE_OWNER,
    none.items,
  );
  equal(a.state, "no_profile");
  assert(a.items.every((item) => item.my_score === null));
  const broken = scoreMapFixture({ fail: true });
  const b = await new ScoreMapService(broken.store, broken.data, broken.pin, clock).attach(
    SCORE_OWNER,
    broken.items,
  );
  equal(b.state, "unavailable");
  equal(b.items.map((item) => item.offering_id), ["SYNTHETIC-A-2027", "SYNTHETIC-B-2027"]);
  assert(b.items.every((item) => item.my_score === null));
  const limited = scoreMapFixture();
  const c = await new ScoreMapService(limited.store, limited.data, limited.pin, clock, {
    maxComputePerRequest: 0,
    computeBudgetMs: 3000,
  }).attach(SCORE_OWNER, limited.items);
  equal(c.state, "partial");
  equal(c.items[0].my_score, null);
  equal(limited.inserts, []);
});
Deno.test("score map rows are closed, owner-scoped and pinned to registry plus selection", async () => {
  for (const sql of [SCORE_MAP_PROFILE_SQL, SCORE_MAP_READ_SQL]) {
    assert(sql.includes("owner_id=$1"));
  }
  assert(SCORE_MAP_INSERT_SQL.includes("ON CONFLICT DO NOTHING"));
  assert(!/UPDATE|DELETE/.test(SCORE_MAP_INSERT_SQL));
  const pin = await scoreMapPin({
    registry: { sha256: "a".repeat(64) },
    selection: { sha256: "b".repeat(64) },
  });
  equal(
    pin,
    await scoreMapPin({
      registry: { sha256: "a".repeat(64) },
      selection: { sha256: "b".repeat(64) },
    }),
  );
  assert(
    pin !==
      await scoreMapPin({
        registry: { sha256: "a".repeat(64) },
        selection: { sha256: "c".repeat(64) },
      }),
  );
  let rejected = 0;
  for (
    const bad of [
      { status: "ready", converted_score: "1.5", official_max_score: null, reason_code: "x" },
      { status: "pending", converted_score: "1.5", official_max_score: null, reason_code: null },
      { status: "reference", converted_score: "1e3", official_max_score: null, reason_code: null },
      { status: "admit", converted_score: "1", official_max_score: null, reason_code: null },
    ]
  ) {
    try {
      myScore(bad);
    } catch {
      rejected++;
    }
  }
  equal(rejected, 4);
});
Deno.test("offerings.search projection carries my_score only through the current public schema", () => {
  const extended = new PublicResponseProjection(
    currentPublicResponseSchemas(schemas) as typeof schemas,
    routeCatalog.operations,
  );
  const offering = {
    offering_id: "2027:SYNTHETIC-PK",
    academic_year: 2027,
    university_id: "999",
    university_name: "가상대학교",
    campus: null,
    department: "가상학과",
    track: null,
    group: "가",
    region: null,
    wildcard_group: null,
  };
  const page = {
    status: "ready",
    reason_code: null,
    matching_offering_count: null,
    matching_school_count: null,
    catalog_version: "synthetic",
    as_of: "2026-11-10T00:00:00.000000Z",
    next_cursor: null,
  };
  const scored = {
    ...page,
    items: [{
      ...offering,
      my_score: {
        status: "reference",
        converted_score: "641.5",
        official_max_score: "950",
        reason_code: "reference_conversion_not_production_approved",
      },
    }, { ...offering, offering_id: "2027:SYNTHETIC-PK2", my_score: null }],
    my_score_state: "complete",
  };
  const out = extended.project("offerings.search", "paid", scored) as NativeObject;
  equal(out.my_score_state, "complete");
  equal(((out.items as NativeObject[])[0].my_score as NativeObject).converted_score, "641.5");
  const plain = extended.project("offerings.search", "paid", {
    ...page,
    items: [offering],
  }) as NativeObject;
  equal((plain.items as NativeObject[])[0].offering_id, "2027:SYNTHETIC-PK");
});
