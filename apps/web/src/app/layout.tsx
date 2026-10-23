import type { Metadata } from "next";
import { CRAWL_ROBOTS } from "@/lib/crawl-policy";
import { Montserrat } from "next/font/google";
/* CSS 순서: tokens → base → 정시터치 공통 → 화면별(각 화면 폴더) */
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/jungsi.css";
import "@/styles/offering.css";
import { SiteHeader } from "@/components/site-header";
import { SyntheticBar } from "@/components/synthetic-bar";
import { LocalBar } from "@/components/local-bar";
import { ConnectionNotice } from "@/components/connection-notice";
import { ConnectionError, getCaller, source } from "@/lib/api";
import type { Session } from "@/lib/dto";

const PRETENDARD_CSS = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
const PRETENDARD_LOADER = `(function(){var l=document.createElement("link");l.rel="stylesheet";l.href="${PRETENDARD_CSS}";document.head.appendChild(l)})()`;

const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["800", "900"] });

// 모든 화면이 회원 개인 응답이라 요청마다 그린다(미리 만들어 공유하지 않는다)
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: CRAWL_ROBOTS,
  title: { default: "정시터치 | 에듀터치", template: "%s | 정시터치" },
  description: "수능 성적이 유리하게 반영되는 대학을 찾는 에듀터치의 정시 분석 서비스",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 로그인 상태를 못 읽으면(설정 없음·503) 화면 전체를 연결 대기로 둔다. 일반 회원으로 낮춰 보이지 않는다
  let session: Session | null = null;
  let down: ConnectionError | null = null;
  try {
    session = await source().getSession(await getCaller());
  } catch (e) {
    if (!(e instanceof ConnectionError)) throw e;
    down = e;
  }
  return (
    <html lang="ko" className={montserrat.variable}>
      <head>
        {/* 에듀터치와 같은 글꼴(Pretendard, OFL). 저장소에 글꼴 파일을 넣지 않으려고 공식 CDN 을 쓴다.
            <link> 로 직접 걸면 CDN 이 느릴 때 화면 전체가 그 응답을 기다리므로, 스크립트로 붙여 기다리지 않게 한다.
            글꼴이 늦거나 실패하면 --font-kr 의 시스템 글꼴(Apple SD Gothic Neo·Malgun Gothic)로 보인다 */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <script dangerouslySetInnerHTML={{ __html: PRETENDARD_LOADER }} />
      </head>
      <body>
        <div className="et jt">
          <SyntheticBar />
          <LocalBar />
          <SiteHeader session={session} down={Boolean(down)} />
          <main>{down ? <ConnectionNotice e={down} /> : children}</main>
          <footer className="jt-foot">
            <div className="wrap">
              <p>지원가능성은 합격 확률이 아닙니다. 대학마다 만점과 반영 방식이 달라 다른 대학의 환산점수와 크기를 비교할 수 없습니다.</p>
              <p>검색 범위는 서비스 대상 정시 모집단위 전체이며 실기 반영 전형은 제외합니다. 미공개 인원·입결은 0이 아니라 미공개로 표시합니다.</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
