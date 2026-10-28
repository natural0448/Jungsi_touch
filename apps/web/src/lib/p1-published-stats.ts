import type { Cell, Row } from "./p1-shape";

/*
  1페이지 학년도 표의 '대학 발표 성적 ①·②' 두 칸(2026-10-28 사용자 결정).
  대학마다 발표 통계가 달라(50·70%컷, 평균·75%컷 등) 한 학년도 행에서 두 개만 골라 보인다. 열은 새로 만들지 않는다.
  - 대상: 최종등록자(입학자·최종입학생 등 같은 뜻) → 최초합격자 → 그 밖(최종합격자 등) 순으로 한 집단만 쓴다. 대상은 화면에 쓰지 않는다
  - 기준: 같은 집단 안에서 대학 환산점수를 먼저 쓰고, 두 값은 같은 기준끼리만 짝짓는다
  - 칸 자리는 통계마다 고정(2026-10-28 사용자 정정): ① 칸은 50%컷 자리, ② 칸은 70%컷 자리.
    ① 50%컷 → 평균
    ② 70%컷 → 다른 %컷(작은 비율부터) → 평균(① 이 50%컷일 때) → 최저 → 최고
    70%컷만 있으면 ①은 비우고 ②에 둔다. 학년도마다 같은 통계가 같은 칸에 서도록 하기 위해서다
  - 이름: '85% 컷'·'85%cut'·'85_percent_cut' 은 학교 표기 차이일 뿐이라 모두 '85%컷'. 최상위·최대 → 최고, 최하위 → 최저
  - 숨김(담당자 확인 대기): 영어 mean·best·worst, 뜻이 애매한 이름(상위80% 집단 평균 등), 기준 '대학 발표 성적 · 기준 확인 중'
  자료(c50·c70·alt)는 그대로 두고 고르기만 한다. 값을 만들거나 다른 집단·기준의 값을 섞지 않는다.
*/

export type PublishedStat = { label: string; cell: Cell; schoolRecord: boolean };

const UNKNOWN_BASIS = "대학 발표 성적 · 기준 확인 중";
const BASIS_ORDER = [
  "대학 환산점수", "대학 반영 백분위", "대학 가중 백분위", "발표 영역 백분위 평균", "발표 선택영역 백분위 평균",
  "대학 수능 성분 점수", "대학 전형 총점", "대학 발표 총점", "발표 영역 평균등급", "발표 수능 평균등급", "학생부 등급",
];
const NAMED: Record<string, string> = { 평균: "평균", 최저: "최저", 최하위: "최저", 최고: "최고", 최상위: "최고", 최대: "최고", 최고점: "최고" };

/** 통계 이름을 화면 표기로 맞춘다. 모르는 이름(영어 mean 등)은 null → 보이지 않는다 */
export function statName(label: string | null): string | null {
  if (label === null) return null;
  const s = label.replace(/\s+/g, "");
  const m = /^(\d{1,3})(?:%컷|%cut|_percent_cut|%)$/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 100 ? `${n}%컷` : null;
  }
  return NAMED[s] ?? null;
}

/** 대상 집단 순위: 1 최종등록자 계열, 2 최초합격자, 3 그 밖·미명시 */
export function cohortTier(c: Cell): number {
  const t = `${c.co ?? ""} ${c.cc ?? ""}`.replace(/\s+/g, "");
  if (/final_registrant|최종등록|최종입학|입학자|입학생|등록생|최종합격\(등록\)자/.test(t)) return 1;
  if (/^최초합격|initial_admit/.test(t)) return 2;
  return 3;
}

const basisRank = (b: string | null | undefined) => {
  const i = BASIS_ORDER.indexOf(b ?? "");
  return i < 0 ? BASIS_ORDER.length : i;
};
/** ② 칸 우선순위: 70%컷 → 다른 %컷(작은 비율부터) → 평균 → 최저 → 최고. 평균은 ① 이 50%컷일 때만 온다 */
const secondRank = (name: string) => {
  if (name === "70%컷") return 0;
  if (name.endsWith("%컷")) return 1 + Number(name.slice(0, -2)) / 1000;
  return SECOND_NAMED[name] ?? 9;
};
const SECOND_NAMED: Record<string, number> = { 평균: 2, 최저: 3, 최고: 4 };

/** 한 학년도 행의 발표 통계 [① 칸, ② 칸]. 맞는 통계가 없는 칸은 undefined */
export function publishedStats(r: Row): [PublishedStat | undefined, PublishedStat | undefined] {
  const all: { label: string; cell: Cell; i: number }[] = [];
  const add = (label: string | null, cell: Cell) => {
    if (label === null || cell.v === null || cell.b === UNKNOWN_BASIS) return;
    all.push({ label, cell, i: all.length });
  };
  add("50%컷", r.c50);
  add("70%컷", r.c70);
  for (const e of r.alt.e) add(statName(e.l), e);
  if (all.length === 0) return [undefined, undefined];
  const tier = Math.min(...all.map((x) => cohortTier(x.cell)));
  const inTier = all.filter((x) => cohortTier(x.cell) === tier);
  const basis = inTier.reduce((best, x) => (basisRank(x.cell.b) < basisRank(best) ? x.cell.b ?? null : best), inTier[0].cell.b ?? null);
  const same = inTier.filter((x) => (x.cell.b ?? null) === basis);
  const stat = (x: { label: string; cell: Cell } | undefined): PublishedStat | undefined =>
    x && { label: x.label, cell: x.cell, schoolRecord: x.cell.b === "학생부 등급" };
  const first = same.find((x) => x.label === "50%컷") ?? same.find((x) => x.label === "평균");
  const second = same
    .filter((x) => x !== first && x.label !== "50%컷" && (x.label !== "평균" || first?.label === "50%컷"))
    .sort((a, b) => secondRank(a.label) - secondRank(b.label) || a.i - b.i)[0];
  return [stat(first), stat(second)];
}
