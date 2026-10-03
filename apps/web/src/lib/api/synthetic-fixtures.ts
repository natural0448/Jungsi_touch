import type { OfferingAnalysis, OfferingRow, ScoreBasis, UniversityRef } from "@/lib/contract";

/*
  합성 응답 자료. 대학·학과·점수·판정은 모두 지어낸 예시이며 실제 대학 자료가 아니다.
  대학 이름에 '예시'를 붙여 실제 대학으로 오해하지 않게 한다. 3페이지 시안(2026-10-03)과 같은 자료다.
  여섯 가지 지원가능성 상태와 보류(반영식 미확정·자격 미충족), 미공개·미확정 모집인원을 모두 담는다.
*/

const AS_OF = "2026-09-10";

const U: Record<string, UniversityRef> = {
  gaon: { university_id: "syn-gaon", name: "예시가온대학교", region: "서울", founding: "사립", score_scale_label: "1000점 만점 · 인문사회 반영식 / 자연 반영식" },
  haesol: { university_id: "syn-haesol", name: "예시해솔대학교", region: "충남", founding: "국립", score_scale_label: "600점 만점 · 보건계열 반영식" },
  daon: { university_id: "syn-daon", name: "예시다온대학교", region: "경기", founding: "사립", score_scale_label: "800점 만점 · 표준점수 반영식" },
};

const rec = (initial: number, change: number | null, final: number | null) => ({ initial, change, final, confirmed: final !== null, as_of: AS_OF });

export const OFFERINGS: OfferingRow[] = [
  { offering_id: "syn-g1", university: U.gaon, unit_name: "경영학과", admission_name: "수능위주 일반", group: "가", recruitment: rec(32, 2, 34) },
  { offering_id: "syn-g2", university: U.gaon, unit_name: "경제학과", admission_name: "수능위주 일반", group: "가", recruitment: rec(28, 0, 28) },
  { offering_id: "syn-g3", university: U.gaon, unit_name: "컴퓨터공학과", admission_name: "수능위주 일반", group: "나", recruitment: rec(40, null, null) },
  { offering_id: "syn-g4", university: U.gaon, unit_name: "자유전공학부", admission_name: "수능위주 일반", group: "나", recruitment: rec(20, 0, 20) },
  { offering_id: "syn-d1", university: U.daon, unit_name: "미디어커뮤니케이션학과", admission_name: "수능위주 일반", group: "가", recruitment: rec(22, -1, 21) },
  { offering_id: "syn-d2", university: U.daon, unit_name: "응용통계학과", admission_name: "수능위주 일반", group: "다", recruitment: rec(16, 0, 16) },
  { offering_id: "syn-h1", university: U.haesol, unit_name: "임상병리학과", admission_name: "수능위주 일반", group: "다", recruitment: rec(15, 3, 18) },
  { offering_id: "syn-h2", university: U.haesol, unit_name: "간호학과", admission_name: "수능위주 일반", group: "다", recruitment: rec(24, null, null) },
  { offering_id: "syn-h3", university: U.haesol, unit_name: "군사학과", admission_name: "수능+면접·체력(조건부)", group: "나", recruitment: rec(10, 0, 10) },
];

export const BASIS: ScoreBasis = { exam_label: "2027 9월 모의평가", total_standard_score: 389, overall_top_percent: "2.35", estimated: true };

const M = "최종등록자 70%";
const hist = (...cuts: (string | null)[]) => cuts.map((c, i) => ({ result_year: 2026 - i, metric_label: M, cut_top_percent: c }));
const calc = (score: string, max: string, rule: string, top: string) => ({ status: "calculated" as const, score, max_score: max, rule_label: rule, university_top_percent: top, reason_code: null });
const adv = (pp: string, top: string) => ({ status: "computed" as const, pp, total_top_percent: BASIS.overall_top_percent, university_top_percent: top, reason_code: null });

