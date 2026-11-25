/*
  성적 입력에 쓰는 시험과 과목 선택지.
  서비스는 2027학년도 9월 모의평가로 시작한다(서비스 기획 REQ-12). 실제 수능은 별도 시험 ID 로 연결한다.
  exam_id·pack_version 은 서버가 등록한 토큰이다. 화면이 시험 목록을 받는 API 가 아직 없어
  여기에 둔다(service_spec pending). 과목 이름은 시험 자료의 이름과 같아야 하며, 최종 검증은 서버 엔진이 한다.
*/

/*
  9월 모의평가 → 수능 가채점 전환(2026-11-21 대표님 확정). 전환 시각은 JUNGSI_CSAT_OPENS_AT(기본 2026-11-23 00:00 KST)이고,
  화면이 요청마다 지금 시각과 비교해 스스로 고른다. 그래서 전환 전에 미리 배포해도 고객 화면은 시각이 될 때까지 9월 모의평가 그대로다.
  - 전환 전: 지금 시험 = 9월 모의평가(JUNGSI_PAST_EXAM_ID · JUNGSI_PAST_PACK_VERSION)
  - 전환 뒤: 지금 시험 = 수능 가채점(JUNGSI_EXAM_ID · JUNGSI_PACK_VERSION), 9월 모의평가는 '지난 기록'(읽기 전용)
  서버도 같은 시각에 9월 단계를 닫는다(window.mode=closed, 새 입력·정정 409). 입력 가능 여부의 최종 판단은 늘 서버 입력 상태다.
  워커는 요청 때 환경값을 채우므로 모듈을 불러올 때가 아니라 쓸 때 읽는다. 합성 응답용 토큰이 기본값이다.
*/
export const CSAT_OPENS_AT_DEFAULT = "2026-11-22T15:00:00Z";

/** 전환 시각. 값이 없거나 읽을 수 없으면 기본 시각(대표님 확정 시각)을 쓴다 */
export function csatOpensAt(): Date {
  const v = process.env.JUNGSI_CSAT_OPENS_AT;
  const d = v ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d : new Date(CSAT_OPENS_AT_DEFAULT);
}

/** 수능 가채점으로 전환됐는가(전환 시각 포함) */
export function csatOpen(now: Date = new Date()): boolean {
  return now.getTime() >= csatOpensAt().getTime();
}

/**
 * 전문가용 학생 가채점 입력을 여는가(2026-11-21 대표님 결정: 오픈 때 개인용과 함께). 전문가용 서버가 원점수
 * pro.score.create 를 알기 전에는 열면 안 되므로, 서버 배포 뒤 JUNGSI_PRO_CSAT_ENABLED=1 로만 연다.
 * 꺼져 있으면 지금 안내 문구를 그대로 둔다. 전환 시각 규칙(csatOpen)은 따로 그대로 따른다.
 */
export function proCsatEnabled(): boolean {
  return process.env.JUNGSI_PRO_CSAT_ENABLED === "1";
}

/*
  수능 가채점 → 수능 실채점 전환(2026-11-25 준비, 대표님 11-24 결정: 12-14 0시 KST 공개). 담당자 실행 안내대로 실채점은
  별도 시험 ID(JUNGSI_FINAL_EXAM_ID, 예: 2027-csat)·별도 입력 범위로 받고, 가채점 리포트는 '지난 기록'으로 남긴다.
  켜기 스위치(JUNGSI_FINAL_ENABLED=1)와 시각(JUNGSI_FINAL_OPENS_AT, 기본 12-14 0시 KST)이 둘 다 맞을 때만 실채점이 '지금 시험'이다.
  스위치가 꺼져 있으면 시각이 지나도 가채점 그대로다(실채점 시험팩·정책 행이 서버에 닿기 전에 미리 배포해도 안전하게).
*/
export const FINAL_OPENS_AT_DEFAULT = "2026-12-13T15:00:00Z";
/** 실채점 전환 시각. 값이 없거나 읽을 수 없으면 기본 시각 */
export function finalOpensAt(): Date {
  const v = process.env.JUNGSI_FINAL_OPENS_AT;
  const d = v ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d : new Date(FINAL_OPENS_AT_DEFAULT);
}
/** 수능 실채점으로 전환됐는가(켜기 스위치 + 전환 시각, 가채점 전환이 먼저여야 한다) */
export function finalOpen(now: Date = new Date()): boolean {
  return process.env.JUNGSI_FINAL_ENABLED === "1" && csatOpen(now) && now.getTime() >= finalOpensAt().getTime();
}

/** 9월 모의평가(전환 뒤에는 지난 기록) */
export const MOCK_EXAM = {
  get exam_id() {
    return process.env.JUNGSI_PAST_EXAM_ID ?? "SYNTHETIC-2027-09-mock";
  },
  get pack_version() {
    return process.env.JUNGSI_PAST_PACK_VERSION ?? "SYNTHETIC-pack-v1";
  },
  label: "2027학년도 9월 모의평가",
  short: "9월 모의평가",
} as const;

