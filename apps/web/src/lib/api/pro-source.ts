import "server-only";
import { headers as incomingHeaders } from "next/headers";
import { professionalMutationOrigin, professionalRenderOrigin } from "../professional-bff-origin";
import type { ProfileDto, ProvisionalScoresInput, ReportDto, ScoresInput } from "@/lib/dto";
import type { ProAssignmentDto, ProBookmarksDto, ProCandidatesDto, ProEnvelope, ProMemberPageDto, ProP4Dto, ProP4Search, ProPrintDto, ProScoreStatusDto, ProSessionDto, ProStudentDto, ProStudentInput, ProStudentPageDto, ProStudentReportDto, ProStudentReportPageDto } from "@/lib/pro-dto";
import { CATALOG, assess, buildCandidates } from "./synthetic-assessment";
import { computeOverall, computeProvisional } from "./synthetic-report";
import { buildTips } from "./synthetic-tips";
import { apiMode } from "./index";
import { AccessDenied, ConnectionError, type Caller, type Result } from "./source";
import { readSyntheticState } from "./synthetic";

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
  scoreStatus(caller: Caller, orgId: string, studentId: string, examId: string, packVersion: string, stage: string): Promise<ProScoreStatusDto | null>;
  /** pro.score.create — 학생×시험×단계 입력 1회. 성적표에 없는 점수의 정상 거절도 1회 사용(422) */
  createScore(caller: Caller, orgId: string, studentId: string, body: { exam_id: string; pack_version: string; stage: string; scores: ScoresInput | ProvisionalScoresInput; expected_entry_version: number }, key: string): Promise<Result<{ profile: ProfileDto }>>;
  /** pro.overall.analyze — 저장한 성적으로 전체 위치(새 리포트 판) */
  analyzeOverall(caller: Caller, orgId: string, studentId: string, profileId: string, expectedProfileVersion: string | number, key: string): Promise<Result<{ report: ReportDto }>>;
  listReports(caller: Caller, orgId: string, studentId: string): Promise<ProStudentReportPageDto>;
  readReport(caller: Caller, orgId: string, studentId: string, reportId: string): Promise<ProStudentReportDto | null>;
  /** pro.university.analyze(가채점 4페이지, 서버 dep_pro_r28) — 검색 조건 또는 모집단위 번호(30개까지)로 학교별 판정. 저장하지 않는다 */
  analyzeP4(caller: Caller, orgId: string, studentId: string, body: { profile_id: string; expected_profile_version: string | number; offering_ids?: string[]; search?: ProP4Search }, key: string): Promise<Result<ProP4Dto>>;
  /** pro.candidates — 저장한 성적으로 유리한 대학 찾기(새 리포트 판에 남는다) */
  candidates(caller: Caller, orgId: string, studentId: string, profileId: string, expectedProfileVersion: string | number, key: string): Promise<Result<ProCandidatesDto>>;
  listBookmarks(caller: Caller, orgId: string, studentId: string, reportId?: string): Promise<ProBookmarksDto | null>;
  addBookmark(caller: Caller, orgId: string, studentId: string, reportId: string, offeringId: string, key: string): Promise<Result<ProBookmarksDto>>;
  /** pro.bookmark.remove(2026-11-13) — 담은 학교 빼기. 서버는 장부를 지우지 않고 뺀 기록을 쌓는다 */
  removeBookmark(caller: Caller, orgId: string, studentId: string, reportId: string, offeringId: string, key: string): Promise<Result<ProBookmarksDto>>;
  /** pro.report.export — 고정 판 인쇄본. 워터마크(기관·교사 코드·인쇄 시각·학생 이름)를 서버가 준다 */
  exportReport(caller: Caller, orgId: string, studentId: string, reportId: string, revisionId: number, key: string): Promise<Result<ProPrintDto>>;
  /** pro.member.list(기관 관리자) */
  listMembers(caller: Caller, orgId: string): Promise<ProMemberPageDto | null>;
  /** pro.student.assign(기관 관리자·2단계 인증) — 담당 교사 전체를 새 목록으로 바꾼다 */
  assignStudent(caller: Caller, orgId: string, studentId: string, teacherIds: string[], expectedVersion: number, key: string): Promise<Result<ProAssignmentDto>>;
  /** pro.student.archive(기관 관리자·2단계 인증) — 보관해도 계약 학생 수는 돌아오지 않는다 */
  archiveStudent(caller: Caller, orgId: string, studentId: string, expectedVersion: number, key: string): Promise<Result<ProStudentDto>>;
  /** pro.correction.grant(고객센터·플랫폼 관리자 aal2·접수 번호) — 학생 정정권 1회 */
  grantCorrection(caller: Caller, orgId: string, studentId: string, body: { exam_id: string; stage: string; ticket_ref: string; expected_version: number }, key: string): Promise<Result<ProScoreStatusDto>>;
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
/*
  2026-11-28 대표님 승인(속도 P1): 화면 서버 → 판정 서버를 공개 주소 대신 Cloudflare 내부 연결(서비스 바인딩)로 부른다.
  같은 요청인데 판정 서버 안 0.5초가 화면 서버에서는 0.9~1.4초였다(서버 사이 이동). 주소가 Cloudflare 판정 서버일 때만 쓰고,
  바인딩이 없으면(시험·Supabase 되돌림) 지금처럼 주소로 부른다. 요청 내용·머리말은 그대로다
*/
const BOUND_HOSTS: Record<string, string> = {
  "jungsi-api-prod.edutouch-web.workers.dev": "JUNGSI_API_SVC",
  "jungsi-pro-api-prod.edutouch-web.workers.dev": "JUNGSI_PRO_API_SVC",
};
type Bound = { fetch(r: Request): Promise<Response> };
async function boundService(url: string): Promise<Bound | null> {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  const name = BOUND_HOSTS[host];
  if (!name) return null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = (await getCloudflareContext({ async: true })).env as Record<string, unknown>;
    const b = env[name] as Bound | undefined;
    return b && typeof b.fetch === "function" ? b : null;
  } catch {
    return null;
  }
}
async function callBackend(url: string, init: RequestInit): Promise<Response> {
  const b = await boundService(url);
  if (!b) return fetch(url, { ...init, cache: "no-store" });
  const { cache: _ignored, ...rest } = init;
  return b.fetch(new Request(url, rest));
}
async function send(path: string, init: RequestInit): Promise<Response> {
  const base = process.env.JUNGSI_PRO_API_URL;
  if (!base) throw new ConnectionError("unconfigured", "pro_api_not_configured");
  // 2026-11-27 속도 측정(대표님 요청: 전문가용 느림): 경로 모양·상태·걸린 시간만 남긴다(기관·학생·리포트 번호는 가린다)
  const t0 = Date.now();
  try {
    const res = await callBackend(`${base}/api/v1/pro${path}`, init);
    console.log(`[pro-api] ${init.method ?? "GET"} ${path.split("?")[0].replace(/\/organizations\/[^/]+/, "/organizations/:org").replace(/\/[A-Za-z_-]*\d[A-Za-z0-9_.:-]*/g, "/:id")} ${res.status} ${Date.now() - t0}ms`);
    return res;
  } catch {
    console.log(`[pro-api] ${init.method ?? "GET"} failed ${Date.now() - t0}ms`);
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
async function write<T>(caller: Caller, method: "POST" | "PATCH" | "PUT", path: string, body: unknown, key: string, render = false): Promise<Result<T>> {
  // render: 화면을 그리며 보내는 계산 요청(③ 판정·검색, 저장 안 함) — professionalRenderOrigin
  const proof = (render ? professionalRenderOrigin : professionalMutationOrigin)(process.env.JUNGSI_PRO_BFF_ORIGIN, await incomingHeaders());
  if (!proof.ok) {
    if (proof.status === 503) throw new ConnectionError("unconfigured", proof.code);
    throw new AccessDenied(403, proof.code);
  }
  const outgoing = headers(caller, { "Content-Type": "application/json", "Idempotency-Key": key });
  outgoing.set("Origin", proof.origin);
  outgoing.set("X-Jungsi-CSRF-Verified", "1");
  const res = await send(path, { method, headers: outgoing, body: JSON.stringify(body) });
  await guard(res);
  if (!res.ok) return { ok: false, code: (await code(res)) ?? "request_failed", status: res.status };
  return { ok: true, value: ((await res.json()) as ProEnvelope<T>).data };
}

/*
  2026-11-28 대표님 승인(전문가용 속도 ①): 화면 한 장이 로그인 확인(/session)·학생 정보를 매번 서버에 다시 물어 0.5~1초가 들었다.
  같은 회원(로그인 토큰 지문)·같은 주소의 성공 응답만 기억한다. 이 화면 서버 실행본 → 데이터센터 캐시.
  2026-11-28 대표님 결정: 20초 → 60분(사실상 로그아웃까지 — 로그인 토큰은 1시간마다 새로 받으므로 그때 한 번 다시 읽는다).
  학생 정보를 바꾸는 요청(수정·담당 지정·보관)을 보내면 성공·거절(판 번호 다름 포함) 모두 그 학생 기억을 지운다. 오류·없음(404)은 기억하지 않는다.
  성적·리포트·판정 요청은 기억하지 않아 서버가 매번 권한을 확인한다
*/
const READ_TTL_MS = 60 * 60_000;
const readMemo = new Map<string, { at: number; v: unknown }>();
async function readKey(caller: Caller, path: string): Promise<string | null> {
  if (!caller.accessToken) return null;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(caller.accessToken + "\u0000" + path));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function readEdge(): Cache | null {
  try {
    return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null;
  } catch {
    return null;
  }
}
const readUrl = (k: string) => `https://jt-pro-read.invalid/${k}`;
async function cachedGet<T>(caller: Caller, path: string): Promise<T | null> {
  const k = await readKey(caller, path);
  if (!k) return get<T>(caller, path);
  const m = readMemo.get(k);
  if (m && Date.now() - m.at < READ_TTL_MS) return m.v as T;
  const edge = readEdge();
  if (edge) {
    try {
      const hit = await edge.match(readUrl(k));
      if (hit) {
        const j = (await hit.json()) as { at: number; v: T };
        if (j && typeof j.at === "number" && Date.now() - j.at < READ_TTL_MS && j.v != null) {
          readMemo.set(k, { at: j.at, v: j.v });
          return j.v;
        }
      }
    } catch {
      // 기억을 못 읽으면 서버에 묻는다
    }
  }
  const v = await get<T>(caller, path);
  if (v != null) {
    const at = Date.now();
    readMemo.set(k, { at, v });
    while (readMemo.size > 500) readMemo.delete(readMemo.keys().next().value as string);
    if (edge) {
      try {
        await edge.put(readUrl(k), new Response(JSON.stringify({ at, v }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } }));
      } catch {
        // 못 넣어도 화면은 그대로
      }
    }
  }
  return v;
}
async function forgetRead(caller: Caller, path: string) {
  const k = await readKey(caller, path);
  if (!k) return;
  readMemo.delete(k);
  try {
    await readEdge()?.delete(readUrl(k));
  } catch {
    // 60분 뒤 사라진다
  }
}
async function thenForget<T>(caller: Caller, path: string, p: Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await p;
  } finally {
    await forgetRead(caller, path);
  }
}

