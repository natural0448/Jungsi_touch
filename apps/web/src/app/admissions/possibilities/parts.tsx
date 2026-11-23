import type { C1Score, NoJudgmentView } from "@/lib/csat-conditions";
import { REPORT_TAB } from "@/lib/routes";
import { csatGainView } from "@/components/csat-badge";
import type { ExceptionView } from "@/lib/csat-exceptions";
import { exceptionCls } from "@/lib/csat-exceptions";
import Link from "@/components/link";
import { ADVANTAGE_WORD, BAND, CATEGORY, CategoryBadge, decisionOf, referenceBandOf, EnrichedReasonList, PickButton, decisionReasonCode, isReferenceScore, reasonText, scoreOf, type Cell } from "@/components/offering-parts";
import { DATA_KIND, POPULATION, scoreBasisLabel } from "@/lib/analysis-labels";
import type { ReactNode } from "react";
import type { AssessmentDto, OfferingDto, OverallResultDto, ReferenceBandDto, SubjectResultDto } from "@/lib/dto";
import { referenceAdvantage } from "@/lib/reference-advantage";
import { CONDITION_MARK_TEXT, conditionLines, formal105Notice } from "@/lib/eligibility-conditions";
import { yearCutoffLines } from "@/lib/year-cutoffs";
import { POSITION_LINE_DESC, POSITION_NONE_DESC, POSITION_NONE_LABEL, positionNoteOf } from "@/lib/position-note";
import { REFERENCE_PERCENTILE_NOTE, REFERENCE_PERCENTILE_TITLE, referencePercentText } from "@/lib/reference-percentile";
import { page } from "@/lib/routes";
import { SchoolReflectedLine } from "@/components/school-reflected";
import { IssueItem } from "./recruit-parts";
import { P1YearCell } from "./p1-year-cell";

/**
 * 펼친 줄: 2027 모집 정보(extras 자리, recruit-parts.tsx) + 환산·학교 누백·지원 판단·유불리 + 근거(assessment).
 * 환산·누백·판단은 서로 따로 준비된다(1.7.0). 판단이 보류여도 성공한 환산·누백은 숨기지 않는다.
 */
/** acts=false: 맨 아래 담기·'내 성적 리포트에서 보기' 줄을 두지 않는다(2페이지 핵심 지원 학교 표에서 펼칠 때 — 이미 그 화면이고, 지난 기록은 읽기 전용) */
export function Detail({ o, a, extras, picked, subjects, overall, examType, acts = true }: { o: OfferingDto; a: Cell; extras: ReactNode; picked: boolean; subjects?: SubjectResultDto[]; overall?: OverallResultDto | null; examType?: string | null; acts?: boolean }) {
  const p2 = page("PAGE-02").path;
  // 2027 모집 정보·발행 기준은 펼친 뒤 따로 받아 채운다(extras.tsx) — 펼치기를 기다리게 하지 않는다
  const recruit = extras;

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
        {/* 화면을 그리기 전에 서버가 분석을 이미 시도했다(2026-11-21). 그래도 없으면 자료 미연결이라 버튼 안내를 하지 않는다 */}
        <div className="empty-an"><p>이 모집단위는 아직 분석 자료에 연결되지 않아 내 성적으로 계산하지 않았습니다. 위의 <b>대학 발표 입시결과 보기</b>에서 지난 결과를 확인할 수 있습니다.</p></div>
      </>
    );
  }

  return (
    <>
      {recruit}
      <StatusStrip a={a} overall={overall ?? null} />
      <div className="four">
        <ConversionCard a={a} />
        <PercentileCard a={a} />
        <DecisionCard a={a} subjects={subjects} examType={examType} overall={overall} />
        <AdvantageCard a={a} overall={overall} />
      </div>
      <SchoolReflectedLine a={a} />
      {(a.recommendation_reasons?.length ?? 0) > 0 && (
        <div className="reasons">
          <h3>이 학과의 판단 이유</h3>
          <DetailReasons a={a} />
        </div>
      )}
      <AdoptedEvidence a={a} />
      <Years a={a} overall={overall ?? null} />
      {acts && (
        <div className="acts">
          <PickButton id={o.offering_id} on={picked} variant="wide" />
          <Link className="btn" href={REPORT_TAB.path}>리포트에서 보기</Link>
        </div>
      )}
    </>
  );
}

/**
 * 수능 가채점 리포트의 펼친 상세(2026-11-23 대표님 요청: 9월 모의평가 때와 같은 화면·분석). 9월 상세와 같은 배치
 * (계산 준비 상태 → 내 환산점수 · 대학 안 내 위치 · 지원가능성 · 환산 유불리 → 담기)로, 가채점 값으로 채운다.
 * - 내 환산점수: 이 대학 방식 환산점수 가운데 추정과 범위(서버 school_score)
 * - 지원가능성: 학교별 가채점 7단계(범위면 '적정~소신')와 단계 안 위치
 * - 대학 안 내 위치: 서버 dep_r30 school_rank(동점 포함 상위누백). 환산 유불리는 아직 보류
 */
