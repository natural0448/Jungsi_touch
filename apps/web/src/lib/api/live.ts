import "server-only";
import { cache } from "react";
import type {
  CatalogSearchDto,
  ForecastCapabilitiesDto,
  ForecastDraftDto,
  ForecastListDto,
  ForecastPublicDto,
  HistoryMetricDto,
  HistorySearchQuery,
  OfferingDetailDto,
  OfferingDto,
  OwnReportListDto,
  ProfileDto,
  RecruitmentDto,
  ReportDto,
  SampleReportDto,
  ScoreInputStatusDto,
  Session,
  SnapshotDto,
  SnapshotHeadDto,
  StatisticsDto,
} from "@/lib/dto";
import { withConditionUnmet, withRequiredUnmet } from "../eligibility-conditions";
/** 서버 조건 목록 전체로 '지원 조건 미충족'을 보일지(2026-11-19 대표님 결정으로 끔).
 *  조건 목록은 지원 요건인지 가산·반영 항목인지 가려져 있지 않다. 대신 담당자가 요건으로 확인한 92행에만 켠다(withRequiredUnmet). */
const CONDITION_UNMET_ENABLED: boolean = false;
import { AccessDenied, ConnectionError, SnapshotChanged, type Caller, type JungsiSource, type Result } from "./source";

/*
  우리 서비스 API(애플리케이션 계층, FastAPI)를 부르는 쪽. 서버에서만 돈다.
  경로·본문·응답은 API_DTO 계약(1.7.0). 401·403 은 AccessDenied, 503·연결 실패는 ConnectionError 로 올리고
  어떤 실패도 합성 응답이나 일반 회원으로 바꾸지 않는다.
*/

const base = () => `${process.env.JUNGSI_API_URL}/api/v1`;
/**
 * 경로에 넣는 번호(정리본 p1-public-history:…, 모집단위 2027:1000001753 등)의 ':' 는 그대로 둔다.
 * 운영 jungsi-api 는 경로 값을 풀지 않고 형식 검사를 해서 '%3A' 를 invalid_identifier(422)로 거절한다
 * (2026-11-13 정리본, 2026-11-14 3페이지 모집 정보·발행 기준 운영 로그).
 * ':' 는 경로 조각에 그대로 쓸 수 있는 문자이고, 나머지 문자는 전처럼 인코딩한다.
 */
const enc = (id: string) => encodeURIComponent(id).replace(/%3A/gi, ":");
export const snapshotSegment = enc;

class NotFound extends Error {}
/** 409: 자료·정책·카탈로그 버전이 바뀌었다. 조회 화면에서는 '없음'으로 받고 다른 근거와 합치지 않는다 */
class Stale extends Error {}

type ErrBody = { error?: { code?: string }; request_id?: string } | null;

