/** Synthetic end-to-end application and recursive DTO boundaries; no operating source. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { bindFieldQualificationPublication } from "../../supabase/functions/_shared/jungsi/application/history_field_qualification.ts";
import {
  HistorySnapshotService,
  validateHistorySnapshotPayload,
  validateQualifiedHistorySnapshotPayload,
} from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  syntheticSnapshotBody,
  syntheticSnapshotPart,
  syntheticSnapshotPublication,
  syntheticSnapshotRow,
} from "./synthetic_history_snapshot.ts";
import {
  SYNTHETIC_QUALIFICATION_PREVIOUS,
  SYNTHETIC_QUALIFICATION_SCHEMA_JSON,
  syntheticQualifiableBody,
  syntheticQualificationArtifacts,
} from "./synthetic_history_qualification.ts";
import { SYNTHETIC_RUNTIME_NOW as NOW } from "./synthetic_runtime_binding.ts";
import { assert, equal } from "./fixture.ts";
const SLOT = "final_additional_admission_rank";
const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
async function denied(
  work: () => unknown | Promise<unknown>,
  code = "snapshot_invalid",
  status = 503,
) {
  try {
    await work();
  } catch (e) {
    assert(e instanceof AccessError);
    equal([e.code, e.http], [code, status]);
    return;
  }
  throw new Error("synthetic_qualification_was_not_rejected");
}
async function fixture() {
  const body = syntheticQualifiableBody(),
    artifacts = await syntheticQualificationArtifacts(body),
    row = (body.rows as NativeObject[])[0],
    rank = row[SLOT] as NativeObject,
    pub = {
      ...syntheticSnapshotPublication(),
      sourceHeadSha256: "b".repeat(64),
      fieldQualification: await bindFieldQualificationPublication(
        artifacts.descriptor.approvals,
        artifacts.bytes,
        {
          publicationSha256: "e".repeat(64),
          sourceHeadSha256: "b".repeat(64),
          scopeSha256: "a".repeat(64),
          authoritySha256: "a".repeat(64),
          qualificationReceiptSha256: (artifacts.descriptor.receipt as NativeObject)
            .sha256 as string,
          previousManifestSha256: SYNTHETIC_QUALIFICATION_PREVIOUS,
          expectedSubjectCount: 1,
        },
      ),
    };
  rank.service_qualification = artifacts.q;
  return { body, pub, row, rank, artifacts, part: syntheticSnapshotPart() };
}
Deno.test("qualified wrapper preserves the legacy synchronous result without grants", async () => {
  const body = syntheticSnapshotBody(), part = syntheticSnapshotPart();
  equal(
    nativeJsonText(
      await validateQualifiedHistorySnapshotPayload(body, part, null),
    ),
    nativeJsonText(validateHistorySnapshotPayload(body, part)),
  );
});
Deno.test("qualified wrapper retains original pending identity native values and caller bytes", async () => {
  const f = await fixture(), before = nativeJsonText(f.body);
  const result = await validateQualifiedHistorySnapshotPayload(
      f.body,
      f.part,
      f.pub,
    ),
    row = (result.rows as NativeObject[])[0],
    rank = row[SLOT] as NativeObject;
  equal(nativeJsonText(f.body), before);
  equal([
    rank.value,
    rank.status,
    rank.unit,
    rank.source_url,
    (row.identity_review as NativeObject).status,
  ], ["17", "pending_metadata", null, null, "review_pending"]);
  assert(nativeJsonText(result).includes("1.2300e+04"));
  equal(
    (rank.service_qualification as NativeObject).subject,
    f.artifacts.q.subject,
  );
});
for (
  const mutation of [
    "missing-q",
    "wrong-variant",
    "wrong-identity",
    "null-rank",
    "q-on-other-slot",
  ]
) {
  Deno.test("qualified wrapper rejects " + mutation, async () => {
    const f = await fixture();
    if (mutation === "missing-q") delete f.rank.service_qualification;
    if (mutation === "wrong-variant") {
      ((f.rank.service_qualification as NativeObject).subject as NativeObject)
        .identity_variant_index = 0;
    }
    if (mutation === "wrong-identity") {
      (f.row.identity_review as NativeObject).reason_code = "SYNTHETIC-different";
    }
    if (mutation === "null-rank") f.rank.value = null;
    if (mutation === "q-on-other-slot") {
      (f.row.competition_ratio as NativeObject).service_qualification = f.artifacts.q;
    }
    await denied(() => validateQualifiedHistorySnapshotPayload(f.body, f.part, f.pub));
  });
}
Deno.test("body q cannot self-register a grant absent an approved review", async () => {
  const f = await fixture(), pub = syntheticSnapshotPublication();
  await denied(() => validateQualifiedHistorySnapshotPayload(f.body, f.part, pub));
});
Deno.test("qualified wrapper captures payload before any asynchronous hash", async () => {
  const f = await fixture(),
    before = nativeJsonText(f.body),
    pending = validateQualifiedHistorySnapshotPayload(f.body, f.part, f.pub);
  f.rank.value = "18";
  ((f.rank.service_qualification as NativeObject)
    .normalized_service_fields as NativeObject).unit = "명";
  ((f.row.identity_review as NativeObject).variants as NativeObject[])[1]
    .department = "SYNTHETIC-late-mutation";
  equal(nativeJsonText(await pending), before);
});
Deno.test("qualification preserves large legacy parts and captures non-target rows before await", async () => {
  const f = await fixture(), rows = f.body.rows as NativeObject[];
  for (let i = 0; i < 4100; i++) {
    const row = syntheticSnapshotRow();
    row.original_pk = "SYNTHETIC-other-" + i;
    row.offering_id = "2026:" + row.original_pk;
    rows.push(row);
  }
  const part = { ...f.part, rows: rows.length, mappedRows: rows.length };
  const pending = validateQualifiedHistorySnapshotPayload(f.body, part, f.pub);
  rows[rows.length - 1].department = "SYNTHETIC-late-mutation";
  const result = (await pending).rows as NativeObject[];
  equal(result.length, 4101);
  equal(result[result.length - 1].department, "SYNTHETIC 모집단위");
  assert(Object.hasOwn(result[0][SLOT] as NativeObject, "service_qualification"));
});
Deno.test("qualified service retains current head and session rechecks and keeps grants out of head DTO", async () => {
  const f = await fixture();
  let current = true, checks = 0;
  const service = new HistorySnapshotService(
    {
      current: () => Promise.resolve(f.pub),
      read: () => Promise.resolve(f.body),
      assertCurrent: () => {
        checks++;
        if (!current) throw new AccessError("publication_changed", 409);
        return Promise.resolve();
      },
    },
    { nowUtc: () => NOW },
    "a".repeat(64),
  );
  const session = {
    user: { subjectId: "SYNTHETIC-owner", expiresAtUtc: NOW + 120000000n },
    evaluatedAtUtc: NOW,
    tier: "standard" as const,
    paidUntilUtc: null,
  };
  const head = await service.head(session, {});
  assert(!Object.hasOwn(head, "fieldQualification"));
  const result = await service.read(session, f.pub.snapshotId, {});
  assert(
    Object.hasOwn(
      (result.rows as NativeObject[])[0][SLOT] as NativeObject,
      "service_qualification",
    ),
  );
  equal(checks, 2);
  current = false;
  await denied(
    () => service.read(session, f.pub.snapshotId, {}),
    "publication_changed",
    409,
  );
});
for (const tier of ["standard", "paid"] as const) {
  Deno.test(
    "rank-only public recursive DTO preserves exact qualified metadata for " +
      tier,
    async () => {
      const f = await fixture(),
        body = await validateQualifiedHistorySnapshotPayload(
          f.body,
          f.part,
          f.pub,
        ),
        projection = new PublicResponseProjection(
          schemas,
          schemas.operations.map((o: { id: string; contract_ref: string }) => ({
            id: o.id,
            contract_ref: o.contract_ref,
          })),
        );
      equal(
        nativeJsonText(
          projection.project("history.snapshot.read", tier, body),
          true,
        ),
        nativeJsonText(body, true),
      );
      const illegal = (body.rows as NativeObject[])[0]
        .competition_ratio as NativeObject;
      illegal.service_qualification = f.artifacts.q;
      const filtered = projection.project(
        "history.snapshot.read",
        tier,
        body,
      ) as NativeObject;
      assert(
        !Object.hasOwn(
          (filtered.rows as NativeObject[])[0]
            .competition_ratio as NativeObject,
          "service_qualification",
        ),
      );
    },
  );
}
