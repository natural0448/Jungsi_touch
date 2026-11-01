/**
 * Pure, review-only catalog descriptor preparation.
 *
 * The function body performs no direct database, Storage, environment,
 * network, secret or publication I/O. The injected verifier is caller-owned
 * code; its behavior and any I/O are the caller's responsibility.
 * All pins, bucket and head inputs are caller claims: equal hashes are not
 * issuer authentication or proof of current operational state.
 */
import {
  CurrentPublicMetadataKeyIndex,
  type PublicKeyObjectRead,
  type PublicKeyObjectReference,
  publicKeyRawHash,
} from "./current_public_key_index.ts";
import type { PublicCatalogKey } from "./current_public_catalog.ts";
import { nativeJsonSha256, nativeJsonText } from "./jungsi/domain/json_value.ts";
import { parseNativeJson } from "./jungsi/domain/native_json.ts";
import { utcInstant } from "./jungsi/domain/time.ts";

/** The caller owns verifier wiring and behavior. A port result is not authority. */
export type CatalogDescriptorVerifier = (
  bytes: Uint8Array,
  expectedSha256: string,
  clock: { nowUtc(): bigint },
) => Promise<unknown>;

export interface CatalogDescriptorReviewClaims {
  previousDescriptorSha256: string;
  consumerBindingSha256: string;
  metadataSha256: string;
  guideCommandStateSha256: string;
  admissionHead: { command_id: string; payload_sha256: string };
  coverageReceiptNativeSha256: string;
  projectionNativeSha256: string;
  approvalReferenceSha256: string;
  candidateVersion: string;
  nowUtc: bigint;
  bucket: string;
  expectedBucket: string;
  objectPrefix: string;
  rootReference: PublicKeyObjectReference;
}

export interface CatalogDescriptorReview {
  readonly status: "HOLD_REVIEW_ONLY";
  readonly candidateDescriptorJson: string;
  readonly candidateDescriptorSha256: string;
  readonly previousDescriptorSha256: string;
  readonly proposedRootSha256: string;
  readonly bucket: string;
  readonly objectPrefix: string;
  readonly descriptorVerifierAuthorityVerified: false;
  readonly descriptorRuntimeContractVerified: false;
  readonly independentApprovalVerified: false;
  readonly currentTimeVerified: false;
  readonly consumerBindingVerified: false;
  readonly coverageReceiptVerified: false;
  readonly previousDescriptorCurrentVerified: false;
  readonly bucketAuthorizationVerified: false;
  readonly currentHeadVerified: false;
  readonly remoteStorageVerified: false;
  readonly shardContentsVerified: false;
  readonly expirationExtended: false;
}

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ROOT_BYTES = 524288;
const typedArrayProto = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthGet = Object.getOwnPropertyDescriptor(typedArrayProto, "byteLength")?.get;
const bufferGet = Object.getOwnPropertyDescriptor(typedArrayProto, "buffer")?.get;
const arrayBufferByteLengthGet = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const nativeSet = Uint8Array.prototype.set;
const encoder = new TextEncoder();
const fail = (): never => {
  throw new Error("CATALOG_DESCRIPTOR_REVIEW_REJECTED");
};

function ownData(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return fail();
  const names = Reflect.ownKeys(value);
  if (
    names.length !== keys.length || names.some((x) => typeof x !== "string" || !keys.includes(x))
  ) {
    return fail();
  }
  const desc = Object.getOwnPropertyDescriptors(value);
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = desc[key];
    if (!d || !("value" in d) || d.enumerable !== true) return fail();
    out[key] = d.value;
  }
  return out;
}

function copiedBytes(value: unknown, max: number): Uint8Array {
  if (!(value instanceof Uint8Array) || !byteLengthGet || !bufferGet || !arrayBufferByteLengthGet) {
    return fail();
  }
  const length = Reflect.apply(byteLengthGet, value, []) as number;
  const buffer = Reflect.apply(bufferGet, value, []) as ArrayBufferLike;
  // ArrayBuffer intrinsic checks the actual internal slot, even if a shared
  // buffer has a forged or null prototype. A SharedArrayBuffer always throws.
  Reflect.apply(arrayBufferByteLengthGet, buffer, []);
  if (!Number.isSafeInteger(length) || length < 1 || length > max) return fail();
  const copy = new Uint8Array(length);
  Reflect.apply(nativeSet, copy, [value]);
  return copy;
}

function pin(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) return fail();
  return value;
}