/** 이 모듈이 부르는 경로의 고정 마디. 나머지 마디(리포트·모집단위·draft 번호)는 기록에서 ":id" 로 바꾼다 */
const STATIC_SEGMENTS = new Set([
  "functions", "v1", "jungsi-api", "api", "me", "admission-history", "offerings", "search", "recruitment", "forecast",
  "forecast-drafts", "forecast-capabilities", "adjustments", "approvals", "publications", "validations",
  "reports", "candidates", "live-statistics", "print", "shortlist", "university-results", "score-profiles", "overall-reports",
  "snapshot", "snapshots", "head", "score-input-status", "report-sample", "management", "score-input-corrections",
]);
/** 경로 → 템플릿. 쿼리·개별 식별자를 남기지 않는다 */
export function pathTemplate(path: string): string {
  const pathname = path.split(/[?#]/)[0];
  return pathname.split("/").map((s) => (s === "" || STATIC_SEGMENTS.has(s) ? s : ":id")).join("/");
}
// REVIEW ONLY: the Owner-agreed variable is server-only; actual Worker binding
// and the deployed backend header contract require independent verification.
const R27_REVIEW_HEADER = "X-Jungsi-P1-R27-Consumer-Credential";
const R27_REVIEW_CREDENTIAL = /^[A-Za-z0-9_-]{43,128}$/;
const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_REQUEST_ID = /^[0-9a-f]{32}$/;

/**
 * 실패 응답의 공개 오류코드. 담당자가 서버 기록과 맞춰 볼 수 있게 경로 템플릿·상태·코드·request_id 한 줄을
 * 서버 기록(wrangler tail)에 남긴다. 코드·request_id 는 형식이 맞을 때만 그대로 쓰고, 본문·토큰·쿼리·개별
 * 식별자는 남기지 않는다. 기록이 실패해도 업무 결과는 바뀌지 않는다.
 */
async function codeOf(res: Response, path: string, sensitiveSnapshot = false) {
  // Snapshot credentials must never be reflected through an upstream error body.
  // Retain only the status and the fixed path template; no upstream code or id.
  if (sensitiveSnapshot) {
    try {
      const status = Number.isInteger(res.status) ? res.status : 0;
      console.warn("[jungsi-api] " + pathTemplate(path) + " " + status + " snapshot_error");
    } catch { /* Do not affect the request. */ }
    return undefined;
  }
  const err = (await res.json().catch(() => null)) as ErrBody;
  const raw = err?.error?.code;
  const code = typeof raw === "string" && SAFE_CODE.test(raw) ? raw : undefined;
  try {
    const rid = typeof err?.request_id === "string" && SAFE_REQUEST_ID.test(err.request_id) ? err.request_id : "-";
    const status = Number.isInteger(res.status) ? res.status : 0;
    console.warn(`[jungsi-api] ${pathTemplate(path)} ${status} ${code ?? (raw === undefined ? "-" : "invalid_code")} request_id=${rid}`);
  } catch {
    // 기록 실패는 무시한다
  }
  return code;
}

/*
  계정당 동시 요청 줄 세우기. 서버는 계정당 동시 2건(concurrent_jobs)까지만 받고 넘치면 429 rate_limit_exceeded 다.
  1페이지는 학년도 3개를 동시에 검색해 세 번째가 거절됐다(2026-10-18 실측). 한 화면 요청 안에서 사용자 Bearer 별로
  회원 등급별 상한(일반 1·유료 2)만큼만 내보내고 나머지는 앞 요청이 끝날 때까지 기다린다.
  대기열은 **요청 하나 안에서만** 쓴다(React cache = 요청마다 새 Map). 워커 전체에서 공유하면 한 요청이 다른 요청의
  대기를 풀어 주게 되는데, Cloudflare 워커는 요청 사이의 promise 해제를 막아 기다리던 요청이 멈춘다(8c3d9fc 배포 실측, 되돌림).
  React cache 가 없는 곳(서버 액션 등)에서는 호출마다 새 Map 이라 줄 세우기 없이 그대로 보낸다.
*/
// 서버 승인 동시성: 일반 1 · 유료(관리자 예외 포함) 2(담당자 FE-LIVE-P1-CONCURRENCY-01, 2026-10-18).
// 세션(/me)을 받기 전에는 1로 시작하고, 받은 뒤 회원 등급으로 맞춘다. 서버 제한을 대신하지 않는 호출부 조절이다
const LIMIT_BY_TIER = { paid: 2, standard: 1 } as const;
type RequestLanes = { limit: number; lanes: Map<string, { active: number; waiting: (() => void)[] }> };
const requestLanes = cache((): RequestLanes => ({ limit: LIMIT_BY_TIER.standard, lanes: new Map() }));
async function withLane<T>(key: string, run: () => Promise<T>): Promise<T> {
  const state = requestLanes();
  const lanes = state.lanes;
  let lane = lanes.get(key);
  if (!lane) lanes.set(key, (lane = { active: 0, waiting: [] }));
  if (lane.active >= state.limit) await new Promise<void>((go) => lane!.waiting.push(go));
  lane.active++;
  try {
    return await run();
  } finally {
    lane.active--;
    const next = lane.waiting.shift();
    if (next) next();
    else if (lane.active === 0) lanes.delete(key);
  }
}

/*
  계정당 동시 한도(429 rate_limit_exceeded)로 거절되면 잠시 기다렸다 같은 요청을 다시 보낸다. 최대 3번(3초·3초·4초,
  서버 Retry-After 가 5초 이하면 그 값). 2026-10-18 결정은 '3초 뒤 한 번'이었으나, 다른 화면에서 시작된 요청이 서버에서
  아직 끝나지 않아 겹치는 경우 한 번으로는 풀리지 않아 확인 자체가 막혔다(2026-10-20 사용자 지적으로 3번으로 늘림).
  하루 분석 한도(analysis_quota_exceeded)는 다시 보내지 않는다. 쓰기는 같은 Idempotency-Key 로 다시 보내므로 중복되지 않는다.
*/
const CONTENTION_WAITS_MS = [3000, 3000, 4000];
const CONTENTION_HINT_MAX_MS = 5000;
async function sendContended(path: string, init: RequestInit): Promise<Response> {
  let res = await send(path, init);
  for (const fallback of CONTENTION_WAITS_MS) {
    if (res.status !== 429) return res;
    const code = ((await res.clone().json().catch(() => null)) as ErrBody)?.error?.code;
    if (code !== "rate_limit_exceeded") return res;
    const hint = retryAfterAt(res.headers.get("Retry-After"));
    const hintMs = hint ? hint.getTime() - Date.now() : null;
    const wait = hintMs !== null && hintMs >= 0 && hintMs <= CONTENTION_HINT_MAX_MS ? Math.max(500, hintMs) : fallback;
    await new Promise((r) => setTimeout(r, wait));
    res = await send(path, init);
  }
  return res;
}

/*
  503 backend_dependency_unavailable(사유 코드 없는 503 포함)은 내려가는 중인 함수 인스턴스에 걸린 일시 장애일 수 있다
  (11-08 v117 15:00:12 GET /me 503, 0.6초 뒤 그 인스턴스 종료 · 로그 사유 EarlyDrop. 부담당자 회신). 1.5초 뒤 한 번만 다시 보낸다.
  다시 보내도 되는 요청만: 읽기(GET)와, 같은 리포트·판·의도에서 만든 Idempotency-Key 로 다시 계산만 하는 분석·후보 요청.
  성적 저장·정정 부여·담기·예측 작성처럼 두 번 실행되면 안 되거나 결과가 바뀌는 쓰기는 다시 보내지 않는다.
  다른 503 코드(security_policy_unavailable·operation_scope_not_approved 등)는 설정·승인 문제라 다시 보내지 않는다.
  546(CPU Time exceeded)도 같은 요청들에 한해 한 번만 다시 보낸다. Supabase 의 CPU 2초 한도는 인스턴스가 사는 동안의 합계로
  걸려, 앞선 요청으로 CPU 가 쌓인 인스턴스에서 마지막 요청이 끊긴다(11-08 v124 18:46:13 POST university-results 546,
  18:47:35 새 인스턴스에서 같은 요청 200. 부담당자 회신). 다시 보내면 대개 새 인스턴스로 간다.
*/
const DEPENDENCY_RETRY_MS = 1500;
async function sendOnceMore(path: string, init: RequestInit, replayable: boolean): Promise<Response> {
  const res = await sendContended(path, init);
  if (!replayable || (res.status !== 503 && res.status !== 546)) return res;
  if (res.status === 503) {
    const code = ((await res.clone().json().catch(() => null)) as ErrBody)?.error?.code;
    if (code !== undefined && code !== "backend_dependency_unavailable") return res;
  }
  await new Promise((r) => setTimeout(r, DEPENDENCY_RETRY_MS));
  return sendContended(path, init);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const key = new Headers(init.headers).get("Authorization") ?? "anonymous";
  return withLane(key, async () => {
    try {
      return await fetch(`${base()}${path}`, { ...init, cache: "no-store" });
    } catch {
      throw new ConnectionError("unavailable", "backend_unreachable");
    }
  });
}

/**
 * Retry-After 해석(FE-01). 계약은 음이 아닌 정수 delta-seconds 또는 HTTP 날짜다.
 * - 숫자는 순수 십진 정수 문법만 받는다. 빈 값·공백·음수·소수·지수(1e300 등)는 거절한다.
 * - 날짜는 '지금 이후 ~ 7일 안'만 받는다. 과거·범위 밖·해석 불가 값으로 임의 복구 시각을 만들지 않는다.
 * 유효하지 않으면 null 을 돌려주고 화면은 시각 없는 제한 안내만 보인다. 입력값·멱등 키 보존은 호출한 쪽 규칙 그대로다.
 */
const RETRY_AFTER_MAX_MS = 7 * 24 * 60 * 60 * 1000;
function retryAfterAt(header: string | null): Date | null {
  if (header === null) return null;
  const v = header.trim();
  if (/^\d{1,7}$/.test(v)) {
    const ms = Number(v) * 1000;
    return ms <= RETRY_AFTER_MAX_MS ? new Date(Date.now() + ms) : null;
  }
  const t = Date.parse(v);
  if (!Number.isNaN(t) && t > Date.now() && t - Date.now() <= RETRY_AFTER_MAX_MS) return new Date(t);
  return null;
}

/** 401·403·429·503 은 공통으로 올린다. 나머지는 호출한 쪽이 판단한다 */
async function guard(res: Response, path: string, sensitiveSnapshot = false) {
  if (res.status === 401 || res.status === 403) {
    const code = await codeOf(res, path, sensitiveSnapshot);
    throw new AccessDenied(res.status, code ?? (res.status === 401 ? "authentication_required" : "paid_required"));
  }
  // 429(요청 제한, SEC-07): 코드와 Retry-After 만 받아 안내한다. 성공으로 숨기지 않는다
  if (res.status === 429) {
    throw new ConnectionError("rate_limited", (await codeOf(res, path, sensitiveSnapshot)) ?? "rate_limit_exceeded", retryAfterAt(res.headers.get("Retry-After")));
  }
  if (res.status === 503) throw new ConnectionError("unavailable", (await codeOf(res, path, sensitiveSnapshot)) ?? "backend_dependency_unavailable");
}

function auth(caller: Caller, extra?: Record<string, string>) {
  const h = new Headers(extra);
  if (caller.accessToken) h.set("Authorization", `Bearer ${caller.accessToken}`);
  // FE-SEC03-RELAY: 서버 전용 relay 토큰(확정 계약). 사용자 Bearer 와 별도 헤더로 보내고,
  // 이 모듈은 server-only 라 값이 브라우저 번들·화면에 내려가지 않는다. 없으면 보내지 않는다.
  const relay = process.env.JUNGSI_RELAY_TOKEN;
  if (relay) h.set("X-Jungsi-Relay-Token", relay);
  return h;
}

// This module is server-only. Only the two snapshot operations opt in here.
// Unset means exact v1 behavior. A present but malformed or reused relay value
// fails closed, without including either credential in errors or logs.
function snapshotRequest(caller: Caller): { init: RequestInit; sensitive: boolean } {
  const headers = auth(caller);
  const credential = process.env.JUNGSI_P1_R27_CONSUMER_CREDENTIAL;
  if (credential === undefined) return { init: { headers }, sensitive: false };
  const relay = process.env.JUNGSI_RELAY_TOKEN;
  if (!R27_REVIEW_CREDENTIAL.test(credential) || !relay || credential === relay) {
    throw new ConnectionError("unavailable", "snapshot_auth_unavailable");
  }
  headers.set(R27_REVIEW_HEADER, credential);
  // Never follow a redirect while a custom secret-bearing header is attached.
  return { init: { headers, redirect: "manual" }, sensitive: true };
}

async function call<T>(caller: Caller, path: string, snapshot = false): Promise<T> {
  const request = snapshot ? snapshotRequest(caller) : { init: { headers: auth(caller) }, sensitive: false };
  const res = await sendOnceMore(path, request.init, true);
  await guard(res, path, request.sensitive);
  // 404·409 도 기록만 남기고 뜻은 그대로(없음 / 버전 바뀜). 예외 문장에도 쿼리·식별자 없는 템플릿만 쓴다
  if (res.status === 404) {
    await codeOf(res, path, request.sensitive);
    throw new NotFound(pathTemplate(path));
  }
  if (res.status === 409) {
    await codeOf(res, path, request.sensitive);
    throw new Stale(pathTemplate(path));
  }
  if (!res.ok) throw new Error(`정시터치 API ${res.status} ${(await codeOf(res, path, request.sensitive)) ?? ""}: ${pathTemplate(path)}`);
  return (await res.json()) as T;
}

/**
 * 정리본 분할: 본문을 JSON 으로 풀지 않고 받은 bytes 그대로 돌려준다(호출한 쪽이 pins 의 길이·SHA 를 대조하고
 * 숫자 원문을 잃지 않게 읽는다). 409 는 판 변경, 그 밖의 실패는 조회 실패로 올린다(빈 결과로 바꾸지 않는다)
 */
async function callBytes(caller: Caller, path: string): Promise<Uint8Array> {
  const request = snapshotRequest(caller);
  const res = await sendOnceMore(path, request.init, true);
  await guard(res, path, request.sensitive);
  if (res.status === 409) {
    await codeOf(res, path, request.sensitive);
    throw new SnapshotChanged();
  }
  // 546(함수 자원 한도로 실행 인스턴스가 내려감): 같은 인스턴스의 다른 요청 때문에 함께 끊길 수 있다(11-08 seq24 01:06).
  // 분할 자체의 문제가 아니므로 일시 장애로 올려 재-warm 이 같은 단계부터 다시 받게 한다
  if (res.status === 546) {
    throw new ConnectionError("unavailable", (await codeOf(res, path, request.sensitive)) ?? "backend_worker_limit");
  }
  if (!res.ok) throw new Error(`정시터치 API ${res.status} ${(await codeOf(res, path, request.sensitive)) ?? ""}: ${pathTemplate(path)}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** POST/PUT 은 Idempotency-Key 가 필수. 같은 키의 재시도는 처음 결과를 돌려받는다 */
async function write<T>(caller: Caller, method: "POST" | "PUT", path: string, body: unknown, key: string, replayable = false): Promise<Result<T>> {
  const res = await sendOnceMore(path, { method, headers: auth(caller, { "Content-Type": "application/json", "Idempotency-Key": key }), body: JSON.stringify(body) }, replayable);
  // 쓰기를 보냈으면(성공·실패·응답 오류 모두) 이 뒤에 읽는 리포트·입력 상태는 새로 받는다
  writeGeneration++;
  await guard(res, path);
  if (!res.ok) return { ok: false, code: (await codeOf(res, path)) ?? "request_failed", status: res.status };
  return { ok: true, value: (await res.json()) as T };
}

/** 404 는 없음으로 받는다(남의 리포트·범위 밖 draft 도 서버는 같은 404) */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFound) return null;
    throw e;
  }
}

/** 검색 쿼리. 같은 이름의 키를 두 번 보내지 않는다(서버가 422 로 거절) */
function qs(q: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

/*
  한 화면 요청 안에서 /me 는 한 번만 부른다. 레이아웃과 페이지가 따로 getSession 을 불러도 같은 결과를 함께 쓴다
  (11-08 부담당자 회신: 4페이지 한 번에 함수 호출이 차례로 나가 첫 화면이 길어짐). 토큰별로 그 요청 안에서만 기억한다
*/
const sessionOf = cache(async (accessToken: string): Promise<Session | null> => {
  const s = await call<Session>({ accessToken }, "/me");
  // 이 요청의 동시 호출 상한을 회원 등급에 맞춘다
  requestLanes().limit = s?.member_tier === "paid" ? LIMIT_BY_TIER.paid : LIMIT_BY_TIER.standard;
  return s;
});

/*
  현재 리포트 찾기(score-input-status)와 리포트 읽기(report.read)도 한 화면 요청 안에서는 한 번만 부른다(2026-11-10
  부담당자 요청 3: 한 화면에 /reports/{id} 2~3번). 화면을 나눠 그리면서 여러 칸이 같은 리포트를 기다려도 서버에는 한 번만 간다.
  React cache 는 화면 그리기 안에서만 기억하므로, 서버 액션(분석·담기)은 늘 새로 읽어 최신 판으로 쓰기를 보낸다.
  쓰기가 성공할 때마다 writeGeneration 이 올라 기억 열쇠가 바뀐다 — 혹시 액션과 액션 뒤 다시 그리기가 같은 기억을 쓰더라도
  쓰기 전에 읽은 리포트를 쓰기 뒤 화면에 다시 쓰지 않는다(다른 요청에는 기억을 한 번 덜 쓰는 것뿐이다).
*/
let writeGeneration = 0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- _gen 은 기억 열쇠에만 쓴다
const statusOfCached = cache((accessToken: string, examId: string, stage: string | undefined, _gen: number) =>
  call<ScoreInputStatusDto>({ accessToken }, `/me/score-input-status${qs({ exam_id: examId, stage })}`),
);
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- _gen 은 기억 열쇠에만 쓴다
const reportOfCached = cache(async (accessToken: string, reportId: string, _gen: number) => {
  const r = await orNull(call<ReportDto>({ accessToken }, `/reports/${enc(reportId)}`));
  // 지정 과목 미응시 표시(2026-11-18)는 CONDITION_UNMET_ENABLED 로 끄고 켠다. 서버 저장값은 바꾸지 않는다
  if (!r) return r;
  return withRequiredUnmet(CONDITION_UNMET_ENABLED ? withConditionUnmet(r) : r);
});
const statusOf = (accessToken: string, examId: string, stage: string | undefined) => statusOfCached(accessToken, examId, stage, writeGeneration);
const reportOf = (accessToken: string, reportId: string) => reportOfCached(accessToken, reportId, writeGeneration);

export const liveSource: JungsiSource = {
  kind: "live",
  async getSession(caller) {
    if (!caller.accessToken) return null;
    try {
      return await sessionOf(caller.accessToken);
    } catch (e) {
      // 인증 거부·만료는 비로그인으로 본다. 503 은 일반 회원으로 낮추지 않고 그대로 올린다
      if (e instanceof AccessDenied && e.status === 401) return null;
      throw e;
    }
  },

  searchHistory: (caller, q: HistorySearchQuery) => call<CatalogSearchDto<HistoryMetricDto>>(caller, `/admission-history${qs({ ...q })}`),
  readSnapshotHead: (caller) => call<SnapshotHeadDto>(caller, "/admission-history/snapshot/head", true),
  readSnapshotPart: (caller, snapshotId, partId) => callBytes(caller, `/admission-history/snapshots/${snapshotSegment(snapshotId)}${qs({ part_id: partId })}`),
  readRecruitment: (caller, id) => orNull(call<RecruitmentDto>(caller, `/offerings/${enc(id)}/recruitment`)),

  createScoreProfile: (caller, scores, confirmed, key) => write<ProfileDto>(caller, "POST", "/score-profiles", { scores, confirmed }, key),
  analyzeOverall: (caller, body, key) => write<ReportDto>(caller, "POST", "/overall-reports", body, key),
  readReport: (caller, reportId) => (caller.accessToken ? reportOf(caller.accessToken, reportId) : orNull(call<ReportDto>(caller, `/reports/${enc(reportId)}`))),
  listOwnReports: (caller, q) => call<OwnReportListDto>(caller, `/me/reports${qs({ ...q })}`),
  readScoreInputStatus: (caller, examId, stage) =>
    caller.accessToken ? statusOf(caller.accessToken, examId, stage) : call<ScoreInputStatusDto>(caller, `/me/score-input-status${qs({ exam_id: examId, stage })}`),
  readReportSample: (caller) => call<SampleReportDto>(caller, "/report-sample"),
  grantScoreCorrection: (caller, body, key) => write<ScoreInputStatusDto>(caller, "POST", "/management/score-input-corrections", { ...body, reason_code: "score_correction" }, key),
  exportReport: (caller, reportId) => orNull(call<SnapshotDto>(caller, `/reports/${enc(reportId)}/print`)),

  searchOfferings: async (caller, q) => {
    try {
      return await call<CatalogSearchDto<OfferingDto>>(caller, `/offerings/search${qs({ ...q })}`);
    } catch (error) {
      if (q.cursor && error instanceof Stale) throw new Error("invalid_cursor");
      throw error;
    }
  },
  readOffering: (caller, id) => orNull(call<OfferingDetailDto>(caller, `/offerings/${enc(id)}`)),
  analyzeUniversities: (caller, reportId, expected, ids, key) =>
    write<ReportDto>(caller, "POST", `/reports/${enc(reportId)}/university-results`, { expected_version: expected, offering_ids: ids }, key, true),
  buildCandidates: (caller, reportId, expected, key) => write<ReportDto>(caller, "POST", `/reports/${enc(reportId)}/candidates`, { expected_version: expected }, key, true),
  updateShortlist: (caller, reportId, id, selected, expected, key) =>
    write<ReportDto>(caller, "PUT", `/reports/${enc(reportId)}/shortlist/${enc(id)}`, { selected, expected_version: expected }, key),
  readStatistics: (caller, reportId, id) => orNull(call<StatisticsDto>(caller, `/reports/${enc(reportId)}/offerings/${enc(id)}/live-statistics`)),

  readForecastCapabilities: (caller) => call<ForecastCapabilitiesDto>(caller, "/forecast-capabilities"),
  listForecastDrafts: (caller, universityId) => call<ForecastListDto>(caller, `/forecast-drafts${qs({ university_id: universityId })}`),
  readForecastDraft: (caller, id) => orNull(call<ForecastDraftDto>(caller, `/forecast-drafts/${enc(id)}`)),
  createForecastDraft: (caller, offeringId, body, key) => write<ForecastDraftDto>(caller, "POST", `/offerings/${enc(offeringId)}/forecast-drafts`, body, key),
  adjustForecastDraft: (caller, id, body, key) => write<ForecastDraftDto>(caller, "POST", `/forecast-drafts/${enc(id)}/adjustments`, body, key),
  validateForecastDraft: (caller, id, body, key) => write<ForecastDraftDto>(caller, "POST", `/forecast-drafts/${enc(id)}/validations`, body, key),
  approveForecastDraft: (caller, id, body, key) => write<ForecastDraftDto>(caller, "POST", `/forecast-drafts/${enc(id)}/approvals`, body, key),
  publishForecastDraft: (caller, id, body, key) => write<ForecastDraftDto>(caller, "POST", `/forecast-drafts/${enc(id)}/publications`, body, key),
  // 현재 context·고정 입력·정책이 발표본과 달라지면 409. 학생 분석 쪽은 성공한 환산·누백을 유지하고 발표본만 보이지 않는다
  readPublishedForecast: async (caller, offeringId) => {
    try {
      return await orNull(call<ForecastPublicDto>(caller, `/offerings/${enc(offeringId)}/forecast`));
    } catch (e) {
      if (e instanceof Stale) return null;
      throw e;
    }
  },
};
