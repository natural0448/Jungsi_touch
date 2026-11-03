/** REVIEW ONLY: bounded matcher over a private candidate index. It does not issue
 * production approval, load DB/Storage, define routes, or validate review docs. */
import { AccessError } from "./jungsi/application/access.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import { sessionDto } from "./jungsi/application/session_service.ts";
import { parseNativeJson } from "./jungsi/domain/native_json.ts";
import type {
  CurrentPagePortContext,
  PhysicalKey,
} from "./jungsi/application/history_current_page.ts";
import type {
  GuideProjectionClaim,
  GuideSearchAuthority,
} from "./current_2027_guide_search_review_only.ts";

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATE = /^[A-Z0-9_]{1,128}$/;
const fail = (): never => {
  throw new AccessError("scope_evidence_unavailable", 503);
};
type Scope = "CONFIRMED" | "HOLD" | "EXCLUDE";
type Practice = "NON_PRACTICAL" | "HOLD" | "EXCLUDE";
type SourceHashes = Readonly<
  { source: string; rowox: string; v20: string; coverage: string; lineage: string }
>;
type Candidate = Readonly<{
  target: PhysicalKey;
  rowFingerprint: string;
  sourceSnapshot: string;
  snapshotLine: number;
  lineage: Readonly<{
    recruitment_fact: string;
    scope_state: string;
    local_membership_candidate: number | null;
    prior_scope: string;
    scope254: string;
    user_hold: number;
    original_final_carryover_only_hold: number;
  }>;
  references: Readonly<
    {
      coverage_row_0based: number;
      rowox_row_0based: number | null;
      v20_entry_0based: number | null;
    }
  >;
}>;
type IndexEntry =
  & Omit<Candidate, "target" | "rowFingerprint" | "sourceSnapshot">
  & Readonly<{ rowFingerprint: string }>;
/** Implemented by an independently authorized server provider, not by the
 * index itself or the client. Bind the exact index and pre-existing review refs
 * to the actual current composite Guide head and request; verify review documents
 * and issuer without inventing authorization from a hash/status/count. `review`
 * evaluates the whole page in one bounded batch; it must keep current enrollment,
 * practical scope, final rollover and historical relation evidence separate. */
export interface LocalScopeReviewTrust {
  authorizeBeforeIO(context: CurrentPagePortContext): void;
  assertCurrent(context: CurrentPagePortContext): Promise<void>;
  bindIndex(
    context: CurrentPagePortContext,
    indexSha256: string,
    sourceHashes: SourceHashes,
  ): Promise<void>;
  review(context: CurrentPagePortContext, candidates: readonly Candidate[]): Promise<
    readonly Readonly<{ target: PhysicalKey; enrollment: Scope; practical: Practice }>[]
  >;
}
function record(v: unknown): Record<string, unknown> {
  if (
    !v || typeof v !== "object" || Array.isArray(v) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  ) return fail();
  return v as Record<string, unknown>;
}
function own(v: unknown, name: string): unknown {
  const d = Object.getOwnPropertyDescriptor(record(v), name);
  if (!d || !("value" in d)) return fail();
  return d.value;
}
function exact(v: unknown, names: readonly string[]): Record<string, unknown> {
  const o = record(v), keys = Reflect.ownKeys(o);
  if (
    keys.length !== names.length || keys.some((x) => typeof x !== "string" || !names.includes(x))
  ) return fail();
  for (const name of names) own(o, name);
  return o;
}
function text(v: unknown, pattern: RegExp): string {
  if (typeof v !== "string" || !pattern.test(v)) return fail();
  return v;
}
function number(v: unknown, nullable = false): number | null {
  if (nullable && v === null) return null;
  if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > 10_000_000) return fail();
  return v as number;
}
function physical(v: unknown): PhysicalKey {
  const o = exact(v, ["release_id", "academic_year", "offering_pk", "school_id"]);
  if (o.academic_year !== 2027) return fail();
  return Object.freeze({
    release_id: text(o.release_id, ID),
    academic_year: 2027,
    offering_pk: text(o.offering_pk, ID),
    school_id: text(o.school_id, ID),
  });
}
const physicalId = (k: PhysicalKey) =>
  JSON.stringify([k.release_id, k.academic_year, k.school_id, k.offering_pk]);
