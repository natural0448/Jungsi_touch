"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccessDenied, ConnectionError, getCaller } from "@/lib/api";
import { proSource, validId } from "@/lib/api/pro-source";
import type { ProStudentInput } from "@/lib/pro-dto";

export type StudentFormState = { error: string; values: Partial<Record<keyof ProStudentInput, string>> } | null;

const MESSAGE: Record<string, string> = {
  student_seat_limit_reached: "계약한 학생 수를 모두 사용했습니다. 학생을 더 추가하려면 기관 관리자에게 계약 학생 수 조정을 요청해 주세요.",
  expected_version_changed: "다른 화면에서 먼저 바뀌었습니다. 화면을 새로 고친 뒤 다시 저장해 주세요.",
  contract_expired: "기관 계약 기간이 끝나 학생을 추가·수정할 수 없습니다.",
  role_not_allowed: "이 역할로는 학생을 추가·수정할 수 없습니다(열람 전용).",
  not_found: "학생을 찾지 못했습니다.",
  invalid_request: "입력 칸을 다시 확인해 주세요.",
};

/** 폼 → 학생 입력. 이름 필수(실명 허용), 반·번호·태그·메모는 선택. 연락처·주민번호 칸은 두지 않는다 */
function parse(fd: FormData): { input: ProStudentInput; values: Record<string, string> } | { error: string; values: Record<string, string> } {
  const values = Object.fromEntries(["display_name", "class_label", "class_number", "tags", "memo"].map((k) => [k, String(fd.get(k) ?? "").trim()]));
  const name = values.display_name;
  if (!name || name.length > 40) return { error: "학생 이름을 1~40자로 넣어 주세요.", values };
  if (values.class_label.length > 20) return { error: "반은 20자 안으로 넣어 주세요.", values };
  if (values.class_number && !/^\d{1,3}$/.test(values.class_number)) return { error: "번호는 숫자로 넣어 주세요.", values };
  if (values.memo.length > 300) return { error: "메모는 300자 안으로 넣어 주세요.", values };
  const tags = values.tags ? values.tags.split(/[,\s]+/).filter(Boolean).slice(0, 5).map((t) => t.slice(0, 12)) : [];
  return { input: { display_name: name, class_label: values.class_label || null, class_number: values.class_number ? Number(values.class_number) : null, tags, memo: values.memo || null }, values };
}

function failText(e: unknown): string | null {
  if (e instanceof AccessDenied) return e.status === 401 ? "로그인이 필요합니다. 다시 로그인해 주세요." : MESSAGE[e.code] ?? `권한이 없어 처리하지 못했습니다. (사유 코드 ${e.code})`;
  if (e instanceof ConnectionError) return e.kind === "rate_limited" ? "요청이 겹쳐 잠시 제한되었습니다. 몇 초 뒤 다시 저장해 주세요. 입력한 값은 그대로 남아 있습니다." : `정시터치 서버에 연결할 수 없어 저장하지 못했습니다. (사유 코드 ${e.code})`;
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
    if (!r.ok) return { error: MESSAGE[r.code] ?? `저장하지 못했습니다. (사유 코드 ${r.code})`, values: p.values };
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
    if (!r.ok) return { error: MESSAGE[r.code] ?? `저장하지 못했습니다. (사유 코드 ${r.code})`, values: p.values };
  } catch (e) {
    const t = failText(e);
    if (t) return { error: t, values: p.values };
    throw e;
  }
  return back(`/pro/students/${encodeURIComponent(studentId)}?org=${encodeURIComponent(orgId)}`);
}
