/** Application-only snapshot checks with an explicit fake port; no DB/Storage acceptance. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  HISTORY_SNAPSHOT_SLOTS,
  HistorySnapshotService,
  validateHistorySnapshotPayload,
  validateQualifiedHistorySnapshotPayload,
} from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import { bindHistoricalReferencePublication } from "../../supabase/functions/_shared/jungsi/application/history_reference_estimates.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import {
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SYNTHETIC_QUALIFICATION_SCHEMA_JSON } from "./synthetic_history_qualification.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { SYNTHETIC_RUNTIME_NOW as NOW } from "./synthetic_runtime_binding.ts";
import {
  syntheticSnapshotBody,
  syntheticSnapshotPart,
  syntheticSnapshotPublication,
  syntheticSnapshotStatisticsBody,
} from "./synthetic_history_snapshot.ts";
import { assert, equal } from "./fixture.ts";
const session = {
  user: { subjectId: "SYNTHETIC-owner", expiresAtUtc: NOW + 120000000n },
  evaluatedAtUtc: NOW,
  tier: "standard" as const,
  paidUntilUtc: null,
};
function historicalReference(seed = "1"): NativeObject {
  return {
    format: "jungsi.historical-cutoff-reference/v1",
    observation_id: "observation:" + seed.repeat(64),
    academic_year: 2026,
    school_id: "SYNTHETIC-university",
    offering_pk: "SYNTHETIC-pk",
    value: "1.2300",
    unit: "%",
    status: "model_estimated",
    label: "추정상위누백(전체응시자)",
    scope: "historical_admission_cutoff",
    method_id: "estimated-whole-cohort-percentile:" + "2".repeat(64),
    release_id: "reference-percentile:" + "3".repeat(64),
    display_role: "independent_observation",
    statistic_label: null,
    reference_status: "CALCULATED_WHOLE_COHORT_MODEL_ESTIMATE",
    engine_approved: false,
    production_allowed: false,
  };
}
function historicalFixture() {
  const body = syntheticSnapshotStatisticsBody(),
    row = (body.rows as NativeObject[])[0];
  const publication = syntheticSnapshotPublication();
  const descriptor = {
    format: "jungsi.history-reference-estimates/v1",
    release_id: historicalReference().release_id,
    source_export_sha256: "4".repeat(64),
    head_readback_receipt_sha256: "5".repeat(64),
    metric: "estimated_upper_cumulative_percent_all_examinees",
    observation_count: 2,
    school_count: 1,
    engine_approved: false,
    production_allowed: false,
    display_scope: "historical_admission_only",
  };
  row.historical_cutoff_references = [historicalReference()];
  return {
    body,
    row,
    descriptor,
    publication: {
      ...publication,
      historicalReferences: bindHistoricalReferencePublication(
        descriptor,
        publication.publicationSha256,
        publication.sourceHeadSha256,
        publication.scopeSha256,
      ),
    },
  };
}
Deno.test("historical references keep native text and every original pending cell unchanged", async () => {
  const f = historicalFixture();
  const original = nativeJsonText(syntheticSnapshotStatisticsBody());
  const out = await validateQualifiedHistorySnapshotPayload(
    f.body,
    syntheticSnapshotPart(),
    f.publication,
  );
  const row = { ...(out.rows as NativeObject[])[0] };
  equal(
    (row.historical_cutoff_references as NativeObject[])[0].value,
    "1.2300",
  );
  delete row.historical_cutoff_references;
  equal(nativeJsonText({ ...out, rows: [row] }), original);
});
Deno.test("historical references require a verified review context for serving", async () => {
  const f = historicalFixture();
  await denied(
    () =>
      validateQualifiedHistorySnapshotPayload(
        f.body,
        syntheticSnapshotPart(),
        syntheticSnapshotPublication(),
      ),
    "snapshot_invalid",
  );
  await denied(
    () =>
      validateQualifiedHistorySnapshotPayload(f.body, syntheticSnapshotPart(), {
        ...f.publication,
        historicalReferences: { ...f.publication.historicalReferences },
      }),
    "snapshot_invalid",
  );
});
Deno.test("historical reference review context is bound to all three publication pins", async () => {
  for (const key of ["publicationSha256", "sourceHeadSha256", "scopeSha256"]) {
    const f = historicalFixture();
    await denied(
      () =>
        validateQualifiedHistorySnapshotPayload(
          f.body,
          syntheticSnapshotPart(),
          {
            ...f.publication,
            [key]: "6".repeat(64),
          },
        ),
      "snapshot_invalid",
    );
  }
});
Deno.test("historical references reject wrong year school PK CID and inferred statistic labels", async () => {
  for (
    const [key, value] of [
      ["academic_year", 2025],
      ["school_id", "SYNTHETIC-other"],
      ["offering_pk", "SYNTHETIC-other"],
      ["observation_id", "bad"],
      ["statistic_label", "70%"],
      ["scope", "student_rank"],
      ["display_role", "final_70_percent_cut"],
    ] as const
  ) {
    const f = historicalFixture();
    (f.row.historical_cutoff_references as NativeObject[])[0][key] = value;
    await denied(
      () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
});
Deno.test("historical reference decimals reject numeric coercion out of range and unsafe exponents", async () => {
  for (
    const value of [
      0,
      null,
      "",
      "NaN",
      "Infinity",
      "-0.0001",
      "100.0001",
      "1e10001",
      "01.2",
      " 1 ",
    ]
  ) {
    const f = historicalFixture();
    (f.row.historical_cutoff_references as NativeObject[])[0].value = value;
    await denied(
      () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
  for (const value of ["0", "0.00", "100.000", "1e-3"]) {
    const f = historicalFixture();
    (f.row.historical_cutoff_references as NativeObject[])[0].value = value;
    const out = validateHistorySnapshotPayload(f.body, syntheticSnapshotPart());
    equal(
      ((out.rows as NativeObject[])[0]
        .historical_cutoff_references as NativeObject[])[0].value,
      value,
    );
  }
});
Deno.test("historical references reject duplicate observations and exceedance of the row bound", async () => {
  for (
    const refs of [
      [],
      [historicalReference(), historicalReference()],
      Array(17).fill(historicalReference()),
    ]
  ) {
    const f = historicalFixture();
    f.row.historical_cutoff_references = refs;
    await denied(
      () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
});
Deno.test("historical references reject approval promotion hidden fields and getters", async () => {
  for (
    const key of ["engine_approved", "production_allowed", "private_model"]
  ) {
    const f = historicalFixture();
    (f.row.historical_cutoff_references as NativeObject[])[0][key] = true;
    await denied(
      () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
  const f = historicalFixture();
  let reads = 0;
  Object.defineProperty(
    (f.row.historical_cutoff_references as NativeObject[])[0],
    "value",
    {
      enumerable: true,
      get() {
        reads++;
        return "1";
      },
    },
  );
  await denied(
    () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  equal(reads, 0);
});
Deno.test("historical reference release must match the verified independent review", async () => {
  const f = historicalFixture();
  (f.row.historical_cutoff_references as NativeObject[])[0].release_id = "reference-percentile:" +
    "7".repeat(64);
  await denied(
    () =>
      validateQualifiedHistorySnapshotPayload(
        f.body,
        syntheticSnapshotPart(),
        f.publication,
      ),
    "snapshot_invalid",
  );
});
Deno.test("historical reference review rejects inconsistent counts and runtime approval", async () => {
  for (
    const extra of [{ observation_count: 0 }, { school_count: 3 }, {
      engine_approved: true,
    }, {
      production_allowed: true,
    }, { private_model: "hidden" }]
  ) {
    const f = historicalFixture();
    await denied(
      () =>
        bindHistoricalReferencePublication(
          { ...f.descriptor, ...extra },
          f.publication.publicationSha256,
          f.publication.sourceHeadSha256,
          f.publication.scopeSha256,
        ),
      "snapshot_invalid",
    );
  }
});
Deno.test("historical reference context count bounds the complete part", async () => {
  const f = historicalFixture();
  f.row.historical_cutoff_references = [
    historicalReference("1"),
    historicalReference("a"),
    historicalReference("b"),
  ];
  await denied(
    () =>
      validateQualifiedHistorySnapshotPayload(
        f.body,
        syntheticSnapshotPart(),
        f.publication,
      ),
    "snapshot_invalid",
  );
});
Deno.test("snapshot strict IDs reject controls while preserving PK 001 and 0 strings", async () => {
  for (const pk of ["001", "0"]) {
    const body = syntheticSnapshotBody(),
      row = (body.rows as NativeObject[])[0];
    row.original_pk = pk;
    row.offering_id = "2026:" + pk;
    equal(
      (validateHistorySnapshotPayload(body, syntheticSnapshotPart())
        .rows as NativeObject[])[0]
        .original_pk,
      pk,
    );
  }
  for (const control of ["\u0000", "\n", "\r"]) {
    for (const field of ["original_pk", "offering_id", "university_id"]) {
      const body = syntheticSnapshotBody(),
        row = (body.rows as NativeObject[])[0];
      if (field === "original_pk") {
        row.original_pk = "001" + control;
        row.offering_id = "2026:001" + control;
      } else row[field] = String(row[field]) + control;
      await denied(
        () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
        "snapshot_invalid",
      );
    }
  }
});
Deno.test("snapshot explicit 75 alternatives retain native values and source variants within bounds", async () => {
  const body = syntheticSnapshotBody(), row = (body.rows as NativeObject[])[0];
  (row.identity_review as NativeObject).variants = [{
    university_name: "SYNTHETIC 학교",
    department: "SYNTHETIC 과",
    admission_track: "SYNTHETIC 전형",
    group: null,
  }];
  const cut = row.alternate_cut as NativeObject;
  const entry: NativeObject = {
    ...cut,
    value: new JsonFloat("75.00"),
    status: "pending_metadata",
    source_context: {
      observation_id: "observation:" + "a".repeat(64),
      identity_variant_index: 0,
      scope_status: "review_pending",
    },
  };
  delete entry.entries;
  delete entry.omitted_other_basis_count;
  cut.entries = [entry];
  cut.omitted_other_basis_count = 3;
  validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  entry.statistic_percent = 0;
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  entry.statistic_percent = 75;
  (entry.source_context as NativeObject).identity_variant_index = 1;
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  (entry.source_context as NativeObject).identity_variant_index = 0;
  cut.entries = Array(17).fill(entry);
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});
Deno.test("snapshot missing descriptive labels remain null without inventing an identity", () => {
  const body = syntheticSnapshotBody(), r = (body.rows as NativeObject[])[0];
  r.university_name = null;
  r.admission_track = null;
  r.identity_review = {
    status: "metadata_pending",
    reason_code: "SOURCE_IDENTITY_METADATA_PENDING",
    variants: [],
  };
  const result = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  equal((result.rows as NativeObject[])[0].university_name, null);
  equal((result.rows as NativeObject[])[0].admission_track, null);
});
Deno.test("snapshot unresolved identity keeps bounded original variants and selected source context", async () => {
  const body = syntheticSnapshotBody(), r = (body.rows as NativeObject[])[0];
  r.identity_review = {
    status: "review_pending",
    reason_code: "SOURCE_IDENTITY_VARIANTS_REVIEW_PENDING",
    variants: [{
      university_name: "SYNTHETIC 대학",
      department: "SYNTHETIC 학과",
      admission_track: "SYNTHETIC 일반",
      group: "가",
    }, {
      university_name: "SYNTHETIC 대학",
      department: "SYNTHETIC 학과",
      admission_track: "SYNTHETIC 지역",
      group: "가",
    }],
  };
  const c = r.competition_ratio as NativeObject;
  c.value = "2.00";
  c.status = "pending_metadata";
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  c.source_context = {
    observation_id: "observation:" + "a".repeat(64),
    identity_variant_index: 1,
    scope_status: "review_pending",
  };
  validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  (c.source_context as NativeObject).identity_variant_index = 2;
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});
Deno.test("snapshot original PK stays a string with leading zeros and approved academic years", async () => {
  const body = syntheticSnapshotBody(), r = (body.rows as NativeObject[])[0];
  r.original_pk = "000123";
  r.offering_id = "2026:000123";
  equal(
    (validateHistorySnapshotPayload(body, syntheticSnapshotPart())
      .rows as NativeObject[])[0]
      .original_pk,
    "000123",
  );
  for (const pk of [123, 123n]) {
    r.original_pk = pk;
    r.offering_id = "2026:123";
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
  r.original_pk = "000123";
  r.offering_id = "2023:000123";
  r.academic_year = 2023;
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});
Deno.test("snapshot paired 50 and 70 cuts require the same basis cohort and unit with labels", async () => {
  const body = syntheticSnapshotBody(), r = (body.rows as NativeObject[])[0];
  for (const slot of ["final_50_percent_cut", "final_70_percent_cut"]) {
    const c = r[slot] as NativeObject;
    c.value = "SYNTHETIC-original-numeric-text";
    c.status = "pending_metadata";
    c.unit = "점";
    c.basis_code = "SYNTHETIC-score";
    c.basis_label = "SYNTHETIC 기준";
    c.cohort_code = "SYNTHETIC-final";
    c.cohort_label = "SYNTHETIC 대상";
    c.selection_rule_ref = "SYNTHETIC-reviewed-rule";
  }
  validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  const upper = r.final_70_percent_cut as NativeObject;
  for (
    const field of [
      "basis_code",
      "cohort_code",
      "unit",
      "basis_label",
      "cohort_label",
    ]
  ) {
    const original = upper[field];
    upper[field] = field.endsWith("label") ? null : "SYNTHETIC-other";
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
    upper[field] = original;
  }
});
Deno.test("snapshot public source links reject signed storage and sensitive query keys", async () => {
  for (
    const url of [
      "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/sign/private/a?token=x",
      "https://synthetic.invalid/source?APIKEY=secret",
      "https://synthetic.invalid/source?X-Amz-Signature=secret",
      "https://synthetic.invalid/source?access_token=secret",
      "https://synthetic.invalid/storage/v1/object/authenticated/private/a",
      "http://127.0.0.1/a",
    ]
  ) {
    const body = syntheticSnapshotBody();
    ((body.rows as NativeObject[])[0].competition_ratio as NativeObject)
      .source_url = url;
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
});
Deno.test("snapshot verified reserve and headcount require reviewed units and nonblank values", async () => {
  for (
    const slot of [
      "final_additional_admission_rank",
      "additional_admission_count",
    ]
  ) {
    const body = syntheticSnapshotBody(),
      c = (body.rows as NativeObject[])[0][slot] as NativeObject;
    c.status = "verified_official";
    c.source_url = "https://synthetic.invalid/source";
    c.source_as_of = "2026-10-14";
    c.value = 1;
    c.unit = slot === "final_additional_admission_rank" ? "명" : "번";
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
    c.unit = slot === "final_additional_admission_rank" ? "번" : "명";
    validateHistorySnapshotPayload(body, syntheticSnapshotPart());
    c.value = " ";
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
});
async function denied(
  work: () => unknown | Promise<unknown>,
  code: string,
  http = 503,
) {
  let error: unknown;
  try {
    await work();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, code);
  equal(error.http, http);
}
function fixture(
  options: {
    partsOnly?: boolean;
    pending?: boolean;
    change?: boolean;
    scope?: string;
    expired?: boolean;
  } = {},
) {
  let now = NOW, reads = 0, heads = 0, finishes = 0;
  const p = {
    ...syntheticSnapshotPublication(options.partsOnly, options.pending),
    ...(options.scope ? { scopeSha256: options.scope } : {}),
    ...(options.expired ? { expiresAtUtc: NOW } : {}),
  };
  const service = new HistorySnapshotService(
    {
      current: () => {
        heads++;
        return Promise.resolve(p);
      },
      read: () => {
        reads++;
        return Promise.resolve(
          syntheticSnapshotBody(
            options.pending,
            options.partsOnly ? "SYNTHETIC-part" : null,
          ),
        );
      },
      assertCurrent: () => {
        finishes++;
        return options.change
          ? Promise.reject(new AccessError("publication_changed", 409))
          : Promise.resolve();
      },
    },
    { nowUtc: () => now },
    "a".repeat(64),
  );
  return {
    service,
    p,
    counts: () => ({ reads, heads, finishes }),
    setNow: (v: bigint) => now = v,
  };
}
Deno.test("snapshot head returns bounded public descriptors without object keys", async () => {
  const f = fixture(), head = await f.service.head(session, {});
  equal(head.snapshot_id, f.p.snapshotId);
  equal(head.delivery_mode, "full");
  assert(!JSON.stringify(head).includes("object_key"));
  assert(!JSON.stringify(head).includes("SYNTHETIC/private"));
  equal(f.counts(), { reads: 0, heads: 1, finishes: 1 });
});
Deno.test("snapshot head rejects every query including cache delivery intent", async () => {
  const f = fixture();
  const queries: Record<string, string>[] = [{ cache_delivery: "shared" }, {
    part_id: "SYNTHETIC-part",
  }];
  for (const q of queries) {
    await denied(() => f.service.head(session, q), "invalid_request", 422);
  }
  equal(f.counts().heads, 0);
});
Deno.test("snapshot full read uses one selected body and a final current check", async () => {
  const f = fixture(), body = await f.service.read(session, f.p.snapshotId, {});
  equal(body, syntheticSnapshotBody());
  equal(f.counts(), { reads: 1, heads: 1, finishes: 1 });
});
Deno.test("snapshot parts mode requires a listed part and never falls back to full", async () => {
  const f = fixture({ partsOnly: true });
  await denied(
    () => f.service.read(session, f.p.snapshotId, {}),
    "part_required",
    422,
  );
  await denied(
    () => f.service.read(session, f.p.snapshotId, { part_id: "SYNTHETIC-unknown" }),
    "snapshot_part_not_found",
    404,
  );
  equal(f.counts().reads, 0);
  const result = await f.service.read(session, f.p.snapshotId, {
    part_id: "SYNTHETIC-part",
  });
  equal(result.part_id, "SYNTHETIC-part");
});
Deno.test("snapshot stale edition and changed final head never return a body", async () => {
  const f = fixture();
  await denied(
    () => f.service.read(session, "SYNTHETIC-old", {}),
    "publication_changed",
    409,
  );
  equal(f.counts().reads, 0);
  await denied(
    () => fixture({ change: true }).service.read(session, f.p.snapshotId, {}),
    "publication_changed",
    409,
  );
});
Deno.test("snapshot enforces session policy expiry and approved public scope", async () => {
  for (const option of [{ scope: "b".repeat(64) }, { expired: true }]) {
    await denied(
      () => fixture(option).service.head(session, {}),
      "snapshot_invalid",
    );
  }
  const f = fixture();
  f.setNow(NOW + 120000000n);
  await denied(
    () => f.service.head(session, {}),
    "authentication_required",
    401,
  );
  equal(f.counts().heads, 0);
});
Deno.test("snapshot preserves unmapped observations under null original PK and separate counts", () => {
  const body = validateHistorySnapshotPayload(
      syntheticSnapshotBody(true),
      syntheticSnapshotPart(true),
    ),
    row = (body.rows as NativeObject[])[0];
  equal(row.original_pk, null);
  equal(row.offering_id, null);
  equal(row.mapping_status, "mapping_pending");
  assert(String(row.observation_key).startsWith("observation:"));
});
Deno.test("snapshot rejects fake PKs and silently dropped pending rows", async () => {
  const body = syntheticSnapshotBody(true),
    row = (body.rows as NativeObject[])[0];
  row.original_pk = "SYNTHETIC-fake";
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart(true)),
    "snapshot_invalid",
  );
  await denied(
    () =>
      validateHistorySnapshotPayload(
        syntheticSnapshotBody(true),
        syntheticSnapshotPart(false),
      ),
    "snapshot_invalid",
  );
});
Deno.test("snapshot strict public schema rejects private nested and top-level fields", async () => {
  const top = syntheticSnapshotBody();
  top.private_model = {};
  await denied(
    () => validateHistorySnapshotPayload(top, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  const body = syntheticSnapshotBody();
  ((body.rows as NativeObject[])[0].competition_ratio as NativeObject)
    .raw_scores = {};
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});
Deno.test("snapshot never turns missing unpublished or conflicting values into zero", async () => {
  for (
    const status of [
      "not_published",
      "pending_value_missing",
      "pending_value_type",
    ]
  ) {
    const body = syntheticSnapshotBody(),
      cell = (body.rows as NativeObject[])[0].competition_ratio as NativeObject;
    cell.status = status;
    cell.value = 0;
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
});
Deno.test("snapshot retains verified actual zero and native decimal without rounding", () => {
  const body = syntheticSnapshotBody(), row = (body.rows as NativeObject[])[0];
  for (const slot of ["competition_ratio", "final_additional_admission_rank"]) {
    const c = row[slot] as NativeObject;
    c.value = slot === "competition_ratio" ? new JsonFloat("2.00") : 0;
    c.status = "verified_official";
    c.unit = slot === "competition_ratio" ? "대 1" : "번";
    c.source_url = "https://synthetic.invalid/official";
    c.source_as_of = "2026-10-14T00:00:00Z";
    c.reason_code = null;
  }
  const result = validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    r = (result.rows as NativeObject[])[0];
  equal((r.final_additional_admission_rank as NativeObject).value, 0);
  const v = (r.competition_ratio as NativeObject).value;
  assert(v instanceof JsonFloat && v.lexeme === "2.00");
});
Deno.test("snapshot 75 percent cut cannot occupy a true 70 percent slot", async () => {
  const body = syntheticSnapshotBody(),
    c = (body.rows as NativeObject[])[0].final_70_percent_cut as NativeObject;
  c.statistic_percent = 75;
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  const alternate = (syntheticSnapshotBody().rows as NativeObject[])[0]
    .alternate_cut as NativeObject;
  equal(alternate.statistic_percent, 75);
});
Deno.test("snapshot rejects duplicate offering identity and inconsistent recruitment stage", async () => {
  const body = syntheticSnapshotBody();
  (body.rows as NativeObject[]).push((body.rows as NativeObject[])[0]);
  await denied(
    () =>
      validateHistorySnapshotPayload(body, {
        ...syntheticSnapshotPart(),
        rows: 2,
        mappedRows: 2,
      }),
    "snapshot_invalid",
  );
  const other = syntheticSnapshotBody();
  ((other.rows as NativeObject[])[0]
    .recruitment_count_with_stage as NativeObject).stage = "SYNTHETIC-unknown";
  await denied(
    () => validateHistorySnapshotPayload(other, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});
Deno.test("snapshot row requires every fixed cell and preserves five publication statuses", async () => {
  const body = syntheticSnapshotBody();
  delete (body.rows as NativeObject[])[0][HISTORY_SNAPSHOT_SLOTS[0]];
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  const valid = syntheticSnapshotBody(),
    row = (valid.rows as NativeObject[])[0];
  for (
    const [i, status] of [
      "verified_official",
      "pending_metadata",
      "pending_value_type",
      "pending_value_missing",
      "not_published",
    ].entries()
  ) {
    const c = row[HISTORY_SNAPSHOT_SLOTS[i]] as NativeObject;
    c.status = status;
    if (status === "verified_official") {
      c.value = 0;
      c.unit = "명";
      c.source_url = "https://synthetic.invalid/official";
      c.source_as_of = "2026-10-14T00:00:00Z";
      c.reason_code = null;
    }
  }
  validateHistorySnapshotPayload(valid, syntheticSnapshotPart());
});

Deno.test("snapshot published statistics retain original labels nullable percent and native values", () => {
  const body = syntheticSnapshotStatisticsBody();
  const result = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  equal(nativeJsonText(result, true), nativeJsonText(body, true));
  const entries = ((result.rows as NativeObject[])[0].alternate_cut as NativeObject)
    .entries as NativeObject[];
  equal(entries.length, 9);
  equal(entries.map((e) => e.statistic_percent), [
    75,
    80,
    90,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  assert(
    entries[3].value instanceof JsonFloat &&
      entries[3].value.lexeme === "6.500",
  );
  equal(entries[4].value, 0);
  equal(entries[5].value, "0");
  assert(entries[7].value === 9007199254740993n);
  equal(entries[8].status, "pending_metadata");
  equal(entries[8].statistic_label, null);
  equal(entries[8].source_url, null);
  assert(
    entries[8].value instanceof JsonFloat && entries[8].value.lexeme === "0.00",
  );
});
Deno.test("snapshot alternate percentages span reviewed integer ratios without populating fixed cuts", () => {
  const body = syntheticSnapshotStatisticsBody(),
    row = (body.rows as NativeObject[])[0],
    alternate = row.alternate_cut as NativeObject;
  const entry = (alternate.entries as NativeObject[])[0];
  alternate.entries = [1, 50, 70, 75, 80, 90, 100].map((percent) => ({
    ...entry,
    statistic_percent: percent,
    statistic_label: "SYNTHETIC " + percent + "%",
    source_context: {
      ...(entry.source_context as NativeObject),
      observation_id: "observation:" + percent.toString(16).padStart(64, "0"),
    },
  }));
  const result = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  const r = (result.rows as NativeObject[])[0];
  equal((r.final_50_percent_cut as NativeObject).value, null);
  equal((r.final_70_percent_cut as NativeObject).value, null);
  equal(
    ((r.alternate_cut as NativeObject).entries as NativeObject[]).map((e) => e.statistic_percent),
    [1, 50, 70, 75, 80, 90, 100],
  );
});
Deno.test("snapshot alternate percentages reject zero fractional string and out of range metadata", async () => {
  for (const percent of [0, -1, 101, 1.5, "80", 80n, new JsonFloat("75.0")]) {
    const body = syntheticSnapshotStatisticsBody();
    const entry = (((body.rows as NativeObject[])[0].alternate_cut as NativeObject)
      .entries as NativeObject[])[
        0
      ];
    entry.statistic_percent = percent;
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
});
Deno.test("snapshot verified nonpercent statistic needs its original label and reviewed comparison metadata", async () => {
  for (
    const field of [
      "statistic_label",
      "basis_code",
      "basis_label",
      "cohort_code",
      "cohort_label",
      "selection_rule_ref",
      "unit",
      "source_url",
      "source_as_of",
    ]
  ) {
    const body = syntheticSnapshotStatisticsBody();
    const entry = (((body.rows as NativeObject[])[0].alternate_cut as NativeObject)
      .entries as NativeObject[])[
        3
      ];
    entry[field] = null;
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
  const legacy = syntheticSnapshotStatisticsBody(),
    alternate = (legacy.rows as NativeObject[])[0]
      .alternate_cut as NativeObject;
  const old = (alternate.entries as NativeObject[])[0];
  old.statistic_label = null;
  alternate.entries = [old];
  validateHistorySnapshotPayload(legacy, syntheticSnapshotPart());
});
Deno.test("snapshot expanded statistics keep closed fields and exact source context bounds", async () => {
  for (const field of ["raw_scores", "private_rule", "statistic_kind"]) {
    const body = syntheticSnapshotStatisticsBody();
    const entry = (((body.rows as NativeObject[])[0].alternate_cut as NativeObject)
      .entries as NativeObject[])[
        3
      ];
    entry[field] = "SYNTHETIC_PRIVATE_CANARY";
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
  for (
    const context of [null, {
      observation_id: "observation:" + "a".repeat(64),
      identity_variant_index: 1,
      scope_status: "source_consistent",
    }, {
      observation_id: "observation:" + "a".repeat(64),
      identity_variant_index: 0,
      scope_status: "source_consistent",
      private_path: "SYNTHETIC_PRIVATE_CANARY",
    }]
  ) {
    const body = syntheticSnapshotStatisticsBody();
    const entry = (((body.rows as NativeObject[])[0].alternate_cut as NativeObject)
      .entries as NativeObject[])[
        3
      ];
    entry.source_context = context as NativeObject | null;
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
});
Deno.test("snapshot nonpercent statistics retain source URL and missing value safety rules", async () => {
  const body = syntheticSnapshotStatisticsBody();
  const entry = (((body.rows as NativeObject[])[0].alternate_cut as NativeObject)
    .entries as NativeObject[])[3];
  entry.source_url =
    "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/sign/private/a?token=SYNTHETIC";
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  entry.source_url = "https://synthetic.invalid/official-statistics";
  for (
    const status of [
      "pending_value_missing",
      "pending_value_type",
      "not_published",
    ]
  ) {
    entry.status = status;
    entry.reason_code = "SYNTHETIC_MISSING";
    entry.value = 0;
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
    entry.value = null;
    validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  }
});

/** Entirely invented values and identifiers; no source record is copied. */
function calculationYearFixture() {
  const body = syntheticSnapshotStatisticsBody();
  const row = (body.rows as NativeObject[])[0];
  row.academic_year = 2025;
  row.offering_id = "2025:" + row.original_pk;
  const alternate = row.alternate_cut as NativeObject;
  const entries = alternate.entries as NativeObject[];
  alternate.entries = [
    {
      ...entries[3],
      value: new JsonFloat("61.30"),
      statistic_label: "SYNTHETIC 평균",
      score_calculation_context: {
        source_result_year: 2025,
        score_calculation_year: 2025,
        observation_role: "actual_result",
      },
    },
    {
      ...entries[4],
      value: new JsonFloat("55.30"),
      statistic_label: "SYNTHETIC 평균",
      score_calculation_context: {
        source_result_year: 2025,
        score_calculation_year: 2026,
        observation_role: "prior_year_recalculated_reference",
      },
    },
    {
      ...entries[5],
      value: new JsonFloat("61.28"),
      statistic_label: "SYNTHETIC 평균",
      score_calculation_context: {
        source_result_year: 2025,
        score_calculation_year: null,
        observation_role: "unresolved",
      },
    },
  ];
  return { body, row, alternate, entries: alternate.entries as NativeObject[] };
}

