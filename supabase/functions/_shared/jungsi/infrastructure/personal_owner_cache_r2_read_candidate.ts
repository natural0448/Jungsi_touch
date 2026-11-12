/**
 * REVIEW ONLY. Request-scoped personal-owner Cloudflare R2 private-object reader.
 * No bucket, credential, runtime binding, public endpoint, writer or authority is installed.
 * R2 object version binds a read to one upload; it is NOT a cross-DB publication CAS.
 */
import { AccessError } from "../application/access.ts";
import type {
  PersonalOwnerCacheGrant,
  PersonalOwnerCacheHead,
  PersonalOwnerPrivateReadPort,
} from "../application/personal_owner_cache_read_candidate.ts";

/** Minimal structural subset of the native R2 Worker API. */
export interface PrivateR2Metadata {
  readonly key: string;
  readonly version: string;
  readonly size: number;
  readonly customMetadata?: Readonly<Record<string, string>>;
}
export interface PrivateR2Body extends PrivateR2Metadata {
  readonly body: ReadableStream<Uint8Array>;
}
export interface PrivateR2Bucket {
  head(key: string): Promise<PrivateR2Metadata | null>;
  get(key: string): Promise<PrivateR2Body | null>;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEAD_FIELDS = [
  "kind",
  "ownerUuid",
  "profileId",
  "reportId",
  "reportRevision",
  "academicYear",
  "payloadSha256",
  "payloadBytes",
  "coverageSha256",
  "totalRows",
  "pins",
] as const;
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function checkSignal(signal: AbortSignal): void {
  if (!signal || signal.aborted) unavailable();
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
}
function sourceKey(prefix: string, ownerUuid: string, profileId: string, reportId: string): string {
  if (
    !UUID.test(ownerUuid) || typeof profileId !== "string" || !VERSION.test(profileId) ||
    typeof reportId !== "string" || !VERSION.test(reportId)
  ) unavailable();
  // Explicitly namespaced by verified member owner; never treat this UUID as a student ID.
  const key = `${prefix}personal/${ownerUuid}/${profileId}/${reportId}.json`;
  if (new TextEncoder().encode(key).length > 1024) unavailable();
  return key;
}
function cleanPrefix(prefix: string): string {
  if (
    typeof prefix !== "string" || !prefix.endsWith("/") || prefix.length > 256 ||
    prefix.startsWith("/") || containsUnsafeAscii(prefix, "\\%", true) ||
    prefix.slice(0, -1).split("/").some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) unavailable();
  return prefix;
}
function decodeHead(
  obj: PrivateR2Metadata,
  grant: PersonalOwnerCacheGrant,
): PersonalOwnerCacheHead {
  if (
    !obj || typeof obj.version !== "string" || !VERSION.test(obj.version) ||
    !Number.isSafeInteger(obj.size) || obj.size < 1 || obj.size > grant.maxBytes ||
    !obj.customMetadata || typeof obj.customMetadata["cache-head"] !== "string"
  ) unavailable();
  const encoded = obj.customMetadata["cache-head"];
  if (new TextEncoder().encode(encoded).length > 8192) unavailable();
  let raw: unknown;
  try {
    raw = JSON.parse(encoded);
  } catch {
    return unavailable();
  }
  if (
    !object(raw) || Reflect.ownKeys(raw).length !== HEAD_FIELDS.length ||
    Reflect.ownKeys(raw).some((k) =>
      typeof k !== "string" || !HEAD_FIELDS.includes(k as typeof HEAD_FIELDS[number])
    )
  ) unavailable();
  if (
    raw.kind !== "personal_owner" || raw.ownerUuid !== grant.ownerUuid ||
    raw.profileId !== grant.profileId ||
    raw.reportId !== grant.reportId || raw.reportRevision !== grant.reportRevision ||
    raw.academicYear !== 2027 || raw.totalRows !== grant.totalRows || raw.payloadBytes !== obj.size
  ) unavailable();
  // Full field, hash, pins and source coverage checks are performed by the application reader.
  return Object.freeze({ ...raw, version: obj.version }) as unknown as PersonalOwnerCacheHead;
}

/**
 * One instance per authorized request. Never print or return the key or provider error.
 * This implementation does not create, modify or delete any object. A separate durable
 * single-writer/publisher must prove complete file and metadata consistency before activation.
 */
export class PersonalOwnerPrivateR2Reader implements PersonalOwnerPrivateReadPort {
  private readonly prefix: string;
  private selected:
    | Readonly<{ grant: PersonalOwnerCacheGrant; key: string; version: string; size: number }>
    | null = null;
  constructor(private readonly bucket: PrivateR2Bucket, prefix: string) {
    if (!bucket || typeof bucket.head !== "function" || typeof bucket.get !== "function") {
      unavailable();
    }
    this.prefix = cleanPrefix(prefix);
  }
  async head(
    grant: PersonalOwnerCacheGrant,
    signal: AbortSignal,
  ): Promise<PersonalOwnerCacheHead | null> {
    checkSignal(signal);
    this.selected = null;
    try {
      const key = sourceKey(this.prefix, grant.ownerUuid, grant.profileId, grant.reportId);
      const metadata = await this.bucket.head(key);
      checkSignal(signal);
      if (metadata === null) return null;
      if (metadata.key !== key) unavailable();
      const head = decodeHead(metadata, grant);
      this.selected = Object.freeze({ grant, key, version: metadata.version, size: metadata.size });
      return head;
    } catch {
      return unavailable();
    }
  }
  async bytes(
    grant: PersonalOwnerCacheGrant,
    head: PersonalOwnerCacheHead,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    checkSignal(signal);
    const selected = this.selected;
    if (
      !selected || selected.grant !== grant || selected.version !== head.version ||
      selected.size !== head.payloadBytes || selected.size > grant.maxBytes
    ) unavailable();
    try {
      const obj = await this.bucket.get(selected.key);
      if (!obj) unavailable();
      // ETag is not enough: another upload can keep identical bytes but alter metadata.
      if (
        obj.key !== selected.key || obj.version !== selected.version ||
        obj.size !== selected.size ||
        !obj.body || typeof obj.body.getReader !== "function"
      ) {
        try {
          await obj.body?.cancel();
        } catch { /* The outer authority verifies quiescence. */ }
        unavailable();
      }
      const reader = obj.body.getReader();
      const parts: Uint8Array[] = [];
      let total = 0;
      let completed = false;
      let cancellation: Promise<boolean> | null = null;
      const onAbort = () => {
        cancellation ??= reader.cancel().then(() => true, () => false);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (signal.aborted) onAbort();
        for (;;) {
          const part = await reader.read();
          checkSignal(signal);
          if (part.done) {
            completed = true;
            break;
          }
          if (!(part.value instanceof Uint8Array) || part.value.byteLength < 1) unavailable();
          total += part.value.byteLength;
          if (total > selected.size || total > grant.maxBytes) {
            onAbort();
            unavailable();
          }
          parts.push(Uint8Array.from(part.value));
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        if (!completed) onAbort();
        if (cancellation && !await cancellation) unavailable();
        reader.releaseLock();
      }
      checkSignal(signal);
      if (total !== selected.size) unavailable();
      const result = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        result.set(part, offset);
        offset += part.byteLength;
      }
      // The parent service verifies payload SHA, all source pins, coverage and final authority.
      return result;
    } catch {
      return unavailable();
    }
  }
}

/** Reject ASCII controls and the path delimiters relevant to this field. */
function containsUnsafeAscii(value: string, extra: string, rejectSpace = false): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= (rejectSpace ? 0x20 : 0x1f) || code === 0x7f || extra.includes(ch)) return true;
  }
  return false;
}
