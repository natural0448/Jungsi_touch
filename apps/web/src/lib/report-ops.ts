import "server-only";
import { AccessDenied, ConnectionError, type Caller, type JungsiSource, type StatusScanRequest } from "@/lib/api";
import type { AssessmentDto, CandidatesDto, CsatMinimum, OfferingDto, OverallAnalysisDto, ReferenceBandDto, ReportDto, ShortlistEntryDto } from "@/lib/dto";
import { currentReportId, screenReport } from "@/lib/report-ref";
import { CSAT_INCOMPLETE_TTL_MS, csatBandsIncomplete, csatJudged, pickedIds, provisionalOnly } from "@/lib/report-pure";

// 브라우저 화면도 쓰는 읽기 전용 판단은 report-pure 에 둔다(서버 전용 모듈이 브라우저 묶음에 끌려가지 않게, 2026-11-22)
export { csatJudged, pickedIds, provisionalOnly };

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
  return id ? screenReport(caller, await src.readReport(caller, id)) : null;
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
  return id ? screenReport(caller, await finishEagerReport(src, caller, eager, id)) : null;
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
  return id ? screenReport(caller, await finishEagerReport(src, caller, eager, id)) : null;
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
    current = conflictVersion(fresh, current);
  }
  return { kind: "failed", report: current, code: "revision_conflict" };
}

/**
 * 409 뒤 다시 읽은 리포트로 한 번 더 보낼 판(2026-11-22 운영: 3페이지 candidates.build 가 판을 올린 직후
 * university.analyze 가 409 를 두 번 받았다 — 다시 읽은 리포트가 쓰기 직후라 아직 앞 판을 돌려줬다).
 * 서버가 거절했다는 것은 보낸 판보다 새 판이 있다는 뜻이므로, 다시 읽은 판이 보낸 판보다 크지 않으면 보낸 판 + 1 로 보낸다.
 * 리포트 판은 쓰기마다 1씩 오른다. 그래도 맞지 않으면 실패로 끝낸다(한 번만 다시 보낸다)
 */
export function conflictVersion(fresh: ReportDto, sent: ReportDto): ReportDto {
  return fresh.report_version > sent.report_version ? fresh : { ...fresh, report_version: sent.report_version + 1 };
}

/** 같은 리포트를 쓰기 응답과 다시 읽기로 둘 다 받았을 때, 다시 읽은 쪽이 앞 판이면(쓰기 직후 지연) 쓰기 응답의 판을 쓴다 */
export function newerVersion(read: ReportDto, written: ReportDto): ReportDto {
  return read.report_id === written.report_id && written.report_version > read.report_version ? { ...read, report_version: written.report_version } : read;
}

/** 보이는 모집행 중 아직 분석이 없는 것만 university.analyze 로 채운다(한 번에 100개까지) */
export async function ensureAnalyses(src: JungsiSource, caller: Caller, report: ReportDto, ids: string[]): Promise<ReportState> {
  if (csatJudged(report)) return { kind: "ready", report };
  const targets = canonicalOfferingIds(ids);
  return retryOnConflict(src, caller, report, async (r) => {
    const missing = targets.filter((id) => !r.analyses?.[id]).slice(0, 100);
    if (missing.length === 0) return { ok: true, value: r };
    const body = { expected_version: r.report_version, offering_ids: missing };
    return src.analyzeUniversities(caller, r.report_id, r.report_version, missing, await key("ua", r, body));
  });
}

