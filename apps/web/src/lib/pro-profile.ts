/**
 * 전문가용 학생 '상담 참고'(2026-11-13 최종관리자 결정). 예전 태그(쉼표 5개)·메모 칸 대신
 * 희망 계열·희망 전공·희망 대학·희망 지역·기타 다섯 항목에 항목마다 최대 5개씩 적는다.
 *
 * 서버 계약은 바꾸지 않는다: 학생 metadata.tags(최대 5개, 개당 100자, 중복 없음)에 항목 하나를
 * 태그 하나로 담는다. 예: "희망 대학: 서울대, 연세대". 빈 항목은 태그를 만들지 않는다.
 * 머리말이 없는 예전 태그는 읽을 때 '기타'로 보인다(다시 저장하면 기타 항목으로 옮겨진다).
 */
export const PROFILE_FIELDS = [
  { key: "track", label: "희망 계열", ph: "예: 공학, 자연" },
  { key: "major", label: "희망 전공", ph: "예: 컴퓨터공학, 전자공학" },
  { key: "univ", label: "희망 대학", ph: "예: 서울대, 연세대" },
  { key: "region", label: "희망 지역", ph: "예: 서울, 경기" },
  { key: "etc", label: "기타", ph: "예: 재수, 교차지원 고려" },
] as const;
export type ProfileKey = (typeof PROFILE_FIELDS)[number]["key"];
export type StudentProfile = Record<ProfileKey, string[]>;

/** 항목마다 최대 개수와 낱말 길이. 머리말(7자)+": "+5×(16자+", ")가 서버 태그 한도 100자 안에 든다 */
export const PROFILE_MAX_ITEMS = 5;
export const PROFILE_MAX_ITEM_CHARS = 16;
const TAG_MAX = 100;
const SEP = ": ";

export const emptyProfile = (): StudentProfile => ({ track: [], major: [], univ: [], region: [], etc: [] });

/** 입력칸 글 → 낱말 목록(쉼표·가운뎃점·줄바꿈으로 나눔, 앞뒤 공백 제거, 중복 제거) */
export function splitItems(text: string): string[] {
  return [...new Set(text.split(/[,，、·\n]+/).map((s) => s.trim()).filter(Boolean))];
}

/** 받침 있는 낱말 뒤 '은', 없으면 '는'(희망 대학은 · 기타는) */
const topic = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return w + (c >= 0 && c < 11172 && c % 28 !== 0 ? "은" : "는");
};

/** 입력 검사. 문제가 있으면 안내 문장, 없으면 null */
export function profileProblem(p: StudentProfile): string | null {
  for (const f of PROFILE_FIELDS) {
    const items = p[f.key];
    if (items.length > PROFILE_MAX_ITEMS) return `${topic(f.label)} ${PROFILE_MAX_ITEMS}개까지 넣을 수 있습니다.`;
    if (items.some((s) => s.length > PROFILE_MAX_ITEM_CHARS)) return `${f.label}의 낱말은 ${PROFILE_MAX_ITEM_CHARS}자 안으로 넣어 주세요.`;
  }
  return null;
}

/** 항목 → 서버 태그(항목 하나 = 태그 하나) */
export function profileToTags(p: StudentProfile): string[] {
  return PROFILE_FIELDS.filter((f) => p[f.key].length > 0).map((f) => `${f.label}${SEP}${p[f.key].join(", ")}`.slice(0, TAG_MAX));
}

/** 서버 태그 → 항목. 머리말 없는 예전 태그는 기타로 모은다 */
export function tagsToProfile(tags: readonly string[]): StudentProfile {
  const out = emptyProfile();
  for (const t of tags) {
    const f = PROFILE_FIELDS.find((x) => t.startsWith(x.label + SEP));
    if (f) out[f.key].push(...splitItems(t.slice(f.label.length + SEP.length)));
    else if (t.trim()) out.etc.push(t.trim());
  }
  for (const f of PROFILE_FIELDS) out[f.key] = [...new Set(out[f.key])];
  return out;
}
