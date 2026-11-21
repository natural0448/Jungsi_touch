"use client";

import { useState, type ReactNode } from "react";
import { ChevronIcon } from "@/components/icons";
import type { Cell } from "@/components/offering-parts";
import type { OfferingDto } from "@/lib/dto";
import { ExtrasBody, useOfferingExtras } from "./offering-extras";

/**
 * 모집단위 한 줄. 펼치기·접기는 화면에서 바로 한다(서버 왕복 없음) — 환산·누백·판단 카드(detail)는
 * 목록을 받을 때 이미 그려 두었다. 2027 모집 정보·발행 기준·학년도별 대학 발표 성적만 처음 펼칠 때 그 모집단위만 받아 채운다.
 * 주소의 ?open= 은 화면 이동 없이 바꿔(공유·새로 고침 때 같은 줄이 열림) 둔다.
 * 2026-11-21 대표님 지적: 펼친 상세는 필요한 자료가 다 모인 뒤 한 번에 보인다. 그 전에는 책 넘김 대기 화면이고,
 * '모집 인원 불러오는 중…'·'판정 근거 부족'이 먼저 보였다가 바뀌는 일이 없게 한다. 받는 요청은 한 줄로 세워 보낸다(client-queue).
 * 받기·그리기는 2페이지 핵심 지원 학교 표와 함께 쓴다(offering-extras.tsx)
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
  const { extras, p1Fast, fetchOnce } = useOfferingExtras(o, initialOpen);

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
          <ExtrasBody o={o} a={a} extras={extras} p1Fast={p1Fast} detail={detail} conds={conds} />
        </div>
      )}
    </li>
  );
}