const liveSource: ProSource = {
  session: async (caller) => (await cachedGet<ProSessionDto>(caller, "/session")) ?? { organizations: [], org_id: null, role: null, contract_status: "selection_required" },
  listStudents: async (caller, orgId, q) => (await get<ProStudentPageDto>(caller, `/organizations/${enc(orgId)}/students${qs(q)}`)) ?? { items: [], next_cursor: null, has_more: false },
  createStudent: (caller, orgId, input, v, key) => write(caller, "POST", `/organizations/${enc(orgId)}/students`, { ...input, expected_contract_version: v }, key),
  readStudent: (caller, orgId, id) => cachedGet(caller, `/organizations/${enc(orgId)}/students/${enc(id)}`),
  updateStudent: (caller, orgId, id, input, v, key) =>
    thenForget(caller, `/organizations/${enc(orgId)}/students/${enc(id)}`, write(caller, "PATCH", `/organizations/${enc(orgId)}/students/${enc(id)}`, { ...input, expected_version: v }, key)),
  scoreStatus: (caller, orgId, id, examId, packVersion, stage) =>
    get(caller, `/organizations/${enc(orgId)}/students/${enc(id)}/score-input-status${qs({ exam_id: examId, pack_version: packVersion, stage })}`),
  createScore: (caller, orgId, id, body, key) => write(caller, "POST", `/organizations/${enc(orgId)}/students/${enc(id)}/score-profiles`, { ...body, confirmed: true }, key),
  analyzeOverall: (caller, orgId, id, profileId, v, key) =>
    write(caller, "POST", `/organizations/${enc(orgId)}/students/${enc(id)}/overall-analysis`, { profile_id: profileId, expected_profile_version: v }, key),
  listReports: async (caller, orgId, id) =>
    (await get<ProStudentReportPageDto>(caller, `/organizations/${enc(orgId)}/students/${enc(id)}/reports${qs({ limit: 20 })}`)) ?? { org_id: orgId, student_id: id, items: [], next_cursor: null, has_more: false },
  readReport: (caller, orgId, id, reportId) => get(caller, `/organizations/${enc(orgId)}/students/${enc(id)}/reports/${enc(reportId)}`),
  analyzeP4: (caller, orgId, id, body, key) => write(caller, "POST", `/organizations/${enc(orgId)}/students/${enc(id)}/university-analysis`, body, key, true),
  candidates: (caller, orgId, id, profileId, v, key) =>
    write(caller, "POST", `/organizations/${enc(orgId)}/students/${enc(id)}/candidates`, { profile_id: profileId, filters: {}, expected_profile_version: v }, key),
  listBookmarks: (caller, orgId, id, reportId) => get(caller, `/organizations/${enc(orgId)}/students/${enc(id)}/bookmarks${qs({ report_id: reportId })}`),
  addBookmark: (caller, orgId, id, reportId, offeringId, key) =>
    write(caller, "POST", `/organizations/${enc(orgId)}/students/${enc(id)}/bookmarks`, { report_id: reportId, offering_id: offeringId }, key),
  removeBookmark: (caller, orgId, id, reportId, offeringId, key) =>
    write(caller, "POST", `/organizations/${enc(orgId)}/students/${enc(id)}/bookmarks/remove`, { report_id: reportId, offering_id: offeringId }, key),
  exportReport: (caller, orgId, id, reportId, revisionId, key) =>
    write(caller, "POST", `/organizations/${enc(orgId)}/students/${enc(id)}/reports/${enc(reportId)}/export`, { revision_id: revisionId }, key),
  listMembers: (caller, orgId) => get(caller, `/organizations/${enc(orgId)}/members${qs({ limit: 100 })}`),
  assignStudent: (caller, orgId, id, ids, v, key) =>
    thenForget(caller, `/organizations/${enc(orgId)}/students/${enc(id)}`, write(caller, "PUT", `/organizations/${enc(orgId)}/students/${enc(id)}/assignments`, { assigned_teacher_ids: ids, expected_version: v }, key)),
  archiveStudent: (caller, orgId, id, v, key) =>
    thenForget(caller, `/organizations/${enc(orgId)}/students/${enc(id)}`, write(caller, "POST", `/organizations/${enc(orgId)}/students/${enc(id)}/archive`, { expected_version: v }, key)),
  grantCorrection: (caller, orgId, id, body, key) => write(caller, "POST", `/organizations/${enc(orgId)}/students/${enc(id)}/management/score-input-corrections`, body, key),
};

