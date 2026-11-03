/** REVIEW ONLY. One bounded Guide search; no route, provider, DB configuration or authorization.
 * The server composition must inject independently authorized, request-scoped authority and
 * a position codec already bound to the v6 cursor scope. Hash shape alone grants nothing. */
import { AccessError } from "./jungsi/application/access.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import { sessionDto } from "./jungsi/application/session_service.ts";
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
  /** Independently verify the source fingerprint AND every projected display field,
   * bound to the current approved composite head and physical release. */
  classifyGuideProjections(
    context: CurrentPagePortContext,
    claims: readonly GuideProjectionClaim[],
  ): Promise<
    readonly Readonly<{ target: PhysicalKey; decision: "VERIFIED" | "HOLD" }>[]
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
export type GuideProjectionClaim = Readonly<{
  target: PhysicalKey;
  rowFingerprint: string | null;
  offering: CurrentOffering;
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
type CapturedRow = Readonly<
  { key: PublicCatalogKey; offering: CurrentOffering; fingerprint: string | null }
>;
function captureRow(raw: unknown): CapturedRow {
  const sourceKey = key(data(raw, "key")), row = data(raw, "row"), guide = data(raw, "guide");
  const target = physical(row), guideTarget = physical(guide);
  const fingerprint = data(row, "row_fingerprint", true);
  if (
    data(row, "source_kind", true) !== "current_guide" ||
    data(row, "active_service", true) === false ||
    data(guide, "active_service", true) === false ||
    data(row, "practical_required", true) === true ||
    data(guide, "practical_required", true) === true ||
    keyId(target) !== keyId(guideTarget) || sourceKey[1] !== target.school_id ||
    sourceKey[2] !== target.offering_pk || sourceKey[3] !== "" ||
    sourceKey[4] !== `2027:${target.offering_pk}` ||
    data(row, "offering_id") !== `2027:${target.offering_pk}` ||
    data(guide, "offering_id") !== `2027:${target.offering_pk}`
  ) return fail();
  return Object.freeze({
    key: sourceKey,
    fingerprint: typeof fingerprint === "string" && HASH.test(fingerprint) ? fingerprint : null,
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

function createGuideSearchPageAdapter(
  catalog: CurrentPublicCatalogPort | null,
  authority: GuideSearchAuthority | null,
  codec: GuidePositionCodec | null,
  clock: RequestClockPort,
  markHeld: (context: CurrentPagePortContext, target: PhysicalKey) => void,
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
      if (await authority.assertCurrent(context) !== undefined) return fail();
      check();
      const firstRaw = await catalog.publication();
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
      const rawPage = await catalog.search(subject, "offerings", searchQuery, before);
      check();
      const version = data(rawPage, "version"),
        head = data(rawPage, "head"),
        asOf = data(rawPage, "asOfUtc");
      const rows = dense(data(rawPage, "rows"), safeQuery.limit + 1).map(captureRow);
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
      let previous = before;
      for (const row of rows) {
        if (previous && comparePublicCatalogKeys(previous, row.key) >= 0) return fail();
        previous = row.key;
        const o = row.offering;
        if (
          !unicodeCasefold(o.university_name ?? "").includes(searchQuery.university_q) ||
          !unicodeCasefold(o.department ?? "").includes(searchQuery.department_q) ||
          searchQuery.region && unicodeCasefold(o.region ?? "") !== searchQuery.region ||
          searchQuery.group && unicodeCasefold(o.group ?? "") !== searchQuery.group
        ) return fail();
      }
      const selected = rows.slice(0, safeQuery.limit),
        keys = Object.freeze(selected.map((r) => r.offering.key));
      const unique = new Set(keys.map(keyId));
      if (unique.size !== keys.length) return fail();
      const claims = Object.freeze(selected.map((r) =>
        Object.freeze({
          target: r.offering.key,
          rowFingerprint: r.fingerprint,
          offering: r.offering,
        })
      ));
      const projections = keys.length
        ? await authority.classifyGuideProjections(context, claims)
        : [];
      check();
      const projectionSeen = new Set<string>();
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
        if (decision === "HOLD" || claim.rowFingerprint === null) markHeld(context, target);
      }
      if (projectionSeen.size !== keys.length) return fail();
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
      const classifiedKeys = Object.freeze(
        keys.filter((k) =>
          membership.get(keyId(k)) === "VERIFIED" && publicCounts.get(k.offering_pk) === 1 &&
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
        selected.filter((r) => !confirmed.has(keyId(r.offering.key))).map((r) => r.offering),
      );
      const incomplete = selected.some((r) =>
        membership.get(keyId(r.offering.key)) === "HOLD" ||
        publicCounts.get(r.offering.key.offering_pk)! > 1 ||
        unresolved.has(keyId(r.offering.key)) ||
        decisions.get(keyId(r.offering.key)) === "HOLD"
      );
      const continuation = rows.length > safeQuery.limit
        ? selected.at(-1)?.key ?? null
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
      const lastRaw = await catalog.publication();
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
): Readonly<{ authority: GuideSearchAuthority; offerings: CurrentOfferingPagePort }> {
  if (!base || !catalog || !codec || typeof base.authorizeBeforeBegin !== "function") return fail();
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
      requests.set(execution, { boundary, pins, held: new Set() });
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
        return saved.held.has(id)
          ? Object.freeze({ target, decision: "HOLD" as const, quota: null })
          : Object.freeze({
            target,
            decision,
            quota: data(item, "quota") as QuotaDecision["quota"],
          });
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
    offerings: createGuideSearchPageAdapter(catalog, authority, codec, clock, markHeld),
  });
}
