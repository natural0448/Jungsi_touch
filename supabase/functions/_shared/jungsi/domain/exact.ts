/** Internal exact arithmetic. Never serialize BigInt ratios into a student DTO. */
export class ContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ContractError";
  }
}
export function requireContract(ok: unknown, code: string): asserts ok {
  if (!ok) throw new ContractError(code);
}
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
export class Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
  constructor(n: bigint, d = 1n) {
    requireContract(d !== 0n, "DIVISION_BY_ZERO");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.numerator = n / g;
    this.denominator = d / g;
    Object.freeze(this);
  }
  add(b: Rational): Rational {
    return new Rational(
      this.numerator * b.denominator + b.numerator * this.denominator,
      this.denominator * b.denominator,
    );
  }
  subtract(b: Rational): Rational {
    return this.add(new Rational(-b.numerator, b.denominator));
  }
  multiply(b: Rational): Rational {
    return new Rational(this.numerator * b.numerator, this.denominator * b.denominator);
  }
  divide(b: Rational): Rational {
    return new Rational(this.numerator * b.denominator, this.denominator * b.numerator);
  }
  compare(b: Rational): number {
    const d = this.numerator * b.denominator - b.numerator * this.denominator;
    return d < 0n ? -1 : d > 0n ? 1 : 0;
  }
  toString(): string {
    return this.denominator === 1n
      ? String(this.numerator)
      : `${this.numerator}/${this.denominator}`;
  }
}
export function exact(value: unknown): Rational {
  if (value instanceof Rational) return value;
  if (typeof value === "bigint") return new Rational(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return new Rational(BigInt(value));
  requireContract(typeof value === "string", "INVALID_NUMBER");
  // Decimal strings are exact; JSON floating lexemes are deliberately a different type.
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(
    value.trim().replaceAll("_", ""),
  );
  requireContract(m, "INVALID_NUMBER");
  const fraction = m[3] ?? m[4] ?? "";
  const exponent = Number(m[5] ?? "0") - fraction.length;
  // A local foundation bound, not an approved request/quota policy or full Decimal port.
  requireContract(
    Number.isSafeInteger(exponent) && Math.abs(exponent) <= 10000,
    "NUMERIC_RESOURCE_LIMIT",
  );
  let n = BigInt((m[2] ?? "0") + fraction);
  if (m[1] === "-") n = -n;
  return exponent >= 0
    ? new Rational(n * 10n ** BigInt(exponent))
    : new Rational(n, 10n ** BigInt(-exponent));
}
export type RoundingMode = "half_up" | "half_even" | "truncate" | "floor" | "ceil";
export function roundExact(value: Rational, places: unknown, mode: unknown): Rational {
  requireContract(
    typeof places === "number" && Number.isInteger(places) && places >= 0 && places <= 8,
    "INVALID_PRECISION",
  );
  requireContract(
    ["half_up", "half_even", "truncate", "floor", "ceil"].includes(String(mode)),
    "ROUNDING_UNSPECIFIED",
  );
  return rounded(value, places, mode as RoundingMode);
}
function rounded(value: Rational, places: number, mode: RoundingMode): Rational {
  const scale = 10n ** BigInt(places), n = value.numerator * scale;
  const negative = n < 0n, abs = negative ? -n : n;
  let q = abs / value.denominator;
  const r = abs % value.denominator;
  if (
    (mode === "half_up" && 2n * r >= value.denominator) ||
    (mode === "half_even" &&
      (2n * r > value.denominator || (2n * r === value.denominator && q % 2n !== 0n))) ||
    (mode === "floor" && negative && r > 0n) || (mode === "ceil" && !negative && r > 0n)
  ) q++;
  return new Rational(negative ? -q : q, scale);
}
export function displayExact(value: Rational, places = 6): string {
  requireContract(Number.isInteger(places) && places >= 0 && places <= 12, "INVALID_PRECISION");
  const result = rounded(value, places, "half_up"), scale = 10n ** BigInt(places);
  const n = result.numerator * scale / result.denominator, abs = n < 0n ? -n : n;
  const sign = n < 0n ? "-" : "";
  return places
    ? `${sign}${abs / scale}.${String(abs % scale).padStart(places, "0")}`
    : sign + String(abs);
}
