/** Native Supabase getUser and same-bearer own-row RLS transport. */
import { AccessError } from "../application/access.ts";
import { parseNativeJson } from "../domain/native_json.ts";
import { utcText } from "../domain/time.ts";
import { observeAuthExchange, type SafeExchangeObservation } from "./auth_exchange_observation.ts";
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
/** Bounded transport metadata only; neither rows nor account identifiers are observable. */
export interface SafeProfileLookupObservation {
  readonly outcome: "ok" | "http_status" | "invalid_shape" | "invalid_status" | "request_failed";
  readonly http_status: number | null;
  /** Two means two or more; null means no valid array was read. */
  readonly row_count: 0 | 1 | 2 | null;
  readonly elapsed_ms: number;
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
/** Bound the caller's wait; this does not prove that a noncooperative transport settled. */
async function awaitRequest<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => {});
    throw signal.reason;
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
/** Bound waiting for an error response body to this request's existing abort signal.
 * Abort initiates transport cancellation, but does not prove physical cleanup completed. */
async function cancelResponseBody(response: Response, signal: AbortSignal): Promise<void> {
  if (!response.body) return;
  const cancellation = response.body.cancel();
  if (signal.aborted) {
    void cancellation.catch(() => {});
    return;
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => {
    onAbort = () => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) resolve();
  });
  try {
    await Promise.race([cancellation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
async function boundedJson(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > maximum)) {
    await cancelResponseBody(response, signal);
    throw new Error("response_size");
  }
  if (!response.body) throw new Error("response_body");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await awaitRequest(reader.read(), signal);
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maximum) {
        await awaitRequest(reader.cancel(), signal);
        throw new Error("response_size");
      }
      chunks.push(item.value);
    }
  } finally {
    if (signal.aborted) {
      try {
        void reader.cancel().catch(() => {});
      } catch { /* no authority is returned */ }
    }
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
  constructor(
    config: SupabaseAuthSettings,
    private readonly fetcher: typeof fetch = fetch,
    private readonly observeProfile?: (event: SafeProfileLookupObservation) => void,
    private readonly observeExchange?: (event: SafeExchangeObservation) => void | Promise<void>,
    private readonly requestSignal?: AbortSignal,
  ) {
    const selected = settings(config);
    this.origin = selected.origin;
    this.key = selected.key;
  }
  private request(path: string, token: string, signal: AbortSignal): Promise<Response> {
    const pending = this.fetcher(this.origin + path, {
      method: "GET",
      headers: { Authorization: "Bearer " + token, apikey: this.key },
      redirect: "error",
      signal,
    });
    // A noncooperative fetch may deliver a response after the caller has stopped
    // waiting. Attempt to release its body, without treating that as proof of
    // physical transport settlement or allowing it to grant authentication.
    void pending.then((response) => {
      if (signal.aborted) {
        try {
          void response.body?.cancel().catch(() => {});
        } catch { /* best effort */ }
      }
    }, () => {});
    return pending;
  }
  async verifyExactBearer(token: string, nowUtc: bigint): Promise<NativeSessionReceipt | null> {
    if (
      typeof token !== "string" || !token || token.length > 16384 || /[\s,]/.test(token) ||
      /^sb_(?:publishable|secret)_/.test(token)
    ) return null;
    let user: unknown;
    try {
      user = await observeAuthExchange(
        "auth_lookup",
        async (signal, mark) => {
          const response = await awaitRequest(this.request("/auth/v1/user", token, signal), signal);
          mark(response.status);
          if ([400, 401, 403].includes(response.status)) {
            // A confirmed denial stays a denial when body cleanup fails. The caller's
            // own cancellation is checked by observeAuthExchange before returning.
            try {
              await cancelResponseBody(response, signal);
            } catch { /* denial is final */ }
            return null;
          }
          if (response.status !== 200) {
            await cancelResponseBody(response, signal);
            throw new Error("auth_status");
          }
          return await boundedJson(response, 65536, signal);
        },
        this.observeExchange,
        this.requestSignal,
      );
      if (user === null) return null;
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
      const digest = await bearerSha256(token);
      if (this.requestSignal?.aborted) throw new AccessError("auth_unavailable", 503);
      return Object.freeze({
        verification: "supabase_auth_getUser_exact_bearer",
        bearerSha256: digest,
        subjectId: user.id.toLowerCase(),
        expiresAtUtc: expires,
        assuranceLevel: aal,
      });
    } catch {
      if (this.requestSignal?.aborted) throw new AccessError("auth_unavailable", 503);
      return null;
    }
  }
  async readOwnStatus(token: string, subjectId: string): Promise<OwnProfileReceipt | null> {
    if (
      typeof subjectId !== "string" || !UUID.test(subjectId) || typeof token !== "string" ||
      !token || token.length > 16384 || /[\s,]/.test(token) ||
      /^sb_(?:publishable|secret)_/.test(token)
    ) return null;
    const startedAt = performance.now();
    let outcome: SafeProfileLookupObservation["outcome"] = "request_failed";
    let httpStatus: number | null = null, rowCount: 0 | 1 | 2 | null = null;
    let result: OwnProfileReceipt | null;
    try {
      result = await (async () => {
        try {
          const query = new URLSearchParams({
            select: "role,status",
            id: "eq." + subjectId,
            limit: "1",
          });
          const profileHttpFailure = Symbol();
          const rows = await observeAuthExchange(
            "profile_lookup",
            async (signal, mark) => {
              const response = await awaitRequest(
                this.request("/rest/v1/profiles?" + query, token, signal),
                signal,
              );
              mark(response.status);
              httpStatus = response.status >= 100 && response.status <= 599
                ? response.status
                : null;
              if (response.status !== 200) {
                outcome = "http_status";
                await cancelResponseBody(response, signal);
                return profileHttpFailure;
              }
              return await boundedJson(response, 2048, signal);
            },
            this.observeExchange,
            this.requestSignal,
          );
          if (rows === profileHttpFailure) return null;
          if (Array.isArray(rows)) rowCount = rows.length === 0 ? 0 : rows.length === 1 ? 1 : 2;
          outcome = "invalid_shape";
          if (
            !Array.isArray(rows) || rows.length !== 1 || !object(rows[0]) ||
            Object.keys(rows[0]).some((key) => key !== "role" && key !== "status") ||
            !Object.hasOwn(rows[0], "status")
          ) return null;
          const status = rows[0].status;
          outcome = "invalid_status";
          if (typeof status !== "string" || !status.trim() || status.length > 64) return null;
          const receipt = Object.freeze({
            verification: "own_profile_same_bearer_publishable_RLS",
            bearerSha256: await bearerSha256(token),
            subjectId,
            status,
            role:
              typeof rows[0].role === "string" && rows[0].role.trim() && rows[0].role.length <= 64
                ? rows[0].role
                : null,
          });
          outcome = "ok";
          return receipt;
        } catch {
          return null;
        }
      })();
    } finally {
      try {
        const elapsed = performance.now() - startedAt;
        const pending: unknown = this.observeProfile?.(Object.freeze({
          outcome,
          http_status: httpStatus,
          row_count: rowCount,
          elapsed_ms: Number.isFinite(elapsed)
            ? Math.min(60000, Math.max(0, Math.round(elapsed)))
            : 0,
        }));
        if (pending && typeof (pending as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(pending).catch(() => {});
        }
      } catch { /* Observation never changes authorization. */ }
    }
    if (this.requestSignal?.aborted) throw new AccessError("auth_unavailable", 503);
    return result;
  }
}
