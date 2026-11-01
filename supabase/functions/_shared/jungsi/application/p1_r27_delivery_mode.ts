/** v2-only delivery invariant. Does not grant publisher or source authority. */
import { AccessError } from "./access.ts";
import type { SnapshotPublication } from "./history_snapshot.ts";
function field(value: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !d.enumerable || !("value" in d)) throw new AccessError("snapshot_invalid", 503);
  return d.value;
}
export function assertP1R27DeliveryMode(publication: SnapshotPublication): void {
  if (!publication || typeof publication !== "object") {
    throw new AccessError("snapshot_invalid", 503);
  }
  if (field(publication, "schemaVersion") !== "jungsi.history-snapshot/v2") return;
  const parts = field(publication, "parts"), full = field(publication, "full");
  if (
    !Array.isArray(parts) || !(full === null || typeof full === "object" && full !== null) ||
    (full !== null) === (parts.length > 0)
  ) throw new AccessError("snapshot_invalid", 503);
}
