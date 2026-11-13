"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccessDenied, ConnectionError, getCaller } from "@/lib/api";
import { emptyProfile, PROFILE_FIELDS, profileProblem, profileToTags, splitItems } from "@/lib/pro-profile";
import { proSource, validId } from "@/lib/api/pro-source";
import type { ScoresInput } from "@/lib/dto";
import { EXAM } from "@/lib/exam";
import type { ProPrintDto, ProStudentInput } from "@/lib/pro-dto";
import type { ScoreFormState } from "../reports/me/actions";
import type { ScoreDefaults } from "../reports/me/score-form";

export type StudentFormState = { error: string; values: Record<string, string> } | null;

const MESSAGE: Record<string, string> = {
  student_seat_limit_reached: "계약한 학생 수를 모두 사용했습니다. 학생을 더 추가하려면 기관 관리자에게 계약 학생 수 조정을 요청해 주세요.",
  expected_version_changed: "다른 화면에서 먼저 바뀌었습니다. 화면을 새로 고친 뒤 다시 저장해 주세요.",
  contract_expired: "기관 계약 기간이 끝나 학생을 추가·수정할 수 없습니다.",
  role_not_allowed: "이 역할로는 학생을 추가·수정할 수 없습니다(열람 전용).",
  not_found: "학생을 찾지 못했습니다.",
  invalid_request: "입력 칸을 다시 확인해 주세요.",
};

/**
 * 폼 → 학생 입력. 이름 필수(실명 허용), 반·번호·상담 참고는 선택. 연락처·주민번호 칸은 두지 않는다.
 * 상담 참고(희망 계열·전공·대학·지역·기타, 항목마다 5개까지)는 서버 태그에 항목 하나씩 담는다(lib/pro-profile).
 * 메모 칸은 2026-11-13 최종관리자 결정으로 뺐다 — 보내지 않으므로 예전에 적은 메모는 서버에 그대로 남는다.
 */
function parse(fd: FormData): { input: ProStudentInput; values: Record<string, string> } | { error: string; values: Record<string, string> } {
  const keys = ["display_name", "class_label", "class_number", ...PROFILE_FIELDS.map((f) => `p_${f.key}`)];
  const values = Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? "").trim()]));
  const name = values.display_name;
  if (!name || name.length > 40) return { error: "학생 이름을 1~40자로 넣어 주세요.", values };
  if (values.class_label.length > 20) return { error: "반은 20자 안으로 넣어 주세요.", values };
  if (values.class_number && !/^\d{1,3}$/.test(values.class_number)) return { error: "번호는 숫자로 넣어 주세요.", values };
  const profile = emptyProfile();
  for (const f of PROFILE_FIELDS) profile[f.key] = splitItems(values[`p_${f.key}`]);
  const problem = profileProblem(profile);
  if (problem) return { error: problem, values };
  return { input: { display_name: name, class_label: values.class_label || null, class_number: values.class_number || null, tags: profileToTags(profile) }, values };
}

function failText(e: unknown): string | null {
  if (e instanceof AccessDenied) return e.status === 401 ? "로그인이 필요합니다. 다시 로그인해 주세요." : MESSAGE[e.code] ?? `권한이 없어 처리하지 못했습니다. (문의 번호 ${e.code})`;
  if (e instanceof ConnectionError) return e.kind === "rate_limited" ? "요청이 겹쳐 잠시 제한되었습니다. 몇 초 뒤 다시 저장해 주세요. 입력한 값은 그대로 남아 있습니다." : `정시터치 서버에 연결할 수 없어 저장하지 못했습니다. (문의 번호 ${e.code})`;
  return null;
}

async function back(path: string): Promise<never> {
  const viaJs = (await headers()).has("next-action");
  redirect(viaJs ? path : `/jeongsi${path}`);
}

