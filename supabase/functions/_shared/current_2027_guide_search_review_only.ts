/** REVIEW ONLY. One bounded Guide search; no route, provider, DB configuration or authorization.
 * The server composition must inject independently authorized, request-scoped authority and
 * a position codec already bound to the v6 cursor scope. Hash shape alone grants nothing. */
import { AccessError } from "./jungsi/application/access.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import { sessionDto } from "./jungsi/application/session_service.ts";
import { nativeJsonText } from "./jungsi/domain/json_value.ts";
import { JsonFloat } from "./jungsi/domain/native_json.ts";
import { hasAsciiControl, unicodeCasefold } from "./jungsi/domain/text.ts";
import type {
  CurrentOffering,
  CurrentOfferingPagePort,
  CurrentPageAuthority,
  CurrentPageBoundary,
  CurrentPageExecution,
  CurrentPagePins,
  CurrentPagePortContext,
  CurrentPageQuery,
  PhysicalKey,
  QuotaDecision,
} from "./jungsi/application/history_current_page.ts";
import {
  comparePublicCatalogKeys,
  type CurrentPublicCatalogPort,
  parsePublicCatalogQuery,
  type PublicCatalogKey,
  publicCatalogKey,
  type PublicCatalogQuery,
} from "./current_public_catalog.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = (): never => {
  throw new AccessError("current_guide_page_unavailable", 503);
};

/** All methods are server-only. This internal port never invokes the paid P3
 * offerings.search route or changes its entitlement. Both preflights must verify the
 * separately approved P1 operation, role/tier, issuer and reserved budget before I/O.
 * authorizeBeforeIO is synchronous and must verify
 * the actual request, role, operation, independently approved 2027 index coverage,
 * current composite heads/scope, cancellation and reserved whole-page budget
 * before ANY possible I/O. classify/exclusion
 * evidence must cover the full composite head, including cross-page collisions.
 * Practical scope needs independent reviewed evidence for each target; a false
 * flag alone never proves non-practical status. Unknown enrollment or practical
 * scope is HOLD, while verified enrollment and missing quota is INCLUDE+pending.
 * A synthetic implementation or a status string is not an approval. */
export interface GuideSearchAuthority extends CurrentPageAuthority {
  /** Independently checks actual issuer, session, operation, relay, cancellation,
   * budget and approved collision-free/normalized 2027 coverage before begin can I/O. */
  authorizeBeforeBegin(execution: CurrentPageExecution, boundary: CurrentPageBoundary): void;
  /** Catalog composite head is DISTINCT from the Guide source head. */
  assertCatalogBinding(
    context: CurrentPagePortContext,
    publication: string,
    catalogHead: string,
  ): void;
  /** Verify source fingerprint and projected fields against the approved head and
   * physical release. In direct mode campus is separately classified by the scope
   * authority; an unknown campus alone must not make verified recruitment HOLD. */
  classifyGuideProjections(
    context: CurrentPagePortContext,
    claims: readonly GuideProjectionClaim[],
  ): Promise<
    readonly Readonly<{ target: PhysicalKey; decision: "VERIFIED" | "HOLD" }>[]
  >;
  /** Required for the direct-view candidate. Independently rebind pre-existing
   * enrollment and practical-scope evidence to the exact physical key, row
   * fingerprint, current Guide head and this admitted request in one page batch.
   * Missing metadata, a flag value, a synthetic verdict or a local target_pk by
   * itself cannot establish either confirmed result. */
  verifyGuideScope?(
    context: CurrentPagePortContext,
    claims: readonly GuideProjectionClaim[],
  ): Promise<
    readonly Readonly<
      {
        target: PhysicalKey;
        enrollment: "CONFIRMED" | "HOLD" | "EXCLUDE";
        practical: "NON_PRACTICAL" | "HOLD" | "EXCLUDE";
        /** Only independently verified conditional-only recruitment awaiting official rollover. */
        enrollment_basis?: "unknown" | "rollover_only_pending";
        campus_state?: "unknown" | "confirmed_null" | "confirmed_value";
        campus_value?: string | null;
        campus_origin?: "unknown" | "source" | "separate_grant";
      }
    >[]
  >;
  /** Prove the bounded index selection and any keyset gap/nextAfter do not omit
   * eligible or unresolved HOLD rows. No full count or per-row lookup. */
  assertScanCoverage(
    context: CurrentPagePortContext,
    query: CurrentPageQuery,
    before: PublicCatalogKey | null,
    scanned: readonly PublicCatalogKey[],
    next: PublicCatalogKey | null,
    catalogHead: string,
  ): Promise<void>;
  authorizeBeforeIO(
    context: CurrentPagePortContext,
    query: CurrentPageQuery,
    after: string | null,
  ): void;
  /** A confirmed final-zero exclusion needs independent final-stage and resolved
   * rollover proof for this exact target. An initial zero, missing quota, uncertain
   * enrollment, or uncertain practical scope is not such an exclusion. Confirmed
   * enrollment with missing quota remains INCLUDE + pending_value_missing. */
  confirmExclusions(
    context: CurrentPagePortContext,
    keys: readonly PhysicalKey[],
  ): Promise<
    readonly Readonly<{
      target: PhysicalKey;
      decision: "EXCLUDE_CONFIRMED" | "HOLD" | "UNKNOWN";
    }>[]
  >;
}
export type GuideRawField<T> = Readonly<
  { state: "missing" | "invalid" } | { state: "present"; value: T }
