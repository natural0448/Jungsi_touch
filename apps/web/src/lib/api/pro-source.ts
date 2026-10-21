import "server-only";
import type { ProEnvelope, ProScoreStatusDto, ProSessionDto, ProStudentDto, ProStudentInput, ProStudentPageDto } from "@/lib/pro-dto";
import { apiMode } from "./index";
import { AccessDenied, ConnectionError, type Caller, type Result } from "./source";

/*
  전문가용 서비스 API(jungsi-pro-api) 창구. 화면 서버에서만 부른다. 기관·역할·담당은 클라이언트가 보내지 않고
  서버가 로그인 토큰으로 판단한다(계약: tenant_and_actor_from_client_body forbidden). 다른 기관·담당 아닌 학생은
  서버가 같은 404 로 막으므로 화면도 '없음'으로만 보인다.
  - live: JUNGSI_PRO_API_URL(서버 함수 주소, /api/v1 은 이 모듈이 붙인다). 아직 등록 전이면 '연결 대기'
  - synthetic: 화면 제작용 메모리 응답(이 서버 인스턴스 안에서만, 실제 기관·학생이 아니다)
*/

export interface ProSource {
  session(caller: Caller): Promise<ProSessionDto>;
  listStudents(caller: Caller, orgId: string, q: { limit?: number; cursor?: string; q?: string; class_label?: string }): Promise<ProStudentPageDto>;
  createStudent(caller: Caller, orgId: string, input: ProStudentInput, expectedContractVersion: number, key: string): Promise<Result<ProStudentDto>>;
  readStudent(caller: Caller, orgId: string, studentId: string): Promise<ProStudentDto | null>;
  updateStudent(caller: Caller, orgId: string, studentId: string, input: ProStudentInput, expectedVersion: number, key: string): Promise<Result<ProStudentDto>>;
  scoreStatus(caller: Caller, orgId: string, studentId: string, examId: string, packVersion: string, stage?: string): Promise<ProScoreStatusDto | null>;
}

const enc = encodeURIComponent;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const qs = (q: Record<string, string | number | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

/* ── live ── */

function headers(caller: Caller, extra?: Record<string, string>) {
  const h = new Headers(extra);
  if (caller.accessToken) h.set("Authorization", `Bearer ${caller.accessToken}`);
  const relay = process.env.JUNGSI_RELAY_TOKEN;
  if (relay) h.set("X-Jungsi-Relay-Token", relay);
  return h;
}
async function send(path: string, init: RequestInit): Promise<Response> {
  const base = process.env.JUNGSI_PRO_API_URL;
  if (!base) throw new ConnectionError("unconfigured", "pro_api_not_configured");
  try {
    return await fetch(`${base}/api/v1/pro${path}`, { ...init, cache: "no-store" });
  } catch {
    throw new ConnectionError("unavailable", "backend_unreachable");
  }
}
async function code(res: Response): Promise<string | undefined> {
  const b = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  const c = b?.error?.code;
  return typeof c === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(c) ? c : undefined;
}
async function guard(res: Response) {
  if (res.status === 401 || res.status === 403) throw new AccessDenied(res.status, (await code(res)) ?? (res.status === 401 ? "authentication_required" : "role_not_allowed"));
  if (res.status === 429) throw new ConnectionError("rate_limited", (await code(res)) ?? "rate_limit_exceeded");
  if (res.status === 503) throw new ConnectionError("unavailable", (await code(res)) ?? "contract_or_authority_unavailable");
}
async function get<T>(caller: Caller, path: string): Promise<T | null> {
  const res = await send(path, { headers: headers(caller) });
  await guard(res);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`정시터치 전문가용 API ${res.status} ${(await code(res)) ?? ""}`);
  return ((await res.json()) as ProEnvelope<T>).data;
}
async function write<T>(caller: Caller, method: "POST" | "PATCH" | "PUT", path: string, body: unknown, key: string): Promise<Result<T>> {
  const res = await send(path, { method, headers: headers(caller, { "Content-Type": "application/json", "Idempotency-Key": key }), body: JSON.stringify(body) });
  await guard(res);
  if (!res.ok) return { ok: false, code: (await code(res)) ?? "request_failed", status: res.status };
  return { ok: true, value: ((await res.json()) as ProEnvelope<T>).data };
}

const liveSource: ProSource = {
  session: async (caller) => (await get<ProSessionDto>(caller, "/session")) ?? { organizations: [], org_id: null, role: null, contract_status: "selection_required" },
  listStudents: async (caller, orgId, q) => (await get<ProStudentPageDto>(caller, `/organizations/${enc(orgId)}/students${qs(q)}`)) ?? { items: [], next_cursor: null, has_more: false },
  createStudent: (caller, orgId, input, v, key) => write(caller, "POST", `/organizations/${enc(orgId)}/students`, { ...input, expected_contract_version: v }, key),
  readStudent: (caller, orgId, id) => get(caller, `/organizations/${enc(orgId)}/students/${enc(id)}`),
  updateStudent: (caller, orgId, id, input, v, key) => write(caller, "PATCH", `/organizations/${enc(orgId)}/students/${enc(id)}`, { ...input, expected_version: v }, key),
  scoreStatus: (caller, orgId, id, examId, packVersion, stage) =>
    get(caller, `/organizations/${enc(orgId)}/students/${enc(id)}/score-input-status${qs({ exam_id: examId, pack_version: packVersion, stage })}`),
};

