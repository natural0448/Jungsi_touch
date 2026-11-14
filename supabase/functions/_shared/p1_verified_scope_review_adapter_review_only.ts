/** REVIEW ONLY. No operational authority, route, storage port or DTO is installed. */
import { AccessError } from "./jungsi/application/access.ts";
import type {
  CurrentPagePortContext,
  PhysicalKey,
} from "./jungsi/application/history_current_page.ts";
import type {
  Candidate,
  LocalScopeReviewTrust,
  SourceHashes,
} from "./p1_local_scope_matcher_review_only.ts";
import {
  type ActiveScopeAdmissionGuard,
  type ApprovedScopePin,
  CurrentGuideReviewedScopeIssuer,
  type IndependentConditionalOnlyAuthority,
  type IndependentScopeAuthority,
  type ScopeClaim,
  type ScopeEvidenceReader,
  type ScopeRequest,
  type SeparateCampusGrantAuthority,
} from "./jungsi/application/current_guide_scope_issuer.campus.review-only.ts";

const HASH = /^[a-f0-9]{64}$/;
function fail(): never {
  throw new AccessError("scope_evidence_unavailable", 503);
}
const id = (t: PhysicalKey) =>
  JSON.stringify([t.release_id, t.academic_year, t.school_id, t.offering_pk]);
const hold = (target: PhysicalKey) =>
  Object.freeze({ target, enrollment: "HOLD" as const, practical: "HOLD" as const });

/** Opaque capability: neither its shape nor a local hash constitutes approval. */
export type CandidateIndexBinding = object;
export interface IndependentCandidateIndexAuthority {
  /** Verify authenticated request, current decision scope, expiry and revocation. */
  assertRequest(context: CurrentPagePortContext): Promise<void>;
  /** Independently bind the index and its prior review sources to this request and current heads. */
  bindIndex(
    context: CurrentPagePortContext,
    digest: string,
    hashes: SourceHashes,
  ): Promise<CandidateIndexBinding | null>;
  assertBound(context: CurrentPagePortContext, binding: CandidateIndexBinding): Promise<void>;
  /** One batch of <=100. Independently rebind each candidate's indexed source and
   * existing O/X evidence to the issuer's approved source/head and the current Guide
   * physical PK, row fingerprint, school, track and group. Per-target uncertainty or
   * contradiction is HOLD; no source/null/hash/count alone grants approval. Preserve
   * explicit user HOLD. A final/carryover-only HOLD does not by itself negate an
   * independently confirmed initial enrollment. No campus ID or confirmed null is
   * inferred. The issuer remains responsible for independently reviewed scope.
   * ROLLOVER_ONLY_PENDING requires independent official evidence that this is a
   * conditional-only offering with no confirmed base intake and rollover not yet
   * officially confirmed; generic condition text, initial zero, local status or
   * missing data can never establish this decision. */
  classifySourcePair(
    context: CurrentPagePortContext,
    binding: CandidateIndexBinding,
    pin: ApprovedScopePin,
    candidates: readonly Candidate[],
  ): Promise<
    readonly Readonly<
      { target: PhysicalKey; decision: "MATCHED" | "HOLD" | "ROLLOVER_ONLY_PENDING" }
    >[]
  >;
  /** Recheck request, head/source, this exact pair authority, expiry and revocation. */
  assertPairCurrent(
    context: CurrentPagePortContext,
    binding: CandidateIndexBinding,
    pin: ApprovedScopePin,
  ): Promise<void>;
}

type State = Readonly<{ capability: CandidateIndexBinding; digest: string; hashes: SourceHashes }>;
function snapshotPin(raw: ApprovedScopePin): ApprovedScopePin {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const keys = [
    "manifest_sha256",
    "source_sha256",
    "source_head_sha256",
    "guide_head_sha256",
    "guide_publication_sha256",
  ] as const;
  if (Reflect.ownKeys(raw).length !== keys.length) return fail();
  const out: Record<string, string> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, k);
    if (
      !d || !("value" in d) || !d.enumerable || typeof d.value !== "string" || !HASH.test(d.value)
    ) return fail();
    out[k] = d.value;
  }
  return Object.freeze(out) as ApprovedScopePin;
}
function snapshotTarget(raw: unknown): PhysicalKey {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const keys = ["release_id", "academic_year", "school_id", "offering_pk"] as const;
  if (Reflect.ownKeys(raw).length !== keys.length) return fail();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, k);
    if (!d || !("value" in d) || !d.enumerable) return fail();
    out[k] = d.value;
  }
  if (
    out.academic_year !== 2027 ||
    [out.release_id, out.school_id, out.offering_pk].some((v) =>
      typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)
    )
  ) return fail();
  return Object.freeze(out) as PhysicalKey;
}