/** 수능 가채점 */
export const CSAT_EXAM = {
  get exam_id() {
    return process.env.JUNGSI_EXAM_ID ?? "SYNTHETIC-2027-csat-provisional";
  },
  get pack_version() {
    return process.env.JUNGSI_PACK_VERSION ?? "SYNTHETIC-csat-pack-v1";
  },
  label: "2027학년도 대학수학능력시험 가채점",
  short: "수능 가채점",
} as const;

/** 수능 실채점(성적표 표준점수 입력). 실채점 전환 뒤 '지금 시험' */
export const FINAL_EXAM = {
  get exam_id() {
    return process.env.JUNGSI_FINAL_EXAM_ID ?? "SYNTHETIC-2027-csat";
  },
  get pack_version() {
    return process.env.JUNGSI_FINAL_PACK_VERSION ?? "SYNTHETIC-csat-final-pack-v1";
  },
  label: "2027학년도 대학수학능력시험",
  short: "수능 실채점",
} as const;

/** 지금 성적 입력에 쓰는 시험. 9월 모의평가 → 수능 가채점(11-23) → 수능 실채점(스위치 + 12-14) */
const current = () => (finalOpen() ? FINAL_EXAM : csatOpen() ? CSAT_EXAM : MOCK_EXAM);
export const EXAM = {
  get exam_id() {
    return current().exam_id;
  },
  get pack_version() {
    return current().pack_version;
  },
  get label() {
    return current().label;
  },
};

export const KOREAN_CHOICES = ["화법과 작문", "언어와 매체"] as const;
export const MATH_CHOICES = ["확률과 통계", "미적분", "기하"] as const;

export const INQUIRY_SUBJECTS: { group: string; subjects: string[] }[] = [
  { group: "사회탐구", subjects: ["생활과 윤리", "윤리와 사상", "한국지리", "세계지리", "동아시아사", "세계사", "경제", "정치와 법", "사회·문화"] },
  { group: "과학탐구", subjects: ["물리학Ⅰ", "화학Ⅰ", "생명과학Ⅰ", "지구과학Ⅰ", "물리학Ⅱ", "화학Ⅱ", "생명과학Ⅱ", "지구과학Ⅱ"] },
];

/** 제2외국어/한문 과목(성적표 표기). 서버(overall_analysis)의 허용 목록과 같아야 한다. 절대평가 등급만 받는다(2026-11-12 최종관리자 결정) */
export const SECOND_LANGUAGE_SUBJECTS = ["독일어Ⅰ", "프랑스어Ⅰ", "스페인어Ⅰ", "중국어Ⅰ", "일본어Ⅰ", "러시아어Ⅰ", "아랍어Ⅰ", "베트남어Ⅰ", "한문Ⅰ"] as const;

/*
  성적 입력 단계(2026-11-12 최종관리자 결정). 단계는 서버 입력 상태(score-input-status.stage)가 정한다.
  - mock: 지금의 9월 모의평가(표준점수 입력)
  - provisional: 수능 가채점 — 원점수 입력. 영어·한국사·제2외국어/한문은 원점수로 등급이 확정된다
  - final: 수능 실채점 — 성적표 배부 3일 뒤부터(2026-11-13 결정), 9월 모의평가와 같은 표준점수 입력
  수능일 이후(가채점·실채점)에는 9월 모의평가 단계를 보이지 않는다. 단계마다 입력 1회 + 정정 요청 1회(기존 정책).
*/
export type InputStage = "mock" | "provisional" | "final";
export const stageOf = (s: string | null | undefined): InputStage => (s === "provisional" || s === "final" ? s : "mock");
export function examTitle(stage: InputStage, year: number): string {
  if (stage === "provisional") return `${year}학년도 대학수학능력시험 가채점`;
  if (stage === "final") return `${year}학년도 대학수학능력시험`;
  return MOCK_EXAM.label;
}

/** 가채점 원점수 만점 */
export const RAW_MAX = { korean: 100, math: 100, english: 100, history: 50, inquiry: 50, second: 50 } as const;
/** 평가원 절대평가 등급 구간: [만점, 1등급 하한, 등급 간격]. 영어 90·한국사 40·제2외국어/한문 45 이상이 1등급 */
export const ABSOLUTE_CUTS = { english: [100, 90, 10], history: [50, 40, 5], second: [50, 45, 5] } as const;
/** 절대평가 원점수 → 등급. 빈 값·범위 밖·정수 아님은 null. 저장되는 등급은 서버가 같은 구간으로 다시 정한다 */
export function absoluteGrade(area: keyof typeof ABSOLUTE_CUTS, raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const n = Number(raw), [max, top, step] = ABSOLUTE_CUTS[area];
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n >= top ? 1 : Math.min(9, 1 + Math.ceil((top - n) / step));
}

export const AREA_LABEL: Record<string, string> = { korean: "국어", math: "수학", inquiry1: "탐구 1", inquiry2: "탐구 2" };

/** 서버의 시험 종류 코드 → 화면 이름. 모르는 코드는 그대로(합성 응답은 이미 한글이다) */
const EXAM_TYPE_LABEL: Record<string, string> = {
  september_mock: "9월 모의평가",
  june_mock: "6월 모의평가",
  csat: "대학수학능력시험",
  csat_provisional: "수능 가채점",
  csat_final: "수능 실채점",
};
export const examTypeLabel = (t: string) => EXAM_TYPE_LABEL[t] ?? t;