/* ── synthetic(화면 제작용 메모리) ── */

type SynStore = { students: ProStudentDto[]; keys: Map<string, ProStudentDto>; used: number };
const syn: SynStore = ((globalThis as { __jtProSyn?: SynStore }).__jtProSyn ??= { students: seed(), keys: new Map(), used: 3 });
function seed(): ProStudentDto[] {
  const at = "2026-11-20T01:00:00Z";
  return [
    ["김하늘", "3-2", "7", ["정시"]],
    ["이서준", "3-2", "15", []],
    ["박지민", "3-4", "3", ["재수"]],
  ].map(([name, cls, no, tags], i) => ({
    org_id: "1", student_id: `syn-stu-${i + 1}`, display_name: name as string, class_label: cls as string, class_number: no as string,
    tags: tags as string[], memo: null, archived: false, version: 1, assigned_teacher_ids: ["syn-teacher-1"], created_at_utc: at,
  }));
}
const SYN_ORG = { org_id: "1", org_name: "합성 시범고등학교", contract_id: "syn-contract-1", academic_year: 2027, role: "teacher" as const, contract_status: "active" as const, contract_expires_at: "2027-01-10T14:59:59Z", contract_version: 1, contracted_student_count: 30 };
const synSource: ProSource = {
  async session() {
    const o = { ...SYN_ORG, used_student_count: syn.used, remaining_student_count: SYN_ORG.contracted_student_count - syn.used };
    return { organizations: [o], org_id: o.org_id, role: o.role, contract_status: "active" };
  },
  async listStudents(_c, orgId, q) {
    if (orgId !== SYN_ORG.org_id) return { items: [], next_cursor: null, has_more: false };
    const word = q.q?.trim();
    const items = syn.students.filter((s) => !s.archived && (!word || s.display_name.includes(word) || (s.class_label ?? "").includes(word)) && (!q.class_label || s.class_label === q.class_label));
    items.sort((a, b) => (a.class_label ?? "").localeCompare(b.class_label ?? "") || Number(a.class_number ?? 0) - Number(b.class_number ?? 0));
    return { items, next_cursor: null, has_more: false };
  },
  async createStudent(_c, orgId, input, v, key) {
    const prior = syn.keys.get(key);
    if (prior) return { ok: true, value: prior };
    if (orgId !== SYN_ORG.org_id) return { ok: false, code: "not_found", status: 404 };
    if (v !== SYN_ORG.contract_version) return { ok: false, code: "expected_version_changed", status: 409 };
    if (syn.used >= SYN_ORG.contracted_student_count) return { ok: false, code: "student_seat_limit_reached", status: 409 };
    const s: ProStudentDto = { org_id: orgId, student_id: `syn-stu-${syn.students.length + 1}`, ...input, archived: false, version: 1, assigned_teacher_ids: ["syn-teacher-1"], created_at_utc: new Date().toISOString() };
    syn.students.push(s);
    syn.used++;
    syn.keys.set(key, s);
    return { ok: true, value: s };
  },
  async readStudent(_c, orgId, id) {
    return syn.students.find((s) => s.org_id === orgId && s.student_id === id) ?? null;
  },
  async updateStudent(_c, orgId, id, input, v, key) {
    const prior = syn.keys.get(key);
    if (prior) return { ok: true, value: prior };
    const i = syn.students.findIndex((s) => s.org_id === orgId && s.student_id === id);
    if (i < 0) return { ok: false, code: "not_found", status: 404 };
    if (syn.students[i].version !== v) return { ok: false, code: "expected_version_changed", status: 409 };
    syn.students[i] = { ...syn.students[i], ...input, version: v + 1 };
    syn.keys.set(key, syn.students[i]);
    return { ok: true, value: syn.students[i] };
  },
  async scoreStatus(_c, orgId, id, examId, packVersion, stage) {
    if (!syn.students.some((s) => s.org_id === orgId && s.student_id === id)) return null;
    return { org_id: orgId, student_id: id, exam_id: examId, pack_version: packVersion, stage: stage ?? "mock", initial_used: 0, initial_remaining: 1, correction_granted: 0, correction_used: 0, entry_version: 0, current_profile_id: null, current_report_id: null, last_rejection_code: null };
  },
};

const unconfigured = new Proxy({} as ProSource, { get: () => () => Promise.reject(new ConnectionError("unconfigured", "pro_api_not_configured")) });

export function proSource(): ProSource {
  const m = apiMode();
  return m === "synthetic" ? synSource : m === "live" ? liveSource : unconfigured;
}

/** 주소의 기관·학생 번호 형식 확인(형식만. 권한은 서버) */
export const validId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
