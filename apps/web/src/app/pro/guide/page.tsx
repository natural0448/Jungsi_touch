import type { Metadata } from "next";
import Link from "@/components/link";
import { PageHead } from "@/components/page-head";
import { proAccess } from "@/lib/pro-access";
import "../pro.css";

export const metadata: Metadata = { title: "정시 기본 안내 · 정시터치 전문가용" };
export const dynamic = "force-dynamic";

/*
  정시 기본 안내 — 누구에게나 같은 공통 안내(학생별 상담 tip 과 별개). 문장은 일반 상담 가이드 v2
  (에듀터치 원문 대조 2026-10-21)에서 공개 조건을 채운 주제만 옮겼다. 환산 유불리·와일드카드 변동은
  서버 정의가 확정되면 더한다. 출처 기호는 아래 '출처' 목록과 같다.
*/

type Src = "A" | "B" | "C" | "D" | "E";
const SOURCES: Record<Src, { title: string; url: string }> = {
  A: { title: "한국대학교육협의회 「2027학년도 대학입학전형시행계획 주요사항」(2025. 4. 30.)", url: "https://www.kcue.or.kr/_upload/news/2025/04/30/application_25d9ccd90388d6ba316a2c7d398ff944.pdf" },
  B: { title: "고등교육법 시행령 제42조(입학지원방법 등) [시행 2026. 9. 11.]", url: "https://www.law.go.kr/법령/고등교육법시행령/제42조" },
  C: { title: "경기대학교 「2026~2024학년도 전형결과안내」 용어 설명", url: "https://enter.kyonggi.ac.kr/ajaxfile/CMN_SVC/FileView.do?GBN=X12&SITE_NO=2&MENU_NO=150&CONTENTS_NO=1&TYPE_CODE=C0601" },
  D: { title: "한국교육과정평가원 공고 제2026-91호 「2027학년도 대학수학능력시험 시행세부계획 공고」(2026. 7. 1.)", url: "https://www.suneung.re.kr" },
  E: { title: "한국대학교육협의회 「2027학년도 대학입학전형기본사항」(개정 2026. 7. 31.) 42~43쪽", url: "https://kcue.or.kr/_upload/news/2026/07/31/application_8366fe4b41bdfd2721e0b5596d3a265d.pdf" },
};

