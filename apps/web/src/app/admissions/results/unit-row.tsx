"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronIcon } from "@/components/icons";
import type { R27Summary } from "@/lib/p1-shape";
import { YearTable } from "./snapshot-table";
import { loadSchoolRows, type UnitRows } from "./unit-actions";

/** 접힌 줄에는 2027 모집인원 또는 별도 과거 발표 결과 여부를 보인다. */
export type SumItem = { k: string; g: string | null; d: string; sub: string; r27: R27Summary | null; ratio27: string | null; eligibility27?: string | null };
/* ratio27: 2027 수능 영역별 반영비율 한 줄(예: "국 30 · 수 40 · 영 20 · 탐 10"). 담당자 자료 연결 전에는 null 이라 칸을 그리지 않는다 */

/**
 * 2027 모집 칸(11-02 사용자 확인 문구). 이월 미정은 0 이 아니라 '이월 시 선발', 모르는 상태는 '인원 확인 중'.
 * 값 옆 꼬리표('최초'·'단계 확인 중'·'확인')는 붙이지 않는다(2026-11-04 사용자 결정: 1페이지 '확인 중' 꼬리표 전부 제거).
 * 단계·출처 상태(initial·stageUnknown·check)는 자료에 그대로 있고 화면만 그리지 않는다.
 */
function V({ c }: { c: R27Summary }) {
  if (c.hold) return <span className="unpub" title="2027학년도 모집인원을 모집요강 원문과 대조하고 있습니다">인원 확인 중</span>;
  if (c.v === null) return <b title={c.note ?? undefined}>이월 시 선발</b>;
  return (
    <span title={c.note ?? undefined}>
      <b className="num">{c.v}</b>
      <small>명</small>
      {c.carry && <b> + 이월</b>}
    </span>
  );
}

/*
 * 한 학교의 학년도별 행을 학교 단위로 한 번만 받는다(11-07 사용자 요청: 펼침이 늦다).
 * - 전에는 줄마다 요청해 펼칠 때마다 회원 확인 왕복(실측 0.65~0.85초)이 들었다.
 * - 일반 회원은 서버 동시 처리 한도가 1이라, 앞 요청이 끝나기 전에 다른 줄을 누르면 429 로 거절되고
 *   화면 서버가 3초 뒤 다시 보냈다(lib/api/live.ts). '가끔 한참 늦게 뜨는' 경우가 이것이다.
 * 그래서 이 탭의 요청은 한 줄로 세워 하나씩 보내고, 같은 학교는 한 번만 받는다.
 * 미리 받기는 사람이 줄에 마우스를 0.25초 이상 올리거나 키보드로 골랐을 때만 한다. 화면에 보이기만 한 학교는 받지 않는다
 * (누르지 않은 요청이 동시 처리 한도를 차지하지 않게, components/link.tsx 참고).
 */
type SchoolLoader = { get: () => Promise<Record<string, UnitRows>>; reset: () => void };
let lane: Promise<unknown> = Promise.resolve();
function inLane<T>(run: () => Promise<T>): Promise<T> {
  const p = lane.then(run, run);
  lane = p.catch(() => undefined);
  return p;
}
function schoolLoader(pub: string, schoolId: string, keys: string[]): SchoolLoader {
  let pending: Promise<Record<string, UnitRows>> | null = null;
  const all = (v: UnitRows) => Object.fromEntries(keys.map((k) => [k, v]));
  return {
    get: () =>
      (pending ??= inLane(() => loadSchoolRows(pub, schoolId, keys)).then(
        (res) => {
          if (res.ok) return Object.fromEntries(keys.map((k) => [k, { ok: true, rows: res.units[k] ?? [] } as UnitRows]));
          pending = null; // 실패는 담아 두지 않는다. 다시 펼치면 다시 받는다
          return all({ ok: false, code: res.code });
        },
        () => { pending = null; return all({ ok: false, code: "request_failed" }); },
      )),
    reset: () => { pending = null; },
  };
}

/**
 * 한 학교의 모집단위 목록. 처음에는 요약 줄만 그리고, 줄을 누르면 그 자리에서 학년도별 고정 표를 펼친다.
 * 표는 화면 서버의 정리본 저장본에서 학교 단위로 한 번 받는다(같은 학교의 다른 줄은 바로 펼침)
 */
export function UnitList({ pub, schoolId, schoolName, items }: { pub: string; schoolId: string; schoolName: string; items: SumItem[] }) {
  const keys = items.map((it) => it.k).join("\n");
  const loader = useMemo(() => schoolLoader(pub, schoolId, keys.split("\n")), [pub, schoolId, keys]);
  return (
    <ul>
      {items.map((it) => (
        <Item key={it.k} loader={loader} schoolName={schoolName} it={it} />
      ))}
    </ul>
  );
}

function Item({ loader, schoolName, it }: { loader: SchoolLoader; schoolName: string; it: SumItem }) {
  const [open, setOpen] = useState(false);
  const [got, setGot] = useState<UnitRows | null>(null);
  const asked = useRef(false);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !asked.current) {
      asked.current = true;
      loader.get().then((all) => setGot(all[it.k] ?? { ok: false, code: "request_failed" }));
    }
    if (!next && got && !got.ok) {
      asked.current = false; // 실패했으면 다시 펼칠 때 다시 받는다
      loader.reset();
      setGot(null);
    }
  };
  /** 누르기 직전(마우스를 0.25초 올림·키보드 선택)에 미리 받기 시작한다. 사람이 고른 줄에서만, 학교당 한 번 */
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warm = () => { if (!asked.current) void loader.get(); };
  const hoverStart = () => { if (hover.current === null) hover.current = setTimeout(() => { hover.current = null; warm(); }, 250); };
  const hoverEnd = () => { if (hover.current !== null) { clearTimeout(hover.current); hover.current = null; } };
  return (
    <li className={`rs-off${open ? " open" : ""}`}>
      <button type="button" className="rs-offhd rs-btn" onClick={toggle} onPointerEnter={hoverStart} onPointerLeave={hoverEnd} onFocus={warm} aria-expanded={open}>
        <span className="grp">{it.g ?? "─"}</span>
        <span className="unit">
          <b>{it.d}</b>
          {it.sub && <small>{it.sub}</small>}
          {it.eligibility27 && <small>지원 자격: {it.eligibility27}</small>}
        </span>
        {it.ratio27 && <span className="rs-ratio" title="2027학년도 수능 영역별 반영비율">{it.ratio27}</span>}
        <span className="rs-sum">
          {it.r27 ? <><span className="y num">2027</span><span><small>모집</small> <V c={it.r27} /></span></>
            : <span>과거 발표 결과</span>}
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
            {got.code === "publication_changed" ? "입시결과 자료가 새로 바뀌었습니다. 화면을 새로 고쳐 주세요." : `불러오지 못했습니다(문의 번호 ${got.code}). 접었다가 다시 펼쳐 보세요.`}
          </p>
        ))}
    </li>
  );
}
