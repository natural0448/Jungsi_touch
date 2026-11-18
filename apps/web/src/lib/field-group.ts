import data from "./field-groups-2027.json";

/*
  모집단위의 학과 계열(표시용). 데이터팀 R2 회신(2026-11-18)을 2027 + 모집행 PK 로 붙인다.
  - 7계열 값은 대교협 2025 학과 분류를 2027 모집단위에 임시로 참고한 것이다. 2027 확정 분류가 아니므로
    화면에는 항상 '2025 분류 참고'를 함께 적는다(confirmed_2027 에 든 PK 만 예외).
  - 자유전공은 모집단위 이름에 자유·자율·무전공이 적힌 별도 유형이다. 7계열 가운데 하나로 넣지 않는다.
  - 자료에 없는 모집단위는 null — '계열 확인 중'으로 보이고 어느 계열에도 넣지 않는다.
  - 계열은 학과 내용의 표시 축일 뿐이다. 대학 환산식 묶음·실기 여부·분석 가능 여부를 뜻하지 않는다.
*/
export const FIELD_GROUPS = ["인문", "사회", "교육", "공학", "자연", "의약", "예체능", "자유전공"] as const;
export type FieldGroupName = (typeof FIELD_GROUPS)[number];
export interface FieldGroup {
  name: FieldGroupName;
  /** 2025 분류를 임시로 참고한 값이면 true */
  provisional: boolean;
}
/** 계열을 모르는 모집단위를 묶을 때 쓰는 이름(계열이 아니다) */
export const FIELD_UNKNOWN = "계열 확인 중";

const BY_PK = new Map<number, FieldGroupName>();
for (const name of FIELD_GROUPS) for (const pk of (data.groups as Record<string, number[]>)[name] ?? []) BY_PK.set(pk, name);
const CONFIRMED = new Set<number>(data.confirmed_2027 as number[]);

/** offering_id("2027:1000006263")의 계열. 다른 학년도·모르는 PK 는 null */
export function fieldGroupOf(offeringId: string): FieldGroup | null {
  const m = /^(\d{4}):(\d{1,12})$/.exec(offeringId);
  if (!m || Number(m[1]) !== data.year) return null;
  const pk = Number(m[2]);
  const name = BY_PK.get(pk);
  if (!name) return null;
  return { name, provisional: name !== "자유전공" && !CONFIRMED.has(pk) };
}

/** 묶음 이름: 계열 이름 또는 '계열 확인 중' */
export function fieldLabelOf(offeringId: string): string {
  return fieldGroupOf(offeringId)?.name ?? FIELD_UNKNOWN;
}

/** 모집단위들을 계열 순서(7계열 → 자유전공 → 확인 중)로 묶는다. 빈 묶음은 내지 않는다 */
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
