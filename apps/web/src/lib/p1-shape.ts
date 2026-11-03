/*
  1페이지 정리본의 화면용 작은 모양(서버·브라우저 공용). 저장·검증은 lib/p1-snapshot.ts.
*/

/** 칸 하나. v 는 원문 표기(숫자도 문자열), n=1 은 원문이 JSON 숫자였다는 표시 */
export type Cell = {
  /** Rank-only display result of the existing backend-validated snapshot API. */
  sq?: { status: "verified_official"; unit: "번" };
  v: string | null;
  /** 발행 서버가 해당 성적 칸에 대해 독립 검증한 사유만 허용한다. 미전달은 미확인이다. */
  verified_score_null_reasons?: readonly ("other_statistic_only" | "three_or_fewer")[];
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
  /** 2027 모집행: 서버가 검토한 과거 행의 전체 식별자와 2027 scope */
  hl?: HistoryLink[];
  scope27?: string;
  /** 학교 묶음의 확인된 표시 키. 근거가 없는 연도는 별도 키를 유지한다. */
  gk?: string;
};
/** 과거 발표 연도의 전형·군·캠퍼스를 원문 그대로 구분한다. */
export function historyConditions(row:Pick<Row,"c"|"t"|"g">):string {
  return [row.c && `캠퍼스 ${row.c}`,row.t && `전형 ${row.t}`,row.g && `모집군 ${row.g}`].filter(Boolean).join(" · ");
}
/** 직전 학년도와 확인된 조건의 차이가 있을 때만 표시한다. */
export function historyConditionsChanged(row: Pick<Row, "c" | "t" | "g">, previous: readonly Pick<Row, "c" | "t" | "g">[]): boolean {
  if (previous.length === 0) return false;
  const fields = ["c", "t", "g"] as const;
  return previous.every(p => fields.some(field => {
    const now = row[field]?.trim() ?? "", before = p[field]?.trim() ?? "";
    return now !== "" && before !== "" && now !== before;
  }));
}
/** 과거 행 식별자. 캠퍼스·전형·군이 없는 행은 null 그대로 둬야 그 과거 행의 c·t·g 와 맞는다 */
export type HistoryLink = {
  academic_year: number; school_id: string | null; original_pk: string | null;
  campus: string | null; admission_track: string | null; group: string | null;
};
export type School = { id: string; name: string; names: string[]; region: string | null; units: number; pending: number };
/** 2027 모집인원 원문. v 는 quota_value 원문 표기, ls·st·ct 는 quota_literal_state·quota_stage·quota_condition_text,
 * cs 는 quota_cell.status, rs 는 서버 quota_review_status */
export type Quota27 = { v: string | null; ls: string | null; st: string | null; ct: string | null; cs: string | null; rs: string };
/** 2027 부분 발행 표시(서버 r27_scope_coverage). head 와 모든 분할이 같은 값이다 */
export type R27Coverage = { status: "partial"; source_rows: number; included_rows: number; excluded_rows: number; review_pending_rows: number };

/** 학교별 조립이 끝난 행의 표시 키. 2027 행은 linkR27에서 기존 PK와 다른 scope 키를 받는다. */
export const unitKey = (r: Row) => r.gk ?? (r.pk !== null ? `pk:${r.pk}` : `ob:${r.ob}`);

/**
 * 한 학교의 모든 조각을 받은 뒤 1회 실행한다. 원래 PK가 같아도 2027 행은 별도 scope 키로 시작한다.
 * 서버가 승인한 전체 식별자가 정확히 한 과거 행을 가리키고, 그 행을 주장한 2027 scope가 하나일 때만 연결한다.
 */
