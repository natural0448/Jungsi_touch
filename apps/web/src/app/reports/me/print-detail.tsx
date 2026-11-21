import type { Cell } from "@/components/offering-parts";
import type { OfferingDto, OverallResultDto, SubjectResultDto } from "@/lib/dto";
import { ConditionsBlock, Detail } from "@/app/admissions/possibilities/parts";
import { ExtrasBody } from "@/app/admissions/possibilities/offering-extras";
import type { Extras } from "@/app/admissions/possibilities/extras-actions";

/** 미리 받지 못한 학교: 값이 없는 것과 같은 확정 표시(미공개·자료 없음)로 그린다 */
const NOT_LOADED: Extras = { ok: false, code: "not_loaded" };

/**
 * 인쇄본의 담은 학교 하나 — 2·4페이지에서 펼친 상세와 같은 카드(모집군·인원, 지원 조건, 네 칸, 판단 이유, 연도별 근거, 설명 문장)를
 * 화면에서 무엇을 열어 두었든 항상 펼친 채로 그린다(대표님 결정 2026-11-22). 자료(extras)는 서버가 미리 받아 넘긴다(print-extras.ts).
 * 브라우저 인쇄는 닫힌 details 의 내용을 찍지 않으므로 여기서는 details·접기 단추를 쓰지 않는다.
 * 상담 리포트 인쇄(서버 화면)와 전문가용 학생 인쇄(브라우저 화면)가 함께 쓴다.
 */
export function PrintDetail({ o, a, extras, subjects, overall, examType }: { o: OfferingDto; a: Cell; extras: Extras | null | undefined; subjects?: SubjectResultDto[]; overall?: OverallResultDto | null; examType?: string | null }) {
  return (
    <div className="ps rp-ps pr-detail">
      <div className="detail">
        <ExtrasBody
          o={o}
          a={a}
          extras={extras ?? NOT_LOADED}
          p1Fast={null}
          detail={<Detail o={o} a={a} extras={null} picked={false} subjects={subjects} overall={overall} examType={examType} acts={false} />}
          conds={<ConditionsBlock a={a} subjects={subjects} />}
        />
      </div>
    </div>
  );
}
