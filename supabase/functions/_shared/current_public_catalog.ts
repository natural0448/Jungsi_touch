/** Paged current-DB catalog application port. Frozen analysis artifacts remain separate. */
import { AccessError } from "./jungsi/application/access.ts";
import {
  type CatalogDataPort,
  type CatalogRelease,
  CatalogService,
} from "./jungsi/application/catalog.ts";
import type { ApiExecution } from "./jungsi/application/api_dispatch.ts";
import type { UniversityAnalysisDataPort } from "./jungsi/application/university_analysis.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import { sessionDto } from "./jungsi/application/session_service.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  type NativeObject,
} from "./jungsi/domain/json_value.ts";
import { JsonFloat, type NativeJson, parseNativeJson } from "./jungsi/domain/native_json.ts";
import { hasAsciiControl, pythonTrim, unicodeCasefold } from "./jungsi/domain/text.ts";
import { utcText } from "./jungsi/domain/time.ts";
/** Retain the reviewed 5c9 scalar comparison contract without loading an Owner runtime graph. */
function decimal(value: string): string | null {
  const m = value.match(
    /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/,
  );
  if (!m) return null;
  let digits = (m[2] + (m[3] ?? "")).replace(/^0+/, "");
  if (!digits) return "0";
  let exponent = BigInt(m[4] ?? "0") - BigInt((m[3] ?? "").length);
  const tail = digits.match(/0+$/)?.[0].length ?? 0;
  if (tail) {
    digits = digits.slice(0, -tail);
    exponent += BigInt(tail);
  }
  return m[1] + digits + "e" + exponent;
}
function validateCurrentScalar(
  literal: unknown,
  type: unknown,
  numeric: unknown,
): { availability: string; reasons: string[] } {
  if (literal === null || type === null) {
    return { availability: "missing", reasons: ["value_missing"] };
  }
  if (!TEXT(literal) || !TEXT(type) || numeric !== null && !TEXT(numeric)) {
    return { availability: "held", reasons: ["value_type_unqualified"] };
  }
  if (type === "null") {
    return literal === "null" && numeric === null
      ? { availability: "actual_null", reasons: [] }
      : { availability: "held", reasons: ["value_type_mismatch"] };
  }
  if (type === "string") {
    try {
      if (typeof JSON.parse(literal) !== "string") {
        throw new Error("scalar_type_mismatch");
      }
      return { availability: "present", reasons: [] };
    } catch {
      return { availability: "held", reasons: ["value_type_mismatch"] };
    }
  }
  if (["number", "integer", "decimal"].includes(type)) {
    const lhs = decimal(literal), rhs = TEXT(numeric) ? decimal(numeric) : null;
    if (
      lhs === null || rhs === null || lhs !== rhs ||
      type === "integer" && !/^-?(?:0|[1-9][0-9]*)$/.test(literal)
    ) return { availability: "held", reasons: ["value_numeric_mismatch"] };
    return { availability: "present", reasons: [] };
  }
  return { availability: "held", reasons: ["value_type_unqualified"] };
}

