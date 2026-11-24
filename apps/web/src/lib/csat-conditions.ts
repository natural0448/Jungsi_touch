import type { CsatMinimum, OverallAnalysisDto, SubjectResultDto } from "./dto";
import { INQUIRY_SUBJECTS } from "./exam";

/*
  수능 가채점 판정 없음의 화면 처리(담당자 11-23 회신 D1·C1, 대표님 승인).
  - D1: 학교 점수가 나오지 않은 모집단위 가운데 2027 Guide 에 '과학탐구 2과목'만 반영이 확정된 51곳은 사회탐구 응시면,
        '제2외국어/한문' 응시가 필수로 확정된 28곳은 미응시면 '지원 조건 미충족'. 나머지는 '비교 기준 확인 필요'.
        (담당자 project_non_assessment.review.v1 의 strictSciencePair·confirmed_required_exam_areas 와 같은 기준,
         자료 D1_2027_PK_Guide_응시조건_전국6081 75a45da0…)
  - C1: 예외 7곳의 점수(수능 반영분·우수 3영역). 담당자 calculate_v28_special_score.review.v1(3b8e2650…)를 그대로 옮겼다.
        입력은 과목별 가채점 백분위 범위와 영어·한국사 등급. 7단계·자동 후보와는 따로다.
*/
const SCIENCE_PAIR = new Set([29,30,49,52,53,56,66,73,74,76,79,80,81,84,85,86,88,89,96,97,102,103,107,109,112,113,1854,1855,2090,2102,6365,6366,7924,7925,7927,7939,7943,7954,7956,7959,10216,10217,10218,10219,10220,10221,10222,10231,10232,10233,10234].map((n) => `2027:${1000000000 + n}`));
const SECOND_LANG_REQUIRED = new Set([750,751,753,755,762,763,764,771,772,779,781,783,784,785,787,792,797,803,804,8023,8024,8025,8026,10600,10601,10602,10603,10609].map((n) => `2027:${1000000000 + n}`));

