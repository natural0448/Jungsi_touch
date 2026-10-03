import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
/* CSS 순서: tokens → base → 정시터치 공통 → 화면별(각 화면 폴더) */
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/jungsi.css";
import "@/styles/offering.css";
import { SiteHeader } from "@/components/site-header";
import { SyntheticBar } from "@/components/synthetic-bar";
import { getCaller, source } from "@/lib/api";

const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["800", "900"] });

export const metadata: Metadata = {
  title: { default: "정시터치 | 에듀터치", template: "%s | 정시터치" },
  description: "수능 성적이 유리하게 반영되는 대학을 찾는 에듀터치의 정시 분석 서비스",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await source().getSession(await getCaller());
  return (
    <html lang="ko" className={montserrat.variable}>
      <head>
        {/* 에듀터치와 같은 글꼴(Pretendard, OFL). 저장소에 글꼴 파일을 넣지 않으려고 공식 CDN 을 쓴다 */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body>
        <div className="et jt">
          <SyntheticBar />
          <SiteHeader session={session} />
          <main>{children}</main>
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