/*
  4페이지 수능 가채점 판정(서버 dep_r29, 2026-11-23). 보이는 모집단위를 university.analyze 로 보내면 서버가 3페이지와 같은
  계산·같은 판정 묶음으로 그 모집단위만 7단계(안정~불가 모두)를 판정해 응답의 candidates.reference_university_groups
  (행 reference_band, basis reference_threshold, source "g")에 싣는다. 리포트에 저장되지 않아 report.read 에는 없다.
  - 판정이 없는 모집단위(산식 결속 대기·예외 표시 17곳·이 성적 조합으로 계산 불가)는 응답에 없다 → '가채점 판정 준비 중'.
  - 실패(연결 오류·409 두 번·옛 서버)는 빈 표 → 지금처럼 '가채점 판정 준비 중'. 오류 화면은 없다.
  - 같은 리포트·같은 모집단위 묶음은 이 Worker 메모리에 15분 둔다(성적·판정 묶음이 바뀌면 리포트도 바뀐다).
  - 요청마다 리포트 판이 하나 오른다(3페이지 candidates.build 와 같다). 그래서 쓴 뒤의 판을 함께 돌려준다.
*/
// reference-percentile thresholdBandOf 와 같은 검사(시험의 모듈 대체 목록을 늘리지 않으려고 여기 둔다)
const P4_BAND_CODES = new Set(["stable", "downward", "target", "aspirational", "upward", "challenge", "outside"]);
const thresholdBandOf = (b: ReferenceBandDto | null | undefined): ReferenceBandDto | null =>
  b && b.basis === "reference_threshold" && typeof b.code === "string" && P4_BAND_CODES.has(b.code) ? b : null;
const provisionalMemo = new Map<string, { bands: Record<string, ReferenceBandDto>; min: Record<string, CsatMinimum>; display: SchoolDisplay; at: number; ttl: number }>();
type SchoolDisplay = NonNullable<OverallAnalysisDto["provisional_school_display"]>;
/** 2026-11-24 담당자 v3: 서버가 7단계를 내지 않은 모집단위(candidates.csat_withheld) → 모집단위별 가운데 환산점수·사유 */
export function schoolDisplayOf(c: CandidatesDto | null | undefined): SchoolDisplay {
  const out: SchoolDisplay = {};
  for (const x of c?.csat_withheld ?? []) {
    if (!x || typeof x.offering_id !== "string") continue;
    if (x.reason !== "comparison_axis_unverified" && x.reason !== "non_csat_components_missing") continue;
    out[x.offering_id] = { reason: x.reason, score_kind: x.score_kind === "csat_component" ? "csat_component" : "university_score", central_score: typeof x.central_score === "string" ? x.central_score : null };
  }
  return out;
}
/** 리포트 전체 분석(overall)에 보류 표시를 더한 사본. 더할 것이 없으면 그대로 */
export function withSchoolDisplay<T extends OverallAnalysisDto | null | undefined>(a: T, d: SchoolDisplay | null | undefined): T {
  if (!a || !d || Object.keys(d).length === 0) return a;
  return { ...a, provisional_school_display: { ...(a.provisional_school_display ?? {}), ...d } };
}
/** 응답의 수능 최저 사유 목록 → 모집단위별 */
function minimumOf(c: CandidatesDto | null | undefined): Record<string, CsatMinimum> {
  const out: Record<string, CsatMinimum> = {};
  for (const id of c?.csat_minimum_partial ?? []) out[id] = "partial";
  for (const id of c?.csat_condition_unmet ?? []) out[id] = "condition";
  for (const id of c?.csat_inquiry_cap ?? []) out[id] = "cap";
  for (const id of c?.csat_minimum_unmet ?? []) out[id] = "unmet";
  return out;
}
/**
 * 서버 dep_r38(2026-11-24 대표님 지적: 지원가능성 필터가 120개만 보고 멈췄다): 전국 판정에서 고른 단계 모집단위 한 쪽.
 * 받지 못하면 null(화면은 앞 방식으로 쪽마다 확인한다). 판정 있는 행의 점수·위치·유불리는 bands 에.
 */