>;
export type GuideQuotaScalar = null | string | number | bigint | JsonFloat;
export type GuideRawQuota = Readonly<{
  value: GuideRawField<GuideQuotaScalar>;
  literal: GuideRawField<string | null>;
  stage: GuideRawField<string | null>;
  sourceUrl: GuideRawField<string | null>;
  sourceAsOf: GuideRawField<string | null>;
  /** SQL does not project condition text; never infer or synthesize it. */
  conditionText: Readonly<{ state: "missing" }>;
}>;
export type GuideProjectionClaim = Readonly<{
  target: PhysicalKey;
  rowFingerprint: string | null;
  offering: CurrentOffering;
  rawQuota: GuideRawQuota;
  scopeSignals: Readonly<
    {
      activeRow: boolean | null;
      activeGuide: boolean | null;
      practicalRow: boolean | null;
      practicalGuide: boolean | null;
      malformed: boolean;
      /** A null here can be SQL null or a missing original metadata key. */
      participationStatus: GuideRawField<string | null>;
    }
  >;
}>;
/** Bound by the authenticated outer v7.1 cursor to subject, operation, all filters,
 * both source heads, decision scope and expiry. No plain client cursor is trusted. */
export interface GuidePositionCodec {
  decode(context: CurrentPagePortContext, query: CurrentPageQuery, token: string): PublicCatalogKey;
  encode(context: CurrentPagePortContext, query: CurrentPageQuery, key: PublicCatalogKey): string;
}

function data(value: unknown, field: string, optional = false): unknown {
  if (!value || typeof value !== "object") return fail();
  const d = Object.getOwnPropertyDescriptor(value, field);
  if (!d) return optional ? undefined : fail();
  if (!("value" in d)) return fail();
  return d.value;
}
function fields(value: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) return fail();
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, data(value, key as string)])));
}
function dense(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail();
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) result.push(data(value, String(i)));
  return result;
}
function key(value: unknown): PublicCatalogKey {
  const captured = dense(value, 5);
  if (captured.length !== 5) return fail();
  const result = publicCatalogKey(captured);
  if (result[0] !== 2027) return fail();
  return Object.freeze(result) as unknown as PublicCatalogKey;
}
function keyId(value: PhysicalKey): string {
  return JSON.stringify([
    value.release_id,
    value.academic_year,
    value.offering_pk,
    value.school_id,
  ]);
}
function physical(value: unknown): PhysicalKey {
  const release = data(value, "release_id"),
    year = data(value, "academic_year"),
    offering = data(value, "offering_pk"),
    school = data(value, "school_id");
  if (
    typeof release !== "string" || !ID.test(release) || year !== 2027 ||
    typeof offering !== "string" || !ID.test(offering) ||
    typeof school !== "string" || !ID.test(school)
  ) return fail();
  return Object.freeze({
    release_id: release,
    academic_year: 2027,
    offering_pk: offering,
    school_id: school,
  });
}
function label(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 4096 || hasAsciiControl(value)) return fail();
  return value;
}
function position(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 8192 || hasAsciiControl(value)) {
    return fail();
  }
  return value;
}
function rawField<T>(
  source: unknown,
  name: string,
  capture: (value: unknown) => T | undefined,
): GuideRawField<T> {
  if (!source || typeof source !== "object") return Object.freeze({ state: "missing" });
  const d = Object.getOwnPropertyDescriptor(source, name);
  if (!d) return Object.freeze({ state: "missing" });
  if (!("value" in d)) return Object.freeze({ state: "invalid" });
  const result = capture(d.value);
  return result === undefined
    ? Object.freeze({ state: "invalid" })
    : Object.freeze({ state: "present", value: result });
}
function scalar(value: unknown): GuideQuotaScalar | undefined {
  if (value === null || typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && value.length <= 4096 && !hasAsciiControl(value)) return value;
  if (
    value instanceof JsonFloat &&
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value.lexeme)
  ) return Object.freeze(new JsonFloat(value.lexeme));
  return undefined;
}
function rawText(value: unknown): string | null | undefined {
  return value === null ||
      typeof value === "string" && value.length <= 4096 && !hasAsciiControl(value)
    ? value
    : undefined;
}
function sameScalar(a: GuideQuotaScalar, b: GuideQuotaScalar): boolean {
  if (a instanceof JsonFloat || b instanceof JsonFloat) {
    return a instanceof JsonFloat && b instanceof JsonFloat && a.lexeme === b.lexeme;
  }
  return typeof a === typeof b && Object.is(a, b);
}
/** Compare native scalar type and original metadata, then rebuild only fields
 * independently verified for this exact physical row. No condition text was read. */
