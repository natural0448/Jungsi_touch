/**
 * 학교 반영 참고백분위(2026-11-14 대표님 결정).
 *
 * 학생의 같은 시험 국어·수학·탐구 백분위를 그 모집단위의 확인된 반영비율로
 * 가중평균한 참고값이다. 영어·한국사·가산점은 분자와 분모 모두에서 뺀다.
 * 대학 환산점수·상위누백·합격 가능성이 아니다.
 *
 * 허가 목록(모집단위별 비율과 탐구 반영 방식)은 호출하는 서버가 승인된 자료판에서
 * 넘긴다. 이 모듈은 계산만 하며 회원 권한·자료판 진위를 증명하지 않는다.
 * 없는 값은 0으로 바꾸지 않고 '대기' 사유를 돌려준다. 실제 0은 0이다.
 */

/** 탐구 반영 방식 */
export type ReflectedInquiryMode =
  /** 탐구를 반영하지 않음 */
  | "none"
  /** 응시한 탐구 2과목을 같은 비중으로 반영 */
  | "two_equal"
  /** 탐구 중 백분위가 높은 1과목 */
  | "best1_percentile"
  /** 탐구 중 표준점수가 높은 1과목(같으면 백분위가 높은 과목) */
  | "best1_standard";

/** 허가된 모집단위 하나의 반영 규칙 */
export interface ReflectedReferenceRule {
  readonly offeringId: string;
  /** 국어·수학·탐구 반영비율(같은 단위, 합이 100일 필요 없음). 0은 미반영 */
  readonly korean: number;
  readonly math: number;
  readonly inquiry: number;
  readonly inquiryMode: ReflectedInquiryMode;
  /** 지원 조건(필수 응시 영역·과목 지정)이 아직 확정되지 않은 모집단위 */
  readonly eligibilityNote: boolean;
}

/** 학생의 같은 시험 과목 성적 */
export interface ReflectedSubjectScore {
  readonly percentile: number | null;
  readonly standard: number | null;
}

export interface ReflectedStudentScores {
  readonly korean: ReflectedSubjectScore | null;
  readonly math: ReflectedSubjectScore | null;
  /** 응시한 탐구 과목(0~2개). 제2외국어·한문은 넣지 않는다 */
  readonly inquiry: readonly ReflectedSubjectScore[];
}

export type ReflectedPendingReason =
  | "rule_invalid"
  | "korean_missing"
  | "math_missing"
  | "inquiry_missing"
  | "inquiry_two_subjects_required"
  | "score_invalid";

export type ReflectedReferenceResult =
  | {
    readonly status: "reference";
    readonly offeringId: string;
    /** 반올림하지 않은 값(0~100). 표시 반올림은 화면이 정한다 */
    readonly value: number;
    readonly excluded: readonly ["english", "korean_history", "bonus"];
    readonly eligibilityNote: boolean;
  }
  | {
    readonly status: "pending";
    readonly offeringId: string;
    readonly reason: ReflectedPendingReason;
  };

const EXCLUDED = ["english", "korean_history", "bonus"] as const;

function weight(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function percentile(score: ReflectedSubjectScore | null | undefined): number | null {
  const p = score?.percentile;
  return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 100 ? p : null;
}
function standard(score: ReflectedSubjectScore): number | null {
  const s = score.standard;
  return typeof s === "number" && Number.isFinite(s) && s >= 0 ? s : null;
}

/** 참고백분위 하나를 계산한다. 필요한 값이 없으면 대기 사유를 돌려준다 */
export function schoolReflectedReference(
  rule: ReflectedReferenceRule,
  scores: ReflectedStudentScores,
): ReflectedReferenceResult {
  const pending = (reason: ReflectedPendingReason): ReflectedReferenceResult => ({
    status: "pending",
    offeringId: rule.offeringId,
    reason,
  });
  const k = weight(rule.korean), m = weight(rule.math), i = weight(rule.inquiry);
  if (
    k === null || m === null || i === null || k + m + i <= 0 ||
    !["none", "two_equal", "best1_percentile", "best1_standard"].includes(rule.inquiryMode) ||
    (rule.inquiryMode === "none") !== (i === 0)
  ) return pending("rule_invalid");
  if (!Array.isArray(scores.inquiry) || scores.inquiry.length > 2) return pending("score_invalid");

  let numerator = 0, denominator = 0;
  if (k > 0) {
    const p = percentile(scores.korean);
    if (p === null) return pending("korean_missing");
    numerator += p * k;
    denominator += k;
  }
  if (m > 0) {
    const p = percentile(scores.math);
    if (p === null) return pending("math_missing");
    numerator += p * m;
    denominator += m;
  }
  if (i > 0) {
    const taken = scores.inquiry;
    if (rule.inquiryMode === "two_equal") {
      if (taken.length !== 2) return pending("inquiry_two_subjects_required");
      const a = percentile(taken[0]), b = percentile(taken[1]);
      if (a === null || b === null) return pending("inquiry_missing");
      // 두 과목을 같은 비중으로 넣는다(요강에 합산·평균으로 확인된 모집단위만 허가됨)
      numerator += (a + b) / 2 * i;
    } else {
      if (taken.length === 0) return pending("inquiry_missing");
      let best: ReflectedSubjectScore | null = null;
      for (const s of taken) {
        if (percentile(s) === null) return pending("inquiry_missing");
        if (rule.inquiryMode === "best1_standard" && standard(s) === null) {
          return pending("inquiry_missing");
        }
        if (best === null) {
          best = s;
          continue;
        }
        const better = rule.inquiryMode === "best1_standard"
          ? standard(s)! > standard(best)! ||
            (standard(s) === standard(best) && percentile(s)! > percentile(best)!)
          : percentile(s)! > percentile(best)!;
        if (better) best = s;
      }
      numerator += percentile(best)! * i;
    }
    denominator += i;
  }
  return {
    status: "reference",
    offeringId: rule.offeringId,
    value: numerator / denominator,
    excluded: EXCLUDED,
    eligibilityNote: rule.eligibilityNote === true,
  };
}
