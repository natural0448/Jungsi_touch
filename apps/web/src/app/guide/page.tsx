import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "@/components/link";
import { BAND } from "@/lib/decision-labels";
import { GUIDE_TAB, REPORT_TAB, page } from "@/lib/routes";
import { MarkGuideSeen } from "./seen";
import "./guide.css";

export const metadata: Metadata = { title: GUIDE_TAB.label };

/*
  1번째 탭 '이용 안내'(대표님 결정 2026-11-25). 정시터치를 누르면 처음 보이는 화면이라
  줄글 대신 그림·흐름도·실제 배지 미리보기로 한눈에 보이게 다시 그렸다(2026-11-25 대표님 지적: 밋밋하고 보기 어려움).
  외부 이미지는 쓰지 않는다(그림은 모두 이 파일의 SVG와 실제 화면 배지 모양). 판정 단계 문구는 decision-labels 를 그대로 쓴다.
  미리보기의 학교·점수는 모양을 보이기 위한 예시다(실제 학교 이름을 쓰지 않는다).
*/

const Ico = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICON = {
  results: "M4 19V9m6 10V5m6 14v-7m4 7H2",
  input: "M4 20h4l10-10-4-4L4 16v4zM13 7l4 4",
  favorable: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  all: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4-4",
  report: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
} as const;

const STAGES = ["stable", "downward", "target", "aspirational", "upward", "challenge", "outside"] as const;

function Mock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="g-mock" aria-hidden="true">
      <div className="g-mock-bar"><i /><i /><i /><span>{title}</span></div>
      <div className="g-mock-body">{children}</div>
    </div>
  );
}

