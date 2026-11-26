import type { Metadata } from "next";
import Link from "@/components/link";
import { BAND } from "@/lib/decision-labels";
import { GUIDE_TAB, REPORT_TAB, page } from "@/lib/routes";
import { MarkGuideSeen } from "./seen";
import "./guide.css";

export const metadata: Metadata = { title: GUIDE_TAB.label };

/*
  1번째 탭 '이용 안내'(대표님 결정 2026-11-25).
  2026-11-26 대표님 지적으로 다시 씀: 카드·아이콘 상자·영문 머리말이 많아 기계가 만든 티가 나고 글씨가 작다,
  가채점(무료 공개)과 실채점(이용권)을 나눠 써야 한다.
  → 입시 안내 책자처럼 번호 매긴 단락과 표로 정리하고, 본문 16px·보조 14px 이상으로 키웠다.
  판정 단계 문구는 decision-labels 를 그대로 쓰고, '7단계 대신 나오는 표시'는 화면 문구(lib/csat-conditions.ts)와 같은 이름을 쓴다.
*/

const STAGES = ["stable", "downward", "target", "aspirational", "upward", "challenge", "outside"] as const;

/** 7단계 대신 나오는 표시. 이름은 화면에 실제로 나오는 그대로 */
const MARKS: { label: string; tone: "inel" | "check" | "note"; what: string; when: string }[] = [
  { label: "지원 조건 미충족", tone: "inel", what: "모집요강이 요구하는 과목·자격(예: 과학탐구 필수, 제2외국어 응시)을 지금 입력한 성적이 채우지 않습니다.", when: "입력한 과목이 바뀌지 않으면 그대로입니다." },
  { label: "반영 과목 불일치", tone: "inel", what: "이 모집단위가 점수에 반영하는 과목(수학 선택과목, 탐구 영역)과 입력한 과목이 다릅니다.", when: "모집요강에서 반영 과목을 확인해 주세요." },
  { label: "수능 최저 미충족", tone: "inel", what: "이 모집단위의 수능 최저학력기준을 지금 성적으로는 넘지 못합니다.", when: "가채점 범위 전체에서 못 넘을 때만 나옵니다." },
  { label: "수능 최저 충족 여부 갈림", tone: "check", what: "가채점 점수 범위에 따라 최저기준을 넘기도, 못 넘기도 합니다.", when: "실채점 성적을 넣으면 하나로 정해집니다." },
  { label: "탐구 점수 환산 범위 확인", tone: "check", what: "추정한 탐구 표준점수가 대학 환산표 범위를 벗어나 이 대학 점수를 계산하지 않았습니다.", when: "실채점 성적을 넣으면 계산됩니다." },
  { label: "수능 반영분만 비교", tone: "note", what: "학생부도 반영하는 전형입니다. 수능 반영분 점수와 그 분포에서의 위치만 보여 드립니다.", when: "정시터치는 학생부 성적을 받지 않습니다." },
  { label: "환산점수만 제공", tone: "note", what: "학생부 등 다른 영역을 함께 보는 전형이라 지원가능성 대신 수능 환산점수만 보여 드립니다.", when: "다른 영역은 이 점수를 바탕으로 직접 검토해 주세요." },
  { label: "비교 기준 확인 필요", tone: "check", what: "지난 입시결과와 올해 성적을 같은 기준(감점 방식·만점 기준 등)으로 견줄 수 있는지 확인하는 중입니다. 환산점수가 나오면 함께 보여 드립니다.", when: "확인이 끝나는 대로 7단계 판정이 붙습니다." },
  { label: "비교 자료 없음", tone: "check", what: "이 성적 조합으로 지원한 과거 사례가 비교 자료에 없어 지원가능성을 판정하지 않았습니다.", when: "지원 자격과는 관계없습니다." },
];

