import { AdvantageCell, plainReason, reasonText, ScoreCell, StatusCell } from "@/components/offering-parts";
import type { OverallAnalysisDto } from "@/lib/dto";
import { DATA_KIND, overallWaitLabel } from "@/lib/analysis-labels";
import { AREA_LABEL } from "@/lib/exam";
import { pctText } from "@/lib/format";
import type { PickedItem } from "@/lib/shortlist";

/* 2페이지 리포트의 전체 성적 부분 — 일반·유료 모두 보는 범위(REQ-02). 인쇄 화면도 같은 부품을 쓴다 */

const PENDING: Record<string, string> = {
  total_model_missing: "이 리포트를 저장할 때는 전체 누백 분포 자료가 서비스에 연결되어 있지 않았습니다. 계산이 진행 중인 것이 아닙니다. 같은 성적을 다시 저장할 필요는 없으며, 고객센터에 알려 주시면 확인해 드립니다.",
  total_model_not_approved: "전체 누적 곡선을 검수하고 있습니다.",
  score_outside_domain: "입력한 총점이 곡선의 검증 범위 밖이라 위치를 계산하지 않았습니다.",
};

/** 공식 전체 응시자를 분모로 한 추정 전체 누백인가(서버 DTO 의 실제 필드로만 판정, 인원 분모는 화면에 하드코딩하지 않는다) */
const officialEstimate = (o: OverallAnalysisDto["overall"]) =>
  o.status === "estimated" && o.data_kind === "estimated_weights" && o.population_id === OFFICIAL_ALL;
const OFFICIAL_ALL = "official_all_examinees";
/** 상위 % 를 '1,000명 중 위에서 몇 번째쯤'으로 바꾼다(최소 1번째) */
const rankOf1000 = (pct: string | number) => Math.max(1, Math.round(Number(pct) * 10)).toLocaleString("ko-KR");

/** 전체 위치: 국·수·탐2 표준점수 합을 점수축으로, 서버가 밝힌 비교집단에서 위에서 몇 % */
export function OverallCard({ a }: { a: OverallAnalysisDto }) {
  const o = a.overall;
  const interval = o.tie_interval_percent && typeof o.tie_interval_percent === "object" ? o.tie_interval_percent : null;
  const kind = o.data_kind ? DATA_KIND[o.data_kind] : null;
  const official = officialEstimate(o);
  return (
    <section className="rp-overall" aria-label="전체 성적 위치">
      <div className="n">
        <small>국어·수학·탐구 2과목 표준점수 합</small>
        <b className="num big">{a.total_standard_score}</b>
        <span className="unit">점</span>
      </div>
      <div className="n">
        <small>{official ? "공식 전체 응시자 기준 추정 전체 누적백분위" : "전체 응시자 기준 상위"}</small>
        {o.status !== "pending" && o.inclusive_top_percent ? (
          <>
            <b className="num big">{pctText(o.inclusive_top_percent)}%</b>
            {o.status === "estimated" && <span className="est">{official ? "추정" : kind?.label ?? "추정"}</span>}
            {interval &&
              (official ? (
                // 추정 분포의 동점 비중을 실제로 센 학생 수로 말하지 않는다
                <p className="tie">
                  누적백분위는 전체 응시자를 국어·수학·탐구 2과목 표준점수 합 순서로 줄 세웠을 때 내가 위에서 몇 % 안에 드는지를 뜻합니다.
                  {" "}상위 <b className="num">{pctText(o.inclusive_top_percent)}%</b>는 응시자 1,000명으로 치면 위에서 약 <b className="num">{rankOf1000(o.inclusive_top_percent)}</b>번째쯤입니다.
                  {" "}나와 총점이 똑같은 학생도 있어서, 나보다 점수가 높은 학생만 세면 상위 <b className="num">{pctText(interval.lower)}%</b>, 같은 점수 학생까지 함께 세면 상위 <b className="num">{pctText(interval.upper)}%</b>입니다(큰 숫자는 같은 점수까지 센 값).
                  {" "}두 숫자의 차이는 같은 점수를 어떻게 세느냐의 차이일 뿐, 합격 가능성이나 오차 범위를 뜻하지 않습니다.
                </p>
              ) : (
                <p className="tie">
                  나와 총점이 같은 학생들이 있어, 같은 점수인 사람을 빼고 세면 상위 <b className="num">{pctText(interval.lower)}%</b>, 포함해 세면 상위 <b className="num">{pctText(interval.upper)}%</b>입니다. 이 구간은 세는 방법의 차이일 뿐, 합격 확률이나 오차 범위가 아닙니다.
                </p>
              ))}
            {official ? (
              // 정확한 model_version 은 근거로 남기되 화면 글자로는 보이지 않는다(10-26 사용자 결정: 학생·학부모·교사에게 의미 없는 내부 식별자)
              <p className="tie" data-model-version={o.model_version ?? undefined}>
                이 위치는 이번 시험의 공식 전체 응시자 수를 기준으로 계산한 <b>추정값</b>입니다. 정시터치 회원들의 성적을 모아 순위를 매긴 것이 아닙니다.
                {" "}학생마다 본 과목이 다르고 일부 과목을 보지 않은 학생도 있어, 그런 부분은 통계 모형으로 채워 계산했습니다.
                {" "}그래서 성적표의 과목별 백분위나 실제 대학 지원 결과와는 차이가 날 수 있습니다. 내 대략적인 위치를 가늠하는 참고 자료로 보시고, 대학별 지원 가능성은 &lsquo;가능성 보기&rsquo;에서 학교마다 따로 확인하세요.
              </p>
            ) : (
              kind && <p className="tie">{kind.note}</p>
            )}
          </>
        ) : (
          <>
            <b className="wait">{overallWaitLabel(o.reason_code)}</b>
            <p className="tie">{(o.reason_code && PENDING[o.reason_code]) ?? "전체 위치를 계산할 자료가 아직 준비되지 않았습니다."} 총점과 과목 결과는 그대로 보입니다.</p>
          </>
        )}
      </div>
    </section>
  );
}

