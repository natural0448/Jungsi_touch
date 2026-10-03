import Link from "next/link";
import { CATEGORY, CategoryBadge, PickButton, reasonText, type Cell } from "@/components/offering-parts";
import type { AssessmentDto, OfferingDto, RecruitmentDto } from "@/lib/dto";
import { plainDate, signed } from "@/lib/format";
import { page } from "@/lib/routes";

/** 펼친 줄: 2027 모집 정보(recruitment.read) + 세 판단 칸 + 연도별 근거(assessment) */
export function Detail({ o, a, rec, picked }: { o: OfferingDto; a: Cell; rec: RecruitmentDto | null; picked: boolean }) {
  const p2 = page("PAGE-02").path;
  const recruit = <Recruit o={o} rec={rec} />;

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
          <Link className="btn p" href={p2}>성적 입력하기</Link>
        </div>
      </>
    );
  }
  if (!a) {
    return (
      <>
        {recruit}
        <div className="empty-an"><p>이 모집단위의 분석 결과를 아직 받지 못했습니다. 잠시 뒤 다시 열어 보세요.</p></div>
      </>
    );
  }

  return (
    <>
      {recruit}
      <div className="three">
        <ConvertedCard a={a} />
        <DecisionCard a={a} />
        <AdvantageCard a={a} />
      </div>
      <Years a={a} />
      <div className="acts">
        <PickButton id={o.offering_id} on={picked} variant="wide" />
        <Link className="btn" href={p2}>내 성적 리포트에서 보기</Link>
      </div>
    </>
  );
}

function Recruit({ o, rec }: { o: OfferingDto; rec: RecruitmentDto | null }) {
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
          <span>기준일<b className="num">{plainDate(r.source_as_of)}</b></span>
        </>
      ) : (
        <span>모집 인원<b>{wait("자료 준비 중")}</b></span>
      )}
      <Link href={`${page("PAGE-01").path}?university=${encodeURIComponent(o.university_name)}&unit=${encodeURIComponent(o.department)}`}>대학 발표 입시결과 보기</Link>
    </div>
  );
}

function ConvertedCard({ a }: { a: AssessmentDto }) {
  return (
    <section className="card" aria-label="내 환산점수">
      <h3>내 환산점수</h3>
      {a.converted_score ? (
        <>
          <div className="big num">{a.converted_score}</div>
          <p>
            올해 이 대학 공식 반영식으로 환산했습니다.
            {a.converted_percentile && (
              <>
                {" "}이 대학 환산 분포에서 상위 <b className="num">{a.converted_percentile}%</b>(동점 포함) 위치입니다.
              </>
            )}
          </p>
        </>
      ) : (
        <>
          <div className="big hold">계산 보류</div>
          <p>{reasonText(a.reason_code)} 작년 표로 대신 계산하지 않습니다.</p>
        </>
      )}
      <span className="note">대학마다 만점·반영 방식이 달라 다른 대학 점수와 크기를 비교하지 않습니다.</span>
    </section>
  );
}

function DecisionCard({ a }: { a: AssessmentDto }) {
  const d = a.decision_components;
  const ev = a.decision_evidence;
  const r = ev?.expected_acceptance_range;
  const f = ev?.forecast_70;
  return (
    <section className="card" aria-label="지원가능성">
      <h3>지원가능성</h3>
      <div>
        <CategoryBadge a={a} />
      </div>
      {a.status !== "ready" ? (
        <p>{reasonText(a.reason_code)}{a.status === "ineligible" ? " 자격을 충족하지 않으면 점수 비교를 하지 않습니다." : ""}</p>
      ) : (
        <>
          {d?.adjusted_category && (
            <p className="adj">
              기본 판단 <b>{CATEGORY[d.base_category].label}</b> → 상담 조정 <b>{CATEGORY[d.adjusted_category].label}</b>
            </p>
          )}
          {r && (
            <p>
              판단 구간 <b className="num">{r.lower}~{r.upper}</b>{r.unit}
              <br />
              <small>{r.definition}</small>
            </p>
          )}
          {f && (
            <p>
              올해 70% 예상선{" "}
              {f.status === "ready" ? (
                <b className="num">
                  {f.value}
                  {f.unit}
                </b>
              ) : (
                <span className="wait">발표 대기</span>
              )}
            </p>
          )}
        </>
      )}
      <span className="note">지원가능성은 합격 확률이 아닙니다. 학과마다 따로 판단합니다.</span>
    </section>
  );
}

function AdvantageCard({ a }: { a: AssessmentDto }) {
  const v = a.advantage;
  if (!v) {
    return (
      <section className="card" aria-label="환산 유불리">
        <h3>환산 유불리</h3>
        <div className="big hold">판단 보류</div>
        <p>{a.status === "ineligible" ? "지원 자격을 충족하지 않아 유불리를 계산하지 않았습니다." : reasonText(a.reason_code) || "비교할 수 있는 분포와 환산 자료를 확인하고 있습니다."}</p>
      </section>
    );
  }
  const n = Number(v.delta_pp);
  const tone = v.status === "neutral" ? "even" : n > 0 ? "up" : "down";
  return (
    <section className="card" aria-label="환산 유불리">
      <h3>환산 유불리</h3>
      <div className={`big num ${tone}`}>
        {n > 0 ? "+" : ""}
        {v.delta_pp}
        <small>%p</small>
      </div>
      <p>{v.status === "favorable" ? "총점보다 이 대학 환산에서 위치가 올라갑니다." : v.status === "unfavorable" ? "총점보다 이 대학 환산에서 위치가 내려갑니다." : "총점과 이 대학 환산의 위치가 거의 같습니다."}</p>
      <span className="note">같은 비교집단 안에서 위치가 얼마나 바뀌는지입니다. 유리해도 합격 가능을, 불리해도 지원 불가를 뜻하지 않습니다.</span>
    </section>
  );
}

/** 연도별: 그해 기준으로 옮긴 내 환산점수(추정)와 대학 발표 지표를 나란히. 화면이 둘을 비교해 판정하지 않는다 */
function Years({ a }: { a: AssessmentDto }) {
  const metrics = a.decision_evidence?.historical_metrics ?? [];
  const years = a.years.filter((y) => y.academic_year < 2027);
  const all = Array.from(new Set([...years.map((y) => y.academic_year), ...metrics.map((m) => m.academic_year)])).sort((x, y) => y - x);
  if (all.length === 0) return null;
  return (
    <div className="years">
      <table>
        <caption>연도별 근거</caption>
        <thead>
          <tr>
            <th scope="col">학년도</th>
            <th scope="col" className="r">내 환산점수(그해 기준 추정)</th>
            <th scope="col">대학 발표 지표</th>
          </tr>
        </thead>
        <tbody>
          {all.map((yr) => {
            const y = years.find((x) => x.academic_year === yr);
            const ms = metrics.filter((m) => m.academic_year === yr);
            return (
              <tr key={yr}>
                <th scope="row" className="num">{yr}</th>
                <td className="r num">{y?.converted_score ?? <span className="na">─</span>}</td>
                <td>
                  {ms.length === 0 ? (
                    <span className="na">자료 없음</span>
                  ) : (
                    ms.map((m) => (
                      <span key={m.metric_name} className="m">
                        {m.metric_name}{" "}
                        {m.value === null ? <span className="na">미발표</span> : <b className="num">{m.value}{m.unit ?? ""}</b>}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <span className="note">대학 발표 지표는 대학마다 기준(환산점수·백분위·등급)이 달라 내 점수와 그대로 비교하지 않습니다. 판단은 위의 지원가능성을 보세요.</span>
    </div>
  );
}
