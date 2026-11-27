import type { ReportDto, ScoreInputStatusDto } from "./dto";

// 리포트 과목 영역 이름(lib/exam AREA_LABEL 과 같다). 이 모듈은 다른 모듈을 값으로 불러오지 않는다(시험이 그대로 실행한다)
const AREA_LABEL: Record<string, string> = { korean: "국어", math: "수학", inquiry1: "탐구 1", inquiry2: "탐구 2" };

/*
  받을 수 없는 점수(2026-11-22 대표님 결정). 화면(확인 창)·서버 액션·3·4페이지 막기가 같이 쓴다.
  서버(jungsi-api dep_r24 domain/provisional_raw_achievable.ts)도 같은 구조로 판정해, 저장하면 정상 거절(입력 1회 사용)로 남긴다.

  가채점 원점수 — 가채점 변환표(20261120 review v1)는 0~만점 모든 정수에 행이 있어 '받을 수 있는 점수' 목록이 아니고,
  시험팩에도 문항·배점이 없다. 그래서 평가원 수능 구조(맞힌 문항 배점의 합, 부분 점수 없음)로 계산한다.
    국어 45문항 100점: 2점 35·3점 10 / 수학 30문항 100점: 2점 3·3점 14·4점 13 / 영어 45문항 100점: 2점 35·3점 10
    한국사 20문항 50점: 2점 10·3점 10 / 탐구 20문항 50점: 2점 10·3점 10 / 제2외국어/한문 30문항 50점: 1점 10·2점 20
  → 국어·수학·영어 1·99, 한국사·탐구 1·49 불가, 제2외국어/한문은 0~50 모두 가능. 대표님 기준표와 같다(기준표 점수는 늘 불가).

  9월·실채점 표준점수 — 그 시험 팩의 표준점수↔백분위↔등급 표에 없는 점수. 화면은 그 표를 받지 못하므로(받는 API 없음)
  표가 주어질 때만 화면에서 미리 판정하고, 아니면 서버가 성적표에 없는 점수(unobserved_standard_score)로 거절한다.
  등급만 넣는 과목은 1~9 범위 검사로 충분하다(선택 목록이 1~9).
*/

export type RawArea = "korean" | "math" | "english" | "korean_history" | "inquiry" | "second_language";

/** [배점, 문항 수] */
export const RAW_STRUCTURES: Readonly<Record<RawArea, readonly (readonly [number, number])[]>> = {
  korean: [[2, 35], [3, 10]],
  math: [[2, 3], [3, 14], [4, 13]],
  english: [[2, 35], [3, 10]],
  korean_history: [[2, 10], [3, 10]],
  inquiry: [[2, 10], [3, 10]],
  second_language: [[1, 10], [2, 20]],
};

/** 대표님 기준표(2026-11-22): 반드시 '받을 수 없음' */
export const ALWAYS_UNATTAINABLE: Readonly<Record<RawArea, readonly number[]>> = {
  korean: [1, 99],
  math: [1, 99],
  english: [1, 99],
  korean_history: [1, 49],
  inquiry: [1, 49],
  second_language: [],
};

/** 맞힌 문항 배점의 합으로 만들 수 있는 모든 점수(0 포함) */
export function achievableScores(parts: readonly (readonly [number, number])[]): Set<number> {
  let sums = new Set<number>([0]);
  for (const [points, count] of parts) {
    for (let i = 0; i < count; i++) {
      const next = new Set(sums);
      for (const s of sums) next.add(s + points);
      sums = next;
    }
  }
  return sums;
}

const ACHIEVABLE = Object.fromEntries(
  (Object.keys(RAW_STRUCTURES) as RawArea[]).map((a) => {
    const set = achievableScores(RAW_STRUCTURES[a]);
    for (const x of ALWAYS_UNATTAINABLE[a]) set.delete(x);
    return [a, set];
  }),
) as Record<RawArea, Set<number>>;

/** 이 영역에서 받을 수 있는 원점수인가. 정수가 아니면 false(범위 검사는 따로 한다) */
export const isAchievableRaw = (area: RawArea, raw: number): boolean => Number.isInteger(raw) && ACHIEVABLE[area].has(raw);

/** 확인 창·안내에 보일 한 줄(어떤 과목·어떤 점수) */
export interface BadScore {
  label: string;
  score: number;
}

/** 가채점 양식 값에서 받을 수 없는 원점수. 빈 칸은 보지 않는다(필수 검사는 따로) */
export function unattainableRaw(v: {
  korean_choice?: string; korean?: number; math_choice?: string; math?: number;
  inq1?: string; inq1_raw?: number; inq2?: string; inq2_raw?: number;
  english?: number; history?: number; sl_subject?: string; sl_raw?: number;
}): BadScore[] {
  const out: BadScore[] = [];
  const check = (area: RawArea, raw: number | undefined, label: string) => {
    if (typeof raw === "number" && Number.isFinite(raw) && !isAchievableRaw(area, raw)) out.push({ label, score: raw });
  };
  const sub = (name: string, choice?: string) => (choice ? `${name}(${choice})` : name);
  check("korean", v.korean, sub("국어", v.korean_choice));
  check("math", v.math, sub("수학", v.math_choice));
  check("english", v.english, "영어");
  check("korean_history", v.history, "한국사");
  check("inquiry", v.inq1_raw, `탐구 1${v.inq1 ? `(${v.inq1})` : ""}`);
  check("inquiry", v.inq2_raw, `탐구 2${v.inq2 ? `(${v.inq2})` : ""}`);
  if (v.sl_subject && v.sl_subject !== "none") check("second_language", v.sl_raw, sub("제2외국어/한문", v.sl_subject));
  return out;
}