export default function GuidePage() {
  const results = page("PAGE-01"), input = page("PAGE-02"), favorable = page("PAGE-04"), all = page("PAGE-03");
  const steps = [
    { n: results.number, href: results.path, title: results.label, what: "대학이 발표한 2024~2026학년도 정시 입시결과(모집인원·경쟁률·충원·합격 성적)를 대학별로 봅니다.", todo: "성적을 넣지 않아도 볼 수 있습니다." },
    { n: input.number, href: input.path, title: input.label, what: "수능 가채점 원점수를 넣으면 과목별 예상 표준점수·백분위·등급과 전국 내 예상 위치가 나옵니다.", todo: "저장하기 전에 확인 창에서 선택과목과 점수를 한 번 더 봐 주세요. 저장한 성적은 직접 고칠 수 없습니다." },
    { n: favorable.number, href: favorable.path, title: favorable.label, what: "내 성적을 대학마다 그 대학 방식으로 계산해, 지원해 볼 만한 대학을 도전·핵심·여유로 나눠 보여 줍니다.", todo: "관심 있는 대학에 ★를 눌러 두면 다음 화면에서 모아 볼 수 있습니다." },
    { n: all.number, href: all.path, title: all.label, what: "대학·학과 이름, 지역, 모집군으로 찾아 학과마다 환산점수·지원가능성·대학 안 위치·환산 유불리를 봅니다.", todo: "지원을 검토할 학과는 '담기'를 눌러 두세요." },
    { n: REPORT_TAB.number, href: REPORT_TAB.path, title: REPORT_TAB.label, what: "담은 학과와 내 성적을 한 장으로 정리합니다. 상담할 때 출력해서 쓰면 됩니다.", todo: "가·나·다군별로 담은 학과를 견줘 보세요." },
  ];
  return (
    <div className="guide">
      <MarkGuideSeen />

      <header className="wrap g-head">
        <h1>정시터치 이용 안내</h1>
        <p className="g-head-sub">수능 성적을 대학마다 그 대학의 계산 방식으로 환산해, 학과마다 내 위치를 보여 드립니다. 처음이라면 아래 순서대로 보시면 됩니다.</p>

        <div className="g-table-wrap">
          <table className="g-plan">
            <caption>가채점과 실채점</caption>
            <thead>
              <tr><td /><th scope="col">수능 가채점</th><th scope="col">수능 실채점</th></tr>
            </thead>
            <tbody>
              <tr><th scope="row">기간</th><td><b>11월 27일 ~ 12월 13일</b></td><td><b>12월 14일부터</b></td></tr>
              <tr><th scope="row">이용</th><td><span className="g-free">무료 공개</span> 회원가입만 하면 이용권 없이 씁니다</td><td><span className="g-paid">이용권</span> 이용권이 있어야 씁니다</td></tr>
              <tr><th scope="row">넣는 성적</th><td>시험지에 적어 온 원점수</td><td>12월 11일 받는 성적표의 표준점수·백분위·등급</td></tr>
              <tr><th scope="row">결과</th><td>점수가 추정이라 낮게~높게 <b>범위</b>로 나옵니다. 유리한 대학은 묶음마다 10곳까지 보여 드립니다.</td><td>확정 성적이라 <b>한 값</b>으로 나옵니다. 대학 안 정확한 위치, 유불리 수치, 경계까지의 점수 차이, 지난 입시결과와의 비교까지 봅니다.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="g-plan-note">{results.label}는 언제나 로그인만 하면 볼 수 있습니다.</p>
      </header>

      <div className="wrap">
        <section className="g-sec" aria-labelledby="g-flow">
          <h2 id="g-flow">쓰는 순서</h2>
          <ol className="g-steps">
            {steps.map((s) => (
              <li key={s.href}>
                <span className="g-step-no">{s.n}</span>
                <div className="g-step-body">
                  <h3><Link href={s.href}>{s.title}</Link></h3>
                  <p>{s.what}</p>
                  <p className="g-step-todo">{s.todo}</p>
                </div>
                <Link className="g-step-go" href={s.href} aria-label={`${s.title} 화면 열기`}>열기</Link>
              </li>
            ))}
          </ol>
        </section>

        <section className="g-sec" aria-labelledby="g-diff">
          <h2 id="g-diff">두 화면의 차이</h2>
          <p className="g-lead">{favorable.label}와 {all.label}는 같은 성적·같은 계산을 씁니다. 다른 것은 학교를 고르는 방법입니다.</p>
          <div className="g-table-wrap">
            <table className="g-cmp">
              <thead>
                <tr><td /><th scope="col">{favorable.label}</th><th scope="col">{all.label}</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">학교를 고르는 쪽</th><td>정시터치가 내 성적에 유리한 곳을 추립니다</td><td>내가 이름·지역·모집군으로 직접 찾습니다</td></tr>
                <tr><th scope="row">보는 단위</th><td>대학 → 계열 → 학과 순서로 펼쳐 봅니다</td><td>학과 한 줄씩, 펼치면 자세한 근거가 나옵니다</td></tr>
                <tr><th scope="row">주로 보는 값</th><td>대학별 지원가능성 7단계</td><td>환산점수, 지원가능성, 대학 안 위치, 환산 유불리</td></tr>
                <tr><th scope="row">다음 단계</th><td>★ 즐겨찾기 → {all.label}에서 모아 보기</td><td>담기 → {REPORT_TAB.label}에서 한 장으로 보기</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="g-sec" aria-labelledby="g-band">
          <h2 id="g-band">지원가능성 7단계</h2>
          <p className="g-lead">합격 확률이 아닙니다. 내 점수가 그 학과의 <b>예상 합격권</b>에서 어디쯤인지를 일곱 칸으로 나눈 것입니다.</p>
          <div className="g-scale" aria-hidden="true">
            {STAGES.map((c) => <span key={c} className={`g-seg ${c}`}>{BAND[c].label}</span>)}
          </div>
          <div className="g-scale-axis" aria-hidden="true"><span>여유 있음</span><span>예상 합격권</span><span>합격선 아래</span></div>
          <dl className="g-defs">
            {STAGES.map((c) => (
              <div key={c} className={`g-def ${c}`}>
                <dt>{BAND[c].label}</dt>
                <dd>{BAND[c].desc}</dd>
              </div>
            ))}
          </dl>
          <p className="g-note">가채점에서는 점수가 범위라 &lsquo;적정~소신&rsquo;처럼 두 단계에 걸쳐 나올 수 있습니다. 실채점 성적을 넣으면 한 단계로 정해집니다.</p>
        </section>

        <section className="g-sec" aria-labelledby="g-combo">
          <h2 id="g-combo">지원가능성과 환산 유불리</h2>
          <div className="g-two">
            <div>
              <h3>지원가능성</h3>
              <p>이 대학 방식으로 계산한 내 점수가 예상 합격선에서 얼마나 떨어져 있는지 봅니다. &lsquo;붙을 만한가&rsquo;에 가까운 질문입니다.</p>
            </div>
            <div>
              <h3>환산 유불리</h3>
              <p>국어·수학·탐구 표준점수 합으로 줄 세울 때보다 이 대학 계산 방식에서 내가 앞서는지(유리), 뒤지는지(불리)를 %p로 봅니다. &lsquo;이 대학 계산법이 나에게 득인가&rsquo;를 묻는 값입니다.</p>
            </div>
          </div>
          <p className="g-example"><b>예를 들어</b> &lsquo;하향 · 불리 −5.58%p&rsquo;라면, 이 대학 계산 방식은 나에게 조금 불리하지만 그래도 예상 합격권보다 앞에 있다는 뜻입니다. 반대로 &lsquo;유리&rsquo;인데 &lsquo;불가&rsquo;라면, 계산 방식은 득이지만 합격선에는 못 미친다는 뜻입니다.</p>
        </section>

        <section className="g-sec" aria-labelledby="g-marks">
          <h2 id="g-marks">7단계 대신 나오는 표시</h2>
          <p className="g-lead">아래 표시는 판정을 숨긴 것이 아니라, 7단계로 말하기 전에 먼저 알아야 할 사정이 있다는 뜻입니다.</p>
          <div className="g-table-wrap">
            <table className="g-marks">
              <thead><tr><th scope="col">표시</th><th scope="col">뜻</th><th scope="col">이후</th></tr></thead>
              <tbody>
                {MARKS.map((m) => (
                  <tr key={m.label}>
                    <th scope="row"><span className={`g-mark ${m.tone}`}>{m.label}</span></th>
                    <td>{m.what}</td>
                    <td className="g-when">{m.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="g-note">판정 옆에 &lsquo;· 수능 기준&rsquo;이 붙으면 학생부도 반영하는 전형을 수능 반영분만으로 판정한 것이고, &lsquo;· 유사 학과 기준&rsquo;이 붙으면 이 학과의 지난 합격선 대신 같은 캠퍼스의 비슷한 학과로 잡은 기준입니다.</p>
        </section>

        <section className="g-sec" aria-labelledby="g-final">
          <h2 id="g-final">가채점에서 실채점으로</h2>
          <ol className="g-time">
            <li>
              <span className="g-date">11.27 ~ 12.13</span>
              <div>
                <h3>가채점 분석 <span className="g-free">무료 공개</span></h3>
                <p>원점수로 표준점수·백분위·등급을 <b>추정</b>해 계산합니다. 결과가 범위로 나오고, 범위 안에서 답이 갈리는 곳(수능 최저 충족 여부, 탐구 환산 범위 등)은 결론을 미룹니다.</p>
              </div>
            </li>
            <li>
              <span className="g-date">12.11</span>
              <div>
                <h3>수능 성적표 배부</h3>
                <p>성적표를 받으면 표준점수·백분위·등급을 확인해 두세요.</p>
              </div>
            </li>
            <li>
              <span className="g-date">12.14 ~</span>
              <div>
                <h3>실채점 분석 <span className="g-paid">이용권</span></h3>
                <p>성적표 성적을 넣으면 범위로 나오던 값이 한 값으로 정해집니다. 가채점 때 미뤘던 수능 최저 충족 여부와 범위 판정도 이때 정해집니다.</p>
              </div>
            </li>
          </ol>
        </section>

        <p className="g-end">
          준비가 되었다면 <Link href={input.path}>{input.label}</Link>부터 시작하세요. 가채점 원점수만 있으면 됩니다.
        </p>
      </div>
    </div>
  );
}
