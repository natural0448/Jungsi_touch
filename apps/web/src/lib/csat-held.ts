import type { ReferenceBandDto } from "./dto";
/*
  가채점 판정 보류 모집단위.
  - 2026-11-23 오후: 같은 기본 경계 861곳(H1)을 보류했다가, 같은 날 담당자 H1 회신(859 + 서울신학대 2 새 경계)을
    판정 묶음 v5p234-v52-h1 에 넣어 보류를 풀었다.
  - 남은 8곳: 건국대(글로컬)·울산대 의예과. 곡선 생산기 16비트 정수 넘침(담당자 ck_correction).
    대표님 결정(11-23): 담당자 확인 뒤 정정판 적용, 그때까지 보류.
  환산점수(school_score)는 그대로 보인다. 목록은 2027 PK 번호 - 1000000000 을 정렬해 담았다.
*/
const HELD_OFFSETS = [1854,1855,4553,10231,10232,10233,10234,10771];
const HELD = new Set(HELD_OFFSETS.map((n) => `2027:${1000000000 + n}`));
export const CSAT_HELD_COUNT = 8;
/** 이 모집단위의 가채점 7단계를 보류하는가 */
export const isCsatHeld = (offeringId: string | null | undefined): boolean => typeof offeringId === "string" && HELD.has(offeringId);
/** 4페이지: 보류 모집단위면 단계 없이 환산점수만 쓰도록 held 를 붙인다 */
export function heldBand(id: string, b: ReferenceBandDto | null | undefined): ReferenceBandDto | undefined {
  if (!b) return undefined;
  return isCsatHeld(id) ? { ...b, held: true } : b;
}
