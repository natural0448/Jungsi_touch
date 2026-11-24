/*
  1페이지 펼친 표의 추정 2열(snapshot-table.tsx). 발표 칸은 덮지 않고 이 두 칸만 계산한다.
  추정 총 지원자 = 모집인원×경쟁률 반올림(2026-10-22 사용자 확인, 경쟁률은 보이는 둘째 자리 값),
  추정 탈락자 = 추정 총 지원자 − (모집인원 + 충원인원)(실제 충원 인원이 발표된 경우).
*/
import { ratioText } from "./format";
import { ADIGA_FILL_STATUS } from "./p1-adiga-fill";
import { rankDisplayModel } from "./p1-field-qualification";
import type { Cell, Row } from "./p1-shape";

/* 추정 2열 재료: 십진 문법을 직접 검사한다(Number("") → 0 같은 변환을 쓰지 않는다) */
const personInt = (c: Cell): number | null => {
  if (c.v === null || c.u !== "명") return null;
  const s = c.v.trim();
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
};
const ratioOf = (c: Cell): { n: number; s: number } | null => {
  if (c.v === null) return null;
  if (c.u !== null && !c.u.includes("대")) return null;
  // 화면에 보이는 반올림 값(둘째 자리)으로 계산해 표의 경쟁률과 추정 총 지원자가 서로 맞게 한다
  const t = /^(\d+)(?:\.(\d+))?$/.exec(ratioText(c.v.trim()));
  if (!t) return null;
  const frac = t[2] ?? "";
  if ((t[1] + frac).length > 10) return null;
  return { n: Number(t[1] + frac), s: 10 ** frac.length };
};
const integerOf = (value: string | null): number | null => {
  const match = /^(\d{1,9})(?:\.0+)?$/.exec(value?.trim() ?? "");
  return match ? Number(match[1]) : null;
};

/** 충원 인원은 검증된 인원 관측값에서만 읽는다. */
export function fillCount(r: Pick<Row, "ad">): number | null {
  const cell = r.ad;
  if (cell.u !== "명") return null;
  if (cell.s !== "verified_official" && !(cell.s === ADIGA_FILL_STATUS && cell.l === "충원인원")) return null;
  return integerOf(cell.v);
}

/** 최종 예비번호는 충원 발표 열에 순번으로 표시한다. */
function displayedRank(c: Cell): number | null {
  let cell: Cell;
  try { cell = rankDisplayModel(c).cell; } catch { return null; }
  return cell.u === "번" ? integerOf(cell.v) : null;
}

/* 추정 탈락자는 발표된 실제 충원 인원이 있는 행에만 계산한다. */
export function derived(r: Row): { applicants: number | null; dropped: number | null; fill: number | null; rank: number | null; heldA: boolean; heldD: boolean } {
  const cap = personInt(r.rc);
  const rank = displayedRank(r.rk);
  const ratio = ratioOf(r.cr);
  const fill = fillCount(r);
  const isHeld = (c: Cell) => c.s !== "verified_official" && c.s.startsWith("pending");
  if (cap === null || ratio === null || cap >= 1e5) return { applicants: null, dropped: null, fill, rank, heldA: false, heldD: false };
  // half-up(Q×R)을 정수 분수로: floor((2QR + s) / 2s)
  const applicants = Math.floor((2 * cap * ratio.n + ratio.s) / (2 * ratio.s));
  const heldA = isHeld(r.rc) || isHeld(r.cr);
  if (fill === null) return { applicants, dropped: null, fill, rank, heldA, heldD: false };
  const d = applicants - (cap + fill);
  return { applicants, dropped: d >= 0 ? d : null, fill, rank, heldA, heldD: heldA };
}