export async function provisionalScan(src: JungsiSource, caller: Caller, report: ReportDto, scan: StatusScanRequest): Promise<{ offerings: OfferingDto[]; bands: Record<string, ReferenceBandDto>; matched: number; next: string | null; complete: boolean; min: Record<string, CsatMinimum>; display: SchoolDisplay } | null> {
  if (!csatJudged(report)) return null;
  const ask = (attempt: number) =>
    retryOnConflict(src, caller, report, async (r) => {
      const body = { expected_version: r.report_version, status_scan: scan };
      return src.scanUniversities(caller, r.report_id, r.report_version, scan, await key(attempt ? `uas${attempt}` : "uas", r, body));
    });
  let state: ReportState;
  try {
    state = await ask(0);
    if (state.kind === "ready" && state.report.candidates?.status_scan?.complete === false) {
      await new Promise((r) => setTimeout(r, 1500));
      const again = await ask(1).catch(() => null);
      if (again && again.kind === "ready") state = again;
    }
  } catch {
    logSettle("p4_scan_failed", { thrown: true });
    return null;
  }
  if (state.kind !== "ready") return null;
  const sc = state.report.candidates?.status_scan;
  if (!sc || !Array.isArray(sc.offerings)) return null;
  const bands: Record<string, ReferenceBandDto> = {};
  for (const g of state.report.candidates?.reference_university_groups ?? []) {
    for (const it of g.offerings ?? []) {
      const id = it.offering?.offering_id;
      const b = thresholdBandOf(it.reference_band);
      if (typeof id === "string" && b && b.source === "g") bands[id] = b;
    }
  }
  logSettle("p4_scan", { matched: sc.matched, page: sc.offerings.length });
  return { offerings: sc.offerings, bands, matched: sc.matched, next: sc.next_after, complete: sc.complete, min: minimumOf(state.report.candidates), display: schoolDisplayOf(state.report.candidates) };
}

export async function provisionalBands(src: JungsiSource, caller: Caller, report: ReportDto, ids: string[]): Promise<{ bands: Record<string, ReferenceBandDto>; version: number; min: Record<string, CsatMinimum>; display: SchoolDisplay }> {
  const none = { bands: {}, version: report.report_version, min: {}, display: {} };
  if (!csatJudged(report)) return none;
  const targets = canonicalOfferingIds(ids).slice(0, 100);
  if (targets.length === 0) return none;
  const mk = JSON.stringify([report.report_id, report.profile_id, targets]);
  const hit = provisionalMemo.get(mk);
  if (hit && Date.now() - hit.at <= hit.ttl) return { bands: hit.bands, version: report.report_version, min: hit.min, display: hit.display };
  let state: ReportState;
  const ask = (attempt: number) =>
    retryOnConflict(src, caller, report, async (r) => {
      const body = { expected_version: r.report_version, offering_ids: targets };
      // 다시 받을 때는 다른 요청 키(같은 키면 서버가 앞 응답을 그대로 돌려준다)
      return src.analyzeUniversities(caller, r.report_id, r.report_version, targets, await key(attempt ? `uap${attempt}` : "uap", r, body));
    });
  try {
    state = await ask(0);
    // 서버(dep_r32)가 곡선·총점 분포를 시간 안에 다 못 읽었으면 complete=false. 뒤에서 마저 읽으므로 잠시 뒤 한 번만 다시 받는다(2026-11-23)
    if (state.kind === "ready" && state.report.candidates?.reference_threshold_summary?.complete === false) {
      await new Promise((r) => setTimeout(r, 1500));
      const again = await ask(1).catch(() => null);
      if (again && again.kind === "ready") state = again;
    }
  } catch (e) {
    logSettle("p4_csat_failed", { thrown: true });
    return none;
  }
  if (state.kind !== "ready") {
    logSettle("p4_csat_failed", { thrown: false, conflict: state.kind === "failed" && state.code === "revision_conflict" });
    return none;
  }
  const want = new Set(targets);
  const bands: Record<string, ReferenceBandDto> = {};
  for (const g of state.report.candidates?.reference_university_groups ?? []) {
    for (const it of g.offerings ?? []) {
      const id = it.offering?.offering_id;
      const b = thresholdBandOf(it.reference_band);
      if (typeof id === "string" && want.has(id) && b && b.source === "g") bands[id] = b;
    }
  }
  logSettle("p4_csat", { asked: targets.length, judged: Object.keys(bands).length });
  const display = schoolDisplayOf(state.report.candidates);
  if (Object.keys(bands).length || Object.keys(display).length) {
    provisionalMemo.delete(mk);
    // 위치·유불리가 덜 찬 결과(서버가 곡선을 아직 다 못 읽음)는 짧게만 기억한다(2026-11-23)
    provisionalMemo.set(mk, { bands, min: minimumOf(state.report.candidates), display, at: Date.now(), ttl: csatBandsIncomplete(bands) ? CSAT_INCOMPLETE_TTL_MS : REFERENCE_TTL_MS });
    while (provisionalMemo.size > REFERENCE_MAX) provisionalMemo.delete(provisionalMemo.keys().next().value as string);
  }
  return { bands, version: Math.max(report.report_version, state.report.report_version), min: minimumOf(state.report.candidates), display };
}

