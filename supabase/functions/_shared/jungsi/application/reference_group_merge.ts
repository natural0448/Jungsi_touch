/** Immutable old reference rows can be retained alongside separately verified new rows. */
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
function object(v: unknown): v is NativeObject {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function canonical(v: unknown): string {
  return nativeJsonText(v as NativeObject, true);
}
type Entry = { group: string; metadata: string; row: string };
/** Closed identity: distinct university groups and distinct offering IDs; no numeric matching. */
export function referenceGroupIndex(value: unknown): Map<string, Entry> | null {
  if (!Array.isArray(value)) return null;
  const result = new Map<string, Entry>(), groups = new Set<string>();
  try {
    for (const g of value) {
      if (
        !object(g) || typeof g.university_id !== "string" || !g.university_id ||
        groups.has(g.university_id) || !Array.isArray(g.offerings)
      ) return null;
      groups.add(g.university_id);
      const { offerings, ...meta } = g, metadata = canonical(meta);
      for (const row of offerings) {
        if (
          !object(row) || !object(row.offering) || typeof row.offering.offering_id !== "string" ||
          !row.offering.offering_id || result.has(row.offering.offering_id)
        ) return null;
        result.set(row.offering.offering_id, {
          group: g.university_id,
          metadata,
          row: canonical(row),
        });
      }
    }
    return result;
  } catch {
    return null;
  }
}
export function referenceGroupsContain(original: unknown, current: unknown): boolean {
  const a = referenceGroupIndex(original), b = referenceGroupIndex(current);
  if (!a || !b) return false;
  for (const [id, old] of a) {
    const now = b.get(id);
    if (!now || now.group !== old.group || now.metadata !== old.metadata || now.row !== old.row) {
      return false;
    }
  }
  return true;
}
/** Preserve the old exact row when an ID is present in both; do not merge by numeric value. */
export function mergeReferenceGroups(original: unknown, current: unknown): NativeObject[] | null {
  if (
    !Array.isArray(original) || !Array.isArray(current) || !referenceGroupIndex(original) ||
    !referenceGroupIndex(current)
  ) return null;
  const out = cloneNativeJson(current) as NativeObject[];
  try {
    for (const old of original) {
      if (!object(old) || !Array.isArray(old.offerings)) return null;
      const dest = out.find((g) => g.university_id === old.university_id);
      if (!dest) {
        out.push(cloneNativeJson(old));
        continue;
      }
      const { offerings: oldRows, ...oldMeta } = old, { offerings: newRows, ...newMeta } = dest;
      if (!Array.isArray(newRows)) return null;
      // A renamed or otherwise changed university cannot be conflated: keep that
      // university's old confirmed group while retaining unrelated new groups.
      if (canonical(oldMeta) !== canonical(newMeta)) {
        const i = out.indexOf(dest);
        out[i] = cloneNativeJson(old);
        continue;
      }
      for (const row of oldRows) {
        if (!object(row) || !object(row.offering) || typeof row.offering.offering_id !== "string") {
          return null;
        }
        const id = row.offering.offering_id;
        const i = newRows.findIndex((v) =>
          object(v) && object(v.offering) && v.offering.offering_id === id
        );
        if (i < 0) newRows.push(cloneNativeJson(row));
        else newRows[i] = cloneNativeJson(row);
      }
    }
    return referenceGroupsContain(original, out) ? out : null;
  } catch {
    return null;
  }
}