/** 학생 추가: 좌석 소모와 생성은 서버가 같은 경계에서 처리한다. 같은 화면에서 두 번 눌러도 같은 요청 키라 한 명만 생긴다 */
export async function createStudent(_prev: StudentFormState, fd: FormData): Promise<StudentFormState> {
  const orgId = String(fd.get("org_id") ?? "");
  const key = String(fd.get("idem") ?? "");
  const cv = Number(fd.get("contract_version"));
  const p = parse(fd);
  if ("error" in p) return p;
  if (!validId(orgId) || !/^[0-9a-f-]{36}$/i.test(key) || !Number.isSafeInteger(cv)) return { error: "화면을 새로 고친 뒤 다시 저장해 주세요.", values: p.values };
  let studentId: string;
  try {
    const r = await proSource().createStudent(await getCaller(), orgId, p.input, cv, key);
    if (!r.ok) return { error: MESSAGE[r.code] ?? `저장하지 못했습니다. (문의 번호 ${r.code})`, values: p.values };
    studentId = r.value.student_id;
  } catch (e) {
    const t = failText(e);
    if (t) return { error: t, values: p.values };
    throw e;
  }
  return back(`/pro/students/${encodeURIComponent(studentId)}?org=${encodeURIComponent(orgId)}`);
}

/** 학생 정보 수정(이름·반·번호·태그·메모). 다른 화면이 먼저 바꿨으면 409 로 막힌다 */
export async function updateStudent(_prev: StudentFormState, fd: FormData): Promise<StudentFormState> {
  const orgId = String(fd.get("org_id") ?? "");
  const studentId = String(fd.get("student_id") ?? "");
  const key = String(fd.get("idem") ?? "");
  const v = Number(fd.get("version"));
  const p = parse(fd);
  if ("error" in p) return p;
  if (!validId(orgId) || !validId(studentId) || !/^[0-9a-f-]{36}$/i.test(key) || !Number.isSafeInteger(v)) return { error: "화면을 새로 고친 뒤 다시 저장해 주세요.", values: p.values };
  try {
    const r = await proSource().updateStudent(await getCaller(), orgId, studentId, p.input, v, key);
    if (!r.ok) return { error: MESSAGE[r.code] ?? `저장하지 못했습니다. (문의 번호 ${r.code})`, values: p.values };
  } catch (e) {
    const t = failText(e);
    if (t) return { error: t, values: p.values };
    throw e;
  }
  return back(`/pro/students/${encodeURIComponent(studentId)}?org=${encodeURIComponent(orgId)}`);
}

const SCORE_MESSAGE: Record<string, string> = {
  input_right_exhausted: "이 학생은 이 시험 단계의 성적 입력 1회를 이미 사용했습니다. 정정은 고객센터에 요청해 주세요.",
  expected_version_changed: "다른 화면에서 이 학생의 성적이 먼저 저장되었습니다. 화면을 새로 고쳐 확인해 주세요.",
  professional_student_archived: "보관된 학생이라 성적을 저장할 수 없습니다.",
  pack_version_mismatch: "시험 자료가 새로 바뀌었습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.",
};
/** 성적표에 없는 점수 등 정상 거절(입력 1회 사용) — 서버 SCORE_CONTENT_REJECTION_CODES */
const CONTENT_REJECTIONS = new Set(["unobserved_standard_score", "invalid_score", "invalid_integer", "invalid_grade", "invalid_reported_grade", "invalid_reported_percentile", "reported_grade_conflict", "reported_percentile_conflict"]);

/**
 * 전문가용 학생 성적 저장 → 전체 위치 → 유리한 대학 찾기(자동 1회). 학생×시험×단계 입력 1회(개인용과 같은 규칙). 같은 화면에서 두 번 눌러도
 * 같은 요청 키라 한 번만 저장된다. 성적은 저장됐는데 분석만 못 했으면 그 사실을 알리고 다시 저장하지 말라고 한다.
 * 유리한 대학 찾기는 같은 성적이면 결과가 같으므로 저장 때 한 번만 계산한다(2026-11-13 최종관리자 결정: '다시 찾기' 없음,
 * 계산 횟수 = 학생·단계당 입력 1 + 정정 1). 이 단계만 실패하면 저장·전체 위치는 그대로 두고 학생 화면의 '찾기' 버튼으로 한 번 더 할 수 있다
 */