export function CsatDetail({ o, band, exception = null, noJudgment = null, c1 = null, extras, picked, acts = true }: { o: OfferingDto; band: ReferenceBandDto | null; exception?: ExceptionView | null; noJudgment?: NoJudgmentView | null; c1?: C1Score | null; extras: ReactNode; picked: boolean; acts?: boolean }) {
  // 판정 보류 모집단위(lib/csat-held.ts): 환산점수만 보이고 단계는 내지 않는다
  const judged = band && !band.held ? band : null;
  const ex = band ? null : exception;
  const s = band?.school_score ?? null;
  const range = s ? (s.low === s.high ? s.low : `${s.low}~${s.high}`) : null;
  const tone = judged ? BAND[judged.code] : null;
  const upper = judged?.upper_code && judged.upper_code !== judged.code ? BAND[judged.upper_code] : null;
  const pos = judged?.position ?? null;
  // 대학 안 내 위치(서버 dep_r30): 판정과 같은 누적 도수에서 읽은 동점 포함 상위누백. 보류 모집단위는 보이지 않는다
  const rk = judged?.school_rank && (judged.school_rank.central ?? judged.school_rank.best ?? judged.school_rank.worst) ? judged.school_rank : null;
  const rkRange = rk && rk.best && rk.worst && rk.best !== rk.worst ? `${rk.best}~${rk.worst}` : null;
  // 환산 유불리(서버 dep_r31). 보류 모집단위는 csatGainView 가 null
  const gain = csatGainView(judged);
  const items = [
    { k: "점수 변환", ok: !!s || !!c1, label: s || c1 ? "계산됨" : undefined, why: "가채점 성적으로 이 대학 환산점수를 계산하지 못했습니다" },
    { k: "대학 안 내 위치", ok: !!rk, label: rk ? "계산됨" : undefined, why: "가채점 성적의 대학 안 위치는 준비 중입니다" },
    { k: "지원 판단", ok: !!judged || ex?.kind === "minimum", label: judged ? "판정" : ex?.kind === "minimum" ? "수능 최저" : undefined, why: ex ? ex.desc : "이 모집단위의 가채점 판정 근거가 아직 없습니다" },
  ];
  return (
    <>
      {extras}
      <ul className="strip" aria-label="계산 준비 상태">
        {items.map((i) => (
          <li key={i.k} className={i.ok ? "ok" : "hold"}>
            <b>{i.k}</b> {i.ok ? i.label ?? "준비됨" : "—"}
            {!i.ok && <small> · {i.why}</small>}
          </li>
        ))}
      </ul>
      <div className="four">
        <section className="card" aria-label="내 환산점수">
          <h3>내 환산점수</h3>
          {s ? (
            <>
              <div className="big num">{s.central ?? range}</div>
              <p>
                {s.central !== null && s.low !== s.high && <>범위 {range} · </>}
                <span className="tag">학교 수능 반영분</span>
              </p>
              <p>가채점 원점수로 추정한 표준점수·백분위를 이 대학 방식으로 계산한 값입니다. 성적표가 나오면 달라질 수 있습니다.</p>
            </>
          ) : c1 ? (
            // 담당자 C1(11-23): 예외 7곳은 7단계 없이 수능 반영분·우수 3영역 점수만
            <>
              <div className="big num">{c1.central ?? `${c1.low}~${c1.high}`}</div>
              <p>
                {c1.central !== null && c1.low !== c1.high && <>범위 {c1.low}~{c1.high} · </>}
                <span className="tag">{c1.label}</span>
              </p>
              <p>이 전형은 수능 외 평가가 함께 반영되거나 3영역을 골라 반영해, 수능 부분 점수만 계산했습니다.</p>
            </>
          ) : (
            <>
              <div className="big hold">—</div>
              <p>{noJudgment?.label === "지원 조건 미충족" ? noJudgment.desc : "지금 성적으로 이 대학 환산점수를 계산하지 못했습니다(반영 과목·선택과목 조건 등)."}</p>
            </>
          )}
        </section>
        <section className="card" aria-label="대학 안 내 위치">
          <h3>대학 안 내 위치</h3>
          {rk ? (
            <>
              <div className="big num">
                상위 {rk.central ?? rkRange ?? rk.best ?? rk.worst}
                <small>%</small>
              </div>
              <p>
                {rk.central !== null && rkRange && <>범위 상위 {rkRange}%</>}
              </p>
              <span className="note">이 대학 방식 환산점수로 전체 응시자 중 위에서 몇 %인지입니다(같은 점수 포함). 이 숫자만으로 합격 여부를 판단하지 않습니다 — 판단은 <b>지원가능성</b> 칸이 담당합니다.</span>
            </>
          ) : (
            <>
              <div className="big hold">준비 중</div>
              <p>가채점 성적으로 이 대학 환산 분포에서의 위치를 계산하지 못했습니다.</p>
            </>
          )}
        </section>
        <section className="card" aria-label="지원가능성">
          <h3>지원가능성</h3>
          {judged && tone ? (
            <>
              <div>
                <span className={`st ${tone.cls}`} title={tone.desc}>{upper ? `${tone.label}~${upper.label}` : tone.label}</span>
              </div>
              <p>{tone.desc}</p>
              {upper && <p>가채점 점수 범위에 따라 {tone.label}부터 {upper.label}까지 나옵니다.</p>}
              {pos && (pos.better_gap || pos.worse_gap) && (
                <p>
                  {pos.better_gap && <>한 단계 위까지 {pos.better_gap}점 더 필요 · </>}
                  {pos.worse_gap && <>한 단계 아래로 내려가기 전까지 {pos.worse_gap}점 여유</>}
                </p>
              )}
              <p>가채점 원점수로 추정한 성적을 이 대학 방식으로 계산해 예상 합격권과 견준 판정입니다. 합격 확률이 아닙니다.</p>
            </>
          ) : ex ? (
            <>
              <div><span className={`st ${exceptionCls(ex)}`} title={ex.desc}>{ex.label}</span></div>
              <p>{ex.desc}</p>
            </>
          ) : (
            <>
              <div><span className={`st ${noJudgment?.cls ?? "check"}`} title={noJudgment?.desc ?? POSITION_NONE_DESC}>{noJudgment?.label ?? POSITION_NONE_LABEL}</span></div>
              <p>{noJudgment?.desc ?? "이 모집단위는 판정 근거가 아직 없어 단계를 내지 않았습니다."}</p>
            </>
          )}
        </section>
        <section className="card" aria-label="환산 유불리">
          <h3>환산 유불리</h3>
          {gain ? (
            <>
              <div className={`big num ${gain.tone}`}><span className="advw">{gain.tone === "up" ? "유리" : gain.tone === "down" ? "불리" : "비슷"}</span> {gain.text}<small>%p</small></div>
              <p>
                {gain.range && <>범위 {gain.range}%p</>}
              </p>
              <p>국·수·탐2 표준점수 합으로 본 전체 위치(상위 %)에서 이 대학 방식 환산점수로 본 위치(상위 %)를 뺀 값입니다. +면 이 대학 방식이 내게 유리, −면 불리합니다. 합격 가능성 판단과는 별개입니다.</p>
            </>
          ) : (
            <>
              <div className="big hold">준비 중</div>
              <p>이 모집단위는 가채점 환산 유불리를 비교할 자료가 아직 없습니다.</p>
            </>
          )}
        </section>
      </div>
      {acts && (
        <div className="acts">
          <PickButton id={o.offering_id} on={picked} variant="wide" />
          <Link className="btn" href={REPORT_TAB.path}>리포트에서 보기</Link>
        </div>
      )}
    </>
  );
}

