/** Publisher-side whole-part-set check. No I/O or publication authority. */
import { AccessError } from "./access.ts";
import {
  type SnapshotPublication,
  validateQualifiedHistorySnapshotPayloadForPublisher,
} from "./history_snapshot.ts";
import { assertCompleteR27ScopeIndex } from "./history_r27_scope_index.ts";
import { assertP1R27DeliveryMode } from "./p1_r27_delivery_mode.ts";
import { parseNativeJson } from "../domain/native_json.ts";
import type { NativeObject } from "../domain/json_value.ts";

function invalid(): never {
  throw new AccessError("snapshot_invalid", 503);
}
function byteLength(raw: Uint8Array): number {
  const getter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;
  if (!(raw instanceof Uint8Array) || typeof getter !== "function") invalid();
  return Reflect.apply(getter, raw, []) as number;
}
function copyBytes(raw: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(size));
  Uint8Array.prototype.set.call(copy, raw);
  return copy;
}
async function sha(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
}
function parseBounded(raw: Uint8Array<ArrayBuffer>, maxDepth: number): NativeObject {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  let depth = 0, quoted = false, escaped = false;
  for (const c of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") { if (++depth > maxDepth) invalid(); }
    else if (c === "}" || c === "]") { if (--depth < 0) invalid(); }
  }
  if (depth !== 0 || quoted) invalid();
  const body = parseNativeJson(text);
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
  return body as NativeObject;
}
/** The caller must first authenticate the publication, manifest, review and original gzip objects.
 * This function verifies exact decoded bytes and the whole part set; it does not publish.
 */
export async function validateP1PreparedPartsGlobal(
  publication: SnapshotPublication,
  rawBodies: readonly Uint8Array[],
  limits: Readonly<{
    maxParts: number;
    maxRows: number;
    maxDecodedBytes: number;
    maxPartBytes: number;
    maxDepth: number;
  }>,
): Promise<
  {
    readonly status: "HOLD_UNPUBLISHED";
    readonly partsChecked: number;
    readonly rowsChecked: number;
  }
> {
  const names = ["maxParts", "maxRows", "maxDecodedBytes", "maxPartBytes", "maxDepth"] as const;
  if (!limits || typeof limits !== "object" || Reflect.ownKeys(limits).length !== names.length) {
    invalid();
  }
  const values: number[] = [];
  for (const name of names) {
    const d = Object.getOwnPropertyDescriptor(limits, name);
    if (!d || !d.enumerable || !("value" in d) || !Number.isSafeInteger(d.value)) invalid();
    values.push(d.value);
  }
  const [maxParts, maxRows, maxDecodedBytes, maxPartBytes, maxDepth] = values;
  if (
    !publication || publication.schemaVersion !== "jungsi.history-snapshot/v2" ||
    !Array.isArray(publication.parts) || !Array.isArray(rawBodies) ||
    maxParts < 1 || maxParts > 512 || maxRows < 1 || maxRows > 40_000 ||
    maxDecodedBytes < 1 || maxDecodedBytes > 268_435_456 ||
    maxPartBytes < 1 || maxPartBytes > 67_108_864 || maxDepth < 1 || maxDepth > 128
  ) invalid();
  assertP1R27DeliveryMode(publication);
  const parts =
    (publication.parts.length ? publication.parts : publication.full ? [publication.full] : [])
      .map((part) => Object.freeze({ ...part }));
  if (!parts.length || parts.length > maxParts || rawBodies.length !== parts.length) invalid();
  const snapshot = Object.freeze({
    ...publication,
    counts: Object.freeze({ ...publication.counts }),
    full: publication.parts.length ? null : parts[0],
    parts: Object.freeze(publication.parts.length ? parts : []),
  });
  const sizes: number[] = [];
  let totalBytes = 0, declaredRows = 0;
  for (let i = 0; i < parts.length; i++) {
    const size = byteLength(rawBodies[i]);
    if (
      !Number.isSafeInteger(parts[i].decodedBytes) || size !== parts[i].decodedBytes ||
      size < 1 || size > maxPartBytes || !Number.isSafeInteger(parts[i].rows) || parts[i].rows < 0
    ) invalid();
    totalBytes += size;
    declaredRows += parts[i].rows;
    if (totalBytes > maxDecodedBytes || declaredRows > maxRows) invalid();
    sizes.push(size);
  }
  const bodies = rawBodies.map((bytes, index) => copyBytes(bytes, sizes[index]));
  const partIds = new Set<string>(), identities = new Set<string>(), rows: NativeObject[] = [];
  let mapped = 0, pending = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (parts.length > 1 && (part.partId === null || partIds.has(part.partId))) invalid();
    if (part.partId !== null) partIds.add(part.partId);
    if (await sha(bodies[i]) !== part.decodedSha256) invalid();
    const body = await validateQualifiedHistorySnapshotPayloadForPublisher(
      parseBounded(bodies[i], maxDepth),
      part,
      snapshot,
    );
    for (const row of body.rows as NativeObject[]) {
      let identity: string;
      if (row.mapping_status === "mapped") {
        mapped++;
        identity = row.academic_year === 2027
          ? "r27:" + String((row.r27_source as NativeObject).scope_key)
          : "mapped:" + String(row.academic_year) + ":" + String(row.original_pk);
      } else {
        pending++;
        identity = "observation:" + String(row.observation_key);
      }
      if (identities.has(identity)) invalid();
      identities.add(identity);
      rows.push(row);
      if (rows.length > maxRows) invalid();
    }
  }
  if (
    rows.length !== snapshot.counts.rows || mapped !== snapshot.counts.mapped_rows ||
    pending !== snapshot.counts.mapping_pending_rows
  ) invalid();
  await assertCompleteR27ScopeIndex(
    snapshot.r27ScopeIndex,
    snapshot.publicationSha256,
    snapshot.sourceHeadSha256,
    snapshot.scopeSha256,
    rows,
  );
  return { status: "HOLD_UNPUBLISHED", partsChecked: parts.length, rowsChecked: rows.length };
}