Deno.test("snapshot preserves actual, prior-year recalculation and unresolved observations separately", async () => {
  const f = calculationYearFixture();
  const validated = validateHistorySnapshotPayload(
    f.body,
    syntheticSnapshotPart(),
  );
  const entries = ((validated.rows as NativeObject[])[0].alternate_cut as NativeObject)
    .entries as NativeObject[];
  equal(entries.length, 3);
  equal(
    entries.map((e) => (e.score_calculation_context as NativeObject).observation_role),
    [
      "actual_result",
      "prior_year_recalculated_reference",
      "unresolved",
    ],
  );
  equal(
    entries.map((e) => (e.score_calculation_context as NativeObject).source_result_year),
    [
      2025,
      2025,
      2025,
    ],
  );
  equal(
    entries.map((e) => (e.score_calculation_context as NativeObject).score_calculation_year),
    [
      2025,
      2026,
      null,
    ],
  );
  equal(entries.map((e) => (e.value as JsonFloat).lexeme), [
    "61.30",
    "55.30",
    "61.28",
  ]);
  equal(
    new Set(
      entries.map((e) => (e.source_context as NativeObject).observation_id),
    ).size,
    3,
  );
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const projected = projection.project(
      "history.snapshot.read",
      tier,
      validated,
    );
    equal(await nativeJsonSha256(projected), await nativeJsonSha256(validated));
    equal(nativeJsonText(projected, true), nativeJsonText(f.body, true));
  }
});