/** 가로 성적표: 입력 성적표와 같은 틀(한국사·국어·수학·영어·탐구). 절대평가 등급도 여기에 함께 보인다 */
/** second=false: 전문가용(학생 성적 입력에 제2외국어/한문 칸이 아직 없어 열을 숨긴다) */
export function SubjectsSheet({ a, second = true }: { a: OverallAnalysisDto; second?: boolean }) {
  const by = new Map(a.subjects.map((s) => [s.area, s]));
  const k = by.get("korean"), m = by.get("math"), q1 = by.get("inquiry1"), q2 = by.get("inquiry2");
  const g = a.absolute_grades;
  // 제2외국어/한문: 없거나 null 이면 미응시. 이 칸이 생기기 전(2026-11-12)에 저장한 성적도 미응시로 본다(최종관리자 결정)
  const sl = a.second_language ?? null;
  const na = <span className="rs-na" aria-label="해당 없음">─</span>;
  const num = (v: number | string | null | undefined, unit = "") => (v === null || v === undefined ? <span className="rs-wait">대기</span> : <b className="num">{v}{unit}</b>);
  const pctv = (v: string | null | undefined) => (v ? <b className="num">{pctText(v)}%</b> : <span className="rs-wait">대기</span>);
  return (
    <div className="rp-sheet" role="group" aria-label="과목별 결과 성적표">
      <table>
        <colgroup>
          <col className="c-head" />
          <col />
          <col className="c-main" />
          <col className="c-main" />
          <col />
          <col className="c-main" />
          <col className="c-main" />
          {second && <col className="c-main" />}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className="corner">구분</th>
            <th scope="col" rowSpan={2}>한국사<br />영역</th>
            <th scope="col" rowSpan={2}>국어<br />영역</th>
            <th scope="col" rowSpan={2}>수학<br />영역</th>
            <th scope="col" rowSpan={2}>영어<br />영역</th>
            <th scope="colgroup" colSpan={2}>탐구 영역</th>
            {second && <th scope="col" rowSpan={2}>제2외국어<br />/한문 영역</th>}
          </tr>
          <tr>
            {/* 과목명은 다른 영역처럼 '선택과목' 줄에 둔다(10-26 사용자 지적: 머리글에 과목명이 올라가 있었다) */}
            <th scope="col" className="sub">탐구 1</th>
            <th scope="col" className="sub">탐구 2</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">선택과목</th>
            <td className="na">{na}</td>
            <td>{k?.choice ?? "─"}</td>
            <td>{m?.choice ?? "─"}</td>
            <td className="na">{na}</td>
            <td>{q1?.subject ?? "─"}</td>
            <td>{q2?.subject ?? "─"}</td>
            {second && <td>{sl ? sl.subject : <span className="rs-na">미응시</span>}</td>}
          </tr>
          <tr className="key">
            <th scope="row">표준점수</th>
            <td className="na">{na}</td>
            <td>{num(k?.standard_score)}</td>
            <td>{num(m?.standard_score)}</td>
            <td className="na">{na}</td>
            <td>{num(q1?.standard_score)}</td>
            <td>{num(q2?.standard_score)}</td>
            {second && <td className="na">{na}</td>}
          </tr>
          <tr>
            <th scope="row">등급</th>
            <td>{g.한국사 ? <b className="num">{g.한국사}</b> : <span className="rs-na">안 넣음</span>}</td>
            <td>{num(k?.grade)}</td>
            <td>{num(m?.grade)}</td>
            <td>{g.영어 ? <b className="num">{g.영어}</b> : <span className="rs-na">안 넣음</span>}</td>
            <td>{num(q1?.grade)}</td>
            <td>{num(q2?.grade)}</td>
            {second && <td>{sl ? <b className="num">{sl.grade}</b> : na}</td>}
          </tr>
          <tr>
            <th scope="row">상위 % <small>같은 점수 포함</small></th>
            <td className="na">{na}</td>
            <td>{pctv(k?.top_percent_inclusive)}</td>
            <td>{pctv(m?.top_percent_inclusive)}</td>
            <td className="na">{na}</td>
            <td>{pctv(q1?.top_percent_inclusive)}</td>
            <td>{pctv(q2?.top_percent_inclusive)}</td>
            {second && <td className="na">{na}</td>}
          </tr>
          <tr>
            <th scope="row">상위 % <small>같은 점수 제외</small></th>
            <td className="na">{na}</td>
            <td>{pctv(k?.top_percent_exclusive)}</td>
            <td>{pctv(m?.top_percent_exclusive)}</td>
            <td className="na">{na}</td>
            <td>{pctv(q1?.top_percent_exclusive)}</td>
            <td>{pctv(q2?.top_percent_exclusive)}</td>
            {second && <td className="na">{na}</td>}
          </tr>
        </tbody>
      </table>
      <p className="rp-sheet-note">상위 %는 그 과목을 본 응시자 중에서 내가 위에서 몇 번째쯤인지입니다(과목마다 본 사람이 달라 과목끼리 직접 비교하지 않습니다). 영어·한국사{second && "·제2외국어/한문"}은 절대평가라 등급만 표시하며 총점(국·수·탐2)과 전체 위치에 넣지 않습니다.</p>
    </div>
  );
}