export function linkR27(rows: Row[], schoolId: string): Row[] {
  const result = rows.map(r => ({ ...r }));
  const id = (year: number, school: string, pk: string | null, campus: string | null, track: string | null, group: string | null) =>
    JSON.stringify([year, school, pk, campus, track, group]);
  const historical = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.y === 2027 || r.pk === null) continue;
    const key = id(r.y, schoolId, r.pk, r.c, r.t, r.g);
    const found = historical.get(key);
    if (found) found.push(i); else historical.set(key, [i]);
  }
  // 같은 scope 를 두 2027 행이 쓰면 서버 자료 오류다. 학교 전체를 막지 않고 그 행들만 연결하지 않는다
  const scopeCount = new Map<string, number>();
  for (const r of rows) if (r.y === 2027 && r.pk !== null && r.scope27) scopeCount.set(r.scope27, (scopeCount.get(r.scope27) ?? 0) + 1);
  const claims = new Map<string, Set<string>>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.y !== 2027 || r.pk === null) continue;
    // 학교 캐시 안의 행 번호라 판·학교에 묶이고 주소에 scope 원문이 드러나지 않는다
    const key = `r27:${i}`;
    result[i].gk = key;
    if (!r.scope27 || scopeCount.get(r.scope27) !== 1) continue;
    // 대상은 과거 행 자신의 전체 식별자로 맞춘다. 학년도 사이 전형명·군이 바뀐 검토 연결도 있어 2027 행의 c·t·g 와 같을 필요는 없다
    for (const link of r.hl ?? []) {
      if (![2024, 2025, 2026].includes(link.academic_year) || link.school_id !== schoolId || !link.original_pk) continue;
      const target = id(link.academic_year, link.school_id, link.original_pk, link.campus, link.admission_track, link.group);
      const owners = claims.get(target);
      if (owners) owners.add(key); else claims.set(target, new Set([key]));
    }
  }
  for (const [target, owners] of claims) {
    const found = historical.get(target);
    if (owners.size === 1 && found?.length === 1) result[found[0]].gk = [...owners][0];
  }
  return result;
}

/** 접힌 줄의 2027 모집 칸. hold 면 '확인 중', carry 는 수시 이월 조건, initial 은 최초 인원 */
export type R27Summary = { v: string | null; carry: boolean; initial: boolean; check: boolean; hold: boolean; note: string | null; stageUnknown?: boolean };
const CARRY_STATES = new Set(["conditional_transfer", "conditional_carryover"]);
/** 모집인원 원문을 그대로 보인다. 이월 미정을 0 으로 바꾸지 않고, 모르는 상태 값은 '확인 중'으로 둔다 */
export function r27Summary(q: Quota27 | undefined): R27Summary {
  const hold: R27Summary = { v: null, carry: false, initial: false, check: false, hold: true, note: null };
  if (!q || q.rs === "source_conflict" || (q.ls !== null && q.ls !== "numeric_literal" && !CARRY_STATES.has(q.ls))) return hold;
  // 일반 모집조건 문구만으로 이월을 추정하지 않는다.
  const carry = q.ls !== null && CARRY_STATES.has(q.ls);
  if (carry && q.st === "final") return hold;
  const parsed = q.v !== null && /^[0-9]+$/.test(q.v.trim()) ? Number(q.v.trim()) : NaN;
  const v = Number.isSafeInteger(parsed) && parsed >= 0 ? q.v!.trim() : null;
  if (v === null && (q.ls === "numeric_literal" || !carry || (q.v !== null && q.v.trim() !== ""))) return hold;
  // 원문 0은 0 그대로 둔다. 최종 0 행의 회원 목록 제외는 서버 발급 범위가 맡는다(범위 공급 전 화면에서 숨기지 않음, 2026-11-03 사용자 결정)
  const base = carry
    ? v === null
      ? "수시에서 남은 인원이 있을 때만 정시로 뽑습니다. 인원은 아직 정해지지 않았습니다."
      : "수시 미충원 인원이 더해질 수 있습니다. 최종 인원은 수시 등록이 끝난 뒤 정해집니다."
    : null;
  const condition = q.ct ? `모집요강: ${q.ct.length > 200 ? `${q.ct.slice(0, 200)}…` : q.ct}` : null;
  return {
    v, carry, hold: false,
    initial: q.st === "initial",
    stageUnknown: v !== null && q.st !== "initial" && q.st !== "final",
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
