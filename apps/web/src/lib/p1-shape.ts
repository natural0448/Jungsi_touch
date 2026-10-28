/*
  1페이지 정리본의 화면용 작은 모양(서버·브라우저 공용). 저장·검증은 lib/p1-snapshot.ts.
*/

/** 칸 하나. v 는 원문 표기(숫자도 문자열), n=1 은 원문이 JSON 숫자였다는 표시 */
export type Cell = {
  /** Rank-only display result of the existing backend-validated snapshot API. */
  sq?: { status: "verified_official"; unit: "번" };
  v: string | null;
  n?: 1;
  s: string; // status
  r: string | null; // reason_code
  u: string | null; // unit
  l: string | null; // statistic_label
  st?: string; // 모집인원 단계
  b?: string | null; // 기준(basis_label)
  co?: string | null; // 대상 집단
  p?: number | null; // 실제 발표 비율. 평균/최저 등에는 null
  bc?: string | null; // 원래 점수 기준 코드
  cc?: string | null; // 원래 대상 집단 코드
  at?: string | null; // 원문 자료 기준일/시각(값이 없으면 null)
  ctx?: { identity_variant_index: number; scope_status: string } | null;
  /** 발표 용도(서버 publication_context.publication_role, 담당자 서비스 후보 2026-10-28). 없으면 기존 v1 */
  pr?: "actual_result" | "simulation_reference" | "unresolved";
  url?: string | null;
};
export type Row = {
  y: number;
  pk: string | null; // 원래 PK(연결된 행만)
  ob: string | null; // PK 미연결 관측 주소
  n: string; // 그 학년도 발표 대학명
  d: string;
  t: string | null;
  g: string | null;
  c: string | null;
  rg: string | null;
  idv: number; // 표기 변형 수(확인 중)
  rc: Cell;
  cr: Cell;
  ad: Cell;
  rk: Cell;
  c50: Cell;
  c70: Cell;
  alt: { s: string; r: string | null; om: number; e: Cell[] };
};
export type School = { id: string; name: string; names: string[]; region: string | null; units: number; pending: number };

/** 학교 묶음 안의 모집단위 키: 연결된 행은 원래 PK, 미연결 관측은 관측 주소 */
export const unitKey = (r: Row) => (r.pk !== null ? `pk:${r.pk}` : `ob:${r.ob}`);

/** 원문 이름을 먼저 쓴다. 비율 없는 평균/최저에 50/70 같은 숫자를 만들지 않는다. */
export function publishedStatisticLabel(c: Cell): string {
  if (c.l !== null && c.l.trim()) return c.l;
  if (c.p !== null && c.p !== undefined && Number.isSafeInteger(c.p) && c.p >= 1 && c.p <= 100)
    return `${c.p}%컷`;
  return "발표 기준 확인 중";
}
