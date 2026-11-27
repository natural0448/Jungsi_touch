import type { Metadata } from "next";
import { PageHead } from "@/components/page-head";
import { isEdutouchAdmin } from "@/lib/admin";
import { EXAM, csatOpen, finalOpen } from "@/lib/exam";
import { PersonalForm, ProForm } from "./forms";
import "../../pro/pro.css";

export const metadata: Metadata = { title: "고객센터 성적 정정 승인" };
export const dynamic = "force-dynamic";

/*
  고객센터 전용 성적 정정 승인(개인용 score-input.correction.grant · 전문가용 pro.correction.grant).
  에듀터치 관리자만 화면이 열리고, 실제 승인은 서버가 fresh active·aal2(OTP)·접수 번호·정확한 대상·기대 판·멱등키로
  다시 확인한다. 정정은 대상·시험 단계마다 1회다. 409(판 변경)는 자동으로 다시 보내지 않는다. 기관 관리자는 이 화면을 쓰지 않는다.
*/
export default async function Page() {
  const head = <PageHead kicker="관리" title="고객센터 성적 정정 승인" desc="고객센터 접수 건마다 정정권 1회를 승인합니다. 2단계 인증(OTP) 세션이 필요합니다." />;
  if (!(await isEdutouchAdmin()))
    return <>{head}<div className="wrap pg-body"><section className="gate flat"><h2>에듀터치 관리자만 쓸 수 있는 화면입니다</h2></section></div></>;
  return (
    <>
      {head}
      <div className="wrap pg-body pro">
        <section className="pro-sec" aria-labelledby="p-h">
          <h2 id="p-h">개인 회원</h2>
          <PersonalForm examId={EXAM.exam_id} stage={finalOpen() ? "final" : csatOpen() ? "provisional" : "mock"} idem={crypto.randomUUID()} />
        </section>
        <section className="pro-sec" aria-labelledby="o-h">
          <h2 id="o-h">전문가용 학생</h2>
          <ProForm examId={EXAM.exam_id} stage={finalOpen() ? "final" : csatOpen() ? "provisional" : "mock"} idem={crypto.randomUUID()} />
          <p className="pro-note">전문가용 정정은 기관 권한 DB 함수의 고객센터(support) 판정이 연결된 뒤 동작합니다. 지금은 연결 대기로 보일 수 있습니다.</p>
        </section>
        <p className="pro-note">승인 전에 고객센터 접수 내용과 대상(회원·학생·시험·단계)이 정확히 맞는지 확인하세요. 승인한 정정권은 되돌리거나 늘리지 않습니다.</p>
      </div>
    </>
  );
}