/** 세 계산의 준비 상태를 따로 보인다 */
function StatusStrip({ a, overall }: { a: AssessmentDto; overall: OverallResultDto | null }) {
  const pn = positionNoteOf(a, overall);
  const conv = a.conversion?.status ?? (a.converted_score ? "ready" : "pending");
  const ref = isReferenceScore(a) && !!scoreOf(a);
  const pct = a.percentile?.status ?? (a.converted_percentile ? "ready" : "pending");
  const refPct = pct !== "ready" && !!referencePercentText(a.reference_percentile);
  const items = [
    { k: "점수 변환", ok: conv === "ready" || ref, label: ref ? "계산됨" : undefined, why: a.conversion?.reason_code },
    { k: "대학 안 내 위치", ok: pct === "ready" || refPct, label: refPct ? "추정됨" : undefined, why: a.percentile?.reason_code },
    pn
      ? { k: "지원 판단", ok: true, label: pn.kind === "line" ? "합격선 대비 위치" : "판정 근거 부족", why: undefined }
      : { k: "지원 판단", ok: a.status === "ready" || !!referenceBandOf(a), label: referenceBandOf(a) ? "판정" : undefined, why: a.status === "ineligible" ? "eligibility_not_met" : decisionReasonCode(a) },
  ];
  return (
    <ul className="strip" aria-label="계산 준비 상태">
      {items.map((i) => (
        <li key={i.k} className={i.ok ? "ok" : "hold"}>
          <b>{i.k}</b> {i.ok ? i.label ?? "준비됨" : "보류"}
          {!i.ok && i.why && <small> · {reasonText(i.why)}</small>}
        </li>
      ))}
    </ul>
  );
}