export const ANALYSES: OfferingAnalysis[] = [
  { offering_id: "syn-g1", converted: calc("915.20", "1000", "인문사회 반영식", "1.82"), advantage: adv("+0.53", "1.82"),
    support: { status: "reach", history: hist("1.40", "1.55", "1.62", null), reason: "수학 강점이 인문사회 반영식에서 유리하게 반영되지만, 이 학과의 지난 기준 위치에는 아직 미치지 않습니다." } },
  { offering_id: "syn-g2", converted: calc("915.20", "1000", "인문사회 반영식", "1.82"), advantage: adv("+0.53", "1.82"),
    support: { status: "core", history: hist("1.95", "1.78", "2.10", "1.88"), reason: "같은 환산점수라도 경제학과의 지난 기준과 비교하면 핵심 검토 범위입니다." } },
  { offering_id: "syn-g3", converted: calc("921.05", "1000", "자연 반영식", "2.04"), advantage: adv("+0.31", "2.04"),
    support: { status: "out_of_range", history: hist("0.92", "1.10", "1.05", "1.21"), reason: "환산 이점이 있지만 이 학과의 지난 기준 위치와 차이가 커서 이번 추천 범위에는 넣지 않았습니다. 지원 불가라는 뜻은 아닙니다." } },
  { offering_id: "syn-g4",
    converted: { status: "pending", score: null, max_score: "1000", rule_label: "자유전공 반영식(올해 변경)", university_top_percent: null, reason_code: "CONVERSION_TABLE_PENDING" },
    advantage: { status: "pending", pp: null, total_top_percent: BASIS.overall_top_percent, university_top_percent: null, reason_code: "CONVERSION_TABLE_PENDING" },
    support: { status: "needs_check", history: hist(null, null, null, null), reason: "올해 반영식이 바뀌어 비교할 수 있는 과거 기준을 확인하고 있습니다. 확인 전에는 판정을 내지 않습니다." } },
  { offering_id: "syn-d1", converted: calc("702.6", "800", "표준점수 반영식", "2.31"), advantage: adv("+0.04", "2.31"),
    support: { status: "core", history: hist("2.28", "2.50", "2.12", "2.44"), reason: "총점을 그대로 반영하는 대학이라 환산 유불리는 거의 없습니다. 지난 기준 위치와 비슷해 핵심 검토 범위입니다." } },
  { offering_id: "syn-d2", converted: calc("705.0", "800", "수학 가중 반영식", "1.98"), advantage: adv("+0.37", "1.98"),
    support: { status: "safe", history: hist("3.02", "2.88", "3.15", "2.95"), reason: "수학 가중 반영식이라 수학 강점이 크게 반영됩니다. 지난 기준 위치와 비교해 여유가 있습니다." } },
  { offering_id: "syn-h1", converted: calc("548.30", "600", "보건계열 반영식", "2.48"), advantage: adv("-0.13", "2.48"),
    support: { status: "safe", history: hist("6.10", "5.85", "6.40", "6.02"), reason: "탐구 반영 비율이 낮아 환산은 조금 불리하지만, 이 학과의 지난 기준 위치와는 여유가 있습니다." } },
  { offering_id: "syn-h2", converted: calc("551.10", "600", "간호 반영식", "1.93"), advantage: adv("+0.42", "1.93"),
    support: { status: "core", history: hist("2.05", "1.80", null, "2.11"), reason: "간호 반영식에서 영어 등급 반영이 유리하게 작용합니다. 2024학년도는 대학이 이 지표를 발표하지 않았습니다." } },
  { offering_id: "syn-h3",
    converted: { status: "calculated", score: "540.00", max_score: "600", rule_label: "군사학 반영식", university_top_percent: null, reason_code: null },
    advantage: { status: "pending", pp: null, total_top_percent: BASIS.overall_top_percent, university_top_percent: null, reason_code: "ELIGIBILITY_NOT_MET" },
    support: { status: "ineligible", history: [], reason: "이 전형은 신체·연령 지원 자격을 확인해야 합니다. 입력하신 정보로는 지원 자격을 충족하지 않는 것으로 확인됩니다." } },
];
