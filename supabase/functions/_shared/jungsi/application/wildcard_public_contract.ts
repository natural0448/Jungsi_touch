/** Cross-field candidate DTO checks; null and absence are legacy unknown, not a new result. */
const REASONS = new Set([
  "wildcard_evidence_unavailable",
  "wildcard_assessment_pending",
  "wildcard_comparison_unverified",
]);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export function validWildcardSelection(value: unknown): boolean {
  if (!object(value)) return false;
  if (!Object.hasOwn(value, "wildcard_selection") || value.wildcard_selection === null) return true;
  const selection = value.wildcard_selection, cards = value.wildcards;
  if (
    !object(selection) || !Array.isArray(cards) || cards.length > 4 ||
    !Array.isArray(selection.card_stability) || selection.card_stability.length !== cards.length
  ) return false;
  if (selection.status === "ready") {
    if (selection.reason_code !== null) return false;
  } else if (selection.status === "partial") {
    if (
      !cards.length || typeof selection.reason_code !== "string" ||
      !REASONS.has(selection.reason_code)
    ) return false;
  } else if (selection.status === "pending") {
    if (
      cards.length || typeof selection.reason_code !== "string" ||
      !REASONS.has(selection.reason_code)
    ) return false;
  } else return false;
  const seen = new Set<string>();
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i], item = selection.card_stability[i];
    if (
      !object(card) || !object(card.offering) || typeof card.offering.offering_id !== "string" ||
      !object(item) || item.offering_id !== card.offering.offering_id ||
      (item.status !== "verified" && item.status !== "pending") ||
      seen.has(item.offering_id as string)
    ) return false;
    seen.add(item.offering_id as string);
  }
  return true;
}