/** conversion.score_scope 를 사람이 읽는 말로. 모르는 값은 내부 코드라 보이지 않는다 */
const SCOPE: Record<string, string> = { csat_component: "수능 반영분" };

function ConversionCard({ a }: { a: AssessmentDto }) {
  const c = a.conversion;
  const score = scoreOf(a);
  const reference = isReferenceScore(a);
  return (
    <section className="card" aria-label="내 환산점수">
      <h3>내 환산점수</h3>
      {score ? (
        <>
          <div className="big num">
            {score}
            {c?.official_max_score && <small>/ {c.official_max_score}</small>}
          </div>
          <p>
            {!reference && c?.score_scope && SCOPE[c.score_scope] && <>반영 {SCOPE[c.score_scope]} · </>}
            {c?.score_basis && <span className="tag">{scoreBasisLabel(c.score_basis)}</span>}
            {reference && <span className="tag">학교 수능 반영분</span>}
          </p>
          {reference && <p>{reasonText("reference_conversion_not_production_approved")}</p>}
        </>
      ) : (
        <>
          <div className="big hold">계산 보류</div>
          <p>{reasonText(c?.reason_code ?? a.reason_code)}</p>
        </>
      )}
    </section>
  );
}

function PercentileCard({ a }: { a: AssessmentDto }) {
  const p = a.percentile;
  const top = p?.inclusive_top_percent ?? p?.top_percent ?? a.converted_percentile;
  // 학교 누백이 없을 때만 참고 누백(추정)을 이 자리에 보인다. 신호등·판정 표시는 붙이지 않는다
  const ref = referencePercentText(a.reference_percentile);
  if (!(top && p?.status !== "pending") && ref) {
    return (
      <section className="card" aria-label={REFERENCE_PERCENTILE_TITLE}>
        <h3>{REFERENCE_PERCENTILE_TITLE}</h3>
        <div className="big num">
          상위 {ref}
          <small>%</small>
        </div>
        <p className="ref-note">{REFERENCE_PERCENTILE_NOTE}</p>
      </section>
    );
  }
  const kind = p?.data_kind ? DATA_KIND[p.data_kind] : null;
  const pop = p?.population_scope ? POPULATION[p.population_scope] : null;
  return (
    <section className="card" aria-label="학교 환산 누백">
      <h3>이 대학 기준 내 위치</h3>
      {top && p?.status !== "pending" ? (
        <>
          <div className="big num">
            상위 {top}
            <small>%</small>
          </div>
          {(kind || pop) && (
            <p className="tags">
              {kind && <span className="tag">{kind.label}</span>}
              {pop && <span className="tag">{pop.label}</span>}
            </p>
          )}
          <span className="note">이 숫자만으로 유불리·합격 여부를 판단하지 않습니다 — 판단은 <b>지원가능성</b> 칸이 담당합니다.</span>
        </>
      ) : (
        <>
          <div className="big hold">누백 보류</div>
          <p>{reasonText(p?.reason_code) || "이 대학 환산 분포가 아직 준비되지 않았습니다."}</p>
        </>
      )}
    </section>
  );
}

/** 판단 구간·예상선 같은 내부 기준 수치는 보이지 않는다(최종 관리자 지시 2026-10-07). 뜻풀이와 조정 여부만 적는다 */
/** 자격 확인이 필요한 모집단위에서 학생이 할 일(2026-11-15 대표님 결정 문구) */
const DECISION_CONFIRM =
  "이 모집단위의 판정 자료가 아직 준비되지 않았습니다. 지원 자격(필수 응시 영역·지정 과목)은 모집요강에서 직접 확인해야 합니다. 자격이 맞다면 왼쪽 두 점수와 아래 연도별 근거로 지난 합격선과 비교해 판단하세요.";
const DECISION_CONDITIONS =
  "이 모집단위의 판정 자료가 아직 준비되지 않았습니다. 그동안은 요강에 적힌 지원 조건과 내 입력을 견줘 보세요. 맞으면 왼쪽 두 점수와 아래 연도별 근거로 지난 합격선과 비교해 판단하고, 졸업 연도 등 그 밖의 자격은 모집요강에서 확인하세요.";

/**
 * 펼친 상세 맨 위 줄(2027 모집군·모집 인원 … 대학 발표 입시결과 보기) 사이에 두는 지원 조건 묶음(대표님 요청 2026-11-22).
 * 전에는 지원가능성 카드 안에 있어 카드가 세로로 길었다. 필수 응시·수학·탐구 줄과 '내 입력과 맞음/다름', 모집요강 확인 안내를 함께 둔다.
 * 좁은 화면에서는 CSS 로 그 줄 아래로 내려간다(possibilities.css .rc-conds)
 */
