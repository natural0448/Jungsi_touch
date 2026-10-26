/** Application-only snapshot checks with an explicit fake port; no DB/Storage acceptance. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  HISTORY_SNAPSHOT_SLOTS,
  HistorySnapshotService,
  validateHistorySnapshotPayload,
  validateQualifiedHistorySnapshotPayload,
} from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import { bindHistoricalReferencePublication } from "../../supabase/functions/_shared/jungsi/application/history_reference_estimates.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
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
  const body = syntheticSnapshotStatisticsBody(), row = (body.rows as NativeObject[])[0];
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
  equal((row.historical_cutoff_references as NativeObject[])[0].value, "1.2300");
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
  await denied(() =>
    validateQualifiedHistorySnapshotPayload(f.body, syntheticSnapshotPart(), {
      ...f.publication,
      historicalReferences: { ...f.publication.historicalReferences },
    }), "snapshot_invalid");
});
Deno.test("historical reference review context is bound to all three publication pins", async () => {
  for (const key of ["publicationSha256", "sourceHeadSha256", "scopeSha256"]) {
    const f = historicalFixture();
    await denied(() =>
      validateQualifiedHistorySnapshotPayload(f.body, syntheticSnapshotPart(), {
        ...f.publication,
        [key]: "6".repeat(64),
      }), "snapshot_invalid");
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
    const value of [0, null, "", "NaN", "Infinity", "-0.0001", "100.0001", "1e10001", "01.2", " 1 "]
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
      ((out.rows as NativeObject[])[0].historical_cutoff_references as NativeObject[])[0].value,
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
  for (const key of ["engine_approved", "production_allowed", "private_model"]) {
    const f = historicalFixture();
    (f.row.historical_cutoff_references as NativeObject[])[0][key] = true;
    await denied(
      () => validateHistorySnapshotPayload(f.body, syntheticSnapshotPart()),
      "snapshot_invalid",
    );
  }
  const f = historicalFixture();
  let reads = 0;
  Object.defineProperty((f.row.historical_cutoff_references as NativeObject[])[0], "value", {
    enumerable: true,
    get() {
      reads++;
      return "1";
    },
  });
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
    () => validateQualifiedHistorySnapshotPayload(f.body, syntheticSnapshotPart(), f.publication),
    "snapshot_invalid",
  );
});
Deno.test("historical reference review rejects inconsistent counts and runtime approval", async () => {
  for (
    const extra of [{ observation_count: 0 }, { school_count: 3 }, { engine_approved: true }, {
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
    () => validateQualifiedHistorySnapshotPayload(f.body, syntheticSnapshotPart(), f.publication),
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