/* ── synthetic(화면 제작용 메모리) ── */

/** 입력 횟수는 단계(모의평가·가채점·실채점)마다 따로 센다(운영 정책과 같음) */
type SynScore = { entry: Map<string, number>; profile: (ProfileDto & { scores: ScoresInput | ProvisionalScoresInput; stage: string }) | null; reports: ProStudentReportDto[]; keys: Map<string, unknown> };
/** 수능 가채점 원점수 입력인가(국어에 원점수 칸이 있다) */
const isRawScores = (s: ScoresInput | ProvisionalScoresInput): s is ProvisionalScoresInput => "raw_score" in s.korean;
type SynStore = { students: ProStudentDto[]; keys: Map<string, ProStudentDto>; used: number; scores: Map<string, SynScore> };
const syn: SynStore = ((globalThis as { __jtProSyn?: SynStore }).__jtProSyn ??= { students: seed(), keys: new Map(), used: 3, scores: new Map() });
syn.scores ??= new Map();
const synScore = (id: string): SynScore => {
  let x = syn.scores.get(id);
  if (!x) syn.scores.set(id, (x = { entry: new Map(), profile: null, reports: [], keys: new Map() }));
  return x;
};
function seed(): ProStudentDto[] {
  const at = "2026-11-20T01:00:00Z";
  return [
    ["김하늘", "3-2", "7", ["희망 계열: 공학", "희망 대학: 서울대, 연세대"]],
    ["이서준", "3-2", "15", []],
    ["박지민", "3-4", "3", ["재수"]],
  ].map(([name, cls, no, tags], i) => ({
    org_id: "1", student_id: `syn-stu-${i + 1}`, display_name: name as string, class_label: cls as string, class_number: no as string,
    tags: tags as string[], memo: null, archived: false, version: 1, assigned_teacher_ids: ["syn-teacher-1"], created_at_utc: at,
  }));
}
const SYN_MEMBERS: ProMemberPageDto["items"] = [
  { member_id: "1", subject_id: "syn-admin-1", role: "org_admin", status: "active", version: 1, display_name: "가상 관리자" },
  { member_id: "2", subject_id: "syn-teacher-1", role: "teacher", status: "active", version: 1, display_name: "김가상" },
  { member_id: "3", subject_id: "syn-teacher-2", role: "teacher", status: "active", version: 1, display_name: null },
  { member_id: "4", subject_id: "syn-viewer-1", role: "viewer", status: "active", version: 1 },
];
const SYN_ORG = { org_id: "1", org_name: "합성 시범고등학교", contract_id: "syn-contract-1", academic_year: 2027, role: "teacher" as const, contract_status: "active" as const, contract_expires_at: "2027-01-07T14:59:59Z", contract_version: 1, contracted_student_count: 30 };
const synSource: ProSource = {
  async session() {
    const role = (await readSyntheticState()) === "operator" ? ("org_admin" as const) : ("teacher" as const);
    const o = { ...SYN_ORG, role, used_student_count: syn.used, remaining_student_count: SYN_ORG.contracted_student_count - syn.used };
    return { organizations: [o], org_id: o.org_id, role, contract_status: "active" };
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
    const s: ProStudentDto = { org_id: orgId, student_id: `syn-stu-${syn.students.length + 1}`, ...input, memo: input.memo ?? null, archived: false, version: 1, assigned_teacher_ids: ["syn-teacher-1"], created_at_utc: new Date().toISOString() };
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
    const x = synScore(id);
    const entry = x.entry.get(stage) ?? 0, used = entry > 0 ? 1 : 0;
    const mine = x.reports.filter((r) => r.stage === stage);
    return { org_id: orgId, student_id: id, exam_id: examId, pack_version: packVersion, stage, initial_used: used, initial_remaining: 1 - used, correction_granted: 0, correction_used: 0, entry_version: entry, current_profile_id: x.profile?.stage === stage ? x.profile.profile_id : null, current_report_id: mine.at(-1)?.report_id ?? null, last_rejection_code: null };
  },
  async createScore(_c, orgId, id, body, key) {
    if (!syn.students.some((s) => s.org_id === orgId && s.student_id === id)) return { ok: false, code: "not_found", status: 404 };
    const x = synScore(id);
    const prior = x.keys.get(key) as { profile: ProfileDto } | undefined;
    if (prior) return { ok: true, value: prior };
    const entry = x.entry.get(body.stage) ?? 0;
    if (entry > 0) return { ok: false, code: "input_right_exhausted", status: 409 };
    if (body.expected_entry_version !== entry) return { ok: false, code: "expected_version_changed", status: 409 };
    const created = new Date().toISOString();
    x.entry.set(body.stage, 1);
    x.profile = { profile_id: `syn-pro-profile-${id}-${body.stage}`, profile_version: 1, confirmed: true, created_at: created, scores: body.scores, stage: body.stage };
    const value = { profile: { profile_id: x.profile.profile_id, profile_version: 1, confirmed: true, created_at: created } };
    x.keys.set(key, value);
    return { ok: true, value };
  },
  async analyzeOverall(_c, orgId, id, profileId, _v, key) {
    const x = synScore(id);
    const prior = x.keys.get(key) as { report: ReportDto } | undefined;
    if (prior) return { ok: true, value: prior };
    if (!x.profile || x.profile.profile_id !== profileId) return { ok: false, code: "profile_not_found", status: 404 };
    const n = x.reports.length + 1;
    const now = new Date().toISOString();
    const report: ReportDto = { format: "jungsi.persisted-report/v1", report_id: `syn-pro-report-${id}-${x.profile.stage}`, report_version: n, profile_id: profileId, updated_at: now, overall: isRawScores(x.profile.scores) ? computeProvisional(x.profile.scores) : computeOverall(x.profile.scores) };
    x.reports.push({ org_id: orgId, student_id: id, report_id: report.report_id, revision_id: n, exam_id: x.profile.scores.exam_id, stage: x.profile.stage, profile_id: profileId, published_result: report, counseling_reasons: [], created_at_utc: now });
    const value = { report };
    x.keys.set(key, value);
    return { ok: true, value };
  },
  async listReports(_c, orgId, id) {
    return { org_id: orgId, student_id: id, items: [...synScore(id).reports].reverse(), next_cursor: null, has_more: false };
  },
  async readReport(_c, _orgId, id, reportId) {
    return [...synScore(id).reports].reverse().find((r) => r.report_id === reportId) ?? null;
  },
  // 화면 제작용 합성 응답은 가채점 학교별 판정을 만들지 않는다(4페이지는 '가채점 판정 준비 중')
  async analyzeP4() {
    return { ok: false, code: "professional_exam_unavailable", status: 409 };
  },
  async candidates(_c, orgId, id, profileId, _v, key) {
    const x = synScore(id);
    const prior = x.keys.get(key) as ProCandidatesDto | undefined;
    if (prior) return { ok: true, value: prior };
    if (!x.profile || x.profile.profile_id !== profileId) return { ok: false, code: "profile_not_found", status: 404 };
    const last = x.reports.at(-1);
    if (!last) return { ok: false, code: "initial_overall_report_required", status: 409 };
    // 가채점 원점수 성적은 대학 환산을 하지 않는다(운영 서버 professional_exam_unavailable 409와 같음)
    const scores = x.profile.scores;
    if (isRawScores(scores)) return { ok: false, code: "professional_exam_unavailable", status: 409 };
    const overall = last.published_result.overall;
    const analyses = Object.fromEntries(CATALOG.map((o) => [o.offering_id, assess(o, scores, overall)]));
    const candidates = buildCandidates(analyses);
    const now = new Date().toISOString();
    const n = x.reports.length + 1;
    const report: ReportDto = { ...last.published_result, report_version: n, updated_at: now, analyses, candidates, shortlist: last.published_result.shortlist ?? {} };
    x.reports.push({ ...last, revision_id: n, published_result: report, counseling_reasons: buildTips(analyses, scores), created_at_utc: now });
    const value = { org_id: orgId, student_id: id, candidates };
    x.keys.set(key, value);
    return { ok: true, value };
  },
  async listBookmarks(_c, orgId, id) {
    const last = synScore(id).reports.at(-1);
    return { org_id: orgId, student_id: id, shortlist: last?.published_result.shortlist ?? {} };
  },
  async addBookmark(_c, orgId, id, reportId, offeringId, key) {
    const x = synScore(id);
    const prior = x.keys.get(key) as ProBookmarksDto | undefined;
    if (prior) return { ok: true, value: prior };
    const last = x.reports.at(-1);
    if (!last || last.report_id !== reportId) return { ok: false, code: "professional_report_not_found", status: 404 };
    const a = last.published_result.analyses?.[offeringId];
    const shortlist = { ...(last.published_result.shortlist ?? {}), [offeringId]: { selected: true, changed_at: new Date().toISOString(), assessment_status: a?.status ?? "pending", profile_id: last.profile_id, catalog_version: "SYNTHETIC-catalog-v1" } };
    last.published_result = { ...last.published_result, shortlist };
    const value = { org_id: orgId, student_id: id, shortlist };
    x.keys.set(key, value);
    return { ok: true, value };
  },
  async removeBookmark(_c, orgId, id, reportId, offeringId, key) {
    const x = synScore(id);
    const prior = x.keys.get(key) as ProBookmarksDto | undefined;
    if (prior) return { ok: true, value: prior };
    const last = x.reports.at(-1);
    if (!last || last.report_id !== reportId) return { ok: false, code: "professional_report_not_found", status: 404 };
    if (!last.published_result.shortlist?.[offeringId]?.selected) return { ok: false, code: "professional_bookmark_not_found", status: 404 };
    const shortlist = Object.fromEntries(Object.entries(last.published_result.shortlist).filter(([k]) => k !== offeringId));
    last.published_result = { ...last.published_result, shortlist };
    const value = { org_id: orgId, student_id: id, shortlist };
    x.keys.set(key, value);
    return { ok: true, value };
  },
  async listMembers(_c, orgId) {
    return { org_id: orgId, items: SYN_MEMBERS, next_cursor: null, has_more: false };
  },
  async assignStudent(_c, orgId, id, ids, v, key) {
    const prior = syn.keys.get(key);
    if (prior) return { ok: true, value: { org_id: orgId, student_id: id, assigned_teacher_ids: prior.assigned_teacher_ids, version: prior.version } };
    const i = syn.students.findIndex((s) => s.org_id === orgId && s.student_id === id);
    if (i < 0) return { ok: false, code: "not_found", status: 404 };
    if (syn.students[i].version !== v) return { ok: false, code: "expected_version_changed", status: 409 };
    if (ids.some((t) => !SYN_MEMBERS.some((m) => m.subject_id === t && m.role !== "org_admin"))) return { ok: false, code: "invalid_request", status: 422 };
    syn.students[i] = { ...syn.students[i], assigned_teacher_ids: ids, version: v + 1 };
    syn.keys.set(key, syn.students[i]);
    return { ok: true, value: { org_id: orgId, student_id: id, assigned_teacher_ids: ids, version: v + 1 } };
  },
  async archiveStudent(_c, orgId, id, v, key) {
    const prior = syn.keys.get(key);
    if (prior) return { ok: true, value: prior };
    const i = syn.students.findIndex((s) => s.org_id === orgId && s.student_id === id);
    if (i < 0) return { ok: false, code: "not_found", status: 404 };
    if (syn.students[i].version !== v) return { ok: false, code: "expected_version_changed", status: 409 };
    syn.students[i] = { ...syn.students[i], archived: true, version: v + 1 };
    syn.keys.set(key, syn.students[i]);
    return { ok: true, value: syn.students[i] };
  },
  async grantCorrection() {
    return { ok: false, code: "professional_authority_unavailable", status: 503 };
  },
  async exportReport(_c, orgId, id, reportId, revisionId) {
    const r = synScore(id).reports.find((x) => x.report_id === reportId && x.revision_id === revisionId);
    const s = syn.students.find((x) => x.student_id === id);
    if (!r || !s) return { ok: false, code: "professional_report_not_found", status: 404 };
    const printed = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date());
    return {
      ok: true,
      value: {
        org_id: orgId, student_id: id,
        snapshot: { format: "jungsi.counseling-snapshot/v1", status: "ready", snapshot_version: revisionId, generated_at: r.created_at_utc, report: r.published_result },
        watermark: { organization_name: SYN_ORG.org_name, teacher_code: "SYNTEACH01", printed_at_seoul: printed, student_name: s.display_name },
        counseling_reasons: r.counseling_reasons,
      },
    };
  },
};

const unconfigured = new Proxy({} as ProSource, { get: () => () => Promise.reject(new ConnectionError("unconfigured", "pro_api_not_configured")) });

export function proSource(): ProSource {
  const m = apiMode();
  return m === "synthetic" ? synSource : m === "live" ? liveSource : unconfigured;
}

/** 주소의 기관·학생 번호 형식 확인(형식만. 권한은 서버) */
export const validId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
