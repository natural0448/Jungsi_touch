import type { ReferenceBandDto } from "./dto";
/*
  가채점 판정 보류 모집단위.
  - 2026-11-23 오후: 같은 기본 경계 861곳(H1)을 보류했다가, 같은 날 담당자 H1 회신(859 + 서울신학대 2 새 경계)을
    판정 묶음 v5p234-v52-h1 에 넣어 보류를 풀었다.
  - 정수 넘침 8곳(건국대 글로컬·울산대 의예과): 담당자 K1 확인(11-23 저녁) 뒤 정정 곡선·경계를 판정 묶음 v5p234-v52-h1k1·
    곡선 색인 r36 에 넣어 보류를 풀었다. 운영 학교 점수 계산기는 담당자 시험 입력 56/56 일치(정수 넘침 없음).
  가톨릭관동대 의예과 지역의사선발 6행(Q1)은 비교 경계를 확인할 때까지 보류한다.
  환산점수(school_score)는 그대로 보인다. 목록은 2027 PK 번호 - 1000000000 을 정렬해 담았다.
*/
const HELD_OFFSETS = [10193, 10194, 10195, 10196, 10197, 10198];
const HELD = new Set(HELD_OFFSETS.map((n) => `2027:${1000000000 + n}`));
export const CSAT_HELD_COUNT = HELD.size;
/** 이 모집단위의 가채점 7단계를 보류하는가 */
export const isCsatHeld = (offeringId: string | null | undefined): boolean => typeof offeringId === "string" && HELD.has(offeringId);
/** 4페이지: 보류 모집단위면 단계 없이 환산점수만 쓰도록 held 를 붙인다 */
export function heldBand(id: string, b: ReferenceBandDto | null | undefined): ReferenceBandDto | undefined {
  if (!b) return undefined;
  return isCsatHeld(id) ? { ...b, held: true } : b;
}
