import type { HistoryMetricDto } from "@/lib/dto";

/*
  전국 현재 정본(current-public catalog)의 입결 지표를 받은 그대로 보여 주는 표.
  이 자료의 metric_name 은 원본 지표 종류 코드(예: competition_ratio)이고, 통계 구분(statistic_label)과
  대상 집단(cohort)은 대학 원문 표기 그대로 온다(70%컷·70% 컷·70_percent_cut 등이 서로 다른 문자열).
  - 줄 = 지표 종류 · 통계 구분 · 대상 집단 · 단위 · 정의가 모두 같은 지표. 하나라도 다르면 합치지 않는다
    (담당자 후속 요청 v3 §2: 정의·단위·통계·코호트·연도·출처가 다르면 합치지 않음)
  - 열 = 그 모집행 PK 로 실제 발행된 학년도
  - 우리말 이름·표기 정리는 화면 표시용일 뿐이고 줄을 나누는 키는 원문 값이다
  - 발표 상태 5가지(verified_official·pending_metadata·pending_value_type·pending_value_missing·not_published)를
    구분한다. 값이 있는 메타데이터 보류는 '확인 중'으로 값과 함께, 값이 없으면 0 을 만들지 않는다
  - 경쟁률·모집·충원·50/70%컷처럼 먼저 볼 줄을 위에 두고 나머지는 접어 둔다(순서만 바꾼다)
*/

/** 지표 종류 코드 → 화면 이름. 목록에 없으면 담당자가 붙인 지표 정의, 그것도 없으면 코드 그대로 */
const KIND: Record<string, string> = {
  competition_ratio: "경쟁률",
  recruitment_quota_final: "모집인원(최종)",
  recruitment_quota_initial: "모집인원(최초)",
  recruitment_quota_carryover: "모집인원(이월)",
  recruitment_quota_published_stage_unspecified: "모집인원",
  additional_admitted_count: "충원 합격 인원",
  additional_admission_rank: "충원 합격 순위",
  university_converted_score: "대학 환산점수",
  university_total_score: "대학 총점",
  university_selection_total_score: "대학 전형 총점",
  university_csat_component_score: "대학 수능 영역 점수",
  university_area_score_sum: "대학 영역 점수 합",
  university_csat_weighted_standard_score: "대학 가중 표준점수",
  university_reflected_percentile: "대학 반영 백분위",
  university_weighted_percentile: "대학 가중 백분위",
  university_reflected_subject_percentile: "대학 반영 과목 백분위",
  university_selected_subject_percentile: "대학 선택 과목 백분위",
  university_published_csat_percentile: "대학 발표 수능 백분위",
  university_published_csat_percentile_score: "대학 발표 백분위 점수",
  university_published_csat_grade: "대학 발표 수능 등급",
  university_csat_reflected_grade: "대학 반영 수능 등급",
  university_reflected_grade: "대학 반영 등급",
  csat_subject_percentile: "수능 과목 백분위",
  mean_subject_percentile: "과목 평균 백분위",
  subject_percentile_mean: "과목 평균 백분위",
  selected_subject_percentile_mean: "선택 과목 평균 백분위",
  csat_average_percentile: "수능 평균 백분위",
  subject_percentile: "과목 백분위",
  published_subject_percentile: "발표 과목 백분위",
  subject_percentile_sum: "과목 백분위 합",
  sum_subject_percentiles: "과목 백분위 합",
  korean_percentile: "국어 백분위",
  math_percentile: "수학 백분위",
  inquiry_percentile: "탐구 백분위",
  social_vocational_inquiry_percentile: "사회·직업탐구 백분위",
  science_inquiry_percentile: "과학탐구 백분위",
  subject_standard_score: "과목 표준점수",
  standard_score_sum: "표준점수 합",
  subject_standard_score_sum: "과목 표준점수 합",
  csat_standard_score_sum: "수능 표준점수 합",
  korean_standard_score: "국어 표준점수",
  math_standard_score: "수학 표준점수",
  social_vocational_inquiry_standard_score: "사회·직업탐구 표준점수",
  science_inquiry_standard_score: "과학탐구 표준점수",
  csat_grade: "수능 등급",
  csat_mean_grade: "수능 평균 등급",
  mean_subject_grade: "과목 평균 등급",
  applicant_mean_subject_grade: "지원자 과목 평균 등급",
  published_grade: "발표 등급",
  subject_grade: "과목 등급",
  english_grade: "영어 등급",
  korean_history_grade: "한국사 등급",
  english_source_reported_score: "영어 점수(원문)",
  subject_converted_score: "과목 환산점수",
  published_standard_deviation: "발표 표준편차",
  student_record_grade: "학생부 등급",
  school_record_grade: "학생부 등급",
  student_record_converted_score: "학생부 환산점수",
  source_defined_grade: "등급(원문 정의)",
  published_metric_unspecified: "발표 지표(종류 미명시)",
};

