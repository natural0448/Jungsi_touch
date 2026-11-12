/** REVIEW ONLY. Independent internal service, not a route, writer, DB adapter or authorization.
 * Existing CurrentPublicCatalogPort and public projection functions are injected/reused.
 * The server must supply a separately authenticated guard that binds the real request,
 * admission, exact key scope, approved publication and current head. */
import { AccessError } from "./jungsi/application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./jungsi/application/api_dispatch.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import { sessionDto } from "./jungsi/application/session_service.ts";
import type { NativeObject } from "./jungsi/domain/json_value.ts";
import { JsonFloat, type NativeJson } from "./jungsi/domain/native_json.ts";
import { utcText } from "./jungsi/domain/time.ts";
import {
  comparePublicCatalogKeys,
  type CurrentPublicCatalogPort,
  type PublicCatalogKey,
  publicCatalogKey,
  publicCatalogOffering,
  type PublicCatalogPage,
  type PublicCatalogPublication,
  type PublicCatalogRecord,
  publicCatalogRecruitment,
} from "./current_public_catalog.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const fail = (code = "current_catalog_unavailable", http = 503): never => {
  throw new AccessError(code, http);
};
const object = (v: unknown): v is NativeObject =>
  v !== null && typeof v === "object" && !Array.isArray(v) &&
  !(v instanceof JsonFloat);
function scalar(v: unknown): v is NativeJson {
  return v === null || typeof v === "string" || typeof v === "boolean" ||
    typeof v === "bigint" || typeof v === "number" && Number.isSafeInteger(v) ||
    v instanceof JsonFloat && Number.isFinite(Number(v.lexeme));
}
const OFFERING_ROW_FIELDS = [
  "academic_year",
  "offering_pk",
  "offering_id",
  "canonical_result_id",
  "university_code",
  "school_id",
  "university",
  "department",
  "track",
  "recruit_group",
] as const;
const OFFERING_GUIDE_FIELDS = ["campus", "location", "wildcard_group"] as const;
function snapshotOfferingFields(
  input: NativeObject,
  names: readonly string[],
): NativeObject {
  const copy: NativeObject = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor) continue;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      fail("current_catalog_page_invalid");
    }
    copy[name] = descriptor!.value as NativeJson;
  }
  return Object.freeze(copy);
}
/** REVIEW ONLY: server composition must inject this trust port; HTTP input never supplies it.
 * The real implementation must authenticate the request and admission, authorize exactly these
 * keys and derive the returned publication/head binding independently from approved descriptors.
 * Neither this type nor a synthetic port is proof of deployed trust or physical I/O controls. */
export interface Own2027SelectionTrust {
  bind(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    scope: readonly Own2027SelectionKey[],
    publication: PublicCatalogPublication,
  ): Promise<unknown>;
}
export type Own2027SelectionKey = Readonly<
  { academic_year: 2027; school_id: string; offering_pk: string }
