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
