/** Opaque v2 consumer gate. Trusted pins must come from server-controlled independent approval. */
import { AccessError } from "./access.ts";
import { assertP1R27DeliveryMode } from "./p1_r27_delivery_mode.ts";
import { p1R27DeliveryDigest } from "./p1_r27_delivery_digest.ts";
import {
  bindR27ScopeIndex,
  readR27PartialCoverage,
  type VerifiedR27ScopeIndex,
} from "./history_r27_scope_index.ts";
import { detachedQualificationSnapshot } from "./history_field_qualification.ts";
import type { SnapshotPublication } from "./history_snapshot.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
const HASH = /^[a-f0-9]{64}$/;
function fail(): never {
  throw new AccessError("snapshot_invalid", 503);
}
function exact(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v || typeof v !== "object" || Array.isArray(v) || v instanceof JsonFloat ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  ) fail();
  const names = Reflect.ownKeys(v);
  if (
    names.length !== keys.length || names.some((k) => typeof k !== "string" || !keys.includes(k))
  ) fail();
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(v, key);
    if (!d || !d.enumerable || !("value" in d)) fail();
    out[key] = d.value;
  }
  return out;
}
function digest(v: unknown): string {
  if (typeof v !== "string" || !HASH.test(v)) fail();
  return v;
}
function copy(raw: Uint8Array, max: number): Uint8Array<ArrayBuffer> {
  const getter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;
  if (!(raw instanceof Uint8Array) || !getter) fail();
  const size = Reflect.apply(getter, raw, []) as number;
  if (size < 1 || size > max) fail();
  const out = new Uint8Array(new ArrayBuffer(size));
  Uint8Array.prototype.set.call(out, raw);
  return out;
}
async function sha(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw.buffer))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}
function parsed(raw: Uint8Array<ArrayBuffer>, maxDepth: number): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  let depth = 0, quoted = false, escape = false;
  for (const c of text) {
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") { if (++depth > maxDepth) fail(); }
    else if (c === "}" || c === "]") { if (--depth < 0) fail(); }
  }
  if (quoted || depth !== 0) fail();
  try {
    return parseNativeJson(text);
  } catch {
    return fail();
  }
}
function publicationSnapshot(
  p: SnapshotPublication,
  index: VerifiedR27ScopeIndex,
): SnapshotPublication {
  const names = [
    "snapshotId",
    "publicationSha256",
    "sourceHeadSha256",
    "scopeSha256",
    "generatedAt",
    "sourceAsOf",
    "schemaVersion",
    "normalizationRulesVersion",
    "selectionRulesVersion",
    "expiresAtUtc",
    "counts",
    "full",
    "parts",
  ] as const;
  const raw: Record<string, unknown> = {};
  for (const key of names) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (!d || !("value" in d)) fail();
    raw[key] = d.value;
  }
  const frozen = detachedQualificationSnapshot(raw) as unknown as SnapshotPublication;
  const q = Object.getOwnPropertyDescriptor(p, "fieldQualification"),
    h = Object.getOwnPropertyDescriptor(p, "historicalReferences");
  if (q && !("value" in q) || h && !("value" in h)) fail();
  return Object.freeze({
    ...frozen,
    r27ScopeIndex: index,
    ...(q?.value ? { fieldQualification: q.value } : {}),
    ...(h?.value ? { historicalReferences: h.value } : {}),
  });
}
export interface VerifiedP1R27ConsumerGate {
  readonly kind: "verified_p1_r27_consumer_gate";
}
type GateState = {
  readonly manifestSha256: string;
  readonly sourceHeadSha256: string;
  readonly scopeSha256: string;
  readonly deliverySha256: string;
  readonly scopeIndex: VerifiedR27ScopeIndex;
};
const gates = new WeakMap<VerifiedP1R27ConsumerGate, GateState>();
export interface P1R27ConsumerPins {
  readonly headSha256: string;
  readonly manifestSha256: string;
  readonly sourceHeadSha256: string;
  readonly scopeSha256: string;
  readonly indexSha256: string;
  readonly coverageSha256: string;
  readonly globalReceiptSha256: string;
  readonly consumerReceiptSha256: string;
  readonly consumerBuildSha256: string;
  readonly consumerContractSha256: string;
}
/** Verify all supplied bytes against independent exact pins. This does not authenticate caller-supplied pins. */
export async function bindP1R27ConsumerGate(
  publication: SnapshotPublication,
  indexBytes: Uint8Array,
  globalBytes: Uint8Array,
  consumerBytes: Uint8Array,
  trusted: P1R27ConsumerPins,
  actualHeadSha256: string,
  nowUtc: bigint,
): Promise<VerifiedP1R27ConsumerGate> {
  const names = [
    "headSha256",
    "manifestSha256",
    "sourceHeadSha256",
    "scopeSha256",
    "indexSha256",
    "coverageSha256",
    "globalReceiptSha256",
    "consumerReceiptSha256",
    "consumerBuildSha256",
    "consumerContractSha256",
  ] as const;
  const rawPins = exact(trusted, names),
    pins = Object.freeze(
      Object.fromEntries(names.map((k) => [k, digest(rawPins[k])])),
    ) as unknown as P1R27ConsumerPins;
  if (!publication || typeof publication !== "object" || actualHeadSha256 !== pins.headSha256) {
    fail();
  }
  const p = publicationSnapshot(
    publication,
    Object.freeze({ kind: "verified_r27_scope_index" as const }),
  );
  const idx = copy(indexBytes, 8388608),
    global = copy(globalBytes, 65536),
    consumer = copy(consumerBytes, 65536);
  if (
    !p || p.schemaVersion !== "jungsi.history-snapshot/v2" ||
    p.publicationSha256 !== pins.manifestSha256 || p.sourceHeadSha256 !== pins.sourceHeadSha256 ||
    p.scopeSha256 !== pins.scopeSha256 || typeof nowUtc !== "bigint" || nowUtc < 0n ||
    p.expiresAtUtc <= nowUtc
  ) fail();
  assertP1R27DeliveryMode(p);
  if (
    await sha(idx) !== pins.indexSha256 || await sha(global) !== pins.globalReceiptSha256 ||
    await sha(consumer) !== pins.consumerReceiptSha256
  ) fail();
  const g = exact(parsed(global, 32), [
    "format",
    "status",
    "manifest_sha256",
    "source_head_sha256",
    "scope_sha256",
    "coverage_sha256",
    "index_sha256",
    "delivery_sha256",
    "parts_checked",
    "rows_checked",
  ]);
  const expectedParts = p.parts.length || (p.full ? 1 : 0);
  if (
    g.format !== "jungsi.p1-r27-global-validation/v1" || g.status !== "global_checks_passed" ||
    g.manifest_sha256 !== pins.manifestSha256 ||
    g.source_head_sha256 !== pins.sourceHeadSha256 || g.scope_sha256 !== pins.scopeSha256 ||
    g.coverage_sha256 !== pins.coverageSha256 || g.index_sha256 !== pins.indexSha256 ||
    g.delivery_sha256 !== await p1R27DeliveryDigest(p) || g.parts_checked !== expectedParts ||
    g.rows_checked !== p.counts.rows
  ) fail();
  const scopeIndex = await bindR27ScopeIndex(idx, {
    indexSha256: pins.indexSha256,
    publicationSha256: pins.manifestSha256,
    sourceHeadSha256: pins.sourceHeadSha256,
    scopeSha256: pins.scopeSha256,
    coverageSha256: pins.coverageSha256,
  });
  const partial = readR27PartialCoverage(
    scopeIndex,
    pins.manifestSha256,
    pins.sourceHeadSha256,
    pins.scopeSha256,
  );
  // A consumer that understands v2 scope keys is not necessarily able to disclose
  // a partial scope. Partial delivery requires an independently pinned v2 receipt.
  const c = exact(parsed(consumer, 32), [
    "format",
    "status",
    "manifest_sha256",
    "source_head_sha256",
    "scope_sha256",
    "consumer_build_sha256",
    "consumer_contract_sha256",
    "r27_scope_key_supported",
    ...(partial ? ["r27_partial_coverage_supported"] : []),
    "expires_at_utc_micros",
  ]);
  if (
    c.format !==
      (partial ? "jungsi.p1-r27-consumer-approval/v2" : "jungsi.p1-r27-consumer-approval/v1") ||
    c.status !== "approved" ||
    c.manifest_sha256 !== pins.manifestSha256 || c.source_head_sha256 !== pins.sourceHeadSha256 ||
    c.scope_sha256 !== pins.scopeSha256 ||
    c.consumer_build_sha256 !== pins.consumerBuildSha256 ||
    c.consumer_contract_sha256 !== pins.consumerContractSha256 ||
    c.r27_scope_key_supported !== true ||
    (partial !== null && c.r27_partial_coverage_supported !== true) ||
    typeof c.expires_at_utc_micros !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(c.expires_at_utc_micros) ||
    (BigInt(c.expires_at_utc_micros) <= nowUtc || BigInt(c.expires_at_utc_micros) < p.expiresAtUtc)
  ) fail();
  const gate = Object.freeze({ kind: "verified_p1_r27_consumer_gate" as const });
  gates.set(gate, {
    manifestSha256: pins.manifestSha256,
    sourceHeadSha256: pins.sourceHeadSha256,
    scopeSha256: pins.scopeSha256,
    deliverySha256: String(g.delivery_sha256),
    scopeIndex,
  });
  return gate;
}
/** The publisher-only validation API cannot issue this server-consumer capability. */
export async function assertP1R27ConsumerGate(
  gate: VerifiedP1R27ConsumerGate | undefined,
  publication: SnapshotPublication,
): Promise<VerifiedR27ScopeIndex> {
  const state = gate && gates.get(gate);
  if (!state || !publication || !Object.isFrozen(publication)) fail();
  // Inspect only own data descriptors before touching any caller-supplied field.
  // Detachment rejects accessors and sparse or exotic arrays without running getters.
  const snapshot = publicationSnapshot(publication, state.scopeIndex);
  const counts = Object.getOwnPropertyDescriptor(publication, "counts")?.value;
  const parts = Object.getOwnPropertyDescriptor(publication, "parts")?.value;
  const full = Object.getOwnPropertyDescriptor(publication, "full")?.value;
  if (
    !counts || typeof counts !== "object" || !Object.isFrozen(counts) ||
    !Array.isArray(parts) || !Object.isFrozen(parts) ||
    full !== null && (!full || typeof full !== "object" || !Object.isFrozen(full))
  ) fail();
  for (let i = 0; i < parts.length; i++) {
    const d = Object.getOwnPropertyDescriptor(parts, String(i));
    if (
      !d || !("value" in d) || !d.value || typeof d.value !== "object" ||
      !Object.isFrozen(d.value)
    ) fail();
  }
  if (
    snapshot.schemaVersion !== "jungsi.history-snapshot/v2" ||
    snapshot.publicationSha256 !== state.manifestSha256 ||
    snapshot.sourceHeadSha256 !== state.sourceHeadSha256 ||
    snapshot.scopeSha256 !== state.scopeSha256 ||
    await p1R27DeliveryDigest(snapshot) !== state.deliverySha256
  ) fail();
  return state.scopeIndex;
}
