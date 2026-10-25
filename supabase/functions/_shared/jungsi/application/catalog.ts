/** Approved catalog/history/recruitment reads; no local files or synthetic fallback. */
import { AccessError } from "./access.ts";
import type { ApiBusinessPort, ApiExecution } from "./api_dispatch.ts";
import { sessionDto } from "./session_service.ts";
import type { RequestClockPort } from "./ports.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson, parseNativeJson } from "../domain/native_json.ts";
import { calendarDate, utcInstant, utcText } from "../domain/time.ts";
import { pythonTrim, unicodeCasefold, unicodeCompare } from "../domain/text.ts";
export interface CatalogRelease {
  readonly version: string;
  readonly status: string;
  readonly asOfUtc: bigint;
  readonly offerings: readonly NativeObject[];
  readonly history: readonly NativeObject[];
}
export interface CatalogDataPort {
  getCatalog(): Promise<CatalogRelease | null>;
}
export const CATALOG_OPERATIONS = [
  "history.search",
  "recruitment.read",
  "offerings.search",
  "offering.read",
] as const;
export const OFFERING_FIELDS = [
  "offering_id",
  "academic_year",
  "university_id",
  "university_name",
  "campus",
  "department",
  "track",
  "group",
  "region",
  "wildcard_group",
] as const;
const HISTORY_FIELDS = [
  ...OFFERING_FIELDS,
  "metric_name",
  "metric_definition",
  "value",
  "unit",
  "original_scale",
  "publication_status",
  "source_url",
  "source_as_of",
];
const RECRUITMENT_FIELDS = [
  "initial_count",
  "rollover_change",
  "final_count",
  "count_status",
  "changes",
  "source_url",
  "source_as_of",
  "deadline",
  "deadline_at",
];
const CHANGE_FIELDS = [
  "kind",
  "delta",
  "announced_date",
  "announced_at",
  "source_url",
  "status",
  "reason",
  "revision",
];
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function fail(code: string, http = 503): never {
  throw new AccessError(code, http);
}
function object(v: unknown): v is NativeObject {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function integer(v: unknown): v is number | bigint {
  return typeof v === "bigint" || typeof v === "number" && Number.isSafeInteger(v);
}
function shape(v: unknown, optional: readonly string[] = []): NativeObject {
  if (!object(v) || Object.keys(v).some((k) => !optional.includes(k))) fail("invalid_request", 422);
  return v;
}
export function offeringDto(row: NativeObject): NativeObject {
  return publicFields(row, OFFERING_FIELDS);
}
function publicFields(row: NativeObject, fields: readonly string[]): NativeObject {
  return Object.fromEntries(fields.map((k) => [k, cloneNativeJson(row[k] ?? null)]));
}
export function publicSourceUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") fail("public_source_invalid");
  try {
    const u = new URL(value);
    if (
      !["http:", "https:"].includes(u.protocol) || !u.hostname || u.username || u.password ||
      [...u.searchParams.keys()].some((k) =>
        ["token", "access_token", "refresh_token", "authorization", "api_key"].includes(k)
      )
    ) throw new Error();
    return value;
  } catch {
    return fail("public_source_invalid");
  }
}
function date(v: unknown): string {
  try {
    if (typeof v !== "string") throw new Error();
    return calendarDate(v);
  } catch {
    return fail("public_source_invalid");
  }
}
function instant(v: unknown, zone: unknown): string {
  try {
    if (typeof v !== "string") throw new Error();
    return utcText(utcInstant(v, typeof zone === "string" ? zone : undefined));
  } catch {
    return fail("recruitment_changes_invalid");
  }
}
function changes(value: unknown, zone: unknown): NativeJson[] {
  if (!Array.isArray(value)) fail("recruitment_changes_invalid");
  return value.map((row) => {
    if (!object(row)) fail("recruitment_changes_invalid");
    const r = publicFields(row, CHANGE_FIELDS);
    if (Object.values(r).some((v) => v !== null && typeof v !== "string" && !integer(v))) {
      fail("recruitment_changes_invalid");
    }
    if (r.announced_at !== null) r.announced_at = instant(r.announced_at, zone);
    if (r.announced_date !== null) r.announced_date = date(r.announced_date);
    r.source_url = publicSourceUrl(r.source_url);
    return r;
  });
}
/** Python's default JSON spacing and ASCII escapes keep existing cursor signatures valid. */
function pythonJson(value: unknown, sort = true): string {
  const raw = nativeJsonText(value, sort);
  let out = "", quoted = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c.charCodeAt(0) > 127) {
      out += "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
      continue;
    }
    out += c;
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ":") out += " ";
  }
  return out;
}
async function sha(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
}
export class CatalogService implements ApiBusinessPort {
  /** A concrete approved bounded provider must override this; no nationwide fallback. */
  selectedOfferings(
    _owner: string,
    _year: number,
    _ids: readonly string[],
  ): Promise<ReadonlyMap<string, NativeObject>> {
    throw new AccessError("operation_scope_not_approved", 503);
  }
  constructor(private readonly data: CatalogDataPort, private readonly clock: RequestClockPort) {}
  async catalog(): Promise<CatalogRelease | null> {
    let release: CatalogRelease | null;
    try {
      release = await this.data.getCatalog();
    } catch (e) {
      if (e instanceof AccessError) throw e;
      return fail("catalog_unavailable");
    }
    if (release === null) return null;
    if (
      !release || typeof release.version !== "string" || !IDENTIFIER.test(release.version) ||
      typeof release.asOfUtc !== "bigint" || !Array.isArray(release.offerings) ||
      !Array.isArray(release.history)
    ) fail("catalog_release_invalid");
    if (release.status !== "approved") fail("catalog_release_not_approved");
    utcText(release.asOfUtc);
    const ids = new Set<unknown>();
    for (const row of release.offerings) {
      if (
        !object(row) || !Number.isSafeInteger(row.academic_year) ||
        ![2024, 2025, 2026, 2027].includes(row.academic_year as number) ||
        typeof row.practical_required !== "boolean"
      ) fail("catalog_scope_unverified");
      if (
        typeof row.offering_id !== "string" || !IDENTIFIER.test(row.offering_id) ||
        typeof row.university_id !== "string" || !IDENTIFIER.test(row.university_id) ||
        OFFERING_FIELDS.some((k) =>
          k !== "academic_year" && row[k] !== null && row[k] !== undefined &&
          typeof row[k] !== "string"
        )
      ) fail("catalog_field_invalid");
      if (ids.has(row.offering_id)) fail("catalog_identity_conflict");
      ids.add(row.offering_id);
    }
    for (const row of release.history) {
      if (!object(row)) fail("published_metric_invalid");
      if (row.verification_status !== "verified_official") continue;
      if (
        row.value !== null && row.value !== undefined && typeof row.value !== "string" &&
          !integer(row.value) ||
        HISTORY_FIELDS.some((k) =>
          !["academic_year", "value"].includes(k) && row[k] !== null && row[k] !== undefined &&
          typeof row[k] !== "string"
        )
      ) fail("published_metric_invalid");
      publicSourceUrl(row.source_url);
      if (row.source_as_of !== null && row.source_as_of !== undefined) date(row.source_as_of);
    }
    return release;
  }
  serviceRows(release: CatalogRelease): readonly NativeObject[] {
    return release.offerings.filter((r) => r.practical_required === false);
  }
  offering(release: CatalogRelease, id: unknown): NativeObject {
    if (typeof id !== "string" || !IDENTIFIER.test(id)) fail("invalid_identifier", 422);
    const row = this.serviceRows(release).find((r) => r.offering_id === id);
    if (!row) fail("offering_not_found", 404);
    return row;
  }
  async execute(request: ApiExecution): Promise<NativeObject> {
    const { operation: op, session, body, query, params } = request;
    if (!CATALOG_OPERATIONS.includes(op as typeof CATALOG_OPERATIONS[number])) {
      fail("route_not_found", 404);
    }
    sessionDto(session, this.clock.nowUtc());
    if (["offerings.search", "offering.read"].includes(op) && session.tier !== "paid") {
      fail("paid_required", 403);
    }
    shape(body);
    let result: NativeObject;
    if (op === "history.search" || op === "offerings.search") result = await this.search(op, query);
    else {
      shape(query);
      const release = await this.catalog();
      if (release === null) {
        result = { status: "pending", reason_code: "catalog_release_missing", offering: null };
      } else {
        const row = this.offering(release, params.offering_id);
        if (op === "offering.read") {
          result = {
            status: "ready",
            reason_code: null,
            offering: offeringDto(row),
            catalog_version: release.version,
          };
        } else if (!object(row.recruitment)) {
          result = {
            status: "pending",
            reason_code: "recruitment_not_published",
            offering: offeringDto(row),
            recruitment: null,
          };
        } else {
          const r = publicFields(row.recruitment, RECRUITMENT_FIELDS),
            zone = row.recruitment.source_timezone;
          r.changes = changes(row.recruitment.changes ?? [], zone);
          r.source_url = publicSourceUrl(r.source_url);
          if (r.source_as_of !== null) r.source_as_of = date(r.source_as_of);
          for (const field of ["initial_count", "rollover_change", "final_count"]) {
            if (r[field] !== null && !integer(r[field])) fail("recruitment_count_invalid");
          }
          if (r.deadline !== null) r.deadline = date(r.deadline);
          if (r.deadline_at !== null) r.deadline_at = instant(r.deadline_at, zone);
          result = {
            status: "ready",
            reason_code: null,
            offering: offeringDto(row),
            recruitment: r,
            catalog_version: release.version,
          };
        }
      }
    }
    sessionDto(session, this.clock.nowUtc());
    return result;
  }
  private async search(op: string, query: Readonly<Record<string, string>>): Promise<NativeObject> {
    shape(query, [
      "academic_year",
      "university_q",
      "department_q",
      "region",
      "group",
      "cursor",
      "limit",
    ]);
    const clean: Record<string, string> = {};
    for (const field of ["university_q", "department_q", "region", "group"]) {
      const value = query[field] ?? "";
      if (typeof value !== "string" || [...value].length > 100) fail("invalid_query", 422);
      clean[field] = pythonTrim(unicodeCasefold(value));
    }
    let year: number | null = null;
    if (query.academic_year !== undefined) {
      if (!/^[0-9]+$/.test(query.academic_year)) fail("invalid_year", 422);
      year = Number(query.academic_year);
      if (![2024, 2025, 2026, 2027].includes(year)) fail("invalid_year", 422);
    }
    const limit = query.limit === undefined
      ? 50
      : /^[0-9]+$/.test(query.limit)
      ? Number(query.limit)
      : NaN;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("invalid_limit", 422);
    const release = await this.catalog();
    if (release === null) {
      return {
        status: "pending",
        reason_code: "catalog_release_missing",
        items: null,
        matching_offering_count: null,
        matching_school_count: null,
        next_cursor: null,
        catalog_version: null,
      };
    }
    let rows = [...this.serviceRows(release)];
    if (op === "history.search") {
      const ids = new Set(rows.map((r) => r.offering_id));
      rows = release.history.filter((r) =>
        ids.has(r.offering_id) && r.verification_status === "verified_official"
      );
    }
    const str = (v: NativeJson | undefined) => typeof v === "string" ? v : "";
    rows = rows.filter((r) =>
      (year === null || r.academic_year === year) &&
      unicodeCasefold(str(r.university_name) + " " + str(r.campus)).includes(clean.university_q) &&
      unicodeCasefold(str(r.department)).includes(clean.department_q) &&
      (!clean.region || clean.region === unicodeCasefold(str(r.region))) &&
      (!clean.group || clean.group === unicodeCasefold(str(r.group)))
    );
    rows.sort((a, b) =>
      (a.academic_year as number) - (b.academic_year as number) ||
      unicodeCompare(str(a.university_id), str(b.university_id)) ||
      unicodeCompare(str(a.offering_id), str(b.offering_id)) ||
      unicodeCompare(str(a.metric_name), str(b.metric_name))
    );
    const signature = (await sha(pythonJson([op, clean, year]))).slice(0, 16);
    let start = 0;
    if (query.cursor) {
      try {
        if (typeof query.cursor !== "string" || query.cursor.length > 2048) throw new Error();
        const decoded = parseNativeJson(
          atob(query.cursor.replaceAll("-", "+").replaceAll("_", "/")),
        );
        if (!Array.isArray(decoded) || decoded.length !== 3) throw new Error();
        const [version, index, hash] = decoded;
        if (version !== release.version || hash !== signature) fail("cursor_version_mismatch", 409);
        if (
          typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 ||
          index > rows.length
        ) throw new Error();
        start = index;
      } catch (e) {
        if (e instanceof AccessError) throw e;
        fail("invalid_cursor", 422);
      }
    }
    const end = start + limit,
      cursor = end < rows.length
        ? btoa(pythonJson([release.version, end, signature], false)).replaceAll("+", "-")
          .replaceAll("/", "_")
        : null;
    return {
      status: "ready",
      reason_code: null,
      items: rows.slice(start, end).map((r) =>
        publicFields(r, op === "history.search" ? HISTORY_FIELDS : OFFERING_FIELDS)
      ),
      matching_offering_count: new Set(rows.map((r) => r.offering_id)).size,
      matching_school_count: new Set(rows.map((r) => r.university_id)).size,
      catalog_version: release.version,
      as_of: utcText(release.asOfUtc),
      next_cursor: cursor,
    };
  }
}