/*
  2026-11-24 대표님 지적('판정 근거 부족'이 어떤 학교인지 확인해 판정을 줄 수 있게): D1 전국 6,081행의 반영 탐구 영역·수학 지정으로
  판정 없는 모집단위를 '지원 조건 미충족'으로 확정한다(시험 계정 사탐·미적 450곳 중 356곳이 이 경우였다).
  - SCIENCE_ONLY_1/2: 반영 탐구 영역에 사회가 없다(inquiry_allowed_reflection_domains). _2 는 반영 과목 수 하한 2(과학 2과목 필요)
  - MATH_CALC_GEOM: 수학 '미적분 또는 기하' 지정(가산점만 주는 문구는 빼고). 확률과 통계 응시면 미충족
  학교 판정이 있으면 판정이 먼저다(이 함수는 판정 없는 행에만 쓴다).
*/
const SCIENCE_ONLY_1 = new Set([4325,4328,4331,4333,4334,4336,4917,4918,4927,4928,4943,4944,10732,10733,10734,10882,10883,10884,10885,10886,10887,10888].map((n) => `2027:${1000000000 + n}`));
const SCIENCE_ONLY_2 = new Set([29,30,49,52,53,56,66,73,74,76,79,80,81,84,85,86,88,89,96,97,102,103,107,109,112,113,297,309,310,321,322,542,749,754,758,759,760,761,765,766,767,768,773,774,775,776,777,780,782,786,789,795,796,798,799,801,802,805,807,808,809,810,811,812,813,845,922,925,933,941,953,959,960,963,965,968,970,971,972,991,995,996,1000,1008,1009,1010,1014,1016,1017,1099,1112,1124,1125,1140,1141,1171,1180,1185,1186,1193,1194,1201,1202,1323,1324,1326,1334,1335,1347,1348,1380,1381,1386,1391,1393,1398,1399,1400,1402,1403,1408,1409,1410,1413,1414,1415,1420,1423,1424,1433,1435,1437,1438,1439,1440,1442,1450,1451,1452,1455,1459,1460,1464,1465,1466,1467,1854,1855,1891,2004,2037,2090,2102,2331,2339,2441,2442,2469,2470,2834,2835,2844,2845,3056,3057,3070,3107,3845,4335,4378,4379,4389,4390,4496,4512,4513,4553,4600,4610,4620,4626,4645,4646,4726,4727,4735,4736,5206,6224,6235,6239,6365,6366,6427,6432,6443,6444,6445,6453,6498,6500,6505,6507,7220,7222,7403,7641,7924,7925,7927,7939,7943,7954,7956,7959,7986,8002,8022,8042,8092,8798,9231,9245,9247,9776,9777,10088,10089,10090,10091,10092,10093,10094,10216,10217,10218,10219,10220,10221,10222,10231,10232,10233,10234,10236,10237,10238,10239,10240,10241,10255,10269,10270,10271,10272,10273,10274,10275,10340,10341,10342,10343,10344,10345,10404,10405,10406,10407,10408,10409,10421,10422,10423,10424,10425,10604,10605,10606,10607,10608,10735,10736,10737,10738,10739,10740,10741,10743,10744,10745,10746,10747,10748,10749,10771,10774,10775,10776,10777,10778,10779,10780,10798,10799,10800,10801,10802,10803,10823,10824,10825,10858,10859,10860,10861,10862,10863,10865,10866,10867,10946,10947,10948,10949,10950,10951,10960,10961,10962,10963,10973,10974,10975,10976,10977,10978,10979,11354].map((n) => `2027:${1000000000 + n}`));
// D1 반영 탐구 영역이 사회뿐(대구한의대 한의예과 인문 2003), 수학 '확률과 통계'만 지정(2003, 동의대 한의예과 확률과통계 7090)
const SOCIAL_ONLY = new Set([2003].map((n) => `2027:${1000000000 + n}`));
const MATH_PROB_ONLY = new Set([2003, 7090].map((n) => `2027:${1000000000 + n}`));
/*
  2026-11-24 담당자 통합 회신(R1 대조 1,379건): 반영 영역·과목 수만으로 지원 자격을 단정하지 않는다. 지원 자격으로 확인된 조건만
  '지원 조건 미충족'(부산대 47 과학탐구 1과목 이상 필수, 성신여대 간호(인문) 사회탐구 1과목 이상 필수, 앞서 승인한 SCIENCE_PAIR 51·
  제2외국어 28·울산대 의예), 나머지 반영 과목 기반은 '반영 과목 불일치'(대표님 결정). 부산대 47·의약 5는 수학 지정에서 뺐다(확률과 통계 허용)
*/
const PNU_SCIENCE_1 = new Set([631, 632, 633, 638, 646, 650, 662, 663, 665, 670, 672, 675, 679, 680, 681, 682, 683, 686, 687, 699, 700, 708, 713, 714, 715, 716, 717, 718, 721, 726, 728, 740, 741, 745, 746, 6423, 6424, 8009, 8011, 8013, 8014, 8015, 8016, 8017, 8018, 10544, 11359].map((n) => `2027:${1000000000 + n}`));
const SUNGSHIN_SOCIAL_1 = new Set([3844].map((n) => `2027:${1000000000 + n}`));
const MISMATCH = (desc: string): NoJudgmentView => ({ label: "반영 과목 불일치", cls: "inel", desc: desc + " 지금 응시 과목으로는 이 대학 방식 점수를 계산할 수 없습니다. 지원 가능 여부는 모집요강에서 확인하세요." });
const MATH_CALC_GEOM = new Set([297,309,310,321,322,542,749,754,758,759,760,761,765,766,767,768,773,774,775,776,777,780,782,786,789,795,796,798,799,801,802,805,807,808,809,810,811,812,813,845,922,925,933,941,942,953,959,960,963,964,965,968,970,971,972,995,996,1000,1008,1009,1010,1011,1014,1016,1017,1099,1101,1112,1124,1125,1140,1141,1185,1186,1188,1193,1194,1201,1202,1323,1324,1325,1326,1334,1335,1347,1348,1357,1414,1415,1424,1433,1435,1439,1442,2004,2037,2090,2102,2331,2339,2441,2442,2469,2470,2834,2835,2844,2845,3107,4335,4496,4553,4726,4727,4735,4736,4917,4918,4927,4928,4943,4944,5206,6224,6235,6239,6427,6432,6443,6444,6445,6500,6507,7089,7220,7222,7403,7641,7986,8002,8022,9231,9776,9777,10088,10089,10090,10091,10092,10093,10094,10255,10269,10270,10271,10272,10273,10274,10275,10340,10341,10342,10343,10344,10345,10404,10405,10406,10407,10408,10409,10604,10605,10606,10607,10608,10735,10736,10737,10738,10739,10740,10741,10771,10798,10799,10800,10801,10802,10803,10823,10824,10825,10865,10866,10867,10882,10883,10884,10885,10886,10887,10888,10946,10947,10948,10949,10950,10951,10960,10961,10962,10963,10973,10974,10975,10976,10977,10978,10979,11354].map((n) => `2027:${1000000000 + n}`));

