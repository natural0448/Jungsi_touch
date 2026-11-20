import Link from "@/components/link";
import type { Cell } from "@/components/offering-parts";
import type { ForecastPublicDto, IssueSummaryDto, OfferingDto, RecruitmentDto } from "@/lib/dto";
import { signed } from "@/lib/format";
import { page } from "@/lib/routes";

/* 펼친 줄의 2027 모집 정보(recruitment.read)와 발행된 학과 기준(forecast.published.read).
   펼친 뒤 그 모집단위만 따로 받아(extras.tsx) 화면에서 그리므로 브라우저에서도 쓰는 부품이다 */

export function Recruit({ o, rec }: { o: OfferingDto; rec: RecruitmentDto | null }) {
  const r = rec?.status === "ready" ? rec.recruitment : null;
  const wait = (t: string) => <span className="wait">{t}</span>;
  return (
    <div className="recruit">
      <span>2027 모집군<b>{o.group}군</b></span>
      {r ? (
        <>
          <span>최초 인원<b className="num">{r.initial_count ?? wait("미공개")}</b></span>
          <span>이월·변경<b className="num">{r.rollover_change === null ? wait("미공개") : signed(r.rollover_change)}</b></span>
          <span>최종 인원<b className="num">{r.final_count ?? wait("미확정")}</b></span>
        </>
      ) : (
        // 값이 없으면 확정 표시 '미공개'(2026-11-21: '자료 준비 중' 같은 중간 문구를 고객에게 보이지 않는다)
        <span>모집 인원<b>{wait("미공개")}</b></span>
      )}
      <Link href={`${page("PAGE-01").path}?university=${encodeURIComponent(o.university_name)}&unit=${encodeURIComponent(o.department)}`}>대학 발표 입시결과 보기</Link>
    </div>
  );
}

export function IssueItem({ t }: { t: IssueSummaryDto }) {
  return (
    <li>
      <b>올해 변화</b> {t.title}: {t.summary}
      {!t.numeric_effect_applied && <small> · 점수에는 반영하지 않음</small>}
    </li>
  );
}

/** 공개 context 17필드(서비스·DB 인계 ③). 값·타입·명시적 null 이 모두 같아야 같은 근거다 */
const CONTEXT_FIELDS = [
  "offering_id", "academic_year", "exam_id", "source_pack_version", "catalog_version", "rule_id", "rule_version", "curve_version",
  "analysis_version", "score_scale_id", "score_scope", "bonus_treatment", "population_id", "comparison_metric", "unit", "direction", "tie_policy",
] as const;

/** 학과 판단에 쓴 근거(decision_evidence)와 발행본(forecast_public)이 같은 발표본인지: 발표본 버전·정책·입력 버전과 context 17필드가 모두 같을 때만 */
export function sameRelease(a: Cell, f: ForecastPublicDto | null) {
  const ev = a && a !== "need" ? a.decision_evidence : undefined;
  if (!ev || !f || f.status !== "published" || !ev.context || !f.context) return false;
  const x = ev.context as unknown as Record<string, unknown>;
  const y = f.context as unknown as Record<string, unknown>;
  // 발표본·정책·입력 버전은 양쪽 모두 비어 있지 않은 문자열이어야 한다. 둘 다 없거나 null 인 것을 '같다'로 보지 않는다
  const id = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
  const pairs: [unknown, unknown][] = [
    [ev.forecast_release_version, f.release_version],
    [ev.policy_version, f.policy_version],
    [ev.input_version, f.input_version],
  ];
  return pairs.every(([a, b]) => id(a) && id(b) && a === b) && CONTEXT_FIELDS.every((k) => k in x && k in y && x[k] === y[k]);
}

/** 발행된 학과별 예상 기준(forecast.published.read). 예상선·합격권·구간표 같은 기준 수치는
 * 화면에 보이지 않는다(최종 관리자 지시 2026-10-07) — 자료판·준비 상태·만든 방법·올해 변화만 적는다 */
export function Published({ f, same }: { f: ForecastPublicDto | null; same: boolean }) {
  if (!f || f.status !== "published") return null;
  const ready = f.forecast_70?.status === "ready";
  return (
    <div className="published">
      <h3>
        이 판단에 쓴 자료 <small>자료 기준 {f.release_version}</small>
      </h3>
      <p>
        올해 예상 기준이 {ready ? "검수를 마치고 준비돼 있습니다." : <span className="wait">아직 발표 대기입니다.</span>}
        {f.adjustment_summary.applied && <> 입시 상담 경험을 반영한 조정이 들어 있습니다.</>}
      </p>
      {f.issue_summaries.length > 0 && (
        <ul className="pub-issues">
          {f.issue_summaries.map((t) => <IssueItem key={t.issue_id} t={t} />)}
        </ul>
      )}
      <span className="note">
        {same
          ? "이 학과의 지원 판단도 이 자료로 계산했습니다. "
          : "이 학과의 지원 판단은 예전 자료로 계산됐을 수 있습니다. 최신 기준으로 보려면 성적을 다시 분석해 주세요. "}
        판단에 쓰는 기준 점수는 공개하지 않으며, 이 자료는 실제 합격 확률이나 최저 합격점이 아닙니다.
      </span>
    </div>
  );
}
