/** Invented observations only. The source record is never rewritten. */
import { assert, equal } from "./fixture.ts";
import {
  publicCatalogHistory,
  publicCatalogOffering,
  publicCatalogOfferingId,
  type PublicCatalogRecord,
} from "../../supabase/functions/_shared/current_public_catalog.ts";
import {
  hasWaitlistSemanticConflict,
  type HistoryAliasScope,
} from "../../supabase/functions/_shared/jungsi/application/history_metric_alias.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

function fixture(kind: string, label: string, unit: string, value = "3"): PublicCatalogRecord {
  const row: NativeObject = {
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
    metric_kind: kind,
    statistic_label: label,
    metric_value_literal: value,
    metric_value_json_type: "integer",
    metric_value_numeric: value,
    source_location: {},
    curation_fields: {
      qualification_status: "verified_official",
      metric_definition: "SYNTHETIC-DEFINITION",
      unit,
      source_url: "https://admission.synthetic.example/notice",
      source_as_of: "2026-10-18",
    },
  };
  return {
    key: [2024, "SYNTHETIC-SCHOOL", "2024:SYNTHETIC-A", kind, "SYNTHETIC-OBS"],
    row,
    guide: null,
  };
}
const scope: HistoryAliasScope = {
  observation_id: "SYNTHETIC-OBS",
  academic_year: 2024,
  offering_id: null,
  cohort: null,
  score_basis: null,
  score_scope: null,
  source_round: null,
  statistic_percent: null,
};

Deno.test("rank kind and explicit count label remain held without changing source", async () => {
  const record = fixture("additional_admission_rank", "추가합격인원수", "명");
  assert(hasWaitlistSemanticConflict("additional_admission_rank", "추가합격인원수", scope));
  const result = await publicCatalogHistory(record);
  equal([result.metric_name, result.value, result.publication_status], [
    null,
    null,
    "pending_metadata",
  ]);
  equal([result.statistic_label, result.unit], ["추가합격인원수", "명"]);
  equal([record.row.metric_kind, record.row.metric_value_literal], [
    "additional_admission_rank",
    "3",
  ]);
});
Deno.test("count kind and explicit final rank label also remain held", async () => {
  const record = fixture("additional_admission_count", "최종충원순위", "번");
  const result = await publicCatalogHistory(record);
  equal([result.metric_name, result.value, result.publication_status], [
    null,
    null,
    "pending_metadata",
  ]);
});
Deno.test("unambiguous rank and count retain original values including zero", async () => {
  const rank = await publicCatalogHistory(
    fixture("additional_admission_rank", "최종충원순위", "번", "0"),
  );
  const count = await publicCatalogHistory(
    fixture("additional_admission_count", "추가합격인원수", "명"),
  );
  equal([rank.metric_name, rank.value, rank.unit, rank.publication_status], [
    "additional_admission_rank",
    0,
    "번",
    "verified_official",
  ]);
  equal([count.metric_name, count.value, count.unit, count.publication_status], [
    "additional_admission_count",
    3,
    "명",
    "verified_official",
  ]);
});
Deno.test("coherent conflicting evidence is held without claiming real approval", async () => {
  const record = fixture("additional_admission_rank", "최종충원순위", "번");
  record.row.offering_pk = "SYNTHETIC-A";
  record.row.offering_id = "2024:SYNTHETIC-A";
  (record.row.curation_fields as NativeObject).metric_alias_evidence = {
    status: "meaning_verified",
    definition_sha256: "a".repeat(64),
    source_label: "최종충원순위",
    family: "additional_admission_count",
    scope: { ...scope, offering_id: "2024:SYNTHETIC-A" } as unknown as NativeObject,
  };
  const result = await publicCatalogHistory(record);
  equal([result.metric_name, result.value, result.publication_status], [
    null,
    null,
    "pending_metadata",
  ]);
});
Deno.test("missing and official unpublished remain distinct under a semantic conflict", async () => {
  const record = fixture("additional_admission_rank", "추가합격인원수", "명");
  record.row.metric_value_literal = null;
  record.row.metric_value_numeric = null;
  record.row.metric_value_json_type = null;
  equal((await publicCatalogHistory(record)).publication_status, "pending_value_missing");
  (record.row.curation_fields as NativeObject).publication_status = "not_published";
  const result = await publicCatalogHistory(record);
  equal([result.metric_name, result.value, result.publication_status], [
    null,
    null,
    "not_published",
  ]);
});
Deno.test("invalid native value stays pending_value_type under a semantic conflict", async () => {
  const record = fixture("additional_admission_rank", "추가합격인원수", "명");
  record.row.metric_value_numeric = "4";
  const result = await publicCatalogHistory(record);
  equal([result.metric_name, result.value, result.publication_status], [
    null,
    null,
    "pending_value_type",
  ]);
});
Deno.test("non-waitlist semantic conflicts are outside this guard", () => {
  equal(hasWaitlistSemanticConflict("separate_recruitment_quota", "최초예비번호", scope), false);
});
Deno.test("ambiguous label is not treated as proof of a different family", () => {
  equal(hasWaitlistSemanticConflict("additional_admission_rank", "충원인원", scope), false);
});

Deno.test("unverified evidence cannot promote or erase an ambiguous raw label", async () => {
  const record = fixture("충원인원", "충원인원", "명");
  (record.row.curation_fields as NativeObject).metric_alias_evidence = {
    status: "meaning_verified",
    definition_sha256: "a".repeat(64),
    source_label: "충원인원",
    family: "final_waitlist_rank",
    scope: scope as unknown as NativeObject,
  };
  const result = await publicCatalogHistory(record);
  equal([result.metric_name, result.statistic_label, result.value], ["충원인원", "충원인원", 3]);
});