export function ConditionsBlock({ a, subjects }: { a: Cell; subjects?: SubjectResultDto[] }) {
  if (!a || a === "need") return null;
  const show = a.eligibility_status === "needs_confirmation" || a.reason_code === "designated_subject_not_taken";
  return (
    <div className="rc-conds" aria-label="지원 조건">
      {show && <Conditions a={a} subjects={subjects} />}
      <p className="rc-note">지원 자격(필수 응시 영역·지정 과목·졸업 연도 등)은 모집요강에서 확인하세요.</p>
    </div>
  );
}

function Conditions({ a, subjects }: { a: AssessmentDto; subjects?: SubjectResultDto[] }) {
  const lines = conditionLines(a, subjects);
  if (!lines.length) return null;
  return (
    <ul className="conds">
      {lines.map((l) => (
        <li key={l.label}>
          <b>{l.label}</b> {l.text}
          {l.mark && <span className={`cm ${l.mark}`}>{CONDITION_MARK_TEXT[l.mark]}</span>}
        </li>
      ))}
    </ul>
  );
}

function Formal105({ a, subjects, examType }: { a: AssessmentDto; subjects?: SubjectResultDto[]; examType?: string | null }) {
  const n = formal105Notice(a.offering_id, examType, subjects);
  if (!n || a.status === "ineligible") return null;
  return (
    <p className="f105">
      <b>{n.score === "met" ? "점수 조건 충족" : "지원자격 확인 필요"}</b> 모집요강 지원자격: {n.text}.{" "}
      {n.score === "met" ? `${n.documents}은 모집요강에서 확인하세요.` : `본수능 실채점 성적을 넣으면 점수로 확인할 수 있는 조건을 확인합니다. ${n.documents}은 모집요강에서 확인하세요.`}
    </p>
  );
}

function DecisionCard({ a, subjects, examType, overall }: { a: AssessmentDto; subjects?: SubjectResultDto[]; examType?: string | null; overall?: OverallResultDto | null }) {
  const d = a.decision_components;
  const pn = positionNoteOf(a, overall);
  return (
    <section className="card" aria-label="지원가능성">
      <h3>지원가능성</h3>
      <div>
        <CategoryBadge a={a} overall={overall} />
      </div>
      <Formal105 a={a} subjects={subjects} examType={examType} />
      {pn ? (
        <>
          {pn.kind === "line" ? (
            <>
              <p>
                <b>{pn.margin.text}</b>입니다{pn.basis === "overall" ? " (이 대학 기준 내 위치가 없어 국·수·탐 표준점수 합 전체 위치로 견줌)" : ""}.
              </p>
              <p>{POSITION_LINE_DESC}</p>
            </>
          ) : (
            <p>{POSITION_NONE_DESC}</p>
          )}
          {/* 지원 조건 줄·모집요강 확인 안내는 상세 맨 위 줄로 옮겼다(ConditionsBlock, 2026-11-22) */}
        </>
      ) : null}
      {pn ? null : <DecisionBody a={a} subjects={subjects} d={d} />}
    </section>
  );
}

function DecisionBody({ a, subjects, d }: { a: AssessmentDto; subjects?: SubjectResultDto[]; d: AssessmentDto["decision_components"] }) {
  return (
    <>
      {referenceBandOf(a) && (
        <>
          <p>
            이 대학 방식으로 본 내 위치(누적 백분위)를 올해 합격권과 견준 결과입니다. {BAND[referenceBandOf(a)!.code].desc}
            {/* 범위로 나온 누백도 판정은 추정값 단계 하나로 적고, 범위는 누적 백분위 칸에만 둔다(2026-11-22) */}
            {referenceBandOf(a)!.upper_code && referenceBandOf(a)!.upper_code !== referenceBandOf(a)!.code ? " 내 위치가 범위로 나와, 점수를 낸 응시자 기준 추정값으로 판정했습니다. 범위는 누적 백분위 칸에서 확인하세요." : ""}
          </p>
          <span className="note">합격 확률이 아니니, 아래 연도별 근거와 함께 보고 판단하세요. 추천 목록에는 쓰이지 않습니다.</span>
        </>
      )}
      {/* 지원 조건 줄·모집요강 확인 안내는 상세 맨 위 줄로 옮겼다(ConditionsBlock, 2026-11-22) */}
      {referenceBandOf(a) ? null : a.status === "pending" && a.eligibility_status === "needs_confirmation" ? (
        conditionLines(a, subjects).length ? <p>{DECISION_CONDITIONS}</p> : <p>{DECISION_CONFIRM}</p>
      ) : a.status !== "ready" ? (
        a.reason_code === "designated_subject_not_taken" ? (
          <p>{reasonText(a.reason_code)} 위의 지원 조건에서 &lsquo;내 입력과 다름&rsquo;으로 표시된 조건을 확인하세요.</p>
        ) : (
          <p>{reasonText(decisionReasonCode(a))}{a.status === "ineligible" ? " 지원 조건을 충족하지 않으면 점수 비교를 하지 않습니다." : ""}</p>
        )
      ) : (
        <>
          <p>{decisionOf(a).desc}</p>
          {d?.adjusted_category && (
            <p className="adj">
              점수로 본 판단은 <b>{CATEGORY[d.base_category].label}</b>이지만, 입시 상담 경험을 반영해 <b>{CATEGORY[d.adjusted_category].label}</b>로 조정했습니다.
            </p>
          )}
        </>
      )}
      {a.status === "ready" && <span className="note">지난 입시결과와 비교해 나눈 구간입니다.</span>}
    </>
  );
}

