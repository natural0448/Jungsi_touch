import { ConnectionNotice } from "@/components/connection-notice";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "@/components/link";
import { PaidGate } from "@/components/paid-gate";
import { PageHead } from "@/components/page-head";
import { BookLoading } from "@/components/book-loading";
import { getCaller, sessionOrDown, source } from "@/lib/api";
import { memberName } from "@/lib/member-name";
import { lockFor, page } from "@/lib/routes";
import { CatalogBrowse } from "./catalog-browse";

const route = page("PAGE-03");
const FEATURES = ["추천에 없는 대학·학과까지 직접 검색", "모집단위마다 내 환산점수 · 지원가능성 · 환산 유불리", "마음에 드는 곳을 핵심 지원 학교에 담아 리포트로 정리"];
export const metadata: Metadata = { title: route.label };

export default async function Page({ searchParams }: PageProps<"/admissions/possibilities">) {
  const head = (
    <PageHead
      kicker={`PAGE ${route.number} · 유료`}
      title={route.label}
      desc="보고 싶은 대학과 학과를 직접 검색하고, 모집단위마다 내 환산점수 · 지원가능성 · 환산 유불리를 따로 확인하세요."
      side={<Link prefetch={false} className="btn" href={page("PAGE-04").path}>유리한 대학 추천 다시 보기</Link>}
    />
  );

  const caller = await getCaller();
  const src = source();
  const naming = memberName(); // 대기 화면 문구용. 서비스 API 와 별개 조회라 함께 보낸다
  const { session, down } = await sessionOrDown(src, caller);
  if (down) return <>{head}<ConnectionNotice e={down} /></>;
  // 화면 표시용 잠금. 서버가 검색을 403 으로 막아도 아래 catch 가 같은 안내를 그린다
  const lock = lockFor(session, route);
  if (lock) return <>{head}<PaidGate kind={lock} route={route} features={FEATURES} /></>;

  const sp = await searchParams;
  const name = await naming;
  // 머리글은 바로 보이고, 검색과 내 분석을 기다리는 본문 자리에는 책 넘김 대기 화면을 둔다(2026-11-18 대표님 요청)
  return (
    <>
      {head}
      <Suspense fallback={<BookLoading name={name} kind="possibilities" />}>
        <CatalogBrowse src={src} caller={caller} sp={sp} route={route} features={FEATURES} />
      </Suspense>
    </>
  );
}
