import "server-only";
import { AccessDenied, ConnectionError, type Caller, type JungsiSource } from "@/lib/api";
import type { AssessmentDto, OfferingDto, ReportDto, ShortlistEntryDto } from "@/lib/dto";
import { currentReportId } from "@/lib/report-ref";

/*
  3·4페이지(와 2페이지 유료 부분)가 리포트에 묶인 분석을 쓰는 방법.
  - 개인 분석은 report.analyses 에, 후보는 report.candidates 에, 선택은 report.shortlist 에 있다(API_DTO 계약).
  - 회원이 분석 버튼을 눌렀을 때만 university.analyze / candidates.build 로 리포트를 갱신한다.
  - 요청 키는 (operation, 리포트, revision, 실제 요청 본문)으로 정해 같은 요청을 중복 실행하지 않고,
    다른 화면이 먼저 갱신해 revision_conflict 가 나면 새로 읽어 한 번만 다시 시도한다.
*/

/** 요청 키: [A-Za-z0-9._:-] 128자 이내(서버의 등록 토큰 형식) */
async function key(prefix: string, report: ReportDto, body: object) {
  const bytes = new TextEncoder().encode(JSON.stringify([prefix, report.report_id, report.report_version, body]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${hex}`;
}

/** 같은 집합은 같은 순서·본문으로 보낸다. 공란·중복으로 100개 한도를 소비하지 않는다. */
export function canonicalOfferingIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

/** failed: 서버가 갱신을 거절했다(사유 코드). 화면 전체를 깨지 않고 갱신 전 리포트로 그리며 사유만 안내한다 */
export type ReportState =
  | { kind: "none" }
  | { kind: "ready"; report: ReportDto }
  | { kind: "score_required"; report: ReportDto | null }
  | { kind: "failed"; report: ReportDto; code: string };

/** 내 리포트 = 계정의 현재 리포트(서버 입력 상태, 2026-11-04 사용자 결정). 없으면 성적 입력이 먼저다 */
export async function loadMine(src: JungsiSource, caller: Caller): Promise<ReportDto | null> {
  const id = await currentReportId(src, caller);
  await rememberCurrentReport(src, caller, id);
  return id ? src.readReport(caller, id) : null;
}

/*
  현재 리포트 미리 읽기 — 임시 조치(2026-11-10 부담당자 요청, 최종관리자 결정).
  서버의 '현재 리포트 한 번에 주는 경로'(속도 요청 D)가 켜지면 이 묶음(아래 hint~loadMineEager)을 걷어내고 한 번 호출로 바꾼다.
  - 지금은 입력 상태(score-input-status)가 와야 리포트 번호를 알아 리포트 읽기가 이어서 기다린다(약 1초).
    지난번에 확인한 현재 리포트 번호를 '힌트'로 두고, 입력 상태와 그 번호의 리포트를 동시에 보낸다.
  - 힌트는 화면 서버(Worker) 메모리에만 둔다. 브라우저·기기에는 리포트 번호를 기억하지 않는다(2026-11-04 결정 그대로).
  - 열쇠는 access token 의 SHA-256 이다. 같은 로그인 안에서만 쓰이므로 다른 계정이나 다시 로그인한 뒤에는 열쇠가 달라
    앞 계정의 번호로 요청이 나가지 않는다. 토큰 원문은 두지 않는다. 30분 지나면 버리고 500 로그인까지만 둔다.
  - 어느 리포트를 여는지는 언제나 입력 상태의 current_report_id 가 정한다. 힌트와 다르면 미리 읽은 것은 버리고 맞는 번호로 읽는다.
    같을 때만 미리 읽은 결과를 쓰며, 그 결과(404·403·연결 오류 포함)는 힌트 없이 읽었을 때와 같게 처리된다.
  - 3페이지에는 쓰지 않는다(계정당 동시 2건 — 검색과 겹치면 목록이 늦어진다). 3페이지·버튼 동작은 힌트를 적어 두기만 한다.
*/
const HINT_TTL_MS = 30 * 60_000;
const HINT_MAX = 500;
const hints = new Map<string, { id: string; at: number }>();

async function hintKey(src: JungsiSource, caller: Caller): Promise<string | null> {
  if (src.kind === "synthetic") return "synthetic"; // 합성 화면(로컬 확인용)은 로그인이 없다
  if (!caller.accessToken) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(caller.accessToken));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 입력 상태로 확인한 현재 리포트 번호를 이 로그인의 힌트로 적는다(없으면 지운다) */
export async function rememberCurrentReport(src: JungsiSource, caller: Caller, id: string | null | undefined): Promise<void> {
  const key = await hintKey(src, caller);
  if (!key) return;
  hints.delete(key);
  if (!id) return;
  hints.set(key, { id, at: Date.now() });
  while (hints.size > HINT_MAX) hints.delete(hints.keys().next().value as string);
}

function recallHint(key: string): string | null {
  const h = hints.get(key);
  if (!h) return null;
  if (Date.now() - h.at > HINT_TTL_MS) {
    hints.delete(key);
    return null;
  }
  return h.id;
}

export interface EagerReport {
  hint: string | null;
  pre: Promise<ReportDto | null> | null;
}

/** 힌트가 있으면 그 번호의 리포트를 먼저 보낸다. 입력 상태와 함께 부른다. 거절되지 않는다 */
export async function startEagerReport(src: JungsiSource, caller: Caller): Promise<EagerReport> {
  const key = await hintKey(src, caller);
  const hint = key ? recallHint(key) : null;
  if (!hint) return { hint: null, pre: null };
  const pre = src.readReport(caller, hint);
  pre.catch(() => {}); // 힌트가 틀려 버릴 때 처리되지 않은 거절로 남지 않게(같으면 아래에서 그대로 기다린다)
  return { hint, pre };
}

/** 입력 상태의 현재 리포트 번호로 리포트를 얻는다. 힌트와 같으면 미리 보낸 요청을, 다르면 새로 읽는다 */
export function finishEagerReport(src: JungsiSource, caller: Caller, eager: EagerReport, id: string): Promise<ReportDto | null> {
  return eager.pre && eager.hint === id ? eager.pre : src.readReport(caller, id);
}

/** loadMine 과 같은 결과. 2·4페이지 전용(입력 상태와 힌트 리포트를 동시에 보낸다) */
export async function loadMineEager(src: JungsiSource, caller: Caller): Promise<ReportDto | null> {
  const eagerP = startEagerReport(src, caller);
  const id = await currentReportId(src, caller);
  const eager = await eagerP;
  await rememberCurrentReport(src, caller, id);
  return id ? finishEagerReport(src, caller, eager, id) : null;
}

/**
 * 화면을 나눠 그릴 때(2026-11-10 부담당자 요청: 먼저 온 것부터 그리기) 내 리포트를 기다리지 않고 받기 시작만 한다.
 * 실패해도 거절되지 않는 약속으로 바꿔, 리포트가 필요한 칸만 그 결과를 기다리며 각자 안내를 그린다.
 * 연결 문제(ConnectionError)·권한(AccessDenied)이 아닌 오류는 fatal 로 넘겨 받은 칸에서 다시 던진다(화면 오류).
 */
export type MineResult =
  | { ok: true; report: ReportDto | null }
  | { ok: false; error: ConnectionError | AccessDenied }
  | { ok: false; fatal: unknown };

/**
 * 3페이지 전용(2026-11-18 대표님 요청: 첫 화면 12초). 계정당 동시 2건을 지키면서 리포트를 먼저 읽는다.
 * 힌트(지난번 확인한 현재 리포트 번호)가 있으면 그 리포트 읽기를 검색과 함께 바로 보내고(동시 2건),
 * 입력 상태는 검색(gate)이 끝난 뒤에 보낸다. 그때 함께 도는 것은 리포트 읽기 하나뿐이라 동시 2건을 넘지 않는다.
 * 어느 리포트를 여는지는 전과 같이 입력 상태의 번호가 정한다(힌트와 다르면 미리 읽은 것은 버린다).
 * 힌트가 없으면 전과 똑같이 입력 상태 → 리포트 순서다(목록은 늦어지지 않는다).
 */
export async function loadMineAfter(src: JungsiSource, caller: Caller, gate: Promise<unknown>): Promise<ReportDto | null> {
  const eager = await startEagerReport(src, caller);
  if (!eager.pre) return loadMine(src, caller);
  await gate.then(() => undefined, () => undefined);
  const id = await currentReportId(src, caller);
  await rememberCurrentReport(src, caller, id);
  return id ? finishEagerReport(src, caller, eager, id) : null;
}

export function startMine(src: JungsiSource, caller: Caller, gate?: Promise<unknown>): Promise<MineResult> {
  return (gate ? loadMineAfter(src, caller, gate) : loadMine(src, caller)).then(
    (report): MineResult => ({ ok: true, report }),
    (e): MineResult => (e instanceof ConnectionError || e instanceof AccessDenied ? { ok: false, error: e } : { ok: false, fatal: e }),
  );
}

/** 받은 결과에서 리포트를 꺼낸다. fatal 은 그 자리에서 다시 던진다 */
export function mineReport(m: MineResult): ReportDto | null {
  if (m.ok) return m.report;
  if ("fatal" in m) throw m.fatal;
  return null;
}

/** 담은 모집단위 번호(report.shortlist 의 selected). 이름(offering.read)이 없어도 담기 표시는 이것으로 그린다 */
export function pickedIds(report: ReportDto | null): Set<string> {
  return new Set(Object.entries(report?.shortlist ?? {}).filter(([, e]) => e.selected).map(([id]) => id));
}

async function retryOnConflict(src: JungsiSource, caller: Caller, report: ReportDto, run: (r: ReportDto, attempt: number) => ReturnType<JungsiSource["analyzeUniversities"]>): Promise<ReportState> {
  let current = report;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await run(current, attempt);
    if (res.ok) return { kind: "ready", report: res.value };
    if (res.code === "score_confirmation_required") return { kind: "score_required", report: current };
    if (res.code !== "revision_conflict") return { kind: "failed", report: current, code: res.code };
    if (attempt === 1) return { kind: "failed", report: current, code: res.code };
    const fresh = await src.readReport(caller, current.report_id);
    if (!fresh) return { kind: "none" };
    current = fresh;
  }
  return { kind: "failed", report: current, code: "revision_conflict" };
}

/** 보이는 모집행 중 아직 분석이 없는 것만 university.analyze 로 채운다(한 번에 100개까지) */
export async function ensureAnalyses(src: JungsiSource, caller: Caller, report: ReportDto, ids: string[]): Promise<ReportState> {
  const targets = canonicalOfferingIds(ids);
  return retryOnConflict(src, caller, report, async (r) => {
    const missing = targets.filter((id) => !r.analyses?.[id]).slice(0, 100);
    if (missing.length === 0) return { ok: true, value: r };
    const body = { expected_version: r.report_version, offering_ids: missing };
    return src.analyzeUniversities(caller, r.report_id, r.report_version, missing, await key("ua", r, body));
  });
}

/** 후보가 아직 없으면 candidates.build 로 만든다 */
export async function ensureCandidates(src: JungsiSource, caller: Caller, report: ReportDto): Promise<ReportState> {
  return retryOnConflict(src, caller, report, async (r) => {
    if (r.candidates) return { ok: true, value: r };
    return src.buildCandidates(caller, r.report_id, r.report_version, await key("cb", r, { expected_version: r.report_version }));
  });
}

/** 한 번의 명시 조작을 리포트·원래 성적·표시 당시 revision에 결속한다. 재전송은 같은 intent를 쓴다. */
export interface RefreshIntent {
  id: string;
  reportId: string;
  profileId: string;
  reportVersion: number;
}

function refreshGuard(report: ReportDto, intent: RefreshIntent): ReportState | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.id) ||
      !Number.isSafeInteger(intent.reportVersion) || intent.reportVersion < 1 || intent.reportVersion > report.report_version) {
    return { kind: "failed", report, code: "invalid_refresh_intent" };
  }
  if (report.report_id !== intent.reportId || report.profile_id !== intent.profileId) {
    return { kind: "failed", report, code: "refresh_target_changed" };
  }
  return null;
}

/** 명시한 모집행만 재확인한다. 저장된 ready/pending을 이유로 요청을 생략하지 않는다. */
export async function refreshAnalyses(src: JungsiSource, caller: Caller, report: ReportDto, ids: string[], intent: RefreshIntent): Promise<ReportState> {
  const rejected = refreshGuard(report, intent);
  if (rejected) return rejected;
  const targets = canonicalOfferingIds(ids);
  if (targets.length < 1 || targets.length > 100) return { kind: "failed", report, code: "invalid_refresh_scope" };
  return retryOnConflict(src, caller, report, async (r, attempt) => {
    const changed = refreshGuard(r, intent);
    if (changed) return { ok: false, code: changed.kind === "failed" ? changed.code : "refresh_target_changed", status: 409 };
    // 첫 전송은 폼에 결속한 revision을 유지해 같은 intent의 저장 응답을 회복할 수 있게 한다.
    // 충돌 후 한 번의 재조회에서만 현재 revision으로 다시 보낸다.
    const expected = attempt === 0 ? intent.reportVersion : r.report_version;
    const wire = { ...r, report_version: expected };
    const body = { expected_version: expected, offering_ids: targets };
    return src.analyzeUniversities(caller, r.report_id, expected, targets, await key("uar", wire, { intent_id: intent.id, request: body }));
  });
}

/** 명시한 기존 성적의 후보를 다시 확인한다. 현재 context의 no-op 판단은 서버가 맡는다. */
export async function refreshCandidates(src: JungsiSource, caller: Caller, report: ReportDto, intent: RefreshIntent): Promise<ReportState> {
  const rejected = refreshGuard(report, intent);
  if (rejected) return rejected;
  return retryOnConflict(src, caller, report, async (r, attempt) => {
    const changed = refreshGuard(r, intent);
    if (changed) return { ok: false, code: changed.kind === "failed" ? changed.code : "refresh_target_changed", status: 409 };
    const expected = attempt === 0 ? intent.reportVersion : r.report_version;
    const wire = { ...r, report_version: expected };
    const body = { expected_version: expected };
    return src.buildCandidates(caller, r.report_id, expected, await key("cbr", wire, { intent_id: intent.id, request: body }));
  });
}

/** 담기·빼기: 최신 revision 으로 shortlist.update. 같은 상태 쓰기는 서버가 revision 을 올리지 않는다 */
export async function togglePickOn(src: JungsiSource, caller: Caller, report: ReportDto, offeringId: string, selected: boolean): Promise<ReportState> {
  return retryOnConflict(src, caller, report, async (r) =>
    src.updateShortlist(caller, r.report_id, offeringId, selected, r.report_version, await key("sl", r, { offering_id: offeringId, selected, expected_version: r.report_version })),
  );
}

export interface PickedItem {
  offering: OfferingDto | null; // 카탈로그에서 빠졌으면 null
  offering_id: string;
  entry: ShortlistEntryDto;
  assessment: AssessmentDto | null;
}

/** 선택된 항목만, 이름은 offering.read 로 붙인다(report.shortlist 에는 이름이 없다) */
export async function pickedItems(src: JungsiSource, caller: Caller, report: ReportDto, known: OfferingDto[] = []): Promise<PickedItem[]> {
  const entries = Object.entries(report.shortlist ?? {}).filter(([, e]) => e.selected);
  return Promise.all(
    entries.map(async ([id, entry]) => {
      const offering = known.find((o) => o.offering_id === id) ?? (await src.readOffering(caller, id))?.offering ?? null;
      return { offering, offering_id: id, entry, assessment: report.analyses?.[id] ?? null };
    }),
  );
}