/** 통계 구분·대상 집단의 영문 코드 → 우리말(표시용). 한글 원문은 줄바꿈만 공백으로 바꾼다 */
const LABEL_EN: Record<string, string> = {
  "50_percent_cut": "50%컷",
  "70_percent_cut": "70%컷",
  "80_percent_cut": "80%컷",
  mean: "평균",
  standard_deviation: "표준편차",
  best: "최고",
  worst: "최저",
};
const COHORT_EN: Record<string, string> = {
  final_registrants: "최종등록자",
  final_admits: "최종합격자",
  final_admitted: "최종합격자",
  initial_admits: "최초합격자",
  initial_admitted: "최초합격자",
  applicants: "지원자",
  all_applicants: "전체 지원자",
  all_admits_including_initial_and_additional: "합격자 전체(최초·충원)",
  all_admits_initial_and_additional: "합격자 전체(최초·충원)",
  final_admitted_top80_percentile_group: "최종합격자 상위80%",
  published_admissions_recruitment_context: "모집·지원 현황",
  published_admissions_applicant_competition_context: "지원 현황",
  registrants_finality_not_specified: "등록자(최종 여부 미명시)",
  admitted_students_registration_not_specified: "합격자(등록 여부 미명시)",
  admitted_students_finality_not_specified: "합격자(최종 여부 미명시)",
  final_admits_registration_not_specified: "최종합격자(등록 여부 미명시)",
  published_score_cohort_not_explicit: "대상 집단 미명시",
  published_final_group_cohort_not_explicit: "대상 집단 미명시",
  source_cohort_not_specified: "대상 집단 미명시",
  not_stated_in_source: "대상 집단 미명시",
  not_explicit_in_reviewed_actual_table: "대상 집단 미명시",
  source_defined: "원문 정의",
  published_final_registrants_last_successful_waitlist: "최종등록자 마지막 충원 순번",
};
const tidy = (s: string | null | undefined, en: Record<string, string>) => {
  if (s === null || s === undefined || s === "") return null;
  return en[s] ?? s.replace(/\s*\n\s*/g, " ").trim();
};

type Row = {
  key: string;
  label: string;
  stat: string | null;
  cohort: string | null;
  unit: string | null;
  definition: string | null;
  rank: number;
  /** 우리말 표시가 다른 줄과 똑같아질 때만 채우는 원문 표기(통계 구분 · 대상 집단) */
  raw: string | null;
  rawStat: string | null;
  rawCohort: string | null;
  byYear: Map<number, HistoryMetricDto[]>;
};

/** 먼저 볼 줄의 순서(작을수록 위). 표시 순서만 정하고 값·줄 나눔에는 쓰지 않는다 */
function rankOf(m: HistoryMetricDto): number {
  const k = m.metric_name;
  if (k === "competition_ratio") return 0;
  if (k.startsWith("recruitment_quota")) return 1;
  if (k === "additional_admitted_count" || k === "additional_admission_rank") return 2;
  const stat = (tidy(m.statistic_label, LABEL_EN) ?? "").replace(/\s/g, "");
  if (/^(50|70)%?(컷|cut)?$/i.test(stat)) return 3;
  return 9;
}

/** 서버 원문 값(문자열·숫자·참거짓)을 그대로 글자로. 계산·반올림하지 않는다 */
const text = (v: HistoryMetricDto["value"]) => (v === null || v === undefined ? null : String(v));