Deno.test("snapshot keeps a separately declared subsequent actual result in its own result year", () => {
  const body = syntheticSnapshotStatisticsBody(),
    row = (body.rows as NativeObject[])[0];
  const alternate = row.alternate_cut as NativeObject;
  const entry = (alternate.entries as NativeObject[])[3];
  entry.score_calculation_context = {
    source_result_year: 2026,
    score_calculation_year: 2026,
    observation_role: "actual_result",
  };
  const result = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  const r = (result.rows as NativeObject[])[0];
  equal(r.academic_year, 2026);
  equal(
    (((r.alternate_cut as NativeObject).entries as NativeObject[])[3]
      .score_calculation_context as NativeObject).source_result_year,
    2026,
  );
});

Deno.test("snapshot rejects a reference falsely declared as an actual result or under another result year", async () => {
  for (
    const change of [
      {
        source_result_year: 2025,
        score_calculation_year: 2026,
        observation_role: "actual_result",
      },
      {
        source_result_year: 2025,
        score_calculation_year: 2024,
        observation_role: "actual_result",
      },
      {
        source_result_year: 2026,
        score_calculation_year: 2026,
        observation_role: "prior_year_recalculated_reference",
      },
      {
        source_result_year: 2025,
        score_calculation_year: 2025,
        observation_role: "prior_year_recalculated_reference",
      },
      {
        source_result_year: 2025,
        score_calculation_year: null,
        observation_role: "actual_result",
      },
      {
        source_result_year: 2025,
        score_calculation_year: null,
        observation_role: "prior_year_recalculated_reference",
      },
      {
        source_result_year: 2025,
        score_calculation_year: "2026",
        observation_role: "prior_year_recalculated_reference",
      },
      {
        source_result_year: 2025,
        score_calculation_year: 2026.5,
        observation_role: "prior_year_recalculated_reference",
      },
      {
        source_result_year: 2025,
        score_calculation_year: 2026,
        observation_role: "actual",
      },
      {
        source_result_year: 2025,
        score_calculation_year: 2026,
        observation_role: "prior_year_recalculated_reference",
        private_source: "SYNTHETIC",
      },
    ]
  ) {
    const f = calculationYearFixture();
    f.entries[1].score_calculation_context = change as unknown as NativeObject;
    await denied(
      () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
  const f = calculationYearFixture();
  f.row.final_50_percent_cut = { ...f.entries[1], statistic_percent: 50 };
  await denied(
    () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  f.row.final_50_percent_cut = { ...f.entries[2], statistic_percent: 50 };
  await denied(
    () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});

Deno.test("snapshot binds new fixed 50 and 70 contexts while retaining legacy v1", async () => {
  const legacy = syntheticSnapshotStatisticsBody();
  validateHistorySnapshotPayload(legacy, syntheticSnapshotPart());
  const f = calculationYearFixture();
  f.row.final_50_percent_cut = {
    ...f.entries[0],
    statistic_percent: 50,
    selection_rule_ref: "SYNTHETIC-rule-A",
  };
  f.row.final_70_percent_cut = {
    ...f.entries[0],
    statistic_percent: 70,
    selection_rule_ref: "SYNTHETIC-rule-B",
  };
  validateHistorySnapshotPayload(f.body, syntheticSnapshotPart());
  const upper = f.row.final_70_percent_cut as NativeObject;
  upper.score_calculation_context = {
    source_result_year: 2025,
    score_calculation_year: 2024,
    observation_role: "actual_result",
  };
  await denied(
    () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  delete upper.score_calculation_context;
  await denied(
    () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});

Deno.test("snapshot preserves known but unclassified different-year scores as unresolved", () => {
  for (const year of [2024, 2026, null]) {
    const f = calculationYearFixture();
    (f.entries[2].score_calculation_context as NativeObject)
      .score_calculation_year = year;
    const out = validateHistorySnapshotPayload(f.body, syntheticSnapshotPart());
    const entry = (((out.rows as NativeObject[])[0].alternate_cut as NativeObject)
      .entries as NativeObject[])[2];
    equal(
      (entry.score_calculation_context as NativeObject).observation_role,
      "unresolved",
    );
    equal(
      (entry.score_calculation_context as NativeObject).score_calculation_year,
      year,
    );
    equal((entry.value as JsonFloat).lexeme, "61.28");
  }
});

Deno.test("snapshot recursive projection rejects invalid calculation context types for both tiers", async () => {
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    for (
      const [key, invalid] of [
        ["source_result_year", "2025"],
        ["score_calculation_year", "2026"],
        ["observation_role", "SYNTHETIC-unknown"],
      ] as const
    ) {
      const f = calculationYearFixture();
      (f.entries[1].score_calculation_context as NativeObject)[key] = invalid;
      await denied(
        () => projection.project("history.snapshot.read", tier, f.body),
        "security_policy_unavailable",
      );
    }
  }
});

/** Invented identical labels and distinct observations; values are not from source data. */
function unresolvedTwinFixture(first: string, second: string) {
  const f = calculationYearFixture();
  const entries = f.entries.slice(0, 2);
  for (const [i, value] of [first, second].entries()) {
    entries[i].value = new JsonFloat(value);
    entries[i].statistic_label = "SYNTHETIC 평균";
    entries[i].score_calculation_context = {
      source_result_year: 2025,
      score_calculation_year: null,
      observation_role: "unresolved",
    };
  }
  f.alternate.entries = entries;
  return { ...f, entries };
}

for (
  const [name, first, second] of [
    ["different values", "0.000000123400", "0.000000567800"],
    ["equal values", "0.000000246800", "0.000000246800"],
  ] as const
) {
  Deno.test(
    "snapshot keeps separate unresolved observations with " + name,
    async () => {
      const f = unresolvedTwinFixture(first, second);
      const body = validateHistorySnapshotPayload(
        f.body,
        syntheticSnapshotPart(),
      );
      const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
      const projection = new PublicResponseProjection(
        schemas,
        schemas.operations.map((o: { id: string; contract_ref: string }) => ({
          id: o.id,
          contract_ref: o.contract_ref,
        })),
      );
      for (const tier of ["standard", "paid"] as const) {
        const projected = projection.project(
          "history.snapshot.read",
          tier,
          body,
        ) as NativeObject;
        const alt = (projected.rows as NativeObject[])[0]
          .alternate_cut as NativeObject;
        const entries = alt.entries as NativeObject[];
        equal(entries.length, 2);
        equal(entries.map((x) => (x.value as JsonFloat).lexeme), [
          first,
          second,
        ]);
        equal(
          new Set(
            entries.map((x) => (x.source_context as NativeObject).observation_id),
          ).size,
          2,
        );
        equal(
          entries.map((x) => (x.score_calculation_context as NativeObject).score_calculation_year),
          [null, null],
        );
        equal(
          entries.map((x) => (x.score_calculation_context as NativeObject).observation_role),
          ["unresolved", "unresolved"],
        );
        equal(await nativeJsonSha256(projected), await nativeJsonSha256(body));
      }
    },
  );
}

Deno.test("legacy snapshot allows a shared source ID across different statistics without year inference", () => {
  const body = syntheticSnapshotStatisticsBody();
  const row = (body.rows as NativeObject[])[0];
  const alt = row.alternate_cut as NativeObject;
  const entries = (alt.entries as NativeObject[]).slice(3, 5);
  (entries[1].source_context as NativeObject).observation_id =
    (entries[0].source_context as NativeObject).observation_id;
  alt.entries = entries;
  const validated = validateHistorySnapshotPayload(
    body,
    syntheticSnapshotPart(),
  );
  const output = ((validated.rows as NativeObject[])[0].alternate_cut as NativeObject)
    .entries as NativeObject[];
  equal(output.length, 2);
  assert(output[0].statistic_label !== output[1].statistic_label);
  assert(
    output.every((entry) => !Object.hasOwn(entry, "score_calculation_context")),
  );
});

Deno.test("snapshot keeps same statistic and cohort on distinct synthetic score components", async () => {
  const f = unresolvedTwinFixture("0.000000013570", "0.000000097530");
  f.entries[0].basis_code = "SYNTHETIC-component-a";
  f.entries[0].basis_label = "SYNTHETIC component A";
  f.entries[1].basis_code = "SYNTHETIC-component-b";
  f.entries[1].basis_label = "SYNTHETIC component B";
  const body = validateHistorySnapshotPayload(f.body, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const projected = projection.project(
      "history.snapshot.read",
      tier,
      body,
    ) as NativeObject;
    const row = (projected.rows as NativeObject[])[0];
    const entries = (row.alternate_cut as NativeObject)
      .entries as NativeObject[];
    equal(entries.length, 2);
    equal(entries.map((e) => e.statistic_label), [
      "SYNTHETIC 평균",
      "SYNTHETIC 평균",
    ]);
    equal(entries[0].cohort_code, entries[1].cohort_code);
    equal(entries.map((e) => e.basis_code), [
      "SYNTHETIC-component-a",
      "SYNTHETIC-component-b",
    ]);
    equal(entries.map((e) => e.basis_label), [
      "SYNTHETIC component A",
      "SYNTHETIC component B",
    ]);
    equal(entries.map((e) => (e.value as JsonFloat).lexeme), [
      "0.000000013570",
      "0.000000097530",
    ]);
    equal(
      entries.map((e) => (e.score_calculation_context as NativeObject).observation_role),
      ["unresolved", "unresolved"],
    );
    equal(await nativeJsonSha256(projected), await nativeJsonSha256(body));
  }
});

Deno.test("snapshot keeps different identity variants under the same PK pending without promotion", async () => {
  const f = unresolvedTwinFixture("0.000000013570", "0.000000097530");
  f.row.identity_review = {
    status: "review_pending",
    reason_code: "SYNTHETIC_IDENTITY_REVIEW_PENDING",
    variants: [
      {
        university_name: "SYNTHETIC 학교",
        department: "SYNTHETIC 모집단위 A",
        admission_track: "SYNTHETIC 전형",
        group: null,
      },
      {
        university_name: "SYNTHETIC 학교",
        department: "SYNTHETIC 모집단위 B",
        admission_track: "SYNTHETIC 전형",
        group: null,
      },
    ],
  };
  for (const [i, entry] of f.entries.entries()) {
    entry.status = "pending_metadata";
    entry.reason_code = "SYNTHETIC_IDENTITY_REVIEW_PENDING";
    (entry.source_context as NativeObject).identity_variant_index = i;
    (entry.source_context as NativeObject).scope_status = "review_pending";
  }
  const body = validateHistorySnapshotPayload(f.body, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const projected = projection.project(
      "history.snapshot.read",
      tier,
      body,
    ) as NativeObject;
    const row = (projected.rows as NativeObject[])[0];
    const review = row.identity_review as NativeObject;
    const entries = (row.alternate_cut as NativeObject)
      .entries as NativeObject[];
    equal(row.original_pk, "SYNTHETIC-pk");
    equal(review.status, "review_pending");
    equal((review.variants as NativeObject[]).length, 2);
    equal(entries.length, 2);
    equal(
      entries.map((e) => (e.source_context as NativeObject).identity_variant_index),
      [0, 1],
    );
    equal(entries.map((e) => (e.source_context as NativeObject).scope_status), [
      "review_pending",
      "review_pending",
    ]);
    equal(entries.map((e) => e.status), [
      "pending_metadata",
      "pending_metadata",
    ]);
    equal(
      new Set(
        entries.map((e) => (e.source_context as NativeObject).observation_id),
      ).size,
      2,
    );
    equal(await nativeJsonSha256(projected), await nativeJsonSha256(body));
  }
});

Deno.test("snapshot keeps a labeled target-admission simulation unresolved across identity variants", async () => {
  const f = unresolvedTwinFixture("0.000000024680", "0.000000086420");
  f.row.academic_year = 2024;
  f.row.offering_id = "2024:" + f.row.original_pk;
  f.row.identity_review = {
    status: "review_pending",
    reason_code: "SYNTHETIC_SCOPE_REVIEW_PENDING",
    variants: [
      {
        university_name: "SYNTHETIC 학교",
        department: "SYNTHETIC program A",
        admission_track: "SYNTHETIC track",
        group: null,
      },
      {
        university_name: "SYNTHETIC 학교",
        department: "SYNTHETIC program B",
        admission_track: "SYNTHETIC track",
        group: null,
      },
    ],
  };
  for (const [i, entry] of f.entries.entries()) {
    entry.statistic_label = "SYNTHETIC prior-result target-admission simulation";
    entry.status = "pending_metadata";
    entry.reason_code = "SYNTHETIC_SCOPE_REVIEW_PENDING";
    (entry.source_context as NativeObject).identity_variant_index = i;
    (entry.source_context as NativeObject).scope_status = "review_pending";
    (entry.score_calculation_context as NativeObject).source_result_year = 2024;
    entry.publication_context = {
      publication_role: "simulation_reference",
      simulation_target_academic_year: 2025,
    };
  }
  const body = validateHistorySnapshotPayload(f.body, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const projected = projection.project(
      "history.snapshot.read",
      tier,
      body,
    ) as NativeObject;
    const row = (projected.rows as NativeObject[])[0];
    const entries = (row.alternate_cut as NativeObject)
      .entries as NativeObject[];
    equal(row.academic_year, 2024);
    equal((row.identity_review as NativeObject).status, "review_pending");
    equal(entries.map((e) => e.statistic_label), [
      "SYNTHETIC prior-result target-admission simulation",
      "SYNTHETIC prior-result target-admission simulation",
    ]);
    equal(
      entries.map((e) => (e.source_context as NativeObject).identity_variant_index),
      [0, 1],
    );
    equal(entries.map((e) => (e.source_context as NativeObject).scope_status), [
      "review_pending",
      "review_pending",
    ]);
    equal(entries.map((e) => e.status), [
      "pending_metadata",
      "pending_metadata",
    ]);
    equal(entries.map((e) => (e.publication_context as NativeObject).publication_role), [
      "simulation_reference",
      "simulation_reference",
    ]);
    equal(
      entries.map((e) => (e.publication_context as NativeObject).simulation_target_academic_year),
      [2025, 2025],
    );
    equal(
      entries.map((e) => (e.score_calculation_context as NativeObject).score_calculation_year),
      [null, null],
    );
    equal(
      entries.map((e) => (e.score_calculation_context as NativeObject).observation_role),
      ["unresolved", "unresolved"],
    );
    equal(entries.map((e) => (e.value as JsonFloat).lexeme), [
      "0.000000024680",
      "0.000000086420",
    ]);
    equal(await nativeJsonSha256(projected), await nativeJsonSha256(body));
  }
  const context = f.entries[0].score_calculation_context as NativeObject;
  context.observation_role = "simulated_admission_reference";
  await denied(
    () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  context.observation_role = "unresolved";
  context.target_admission_year = 2025;
  await denied(
    () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});

function publicationContextFixture() {
  const f = calculationYearFixture();
  f.entries[0].publication_context = {
    publication_role: "actual_result",
    simulation_target_academic_year: null,
  };
  f.entries[1].publication_context = {
    publication_role: "simulation_reference",
    simulation_target_academic_year: 2027,
  };
  f.entries[2].publication_context = {
    publication_role: "unresolved",
    simulation_target_academic_year: null,
  };
  return f;
}

Deno.test("snapshot keeps publication purpose and target year independent of calculation year", async () => {
  const f = publicationContextFixture();
  const body = validateHistorySnapshotPayload(f.body, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const projected = projection.project("history.snapshot.read", tier, body) as NativeObject;
    const row = (projected.rows as NativeObject[])[0];
    const entries = (row.alternate_cut as NativeObject).entries as NativeObject[];
    equal(row.academic_year, 2025);
    equal(entries.map((e) => (e.publication_context as NativeObject).publication_role), [
      "actual_result",
      "simulation_reference",
      "unresolved",
    ]);
    equal(
      entries.map((e) => (e.publication_context as NativeObject).simulation_target_academic_year),
      [null, 2027, null],
    );
    equal(
      entries.map((e) => (e.score_calculation_context as NativeObject).score_calculation_year),
      [2025, 2026, null],
    );
    equal(entries.map((e) => (e.value as JsonFloat).lexeme), ["61.30", "55.30", "61.28"]);
    equal(await nativeJsonSha256(projected), await nativeJsonSha256(body));
  }
  const unknownTarget = publicationContextFixture();
  (unknownTarget.entries[1].publication_context as NativeObject).simulation_target_academic_year =
    null;
  const pending = validateHistorySnapshotPayload(unknownTarget.body, syntheticSnapshotPart());
  const entry =
    (((pending.rows as NativeObject[])[0].alternate_cut as NativeObject).entries as NativeObject[])[
      1
    ];
  equal((entry.publication_context as NativeObject).simulation_target_academic_year, null);
  equal((entry.score_calculation_context as NativeObject).score_calculation_year, 2026);
});

Deno.test("snapshot rejects malformed publication purpose, target and conflicting scoring roles", async () => {
  for (
    const bad of [
      null,
      { publication_role: "unknown", simulation_target_academic_year: null },
      { publication_role: "simulation_reference", simulation_target_academic_year: "2027" },
      { publication_role: "simulation_reference", simulation_target_academic_year: 2027.5 },
      { publication_role: "simulation_reference", simulation_target_academic_year: true },
      { publication_role: "simulation_reference", simulation_target_academic_year: 0 },
      { publication_role: "simulation_reference", simulation_target_academic_year: 10000 },
      {
        publication_role: "simulation_reference",
        simulation_target_academic_year: 2027,
        private_source: "SYNTHETIC",
      },
      { publication_role: "actual_result", simulation_target_academic_year: 2027 },
      { publication_role: "unresolved", simulation_target_academic_year: 2027 },
      { publication_role: "actual_result", simulation_target_academic_year: null },
    ]
  ) {
    const f = publicationContextFixture();
    f.entries[1].publication_context = bad as unknown as NativeObject;
    await denied(
      () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
  const conflict = publicationContextFixture();
  conflict.entries[0].publication_context = {
    publication_role: "simulation_reference",
    simulation_target_academic_year: 2027,
  };
  await denied(
    () => validateHistorySnapshotPayload(conflict.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  const nonCut = publicationContextFixture();
  (nonCut.row.competition_ratio as NativeObject).publication_context = {
    publication_role: "unresolved",
    simulation_target_academic_year: null,
  };
  await denied(
    () => validateHistorySnapshotPayload(nonCut.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});

Deno.test("snapshot never promotes simulation or unresolved publication to primary cuts", async () => {
  for (
    const publication of [
      { publication_role: "simulation_reference", simulation_target_academic_year: 2027 },
      { publication_role: "unresolved", simulation_target_academic_year: null },
    ]
  ) {
    for (const slot of ["final_50_percent_cut", "final_70_percent_cut"] as const) {
      const f = publicationContextFixture();
      const main: NativeObject = {
        ...f.entries[0],
        statistic_percent: slot === "final_50_percent_cut" ? 50 : 70,
        publication_context: publication,
      };
      delete main.score_calculation_context;
      f.row[slot] = main;
      await denied(
        () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
        "snapshot_invalid",
      );
    }
  }
  // The wrapper cannot claim any publication role, including an actual label
  // while an individual entry carries the simulation reference.
  for (
    const publication of [
      { publication_role: "actual_result", simulation_target_academic_year: null },
      { publication_role: "simulation_reference", simulation_target_academic_year: 2027 },
      { publication_role: "unresolved", simulation_target_academic_year: null },
    ]
  ) {
    const f = publicationContextFixture();
    f.alternate.publication_context = publication;
    await denied(
      () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  assert(
    !Object.hasOwn(
      schemas.schemas.history_snapshot_alternate_cell.properties,
      "publication_context",
    ),
  );
  assert(
    Object.hasOwn(schemas.schemas.history_snapshot_cut_cell.properties, "publication_context"),
  );
});

Deno.test("snapshot requires matching actual publication roles for a populated primary cut pair", async () => {
  const f = publicationContextFixture();
  f.row.final_50_percent_cut = { ...f.entries[0], statistic_percent: 50 };
  f.row.final_70_percent_cut = { ...f.entries[0], statistic_percent: 70 };
  validateHistorySnapshotPayload(f.body, syntheticSnapshotPart());
  const lower = f.row.final_50_percent_cut as NativeObject;
  const upper = f.row.final_70_percent_cut as NativeObject;
  delete upper.publication_context;
  await denied(
    () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  upper.publication_context = {
    publication_role: "actual_result",
    simulation_target_academic_year: null,
  };
  delete lower.publication_context;
  await denied(
    () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  lower.publication_context = {
    publication_role: "actual_result",
    simulation_target_academic_year: null,
  };
  upper.publication_context = {
    publication_role: "unresolved",
    simulation_target_academic_year: null,
  };
  await denied(
    () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});

Deno.test("public projection rejects invalid publication context types in both tiers", async () => {
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    for (
      const bad of [
        null,
        { publication_role: "other", simulation_target_academic_year: null },
        { publication_role: "simulation_reference", simulation_target_academic_year: "2027" },
        { publication_role: "simulation_reference", simulation_target_academic_year: 2027.5 },
        { publication_role: "simulation_reference" },
      ]
    ) {
      const f = publicationContextFixture();
      f.entries[1].publication_context = bad as unknown as NativeObject;
      await denied(
        () => projection.project("history.snapshot.read", tier, f.body),
        "security_policy_unavailable",
      );
    }
  }
});

Deno.test("legacy v1 projection does not infer publication purpose or mutate semantic bytes", async () => {
  const original = syntheticSnapshotStatisticsBody();
  const before = await nativeJsonSha256(original);
  const body = validateHistorySnapshotPayload(original, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const projected = projection.project("history.snapshot.read", tier, body) as NativeObject;
    const entries = ((projected.rows as NativeObject[])[0].alternate_cut as NativeObject)
      .entries as NativeObject[];
    assert(entries.every((e) => !Object.hasOwn(e, "publication_context")));
    equal(await nativeJsonSha256(projected), before);
  }
});

// Priority is deliberately not inferred from a rule identifier. The fixture supplies
// a pending reason; this checks its transport, not a publisher selection algorithm.
Deno.test("snapshot preserves pending priority conflicts without choosing a winner", async () => {
  for (const sameBasis of [false, true]) {
    const body = syntheticSnapshotStatisticsBody();
    const row = (body.rows as NativeObject[])[0];
    const alt = row.alternate_cut as NativeObject;
    const originals = alt.entries as NativeObject[];
    const entries = [originals[3], originals[4]].map((original, i) => ({
      ...original,
      value: new JsonFloat(i === 0 ? "0.000000010230" : "0.000000045670"),
      status: "pending_metadata",
      reason_code: "SYNTHETIC_PRIORITY_CONFLICT_PENDING",
      statistic_label: "SYNTHETIC source statistic / original label",
      cohort: "SYNTHETIC source cohort",
      cohort_code: "SYNTHETIC-cohort",
      cohort_label: "SYNTHETIC cohort label / original",
      basis_code: i === 0 || sameBasis ? "SYNTHETIC-component-a" : "SYNTHETIC-component-b",
      basis_label: i === 0 || sameBasis ? "SYNTHETIC component A" : "SYNTHETIC component B",
      selection_rule_ref: "SYNTHETIC-same-rule-reference",
      source_context: {
        ...(original.source_context as NativeObject),
        scope_status: "review_pending",
      },
      score_calculation_context: {
        source_result_year: 2026,
        score_calculation_year: null,
        observation_role: "unresolved",
      },
      publication_context: i === 0
        ? { publication_role: "unresolved", simulation_target_academic_year: null }
        : { publication_role: "simulation_reference", simulation_target_academic_year: null },
    }));
    alt.entries = entries;
    alt.reason_code = "SYNTHETIC_PRIORITY_CONFLICT_PENDING";
    const upper = row.final_70_percent_cut as NativeObject;
    upper.status = "pending_metadata";
    upper.reason_code = "SYNTHETIC_PRIORITY_CONFLICT_PENDING";
    const validated = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
    const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
    const projection = new PublicResponseProjection(
      schemas,
      schemas.operations.map((o: { id: string; contract_ref: string }) => ({
        id: o.id,
        contract_ref: o.contract_ref,
      })),
    );
    for (const tier of ["standard", "paid"] as const) {
      const out = projection.project("history.snapshot.read", tier, validated) as NativeObject;
      const outputRow = (out.rows as NativeObject[])[0];
      const outputAlt = outputRow.alternate_cut as NativeObject;
      const got = outputAlt.entries as NativeObject[];
      equal(got.length, 2);
      equal(got.map((v) => v.status), ["pending_metadata", "pending_metadata"]);
      equal(got.map((v) => v.reason_code), [
        "SYNTHETIC_PRIORITY_CONFLICT_PENDING",
        "SYNTHETIC_PRIORITY_CONFLICT_PENDING",
      ]);
      equal(got.map((v) => v.statistic_label), [
        "SYNTHETIC source statistic / original label",
        "SYNTHETIC source statistic / original label",
      ]);
      equal(got.map((v) => v.source_url), [
        "https://synthetic.invalid/official-statistics",
        "https://synthetic.invalid/official-statistics",
      ]);
      equal(got.map((v) => v.source_as_of), ["2026-10-14", "2026-10-14"]);
      equal(got.map((v) => v.cohort_code), ["SYNTHETIC-cohort", "SYNTHETIC-cohort"]);
      equal(got.map((v) => (v.source_context as NativeObject).scope_status), [
        "review_pending",
        "review_pending",
      ]);
      equal(got.map((v) => v.cohort), ["SYNTHETIC source cohort", "SYNTHETIC source cohort"]);
      equal(got.map((v) => v.cohort_label), [
        "SYNTHETIC cohort label / original",
        "SYNTHETIC cohort label / original",
      ]);
      equal(got.map((v) => v.basis_code), [
        "SYNTHETIC-component-a",
        sameBasis ? "SYNTHETIC-component-a" : "SYNTHETIC-component-b",
      ]);
      equal(got.map((v) => v.basis_label), [
        "SYNTHETIC component A",
        sameBasis ? "SYNTHETIC component A" : "SYNTHETIC component B",
      ]);
      equal(got.map((v) => v.selection_rule_ref), [
        "SYNTHETIC-same-rule-reference",
        "SYNTHETIC-same-rule-reference",
      ]);
      equal(got.map((v) => (v.value as JsonFloat).lexeme), ["0.000000010230", "0.000000045670"]);
      equal(got.map((v) => (v.score_calculation_context as NativeObject).score_calculation_year), [
        null,
        null,
      ]);
      equal(got.map((v) => (v.publication_context as NativeObject).publication_role), [
        "unresolved",
        "simulation_reference",
      ]);
      equal(
        got.map((v) => (v.publication_context as NativeObject).simulation_target_academic_year),
        [null, null],
      );
      equal((outputRow.final_50_percent_cut as NativeObject).value, null);
      equal((outputRow.final_70_percent_cut as NativeObject).value, null);
      equal((outputRow.final_70_percent_cut as NativeObject).status, "pending_metadata");
      equal(await nativeJsonSha256(out), await nativeJsonSha256(validated));
    }
  }
});

Deno.test("snapshot does not replace missing 50 with an average or 70", async () => {
  for (const [hasMean, has70] of [[true, false], [false, true], [true, true]] as const) {
    const body = syntheticSnapshotStatisticsBody();
    const row = (body.rows as NativeObject[])[0];
    const alt = row.alternate_cut as NativeObject;
    const entries = alt.entries as NativeObject[];
    const mean: NativeObject = {
      ...entries[3],
      value: new JsonFloat("0.000000012340"),
      statistic_label: "SYNTHETIC original mean label",
      statistic_percent: null,
    };
    const seventy: NativeObject = {
      ...entries[0],
      value: new JsonFloat("0.000000056780"),
      statistic_label: "SYNTHETIC original 70 label",
      statistic_percent: 70,
    };
    alt.entries = hasMean ? [mean] : [];
    if (has70) row.final_70_percent_cut = seventy;
    const validated = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
    const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
    const projection = new PublicResponseProjection(
      schemas,
      schemas.operations.map((o: { id: string; contract_ref: string }) => ({
        id: o.id,
        contract_ref: o.contract_ref,
      })),
    );
    for (const tier of ["standard", "paid"] as const) {
      const out = projection.project("history.snapshot.read", tier, validated) as NativeObject;
      const r = (out.rows as NativeObject[])[0];
      equal((r.final_50_percent_cut as NativeObject).value, null);
      equal((r.final_50_percent_cut as NativeObject).status, "not_published");
      const u = r.final_70_percent_cut as NativeObject;
      equal(has70 ? (u.value as JsonFloat).lexeme : u.value, has70 ? "0.000000056780" : null);
      const a = (r.alternate_cut as NativeObject).entries as NativeObject[];
      equal(a.length, hasMean ? 1 : 0);
      if (hasMean) {
        equal(a[0].statistic_label, "SYNTHETIC original mean label");
        equal(a[0].statistic_percent, null);
        equal((a[0].value as JsonFloat).lexeme, "0.000000012340");
      }
      equal(await nativeJsonSha256(out), await nativeJsonSha256(validated));
    }
  }
});

Deno.test("snapshot retains explicit synthetic missing and hold reasons without inferring values", () => {
  const reasons = [
    "SYNTHETIC_MULTIPLE_BASIS_PENDING",
    "SYNTHETIC_SAME_COHORT_50_MISSING",
    "SYNTHETIC_CANDIDATE_EVENT_CONFLICT",
    "SYNTHETIC_MAPPING_PENDING",
    "SYNTHETIC_SOURCE_SCOPE_PENDING",
    "SYNTHETIC_BASIS_UNCLASSIFIED",
  ];
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const reason of reasons) {
    const mappingPending = reason === "SYNTHETIC_MAPPING_PENDING";
    const body = syntheticSnapshotBody(mappingPending);
    const row = (body.rows as NativeObject[])[0];
    const fifty = row.final_50_percent_cut as NativeObject;
    fifty.status = "pending_metadata";
    fifty.reason_code = reason;
    const validated = validateHistorySnapshotPayload(body, syntheticSnapshotPart(mappingPending));
    for (const tier of ["standard", "paid"] as const) {
      const out = projection.project("history.snapshot.read", tier, validated) as NativeObject;
      const resultRow = (out.rows as NativeObject[])[0];
      const result = resultRow.final_50_percent_cut as NativeObject;
      equal(result.value, null);
      equal(result.reason_code, reason);
      equal(result.status, "pending_metadata");
      equal(resultRow.mapping_status, mappingPending ? "mapping_pending" : "mapped");
      if (mappingPending) equal(resultRow.original_pk, null);
      assert(!Object.hasOwn(result, "score_calculation_context"));
      assert(!Object.hasOwn(result, "publication_context"));
    }
  }
});

// All schools, labels, values, years, sources and observations below are invented.
// These checks preserve supplied facts; they do not classify publisher source material.
Deno.test("snapshot keeps multiple synthetic schools and years' actual and recalculated observations distinct", async () => {
  const cases = [
    {
      year: 2024,
      calculationYear: 2025,
      school: "SYNTHETIC school A",
      schoolId: "SYNTHETIC-school-a",
      track: "SYNTHETIC track A",
      pk: "SYNTHETIC-pk-a",
      ids: ["1", "2", "3"],
      values: ["0.0001010", "0.0002020", "0.0003030"],
    },
    {
      year: 2026,
      calculationYear: 2027,
      school: "SYNTHETIC school B",
      schoolId: "SYNTHETIC-school-b",
      track: "SYNTHETIC track B",
      pk: "SYNTHETIC-pk-b",
      ids: ["4", "5", "6"],
      values: ["0.0004040", "0.0005050", "0.0006060"],
    },
  ] as const;
  const rows = cases.map((sample, schoolIndex) => {
    const row = (syntheticSnapshotStatisticsBody().rows as NativeObject[])[0];
    row.academic_year = sample.year;
    row.original_pk = sample.pk;
    row.offering_id = `${sample.year}:${sample.pk}`;
    row.university_id = sample.schoolId;
    row.university_name = sample.school;
    row.admission_track = sample.track;
    row.identity_review = {
      status: "review_pending",
      reason_code: "SYNTHETIC_SOURCE_VARIANT_PENDING",
      variants: ["SYNTHETIC program original", "SYNTHETIC program source variant"].map(
        (department) => ({
          university_name: sample.school,
          department,
          admission_track: sample.track,
          group: null,
        }),
      ),
    };
    const alternate = row.alternate_cut as NativeObject;
    const originals = alternate.entries as NativeObject[];
    alternate.entries = ["actual", "recalculated", "unknown"].map((kind, i) => ({
      ...originals[3 + i],
      value: new JsonFloat(sample.values[i]),
      statistic_label: "SYNTHETIC source observation",
      source_url: `https://synthetic.invalid/school-${schoolIndex}/${kind}`,
      source_context: {
        observation_id: "observation:" + sample.ids[i].repeat(64),
        identity_variant_index: i === 0 ? 0 : 1,
        scope_status: "review_pending",
      },
      score_calculation_context: {
        source_result_year: sample.year,
        score_calculation_year: i === 0 ? sample.year : i === 1 ? sample.calculationYear : null,
        observation_role: i === 0
          ? "actual_result"
          : i === 1
          ? "prior_year_recalculated_reference"
          : "unresolved",
      },
      publication_context: {
        publication_role: i === 0 ? "actual_result" : "unresolved",
        simulation_target_academic_year: null,
      },
    }));
    return row;
  });
  const body = syntheticSnapshotBody();
  body.rows = rows;
  const part = { ...syntheticSnapshotPart(), rows: 2, mappedRows: 2 };
  const validated = validateHistorySnapshotPayload(body, part);
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const out = projection.project("history.snapshot.read", tier, validated) as NativeObject;
    const resultRows = out.rows as NativeObject[];
    equal(resultRows.length, 2);
    for (const [i, sample] of cases.entries()) {
      const row = resultRows[i];
      const review = row.identity_review as NativeObject;
      const variants = review.variants as NativeObject[];
      const entries = (row.alternate_cut as NativeObject).entries as NativeObject[];
      equal([row.academic_year, row.university_id, row.admission_track], [
        sample.year,
        sample.schoolId,
        sample.track,
      ]);
      equal(review.status, "review_pending");
      equal(variants.map((v) => v.admission_track), [sample.track, sample.track]);
      equal(variants.map((v) => v.department), [
        "SYNTHETIC program original",
        "SYNTHETIC program source variant",
      ]);
      equal(entries.length, 3);
      equal(entries.map((e) => e.source_url), [
        `https://synthetic.invalid/school-${i}/actual`,
        `https://synthetic.invalid/school-${i}/recalculated`,
        `https://synthetic.invalid/school-${i}/unknown`,
      ]);
      equal(
        entries.map((e) => (e.source_context as NativeObject).observation_id),
        sample.ids.map((id) => "observation:" + id.repeat(64)),
      );
      equal(entries.map((e) => (e.source_context as NativeObject).identity_variant_index), [
        0,
        1,
        1,
      ]);
      equal(entries.map((e) => (e.source_context as NativeObject).scope_status), [
        "review_pending",
        "review_pending",
        "review_pending",
      ]);
      equal(entries.map((e) => (e.score_calculation_context as NativeObject).source_result_year), [
        sample.year,
        sample.year,
        sample.year,
      ]);
      equal(
        entries.map((e) => (e.score_calculation_context as NativeObject).score_calculation_year),
        [sample.year, sample.calculationYear, null],
      );
      equal(entries.map((e) => (e.score_calculation_context as NativeObject).observation_role), [
        "actual_result",
        "prior_year_recalculated_reference",
        "unresolved",
      ]);
      equal(entries.map((e) => (e.publication_context as NativeObject).publication_role), [
        "actual_result",
        "unresolved",
        "unresolved",
      ]);
      equal(
        entries.map((e) => (e.publication_context as NativeObject).simulation_target_academic_year),
        [null, null, null],
      );
      equal(entries.map((e) => (e.value as JsonFloat).lexeme), [...sample.values]);
    }
    equal(await nativeJsonSha256(out), await nativeJsonSha256(validated));
  }
});

// Variant and hold are supplied by the fixture, not inferred from track labels.
Deno.test("snapshot preserves another synthetic track as pending under a general offering", async () => {
  const f = calculationYearFixture();
  f.row.university_name = "SYNTHETIC school C";
  f.row.admission_track = "SYNTHETIC general track";
  f.row.identity_review = {
    status: "review_pending",
    reason_code: "SYNTHETIC_TRACK_SCOPE_REVIEW_PENDING",
    variants: ["SYNTHETIC general track", "SYNTHETIC other track"].map((admission_track) => ({
      university_name: "SYNTHETIC school C",
      department: "SYNTHETIC program C",
      admission_track,
      group: null,
    })),
  };
  const actual: NativeObject = {
    ...f.entries[0],
    value: new JsonFloat("0.000000031415"),
    basis_code: "SYNTHETIC-general-track-score",
    basis_label: "SYNTHETIC general track score (full mark: 17)",
    source_url: "https://synthetic.invalid/school-c/general-source",
    source_context: {
      observation_id: "observation:" + "7".repeat(64),
      identity_variant_index: 0,
      scope_status: "source_consistent",
    },
    publication_context: {
      publication_role: "actual_result",
      simulation_target_academic_year: null,
    },
  };
  const pending: NativeObject = {
    ...f.entries[2],
    value: new JsonFloat("0.0007070"),
    basis_code: "SYNTHETIC-other-track-score",
    basis_label: "SYNTHETIC other track score (full mark: 23)",
    status: "pending_metadata",
    reason_code: "SYNTHETIC_TRACK_SCOPE_REVIEW_PENDING",
    source_url: "https://synthetic.invalid/school-c/other-track-source",
    source_context: {
      observation_id: "observation:" + "8".repeat(64),
      identity_variant_index: 1,
      scope_status: "review_pending",
    },
    publication_context: { publication_role: "unresolved", simulation_target_academic_year: null },
  };
  f.alternate.entries = [actual, pending];
  const validated = validateHistorySnapshotPayload(f.body, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const out = projection.project("history.snapshot.read", tier, validated) as NativeObject;
    const row = (out.rows as NativeObject[])[0];
    const review = row.identity_review as NativeObject;
    const variants = review.variants as NativeObject[];
    const entries = (row.alternate_cut as NativeObject).entries as NativeObject[];
    equal(row.mapping_status, "mapped");
    equal(row.admission_track, "SYNTHETIC general track");
    equal(review.status, "review_pending");
    equal(review.reason_code, "SYNTHETIC_TRACK_SCOPE_REVIEW_PENDING");
    equal(variants.map((v) => v.admission_track), [
      "SYNTHETIC general track",
      "SYNTHETIC other track",
    ]);
    equal(entries.map((e) => (e.source_context as NativeObject).identity_variant_index), [0, 1]);
    equal(entries.map((e) => (e.source_context as NativeObject).scope_status), [
      "source_consistent",
      "review_pending",
    ]);
    equal(entries.map((e) => e.source_url), [
      "https://synthetic.invalid/school-c/general-source",
      "https://synthetic.invalid/school-c/other-track-source",
    ]);
    equal(entries.map((e) => (e.source_context as NativeObject).observation_id), [
      "observation:" + "7".repeat(64),
      "observation:" + "8".repeat(64),
    ]);
    equal(entries.map((e) => e.basis_code), [
      "SYNTHETIC-general-track-score",
      "SYNTHETIC-other-track-score",
    ]);
    equal(entries.map((e) => e.basis_label), [
      "SYNTHETIC general track score (full mark: 17)",
      "SYNTHETIC other track score (full mark: 23)",
    ]);
    equal(entries.map((e) => (e.value as JsonFloat).lexeme), ["0.000000031415", "0.0007070"]);
    equal(entries.map((e) => e.status), ["verified_official", "pending_metadata"]);
    equal(entries[1].reason_code, "SYNTHETIC_TRACK_SCOPE_REVIEW_PENDING");
    equal((entries[1].score_calculation_context as NativeObject).score_calculation_year, null);
    equal((entries[1].publication_context as NativeObject).publication_role, "unresolved");
    equal((entries[1].value as JsonFloat).lexeme, "0.0007070");
    equal((row.final_50_percent_cut as NativeObject).value, null);
    equal((row.final_70_percent_cut as NativeObject).value, null);
    equal(await nativeJsonSha256(out), await nativeJsonSha256(validated));
  }
  // The fixture explicitly marks the observation as unresolved: the service
  // rejects copying that marked observation into either populated fixed slot.
  for (
    const [slot, percent] of [["final_50_percent_cut", 50], ["final_70_percent_cut", 70]] as const
  ) {
    const previous = f.row[slot];
    const promoted: NativeObject = { ...pending, statistic_percent: percent };
    // Isolate the explicit publication-role guard from score-year validation.
    delete promoted.score_calculation_context;
    f.row[slot] = promoted;
    await denied(
      () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
    f.row[slot] = previous;
  }
});

// The full marks are literal source labels, not independent numeric DTO fields.
Deno.test("snapshot keeps separate synthetic component cuts and rejects mixed main bases", async () => {
  const body = syntheticSnapshotStatisticsBody();
  const row = (body.rows as NativeObject[])[0];
  const alternate = row.alternate_cut as NativeObject;
  const originals = alternate.entries as NativeObject[];
  const labels = [
    "SYNTHETIC 공식 성분 A (만점 137점)",
    "SYNTHETIC 공식 성분 B (만점 29점)",
  ];
  const values = ["0.0000110", "0.0000220", "0.0000330", "0.0000440"];
  const entries = [0, 1, 2, 3].map((i): NativeObject => ({
    ...originals[i],
    value: new JsonFloat(values[i]),
    statistic_percent: i % 2 === 0 ? 50 : 70,
    statistic_label: i % 2 === 0 ? "SYNTHETIC 50%" : "SYNTHETIC 70%",
    basis_code: i < 2 ? "SYNTHETIC-component-a" : "SYNTHETIC-component-b",
    basis_label: labels[i < 2 ? 0 : 1],
    source_url: `https://synthetic.invalid/component-${i < 2 ? "a" : "b"}`,
    source_context: {
      observation_id: "observation:" + ["a", "b", "c", "d"][i].repeat(64),
      identity_variant_index: 0,
      scope_status: "source_consistent",
    },
  }));
  alternate.entries = entries;
  const validated = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  assert(
    !Object.hasOwn(schemas.schemas.history_snapshot_cut_cell.properties, "official_max_score"),
  );
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const out = projection.project("history.snapshot.read", tier, validated) as NativeObject;
    const result = (out.rows as NativeObject[])[0];
    const got = (result.alternate_cut as NativeObject).entries as NativeObject[];
    equal(got.length, 4);
    equal(got.map((e) => e.statistic_percent), [50, 70, 50, 70]);
    equal(got.map((e) => e.basis_code), [
      "SYNTHETIC-component-a",
      "SYNTHETIC-component-a",
      "SYNTHETIC-component-b",
      "SYNTHETIC-component-b",
    ]);
    equal(got.map((e) => e.basis_label), [labels[0], labels[0], labels[1], labels[1]]);
    equal(got.map((e) => (e.value as JsonFloat).lexeme), values);
    equal((result.final_50_percent_cut as NativeObject).value, null);
    equal((result.final_70_percent_cut as NativeObject).value, null);
    equal(await nativeJsonSha256(out), await nativeJsonSha256(validated));
  }
  for (const [low, high] of [[0, 1], [2, 3]]) {
    row.final_50_percent_cut = entries[low];
    row.final_70_percent_cut = entries[high];
    validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  }
  for (const [low, high] of [[0, 3], [2, 1]]) {
    row.final_50_percent_cut = entries[low];
    row.final_70_percent_cut = entries[high];
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
});

// These are explicitly supplied fictional axes, not source classification logic.
Deno.test("snapshot keeps synthetic PDF and portal bonus axes separate", async () => {
  const body = syntheticSnapshotStatisticsBody();
  const row = (body.rows as NativeObject[])[0];
  const alt = row.alternate_cut as NativeObject;
  const originals = alt.entries as NativeObject[];
  const values = ["0.000000001230", "0.000000004560", "0.000000007890", "0.000000002460"];
  const sources = ["https://synthetic.invalid/report.pdf", "https://synthetic.invalid/portal"];
  const entries = [0, 1, 2, 3].map((i): NativeObject => ({
    ...originals[i],
    value: new JsonFloat(values[i]),
    statistic_percent: i % 2 === 0 ? 50 : 70,
    statistic_label: i % 2 === 0 ? "SYNTHETIC original 50 label" : "SYNTHETIC original 70 label",
    basis_code: i < 2 ? "SYNTHETIC-bonus-included" : "SYNTHETIC-bonus-excluded",
    basis_label: i < 2 ? "SYNTHETIC score including bonus" : "SYNTHETIC score excluding bonus",
    source_url: sources[i < 2 ? 0 : 1],
    source_context: {
      observation_id: "observation:" + ["a", "b", "c", "d"][i].repeat(64),
      identity_variant_index: 0,
      scope_status: "source_consistent",
    },
  }));
  alt.entries = entries;
  const validated = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const out = projection.project("history.snapshot.read", tier, validated) as NativeObject;
    const result = (out.rows as NativeObject[])[0];
    const got = (result.alternate_cut as NativeObject).entries as NativeObject[];
    equal(got.length, 4);
    equal(got.map((e) => e.source_url), [sources[0], sources[0], sources[1], sources[1]]);
    equal(got.map((e) => e.basis_code), [
      "SYNTHETIC-bonus-included",
      "SYNTHETIC-bonus-included",
      "SYNTHETIC-bonus-excluded",
      "SYNTHETIC-bonus-excluded",
    ]);
    equal(got.map((e) => e.basis_label), [
      "SYNTHETIC score including bonus",
      "SYNTHETIC score including bonus",
      "SYNTHETIC score excluding bonus",
      "SYNTHETIC score excluding bonus",
    ]);
    equal(got.map((e) => e.statistic_percent), [50, 70, 50, 70]);
    equal(
      got.map((e) => (e.source_context as NativeObject).observation_id),
      ["a", "b", "c", "d"].map((seed) => "observation:" + seed.repeat(64)),
    );
    equal(got.map((e) => (e.value as JsonFloat).lexeme), values);
    equal(await nativeJsonSha256(out), await nativeJsonSha256(validated));
  }
  // Same-basis controls establish that only mixed axes are rejected in this fixture.
  for (const [low, high] of [[0, 1], [2, 3]]) {
    row.final_50_percent_cut = entries[low];
    row.final_70_percent_cut = entries[high];
    validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  }
  for (const [low, high] of [[0, 3], [2, 1]]) {
    row.final_50_percent_cut = entries[low];
    row.final_70_percent_cut = entries[high];
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
});

Deno.test("snapshot preserves applicant mean and enrolled mean and cut as distinct cohorts", async () => {
  const body = syntheticSnapshotStatisticsBody();
  const row = (body.rows as NativeObject[])[0];
  const alt = row.alternate_cut as NativeObject;
  const originals = alt.entries as NativeObject[];
  const applicants: NativeObject = {
    ...originals[3],
    value: new JsonFloat("0.000000003210"),
    statistic_percent: null,
    statistic_label: "SYNTHETIC applicant mean / source label",
    cohort: "SYNTHETIC applicants",
    cohort_code: "SYNTHETIC-applicants",
    cohort_label: "SYNTHETIC applicant cohort / source label",
    source_url: "https://synthetic.invalid/applicant-mean",
  };
  const enrolled: NativeObject = {
    ...originals[4],
    value: new JsonFloat("0.000000006540"),
    statistic_percent: null,
    statistic_label: "SYNTHETIC enrolled mean / source label",
    cohort: "SYNTHETIC enrolled",
    cohort_code: "SYNTHETIC-enrolled",
    cohort_label: "SYNTHETIC enrolled cohort / source label",
    source_url: "https://synthetic.invalid/enrolled-mean",
  };
  const seventy: NativeObject = {
    ...originals[0],
    value: new JsonFloat("0.000000009870"),
    statistic_percent: 70,
    statistic_label: "SYNTHETIC enrolled 70 cut / source label",
    cohort: "SYNTHETIC enrolled",
    cohort_code: "SYNTHETIC-enrolled",
    cohort_label: "SYNTHETIC enrolled cohort / source label",
    source_url: "https://synthetic.invalid/enrolled-cut",
  };
  alt.entries = [applicants, enrolled];
  row.final_70_percent_cut = seventy;
  const validated = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const out = projection.project("history.snapshot.read", tier, validated) as NativeObject;
    const result = (out.rows as NativeObject[])[0];
    const entries = (result.alternate_cut as NativeObject).entries as NativeObject[];
    const upper = result.final_70_percent_cut as NativeObject;
    equal(entries.length, 2);
    equal(entries.map((e) => e.statistic_percent), [null, null]);
    equal(entries.map((e) => e.statistic_label), [
      "SYNTHETIC applicant mean / source label",
      "SYNTHETIC enrolled mean / source label",
    ]);
    equal(entries.map((e) => e.cohort), ["SYNTHETIC applicants", "SYNTHETIC enrolled"]);
    equal(entries.map((e) => e.cohort_code), ["SYNTHETIC-applicants", "SYNTHETIC-enrolled"]);
    equal(entries.map((e) => e.cohort_label), [
      "SYNTHETIC applicant cohort / source label",
      "SYNTHETIC enrolled cohort / source label",
    ]);
    equal(entries.map((e) => e.source_url), [
      "https://synthetic.invalid/applicant-mean",
      "https://synthetic.invalid/enrolled-mean",
    ]);
    equal(entries.map((e) => (e.value as JsonFloat).lexeme), ["0.000000003210", "0.000000006540"]);
    equal(upper.statistic_percent, 70);
    equal(upper.statistic_label, "SYNTHETIC enrolled 70 cut / source label");
    equal(upper.cohort_code, "SYNTHETIC-enrolled");
    equal((upper.value as JsonFloat).lexeme, "0.000000009870");
    equal((result.final_50_percent_cut as NativeObject).value, null);
    equal(await nativeJsonSha256(out), await nativeJsonSha256(validated));
  }
  // A non-percent mean copied without its explicit statistic identity is not a 50 cut.
  for (const mean of [applicants, enrolled]) {
    row.final_50_percent_cut = mean;
    await denied(
      () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
  // Independently valid synthetic 50 cuts show that rejection of the mixed
  // 50/70 pair comes from cohort_code, not a missing statistic_percent.
  const applicant50: NativeObject = {
    ...applicants,
    value: new JsonFloat("0.000000007770"),
    statistic_percent: 50,
    statistic_label: "SYNTHETIC applicant 50 cut / source label",
    source_url: "https://synthetic.invalid/applicant-cut",
    source_context: {
      observation_id: "observation:" + "1".repeat(64),
      identity_variant_index: 0,
      scope_status: "source_consistent",
    },
  };
  const enrolled50: NativeObject = {
    ...applicant50,
    statistic_label: "SYNTHETIC enrolled 50 cut / source label",
    cohort: "SYNTHETIC enrolled",
    cohort_code: "SYNTHETIC-enrolled",
    cohort_label: "SYNTHETIC enrolled cohort / source label",
    source_url: "https://synthetic.invalid/enrolled-50-cut",
    source_context: {
      observation_id: "observation:" + "2".repeat(64),
      identity_variant_index: 0,
      scope_status: "source_consistent",
    },
  };
  row.final_50_percent_cut = applicant50;
  row.final_70_percent_cut =
    (syntheticSnapshotBody().rows as NativeObject[])[0].final_70_percent_cut;
  validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  row.final_50_percent_cut = enrolled50;
  row.final_70_percent_cut = seventy;
  const sameCohort = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  const paired = (sameCohort.rows as NativeObject[])[0];
  equal((paired.final_50_percent_cut as NativeObject).statistic_percent, 50);
  equal((paired.final_70_percent_cut as NativeObject).statistic_percent, 70);
  equal((paired.final_50_percent_cut as NativeObject).cohort_code, "SYNTHETIC-enrolled");
  equal((paired.final_70_percent_cut as NativeObject).cohort_code, "SYNTHETIC-enrolled");
  row.final_50_percent_cut = applicant50;
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
  // Change only the cohort code from the accepted pair to isolate the check.
  row.final_50_percent_cut = { ...enrolled50, cohort_code: "SYNTHETIC-applicants" };
  await denied(
    () => validateHistorySnapshotPayload(body, syntheticSnapshotPart()),
    "snapshot_invalid",
  );
});

// The basis identifies the fictional indicator; the statistic and cohort are
// independently supplied. A mean in an indicator name does not forbid a 70 cut.
Deno.test("snapshot keeps a synthetic percentile mean indicator separate from its 70 cut", async () => {
  const body = syntheticSnapshotStatisticsBody();
  const row = (body.rows as NativeObject[])[0];
  const alt = row.alternate_cut as NativeObject;
  const originals = alt.entries as NativeObject[];
  const common = {
    unit: "%",
    basis_code: "SYNTHETIC-subject-percentile-mean-indicator",
    basis_label: "SYNTHETIC subject percentile mean indicator",
    cohort: "SYNTHETIC enrolled cohort",
    cohort_code: "SYNTHETIC-enrolled-cohort",
    cohort_label: "SYNTHETIC original enrolled cohort",
  };
  const cut70: NativeObject = {
    ...originals[0],
    ...common,
    value: new JsonFloat("0.000000001110"),
    statistic_percent: 70,
    statistic_label: "SYNTHETIC original 70 percent cut",
    source_url: "https://synthetic.invalid/percentile-cut",
  };
  const mean: NativeObject = {
    ...originals[3],
    ...common,
    value: new JsonFloat("0.000000002220"),
    statistic_percent: null,
    statistic_label: "SYNTHETIC original mean statistic",
    source_url: "https://synthetic.invalid/percentile-mean",
  };
  row.final_70_percent_cut = cut70;
  alt.entries = [mean];
  const validated = validateHistorySnapshotPayload(body, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const out = projection.project("history.snapshot.read", tier, validated) as NativeObject;
    const result = (out.rows as NativeObject[])[0];
    const upper = result.final_70_percent_cut as NativeObject;
    const entries = (result.alternate_cut as NativeObject).entries as NativeObject[];
    equal(entries.length, 1);
    const average = entries[0];
    equal([upper.basis_code, average.basis_code], [common.basis_code, common.basis_code]);
    equal([upper.basis_label, average.basis_label], [common.basis_label, common.basis_label]);
    equal([upper.cohort, average.cohort], [common.cohort, common.cohort]);
    equal([upper.cohort_code, average.cohort_code], [common.cohort_code, common.cohort_code]);
    equal([upper.cohort_label, average.cohort_label], [common.cohort_label, common.cohort_label]);
    equal([upper.statistic_percent, average.statistic_percent], [70, null]);
    equal([upper.statistic_label, average.statistic_label], [
      "SYNTHETIC original 70 percent cut",
      "SYNTHETIC original mean statistic",
    ]);
    equal([upper.source_url, average.source_url], [
      "https://synthetic.invalid/percentile-cut",
      "https://synthetic.invalid/percentile-mean",
    ]);
    equal([(upper.value as JsonFloat).lexeme, (average.value as JsonFloat).lexeme], [
      "0.000000001110",
      "0.000000002220",
    ]);
    equal((result.final_50_percent_cut as NativeObject).value, null);
    equal(await nativeJsonSha256(out), await nativeJsonSha256(validated));
  }
});

// Explicitly independent source/role/scope states: preservation is not track approval.
Deno.test("snapshot preserves independent official actual and pending track scope", async () => {
  const f = calculationYearFixture();
  f.row.admission_track = "SYNTHETIC general track";
  f.row.identity_review = {
    status: "review_pending",
    reason_code: "SYNTHETIC_TRACK_REVIEW_PENDING",
    variants: ["SYNTHETIC general track", "SYNTHETIC other track"].map((admission_track) => ({
      university_name: "SYNTHETIC school D",
      department: "SYNTHETIC program D",
      admission_track,
      group: null,
    })),
  };
  const observation: NativeObject = {
    ...f.entries[0],
    value: new JsonFloat("0.000000004440"),
    status: "verified_official",
    reason_code: null,
    source_url: "https://synthetic.invalid/other-track-official",
    source_context: {
      observation_id: "observation:" + "e".repeat(64),
      identity_variant_index: 1,
      scope_status: "review_pending",
    },
    publication_context: {
      publication_role: "actual_result",
      simulation_target_academic_year: null,
    },
  };
  f.alternate.entries = [observation];
  const validated = validateHistorySnapshotPayload(f.body, syntheticSnapshotPart());
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const out = projection.project("history.snapshot.read", tier, validated) as NativeObject;
    const row = (out.rows as NativeObject[])[0];
    const review = row.identity_review as NativeObject;
    const variants = review.variants as NativeObject[];
    const entries = (row.alternate_cut as NativeObject).entries as NativeObject[];
    equal(row.admission_track, "SYNTHETIC general track");
    equal(review.status, "review_pending");
    equal(review.reason_code, "SYNTHETIC_TRACK_REVIEW_PENDING");
    equal(variants.map((v) => v.admission_track), [
      "SYNTHETIC general track",
      "SYNTHETIC other track",
    ]);
    equal(entries.length, 1);
    equal(entries[0].status, "verified_official");
    equal(entries[0].source_url, "https://synthetic.invalid/other-track-official");
    equal((entries[0].publication_context as NativeObject).publication_role, "actual_result");
    equal((entries[0].source_context as NativeObject).identity_variant_index, 1);
    equal((entries[0].source_context as NativeObject).scope_status, "review_pending");
    equal((entries[0].value as JsonFloat).lexeme, "0.000000004440");
    equal((row.final_50_percent_cut as NativeObject).value, null);
    equal((row.final_70_percent_cut as NativeObject).value, null);
    equal(await nativeJsonSha256(out), await nativeJsonSha256(validated));
  }
});