function reference(value: unknown): PublicKeyObjectReference {
  const r = ownData(value, ["object_key", "bytes", "sha256"]);
  if (
    typeof r.object_key !== "string" || !r.object_key ||
    !Number.isSafeInteger(r.bytes) || Number(r.bytes) < 1 ||
    Number(r.bytes) > MAX_ROOT_BYTES
  ) return fail();
  return { object_key: r.object_key, bytes: Number(r.bytes), sha256: pin(r.sha256) };
}

function prefix(value: unknown): string {
  if (typeof value !== "string" || value.length < 2 || value.length > 438 || !value.endsWith("/")) {
    return fail();
  }
  const parts = value.slice(0, -1).split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || !/^[-A-Za-z0-9_.]+$/.test(p))) {
    return fail();
  }
  return value;
}

function bucket(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(value)) return fail();
  return value;
}

function captureClaims(value: unknown): CatalogDescriptorReviewClaims {
  const c = ownData(value, [
    "previousDescriptorSha256",
    "consumerBindingSha256",
    "metadataSha256",
    "guideCommandStateSha256",
    "admissionHead",
    "coverageReceiptNativeSha256",
    "projectionNativeSha256",
    "approvalReferenceSha256",
    "candidateVersion",
    "nowUtc",
    "bucket",
    "expectedBucket",
    "objectPrefix",
    "rootReference",
  ]);
  const h = ownData(c.admissionHead, ["command_id", "payload_sha256"]);
  if (
    typeof h.command_id !== "string" || !ID.test(h.command_id) ||
    typeof c.candidateVersion !== "string" || !ID.test(c.candidateVersion) ||
    typeof c.nowUtc !== "bigint" || c.nowUtc < 0n
  ) return fail();
  const b = bucket(c.bucket), expected = bucket(c.expectedBucket);
  if (b !== expected) return fail();
  const objectPrefix = prefix(c.objectPrefix), rootReference = reference(c.rootReference);
  if (rootReference.object_key !== objectPrefix + "root." + rootReference.sha256 + ".json") {
    return fail();
  }
  return {
    previousDescriptorSha256: pin(c.previousDescriptorSha256),
    consumerBindingSha256: pin(c.consumerBindingSha256),
    metadataSha256: pin(c.metadataSha256),
    guideCommandStateSha256: pin(c.guideCommandStateSha256),
    admissionHead: { command_id: h.command_id, payload_sha256: pin(h.payload_sha256) },
    coverageReceiptNativeSha256: pin(c.coverageReceiptNativeSha256),
    projectionNativeSha256: pin(c.projectionNativeSha256),
    approvalReferenceSha256: pin(c.approvalReferenceSha256),
    candidateVersion: c.candidateVersion,
    nowUtc: c.nowUtc,
    bucket: b,
    expectedBucket: expected,
    objectPrefix,
    rootReference,
  };
}

/**
 * The maximum valid key under 42b7's year <= 2027, 256 UTF-16 code-unit
 * string limit and lexicographic UTF-8 byte comparator.
 * If those contracts change, this root-only technique must be reviewed again.
 */
export function catalogRootReviewEndKey(): PublicCatalogKey {
  const max = String.fromCodePoint(0x10ffff).repeat(128);
  return [2027, max, max, max, max];
}

/** Read only the supplied pinned root bytes; refuse every shard or other object. */
export function makeCatalogRootOnlyMemoryReader(
  suppliedReference: PublicKeyObjectReference,
  suppliedBytes: Uint8Array,
): PublicKeyObjectRead {
  try {
    const expected = reference(suppliedReference);
    const bytes = copiedBytes(suppliedBytes, MAX_ROOT_BYTES);
    if (bytes.length !== expected.bytes) return fail();
    return (request) => {
      try {
        const r = reference(request);
        if (
          r.object_key !== expected.object_key || r.bytes !== expected.bytes ||
          r.sha256 !== expected.sha256
        ) return fail();
        return Promise.resolve(new Uint8Array(bytes));
      } catch {
        return Promise.reject(new Error("CATALOG_DESCRIPTOR_REVIEW_REJECTED"));
      }
    };
  } catch {
    return fail();
  }
}

function ensureRefsInsidePrefix(raw: unknown, objectPrefix: string): void {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const root = raw as Record<string, unknown>;
  if (
    !Array.isArray(root.history) || !Array.isArray(root.offerings) ||
    root.lookups === null || typeof root.lookups !== "object" || Array.isArray(root.lookups)
  ) return fail();
  const validate = (candidate: unknown) => {
    const r = reference(candidate);
    if (
      !r.object_key.startsWith(objectPrefix) ||
      !r.object_key.endsWith("." + r.sha256 + ".json")
    ) return fail();
  };
  for (const shard of [...root.history, ...root.offerings]) {
    if (shard === null || typeof shard !== "object" || Array.isArray(shard)) return fail();
    validate((shard as Record<string, unknown>).reference);
  }
  for (const ref of Object.values(root.lookups as Record<string, unknown>)) validate(ref);
}

