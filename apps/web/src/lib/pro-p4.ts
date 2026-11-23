import { CSAT_INCOMPLETE_TTL_MS, csatBandsIncomplete } from "@/lib/report-pure";
import "server-only";
import { AccessDenied, ConnectionError, type Caller } from "@/lib/api";
import { proSource, validId } from "@/lib/api/pro-source";
import type { CatalogSearchDto, OfferingDto, ReferenceBandDto, ReferenceUniversityGroupDto, ReportDto } from "@/lib/dto";
import { EXAM, stageOf, type InputStage } from "@/lib/exam";
import type { ProOrganization, ProP4Search, ProScoreStatusDto, ProStudentDto, ProStudentReportDto } from "@/lib/pro-dto";
import { proAccess, type ProOrg } from "@/lib/pro-access";
import { currentStage } from "@/lib/pro-stage";

/*
  전문가용 학생 탭(① 성적 입력 ② 유리한 대학 찾기 ③ 전체 대학·학과 가능성 보기 ④ 정시 리포트, 2026-11-23 대표님 결정)이
  함께 쓰는 '지금 보는 학생' 읽기와 ③ 가채점 판정·검색(서버 dep_pro_r28 pro.university.analyze).
  - 기관은 본체 jeongsi_pro_access(계약 구성원) 와 전문가용 서버 세션 둘 다에서 확인한다. 다른 기관·담당 아닌 학생은 서버가 404.
  - 리포트는 지금 입력 단계의 현재 리포트(없으면 가장 최근). 담은 학교는 pro.report.read(지금 담은 값)로 읽는다.
*/
export interface ProStudentView {
  org: ProOrg;
  svc: ProOrganization;
  student: ProStudentDto;
  stage: InputStage | null;
  status: ProScoreStatusDto | null;
  reports: ProStudentReportDto[];
  shown: ProStudentReportDto | null;
  /** shown 의 리포트(개인용 화면 코드에 그대로 넘기는 모양). 담은 학교(shortlist)는 지금 값 */
  report: ReportDto | null;
  /** 선생님이 이 학생의 담기·별표를 바꿀 수 있는가(담당 교사·보관 안 된 학생) */
  canEdit: boolean;
}

export type ProStudentLoad =
  | { kind: "ok"; view: ProStudentView }
  | { kind: "not_found" }
  | { kind: "connection"; error: ConnectionError };

export async function loadProStudent(caller: Caller, orgParam: string, studentId: string, reportParam = ""): Promise<ProStudentLoad> {
  const orgs = await proAccess();
  const org = orgs?.find((o) => String(o.org_id) === orgParam);
  if (!org || !validId(studentId)) return { kind: "not_found" };
  const src = proSource();
  try {
    const stageP = currentStage(caller);
    const svc = (await src.session(caller)).organizations.find((o) => o.org_id === String(org.org_id));
    if (!svc) return { kind: "not_found" };
    const student = await src.readStudent(caller, svc.org_id, studentId);
    if (!student) return { kind: "not_found" };
    const stageSt = await stageP;
    const stage = stageSt ? stageOf(stageSt.stage) : null;
    const status = stage ? await src.scoreStatus(caller, svc.org_id, studentId, EXAM.exam_id, EXAM.pack_version, stage) : null;
    const reports = (await src.listReports(caller, svc.org_id, studentId)).items;
    const want = reportParam && validId(reportParam) ? reportParam : (status?.current_report_id ?? reports[0]?.report_id);
    const shown = want ? ((await src.readReport(caller, svc.org_id, studentId, want)) ?? reports.find((r) => r.report_id === want) ?? null) : null;
    const report = shown ? reportOf(shown) : null;
    return { kind: "ok", view: { org, svc, student, stage, status, reports, shown, report, canEdit: svc.role === "teacher" && !student.archived } };
  } catch (e) {
    if (e instanceof ConnectionError) return { kind: "connection", error: e };
    if (e instanceof AccessDenied) return { kind: "not_found" };
    throw e;
  }
}

/**
 * 담기·별표 버튼용 가벼운 읽기(2026-11-23: 담기 응답이 14초 — 입력 단계·리포트 목록까지 읽었다).
 * 기관·학생(담당·보관 여부)과 버튼이 보낸 리포트 하나만 읽는다. 리포트는 지금 담은 값이 붙은 pro.report.read.
 */
export async function loadProForAction(caller: Caller, orgParam: string, studentId: string, reportId: string): Promise<ProStudentLoad> {
  const orgs = await proAccess();
  const org = orgs?.find((o) => String(o.org_id) === orgParam);
  if (!org || !validId(studentId) || !validId(reportId)) return { kind: "not_found" };
  const src = proSource();
  try {
    const [session, student] = await Promise.all([src.session(caller), src.readStudent(caller, String(org.org_id), studentId)]);
    const svc = session.organizations.find((o) => o.org_id === String(org.org_id));
    if (!svc || !student) return { kind: "not_found" };
    const shown = await src.readReport(caller, svc.org_id, studentId, reportId);
    const report = shown ? reportOf(shown) : null;
    return { kind: "ok", view: { org, svc, student, stage: null, status: null, reports: shown ? [shown] : [], shown, report, canEdit: svc.role === "teacher" && !student.archived } };
  } catch (e) {
    if (e instanceof ConnectionError) return { kind: "connection", error: e };
    if (e instanceof AccessDenied) return { kind: "not_found" };
    throw e;
  }
}