>;
export type Own2027NativeQuota =
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "present"; value: NativeJson }>;
export type Own2027SelectionItem = Readonly<{
  academic_year: 2027;
  school_id: string;
  offering_pk: string;
  offering_id: string;
  status: "HOLD";
  reasons: readonly string[];
  offering: NativeObject | null;
  recruitment: NativeObject | null;
  quota_native: Own2027NativeQuota;
  quota_literal_native: Own2027NativeQuota;
  quota_stage_native: Own2027NativeQuota;
}>;
function own2027Record(
  raw: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail("current_catalog_page_invalid");
  }
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) {
    fail("current_catalog_page_invalid");
  }
  const keys = Reflect.ownKeys(raw as object);
  if (
    keys.length !== fields.length ||
    keys.some((k) => typeof k !== "string" || !fields.includes(k))
  ) {
    fail("current_catalog_page_invalid");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, k);
    if (!d || !d.enumerable || !("value" in d)) {
      fail("current_catalog_page_invalid");
    }
    Object.defineProperty(result, k, {
      value: d!.value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(result);
}
function own2027Array(raw: unknown, max: number): unknown[] {
  if (!Array.isArray(raw)) fail("current_catalog_page_invalid");
  const length = Object.getOwnPropertyDescriptor(raw, "length"),
    keys = Reflect.ownKeys(raw as object);
  if (
    !length || !("value" in length) || !Number.isSafeInteger(length.value) ||
    length.value < 0 || length.value > max || keys.length !== length.value + 1
  ) {
    fail("current_catalog_page_invalid");
  }
  const out: unknown[] = [];
  for (let i = 0; i < length!.value; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!d || !d.enumerable || !("value" in d)) {
      fail("current_catalog_page_invalid");
    }
    out.push(d!.value);
  }
  return out;
}
function own2027Input(raw: unknown): readonly Own2027SelectionKey[] {
  const items = own2027Array(raw, 100);
  if (!items.length) fail("current_catalog_page_invalid");
  const out: Own2027SelectionKey[] = [], ids = new Set<string>();
  for (const item of items) {
    const k = own2027Record(item, [
      "academic_year",
      "school_id",
      "offering_pk",
    ]);
    if (
      k.academic_year !== 2027 || typeof k.school_id !== "string" ||
      !ID.test(k.school_id) ||
      typeof k.offering_pk !== "string" || !ID.test(k.offering_pk) ||
      !ID.test("2027:" + k.offering_pk) || ids.has("2027:" + k.offering_pk)
    ) {
      fail("current_catalog_page_invalid");
    }
    ids.add("2027:" + k.offering_pk);
    out.push(
      Object.freeze({
        academic_year: 2027,
        school_id: k.school_id as string,
        offering_pk: k.offering_pk as string,
      }),
    );
  }
  return Object.freeze(out);
}
function own2027Publication(
  raw: unknown,
  now: bigint,
): PublicCatalogPublication {
  const p = own2027Record(raw, ["version", "sha256", "expiresAtUtc"]);
  if (
    typeof p.version !== "string" || !ID.test(p.version) ||
    typeof p.sha256 !== "string" ||
    !HASH.test(p.sha256) || typeof p.expiresAtUtc !== "bigint" ||
    now >= p.expiresAtUtc
  ) {
    fail("current_catalog_publication_unapproved");
  }
  return Object.freeze({
    version: p.version as string,
    sha256: p.sha256 as string,
    expiresAtUtc: p.expiresAtUtc as bigint,
  });
}
function own2027Binding(
  raw: unknown,
  pub: PublicCatalogPublication,
): Readonly<
  { subject_id: string; publication_sha256: string; head_sha256: string }
