"use server";

import { isEdutouchAdmin } from "@/lib/admin";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { proSource, validId } from "@/lib/api/pro-source";

export type CorrectionState = { ok: true; text: string } | { ok: false; error: string } | null;

const MESSAGE: Record<string, string> = {
  management_mfa_required: "정정 승인은 2단계 인증(OTP)을 마친 관리자 세션에서만 할 수 있습니다.",
  professional_access_denied: "고객센터 권한(플랫폼 관리자)이 아니거나 접수 번호가 대상과 맞지 않습니다.",
  revision_conflict: "입력 상태가 그사이 바뀌었습니다. 대상의 현재 판을 다시 확인해 주세요(자동으로 다시 보내지 않습니다).",
  expected_version_changed: "입력 상태가 그사이 바뀌었습니다. 대상의 현재 판을 다시 확인해 주세요(자동으로 다시 보내지 않습니다).",
  correction_already_granted: "이 대상·시험 단계에는 이미 정정권을 승인했습니다. 정정은 1회뿐입니다.",
  invalid_request: "입력 칸을 다시 확인해 주세요(회원 UUID·접수 번호·기대 판).",
};
const text = (code: string) => MESSAGE[code] ?? `승인하지 못했습니다. (사유 코드 ${code})`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function common(fd: FormData) {
  const v = Number(fd.get("expected_version"));
  return {
    exam_id: String(fd.get("exam_id") ?? "").trim(),
    stage: String(fd.get("stage") ?? ""),
    ticket_ref: String(fd.get("ticket_ref") ?? "").trim(),
    expected_version: v,
    key: String(fd.get("idem") ?? ""),
    ok: validId(String(fd.get("exam_id") ?? "").trim()) && ["mock", "provisional", "final"].includes(String(fd.get("stage") ?? "")) && validId(String(fd.get("ticket_ref") ?? "").trim()) && Number.isSafeInteger(v) && v >= 1 && /^[0-9a-f-]{36}$/i.test(String(fd.get("idem") ?? "")),
  };
}

async function guard<T>(run: () => Promise<{ ok: true; value: T } | { ok: false; code: string }>, done: (v: T) => string): Promise<CorrectionState> {
  if (!(await isEdutouchAdmin())) return { ok: false, error: "에듀터치 관리자만 쓸 수 있습니다." };
  try {
    const r = await run();
    if (!r.ok) return { ok: false, error: text(r.code) };
    return { ok: true, text: done(r.value) };
  } catch (e) {
    if (e instanceof AccessDenied) return { ok: false, error: text(e.code) };
    if (e instanceof ConnectionError) return { ok: false, error: `서버에 연결할 수 없습니다. (사유 코드 ${e.code})` };
    throw e;
  }
}

/** 개인용 고객센터 정정 승인(score-input.correction.grant). 한 번 누를 때만 보낸다 — 409 에 자동 재시도 없음 */
export async function grantPersonal(_prev: CorrectionState, fd: FormData): Promise<CorrectionState> {
  const c = common(fd), subject = String(fd.get("subject_id") ?? "").trim();
  if (!c.ok || !UUID.test(subject)) return { ok: false, error: MESSAGE.invalid_request };
  return guard(
    async () => await source().grantScoreCorrection(await getCaller(), { subject_id: subject, exam_id: c.exam_id, stage: c.stage, ticket_ref: c.ticket_ref, expected_version: c.expected_version }, c.key),
    (s) => `승인했습니다. 승인된 정정 ${s.correction_granted}회 · 사용 ${s.correction_used}회 · 입력 판 ${s.entry_version}`,
  );
}

/** 전문가용 학생 정정 승인(pro.correction.grant). 기관 관리자 경로가 아니다 */
export async function grantPro(_prev: CorrectionState, fd: FormData): Promise<CorrectionState> {
  const c = common(fd), orgId = String(fd.get("org_id") ?? "").trim(), studentId = String(fd.get("student_id") ?? "").trim();
  if (!c.ok || !validId(orgId) || !validId(studentId)) return { ok: false, error: MESSAGE.invalid_request };
  return guard(
    async () => await proSource().grantCorrection(await getCaller(), orgId, studentId, { exam_id: c.exam_id, stage: c.stage, ticket_ref: c.ticket_ref, expected_version: c.expected_version }, c.key),
    (s) => `승인했습니다. 승인된 정정 ${s.correction_granted}회 · 사용 ${s.correction_used}회 · 입력 판 ${s.entry_version}`,
  );
}