/** 후보가 아직 없으면 candidates.build 로 만든다 */
export async function ensureCandidates(src: JungsiSource, caller: Caller, report: ReportDto): Promise<ReportState> {
  // 가채점도 보낸다(dep_r22: 3페이지 학교별 가채점 7단계는 candidates.build 응답에만 실린다)
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

/*
  화면을 열 때 계산을 끝낸 뒤 보여 주기(2026-11-21 대표님 지적: '분석 대기'·'아직 분석하지 않았습니다' 띠, '판정 근거 부족'이
  몇 초 뒤 '안정'으로 바뀌는 깜박임이 고객에게 보이면 안 된다).
  - 3·4페이지 본문은 아래 두 함수가 끝날 때까지 책 넘김 대기 화면(Suspense fallback)을 둔다.
  - 이미 분석된 곳은 다시 계산하지 않는다(ensureAnalyses·ensureCandidates 와 같은 요청 키 → 서버가 중복 실행하지 않는다).
  - 서버가 옛 자료판으로 계산됐다고 알려 준 곳(stale)은 같은 성적으로 한 번 다시 확인한 뒤 보인다. 재확인 의도 번호는
    (리포트·판·범위)에서 정해 만들어, 같은 화면을 다시 열어도 같은 요청 키가 되어 서버가 두 번 계산하지 않는다.
  - 실패해도 화면을 깨지 않고 받은 리포트로 그린다(빈 칸은 확정 표시 규칙대로).
*/
async function stableIntent(report: ReportDto, scope: string): Promise<RefreshIntent> {
  const bytes = new TextEncoder().encode(JSON.stringify(["auto-refresh", report.report_id, report.profile_id, report.report_version, scope]));
  const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return { id, reportId: report.report_id, profileId: report.profile_id, reportVersion: report.report_version };
}

/*
  재확인 되풀이 막기(2026-11-21). 재확인한 뒤에도 서버가 계속 '옛 자료판'이라고 하면 그 결과를 확정 표시로 두고,
  화면을 다시 열 때마다 또 보내지 않는다. (리포트·성적·범위)마다 재확인 뒤의 리포트 판을 화면 서버(Worker) 메모리에 적어 두고,
  리포트 판이 그보다 올라가지 않았으면(새 분석·담기 등이 없었으면) 다시 보내지 않는다. 6시간 지나면 버리고 1,000건까지만 둔다.
*/
const RECHECK_TTL_MS = 6 * 60 * 60_000;
const RECHECK_MAX = 1000;
const rechecked = new Map<string, { version: number; at: number; tries: number }>();

/** 운영 확인용 기록. 리포트 번호·성적·학교 이름은 남기지 않고 개수·참거짓만 적는다 */
function logSettle(kind: string, facts: Record<string, number | boolean>) {
  try {
    console.info(`[jungsi-settle] ${kind} ${Object.entries(facts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  } catch {
    // 기록 실패는 화면에 영향 없음
  }
}

/** 자동 계산·화면 준비 중 예상 밖 오류. 화면은 깨지 않고 이유만 남긴다(리포트 번호·성적·학교 이름 없음) */
export function logSettleError(step: string, e: unknown) {
  try {
    const name = e instanceof Error ? e.name : typeof e;
    const msg = e instanceof Error ? e.message.slice(0, 200) : "";
    const at = e instanceof Error ? (e.stack ?? "").split("\n").slice(1, 3).map((s) => s.trim()).join(" | ") : "";
    console.warn(`[jungsi-settle] error step=${step} ${name}: ${msg} @ ${at}`);
  } catch {
    // 기록 실패는 화면에 영향 없음
  }
}

function recheckKey(kind: string, report: ReportDto, scope: string) {
  return JSON.stringify([kind, report.report_id, report.profile_id, scope]);
}

/** 이 판(또는 그 뒤 판)에서 이 범위를 재확인한 횟수. 판이 그 뒤로 올라갔으면 0 */
function recheckTries(kind: string, report: ReportDto, scope: string, anyVersion = false): number {
  const k = recheckKey(kind, report, scope);
  const r = rechecked.get(k);
  if (!r) return 0;
  if (Date.now() - r.at > RECHECK_TTL_MS) {
    rechecked.delete(k);
    return 0;
  }
  return anyVersion || report.report_version <= r.version ? r.tries : 0;
}

/** 이 범위를 이 판(또는 그 뒤 판)에서 이미 limit 번 재확인했는지(기본 한 번) */
export function alreadyRechecked(kind: string, report: ReportDto, scope: string, limit = 1): boolean {
  return recheckTries(kind, report, scope) >= limit;
}

function markRechecked(kind: string, before: ReportDto, after: ReportDto, scope: string, anyVersion = false) {
  const k = recheckKey(kind, before, scope);
  const tries = recheckTries(kind, before, scope, anyVersion) + 1;
  rechecked.delete(k);
  rechecked.set(k, { version: Math.max(before.report_version, after.report_version), at: Date.now(), tries });
  while (rechecked.size > RECHECK_MAX) rechecked.delete(rechecked.keys().next().value as string);
}

/**
 * 갱신 한 번. 거절·연결 실패면 갱신 전 리포트로 그린다. 응답만 503 으로 끊겼으면 저장됐을 수 있어 한 번 다시 읽는다.
 * 쓰기가 실제로 나가 성공했으면 응답 본문 대신 리포트를 새로 읽어 그린다(2026-11-22 운영: 자료판 rnat3d→rnat3f 직후
 * 4페이지 전남대 30줄이 재확인 200 뒤에도 옛 결과로 그려지고, 다시 열어야 새 판정이 보였다).
 * 쓰기 응답 본문에는 리포트 읽기에서만 붙는 값(옛 자료판 표식 stale_analysis_ids·candidates_stale 등)이 빠지고,
 * 화면 서버가 읽을 때만 하는 보정(live.ts reportOf: 지원 요건 표시)도 거치지 않는다. 버튼 방식(서버 액션 → 화면 다시 그리기)은
 * 늘 리포트를 다시 읽어 이 차이가 드러나지 않았다. 다시 읽기는 쓰기 뒤 새 기억 열쇠로 가므로(writeGeneration) 옛 기억을 쓰지 않는다.
 */
async function settleStep(src: JungsiSource, caller: Caller, current: ReportDto, run: () => Promise<ReportState>): Promise<ReportDto> {
  try {
    const st = await run();
    if (st.kind !== "ready") return current;
    if (st.report === current) return current; // 보낼 것이 없어 쓰기를 하지 않았다
    try {
      const read = await src.readReport(caller, st.report.report_id);
      return read ? newerVersion(read, st.report) : st.report;
    } catch (e) {
      // 2026-11-22 운영 사고 방어: 자동 계산은 화면을 돕는 일이다. 연결 오류가 아닌 예상 밖 오류(Error)도 화면 전체를
      // 오류 화면으로 깨지 않고 받은 리포트로 그린 뒤 이유만 기록한다
      if (!(e instanceof ConnectionError || e instanceof AccessDenied)) logSettleError("reread", e);
      return st.report;
    }
  } catch (e) {
    if (!(e instanceof ConnectionError || e instanceof AccessDenied)) {
      logSettleError("write", e);
      return current;
    }
    if (e instanceof ConnectionError && e.kind === "unavailable") {
      try {
        return (await src.readReport(caller, current.report_id)) ?? current;
      } catch {
        return current;
      }
    }
    return current;
  }
}

/**
 * 행들의 지금 분석 내용 지문(16자). 판단에 쓰인 버전(versions)과 화면에 보이는 결과(상태·판정·환산·누백)만 본다 —
 * 시각처럼 읽을 때마다 바뀔 수 있는 값으로 되풀이 막기가 풀리지 않게 한다
 */
export async function analysesFingerprint(report: ReportDto, ids: string[]): Promise<string> {
  const pick = (a: AssessmentDto | undefined) =>
    a && typeof a === "object"
      ? [a.versions ?? null, a.status ?? null, a.category ?? null, a.band?.code ?? null, a.reference_band?.code ?? null, a.reference_band?.upper_code ?? null,
        a.conversion?.converted_score ?? a.converted_score ?? null, a.percentile?.top_percent ?? a.converted_percentile ?? null,
        a.reference_percentile?.estimated_upper_cumulative_percent_all_examinees ?? null, a.decision_evidence?.version ?? null]
      : null;
  const body = JSON.stringify([...ids].sort().map((id) => [id, pick(report.analyses?.[id])]));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** 보이는 모집단위의 분석을 채우고(없는 것만), 옛 자료판 분석이면 다시 확인한 리포트를 돌려준다 */
export async function settleAnalyses(src: JungsiSource, caller: Caller, report: ReportDto, ids: string[]): Promise<ReportDto> {
  if (csatJudged(report)) return report;
  const targets = canonicalOfferingIds(ids).slice(0, 100);
  if (targets.length === 0) return report;
  let current = report;
  // 없는 행과 옛 자료판 행을 한 요청으로 보낸다(2026-11-21 운영 '자료 없음': 둘을 나눠 보내면 서버의 저장 한도 비우기가
  // 둘째 요청을 저장할 때 첫째 요청에서 막 계산한 행(번호가 작은 강원대 0000002·국민대 새 PK)을 지웠다. 리포트 79판까지 확인).
  // 한 요청 안의 행은 서버가 지우지 않는다. 함께 보낼 옛 자료판 행이 없으면 예전처럼 없는 행만 보낸다.
  const missing0 = targets.filter((id) => !current.analyses?.[id]);
  const stale0 = new Set(current.stale_analysis_ids ?? []);
  const staleWith = targets.filter((id) => stale0.has(id) && current.analyses?.[id]);
  if (missing0.length && staleWith.length) {
    const scope = `${staleWith.join(",")}@${await analysesFingerprint(current, staleWith)}+${missing0.join(",")}`;
    if (recheckTries("analyses", current, scope, true) < 1) {
      const base = current;
      const intent = await stableIntent(base, scope);
      current = await settleStep(src, caller, base, () => refreshAnalyses(src, caller, base, [...missing0, ...staleWith], intent));
      markRechecked("analyses", base, current, scope, true);
      logSettle("analyses_together", { missing: missing0.length, stale: staleWith.length, still_missing: missing0.filter((id) => !current.analyses?.[id]).length });
    }
  }
  // 함께 보낸 요청이 실패했으면(연결 오류 등) 없는 행만 한 번 더 보낸다
  if (targets.some((id) => !current.analyses?.[id])) {
    const base = current;
    current = await settleStep(src, caller, base, () => ensureAnalyses(src, caller, base, targets));
  }
  // 서버가 옛 자료판으로 계산됐다고 표시한 보이는 행은 모두 다시 계산한다.
  // 되풀이 막기(2026-11-22 운영: 판 rnat3h 적용 직후 4페이지 중앙대 첫 열기에서 옛 결과가 보이고 다시 열어야 새 판정이 나왔다):
  //  - 전에는 '리포트 판' 기준이라, 앞 자료판 때 같은 판·같은 30줄을 재확인한 기록이 남아 있으면 새 자료판의 재확인을 건너뛰었고,
  //    요청 키도 (리포트 판·범위)로만 정해 서버가 앞 자료판 때의 응답을 그대로 되돌려줄 수 있었다.
  //  - 서버는 지금 자료판 표식 자체를 응답에 싣지 않는다(stale_analysis_ids 만 준다). 그래서 '그 행들의 지금 분석 내용'의 지문을
  //    열쇠와 요청 키에 넣는다. 자료판이 바뀌어 다시 옛 분석이 되면 지문이 달라 반드시 다시 보내고, 다시 계산해도 서버가 같은 분석을
  //    돌려주며 계속 옛 분석이라 하면 지문이 같아 되풀이하지 않는다.
  //  - 다시 계산했는데도 일부가 여전히 옛 자료판이고 내용은 달라졌으면(자료판이 바뀌는 순간 서버의 다른 인스턴스가 앞 판으로 계산한 경우)
  //    같은 화면을 그리는 동안 한 번 더 보낸다. 그래도 남으면 그 결과로 그린다(최대 두 번).
  for (let round = 0; round < 2; round++) {
    const stale = new Set(current.stale_analysis_ids ?? []);
    const staleHere = targets.filter((id) => stale.has(id) && current.analyses?.[id]);
    if (staleHere.length === 0) break;
    const scope = `${staleHere.join(",")}@${await analysesFingerprint(current, staleHere)}`;
    const skip = recheckTries("analyses", current, scope, true) >= 1;
    if (!skip) {
      const base = current;
      const intent = await stableIntent(base, scope);
      current = await settleStep(src, caller, base, () => refreshAnalyses(src, caller, base, staleHere, intent));
      markRechecked("analyses", base, current, scope, true);
    }
    const still = new Set(current.stale_analysis_ids ?? []);
    logSettle("analyses", { round, stale: staleHere.length, sent: !skip, skipped: skip, after_stale: staleHere.filter((id) => still.has(id)).length });
    if (skip) break;
  }
  return current;
}

/*
  3페이지를 열 때의 후보(candidates.build) — 서버 dep_r17(2026-11-21, 문서 C:\j\w\p3_thresh\SCREEN_API_r17.md).
  - 참고 문턱 목록(reference_university_groups·reference_threshold_summary)은 리포트에 저장되지 않고 report.read 에도 없다.
    candidates.build 응답에만 실린다. 그래서 3페이지를 열 때마다 candidates.build 를 한 번 부르고(매번 새 요청 키 — 같은 키면
    서버가 목록 없는 저장본을 되돌려준다), 그 응답의 참고 목록으로 그린다. report.read 결과로 덮어쓰지 않는다.
  - 기본 목록·와일드카드·분석·담기·지원 요건 표시는 다시 읽은 리포트(report.read, 화면 서버 보정 포함)를 쓴다. 응답과 값이 같다.
  - 409 revision_conflict 면 report.read 로 판을 받아 한 번 더. 429 는 live.ts 가 조용히 기다렸다 다시 보낸다.
  - complete:false(서버가 미뤘거나 크기 한도로 뒤를 뺌)여도 따로 알리지 않고 받은 만큼 그린다. 자동으로 다시 부르지 않는다.
  - 서버 액션(담기·계열 펼침 계산) 뒤 같은 화면을 다시 그릴 때는 다시 부르지 않고, 이 화면 서버가 방금 받은 목록을 다시 쓴다
    (한 번 열 때 candidates.build 한 번). 목록은 Worker 메모리에 리포트별로 15분만 둔다.
  - dep_r13(목록이 리포트에 저장되던 예전 방식)과도 맞는다: 다시 읽은 리포트에 이미 참고 목록이 있으면 그것을 그대로 쓴다.
*/
type ReferenceLists = Pick<CandidatesDto, "reference_university_groups" | "reference_threshold_summary">;
const REFERENCE_TTL_MS = 15 * 60_000;
const REFERENCE_MAX = 300;
const referenceMemo = new Map<string, { lists: ReferenceLists; at: number }>();
const memoKey = (r: ReportDto) => JSON.stringify([r.report_id, r.profile_id]);

function rememberReference(r: ReportDto, lists: ReferenceLists) {
  const k = memoKey(r);
  referenceMemo.delete(k);
  referenceMemo.set(k, { lists, at: Date.now() });
  while (referenceMemo.size > REFERENCE_MAX) referenceMemo.delete(referenceMemo.keys().next().value as string);
}
function recallReference(r: ReportDto): ReferenceLists | null {
  const k = memoKey(r);
  const hit = referenceMemo.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > REFERENCE_TTL_MS) {
    referenceMemo.delete(k);
    return null;
  }
  return hit.lists;
}

/** 응답 후보에서 참고 목록만 꺼낸다. 목록이 없으면 null */
function referenceListsOf(c: CandidatesDto | null | undefined): ReferenceLists | null {
  const groups = c?.reference_university_groups;
  if (!Array.isArray(groups) || groups.length === 0) return null;
  return { reference_university_groups: groups, reference_threshold_summary: c?.reference_threshold_summary ?? null };
}

/** 리포트에 참고 목록을 붙인다. 리포트에 이미 목록이 있으면(예전 방식) 그대로 둔다. 후보가 없으면 응답 후보를 쓴다 */
function withReference(base: ReportDto, lists: ReferenceLists | null, fallback?: CandidatesDto | null): ReportDto {
  const c = base.candidates ?? fallback ?? null;
  if (!c) return base;
  if (!lists || referenceListsOf(c)) return c === base.candidates ? base : { ...base, candidates: c };
  return { ...base, candidates: { ...c, ...lists } };
}

const freshKey = () => `cbo-${crypto.randomUUID()}`;

/**
 * 3페이지를 열 때 후보를 만든다(위 설명). reuse: 서버 액션 뒤 다시 그리기 — 방금 받은 목록이 있으면 candidates.build 를 부르지 않는다.
 * 어떤 실패에도 받은 리포트로 그린다(화면 전체를 깨지 않는다).
 */
export async function settleCandidates(src: JungsiSource, caller: Caller, report: ReportDto, opts: { reuse?: boolean } = {}): Promise<ReportDto> {
  // 가채점 리포트도 보낸다(dep_r22). 판정 Secret 이 없으면 응답에 참고 묶음이 없고 3페이지는 '가채점 판정 준비 중'
  if (opts.reuse) {
    const lists = recallReference(report);
    if (lists && report.candidates) {
      logSettle("candidates", { sent: false, reused: true });
      return withReference(report, lists);
    }
  }
  let current = report;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Awaited<ReturnType<JungsiSource["buildCandidates"]>>;
    try {
      res = await src.buildCandidates(caller, current.report_id, current.report_version, freshKey());
    } catch (e) {
      if (!(e instanceof ConnectionError || e instanceof AccessDenied)) logSettleError("candidates-build", e);
      // 응답만 503 으로 끊겼으면 저장됐을 수 있어 다시 읽는다(참고 목록은 받지 못했으니 기본 목록만)
      if (e instanceof ConnectionError && e.kind === "unavailable") return (await rereadOr(src, caller, current)) ?? current;
      return current;
    }
    if (res.ok) {
      const built = res.value;
      const lists = referenceListsOf(built.candidates);
      if (lists) rememberReference(built, lists);
      const read = await rereadOr(src, caller, built);
      const out = withReference(read ? newerVersion(read, built) : built, lists, built.candidates);
      const sum = lists?.reference_threshold_summary;
      logSettle("candidates", { sent: true, attempt, rows: (lists?.reference_university_groups ?? []).reduce((n, g) => n + (g?.offerings?.length ?? 0), 0), complete: sum ? sum.complete !== false : true });
      return out;
    }
    if (res.code !== "revision_conflict" || attempt === 1) {
      logSettle("candidates", { sent: true, failed: true });
      return current;
    }
    const fresh = await rereadOr(src, caller, current);
    if (!fresh) return current;
    current = conflictVersion(fresh, current);
  }
  return current;
}

/** 리포트를 다시 읽는다. 실패하면 null(화면은 가진 리포트로 그린다) */
async function rereadOr(src: JungsiSource, caller: Caller, r: ReportDto): Promise<ReportDto | null> {
  try {
    return await src.readReport(caller, r.report_id);
  } catch (e) {
    if (!(e instanceof ConnectionError || e instanceof AccessDenied)) logSettleError("candidates-reread", e);
    return null;
  }
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