> {
  const b = own2027Record(raw, [
    "subject_id",
    "publication_sha256",
    "head_sha256",
  ]);
  if (
    typeof b.subject_id !== "string" || !ID.test(b.subject_id) ||
    b.publication_sha256 !== pub.sha256 || typeof b.head_sha256 !== "string" ||
    !HASH.test(b.head_sha256)
  ) {
    fail("current_catalog_publication_unapproved");
  }
  return Object.freeze({
    subject_id: b.subject_id as string,
    publication_sha256: b.publication_sha256 as string,
    head_sha256: b.head_sha256 as string,
  });
}
function own2027Selected(
  raw: unknown,
  fields: readonly string[],
): NativeObject {
  if (!object(raw)) fail("current_catalog_page_invalid");
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) {
    fail("current_catalog_page_invalid");
  }
  return snapshotOfferingFields(raw as NativeObject, fields);
}
function own2027NativeField(
  raw: NativeObject | null,
  name: string,
): Own2027NativeQuota {
  if (!raw || !Object.hasOwn(raw, name)) {
    return Object.freeze({ state: "absent" });
  }
  const d = Object.getOwnPropertyDescriptor(raw, name);
  if (!d || !d.enumerable || !("value" in d)) {
    fail("current_catalog_page_invalid");
  }
  let value: unknown = d!.value;
  if (value instanceof JsonFloat) {
    const lexeme = Object.getOwnPropertyDescriptor(value, "lexeme");
    if (
      !lexeme || !lexeme.enumerable || !("value" in lexeme) ||
      typeof lexeme.value !== "string" ||
      !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(
        lexeme.value,
      ) ||
      !Number.isFinite(Number(lexeme.value))
    ) fail("current_catalog_page_invalid");
    value = new JsonFloat(lexeme!.value);
  }
  if (!scalar(value)) fail("current_catalog_page_invalid");
  return Object.freeze({ state: "present", value: value as NativeJson });
}
function own2027Page(raw: unknown): PublicCatalogPage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("current_catalog_page_invalid");
  }
  const d = raw as Record<string, unknown>, names = Reflect.ownKeys(d);
  const allowed = ["version", "head", "asOfUtc", "rows", "nextAfter"];
  if (
    names.some((x) => typeof x !== "string" || !allowed.includes(x)) ||
    !["version", "head", "asOfUtc", "rows"].every((x) => Object.hasOwn(d, x))
  ) {
    fail("current_catalog_page_invalid");
  }
  const p = own2027Record(d, names as string[]);
  if (
    Object.hasOwn(p, "nextAfter") && p.nextAfter !== null &&
    p.nextAfter !== undefined
  ) fail("current_catalog_page_invalid");
  const rows: PublicCatalogRecord[] = [];
  for (const item of own2027Array(p.rows, 100)) {
    const r = own2027Record(item, ["key", "row", "guide"]);
    const key = publicCatalogKey(own2027Array(r.key, 5));
    const row = own2027Selected(r.row, [
      ...OFFERING_ROW_FIELDS,
      "active_service",
      "practical_required",
      "source_kind",
      "metric_kind",
      "lookup_requested_id",
      "release_id",
    ]);
    let guide: NativeObject | null = null;
    if (r.guide !== null) {
      const g = own2027Selected(r.guide, [
        ...OFFERING_GUIDE_FIELDS,
        "academic_year",
        "school_id",
        "offering_pk",
        "offering_id",
        "active_service",
        "practical_required",
        "recruitment_link_status",
        "quota_value",
        "quota_literal_state",
        "metadata",
      ]);
      const copy: NativeObject = { ...g };
      if (Object.hasOwn(g, "metadata") && g.metadata !== null) {
        copy.metadata = own2027Selected(g.metadata, [
          "quota_stage",
          "source_url",
          "source_as_of",
          "deadline",
        ]);
      }
      guide = Object.freeze(copy);
    }
    rows.push(Object.freeze({ key, row, guide }));
  }
  return Object.freeze({
    version: p.version as string,
    head: p.head as string,
    asOfUtc: p.asOfUtc as bigint,
    rows: Object.freeze(rows),
  });
}