async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
function parseEntry(value: unknown): IndexEntry {
  const v = exact(value, [
    "source_row_sha256",
    "snapshot_line_1based",
    "lineage_candidate",
    "references",
  ]);
  const l = exact(v.lineage_candidate, [
    "recruitment_fact",
    "scope_state",
    "local_membership_candidate",
    "prior_scope",
    "scope254",
    "user_hold",
    "original_final_carryover_only_hold",
  ]);
  const ref = exact(v.references, ["coverage_row_0based", "rowox_row_0based", "v20_entry_0based"]);
  const userHold = number(l.user_hold),
    carryoverHold = number(l.original_final_carryover_only_hold),
    member = number(l.local_membership_candidate, true),
    line = number(v.snapshot_line_1based);
  if (
    ![0, 1].includes(userHold!) || ![0, 1].includes(carryoverHold!) ||
    (member !== null && member !== 1) || !line
  ) return fail();
  return Object.freeze({
    rowFingerprint: text(v.source_row_sha256, HASH),
    snapshotLine: line,
    lineage: Object.freeze({
      recruitment_fact: text(l.recruitment_fact, STATE),
      scope_state: text(l.scope_state, STATE),
      local_membership_candidate: member,
      prior_scope: text(l.prior_scope, STATE),
      scope254: text(l.scope254, STATE),
      user_hold: userHold!,
      original_final_carryover_only_hold: carryoverHold!,
    }),
    references: Object.freeze({
      coverage_row_0based: number(ref.coverage_row_0based)!,
      rowox_row_0based: number(ref.rowox_row_0based, true),
      v20_entry_0based: number(ref.v20_entry_0based, true),
    }),
  });
}
/** The byte buffer is already supplied by a trusted server composition; this
 * factory itself performs no file or network access and grants no rights. */
