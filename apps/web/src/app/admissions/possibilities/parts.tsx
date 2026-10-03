import Link from "next/link";
import type { OfferingAnalysis, OfferingRow, Recruitment, SupportStatus } from "@/lib/contract";
import { plainDate, signed } from "@/lib/format";
import { togglePick } from "./actions";

/* 지원가능성 여섯 상태. 색과 함께 점 모양으로도 구분한다. 빨강은 '지원 조건 미충족'에만 */
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

export function PickButton({ id, on, wide }: { id: string; on: boolean; wide?: boolean }) {
  return (
    <form action={togglePick}>
      <input type="hidden" name="offering_id" value={id} />
      <input type="hidden" name="selected" value={on ? "0" : "1"} />
      {wide ? (
        <button className={`btn${on ? "" : " t"}`}>{on ? "핵심 지원 학교에서 빼기" : "핵심 지원 학교에 담기"}</button>
      ) : (
        <button className={`pick${on ? " on" : ""}`} aria-pressed={on}>
          {on ? "담음" : "담기"}
        </button>
      )}
    </form>
  );
}

/** 펼친 줄: 2027 모집 정보 + 세 판단 칸 + 근거 */
export function Detail({ o, a, picked }: { o: OfferingRow; a: OfferingAnalysis | null | "need"; picked: boolean }) {
  const r = o.recruitment;
  const recruit = (
    <div className="recruit">
      <span>2027 모집군<b>{o.group}군</b></span>
      <span>최초 인원<b className="num">{r.initial ?? <span className="wait">미공개</span>}</b></span>
      <span>변경<b className="num">{r.change === null ? <span className="wait">미공개</span> : signed(r.change)}</b></span>
      <span>최종 인원<b className="num">{r.final === null ? <span className="wait">미확정</span> : r.final}</b></span>
      <span>기준일<b className="num">{plainDate(r.as_of)}</b></span>
      <Link href="/admissions/results">대학 발표 입시결과 보기</Link>
    </div>
  );

  if (a === "need") {
    return (
      <>
        {recruit}
        <div className="empty-an">
          <p>
            <b>성적을 넣으면 이 모집단위의 내 환산점수 · 지원가능성 · 환산 유불리가 보입니다.</b>
            <br />
            성적이 없어도 검색과 모집 정보는 그대로 볼 수 있습니다.
          </p>
          <Link className="btn p" href="/reports/me">성적 입력하기</Link>
        </div>
      </>
    );
  }
  if (!a) {
    return (
      <>
        {recruit}
        <div className="empty-an"><p>이 모집단위의 분석 결과를 아직 받지 못했습니다.</p></div>
      </>
    );
  }

  return (
    <>
      {recruit}
      <div className="three">
        <ConvertedCard a={a} />
        <SupportCard a={a} />
        <AdvantageCard a={a} />
      </div>
      <div className="reason">
        <span className="lab">근거</span>
        <span>
          <b>{o.university.name} {o.unit_name}</b> · {a.support.reason}
        </span>
      </div>
      <div className="acts">
        <PickButton id={o.offering_id} on={picked} wide />
        <Link className="btn" href="/reports/me">내 성적 리포트에서 보기</Link>
      </div>
    </>
  );
}

function ConvertedCard({ a }: { a: OfferingAnalysis }) {
  const c = a.converted;
  return (
    <section className="card" aria-label="내 환산점수">
      <h3>내 환산점수</h3>
      {c.status === "calculated" && c.score ? (
        <>
          <div className="big num">
            {c.score}
            <small>/ {c.max_score}</small>
          </div>
          <p>
            {c.rule_label} 적용.
            {c.university_top_percent && (
              <>
                {" "}이 대학 환산 기준으로 같은 비교집단 상위 <b className="num">{c.university_top_percent}%</b> 위치입니다.
              </>
            )}
          </p>
        </>
      ) : (
        <>
          <div className="big hold">계산 보류</div>
          <p>올해 반영식이 확정되지 않아 환산하지 않았습니다. 작년 표로 대신 계산하지 않습니다.</p>
        </>
      )}
      <span className="note">대학마다 만점·반영 방식이 달라 다른 대학 점수와 크기를 비교하지 않습니다.</span>
    </section>
  );
}

