/*
  성적 입력에 쓰는 시험과 과목 선택지.
  서비스는 2027학년도 9월 모의평가로 시작한다(서비스 기획 REQ-12). 실제 수능은 별도 시험 ID 로 연결한다.
  exam_id·pack_version 은 서버가 등록한 토큰이다. 화면이 시험 목록을 받는 API 가 아직 없어
  여기에 둔다(service_spec pending). 과목 이름은 시험 자료의 이름과 같아야 하며, 최종 검증은 서버 엔진이 한다.
*/

export const EXAM = {
  // 합성 응답용 토큰. 실제 연결 때 서버가 알려 준 값으로 바꾼다
  exam_id: process.env.JUNGSI_EXAM_ID ?? "SYNTHETIC-2027-09-mock",
  pack_version: process.env.JUNGSI_PACK_VERSION ?? "SYNTHETIC-pack-v1",
  label: "2027학년도 9월 모의평가",
} as const;

export const KOREAN_CHOICES = ["화법과 작문", "언어와 매체"] as const;
export const MATH_CHOICES = ["확률과 통계", "미적분", "기하"] as const;

export const INQUIRY_SUBJECTS: { group: string; subjects: string[] }[] = [
  { group: "사회탐구", subjects: ["생활과 윤리", "윤리와 사상", "한국지리", "세계지리", "동아시아사", "세계사", "경제", "정치와 법", "사회·문화"] },
  { group: "과학탐구", subjects: ["물리학Ⅰ", "화학Ⅰ", "생명과학Ⅰ", "지구과학Ⅰ", "물리학Ⅱ", "화학Ⅱ", "생명과학Ⅱ", "지구과학Ⅱ"] },
];

export const AREA_LABEL: Record<string, string> = { korean: "국어", math: "수학", inquiry1: "탐구 1", inquiry2: "탐구 2" };
