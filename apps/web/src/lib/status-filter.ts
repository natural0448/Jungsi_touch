import type { AssessmentDto, BandCode, OverallResultDto } from "./dto";
import { positionNoteOf } from "./position-note";

/*
  4페이지 지원가능성 필터(대표님 요청 2026-11-22). 목록 배지(offering-parts CategoryBadge)와 같은 규칙으로 모집단위마다
  필터 열쇠 하나를 정한다. 배지를 바꾸면 이 규칙도 함께 바꾼다.
  - 참고 기준 판정(reference_band)이 있으면 그 단계(추정값 단계 = code, 범위여도 한 단계)
  - 판정 경계가 없으면 '합격선 대비 위치'(line) 또는 '판정 근거 부족'(none)
  - 정식 판정(ready)의 7단계(band), 지원 조건 미충족(ineligible)
  - 그 밖(판정 준비 중·정식 판정의 옛 3구분·분석 없음)은 other
*/
export const STATUS_KEYS = ["stable", "downward", "target", "aspirational", "upward", "challenge", "outside", "line", "none", "ineligible", "other"] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

/** 칩 이름(화면 이름 순서: 하향 → 안정 → … , 서버 stable = 하향, downward = 안정 — 2026-11-22 이름 바꿈) */
export const STATUS_LABEL: Record<StatusKey, string> = {
  stable: "하향",
  downward: "안정",
  target: "적정",
  aspirational: "소신",
  upward: "상향",
  challenge: "도전",
  outside: "불가",
  line: "합격선 대비 위치",
  none: "판정 근거 부족",
  ineligible: "지원 조건 미충족",
  other: "그 밖",
};

const BANDS = new Set<string>(["stable", "downward", "target", "aspirational", "upward", "challenge", "outside"]);

export function statusKeyOf(a: AssessmentDto | null | undefined | "need", overall?: OverallResultDto | null): StatusKey {
  if (!a || a === "need") return "other";
  if (a.status !== "ready" && a.status !== "ineligible" && a.reference_band && BANDS.has(a.reference_band.code)) return a.reference_band.code as BandCode;
  const pn = positionNoteOf(a, overall);
  if (pn) return pn.kind === "none" ? "none" : "line";
  if (a.status === "ineligible" || a.category === "ineligible") return "ineligible";
  if (a.status === "ready" && a.band && BANDS.has(a.band.code)) return a.band.code as BandCode;
  return "other";
}

/** 주소 값(st=stable,target)을 읽는다. 모르는 값은 버리고 정해진 순서로 정렬한다 */
export function parseStatusFilter(v: string | undefined): StatusKey[] | undefined {
  if (!v) return undefined;
  const set = new Set(v.split(",").map((s) => s.trim()));
  const keys = STATUS_KEYS.filter((k) => set.has(k));
  return keys.length ? keys : undefined;
}

/** 필터 칩을 누를 때의 다음 값(있으면 빼고 없으면 넣는다) */
export function toggleStatus(cur: StatusKey[] | undefined, k: StatusKey): StatusKey[] | undefined {
  const set = new Set(cur ?? []);
  if (set.has(k)) set.delete(k);
  else set.add(k);
  const keys = STATUS_KEYS.filter((x) => set.has(x));
  return keys.length ? keys : undefined;
}

/*
  필터를 켰을 때 모으는 방식: 검색 결과를 30개씩 차례로 받아 분석을 채운 뒤(한 번에 분석 요청 하나, 30개 이하)
  고른 단계만 모은다. 30개가 모이거나, 한 화면에서 SCAN_PAGES 쪽(최대 120개)을 확인했거나, 검색이 끝나면 멈춘다.
  다음 쪽 링크는 멈춘 곳의 검색 커서에서 이어 간다. 그동안 화면은 책 넘김 대기 화면이다.
*/
export const SCAN_PAGES = 4;
export const SCAN_EMPTY_HOPS = 4;
