"use client";

import { useRef, useState } from "react";
import { ChevronIcon } from "@/components/icons";
import type { R27Summary } from "@/lib/p1-shape";
import { YearTable } from "./snapshot-table";
import { loadUnitRows, type UnitRows } from "./unit-actions";

/** 접힌 줄에는 2027학년도 모집인원만 보인다(2026-10-24 사용자 결정). 2027 모집행이 없으면 r27 = null → '준비 중' */
export type SumItem = { k: string; g: string | null; d: string; sub: string; r27: R27Summary | null; ratio27: string | null };
/* ratio27: 2027 수능 영역별 반영비율 한 줄(예: "국 30 · 수 40 · 영 20 · 탐 10"). 담당자 자료 연결 전에는 null 이라 칸을 그리지 않는다 */

/** 2027 모집 칸(11-02 사용자 확인 문구). 이월 미정은 0 이 아니라 '이월 시 선발', 모르는 상태는 '확인 중' */
function V({ c }: { c: R27Summary }) {
  if (c.hold) return <span className="unpub" title="2027학년도 모집인원을 모집요강 원문과 대조하고 있습니다">확인 중</span>;
  if (c.v === null) return <b title={c.note ?? undefined}>이월 시 선발</b>;
  return (
    <span title={c.note ?? undefined}>
      <b className="num">{c.v}</b>
      <small>명</small>
      {c.carry && <b> + 이월</b>}
      {c.initial && <small> 최초</small>}
      {c.stageUnknown && <small> 단계 확인 중</small>}
      {c.check && <i className="q" title="값은 모집요강 그대로이고 단위·기준일 확인이 남았습니다">확인</i>}
    </span>
  );
}

/**
 * 한 학교의 모집단위 목록. 처음에는 요약 줄만 그리고, 줄을 누르면 그 자리에서 학년도별 고정 표를 펼친다.
 * 표는 화면 서버의 정리본 저장본에서 그 모집단위만 받는다(처음 펼칠 때 한 번)
 */
export function UnitList({ pub, schoolId, schoolName, items }: { pub: string; schoolId: string; schoolName: string; items: SumItem[] }) {
  return (
    <ul>
      {items.map((it) => (
        <Item key={it.k} pub={pub} schoolId={schoolId} schoolName={schoolName} it={it} />
      ))}
    </ul>
  );
}

function Item({ pub, schoolId, schoolName, it }: { pub: string; schoolId: string; schoolName: string; it: SumItem }) {
  const [open, setOpen] = useState(false);
  const [got, setGot] = useState<UnitRows | null>(null);
  const asked = useRef(false);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !asked.current) {
      asked.current = true;
      loadUnitRows(pub, schoolId, it.k)
        .then(setGot)
        .catch(() => setGot({ ok: false, code: "request_failed" }));
    }
    if (!next && got && !got.ok) {
      asked.current = false; // 실패했으면 다시 펼칠 때 다시 받는다
      setGot(null);
    }
  };
  return (
    <li className={`rs-off${open ? " open" : ""}`}>
      <button type="button" className="rs-offhd rs-btn" onClick={toggle} aria-expanded={open}>
        <span className="grp">{it.g ?? "─"}</span>
        <span className="unit">
          <b>{it.d}</b>
          {it.sub && <small>{it.sub}</small>}
        </span>
        {it.ratio27 && <span className="rs-ratio" title="2027학년도 수능 영역별 반영비율">{it.ratio27}</span>}
        <span className="rs-sum">
          <span className="y num">2027</span>
          <span>
            <small>모집</small> {it.r27 ? <V c={it.r27} /> : <span className="unpub" title="2027학년도 모집인원 자료를 연결하고 있습니다">준비 중</span>}
          </span>
        </span>
        <span className="go"><ChevronIcon /></span>
      </button>
      {open && it.r27?.note && <p className="rs-idnote">2027 모집: {it.r27.note}</p>}
      {open &&
        (got === null ? (
          <p className="rs-wait">학년도별 결과를 불러오는 중…</p>
        ) : got.ok ? (
          <YearTable rows={got.rows} schoolName={schoolName} />
        ) : (
          <p className="rs-wait">
            {got.code === "publication_changed" ? "입시결과 정리본이 새 판으로 바뀌었습니다. 화면을 새로 고쳐 주세요." : `불러오지 못했습니다(사유 코드 ${got.code}). 접었다가 다시 펼쳐 보세요.`}
          </p>
        ))}
    </li>
  );
}
