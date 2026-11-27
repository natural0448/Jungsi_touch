"use client";

import { useState, type ReactNode } from "react";
import { ChevronIcon } from "@/components/icons";
import type { Cell } from "@/components/offering-parts";
import type { OfferingDto } from "@/lib/dto";
import { ExtrasBody, useOfferingExtras } from "@/app/admissions/possibilities/offering-extras";
import "@/app/admissions/possibilities/possibilities.css";

/**
 * 2페이지 핵심 지원 학교 표의 한 줄. 학교·모집단위 이름이나 오른쪽 화살표를 누르면 바로 아래에
 * 4페이지와 같은 상세 카드(MineDetail → Detail)가 펼쳐진다(대표님 지적 2026-11-22: ship50 개편 뒤 펼침이 사라졌다).
 * 2027 모집 정보·발행 기준·학년도별 대학 발표 성적은 4페이지처럼 처음 펼칠 때 그 모집단위만 받는다(offering-extras.tsx).
 * 상세 카드는 서버가 그려 detail 로 넘긴다. 가채점(판정 준비 중)·인쇄 화면은 이 줄을 쓰지 않는다.
 */
export function PickedRow({ o, a, name, cells, detail, conds, span }: { o: OfferingDto; a: Cell; name: ReactNode; cells: ReactNode; detail: ReactNode; conds?: ReactNode; span: number }) {
  const [open, setOpen] = useState(false);
  const { extras, p1Fast, fetchOnce } = useOfferingExtras(o, false);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchOnce();
  };
  const id = `rp-d-${o.offering_id}`;
  return (
    <>
      <tr className={open ? "rp-row open" : "rp-row"}>
        <th scope="row">
          <button type="button" className="rp-unit" onClick={toggle} aria-expanded={open} aria-controls={id}>
            {name}
          </button>
        </th>
        {cells}
        <td className="rp-chev">
          <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} aria-label={open ? "접기" : "자세히"}>
            <ChevronIcon />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="rp-drow" id={id}>
          <td colSpan={span}>
            {/* 4페이지 상세 스타일(.ps .detail …)을 그대로 쓴다 */}
            <div className="ps rp-ps">
              <div className="detail">
                <ExtrasBody o={o} a={a} extras={extras} p1Fast={p1Fast} detail={detail} conds={conds} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
