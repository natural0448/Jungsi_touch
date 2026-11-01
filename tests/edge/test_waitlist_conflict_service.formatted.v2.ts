/** Invented end-to-end service/response projection; no DB or external requests. */
import { assert, equal } from "./fixture.ts";
import schemas from "../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import {
  CurrentPublicCatalogCursor,
  type CurrentPublicCatalogPort,
  CurrentPublicCatalogService,
  currentPublicResponseSchemas,
  type PublicCatalogRecord,
} from "../../supabase/functions/_shared/current_public_catalog.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { utcInstant } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

Deno.test("conflicting count and rank stay held for both tiers with existing response allowlist and one search", async () => {
  const now = utcInstant("2026-10-19T00:00:00Z"), expires = now + 43_200_000_000n;
  const record: PublicCatalogRecord = {
    key: [
      2024,
      "SYNTHETIC-SCHOOL",
      "2024:SYNTHETIC-A",
      "additional_admission_rank",
      "SYNTHETIC-OBS",
    ],
    row: {
      academic_year: 2024,
      school_id: "SYNTHETIC-SCHOOL",
      offering_pk: "2024:SYNTHETIC-A",
      university_code: "SYNTHETIC-UNI",
      university: "가상대학교",
      department: "가상모집단위",
      track: null,
      recruit_group: null,
      active_service: true,
      canonical_result_id: "SYNTHETIC-OBS",
      metric_kind: "additional_admission_rank",
      statistic_label: "추가합격인원수",
      metric_value_literal: "3",
      metric_value_json_type: "integer",
      metric_value_numeric: "3",
      source_location: {},
      curation_fields: {
        qualification_status: "verified_official",
        metric_definition: "SYNTHETIC-DEFINITION",
        unit: "명",
        source_url: "https://admission.synthetic.example/notice",
        source_as_of: "2026-10-18",
        private_marker: "SYNTHETIC-NOT-PUBLIC",
      },
    },
    guide: null,
  };
  let searchCalls = 0, lookupCalls = 0, catalogCalls = 0;
  const current: CurrentPublicCatalogPort = {
    publication: () =>
      Promise.resolve({
        version: "SYNTHETIC-CURRENT",
        sha256: "a".repeat(64),
        expiresAtUtc: expires,
      }),
    search: () => {
      searchCalls++;
      return Promise.resolve({
        version: "SYNTHETIC-CURRENT",
        head: "b".repeat(64),
        asOfUtc: now,
        rows: [record],
      });
    },
    lookup: () => {
      lookupCalls++;
      throw new Error("SYNTHETIC_UNEXPECTED_LOOKUP");
    },
  };
  const service = new CurrentPublicCatalogService(
    {
      getCatalog: () => {
        catalogCalls++;
        throw new Error("SYNTHETIC_UNEXPECTED_CATALOG");
      },
    },
    current,
    { nowUtc: () => now },
    new CurrentPublicCatalogCursor(new Uint8Array(32).fill(7)),
  );
  const projection = new PublicResponseProjection(
    currentPublicResponseSchemas(schemas),
    schemas.operations.map(({ id, contract_ref }) => ({ id, contract_ref })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const request: ApiExecution = {
      operation: "history.search",
      session: {
        user: { subjectId: "00000000-0000-0000-0000-000000000001", expiresAtUtc: expires },
        evaluatedAtUtc: now,
        tier,
        paidUntilUtc: tier === "paid" ? expires : null,
      },
      management: null,
      body: {},
      query: {},
      params: {},
      requestKey: null,
    };
    const result = await service.execute(request);
    const publicResult = projection.project("history.search", tier, result) as NativeObject;
    const item = (publicResult.items as NativeObject[])[0];
    equal(
      [item.metric_name, item.value, item.publication_status, item.statistic_label, item.unit],
      [null, null, "pending_metadata", "추가합격인원수", "명"],
    );
    assert(!JSON.stringify(publicResult).includes("SYNTHETIC-NOT-PUBLIC"));
  }
  equal([searchCalls, lookupCalls, catalogCalls], [2, 0, 0]);
});