function boundQuota(
  value: unknown,
  raw: GuideRawQuota,
): { quota: NonNullable<QuotaDecision["quota"]>; signature: string } | null {
  if (
    !value || typeof value !== "object" ||
    [raw.value, raw.literal, raw.stage, raw.sourceUrl, raw.sourceAsOf].some((field) =>
      field.state === "invalid"
    )
  ) return null;
  const qValue = scalar(data(value, "value"));
  const status = data(value, "status"),
    stage = data(value, "stage"),
    unit = rawText(data(value, "unit")),
    condition = data(value, "condition"),
    conditionText = data(value, "condition_text"),
    sourceUrl = rawText(data(value, "source_url")),
    sourceAsOf = rawText(data(value, "source_as_of"));
  if (
    qValue === undefined || unit === undefined || sourceUrl === undefined ||
    sourceAsOf === undefined ||
    !["verified_official", "pending_value_missing", "not_published"].includes(String(status)) ||
    !["initial", "final", "unknown"].includes(String(stage)) || condition !== "unknown" ||
    conditionText !== null
  ) return null;
  if (
    raw.literal.state === "present" && raw.literal.value === "json_null" &&
    (raw.value.state !== "present" || raw.value.value !== null)
  ) return null;
  if (raw.literal.state === "present" && raw.literal.value === "numeric_literal") {
    if (raw.value.state !== "present") return null;
    const n = raw.value.value;
    if (
      !(typeof n === "number" || typeof n === "bigint" || n instanceof JsonFloat ||
        typeof n === "string" && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(n))
    ) return null;
  }
  if (status === "verified_official") {
    if (raw.value.state !== "present" || !sameScalar(qValue, raw.value.value)) return null;
  } else if (qValue !== null) return null;
  if (stage !== "unknown" && (raw.stage.state !== "present" || raw.stage.value !== stage)) {
    return null;
  }
  if (
    sourceUrl !== null && (raw.sourceUrl.state !== "present" || raw.sourceUrl.value !== sourceUrl)
  ) return null;
  if (
    sourceAsOf !== null &&
    (raw.sourceAsOf.state !== "present" || raw.sourceAsOf.value !== sourceAsOf)
  ) return null;
  const source: Record<string, unknown> = {};
  if (
    raw.value.state === "present" && (status === "verified_official" || raw.value.value === null)
  ) {
    source.quota_value = raw.value.value;
  }
  if (raw.literal.state === "present") source.quota_literal_state = raw.literal.value;
  if (raw.stage.state === "present") source.quota_stage = raw.stage.value;
  const supplied = data(value, "source_quota", true);
  if (supplied !== undefined) {
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) return null;
    for (const key of Reflect.ownKeys(supplied)) {
      if (typeof key !== "string" || !Object.hasOwn(source, key)) return null;
      const actual = data(supplied, key), expected = source[key];
      if (key === "quota_value") {
        const a = scalar(actual), b = scalar(expected);
        if (a === undefined || b === undefined || !sameScalar(a, b)) return null;
      } else if (actual !== expected) return null;
    }
  }
  const quota = Object.freeze({
    value: qValue,
    status: status as "verified_official" | "pending_value_missing" | "not_published",
    stage: stage as "initial" | "final" | "unknown",
    unit,
    condition: "unknown" as const,
    condition_text: null,
    source_url: sourceUrl,
    source_as_of: sourceAsOf,
    ...(Object.keys(source).length ? { source_quota: Object.freeze(source) } : {}),
  }) as NonNullable<QuotaDecision["quota"]>;
  const signature = nativeJsonText(quota, true) + "|" + typeof qValue +
    (qValue instanceof JsonFloat ? "|" + qValue.lexeme : "");
  return { quota, signature };
}
type CapturedRow = Readonly<{
  key: PublicCatalogKey;
  offering: CurrentOffering;
  fingerprint: string | null;
  rawQuota: GuideRawQuota;
  scopeConflict: boolean;
  scopeSignals: GuideProjectionClaim["scopeSignals"];
}>;
function captureRow(raw: unknown, direct = false): CapturedRow {
  const sourceKey = key(data(raw, "key")), row = data(raw, "row"), guide = data(raw, "guide");
  const target = physical(row), guideTarget = physical(guide);
  const fingerprint = data(row, "row_fingerprint", true);
  const activeRow = data(row, "active_service", true),
    activeGuide = data(guide, "active_service", true),
    practicalRow = data(row, "practical_required", true),
    practicalGuide = data(guide, "practical_required", true);
  const malformed = [activeRow, activeGuide, practicalRow, practicalGuide].some((v) =>
    v != null && typeof v !== "boolean"
  );
  const scopeConflict = malformed || activeRow === false || activeGuide === false ||
    practicalRow === true || practicalGuide === true ||
    activeRow != null && activeGuide != null && activeRow !== activeGuide ||
    practicalRow != null && practicalGuide != null && practicalRow !== practicalGuide;
  const metadata = data(row, "metadata", true);
  const rawQuota: GuideRawQuota = Object.freeze({
    value: rawField(row, "quota_value", scalar),
    literal: rawField(row, "quota_literal_state", rawText),
    stage: rawField(metadata, "quota_stage", rawText),
    sourceUrl: rawField(metadata, "source_url", rawText),
    sourceAsOf: rawField(metadata, "source_as_of", rawText),
    conditionText: Object.freeze({ state: "missing" }),
  });
  if (
    data(row, "source_kind", true) !== "current_guide" ||
    !direct && scopeConflict ||
    keyId(target) !== keyId(guideTarget) || sourceKey[1] !== target.school_id ||
    sourceKey[2] !== target.offering_pk || sourceKey[3] !== "" ||
    sourceKey[4] !== `2027:${target.offering_pk}` ||
    data(row, "offering_id") !== `2027:${target.offering_pk}` ||
    data(guide, "offering_id") !== `2027:${target.offering_pk}`
  ) return fail();
  return Object.freeze({
    key: sourceKey,
    fingerprint: typeof fingerprint === "string" && HASH.test(fingerprint) ? fingerprint : null,
    rawQuota,
    scopeConflict,
    scopeSignals: Object.freeze({
      activeRow: typeof activeRow === "boolean" ? activeRow : null,
      activeGuide: typeof activeGuide === "boolean" ? activeGuide : null,
      practicalRow: typeof practicalRow === "boolean" ? practicalRow : null,
      practicalGuide: typeof practicalGuide === "boolean" ? practicalGuide : null,
      malformed,
      participationStatus: rawField(metadata, "participation_conditions_status", rawText),
    }),
    offering: Object.freeze({
      key: target,
      university_name: label(data(row, "university", true)),
      region: label(data(guide, "location", true)),
      campus: label(data(guide, "campus", true)),
      department: label(data(row, "department", true)),
      admission_track: label(data(row, "track", true)),
      group: label(data(row, "recruit_group", true)),
    }),
  });
}