Deno.test("strong raw kind and contradictory label are held in either direction", async () => {
  const rankAsRaw = await publicCatalogHistory(fixture("최종충원순위", "추가합격인원수", "명"));
  const countAsRaw = await publicCatalogHistory(fixture("추가합격인원수", "최종충원순위", "번"));
  equal([rankAsRaw.metric_name, rankAsRaw.value, rankAsRaw.publication_status], [
    null,
    null,
    "pending_metadata",
  ]);
  equal([countAsRaw.metric_name, countAsRaw.value, countAsRaw.publication_status], [
    null,
    null,
    "pending_metadata",
  ]);
});

Deno.test("pending or wrong-scope evidence does not erase an existing raw response", async () => {
  for (const status of ["pending", "meaning_verified"]) {
    const record = fixture("additional_admission_rank", "충원인원", "번");
    record.row.offering_pk = "SYNTHETIC-A";
    record.row.offering_id = "2024:SYNTHETIC-A";
    (record.row.curation_fields as NativeObject).metric_alias_evidence = {
      status,
      definition_sha256: "a".repeat(64),
      source_label: "충원인원",
      family: "additional_admission_count",
      scope: {
        ...scope,
        offering_id: status === "pending" ? "2024:SYNTHETIC-A" : "2024:OTHER",
      } as unknown as NativeObject,
    };
    const result = await publicCatalogHistory(record);
    equal([result.metric_name, result.value, result.publication_status], [
      "additional_admission_rank",
      3,
      "verified_official",
    ]);
  }
});
Deno.test("strong raw kind and scope-consistent conflicting evidence are held", async () => {
  const record = fixture("최종충원순위", "충원인원", "번");
  record.row.offering_pk = "SYNTHETIC-A";
  record.row.offering_id = "2024:SYNTHETIC-A";
  (record.row.curation_fields as NativeObject).metric_alias_evidence = {
    status: "meaning_verified",
    definition_sha256: "a".repeat(64),
    source_label: "충원인원",
    family: "additional_admission_count",
    scope: { ...scope, offering_id: "2024:SYNTHETIC-A" } as unknown as NativeObject,
  };
  const result = await publicCatalogHistory(record);
  equal([result.metric_name, result.value, result.publication_status], [
    null,
    null,
    "pending_metadata",
  ]);
});
Deno.test("offering fields are captured together before async identity work", async () => {
  const record = fixture("additional_admission_rank", "추가합격인원수", "명");
  record.guide = { campus: "가상캠퍼스", location: "가상지역", wildcard_group: null };
  const pending = publicCatalogHistory(record);
  record.row.academic_year = 2025;
  record.row.university = "변경된가상대학교";
  record.row.department = "변경된가상모집단위";
  record.guide.campus = "변경된가상캠퍼스";
  const result = await pending;
  equal([result.academic_year, result.university_name, result.department, result.campus], [
    2024,
    "가상대학교",
    "가상모집단위",
    "가상캠퍼스",
  ]);
  equal([result.metric_name, result.value, result.publication_status], [
    null,
    null,
    "pending_metadata",
  ]);
});
Deno.test("offering projection rejects accessor fields without executing them", async () => {
  const record = fixture("additional_admission_rank", "최종충원순위", "번");
  let calls = 0, rejected = false;
  Object.defineProperty(record.row, "university", {
    enumerable: true,
    get() {
      calls++;
      return "SYNTHETIC";
    },
  });
  try {
    await publicCatalogHistory(record);
  } catch {
    rejected = true;
  }
  equal([rejected, calls], [true, 0]);
});

Deno.test("offering id ignores unrelated getters and rejects id getters", async () => {
  const row = fixture("additional_admission_rank", "최종충원순위", "번").row;
  let displayCalls = 0;
  Object.defineProperty(row, "university", {
    enumerable: true,
    get() {
      displayCalls++;
      return "SYNTHETIC";
    },
  });
  equal(await publicCatalogOfferingId(row), "2024:SYNTHETIC-A");
  equal(displayCalls, 0);
  let idCalls = 0, rejected = false;
  Object.defineProperty(row, "academic_year", {
    enumerable: true,
    get() {
      idCalls++;
      return 2024;
    },
  });
  try {
    await publicCatalogOfferingId(row);
  } catch {
    rejected = true;
  }
  equal([rejected, idCalls], [true, 0]);
});

Deno.test("offering snapshot preserves missing versus present id", async () => {
  const row = fixture("additional_admission_rank", "최종충원순위", "번").row;
  row.offering_pk = "SYNTHETIC-A";
  equal(await publicCatalogOfferingId(row), "SYNTHETIC-A");
  row.offering_id = "2024:SYNTHETIC-A";
  equal(await publicCatalogOfferingId(row), "2024:SYNTHETIC-A");
  row.offering_id = null;
  let rejected = false;
  try {
    await publicCatalogOfferingId(row);
  } catch {
    rejected = true;
  }
  assert(rejected);
});

Deno.test("offering projection preserves falsy guide behavior", async () => {
  const row = fixture("additional_admission_rank", "최종충원순위", "번").row;
  const expected = await publicCatalogOffering(row, null);
  for (const guide of [undefined, null, false, 0, ""] as unknown[]) {
    equal(await publicCatalogOffering(row, guide as NativeObject | null), expected);
  }
});