type Line = { t: string; s?: Src[] };
const TOPICS: { id: string; title: string; lines: Line[] }[] = [
  {
    id: "groups",
    title: "정시 가·나·다군과 지원 규칙",
    lines: [
      { t: "정시모집은 대학마다 가·나·다 중 한 군(또는 여러 군에 나눠) 학생을 뽑습니다. 2027학년도 정시 모집 대학은 가군 141곳, 나군 146곳, 다군 137곳입니다.", s: ["A"] },
      { t: "일반대학(교육대학 포함)끼리는 같은 군에서 두 곳 이상 지원할 수 없습니다. 같은 대학 안에서도 같은 군의 모집단위끼리는(일반·특별전형 사이 포함) 복수 지원이 안 됩니다.", s: ["B", "E"] },
      { t: "그래서 일반대학은 군마다 한 곳씩, 최대 세 곳까지 지원하는 것이 기본입니다.", s: ["B", "E"] },
      { t: "산업대학·전문대학은 이 군 제한을 받지 않습니다. 사관학교·경찰대학·과학기술원·한국예술종합학교·한국방송통신대학교 같은 특별법 설치 대학과 일반대학 사이에는 복수지원·이중등록 금지가 적용되지 않습니다.", s: ["E"] },
      { t: "수시모집에 합격하면(최초·충원 합격 모두) 같은 학년도의 정시·추가모집에 지원할 수 없습니다.", s: ["B", "E"] },
      { t: "같은 학기에 입학하는 여러 대학에 합격하면 한 대학에만 등록해야 합니다. 복수지원 금지를 어긴 사실이 전산 검색으로 확인되면 입학이 무효가 됩니다.", s: ["B", "E"] },
    ],
  },
  {
    id: "schedule",
    title: "2027학년도 정시 일정",
    lines: [
      { t: "원서접수: 2027년 1월 4일(월)~7일(목) 중 대학별로 3일 이상", s: ["A"] },
      { t: "전형기간: 가군 1월 11~17일, 나군 1월 18~24일, 다군 1월 25~31일", s: ["A"] },
      { t: "합격자 발표 2월 5일까지, 등록 2월 10~12일, 미등록 충원 합격통보 마감 2월 13~17일, 충원 등록 마감 2월 18일 22시", s: ["A"] },
      { t: "대학마다 실제 접수 일정이 다르므로 지원 대학의 모집요강을 꼭 확인하세요.", s: ["A"] },
    ],
  },
  {
    id: "cuts",
    title: "50%컷·70%컷 읽는 법",
    lines: [
      { t: "50%컷·70%컷은 최종등록자를 성적순으로 세웠을 때 위에서 50%, 70% 등수에 해당하는 학생의 점수입니다. 등록자가 10명이면 5번째·7번째 학생의 점수입니다.", s: ["C"] },
      { t: "등수가 소수로 나오면 버리는 대학이 많지만(예: 12명의 70%는 8.4 → 8번째), 처리 방식은 대학마다 다를 수 있습니다.", s: ["C"] },
      { t: "평균도 합격 최저점도 아닙니다. 70%컷보다 낮은 점수로 등록한 학생도 있다는 뜻입니다.", s: ["C"] },
      { t: "대학 발표 자료는 '최종합격자(최초+충원) 성적'과 '최종등록자 성적'을 구분하기도 합니다. 정시터치 입시결과 표의 컷은 최종등록자 기준입니다.", s: ["C"] },
      { t: "대학 환산점수는 대학마다 만점과 반영 방식이 달라, 대학끼리 컷 숫자를 직접 비교하지 않습니다." },
    ],
  },
  {
    id: "waitlist",
    title: "충원(추가합격)과 예비번호",
    lines: [
      { t: "최초 합격자가 등록하지 않으면, 대학이 예비 순위에 따라 추가로 합격을 통보합니다(미등록 충원). 2027학년도 정시 충원 합격통보 마감은 2월 17일, 충원 등록 마감은 2월 18일 22시입니다.", s: ["A"] },
      { t: "같은 학기에 입학하는 대학은 한 곳에만 등록할 수 있으므로, 충원 합격한 대학으로 옮기려면 먼저 등록한 대학의 등록을 포기해야 합니다. 구체적인 절차는 대학별 모집요강에 따릅니다.", s: ["B"] },
      { t: "정시터치 입시결과 표의 '최종 합격 예비번호'는 그해 마지막으로 합격한 예비 순번(번)입니다. 실제로 추가 합격한 인원(명)과는 다른 지표라, 대학이 그 인원만 발표한 경우에도 예비번호로 바꾸어 적지 않습니다." },
    ],
  },
  {
    id: "mix",
    title: "도전·핵심 검토·여유 후보 조합",
    lines: [
      { t: "정시터치 분류는 합격 확률이 아니라, 올해 공식 반영식과 판단 기준으로 본 검토 범위입니다." },
      { t: "군마다 분류가 겹치지 않게(예: 가군 도전, 나군 핵심 검토, 다군 여유 후보) 담아 보면 균형을 확인하기 쉽습니다. 담은 학교 목록이 그대로 인쇄 리포트의 '담은 학교'가 됩니다." },
    ],
  },
  {
    id: "english",
    title: "영어·한국사",
    lines: [
      { t: "2027학년도 수능에서 영어·한국사·제2외국어/한문은 원점수에 따른 고정 분할의 절대평가 등급만 성적통지표에 적힙니다.", s: ["D"] },
      { t: "한국사는 모든 수험생이 반드시 응시해야 하며, 응시하지 않으면 수능 성적 전체가 무효가 됩니다.", s: ["D"] },
      { t: "정시터치 전체 위치(국어·수학·탐구 2과목 표준점수 합)에는 영어·한국사를 넣지 않습니다. 대학별 환산에서는 대학이 정한 방식(가산·감산·비율)으로 반영됩니다." },
    ],
  },
];

export default async function Page({ searchParams }: PageProps<"/pro/guide">) {
  const sp = await searchParams;
  const orgParam = typeof sp.org === "string" ? sp.org : "";
  const orgs = await proAccess();
  const head = <PageHead kicker="전문가용" title="정시 기본 안내" desc="상담 전에 함께 확인할 공통 규칙과 용어입니다. 학생별 이유는 학생 화면의 상담 tip에 있습니다." />;
  if (!orgs || orgs.length === 0)
    return (
      <>
        {head}
        <div className="wrap pg-body"><p className="pro-note">전문가용 이용 기관의 구성원만 볼 수 있습니다.</p></div>
      </>
    );
  return (
    <>
      {head}
      <div className="wrap pg-body pro pro-guide">
        <div className="pro-sechd"><Link className="btn" href={`/pro${orgParam ? `?org=${encodeURIComponent(orgParam)}` : ""}`}>학생 목록</Link></div>
        <nav aria-label="안내 목차" className="pro-guide-toc">
          {TOPICS.map((x, i) => <a key={x.id} href={`#${x.id}`}>{i + 1}. {x.title}</a>)}
        </nav>
        {TOPICS.map((x, i) => (
          <section key={x.id} id={x.id} className="pro-sec" aria-labelledby={`${x.id}-h`}>
            <h2 id={`${x.id}-h`}>{i + 1}. {x.title}</h2>
            <ul>
              {x.lines.map((l, k) => (
                <li key={k}>
                  {l.t}
                  {l.s && <sup className="pro-guide-src">{l.s.join("·")}</sup>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section className="pro-sec" aria-labelledby="src-h">
          <h2 id="src-h">출처</h2>
          <ul className="pro-guide-srcs">
            {(Object.keys(SOURCES) as Src[]).map((k) => (
              <li key={k}>
                <b>{k}.</b> <a href={SOURCES[k].url} target="_blank" rel="noreferrer">{SOURCES[k].title}</a>
              </li>
            ))}
          </ul>
          <p className="pro-note">대학별 세부 기준은 해마다 바뀔 수 있으니 지원 전에 대학 모집요강을 다시 확인하세요. 원문 대조 2026-10-21.</p>
        </section>
      </div>
    </>
  );
}