export type GuideRequestCatalogFactory = (
  context: CurrentPagePortContext,
  query: Readonly<PublicCatalogQuery>,
  after: PublicCatalogKey | null,
) => CurrentPublicCatalogPort;
function createGuideSearchPageAdapter(
  catalog: CurrentPublicCatalogPort | null,
  authority: GuideSearchAuthority | null,
  codec: GuidePositionCodec | null,
  clock: RequestClockPort,
  markHeld: (context: CurrentPagePortContext, target: PhysicalKey) => void,
  rememberClaim: (context: CurrentPagePortContext, claim: GuideProjectionClaim) => void,
  catalogFactory?: GuideRequestCatalogFactory,
): CurrentOfferingPagePort {
  return Object.freeze({
    async page(context: CurrentPagePortContext, query: CurrentPageQuery, after: string | null) {
      if (
        !catalog || typeof catalog.publication !== "function" ||
        typeof catalog.search !== "function" ||
        !authority || !codec || typeof authority.authorizeBeforeIO !== "function" ||
        typeof authority.assertCurrent !== "function" ||
        typeof authority.classifyGuideMembership !== "function" ||
        typeof authority.classifyTargets !== "function" ||
        typeof authority.confirmExclusions !== "function" ||
        typeof authority.classifyGuideProjections !== "function" ||
        typeof authority.assertCatalogBinding !== "function" ||
        typeof authority.assertScanCoverage !== "function" ||
        typeof codec.decode !== "function" || typeof codec.encode !== "function" ||
        !context || !context.execution || context.execution.operation !== "history.current-page" ||
        !context.execution.session?.user || !context.boundary ||
        !(context.boundary.signal instanceof AbortSignal) || context.boundary.signal.aborted ||
        !context.boundary.admission || !context.pins
      ) return fail();
      const execution = context.execution,
        session = execution.session,
        user = session.user,
        boundary = context.boundary,
        signal = boundary.signal,
        admission = boundary.admission,
        pins = context.pins,
        subject = user.subjectId,
        userExpires = user.expiresAtUtc,
        evaluatedAt = session.evaluatedAtUtc,
        tier = session.tier,
        paidUntil = session.paidUntilUtc,
        rawQuery = execution.query;
      const queryFields = ["university_q", "department_q", "region", "group", "limit"] as const;
      const q = fields(query, queryFields),
        capturedRaw = fields(rawQuery, [...queryFields, "cursor"]);
      if (
        queryFields.some((name) => !Object.hasOwn(q, name)) ||
        queryFields.slice(0, 4).some((name) =>
          typeof q[name] !== "string" || q[name] !== (capturedRaw[name] ?? "")
        ) ||
        !Number.isSafeInteger(q.limit) || Number(q.limit) < 1 || Number(q.limit) > 100 ||
        String(q.limit) !== (capturedRaw.limit ?? "50") ||
        !(after === null || typeof after === "string" && position(after) === after)
      ) return fail();
      const safeQuery = Object.freeze({
        university_q: q.university_q as string,
        department_q: q.department_q as string,
        region: q.region as string,
        group: q.group as string,
        limit: q.limit as number,
      });
      const pinNames = [
        "subject",
        "snapshot_id",
        "snapshot_publication_sha256",
        "snapshot_source_head_sha256",
        "snapshot_scope_sha256",
        "guide_publication_sha256",
        "guide_head_sha256",
        "decision_scope_sha256",
        "expires_at_utc",
      ] as const;
      const stablePins = fields(pins, pinNames);
      if (
        pinNames.some((name) => !Object.hasOwn(stablePins, name)) ||
        stablePins.subject !== subject ||
        typeof stablePins.snapshot_id !== "string" || !ID.test(stablePins.snapshot_id) ||
        pinNames.slice(2, 8).some((name) =>
          typeof stablePins[name] !== "string" || !HASH.test(stablePins[name] as string)
        ) ||
        typeof stablePins.expires_at_utc !== "bigint"
      ) return fail();
      const expiresAt = stablePins.expires_at_utc as bigint;
      const check = () => {
        const now = clock.nowUtc();
        if (
          context.execution !== execution || execution.operation !== "history.current-page" ||
          execution.session !== session || session.user !== user || user.subjectId !== subject ||
          user.expiresAtUtc !== userExpires || session.evaluatedAtUtc !== evaluatedAt ||
          session.tier !== tier || session.paidUntilUtc !== paidUntil ||
          context.boundary !== boundary || boundary.signal !== signal || signal.aborted ||
          boundary.admission !== admission ||
          context.pins !== pins || execution.query !== rawQuery ||
          JSON.stringify(fields(rawQuery, [...queryFields, "cursor"])) !==
            JSON.stringify(capturedRaw) ||
          pinNames.some((name) => data(pins, name) !== stablePins[name]) || now >= expiresAt
        ) return fail();
        sessionDto(session, now);
      };
      check();
      if (authority.authorizeBeforeIO(context, safeQuery, after) !== undefined) return fail();
      check();
      const before = after === null ? null : key(codec.decode(context, safeQuery, after));
      check();
      const searchQuery = Object.freeze(parsePublicCatalogQuery({
        academic_year: "2027",
        university_q: safeQuery.university_q,
        department_q: safeQuery.department_q,
        region: safeQuery.region,
        group: safeQuery.group,
        limit: String(safeQuery.limit),
      }));
      const selectedCatalog = catalogFactory
        ? catalogFactory(context, searchQuery, before)
        : catalog;
      if (
        !selectedCatalog || typeof selectedCatalog.publication !== "function" ||
        typeof selectedCatalog.search !== "function"
      ) return fail();
      check();
      if (await authority.assertCurrent(context) !== undefined) return fail();
      check();
      const firstRaw = await selectedCatalog.publication();
      check();
      const first = Object.freeze({
        version: data(firstRaw, "version"),
        sha256: data(firstRaw, "sha256"),
        expiresAtUtc: data(firstRaw, "expiresAtUtc"),
      });
      if (
        typeof first.version !== "string" || !first.version ||
        first.sha256 !== pins.guide_publication_sha256 ||
        typeof first.expiresAtUtc !== "bigint" || first.expiresAtUtc <= clock.nowUtc()
      ) return fail();
      const rawPage = await selectedCatalog.search(subject, "offerings", searchQuery, before);
      check();
      const version = data(rawPage, "version"),
        head = data(rawPage, "head"),
        asOf = data(rawPage, "asOfUtc");
      const rows = dense(data(rawPage, "rows"), safeQuery.limit + 1).map((r) =>
        captureRow(r, !!catalogFactory)
      );
      const rawNext = data(rawPage, "nextAfter", true),
        suppliedNext = rawNext == null ? null : key(rawNext);
      if (
        version !== first.version || typeof head !== "string" || !HASH.test(head) ||
        typeof asOf !== "bigint"
      ) return fail();
      if (
        authority.assertCatalogBinding(context, first.sha256 as string, head as string) !==
          undefined
      ) return fail();
      check();
      if (
        await authority.assertScanCoverage(
          context,
          safeQuery,
          before,
          Object.freeze(rows.map((r) => r.key)),
          suppliedNext,
          head as string,
        ) !== undefined
      ) return fail();
      check();
      let previous = before, hasScannedRow = false;
      const duplicatePositions = new Set<string>();
      for (const row of rows) {
        if (previous) {
          const cmp = comparePublicCatalogKeys(previous, row.key);
          if (cmp > 0 || cmp === 0 && (!catalogFactory || !hasScannedRow)) return fail();
          if (cmp === 0) duplicatePositions.add(JSON.stringify(row.key));
        }
        previous = row.key;
        hasScannedRow = true;
        const o = row.offering;
        if (
          !unicodeCasefold(o.university_name ?? "").includes(searchQuery.university_q) ||
          !unicodeCasefold(o.department ?? "").includes(searchQuery.department_q) ||
          searchQuery.region && unicodeCasefold(o.region ?? "") !== searchQuery.region ||
          searchQuery.group && unicodeCasefold(o.group ?? "") !== searchQuery.group
        ) return fail();
      }
      const scannedSelection = rows.slice(0, safeQuery.limit);
      const selected = catalogFactory
        ? [...new Map(scannedSelection.map((r) => [JSON.stringify(r.key), r])).values()]
        : scannedSelection;
      for (const row of selected) {
        if (duplicatePositions.has(JSON.stringify(row.key))) markHeld(context, row.offering.key);
      }
      const keys = Object.freeze(selected.map((r) => r.offering.key));
      const unique = new Set(keys.map(keyId));
      if (unique.size !== keys.length) return fail();
      const claims = Object.freeze(selected.map((r) =>
        Object.freeze({
          target: r.offering.key,
          rowFingerprint: r.fingerprint,
          offering: r.offering,
          rawQuota: r.rawQuota,
          scopeSignals: r.scopeSignals,
        })
      ));
      const projections = keys.length
        ? await authority.classifyGuideProjections(context, claims)
        : [];
      check();
      const projectionSeen = new Set<string>(), projectionHeld = new Set<string>();
      for (const item of dense(projections, keys.length)) {
        const target = physical(data(item, "target")),
          id = keyId(target),
          decision = data(item, "decision");
        if (
          !unique.has(id) || projectionSeen.has(id) ||
          (decision !== "VERIFIED" && decision !== "HOLD")
        ) return fail();
        projectionSeen.add(id);
        const claim = claims.find((c) => keyId(c.target) === id)!;
        if (decision === "HOLD" || claim.rowFingerprint === null) {
          projectionHeld.add(id);
          markHeld(context, target);
        } else if (catalogFactory) rememberClaim(context, claim);
      }
      if (projectionSeen.size !== keys.length) return fail();
      const scopedExclusions = new Set<string>(), conditionalOnlyPending = new Set<string>();
      const verifiedCampuses = new Map<string, string | null>();
      if (catalogFactory && keys.length) {
        if (typeof authority.verifyGuideScope !== "function") return fail();
        const rawScope = await authority.verifyGuideScope(context, claims);
        check();
        const seen = new Set<string>();
        for (const item of dense(rawScope, keys.length)) {
          const target = physical(data(item, "target")),
            id = keyId(target),
            enrollment = data(item, "enrollment"),
            practical = data(item, "practical"),
            enrollmentBasis = data(item, "enrollment_basis", true) ?? "unknown",
            campusState = data(item, "campus_state", true) ?? "unknown",
            campusValue = data(item, "campus_value", true) ?? null,
            campusOrigin = data(item, "campus_origin", true) ?? "unknown";
          if (
            !unique.has(id) || seen.has(id) || typeof enrollment !== "string" ||
            typeof practical !== "string" ||
            !["CONFIRMED", "HOLD", "EXCLUDE"].includes(enrollment) ||
            !["NON_PRACTICAL", "HOLD", "EXCLUDE"].includes(practical) ||
            !["unknown", "rollover_only_pending"].includes(enrollmentBasis as string) ||
            enrollmentBasis === "rollover_only_pending" &&
              (enrollment !== "HOLD" || practical !== "HOLD") ||
            !["unknown", "confirmed_null", "confirmed_value"].includes(campusState as string) ||
            !["unknown", "source", "separate_grant"].includes(campusOrigin as string) ||
            campusState === "confirmed_value" &&
              (typeof campusValue !== "string" || !label(campusValue)) ||
            campusState !== "confirmed_value" && campusValue !== null ||
            campusState === "unknown" && campusOrigin !== "unknown" ||
            campusState !== "unknown" && campusOrigin === "unknown"
          ) return fail();
          verifiedCampuses.set(
            id,
            campusState === "confirmed_value" ? campusValue as string : null,
          );
          if (enrollmentBasis === "rollover_only_pending") conditionalOnlyPending.add(id);
          seen.add(id);
          if (enrollment === "HOLD" || practical === "HOLD") {
            if (enrollmentBasis !== "rollover_only_pending") markHeld(context, target);
          } else if (enrollment === "EXCLUDE" || practical === "EXCLUDE") scopedExclusions.add(id);
        }
        if (seen.size !== keys.length) return fail();
      }
      const membershipRaw = keys.length
        ? await authority.classifyGuideMembership(context, keys)
        : [];
      check();
      const membership = new Map<string, "VERIFIED" | "HOLD">();
      for (const item of dense(membershipRaw, keys.length)) {
        const target = physical(data(item, "target")),
          decision = data(item, "decision"),
          id = keyId(target);
        if (
          !unique.has(id) || membership.has(id) || (decision !== "VERIFIED" && decision !== "HOLD")
        ) return fail();
        membership.set(id, decision);
      }
      if (membership.size !== keys.length) return fail();
      const publicCounts = new Map<string, number>();
      for (const k of keys) {
        publicCounts.set(k.offering_pk, (publicCounts.get(k.offering_pk) ?? 0) + 1);
      }
      for (const k of keys) if (publicCounts.get(k.offering_pk)! > 1) markHeld(context, k);
      // Suppress only independently verified conditional-only, unconfirmed rollover.
      // Conflicting projection, source signals or membership remain ordinary HOLD.
      const deferred = new Set(
        selected.filter((r) => {
          const id = keyId(r.offering.key);
          return conditionalOnlyPending.has(id) && !projectionHeld.has(id) && !r.scopeConflict &&
            membership.get(id) === "VERIFIED" && publicCounts.get(r.offering.key.offering_pk) === 1;
        }).map((r) => keyId(r.offering.key)),
      );
      for (const row of selected) {
        const id = keyId(row.offering.key);
        if (conditionalOnlyPending.has(id) && !deferred.has(id)) {
          markHeld(context, row.offering.key);
        }
      }
      const classifiedKeys = Object.freeze(
        keys.filter((k) =>
          !deferred.has(keyId(k)) && membership.get(keyId(k)) === "VERIFIED" &&
          publicCounts.get(k.offering_pk) === 1 &&
          claims.find((c) => keyId(c.target) === keyId(k))?.rowFingerprint !== null
        ),
      );
      const rawDecisions = classifiedKeys.length
        ? await authority.classifyTargets(context, classifiedKeys)
        : [];
      check();
      const approved = new Set(classifiedKeys.map(keyId)),
        decisions = new Map<string, "INCLUDE" | "HOLD" | "EXCLUDE">();
      for (const item of dense(rawDecisions, classifiedKeys.length)) {
        const target = physical(data(item, "target")),
          decision = data(item, "decision"),
          id = keyId(target);
        if (
          !approved.has(id) || decisions.has(id) || typeof decision !== "string" ||
          !["INCLUDE", "HOLD", "EXCLUDE"].includes(decision)
        ) return fail();
        decisions.set(id, decision as "INCLUDE" | "HOLD" | "EXCLUDE");
      }
      if (decisions.size !== classifiedKeys.length) return fail();
      for (const row of selected) {
        if (
          catalogFactory && (row.scopeConflict || scopedExclusions.has(keyId(row.offering.key))) &&
          decisions.get(keyId(row.offering.key)) === "INCLUDE"
        ) markHeld(context, row.offering.key);
      }
      const exclusions = Object.freeze(
        classifiedKeys.filter((k) => decisions.get(keyId(k)) === "EXCLUDE"),
      );
      const rawExclusions = exclusions.length
        ? await authority.confirmExclusions(context, exclusions)
        : [];
      check();
      const excludedIds = new Set(exclusions.map(keyId)),
        confirmed = new Set<string>(),
        unresolved = new Set<string>(),
        seenExclusions = new Set<string>();
      for (const item of dense(rawExclusions, exclusions.length)) {
        const target = physical(data(item, "target")),
          result = data(item, "decision"),
          id = keyId(target);
        if (
          !excludedIds.has(id) || seenExclusions.has(id) ||
          (result !== "EXCLUDE_CONFIRMED" && result !== "HOLD" && result !== "UNKNOWN")
        ) return fail();
        seenExclusions.add(id);
        if (result === "EXCLUDE_CONFIRMED") confirmed.add(id);
        else {
          unresolved.add(id);
          markHeld(context, target);
        }
      }
      if (seenExclusions.size !== exclusions.length) return fail();
      const items = Object.freeze(
        selected.filter((r) =>
          !confirmed.has(keyId(r.offering.key)) && !deferred.has(keyId(r.offering.key))
        ).map((r) =>
          catalogFactory
            ? Object.freeze({
              ...r.offering,
              campus: verifiedCampuses.get(keyId(r.offering.key)) ?? null,
            })
            : r.offering
        ),
      );
      const incomplete = deferred.size > 0 ||
        selected.some((r) =>
          membership.get(keyId(r.offering.key)) === "HOLD" ||
          duplicatePositions.has(JSON.stringify(r.key)) ||
          catalogFactory && (r.scopeConflict || scopedExclusions.has(keyId(r.offering.key))) &&
            decisions.get(keyId(r.offering.key)) === "INCLUDE" ||
          publicCounts.get(r.offering.key.offering_pk)! > 1 ||
          unresolved.has(keyId(r.offering.key)) ||
          decisions.get(keyId(r.offering.key)) === "HOLD"
        );
      const continuation = rows.length > safeQuery.limit
        ? scannedSelection.at(-1)?.key ?? null
        : suppliedNext;
      if (
        continuation && (before && comparePublicCatalogKeys(before, continuation) >= 0 ||
          rows.length <= safeQuery.limit && previous &&
            comparePublicCatalogKeys(previous, continuation) > 0)
      ) return fail();
      const next = continuation ? position(codec.encode(context, safeQuery, continuation)) : null;
      check();
      if (await authority.assertCurrent(context) !== undefined) return fail();
      check();
      const lastRaw = await selectedCatalog.publication();
      check();
      if (
        data(lastRaw, "version") !== first.version || data(lastRaw, "sha256") !== first.sha256 ||
        data(lastRaw, "expiresAtUtc") !== first.expiresAtUtc || first.expiresAtUtc <= clock.nowUtc()
      ) return fail();
      if (await authority.assertCurrent(context) !== undefined) return fail();
      check();
      return Object.freeze({ items, next_position: next, incomplete_before: incomplete });
    },
  });
}

