import { isCsatHeld } from "./csat-held";
import { personalCsatPoint } from "./personal-csat-point";
import type { BandCode, CandidatesDto, ReferenceBandDto } from "./dto";
import { referenceGroups, thresholdBandOf } from "./reference-percentile";
import { LISTED_BANDS, referenceUniversities, type ReferenceItem, type ReferenceUniversity } from "./reference-view";

/*
  수능 가채점 리포트의 3번째 화면(유리한 대학 찾기) 목록(dep_r22, 2026-11-21).
  서버는 판정 Secret(JUNGSI_CSAT_PROVISIONAL_SCHOOL_CUTS)이 있을 때만 candidates.build 응답에 학교별 가채점 7단계를
  9모 문턱 판정과 같은 모양(reference_university_groups, 행의 reference_band basis reference_threshold, source "g")으로 싣는다.
  리포트에는 저장하지 않는다(응답에만). 판정 행이 하나도 없으면 화면은 '가채점 판정 준비 중'을 그대로 보인다.
  - 가채점에는 누백·지난해 합격선 위치·환산 유불리·와일드카드가 없다(4페이지·와일드카드에 가채점 판정을 쓰지 않는다, 담당자 P4 미승인).
  - 중앙 프로필이 계산되면 code 한 단계, 안 되면 code(좋은 끝)~upper_code(나쁜 끝) 범위로 온다(server csat_provisional/judgment.ts).
*/
export const CSAT_SOURCE = "g";

/** Consumer defense for authoritative server exclusions; eligibility is evaluated upstream. */
export function blockedCsatRecommendationIds(c: CandidatesDto | null | undefined): Set<string> {
  const blocked = new Set<string>();
  for (const ids of [c?.csat_condition_unmet, c?.csat_minimum_unmet, c?.csat_minimum_partial]) {
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") blocked.add(id);
  }
  if (Array.isArray(c?.ineligible_offerings)) {
    for (const row of c.ineligible_offerings) {
      if (typeof row?.offering_id === "string") blocked.add(row.offering_id);
    }
  }
  return blocked;
}

/** 가채점 판정 행의 판정. source g · 문턱 판정 모양 · 7단계 코드일 때만(9모 행이 섞여 와도 쓰지 않는다) */
export function csatBandOf(b: ReferenceBandDto | null | undefined): ReferenceBandDto | null {
  const t = thresholdBandOf(b);
  return t && t.source === CSAT_SOURCE ? t : null;
}

const LABEL: Record<BandCode, string> = { stable: "안정", downward: "하향", target: "적정", aspirational: "소신", upward: "상향", challenge: "도전", outside: "불가" };
const ORDER: BandCode[] = ["stable", "downward", "target", "aspirational", "upward", "challenge", "outside"];

/** 범위의 나쁜 끝. 7단계 코드이고 좋은 끝보다 뒤일 때만 */
export function csatUpper(b: ReferenceBandDto): BandCode | null {
  const u = b.upper_code;
  return typeof u === "string" && ORDER.includes(u) && ORDER.indexOf(u) > ORDER.indexOf(b.code) ? u : null;
}

/** 목록 배지 문구: 한 단계면 '적정', 중앙 없이 범위면 '적정~소신' */
export function csatBandText(b: ReferenceBandDto): string {
  const u = csatUpper(b);
  return u ? `${LABEL[b.code]}~${LABEL[u]}` : LABEL[b.code];
}

export interface CsatView {
  universities: ReferenceUniversity[];
  /** 판정이 나왔지만 목록 밖(도전·불가)이라 서버가 뺀 수(요약 by_code 기준, 없으면 0) */
  outsideBand: number;
  /** 서버가 판정한 모집단위 수(요약 judged, 없으면 목록 수) */
  judged: number;
}

/**
 * 가채점 판정 행만 골라 대학 → 계열 → 학과로 묶는다. 순서는 9모 참고 목록과 같다(적정·소신 → 상향 → 하향 → 안정).
 * 판정 행이 하나도 없으면 universities 는 빈 배열(화면은 '가채점 판정 준비 중')
 */
