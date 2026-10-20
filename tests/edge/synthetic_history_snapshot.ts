/** Invented public projection and private part reference. No admission data. */
import {
  HISTORY_SNAPSHOT_SLOTS,
  type SnapshotPart,
  type SnapshotPublication,
} from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
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
