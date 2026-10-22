/** Invented public projection and private part reference. No admission data. */
import {
  HISTORY_SNAPSHOT_SLOTS,
  type SnapshotPart,
  type SnapshotPublication,
} from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { SYNTHETIC_RUNTIME_NOW as NOW } from "./synthetic_runtime_binding.ts";
export function syntheticSnapshotCell(slot: typeof HISTORY_SNAPSHOT_SLOTS[number]): NativeObject {
  const cut = slot.endsWith("percent_cut") || slot === "alternate_cut";
  return {
    value: null,
    unit: null,
    status: "not_published",
    reason_code: "SYNTHETIC-unpublished",
    source_url: null,
    source_as_of: null,
    statistic_label: null,
    cohort: null,
    source_context: null,
    ...(slot === "alternate_cut" ? { entries: [], omitted_other_basis_count: 0 } : {}),
    ...(slot === "recruitment_count_with_stage" ? { stage: "unspecified" } : {}),
    ...(cut
      ? {
        statistic_percent: slot === "final_50_percent_cut"
          ? 50
          : slot === "final_70_percent_cut"
          ? 70
          : 75,
        basis_code: null,
        basis_label: null,
        cohort_code: null,
        cohort_label: null,
        selection_rule_ref: null,
      }
      : {}),
  };
}
export function syntheticSnapshotRow(pending = false): NativeObject {
  return {
    offering_id: pending ? null : "2026:SYNTHETIC-pk",
    academic_year: 2026,
    original_pk: pending ? null : "SYNTHETIC-pk",
    observation_key: pending ? "observation:" + "b".repeat(64) : null,
    mapping_status: pending ? "mapping_pending" : "mapped",
    identity_review: {
      status: pending ? "mapping_pending" : "source_consistent",
      reason_code: pending ? "OFFERING_MAPPING_PENDING" : null,
      variants: [],
    },
    university_id: "SYNTHETIC-university",
    university_name: "SYNTHETIC 학교",
    region: null,
    campus: null,
    department: "SYNTHETIC 모집단위",
    admission_track: "SYNTHETIC 전형",
    group: null,
    ...Object.fromEntries(
      HISTORY_SNAPSHOT_SLOTS.map((slot) => [slot, syntheticSnapshotCell(slot)]),
    ),
  };
}
export function syntheticSnapshotPart(pending = false, partId: string | null = null): SnapshotPart {
  return {
    partId,
    payloadId: "SYNTHETIC-payload",
    gzipBytes: 32,
    gzipSha256: "c".repeat(64),
    decodedBytes: 1024,
    decodedSha256: "d".repeat(64),
    rows: 1,
    mappedRows: pending ? 0 : 1,
    mappingPendingRows: pending ? 1 : 0,
    objectKey: "SYNTHETIC/private/body.json.gz",
  };
}
export function syntheticSnapshotBody(pending = false, partId: string | null = null): NativeObject {
  return {
    format: "jungsi.history-snapshot/v1",
    payload_id: "SYNTHETIC-payload",
    part_id: partId,
    rows: [syntheticSnapshotRow(pending)],
  };
}
export function syntheticSnapshotPublication(
  partsOnly = false,
  pending = false,
): SnapshotPublication {
  return {
    snapshotId: "SYNTHETIC-edition",
    publicationSha256: "e".repeat(64),
    sourceHeadSha256: "f".repeat(64),
    scopeSha256: "a".repeat(64),
    generatedAt: "2026-10-15T00:00:00Z",
    sourceAsOf: "2026-10-14T00:00:00Z",
    schemaVersion: "jungsi.history-snapshot/v1",
    normalizationRulesVersion: "SYNTHETIC-normalization-v1",
    selectionRulesVersion: "SYNTHETIC-selection-v1",
    expiresAtUtc: NOW + 60000000n,
    counts: {
      rows: 1,
      mapped_rows: pending ? 0 : 1,
      mapping_pending_rows: pending ? 1 : 0,
      observations: 1,
      schools: 1,
    },
    full: partsOnly ? null : syntheticSnapshotPart(pending),
    parts: partsOnly ? [syntheticSnapshotPart(pending, "SYNTHETIC-part")] : [],
  };
}

/** Invented mixed publication statistics. This fixture does not classify real source labels. */
export function syntheticSnapshotStatisticsBody(): NativeObject {
  const body = syntheticSnapshotBody(), row = (body.rows as NativeObject[])[0];
  (row.identity_review as NativeObject).variants = [{
    university_name: "SYNTHETIC 학교",
    department: "SYNTHETIC 모집단위",
    admission_track: "SYNTHETIC 전형",
    group: null,
  }];
  const make = (
    percent: number | null,
    label: string | null,
    value: NativeObject[string],
    seed: number,
  ): NativeObject => ({
    ...syntheticSnapshotCell("final_70_percent_cut"),
    value,
    unit: "점",
    status: "verified_official",
    reason_code: null,
    source_url: "https://synthetic.invalid/official-statistics",
    source_as_of: "2026-10-14",
    statistic_label: label,
    statistic_percent: percent,
    cohort: "SYNTHETIC 최종등록자",
    basis_code: "SYNTHETIC-score",
    basis_label: "SYNTHETIC 원문 점수 기준",
    cohort_code: "SYNTHETIC-final",
    cohort_label: "SYNTHETIC 최종등록자",
    selection_rule_ref: "SYNTHETIC-reviewed-statistic-rule",
    source_context: {
      observation_id: "observation:" + seed.toString(16).padStart(64, "0"),
      identity_variant_index: 0,
      scope_status: "source_consistent",
    },
  });
  const entries = [
    make(75, "SYNTHETIC 75% 컷", new JsonFloat("7.500"), 1),
    make(80, "SYNTHETIC 80% 기준", "8.000", 2),
    make(90, "SYNTHETIC 90% 기준", 9, 3),
    make(null, "SYNTHETIC 평균", new JsonFloat("6.500"), 4),
    make(null, "SYNTHETIC 최저", 0, 5),
    make(null, "SYNTHETIC 최고", "0", 6),
    make(null, "SYNTHETIC 중앙값", new JsonFloat("6.00"), 7),
    make(null, "SYNTHETIC 발표 기준", 9007199254740993n, 8),
    {
      ...make(null, null, new JsonFloat("0.00"), 9),
      status: "pending_metadata",
      reason_code: "SYNTHETIC_STATISTIC_METADATA_UNCONFIRMED",
      unit: null,
      source_url: null,
      source_as_of: null,
      cohort: null,
      basis_code: null,
      basis_label: null,
      cohort_code: null,
      cohort_label: null,
      selection_rule_ref: null,
    },
  ];
  const alternate = row.alternate_cut as NativeObject;
  alternate.status = "pending_metadata";
  alternate.reason_code = "SYNTHETIC_MULTIPLE_PUBLISHED_STATISTICS";
  alternate.entries = entries;
  return body;
}