/** Mirror the existing catalog page checks without changing or weakening that file. */
function own2027ValidatePage(
  page: PublicCatalogPage,
  pub: PublicCatalogPublication,
  max: number,
): void {
  if (
    !page || page.version !== pub.version || !HASH.test(page.head) ||
    typeof page.asOfUtc !== "bigint" || !Array.isArray(page.rows) ||
    page.rows.length > max
  ) {
    fail("current_catalog_page_invalid");
  }
  utcText(page.asOfUtc);
  let last: PublicCatalogKey | null = null;
  for (const r of page.rows) {
    const key = publicCatalogKey(r.key);
    if (
      r.guide?.active_service === false || r.guide?.practical_required === true
    ) fail("current_catalog_page_invalid");
    if (
      !object(r.row) || (typeof r.row.canonical_result_id === "string"
        ? r.row.active_service !== true
        : r.row.active_service === false || r.row.practical_required === true ||
          r.row.source_kind !== "current_guide" &&
            r.row.active_service !== true) ||
      r.row.academic_year !== key[0] ||
      String(r.row.school_id ?? "") !== key[1] ||
      String(r.row.offering_pk ?? "") !== key[2] ||
      String(r.row.metric_kind ?? "") !== key[3] ||
      String(
          r.row.canonical_result_id ?? r.row.offering_id ?? r.row.release_id ??
            "",
        ) !== key[4] ||
      last && comparePublicCatalogKeys(last, key) >= 0
    ) {
      fail("current_catalog_page_invalid");
    }
    last = key;
  }
}
export class CurrentPublicR27SelectionService {
  constructor(
    private readonly current: CurrentPublicCatalogPort,
    private readonly requestClock: RequestClockPort,
    private readonly trust?: Own2027SelectionTrust,
  ) {}
  /** Internal candidate only: no public route; caller cannot provide subject or head.
   * The installed server guard must authorize the admitted request and exact key scope. */
  async selectedOwn2027Guides(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    rawKeys: unknown,
  ): Promise<
    Readonly<
      {
        publication_sha256: string;
        head_sha256: string;
        items: readonly Own2027SelectionItem[];
      }
    >
  > {
    const keys = own2027Input(rawKeys);
    const trust = this.trust;
    if (
      !trust || typeof trust.bind !== "function" || !boundary ||
      !(boundary.signal instanceof AbortSignal) ||
      boundary.signal.aborted || boundary.admission === undefined ||
      boundary.admission === null
    ) fail("security_policy_unavailable");
    const bindOwn = trust!.bind.bind(trust),
      lookup = this.current.lookup.bind(this.current),
      publication = this.current.publication.bind(this.current);
    sessionDto(request.session, this.requestClock.nowUtc());
    const pub = own2027Publication(
      await publication(),
      this.requestClock.nowUtc(),
    );
    const first = own2027Binding(
      await bindOwn(request, boundary, keys, pub),
      pub,
    );
    if (
      first.subject_id !== request.session.user.subjectId ||
      boundary.signal.aborted
    ) fail("security_policy_unavailable");
    const ids = Object.freeze(keys.map((k) => "2027:" + k.offering_pk));
    const page = own2027Page(await lookup(first.subject_id, ids, true));
    // The existing page validator stringifies these fields. Reject objects before
    // reaching it, so provider-supplied coercion hooks can never run.
    for (const r of page.rows) {
      if (
        r.row.academic_year !== 2027 || typeof r.row.school_id !== "string" ||
        typeof r.row.offering_pk !== "string" ||
        typeof r.row.offering_id !== "string" ||
        [r.row.canonical_result_id, r.row.metric_kind, r.row.release_id].some(
          (x) => x !== undefined && x !== null && typeof x !== "string",
        )
      ) fail("current_catalog_page_invalid");
    }
    own2027ValidatePage(page, pub, ids.length);
    if (page.head !== first.head_sha256) {
      fail("current_catalog_state_unapproved");
    }
    const wanted = new Map(ids.map((id, i) => [id, keys[i]] as const));
    const found = new Map<string, Own2027SelectionItem>();
    for (const r of page.rows) {
      const id = r.key[4], expected = wanted.get(id);
      if (
        !expected || found.has(id) || r.key[0] !== 2027 ||
        r.key[1] !== expected.school_id ||
        r.key[2] !== expected.offering_pk || r.key[3] !== "" ||
        r.row.academic_year !== 2027 ||
        r.row.school_id !== expected.school_id ||
        r.row.offering_pk !== expected.offering_pk ||
        r.row.offering_id !== id ||
        (Object.hasOwn(r.row, "lookup_requested_id") &&
          r.row.lookup_requested_id !== id)
      ) {
        fail("current_catalog_identity_conflict");
      }
      const selected = expected!;
      if (!r.guide || r.guide.recruitment_link_status !== "verified") {
        found.set(
          id,
          Object.freeze({
            ...selected,
            offering_id: id,
            status: "HOLD",
            reasons: Object.freeze([
              "GUIDE_LINK_UNVERIFIED",
              "CONDITIONAL_SOURCE_UNPROVEN",
              "NULL_ORIGIN_UNPROVEN",
              "PRACTICAL_EVIDENCE_UNPROVEN",
            ]),
            offering: null,
            recruitment: null,
            quota_native: Object.freeze({ state: "absent" }),
            quota_literal_native: Object.freeze({ state: "absent" }),
            quota_stage_native: Object.freeze({ state: "absent" }),
          }),
        );
        continue;
      }
      if (
        r.guide.academic_year !== 2027 ||
        r.guide.school_id !== selected.school_id ||
        r.guide.offering_pk !== selected.offering_pk ||
        r.guide.offering_id !== id
      ) {
        fail("current_catalog_identity_conflict");
      }
      const quota = own2027NativeField(r.guide, "quota_value");
      const quotaLiteral = own2027NativeField(r.guide, "quota_literal_state");
      const quotaStage = own2027NativeField(
        object(r.guide.metadata) ? r.guide.metadata : null,
        "quota_stage",
      );
      const offering = Object.freeze(
        await publicCatalogOffering(r.row, r.guide),
      );
      if (offering.offering_id !== id || offering.academic_year !== 2027) {
        fail("current_catalog_identity_conflict");
      }
      const projectionGuide = quota.state === "present"
        ? Object.freeze({ ...r.guide, quota_value: quota.value })
        : r.guide;
      const recruitment = publicCatalogRecruitment(projectionGuide);
      if (Array.isArray(recruitment.changes)) {
        Object.freeze(recruitment.changes);
      }
      Object.freeze(recruitment);
      // Current Guide projection has no independently qualified condition, null-origin
      // or practical-eligibility evidence. Keep native values and never mark ready.
      const reasons = [
        "CONDITIONAL_SOURCE_UNPROVEN",
        "NULL_ORIGIN_UNPROVEN",
        "PRACTICAL_EVIDENCE_UNPROVEN",
      ];
      found.set(
        id,
        Object.freeze({
          ...selected,
          offering_id: id,
          status: "HOLD",
          reasons: Object.freeze(reasons),
          offering,
          recruitment,
          quota_native: quota,
          quota_literal_native: quotaLiteral,
          quota_stage_native: quotaStage,
        }),
      );
    }
    const end = own2027Publication(
      await publication(),
      this.requestClock.nowUtc(),
    );
    const last = own2027Binding(
      await bindOwn(request, boundary, keys, end),
      end,
    );
    sessionDto(request.session, this.requestClock.nowUtc());
    if (
      boundary.signal.aborted || last.subject_id !== first.subject_id ||
      last.subject_id !== request.session.user.subjectId ||
      last.head_sha256 !== first.head_sha256 ||
      end.version !== pub.version || end.sha256 !== pub.sha256 ||
      end.expiresAtUtc !== pub.expiresAtUtc
    ) {
      fail("current_catalog_state_unapproved");
    }
    const items = keys.map((k) =>
      found.get("2027:" + k.offering_pk) ??
        Object.freeze({
          ...k,
          offering_id: "2027:" + k.offering_pk,
          status: "HOLD" as const,
          reasons: Object.freeze(["NOT_RETURNED"]),
          offering: null,
          recruitment: null,
          quota_native: Object.freeze({ state: "absent" as const }),
          quota_literal_native: Object.freeze({ state: "absent" as const }),
          quota_stage_native: Object.freeze({ state: "absent" as const }),
        })
    );
    return Object.freeze({
      publication_sha256: pub.sha256,
      head_sha256: first.head_sha256,
      items: Object.freeze(items),
    });
  }
}
