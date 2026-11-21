"use client";

import { createContext, useContext } from "react";
import type { P1Year } from "./extras-actions";

/** 펼친 모집단위의 1페이지 학년도별 성적. undefined = 받는 중, null = 받지 못함 */
export const P1YearsContext = createContext<P1Year[] | null | undefined>(undefined);

/** 연도별 근거의 '대학 발표 입시결과' 칸: 1페이지와 같은 ①② 성적(2026-11-17 대표님 결정 1-가) */
export function P1YearCell({ year }: { year: number }) {
  const all = useContext(P1YearsContext);
  if (all === undefined) return <span className="na">불러오는 중…</span>;
  const stats = (all ?? []).filter((y) => y.year === year).flatMap((y) => y.stats);
  if (stats.length === 0) return <span className="na">자료 없음</span>;
  return (
    <>
      {stats.map((s, i) => (
        <span key={i} className="m">
          {s.label} <b className="num">{s.value}{s.unit ?? ""}</b>
        </span>
      ))}
    </>
  );
}