/* ── 위치 그래프: 서버가 준 상위 % 를 눈금 위에 표시만 한다(계산 없음) ── */

const COMBO_PENDING: Record<string, string> = {
  combo_model_missing: "이 조합의 분포가 아직 발행되지 않았습니다",
  total_model_missing: "전체 누백 분포 자료 연결 대기",
  total_model_not_approved: "분포 검수 중",
};

function pos(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

function ChartRow({ label, sub, incl, excl, strong = false, waitText }: { label: string; sub?: string; incl: string | null | undefined; excl: string | null | undefined; strong?: boolean; waitText?: string }) {
  const i = pos(incl);
  if (i === null)
    return (
      <div className="pc-row">
        <span className="pc-label">{label}{sub && <small>{sub}</small>}</span>
        <div className="pc-track pending"><span>{waitText ?? "자료 대기"}</span></div>
        <span className="pc-val">─</span>
      </div>
    );
  const e = pos(excl) ?? i;
  const left = Math.min(i, e);
  const width = Math.max(0.8, Math.abs(i - e));
  return (
    <div className="pc-row">
      <span className="pc-label">{label}{sub && <small>{sub}</small>}</span>
      <div className="pc-track" aria-hidden>
        <i className={`pc-band${strong ? " strong" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} />
        <i className={`pc-dot${strong ? " strong" : ""}`} style={{ left: `${i}%` }} />
      </div>
      <span className="pc-val num">{incl != null ? `${pctText(incl)}%` : ""}</span>
    </div>
  );
}

function Axis() {
  return (
    <div className="pc-row pc-axis" aria-hidden>
      <span className="pc-label" />
      <div className="axis"><span>상위 0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
      <span className="pc-val" />
    </div>
  );
}

/** 과목·전체 위치 그래프 */
export function PositionChart({ a }: { a: OverallAnalysisDto }) {
  const o = a.overall;
  const official = officialEstimate(o);
  return (
    <section className="rp-chart" aria-label="상위 위치 그래프">
      <header>
        <h3>위치 그래프</h3>
        <small>왼쪽일수록 상위권 · 점은 내 위치(같은 점수 포함), 짧은 띠는 나와 같은 점수인 학생들이 차지하는 구간</small>
      </header>
      <Axis />
      {a.subjects.map((s) => (
        <ChartRow key={s.area} label={AREA_LABEL[s.area] ?? s.area} sub={s.area === "korean" || s.area === "math" ? (s.choice ?? undefined) : s.subject} incl={s.top_percent_inclusive} excl={s.top_percent_exclusive} />
      ))}
      <ChartRow label="전체" sub={official ? "공식 전체 응시자 · 추정" : "국·수·탐2"} strong incl={o.inclusive_top_percent} excl={o.exclusive_top_percent} waitText={(o.reason_code && COMBO_PENDING[o.reason_code]) ?? "계산 대기"} />
      <p className="pc-note">
        {official
          ? "과목 줄은 그 과목을 본 응시자 중의 내 위치, 전체 줄은 국·수·탐2 표준점수 합으로 본 공식 전체 응시자 기준 추정 위치입니다(미응시·결측 과목은 모형으로 보완). 비교하는 집단이 서로 달라 줄끼리 길이를 견주지 않습니다."
          : "과목 줄은 그 과목을 본 응시자 중의 내 위치, 전체 줄은 국·수·탐2 표준점수 합으로 본 서버 비교 집단 중의 내 위치입니다. 비교하는 집단이 서로 달라 줄끼리 길이를 견주지 않습니다."}
      </p>
    </section>
  );
}

/** 반영 조합별 위치(제안 필드). 서버가 combinations 를 주지 않으면 안내만 보인다 */
export function ComboChart({ a }: { a: OverallAnalysisDto }) {
  const combos = a.combinations ?? [];
  if (combos.length === 0)
    return <p className="rp-combo-wait">반영 조합별 위치(국+수, 국+탐 등)는 조합별 승인 분포가 발행되면 여기에 표시됩니다.</p>;
  return (
    <section className="rp-chart" aria-label="반영 조합별 위치">
      <header>
        <h3>반영 조합별 위치</h3>
        <small>대학마다 반영 과목 조합이 달라, 조합별로 그 조합 응시자 중 내 위치를 보여 줍니다 · 대학별 환산은 「전체 대학·학과 가능성 보기」에서</small>
      </header>
      <Axis />
      {combos.map((c) => (
        <ChartRow key={c.combo_id} label={c.label} sub={c.total_standard_score !== null ? `${c.total_standard_score}점` : undefined} incl={c.inclusive_top_percent} excl={c.exclusive_top_percent} waitText={(c.reason_code && COMBO_PENDING[c.reason_code]) ?? "자료 대기"} />
      ))}
    </section>
  );
}

/** 핵심 지원 학교 표(report.shortlist + report.analyses). 성적을 바꾼 뒤 아직 다시 확인하지 않은 항목은 표시한다 */
export function PickedTable({ items, print = false }: { items: PickedItem[]; print?: boolean }) {
  return (
    <div className="tblwrap">
      <table className="tb rp-short">
        <thead>
          <tr>
            <th scope="col">대학 · 모집단위</th>
            <th scope="col" className="r">내 환산점수</th>
            <th scope="col">지원가능성</th>
            <th scope="col" className="r">환산 유불리</th>
            {print && <th scope="col">판단 근거</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const a = s.assessment;
            // 판단 구간 같은 내부 기준 수치는 인쇄본에도 적지 않는다(최종 관리자 지시 2026-10-07)
            const why = a && a.status === "ready" ? (a.recommendation_reasons?.length ? plainReason(a.recommendation_reasons[0]) : null) : null;
            return (
              <tr key={s.offering_id}>
                <th scope="row">
                  {s.offering ? s.offering.university_name : "카탈로그에 없는 모집단위"}
                  {s.offering && <small> {s.offering.department} · {s.offering.group}군</small>}
                  {s.entry.assessment_status === "needs_revalidation" && <span className="stale-tag">다시 확인 필요</span>}
                </th>
                <td className="r"><ScoreCell a={a} /></td>
                <td><StatusCell a={a} /></td>
                <td className="r"><AdvantageCell a={a} /></td>
                {print && (
                  <td className="why">
                    {!a ? "─" : a.status !== "ready" ? reasonText(a.reason_code) : why ?? "─"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="rp-short-note">
        내 환산점수는 그 대학이 정한 과목 비율대로 다시 계산한 점수(대학마다 만점이 달라 서로 비교하지 않음),
        환산 유불리는 전체 성적 기준과 견줘 그 대학 계산 방식에서 내 위치가 얼마나 오르내리는지(%p)입니다.
        지원 가부는 지원가능성 판단을 보세요 — 각 학과를 누르면 가능성 보기에서 자세한 설명이 열립니다.
      </p>
    </div>
  );
}
