import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "@/components/link";
import { ConnectionNotice } from "@/components/connection-notice";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller } from "@/lib/api";
import { proSource, validId } from "@/lib/api/pro-source";
import { EXAM } from "@/lib/exam";
import { seoulDate } from "@/lib/format";
import type { ProOrganization, ProScoreStatusDto, ProStudentDto } from "@/lib/pro-dto";
import { proAccess } from "@/lib/pro-access";
import { StudentForm } from "../../student-form";
import "../../pro.css";

export const metadata: Metadata = { title: "학생 · 정시터치 전문가용" };
export const dynamic = "force-dynamic";

/*
  전문가용 학생 화면(계약 pro.student). 화면 위에 '지금 보는 학생' 띠를 고정하고, 그 아래 학생별 입력 상태·성적 입력·
  리포트 판 목록이 온다(입력·분석·리포트는 다음 묶음). 다른 기관·담당 아닌 학생은 서비스가 404 로 막고 화면도 '없음'만 보인다.
*/
export default async function Page({ params, searchParams }: PageProps<"/pro/students/[studentId]">) {
  const { studentId } = await params;
  const sp = await searchParams;
  const orgParam = typeof sp.org === "string" ? sp.org : "";
  const editing = sp.edit === "1";
  const head = <PageHead kicker="전문가용" title="학생 분석" />;
  const back = <Link className="btn" href={`/pro?org=${encodeURIComponent(orgParam)}`}>학생 목록</Link>;

  const orgs = await proAccess();
  const org = orgs?.find((o) => String(o.org_id) === orgParam);
  if (!org || !validId(studentId)) return <>{head}<NotFound back={back} /></>;

  const caller = await getCaller();
  const src = proSource();
  let svc: ProOrganization | undefined;
  let student: ProStudentDto | null = null;
  let status: ProScoreStatusDto | null = null;
  try {
    svc = (await src.session(caller)).organizations.find((o) => o.org_id === String(org.org_id));
    if (svc) {
      student = await src.readStudent(caller, svc.org_id, studentId);
      if (student) status = await src.scoreStatus(caller, svc.org_id, studentId, EXAM.exam_id, EXAM.pack_version);
    }
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (!(e instanceof AccessDenied)) throw e;
  }
  if (!svc || !student) return <>{head}<NotFound back={back} /></>;
  const cls = [student.class_label, student.class_number ? `${student.class_number}번` : null].filter(Boolean).join(" ");
  const self = `/pro/students/${encodeURIComponent(student.student_id)}?org=${encodeURIComponent(svc.org_id)}`;

  return (
    <>
      {head}
      {/* 지금 보는 학생 띠 — 학생을 잘못 고른 채 입력하지 않도록 화면 위에 고정한다 */}
      <div className="pro-student-bar" role="status" aria-label="지금 보는 학생">
        <div className="wrap">
          <span className="lab">지금 보는 학생</span>
          <b>{student.display_name}</b>
          {cls && <span className="cls">{cls}</span>}
          {student.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          <span className="org">{org.org_name}</span>
        </div>
      </div>
      <div className="wrap pg-body pro">
        <div className="pro-sechd">{back}{svc.role !== "viewer" && !editing && <Link className="btn" href={`${self}&edit=1`}>학생 정보 수정</Link>}</div>
        {editing && svc.role !== "viewer" && <StudentForm orgId={svc.org_id} idem={crypto.randomUUID()} student={student} onDone={self} />}
        {student.memo && <p className="pro-note">메모: {student.memo}</p>}

        <section className="pro-sec" aria-labelledby="score-h">
          <div className="pro-sechd">
            <h2 id="score-h">{EXAM.label} 성적</h2>
          </div>
          {status ? (
            <div className="rp-rights">
              <b>이 학생의 입력</b>
              <span>
                최초 입력 남음 <b className="num">{status.initial_remaining}</b>회 · 정정(고객센터) 승인 남음 <b className="num">{Math.max(0, status.correction_granted - status.correction_used)}</b>회
              </span>
              {status.last_rejection_code && <span className="warn">지난 입력이 정상 계산되지 않았습니다(사유 코드 {status.last_rejection_code}). 정정은 고객센터에 요청해 주세요.</span>}
            </div>
          ) : (
            <p className="pro-note">이 학생의 입력 상태를 지금 확인할 수 없습니다.</p>
          )}
          <div className="pro-empty">
            <p>학생별 성적 입력·전체 위치·대학 분석·상담 리포트는 다음 단계에서 열립니다(준비 중).</p>
            <p className="sub">저장할 때는 확인 창에 학생 이름을 크게 보여 드립니다. 학생마다 시험 단계별 입력 1회와 고객센터 정정 1회가 적용됩니다.</p>
          </div>
        </section>
        <p className="pro-note">추가한 날 {seoulDate(student.created_at_utc)} · 학생 번호 {student.student_id}</p>
      </div>
    </>
  );
}

function NotFound({ back }: { back: ReactNode }) {
  return (
    <div className="wrap pg-body">
      <section className="gate flat">
        <h2>학생을 찾을 수 없습니다</h2>
        <p>담당이 아니거나 다른 기관의 학생이면 열리지 않습니다. 담당 변경은 기관 관리자에게 요청해 주세요.</p>
        <div className="acts">{back}</div>
      </section>
    </div>
  );
}