/** 전문가용 리포트 → 개인용 화면 코드가 읽는 리포트 모양 */
export function reportOf(r: ProStudentReportDto): ReportDto {
  return { ...r.published_result, report_id: r.report_id, report_version: r.revision_id, profile_id: r.profile_id };
}

/** 학생 탭 주소(기관 번호를 늘 붙인다) */
export function proTabHref(orgId: string, studentId: string, tab: "" | "favorable" | "possibilities" | "report", extra = ""): string {
  const base = `/pro/students/${encodeURIComponent(studentId)}${tab ? `/${tab}` : ""}`;
  return `${base}?org=${encodeURIComponent(orgId)}${extra ? `&${extra}` : ""}`;
}

/* ── ③ 가채점 판정·검색 ── */
const TTL_MS = 15 * 60_000, MAX = 300;
const memo = new Map<string, { at: number; v: P4Result; ttl: number }>();
export interface P4Result {
  search: CatalogSearchDto<OfferingDto> | null;
  bands: Record<string, ReferenceBandDto>;
  /** 서버가 준 학교별 판정 묶음 그대로(④ 정시 리포트가 담은 학교의 이름·판정·위치를 채울 때) */
  groups: ReferenceUniversityGroupDto[];
  /** 서버가 답하지 못했다(연결·한도·준비 안 됨). 검색 모드면 화면이 차분한 안내 한 줄로 바꾼다 */
  failed: string | null;
}
const BAND_CODES = new Set(["stable", "downward", "target", "aspirational", "upward", "challenge", "outside"]);

async function keyOf(parts: unknown): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts))));
  const h = Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * 검색 조건 또는 모집단위 번호(30개까지)로 이 학생의 학교별 가채점 판정을 받는다. 같은 학생·리포트·요청은 15분 메모.
 * 서버는 판정을 리포트에 저장하지 않는다(개인용 4페이지와 같다).
 */
export async function proP4(caller: Caller, v: ProStudentView, req: { offering_ids?: string[]; search?: ProP4Search }): Promise<P4Result> {
  const shown = v.shown;
  if (!shown) return { search: null, bands: {}, groups: [], failed: "no_report" };
  const body = { profile_id: shown.profile_id, expected_profile_version: shown.profile_id, ...req };
  const mk = JSON.stringify([v.svc.org_id, v.student.student_id, shown.report_id, shown.profile_id, req]);
  const hit = memo.get(mk);
  if (hit && Date.now() - hit.at <= hit.ttl) return hit.v;
  let out: P4Result;
  try {
    let r = await proSource().analyzeP4(caller, v.svc.org_id, v.student.student_id, body, await keyOf(["p4", mk]));
    // 서버(dep_pro_r32)가 곡선·총점 분포를 시간 안에 다 못 읽었으면 complete=false. 잠시 뒤 한 번만 다른 키로 다시 받는다(2026-11-23)
    if (r.ok && r.value.candidates?.reference_threshold_summary?.complete === false) {
      await new Promise((res) => setTimeout(res, 1500));
      const again = await proSource().analyzeP4(caller, v.svc.org_id, v.student.student_id, body, await keyOf(["p4", mk, "again"])).catch(() => null);
      if (again?.ok) r = again;
    }
    if (!r.ok) {
      out = { search: null, bands: {}, groups: [], failed: r.code };
    } else {
      const bands: Record<string, ReferenceBandDto> = {};
      for (const g of r.value.candidates?.reference_university_groups ?? []) {
        for (const it of g.offerings ?? []) {
          const b = it.reference_band;
          const id = it.offering?.offering_id;
          if (typeof id === "string" && b && b.basis === "reference_threshold" && b.source === "g" && BAND_CODES.has(b.code)) bands[id] = b;
        }
      }
      out = { search: r.value.search ?? null, bands, groups: r.value.candidates?.reference_university_groups ?? [], failed: null };
    }
  } catch (e) {
    if (e instanceof ConnectionError || e instanceof AccessDenied) out = { search: null, bands: {}, groups: [], failed: e.code };
    else throw e;
  }
  if (out.failed) {
    // 운영 확인용(성적·학생 이름 없음): 실패 사유 코드만
    try {
      console.info(`[pro-p4] failed code=${out.failed} mode=${req.search ? "search" : "ids"}`);
    } catch {
      // 기록 실패는 화면에 영향 없음
    }
  } else {
    memo.delete(mk);
    // 위치·유불리가 덜 찬 결과(서버가 곡선을 아직 다 못 읽음)는 짧게만 기억한다(2026-11-23)
    memo.set(mk, { at: Date.now(), v: out, ttl: csatBandsIncomplete(out.bands) ? CSAT_INCOMPLETE_TTL_MS : TTL_MS });
    while (memo.size > MAX) memo.delete(memo.keys().next().value as string);
  }
  return out;
}
