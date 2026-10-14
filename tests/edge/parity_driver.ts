/** Stdin/stdout only, no network, database, environment or filesystem permission. */
import {
  displayExact,
  exact,
  Rational,
  roundExact,
} from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import {
  canonicalIntegerKeys,
  parseNativeJson,
  parseNativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { ConversionRule, row } from "../../supabase/functions/_shared/jungsi/domain/conversion.ts";
import {
  ExactFrequencyDistribution,
  type Frequency,
} from "../../supabase/functions/_shared/jungsi/domain/percentile.ts";
import {
  seoulDateRange,
  utcInstant,
  utcText,
} from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { calculateSyntheticOffering } from "../../supabase/functions/_shared/jungsi/application/research_offering.ts";
const input = await new Response(Deno.stdin.readable).text();
const cases = parseNativeJson(input) as { id: string; kind: string; payload: unknown }[];
const ratio = (v: Rational) => ({
  numerator: String(v.numerator),
  denominator: String(v.denominator),
});
const results = cases.map((c) => {
  try {
    const p = row(c.payload);
    let result: unknown;
    if (c.kind === "round") {
      const v = roundExact(exact(p.value), p.places, p.mode);
      result = { ratio: ratio(v), display: displayExact(v, Number(p.places)) };
    } else if (c.kind === "conversion") {
      const calc = new ConversionRule(p.rule).calculate(p.profile, p.research === true);
      result = { ratio: ratio(calc.score), display: calc.convertedScore };
    } else if (c.kind === "tail") {
      const r = new ExactFrequencyDistribution(p.rows as Frequency[], p.total, p.observed === true)
        .calculate(Number(p.score), p.tie as "include_equal" | "exclude_equal", Number(p.places));
      result = {
        top: ratio(r.top),
        inclusive: ratio(r.inclusive),
        exclusive: ratio(r.exclusive),
        display: r.topPercent,
        tie: r.tieSharePercent,
      };
    } else if (c.kind === "time") {
      result = utcText(utcInstant(String(p.value), p.source as string | undefined));
    } else if (c.kind === "range") {
      result = seoulDateRange(String(p.start), String(p.end)).map(utcText);
    } else if (c.kind === "single") {
      const r = calculateSyntheticOffering({ read: () => p as never });
      result = {
        ratio: ratio(r.score),
        display: r.convertedScore,
        scoring: r.scoringStatus,
        percentile: r.percentileStatus,
        judgment: r.judgmentStatus,
        production_ready: r.productionReady,
      };
    } else if (c.kind === "integer_keys") {
      result = [...canonicalIntegerKeys(parseNativeObject(String(p.text))).keys()].map(String)
        .sort();
    } else throw new Error("unknown case");
    return { id: c.id, result };
  } catch (e) {
    return { id: c.id, error: (e as { code?: string }).code ?? "invalid_value" };
  }
});
console.log(JSON.stringify(results));
