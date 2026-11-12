/** REVIEW ONLY. No durable fence/store, reconciliation, or physical cancellation is installed. */
import { AccessError } from "./access.ts";

export type ReferenceQuiescence = Readonly<{
  physical: "stopped" | "unknown";
  current: boolean;
}>;

/** Runtime opt-in is intentionally impossible until a reviewed durable implementation exists. */
export const REFERENCE_DURABLE_FENCE_IMPLEMENTED: boolean = false;
export function requireReferenceDurableFence(): void {
  if (!REFERENCE_DURABLE_FENCE_IMPLEMENTED) {
    throw new AccessError("security_policy_unavailable", 503);
  }
}
const hold = (): Promise<never> => new Promise<never>(() => {});

/**
 * This examines transport shape only; a trusted server authority must still independently
 * prove physical termination. Accessors, rejected proxy traps, malformed values and unknown
 * stop evidence all remain UNKNOWN rather than escaping as a normal failure settlement.
 */
function safeProof(value: unknown): ReferenceQuiescence | null {
  try {
    if (!value || typeof value !== "object") return null;
    const physical = Object.getOwnPropertyDescriptor(value, "physical");
    const current = Object.getOwnPropertyDescriptor(value, "current");
    if (
      !physical || !("value" in physical) || !current || !("value" in current) ||
      (physical.value !== "stopped" && physical.value !== "unknown") ||
      typeof current.value !== "boolean"
    ) return null;
    return Object.freeze({ physical: physical.value, current: current.value });
  } catch {
    return null;
  }
}

/** In-memory HOLD does not survive worker death. The route is separately hard-disabled. */
export async function requireStoppedAndCurrent(
  source: () => Promise<ReferenceQuiescence>,
  delivery: () => Promise<ReferenceQuiescence>,
): Promise<void> {
  const [sourceResult, deliveryResult] = await Promise.allSettled([
    Promise.resolve().then(source),
    Promise.resolve().then(delivery),
  ]);
  if (sourceResult.status !== "fulfilled" || deliveryResult.status !== "fulfilled") {
    return await hold();
  }
  const a = safeProof(sourceResult.value), b = safeProof(deliveryResult.value);
  if (!a || !b || a.physical !== "stopped" || b.physical !== "stopped") return await hold();
  if (!a.current || !b.current) throw new AccessError("security_policy_unavailable", 503);
}

/** Legacy boolean is termination proof only: false, non-boolean and throw are UNKNOWN. */
export async function requireBooleanStopped(drain: () => Promise<boolean>): Promise<void> {
  try {
    if (await drain() === true) return;
  } catch { /* physical termination remains unknown */ }
  return await hold();
}

/** Existing void authorities promise to resolve only after all their I/O stopped. */
export async function requireVoidDrains(drains: readonly (() => Promise<void>)[]): Promise<void> {
  const results = await Promise.allSettled(drains.map((drain) => Promise.resolve().then(drain)));
  if (results.some((result) => result.status !== "fulfilled" || result.value !== undefined)) {
    return await hold();
  }
}
