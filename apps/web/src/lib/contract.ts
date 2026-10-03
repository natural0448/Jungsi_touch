/*
  화면이 기대하는 응답 모양 — 3페이지(전체 대학·학과 가능성 보기) 화면 초안
  ─────────────────────────────────────────────────────────────
  docs/current/라우팅_명세.md 의 작업 ID 와 경로를 따른다. 응답 필드는 명세에 아직 없어서
  화면이 필요로 하는 최소 필드를 여기 적는다. 애플리케이션 계약이 확정되면 그 모양으로 바꾼다.

  - offerings.search   GET  /api/v1/offerings/search                     (유료)
  - university.analyze POST /api/v1/reports/{report_id}/university-results (유료·본인·확인 성적)
  - shortlist.update   PUT  /api/v1/reports/{report_id}/shortlist/{offering_id} (유료·본인)
  - session.read       GET  /api/v1/me  (PR #5 제안, 승인 대기)

  규칙(서비스 기획 REQ-01·05·08·13)
  - 숫자는 문자열로 받는다. 대학 공식 자릿수를 화면이 바꾸지 않는다.
  - 없는 값은 null. 0 으로 채우지 않는다. 미공개·미확정은 상태로 받는다.
  - 내 환산점수 · 지원가능성 · 환산 유불리는 따로 온다. 하나가 보류돼도 다른 것은 보인다.
  - 시각은 UTC ISO 8601 Z 로 받고 화면에서 Asia/Seoul 로 바꾼다. 날짜만 있는 값은 그대로 쓴다.
*/

export type Group = "가" | "나" | "다";
export type MemberTier = "standard" | "paid";

/** session.read */
export interface Session {
  format: "jungsi.session/v1";
  member_tier: MemberTier;
  entitlement_expires_at: string | null; // UTC ISO 8601 Z
}

/** REQ-13: 최초·변경·최종을 구분하고 미공개·미확정을 0 으로 바꾸지 않는다 */
export interface Recruitment {
  initial: number | null;
  change: number | null; // 감소는 음수, 미공개는 null
  final: number | null; // 미확정이면 null
  confirmed: boolean;
  as_of: string | null; // YYYY-MM-DD (날짜만)
}

export interface UniversityRef {
  university_id: string;
  name: string;
  region: string;
  founding: "국립" | "공립" | "사립";
  /** 이 대학 환산점수의 척도 안내. "1000점 만점 · 인문사회 반영식 / 자연 반영식" */
  score_scale_label: string;
}

/** offerings.search 의 한 줄. 개인 분석 없이 공식 모집 정보만 */
export interface OfferingRow {
  offering_id: string;
  university: UniversityRef;
  unit_name: string;
  admission_name: string;
  group: Group;
  recruitment: Recruitment;
}

export interface OfferingSearchParams {
  university?: string;
  unit?: string;
  region?: string;
  group?: Group;
  page?: number;
}

export interface OfferingSearchResult {
  items: OfferingRow[];
  total_offerings: number;
  total_universities: number;
  regions: string[]; // 검색 조건 칩
  page: number;
  page_size: number;
}

/** 지원가능성. 합격 확률이 아니다(REQ-08) */
export type SupportStatus = "reach" | "core" | "safe" | "out_of_range" | "needs_check" | "ineligible";

export interface HistoryPoint {
  result_year: number;
  /** 대학 발표 기준의 이름. "최종등록자 70%" */
  metric_label: string;
  /** 그해 기준 점수가 같은 대학 환산 분포에서 위에서 몇 %인지. 대학이 발표하지 않았으면 null */
  cut_top_percent: string | null;
}

/** university.analyze 의 모집단위 하나 */
export interface OfferingAnalysis {
  offering_id: string;
  converted: {
    status: "calculated" | "pending";
    score: string | null;
    max_score: string | null;
    rule_label: string;
    /** 이 대학 환산 기준으로 같은 비교집단에서 위에서 몇 % */
    university_top_percent: string | null;
    reason_code: string | null;
  };
  support: {
    status: SupportStatus;
    reason: string;
    history: HistoryPoint[];
  };
  advantage: {
    status: "computed" | "pending";
    /** 같은 비교집단에서 총점 기준 상위% − 대학 환산 기준 상위%. 양수면 유리 */
    pp: string | null;
    total_top_percent: string | null;
    university_top_percent: string | null;
    reason_code: string | null;
  };
}

export interface ScoreBasis {
  exam_label: string; // "2027 9월 모의평가"
  total_standard_score: number;
  overall_top_percent: string | null;
  estimated: boolean;
}

/** university.analyze 응답. 확인된 성적이 없으면 서버가 409 → 화면은 score_required */
export type AnalysisResult =
  | { state: "ready"; basis: ScoreBasis; results: OfferingAnalysis[] }
  | { state: "score_required" };

export interface ShortlistItem {
  offering_id: string;
  university_name: string;
  unit_name: string;
}