const DESCRIPTOR_FIELDS = [
  "format",
  "version",
  "issued_at",
  "expires_at",
  "approval_reference_sha256",
  "consumer_binding_sha256",
  "metadata_sha256",
  "operations",
  "source_views",
  "general_publication_allowed",
  "nationwide_current",
  "active_service_only",
  "incomplete_metadata",
  "order",
  "counts",
  "engine_activation",
  "max_page_rows",
  "guide_command_state",
  "key_index",
  "coverage_receipt_sha256",
  "admission_head",
] as const;

/** Capture only plain own data; reject getters, symbols, holes and cycles. */
function captureVerifierData(value: unknown, depth = 0, seen = new Set<object>()): unknown {
  if (depth > 128) return fail();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : fail();
  if (typeof value !== "object" || seen.has(value)) return fail();
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(value);
  let out: unknown;
  if (Array.isArray(value)) {
    const n = descriptors.length?.value;
    if (!Number.isSafeInteger(n) || n < 0 || n > 16384 || names.length !== n + 1) return fail();
    const array: unknown[] = [];
    for (let i = 0; i < n; i++) {
      const property = descriptors[String(i)];
      if (!property || !("value" in property) || property.enumerable !== true) return fail();
      array.push(captureVerifierData(property.value, depth + 1, seen));
    }
    out = array;
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null || names.some((k) => typeof k !== "string")) {
      return fail();
    }
    const obj: Record<string, unknown> = Object.create(null);
    for (const key of names as string[]) {
      const property = descriptors[key];
      if (!property || !("value" in property) || property.enumerable !== true) return fail();
      obj[key] = captureVerifierData(property.value, depth + 1, seen);
    }
    out = obj;
  }
  seen.delete(value);
  return out;
}

async function verifyBoundDescriptor(
  verifier: CatalogDescriptorVerifier,
  bytes: Uint8Array,
  expectedSha256: string,
  nowUtc: bigint,
): Promise<Record<string, unknown>> {
  // The injected verifier sees a separate copy. It cannot replace our pinned
  // input or supply a descriptor for a different byte sequence.
  if (await publicKeyRawHash(bytes) !== expectedSha256) return fail();
  const parsed = parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const descriptor = ownData(parsed, DESCRIPTOR_FIELDS);
  if (typeof descriptor.issued_at !== "string" || typeof descriptor.expires_at !== "string") {
    return fail();
  }
  const issued = utcInstant(descriptor.issued_at), expires = utcInstant(descriptor.expires_at);
  if (issued > nowUtc || expires <= nowUtc || expires <= issued) return fail();
  const originalText = nativeJsonText(descriptor, true);
  const verifierBytes = new Uint8Array(bytes);
  const clock = Object.freeze(Object.assign(Object.create(null), { nowUtc: () => nowUtc }));
  const received = ownData(await verifier(verifierBytes, expectedSha256, clock), [
    "descriptor",
    "publication",
  ]);
  // Capture the verifier object synchronously before another await.
  const checked = captureVerifierData(received.descriptor);
  const publication = ownData(received.publication, ["version", "sha256", "expiresAtUtc"]);
  if (
    nativeJsonText(checked, true) !== originalText ||
    publication.version !== descriptor.version || publication.sha256 !== expectedSha256 ||
    publication.expiresAtUtc !== expires
  ) return fail();
  if (await publicKeyRawHash(verifierBytes) !== expectedSha256) return fail();
  return descriptor;
}

