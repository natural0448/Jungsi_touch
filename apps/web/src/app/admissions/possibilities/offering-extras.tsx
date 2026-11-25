"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookLoading } from "@/components/book-loading";
import type { Cell } from "@/components/offering-parts";
import type { OfferingDto } from "@/lib/dto";
import { enqueue } from "@/lib/client-queue";
import { loadExtras, type Extras, type P1Year } from "./extras-actions";
import { loadProExtras } from "@/app/pro/p4-actions";
import { useProScope } from "@/components/pro-scope";
import { Published, Recruit, sameRelease } from "./recruit-parts";
import { P1YearsContext } from "./p1-year-cell";

/**
 * 펼친 모집단위 상세의 '처음 펼칠 때 받는 자료'(2027 모집 정보·발행 기준·학년도별 대학 발표 성적).
 * 4페이지 목록(item-shell.tsx)과 2페이지 핵심 지원 학교 표(reports/me/picked-row.tsx)가 같은 받기·같은 그리기를 쓴다.
 * 처음 펼칠 때 한 번만 받는다(접었다 다시 펴도 다시 부르지 않음).
 */
export function useOfferingExtras(o: OfferingDto, initialOpen: boolean) {
  const [extras, setExtras] = useState<Extras | null>(null); // null = 아직 받는 중
  // 1페이지 성적만 먼저(따로 fetch). undefined = 받는 중, null = 저장본 없음 → extras.p1 을 쓴다
  const [p1Fast, setP1Fast] = useState<P1Year[] | null | undefined>(undefined);
  const asked = useRef(false);
  // 전문가용 학생 화면에서는 같은 자료를 학생 쪽 권한 없이 읽는다(선생님 계정은 개인용 모집 정보 조회 권한이 없을 수 있다)
  const pro = useProScope();
  const load = pro ? loadProExtras : loadExtras;
  const fetchOnce = () => {
    if (asked.current) return;
    asked.current = true;
    fetch(`/jeongsi/admissions/possibilities/p1-years?offering=${encodeURIComponent(o.offering_id)}&university=${encodeURIComponent(o.university_name)}`)
      .then((r) => (r.ok ? r.json() : { p1: null }))
      .then((b: { p1?: P1Year[] | null }) => setP1Fast(Array.isArray(b.p1) ? b.p1 : null))
      .catch(() => setP1Fast(null));
    // 정시터치 서버 조회(모집 정보·발행 기준)는 다른 펼치기·담기와 겹치지 않게 차례로 보낸다
    enqueue(() => load(o.offering_id, o.university_name))
      .then(setExtras)
      .catch(() => setExtras({ ok: false, code: "request_failed" }));
  };
  // 주소에 ?open= 이 있어 펼친 채로 들어온 경우
  useEffect(() => {
    if (initialOpen) fetchOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { extras, p1Fast, fetchOnce };
}

/**
 * 2026-11-21 대표님 지적: 펼친 상세는 필요한 자료가 다 모인 뒤 한 번에 보인다. 그 전에는 책 넘김 대기 화면이고,
 * '모집 인원 불러오는 중…'·'판정 근거 부족'이 먼저 보였다가 바뀌는 일이 없게 한다.
 */
export function ExtrasBody({ o, a, extras, p1Fast, detail, conds }: { o: OfferingDto; a: Cell; extras: Extras | null; p1Fast: P1Year[] | null | undefined; detail: ReactNode; conds?: ReactNode }) {
  if (extras === null) return <BookLoading compact text={<>{o.university_name} {o.department}의 모집 정보와 지원 판단 근거를 모으고 있습니다.</>} />;
  return (
    <>
      {/* 받지 못했으면 값이 없는 것과 같은 확정 표시(미공개)로 그린다. 문의 번호·'불러오지 못했습니다'는 보이지 않는다 */}
      <Recruit o={o} rec={extras.ok ? extras.rec : null} conds={conds} q27={extras.ok ? extras.q27 ?? null : null} />
      {extras.ok && <Published f={extras.pub} same={sameRelease(a, extras.pub)} />}
      <P1YearsContext.Provider value={p1Fast ? p1Fast : extras.ok ? extras.p1 : null}>{detail}</P1YearsContext.Provider>
    </>
  );
}