export const CURRENT_PUBLIC_OPERATIONS = [
  "history.search",
  "offerings.search",
  "offering.read",
  "recruitment.read",
] as const;
export type PublicCatalogKind = "history" | "offerings";
export type PublicCatalogKey = [number, string, string, string, string];
export interface PublicCatalogQuery {
  academic_year: number | null;
  university_q: string;
  department_q: string;
  region: string;
  group: string;
  limit: number;
  cursor: string | null;
}
export interface PublicCatalogRecord {
  key: PublicCatalogKey;
  row: NativeObject;
  guide: NativeObject | null;
}
export interface PublicCatalogPage {
  version: string;
  head: string;
  asOfUtc: bigint;
  rows: readonly PublicCatalogRecord[];
  nextAfter?: PublicCatalogKey | null;
}
export interface PublicCatalogPublication {
  version: string;
  sha256: string;
  expiresAtUtc: bigint;
}
export interface PublicPreparedKey {
  key: PublicCatalogKey;
  sourceKind: "admission" | "guide";
  guide: NativeObject | null;
  nativeOfferingId: string | null;
  expectedFingerprint: string | null;
}
export interface PublicPreparedKeyPage {
  keys: readonly PublicPreparedKey[];
  nextAfter: PublicCatalogKey | null;
  admissionHead: { command_id: string; payload_sha256: string };
  coverage: "all_eligible_current_db_observations_at_head";
  indexSha256: string;
}
/** A separately approved metadata projection selects keys; every actual value is reread from DB. */
export interface CurrentPublicKeySelectionPort {
  select(
    kind: PublicCatalogKind,
    query: PublicCatalogQuery,
    after: PublicCatalogKey | null,
  ): Promise<PublicPreparedKeyPage>;
  resolve(
    ids: readonly string[],
    recruitment: boolean,
  ): Promise<PublicPreparedKeyPage>;
}
export interface CurrentPublicCatalogPort {
  publication(): Promise<PublicCatalogPublication>;
  search(
    subject: string,
    kind: PublicCatalogKind,
    query: PublicCatalogQuery,
    after: PublicCatalogKey | null,
  ): Promise<PublicCatalogPage>;
  lookup(
    subject: string,
    ids: readonly string[],
    recruitment: boolean,
  ): Promise<PublicCatalogPage>;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const TEXT = (v: unknown): v is string => typeof v === "string" && !hasAsciiControl(v);
const object = (v: unknown): v is NativeObject =>
  v !== null && typeof v === "object" && !Array.isArray(v) &&
  !(v instanceof JsonFloat);
const fail = (code = "current_catalog_unavailable", http = 503): never => {
  throw new AccessError(code, http);
};
function shape(v: unknown, names: readonly string[] = []): NativeObject {
  if (!object(v) || Object.keys(v).some((k) => !names.includes(k))) {
    fail("invalid_request", 422);
  }
  return v as NativeObject;
}
function scalar(v: unknown): v is NativeJson {
  return v === null || typeof v === "string" || typeof v === "boolean" ||
    typeof v === "bigint" || typeof v === "number" && Number.isSafeInteger(v) ||
    v instanceof JsonFloat && Number.isFinite(Number(v.lexeme));
}
function field(row: NativeObject, k: string): string | null {
  return TEXT(row[k]) ? row[k] as string : null;
}
function date(v: unknown): string | null {
  try {
    return typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v) &&
        new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v
      ? v
      : null;
  } catch {
    return null;
  }
}
function publicUrl(v: unknown): string | null {
  if (!TEXT(v)) return null;
  try {
    const u = new URL(v);
    if (
      !["http:", "https:"].includes(u.protocol) || !u.hostname || u.username ||
      u.password ||
      /supabase\.(?:co|in)$|(?:^|\.)drive\.google\.com$|(?:^|\.)docs\.google\.com$|(?:^|\.)storage\.googleapis\.com$|(?:^|\.)amazonaws\.com$|(?:^|\.)r2\.cloudflarestorage\.com$|localhost$|^127\.|^10\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./i
        .test(u.hostname) ||
      [...u.searchParams.keys()].some((k) =>
        /(?:^|[_-])(?:token|signature|authorization|credential|sig)(?:$|[_-])/i
          .test(k) || /^(?:api[_-]?key)$/i.test(k)
      )
    ) return null;
    return v;
  } catch {
    return null;
  }
}
export function parsePublicCatalogQuery(
  query: Readonly<Record<string, string>>,
): PublicCatalogQuery {
  shape(query, [
    "academic_year",
    "university_q",
    "department_q",
    "region",
    "group",
    "limit",
    "cursor",
  ]);
  const q: Record<string, string> = {};
  for (const k of ["university_q", "department_q", "region", "group"]) {
    const v = query[k] ?? "";
    if (!TEXT(v) || v.length > 100) fail("invalid_query", 422);
    q[k] = unicodeCasefold(pythonTrim(v));
  }
  const year = query.academic_year === undefined
    ? null
    : /^\d{4}$/.test(query.academic_year)
    ? Number(query.academic_year)
    : NaN;
  if (year !== null && ![2024, 2025, 2026, 2027].includes(year)) {
    fail("invalid_year", 422);
  }
  const limit = query.limit === undefined
    ? 50
    : /^\d+$/.test(query.limit)
    ? Number(query.limit)
    : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    fail("invalid_limit", 422);
  }
  const cursor = query.cursor ?? null;
  if (
    cursor !== null &&
    (!cursor || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor))
  ) fail("invalid_cursor", 400);
  return {
    academic_year: year,
    university_q: q.university_q,
    department_q: q.department_q,
    region: q.region,
    group: q.group,
    limit,
    cursor,
  };
}
export function comparePublicCatalogKeys(
  a: PublicCatalogKey,
  b: PublicCatalogKey,
): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  for (let i = 1; i < 5; i++) {
    const x = new TextEncoder().encode(a[i] as string),
      y = new TextEncoder().encode(b[i] as string);
    for (let j = 0; j < Math.min(x.length, y.length); j++) {
      if (x[j] !== y[j]) return x[j] < y[j] ? -1 : 1;
    }
    if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  }
  return 0;
}
export function publicCatalogKey(v: unknown): PublicCatalogKey {
  if (
    !Array.isArray(v) || v.length !== 5 || !Number.isSafeInteger(v[0]) ||
    ![2024, 2025, 2026, 2027].includes(v[0]) ||
    !v.slice(1).every((x) => TEXT(x) && x.length <= 256)
  ) fail("current_catalog_page_invalid");
  return [...(v as PublicCatalogKey)];
}
export async function publicCatalogOfferingId(
  row: NativeObject,
): Promise<string> {
  if (
    !Number.isSafeInteger(row.academic_year) ||
    ![2024, 2025, 2026, 2027].includes(row.academic_year as number)
  ) fail("current_catalog_page_invalid");
  const id = String(row.offering_pk ?? "");
  if (Object.hasOwn(row, "offering_id") && TEXT(row.offering_pk) && row.offering_pk) {
    // The bounded DB projection addresses its original (academic_year, offering_pk) tuple.
    // Raw PKs repeat across years; this address never implies a future-year lineage link.
    const address = `${row.academic_year}:${id}`;
    if (
      !TEXT(row.offering_pk) || !row.offering_pk || !ID.test(address) || row.offering_id !== address
    ) {
      fail("current_catalog_page_invalid");
    }
    return address;
  }
  if (TEXT(row.offering_pk) && row.offering_pk && ID.test(id)) return id;
  if (!TEXT(row.canonical_result_id) || !row.canonical_result_id) {
    fail("current_catalog_page_invalid");
  }
  const plain = new TextEncoder().encode(
    "current-public-observation|" + row.academic_year + "|" +
      row.canonical_result_id,
  );
  const observation = "observation:" +
    Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", plain)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
  if (
    Object.hasOwn(row, "offering_id") && row.offering_id !== null && row.offering_id !== observation
  ) {
    fail("current_catalog_page_invalid");
  }
  return observation;
}
export async function publicCatalogOffering(
  row: NativeObject,
  guide: NativeObject | null,
): Promise<NativeObject> {
  return {
    offering_id: await publicCatalogOfferingId(row),
    academic_year: row.academic_year,
    university_id: field(row, "university_code") ?? field(row, "school_id"),
    university_name: field(row, "university"),
    campus: guide ? field(guide, "campus") : null,
    department: field(row, "department"),
    track: field(row, "track"),
    group: field(row, "recruit_group"),
    region: guide ? field(guide, "location") : null,
    wildcard_group: guide ? field(guide, "wildcard_group") : null,
  };
}
export async function publicCatalogHistory(
  record: PublicCatalogRecord,
): Promise<NativeObject> {
  const row = record.row,
    meta = object(row.curation_fields) ? row.curation_fields : {},
    location = object(row.source_location) ? row.source_location : {};
  let value: NativeJson = null, valueHeld = false;
  const raw = ["array", "object"].includes(String(row.metric_value_json_type))
    ? { availability: "held", reasons: ["value_type_unqualified"] }
    : validateCurrentScalar(
      row.metric_value_literal as string | null,
      row.metric_value_json_type as string | null,
      row.metric_value_numeric as string | null,
    );
  if (
    raw.availability === "present" &&
    typeof row.metric_value_literal === "string"
  ) {
    try {
      const parsed = parseNativeJson(row.metric_value_literal);
      if (scalar(parsed)) value = parsed;
      else valueHeld = true;
    } catch {
      valueHeld = true;
    }
  }
  const definition = field(meta, "metric_definition"),
    unit = field(meta, "unit"),
    scale = scalar(meta.original_scale) ? cloneNativeJson(meta.original_scale) : null;
  const url = publicUrl(meta.source_url ?? location.source_url ?? location.url),
    asOf = date(meta.source_as_of ?? location.source_as_of);
  const qualified = meta.qualification_status === "verified_official" &&
    definition !== null && unit !== null && url !== null && asOf !== null &&
    (meta.original_scale === undefined || scalar(meta.original_scale));
  const officialNotPublished = meta.publication_status === "not_published" &&
    meta.qualification_status === "verified_official" && url !== null &&
    asOf !== null;
  const status = raw.availability === "held" || valueHeld
    ? "pending_value_type"
    : raw.availability === "missing"
    ? (officialNotPublished ? "not_published" : "pending_value_missing")
    : qualified
    ? "verified_official"
    : "pending_metadata";
  return {
    ...await publicCatalogOffering(row, record.guide),
    metric_name: field(row, "metric_kind"),
    statistic_label: field(row, "statistic_label"),
    cohort: field(row, "cohort"),
    value_json_type: field(row, "metric_value_json_type"),
    metric_definition: definition,
    value,
    unit,
    original_scale: scale,
    publication_status: status,
    source_url: url,
    source_as_of: asOf,
  };
}
const encode = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_")
    .replace(/=+$/, "");
