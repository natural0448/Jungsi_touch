/*
  대학 약칭 → 정식 이름의 일부(2026-11-28 담당자 통합 회신 R29 §2).
  검색은 정식 이름에 검색어가 들어 있는지로 찾는다. '금오공대'는 '금오공과대학교'에 들어 있지 않아 1·4페이지 모두 0건이었다.
  자주 쓰는 약칭만 정식 이름의 일부로 바꾼다. 바꿀 것이 없으면 그대로 둔다(정식 이름·이미 맞는 일부는 영향 없음).
*/

/** 통째로 바꾸는 약칭(띄어쓰기 없이 비교). 값은 정식 이름에 들어 있는 글자 */
const EXACT: Record<string, string> = {
  연대: "연세대",
  고대: "고려대",
  성대: "성균관대",
  한대: "한양대",
  중대: "중앙대",
  건대: "건국대",
  동대: "동국대",
  홍대: "홍익대",
  외대: "한국외국어",
  한국외대: "한국외국어",
  시립대: "서울시립",
  서울시립대: "서울시립",
  서울과기대: "서울과학기술",
  과기대: "과학기술",
  한기대: "한국기술교육",
  코리아텍: "한국기술교육",
  금오공대: "금오공과",
  한국공대: "한국공학",
  포스텍: "포항공과",
  카이스트: "한국과학기술원",
  한예종: "한국예술종합",
  한체대: "한국체육",
};

/** 끝말 규칙(앞부분은 그대로): 서울여대 → 서울여자, 부산외대 → 부산외국어, 서울교대 → 서울교육, ○○공대 → ○○공과 */
const SUFFIX: [RegExp, string][] = [
  [/^(.+)과기대(학교)?$/, "$1과학기술"],
  [/^(.+)여대(학교)?$/, "$1여자"],
  [/^(.+)외대(학교)?$/, "$1외국어"],
  [/^(.+)교대(학교)?$/, "$1교육"],
  [/^(.+)공대(학교)?$/, "$1공과"],
];

/** 검색어 하나를 정식 이름의 일부로. 약칭이 아니면 받은 그대로(공백 정리만) */
export function expandUniversityTerm(term: string): string {
  const t = term.normalize("NFC").replace(/\s+/g, "");
  if (!t) return term;
  if (EXACT[t]) return EXACT[t];
  for (const [re, to] of SUFFIX) if (re.test(t)) return t.replace(re, to);
  return term;
}

/** 쉼표로 여러 검색어를 쓴 경우 각각 바꾼다(1페이지는 쉼표로 여러 학교를 찾는다) */
export function expandUniversityQuery(q?: string): string | undefined {
  if (!q) return q;
  return q.split(/([,，、])/).map((part, i) => {
    if (i % 2) return part;
    const lead = part.match(/^\s*/)?.[0] ?? "", tail = part.match(/\s*$/)?.[0] ?? "";
    const core = part.trim();
    return core ? lead + expandUniversityTerm(core) + tail : part;
  }).join("");
}