/** Keep the same execution, query, session, pins and admission throughout review.
 * This mutation guard supplements, never substitutes, the real admission guard. */
function watchRequest(ctx: CurrentPagePortContext): () => void {
  const objects: object[] = [
    ctx,
    ctx.execution,
    ctx.execution.query,
    ctx.execution.session,
    ctx.execution.session.user,
    ctx.boundary,
    ctx.pins,
  ];
  const snapshots = objects.map((object) => {
    const keys = Reflect.ownKeys(object);
    const values = keys.map((key) => {
      const d = Object.getOwnPropertyDescriptor(object, key);
      if (!d || !("value" in d) || !d.enumerable) return fail();
      return d.value;
    });
    return { object, keys, values };
  });
  return () => {
    for (const snap of snapshots) {
      const keys = Reflect.ownKeys(snap.object);
      if (keys.length !== snap.keys.length || keys.some((key, i) => key !== snap.keys[i])) {
        return fail();
      }
      for (let i = 0; i < keys.length; i++) {
        const d = Object.getOwnPropertyDescriptor(snap.object, keys[i]);
        if (!d || !("value" in d) || !d.enumerable || d.value !== snap.values[i]) return fail();
      }
    }
    if (ctx.boundary.signal.aborted) return fail();
  };
}

/** Compose once. Index bytes must already have been loaded under real pre-I/O
 * admission; no filesystem, DB or Storage loader is implemented here. */
