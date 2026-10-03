import { togglePick } from "@/app/shortlist-actions";
import type { OfferingAnalysis, OfferingStatistics, Recruitment, SupportStatus } from "@/lib/contract";
import { seoulDate, signed } from "@/lib/format";

/* 3·4페이지가 같이 쓰는 모집단위 칸들. 같은 판단은 어느 화면에서나 같은 모양으로 보인다 */

/** 지원가능성 여섯 상태. 색과 함께 점 모양으로도 구분한다. 빨강은 '지원 조건 미충족'에만 */
export const SUPPORT: Record<SupportStatus, { cls: string; label: string }> = {
  reach: { cls: "reach", label: "도전" },
  core: { cls: "core", label: "핵심 검토" },
  safe: { cls: "safe", label: "여유 후보" },
  out_of_range: { cls: "out", label: "추천 범위 밖" },
  needs_check: { cls: "check", label: "확인 필요" },
  ineligible: { cls: "inel", label: "지원 조건 미충족" },
};

export function SupportBadge({ status }: { status: SupportStatus }) {
  const s = SUPPORT[status];
  return <span className={`st ${s.cls}`}>{s.label}</span>;
}

export function SupportLegend() {
  return (
    <span className="legend" aria-label="지원가능성 표시">
      {Object.values(SUPPORT).map((s) => (
        <span key={s.cls} className={`st ${s.cls}`}>{s.label}</span>
      ))}
    </span>
  );
}

export function QuotaCell({ r }: { r: Recruitment }) {
  if (r.final === null) {
    return (
      <span className="quota">
        <b className="num">{r.initial ?? "─"}</b> <span className="w">최종 미확정</span>
      </span>
    );
  }
  return (
    <span className="quota">
      <b className="num">{r.final}</b>
      {r.change ? <span className="w muted">변경 {signed(r.change)}</span> : null}
    </span>
  );
}

export function ScoreCell({ a }: { a: OfferingAnalysis | null | "need" }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (!a || a.converted.status !== "calculated" || !a.converted.score) return <span className="need">계산 보류</span>;
  return (
    <span className="score">
      <b className="num">{a.converted.score}</b>
      <small>/ {a.converted.max_score}</small>
    </span>
  );
}

export function AdvantageCell({ a }: { a: OfferingAnalysis | null | "need" }) {
  if (a === "need") return <span className="need">성적 입력 필요</span>;
  if (!a || a.advantage.status !== "computed" || !a.advantage.pp) return <span className="need">판단 보류</span>;
  const n = Number(a.advantage.pp);
  const tone = Math.abs(n) < 0.1 ? "even" : n > 0 ? "up" : "down";
  const width = Math.min(50, (Math.abs(n) / 0.6) * 50);
  return (
    <span className="adv">
      <span className="bar" aria-hidden="true">{tone !== "even" && <i className={n > 0 ? "up" : "down"} style={{ width: `${width}%` }} />}</span>
      <span className={`v num ${tone}`}>{a.advantage.pp}%p</span>
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

/** REQ-10: 서비스 안의 추천·선택 인원과 담은 사람 중 내 위치. 실제 지원자 수가 아니다 */
export function StatsLine({ s }: { s: OfferingStatistics | undefined }) {
  if (!s || s.status !== "ready" || s.recommended_count === null) return <span className="stats wait">추천·선택 집계 준비 중</span>;
  return (
    <span className="stats">
      추천 <b className="num">{s.recommended_count}</b>명 · 담음 <b className="num">{s.selected_count}</b>명
      {s.my_rank !== null && s.selected_count ? (
        <>
          {" "}· 담은 사람 중 <b className="num">{s.my_rank}</b>위{s.tie_count && s.tie_count > 1 ? <> (동점 {s.tie_count}명)</> : null}
        </>
      ) : null}
      {s.updated_at && <small> {seoulDate(s.updated_at)} 기준</small>}
    </span>
  );
}