export async function submitStudentScores(prev: ScoreFormState, fd: FormData): Promise<ScoreFormState> {
  const int = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? undefined : Number(v);
  };
  const values: ScoreDefaults = {
    korean_choice: String(fd.get("korean_choice") ?? "") || undefined, korean: int("korean"),
    math_choice: String(fd.get("math_choice") ?? "") || undefined, math: int("math"),
    inq1: String(fd.get("inq1") ?? "") || undefined, inq1_score: int("inq1_score"),
    inq2: String(fd.get("inq2") ?? "") || undefined, inq2_score: int("inq2_score"),
    english: int("english"), history: int("history"),
  };
  const fail = (error: string, field?: string): ScoreFormState => ({ error, field, values, attempt: (prev?.attempt ?? 0) + 1 });
  const orgId = String(fd.get("org_id") ?? ""), studentId = String(fd.get("student_id") ?? ""), key = String(fd.get("idem") ?? "");
  const entry = Number(fd.get("entry_version")), stage = String(fd.get("stage") ?? "");
  if (!validId(orgId) || !validId(studentId) || !/^[0-9a-f-]{36}$/i.test(key) || !Number.isSafeInteger(entry) || !["mock", "provisional", "final"].includes(stage)) return fail("화면을 새로 고친 뒤 다시 저장해 주세요.");
  const ks = values.korean, ms = values.math, i1 = values.inq1_score, i2 = values.inq2_score;
  if ([ks, ms, i1, i2].some((v) => v === undefined || Number.isNaN(v)) || !values.inq1 || !values.inq2) return fail("국어·수학·탐구 두 과목의 표준점수를 모두 넣어 주세요.");
  if (fd.get("confirm") !== "on") return fail("저장 전 확인 창에서 학생 이름과 점수를 확인하고 '이대로 저장'을 눌러 주세요.", "confirm");
  const scores: ScoresInput = {
    exam_id: EXAM.exam_id,
    pack_version: EXAM.pack_version,
    korean: { standard_score: ks!, ...(values.korean_choice ? { choice: values.korean_choice } : {}) },
    math: { standard_score: ms!, ...(values.math_choice ? { choice: values.math_choice } : {}) },
    inquiry: [{ subject: values.inq1, standard_score: i1! }, { subject: values.inq2, standard_score: i2! }],
    ...(values.english !== undefined ? { english_grade: values.english } : {}),
    ...(values.history !== undefined ? { korean_history_grade: values.history } : {}),
  };
  const caller = await getCaller();
  const src = proSource();
  let step = "성적 저장";
  try {
    const saved = await src.createScore(caller, orgId, studentId, { exam_id: EXAM.exam_id, pack_version: EXAM.pack_version, stage, scores, expected_entry_version: entry }, `${key}:profile`);
    if (!saved.ok) {
      if (saved.status === 422 && CONTENT_REJECTIONS.has(saved.code)) return fail(`실제 성적표의 표준점수를 입력하지 않아 정상적인 계산이 불가능합니다. 이 학생의 입력 1회가 사용되었습니다. 정정은 고객센터에 요청해 주세요. (문의 번호 ${saved.code})`);
      return fail(SCORE_MESSAGE[saved.code] ?? MESSAGE[saved.code] ?? `저장하지 못했습니다. (문의 번호 ${saved.code})`);
    }
    step = "전체 분석";
    const p = saved.value.profile;
    const r = await src.analyzeOverall(caller, orgId, studentId, p.profile_id, p.profile_version, `${key}:overall`);
    if (!r.ok) return fail(`성적은 저장됐지만 전체 분석을 완료하지 못했습니다. 같은 성적을 다시 저장하지 말고 잠시 뒤 학생 화면을 다시 열어 주세요. (문의 번호 ${r.code})`);
    step = "대학 찾기";
    // 실패해도 저장·전체 위치는 끝났다. 학생 화면에 '찾기' 버튼이 남아 한 번 더 할 수 있다
    await src.candidates(caller, orgId, studentId, p.profile_id, p.profile_id, `${key}:candidates`).catch(() => null);
  } catch (e) {
    if (step === "전체 분석" && (e instanceof AccessDenied || e instanceof ConnectionError)) return fail(`성적은 저장됐지만 전체 분석을 완료하지 못했습니다. 같은 성적을 다시 저장하지 마세요. (문의 번호 ${e.code})`);
    const t = failText(e);
    if (t) return fail(t);
    throw e;
  }
  return back(`/pro/students/${encodeURIComponent(studentId)}?org=${encodeURIComponent(orgId)}`);
}

