/** REVIEW ONLY. No runtime route, real descriptor authority, DB, Storage or publication.
 * Every pin must be issued independently for this same admitted request. A matching
 * hash, local file, status string, or permissive mock is not proof of approval. */
import {
  bindReviewedR27Scope,
  combineReviewedR27Scopes,
  projectStandaloneR27Row,
  type ReviewedR27Scope,
  reviewR27AbsentCampusScope,
} from "./r27_standalone.ts";
import { nativeJsonSha256 } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { hasAsciiControl } from "../domain/text.ts";

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_CLAIMS = 101;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const fail = (): never => {
  throw new Error("reviewed_scope_unavailable");
};

export type ScopeTarget = Readonly<{
  release_id: string;
  academic_year: number;
  school_id: string;
  offering_pk: string;
}>;
export type ScopeClaim = Readonly<{
  target: ScopeTarget;
  rowFingerprint: string | null;
  offering: Readonly<{
    campus: string | null;
    admission_track: string | null;
    group: string | null;
  }>;
}>;
export type ScopeDecision = Readonly<{
  target: ScopeTarget;
  enrollment: "CONFIRMED" | "HOLD";
  practical: "NON_PRACTICAL" | "EXCLUDE" | "HOLD";
  enrollment_basis?: "unknown" | "rollover_only_pending";
  /** Internal only. The existing direct DTO does not yet expose this status. */
  campus_state?: "unknown" | "confirmed_null" | "confirmed_value";
  /** Internal display value; absent/unknown does not mean confirmed null. */
  campus_value?: string | null;
  campus_origin?: "unknown" | "source" | "separate_grant";
}>;
export type ScopeRequest = Readonly<{
  execution: Readonly<{
    operation: string;
    session: Readonly<{ user: Readonly<{ subjectId: string }> }>;
  }>;
  boundary: Readonly<{ signal: AbortSignal; admission?: unknown }>;
  pins: Readonly<{
    subject: string;
    guide_head_sha256: string;
    guide_publication_sha256: string;
  }>;
}>;
export type ApprovedScopePin = Readonly<{
  manifest_sha256: string;
  source_sha256: string;
  source_head_sha256: string;
  guide_head_sha256: string;
  guide_publication_sha256: string;
}>;
/** Must be implemented by the real server's independent approval authority. It
 * authenticates subject, route, relay, active admission, descriptor provenance,
 * current source/head, publication, revocation and exact manifest pin. Null means
 * no approved scope. Failures/aborts must throw; they are not a successful HOLD. */
export interface IndependentScopeAuthority {
  authorize(request: ScopeRequest): Promise<ApprovedScopePin | null>;
  assertCurrent(request: ScopeRequest, pin: ApprovedScopePin): Promise<void>;
}
/** A synchronous, local server guard must verify the actual budget issuer,
 * original request and active admission. Merely comparing object identities,
 * a synthetic implementation or a shape check is not an operating guarantee. */
export interface ActiveScopeAdmissionGuard {
  assertActive(request: ScopeRequest): void;
}
/** A single bounded batch read under the same active admission. This review-only
 * interface does not enforce actual physical I/O, timeout, RLS or cancellation. */
export interface ScopeEvidenceReader {
  read(
    request: ScopeRequest,
    pin: ApprovedScopePin,
    claims: readonly ScopeClaim[],
  ): Promise<
    Readonly<{
      manifest: Uint8Array;
      sourcePages: readonly Uint8Array[];
      receipts: readonly Uint8Array[];
    }>
  >;
}
/** Optional, independently authorized campus grant. It verifies the exact
 * request/admission, physical PK, Guide head, source-page presence, separate grant
 * provenance and expiry/revocation; a SHA or mock status is not an approval.
 * Missing evidence is returned as unknown and never changes enrollment/scope. */
