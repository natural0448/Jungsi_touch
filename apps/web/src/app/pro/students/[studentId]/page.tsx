import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "@/components/link";
import { ConnectionNotice } from "@/components/connection-notice";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller } from "@/lib/api";
import { currentStage } from "@/lib/pro-stage";
import { proSource, validId } from "@/lib/api/pro-source";
import type { ScoreInputStatusDto } from "@/lib/dto";
import { isProvisionalOverall } from "@/lib/dto";
import { EXAM, csatOpen, examTitle, examTypeLabel, proCsatEnabled, stageOf, type InputStage } from "@/lib/exam";
import { seoulDateTime } from "@/lib/format";
import type { ProOrganization, ProScoreStatusDto, ProStudentDto, ProStudentReportDto } from "@/lib/pro-dto";
import { proAccess } from "@/lib/pro-access";
import { studentHasMockReports } from "@/lib/past-mock";
import { inaccurateText } from "@/lib/score-validity";
import { MOCK_EXAM } from "@/lib/exam";

const EXAM_MOCK_ID = () => MOCK_EXAM.exam_id;
import { OverallCard, PositionChart, ProvisionalOverallCard, ProvisionalSubjectsSheet, SubjectsSheet } from "../../../reports/me/report-view";
import { ProvisionalForm } from "../../../reports/me/provisional-form";
import { ScoreForm } from "../../../reports/me/score-form";
import { StageSteps } from "../../../reports/me/stage-steps";
import { findCandidates, submitStudentProvisional, submitStudentScores } from "../../actions";
import { ActionButton } from "../../action-button";
import { CandidatesView, PickedList } from "../../candidates-view";
import { ProfileView } from "../../profile-view";
import { ChoiceGuideView, CounselPicked, CsatCandidates, guideOf } from "../../counsel-view";
import { counselSchools, csatRows, offeringIndex, pickedIds } from "@/lib/pro-counsel-view";
import { counselYears } from "@/lib/pro-counsel-data";
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
        // 고른 리포트가 없으면 지금 단계의 현재 성적 리포트, 없으면 가장 최근 리포트(전환 뒤 9월 리포트는 지난 기록으로 남는다)
        const want = reportParam && validId(reportParam) ? reportParam : (status?.current_report_id ?? reports[0]?.report_id);
        // 담은 학교(shortlist)는 리포트 읽기(pro.report.read)에만 지금 값이 붙는다. 목록 항목은 저장 당시 값이라 담기가 보이지 않았다(2026-11-23)
        shown = want ? ((await src.readReport(caller, svc.org_id, studentId, want)) ?? reports.find((r) => r.report_id === want) ?? null) : null;
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
  const provisional = isProvisionalOverall(a);
  // 전문가용 학생 가채점 입력: 서버가 원점수 pro.score.create 를 아는 배포 뒤(JUNGSI_PRO_CSAT_ENABLED=1)·전환 시각 뒤에만 연다
  const proCsat = proCsatEnabled() && csatOpen();
  // 수능 가채점 전환 뒤 9월 모의평가 리포트는 지난 기록(읽기 전용)
  // 9월 리포트가 있는 학생에게만 '지난 기록' 표시가 보인다(2026-11-22 대표님 요청)
  const pastMock = csatOpen() && studentHasMockReports(reports, EXAM_MOCK_ID());
  const pastOf = (r: ProStudentReportDto) => pastMock && stageOf(r.stage) === "mock";
  // 판 번호 대신 꼬리표(2026-10-28, 2026-11-04 사용자 결정): 서버 입력 상태의 current_report_id 리포트 중 가장 최근 판이 현재 성적이다.
  // 정정을 모두 썼으면 개인용 2페이지와 같은 '정정 입력 횟수 소진', 아니면 '현재 성적'(교사는 학생의 예전 판도 고르므로 남긴다). 판 번호는 열기·인쇄 주소에만 쓴다
  const curRev = Math.max(0, ...reports.filter((r) => r.report_id === status?.current_report_id).map((r) => r.revision_id));
  const tagOf = (r: { report_id: string; revision_id: number }) =>
    status && r.report_id === status.current_report_id && r.revision_id === curRev ? (status.correction_used > 0 && status.correction_used >= status.correction_granted ? "정정 입력 횟수 소진" : "현재 성적") : null;
  // 담은 학교의 이름은 같은 판의 후보 목록에서 찾는다(별도 조회 없음)
  // 가채점 학교별 판정(서버 dep_pro_r27, source g). 없으면 빈 목록 → '가채점 판정 준비 중'
  const csat = provisional ? csatRows(shown?.published_result.candidates) : [];
  const pickedList = shown ? pickedIds(shown.published_result.shortlist) : [];
  const known = offeringIndex(shown?.published_result.candidates);
  // 상담 팁의 지난 학년도 문장(1페이지 정리본, 서비스 API 를 부르지 않는다). 읽지 못하면 그 문장만 빠진다
  const years = shown && pickedList.length
    ? await counselYears(pickedList.flatMap((id) => (known.get(id) ? [{ offering_id: id, university_name: known.get(id)!.university_name }] : []))).catch(() => ({}))
    : {};
  const counsel = shown ? counselSchools(shown.published_result, provisional, pickedList, years) : [];
  const guide = guideOf(counsel);
  const printHref = shown ? `/pro/students/${encodeURIComponent(student.student_id)}/print?org=${encodeURIComponent(svc.org_id)}&report=${encodeURIComponent(shown.report_id)}&rev=${shown.revision_id}` : "";
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
              {status.last_rejection_code && (
                stage && stage !== "mock" ? (
                  // 부정확 입력(2026-11-22 대표님 결정): 학생 이름으로 같은 문구. 정정은 고객센터 승인(전문가용)
                  <span className="warn">{inaccurateText(student.display_name)}. 정정은 고객센터에 요청해 주세요. (문의 번호 {status.last_rejection_code})</span>
                ) : (
                  <span className="warn">지난 입력이 정상 계산되지 않았습니다(문의 번호 {status.last_rejection_code}). 정정은 고객센터에 요청해 주세요.</span>
                )
              )}
            </div>
          ) : (
            <p className="pro-note">{stage ? "이 학생의 입력 상태를 지금 확인할 수 없습니다. 입력을 열지 않았습니다." : "지금 입력 단계(모의평가·가채점·실채점)를 확인할 수 없어 입력을 열지 않았습니다. 잠시 뒤 다시 열어 주세요."}</p>
          )}
          {canInput && status && stage === "provisional" && !proCsat && (
            // 서버가 원점수 pro.score.create 를 알기 전에는 열지 않는다. 개인용 가채점 저장 동작(본인 계정)은 여기서 절대 쓰지 않는다
            // — 학생 성적이 교사 개인 계정에 저장되는 일을 막는다(2026-11-21)
            <p className="pro-note">전문가용 학생 가채점 원점수 입력은 학생별 입력권과 함께 따로 엽니다. 저장한 학생 리포트와 담은 학교는 아래에서 그대로 볼 수 있습니다.</p>
          )}
          {canInput && status && stage === "provisional" && proCsat && (
            // 개인용과 같은 원점수 양식. 저장은 이 학생의 pro.score.create(stage provisional)로만 간다(submitStudentProvisional)
            <ProvisionalForm
              examLabel={title}
              idem={crypto.randomUUID()}
              submit={submitStudentProvisional}
              subject={student.display_name}
              hidden={{ org_id: svc.org_id, student_id: student.student_id, entry_version: String(status.entry_version) }}
            />
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
                : stageSt.stage === "provisional" && stageSt.stage_state === "not_open"
                  ? <><b>수능 가채점 입력은 {stageSt.opens_at ? seoulDateTime(stageSt.opens_at) : "11월 23일"}부터 열립니다.</b></>
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
                {pastOf(shown) && <span className="rp-tag">지난 기록 · 읽기 전용</span>}
              </h2>
            </div>
            {pastOf(shown) && <p className="pro-note">9월 모의평가 성적 입력은 수능 가채점 전환과 함께 끝났습니다. 저장한 9월 리포트는 그대로 볼 수 있고, 고치거나 새로 입력할 수는 없습니다.</p>}
            {provisional ? (
              <>
                <ProvisionalOverallCard a={a} />
                <ProvisionalSubjectsSheet a={a} />
              </>
            ) : (
              <>
                <OverallCard a={a} />
                <SubjectsSheet a={a} second={false} />
                <PositionChart a={a} />
              </>
            )}
            {/* 학생용(지금 인쇄 그대로)·선생님용(학교마다 상담 팁·최종 3개 선택 가이드, 2026-11-22 대표님 결정) */}
            <div className="pro-sechd">
              <Link className="btn" href={printHref}>학생용 리포트 인쇄·PDF</Link>
              <Link className="btn" href={`${printHref}&view=teacher`}>선생님용 리포트 인쇄·PDF</Link>
            </div>
          </section>
        )}

        {shown && a && provisional && (
          <section className="pro-sec" aria-labelledby="cand-h">
            <div className="pro-sechd">
              <h2 id="cand-h">유리한 대학 찾기 <small className="pro-note">수능 가채점 기준</small></h2>
              {/* 가채점 학교별 7단계(서버 dep_pro_r27). 판정이 없을 때만 찾기 버튼 — 서버가 아직 못 내면 409 로 돌아와 아래 문구가 남는다 */}
              {svc.role === "teacher" && !student.archived && csat.length === 0 && proCsatEnabled() && (
                <ActionButton
                  act={findCandidates}
                  primary
                  label="이 학생에게 유리한 대학 찾기"
                  busy="찾는 중…"
                  fields={{ org_id: svc.org_id, student_id: student.student_id, profile_id: shown.profile_id, profile_version: shown.profile_id, idem: crypto.randomUUID() }}
                />
              )}
            </div>
            {csat.length > 0 ? (
              <CsatCandidates
                rows={csat}
                shortlist={shown.published_result.shortlist ?? {}}
                fields={svc.role === "teacher" && !student.archived ? { org_id: svc.org_id, student_id: student.student_id, report_id: shown.report_id } : null}
              />
            ) : (
              <p className="pro-note"><b>가채점 판정 준비 중</b> — 가채점 성적으로 학교별 판정을 아직 만들지 못했습니다. {svc.role === "teacher" && !student.archived ? "위 버튼으로 한 번 찾아 주세요. 그래도 안 되면 잠시 뒤 다시 열어 주세요." : "담당 교사가 찾으면 여기에 보입니다."} 담아 둔 학교는 그대로 남아 있습니다.</p>
            )}
          </section>
        )}

        {shown && a && !provisional && (
          <section className="pro-sec" aria-labelledby="cand-h">
            <div className="pro-sechd">
              <h2 id="cand-h">유리한 대학 찾기</h2>
              {/* 성적 저장 때 자동으로 한 번 찾는다(2026-11-13 결정). 같은 성적이면 결과가 같아 '다시 찾기'는 두지 않고,
                  자동 찾기가 실패해 결과가 없을 때만 버튼을 보인다 */}
              {svc.role === "teacher" && !student.archived && !shown.published_result.candidates && (
                <ActionButton
                  act={findCandidates}
                  primary
                  label="이 학생에게 유리한 대학 찾기"
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
              <p className="pro-note">
                {svc.role === "teacher" && !student.archived
                  ? "아직 대학 후보가 없습니다. 성적을 저장할 때 자동으로 찾는데, 이번에는 끝나지 않았습니다. 위 버튼을 한 번 눌러 주세요."
                  : "아직 대학 후보가 없습니다. 담당 교사가 성적을 저장하면 자동으로 찾습니다."}
              </p>
            )}
          </section>
        )}

        {shown && guide && (
          <section className="pro-sec" aria-labelledby="guide-h">
            <h2 id="guide-h">최종 3개 선택 가이드 <small className="pro-note">가·나·다군 하나씩 고를 때</small></h2>
            <ChoiceGuideView g={guide} />
          </section>
        )}

        {shown && provisional && (
          <section className="pro-sec" aria-labelledby="picked-h">
            <h2 id="picked-h">담은 학교 <small className="pro-note">줄 아래 &lsquo;상담 팁&rsquo;을 펼치면 학교별 안내가 보입니다</small></h2>
            <CounselPicked schools={counsel} missing={pickedList.filter((id) => !known.has(id))} fields={svc.role === "teacher" && !student.archived ? { org_id: svc.org_id, student_id: student.student_id, report_id: shown.report_id } : null} />
          </section>
        )}

        {shown && !provisional && (
          <section className="pro-sec" aria-labelledby="picked-h">
            <h2 id="picked-h">담은 학교</h2>
            <PickedList shortlist={shown.published_result.shortlist ?? {}} analyses={shown.published_result.analyses ?? {}} names={names} reasons={shown.counseling_reasons ?? []} fields={svc.role === "teacher" && !student.archived ? { org_id: svc.org_id, student_id: student.student_id, report_id: shown.report_id } : null} />
          </section>
        )}

        {reports.length > 0 && (
          <section className="pro-sec" aria-labelledby="hist-h">
            <h2 id="hist-h">저장한 리포트</h2>
            <ul className="pro-hist">
              {/* 같은 리포트의 판(저장·판정 계산마다 오른다)은 한 줄로(2026-11-23: 가채점 저장 직후 같은 시각 줄이 두 번 보였다).
                  '열기'는 리포트 번호로만 열고, 목록은 최신 판이 먼저 온다 */}
              {reports.filter((r, i) => reports.findIndex((x) => x.report_id === r.report_id) === i).map((r) => (
                <li key={r.report_id}>
                  <span>
                    <span className="num">{seoulDateTime(r.created_at_utc)}</span> 저장 · {r.stage === "provisional" ? "수능 가채점" : r.stage === "final" ? "수능 실채점" : "9월 모의평가"}
                    {tagOf(r) && <span className="rp-tag">{tagOf(r)}</span>}
                    {pastOf(r) && <span className="rp-tag">지난 기록</span>}
                  </span>
                  {shown?.report_id === r.report_id ? (
                    <span className="cur">보는 중</span>
                  ) : (
                    <Link className="btn" href={`${self}&report=${encodeURIComponent(r.report_id)}`}>열기</Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* '추가한 날'은 뺀다(2026-11-13 최종관리자 결정). 학생 번호는 고객센터 문의용으로만 작게 남긴다 */}
        <p className="pro-note pro-sid">학생 번호 {student.student_id} · 고객센터 문의 때 알려 주세요</p>
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
