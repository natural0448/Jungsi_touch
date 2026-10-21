import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "@/components/link";
import { ConnectionNotice } from "@/components/connection-notice";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller } from "@/lib/api";
import { proSource, validId } from "@/lib/api/pro-source";
import { EXAM } from "@/lib/exam";
import { seoulDate, seoulDateTime } from "@/lib/format";
import type { ProOrganization, ProScoreStatusDto, ProStudentDto, ProStudentReportDto } from "@/lib/pro-dto";
import { proAccess } from "@/lib/pro-access";
import { OverallCard, PositionChart, SubjectsSheet } from "../../../reports/me/report-view";
import { ScoreForm } from "../../../reports/me/score-form";
import { submitStudentScores } from "../../actions";
import { StudentForm } from "../../student-form";
import "../../../reports/me/report.css";
import "../../pro.css";

export const metadata: Metadata = { title: "학생 · 정시터치 전문가용" };
export const dynamic = "force-dynamic";

/** 이번 시험의 입력 단계. 9월 모의평가는 mock 하나만 승인돼 있다(Owner 최종 설정 input_scope) */
const STAGE = "mock";

/*
  전문가용 학생 화면(계약 pro.student). 화면 위에 '지금 보는 학생' 띠를 고정하고, 그 아래 학생별 입력 상태 → 성적 입력
  (확인 창에 학생 이름을 크게) → 최근 리포트(개인용과 같은 전체 위치 화면) → 리포트 판 목록이 온다.
  다른 기관·담당 아닌 학생은 서비스가 404 로 막고 화면도 '없음'만 보인다. 열람 전용은 입력하지 않는다.
*/
export default async function Page({ params, searchParams }: PageProps<"/pro/students/[studentId]">) {
  const { studentId } = await params;
  const sp = await searchParams;
  const orgParam = typeof sp.org === "string" ? sp.org : "";
  const editing = sp.edit === "1";
  const reportParam = typeof sp.report === "string" ? sp.report : "";
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
  let reports: ProStudentReportDto[] = [];
  let shown: ProStudentReportDto | null = null;
  try {
    svc = (await src.session(caller)).organizations.find((o) => o.org_id === String(org.org_id));
    if (svc) {
      student = await src.readStudent(caller, svc.org_id, studentId);
      if (student) {
        status = await src.scoreStatus(caller, svc.org_id, studentId, EXAM.exam_id, EXAM.pack_version, STAGE);
        reports = (await src.listReports(caller, svc.org_id, studentId)).items;
        const want = reportParam && validId(reportParam) ? reportParam : reports[0]?.report_id;
        shown = want ? (reports.find((r) => r.report_id === want) ?? (await src.readReport(caller, svc.org_id, studentId, want))) : null;
      }
    }
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (!(e instanceof AccessDenied)) throw e;
  }
  if (!svc || !student) return <>{head}<NotFound back={back} /></>;
  const cls = [student.class_label, student.class_number ? `${student.class_number}번` : null].filter(Boolean).join(" ");
  const self = `/pro/students/${encodeURIComponent(student.student_id)}?org=${encodeURIComponent(svc.org_id)}`;
  const canInput = svc.role === "teacher" && !student.archived && status !== null && status.initial_remaining > 0;
  const a = shown?.published_result.overall ?? null;

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
      <div className="wrap pg-body pro rp">
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
            <p className="pro-note">이 학생의 입력 상태를 지금 확인할 수 없습니다. 입력을 열지 않았습니다.</p>
          )}
          {canInput && status && (
            <ScoreForm
              examLabel={EXAM.label}
              idem={crypto.randomUUID()}
              defaults={{}}
              submit={submitStudentScores}
              subject={student.display_name}
              hidden={{ org_id: svc.org_id, student_id: student.student_id, entry_version: String(status.entry_version), stage: STAGE }}
            />
          )}
          {!canInput && status && status.initial_remaining === 0 && !shown && (
            <p className="pro-note">이 학생은 입력 1회를 사용했습니다. 리포트가 아직 없다면 잠시 뒤 다시 열어 주세요.</p>
          )}
          {svc.role === "org_admin" && status && status.initial_remaining > 0 && <p className="pro-note">성적 입력은 담당 교사가 합니다.</p>}
        </section>

        {shown && a && (
          <section className="pro-sec" aria-labelledby="report-h">
            <div className="pro-sechd">
              <h2 id="report-h">
                리포트 <small className="pro-note">{shown.revision_id}번째 판 · {seoulDateTime(shown.created_at_utc)}</small>
              </h2>
            </div>
            <OverallCard a={a} />
            <SubjectsSheet a={a} />
            <PositionChart a={a} />
            <p className="pro-note">상담 tip(이 학생에게 유리한 이유 설명)은 서버의 근거 자료가 연결되면 이 자리에 보입니다. 지금은 근거 연결 전입니다.</p>
          </section>
        )}

        {reports.length > 0 && (
          <section className="pro-sec" aria-labelledby="hist-h">
            <h2 id="hist-h">리포트 판 목록</h2>
            <ul className="pro-hist">
              {reports.map((r) => (
                <li key={`${r.report_id}-${r.revision_id}`}>
                  <span>
                    {r.revision_id}번째 판 · <span className="num">{seoulDateTime(r.created_at_utc)}</span>
                  </span>
                  {shown?.report_id === r.report_id && shown.revision_id === r.revision_id ? (
                    <span className="cur">보는 중</span>
                  ) : (
                    <Link className="btn" href={`${self}&report=${encodeURIComponent(r.report_id)}`}>열기</Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
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
