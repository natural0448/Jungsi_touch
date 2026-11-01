/** Server-side wildcard selection. Classification and comparison evidence are server validated. */
import { AccessError } from "./access.ts";
import { Rational } from "../domain/exact.ts";

const GROUPS = new Set(["nursing", "health", "education", "contract", "maritime", "railway"]);
const PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  room: 0,
  core: 1,
  challenge: 2,
});

/** An already validated internal comparison, not an API DTO or an authorization token. */
export interface WildcardStability {
  readonly marginPp: Rational;
  readonly academicYear: number;
  readonly examId: string;
  readonly scoreBasis: string;
  readonly sourceModelVersion: string;
  readonly referencePopulationSha256: string;
  /** Filtered input profiles and their original weights before each university conversion. */
  readonly effectivePopulationWeightsSha256: string;
  readonly denominatorPolicyId: string;
  readonly populationUnit: string;
  readonly metricDefinitionId: string;
  readonly tiePolicy: "include_equal";
  readonly forecastApprovalId: string;
}
export interface WildcardChoice<T> {
  readonly offeringId: string;
  readonly group: string | null;
  /** Explicitly distinguish a confirmed non-wildcard from a missing classification. */
  readonly groupClassification: "approved" | "excluded" | "unresolved";
  readonly status: string;
  readonly category: string | null;
  readonly stability: WildcardStability | null;
  readonly value: T;
}
export type WildcardSelection<T> =
  | { readonly status: "ready"; readonly items: readonly T[] }
  | {
    readonly status: "pending";
    readonly reasonCode: "wildcard_comparison_unverified" | "wildcard_assessment_pending";
    /** Only cards whose prefix cannot change under the remaining uncertainty. */
    readonly items: readonly T[];
  };

function evidenceKey(evidence: WildcardStability | null): string | null {
  const n = evidence?.marginPp && Object.getOwnPropertyDescriptor(evidence.marginPp, "numerator");
  const d = evidence?.marginPp && Object.getOwnPropertyDescriptor(evidence.marginPp, "denominator");
  if (
    !evidence || !(evidence.marginPp instanceof Rational) ||
    Object.getPrototypeOf(evidence.marginPp) !== Rational.prototype ||
    !Object.isFrozen(evidence.marginPp) ||
    !n || !("value" in n) || typeof n.value !== "bigint" ||
    !d || !("value" in d) || typeof d.value !== "bigint" ||
    evidence.marginPp.denominator <= 0n ||
    evidence.marginPp.numerator < -100n * evidence.marginPp.denominator ||
    evidence.marginPp.numerator > 100n * evidence.marginPp.denominator ||
    !Number.isSafeInteger(evidence.academicYear) || evidence.academicYear < 1 ||
    ![
      evidence.examId,
      evidence.scoreBasis,
      evidence.sourceModelVersion,
      evidence.denominatorPolicyId,
      evidence.populationUnit,
      evidence.metricDefinitionId,
      evidence.forecastApprovalId,
    ].every((v) => typeof v === "string" && v.trim().length > 0) ||
    typeof evidence.referencePopulationSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(evidence.referencePopulationSha256) ||
    typeof evidence.effectivePopulationWeightsSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(evidence.effectivePopulationWeightsSha256) ||
    evidence.tiePolicy !== "include_equal"
  ) return null;
  return JSON.stringify([
    evidence.academicYear,
    evidence.examId,
    evidence.scoreBasis,
    evidence.sourceModelVersion,
    evidence.referencePopulationSha256,
    evidence.effectivePopulationWeightsSha256,
    evidence.denominatorPolicyId,
    evidence.populationUnit,
    evidence.metricDefinitionId,
    evidence.tiePolicy,
  ]);
}
/** True only when evidence establishes a strictly higher rank. Equal is not an ID-based win. */
function before<T>(a: WildcardChoice<T>, b: WildcardChoice<T>): boolean {
  const difference = PRIORITY[a.category!] - PRIORITY[b.category!];
  if (difference !== 0) return difference < 0;
  const key = evidenceKey(a.stability);
  if (key === null || key !== evidenceKey(b.stability)) return false;
  const x = a.stability!.marginPp, y = b.stability!.marginPp;
  return x.numerator * y.denominator > y.numerator * x.denominator;
}
/** Linear scan and verification, avoiding quadratic comparison of a large catalog. */
function definiteFirst<T>(pool: readonly WildcardChoice<T>[]): WildcardChoice<T> | null {
  if (!pool.length) return null;
  let candidate = pool[0];
  for (const other of pool.slice(1)) if (before(other, candidate)) candidate = other;
  return pool.every((other) => other === candidate || before(candidate, other)) ? candidate : null;
}
function pending<T>(
  reasonCode: "wildcard_comparison_unverified" | "wildcard_assessment_pending",
  selected: readonly WildcardChoice<T>[],
): WildcardSelection<T> {
  return { status: "pending", reasonCode, items: selected.map((c) => c.value) };
}
/**
 * Six approved groups; room/core/challenge; diversity in the first three; best remaining fourth.
 * An uncertain competitor is never treated as zero or an ID-based winner. Only a prefix whose
 * selection and order are determined is returned while comparison remains pending. This helper
 * does not authorize or load its evidence; its server caller must do both in the same context.
 */
export function selectWildcards<T>(choices: readonly WildcardChoice<T>[]): WildcardSelection<T> {
  if (!Array.isArray(choices)) throw new AccessError("wildcard_offering_invalid", 503);
  const seen = new Set<string>(), eligible: WildcardChoice<T>[] = [];
  let unresolved = false;
  for (const candidate of choices) {
    if (
      !candidate || typeof candidate.offeringId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate.offeringId) ||
      seen.has(candidate.offeringId)
    ) throw new AccessError("wildcard_offering_invalid", 503);
    seen.add(candidate.offeringId);
    // Confirmed noncompetitive assessments cannot affect wildcard selection even if group is unknown.
    if (
      candidate.status === "ineligible" ||
      candidate.status === "ready" && candidate.category === "outside"
    ) continue;
    if (candidate.groupClassification === "excluded" && candidate.group === null) continue;
    if (
      candidate.groupClassification !== "approved" || candidate.group === null ||
      !GROUPS.has(candidate.group)
    ) {
      unresolved = true;
      continue;
    }
    if (
      candidate.status !== "ready" || candidate.category === null ||
      !Object.hasOwn(PRIORITY, candidate.category)
    ) {
      unresolved = true;
      continue;
    }
    eligible.push(candidate);
  }
  // An unclassified or unassessed candidate may precede the first card or add a group.
  if (unresolved) return pending("wildcard_assessment_pending", []);
  const groups = new Set(eligible.map((c) => c.group!)),
    selected: WildcardChoice<T>[] = [],
    selectedGroups = new Set<string>(),
    remaining = [...eligible],
    requiredGroups = Math.min(3, groups.size);
  while (selected.length < 3 && remaining.length) {
    const neededGroups = requiredGroups - selectedGroups.size, slots = 3 - selected.length;
    const possible = remaining.filter((c) => !selectedGroups.has(c.group!) || slots > neededGroups);
    const winner = definiteFirst(possible);
    if (winner === null) return pending("wildcard_comparison_unverified", selected);
    selected.push(winner);
    selectedGroups.add(winner.group!);
    remaining.splice(remaining.indexOf(winner), 1);
  }
  if (remaining.length) {
    const winner = definiteFirst(remaining);
    if (winner === null) return pending("wildcard_comparison_unverified", selected);
    selected.push(winner);
  }
  return { status: "ready", items: selected.map((c) => c.value) };
}