/** 유불리를 내지 못한 모집단위의 안내(2026-11-15 대표님 결정 문구) */
const ADVANTAGE_HOLD =
  "이 대학의 반영 방식이 내 성적에 유리한지 보여 주는 칸입니다. 이 모집단위는 비교 자료가 모자라 표시하지 않았습니다. 아래 학교 반영 백분위로 대신 가늠할 수 있습니다.";

function AdvantageCard({ a, overall }: { a: AssessmentDto; overall?: OverallResultDto | null }) {
  const v = a.advantage;
  const ref = v ? null : referenceAdvantage(a.reference_percentile, overall);
  if (ref) {
    return (
      <section className="card" aria-label="환산 유불리">
        <h3>환산 유불리</h3>
        <div className={`big num ${ref.tone}`}><span className="advw">{ADVANTAGE_WORD[ref.tone]}</span> {ref.text}<small>%p</small></div>
        <p>
          {ref.tone === "up"
            ? "나에게 유리한 대학입니다. 이 대학의 점수 계산 방식이 내 과목 구성에 잘 맞아, 전체 성적으로 볼 때보다 내 위치가 이만큼 앞으로 갑니다."
            : ref.tone === "down"
              ? "나에게 불리한 대학입니다. 이 대학의 점수 계산 방식으로는 전체 성적으로 볼 때보다 내 위치가 이만큼 뒤로 밀립니다."
              : "유리하지도 불리하지도 않습니다. 이 대학 방식으로 계산해도 전체 성적 기준과 위치가 거의 같거나, 범위가 0을 걸쳐 단정할 수 없습니다."}
        </p>
        <span className="note">숫자가 +면 유리, −면 불리입니다. 전체 상위 누백에서 이 대학 방식 누적 백분위(추정)를 뺀 값이며(운영 승인 전 추정값), 둘 중 하나가 범위면 범위로 보입니다. 합격 가능성 판단과는 별개입니다.</span>
      </section>
    );
  }
  if (!v) {
    const otherPop = a.percentile?.population_scope === "required_rule_inputs_present";
    return (
      <section className="card" aria-label="환산 유불리">
        <h3>환산 유불리</h3>
        <div className="big hold">{a.status === "ineligible" ? "해당 없음" : "비교 자료 부족"}</div>
        <p>
          {a.status === "ineligible"
            ? "지원 자격을 충족하지 않아 유불리를 계산하지 않았습니다."
            : otherPop
              ? "이 대학 위치는 반영 성적을 모두 가진 응시자만 비교한 것이라, 전체 응시자 위치와 비교하는 학생 범위가 다릅니다. 그래서 두 위치의 차이를 유불리로 보여 드리지 않습니다."
              : ADVANTAGE_HOLD}
        </p>
      </section>
    );
  }
  const n = Number(v.delta_pp);
  const tone = v.status === "neutral" ? "even" : n > 0 ? "up" : "down";
  // 설명은 한 줄로(사용자 지시 2026-10-08). 판정이 추천 범위 밖인데 유불리가 양수면
  // '유리해 보이지만 판정이 우선'임을 바로 적어 모순처럼 읽히지 않게 한다
  const outsideButFavorable = a.status === "ready" && a.category === "outside" && v.status === "favorable";
  return (
    <section className="card" aria-label="환산 유불리">
      <h3>환산 유불리</h3>
      <div className={`big num ${tone}`}>
        <span className="advw">{ADVANTAGE_WORD[tone]}</span>{" "}
        {n > 0 ? "+" : ""}
        {v.delta_pp}
        <small>%p</small>
      </div>
      <p>
        {v.status === "favorable"
          ? "나에게 유리한 대학입니다. 이 대학 반영식이 내 과목 구성에 잘 맞아, 전체 성적으로 볼 때보다 내 위치가 이만큼 앞으로 갑니다."
          : v.status === "unfavorable"
            ? "나에게 불리한 대학입니다. 이 대학 반영식으로는 전체 성적으로 볼 때보다 내 위치가 이만큼 뒤로 밀립니다."
            : "이 대학 반영식으로 계산해도 전체 성적 기준과 위치가 거의 같습니다."}
        {outsideButFavorable && <b> 다만 유리해 보여도 이 학과는 올해 지원 검토 범위 밖입니다 — 왼쪽 판정이 우선입니다.</b>}
      </p>
      <span className="note">지원 여부 판단과는 별개인 보조 지표입니다 — 판단은 <b>지원가능성</b> 칸.</span>
    </section>
  );
}

