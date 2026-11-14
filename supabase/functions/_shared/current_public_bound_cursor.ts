/** REVIEW ONLY: consume the runtime's already verified descriptor and binding.
 * No new approval registry, issuer, DB/Storage lookup, or network is introduced.
 * The runtime must use its existing cached load() and context.binding() results.
 */
import { AccessError } from "./jungsi/application/access.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import type { ApiExecution } from "./jungsi/application/api_dispatch.ts";
import type { CatalogDataPort } from "./jungsi/application/catalog.ts";
import type { NativeObject } from "./jungsi/domain/json_value.ts";
import { nativeJsonSha256 } from "./jungsi/domain/json_value.ts";
import { utcInstant } from "./jungsi/domain/time.ts";
import type { ApprovedRuntimeBinding } from "./jungsi/infrastructure/runtime_settings.ts";
import {
  CurrentPublicCatalogCursor,
  type CurrentPublicCatalogPort,
  CurrentPublicCatalogService,
  type PublicCatalogCursorBinding,
  type PublicCatalogCursorPort,
  type PublicCatalogKey,
  publicCatalogKey,
  type PublicCatalogPublication,
} from "./current_public_catalog.ts";
import type { PublicCatalogDescriptor } from "./current_public_catalog_sql.ts";

/** Only the already verified, server-owned runtime load can supply these fields. */
export interface ExistingCatalogTrust {
  descriptor: PublicCatalogDescriptor;
  publication: PublicCatalogPublication;
  runtime: Pick<ApprovedRuntimeBinding, "descriptorSha256" | "scopeSha256" | "expiresAtUtc">;
}
const FORMAT = "jungsi.current-public-catalog.cursor/v2";
const HASH = /^[0-9a-f]{64}$/;
const unavailable = (): never => {
  throw new AccessError("security_policy_unavailable", 503);
};
const invalid = (): never => {
  throw new AccessError("invalid_cursor", 400);
};
const mismatch = (): never => {
  throw new AccessError("cursor_version_mismatch", 409);
};

/** Snapshot own data before hashing; a mutable verifier result is not reused across await. */
function snapshot(value: unknown, depth = 0, seen = new Set<object>()): unknown {
  if (depth > 24) return unavailable();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : unavailable();
  if (typeof value !== "object" || seen.has(value)) return unavailable();
  seen.add(value);
  const props = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(value);
  let out: unknown;
  if (Array.isArray(value)) {
    const n = props.length?.value;
    if (!Number.isSafeInteger(n) || n < 0 || n > 256 || names.length !== n + 1) {
      return unavailable();
    }
    const result: unknown[] = [];
    for (let i = 0; i < n; i++) {
      const d = props[String(i)];
      if (!d || !("value" in d) || !d.enumerable) return unavailable();
      result.push(snapshot(d.value, depth + 1, seen));
    }
    out = result;
  } else {
    const proto = Object.getPrototypeOf(value);
    if (
      (proto !== Object.prototype && proto !== null) || names.length > 64 ||
      names.some((n) => typeof n !== "string")
    ) return unavailable();
    const result: Record<string, unknown> = Object.create(null);
    for (const key of names as string[]) {
      const d = props[key];
      if (!d || !("value" in d) || !d.enumerable) return unavailable();
      result[key] = snapshot(d.value, depth + 1, seen);
    }
    out = result;
  }
  seen.delete(value);
  return out;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const x = value as Record<string, unknown>;
  if (Object.keys(x).length !== keys.length || keys.some((key) => !Object.hasOwn(x, key))) {
    return invalid();
  }
  return x;
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}
function decode(token: string): Uint8Array {
  if (!token || token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token) || token.length % 4 === 1) {
    invalid();
  }
  try {
    const bytes = Uint8Array.from(
      atob(token.replace(/-/g, "+").replace(/_/g, "/")),
      (x) => x.charCodeAt(0),
    );
    if (encode(bytes) !== token || bytes.length < 29) invalid();
    return bytes;
  } catch {
    return invalid();
  }
}

/**
 * Scope includes all descriptor fields except version, issued_at and expires_at.
 * The original expiry remains in the authenticated token and is never extended.
 * Runtime scope, approval, source, index, Guide, metadata and
 * all flags remain bound. This is intentionally strict:
 * a repacked index or new receipt may still cause 409 despite equal semantics.
 */
async function stableScope(
  getExisting: () => Promise<ExistingCatalogTrust>,
  binding: PublicCatalogCursorBinding,
  clock: RequestClockPort,
): Promise<string> {
  const trust = await getExisting();
  const d = snapshot(trust.descriptor) as Record<string, unknown>;
  const publication = trust.publication, runtime = trust.runtime;
  if (
    publication.sha256 !== binding.publication || d.version !== publication.version ||
    publication.expiresAtUtc.toString() !== binding.expires ||
    d.consumer_binding_sha256 !== runtime.descriptorSha256 || !HASH.test(runtime.scopeSha256) ||
    typeof runtime.expiresAtUtc !== "bigint" || runtime.expiresAtUtc <= clock.nowUtc() ||
    typeof d.expires_at !== "string" || utcInstant(d.expires_at) !== publication.expiresAtUtc ||
    publication.expiresAtUtc <= clock.nowUtc()
  ) unavailable();
  const copy = { ...d };
  delete copy.version;
  delete copy.issued_at;
  delete copy.expires_at;
  return await nativeJsonSha256({ descriptor: copy, runtime_scope_sha256: runtime.scopeSha256 });
}

