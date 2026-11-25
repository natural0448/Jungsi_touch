import type { Metadata } from "next";
import Link from "@/components/link";
import { PageHead } from "@/components/page-head";
import { BAND } from "@/lib/decision-labels";
import { GUIDE_TAB, REPORT_TAB, page } from "@/lib/routes";
import { MarkGuideSeen } from "./seen";
import "./guide.css";

export const metadata: Metadata = { title: GUIDE_TAB.label };

/**
 * 1번째 탭 '이용 안내'(대표님 결정 2026-11-25). 화면 사이의 관계를 처음 쓰는 사람이 알 수 있게 한다.
 * 판정 단계 설명은 화면이 쓰는 문구(decision-labels)를 그대로 가져온다.
 */
export default function GuidePage() {
  const results = page("PAGE-01"), input = page("PAGE-02"), favorable = page("PAGE-04"), all = page("PAGE-03");
  const steps = [
    { n: results.number, href: results.path, title: results.label, what: "성적 입력 없이, 대학이 발표한 3개 학년도 입시결과를 전국 대학 단위로 봅니다.", tip: "지원을 고민하는 대학의 지난 결과를 먼저 살펴보세요." },
    { n: input.number, href: input.path, title: input.label, what: "수능 가채점 원점수를 넣으면 내 성적의 전체 위치를 분석한 리포트가 만들어집니다.", tip: "입력 횟수에 제한이 있으니 확인 창에서 값을 꼭 확인하고 저장하세요." },
    { n: favorable.number, href: favorable.path, title: favorable.label, what: "내 성적으로 지원에 유리한 대학을 추려 지원가능성(7단계)만 보여 줍니다.", tip: "관심 가는 학교는 ★ 즐겨찾기로 표시해 두세요. 학과별 자세한 내용은 다음 화면에서 봅니다." },
    { n: all.number, href: all.path, title: all.label, what: "지역·모집군·지원가능성으로 걸러 학과마다 내 환산점수, 지원가능성, 환산 유불리를 자세히 봅니다.", tip: "'즐겨찾기만 보기'로 앞 화면에서 고른 학교만 모아 볼 수 있습니다. 지원할 학과는 '담기'를 누르세요." },
    { n: REPORT_TAB.number, href: REPORT_TAB.path, title: REPORT_TAB.label, what: "담아 둔 학교와 내 성적을 한 장으로 정리하고 상담용 리포트로 출력합니다.", tip: "담기는 '전체 대학·학과 가능성 보기'에서만 할 수 있습니다." },
  ];
  const marks = [
    { label: "지원 조건 미충족 · 반영 과목 불일치", desc: "이 전형이 요구하는 과목·자격(예: 과학탐구 필수, 수학 선택과목)을 지금 성적이 채우지 않습니다." },
    { label: "수능 최저 미충족", desc: "수능 최저학력기준을 지금 성적으로는 넘지 못합니다." },
    { label: "판정 근거 부족 · 비교 자료 없음", desc: "비교할 과거 자료가 부족하거나 이 성적 조합의 비교 자료가 없어 지원가능성을 판정하지 않았습니다. 지원 자격과는 관계없습니다." },
    { label: "비교 기준 확인 필요", desc: "과거 입결과 올해 성적을 같은 기준으로 비교할 수 있는지 확인 중입니다. 환산점수는 볼 수 있습니다." },
    { label: "환산점수만 제공", desc: "학생부 등 수능 외 영역도 반영하는 전형입니다. 정시터치는 학생부를 받지 않아 수능 환산점수(와 위치)만 보여 드립니다." },
  ];
  return (
    <main className="guide">
      <MarkGuideSeen />
      <PageHead kicker={`PAGE ${GUIDE_TAB.number}`} title="정시터치 이용 안내" desc="처음이라면 아래 순서대로 따라 해 보세요. 화면마다 하는 일이 다릅니다." />
      <div className="wrap">
        <section className="g-sec" aria-labelledby="g-flow">
          <h2 id="g-flow">한눈에 보는 순서</h2>
          <ol className="g-steps">
            {steps.map((s) => (
              <li key={s.href} className="g-step">
                <span className="g-num">{s.n}</span>
                <div>
                  <h3><Link href={s.href}>{s.title}</Link></h3>
                  <p>{s.what}</p>
                  <p className="g-tip">{s.tip}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="g-sec" aria-labelledby="g-diff">
          <h2 id="g-diff">‘유리한 대학 찾기’와 ‘전체 대학·학과 가능성 보기’는 이렇게 다릅니다</h2>
          <div className="g-table" role="region" aria-label="두 화면 비교" tabIndex={0}>
            <table>
              <thead><tr><th scope="col"></th><th scope="col">{favorable.label}</th><th scope="col">{all.label}</th></tr></thead>
              <tbody>
                <tr><th scope="row">보여 주는 것</th><td>내 성적으로 유리한 대학 목록과 지원가능성(7단계)</td><td>검색한 대학·학과의 환산점수, 지원가능성, 환산 유불리, 모집 정보</td></tr>
                <tr><th scope="row">고르는 방법</th><td>서버가 내 성적 분포로 자동으로 추립니다</td><td>대학·학과 이름, 지역, 모집군, 지원가능성으로 직접 걸러 봅니다</td></tr>
                <tr><th scope="row">자세한 내용</th><td>보지 않습니다(가능성만)</td><td>학과를 펼쳐 자세히 봅니다</td></tr>
                <tr><th scope="row">학교 고르기</th><td>★ 즐겨찾기</td><td>‘담기’ → 리포트로</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="g-sec" aria-labelledby="g-band">
          <h2 id="g-band">지원가능성 7단계</h2>
          <p className="g-lead">지원가능성은 합격 확률이 아닙니다. 내 점수가 대학별 예상 합격권에서 어디쯤인지를 나눈 것입니다.</p>
          <dl className="g-bands">
            {Object.entries(BAND).map(([code, b]) => (
              <div key={code} className={`g-band ${b.cls}`}><dt>{b.label}</dt><dd>{b.desc}</dd></div>
            ))}
          </dl>
        </section>

        <section className="g-sec" aria-labelledby="g-marks">
          <h2 id="g-marks">판정 대신 보이는 표시</h2>
          <dl className="g-marks">
            {marks.map((m) => (<div key={m.label}><dt>{m.label}</dt><dd>{m.desc}</dd></div>))}
          </dl>
        </section>

        <section className="g-sec g-note" aria-labelledby="g-prov">
          <h2 id="g-prov">수능 가채점 분석을 볼 때</h2>
          <p>가채점 분석은 원점수로 표준점수를 추정해 계산한 결과입니다. 실제 성적표의 점수와 다를 수 있습니다. 성적표가 나오면 실채점 성적으로 다시 확인하세요.</p>
        </section>
      </div>
    </main>
  );
}