/**
 * 판단 이유를 수험생·학부모가 이해할 수 있게 구체적으로 적는다(최종 관리자 지시 2026-10-08).
 * - 유불리 이유에는 실제 이동 폭(%p)을 붙인다(사용자 자신의 상대값 — 내부 기준 아님).
 * - 범위 이유에는 '공개된 과거 발표값(최종등록자 70%) ↔ 그해 기준 내 환산점수'의 연도별 대조를 붙인다.
 *   올해 판단 기준 점수 자체는 계속 공개하지 않고, 산출 방법·자료판도 화면에 보이지 않는다.
 */
const RANGE_CODES = new Set(["within_acceptance_range", "above_acceptance_range", "below_acceptance_range"]);

function DetailReasons({ a }: { a: AssessmentDto }) {
  const hasRange = (a.recommendation_reasons ?? []).some((r) => RANGE_CODES.has(r.code));
  return (
    <>
      <EnrichedReasonList a={a} />
      {hasRange && <RangeEvidence a={a} />}
    </>
  );
}

/**
 * 범위 판단의 체감 근거(1.9.16 보강): 공개 발표값(그해 최종등록자 70%)과 그해 기준 내 환산점수를
 * '값 나열'로만 보여 준다 — 통계 정의·산출 단계까지 같은지는 화면이 입증할 수 없으므로 추세·비교
 * 해석 문장을 붙이지 않고, 과거 대조 방향으로 올해 기준의 높낮이·원인을 단정하지 않는다.
 * 단위가 '점'이고 발표 척도의 만점이 올해 환산 만점과 같을 때만 같은 척도로 보고 나열한다.
 */
