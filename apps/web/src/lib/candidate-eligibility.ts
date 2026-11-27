import type { AssessmentDto, CandidatesDto, OfferingStateDto, ReferenceBandDto, ReportDto } from "./dto";
import type { NoJudgmentView } from "./csat-conditions";

export type CandidateReport = Pick<ReportDto, "analyses" | "candidates" | "stale_analysis_ids">;

const list = <T>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : [];
const ineligibleRows = (c: CandidatesDto | null | undefined) =>
  list(c?.ineligible_offerings).filter(row => typeof row?.offering_id === "string");

export function isIneligibleAssessment(a: AssessmentDto | null | undefined): boolean {
  return a?.status === "ineligible" || a?.eligibility_status === "ineligible";
}

export const INELIGIBLE_CANDIDATE_NOTICE: NoJudgmentView = {
  label: "지원 조건 미충족", cls: "inel", desc: "이 모집단위의 지원 필수 조건을 현재 입력한 성적으로 충족하지 않습니다.",
};

export function isConfirmedIneligible(report: CandidateReport, id: string): boolean {
  if (list(report.candidates?.ineligible_offerings).some(row => row?.offering_id === id)) return true;
  const assessment = report.analyses?.[id];
  return isIneligibleAssessment(assessment) && (!assessment?.offering_id || assessment.offering_id === id) &&
    !list(report.stale_analysis_ids).includes(id);
}

export function confirmedIneligibleIds(report: CandidateReport): Set<string> {
  const projected = withCandidateEligibility(report);
  const blocked = new Set(ineligibleRows(projected.candidates).map(row => row.offering_id));
  if (!report.candidates) {
    for (const id of Object.keys(report.analyses ?? {})) if (isConfirmedIneligible(report, id)) blocked.add(id);
  }
  return blocked;
}

export function holdIneligibleBand<T extends ReferenceBandDto | null | undefined>(band: T, ineligible: boolean): T {
  return band && ineligible ? { ...band, held: true } : band;
}

/** Deliver confirmed exclusions together with each saved/merged report's candidate response. */
export function withCandidateEligibility<R extends CandidateReport>(report: R): R {
  const c = report.candidates;
  if (!c || !report.analyses) return report;
  const stale = new Set(list(report.stale_analysis_ids));
  const prior = ineligibleRows(c);
  const seen = new Set(prior.map(row => row.offering_id));
  const additions: OfferingStateDto[] = [];
  for (const [id, assessment] of Object.entries(report.analyses)) {
    if (!isIneligibleAssessment(assessment) || (assessment.offering_id && assessment.offering_id !== id) ||
      stale.has(id) || seen.has(id)) continue;
    additions.push({ offering_id: id, category: "ineligible", reason_code: assessment.reason_code ?? "eligibility_not_met" });
  }
  if (!additions.length) return report;
  return { ...report, candidates: { ...c, ineligible_offerings: [...prior, ...additions] } };
}

/** Server-confirmed exclusion signals also veto a more favorable candidate band. */
export function blockedCandidateIds(c: CandidatesDto | null | undefined): Set<string> {
  const blocked = new Set<string>();
  for (const ids of [c?.csat_condition_unmet, c?.csat_minimum_unmet, c?.csat_minimum_partial]) {
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") blocked.add(id);
  }
  for (const row of ineligibleRows(c)) blocked.add(row.offering_id);
  return blocked;
}

/** Automatic lists may hide a row while the catalog and manually picked rows retain it. */
export function recommendableCandidates(c: CandidatesDto, report?: CandidateReport): CandidatesDto {
  const base = report ? withCandidateEligibility({ ...report, candidates: c }).candidates : c;
  const blocked = blockedCandidateIds(base);
  const allowed = (item: { offering?: { offering_id: string }; assessment?: AssessmentDto | null }) =>
    !!item?.offering && !blocked.has(item.offering.offering_id) && !isIneligibleAssessment(item.assessment);
  const basic = list(base.basic_university_groups).filter(Boolean).map(g => ({ ...g, offerings: list(g.offerings).filter(allowed) }));
  const wildcard = list(base.wildcards).filter(allowed);
  const reference = list(base.reference_university_groups).filter(Boolean).map(g => ({
    ...g, offerings: list(g.offerings).filter(row => allowed(row) && row.reference_band?.automatic_candidate !== false),
  }));
  const kept = new Set(wildcard.map(row => row.offering.offering_id));
  const selection = base.wildcard_selection;
  return {
    ...base,
    basic_university_groups: basic.filter(g => g.offerings.length > 0),
    wildcards: wildcard,
    wildcard_selection: selection && { ...selection, card_stability: list(selection.card_stability).filter(row => kept.has(row?.offering_id)) },
    reference_university_groups: Array.isArray(base.reference_university_groups) ? reference.filter(g => g.offerings.length > 0) : null,
  };
}