/** Request-scoped V2; never share an instance across requests. V1 retains its old checks. */
export class CurrentPublicBoundCursor implements PublicCatalogCursorPort {
  private readonly legacy: CurrentPublicCatalogCursor;
  private readonly key: Promise<CryptoKey>;
  private readonly aad = new TextEncoder().encode(FORMAT);
  private effectiveExpires: bigint | null = null;
  constructor(
    secret: Uint8Array,
    private readonly existing: () => Promise<ExistingCatalogTrust>,
    private readonly clock: RequestClockPort,
  ) {
    this.legacy = new CurrentPublicCatalogCursor(secret);
    this.key = crypto.subtle.importKey(
      "raw",
      new Uint8Array(secret).buffer,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }
  async seal(
    binding: PublicCatalogCursorBinding,
    head: string,
    after: PublicCatalogKey,
  ): Promise<string> {
    if (!HASH.test(head)) unavailable();
    const scope = await stableScope(this.existing, binding, this.clock);
    const expiry = BigInt(binding.expires);
    const effective = this.effectiveExpires !== null && this.effectiveExpires < expiry
      ? this.effectiveExpires
      : expiry;
    if (effective <= this.clock.nowUtc()) invalid();
    const cappedBinding = { ...binding, expires: effective.toString() };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(
      JSON.stringify({
        format: FORMAT,
        binding: cappedBinding,
        scope,
        head,
        after: publicCatalogKey(after),
      }),
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: this.aad },
      await this.key,
      plain,
    );
    const bytes = new Uint8Array(iv.length + encrypted.byteLength);
    bytes.set(iv);
    bytes.set(new Uint8Array(encrypted), iv.length);
    const token = encode(bytes);
    if (token.length > 4096) unavailable();
    return token;
  }
  async open(
    token: string,
    binding: PublicCatalogCursorBinding,
    now: bigint,
  ): Promise<{ head: string; after: PublicCatalogKey }> {
    let legacyError: AccessError;
    try {
      const legacy = await this.legacy.open(token, binding, now);
      this.effectiveExpires = BigInt(binding.expires);
      return legacy;
    } catch (error) {
      if (
        !(error instanceof AccessError) ||
        !["invalid_cursor", "cursor_version_mismatch"].includes(error.code)
      ) throw error;
      legacyError = error;
    }
    let x: Record<string, unknown>;
    try {
      const bytes = decode(token);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: this.aad },
        await this.key,
        bytes.slice(12),
      );
      x = exact(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)), [
        "format",
        "binding",
        "scope",
        "head",
        "after",
      ]);
    } catch {
      throw legacyError;
    }
    const old = exact(x.binding, ["subject", "operation", "query", "publication", "expires"]);
    if (
      x.format !== FORMAT || typeof x.head !== "string" || !HASH.test(x.head) ||
      typeof x.scope !== "string" || !HASH.test(x.scope) ||
      typeof old.expires !== "string" || !/^\d+$/.test(old.expires) || BigInt(old.expires) <= now ||
      old.subject !== binding.subject
    ) invalid();
    if (old.operation !== binding.operation || old.query !== binding.query) mismatch();
    const previousExpires = BigInt(old.expires as string), currentExpires = BigInt(binding.expires);
    if (currentExpires <= now) invalid();
    const expectedScope = await stableScope(this.existing, binding, this.clock);
    if (x.scope !== expectedScope) mismatch();
    this.effectiveExpires = previousExpires < currentExpires ? previousExpires : currentExpires;
    this.assertUnexpired();
    try {
      return { head: x.head as string, after: publicCatalogKey(x.after) };
    } catch {
      return invalid();
    }
  }
  assertUnexpired(): void {
    if (this.effectiveExpires !== null && this.clock.nowUtc() >= this.effectiveExpires) invalid();
  }
}

/** Create a new cursor and pin the already verified publication for one request.
 * Existing runtime authentication, relay, budget and cancellation stay outside this wrapper.
 * Its existing() callback must reuse the runtime load, not perform new IO.
 */
export async function executeWithExistingCatalogTrust(options: {
  request: ApiExecution;
  data: CatalogDataPort;
  current: CurrentPublicCatalogPort;
  clock: RequestClockPort;
  secret: Uint8Array;
  existing: () => Promise<ExistingCatalogTrust>;
}): Promise<NativeObject> {
  if (!["history.search", "offerings.search"].includes(options.request.operation)) {
    throw new AccessError("route_not_found", 404);
  }
  let pinned: PublicCatalogPublication | null = null;
  const current: CurrentPublicCatalogPort = {
    publication: async () => {
      const pub = await options.current.publication();
      const captured = { version: pub.version, sha256: pub.sha256, expiresAtUtc: pub.expiresAtUtc };
      if (
        pinned && (pinned.version !== captured.version || pinned.sha256 !== captured.sha256 ||
          pinned.expiresAtUtc !== captured.expiresAtUtc)
      ) unavailable();
      pinned = Object.freeze(captured);
      return pinned;
    },
    search: (...args) => options.current.search(...args),
    lookup: (...args) => options.current.lookup(...args),
  };
  const cursor = new CurrentPublicBoundCursor(options.secret, options.existing, options.clock);
  const result = await new CurrentPublicCatalogService(options.data, current, options.clock, cursor)
    .execute(options.request);
  cursor.assertUnexpired();
  return result;
}
