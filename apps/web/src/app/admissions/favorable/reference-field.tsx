"use client";

import { useRef, useState, useTransition, type ReactNode, type SyntheticEvent } from "react";
import { analyzeNow, type RunResult } from "@/app/analysis-actions";
import { BookLoading } from "@/components/book-loading";
import { enqueue } from "@/lib/client-queue";

const INITIAL: RunResult = { error: null };

/**
 * 3페이지 참고 목록의 계열 하나(펼치기). 서버 문턱 판정 행(dep_r15, 2026-11-21)은 판정만 있고 누백·합격선 위치·유불리가 없다.
 * 계열을 처음 펼칠 때 그 학과들(pendingIds, 최대 100개)을 4페이지처럼 내 성적으로 계산(university.analyze)하고,
 * 계산이 끝나 화면이 새 값으로 다시 그려질 때까지 책 넘김 애니메이션을 보인다. 이미 계산된 곳은 다시 계산하지 않는다(서버가 빠진 것만).
 * 계산하지 못하면 문턱 판정만으로 그린다(오류 문구는 보이지 않는다).
 */
/** reportId·reportVersion: 화면을 그린 리포트 판(3페이지는 candidates.build 응답의 판). 계산 요청이 앞 판으로 나가 409 를 받지 않게 함께 보낸다 */
export function ReferenceFieldDetails({ pendingIds, summary, label, reportId, reportVersion, children }: { pendingIds: string[]; summary: ReactNode; label: string; reportId?: string; reportVersion?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const asked = useRef(false);
  const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    const next = e.currentTarget.open;
    setOpen(next);
    if (!next || asked.current || pendingIds.length === 0) return;
    asked.current = true;
    start(async () => {
      const fd = new FormData();
      fd.set("ids", pendingIds.slice(0, 100).join(","));
      if (reportId && reportVersion) {
        fd.set("report_id", reportId);
        fd.set("report_version", String(reportVersion));
      }
      // 담기·다른 계산과 겹치지 않게 한 줄로 세워 보낸다. 성공하면 서버 액션이 화면을 새 값으로 다시 그린다
      await enqueue(() => analyzeNow(INITIAL, fd)).catch(() => INITIAL);
    });
  };
  return (
    <details className="sc-fg rf-fg" open={open} onToggle={onToggle}>
      <summary>{summary}</summary>
      {open && busy ? <BookLoading compact text={<>{label} 학과들을 내 성적으로 계산하고 있습니다.</>} /> : children}
    </details>
  );
}
