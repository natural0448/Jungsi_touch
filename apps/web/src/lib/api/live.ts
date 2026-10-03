import "server-only";
import type {
  CatalogSearchDto,
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
import { AccessDenied, type Caller, type JungsiSource, type Result } from "./source";

/*
  우리 서비스 API(애플리케이션 계층, FastAPI)를 부르는 쪽. 서버에서만 돈다.
  경로·본문·응답은 develop 의 docs/current/API_DTO_계약.md. 실제 서버 연결 설정 전이라 쓰이지 않는다(JUNGSI_API_MODE=synthetic).
*/

const base = () => `${process.env.JUNGSI_API_URL ?? "http://localhost:8000"}/api/v1`;
const enc = encodeURIComponent;

async function call<T>(caller: Caller, path: string): Promise<T> {
  const headers = new Headers();
  if (caller.accessToken) headers.set("Authorization", `Bearer ${caller.accessToken}`);
  const res = await fetch(`${base()}${path}`, { headers, cache: "no-store" });
  if (res.status === 401 || res.status === 403) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new AccessDenied(res.status, body?.error?.code ?? (res.status === 401 ? "authentication_required" : "paid_required"));
  }
  if (!res.ok) throw new Error(`정시터치 API ${res.status}: ${path}`);
  return (await res.json()) as T;
}

/** POST/PUT 은 Idempotency-Key 가 필수. 같은 키의 재시도는 처음 결과를 돌려받는다 */
async function write<T>(caller: Caller, method: "POST" | "PUT", path: string, body: unknown, key: string): Promise<Result<T>> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, Authorization: `Bearer ${caller.accessToken ?? ""}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new AccessDenied(res.status, res.status === 401 ? "authentication_required" : "paid_required");
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { ok: false, code: err?.error?.code ?? "request_failed", status: res.status };
  }
  return { ok: true, value: (await res.json()) as T };
}

/** 404 는 없음으로 받는다(남의 리포트도 서버는 같은 404) */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof Error && e.message.includes(" 404:")) return null;
    throw e;
  }
}

/** 검색 쿼리. 같은 이름의 키를 두 번 보내지 않는다(서버가 422 로 거절) */
function qs(q: HistorySearchQuery) {
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
      if (e instanceof AccessDenied && e.status === 401) return null;
      throw e;
    }
  },

  searchHistory: (caller, q) => call<CatalogSearchDto<HistoryMetricDto>>(caller, `/admission-history${qs(q)}`),
  readRecruitment: (caller, id) => orNull(call<RecruitmentDto>(caller, `/offerings/${enc(id)}/recruitment`)),

  createScoreProfile: (caller, scores, confirmed, key) => write<ProfileDto>(caller, "POST", "/score-profiles", { scores, confirmed }, key),
  analyzeOverall: (caller, body, key) => write<ReportDto>(caller, "POST", "/overall-reports", body, key),
  readReport: (caller, reportId) => orNull(call<ReportDto>(caller, `/reports/${enc(reportId)}`)),
  exportReport: (caller, reportId) => orNull(call<SnapshotDto>(caller, `/reports/${enc(reportId)}/print`)),

  searchOfferings: (caller, q) => call<CatalogSearchDto<OfferingDto>>(caller, `/offerings/search${qs(q)}`),
  readOffering: (caller, id) => orNull(call<OfferingDetailDto>(caller, `/offerings/${enc(id)}`)),
  analyzeUniversities: (caller, reportId, expected, ids, key) =>
    write<ReportDto>(caller, "POST", `/reports/${enc(reportId)}/university-results`, { expected_version: expected, offering_ids: ids }, key),
  buildCandidates: (caller, reportId, expected, key) => write<ReportDto>(caller, "POST", `/reports/${enc(reportId)}/candidates`, { expected_version: expected }, key),
  updateShortlist: (caller, reportId, id, selected, expected, key) =>
    write<ReportDto>(caller, "PUT", `/reports/${enc(reportId)}/shortlist/${enc(id)}`, { selected, expected_version: expected }, key),
  readStatistics: (caller, reportId, id) => orNull(call<StatisticsDto>(caller, `/reports/${enc(reportId)}/offerings/${enc(id)}/live-statistics`)),
};
