import type { RecruitmentDto } from "@/lib/dto";
import { plainDate, seoulDate, signed } from "@/lib/format";

/** recruitment.read — 2027 모집인원. 최초·변경·최종을 따로, 미공개는 0 이 아니라 '미공개'(REQ-13) */
export function RecruitmentPanel({ r }: { r: RecruitmentDto | null }) {
  if (!r) return <p className="rs-wait">이 모집단위의 모집 정보를 찾지 못했습니다.</p>;
  if (r.status !== "ready" || !r.recruitment) return <p className="rs-wait">모집 정보가 아직 공개되지 않았습니다.</p>;
  const x = r.recruitment;
  const n = (v: number | null) => (v === null ? <span className="wait">미공개</span> : <span className="num">{v}</span>);
  return (
    <div className="rs-recruit">
      <div className="t">
        2027 모집 정보 <small>{x.count_status === "confirmed" ? "확정" : "최종 미확정"} · 기준일 {plainDate(x.source_as_of)}</small>
      </div>
      <dl>
        <div><dt>최초 인원</dt><dd>{n(x.initial_count)}</dd></div>
        <div><dt>변경</dt><dd>{x.rollover_change === null ? <span className="wait">미공개</span> : <span className="num">{signed(x.rollover_change)}</span>}</dd></div>
        <div><dt>최종 인원</dt><dd>{x.final_count === null ? <span className="wait">미확정</span> : <span className="num">{x.final_count}</span>}</dd></div>
        {x.deadline && <div><dt>마감</dt><dd className="num">{plainDate(x.deadline)}</dd></div>}
      </dl>
      {x.changes.length > 0 && (
        <ul className="chg">
          {x.changes.map((c) => (
            <li key={c.revision}>
              <span className="num">{c.announced_at ? seoulDate(c.announced_at) : plainDate(c.announced_date)}</span> {c.reason ?? "변경"}{" "}
              {c.delta !== null && <b className="num">{signed(c.delta)}</b>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
