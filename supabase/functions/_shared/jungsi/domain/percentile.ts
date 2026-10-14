/** Exact cumulative kernel; approval and full native decoding remain separate ports. */
import { ContractError, displayExact, exact, Rational, requireContract as check } from "./exact.ts";
export interface Frequency {
  readonly score: number;
  readonly weight: unknown;
}
function weight(v: unknown): Rational {
  let n;
  try {
    n = exact(v);
  } catch {
    throw new ContractError("invalid_weight");
  }
  check(n.compare(exact(0)) >= 0, "negative_weight");
  return n;
}
export class ExactFrequencyDistribution {
  private readonly scores: readonly number[];
  private readonly suffix: readonly Rational[];
  constructor(rows: readonly Frequency[], expectedTotal: unknown, observedCounts = false) {
    const expected = weight(expectedTotal);
    check(expected.compare(exact(0)) > 0, "empty_population");
    if (observedCounts) check(expected.denominator === 1n, "fractional_count");
    const frequencies = new Map<number, Rational>();
    for (const r of rows) {
      check(
        typeof r.score === "number" && Number.isSafeInteger(r.score) && r.score >= 0,
        "invalid_integer",
      );
      check(!frequencies.has(r.score), "duplicate_score");
      const w = weight(r.weight);
      if (observedCounts) check(w.denominator === 1n, "fractional_count");
      frequencies.set(r.score, w);
    }
    check(frequencies.size > 0, "empty_distribution");
    this.scores = Object.freeze([...frequencies.keys()].sort((a, b) => a - b));
    const suffix: Rational[] = Array(this.scores.length + 1).fill(exact(0));
    for (let i = this.scores.length - 1; i >= 0; i--) {
      suffix[i] = suffix[i + 1].add(frequencies.get(this.scores[i])!);
    }
    check(suffix[0].compare(exact(0)) > 0, "empty_population");
    check(suffix[0].compare(expected) === 0, "population_total_mismatch");
    this.suffix = Object.freeze(suffix);
    Object.freeze(this);
  }
  calculate(
    score: number,
    tiePolicy: "include_equal" | "exclude_equal" = "include_equal",
    places = 6,
  ) {
    check(Number.isSafeInteger(score) && score >= 0, "invalid_integer");
    check(["include_equal", "exclude_equal"].includes(tiePolicy), "invalid_tie_policy");
    function bound(scores: readonly number[], upper: boolean): number {
      let lo = 0, hi = scores.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (scores[mid] < score || (upper && scores[mid] === score)) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
    const inclusive = this.suffix[bound(this.scores, false)].divide(this.suffix[0]);
    const exclusive = this.suffix[bound(this.scores, true)].divide(this.suffix[0]);
    const top = tiePolicy === "include_equal" ? inclusive : exclusive;
    return Object.freeze({
      top,
      inclusive,
      exclusive,
      topPercent: displayExact(top.multiply(exact(100)), places),
      tieSharePercent: displayExact(inclusive.subtract(exclusive).multiply(exact(100)), places),
    });
  }
}