function SupportCard({ a }: { a: OfferingAnalysis }) {
  const mine = a.converted.university_top_percent;
  const hist = a.support.history;
  const values = [mine, ...hist.map((h) => h.cut_top_percent)].filter((v): v is string => v !== null).map(Number);
  const max = Math.max(4, Math.ceil(Math.max(0, ...values) * 1.25));
  return (
    <section className="card" aria-label="지원가능성">
      <h3>지원가능성</h3>
      <div>
        <SupportBadge status={a.support.status} />
      </div>
      {hist.length > 0 ? (
        <>
          <ul className="hist" aria-label="지난 기준과 내 위치">
            {hist.map((h) => {
              if (h.cut_top_percent === null || mine === null) {
                return (
                  <li key={h.result_year} className="h">
                    <span className="num">{h.result_year}</span>
                    <span className="track" />
                    <span className="r na">{h.cut_top_percent === null ? "미발표" : "─"}</span>
                  </li>
                );
              }
              const above = Number(mine) <= Number(h.cut_top_percent);
              return (
                <li key={h.result_year} className="h">
                  <span className="num">{h.result_year}</span>
                  <span className="track" aria-label={`기준 상위 ${h.cut_top_percent}%, 내 위치 상위 ${mine}%`}>
                    <span className="cut" style={{ left: `${(Number(h.cut_top_percent) / max) * 100}%` }} />
                    <span className="me" style={{ left: `${(Number(mine) / max) * 100}%` }} />
                  </span>
                  <span className={`r ${above ? "above" : "below"}`}>{above ? "기준 이상" : "기준 미만"}</span>
                </li>
              );
            })}
          </ul>
          <span className="note">
            막대는 상위 0~{max}% 구간입니다. 세로선은 그해 대학 발표 기준({hist[0].metric_label})의 누적 위치, 점은 내 위치입니다. 원점수끼리 비교하지 않습니다.
          </span>
        </>
      ) : (
        <p>지원 자격 확인이 먼저입니다. 자격을 충족하지 않으면 점수 비교를 하지 않습니다.</p>
      )}
    </section>
  );
}

function AdvantageCard({ a }: { a: OfferingAnalysis }) {
  const v = a.advantage;
  if (v.status !== "computed" || !v.pp || !v.total_top_percent || !v.university_top_percent) {
    return (
      <section className="card" aria-label="환산 유불리">
        <h3>환산 유불리</h3>
        <div className="big hold">판단 보류</div>
        <p>{v.reason_code === "ELIGIBILITY_NOT_MET" ? "지원 자격을 충족하지 않아 유불리를 계산하지 않았습니다." : "비교할 수 있는 분포와 환산 자료를 확인하고 있습니다."}</p>
      </section>
    );
  }
  const total = Number(v.total_top_percent);
  const uni = Number(v.university_top_percent);
  const lo = Math.min(total, uni) - 0.6;
  const hi = Math.max(total, uni) + 0.6;
  // 왼쪽이 아래(상위 % 큼), 오른쪽이 위(상위 % 작음)
  const pa = ((hi - total) / (hi - lo)) * 100;
  const pb = ((hi - uni) / (hi - lo)) * 100;
  const n = Number(v.pp);
  const tone = Math.abs(n) < 0.1 ? "even" : n > 0 ? "up" : "down";
  return (
    <section className="card" aria-label="환산 유불리">
      <h3>환산 유불리</h3>
      <div className={`big num ${tone}`}>
        {v.pp}
        <small>%p</small>
      </div>
      <div className="dumb" aria-hidden="true">
        <span className="axis" />
        <span className={`seg ${n > 0 ? "" : "down"}`} style={{ left: `${Math.min(pa, pb)}%`, width: `${Math.abs(pb - pa)}%` }} />
        <span className="dot a" style={{ left: `${pa}%` }} />
        <span className="dot b" style={{ left: `${pb}%` }} />
      </div>
      <div className="dumb-lab">
        <span>총점 기준 상위 <b className="num">{v.total_top_percent}%</b></span>
        <span>대학 환산 기준 상위 <b className="num">{v.university_top_percent}%</b></span>
      </div>
      <span className="note">같은 비교집단 안에서 위치가 얼마나 바뀌는지입니다. 유리해도 합격 가능을, 불리해도 지원 불가를 뜻하지 않습니다.</span>
    </section>
  );
}