// K1 Guide 122-2027-R04/R05에는 과탐 두 과목 외에 수학 선택과 탐구 분야 조건도 있다.
const ULSAN_MEDICINE = new Set(["2027:1000004553", "2027:1000010771"]);

const SOCIAL = new Set(INQUIRY_SUBJECTS[0].subjects);
const SCIENCE = new Set(INQUIRY_SUBJECTS[1].subjects);
const kindOf = (s?: SubjectResultDto): "social" | "science" | null => (!s ? null : SOCIAL.has(s.subject) ? "social" : SCIENCE.has(s.subject) ? "science" : null);

export type NoJudgmentView = { label: "지원 조건 미충족" | "반영 과목 불일치" | "탐구 점수 환산 범위 확인" | "유형Ⅰ 점수만 계산" | "환산점수만 제공" | "수능 최저 미충족" | "수능 최저 충족 여부 갈림" | "비교 기준 확인 필요"; cls: string; desc: string };
/** 판정·예외 이름이 없는 모집단위의 사유. 리포트가 없으면 null */
/** min: 서버가 알려 준 수능 최저 사유(2026-11-24) — unmet 미달 확정, partial 가채점 점수에 따라 충족 여부 갈림 */
export function csatNoJudgmentView(offeringId: string, a: OverallAnalysisDto | null | undefined, min?: CsatMinimum | null): NoJudgmentView | null {
  if (!a) return null;
  if (min === "unmet") return { label: "수능 최저 미충족", cls: "inel", desc: "이 모집단위의 수능 최저학력기준(또는 의약 계열 최소 기준)을 지금 성적으로는 넘지 못합니다. 기준을 넘지 못하면 합격할 수 없습니다." };
  if (min === "condition") return MISMATCH("이 모집단위는 2027 반영 과목(과학탐구 분야·과목, 수학 선택 등)이 정해져 있습니다.");
  if (min === "cap") return { label: "탐구 점수 환산 범위 확인", cls: "check", desc: "가채점으로 추정한 탐구 표준점수가 이 대학 환산표의 범위를 넘어 이 대학 방식 점수를 계산하지 않았습니다. 성적표가 나오면 확정 점수로 계산됩니다." };
  if (min === "partial") return { label: "수능 최저 충족 여부 갈림", cls: "inel", desc: "가채점 점수 범위에 따라 이 모집단위의 수능 최저학력기준을 넘기도 하고 못 넘기도 합니다. 성적표가 나오면 정해집니다." };
  const display = a.provisional_school_display?.[offeringId];
  if (display?.reason === "non_csat_components_missing") {
    // 대표님 2026-11-24: 정시터치는 학생부를 받지 않는다 — 학생부 등 반영 전형은 환산점수만 공개하고, 다른 영역은 이 점수를 바탕으로 검토하도록 안내
    return { label: "환산점수만 제공", cls: "check", desc: "이 전형은 수능 외에 학생부 등 다른 영역도 반영합니다. 정시터치는 학생부 성적을 받지 않아 지원가능성 판정 없이 수능 환산점수만 보여 드립니다. 다른 반영 영역은 이 환산점수를 바탕으로 직접 검토해 주세요." };
  }
  if (display?.reason === "comparison_axis_unverified") {
    return { label: "비교 기준 확인 필요", cls: "check", desc: "이 모집단위의 과거 입결과 올해 성적을 같은 기준에서 비교할 수 있는지 확인 중입니다." };
  }
  const by = new Map(a.subjects.map((s) => [s.area, s]));
  const inquiry = [by.get("inquiry1"), by.get("inquiry2")];
  const hasSocialInquiry = inquiry.some((s) => kindOf(s) === "social");
  if (ULSAN_MEDICINE.has(offeringId)) {
    const math = by.get("math")?.choice?.replace(/\s+/g, "");
    const [first, second] = inquiry;
    const sameScienceField = first && second && SCIENCE.has(first.subject) && SCIENCE.has(second.subject)
      && first.subject.replace(/[ⅠⅡ]$/, "") === second.subject.replace(/[ⅠⅡ]$/, "");
    if (math === "확률과통계" || hasSocialInquiry || sameScienceField) {
      return {
        label: "지원 조건 미충족",
        cls: "inel",
        desc: "울산대 의예과는 미적분 또는 기하와 서로 다른 분야의 과학탐구 2과목이 필요합니다. 같은 분야 I·II 조합은 인정하지 않습니다.",
      };
    }
  }
  const scienceCount = inquiry.filter((s) => kindOf(s) === "science").length;
  const mathChoice = by.get("math")?.choice?.replace(/\s+/g, "");
  // 지원 자격으로 확인된 조건(담당자 R4)
  if (SNU_TYPE1.has(offeringId) && a.second_language) {
    return { label: "유형Ⅰ 점수만 계산", cls: "check", desc: "서울대 유형Ⅰ(사탐·확통 등) 수능 반영분 점수만 계산했습니다. 유형Ⅰ 지원자끼리의 위치와 7단계 판정은 대학 자료가 연결된 뒤 보입니다." };
  }
  if (SNU_TYPE1.has(offeringId) && !a.second_language) {
    return { label: "지원 조건 미충족", cls: "inel", desc: "서울대 이 모집단위는 과탐 2과목·미적분/기하(유형Ⅱ-2)가 아니면 유형Ⅰ로 지원하며, 유형Ⅰ은 제2외국어/한문 응시가 필요합니다. 응시했다면 성적 입력에 제2외국어/한문 등급을 넣어 주세요." };
  }
  if (PNU_SCIENCE_1.has(offeringId) && scienceCount < 1) {
    return { label: "지원 조건 미충족", cls: "inel", desc: "이 모집단위는 2027 모집요강에서 사회/과학탐구 2과목 중 과학탐구(과목 I 이상) 1과목 이상을 필수로 합니다." };
  }
  if (SUNGSHIN_SOCIAL_1.has(offeringId) && inquiry.every((s) => kindOf(s) === "science")) {
    return { label: "지원 조건 미충족", cls: "inel", desc: "이 모집단위는 2027 모집요강에서 사회탐구 1과목 이상 응시를 필수로 합니다(지정과목 미응시 시 선발 제외)." };
  }
  if (SCIENCE_PAIR.has(offeringId) && hasSocialInquiry) {
    return { label: "지원 조건 미충족", cls: "inel", desc: "이 모집단위는 2027 모집요강에서 과학탐구 2과목만 반영합니다. 사회탐구 응시로는 점수가 계산되지 않습니다." };
  }
  if (SECOND_LANG_REQUIRED.has(offeringId) && !a.second_language) {
    return { label: "지원 조건 미충족", cls: "inel", desc: "이 모집단위는 2027 모집요강에서 제2외국어/한문 응시가 필요합니다." };
  }
  // 반영 과목 기반(지원 자격은 단정하지 않음)
  if (MATH_PROB_ONLY.has(offeringId) && mathChoice && mathChoice !== "확률과통계") return MISMATCH("이 모집단위는 2027 모집요강에서 수학 확률과 통계를 반영합니다.");
  if (SOCIAL_ONLY.has(offeringId) && inquiry.some((s) => kindOf(s) === "science")) return MISMATCH("이 모집단위는 2027 모집요강에서 사회탐구를 반영합니다.");
  if (MATH_CALC_GEOM.has(offeringId) && mathChoice === "확률과통계") return MISMATCH("이 모집단위는 2027 모집요강에서 수학 미적분 또는 기하를 반영합니다.");
  if ((SCIENCE_ONLY_2.has(offeringId) && scienceCount < 2) || (SCIENCE_ONLY_1.has(offeringId) && scienceCount < 1)) {
    return MISMATCH(SCIENCE_ONLY_2.has(offeringId) ? "이 모집단위는 2027 모집요강에서 과학탐구 2과목을 점수에 반영합니다." : "이 모집단위는 2027 모집요강에서 과학탐구를 점수에 반영합니다.");
  }
  return { label: "비교 기준 확인 필요", cls: "check", desc: "이 모집단위는 지금 성적으로 학교 점수 또는 합격권 기준을 비교할 자료가 아직 맞춰지지 않았습니다. 반영 과목·선택과목 조건도 모집요강에서 확인해 주세요." };
}

