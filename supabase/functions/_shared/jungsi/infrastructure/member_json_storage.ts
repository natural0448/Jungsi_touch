/** Immutable private member objects. Publication CAS belongs to the metadata adapter. */
import { AccessError } from "../application/access.ts";
import type { MemberShortlistDocument } from "../application/member_shortlist.ts";
import { validateMemberShortlist } from "../application/member_shortlist.ts";
import { nativeJsonText } from "../domain/json_value.ts";
import { parseNativeJson } from "../domain/native_json.ts";
import { resultObject } from "../application/paid_result_components.ts";
export interface MemberJsonReference {
  readonly object_key: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly revision: number;
}
export interface MemberJsonStorageSettings {
  readonly projectUrl: string;
  readonly bucket: string;
  readonly prefix: string;
  readonly secretKey: string;
  readonly maxBytes: number;
  readonly maxItems: number;
  readonly timeoutMs: number;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail(code = "storage_result_invalid"): never {
  throw new AccessError(code, 503);
}
export async function memberBytesSha(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))].map(
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export class MemberJsonStorage {
  constructor(
    private readonly settings: MemberJsonStorageSettings,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const s = settings;
    let u: URL;
    try {
      u = new URL(s.projectUrl);
    } catch {
      return fail("storage_configuration_invalid");
    }
    if (
      u.protocol !== "https:" || !u.hostname.endsWith(".supabase.co") ||
      u.origin !== s.projectUrl || u.username || u.password ||
      !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(s.bucket) || !s.prefix.endsWith("/") ||
      /[\\%\s]/.test(s.prefix) ||
      s.prefix.slice(0, -1).split("/").some((x) => !x || x === "." || x === "..") ||
      !s.secretKey || /[\r\n]/.test(s.secretKey) ||
      [s.maxBytes, s.maxItems, s.timeoutMs].some((x) => !Number.isSafeInteger(x) || x < 1)
    ) fail("storage_configuration_invalid");
    this.settings = Object.freeze({ ...s });
  }
  private prefix(owner: string, year: number): string {
    if (!UUID.test(owner) || !Number.isSafeInteger(year) || year < 1000 || year > 9999) fail();
    return `${this.settings.prefix}${owner}/${year}/shortlist/`;
  }
  reference(v: unknown, owner: string, year: number): MemberJsonReference {
    if (
      !resultObject(v) || Object.keys(v).sort().join(",") !== "bytes,object_key,revision,sha256"
    ) fail();
    const n = (x: unknown) =>
      typeof x === "bigint" && x <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x;
    const ref = {
      object_key: v.object_key,
      sha256: v.sha256,
      bytes: n(v.bytes),
      revision: n(v.revision),
    };
    if (
      typeof ref.object_key !== "string" || typeof ref.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(ref.sha256) ||
      typeof ref.bytes !== "number" || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 ||
      ref.bytes > this.settings.maxBytes ||
      typeof ref.revision !== "number" || !Number.isSafeInteger(ref.revision) || ref.revision < 1 ||
      ref.object_key !==
        `${this.prefix(owner, year)}${String(ref.revision).padStart(16, "0")}/${ref.sha256}.json`
    ) fail();
    return ref as MemberJsonReference;
  }
  private async request(ref: MemberJsonReference, body?: Uint8Array): Promise<Response> {
    const key = ref.object_key.split("/").map((x) => encodeURIComponent(x)).join("/"),
      write = body !== undefined;
    const url = `${this.settings.projectUrl}/storage/v1/object/${
      write ? "" : "authenticated/"
    }${this.settings.bucket}/${key}`;
    try {
      const r = await this.fetcher(url, {
        method: write ? "POST" : "GET",
        headers: {
          apikey: this.settings.secretKey,
          ...(write
            ? { "Content-Type": "application/json", "x-upsert": "false" }
            : { Accept: "application/octet-stream" }),
          "Cache-Control": "no-store",
        },
        redirect: "error",
        signal: AbortSignal.timeout(this.settings.timeoutMs),
        ...(write ? { body: Uint8Array.from(body) } : {}),
      });
      if (r.redirected || r.url && r.url !== url) fail("storage_unavailable");
      return r;
    } catch {
      fail("storage_unavailable");
    }
  }
  async read(
    owner: string,
    year: number,
    input: MemberJsonReference,
  ): Promise<MemberShortlistDocument> {
    const ref = this.reference(input, owner, year), r = await this.request(ref);
    if (r.status !== 200) {
      await r.body?.cancel();
      fail("storage_unavailable");
    }
    const reader = r.body?.getReader();
    if (!reader) fail();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const x = await reader.read();
        if (x.done) break;
        size += x.value.length;
        if (size > ref.bytes) {
          await reader.cancel();
          fail();
        }
        chunks.push(x.value);
      }
    } catch {
      try {
        await reader.cancel();
      } catch { /* Safe failure only. */ }
      fail("storage_unavailable");
    } finally {
      reader.releaseLock();
    }
    if (size !== ref.bytes) fail();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    if (await memberBytesSha(bytes) !== ref.sha256) fail();
    let d: MemberShortlistDocument;
    try {
      d = parseNativeJson(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown as MemberShortlistDocument;
      // Native integers can exceed JS precision; bounded revision/year are checked before conversion.
      const raw = d as unknown as Record<string, unknown>;
      for (const k of ["revision", "year"]) {
        if (typeof raw[k] === "bigint" && raw[k] <= BigInt(Number.MAX_SAFE_INTEGER)) {
          raw[k] = Number(raw[k]);
        }
      }
      if (
        Object.keys(d).sort().join(",") !==
          "format,items,owner,previous_sha256,revision,updated_at,year" ||
        d.items.some((i) =>
          !i || Object.keys(i).sort().join(",") !== "changed_at,offering_id,selected"
        )
      ) fail();
      validateMemberShortlist(d, owner, year, this.settings.maxItems);
    } catch {
      fail();
    }
    if (d.revision !== ref.revision) fail();
    return d;
  }
  async create(d: MemberShortlistDocument): Promise<MemberJsonReference> {
    validateMemberShortlist(d, d.owner, d.year, this.settings.maxItems);
    const bytes = new TextEncoder().encode(nativeJsonText(d, true));
    if (bytes.length > this.settings.maxBytes) {
      throw new AccessError("shortlist_limit_exceeded", 409);
    }
    const sha256 = await memberBytesSha(bytes),
      ref = this.reference(
        {
          object_key: `${this.prefix(d.owner, d.year)}${
            String(d.revision).padStart(16, "0")
          }/${sha256}.json`,
          sha256,
          bytes: bytes.length,
          revision: d.revision,
        },
        d.owner,
        d.year,
      );
    const r = await this.request(ref, bytes);
    // An uncertain write or 409 is resolved by reading these exact bytes, never by upsert.
    if (![200, 201, 409].includes(r.status)) {
      await r.body?.cancel();
      fail("storage_unavailable");
    }
    await r.body?.cancel();
    await this.read(d.owner, d.year, ref);
    return ref;
  }
}