export interface SeparateCampusGrantAuthority {
  classify(
    request: ScopeRequest,
    pin: ApprovedScopePin,
    claims: readonly Readonly<
      {
        target: ScopeTarget;
        guide_campus: string | null;
        guide_row_sha256: string;
        source_page_sha256: string;
        source_row_sha256: string;
        source_campus_presence: "missing" | "null" | "value";
        source_campus: string | null;
      }
    >[],
  ): Promise<
    readonly Readonly<
      {
        target: ScopeTarget;
        state: "unknown" | "confirmed_null" | "confirmed_value";
        value: string | null;
        provenance_sha256: string | null;
        guide_presence: "missing" | "null" | "value";
      }
    >[] | null
  >;
  assertCurrent(request: ScopeRequest, pin: ApprovedScopePin): Promise<void>;
}
/** Independently verify that an exact approved source row has no base intake,
 * is conditional-only and the official rollover is not confirmed. This must
 * authenticate real evidence and the same request, subject, source/head, Guide
 * head and row pins; manifest labels, hashes and synthetic mocks are not proof. */
export interface IndependentConditionalOnlyAuthority {
  classify(
    request: ScopeRequest,
    pin: ApprovedScopePin,
    claims: readonly Readonly<{
      target: ScopeTarget;
      guide_row_sha256: string;
      source_page_sha256: string;
      source_row_sha256: string;
      enrollment_evidence_sha256: string;
    }>[],
  ): Promise<
    readonly Readonly<{ target: ScopeTarget; decision: "VERIFIED_PENDING" | "UNKNOWN" }>[] | null
  >;
  assertCurrent(request: ScopeRequest, pin: ApprovedScopePin): Promise<void>;
}
type Obj = Record<string, unknown>;
function data(raw: unknown, name: string): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw instanceof JsonFloat) {
    return fail();
  }
  const d = Object.getOwnPropertyDescriptor(raw, name);
  if (!d || !("value" in d) || !d.enumerable) return fail();
  return d.value;
}
function record(raw: unknown, names: readonly string[]): Obj {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw instanceof JsonFloat) {
    return fail();
  }
  const keys = Reflect.ownKeys(raw);
  if (
    keys.length !== names.length || keys.some((x) => typeof x !== "string" || !names.includes(x))
  ) return fail();
  return Object.fromEntries(names.map((k) => [k, data(raw, k)]));
}
function array(raw: unknown, max: number): unknown[] {
  if (!Array.isArray(raw)) return fail();
  const len = Object.getOwnPropertyDescriptor(raw, "length")?.value;
  if (
    !Number.isSafeInteger(len) || len < 0 || len > max || Reflect.ownKeys(raw).length !== len + 1
  ) return fail();
  const out: unknown[] = [];
  for (let i = 0; i < len; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!d || !("value" in d) || !d.enumerable) return fail();
    out.push(d.value);
  }
  return out;
}
function target(raw: unknown): ScopeTarget {
  const t = record(raw, ["release_id", "academic_year", "school_id", "offering_pk"]);
  if (
    t.academic_year !== 2027 ||
    [t.release_id, t.school_id, t.offering_pk].some((v) => typeof v !== "string" || !ID.test(v))
  ) return fail();
  return Object.freeze(t as unknown as ScopeTarget);
}
const key = (t: ScopeTarget) =>
  JSON.stringify([t.release_id, t.academic_year, t.school_id, t.offering_pk]);
