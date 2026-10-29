import { assertP1R27DeliveryMode } from "./p1_r27_delivery_mode.ts";
import type { SnapshotPart, SnapshotPublication } from "./history_snapshot.ts";
import { nativeJsonSha256 } from "../domain/json_value.ts";
const partWire = (p: SnapshotPart) => ({
  part_id: p.partId,
  payload_id: p.payloadId,
  object_key: p.objectKey,
  gzip_bytes: p.gzipBytes,
  gzip_sha256: p.gzipSha256,
  decoded_bytes: p.decodedBytes,
  decoded_sha256: p.decodedSha256,
  rows: p.rows,
  mapped_rows: p.mappedRows,
  mapping_pending_rows: p.mappingPendingRows,
});
export async function p1R27DeliveryDigest(p: SnapshotPublication): Promise<string> {
  assertP1R27DeliveryMode(p);
  return await nativeJsonSha256({
    snapshot_id: p.snapshotId,
    schema_version: p.schemaVersion,
    source_head_sha256: p.sourceHeadSha256,
    scope_sha256: p.scopeSha256,
    generated_at: p.generatedAt,
    source_as_of: p.sourceAsOf,
    normalization_rules_version: p.normalizationRulesVersion,
    selection_rules_version: p.selectionRulesVersion,
    expires_at_utc_micros: String(p.expiresAtUtc),
    counts: p.counts,
    full: p.full ? partWire(p.full) : null,
    parts: p.parts.map(partWire),
  });
}