/**
 * 9월·실채점 표준점수 양식의 필수 칸(2026-11-22 대표님 결정: 모든 과목 필수).
 * 국어·수학 선택과목, 탐구 두 과목, 국어·수학·탐구 표준점수, 영어·한국사 등급. 제2외국어/한문은 second-language.ts 가 따로 본다
 */
export const STANDARD_REQUIRED = ["korean_choice", "math_choice", "inq1", "inq2", "korean", "math", "inq1_score", "inq2_score", "english", "history"] as const;
export const MISSING_STANDARD = "국어·수학 선택과목과 표준점수, 탐구 두 과목과 표준점수, 영어·한국사 등급을 모두 넣어 주세요.";
/** 빈 필수 칸 이름들 */
export const missingStandard = (get: (k: (typeof STANDARD_REQUIRED)[number]) => unknown): string[] =>
  STANDARD_REQUIRED.filter((k) => {
    const v = get(k);
    return v === undefined || v === null || (typeof v === "number" && Number.isNaN(v)) || String(v).trim() === "";
  });

/** 과목별 표준점수 표(그 시험 팩에 실린 표준점수). 키는 'korean'·'math'·탐구 과목 이름 */
export type StandardTable = Readonly<Record<string, ReadonlySet<number>>>;

/** 9월·실채점 표준점수 가운데 표에 없는 점수. 표가 없으면 판정하지 않는다(서버가 거절한다) */
export function unobservedStandard(
  v: { korean?: number; math?: number; inq1?: string; inq1_score?: number; inq2?: string; inq2_score?: number; korean_choice?: string; math_choice?: string },
  table: StandardTable | null | undefined,
): BadScore[] {
  if (!table) return [];
  const out: BadScore[] = [];
  const check = (key: string | undefined, score: number | undefined, label: string) => {
    const set = key ? table[key] : undefined;
    if (set && typeof score === "number" && Number.isFinite(score) && !set.has(score)) out.push({ label, score });
  };
  check("korean", v.korean, v.korean_choice ? `국어(${v.korean_choice})` : "국어");
  check("math", v.math, v.math_choice ? `수학(${v.math_choice})` : "수학");
  check(v.inq1, v.inq1_score, `탐구 1${v.inq1 ? `(${v.inq1})` : ""}`);
  check(v.inq2, v.inq2_score, `탐구 2${v.inq2 ? `(${v.inq2})` : ""}`);
  return out;
}

/**
 * 저장 확인 창의 다음 단계. 받을 수 없는 점수가 없으면 바로 보낸다.
 * 있으면 입력값 대조(review) → 첫 안내(warn1) → 두 번째 경고(warn2) → 보냄(send). 도중에 닫으면 처음부터 다시다
 */
export function nextStep(step: "review" | "warn1" | "warn2", hasBad: boolean): "warn1" | "warn2" | "send" {
  if (!hasBad) return "send";
  return step === "review" ? "warn1" : step === "warn1" ? "warn2" : "send";
}

/** 받을 수 없는 점수 안내 한 줄: '국어(화법과 작문) 99점, 영어 1점' */
export const badScoreText = (bad: readonly BadScore[]) => bad.map((b) => `${b.label} ${b.score}점`).join(", ");

/** 대표님 문구(2026-11-22) — 그대로 쓴다 */
export const UNATTAINABLE_FIRST = "입력하신 점수는 조합상 받을 수 없는 점수입니다. 그럼에도 불구하고 이 점수로 저장하시겠습니까?";
export const unattainableSecond = (name: string) =>
  `해당 과목에서 받을 수 없는 점수를 입력할 시 성적분석이 되지 않으나 성적 입력횟수는 1회가 차감됩니다. 이에 대한 불이익은 온전히 ${name}님에게 있음을 다시 한번 경고드립니다.`;
export const inaccurateText = (name: string) => `${name}님께서 부정확한 성적을 입력하여 성적 분석이 되지 않습니다`;
export const REENTRY_WARNING = "본인의 성적이 제대로 입력되었는지 다시 한번 확인해 주세요. 이번에 저장하면 더 이상 가채점 원점수의 정정이 불가능합니다.";

/**
 * 부정확 입력 상태인가(서버에 남은 상태 기준이라 새로고침·다른 기기에서도 같다).
 * - 서버: 이 단계의 마지막 저장이 정상 거절(last_attempt_outcome 'rejected': 받을 수 없는 원점수·성적표에 없는 표준점수)
 * - 화면 보조: 서버 변경 전에 받아 둔 가채점 리포트의 원점수가 받을 수 없는 점수(국어·수학·탐구 원점수로 다시 판정)
 * 끝난 9월 모의평가 단계는 보지 않는다(지난 기록은 그대로).
 */
export function isInaccurate(st: Pick<ScoreInputStatusDto, "stage" | "last_attempt_outcome"> | null | undefined, report?: ReportDto | null): boolean {
  if (st && st.stage !== "mock" && st.last_attempt_outcome === "rejected") return true;
  return reportUnattainable(report).length > 0;
}

/** 가채점 리포트에 남은 원점수 가운데 받을 수 없는 점수(표준점수 리포트는 빈 배열) */
export function reportUnattainable(report: ReportDto | null | undefined): BadScore[] {
  const subjects = report?.overall?.subjects ?? [];
  const out: BadScore[] = [];
  for (const s of subjects) {
    if (typeof s.raw_score !== "number") continue;
    const area: RawArea | null = s.area === "korean" ? "korean" : s.area === "math" ? "math" : s.area === "inquiry1" || s.area === "inquiry2" ? "inquiry" : null;
    if (area && !isAchievableRaw(area, s.raw_score)) out.push({ label: `${AREA_LABEL[s.area] ?? s.area}${s.subject && area === "inquiry" ? `(${s.subject})` : ""}`, score: s.raw_score });
  }
  return out;
}
