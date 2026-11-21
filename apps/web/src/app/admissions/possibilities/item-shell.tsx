"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookLoading } from "@/components/book-loading";
import { ChevronIcon } from "@/components/icons";
import type { Cell } from "@/components/offering-parts";
import type { OfferingDto } from "@/lib/dto";
import { enqueue } from "@/lib/client-queue";
import { loadExtras, type Extras, type P1Year } from "./extras-actions";
import { Published, Recruit, sameRelease } from "./recruit-parts";
import { P1YearsContext } from "./p1-year-cell";

/**
 * 모집단위 한 줄. 펼치기·접기는 화면에서 바로 한다(서버 왕복 없음) — 환산·누백·판단 카드(detail)는
 * 목록을 받을 때 이미 그려 두었다. 2027 모집 정보·발행 기준·학년도별 대학 발표 성적만 처음 펼칠 때 그 모집단위만 받아 채운다.
 * 주소의 ?open= 은 화면 이동 없이 바꿔(공유·새로 고침 때 같은 줄이 열림) 둔다.
 * 2026-11-21 대표님 지적: 펼친 상세는 필요한 자료가 다 모인 뒤 한 번에 보인다. 그 전에는 책 넘김 대기 화면이고,
 * '모집 인원 불러오는 중…'·'판정 근거 부족'이 먼저 보였다가 바뀌는 일이 없게 한다. 받는 요청은 한 줄로 세워 보낸다(client-queue).
 */
export function ItemShell({
  o,
  a,
  initialOpen,
  unit,
  cells,
  mmeta,
  detail,
  conds,
}: {
  o: OfferingDto;
  a: Cell;
  initialOpen: boolean;
  unit: ReactNode;
  cells: ReactNode;
  mmeta: ReactNode;
  detail: ReactNode;
  /** 지원 조건 묶음. 상세 맨 위 모집 정보 줄 안에 둔다(2026-11-22) */
  conds?: ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [extras, setExtras] = useState<Extras | null>(null); // null = 아직 받는 중
  // 1페이지 성적만 먼저(따로 fetch). undefined = 받는 중, null = 저장본 없음 → extras.p1 을 쓴다
  const [p1Fast, setP1Fast] = useState<P1Year[] | null | undefined>(undefined);
  const asked = useRef(false);
  // 처음 펼칠 때 한 번만 받는다(접었다 다시 펴도 다시 부르지 않음)
  const fetchOnce = () => {
    if (asked.current) return;
    asked.current = true;
    fetch(`/jeongsi/admissions/possibilities/p1-years?offering=${encodeURIComponent(o.offering_id)}&university=${encodeURIComponent(o.university_name)}`)
      .then((r) => (r.ok ? r.json() : { p1: null }))
      .then((b: { p1?: P1Year[] | null }) => setP1Fast(Array.isArray(b.p1) ? b.p1 : null))
      .catch(() => setP1Fast(null));
    // 정시터치 서버 조회(모집 정보·발행 기준)는 다른 펼치기·담기와 겹치지 않게 차례로 보낸다
    enqueue(() => loadExtras(o.offering_id, o.university_name))
      .then(setExtras)
      .catch(() => setExtras({ ok: false, code: "request_failed" }));
  };
  // 주소에 ?open= 이 있어 펼친 채로 들어온 경우
  useEffect(() => {
    if (initialOpen) fetchOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchOnce();
    try {
      const u = new URL(window.location.href);
      if (next) u.searchParams.set("open", o.offering_id);
      else u.searchParams.delete("open");
      window.history.replaceState(window.history.state, "", u);
    } catch {
      /* 주소 갱신 실패는 펼치기에 영향 없음 */
    }
  };

  return (
    <li id={o.offering_id} className={`item${open ? " open" : ""}`}>
      <div className="row">
        <button type="button" className="unit" onClick={toggle} aria-expanded={open}>
          {unit}
        </button>
        {cells}
        <button type="button" className="c-chev" onClick={toggle} aria-label={open ? "접기" : "자세히"} aria-expanded={open}>
          <ChevronIcon />
        </button>
        {mmeta}
      </div>
      {open && (
        <div className="detail">
          {extras === null ? (
            <BookLoading compact text={<>{o.university_name} {o.department}의 모집 정보와 지원 판단 근거를 모으고 있습니다.</>} />
          ) : (
            <>
              {/* 받지 못했으면 값이 없는 것과 같은 확정 표시(미공개)로 그린다. 문의 번호·'불러오지 못했습니다'는 보이지 않는다 */}
              <Recruit o={o} rec={extras.ok ? extras.rec : null} conds={conds} />
              {extras.ok && <Published f={extras.pub} same={sameRelease(a, extras.pub)} />}
              <P1YearsContext.Provider value={p1Fast ? p1Fast : extras.ok ? extras.p1 : null}>{detail}</P1YearsContext.Provider>
            </>
          )}
        </div>
      )}
    </li>
  );
}