export type ProActionState = { error: string } | null;

/** 유리한 대학 찾기: 지금 학생의 최근 성적(profile)으로 pro.candidates. 결과는 새 리포트 판에 남는다 */
export async function findCandidates(_prev: ProActionState, fd: FormData): Promise<ProActionState> {
  const orgId = String(fd.get("org_id") ?? ""), studentId = String(fd.get("student_id") ?? ""), profileId = String(fd.get("profile_id") ?? "");
  const pv = String(fd.get("profile_version") ?? ""), key = String(fd.get("idem") ?? "");
  if (!validId(orgId) || !validId(studentId) || !validId(profileId) || !pv || !/^[0-9a-f-]{36}$/i.test(key)) return { error: "화면을 새로 고친 뒤 다시 눌러 주세요." };
  try {
    const r = await proSource().candidates(await getCaller(), orgId, studentId, profileId, /^\d+$/.test(pv) ? Number(pv) : pv, key);
    if (!r.ok) return { error: r.code === "initial_overall_report_required" ? "먼저 전체 위치 리포트를 만든 뒤 찾을 수 있습니다." : `대학을 찾지 못했습니다. (문의 번호 ${r.code})` };
  } catch (e) {
    const t = failText(e);
    if (t) return { error: t };
    throw e;
  }
  return back(`/pro/students/${encodeURIComponent(studentId)}?org=${encodeURIComponent(orgId)}`);
}

/** 학생별 담기(찜). 고정된 리포트 판에 결속된다 */
export async function addStudentBookmark(_prev: ProActionState, fd: FormData): Promise<ProActionState> {
  const orgId = String(fd.get("org_id") ?? ""), studentId = String(fd.get("student_id") ?? ""), reportId = String(fd.get("report_id") ?? "");
  const offeringId = String(fd.get("offering_id") ?? ""), key = String(fd.get("idem") ?? "");
  if (!validId(orgId) || !validId(studentId) || !validId(reportId) || !validId(offeringId) || !/^[0-9a-f-]{36}$/i.test(key)) return { error: "화면을 새로 고친 뒤 다시 눌러 주세요." };
  try {
    const r = await proSource().addBookmark(await getCaller(), orgId, studentId, reportId, offeringId, key);
    if (!r.ok) return { error: `담지 못했습니다. (문의 번호 ${r.code})` };
  } catch (e) {
    const t = failText(e);
    if (t) return { error: t };
    throw e;
  }
  return back(`/pro/students/${encodeURIComponent(studentId)}?org=${encodeURIComponent(orgId)}`);
}

/** 담은 학교 빼기(2026-11-13, pro.bookmark.remove). 서버는 지우지 않고 뺀 기록을 쌓는다. 이미 빠졌으면 그대로 돌아간다 */
export async function removeStudentBookmark(_prev: ProActionState, fd: FormData): Promise<ProActionState> {
  const orgId = String(fd.get("org_id") ?? ""), studentId = String(fd.get("student_id") ?? ""), reportId = String(fd.get("report_id") ?? "");
  const offeringId = String(fd.get("offering_id") ?? ""), key = String(fd.get("idem") ?? "");
  if (!validId(orgId) || !validId(studentId) || !validId(reportId) || !validId(offeringId) || !/^[0-9a-f-]{36}$/i.test(key)) return { error: "화면을 새로 고친 뒤 다시 눌러 주세요." };
  try {
    const r = await proSource().removeBookmark(await getCaller(), orgId, studentId, reportId, offeringId, key);
    if (!r.ok && r.code !== "professional_bookmark_not_found") return { error: `빼지 못했습니다. (문의 번호 ${r.code})` };
  } catch (e) {
    const t = failText(e);
    if (t) return { error: t };
    throw e;
  }
  return back(`/pro/students/${encodeURIComponent(studentId)}?org=${encodeURIComponent(orgId)}`);
}

export type PrintState = { ok: true; data: ProPrintDto } | { ok: false; error: string } | null;

/**
 * 상담 리포트 인쇄본(pro.report.export). 쓰기 경로(멱등키)라 서버 동작으로만 부른다(Next 같은 출처 확인).
 * 워터마크의 기관·교사 코드·인쇄 시각·학생 이름은 서버가 준 값을 그대로 찍는다
 */
