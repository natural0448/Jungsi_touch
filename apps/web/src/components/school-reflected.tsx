import type { AssessmentDto } from "@/lib/dto";
import { SCHOOL_REFLECTED_ELIGIBILITY, SCHOOL_REFLECTED_NOTE, SCHOOL_REFLECTED_TITLE, schoolReflectedOf } from "@/lib/school-reflected";

/** 학교 반영 백분위(참고) 한 줄. 값도 대기 사유도 없으면 아무것도 그리지 않는다 */
export function SchoolReflectedLine({ a, compact = false }: { a: AssessmentDto | null | undefined; compact?: boolean }) {
  const v = schoolReflectedOf(a);
  if (!v) return null;
  if (v.kind === "pending") {
    return compact ? null : (
      <p className="sr-line hold">
        <b>{SCHOOL_REFLECTED_TITLE}</b> 계산 대기 — {v.reason}
      </p>
    );
  }
  return (
    <p className={compact ? "sr-line compact" : "sr-line"}>
      <b>{SCHOOL_REFLECTED_TITLE}</b> <span className="num">{v.text}</span>
      {!compact && <span className="sr-note"> · {SCHOOL_REFLECTED_NOTE}</span>}
      {compact && <span className="sr-note"> · 영어·한국사·가산점 제외</span>}
      {v.eligibility && <span className="sr-elig"> {SCHOOL_REFLECTED_ELIGIBILITY}</span>}
    </p>
  );
}