export function createVerifiedScopeReviewTrust(
  indexAuthority: IndependentCandidateIndexAuthority | null,
  scopeAuthority: IndependentScopeAuthority | null,
  reader: ScopeEvidenceReader | null,
  guard: ActiveScopeAdmissionGuard | null,
  campusAuthority: SeparateCampusGrantAuthority | null = null,
  conditionalAuthority: IndependentConditionalOnlyAuthority | null = null,
): LocalScopeReviewTrust {
  if (
    !indexAuthority || !scopeAuthority || !reader || !guard ||
    typeof indexAuthority.assertRequest !== "function" ||
    typeof indexAuthority.bindIndex !== "function" ||
    typeof indexAuthority.assertBound !== "function" ||
    typeof indexAuthority.classifySourcePair !== "function" ||
    typeof indexAuthority.assertPairCurrent !== "function" ||
    typeof scopeAuthority.authorize !== "function" ||
    typeof scopeAuthority.assertCurrent !== "function" || typeof reader.read !== "function" ||
    typeof guard.assertActive !== "function" ||
    campusAuthority !== null &&
      (typeof campusAuthority.classify !== "function" ||
        typeof campusAuthority.assertCurrent !== "function") ||
    conditionalAuthority !== null &&
      (typeof conditionalAuthority.classify !== "function" ||
        typeof conditionalAuthority.assertCurrent !== "function")
  ) return fail();
  const states = new WeakMap<CurrentPagePortContext, State>();
  const bindingInProgress = new WeakSet<CurrentPagePortContext>();
  const active = (ctx: CurrentPagePortContext) => {
    if (guard.assertActive(ctx) !== undefined) return fail();
  };
  const assertBound = async (ctx: CurrentPagePortContext, state: State, check: () => void) => {
    check();
    active(ctx);
    check();
    if (await indexAuthority.assertBound(ctx, state.capability) !== undefined) return fail();
    check();
    active(ctx);
    check();
  };
  return Object.freeze({
    authorizeBeforeIO(ctx: CurrentPagePortContext) {
      active(ctx);
    },
    async assertCurrent(ctx: CurrentPagePortContext) {
      const check = watchRequest(ctx);
      check();
      active(ctx);
      check();
      const state = states.get(ctx);
      if (state) await assertBound(ctx, state, check);
      else {
        if (await indexAuthority.assertRequest(ctx) !== undefined) return fail();
        check();
        active(ctx);
        check();
      }
    },
    async bindIndex(ctx: CurrentPagePortContext, digest: string, hashes: SourceHashes) {
      const check = watchRequest(ctx);
      check();
      active(ctx);
      check();
      const prior = states.get(ctx);
      if (prior) {
        if (
          prior.digest !== digest ||
          Object.keys(hashes).some((k) =>
            hashes[k as keyof SourceHashes] !== prior.hashes[k as keyof SourceHashes]
          )
        ) return fail();
        await assertBound(ctx, prior, check);
        return;
      }
      if (bindingInProgress.has(ctx)) return fail();
      bindingInProgress.add(ctx);
      try {
        const binding = await indexAuthority.bindIndex(ctx, digest, hashes);
        check();
        active(ctx);
        check();
        if (!binding || typeof binding !== "object") return fail();
        const state = Object.freeze({ capability: binding, digest, hashes });
        await assertBound(ctx, state, check);
        states.set(ctx, state);
      } finally {
        bindingInProgress.delete(ctx);
      }
    },
    async review(ctx: CurrentPagePortContext, candidates: readonly Candidate[]) {
      const state = states.get(ctx);
      if (!state || !Array.isArray(candidates) || candidates.length > 100) return fail();
      const check = watchRequest(ctx);
      const live = () => {
        check();
        active(ctx);
        check();
      };
      live();
      await assertBound(ctx, state, check);
      live();
      let issuedPin: ApprovedScopePin | null = null;
      const wrapped: IndependentScopeAuthority = {
        async authorize(request: ScopeRequest) {
          live();
          const pin = await scopeAuthority.authorize(request);
          live();
          if (pin === null) return null;
          issuedPin = snapshotPin(pin);
          await assertBound(ctx, state, check);
          live();
          return issuedPin;
        },
        async assertCurrent(request: ScopeRequest, pin: ApprovedScopePin) {
          live();
          if (await scopeAuthority.assertCurrent(request, pin) !== undefined) return fail();
          live();
          await assertBound(ctx, state, check);
          live();
        },
      };
      const claims: readonly ScopeClaim[] = Object.freeze(candidates.map((c) =>
        Object.freeze({
          target: c.target,
          rowFingerprint: c.rowFingerprint,
          offering: c.offering,
        })
      ));
      const scope = await new CurrentGuideReviewedScopeIssuer(
        wrapped,
        reader,
        {
          assertActive: live,
        },
        campusAuthority,
        conditionalAuthority,
      )
        .verifyGuideScope(ctx, claims);
      live();
      const pin: ApprovedScopePin | null = issuedPin;
      if (!pin) return scope;
      const relevant = candidates;
      live();
      const verdicts = await indexAuthority.classifySourcePair(
        ctx,
        state.capability,
        pin,
        relevant,
      );
      live();
      if (!Array.isArray(verdicts) || verdicts.length !== relevant.length) return fail();
      const expected = new Set(relevant.map((c) => id(c.target))),
        matched = new Map<string, "MATCHED" | "HOLD" | "ROLLOVER_ONLY_PENDING">();
      for (let i = 0; i < verdicts.length; i++) {
        const item = Object.getOwnPropertyDescriptor(verdicts, String(i));
        if (
          !item || !("value" in item) || !item.enumerable || !item.value ||
          typeof item.value !== "object" || Array.isArray(item.value)
        ) return fail();
        const d = item.value, keys = Reflect.ownKeys(d);
        if (keys.length !== 2 || !keys.includes("target") || !keys.includes("decision")) {
          return fail();
        }
        const t = Object.getOwnPropertyDescriptor(d, "target"),
          v = Object.getOwnPropertyDescriptor(d, "decision");
        if (
          !t || !("value" in t) || !t.enumerable || !v || !("value" in v) || !v.enumerable ||
          !["MATCHED", "HOLD", "ROLLOVER_ONLY_PENDING"].includes(v.value)
        ) return fail();
        const key = id(snapshotTarget(t.value));
        if (!expected.has(key) || matched.has(key)) return fail();
        matched.set(key, v.value);
      }
      await assertBound(ctx, state, check);
      live();
      if (await indexAuthority.assertPairCurrent(ctx, state.capability, pin) !== undefined) {
        return fail();
      }
      live();
      if (await scopeAuthority.assertCurrent(ctx, pin) !== undefined) return fail();
      live();
      return Object.freeze(
        scope.map((v) => {
          const verdict = matched.get(id(v.target));
          if (verdict === "MATCHED") {
            return v.enrollment_basis === "rollover_only_pending" ? hold(v.target) : v;
          }
          if (
            verdict === "ROLLOVER_ONLY_PENDING" && v.enrollment === "HOLD" &&
            v.practical === "HOLD" &&
            v.enrollment_basis === "rollover_only_pending"
          ) {
            return Object.freeze({
              ...hold(v.target),
              enrollment_basis: "rollover_only_pending" as const,
            });
          }
          return hold(v.target);
        }),
      );
    },
  });
}
