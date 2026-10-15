/** Server-only runtime configuration. Missing approval never enables data or unlimited budgets. */
import { AccessError } from "../application/access.ts";
import { API_OPERATION_IDS, type ApiOperationId } from "../application/api_dispatch.ts";
import type { UsageStoreLimits } from "../application/usage_budget.ts";
import { nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { utcInstant } from "../domain/time.ts";
import { hasAsciiControl } from "../domain/text.ts";
import type { StorageArtifactLimits } from "./supabase_artifacts.ts";
import { NATIVE_RUNTIME_KINDS, type NativeRuntimeKind } from "./native_source_selection.ts";
import { assertSupabaseProjectBinding } from "./project_binding.ts";
export interface RuntimeEnvironment {
  get(name: string): string | undefined;
}
export interface BasicRuntimeSettings {
  readonly auth: { readonly url: string; readonly publishableKey: string };
  readonly database: { readonly databaseUrl: string; readonly databaseCa: string };
  readonly relayToken: string;
}
export const CONTROL_SOURCE_NAMES = ["head", "registry", "selection", "usage_policy"] as const;
export type ControlSourceName = typeof CONTROL_SOURCE_NAMES[number];
export interface PinnedControlReference {
  readonly objectKey: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface RuntimeReadLimits {
  readonly maxRequests: number;
  readonly maxBytes: number;
}
export interface RuntimeRepositoryLimits {
  readonly maxRecordBytes: number;
  readonly maxForecastRows: number;
  readonly maxBatchIds: number;
}
export interface ApprovedRuntimeBinding {
  readonly descriptorSha256: string;
  readonly projectUrl: string;
  readonly approvalReferenceSha256: string;
  readonly expiresAtUtc: bigint;
  readonly scopeSha256: string;
  readonly operations: readonly ApiOperationId[];
  readonly artifacts: readonly { readonly kind: NativeRuntimeKind; readonly key: string }[];
  readonly references: Readonly<Record<ControlSourceName, PinnedControlReference>>;
  readonly storage: {
    readonly bucket: string;
    readonly objectPrefix: string;
    readonly secretKey: string;
    readonly limits: StorageArtifactLimits;
  };
  readonly readLimits: RuntimeReadLimits;
  readonly repositoryLimits: RuntimeRepositoryLimits;
  readonly usageStoreLimits: UsageStoreLimits;
}
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function required(env: RuntimeEnvironment, name: string): string {
  const value = env.get(name);
  if (typeof value !== "string" || !value || value.trim() !== value) fail();
  return value;
}
function object(value: unknown, keys?: readonly string[]): NativeObject {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    value instanceof JsonFloat
  ) fail();
  const row = value as NativeObject;
  if (
    keys &&
    (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
  ) fail();
  return row;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value || hasAsciiControl(value)) {
    fail();
  }
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail();
  return value;
}
export function runtimeInteger(value: unknown, minimum = 0n): bigint {
  if (!(typeof value === "bigint" || typeof value === "number" && Number.isSafeInteger(value))) {
    fail();
  }
  const integer = BigInt(value);
  if (integer < minimum) fail();
  return integer;
}
function size(value: unknown): number {
  const integer = runtimeInteger(value, 1n);
  if (integer >= BigInt(Number.MAX_SAFE_INTEGER)) fail();
  return Number(integer);
}
function reference(value: unknown): PinnedControlReference {
  const row = object(value, ["object_key", "bytes", "sha256"]), objectKey = text(row.object_key);
  if (
    /[\\%]/.test(objectKey) ||
    objectKey.split("/").some((part) => !part || part === "." || part === "..")
  ) fail();
  try {
    encodeURIComponent(objectKey);
  } catch {
    fail();
  }
  return Object.freeze({ objectKey, bytes: size(row.bytes), sha256: hash(row.sha256) });
}
export function readBasicRuntimeSettings(env: RuntimeEnvironment): BasicRuntimeSettings {
  const url = required(env, "SUPABASE_URL"), databaseUrl = required(env, "DATABASE_URL");
  const databaseCa = env.get("JUNGSI_DATABASE_CA");
  if (typeof databaseCa !== "string" || !databaseCa.trim()) fail();
  // Check PEM framing here; native postgres still verifies the certificate chain and peer.
  const blocks = databaseCa.match(
    /-----BEGIN CERTIFICATE-----[\r\n]+[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g,
  );
  if (
    !blocks?.length ||
    databaseCa.replace(
      /-----BEGIN CERTIFICATE-----[\r\n]+[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g,
      "",
    ).trim()
  ) fail();
  for (const block of blocks) {
    try {
      const body = atob(block.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""));
      if (!body || body.charCodeAt(0) !== 0x30) fail();
    } catch {
      fail();
    }
  }
  assertSupabaseProjectBinding(url, databaseUrl);
  return Object.freeze({
    auth: Object.freeze({ url, publishableKey: required(env, "SUPABASE_PUBLISHABLE_KEY") }),
    database: Object.freeze({ databaseUrl, databaseCa }),
    relayToken: required(env, "JUNGSI_RELAY_TOKEN"),
  });
}
export async function readApprovedRuntimeBinding(
  env: RuntimeEnvironment,
  basic: BasicRuntimeSettings,
  nowUtc: bigint,
): Promise<ApprovedRuntimeBinding> {
  const raw = required(env, "JUNGSI_API_BINDING_JSON"),
    expected = hash(required(env, "JUNGSI_API_BINDING_SHA256"));
  const maximumText = required(env, "JUNGSI_API_BINDING_MAX_BYTES");
  if (!/^[1-9][0-9]*$/.test(maximumText)) fail();
  const maximum = size(BigInt(maximumText)), bytes = new TextEncoder().encode(raw);
  if (bytes.length > maximum) fail();
  const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  if (actual !== expected) fail();
  let row: NativeObject;
  try {
    row = object(parseNativeJson(raw), [
      "format",
      "status",
      "purpose",
      "project_url",
      "approval_reference_sha256",
      "expires_at",
      "worker_plan",
      "scope",
      "sources",
      "limits",
    ]);
  } catch {
    fail();
  }
  if (
    row.format !== "jungsi.edge-api-binding/v1" || row.status !== "approved" ||
    row.purpose !== "jungsi-api-runtime" ||
    row.project_url !== new URL(basic.auth.url).origin || typeof nowUtc !== "bigint"
  ) fail();
  let expiresAtUtc: bigint;
  try {
    expiresAtUtc = utcInstant(text(row.expires_at));
  } catch {
    fail();
  }
  if (expiresAtUtc <= nowUtc) fail();
  const scope = object(row.scope, ["operations", "artifacts"]);
  if (
    !Array.isArray(scope.operations) || !scope.operations.length ||
    !Array.isArray(scope.artifacts) || !scope.artifacts.length
  ) fail();
  const operations = scope.operations.map((value) => {
    if (!API_OPERATION_IDS.includes(value as ApiOperationId)) fail();
    return value as ApiOperationId;
  });
  if (new Set(operations).size !== operations.length) fail();
  const artifacts = scope.artifacts.map((value) => {
    const entry = object(value, ["kind", "key"]);
    if (!NATIVE_RUNTIME_KINDS.includes(entry.kind as NativeRuntimeKind)) fail();
    return Object.freeze({ kind: entry.kind as NativeRuntimeKind, key: text(entry.key) });
  });
  if (new Set(artifacts.map((entry) => JSON.stringify(entry))).size !== artifacts.length) fail();
  const sources = object(row.sources, CONTROL_SOURCE_NAMES);
  const references = Object.fromEntries(
    CONTROL_SOURCE_NAMES.map((name) => [name, reference(sources[name])]),
  ) as unknown as Record<ControlSourceName, PinnedControlReference>;
  const limits = object(row.limits, ["storage", "read", "repositories", "usage_store"]);
  const storage = object(limits.storage, [
    "max_artifact_bytes",
    "max_bucket_bytes",
    "max_metadata_bytes",
    "request_timeout_ms",
  ]);
  const read = object(limits.read, ["max_requests", "max_bytes"]);
  const repositories = object(limits.repositories, [
    "max_record_bytes",
    "max_forecast_rows",
    "max_batch_ids",
  ]);
  const usage = object(limits.usage_store, [
    "lease_seconds",
    "runtime_hard_limit_seconds",
    "clock_margin_seconds",
  ]);
  const worker = row.worker_plan === "free" ? 150n : row.worker_plan === "paid" ? 400n : null;
  const usageStoreLimits = Object.freeze({
    leaseSeconds: runtimeInteger(usage.lease_seconds, 1n),
    runtimeHardLimitSeconds: runtimeInteger(usage.runtime_hard_limit_seconds, 1n),
    clockMarginSeconds: runtimeInteger(usage.clock_margin_seconds),
  });
  if (
    worker === null || usageStoreLimits.runtimeHardLimitSeconds !== worker ||
    usageStoreLimits.leaseSeconds <= worker + usageStoreLimits.clockMarginSeconds
  ) fail();
  const bucket = required(env, "JUNGSI_SUPABASE_STORAGE_BUCKET"),
    objectPrefix = required(env, "JUNGSI_SUPABASE_STORAGE_PREFIX");
  if (
    !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(bucket) || !objectPrefix.endsWith("/") ||
    /[\\%]/.test(objectPrefix) ||
    objectPrefix.slice(0, -1).split("/").some((part) => !part || part === "." || part === "..")
  ) fail();
  if (CONTROL_SOURCE_NAMES.some((name) => !references[name].objectKey.startsWith(objectPrefix))) {
    fail();
  }
  return Object.freeze({
    descriptorSha256: expected,
    projectUrl: new URL(basic.auth.url).origin,
    approvalReferenceSha256: hash(row.approval_reference_sha256),
    expiresAtUtc,
    scopeSha256: await nativeJsonSha256(scope),
    operations: Object.freeze(operations),
    artifacts: Object.freeze(artifacts),
    references: Object.freeze(references),
    storage: Object.freeze({
      bucket,
      objectPrefix,
      secretKey: required(env, "SUPABASE_SECRET_KEY"),
      limits: Object.freeze({
        maxArtifactBytes: size(storage.max_artifact_bytes),
        maxBucketBytes: size(storage.max_bucket_bytes),
        maxMetadataBytes: size(storage.max_metadata_bytes),
        requestTimeoutMs: size(storage.request_timeout_ms),
      }),
    }),
    readLimits: Object.freeze({
      maxRequests: size(read.max_requests),
      maxBytes: size(read.max_bytes),
    }),
    repositoryLimits: Object.freeze({
      maxRecordBytes: size(repositories.max_record_bytes),
      maxForecastRows: size(repositories.max_forecast_rows),
      maxBatchIds: size(repositories.max_batch_ids),
    }),
    usageStoreLimits,
  });
}
