import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "@/components/link";
import { ConnectionNotice } from "@/components/connection-notice";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller } from "@/lib/api";
import { currentStage } from "@/lib/pro-stage";
import { proSource, validId } from "@/lib/api/pro-source";
import type { ScoreInputStatusDto } from "@/lib/dto";
import { EXAM, examTitle, examTypeLabel, stageOf, type InputStage } from "@/lib/exam";
import { seoulDate, seoulDateTime } from "@/lib/format";
import type { ProOrganization, ProScoreStatusDto, ProStudentDto, ProStudentReportDto } from "@/lib/pro-dto";
import { proAccess } from "@/lib/pro-access";
import { OverallCard, PositionChart, SubjectsSheet } from "../../../reports/me/report-view";
import { ScoreForm } from "../../../reports/me/score-form";
import { ProvisionalForm } from "../../../reports/me/provisional-form";
import { StageSteps } from "../../../reports/me/stage-steps";
import { findCandidates, submitStudentScores } from "../../actions";
import { ActionButton } from "../../action-button";
import { CandidatesView, PickedList } from "../../candidates-view";
import { ProfileView } from "../../profile-view";
import { StudentForm } from "../../student-form";
import "../../../reports/me/report.css";
import "../../pro.css";

export const metadata: Metadata = { title: "학생 · 정시터치 전문가용" };
export const dynamic = "force-dynamic";

