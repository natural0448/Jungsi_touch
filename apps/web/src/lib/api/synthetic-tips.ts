import type { AssessmentDto, ScoresInput } from "@/lib/dto";
import type { ProReason } from "@/lib/pro-dto";
import { BASE, CATALOG, RULE, zOf, type Rule } from "./synthetic-assessment";
import { HISTORY, syntheticRecruitment } from "./synthetic-history";

/*
  전문가용 상담 tip 근거(합성). 서버가 만들 pro_reason 과 같은 모양으로, 모집단위마다 '왜 이 분류인가'를
  전년(2026)과 견줘 낸다. 반영 비율·기준·학생 성적은 모두 지어낸 값이다.
  - 학생 점수는 올해(2027) 규칙으로만 계산한다. 전년 규칙은 '반영 방법이 어떻게 바뀌었나' 비교에만 쓴다.
  - 전년 컷과 학생 점수를 같은 척도로 견주는 근거는 학년도 동등화 전이라 pending 으로 둔다.
  - 영향이 큰 순서로 정렬한다(화면은 앞의 3개를 펼쳐 보인다).
*/

/** 2026학년도 합성 반영 비율(전년 모집요강 자리). 2027 과 다른 대학만 적는다 */
const RULE_2026: Record<string, Pick<Rule, "wk" | "wm" | "wi">> = {
  "syn-gaon": { wk: 0.35, wm: 0.35, wi: 0.3 },
  "syn-raon": { wk: 0.3, wm: 0.4, wi: 0.3 },
  "syn-saebit": { wk: 0.3, wm: 0.3, wi: 0.4 },
};
const AREA = { wk: "국어", wm: "수학", wi: "탐구" } as const;
const ZKEY = { wk: "k", wm: "m", wi: "i" } as const;
const GUIDE = (y: number) => ({ title: `예시 대학 ${y}학년도 정시 모집요강(합성)`, url: "https://example.invalid/synthetic-guide", source_year: y });
const RESULT = (y: number) => ({ title: `예시 대학 ${y}학년도 전형결과(합성)`, url: "https://example.invalid/synthetic-admission-results", source_year: y });
const pct = (w: number) => String(Math.round(w * 100));

type Area = keyof typeof AREA;
/** 학생의 상대적 강약(세 영역 평균과의 차이). 0.4 표준편차 이상 차이 날 때만 강·약이라 부른다 */
function relative(z: ReturnType<typeof zOf>, a: Area): "weak" | "strong" | "middle" {
  const mean = (z.k + z.m + z.i) / 3, d = z[ZKEY[a]] - mean;
  return d <= -0.4 ? "weak" : d >= 0.4 ? "strong" : "middle";
}
const metric = (base: string, year: number, name: string): string | null => {
  const v = HISTORY.find((h) => h.offering_id === `${base}-${year}` && h.metric_name === name && h.value !== null)?.value;
  return v === undefined || v === null ? null : String(v);
};

type Scored = { r: ProReason; w: number };