/* ─── C1: 담당자 calculate_v28_special_score.review.v1 을 옮김(계산식은 바꾸지 않는다) ─── */
type Bounds = readonly [number, number];
type Rule = { kind: "sangmyung" | "seokyeong" | "chosun" | "cheongju" | "anyang"; english: readonly number[]; history: readonly number[] | null; den: number; display: "csat_component_only" | "personal_reference" };
const C1_RULES: Readonly<Record<string, Rule>> = {
  "2027:1000003567": { kind: "sangmyung", english: [100, 98, 96, 94, 90, 80, 60, 40, 0], history: [100, 100, 100, 100, 98, 96, 94, 92, 90], den: 50, display: "csat_component_only" },
  "2027:1000007388": { kind: "anyang", english: [100, 95, 90, 85, 80, 65, 50, 30, 0], history: null, den: 31, display: "personal_reference" },
  "2027:1000010568": { kind: "seokyeong", english: [100, 90, 80, 70, 50, 30, 20, 10, 0], history: [5, 5, 5, 4, 4, 3, 3, 2, 1], den: 5, display: "csat_component_only" },
  "2027:1000010569": { kind: "seokyeong", english: [100, 90, 80, 70, 50, 30, 20, 10, 0], history: [5, 5, 5, 4, 4, 3, 3, 2, 1], den: 5, display: "csat_component_only" },
  "2027:1000010868": { kind: "chosun", english: [100, 95, 90, 85, 80, 75, 70, 65, 60], history: null, den: 3, display: "csat_component_only" },
  "2027:1000010922": { kind: "cheongju", english: [100, 95, 90, 85, 80, 75, 70, 65, 60], history: null, den: 100, display: "csat_component_only" },
  "2027:1000010923": { kind: "cheongju", english: [100, 95, 90, 85, 80, 75, 70, 65, 60], history: null, den: 100, display: "csat_component_only" }
};
type Pct = Bounds | null;
const top = (values: readonly number[], count: number) => [...values].sort((x, y) => y - x).slice(0, count).reduce((x, y) => x + y, 0);
function pts(grade: number | undefined, scale: readonly number[] | null): Bounds | null {
  if (!scale || scale.length !== 9 || !Number.isInteger(grade) || grade! < 1 || grade! > 9) return null;
  return [scale[grade! - 1], scale[grade! - 1]];
}
function rankThenBonus(math: Bounds, others: readonly Bounds[]): Bounds {
  let low = Infinity, high = -Infinity;
  const add = (x: number, y: number) => { low = Math.min(low, x); high = Math.max(high, y); };
  for (let m = math[0]; m <= math[1]; m++) {
    if (others.length === 2) {
      add(11 * m + 10 * top(others.map((r) => r[0]), 2), 11 * m + 10 * top(others.map((r) => r[1]), 2));
      continue;
    }
    if (others.every((r) => r[1] >= m)) add(10 * top(others.map((r) => Math.max(r[0], m)), 3), 10 * top(others.map((r) => r[1]), 3));
    for (let w = 0; w < others.length; w++) {
      const cap = Math.min(others[w][1], m - 1);
      if (cap >= others[w][0]) add(11 * m + 10 * top(others.map((r) => r[0]), 2), 11 * m + 10 * top(others.map((r, j) => (j === w ? cap : r[1])), 2));
    }
  }
  return [low, high];
}
function c1Bounds(rule: Rule, k: Pct, m: Pct, mathChoice: string | null, e: number | undefined, h: number | undefined, q: Bounds[] | null): Bounds[] | null {
  if (rule.kind === "anyang") {
    const eg = pts(e, rule.english);
    if (!q || !q.length || !k || !m || !eg) return null;
    if (!(mathChoice === "확률과 통계" || mathChoice === "미적분" || mathChoice === "기하")) return null;
    const inquiry: Bounds = [Math.max(...q.map((r) => r[0])), Math.max(...q.map((r) => r[1]))];
    const others = [k, eg, inquiry];
    const bonus = mathChoice === "미적분" || mathChoice === "기하";
    const sel = (i: 0 | 1) => top([...others.map((r) => 10 * r[i]), (bonus ? 11 : 10) * m[i]], 3);
    const before: Bounds = [sel(0), sel(1)];
    return [bonus ? rankThenBonus(m, others) : before, before];
  }
  const eg = pts(e, rule.english);
  if (!k || !m || !eg || !q || q.length !== 2) return null;
  if (rule.kind === "sangmyung") {
    const hg = pts(h, rule.history);
    if (!hg) return null;
    const w = (i: 0 | 1) => 4 * (35 * k[i] + 25 * m[i] + 20 * eg[i] + 20 * Math.max(q[0][i], q[1][i]));
    return [[w(0) + 4 * hg[0], w(1) + 4 * hg[1]], [w(0) + 5 * hg[0], w(1) + 5 * hg[1]]];
  }
  if (rule.kind === "seokyeong") {
    const hg = pts(h, rule.history);
    if (!hg) return null;
    const sc = (i: 0 | 1) => 7 * (top([2 * k[i], 2 * m[i], q[0][i] + q[1][i]], 2) + eg[i]) + 5 * hg[i];
    return [[sc(0), sc(1)]];
  }
  const sum = (i: 0 | 1) => top([k[i], m[i], eg[i], Math.max(q[0][i], q[1][i])], 3);
  if (rule.kind === "chosun") return [[7 * sum(0), 7 * sum(1)]];
  if (rule.kind === "cheongju") {
    const sc = (i: 0 | 1) => 7 * Math.floor((100 * sum(i) + 1) / 3);
    return [[sc(0), sc(1)]];
  }
  return null;
}
/* ─── 옮긴 부분 끝 ─── */

