import { togglePick } from "@/app/shortlist-actions";
import type { AssessmentDto, Category, StatisticsDto } from "@/lib/dto";
import { seoulDate } from "@/lib/format";

/* 3·4페이지(와 2페이지 유료 부분)가 같이 쓰는 모집단위 칸. 응답 모양은 assessment·statistics DTO */

/** 학과마다의 지원 판단(assessment.category). 색과 함께 점 모양으로도 구분, 빨강은 '지원 조건 미충족'에만 */
export const CATEGORY: Record<Category, { cls: string; label: string }> = {
  challenge: { cls: "reach", label: "도전" },
  core: { cls: "core", label: "핵심 검토" },
  room: { cls: "safe", label: "여유 후보" },
  outside: { cls: "out", label: "추천 범위 밖" },
  pending: { cls: "check", label: "판단 보류" },
  ineligible: { cls: "inel", label: "지원 조건 미충족" },
};

/** 판단 보류·자격 확인의 이유(서버 reason_code) */
const REASON: Record<string, string> = {
  eligibility_confirmation_required: "지원 자격을 확인해야 합니다.",
  eligibility_not_met: "입력한 성적으로는 이 전형의 지원 자격을 충족하지 않습니다.",
  decision_range_unconfirmed: "올해 판단 구간이 아직 확정되지 않았습니다.",
  decision_policy_missing: "이 모집단위의 판단 기준이 아직 없습니다.",
  decision_policy_not_approved: "판단 기준을 검수하고 있습니다.",
  decision_evidence_unapproved: "판단 근거 자료를 검수하고 있습니다.",
  comparison_distribution_missing: "비교할 환산 분포가 아직 없습니다.",
  analysis_release_missing: "이 모집단위의 환산 자료가 아직 없습니다.",
  analysis_release_not_approved: "환산 자료를 검수하고 있습니다.",
  analysis_pack_mismatch: "입력한 시험과 환산 자료의 버전이 맞지 않습니다.",
  target_distribution_missing: "그해 비교 분포가 아직 없습니다.",
  total_model_missing: "전체 누적 곡선이 아직 발행되지 않았습니다.",
  counselor_adjustment_unapproved: "상담 조정 기준을 검수하고 있습니다.",
};
export const reasonText = (code: string | null | undefined) => (code ? REASON[code] ?? "자료를 확인하고 있습니다." : "");

export function CategoryBadge({ a }: { a: AssessmentDto }) {
  if (a.status === "pending" && a.eligibility_status === "needs_confirmation") return <span className="st check">자격 확인 필요</span>;
  const c = CATEGORY[a.category];
  return <span className={`st ${c.cls}`}>{c.label}</span>;
}

export function CategoryLegend() {
  return (
    <span className="legend" aria-label="지원가능성 표시">
      {Object.values(CATEGORY).map((c) => (
        <span key={c.cls} className={`st ${c.cls}`}>{c.label}</span>
      ))}
    </span>
  );
}

export type Cell = AssessmentDto | null | "need";

export function ScoreCell({ a }: { a: Cell }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (!a) return <span className="need">분석 대기</span>;
  if (!a.converted_score) return <span className="need">계산 보류</span>;
  return (
    <span className="score">
      <b className="num">{a.converted_score}</b>
      {a.converted_percentile && <small>상위 {a.converted_percentile}%</small>}
    </span>
  );
}

export function StatusCell({ a }: { a: Cell }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (!a) return <span className="need">분석 대기</span>;
  return <CategoryBadge a={a} />;
}

/** 환산 유불리: 같은 비교집단에서 보정 총점 기준 위치 − 대학 환산 기준 위치(%p). 양수면 유리 */
export function AdvantageCell({ a }: { a: Cell }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (!a || !a.advantage) return <span className="need">판단 보류</span>;
  const n = Number(a.advantage.delta_pp);
  const tone = a.advantage.status === "neutral" || Math.abs(n) < 0.1 ? "even" : n > 0 ? "up" : "down";
  const width = Math.min(50, (Math.abs(n) / 0.6) * 50);
  return (
    <span className="adv">
      <span className="bar" aria-hidden="true">{tone !== "even" && <i className={n > 0 ? "up" : "down"} style={{ width: `${width}%` }} />}</span>
      <span className={`v num ${tone}`}>
        {n > 0 ? "+" : ""}
        {a.advantage.delta_pp}%p
      </span>
    </span>
  );
}

export function PickButton({ id, on, variant = "pill" }: { id: string; on: boolean; variant?: "pill" | "wide" | "wild" }) {
  return (
    <form action={togglePick} className={variant === "wild" ? "pick-wild" : undefined}>
      <input type="hidden" name="offering_id" value={id} />
      <input type="hidden" name="selected" value={on ? "0" : "1"} />
      {variant === "pill" ? (
        <button className={`pick${on ? " on" : ""}`} aria-pressed={on}>
          {on ? "담음" : "담기"}
        </button>
      ) : variant === "wide" ? (
        <button className={`btn${on ? "" : " t"}`}>{on ? "핵심 지원 학교에서 빼기" : "핵심 지원 학교에 담기"}</button>
      ) : (
        <button className={on ? "on" : undefined} aria-pressed={on}>
          {on ? "핵심 지원 학교에 담음" : "핵심 지원 학교에 담기"}
        </button>
      )}
    </form>
  );
}

/** REQ-10: 서비스 안의 추천·선택 인원과 내 순위. 실제 대학 지원자 수가 아니다 */
export function StatsLine({ s }: { s: StatisticsDto | null | undefined }) {
  if (!s || s.status !== "ready" || s.recommended_count === null) return <span className="stats wait">추천·선택 집계 준비 중</span>;
  const r = s.selected_rank ?? s.recommended_rank;
  return (
    <span className="stats">
      추천 <b className="num">{s.recommended_count}</b>명 · 담음 <b className="num">{s.selected_count}</b>명
      {r && (
        <>
          {" "}· {s.selected_rank ? "담은 사람" : "추천받은 사람"} 중 <b className="num">{r.rank}</b>위
          {r.tie_count > 1 ? <> (동점 {r.tie_count}명)</> : null}
        </>
      )}
      {s.updated_at && <small> {seoulDate(s.updated_at)} 기준</small>}
    </span>
  );
}
