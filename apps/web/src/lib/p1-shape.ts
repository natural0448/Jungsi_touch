/*
  1페이지 정리본의 화면용 작은 모양(서버·브라우저 공용). 저장·검증은 lib/p1-snapshot.ts.
*/

/** 칸 하나. v 는 원문 표기(숫자도 문자열), n=1 은 원문이 JSON 숫자였다는 표시 */
export type Cell = {
  v: string | null;
  n?: 1;
  s: string; // status
  r: string | null; // reason_code
  u: string | null; // unit
  l: string | null; // statistic_label
  st?: string; // 모집인원 단계
  b?: string | null; // 기준(basis_label)
  co?: string | null; // 대상 집단
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
