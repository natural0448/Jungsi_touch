/*
  1페이지 펼친 표의 추정 2열(snapshot-table.tsx). 발표 칸은 덮지 않고 이 두 칸만 계산한다.
  추정 총 지원자 = 모집인원×경쟁률 반올림(2026-10-22 사용자 확인, 경쟁률은 보이는 둘째 자리 값),
  추정 탈락자 = 추정 총 지원자 − (모집인원 + 충원인원)(2026-11-16 대표님 결정: 최종 합격 예비번호 = 충원인원, 한 열).
*/
import { ratioText } from "./format";
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
/* 표에 보이는 예비번호(자격 확인을 거친 값 포함)와 같은 기준의 정수. 값·단위가 맞지 않으면 계산하지 않는다 */
const rankInt = (c: Cell): { n: number; cell: Cell } | null => {
  let cell: Cell;
  try { cell = rankDisplayModel(c).cell; } catch { return null; }
  if (cell.v === null || cell.u !== "번") return null;
  const s = cell.v.trim();
  return /^\d{1,9}$/.test(s) ? { n: Number(s), cell } : null;
};
/**
 * 충원인원(2026-11-16 대표님 결정): 최종 합격 예비번호와 충원인원은 같은 것으로 보고 한 열에 숫자로 넣는다.
 * 원문 명칭이 달라도 정수면 쓴다. 예비번호(서비스 자격 확인 포함)가 있으면 그것을, 없으면 충원인원 원문값을 쓴다.
 */
export function fillCount(r: Pick<Row, "rk" | "ad">): number | null {
  const rank = rankInt(r.rk);
  if (rank) return rank.n;
  for (const c of [r.rk, r.ad]) {
    const s = c?.v?.trim() ?? "";
    if (/^\d{1,9}$/.test(s)) return Number(s);
  }
  return null;
}
/* 추정 총 지원자 = 모집인원×경쟁률(2026-10-22 사용자 확인), 추정 탈락자 = 그 값 − (모집인원 + 충원인원)(2026-11-16 대표님 결정) */
export function derived(r: Row): { applicants: number | null; dropped: number | null; fill: number | null; heldA: boolean; heldD: boolean } {
  const cap = personInt(r.rc);
  const rankCell = rankInt(r.rk)?.cell ?? null;
  const fill = fillCount(r);
  const ratio = ratioOf(r.cr);
  const isHeld = (c: Cell) => c.s !== "verified_official" && c.s.startsWith("pending");
  if (cap === null || ratio === null || cap >= 1e5) return { applicants: null, dropped: null, fill, heldA: false, heldD: false };
  // half-up(Q×R)을 정수 분수로: floor((2QR + s) / 2s)
  const applicants = Math.floor((2 * cap * ratio.n + ratio.s) / (2 * ratio.s));
  const heldA = isHeld(r.rc) || isHeld(r.cr);
  if (fill === null) return { applicants, dropped: null, fill, heldA, heldD: false };
  const d = applicants - (cap + fill);
  return { applicants, dropped: d >= 0 ? d : null, fill, heldA, heldD: heldA || (rankCell !== null && isHeld(rankCell)) };
}