/*
  전문가용 학생 화면(계약 pro.student). 화면 위에 '지금 보는 학생' 띠를 고정하고, 그 아래 학생별 입력 상태 → 성적 입력
  (확인 창에 학생 이름을 크게) → 최근 리포트(개인용과 같은 전체 위치 화면) → 저장한 리포트 목록이 온다.
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
  const stageP = currentStage(caller);
  let stageSt: ScoreInputStatusDto | null = null;
  let stage: InputStage | null = null;
  try {
    svc = (await src.session(caller)).organizations.find((o) => o.org_id === String(org.org_id));
    if (svc) {
      student = await src.readStudent(caller, svc.org_id, studentId);
      if (student) {
        stageSt = await stageP;
        stage = stageSt ? stageOf(stageSt.stage) : null;
        status = stage ? await src.scoreStatus(caller, svc.org_id, studentId, EXAM.exam_id, EXAM.pack_version, stage) : null;
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
  const stageOpen = stageSt?.stage_state === "open";
  const canInput = svc.role === "teacher" && !student.archived && status !== null && status.initial_remaining > 0 && stageOpen;
  const title = stage ? examTitle(stage, stageSt?.academic_year ?? 2027) : EXAM.label;
  const a = shown?.published_result.overall ?? null;
  // 판 번호 대신 꼬리표(2026-10-28, 2026-11-04 사용자 결정): 서버 입력 상태의 current_report_id 리포트 중 가장 최근 판이 현재 성적이다.
  // 정정을 모두 썼으면 개인용 2페이지와 같은 '정정 입력 횟수 소진', 아니면 '현재 성적'(교사는 학생의 예전 판도 고르므로 남긴다). 판 번호는 열기·인쇄 주소에만 쓴다
  const curRev = Math.max(0, ...reports.filter((r) => r.report_id === status?.current_report_id).map((r) => r.revision_id));
  const tagOf = (r: { report_id: string; revision_id: number }) =>
    status && r.report_id === status.current_report_id && r.revision_id === curRev ? (status.correction_used > 0 && status.correction_used >= status.correction_granted ? "정정 입력 횟수 소진" : "현재 성적") : null;
  // 담은 학교의 이름은 같은 판의 후보 목록에서 찾는다(별도 조회 없음)
  const names = new Map(
    [...(shown?.published_result.candidates?.basic_university_groups.flatMap((g) => g.offerings) ?? []), ...(shown?.published_result.candidates?.wildcards ?? [])].map((it) => [it.offering.offering_id, it.offering]),
  );

  return (
    <>
      {head}
      {/* 지금 보는 학생 띠 — 학생을 잘못 고른 채 입력하지 않도록 화면 위에 고정한다 */}
      <div className="pro-student-bar" role="status" aria-label="지금 보는 학생">
        <div className="wrap">
          <span className="lab">지금 보는 학생</span>
          <b>{student.display_name}</b>
          {cls && <span className="cls">{cls}</span>}
          <span className="org">{org.org_name}</span>
        </div>
      </div>
      <div className="wrap pg-body pro rp">
        <div className="pro-sechd">{back}{svc.role !== "viewer" && !editing && <Link className="btn" href={`${self}&edit=1`}>학생 정보 수정</Link>}</div>
        {editing && svc.role !== "viewer" && <StudentForm orgId={svc.org_id} idem={crypto.randomUUID()} student={student} onDone={self} />}
        <ProfileView tags={student.tags} />

        <section className="pro-sec" aria-labelledby="score-h">
          <div className="pro-sechd">
            <h2 id="score-h">{title} 성적</h2>
          </div>
          {stage && <StageSteps stage={stage} finalOpen={stageOpen} />}
          {status ? (
            <div className="rp-rights">
              <b>이 학생의 입력</b>
              <span>
                최초 입력 남음 <b className="num">{status.initial_remaining}</b>회 · 정정(고객센터) 승인 남음 <b className="num">{Math.max(0, status.correction_granted - status.correction_used)}</b>회
              </span>
              {status.last_rejection_code && <span className="warn">지난 입력이 정상 계산되지 않았습니다(문의 번호 {status.last_rejection_code}). 정정은 고객센터에 요청해 주세요.</span>}
            </div>
          ) : (
            <p className="pro-note">{stage ? "이 학생의 입력 상태를 지금 확인할 수 없습니다. 입력을 열지 않았습니다." : "지금 입력 단계(모의평가·가채점·실채점)를 확인할 수 없어 입력을 열지 않았습니다. 잠시 뒤 다시 열어 주세요."}</p>
          )}
          {canInput && status && stage === "provisional" && (
            // 가채점 저장은 개인용과 같이 수능 뒤 서버 연결 전까지 값 검사만 하고 보내지 않는다(입력 횟수도 쓰지 않음)
            <ProvisionalForm examLabel={title} subject={student.display_name} />
          )}
          {canInput && status && stage !== "provisional" && stage && (
            <ScoreForm
              examLabel={title}
              kicker={stage === "final" ? "성적 입력 · 수능 실채점" : "성적 입력"}
              banner={stage === "final" ? "가채점 성적이 있으면 실채점 성적을 저장할 때 리포트가 실채점 기준으로 바뀝니다. 가채점 기록은 그대로 남습니다." : undefined}
              idem={crypto.randomUUID()}
              defaults={{}}
              submit={submitStudentScores}
              subject={student.display_name}
              hidden={{ org_id: svc.org_id, student_id: student.student_id, entry_version: String(status.entry_version), stage }}
            />
          )}
          {status && !stageOpen && stageSt && (
            <p className="pro-note">
              {stageSt.stage === "final" && stageSt.stage_state === "not_open"
                ? <><b>수능 성적표 입력은 {stageSt.opens_at ? seoulDateTime(stageSt.opens_at) : "성적표 배부 3일 뒤"}부터 열립니다.</b> 그 전까지는 가채점으로 예상 위치를 확인해 주세요.</>
                : "이 시험 단계는 지금 성적을 입력할 수 있는 기간이 아닙니다."}
            </p>
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
                리포트 <small className="pro-note">{a.exam.academic_year}학년도 {examTypeLabel(a.exam.exam_type)} 기준 {seoulDateTime(shown.created_at_utc)} 저장</small>
                {tagOf(shown) && <span className="rp-tag">{tagOf(shown)}</span>}
              </h2>
            </div>
            <OverallCard a={a} />
            <SubjectsSheet a={a} second={false} />
            <PositionChart a={a} />
                        <div className="pro-sechd">
              <Link className="btn" href={`/pro/students/${encodeURIComponent(student.student_id)}/print?org=${encodeURIComponent(svc.org_id)}&report=${encodeURIComponent(shown.report_id)}&rev=${shown.revision_id}`}>
                상담 리포트 인쇄·PDF
              </Link>
            </div>
          </section>
        )}

        {shown && a && (
          <section className="pro-sec" aria-labelledby="cand-h">
            <div className="pro-sechd">
              <h2 id="cand-h">유리한 대학 찾기</h2>
              {svc.role === "teacher" && !student.archived && (
                <ActionButton
                  act={findCandidates}
                  primary
                  label={shown.published_result.candidates ? "다시 찾기" : "이 학생에게 유리한 대학 찾기"}
                  busy="찾는 중…"
                  fields={{ org_id: svc.org_id, student_id: student.student_id, profile_id: shown.profile_id, profile_version: shown.profile_id, idem: crypto.randomUUID() }}
                />
              )}
            </div>
            {shown.published_result.candidates ? (
              <CandidatesView
                c={shown.published_result.candidates}
                shortlist={shown.published_result.shortlist ?? {}}
                fields={svc.role === "teacher" ? { org_id: svc.org_id, student_id: student.student_id, report_id: shown.report_id } : null}
                reasons={shown.counseling_reasons ?? []}
              />
            ) : (
              <p className="pro-note">아직 찾지 않았습니다. 저장한 성적으로 대학별 환산·유불리와 와일드카드 후보를 찾습니다.</p>
            )}
          </section>
        )}

        {shown && (
          <section className="pro-sec" aria-labelledby="picked-h">
            <h2 id="picked-h">담은 학교</h2>
            <PickedList shortlist={shown.published_result.shortlist ?? {}} analyses={shown.published_result.analyses ?? {}} names={names} reasons={shown.counseling_reasons ?? []} />
          </section>
        )}

        {reports.length > 0 && (
          <section className="pro-sec" aria-labelledby="hist-h">
            <h2 id="hist-h">저장한 리포트</h2>
            <ul className="pro-hist">
              {reports.map((r) => (
                <li key={`${r.report_id}-${r.revision_id}`}>
                  <span>
                    <span className="num">{seoulDateTime(r.created_at_utc)}</span> 저장
                    {tagOf(r) && <span className="rp-tag">{tagOf(r)}</span>}
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
