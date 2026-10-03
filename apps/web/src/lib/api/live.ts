import "server-only";
import type { AnalysisResult, CandidatesResult, OfferingAnalysis, OfferingSearchParams, OfferingSearchResult, OfferingStatistics, ScoreBasis, Session, ShortlistItem } from "@/lib/contract";
import type { CatalogSearchDto, HistoryMetricDto, HistorySearchQuery, ProfileDto, RecruitmentDto, ReportDto, SnapshotDto } from "@/lib/dto";
import { AccessDenied, type Caller, type JungsiSource, type Result } from "./source";

/*
  우리 서비스 API(애플리케이션 계층)를 부르는 쪽. 서버에서만 돈다.
  경로는 docs/current/라우팅_명세.md. HTTP 핸들러가 아직 없어(2026-10-03) 이 파일은 연결 준비 상태다.
  report_id 를 어디서 받는지는 명세에 아직 없다. 연결 때 애플리케이션 계약을 따른다.
*/

const base = () => `${process.env.JUNGSI_API_URL ?? "http://localhost:8000"}/api/v1`;

async function call<T>(caller: Caller, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (caller.accessToken) headers.set("Authorization", `Bearer ${caller.accessToken}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${base()}${path}`, { ...init, headers, cache: "no-store" });
  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => ({}));
    throw new AccessDenied(res.status, String(body?.detail ?? (res.status === 401 ? "authentication_required" : "paid_required")));
  }
  if (!res.ok) throw new Error(`정시터치 API ${res.status}: ${path}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(p: OfferingSearchParams) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** POST/PUT 은 Idempotency-Key 가 필수. 같은 키의 재시도는 처음 결과를 돌려받는다(API_DTO 계약) */
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

/** history.search 쿼리. 같은 이름의 키를 두 번 보내지 않는다(서버가 422 로 거절) */
function histQs(q: HistorySearchQuery) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

// 연결 때 애플리케이션이 알려 줄 리포트 번호. 명세 확정 전 자리
const REPORT = "me";

export const liveSource: JungsiSource = {
  kind: "live",
  searchHistory: (caller, q) => call<CatalogSearchDto<HistoryMetricDto>>(caller, `/admission-history${histQs(q)}`),
  createScoreProfile: (caller, scores, confirmed, key) => write<ProfileDto>(caller, "POST", "/score-profiles", { scores, confirmed }, key),
  analyzeOverall: (caller, body, key) => write<ReportDto>(caller, "POST", "/overall-reports", body, key),
  readReport: (caller, reportId) => orNull(call<ReportDto>(caller, `/reports/${encodeURIComponent(reportId)}`)),
  exportReport: (caller, reportId) => orNull(call<SnapshotDto>(caller, `/reports/${encodeURIComponent(reportId)}/print`)),
  async readRecruitment(caller, offeringId) {
    try {
      return await call<RecruitmentDto>(caller, `/offerings/${encodeURIComponent(offeringId)}/recruitment`);
    } catch (e) {
      if (e instanceof Error && e.message.includes(" 404:")) return null;
      throw e;
    }
  },
  async getSession(caller) {
    if (!caller.accessToken) return null;
    try {
      return await call<Session>(caller, "/me");
    } catch (e) {
      if (e instanceof AccessDenied && e.status === 401) return null;
      throw e;
    }
  },
  searchOfferings: (caller, p) => call<OfferingSearchResult>(caller, `/offerings/search${qs(p)}`),
  async analyze(caller, offeringIds) {
    const res = await fetch(`${base()}/reports/${REPORT}/university-results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${caller.accessToken ?? ""}` },
      body: JSON.stringify({ offering_ids: offeringIds }),
      cache: "no-store",
    });
    // 확인된 성적이 없으면 409 와 보류 사유(라우팅 명세 '권한과 응답 경계')
    if (res.status === 409) return { state: "score_required" };
    if (res.status === 401 || res.status === 403) throw new AccessDenied(res.status, res.status === 401 ? "authentication_required" : "paid_required");
    if (!res.ok) throw new Error(`정시터치 API ${res.status}: university-results`);
    const body = (await res.json()) as { basis: ScoreBasis; results: OfferingAnalysis[] };
    return { state: "ready", basis: body.basis, results: body.results } satisfies AnalysisResult;
  },
  async buildCandidates(caller) {
    const res = await fetch(`${base()}/reports/${REPORT}/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${caller.accessToken ?? ""}` },
      body: "{}",
      cache: "no-store",
    });
    if (res.status === 409) return { state: "score_required" };
    if (res.status === 401 || res.status === 403) throw new AccessDenied(res.status, res.status === 401 ? "authentication_required" : "paid_required");
    if (!res.ok) throw new Error(`정시터치 API ${res.status}: candidates`);
    const body = (await res.json()) as Omit<Extract<CandidatesResult, { state: "ready" }>, "state">;
    return { state: "ready", ...body };
  },
  async getStatistics(caller, offeringIds) {
    // statistics.read 는 모집단위마다 따로 있다. 하나가 실패해도 나머지는 보이게 대기 상태로 둔다
    return Promise.all(
      offeringIds.map((id) =>
        call<OfferingStatistics>(caller, `/reports/${REPORT}/offerings/${encodeURIComponent(id)}/live-statistics`).catch(
          (): OfferingStatistics => ({ offering_id: id, status: "pending", recommended_count: null, selected_count: null, my_rank: null, tie_count: null, updated_at: null }),
        ),
      ),
    );
  },
  listShortlist: (caller) => call<ShortlistItem[]>(caller, `/reports/${REPORT}/shortlist`),
  async setShortlist(caller, offeringId, selected) {
    await call(caller, `/reports/${REPORT}/shortlist/${encodeURIComponent(offeringId)}`, { method: "PUT", body: JSON.stringify({ selected }) });
  },
};