const dec2 = (n: number, d: number) => (Math.round((n / d) * 100) / 100).toFixed(2);
const pctOf = (s?: SubjectResultDto): Pct => {
  const r = s?.percentile_range;
  return r && Number.isInteger(r.low) && Number.isInteger(r.high) ? [Math.min(r.low, r.high), Math.max(r.low, r.high)] : null;
};

export type C1Score = { label: "수능 반영분 점수" | "대학 환산점수" | "우수 3영역 점수" | "유형Ⅰ 수능 반영분 점수"; central: string | null; low: string; high: string };
/** 예외 7곳이면 가채점 성적으로 계산한 점수(범위), 아니면 null */
/*
  서울대 간호·식품영양·의류 유형Ⅰ(담당자 통합 회신 11-24 R4, snu_type1_provisional_score.ts 를 옮김 — 식은 바꾸지 않는다).
  국어 표준점수×1.0 + 수학×1.2 + 탐구 두 과목 합×0.8 − 영어·한국사·제2외국어/한문 등급 감점(점수/10). 유형Ⅱ-2 판정이 있으면 그쪽이 먼저(서버 판정).
  제2외국어/한문 미응시는 유형Ⅰ 요구조건 미충족. 이 점수에는 누백·7단계를 붙이지 않는다(유형Ⅰ 곡선·경계 결속 전).
*/
const SNU_TYPE1 = new Set(["2027:1000000747", "2027:1000000778", "2027:1000000790"]);
const SNU_EN = [0, 5, 20, 40, 60, 80, 100, 120, 140], SNU_HI = [0, 0, 0, 4, 8, 12, 16, 20, 24], SNU_L2 = [0, 0, 5, 10, 15, 20, 25, 30, 35];
function snuType1Score(a: OverallAnalysisDto): C1Score | null {
  const by = new Map(a.subjects.map((s) => [s.area, s]));
  const rng = (s?: SubjectResultDto): [number, number, number] | null => {
    if (!s) return null;
    const r = s.standard_score_range;
    if (r) return [r.low, r.central, r.high];
    return typeof s.standard_score === "number" ? [s.standard_score, s.standard_score, s.standard_score] : null;
  };
  const k = rng(by.get("korean")), m = rng(by.get("math")), q1 = rng(by.get("inquiry1")), q2 = rng(by.get("inquiry2"));
  const en = a.absolute_grades?.영어, hi = a.absolute_grades?.한국사, l2 = a.second_language?.grade;
  if (!k || !m || !q1 || !q2 || !en || !hi || !l2) return null;
  const ded = SNU_EN[en - 1] + SNU_HI[hi - 1] + SNU_L2[l2 - 1];
  const at = (i: 0 | 1 | 2) => 10 * k[i] + 12 * m[i] + 8 * (q1[i] + q2[i]) - ded;
  const lo = at(0), c = at(1), hiN = at(2);
  return { label: "유형Ⅰ 수능 반영분 점수", central: dec2(c, 10), low: dec2(lo, 10), high: dec2(hiN, 10) };
}
export function csatC1Score(offeringId: string, a: OverallAnalysisDto | null | undefined): C1Score | null {
  const display = a?.provisional_school_display?.[offeringId];
  const central = display?.central_score;
  if (display && typeof central === "string" && /^[+-]?\d{1,12}(?:\.\d{1,12})?$/.test(central)) {
    return { label: display.score_kind === "csat_component" ? "수능 반영분 점수" : "대학 환산점수", central, low: central, high: central };
  }
  if (SNU_TYPE1.has(offeringId)) return a && a.second_language ? snuType1Score(a) : null;
  const rule = C1_RULES[offeringId];
  if (!rule || !a) return null;
  const by = new Map(a.subjects.map((s) => [s.area, s]));
  const q1 = by.get("inquiry1"), q2 = by.get("inquiry2");
  const qs = [q1, q2];
  if (qs.some((s) => !kindOf(s)) || q1?.subject === q2?.subject) return null;
  const q = qs.map(pctOf);
  if (q.some((r) => !r)) return null;
  const branches = c1Bounds(rule, pctOf(by.get("korean")), pctOf(by.get("math")), by.get("math")?.choice ?? null, a.absolute_grades?.영어, a.absolute_grades?.한국사, q as Bounds[]);
  if (!branches || !branches.length) return null;
  const lo = Math.min(...branches.map((b) => b[0])), hi = Math.max(...branches.map((b) => b[1]));
  return { label: rule.display === "personal_reference" ? "우수 3영역 점수" : "수능 반영분 점수", central: lo === hi ? dec2(lo, rule.den) : null, low: dec2(lo, rule.den), high: dec2(hi, rule.den) };
}