export async function createLocalScopeCandidateMatcher(
  bytes: Uint8Array,
  expectedSha256: string,
  trust: LocalScopeReviewTrust | null,
  clock: RequestClockPort,
): Promise<Pick<GuideSearchAuthority, "verifyGuideScope">> {
  if (
    !(bytes instanceof Uint8Array) || bytes.byteLength < 2 || bytes.byteLength > 8 * 1024 * 1024 ||
    bytes.buffer instanceof SharedArrayBuffer || !HASH.test(expectedSha256) || !trust ||
    typeof trust.authorizeBeforeIO !== "function" || typeof trust.assertCurrent !== "function" ||
    typeof trust.bindIndex !== "function" || typeof trust.review !== "function"
  ) return fail();
  const stable = new Uint8Array(bytes);
  if (await hash(stable) !== expectedSha256) return fail();
  let parsed: unknown;
  try {
    parsed = parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(stable));
  } catch {
    return fail();
  }
  const root = exact(parsed, [
    "format",
    "authorization",
    "key_scheme",
    "snapshot_scope",
    "source_hashes",
    "rows",
  ]);
  if (
    root.format !== "jungsi.p1-private-scope-evidence-candidate/v1" ||
    root.authorization !== "NONE_REVIEW_ONLY" ||
    root.key_scheme !== "sha256_utf8_compact_json_array_release_year_school_offering" ||
    root.snapshot_scope !== "LOCAL_SNAPSHOT_ONLY_NOT_CURRENT_HEAD"
  ) return fail();
  const hashes = exact(root.source_hashes, ["source", "rowox", "v20", "coverage", "lineage"]);
  const sourceHashes = Object.freeze({
    source: text(hashes.source, HASH),
    rowox: text(hashes.rowox, HASH),
    v20: text(hashes.v20, HASH),
    coverage: text(hashes.coverage, HASH),
    lineage: text(hashes.lineage, HASH),
  });
  const rawRows = record(root.rows), keys = Reflect.ownKeys(rawRows);
  if (keys.length > 10_000 || keys.some((k) => typeof k !== "string" || !HASH.test(k))) {
    return fail();
  }
  const rows = new Map<string, IndexEntry>();
  for (const k of keys as string[]) rows.set(k, parseEntry(own(rawRows, k)));
  return Object.freeze({
    async verifyGuideScope(
      context: CurrentPagePortContext,
      claims: readonly GuideProjectionClaim[],
    ) {
      if (
        !context || context.execution?.operation !== "history.current-page" ||
        !context.execution.session?.user ||
        !context.boundary?.admission || !(context.boundary.signal instanceof AbortSignal) ||
        context.boundary.signal.aborted ||
        !context.pins || !Array.isArray(claims) || claims.length > 100
      ) return fail();
      const execution = context.execution,
        session = execution.session,
        user = session.user,
        boundary = context.boundary,
        signal = boundary.signal,
        admission = boundary.admission,
        pins = context.pins,
        query = execution.query,
        subject = user.subjectId,
        expires = user.expiresAtUtc,
        evaluated = session.evaluatedAtUtc,
        tier = session.tier,
        paidUntil = session.paidUntilUtc;
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
      const pinned = Object.freeze(Object.fromEntries(pinNames.map((k) => [k, own(pins, k)])));
      const queryKeys = Reflect.ownKeys(record(query));
      const querySnapshot = Object.freeze(queryKeys.map((k) => {
        if (typeof k !== "string") return fail();
        return Object.freeze([k, own(query, k)] as const);
      }));
      const check = () => {
        if (
          context.execution !== execution || execution.operation !== "history.current-page" ||
          execution.session !== session ||
          session.user !== user || user.subjectId !== subject || user.expiresAtUtc !== expires ||
          session.evaluatedAtUtc !== evaluated ||
          session.tier !== tier || session.paidUntilUtc !== paidUntil ||
          context.boundary !== boundary ||
          boundary.signal !== signal || signal.aborted || boundary.admission !== admission ||
          context.pins !== pins ||
          pinNames.some((k) => own(pins, k) !== pinned[k]) || execution.query !== query ||
          Reflect.ownKeys(query).length !== querySnapshot.length || querySnapshot.some(([k, v]) =>
            own(query, k) !== v
          ) ||
          typeof pinned.expires_at_utc !== "bigint" || clock.nowUtc() >= pinned.expires_at_utc ||
          pinned.subject !== subject
        ) return fail();
        sessionDto(session, clock.nowUtc());
      };
      const targets = claims.map((claim) => {
        const target = physical(own(claim, "target")), fingerprint = own(claim, "rowFingerprint");
        if (
          fingerprint !== null && (typeof fingerprint !== "string" || !HASH.test(fingerprint))
        ) return fail();
        return Object.freeze({ target, fingerprint });
      });
      if (new Set(targets.map((x) => physicalId(x.target))).size !== targets.length) return fail();
      const permit = () => {
        check();
        if (trust.authorizeBeforeIO(context) !== undefined) return fail();
        check();
      };
      permit();
      if (await trust.assertCurrent(context) !== undefined) return fail();
      permit();
      if (await trust.bindIndex(context, expectedSha256, sourceHashes) !== undefined) return fail();
      check();
      const ids = await Promise.all(
        targets.map((x) => hash(new TextEncoder().encode(physicalId(x.target)))),
      );
      check();
      const eligible: Candidate[] = [];
      for (let i = 0; i < targets.length; i++) {
        const entry = rows.get(ids[i]);
        if (
          !entry || entry.rowFingerprint !== targets[i].fingerprint || entry.lineage.user_hold === 1
        ) continue;
        eligible.push(
          Object.freeze({
            target: targets[i].target,
            rowFingerprint: entry.rowFingerprint,
            sourceSnapshot: sourceHashes.source,
            snapshotLine: entry.snapshotLine,
            lineage: entry.lineage,
            references: entry.references,
          }),
        );
      }
      let decisions: Awaited<ReturnType<LocalScopeReviewTrust["review"]>> = [];
      if (eligible.length) {
        permit();
        decisions = await trust.review(context, Object.freeze(eligible));
      }
      check();
      if (!Array.isArray(decisions) || decisions.length !== eligible.length) return fail();
      const allowed = new Set(eligible.map((x) => physicalId(x.target))),
        verdicts = new Map<string, { enrollment: Scope; practical: Practice }>();
      for (const raw of decisions) {
        const target = physical(own(raw, "target")),
          id = physicalId(target),
          enrollment = own(raw, "enrollment"),
          practical = own(raw, "practical");
        if (
          !allowed.has(id) || verdicts.has(id) || typeof enrollment !== "string" ||
          !["CONFIRMED", "HOLD", "EXCLUDE"].includes(enrollment) ||
          typeof practical !== "string" || !["NON_PRACTICAL", "HOLD", "EXCLUDE"].includes(practical)
        ) return fail();
        verdicts.set(id, { enrollment: enrollment as Scope, practical: practical as Practice });
      }
      permit();
      if (await trust.assertCurrent(context) !== undefined) return fail();
      check();
      return Object.freeze(targets.map(({ target }) =>
        Object.freeze({
          target,
          ...(verdicts.get(physicalId(target)) ??
            { enrollment: "HOLD" as const, practical: "HOLD" as const }),
        })
      ));
    },
  });
}