export default function GuidePage() {
  const results = page("PAGE-01"), input = page("PAGE-02"), favorable = page("PAGE-04"), all = page("PAGE-03");
  const steps = [
    { n: results.number, href: results.path, title: results.label, icon: ICON.results, what: "대학이 발표한 3개 학년도 입시결과를 전국 대학 단위로 봅니다.", todo: "성적 입력 없이 둘러보기" },
    { n: input.number, href: input.path, title: input.label, icon: ICON.input, what: "수능 가채점 원점수를 넣으면 내 성적 위치 리포트가 만들어집니다.", todo: "확인 창에서 값 확인 후 저장" },
    { n: favorable.number, href: favorable.path, title: favorable.label, icon: ICON.favorable, what: "내 성적으로 지원에 유리한 대학과 지원가능성을 추려 줍니다.", todo: "관심 학교에 ★ 즐겨찾기" },
    { n: all.number, href: all.path, title: all.label, icon: ICON.all, what: "학과마다 내 환산점수 · 지원가능성 · 환산 유불리를 자세히 봅니다.", todo: "지원할 학과 '담기'" },
    { n: REPORT_TAB.number, href: REPORT_TAB.path, title: REPORT_TAB.label, icon: ICON.report, what: "담은 학교와 내 성적을 한 장으로 정리해 상담용으로 출력합니다.", todo: "출력해서 상담에 쓰기" },
  ];
  const marks = [
    { tag: "inel", label: "지원 조건 미충족", desc: "요구 과목·자격(예: 과학탐구 필수, 수학 선택과목)을 지금 성적이 채우지 않습니다." },
    { tag: "inel", label: "수능 최저 미충족", desc: "수능 최저학력기준을 지금 성적으로는 넘지 못합니다." },
    { tag: "check", label: "판정 근거 부족 · 비교 자료 없음", desc: "비교할 과거 자료가 부족해 판정하지 않았습니다. 지원 자격과는 관계없습니다." },
    { tag: "check", label: "비교 기준 확인 필요", desc: "과거 입결과 올해 성적을 같은 기준으로 비교할 수 있는지 확인 중입니다." },
    { tag: "safe", label: "○○ · 수능 기준", desc: "학생부 등도 반영하는 전형을 수능 반영분만으로 판정했습니다." },
    { tag: "check", label: "환산점수만 제공", desc: "정시터치는 학생부를 받지 않아 수능 환산점수(와 위치)만 보여 드립니다." },
  ];
  return (
    <div className="guide">
      <MarkGuideSeen />

      <section className="g-hero">
        <div className="wrap g-hero-in">
          <div className="g-hero-text">
            <p className="g-kicker">PAGE {GUIDE_TAB.number} · 이용 안내</p>
            <h1>내 성적이 <em>유리한 대학</em>,<br />정시터치로 5단계면 찾습니다</h1>
            <p className="g-hero-sub">대학 발표 입시결과 확인부터 상담용 리포트까지. 아래 순서대로 따라오세요.</p>
            <div className="g-cta">
              <Link className="g-btn p" href={input.path}>성적 입력부터 시작하기</Link>
              <Link className="g-btn ghost" href={results.path}>입시결과 먼저 둘러보기</Link>
            </div>
          </div>
          <ul className="g-stats" aria-label="정시터치 한눈에">
            <li><b>5,700<small>여</small></b><span>전국 2027 정시<br />모집단위</span></li>
            <li><b>7<small>단계</small></b><span>안정부터 불가까지<br />지원가능성</span></li>
            <li><b>3<small>개 학년도</small></b><span>대학이 발표한<br />입시결과</span></li>
          </ul>
        </div>
      </section>

      <div className="wrap">
        <section className="g-sec" aria-labelledby="g-flow">
          <p className="g-eyebrow">STEP BY STEP</p>
          <h2 id="g-flow">한눈에 보는 순서</h2>
          <ol className="g-steps">
            {steps.map((s) => (
              <li key={s.href} className="g-step">
                <div className="g-step-top">
                  <span className="g-num">{s.n}</span>
                  <span className="g-ico"><Ico d={s.icon} /></span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.what}</p>
                <p className="g-todo"><span>여기서 할 일</span>{s.todo}</p>
                <Link className="g-go" href={s.href}>바로 가기 →</Link>
              </li>
            ))}
          </ol>
        </section>

        <section className="g-sec" aria-labelledby="g-diff">
          <p className="g-eyebrow">PAGE {favorable.number} · PAGE {all.number}</p>
          <h2 id="g-diff">두 화면은 이렇게 다릅니다</h2>
          <div className="g-compare">
            <article className="g-cmp">
              <Mock title={favorable.label}>
                <div className="g-mrow"><b>○○대학교</b><span className="st safe">안정</span><span className="g-star on">★</span></div>
                <div className="g-mrow"><b>△△대학교</b><span className="st core">적정</span><span className="g-star on">★</span></div>
                <div className="g-mrow"><b>□□대학교</b><span className="st reach">상향</span><span className="g-star">☆</span></div>
              </Mock>
              <h3><span className="g-pill">{favorable.number}</span>{favorable.label}</h3>
              <ul className="g-ticks">
                <li>내 성적으로 <b>유리한 대학을 자동으로</b> 추립니다</li>
                <li>대학별 <b>지원가능성 7단계</b>를 보여 줍니다</li>
                <li>관심 학교는 <b>★ 즐겨찾기</b> → 다음 화면으로 이어집니다</li>
              </ul>
            </article>
            <div className="g-arrow" aria-hidden="true"><span>★</span>즐겨찾기로<br />이어 보기</div>
            <article className="g-cmp">
              <Mock title={all.label}>
                <div className="g-mrow g-mhead"><span>학과</span><span>환산점수</span><span>지원가능성</span><span>유불리</span></div>
                <div className="g-mrow"><b>○○학과</b><span className="num">499.00</span><span className="st safe">하향</span><span className="g-adv down">불리 −5.58</span></div>
                <div className="g-mrow"><b>△△학과</b><span className="num">617.10</span><span className="st core">적정</span><span className="g-adv up">유리 +2.10</span></div>
              </Mock>
              <h3><span className="g-pill">{all.number}</span>{all.label}</h3>
              <ul className="g-ticks">
                <li>대학·학과 이름, 지역, 모집군, 지원가능성으로 <b>직접 찾습니다</b></li>
                <li>학과를 펼치면 <b>환산점수 · 대학 안 위치 · 환산 유불리</b></li>
                <li>지원할 학과는 <b>담기</b> → {REPORT_TAB.label}에 모입니다</li>
              </ul>
            </article>
          </div>
        </section>

        <section className="g-sec" aria-labelledby="g-band">
          <p className="g-eyebrow">7 LEVELS</p>
          <h2 id="g-band">지원가능성 7단계</h2>
          <p className="g-lead">합격 확률이 아니라, 내 점수가 그 대학 <b>예상 합격권에서 어디쯤</b>인지입니다.</p>
          <div className="g-scale" aria-hidden="true">
            <div className="g-scale-bar">
              {STAGES.map((c) => <span key={c} className={`g-seg ${c}`}>{BAND[c].label}</span>)}
            </div>
            <div className="g-scale-axis"><span>← 여유 있음</span><span>예상 합격권</span><span>합격선 아래 →</span></div>
          </div>
          <dl className="g-bands">
            {STAGES.map((c) => (
              <div key={c} className="g-band">
                <dt><span className={`st ${BAND[c].cls}`}>{BAND[c].label}</span></dt>
                <dd>{BAND[c].desc}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="g-sec g-combo" aria-labelledby="g-combo">
          <p className="g-eyebrow">READ TOGETHER</p>
          <h2 id="g-combo">지원가능성과 환산 유불리는 다른 것을 봅니다</h2>
          <div className="g-combo-grid">
            <div className="g-q">
              <span className="g-q-ico safe">↕</span>
              <h3>지원가능성</h3>
              <p><b>붙을 만한가?</b><br />이 대학 방식 점수와 예상 합격선 사이의 거리</p>
            </div>
            <div className="g-q">
              <span className="g-q-ico fit">⇄</span>
              <h3>환산 유불리</h3>
              <p><b>계산 방식이 나에게 득인가?</b><br />표준점수 합으로 줄 세울 때보다 이 대학 방식에서 앞서는지(유리), 뒤지는지(불리)</p>
            </div>
          </div>
          <div className="g-example">
            <p className="g-ex-label">예시</p>
            <div className="g-mrow g-ex-row"><b>○○대학교 ○○학과</b><span className="num">499.00</span><span className="st safe">하향</span><span className="g-adv down">불리 −5.58%p</span></div>
            <div className="g-bubble"><b>한 줄로 보면</b> 이 대학 계산 방식은 내게 조금 불리하지만, 그래도 예상 합격권보다 앞에 있습니다.</div>
            <p className="g-small">반대로 &lsquo;유리&rsquo;인데 &lsquo;불가&rsquo;면, 계산 방식은 득이지만 그래도 합격선에 못 미친다는 뜻입니다. {all.label}에서 학과를 펼치면 이 한 줄 해석이 나옵니다.</p>
          </div>
        </section>

        <section className="g-sec" aria-labelledby="g-marks">
          <p className="g-eyebrow">OTHER LABELS</p>
          <h2 id="g-marks">판정 대신 보이는 표시</h2>
          <div className="g-marks">
            {marks.map((m) => (
              <div key={m.label} className="g-mark">
                <span className={`st ${m.tag}`}>{m.label}</span>
                <p>{m.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="g-sec" aria-labelledby="g-final">
          <p className="g-eyebrow">TIMELINE</p>
          <h2 id="g-final">가채점에서 성적표까지</h2>
          <ol className="g-time">
            <li className="now">
              <span className="g-dot" />
              <h3>지금 · 수능 가채점</h3>
              <p>원점수로 표준점수·백분위·등급을 <b>추정</b>해 계산합니다. 점수가 범위로 나와, 범위 안에서 결과가 갈리는 곳은 결론을 미룹니다.</p>
            </li>
            <li>
              <span className="g-dot" />
              <h3>12월 11일 · 수능 성적표</h3>
              <p>성적표를 받으면 실채점 성적을 다시 넣어 주세요. 아래 표시가 한 값으로 정해집니다.</p>
              <div className="g-chips">
                <span className="st inel">수능 최저 충족 여부 갈림</span>
                <span className="st check">탐구 점수 환산 범위 확인</span>
                <span className="st core">적정~소신 같은 범위 판정</span>
              </div>
            </li>
          </ol>
        </section>

        <section className="g-end">
          <h2>준비되셨나요?</h2>
          <p>가채점 원점수만 있으면 바로 시작할 수 있습니다.</p>
          <div className="g-cta">
            <Link className="g-btn p" href={input.path}>성적 입력하러 가기</Link>
            <Link className="g-btn ghost" href={favorable.path}>{favorable.label}</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
