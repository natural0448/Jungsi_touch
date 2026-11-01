/** Display aliases only. Never merge observations, select a value or grant field qualification. */
import { nativeJsonText, type NativeObject } from "../domain/json_value.ts";
export type HistorySemanticFamily =
  | "final_waitlist_rank"
  | "additional_admission_count"
  | "separate_recruitment_quota"
  | "initial_waitlist_number"
  | "score_cut"
  | "mean_score";
export interface HistoryAliasScope {
  readonly observation_id: string | null;
  readonly academic_year: number | null;
  readonly offering_id: string | null;
  readonly cohort: string | null;
  readonly score_basis: string | null;
  readonly score_scope: string | null;
  readonly source_round: string | null;
  readonly statistic_percent: number | null;
}
export interface HistoryAliasEvidence {
  readonly status: "meaning_verified";
  readonly definition_sha256: string;
  readonly source_label: string;
  readonly family: HistorySemanticFamily;
  readonly scope: HistoryAliasScope;
}
const RANK = new Set([
  "최종합격예비번호",
  "최종충원순위",
  "충원합격순위",
  "최종합격자예비번호",
  "마지막합격후보순위",
]);
const COUNT = new Set(["추가합격인원수", "실제추가합격자수", "충원합격자수"]);
const QUOTA = new Set(["별도추가모집정원", "추가모집선발정원"]);
const INITIAL = new Set(["최초발급예비번호", "최초예비번호"]);
const FAMILIES = [
  "final_waitlist_rank",
  "additional_admission_count",
  "separate_recruitment_quota",
  "initial_waitlist_number",
  "score_cut",
  "mean_score",
];
function canonicalKind(kind: string | null): HistorySemanticFamily | null {
  if (
    ["final_waitlist_rank", "final_additional_admission_rank", "additional_admission_rank"]
      .includes(kind ?? "")
  ) return "final_waitlist_rank";
  if (FAMILIES.includes(kind ?? "")) return kind as HistorySemanticFamily;
  return null;
}
function strongLabel(label: string | null): HistorySemanticFamily | null {
  const v = label?.normalize("NFKC").replace(/\s+/gu, "") ?? "";
  return RANK.has(v)
    ? "final_waitlist_rank"
    : COUNT.has(v)
    ? "additional_admission_count"
    : QUOTA.has(v)
    ? "separate_recruitment_quota"
    : INITIAL.has(v)
    ? "initial_waitlist_number"
    : null;
}
/** This only checks the existing evidence shape and scope; it does not establish independent trust. */
function matchingEvidenceBase(
  label: string | null,
  scope: HistoryAliasScope,
  evidence: HistoryAliasEvidence,
): boolean {
  return evidence.status === "meaning_verified" &&
    /^[a-f0-9]{64}$/.test(evidence.definition_sha256) &&
    evidence.source_label === label && !!evidence.scope && typeof evidence.scope === "object" &&
    !Array.isArray(evidence.scope) && FAMILIES.includes(evidence.family) &&
    scope.observation_id !== null && scope.academic_year !== null && scope.offering_id !== null &&
    nativeJsonText(scope as unknown as NativeObject, true) ===
      nativeJsonText(evidence.scope as unknown as NativeObject, true);
}
/** Ambiguous labels such as 충원인원/추가모집인원/합격대기번호 require exact definition evidence. */
export function resolveHistoryMetricAlias(
  kind: string | null,
  label: string | null,
  scope: HistoryAliasScope,
  evidence?: HistoryAliasEvidence | null,
): { family: HistorySemanticFamily | null; label: string | null; reason: string | null } {
  const existing = canonicalKind(kind), strong = strongLabel(label);
  if (strong && existing && strong !== existing) {
    return { family: null, label: null, reason: "semantic_alias_conflict" };
  }
  let family: HistorySemanticFamily | null = null;
  if (evidence) {
    if (
      !matchingEvidenceBase(label, scope, evidence) ||
      strong && strong !== evidence.family || existing && existing !== evidence.family
    ) {
      return { family: null, label: null, reason: "semantic_alias_evidence_mismatch" };
    }
    family = evidence.family;
  } else if (strong && (existing === strong || strongLabel(kind) === strong)) family = strong;
  else return { family: null, label: null, reason: "semantic_alias_definition_required" };
  if (
    family === "score_cut" &&
      (!Number.isSafeInteger(scope.statistic_percent) || Number(scope.statistic_percent) < 1 ||
        Number(scope.statistic_percent) > 100) ||
    family === "mean_score" && scope.statistic_percent !== null
  ) {
    return { family: null, label: null, reason: "semantic_alias_evidence_mismatch" };
  }
  const name = family === "final_waitlist_rank"
    ? "최종 합격 예비번호"
    : family === "additional_admission_count"
    ? "추가 합격 인원"
    : family === "separate_recruitment_quota"
    ? "별도 추가모집 정원"
    : family === "initial_waitlist_number"
    ? "최초 발급 예비번호"
    : family === "score_cut"
    ? (scope.statistic_percent === null ? null : String(scope.statistic_percent) + "% 성적")
    : family === "mean_score"
    ? "평균 성적"
    : null;
  return { family, label: name, reason: null };
}
/** Canonicalize the item key of one current-history record; raw label and all values remain separate. */
export function currentHistoryServiceItem(
  kind: string | null,
  label: string | null,
  scope: HistoryAliasScope,
  evidence?: HistoryAliasEvidence | null,
): string | null {
  const alias = resolveHistoryMetricAlias(kind, label, scope, evidence);
  // Existing API keys remain compatible, including final_additional_admission_rank.
  if (canonicalKind(kind) !== null) return kind;
  return alias.family === "score_cut" || alias.family === "mean_score"
    ? kind
    : alias.family ?? kind;
}
/** Publisher/current-data bridge to the existing P1 slots; no cell value or q object is changed. */
export function p1MetricSlotAlias(
  kind: string | null,
  label: string | null,
  scope: HistoryAliasScope,
  evidence?: HistoryAliasEvidence | null,
): { slot: string | null; serviceLabel: string | null; reason: string | null } {
  const a = resolveHistoryMetricAlias(kind, label, scope, evidence);
  if (a.family === "final_waitlist_rank") {
    return { slot: "final_additional_admission_rank", serviceLabel: a.label, reason: null };
  }
  if (a.family === "additional_admission_count") {
    return { slot: "additional_admission_count", serviceLabel: a.label, reason: null };
  }
  if (a.family === "score_cut") {
    return {
      slot: scope.statistic_percent === 50
        ? "final_50_percent_cut"
        : scope.statistic_percent === 70
        ? "final_70_percent_cut"
        : "alternate_cut",
      serviceLabel: a.label,
      reason: null,
    };
  }
  if (a.family === "mean_score") {
    return { slot: "alternate_cut", serviceLabel: a.label, reason: null };
  }
  return {
    slot: null,
    serviceLabel: a.label,
    reason: a.reason ?? "semantic_family_has_no_existing_P1_slot",
  };
}

/** Explicit waitlist kind/label/evidence contradictions are never promoted as facts. */
export function hasWaitlistSemanticConflict(
  kind: string | null,
  label: string | null,
  scope: HistoryAliasScope,
  evidence?: HistoryAliasEvidence | null,
): boolean {
  const kindFamily = canonicalKind(kind) ?? strongLabel(kind), labelFamily = strongLabel(label);
  const waitlist = (family: HistorySemanticFamily | null): boolean =>
    family === "final_waitlist_rank" || family === "additional_admission_count";
  if (
    kindFamily && labelFamily && kindFamily !== labelFamily &&
    (waitlist(kindFamily) || waitlist(labelFamily))
  ) return true;
  if (!evidence || !matchingEvidenceBase(label, scope, evidence)) return false;
  return [kindFamily, labelFamily].some((family) =>
    family !== null && family !== evidence.family && (waitlist(family) || waitlist(evidence.family))
  );
}