function decode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) {
    fail("invalid_cursor", 400);
  }
  try {
    const b = Uint8Array.from(
      atob(s.replace(/-/g, "+").replace(/_/g, "/")),
      (x) => x.charCodeAt(0),
    );
    if (encode(b) !== s) fail("invalid_cursor", 400);
    return b;
  } catch {
    return fail("invalid_cursor", 400);
  }
}
export interface PublicCatalogCursorBinding {
  subject: string;
  operation: PublicCatalogKind;
  query: string;
  publication: string;
  expires: string;
}
/** Separate authenticated namespace; no Owner cursor, observation token or source ID is accepted. */
export interface PublicCatalogCursorPort {
  seal(
    binding: PublicCatalogCursorBinding,
    head: string,
    after: PublicCatalogKey,
  ): Promise<string>;
  open(
    token: string,
    binding: PublicCatalogCursorBinding,
    now: bigint,
  ): Promise<{ head: string; after: PublicCatalogKey }>;
}
export class CurrentPublicCatalogCursor implements PublicCatalogCursorPort {
  private readonly key: Promise<CryptoKey>;
  private readonly aad = new TextEncoder().encode(
    "jungsi.current-public-catalog.cursor/v1",
  );
  constructor(secret: Uint8Array) {
    if (secret.length !== 32) fail("security_policy_unavailable");
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
    if (!HASH.test(head)) fail();
    const iv = crypto.getRandomValues(new Uint8Array(12)),
      plain = new TextEncoder().encode(
        JSON.stringify({
          format: "jungsi.current-public-catalog.cursor/v1",
          binding,
          head,
          after: publicCatalogKey(after),
        }),
      );
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: this.aad },
        await this.key,
        plain,
      ),
      body = new Uint8Array(iv.length + encrypted.byteLength);
    body.set(iv);
    body.set(new Uint8Array(encrypted), iv.length);
    const s = encode(body);
    if (s.length > 4096) fail();
    return s;
  }
  async open(
    token: string,
    binding: PublicCatalogCursorBinding,
    now: bigint,
  ): Promise<{ head: string; after: PublicCatalogKey }> {
    try {
      const b = decode(token);
      if (b.length < 29) fail("invalid_cursor", 400);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b.slice(0, 12), additionalData: this.aad },
        await this.key,
        b.slice(12),
      );
      const x = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(plain),
      );
      if (
        !object(x) || Object.keys(x).length !== 4 ||
        x.format !== "jungsi.current-public-catalog.cursor/v1" ||
        !object(x.binding) || Object.keys(x.binding).length !== 5 ||
        !HASH.test(String(x.head)) ||
        !/^\d+$/.test(String(x.binding.expires)) ||
        BigInt(x.binding.expires as string) <= now ||
        x.binding.subject !== binding.subject
      ) fail("invalid_cursor", 400);
      if (
        Object.keys(binding).some((k) =>
          x.binding[k] !== binding[k as keyof PublicCatalogCursorBinding]
        )
      ) fail("cursor_version_mismatch", 409);
      return { head: x.head as string, after: publicCatalogKey(x.after) };
    } catch (e) {
      if (
        e instanceof AccessError &&
        ["invalid_cursor", "cursor_version_mismatch"].includes(e.code)
      ) throw e;
      return fail("invalid_cursor", 400);
    }
  }
}
function integer(v: NativeJson | undefined): v is bigint | number {
  return typeof v === "bigint" ||
    typeof v === "number" && Number.isSafeInteger(v);
}
export function publicCatalogRecruitment(guide: NativeObject): NativeObject {
  const meta = object(guide.metadata) ? guide.metadata : {},
    quota = guide.quota_value,
    stage = field(meta, "quota_stage");
  const count = integer(quota) && BigInt(quota) >= 0n ? quota : null;
  return {
    initial_count: stage === "initial" ? count : null,
    rollover_change: null,
    final_count: stage === "final" ? count : null,
    quota_value: scalar(quota) ? cloneNativeJson(quota) : null,
    quota_literal_state: field(guide, "quota_literal_state"),
    count_status: count === null
      ? "quota_not_numeric"
      : stage === "initial" || stage === "final"
      ? "verified_stage"
      : "quota_stage_unqualified",
    changes: [],
    source_url: publicUrl(meta.source_url),
    source_as_of: date(meta.source_as_of),
    deadline: date(meta.deadline),
    deadline_at: null,
  };
}
/** Four public reads never call getCatalog(); selected analysis alone may reuse its old artifact. */
export class CurrentPublicCatalogService extends CatalogService {
  private selection: { subject: string; ids: readonly string[] } | null = null;
  private readonly currentSelections = new Map<string, NativeObject>();
  private readonly unqualifiedSelections = new Set<string>();
  restrictAnalysisData(data: UniversityAnalysisDataPort): void {
    const conversion = data.getConversion.bind(data),
      analysis = data.getAnalysis.bind(data);
    data.getConversion = async (id) =>
      this.unqualifiedSelections.has(id) ? null : await conversion(id);
    data.getAnalysis = async (id) => this.unqualifiedSelections.has(id) ? null : await analysis(id);
  }
  override offering(release: CatalogRelease, id: unknown): NativeObject {
    if (typeof id === "string" && this.currentSelections.has(id)) {
      return this.currentSelections.get(id)!;
    }
    return super.offering(release, id);
  }
  constructor(
    data: CatalogDataPort,
    private readonly current: CurrentPublicCatalogPort,
    private readonly requestClock: RequestClockPort,
    private readonly cursor: PublicCatalogCursorPort,
  ) {
    super(data, requestClock);
  }
  prepareSelection(request: ApiExecution): void {
    if (
      !["university.analyze", "shortlist.update"].includes(request.operation)
    ) return;
    sessionDto(request.session, this.requestClock.nowUtc());
    if (request.session.tier !== "paid") fail("paid_required", 403);
    if (request.operation === "shortlist.update") {
      const id = request.params.offering_id;
      if (typeof id !== "string" || !ID.test(id)) {
        fail("invalid_identifier", 422);
      }
      this.selection = { subject: request.session.user.subjectId, ids: [id] };
      return;
    }
    const body = shape(request.body, ["expected_version", "offering_ids"]);
    if (
      !Array.isArray(body.offering_ids) || !body.offering_ids.length ||
      body.offering_ids.length > 100 ||
      body.offering_ids.some((x) => typeof x !== "string" || !ID.test(x)) ||
      new Set(body.offering_ids).size !== body.offering_ids.length
    ) fail("invalid_offering_ids", 422);
    this.selection = {
      subject: request.session.user.subjectId,
      ids: body.offering_ids as string[],
    };
  }
  override async catalog(): Promise<CatalogRelease | null> {
    const old = await super.catalog();
    if (!this.selection) return old;
    const missing = this.selection.ids.filter((id) =>
      !(old?.offerings ?? []).some((row) => row.offering_id === id)
    );
    if (!missing.length) return old;
    const page = await this.current.lookup(
        this.selection.subject,
        missing,
        false,
      ),
      pub = await this.live();
    this.page(page, pub, 100);
    const byId = new Map(
      (old?.offerings ?? []).map((row) => [row.offering_id, row]),
    );
    for (const r of page.rows) {
      const row = await publicCatalogOffering(r.row, r.guide),
        id = row.offering_id;
      if (!missing.includes(id as string)) {
        fail("current_catalog_identity_conflict");
      }
      const metadata = r.guide && object(r.guide.metadata) ? r.guide.metadata : {};
      const qualified = metadata.practical_required === false &&
        metadata.participation_conditions_status === "verified";
      const internal = {
        ...row,
        practical_required: qualified ? false : null,
        current_public_qualification: qualified ? "verified" : "pending",
      };
      this.currentSelections.set(id as string, internal);
      if (!qualified) this.unqualifiedSelections.add(id as string);
      byId.set(id, internal);
    }
    return {
      version: "current:" + page.head.slice(0, 40),
      status: "approved",
      asOfUtc: page.asOfUtc,
      offerings: [...byId.values()],
      history: old?.history ?? [],
    };
  }
  private async live(): Promise<PublicCatalogPublication> {
    const pub = await this.current.publication();
    if (
      !ID.test(pub.version) || !HASH.test(pub.sha256) ||
      typeof pub.expiresAtUtc !== "bigint" ||
      this.requestClock.nowUtc() >= pub.expiresAtUtc
    ) fail("current_catalog_publication_unapproved");
    return pub;
  }
  private page(
    page: PublicCatalogPage,
    pub: PublicCatalogPublication,
    max: number,
  ): void {
    if (
      !page || page.version !== pub.version || !HASH.test(page.head) ||
      typeof page.asOfUtc !== "bigint" || !Array.isArray(page.rows) ||
      page.rows.length > max
    ) fail("current_catalog_page_invalid");
    utcText(page.asOfUtc);
    let last: PublicCatalogKey | null = null;
    for (const r of page.rows) {
      const key = publicCatalogKey(r.key);
      if (r.guide?.active_service === false || r.guide?.practical_required === true) {
        fail("current_catalog_page_invalid");
      }
      if (
        !object(r.row) || (typeof r.row.canonical_result_id === "string"
          ? r.row.active_service !== true
          : r.row.active_service === false ||
            r.row.practical_required === true ||
            r.row.source_kind !== "current_guide" &&
              r.row.active_service !== true) ||
        r.row.academic_year !== key[0] ||
        String(r.row.school_id ?? "") !== key[1] ||
        String(r.row.offering_pk ?? "") !== key[2] ||
        String(r.row.metric_kind ?? "") !== key[3] ||
        String(r.row.canonical_result_id ?? r.row.offering_id ?? r.row.release_id ?? "") !==
          key[4] ||
        last && comparePublicCatalogKeys(last, key) >= 0
      ) {
        fail("current_catalog_page_invalid");
      }
      last = key;
    }
  }
  override async execute(request: ApiExecution): Promise<NativeObject> {
    const { operation: op, session } = request;
    sessionDto(session, this.requestClock.nowUtc());
    if (
      !CURRENT_PUBLIC_OPERATIONS.includes(
        op as typeof CURRENT_PUBLIC_OPERATIONS[number],
      )
    ) fail("route_not_found", 404);
    if (
      ["offerings.search", "offering.read"].includes(op) &&
      session.tier !== "paid"
    ) fail("paid_required", 403);
    shape(request.body);
    const pub = await this.live();
    let result: NativeObject;
    if (op === "history.search" || op === "offerings.search") {
      const q = parsePublicCatalogQuery(request.query),
        kind: PublicCatalogKind = op === "history.search" ? "history" : "offerings";
      /** A fresh authenticated same-subject JWT is required per request; its exp is not cursor identity. */
      const expires = pub.expiresAtUtc;
      const query = await nativeJsonSha256([
        q.academic_year,
        q.university_q,
        q.department_q,
        q.region,
        q.group,
      ]);
      const binding: PublicCatalogCursorBinding = {
        subject: session.user.subjectId,
        operation: kind,
        query,
        publication: pub.sha256,
        expires: expires.toString(),
      };
      const saved = q.cursor
        ? await this.cursor.open(q.cursor, binding, this.requestClock.nowUtc())
        : null;
      const page = await this.current.search(
        session.user.subjectId,
        kind,
        q,
        saved?.after ?? null,
      );
      this.page(page, pub, q.limit + 1);
      if (saved && page.head !== saved.head) {
        fail("cursor_version_mismatch", 409);
      }
      const items: NativeJson[] = [], seen = new Set<string>();
      let last = saved?.after ?? null;
      for (const record of page.rows) {
        if (last && comparePublicCatalogKeys(last, record.key) >= 0) {
          fail("current_catalog_page_invalid");
        }
        last = record.key;
        if (
          q.academic_year !== null &&
            record.row.academic_year !== q.academic_year ||
          kind === "history" && record.row.academic_year === 2027
        ) fail("current_catalog_page_invalid");
        const item = kind === "history"
          ? await publicCatalogHistory(record)
          : await publicCatalogOffering(record.row, record.guide);
        for (
          const [filter, fieldName] of [["university_q", "university_name"], [
            "department_q",
            "department",
          ]] as const
        ) {
          if (
            !unicodeCasefold(String(item[fieldName] ?? "")).includes(q[filter])
          ) fail("current_catalog_page_invalid");
        }
        for (const filter of ["region", "group"] as const) {
          if (
            q[filter] &&
            unicodeCasefold(String(item[filter] ?? "")) !== q[filter]
          ) fail("current_catalog_page_invalid");
        }
        if (kind === "offerings") {
          const id = item.offering_id as string;
          if (seen.has(id)) fail("current_catalog_identity_conflict");
          seen.add(id);
        }
        items.push(item);
      }
      const more = page.rows.length > q.limit,
        continuation = more ? page.rows[q.limit - 1].key : page.nextAfter ?? null;
      if (
        !more && continuation &&
        (q.academic_year !== null && continuation[0] !== q.academic_year ||
          last &&
            comparePublicCatalogKeys(last, publicCatalogKey(continuation)) >
              0 ||
          page.rows.length === 0 && saved &&
            comparePublicCatalogKeys(saved.after, continuation) >= 0)
      ) fail("current_catalog_page_invalid");
      const next = continuation ? await this.cursor.seal(binding, page.head, continuation) : null;
      result = {
        status: "ready",
        reason_code: null,
        items: items.slice(0, q.limit),
        matching_offering_count: null,
        matching_school_count: null,
        catalog_version: pub.version,
        as_of: utcText(page.asOfUtc),
        next_cursor: next,
      };
    } else {
      shape(request.query);
      const id = request.params.offering_id;
      if (typeof id !== "string" || !ID.test(id)) {
        fail("invalid_identifier", 422);
      }
      const page = await this.current.lookup(
        session.user.subjectId,
        [id],
        op === "recruitment.read",
      );
      this.page(page, pub, 2);
      if (page.rows.length === 0) fail("offering_not_found", 404);
      if (page.rows.length !== 1) fail("current_catalog_identity_conflict");
      const r = page.rows[0],
        offering = await publicCatalogOffering(r.row, r.guide);
      if (
        offering.offering_id !== id &&
        (op !== "recruitment.read" || r.row.lookup_requested_id !== id ||
          r.guide?.recruitment_link_status !== "verified")
      ) fail("current_catalog_identity_conflict");
      if (op === "offering.read") {
        result = {
          status: "ready",
          reason_code: null,
          offering,
          catalog_version: pub.version,
        };
      } else if (
        r.guide === null || r.guide.recruitment_link_status !== "verified"
      ) {
        result = {
          status: "pending",
          reason_code: "recruitment_link_unqualified",
          offering,
          recruitment: null,
          catalog_version: pub.version,
        };
      } else {
        const recruitment = publicCatalogRecruitment(r.guide),
          ready = recruitment.count_status === "verified_stage";
        result = {
          status: ready ? "ready" : "pending",
          reason_code: ready ? null : "recruitment_quota_unqualified",
          offering,
          recruitment,
          catalog_version: pub.version,
        };
      }
    }
    sessionDto(session, this.requestClock.nowUtc());
    await this.live();
    return result;
  }
}
/** Separate history/recruitment roots retain the original registry and its strict schemas. */
export function currentPublicResponseSchemas(registry: unknown): unknown {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    fail("security_policy_unavailable");
  }
  type Schema = { properties: Record<string, unknown>; required: string[]; enum?: unknown[] };
  type Operation = {
    id: string;
    roots: Record<string, { ref: string; nullable: boolean }>;
  };
  const out = structuredClone(registry) as {
    schemas: Record<string, Schema>;
    operations: Operation[];
  };
  if (
    !out.schemas?.history_metric || !out.schemas.history_search ||
    !out.schemas.recruitment_values || !out.schemas.recruitment ||
    !Array.isArray(out.operations)
  ) fail("security_policy_unavailable");
  const scalarSchema = {
    type: "union",
    nullable: true,
    options: [
      { type: "string", nullable: false },
      { type: "integer", nullable: false },
      { type: "number", nullable: false },
      { type: "boolean", nullable: false },
    ],
  };
  out.schemas.current_public_history_metric = structuredClone(
    out.schemas.history_metric,
  );
  out.schemas.current_public_history_metric.properties.value = scalarSchema;
  for (const k of ["statistic_label", "cohort", "value_json_type"]) {
    out.schemas.current_public_history_metric.properties[k] = {
      type: "string",
      nullable: true,
    };
    out.schemas.current_public_history_metric.required.push(k);
  }
  out.schemas.current_public_history_metric.properties.original_scale = structuredClone(
    scalarSchema,
  );
  out.schemas.current_public_history_search = structuredClone(
    out.schemas.history_search,
  );
  (out.schemas.current_public_history_search.properties.items as {
    items: unknown;
  }).items = { ref: "current_public_history_metric", nullable: false };
  const op = out.operations.find((x) => x.id === "history.search");
  if (!op || !op.roots) return fail("security_policy_unavailable");
  for (const tier of ["standard", "paid"]) {
    if (op.roots[tier]?.ref !== "history_search") {
      fail("security_policy_unavailable");
    }
    op.roots[tier] = {
      ...op.roots[tier],
      ref: "current_public_history_search",
    };
  }
  out.schemas.current_public_recruitment_values = structuredClone(
    out.schemas.recruitment_values,
  );
  out.schemas.current_public_recruitment_values.properties.quota_value = structuredClone(
    scalarSchema,
  );
  out.schemas.current_public_recruitment_values.properties.quota_literal_state = {
    type: "string",
    nullable: true,
  };
  out.schemas.current_public_recruitment_values.required.push(
    "quota_value",
    "quota_literal_state",
  );
  out.schemas.current_public_recruitment = structuredClone(
    out.schemas.recruitment,
  );
  if (!Array.isArray(out.schemas.safe_code?.enum)) return fail("security_policy_unavailable");
  out.schemas.current_public_recruitment_reason = structuredClone(out.schemas.safe_code);
  out.schemas.current_public_recruitment_reason.enum!.push(
    "recruitment_link_unqualified",
    "recruitment_quota_unqualified",
  );
  out.schemas.current_public_recruitment.properties.reason_code = {
    ref: "current_public_recruitment_reason",
    nullable: true,
  };
  out.schemas.current_public_recruitment.properties.recruitment = {
    ref: "current_public_recruitment_values",
    nullable: true,
  };
  const recruitment = out.operations.find((x) => x.id === "recruitment.read");
  if (!recruitment) return fail("security_policy_unavailable");
  for (const tier of ["standard", "paid"]) {
    if (recruitment.roots[tier]?.ref !== "recruitment") {
      fail("security_policy_unavailable");
    }
    recruitment.roots[tier] = {
      ...recruitment.roots[tier],
      ref: "current_public_recruitment",
    };
  }
  return out;
}
