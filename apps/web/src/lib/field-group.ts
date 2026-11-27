import data from "./field-groups-2027.json";

/*
  모집단위의 학과 계열(표시용). 데이터팀 R2 회신(2026-11-18)을 2027 + 모집행 PK 로 붙인다.
  - 7계열 값의 근거는 세 가지다(R2 v9 classification_status). 대부분은 대교협 2025 학과 분류를 임시로 참고한 것이라
    '2025 분류 기준'을 함께 적는다. 2027 대학 모집요강의 계열(guide_2027)은 '2027 모집요강 계열',
    2027 요강 초안(draft_2027)은 '2027 요강 초안 기준'이라고 적는다. 어느 것도 확정 분류로 세지 않는다.
    (2026-11-22 새벽 대표님 결정: 화면의 '참고' 표현을 모두 지우되 근거 표시는 남긴다 — 전에는 '…참고')
  - 자유전공은 모집단위 이름에 자유·자율·무전공이 적힌 별도 유형이다. 7계열 가운데 하나로 넣지 않는다.
  - 자료에 없는 모집단위는 null — '기타'로 묶어 보이고 7계열·자유전공 어디에도 넣지 않는다(대표님 결정 2026-11-21, 계열 자료가 올 때까지).
  - 계열은 학과 내용의 표시 축일 뿐이다. 대학 환산식 묶음·실기 여부·분석 가능 여부를 뜻하지 않는다.
*/
export const FIELD_GROUPS = ["인문", "사회", "교육", "공학", "자연", "의약", "예체능", "자유전공"] as const;
export type FieldGroupName = (typeof FIELD_GROUPS)[number];
/** 계열 값의 근거. free 는 모집단위 이름에 자유·자율·무전공이 적힌 별도 유형 */
export type FieldBasis = "2025" | "guide2027" | "draft2027" | "free" | "name2027";
export const FIELD_BASIS_NOTE: Record<FieldBasis, string | null> = { "2025": "2025 분류 기준", guide2027: "2027 모집요강 계열", draft2027: "2027 요강 초안 기준", free: null, name2027: "학과 이름 기준" };
export interface FieldGroup {
  name: FieldGroupName;
  basis: FieldBasis;
  /** 근거 안내 문구(자유전공은 없음) */
  note: string | null;
  /** 2025 분류를 임시로 참고한 값이면 true */
  provisional: boolean;
}
/** 계열을 모르는 모집단위를 묶을 때 쓰는 이름(계열이 아니다) */
export const FIELD_UNKNOWN = "기타";

const BY_PK = new Map<number, FieldGroupName>();
for (const name of FIELD_GROUPS) for (const pk of (data.groups as Record<string, number[]>)[name] ?? []) BY_PK.set(pk, name);
// 2026-11-24 대표님 '실제로 미분류 계열은 없다': R2 자료에 없는 모집단위는 화면팀이 학과 이름·본체 학과 계열로 붙인 값(name_2027)
const NAMED = new Set<number>();
for (const name of FIELD_GROUPS) for (const pk of ((data as { name_2027?: Record<string, number[]> }).name_2027 ?? {})[name] ?? []) if (!BY_PK.has(pk)) { BY_PK.set(pk, name); NAMED.add(pk); }
const GUIDE = new Set<number>(data.guide_2027 as number[]);
const DRAFT = new Set<number>(data.draft_2027 as number[]);

/** offering_id("2027:1000006263")의 계열. 다른 학년도·모르는 PK 는 null */
export function fieldGroupOf(offeringId: string): FieldGroup | null {
  const m = /^(\d{4}):(\d{1,12})$/.exec(offeringId);
  if (!m || Number(m[1]) !== data.year) return null;
  const pk = Number(m[2]);
  const name = BY_PK.get(pk);
  if (!name) return null;
  const basis: FieldBasis = name === "자유전공" ? "free" : GUIDE.has(pk) ? "guide2027" : DRAFT.has(pk) ? "draft2027" : NAMED.has(pk) ? "name2027" : "2025";
  return { name, basis, note: FIELD_BASIS_NOTE[basis], provisional: basis === "2025" };
}

/** 묶음 이름: 계열 이름 또는 '기타' */
export function fieldLabelOf(offeringId: string): string {
  return fieldGroupOf(offeringId)?.name ?? FIELD_UNKNOWN;
}

/** 모집단위들을 계열 순서(7계열 → 자유전공 → 기타)로 묶는다. 빈 묶음은 내지 않는다 */
export function groupByField<T>(items: T[], idOf: (x: T) => string): { label: string; provisional: boolean; items: T[] }[] {
  const order: string[] = [...FIELD_GROUPS, FIELD_UNKNOWN];
  const buckets = new Map<string, { label: string; provisional: boolean; items: T[] }>();
  for (const x of items) {
    const f = fieldGroupOf(idOf(x));
    const label = f?.name ?? FIELD_UNKNOWN;
    const b = buckets.get(label) ?? { label, provisional: false, items: [] };
    if (f?.provisional) b.provisional = true;
    b.items.push(x);
    buckets.set(label, b);
  }
  return order.filter((k) => buckets.has(k)).map((k) => buckets.get(k)!);
}