export function csatView(c: CandidatesDto | null | undefined, pointBased = false): CsatView {
  const items: ReferenceItem[] = [];
  const blocked = blockedCsatRecommendationIds(c);
  try {
    for (const it of referenceGroups(c).flatMap((g) => g.offerings)) {
      const id = it.offering?.offering_id;
      if (typeof id !== "string" || blocked.has(id) || isCsatHeld(id)) continue;
      const raw = csatBandOf(it.reference_band);
      if (raw?.automatic_candidate === false) continue;
      const band = pointBased ? personalCsatPoint(raw) : raw;
      if (!band || band.held || !LISTED_BANDS.includes(band.code)) continue;
      items.push({ offering: it.offering, reference_percentile: null, advantage: null, margin: null, band, pending: false });
    }
  } catch {
    return { universities: [], outsideBand: 0, judged: 0 };
  }
  const universities = items.length > 0 ? referenceUniversities({ items, below: 0, noCutoff: 0, ineligible: 0, outsideBand: 0 }) : [];
  const sum = c?.reference_threshold_summary;
  const gSummary = !pointBased && !!sum && typeof sum === "object" && !!sum.sources && typeof sum.sources === "object" && CSAT_SOURCE in sum.sources;
  const by = gSummary && sum!.by_code && typeof sum!.by_code === "object" ? sum!.by_code : {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return {
    universities,
    outsideBand: n(by.challenge) + n(by.outside),
    judged: gSummary && n(sum!.judged) > 0 ? n(sum!.judged) : items.length,
  };
}

/*
  가채점 참고 후보(2026-11-23 대표님 결정, 담당자 검토안 reference_candidate_policy: '가채점 참고 후보').
  학교별 가채점 7단계를 기본 후보 3그룹으로 묶는다: 안정·하향 → 여유, 적정 → 핵심, 소신·상향 → 도전. 도전·불가는 넣지 않는다.
  범위 판정(적정~소신 등)은 두 끝이 같은 그룹일 때만 넣고, 그룹이 다르거나 한 끝이 빠지는 그룹이면 보류(넣지 않음)한다.
  정식 판정(status ready)의 기본 후보와 다르며 화면에는 '가채점 후보'로 보인다('참고' 꼬리표 없음, 11-22 결정).
*/
export type CsatCandidateGroup = "challenge" | "core" | "room";
export const CSAT_CANDIDATE_GROUP: Record<BandCode, CsatCandidateGroup | null> = {
  stable: "room", downward: "room", target: "core", aspirational: "challenge", upward: "challenge", challenge: null, outside: null,
};
export const CSAT_CANDIDATE_LABEL: Record<CsatCandidateGroup, string> = { challenge: "도전", core: "핵심", room: "여유" };
export interface CsatCandidateView {
  groups: Record<CsatCandidateGroup, ReferenceUniversity[]>;
  counts: Record<CsatCandidateGroup, number>;
  /** 범위가 두 그룹에 걸쳐 보류한 학과 수 */
  held: number;
}
export function csatCandidateGroupOf(b: ReferenceBandDto): CsatCandidateGroup | null {
  const g = CSAT_CANDIDATE_GROUP[b.code];
  if (!g) return null;
  const u = csatUpper(b);
  if (u && CSAT_CANDIDATE_GROUP[u] !== g) return null;
  return g;
}
export function csatCandidateView(c: CandidatesDto | null | undefined, pointBased = false): CsatCandidateView {
  const by: Record<CsatCandidateGroup, ReferenceItem[]> = { challenge: [], core: [], room: [] };
  let held = 0;
  const blocked = blockedCsatRecommendationIds(c);
  try {
    for (const it of referenceGroups(c).flatMap((g) => g.offerings)) {
      const id = it.offering?.offering_id;
      if (typeof id !== "string" || blocked.has(id) || isCsatHeld(id)) continue;
      const raw = csatBandOf(it.reference_band);
      if (raw?.automatic_candidate === false) continue;
      const band = pointBased ? personalCsatPoint(raw) : raw;
      if (band?.held) { held++; continue; }
      if (!band || !CSAT_CANDIDATE_GROUP[band.code]) continue;
      const g = csatCandidateGroupOf(band);
      if (!g) {
        held++;
        continue;
      }
      by[g].push({ offering: it.offering, reference_percentile: null, advantage: null, margin: null, band, pending: false });
    }
  } catch {
    return { groups: { challenge: [], core: [], room: [] }, counts: { challenge: 0, core: 0, room: 0 }, held: 0 };
  }
  const uni = (items: ReferenceItem[]) => (items.length ? referenceUniversities({ items, below: 0, noCutoff: 0, ineligible: 0, outsideBand: 0 }) : []);
  return {
    groups: { challenge: uni(by.challenge), core: uni(by.core), room: uni(by.room) },
    counts: { challenge: by.challenge.length, core: by.core.length, room: by.room.length },
    held,
  };
}
