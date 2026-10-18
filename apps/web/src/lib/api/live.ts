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
  ProfileDto,
  RecruitmentDto,
  ReportDto,
  Session,
  SnapshotDto,
  StatisticsDto,
} from "@/lib/dto";
import { AccessDenied, ConnectionError, type Caller, type JungsiSource, type Result } from "./source";

/*
  우리 서비스 API(애플리케이션 계층, FastAPI)를 부르는 쪽. 서버에서만 돈다.
  경로·본문·응답은 API_DTO 계약(1.7.0). 401·403 은 AccessDenied, 503·연결 실패는 ConnectionError 로 올리고
  어떤 실패도 합성 응답이나 일반 회원으로 바꾸지 않는다.
*/

const base = () => `${process.env.JUNGSI_API_URL}/api/v1`;
const enc = encodeURIComponent;

class NotFound extends Error {}
/** 409: 자료·정책·카탈로그 버전이 바뀌었다. 조회 화면에서는 '없음'으로 받고 다른 근거와 합치지 않는다 */
class Stale extends Error {}

type ErrBody = { error?: { code?: string }; request_id?: string } | null;

/** 이 모듈이 부르는 경로의 고정 마디. 나머지 마디(리포트·모집단위·draft 번호)는 기록에서 ":id" 로 바꾼다 */
const STATIC_SEGMENTS = new Set([
  "functions", "v1", "jungsi-api", "api", "me", "admission-history", "offerings", "search", "recruitment", "forecast",
  "forecast-drafts", "forecast-capabilities", "adjustments", "approvals", "publications", "validations",
  "reports", "candidates", "live-statistics", "print", "shortlist", "university-results", "score-profiles", "overall-reports",
]);
/** 경로 → 템플릿. 쿼리·개별 식별자를 남기지 않는다 */
export function pathTemplate(path: string): string {
  const pathname = path.split(/[?#]/)[0];
  return pathname.split("/").map((s) => (s === "" || STATIC_SEGMENTS.has(s) ? s : ":id")).join("/");
}
const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_REQUEST_ID = /^[0-9a-f]{32}$/;

/**
 * 실패 응답의 공개 오류코드. 담당자가 서버 기록과 맞춰 볼 수 있게 경로 템플릿·상태·코드·request_id 한 줄을
 * 서버 기록(wrangler tail)에 남긴다. 코드·request_id 는 형식이 맞을 때만 그대로 쓰고, 본문·토큰·쿼리·개별
 * 식별자는 남기지 않는다. 기록이 실패해도 업무 결과는 바뀌지 않는다.
 */
async function codeOf(res: Response, path: string) {
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
  최대 MAX_PER_CALLER 건만 내보내고 나머지는 앞 요청이 끝날 때까지 기다린다.
  대기열은 **요청 하나 안에서만** 쓴다(React cache = 요청마다 새 Map). 워커 전체에서 공유하면 한 요청이 다른 요청의
  대기를 풀어 주게 되는데, Cloudflare 워커는 요청 사이의 promise 해제를 막아 기다리던 요청이 멈춘다(8c3d9fc 배포 실측, 되돌림).
  React cache 가 없는 곳(서버 액션 등)에서는 호출마다 새 Map 이라 줄 세우기 없이 그대로 보낸다.
*/
const MAX_PER_CALLER = 2;
type Lanes = Map<string, { active: number; waiting: (() => void)[] }>;
const requestLanes = cache((): Lanes => new Map());
async function withLane<T>(key: string, run: () => Promise<T>): Promise<T> {
  const lanes = requestLanes();
  let lane = lanes.get(key);
  if (!lane) lanes.set(key, (lane = { active: 0, waiting: [] }));
  if (lane.active >= MAX_PER_CALLER) await new Promise<void>((go) => lane!.waiting.push(go));
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
async function guard(res: Response, path: string) {
  if (res.status === 401 || res.status === 403) {
    const code = await codeOf(res, path);
    throw new AccessDenied(res.status, code ?? (res.status === 401 ? "authentication_required" : "paid_required"));
  }
  // 429(요청 제한, SEC-07): 코드와 Retry-After 만 받아 안내한다. 성공으로 숨기지 않는다
  if (res.status === 429) {
    throw new ConnectionError("rate_limited", (await codeOf(res, path)) ?? "rate_limit_exceeded", retryAfterAt(res.headers.get("Retry-After")));
  }
  if (res.status === 503) throw new ConnectionError("unavailable", (await codeOf(res, path)) ?? "backend_dependency_unavailable");
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

async function call<T>(caller: Caller, path: string): Promise<T> {
  const res = await send(path, { headers: auth(caller) });
  await guard(res, path);
  // 404·409 도 기록만 남기고 뜻은 그대로(없음 / 버전 바뀜). 예외 문장에도 쿼리·식별자 없는 템플릿만 쓴다
  if (res.status === 404) {
    await codeOf(res, path);
    throw new NotFound(pathTemplate(path));
  }
  if (res.status === 409) {
    await codeOf(res, path);
    throw new Stale(pathTemplate(path));
  }
  if (!res.ok) throw new Error(`정시터치 API ${res.status} ${(await codeOf(res, path)) ?? ""}: ${pathTemplate(path)}`);
  return (await res.json()) as T;
}

/** POST/PUT 은 Idempotency-Key 가 필수. 같은 키의 재시도는 처음 결과를 돌려받는다 */
async function write<T>(caller: Caller, method: "POST" | "PUT", path: string, body: unknown, key: string): Promise<Result<T>> {
  const res = await send(path, { method, headers: auth(caller, { "Content-Type": "application/json", "Idempotency-Key": key }), body: JSON.stringify(body) });
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

export const liveSource: JungsiSource = {
  kind: "live",
  async getSession(caller) {
    if (!caller.accessToken) return null;
    try {
      return await call<Session>(caller, "/me");
    } catch (e) {
      // 인증 거부·만료는 비로그인으로 본다. 503 은 일반 회원으로 낮추지 않고 그대로 올린다
      if (e instanceof AccessDenied && e.status === 401) return null;
      throw e;
    }
  },

  searchHistory: (caller, q: HistorySearchQuery) => call<CatalogSearchDto<HistoryMetricDto>>(caller, `/admission-history${qs({ ...q })}`),
  readRecruitment: (caller, id) => orNull(call<RecruitmentDto>(caller, `/offerings/${enc(id)}/recruitment`)),

  createScoreProfile: (caller, scores, confirmed, key) => write<ProfileDto>(caller, "POST", "/score-profiles", { scores, confirmed }, key),
  analyzeOverall: (caller, body, key) => write<ReportDto>(caller, "POST", "/overall-reports", body, key),
  readReport: (caller, reportId) => orNull(call<ReportDto>(caller, `/reports/${enc(reportId)}`)),
  exportReport: (caller, reportId) => orNull(call<SnapshotDto>(caller, `/reports/${enc(reportId)}/print`)),

  searchOfferings: (caller, q) => call<CatalogSearchDto<OfferingDto>>(caller, `/offerings/search${qs({ ...q })}`),
  readOffering: (caller, id) => orNull(call<OfferingDetailDto>(caller, `/offerings/${enc(id)}`)),
  analyzeUniversities: (caller, reportId, expected, ids, key) =>
    write<ReportDto>(caller, "POST", `/reports/${enc(reportId)}/university-results`, { expected_version: expected, offering_ids: ids }, key),
  buildCandidates: (caller, reportId, expected, key) => write<ReportDto>(caller, "POST", `/reports/${enc(reportId)}/candidates`, { expected_version: expected }, key),
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
