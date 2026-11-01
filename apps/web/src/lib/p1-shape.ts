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
  /** 2027 모집행만: 서버 r27_source.quota 원문(담당자 1.9.141). 없으면 2024~2026 발표 행 */
  q27?: Quota27;
  /** 2027 모집행만: 담당자가 같은 모집단위로 검토 확인한 과거 행 `${학년도}|${원래 PK}` */
  hl?: string[];
  /** 과거 행만: 검토 확인된 2027 모집행 아래로 묶일 때 그 키(학교 묶음을 만들 때 붙인다) */
  gk?: string;
};
export type School = { id: string; name: string; names: string[]; region: string | null; units: number; pending: number };
/** 2027 모집인원 원문. v 는 quota_value 원문 표기, ls·st·ct 는 quota_literal_state·quota_stage·quota_condition_text,
 * cs 는 quota_cell.status, rs 는 서버 quota_review_status */
export type Quota27 = { v: string | null; ls: string | null; st: string | null; ct: string | null; cs: string | null; rs: string };
/** 2027 부분 발행 표시(서버 r27_scope_coverage). head 와 모든 분할이 같은 값이다 */
export type R27Coverage = { status: "partial"; source_rows: number; included_rows: number; excluded_rows: number; review_pending_rows: number };

/** 학교 묶음 안의 모집단위 키: 연결된 행은 원래 PK, 미연결 관측은 관측 주소. 검토 확인된 과거 행은 2027 모집행 키 */
export const unitKey = (r: Row) => r.gk ?? (r.pk !== null ? `pk:${r.pk}` : `ob:${r.ob}`);

/**
 * 한 학교의 행에 2027 모집행 연결을 붙인다. 담당자가 검토 확인한 과거 행(historical_links)만 그 2027 행 아래로 묶는다.
 * 이름이 같다는 이유로 묶지 않고, 한 과거 행을 두 2027 행이 가리키면 어느 쪽에도 묶지 않는다.
 */
export function linkR27(rows: Row[]): Row[] {
  const owner = new Map<string, string | null>();
  for (const r of rows) {
    if (r.y !== 2027 || r.pk === null || !r.hl) continue;
    for (const target of r.hl) owner.set(target, owner.has(target) && owner.get(target) !== `pk:${r.pk}` ? null : `pk:${r.pk}`);
  }
  return rows.map((r) => {
    if (r.y === 2027 || r.pk === null) return r;
    const key = owner.get(`${r.y}|${r.pk}`);
    return key ? { ...r, gk: key } : r;
  });
}

/** 접힌 줄의 2027 모집 칸. hold 면 '확인 중', carry 는 수시 이월 조건, initial 은 최초 인원 */
export type R27Summary = { v: string | null; carry: boolean; initial: boolean; check: boolean; hold: boolean; note: string | null };
const CARRY_STATES = new Set(["conditional_transfer", "conditional_carryover"]);
/** 모집인원 원문을 그대로 보인다. 이월 미정을 0 으로 바꾸지 않고, 모르는 상태 값은 '확인 중'으로 둔다 */
export function r27Summary(q: Quota27 | undefined): R27Summary {
  const hold: R27Summary = { v: null, carry: false, initial: false, check: false, hold: true, note: null };
  if (!q || q.rs === "source_conflict" || (q.ls !== null && !CARRY_STATES.has(q.ls))) return hold;
  const carry = q.ls !== null || q.ct !== null;
  const v = q.v !== null && /^[0-9]+$/.test(q.v.trim()) ? String(Number(q.v.trim())) : null;
  if (v === null && (!carry || (q.v !== null && q.v.trim() !== ""))) return hold;
  const base = carry
    ? v === null
      ? "수시에서 남은 인원이 있을 때만 정시로 뽑습니다. 인원은 아직 정해지지 않았습니다."
      : "수시 미충원 인원이 더해질 수 있습니다. 최종 인원은 수시 등록이 끝난 뒤 정해집니다."
    : null;
  const condition = q.ct ? `모집요강: ${q.ct.length > 200 ? `${q.ct.slice(0, 200)}…` : q.ct}` : null;
  return {
    v, carry, hold: false,
    initial: !carry && q.st === "initial",
    check: v !== null && q.cs !== null && q.cs !== "verified_official",
    note: [base, condition].filter(Boolean).join(" ") || null,
  };
}

/** 원문 이름을 먼저 쓴다. 비율 없는 평균/최저에 50/70 같은 숫자를 만들지 않는다. */
export function publishedStatisticLabel(c: Cell): string {
  if (c.l !== null && c.l.trim()) return c.l;
  if (c.p !== null && c.p !== undefined && Number.isSafeInteger(c.p) && c.p >= 1 && c.p <= 100)
    return `${c.p}%컷`;
  return "발표 기준 확인 중";
}
