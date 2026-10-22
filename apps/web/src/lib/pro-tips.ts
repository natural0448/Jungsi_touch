import type { Category } from "@/lib/dto";
import type { ProReason } from "@/lib/pro-dto";

/*
  상담 tip 문장 — 서버 근거(code + values)를 그대로 문장으로 옮긴다. 숫자는 values 에 있는 것만 쓰고,
  값이 빠졌으면 그 문장을 만들지 않는다(지어내지 않는다). 확률·합격 예측 표현은 쓰지 않는다.
*/

export type TipLine = { text: string; caution?: string };

/** 받침에 따라 이/가, 을/를 */
const has = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0;
};
const iga = (w: string) => `${w}${has(w) ? "이" : "가"}`;
const eul = (w: string) => `${w}${has(w) ? "을" : "를"}`;

const v = (r: ProReason, name: string) => r.values.find((x) => x.name === name)?.value ?? null;

const CAT_TITLE: Record<Category, string> = {
  challenge: "도전으로", core: "핵심 검토로", room: "여유 후보로", outside: "추천 범위 밖으로", pending: "판단 보류로", ineligible: "지원 조건 미충족으로",
};
export const tipTitle = (c: Category) => `${CAT_TITLE[c]} 본 이유`;

export function tipLine(r: ProReason): TipLine | null {
  if (r.status === "pending") {
    if (r.code === "comparable_historical_cut_delta")
      return { text: "작년 컷과 이 학생 점수를 같은 기준으로 견주는 비교는, 학년도 사이 점수 보정(동등화)이 끝나면 보여 드립니다. 올해 점수를 작년 규칙에 그대로 넣어 비교하지 않습니다." };
    return null;
  }
  switch (r.code) {
    case "classification_basis": {
      const s = v(r, "student_score"), lo = v(r, "range_lower"), hi = v(r, "range_upper"), scale = v(r, "scale");
      if (!s || !lo || !hi) return null;
      const n = Number(s), where = n < Number(lo) ? `아래쪽 끝(${lo}점)보다 ${(Number(lo) - n).toFixed(2)}점 낮습니다` : n > Number(hi) ? `위쪽 끝(${hi}점)보다 ${(n - Number(hi)).toFixed(2)}점 높습니다` : "안에 있습니다";
      return { text: `이 학생의 올해 환산점수는 ${s}점이고, 이 모집단위의 핵심 검토 구간(${lo}~${hi}점) ${where}.${scale ? ` 점수는 ${scale} 기준입니다.` : ""}` };
    }
    case "rule_weight_change": {
      const area = v(r, "area"), p = v(r, "previous_weight"), c = v(r, "current_weight"), rel = v(r, "student_relative");
      if (!area || !p || !c) return null;
      const up = Number(c) > Number(p);
      const text = `${area} 반영 비율이 작년 ${p}%에서 올해 ${c}%로 ${up ? "커졌습니다" : "줄었습니다"}.`;
      const caution =
        rel === "weak" && up ? `이 학생은 ${iga(area)} 다른 영역보다 약해, 같은 성적이라도 작년 방식보다 불리하게 작용합니다. ${area} 비중이 큰 대학은 지원에 유의하세요.`
        : rel === "strong" && up ? `이 학생의 강점인 ${area} 비중이 커져 작년보다 유리하게 작용합니다.`
        : rel === "weak" && !up ? `약한 ${area} 비중이 줄어 작년보다 부담이 덜합니다.`
        : rel === "strong" && !up ? `강점인 ${area} 비중이 줄어 작년만큼의 이점은 기대하기 어렵습니다.`
        : undefined;
      return { text, caution };
    }
    case "subject_weight_strength": {
      const area = v(r, "area"), w = v(r, "current_weight"), rel = v(r, "student_relative");
      if (!area || !w) return null;
      return rel === "weak"
        ? { text: `이 대학은 ${eul(area)} ${w}% 반영합니다.`, caution: `이 학생은 ${iga(area)} 다른 영역보다 약해 이 대학 환산에서 불리하게 작용합니다.` }
        : { text: `이 대학은 이 학생의 강점인 ${eul(area)} ${w}% 반영해 유리하게 작용합니다.` };
    }
    case "admission_capacity_change": {
      const p = v(r, "previous"), c = v(r, "current");
      if (!p || !c) return null;
      const d = Number(c) - Number(p);
      return {
        text: `모집인원이 작년 ${p}명에서 올해 ${c}명으로 ${Math.abs(d)}명 ${d < 0 ? "줄었습니다" : "늘었습니다"}.`,
        caution: d < 0 ? "뽑는 인원이 줄면 같은 점수라도 합격선이 오를 수 있습니다." : undefined,
      };
    }
    case "prior_competition": {
      const ratio = v(r, "competition_ratio"), fill = v(r, "additional_admitted"), q = v(r, "quota");
      if (!ratio) return null;
      return { text: `작년 경쟁률은 ${ratio}대 1이었습니다.${q && fill ? ` 모집 ${q}명 중 ${fill}명이 충원으로 추가 합격했습니다.` : ""}` };
    }
    case "historical_cut_spread": {
      const c50 = v(r, "cut50"), c70 = v(r, "cut70"), gap = v(r, "gap");
      if (!c50 || !c70 || !gap) return null;
      return { text: `작년 최종등록자 50%컷은 ${c50}점, 70%컷은 ${c70}점으로 ${gap}점 차이였습니다. 이 폭이 좁을수록 몇 점 차이로 결과가 갈립니다.` };
    }
    case "english_deduction": {
      const g = v(r, "grade"), d = v(r, "deduction");
      return g && d ? { text: `영어 ${g}등급은 이 대학에서 ${d}점 감점됩니다.` } : null;
    }
    case "history_deduction": {
      const g = v(r, "grade"), d = v(r, "deduction");
      return g && d ? { text: `한국사 ${g}등급은 이 대학에서 ${d}점 감점됩니다.` } : null;
    }
  }
  return null; // 모르는 코드는 문장을 만들지 않는다
}

/** 모든 tip 상자 아래에 붙는 고정 안내 — '작년 이 등급대 합격' 이야기를 들은 학생·학부모용 */
export const GRADE_RUMOR_NOTE =
  "‘작년에 이 등급대가 합격했다’는 이야기는 대개 등급 기준입니다. 정시는 표준점수·백분위와 대학별 환산점수로 뽑고, 해마다 시험 난이도가 달라 같은 등급이라도 점수가 다릅니다. 대학이 반영 방법을 바꾸면 같은 성적이라도 결과가 달라질 수 있습니다.";

/** 근거를 모집단위별로 묶는다(서버가 정한 순서 유지) */
export function tipsByOffering(reasons: ProReason[]): Map<string, ProReason[]> {
  const m = new Map<string, ProReason[]>();
  for (const r of reasons) if (r.offering_id) m.set(r.offering_id, [...(m.get(r.offering_id) ?? []), r]);
  return m;
}