export function buildTips(analyses: Record<string, AssessmentDto>, scores: ScoresInput): ProReason[] {
  const z = zOf(scores);
  const out: ProReason[] = [];
  for (const o of CATALOG) {
    const a = analyses[o.offering_id];
    if (!a || a.status !== "ready") continue;
    const base = BASE(o.offering_id), rule = RULE[o.university_id];
    const tip = (code: ProReason["code"], values: ProReason["values"], extra: Partial<ProReason> = {}): ProReason => ({
      code, status: "ready", academic_year: 2027, offering_id: o.offering_id, comparison_context: null, values, public_basis: [], missing_reason: null, ...extra,
    });
    const list: Scored[] = [];

    // 1. 분류 근거: 판단 구간과 학생 환산점수(항상 맨 앞)
    const range = a.decision_evidence?.expected_acceptance_range;
    if (range && a.converted_score)
      list.push({
        w: 100,
        r: tip("classification_basis", [
          { name: "category", value: a.category, unit: null },
          { name: "student_score", value: a.converted_score, unit: "점" },
          { name: "range_lower", value: String(range.lower), unit: "점" },
          { name: "range_upper", value: String(range.upper), unit: "점" },
          { name: "scale", value: `대학 환산점수(${rule.max}점 만점)`, unit: null },
        ]),
      });

    // 2. 반영 비율 변화(전년 모집요강 대비) — 바뀐 영역마다, 학생 약점과 겹치면 무겁게
    const prev = RULE_2026[o.university_id];
    if (prev)
      for (const k of Object.keys(AREA) as Area[]) {
        const d = Math.round((rule[k] - prev[k]) * 100);
        if (Math.abs(d) < 5) continue;
        const rel = relative(z, k);
        list.push({
          w: 50 + Math.abs(d) + (rel === "weak" && d > 0 ? 30 : 0) + (rel === "strong" && d < 0 ? 20 : 0),
          r: tip(
            "rule_weight_change",
            [
              { name: "area", value: AREA[k], unit: null },
              { name: "previous_weight", value: pct(prev[k]), unit: "%" },
              { name: "current_weight", value: pct(rule[k]), unit: "%" },
              { name: "student_relative", value: rel, unit: null },
            ],
            { comparison_context: { academic_year: 2027, reference_year: 2026, metric: "reflection_weight", score_scale: null, population_id: null }, public_basis: [GUIDE(2027), GUIDE(2026)] },
          ),
        });
      }

    // 3. 학생의 약한·강한 영역을 많이 반영(올해 규칙만). 반영 비율 변화로 이미 말한 영역은 겹치지 않게 뺀다
    const changed = new Set(list.filter((x) => x.r.code === "rule_weight_change").map((x) => x.r.values.find((v) => v.name === "area")?.value));
    for (const k of Object.keys(AREA) as Area[]) {
      const rel = relative(z, k);
      if (rel === "middle" || rule[k] < 0.35 || changed.has(AREA[k])) continue;
      list.push({
        w: rel === "weak" ? 60 : 35,
        r: tip("subject_weight_strength", [
          { name: "area", value: AREA[k], unit: null },
          { name: "current_weight", value: pct(rule[k]), unit: "%" },
          { name: "student_relative", value: rel, unit: null },
        ], { public_basis: [GUIDE(2027)] }),
      });
    }

    // 4. 모집인원 증감(전년 발표 → 올해 모집요강)
    const cap26 = metric(base, 2026, "모집인원");
    const rec = syntheticRecruitment(o.offering_id)?.recruitment;
    const quota = rec?.final_count ?? rec?.initial_count;
    if (cap26 && quota != null && Number(cap26) !== quota) {
      const d = quota - Number(cap26);
      list.push({
        w: 40 + Math.abs(d) * 2,
        r: tip("admission_capacity_change", [
          { name: "previous", value: cap26, unit: "명" },
          { name: "current", value: String(quota), unit: "명" },
        ], { comparison_context: { academic_year: 2027, reference_year: 2026, metric: "quota", score_scale: null, population_id: null }, public_basis: [RESULT(2026), GUIDE(2027)] }),
      });
    }

    // 5. 전년 경쟁률·충원
    const ratio = metric(base, 2026, "경쟁률"), fill = metric(base, 2026, "충원인원");
    if (ratio)
      list.push({
        w: 30,
        r: tip("prior_competition", [
          { name: "competition_ratio", value: ratio, unit: "대 1" },
          ...(fill ? [{ name: "additional_admitted", value: fill, unit: "명" }] : []),
          ...(cap26 ? [{ name: "quota", value: cap26, unit: "명" }] : []),
        ], { comparison_context: { academic_year: 2027, reference_year: 2026, metric: "competition", score_scale: null, population_id: null }, public_basis: [RESULT(2026)] }),
      });

    // 6. 전년 50%·70%컷 폭(같은 척도일 때만)
    const c50 = metric(base, 2026, "최종등록자 50%"), c70 = metric(base, 2026, "최종등록자 70%");
    if (c50 && c70)
      list.push({
        w: 25,
        r: tip("historical_cut_spread", [
          { name: "cut50", value: c50, unit: "점" },
          { name: "cut70", value: c70, unit: "점" },
          { name: "gap", value: (Number(c50) - Number(c70)).toFixed(2), unit: "점" },
        ], { comparison_context: { academic_year: 2027, reference_year: 2026, metric: "final_registrant_cut", score_scale: `대학 환산점수(${rule.max}점 만점)`, population_id: null }, public_basis: [RESULT(2026)] }),
      });

    // 7. 전년 컷과 같은 척도 비교 — 학년도 동등화 전이라 보류
    if (c70)
      list.push({
        w: 1,
        r: tip("comparable_historical_cut_delta", [], { status: "pending", missing_reason: "year_bridge_required", comparison_context: { academic_year: 2027, reference_year: 2026, metric: "final_registrant_cut70", score_scale: null, population_id: null } }),
      });

    list.sort((x, y) => y.w - x.w);
    out.push(...list.map((x) => x.r));
  }
  return out;
}