export async function exportStudentReport(_prev: PrintState, fd: FormData): Promise<PrintState> {
  const orgId = String(fd.get("org_id") ?? ""), studentId = String(fd.get("student_id") ?? ""), reportId = String(fd.get("report_id") ?? "");
  const rev = Number(fd.get("revision_id")), key = String(fd.get("idem") ?? "");
  if (!validId(orgId) || !validId(studentId) || !validId(reportId) || !Number.isSafeInteger(rev) || rev < 1 || !/^[0-9a-f-]{36}$/i.test(key)) return { ok: false, error: "화면을 새로 고친 뒤 다시 눌러 주세요." };
  try {
    const r = await proSource().exportReport(await getCaller(), orgId, studentId, reportId, rev, key);
    if (!r.ok) return { ok: false, error: `인쇄본을 만들지 못했습니다. (문의 번호 ${r.code})` };
    return { ok: true, data: r.value };
  } catch (e) {
    const t = failText(e);
    if (t) return { ok: false, error: t };
    throw e;
  }
}

const ADMIN_MESSAGE: Record<string, string> = {
  management_mfa_required: "담당 변경과 보관은 2단계 인증(OTP)을 마친 세션에서만 할 수 있습니다. 에듀터치에서 OTP 인증 후 다시 시도해 주세요.",
  professional_access_denied: "기관 관리자만 할 수 있습니다.",
  expected_version_changed: "다른 화면에서 이 학생 정보가 먼저 바뀌었습니다. 화면을 새로 고쳐 주세요.",
  invalid_request: "고른 담당자가 이 기관의 교사·열람 전용 구성원이 아닙니다.",
};
const adminText = (code: string) => ADMIN_MESSAGE[code] ?? `처리하지 못했습니다. (문의 번호 ${code})`;

/** 기관 관리자: 학생 담당 교사(·열람 전용) 목록을 새로 정한다(체크한 구성원 전체로 바꿈) */
export async function assignStudentAction(_prev: ProActionState, fd: FormData): Promise<ProActionState> {
  const orgId = String(fd.get("org_id") ?? ""), studentId = String(fd.get("student_id") ?? ""), key = String(fd.get("idem") ?? "");
  const v = Number(fd.get("version"));
  const ids = fd.getAll("teacher").map(String);
  if (!validId(orgId) || !validId(studentId) || !/^[0-9a-f-]{36}$/i.test(key) || !Number.isSafeInteger(v) || ids.some((x) => !validId(x)) || new Set(ids).size !== ids.length) return { error: "화면을 새로 고친 뒤 다시 저장해 주세요." };
  try {
    const r = await proSource().assignStudent(await getCaller(), orgId, studentId, ids, v, key);
    if (!r.ok) return { error: adminText(r.code) };
  } catch (e) {
    if (e instanceof AccessDenied && e.status === 403) return { error: adminText(e.code) };
    const t = failText(e);
    if (t) return { error: t };
    throw e;
  }
  return back(`/pro/management?org=${encodeURIComponent(orgId)}`);
}

/** 기관 관리자: 학생 보관(목록에서 숨김, 기록은 남음, 계약 학생 수는 돌아오지 않음) */
export async function archiveStudentAction(_prev: ProActionState, fd: FormData): Promise<ProActionState> {
  const orgId = String(fd.get("org_id") ?? ""), studentId = String(fd.get("student_id") ?? ""), key = String(fd.get("idem") ?? "");
  const v = Number(fd.get("version"));
  if (fd.get("confirm") !== "on") return { error: "보관하려면 확인란을 체크해 주세요." };
  if (!validId(orgId) || !validId(studentId) || !/^[0-9a-f-]{36}$/i.test(key) || !Number.isSafeInteger(v)) return { error: "화면을 새로 고친 뒤 다시 눌러 주세요." };
  try {
    const r = await proSource().archiveStudent(await getCaller(), orgId, studentId, v, key);
    if (!r.ok) return { error: adminText(r.code) };
  } catch (e) {
    if (e instanceof AccessDenied && e.status === 403) return { error: adminText(e.code) };
    const t = failText(e);
    if (t) return { error: t };
    throw e;
  }
  return back(`/pro/management?org=${encodeURIComponent(orgId)}`);
}
