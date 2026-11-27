import { isCsatHeld } from "./csat-held";
import { blockedCandidateIds, confirmedIneligibleIds, type CandidateReport } from "./candidate-eligibility";
import type { BandCode, CandidatesDto, OfferingDto, ReferenceBandDto, ShortlistEntryDto } from "./dto";
import type { CounselSchool, CounselYear } from "./pro-counsel";

/*
  전문가용 리포트(고정 판) → 상담 팁 입력(CounselSchool). 판정은 서버 값 그대로 옮기기만 한다(화면이 계산하지 않는다).
  - 가채점: candidates.reference_university_groups 의 source "g" 행(서버 dep_pro_r27, position 포함)
  - 9월: analyses[id].band(7단계), 없으면 참고 판정 reference_band. 유불리는 analyses[id].advantage
  시험이 tsx 없이 읽도록 상대 경로 타입만 가져온다.
*/

const CODES: readonly BandCode[] = ["stable", "downward", "target", "aspirational", "upward", "challenge", "outside"];
const code = (v: unknown): BandCode | null => (typeof v === "string" && (CODES as readonly string[]).includes(v) ? (v as BandCode) : null);

export interface CsatRow {
  offering: OfferingDto;
  band: ReferenceBandDto;
}

/** 가채점 판정 행(source g · 문턱 판정 · 7단계 코드)만. 9모 참고 행이 섞여 와도 쓰지 않는다 */
export function csatRows(c: CandidatesDto | null | undefined, report?: CandidateReport): CsatRow[] {
  const blocked = blockedCandidateIds(c);
  if (report) for (const id of confirmedIneligibleIds(report)) blocked.add(id);
  const out: CsatRow[] = [];
  for (const g of c?.reference_university_groups ?? []) {
    for (const it of g.offerings ?? []) {
      const b = it.reference_band;
      if (!b || b.held || b.basis !== "reference_threshold" || b.source !== "g" || !code(b.code) || !it.offering || blocked.has(it.offering.offering_id) || isCsatHeld(it.offering.offering_id)) continue;
      out.push({ offering: it.offering, band: b });
    }
  }
  return out;
}

/** 고정 판에서 모집단위 이름을 찾는다(정식 후보·와일드카드·참고 묶음) */
export function offeringIndex(c: CandidatesDto | null | undefined): Map<string, OfferingDto> {
  return new Map(
    [...(c?.basic_university_groups.flatMap((g) => g.offerings) ?? []), ...(c?.wildcards ?? []), ...(c?.reference_university_groups?.flatMap((g) => g.offerings) ?? [])].map((it) => [it.offering.offering_id, it.offering]),
  );
}

export const pickedIds = (shortlist: Record<string, ShortlistEntryDto> | null | undefined) =>
  Object.entries(shortlist ?? {}).filter(([, e]) => e?.selected).map(([id]) => id);

const position = (b: ReferenceBandDto | null | undefined) => {
  const p = b?.position;
  return p && typeof p.score === "string" ? { score: p.score, better_gap: p.better_gap ?? null, worse_gap: p.worse_gap ?? null, share_pct: typeof p.share_pct === "number" ? p.share_pct : null } : null;
};

/**
 * 담은 학교마다 상담 입력. years/quotas 는 화면 서버가 따로 읽은 1페이지 학년도 값·2027 모집인원(없으면 비운다).
 * 이름을 찾지 못한 모집단위는 넣지 않는다(이름 없이 문장을 만들지 않는다).
 */
export function counselSchools(
  report: CandidateReport & { shortlist?: Record<string, ShortlistEntryDto> },
  provisional: boolean,
  ids: readonly string[] = pickedIds(report.shortlist),
  years: Record<string, CounselYear[] | null> = {},
  quotas: Record<string, number | null> = {},
): CounselSchool[] {
  const names = offeringIndex(report.candidates);
  const csat = new Map(csatRows(report.candidates, report).map((r) => [r.offering.offering_id, r.band]));
  const out: CounselSchool[] = [];
  for (const id of ids) {
    const o = names.get(id);
    if (!o) continue;
    let band: CounselSchool["band"] = null;
    let pos: CounselSchool["position"] = null;
    let advantage: CounselSchool["advantage"] = null;
    if (provisional) {
      const b = csat.get(id);
      const c = code(b?.code);
      if (b && c) {
        band = { code: c, upper: code(b.upper_code) };
        pos = band.upper ? null : position(b);
      }
    } else {
      const a = report.analyses?.[id];
      const c = a?.status === "ready" ? code(a.band?.code) : null;
      const r = !c && a && a.status !== "ineligible" ? a.reference_band : null;
      if (c) band = { code: c, upper: null };
      else if (r && code(r.code)) band = { code: r.code, upper: code(r.upper_code) };
      if (a?.advantage) advantage = { delta_pp: a.advantage.delta_pp, status: a.advantage.status };
    }
    out.push({
      offering_id: id,
      university_name: o.university_name,
      department: o.department,
      group: o.group,
      track: o.track,
      campus: o.campus,
      band,
      provisional,
      position: pos,
      advantage,
      quota2027: quotas[id] ?? null,
      years: years[id] ?? null,
    });
  }
  return out;
}