export async function prepareCatalogDescriptorReview(
  previousDescriptorBytes: Uint8Array,
  candidateRootBytes: Uint8Array,
  suppliedClaims: CatalogDescriptorReviewClaims,
  descriptorVerifier: CatalogDescriptorVerifier,
): Promise<CatalogDescriptorReview> {
  try {
    // Copy every mutable input before the first await.
    const claims = captureClaims(suppliedClaims);
    const previousBytes = copiedBytes(previousDescriptorBytes, 16384);
    const rootBytes = copiedBytes(candidateRootBytes, MAX_ROOT_BYTES);
    if (rootBytes.length !== claims.rootReference.bytes) return fail();
    if (typeof descriptorVerifier !== "function") return fail();
    const old = await verifyBoundDescriptor(
      descriptorVerifier,
      previousBytes,
      claims.previousDescriptorSha256,
      claims.nowUtc,
    );
    if (
      old.format !== "jungsi.current-public-catalog-publication/v2" ||
      typeof old.version !== "string" || !ID.test(old.version) ||
      typeof old.approval_reference_sha256 !== "string" ||
      !HASH.test(old.approval_reference_sha256) ||
      typeof old.coverage_receipt_sha256 !== "string" || !HASH.test(old.coverage_receipt_sha256) ||
      old.consumer_binding_sha256 !== claims.consumerBindingSha256 ||
      old.metadata_sha256 !== claims.metadataSha256 ||
      await nativeJsonSha256(old.guide_command_state) !== claims.guideCommandStateSha256 ||
      old.version === claims.candidateVersion
    ) return fail();
    if (await publicKeyRawHash(rootBytes) !== claims.rootReference.sha256) return fail();
    const rawRoot = parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(rootBytes));
    ensureRefsInsidePrefix(rawRoot, claims.objectPrefix);
    const coverage = (rawRoot as Record<string, unknown>).coverage;
    if (
      coverage === null || typeof coverage !== "object" || Array.isArray(coverage) ||
      (coverage as Record<string, unknown>).snapshot_sha256 !== claims.projectionNativeSha256
    ) return fail();

    const index = new CurrentPublicMetadataKeyIndex({
      requiredFormat: "jungsi.current-public-key-index/v3",
      root: claims.rootReference,
      metadataSha256: claims.metadataSha256,
      guideCommandStateSha256: claims.guideCommandStateSha256,
      admissionHead: claims.admissionHead,
      coverageReceiptSha256: claims.coverageReceiptNativeSha256,
    }, makeCatalogRootOnlyMemoryReader(claims.rootReference, rootBytes));
    // The maximal allowed tuple skips all descriptors after root validation.
    // A changed comparator/key domain may cause a shard request; the memory
    // reader rejects it rather than fetching or accepting it.
    const page = await index.select("history", {
      academic_year: null,
      university_q: "",
      department_q: "",
      region: "",
      group: "",
      limit: 1,
      cursor: null,
    }, catalogRootReviewEndKey());
    if (
      page.keys.length !== 0 || page.nextAfter !== null ||
      page.indexSha256 !== claims.rootReference.sha256 ||
      page.admissionHead.command_id !== claims.admissionHead.command_id ||
      page.admissionHead.payload_sha256 !== claims.admissionHead.payload_sha256 ||
      page.coverage !== "all_eligible_current_db_observations_at_head"
    ) return fail();

    // Inherit the already validated descriptor contract and its time window.
    // The approval pin below is only a supplied claim; it is NOT authenticated.
    const proposed = {
      ...old,
      version: claims.candidateVersion,
      approval_reference_sha256: claims.approvalReferenceSha256,
      key_index: { ...claims.rootReference },
      coverage_receipt_sha256: claims.coverageReceiptNativeSha256,
      admission_head: { ...claims.admissionHead },
    };
    const candidateDescriptorJson = nativeJsonText(proposed, true);
    const candidateDescriptorBytes = encoder.encode(candidateDescriptorJson);
    const candidateDescriptorSha256 = await publicKeyRawHash(candidateDescriptorBytes);
    await verifyBoundDescriptor(
      descriptorVerifier,
      candidateDescriptorBytes,
      candidateDescriptorSha256,
      claims.nowUtc,
    );

    return Object.freeze(Object.assign(Object.create(null), {
      status: "HOLD_REVIEW_ONLY" as const,
      candidateDescriptorJson,
      candidateDescriptorSha256,
      previousDescriptorSha256: claims.previousDescriptorSha256,
      proposedRootSha256: claims.rootReference.sha256,
      bucket: claims.bucket,
      objectPrefix: claims.objectPrefix,
      descriptorVerifierAuthorityVerified: false as const,
      descriptorRuntimeContractVerified: false as const,
      independentApprovalVerified: false as const,
      currentTimeVerified: false as const,
      consumerBindingVerified: false as const,
      coverageReceiptVerified: false as const,
      previousDescriptorCurrentVerified: false as const,
      bucketAuthorizationVerified: false as const,
      currentHeadVerified: false as const,
      remoteStorageVerified: false as const,
      shardContentsVerified: false as const,
      expirationExtended: false as const,
    }));
  } catch {
    return fail();
  }
}