function Cell({ ms }: { ms: HistoryMetricDto[] | undefined }) {
  if (!ms || ms.length === 0) return <span className="unpub">─</span>;
  if (ms.length > 1)
    return <span className="unpub" title="같은 지표가 같은 해에 여러 번 발표되어 한 값을 고르지 않습니다">복수 발표</span>;
  const m = ms[0];
  const v = text(m.value);
  switch (m.publication_status) {
    case "not_published":
      return <span className="unpub">미발표</span>;
    case "pending_value_type":
      return <span className="unpub" title="값의 형식을 확인하고 있습니다">값 확인 중</span>;
    case "pending_value_missing":
      return <span className="unpub" title="값이 비어 있어 확인하고 있습니다. 0 이 아닙니다">값 확인 중</span>;
  }
  if (v === null) return <span className="unpub">─</span>;
  return (
    <>
      <b className="num">{v}</b>
      {m.unit && <small> {m.unit}</small>}
      {m.publication_status === "pending_metadata" && (
        <small className="rs-chk" title="값은 발표 원문 그대로이며, 출처·정의 확인이 끝나지 않았습니다"> 확인 중</small>
      )}
    </>
  );
}

export function RawMetricTable({ rows, years }: { rows: HistoryMetricDto[]; years: readonly number[] }) {
  const map = new Map<string, Row>();
  for (const m of rows) {
    const key = JSON.stringify([m.metric_name, m.statistic_label ?? null, m.cohort ?? null, m.unit ?? null, m.metric_definition ?? null]);
    let r = map.get(key);
    if (!r) {
      r = {
        key,
        label: KIND[m.metric_name] ?? m.metric_definition ?? m.metric_name,
        stat: tidy(m.statistic_label, LABEL_EN),
        cohort: tidy(m.cohort, COHORT_EN),
        unit: m.unit,
        definition: m.metric_definition,
        rank: rankOf(m),
        raw: null,
        rawStat: m.statistic_label ?? null,
        rawCohort: m.cohort ?? null,
        byYear: new Map(),
      };
      map.set(key, r);
    }
    r.byYear.set(m.academic_year, [...(r.byYear.get(m.academic_year) ?? []), m]);
  }
  // 표기 정리 뒤 겉보기가 같아진 줄(예: 70%컷·final_registrants 와 70_percent_cut·최종등록자)은 원문 표기를 덧붙여 구별한다
  const shownAs = (r: Row) => [r.label, r.stat, r.cohort, r.unit].join("|");
  const seenAs = new Map<string, number>();
  for (const r of map.values()) seenAs.set(shownAs(r), (seenAs.get(shownAs(r)) ?? 0) + 1);
  for (const r of map.values())
    if ((seenAs.get(shownAs(r)) ?? 0) > 1) r.raw = [r.rawStat, r.rawCohort].map((x) => x ?? "미표기").join(" · ");
  const all = [...map.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "ko") || (a.stat ?? "").localeCompare(b.stat ?? "", "ko") || a.key.localeCompare(b.key));
  const shown = years.filter((y) => all.some((r) => r.byYear.has(y)));
  const head = all.filter((r) => r.rank < 9);
  const rest = all.filter((r) => r.rank >= 9);
  // 먼저 볼 줄이 하나도 없으면 접지 않는다 — 빈 표 아래 접힌 목록만 남지 않게
  const top = head.length > 0 ? head : rest;
  const folded = head.length > 0 ? rest : [];
  const table = (list: Row[]) => (
    <table className="tb rs-raw">
      <thead>
        <tr>
          <th scope="col">지표 · 통계 · 대상</th>
          {shown.map((y) => (
            <th key={y} scope="col" className="r num">{y}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.key}>
            <th scope="row" title={r.definition ?? undefined}>
              {r.label}
              {(r.stat || r.cohort) && <small>{[r.stat, r.cohort].filter(Boolean).join(" · ")}</small>}
              {r.raw && <small className="rs-rawlab">원문 표기: {r.raw}</small>}
            </th>
            {shown.map((y) => (
              <td key={y} className="r"><Cell ms={r.byYear.get(y)} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="rs-rawwrap">
      <div className="tblwrap">{table(top)}</div>
      {folded.length > 0 && (
        <details className="rs-more">
          <summary>원문 지표 {folded.length}개 더 보기</summary>
          <div className="tblwrap">{table(folded)}</div>
        </details>
      )}
      <p className="rs-rawnote">대학이 발표한 표기 그대로입니다. 통계 구분·대상 집단·단위가 다르면 같은 이름이어도 다른 줄로 보여 드립니다.</p>
    </div>
  );
}