/** Both returned ports must be installed together. A context that did not come
 * from this wrapper's own authorized begin is rejected before catalog I/O. HOLD
 * is monotonic for a physical key throughout this request, including subsequent
 * v7.1 service classifications. The underlying authority remains unimplemented. */
export function createGuideSearchPageComposition(
  catalog: CurrentPublicCatalogPort | null,
  base: GuideSearchAuthority | null,
  codec: GuidePositionCodec | null,
  clock: RequestClockPort,
  catalogFactory?: GuideRequestCatalogFactory,
): Readonly<{ authority: GuideSearchAuthority; offerings: CurrentOfferingPagePort }> {
  if (
    !base || !catalog || !codec || typeof base.authorizeBeforeBegin !== "function" ||
    catalogFactory && typeof base.verifyGuideScope !== "function"
  ) return fail();
  const names = [
    "subject",
    "snapshot_id",
    "snapshot_publication_sha256",
    "snapshot_source_head_sha256",
    "snapshot_scope_sha256",
    "guide_publication_sha256",
    "guide_head_sha256",
    "decision_scope_sha256",
    "expires_at_utc",
  ] as const;
  const requests = new WeakMap<CurrentPageExecution, {
    boundary: CurrentPageBoundary;
    pins: Readonly<Record<string, unknown>>;
    held: Set<string>;
    claims: Map<string, GuideProjectionClaim>;
    quotaPins: Map<string, string>;
  }>();
  function state(ctx: CurrentPagePortContext) {
    const saved = requests.get(ctx.execution);
    if (
      !saved || saved.boundary !== ctx.boundary ||
      names.some((name) => data(ctx.pins, name) !== saved.pins[name])
    ) return fail();
    return saved;
  }
  function markHeld(ctx: CurrentPagePortContext, target: PhysicalKey) {
    state(ctx).held.add(keyId(target));
  }
  function rememberClaim(ctx: CurrentPagePortContext, claim: GuideProjectionClaim) {
    state(ctx).claims.set(keyId(claim.target), claim);
  }
  const authority: GuideSearchAuthority = Object.freeze<GuideSearchAuthority>({
    async begin(execution, boundary) {
      if (
        !execution || requests.has(execution) || !boundary ||
        execution.operation !== "history.current-page" || !execution.session?.user ||
        !(boundary.signal instanceof AbortSignal) || boundary.signal.aborted || !boundary.admission
      ) return fail();
      sessionDto(execution.session, clock.nowUtc());
      if (base.authorizeBeforeBegin(execution, boundary) !== undefined) return fail();
      if (boundary.signal.aborted) return fail();
      const raw = await base.begin(execution, boundary);
      const pins = fields(raw, names);
      if (names.some((name) => !Object.hasOwn(pins, name))) return fail();
      requests.set(execution, {
        boundary,
        pins,
        held: new Set(),
        claims: new Map(),
        quotaPins: new Map(),
      });
      return pins as unknown as CurrentPagePins;
    },
    assertCurrent(ctx) {
      state(ctx);
      return base.assertCurrent(ctx);
    },
    authorizeBeforeBegin(execution, boundary) {
      return base.authorizeBeforeBegin(execution, boundary);
    },
    authorizeBeforeIO(ctx, query, after) {
      state(ctx);
      return base.authorizeBeforeIO(ctx, query, after);
    },
    assertCatalogBinding(ctx, publication, head) {
      state(ctx);
      return base.assertCatalogBinding(ctx, publication, head);
    },
    assertScanCoverage(ctx, query, before, scanned, next, head) {
      state(ctx);
      return base.assertScanCoverage(ctx, query, before, scanned, next, head);
    },
    classifyGuideProjections(ctx, claims) {
      state(ctx);
      return base.classifyGuideProjections(ctx, claims);
    },
    verifyGuideScope(ctx, claims) {
      state(ctx);
      if (typeof base.verifyGuideScope !== "function") {
        return Promise.reject(new Error("scope_evidence_unavailable"));
      }
      return base.verifyGuideScope(ctx, claims);
    },
    async classifyGuideMembership(ctx, keys) {
      const saved = state(ctx), allowed = new Set(keys.map(keyId)), seen = new Set<string>();
      if (allowed.size !== keys.length) return fail();
      const raw = await base.classifyGuideMembership(ctx, keys);
      const result = dense(raw, keys.length).map((item) => {
        const target = physical(data(item, "target")),
          id = keyId(target),
          decision = data(item, "decision");
        if (!allowed.has(id) || seen.has(id) || (decision !== "VERIFIED" && decision !== "HOLD")) {
          return fail();
        }
        seen.add(id);
        if (decision === "HOLD") saved.held.add(id);
        return Object.freeze({
          target,
          decision: saved.held.has(id) ? "HOLD" as const : "VERIFIED" as const,
        });
      });
      if (seen.size !== keys.length) return fail();
      return Object.freeze(result);
    },
    async classifyTargets(ctx, keys) {
      const saved = state(ctx), allowed = new Set(keys.map(keyId)), seen = new Set<string>();
      if (allowed.size !== keys.length) return fail();
      const raw = await base.classifyTargets(ctx, keys);
      const result = dense(raw, keys.length).map((item) => {
        const target = physical(data(item, "target")),
          id = keyId(target),
          decision = data(item, "decision");
        if (
          !allowed.has(id) || seen.has(id) ||
          (decision !== "INCLUDE" && decision !== "HOLD" && decision !== "EXCLUDE")
        ) return fail();
        seen.add(id);
        if (decision === "HOLD") saved.held.add(id);
        let quota = data(item, "quota") as QuotaDecision["quota"];
        if (catalogFactory && decision === "INCLUDE" && !saved.held.has(id)) {
          const claim = saved.claims.get(id);
          const bound = claim ? boundQuota(quota, claim.rawQuota) : null;
          const pinned = saved.quotaPins.get(id);
          if (!bound || pinned !== undefined && pinned !== bound.signature) saved.held.add(id);
          else {
            saved.quotaPins.set(id, bound.signature);
            quota = bound.quota;
          }
        }
        return saved.held.has(id)
          ? Object.freeze({ target, decision: "HOLD" as const, quota: null })
          : Object.freeze({ target, decision, quota });
      });
      if (seen.size !== keys.length) return fail();
      return Object.freeze(result);
    },
    confirmExclusions(ctx, keys) {
      state(ctx);
      return base.confirmExclusions(ctx, keys);
    },
    verifyRelations(ctx, claims) {
      state(ctx);
      return base.verifyRelations(ctx, claims);
    },
  });
  return Object.freeze({
    authority,
    offerings: createGuideSearchPageAdapter(
      catalog,
      authority,
      codec,
      clock,
      markHeld,
      rememberClaim,
      catalogFactory,
    ),
  });
}
