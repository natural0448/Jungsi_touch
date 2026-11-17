"use client";

import { Suspense, use, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronIcon } from "@/components/icons";
import type { Cell } from "@/components/offering-parts";
import type { OfferingDto } from "@/lib/dto";
import { loadExtras, type Extras, type P1Year } from "./extras-actions";
import { Published, Recruit, sameRelease } from "./recruit-parts";
import { P1YearsContext } from "./p1-year-cell";

/**
 * 모집단위 한 줄. 펼치기·접기는 화면에서 바로 한다(서버 왕복 없음) — 환산·누백·판단 카드(detail)는
 * 목록을 받을 때 이미 그려 두었다. 2027 모집 정보·발행 기준만 처음 펼칠 때 그 모집단위만 받아 채운다.
 * 주소의 ?open= 은 화면 이동 없이 바꿔(공유·새로 고침 때 같은 줄이 열림) 둔다.
 * 내 분석(a)은 목록보다 늦게 올 수 있어 약속(aP)으로 받는다. 줄·카드 틀은 먼저 보이고(2026-11-10 나눠 그리기),
 * 내 칸(cells)·판단 카드(detail)는 서버에서 각자 Suspense 경계로 채워 온다.
 */
export function ItemShell({
  o,
  aP,
  initialOpen,
  unit,
  cells,
  mmeta,
  detail,
}: {
  o: OfferingDto;
  aP: Promise<Cell>;
  initialOpen: boolean;
  unit: ReactNode;
  cells: ReactNode;
  mmeta: ReactNode;
  detail: ReactNode;
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
    loadExtras(o.offering_id, o.university_name)
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
            <div className="recruit">
              <span>2027 모집군<b>{o.group}군</b></span>
              <span>모집 인원<b><span className="wait">불러오는 중…</span></b></span>
            </div>
          ) : extras.ok ? (
            <>
              <Recruit o={o} rec={extras.rec} />
              {/* 발행 기준이 내 판단과 같은 판인지는 내 분석이 온 뒤에 적는다(오기 전에는 비워 둔다) */}
              <Suspense fallback={null}>
                <PublishedFor aP={aP} f={extras.pub} />
              </Suspense>
            </>
          ) : (
            <div className="recruit">
              <span>2027 모집군<b>{o.group}군</b></span>
              <span>모집 인원<b><span className="wait">불러오지 못했습니다(문의 번호 {extras.code})</span></b></span>
            </div>
          )}
          <P1YearsContext.Provider value={p1Fast ? p1Fast : extras === null ? undefined : extras.ok ? extras.p1 : null}>{detail}</P1YearsContext.Provider>
        </div>
      )}
    </li>
  );
}

function PublishedFor({ aP, f }: { aP: Promise<Cell>; f: Parameters<typeof Published>[0]["f"] }) {
  const a = use(aP);
  return <Published f={f} same={sameRelease(a, f)} />;
}