function RangeEvidence({ a }: { a: AssessmentDto }) {
  const metrics = a.decision_evidence?.historical_metrics ?? [];
  const officialMax = a.conversion?.official_max_score != null ? Number(a.conversion.official_max_score) : NaN;
  const scaleMax = (s: string | null | undefined) => {
    const t = s ? /(\d+(?:\.\d+)?)\s*점\s*만점/.exec(s) : null;
    return t ? Number(t[1]) : NaN;
  };
  const rows = a.years
    .map((y) => {
      const same = metrics.filter((x) => x.academic_year === y.academic_year && x.metric_name === "최종등록자 70%");
      const m = same.length === 1 ? same[0] : null; // 같은 이름 중복이면 첫 지표를 고르지 않는다
      if (!m || m.value === null || m.unit !== "점") return null;
      if (!Number.isFinite(officialMax) || scaleMax(m.original_scale) !== officialMax) return null;
      const mine = y.converted_score !== null ? Number(y.converted_score) : NaN;
      if (!Number.isFinite(mine) || !Number.isFinite(Number(m.value))) return null;
      return { year: y.academic_year, mine: y.converted_score!, pub: String(m.value), unit: m.unit };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((x, y) => y.year - x.year)
    .slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <div className="range-ev">
      <p>
        발표된 과거 값과 그해 기준 내 환산점수를 나란히 보존해 보여 드립니다 — 만점 숫자({officialMax}점)가 같은
        발표값만 골랐으며, 이것이 연도별 산식·단위·집단까지 같다는 뜻은 아닙니다(동등성은 검수 대상).
      </p>
      <ul>
        {rows.map((r) => (
          <li key={r.year}>
            <b className="num">{r.year}</b> 내 환산 <b className="num">{r.mine}</b>{r.unit} · 발표 최종등록자 70% <b className="num">{r.pub}</b>{r.unit}
          </li>
        ))}
      </ul>
      <p className="caveat">
        통계 정의·산출 단계까지 완전히 같은지는 검수 전이라 값만 보여 드리며, 추세·비교 해석은 하지 않습니다.
        올해 판단은 올해 예상 기준으로 하며, 그 기준 점수는 공개하지 않습니다.
      </p>
    </div>
  );
}

/** 채택본에 결속된 공개 근거(올해 변화·상담 조정·자료판)는 비노출 대상이 아니다 — 1.9.16 보존 요구.
 *  산출 방법(basis) 문구는 최종 관리자 지시대로 계속 보이지 않는다 */
function AdoptedEvidence({ a }: { a: AssessmentDto }) {
  const ev = a.decision_evidence;
  const issues = ev?.issue_summaries ?? [];
  const adj = ev?.adjustment_summary;
  const version = ev?.forecast_release_version ?? null;
  // 버전만 있는 채택본도 자료판 결속을 지우지 않는다(1.9.16 FE-ANALYSIS-02) — 다른 발표본으로 덮지 않음
  if (issues.length === 0 && !adj?.applied && !version) return null;
  return (
    <div className="evidence">
      <h3>
        이 분석이 채택한 발표 자료
        {version && <small> · 자료 기준 {version}</small>}
      </h3>
      {issues.length === 0 && !adj?.applied ? (
        <p className="ev-only-version">이 판단은 위 자료로 계산했습니다. 올해 바뀐 점이나 상담 조정은 없습니다.</p>
      ) : (
        <ul>
          {issues.map((t) => <IssueItem key={t.issue_id} t={t} />)}
          {adj?.applied && (
            <li>
              <b>상담 조정</b> {adj.reason ?? "입시 상담 경험을 반영해 기준을 조정했습니다."}
              {adj.version && <small> · {adj.version}</small>}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * 연도별 근거(대표님 결정 2026-11-15): 학년도별 대학 발표 입시결과, 그 합격선의 누적 백분위(추정),
 * 내 누적 백분위와의 차이. 누적 백분위끼리는 해가 달라도 같은 기준이라 바로 견준다.
 */
function Years({ a, overall }: { a: AssessmentDto; overall: OverallResultDto | null }) {
  const metrics = a.decision_evidence?.historical_metrics ?? [];
  const cut = yearCutoffLines(a, overall);
  const past = (y: number) => y >= 2024 && y <= 2026;
  const all = Array.from(new Set([2026, 2025, 2024, ...metrics.map((m) => m.academic_year).filter(past), ...cut.map((c) => c.year)])).sort((x, y) => y - x);
  return (
    <div className="years">
      <table>
        <caption>연도별 근거</caption>
        <thead>
          <tr>
            <th scope="col">학년도</th>
            <th scope="col">대학 발표 입시결과</th>
            <th scope="col">합격선 누적 백분위(추정) → 내 위치</th>
          </tr>
        </thead>
        <tbody>
          {all.map((yr) => {
            const ms = metrics.filter((m) => m.academic_year === yr);
            const lines = cut.find((c) => c.year === yr)?.lines ?? [];
            return (
              <tr key={yr}>
                <th scope="row" className="num">{yr}</th>
                <td>
                  {ms.length === 0 ? (
                    // 판정 근거가 없으면 1페이지와 같은 대학 발표 성적을 보인다(2026-11-17 대표님 결정 1-가)
                    <P1YearCell year={yr} />
                  ) : (
                    ms.map((m) => (
                      <span key={m.metric_name} className="m">
                        {m.metric_name}{" "}
                        {m.value === null ? <span className="na">미발표</span> : <b className="num">{m.value}{m.unit ?? ""}</b>}
                      </span>
                    ))
                  )}
                </td>
                <td>
                  {lines.length === 0 ? (
                    <span className="na">자료 없음</span>
                  ) : (
                    // 합격선 하나와 그 합격선 대비 내 위치를 한 줄로 짝지어 보인다(2026-11-16 대표님 요청)
                    <ul className="cl">
                      {lines.map((l, i) => (
                        <li key={i}>
                          <span className="cl-m">{l.metric}{l.scope ? <span className="cl-s"> · {l.scope}</span> : null}</span>
                          <b className="num cl-v">상위 {l.cutoff}%</b>
                          <span className={`cl-g ${l.side ?? ""}`}>{l.gap ? `→ ${l.gap}` : <span className="na">내 누적 백분위 없음</span>}</span>
                          {l.basis === "overall" && <span className="cl-s"> · 국·수·탐 표준점수 합 기준</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <span className="note">
        합격선 누적 백분위는 대학이 발표한 입시결과를 전체 응시자 기준 위치로 옮겨 추정한 값이고(운영 승인 전), 내 누적 백분위도 같은 기준입니다. 합격선은 1페이지 대학 발표 입시결과와 같은 자료입니다. 내가 합격선보다 위에 있을수록 그해 기준으로 여유가 있다는 뜻이니, 여러 해의 차이를 함께 보고 판단하세요.
      </span>
    </div>
  );
}

