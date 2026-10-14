/** Native Supabase getUser and same-bearer own-row RLS transport. */
import { AccessError } from "../application/access.ts";
import { parseNativeJson } from "../domain/native_json.ts";
import { utcText } from "../domain/time.ts";
import {
  bearerSha256,
  type NativeSessionReceipt,
  type NativeSessionVerificationPort,
  type OwnProfileReceipt,
  type OwnProfileVerificationPort,
} from "./verified_session.ts";

export interface SupabaseAuthSettings {
  readonly url: string;
  readonly publishableKey: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function jwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) {
    throw new Error("invalid_jwt");
  }
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(payload + "=".repeat((4 - payload.length % 4) % 4));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(decoded, (c) => c.charCodeAt(0)),
  );
  const value = parseNativeJson(text);
  if (!object(value)) throw new Error("invalid_jwt");
  return value;
}
function settings(value: SupabaseAuthSettings): { origin: string; key: string } {
  try {
    const u = new URL(value.url), key = value.publishableKey;
    if (
      u.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname) ||
      u.username || u.password || u.port || u.pathname !== "/" || u.search || u.hash ||
      typeof key !== "string" || !key || key.length > 16384 || /[\s,]/.test(key) ||
      /^sb_secret_/.test(key)
    ) throw new Error();
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      const legacy = jwtPayload(key);
      if (
        legacy.role !== "anon" ||
        Object.hasOwn(legacy, "ref") && legacy.ref !== u.hostname.split(".")[0]
      ) throw new Error();
    }
    return { origin: u.origin, key };
  } catch {
    throw new AccessError("auth_configuration_invalid", 503);
  }
}
async function boundedJson(response: Response, maximum: number): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel();
    throw new Error("response_size");
  }
  if (!response.body) throw new Error("response_body");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new Error("response_size");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export class SupabaseNativeAuth
  implements NativeSessionVerificationPort, OwnProfileVerificationPort {
  private readonly origin: string;
  private readonly key: string;
  constructor(config: SupabaseAuthSettings, private readonly fetcher: typeof fetch = fetch) {
    const selected = settings(config);
    this.origin = selected.origin;
    this.key = selected.key;
  }
  private request(path: string, token: string): Promise<Response> {
    return this.fetcher(this.origin + path, {
      method: "GET",
      headers: { Authorization: "Bearer " + token, apikey: this.key },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  }
  async verifyExactBearer(token: string, nowUtc: bigint): Promise<NativeSessionReceipt | null> {
    if (
      typeof token !== "string" || !token || token.length > 16384 || /[\s,]/.test(token) ||
      /^sb_(?:publishable|secret)_/.test(token)
    ) return null;
    let user: unknown;
    try {
      const response = await this.request("/auth/v1/user", token);
      if ([400, 401, 403].includes(response.status)) {
        await response.body?.cancel();
        return null;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error("auth_status");
      }
      user = await boundedJson(response, 65536);
    } catch {
      throw new AccessError("auth_unavailable", 503);
    }
    // Claims are decoded only after this exact bearer succeeded at getUser.
    try {
      if (!object(user) || typeof user.id !== "string" || !UUID.test(user.id)) return null;
      const claims = jwtPayload(token);
      if (
        typeof claims.sub !== "string" || !UUID.test(claims.sub) ||
        claims.sub.toLowerCase() !== user.id.toLowerCase() ||
        claims.iss !== this.origin + "/auth/v1" ||
        typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) ||
        typeof nowUtc !== "bigint"
      ) return null;
      const expires = BigInt(claims.exp) * 1000000n;
      if (expires <= nowUtc) return null;
      utcText(expires);
      const aal = claims.aal ?? null;
      if (aal !== null && aal !== "aal1" && aal !== "aal2") return null;
      return Object.freeze({
        verification: "supabase_auth_getUser_exact_bearer",
        bearerSha256: await bearerSha256(token),
        subjectId: user.id.toLowerCase(),
        expiresAtUtc: expires,
        assuranceLevel: aal,
      });
    } catch {
      return null;
    }
  }
  async readOwnStatus(token: string, subjectId: string): Promise<OwnProfileReceipt | null> {
    if (
      typeof subjectId !== "string" || !UUID.test(subjectId) || typeof token !== "string" ||
      !token || token.length > 16384 || /[\s,]/.test(token) ||
      /^sb_(?:publishable|secret)_/.test(token)
    ) return null;
    try {
      const query = new URLSearchParams({ select: "status", id: "eq." + subjectId, limit: "1" });
      const response = await this.request("/rest/v1/profiles?" + query, token);
      if (response.status !== 200) {
        await response.body?.cancel();
        return null;
      }
      const rows = await boundedJson(response, 2048);
      if (
        !Array.isArray(rows) || rows.length !== 1 || !object(rows[0]) ||
        Object.keys(rows[0]).length !== 1 || !Object.hasOwn(rows[0], "status")
      ) return null;
      const status = rows[0].status;
      if (typeof status !== "string" || !status.trim() || status.length > 64) return null;
      return Object.freeze({
        verification: "own_profile_same_bearer_publishable_RLS",
        bearerSha256: await bearerSha256(token),
        subjectId,
        status,
      });
    } catch {
      return null;
    }
  }
}
