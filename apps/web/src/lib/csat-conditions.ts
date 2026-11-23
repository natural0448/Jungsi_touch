import type { OverallAnalysisDto, SubjectResultDto } from "./dto";
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
const MATH_CALC_GEOM = new Set([297,309,310,321,322,542,749,754,758,759,760,761,765,766,767,768,773,774,775,776,777,780,782,786,789,795,796,798,799,801,802,805,807,808,809,810,811,812,813,845,922,925,933,941,942,953,959,960,963,964,965,968,970,971,972,995,996,1000,1008,1009,1010,1011,1014,1016,1017,1099,1101,1112,1124,1125,1140,1141,1185,1186,1188,1193,1194,1201,1202,1323,1324,1325,1326,1334,1335,1347,1348,1357,1414,1415,1424,1433,1435,1439,1442,2004,2037,2090,2102,2331,2339,2441,2442,2469,2470,2834,2835,2844,2845,3107,4335,4496,4553,4726,4727,4735,4736,4917,4918,4927,4928,4943,4944,5206,6224,6235,6239,6427,6432,6443,6444,6445,6500,6507,7089,7220,7222,7403,7641,7986,8002,8022,9231,9776,9777,10088,10089,10090,10091,10092,10093,10094,10255,10269,10270,10271,10272,10273,10274,10275,10340,10341,10342,10343,10344,10345,10404,10405,10406,10407,10408,10409,10604,10605,10606,10607,10608,10735,10736,10737,10738,10739,10740,10741,10771,10798,10799,10800,10801,10802,10803,10823,10824,10825,10865,10866,10867,10882,10883,10884,10885,10886,10887,10888,10946,10947,10948,10949,10950,10951,10960,10961,10962,10963,10973,10974,10975,10976,10977,10978,10979,11354].map((n) => `2027:${1000000000 + n}`));

// K1 Guide 122-2027-R04/R05에는 과탐 두 과목 외에 수학 선택과 탐구 분야 조건도 있다.
const ULSAN_MEDICINE = new Set(["2027:1000004553", "2027:1000010771"]);

const SOCIAL = new Set(INQUIRY_SUBJECTS[0].subjects);
const SCIENCE = new Set(INQUIRY_SUBJECTS[1].subjects);
const kindOf = (s?: SubjectResultDto): "social" | "science" | null => (!s ? null : SOCIAL.has(s.subject) ? "social" : SCIENCE.has(s.subject) ? "science" : null);

export type NoJudgmentView = { label: "지원 조건 미충족" | "비교 기준 확인 필요"; cls: string; desc: string };
/** 판정·예외 이름이 없는 모집단위의 사유. 리포트가 없으면 null */
export function csatNoJudgmentView(offeringId: string, a: OverallAnalysisDto | null | undefined): NoJudgmentView | null {
  if (!a) return null;
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
  if (MATH_CALC_GEOM.has(offeringId) && mathChoice === "확률과통계") {
    return { label: "지원 조건 미충족", cls: "inel", desc: "이 모집단위는 2027 모집요강에서 수학 미적분 또는 기하를 지정합니다. 확률과 통계 응시로는 지원 조건에 맞지 않습니다." };
  }
  if ((SCIENCE_ONLY_2.has(offeringId) && scienceCount < 2) || (SCIENCE_ONLY_1.has(offeringId) && scienceCount < 1)) {
    return { label: "지원 조건 미충족", cls: "inel", desc: SCIENCE_ONLY_2.has(offeringId) ? "이 모집단위는 2027 모집요강에서 과학탐구 2과목만 반영합니다. 사회탐구 응시 과목은 점수에 들어가지 않습니다." : "이 모집단위는 2027 모집요강에서 과학탐구만 반영합니다. 사회탐구 응시로는 점수가 계산되지 않습니다." };
  }
  if (SCIENCE_PAIR.has(offeringId) && hasSocialInquiry) {
    return { label: "지원 조건 미충족", cls: "inel", desc: "이 모집단위는 2027 모집요강에서 과학탐구 2과목만 반영합니다. 사회탐구 응시로는 점수가 계산되지 않습니다." };
  }
  if (SECOND_LANG_REQUIRED.has(offeringId) && !a.second_language) {
    return { label: "지원 조건 미충족", cls: "inel", desc: "이 모집단위는 2027 모집요강에서 제2외국어/한문 응시가 필요합니다." };
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

export type C1Score = { label: "수능 반영분 점수" | "우수 3영역 점수"; central: string | null; low: string; high: string };
/** 예외 7곳이면 가채점 성적으로 계산한 점수(범위), 아니면 null */
export function csatC1Score(offeringId: string, a: OverallAnalysisDto | null | undefined): C1Score | null {
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
