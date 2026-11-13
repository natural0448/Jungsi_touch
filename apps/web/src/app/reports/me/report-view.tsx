import Link from "next/link";
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

/** 전체 위치: 국·수·탐2 표준점수 합을 점수축으로, 서버가 밝힌 비교집단에서 위에서 몇 % */
/** fold: 긴 계산 설명을 '자세히 보기'로 접는다(2026-11-13 최종관리자 지시). 인쇄본은 접을 수 없으므로 fold={false} 로 모두 펼친다 */
export function OverallCard({ a, fold = true }: { a: OverallAnalysisDto; fold?: boolean }) {
  const o = a.overall;
  const interval = o.tie_interval_percent && typeof o.tie_interval_percent === "object" ? o.tie_interval_percent : null;
  const kind = o.data_kind ? DATA_KIND[o.data_kind] : null;
  const official = officialEstimate(o);
  // 추정 분포의 동점 비중을 실제로 센 학생 수로 말하지 않는다
  const tieText = interval && (official ? (
    <>
      나와 총점이 똑같은 학생도 있어서, 나보다 점수가 높은 학생만 세면 상위 <b className="num">{pctText(interval.lower)}%</b>, 같은 점수 학생까지 함께 세면 상위 <b className="num">{pctText(interval.upper)}%</b>입니다(위의 큰 숫자는 같은 점수까지 센 값).
      {" "}두 숫자의 차이는 같은 점수를 어떻게 세느냐의 차이일 뿐, 합격 가능성이나 오차 범위를 뜻하지 않습니다.
    </>
  ) : (
    <>
      나와 총점이 같은 학생들이 있어, 같은 점수인 사람을 빼고 세면 상위 <b className="num">{pctText(interval.lower)}%</b>, 포함해 세면 상위 <b className="num">{pctText(interval.upper)}%</b>입니다. 이 구간은 세는 방법의 차이일 뿐, 합격 확률이나 오차 범위가 아닙니다.
    </>
  ));
  // 정확한 model_version 은 근거로 남기되 화면 글자로는 보이지 않는다(10-26 사용자 결정: 학생·학부모·교사에게 의미 없는 내부 식별자)
  const more = official ? (
    <>
      {tieText && <p className="tie">{tieText}</p>}
      <p className="tie" data-model-version={o.model_version ?? undefined}>
        이 위치는 이번 시험의 공식 전체 응시자 수를 기준으로 계산한 <b>추정값</b>입니다. 정시터치 회원들의 성적을 모아 순위를 매긴 것이 아닙니다.
        {" "}학생마다 본 과목이 다르고 일부 과목을 보지 않은 학생도 있어, 그런 부분은 통계 모형으로 채워 계산했습니다.
        {" "}그래서 성적표의 과목별 백분위나 실제 대학 지원 결과와는 차이가 날 수 있습니다.
      </p>
    </>
  ) : (
    <>
      {tieText && <p className="tie">{tieText}</p>}
      {kind && <p className="tie">{kind.note}</p>}
    </>
  );
  return (
    <section className="rp-overall" aria-label="전체 성적 위치">
      <div className="n">
        <small>국어·수학·탐구 2과목 표준점수 합</small>
        <b className="num big">{a.total_standard_score}</b>
        <span className="unit">점</span>
      </div>
      <div className="n">
        <small>{official ? "전체 응시자 중 내 위치 · 누적 백분위(누백)" : "전체 응시자 기준 상위"}</small>
        {o.status !== "pending" && o.inclusive_top_percent ? (
          <>
            <b className="num big">{pctText(o.inclusive_top_percent)}%</b>
            {o.status === "estimated" && <span className="est">{official ? "추정" : kind?.label ?? "추정"}</span>}
            <p className="tie">
              전체 응시자를 국어·수학·탐구 2과목 표준점수 합 순서로 줄 세웠을 때 내가 위에서 몇 % 안에 드는지를 보여 주는 추정값입니다. 합격 가능성이 아니며, 대학별 지원 가능성은 &lsquo;가능성 보기&rsquo;에서 학교마다 따로 확인하세요.
            </p>
            {fold ? (
              <details className="tie-more">
                <summary>이 숫자는 어떻게 계산했나요?</summary>
                {more}
              </details>
            ) : (
              more
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
          <col className="c-main" />
          <col className="c-main" />
          <col className="c-main" />
          <col className="c-main" />
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
      <p className="rp-sheet-note">상위 %는 그 과목을 본 응시자 중에서 내가 위에서 몇 % 안에 드는지입니다(과목마다 본 사람이 달라 과목끼리 직접 비교하지 않습니다). 영어·한국사{second && "·제2외국어/한문"}은 절대평가라 등급만 표시하며 총점(국·수·탐2)과 전체 위치에 넣지 않습니다.</p>
    </div>
  );
}

/* ── 위치 그래프: 서버가 준 상위 % 를 눈금 위에 표시만 한다(계산 없음) ── */

const COMBO_PENDING: Record<string, string> = {
  combo_model_missing: "이 조합의 분포가 아직 준비되지 않았습니다",
  total_model_missing: "전체 누백 분포 자료 연결 대기",
  total_model_not_approved: "분포 검수 중",
};

function pos(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

/*
  눈금 범위: 값이 모두 상위 쪽에 몰리면 0~100% 눈금에서는 점이 왼쪽 끝에 붙어 구분이 안 된다(2026-11-12 최종관리자 지적).
  그래프에 나오는 값 중 가장 큰 값보다 조금 넓은 '보기 좋은' 범위(5·10·20·30·50·100%)로 눈금을 확대한다.
  값은 서버가 준 그대로이며 화면이 새로 계산하지 않는다. 한 그래프 안의 줄은 모두 같은 눈금을 쓴다.
*/
const NICE_MAX = [5, 10, 20, 30, 50, 100];
function scaleMax(values: (string | null | undefined)[]): number {
  const top = Math.max(0, ...values.map((v) => pos(v) ?? 0));
  return NICE_MAX.find((m) => m >= top * 1.15) ?? 100;
}

function ChartRow({ label, sub, incl, excl, max, strong = false, waitText }: { label: string; sub?: string; incl: string | null | undefined; excl: string | null | undefined; max: number; strong?: boolean; waitText?: string }) {
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
  const at = (v: number) => Math.min(100, (v / max) * 100);
  const left = at(Math.min(i, e));
  const width = Math.max(0.8, at(Math.max(i, e)) - left);
  const x = at(i);
  return (
    <div className="pc-row">
      <span className="pc-label">{label}{sub && <small>{sub}</small>}</span>
      <div className="pc-track" aria-hidden>
        <i className={`pc-band${strong ? " strong" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} />
        <i className={`pc-dot${strong ? " strong" : ""}`} style={{ left: `${x}%` }} />
        <b className={`pc-tip${x > 82 ? " end" : ""}${strong ? " strong" : ""}`} style={{ left: `${x}%` }}>{pctText(incl!)}%</b>
      </div>
      <span className="pc-val num">{pctText(incl!)}%</span>
    </div>
  );
}

function Axis({ max }: { max: number }) {
  const ticks = [0, 1, 2, 3, 4, 5].map((k) => (max * k) / 5);
  return (
    <div className="pc-row pc-axis" aria-hidden>
      <span className="pc-label" />
      <div className="axis">
        {ticks.map((t, k) => (
          <span key={k} style={{ left: `${(k / 5) * 100}%` }}>{k === 0 ? "상위 0%" : `${Number.isInteger(t) ? t : t.toFixed(1)}%`}</span>
        ))}
      </div>
      <span className="pc-val" />
    </div>
  );
}

/*
  A(2026-11-12 최종관리자 선택): 과목 중 가장 위·가장 아래를 한 줄로. 서버가 준 상위 %(같은 점수 포함)만 비교하며,
  과목마다 본 응시자가 달라 참고용이라고 함께 적는다. 값이 둘 미만이면 보이지 않는다.
*/
/** 받침에 따라 '이'/'가'(숫자로 끝나면 읽는 소리 기준) */
function iga(word: string): string {
  const ch = word.trim().slice(-1);
  if (/[0-9]/.test(ch)) return "013678".includes(ch) ? "이" : "가";
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "이(가)";
  return code % 28 ? "이" : "가";
}

function SubjectSummary({ a }: { a: OverallAnalysisDto }) {
  const rows = a.subjects
    .map((s) => ({ s, v: pos(s.top_percent_inclusive) }))
    .filter((r): r is { s: (typeof a.subjects)[number]; v: number } => r.v !== null);
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((x, y) => x.v - y.v);
  const hi = sorted[0], lo = sorted[sorted.length - 1];
  if (hi.v === lo.v) return null;
  const name = (s: (typeof a.subjects)[number]) => AREA_LABEL[s.area] ?? s.area;
  return (
    <p className="pc-summary">
      과목별로 보면 <b>{name(hi.s)}</b>{iga(name(hi.s))} 가장 위(상위 {pctText(hi.s.top_percent_inclusive!)}%), <b>{name(lo.s)}</b>{iga(name(lo.s))} 가장 아래(상위 {pctText(lo.s.top_percent_inclusive!)}%)입니다.
      <small> 과목마다 본 응시자가 달라 참고로만 보세요.</small>
    </p>
  );
}

/*
  D(2026-11-12 최종관리자 결정): 가장 위치가 높은 '조합' 하나를 알려 주면 그 조합의 대학이 실제로 좋은 대학인지와
  섞여 오해를 산다. 대신 국어·수학·탐구 중 어느 영역이 상대적으로 높은지로 '어떤 반영 비율의 대학이 유리할 수 있는지'를
  넓게 설명하고, 실제 대학은 유리한 대학 찾기에서 대학별 환산으로 확인하게 한다.
  - 서버가 준 과목별 상위 %(같은 점수 포함)만 쓴다. 탐구는 두 과목 평균. 값이 하나라도 없으면 보이지 않는다.
  - '눈에 띄게 높다' = 상위 %가 다른 영역의 3/4 이하이면서 1%p 이상 작다. 아니면 고른 편으로 본다.
  - 영어·한국사·제2외국어는 대학마다 반영 방식(감점·가산·비율)이 달라 이 문장에 넣지 않는다.
*/
function areaGuide(a: OverallAnalysisDto): { head: string; body: string } | null {
  const v = (area: string) => pos(a.subjects.find((s) => s.area === area)?.top_percent_inclusive);
  const k = v("korean"), m = v("math"), q1 = v("inquiry1"), q2 = v("inquiry2");
  if (k === null || m === null || q1 === null || q2 === null) return null;
  const q = (q1 + q2) / 2;
  const better = (x: number, y: number) => x <= y * 0.75 && y - x >= 1;
  if (better(m, k) && better(m, q))
    return { head: "수학이 국어·탐구보다 상대적으로 높습니다.", body: "수학 반영 비율이 높은 대학이 상대적으로 유리할 수 있습니다." };
  if (better(k, m) && better(q, m))
    return { head: "국어·탐구가 수학보다 상대적으로 높습니다.", body: "국어·탐구 반영 비율이 높은(수학 비율이 낮은) 대학이 상대적으로 유리할 수 있습니다." };
  if (better(k, m) && better(k, q))
    return { head: "국어가 수학·탐구보다 상대적으로 높습니다.", body: "국어 반영 비율이 높은 대학이 상대적으로 유리할 수 있습니다." };
  if (better(q, k) && better(q, m))
    return { head: "탐구가 국어·수학보다 상대적으로 높습니다.", body: "탐구 반영 비율이 높은 대학이 상대적으로 유리할 수 있습니다." };
  if (better(k, q) && better(m, q))
    return { head: "국어·수학이 탐구보다 상대적으로 높습니다.", body: "국어·수학 반영 비율이 높은(탐구 비율이 낮은) 대학이 상대적으로 유리할 수 있습니다." };
  return { head: "국어·수학·탐구가 비교적 고르게 나왔습니다.", body: "반영 비율에 따른 유불리가 크지 않을 수 있습니다." };
}

function AreaGuide({ a }: { a: OverallAnalysisDto }) {
  const g = areaGuide(a);
  if (!g) return null;
  return (
    <div className="pc-best">
      <div className="pc-best-in">
        <p><b>{g.head}</b> {g.body}</p>
        <small>
          &lsquo;유리하다&rsquo;는 내 성적이 그 대학 계산 방식에서 상대적으로 높게 나온다는 뜻일 뿐, 대학의 수준이나 합격 가능성을 뜻하지 않습니다.
          대학마다 반영 비율과 함께 영어·한국사 반영, 가산점, 탐구 반영 과목 수가 달라 실제 유불리는 대학별 환산으로 확인해야 합니다.
        </small>
      </div>
      <Link prefetch={false} href="/admissions/favorable" className="pc-best-go">유리한 대학 찾기에서 대학별로 확인</Link>
    </div>
  );
}

/** 눈금을 확대했을 때 알리는 한 줄 */
function ScaleNote({ max }: { max: number }) {
  if (max >= 100) return null;
  return <p className="pc-scale">눈금을 <b>상위 0~{max}%</b>로 확대했습니다. 오른쪽 끝이 상위 {max}%이며, 줄 전체 길이가 100%가 아닙니다.</p>;
}

/** 과목·전체 위치 그래프 */
export function PositionChart({ a }: { a: OverallAnalysisDto }) {
  const o = a.overall;
  const official = officialEstimate(o);
  const max = scaleMax([...a.subjects.map((s) => s.top_percent_inclusive), ...a.subjects.map((s) => s.top_percent_exclusive), o.inclusive_top_percent, o.exclusive_top_percent]);
  return (
    <section className="rp-chart" aria-label="상위 위치 그래프">
      <header>
        <h3>위치 그래프</h3>
        <small>왼쪽일수록 상위권 · 점은 내 위치(같은 점수 포함), 짧은 띠는 나와 같은 점수인 학생들이 차지하는 구간</small>
      </header>
      <SubjectSummary a={a} />
      <AreaGuide a={a} />
      <ScaleNote max={max} />
      <Axis max={max} />
      {a.subjects.map((s) => (
        <ChartRow key={s.area} label={AREA_LABEL[s.area] ?? s.area} sub={s.area === "korean" || s.area === "math" ? (s.choice ?? undefined) : s.subject} incl={s.top_percent_inclusive} excl={s.top_percent_exclusive} max={max} />
      ))}
      <ChartRow label="전체" max={max} sub={official ? "공식 전체 응시자 · 추정" : "국·수·탐2"} strong incl={o.inclusive_top_percent} excl={o.exclusive_top_percent} waitText={(o.reason_code && COMBO_PENDING[o.reason_code]) ?? "계산 대기"} />
      <p className="pc-note">
        {official
          ? "과목 줄은 그 과목을 본 응시자 중의 내 위치, 전체 줄은 국·수·탐2 표준점수 합으로 본 공식 전체 응시자 기준 추정 위치입니다(미응시·결측 과목은 모형으로 보완). 비교하는 집단이 서로 달라 줄끼리 길이를 견주지 않습니다."
          : "과목 줄은 그 과목을 본 응시자 중의 내 위치, 전체 줄은 국·수·탐2 표준점수 합으로 본, 정시터치가 비교한 학생들 가운데 내 위치입니다. 비교하는 집단이 서로 달라 줄끼리 길이를 견주지 않습니다."}
      </p>
    </section>
  );
}

/*
  반영 조합별 내 표준점수 합(2026-11-12 최종관리자 결정).
  조합별 상위 %는 여러 과목을 함께 본 응시자의 점수 분포가 있어야 하는데 구할 수 없어 제공하지 않는다.
  대신 대학이 자주 쓰는 반영 조합별로 서버가 준 과목 표준점수를 더한 값만 보여 준다(위치·백분위는 만들지 않는다).
  - 탐구 1과목은 두 과목 중 표준점수가 높은 과목. 대학마다 다를 수 있어 안내에 적는다.
  - 표준점수가 하나라도 없으면 그 조합은 '─'.
*/
export function ComboScores({ a }: { a: OverallAnalysisDto }) {
  const sc = (area: string) => a.subjects.find((s) => s.area === area)?.standard_score ?? null;
  const k = sc("korean"), m = sc("math"), q1 = sc("inquiry1"), q2 = sc("inquiry2");
  const q2sum = q1 !== null && q2 !== null ? q1 + q2 : null;
  const q1best = q1 !== null && q2 !== null ? Math.max(q1, q2) : null;
  const sum = (...v: (number | null)[]) => (v.some((x) => x === null) ? null : (v as number[]).reduce((x, y) => x + y, 0));
  // 표 한 개가 오른쪽 절반을 비워 두어(2026-11-12 최종관리자 지적) 두 단으로 나눈다. '읽는 법' 상자는 필요 없다는 결정으로 뺐다.
  // 왼쪽: 국어·수학이 함께 들어가는 조합, 오른쪽: 국어나 수학 한 과목 + 탐구. 좁은 화면에서는 아래로 쌓인다.
  const groups: { title: string; rows: [string, number | null][] }[] = [
    {
      title: "국어·수학 함께",
      rows: [
        ["국어 + 수학 + 탐구(2과목)", sum(k, m, q2sum)],
        ["국어 + 수학 + 탐구(1과목)", sum(k, m, q1best)],
        ["국어 + 수학", sum(k, m)],
      ],
    },
    {
      title: "국어 또는 수학 + 탐구",
      rows: [
        ["국어 + 탐구(2과목)", sum(k, q2sum)],
        ["수학 + 탐구(2과목)", sum(m, q2sum)],
        ["국어 + 탐구(1과목)", sum(k, q1best)],
        ["수학 + 탐구(1과목)", sum(m, q1best)],
      ],
    },
  ];
  return (
    <section className="rp-chart" aria-label="반영 조합별 내 표준점수 합">
      <header>
        <h3>반영 조합별 내 표준점수 합</h3>
        <small>자주 쓰는 반영 조합별로 내 표준점수를 더한 값입니다 · 탐구 1과목은 두 과목 중 높은 과목 · 대학별 실제 환산점수와는 다릅니다</small>
      </header>
      <div className="rp-combo-wrap">
        {groups.map((g) => (
          <div key={g.title} className="tblwrap">
            <table className="tb rp-combo">
              <thead>
                <tr>
                  <th scope="col">{g.title}</th>
                  <th scope="col" className="r">표준점수 합</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(([label, v]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td className="r">{v === null ? "─" : <b className="num">{v}</b>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
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
                  {s.offering ? s.offering.university_name : "지금 목록에서 찾을 수 없는 모집단위"}
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
        환산 유불리는 전체 성적 기준과 견줘 그 대학 계산 방식에서 내 위치가 얼마나 오르내리는지입니다(%p: 상위 %가 몇 %만큼 바뀌는지, 예 +0.5%p는 상위 5.6%→5.1%).
        지원 가부는 지원가능성 판단을 보세요 — 각 학과를 누르면 가능성 보기에서 자세한 설명이 열립니다.
      </p>
    </div>
  );
}