const isHash = (v: unknown): v is string => typeof v === "string" && HASH.test(v);
function snapshot(raw: unknown, max: number): Uint8Array<ArrayBuffer> {
  const lengthGetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;
  if (!(raw instanceof Uint8Array) || !lengthGetter) return fail();
  const length = Reflect.apply(lengthGetter, raw, []) as number;
  if (!Number.isSafeInteger(length) || length <= 0 || length > max) return fail();
  const copy = new Uint8Array(new ArrayBuffer(length));
  Uint8Array.prototype.set.call(copy, raw);
  return copy;
}
async function digest(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw.buffer))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}
function decode(bytes: Uint8Array<ArrayBuffer>): unknown {
  return parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function pin(raw: unknown): ApprovedScopePin {
  const fields = [
    "manifest_sha256",
    "source_sha256",
    "source_head_sha256",
    "guide_head_sha256",
    "guide_publication_sha256",
  ] as const;
  const p = record(raw, fields);
  if (fields.some((f) => !isHash(p[f]))) return fail();
  return Object.freeze(p as unknown as ApprovedScopePin);
}
function hold(t: ScopeTarget): ScopeDecision {
  return Object.freeze({ target: t, enrollment: "HOLD", practical: "HOLD" });
}
function captureClaim(raw: unknown): ScopeClaim {
  const t = target(data(raw, "target")),
    fingerprint = data(raw, "rowFingerprint"),
    offering = data(raw, "offering");
  const fields = ["campus", "admission_track", "group"] as const;
  const identity = Object.fromEntries(fields.map((f) => [f, data(offering, f)]));
  if (fingerprint !== null && !isHash(fingerprint)) {
    return Object.freeze({
      target: t,
      rowFingerprint: null,
      offering: identity as ScopeClaim["offering"],
    });
  }
  if (fields.some((f) => identity[f] !== null && typeof identity[f] !== "string")) return fail();
  return Object.freeze({
    target: t,
    rowFingerprint: fingerprint as string | null,
    offering: Object.freeze(identity) as ScopeClaim["offering"],
  });
}

/** Structural verifyGuideScope candidate for the direct Guide adapter. The outer
 * service must supply claims from the independently verified Guide read, not HTTP. */
export class CurrentGuideReviewedScopeIssuer {
  constructor(
    private readonly authority: IndependentScopeAuthority,
    private readonly reader: ScopeEvidenceReader,
    private readonly admissionGuard: ActiveScopeAdmissionGuard,
    private readonly campusAuthority: SeparateCampusGrantAuthority | null = null,
    private readonly conditionalAuthority: IndependentConditionalOnlyAuthority | null = null,
  ) {}

  async verifyGuideScope(
    ctx: ScopeRequest,
    rawClaims: readonly ScopeClaim[],
  ): Promise<readonly ScopeDecision[]> {
    if (
      !ctx || !this.authority || !this.reader || !this.admissionGuard ||
      typeof this.authority.authorize !== "function" ||
      typeof this.authority.assertCurrent !== "function" ||
      typeof this.reader.read !== "function" ||
      typeof this.admissionGuard.assertActive !== "function"
    ) return fail();
    const execution = ctx.execution,
      session = execution?.session,
      user = session?.user,
      boundary = ctx.boundary,
      signal = boundary?.signal,
      admission = boundary?.admission,
      pins = ctx.pins;
    if (
      !execution || execution.operation !== "history.current-page" || !user ||
      typeof user.subjectId !== "string" || !(signal instanceof AbortSignal) || signal.aborted ||
      admission == null || !pins || pins.subject !== user.subjectId ||
      !isHash(pins.guide_head_sha256) || !isHash(pins.guide_publication_sha256)
    ) return fail();
    const subject = user.subjectId,
      guideHead = pins.guide_head_sha256,
      publication = pins.guide_publication_sha256;
    const check = () => {
      if (
        ctx.execution !== execution || execution.operation !== "history.current-page" ||
        execution.session !== session || session.user !== user || user.subjectId !== subject ||
        ctx.boundary !== boundary || boundary.signal !== signal || signal.aborted ||
        boundary.admission !== admission || ctx.pins !== pins || pins.subject !== subject ||
        pins.guide_head_sha256 !== guideHead || pins.guide_publication_sha256 !== publication
      ) return fail();
    };
    const active = () => {
      check();
      if (this.admissionGuard.assertActive(ctx) !== undefined) return fail();
      check();
    };
    const claims = Object.freeze(array(rawClaims, MAX_CLAIMS).map(captureClaim));
    const counts = new Map<string, number>();
    for (const c of claims) counts.set(key(c.target), (counts.get(key(c.target)) ?? 0) + 1);
    active();
    const approved = await this.authority.authorize(ctx);
    active();
    if (approved === null) return Object.freeze(claims.map((c) => hold(c.target)));
    const p = pin(approved);
    if (p.guide_head_sha256 !== guideHead || p.guide_publication_sha256 !== publication) {
      return Object.freeze(claims.map((c) => hold(c.target)));
    }
    active();
    if (await this.authority.assertCurrent(ctx, p) !== undefined) return fail();
    active();
    const bundle = await this.reader.read(ctx, p, claims);
    active();
    const root = record(bundle, ["manifest", "sourcePages", "receipts"]);
    const manifestBytes = snapshot(root.manifest, 8 * 1024 * 1024);
    const pages = array(root.sourcePages, 64).map((v) => snapshot(v, 2 * 1024 * 1024));
    const receipts = array(root.receipts, 128).map((v) => snapshot(v, 131072));
    if (
      manifestBytes.length + pages.reduce((n, b) => n + b.length, 0) +
          receipts.reduce((n, b) => n + b.length, 0) > MAX_TOTAL_BYTES
    ) return fail();
    if (await digest(manifestBytes) !== p.manifest_sha256) {
      active();
      return Object.freeze(claims.map((c) => hold(c.target)));
    }
    let entries: unknown[];
    try {
      const m = record(decode(manifestBytes), [
        "format",
        "status",
        "source_sha256",
        "source_head_sha256",
        "guide_head_sha256",
        "guide_publication_sha256",
        "entries",
      ]);
      if (
        m.format !== "jungsi.reviewed-current-guide-scope/v1" || m.status !== "approved" ||
        m.source_sha256 !== p.source_sha256 || m.source_head_sha256 !== p.source_head_sha256 ||
        m.guide_head_sha256 !== guideHead || m.guide_publication_sha256 !== publication
      ) throw new Error("manifest_mismatch");
      entries = array(m.entries, 20000);
    } catch {
      active();
      return Object.freeze(claims.map((c) => hold(c.target)));
    }
    const index = new Map<string, Obj | null>();
    for (const raw of entries) {
      try {
        const names = [
          "target",
          "guide_head_sha256",
          "guide_row_sha256",
          "source_page_sha256",
          "source_row_sha256",
          "scope_receipt_sha256",
          "enrollment",
          "enrollment_evidence_sha256",
          "identity_states",
          "user_hold",
        ];
        if (raw && typeof raw === "object" && Object.hasOwn(raw, "identity_binding")) {
          names.push("identity_binding");
        }
        const e = record(raw, names);
        const id = key(target(e.target));
        if (index.has(id)) index.set(id, null);
        else index.set(id, e);
      } catch { /* An unreadable target never becomes an approved match. */ }
    }
    const pageMap = new Map<string, unknown>();
    for (const b of pages) {
      const h = await digest(b);
      try {
        const page = record(decode(b), [
          "format",
          "source_sha256",
          "source_head_sha256",
          "index",
          "rows",
        ]);
        if (
          page.format === "jungsi.r27-source-page/v1" && page.source_sha256 === p.source_sha256 &&
          page.source_head_sha256 === p.source_head_sha256 && Number.isSafeInteger(page.index)
        ) pageMap.set(h, array(page.rows, 128));
      } catch { /* Bad pages affect only targets referencing their hash. */ }
    }
    // Only hashes named in the independently pinned manifest are acceptable.
    // A caller-supplied receipt must never authorize itself by hashing its bytes.
    const allowedReceipts = new Set<string>();
    for (const claim of claims) {
      const e = index.get(key(claim.target));
      if (e && isHash(e.scope_receipt_sha256)) allowedReceipts.add(e.scope_receipt_sha256);
    }
    const scopeMap = new Map<string, ReviewedR27Scope>();
    for (const b of receipts) {
      const h = await digest(b);
      if (!allowedReceipts.has(h)) continue;
      try {
        scopeMap.set(
          h,
          await bindReviewedR27Scope(b, { receiptSha256: h, sourceSha256: p.source_sha256 }),
        );
      } catch { /* Invalid/unpublished receipts do not issue a scope. */ }
    }
    const scopes = scopeMap.size ? combineReviewedR27Scopes([...scopeMap.values()]) : undefined;
    // Preserve source campus absence. Review the original rows as one combined
    // page and once per already-pinned receipt, with no per-row storage I/O.
    const absent: { id: string; receipt: string; row: unknown }[] = [];
    for (const claim of claims) {
      const entry = index.get(key(claim.target));
      if (
        !entry || !claim.rowFingerprint || entry.guide_head_sha256 !== guideHead ||
        entry.guide_row_sha256 !== claim.rowFingerprint || !isHash(entry.source_page_sha256) ||
        !isHash(entry.source_row_sha256) || !isHash(entry.scope_receipt_sha256) ||
        !scopeMap.has(entry.scope_receipt_sha256)
      ) continue;
      const rows = pageMap.get(entry.source_page_sha256);
      if (!Array.isArray(rows)) continue;
      const matched = rows.filter((row) => {
        try {
          return data(row, "academic_year") === 2027 &&
            data(row, "school_id") === claim.target.school_id &&
            data(row, "original_pk") === claim.target.offering_pk;
        } catch {
          return false;
        }
      });
      if (
        matched.length !== 1 || !matched[0] || typeof matched[0] !== "object" ||
        Object.hasOwn(matched[0], "campus") ||
        await nativeJsonSha256(matched[0]) !== entry.source_row_sha256
      ) continue;
      try {
        const preliminary = reviewR27AbsentCampusScope(
          [matched[0]],
          p.source_sha256,
          scopeMap.get(entry.scope_receipt_sha256)!,
        )[0];
        if (
          preliminary.scope_result !== "SCOPE_CANDIDATE" &&
          preliminary.scope_result !== "SCOPE_EXCLUDED"
        ) continue;
      } catch {
        continue;
      }
      absent.push({ id: key(claim.target), receipt: entry.scope_receipt_sha256, row: matched[0] });
    }
    const absentVerdicts = new Map<string, "eligible" | "excluded">();
    if (scopes && absent.length) {
      const combined = reviewR27AbsentCampusScope(
        absent.map((x) => x.row),
        p.source_sha256,
        scopes,
      );
      const groups = new Map<string, number[]>();
      for (let i = 0; i < absent.length; i++) {
        const values = groups.get(absent[i].receipt) ?? [];
        values.push(i);
        groups.set(absent[i].receipt, values);
      }
      for (const [receipt, offsets] of groups) {
        const own = scopeMap.get(receipt)!;
        const ownVerdicts = reviewR27AbsentCampusScope(
          offsets.map((i) => absent[i].row),
          p.source_sha256,
          own,
        );
        for (let i = 0; i < offsets.length; i++) {
          const index = offsets[i],
            a = combined[index].scope_result,
            b = ownVerdicts[i].scope_result;
          if (a !== b) continue;
          if (a === "SCOPE_CANDIDATE") absentVerdicts.set(absent[index].id, "eligible");
          else if (a === "SCOPE_EXCLUDED") absentVerdicts.set(absent[index].id, "excluded");
        }
      }
    }
    const result: ScopeDecision[] = [];
    const conditionalClaims: {
      target: ScopeTarget;
      guide_row_sha256: string;
      source_page_sha256: string;
      source_row_sha256: string;
      enrollment_evidence_sha256: string;
    }[] = [];
    const campusClaims: {
      target: ScopeTarget;
      guide_campus: string | null;
      guide_row_sha256: string;
      source_page_sha256: string;
      source_row_sha256: string;
      source_campus_presence: "missing" | "null" | "value";
      source_campus: string | null;
    }[] = [];
    for (const claim of claims) {
      const t = claim.target, e = index.get(key(t));
      let decision: ScopeDecision = hold(t);
      try {
        if (
          !e || counts.get(key(t)) !== 1 || !claim.rowFingerprint ||
          e.guide_head_sha256 !== guideHead || e.guide_row_sha256 !== claim.rowFingerprint ||
          !isHash(e.source_page_sha256) || !isHash(e.source_row_sha256) ||
          !isHash(e.scope_receipt_sha256) ||
          !["CONFIRMED", "ROLLOVER_ONLY_PENDING"].includes(e.enrollment as string) ||
          !isHash(e.enrollment_evidence_sha256) || e.user_hold !== false ||
          !scopeMap.has(e.scope_receipt_sha256) || !scopes
        ) throw new Error("unverified");
        const states = record(e.identity_states, ["campus", "admission_track", "group"]);
        const rows = pageMap.get(e.source_page_sha256);
        if (!Array.isArray(rows)) throw new Error("unverified");
        const matches = rows.filter((row) => {
          try {
            return data(row, "academic_year") === 2027 && data(row, "school_id") === t.school_id &&
              data(row, "original_pk") === t.offering_pk;
          } catch {
            return false;
          }
        });
        if (matches.length !== 1 || await nativeJsonSha256(matches[0]) !== e.source_row_sha256) {
          throw new Error("unverified");
        }
        const source = matches[0];
        for (const field of ["admission_track", "group"] as const) {
          const v = data(source, field);
          if (
            v !== claim.offering[field] ||
            states[field] !== (v === null ? "confirmed_null" : "confirmed_value")
          ) throw new Error("unverified_identity");
        }
        const hasCampus = !!source && typeof source === "object" && Object.hasOwn(source, "campus");
        const campus = hasCampus ? data(source, "campus") : null;
        let campusState: "unknown" | "confirmed_null" | "confirmed_value";
        if (states.campus === "unknown") {
          const binding = record(e.identity_binding, [
            "physical_pk",
            "source_scope",
            "evidence_sha256",
          ]);
          if (
            campus !== null || binding.physical_pk !== "verified_unique" ||
            binding.source_scope !== "verified_unique" || !isHash(binding.evidence_sha256)
          ) {
            throw new Error("unverified_identity");
          }
          campusState = "unknown";
        } else {
          if (
            !hasCampus || campus !== claim.offering.campus ||
            states.campus !== (campus === null ? "confirmed_null" : "confirmed_value")
          ) {
            throw new Error("unverified_identity");
          }
          campusState = campus === null ? "confirmed_null" : "confirmed_value";
        }
        // Explicit source campus uses the existing six-field projector. An
        // absent key is reviewed by the sealed five-field scope without editing
        // or manufacturing a campus value in the source row.
        let disposition: "eligible" | "excluded" | undefined;
        if (!hasCampus) disposition = absentVerdicts.get(key(t));
        else {
          const own = scopeMap.get(e.scope_receipt_sha256)!;
          const projected = projectStandaloneR27Row(source, undefined, p.source_sha256, scopes);
          const ownProjection = projectStandaloneR27Row(source, undefined, p.source_sha256, own);
          if (projected.disposition !== ownProjection.disposition) {
            throw new Error("scope_conflict");
          }
          if (projected.disposition === "eligible" || projected.disposition === "excluded") {
            disposition = projected.disposition;
          }
        }
        if (disposition === "eligible" && e.enrollment === "ROLLOVER_ONLY_PENDING") {
          conditionalClaims.push(
            Object.freeze({
              target: t,
              guide_row_sha256: claim.rowFingerprint!,
              source_page_sha256: e.source_page_sha256 as string,
              source_row_sha256: e.source_row_sha256 as string,
              enrollment_evidence_sha256: e.enrollment_evidence_sha256 as string,
            }),
          );
        }
        if (disposition === "eligible" && e.enrollment === "CONFIRMED") {
          decision = Object.freeze({
            target: t,
            enrollment: "CONFIRMED",
            practical: "NON_PRACTICAL",
            campus_state: campusState,
            campus_value: campusState === "confirmed_value" ? campus as string : null,
            campus_origin: campusState === "unknown" ? "unknown" : "source",
          });
        }
        if (disposition === "excluded" && e.enrollment === "CONFIRMED") {
          decision = Object.freeze({
            target: t,
            enrollment: "CONFIRMED",
            practical: "EXCLUDE",
            campus_state: campusState,
            campus_value: campusState === "confirmed_value" ? campus as string : null,
            campus_origin: campusState === "unknown" ? "unknown" : "source",
          });
        }
        if (campusState === "unknown" && decision.enrollment === "CONFIRMED") {
          campusClaims.push(Object.freeze({
            target: t,
            guide_campus: claim.offering.campus,
            guide_row_sha256: claim.rowFingerprint!,
            source_page_sha256: e.source_page_sha256 as string,
            source_row_sha256: e.source_row_sha256 as string,
            source_campus_presence: !hasCampus ? "missing" : campus === null ? "null" : "value",
            source_campus: campus as string | null,
          }));
        }
      } catch { /* Each unverified row is held independently. */ }
      result.push(decision);
    }
    // A second independent issuer must explicitly verify the narrow pending
    // basis. Any earlier issuer HOLD, missing authority or malformed proof stays
    // ordinary HOLD, even if the separate source-pair authority disagrees.
    if (this.conditionalAuthority && conditionalClaims.length) {
      if (
        typeof this.conditionalAuthority.classify !== "function" ||
        typeof this.conditionalAuthority.assertCurrent !== "function"
      ) return fail();
      active();
      const raw = await this.conditionalAuthority.classify(
        ctx,
        p,
        Object.freeze(conditionalClaims),
      );
      active();
      if (raw !== null) {
        const expected = new Set(conditionalClaims.map((c) => key(c.target)));
        const verified = new Map<string, boolean>();
        for (const item of array(raw, MAX_CLAIMS)) {
          let id: string;
          try {
            id = key(target(data(item, "target")));
          } catch {
            continue;
          }
          if (!expected.has(id)) continue;
          if (verified.has(id)) {
            verified.set(id, false);
            continue;
          }
          try {
            const proof = record(item, ["target", "decision"]);
            verified.set(id, proof.decision === "VERIFIED_PENDING");
          } catch {
            verified.set(id, false);
          }
        }
        for (let i = 0; i < result.length; i++) {
          if (verified.get(key(result[i].target)) === true) {
            result[i] = Object.freeze({
              ...hold(result[i].target),
              enrollment_basis: "rollover_only_pending",
            });
          }
        }
      }
      active();
      if (await this.conditionalAuthority.assertCurrent(ctx, p) !== undefined) return fail();
      active();
    }
    // Scope and campus are independent. A separately verified campus grant may
    // supply a value when the source page omits campus. Without that authority,
    // retain the row with an unknown campus; never convert unknown to confirmed null.
    if (this.campusAuthority && campusClaims.length) {
      if (
        typeof this.campusAuthority.classify !== "function" ||
        typeof this.campusAuthority.assertCurrent !== "function"
      ) return fail();
      active();
      const raw = await this.campusAuthority.classify(ctx, p, Object.freeze(campusClaims));
      active();
      if (raw !== null) {
        const eligible = new Map(campusClaims.map((c) => [key(c.target), c]));
        const grants = new Map<
          string,
          { state: "confirmed_null" | "confirmed_value"; value: string | null } | null
        >();
        for (const rawGrant of array(raw, MAX_CLAIMS)) {
          let id: string;
          try {
            id = key(target(data(rawGrant, "target")));
          } catch {
            continue;
          }
          const claim = eligible.get(id);
          if (!claim) continue;
          if (grants.has(id)) {
            grants.set(id, null);
            continue;
          }
          try {
            const g = record(rawGrant, [
              "target",
              "state",
              "value",
              "provenance_sha256",
              "guide_presence",
            ]);
            if (g.state === "unknown") {
              grants.set(id, null);
              continue;
            }
            if (!isHash(g.provenance_sha256)) {
              grants.set(id, null);
              continue;
            }
            if (
              g.state === "confirmed_null" && g.value === null && claim.guide_campus === null &&
              ["missing", "null"].includes(g.guide_presence as string)
            ) {
              grants.set(id, { state: "confirmed_null", value: null });
            } else if (
              g.state === "confirmed_value" && typeof g.value === "string" &&
              g.value.length > 0 && g.value.length <= 4096 && !hasAsciiControl(g.value) &&
              ((claim.guide_campus === null && g.guide_presence === "missing") ||
                (claim.guide_campus === g.value && g.guide_presence === "value"))
            ) {
              grants.set(id, { state: "confirmed_value", value: g.value });
            } else grants.set(id, null);
          } catch {
            grants.set(id, null);
          }
        }
        for (let i = 0; i < result.length; i++) {
          if (result[i].campus_state !== "unknown") continue;
          const grant = grants.get(key(result[i].target));
          if (grant) {
            result[i] = Object.freeze({
              ...result[i],
              campus_state: grant.state,
              campus_value: grant.value,
              campus_origin: "separate_grant",
            });
          }
        }
      }
      active();
      if (await this.campusAuthority.assertCurrent(ctx, p) !== undefined) return fail();
      active();
    }
    active();
    if (await this.authority.assertCurrent(ctx, p) !== undefined) return fail();
    active();
    return Object.freeze(result);
  }
}
