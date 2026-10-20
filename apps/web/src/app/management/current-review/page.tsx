import type { Metadata } from "next";
import Form from "next/form";
import Link from "@/components/link";
import { headers } from "next/headers";
import { readFile } from "node:fs/promises";
import { ConnectionNotice } from "@/components/connection-notice";
import { PageHead } from "@/components/page-head";
import { apiMode, getCaller, sessionOrDown, source } from "@/lib/api";
import { seoulTime } from "@/lib/format";
import { loginHref } from "@/lib/links";
import "./review.css";

export const metadata: Metadata = { title: "현재 입결 전수 검수" };
export const dynamic = "force-dynamic";

/*
  관리·화면팀 전용 전수 검수 화면(현재 정본, 담당자 즉시연결 전달문 2026-10-10 v2 →
  2026-10-18 v3: 입결 원 관측 + 그 입결에서 계산한 대학식 추정 상위누백·검수 O/X·진단).
  소비자 4개 화면·22 API 와 분리된 검수 경로 호출만 한다. 브라우저 → 이 서버(BFF) →
  current-admission-review Edge 함수. apikey(공개키)·relay·검수자 토큰은 서버에서만 붙이고
  브라우저·HTML 에 내보내지 않는다. cursor 는 불투명 문자열 그대로 전달하며 해독·재작성·
  기록하지 않는다. 전체 건수는 서버가 세지 않으므로(count_status=unknown) 미계산으로 표기하고
  0 이나 페이지 건수로 대신하지 않는다. 자동 전수 수집 루프는 만들지 않는다 — '다음 범위'
  버튼으로 한 번씩만 이어 본다(I/O 경고 고려). 정본 변경 409 는 처음부터 새 조회로 안내한다.
*/

const PATH = "/management/current-review";
const LIMIT = 100;
const FILTER_KEYS = ["academic_year", "university_q", "department_q", "track", "group", "metric_kind", "cohort", "activity", "offering_pk", "canonical_result_id"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

interface PercentileVariant {
  upper_cumulative_percent: string | null;
  strictly_above_percent: string | null;
  tie_share_percent: string | null;
  status: string;
  eligibility_ox: string;
  reason_code: string | null;
  release_id: string;
}
interface PercentileReview {
  item: string;
  ox: string;
  reason_code: string;
}
interface ReviewItem {
  observation_token: string;
  academic_year: number;
  university: string | null;
  department: string | null;
  track: string | null;
  recruit_group: string | null;
  metric_kind: string | null;
  metric_value_literal: string | null;
  metric_value_json_type: string | null;
  metric_value_numeric_text: string | null;
  cohort: string | null;
  statistic_label: string | null;
  source_member_count: number | null;
  link_scopes: unknown;
  official_metadata: unknown;
  review_status: string | null;
  value_availability: string | null;
  hold_reasons: string[] | null;
  // v3 — 정본·출처 식별, 진단, 산출 누백
  canonical_result_id?: string | null;
  source_result_id?: string | null;
  offering_pk?: string | null;
  active_service?: boolean | null;
  management_status?: string | null;
  row_fingerprint?: string | null;
  diagnostics?: {
    missing_current_fields?: string[];
    integrity_reasons?: string[];
    overlap_marker_present?: boolean;
  };
  calculated_percentiles?: PercentileVariant[];
  percentile_reviews?: PercentileReview[];
  percentile_state?: string;
}
interface ReviewPage {
  format: string;
  query_mode: string;
  status: string;
  publication_status: string;
  count_status: string;
  matching_observation_count: number | null;
  matching_source_school_count: number | null;
  items: ReviewItem[];
  next_cursor: string | null;
  // v3
  review_version?: string;
  as_of?: string;
  approval_expires_at?: string;
  source_version?: {
    admission_command_id: string;
    admission_command_sha256: string;
    percentile_head: { release_id: string; updated_at: string } | null;
  };
  current_scope?: { activity_filter: string; scanned_rows: number | null; empty_items_is_global_no_match: boolean };
}

type Fetched =
  | { kind: "unconfigured"; missing: string[] }
  | { kind: "no_token" }
  | { kind: "not_loopback" }
  | { kind: "error"; status: number; code: string | null; requestId: string | null }
  | { kind: "stale"; code: string | null; requestId: string | null }
  | { kind: "ok"; page: ReviewPage };

/*
  방문자 접근 통제(담당자 독립 검토 지적 2026-10-10, 후속 소견 v8 반영):
  - live  : 방문자의 인증 세션을 확인한 뒤 방문자 본인의 Supabase access token 을 그대로
            전달한다 — 백엔드의 승인 검수 subject 검사가 실제 방문자에게 적용되고, 공통
            검수 토큰은 아예 쓰지 않는다. 승인 명단에 없는 계정은 등급과 무관하게 Edge 의
            403 거절이 그대로 보인다(승인된 일반 회원 검수 계정은 등급을 이유로 배제하지
            않고, 관리자·유료 등급이라고 허용하지도 않는다).
  - local : 검수 PC 전용. local 의 세션 확인은 서버 시험 토큰 기반 표시라 방문자 인증이
            아니므로, 공통 검수 토큰 파일을 읽기 전에 **이 BFF 요청 자체가 loopback 인지**를
            Host 헤더로 검사해 아니면 Edge 호출 없이 거절한다. 실제 격리는 dev 서버의
            127.0.0.1 바인드(package.json dev 스크립트 -H 127.0.0.1)가 담당하고, Host 검사는
            그 바인드가 풀린 구성에 대한 2차 방어다. 운영 배포에는 local 모드·토큰 파일을
            두지 않는다.
  - synthetic/unconfigured : 검수 연결 없음 안내만 보이고 Edge 를 호출하지 않는다.
*/
const LOOPBACK_HOST = /^(127(\.\d{1,3}){3}|localhost|\[::1\])(:\d+)?$/i;

async function reviewBearer(visitorToken: string | null): Promise<string | { kind: "unconfigured"; missing: string[] } | { kind: "no_token" } | { kind: "not_loopback" }> {
  const mode = apiMode();
  if (mode === "live") return visitorToken ?? { kind: "no_token" };
  if (mode !== "local") return { kind: "unconfigured", missing: ["JUNGSI_API_MODE(live 또는 local)"] };
  // local 전용 2차 방어: 이 BFF 에 들어온 요청 자체가 loopback 이 아니면 공통 토큰을 읽지 않는다
  const host = (await headers()).get("host") ?? "";
  if (!LOOPBACK_HOST.test(host)) return { kind: "not_loopback" };
  const tokenFile = process.env.JUNGSI_REVIEW_TOKEN_FILE;
  if (!tokenFile) return { kind: "unconfigured", missing: ["JUNGSI_REVIEW_TOKEN_FILE"] };
  try {
    const token = (await readFile(tokenFile, "utf-8")).trim();
    return token || { kind: "no_token" };
  } catch {
    return { kind: "no_token" };
  }
}

async function fetchReview(query: URLSearchParams, visitorToken: string | null): Promise<Fetched> {
  const base = process.env.JUNGSI_CURRENT_REVIEW_URL;
  const apikey = process.env.JUNGSI_CURRENT_REVIEW_APIKEY;
  const relay = process.env.JUNGSI_RELAY_TOKEN;
  const missing = [
    !base && "JUNGSI_CURRENT_REVIEW_URL",
    !apikey && "JUNGSI_CURRENT_REVIEW_APIKEY",
    !relay && "JUNGSI_RELAY_TOKEN",
  ].filter((v): v is string => Boolean(v));
  if (missing.length) return { kind: "unconfigured", missing };

  const bearer = await reviewBearer(visitorToken);
  if (typeof bearer !== "string") return bearer;
  const token = bearer;

  const url = `${base!.replace(/\/$/, "")}/api/v1/review/current-admissions?${query.toString()}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { apikey: apikey!, Authorization: `Bearer ${token}`, "X-Jungsi-Relay-Token": relay! },
  });
  if (!res.ok) {
    let code: string | null = null;
    let requestId: string | null = null;
    try {
      const body = (await res.json()) as { error?: { code?: string }; code?: string; request_id?: string };
      code = body.error?.code ?? body.code ?? null;
      requestId = body.request_id ?? null;
    } catch {
      /* 오류 본문이 JSON 이 아니면 상태만 보인다 */
    }
    // 담당자 진단용: 사유 코드와 요청 ID 만 남긴다(토큰·cursor·본문은 기록하지 않음)
    console.log(`[current-review] ${res.status} ${code ?? "-"} request_id=${requestId ?? "-"}`);
    if (res.status === 409) return { kind: "stale", code, requestId };
    return { kind: "error", status: res.status, code, requestId };
  }
  return { kind: "ok", page: (await res.json()) as ReviewPage };
}

const one = (v: string | string[] | undefined, max = 256) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, max) || undefined;

export default async function Page({ searchParams }: PageProps<"/management/current-review">) {
  const sp = await searchParams;
  // 방문자 게이트: 인증된 세션이 확인되기 전에는 Edge 검수 호출 자체를 하지 않는다
  const caller = await getCaller();
  const { session, down } = await sessionOrDown(source(), caller);
  const filters = new Map<FilterKey, string>();
  for (const k of FILTER_KEYS) {
    const v = one(sp[k]);
    if (v) filters.set(k, v);
  }
  // cursor 는 불투명·암호화 문자열이라 일반 입력보다 길다 — 자르면 invalid_cursor 가 된다
  const cursor = one(sp.cursor, 8192);
  const started = Boolean(cursor) || filters.size > 0 || one(sp.q) === "1";

  const head = (
    <PageHead
      kicker="관리 · 검수 전용"
      title="현재 입결 전수 검수"
      desc="현재 정본(admission_results_current)의 검수 조회입니다. 승인된 검수 계정으로만 열리며, 값은 발표·수집 원문 그대로이고 보류 표시가 있어도 원 값을 지우지 않습니다. 일반 회원 화면이 아닙니다."
    />
  );

  let body: React.ReactNode = null;
  if (down) {
    body = <ConnectionNotice e={down} />;
  } else if (!session) {
    body = (
      <p className="crv-note">
        검수 화면은 로그인한 승인 검수 계정에서만 조회할 수 있습니다. <a href={loginHref(PATH)}>로그인</a> 후 다시 열어 주세요.
      </p>
    );
  } else if (!started) {
    body = <p className="crv-hint">조건을 넣거나 그대로 검색을 누르면 첫 범위(최대 {LIMIT}건)를 조회합니다. 전체 건수는 세지 않습니다.</p>;
  } else {
    const query = new URLSearchParams();
    for (const [k, v] of filters) query.set(k, v);
    query.set("limit", String(LIMIT));
    if (cursor) query.set("cursor", cursor);
    const got = await fetchReview(query, caller.accessToken);

    if (got.kind === "unconfigured")
      body = <p className="crv-note">검수 연결 설정이 없습니다(서버 환경변수 {got.missing.join(", ")} 미설정). 이 화면은 검수 설정이 있는 서버에서만 동작합니다.</p>;
    else if (got.kind === "not_loopback")
      body = <p className="crv-note">검수 조회는 검수 PC 의 loopback(127.0.0.1) 접속에서만 가능합니다. 외부 주소로 들어온 요청은 거절됩니다.</p>;
    else if (got.kind === "no_token")
      body = <p className="crv-note">검수용 사용자 토큰이 없습니다. live 모드는 로그인 세션을 새로 만들고, 검수 PC(local 모드)는 로그인 스크립트(edge_login.py)로 토큰 파일을 갱신한 뒤 새로고침하세요.</p>;
    else if (got.kind === "stale")
      body = (
        <p className="crv-note">
          조회 중 현재 정본이 변경되었습니다(409{got.code ? ` · ${got.code}` : ""}{got.requestId ? ` · 요청 ID ${got.requestId}` : ""}). 이전 페이지와 섞지 않도록{" "}
          <Link href={hrefFirst(filters)}>처음부터 다시 조회</Link>하세요. 처음부터 다시 조회해도 계속 반복되면 이 요청 ID 를 담당자에게 전달하세요.
        </p>
      );
    else if (got.kind === "error")
      body = (
        <p className="crv-note">
          서버가 요청을 거절했습니다 — HTTP {got.status}
          {got.code ? ` · ${got.code}` : ""}{got.requestId ? ` · 요청 ID ${got.requestId}` : ""}.{" "}
          {got.status === 401
            ? "검수 로그인 토큰이 만료됐을 수 있습니다(로그인 스크립트 재실행 후 새로고침)."
            : got.status === 403
              ? "이 계정은 검수 승인 명단에 없거나 승인 기간이 끝났습니다. 등급(관리자·이용권)과 무관하게 승인된 계정만 열립니다."
              : "같은 내용이 반복되면 상태·코드·요청 ID 를 담당자에게 전달하세요."}
        </p>
      );
    else body = <Results page={got.page} filters={filters} />;
  }

  return (
    <>
      {head}
      <div className="crv">
        <section className="crv-search">
          <Form action={PATH} prefetch={false}>
            <input type="hidden" name="q" value="1" />
            <div className="crv-grid">
              <label>학년도<input name="academic_year" inputMode="numeric" placeholder="2024~2027" defaultValue={filters.get("academic_year") ?? ""} /></label>
              <label>대학(부분)<input name="university_q" placeholder="예: 강원" defaultValue={filters.get("university_q") ?? ""} /></label>
              <label>학과(부분)<input name="department_q" placeholder="예: 간호" defaultValue={filters.get("department_q") ?? ""} /></label>
              <label>전형(정확값)<input name="track" defaultValue={filters.get("track") ?? ""} /></label>
              <label>모집군(정확값)<input name="group" defaultValue={filters.get("group") ?? ""} /></label>
              <label>지표 종류(정확값)<input name="metric_kind" defaultValue={filters.get("metric_kind") ?? ""} /></label>
              <label>집단(정확값)<input name="cohort" defaultValue={filters.get("cohort") ?? ""} /></label>
              <label>
                운영 범위
                <select name="activity" defaultValue={filters.get("activity") ?? "all"}>
                  <option value="all">전체(활성·비활성)</option>
                  <option value="active">활성만</option>
                  <option value="inactive">비활성만</option>
                </select>
              </label>
              <label>모집행 ID(정확값)<input name="offering_pk" defaultValue={filters.get("offering_pk") ?? ""} /></label>
              <label>정본 ID(정확값)<input name="canonical_result_id" defaultValue={filters.get("canonical_result_id") ?? ""} /></label>
            </div>
            <button className="btn p" type="submit">검색(처음부터)</button>
          </Form>
        </section>
        {body}
      </div>
    </>
  );
}

function hrefFirst(filters: Map<FilterKey, string>): string {
  const q = new URLSearchParams({ q: "1" });
  for (const [k, v] of filters) q.set(k, v);
  return `${PATH}?${q.toString()}`;
}

const STATE_LABEL: Record<string, string> = {
  calculated_model_estimate: "산출(모델 추정)",
  hold: "보류",
  multiple_variants: "산출본 여러 개",
  inactive_source: "비활성 원천",
  percentile_release_not_registered: "누백 릴리스 미등록",
  not_reviewed_in_current_percentile_release: "현재 릴리스 미검토",
};

function Results({ page, filters }: { page: ReviewPage; filters: Map<FilterKey, string> }) {
  const items = page.items ?? [];
  const sv = page.source_version;
  const scope = page.current_scope;
  // v3 는 '빈 결과 = 전체 0건'인지 서버가 알려 준다. v2 이하는 next_cursor 유무로만 판단한다
  const globalNoMatch = scope ? scope.empty_items_is_global_no_match : !page.next_cursor;
  return (
    <>
      <p className="crv-meta num">
        응답 {page.format} · {page.query_mode} · 이 범위 {items.length}건
        {scope?.scanned_rows != null ? `(훑은 행 ${scope.scanned_rows})` : ""} · 전체 건수 미계산(count_status: {page.count_status}) ·{" "}
        {page.publication_status === "not_published" ? "검수 상태 표기(미발행) — 자료가 없다는 뜻이 아님" : page.publication_status}
        {scope ? ` · 운영 범위 ${scope.activity_filter}` : ""}
      </p>
      {(sv || page.as_of) && (
        <p className="crv-meta num">
          {page.as_of && <>기준 {seoulTime(page.as_of)} · </>}
          {page.review_version && <>검수판 {page.review_version} · </>}
          {sv && (
            <>
              입결 command {sv.admission_command_id}({sv.admission_command_sha256.slice(0, 12)}) · 누백 릴리스{" "}
              {sv.percentile_head ? `${sv.percentile_head.release_id}(갱신 ${seoulTime(sv.percentile_head.updated_at)})` : "미등록"}
            </>
          )}
          {page.approval_expires_at && <> · 검수 승인 만료 {seoulTime(page.approval_expires_at)}</>}
        </p>
      )}
      {sv && (
        <p className="crv-hint">
          누백은 <b>과거 입결 점수의 대학식 추정 상위누백</b>입니다. 지금 학생의 전체 누백이나 실제 지원자 순위·합격 확률이 아닙니다. 출처가 여러 개이거나 겹침 표시가 있어도 중복 오류로 확정하지 않습니다.
        </p>
      )}
      {items.length === 0 ? (
        <p className="crv-hint">{globalNoMatch ? "조회 완료 — 조건에 맞는 관측이 없습니다." : "이 범위에는 결과가 없지만 다음 범위가 남아 있습니다 — 전체 0건이 아닙니다. 아래에서 이어 보세요."}</p>
      ) : (
        <div className="tblwrap">
          <table className="tb crv-tb">
            <thead>
              <tr>
                <th scope="col">학년도</th>
                <th scope="col">대학</th>
                <th scope="col">학과 · 전형 · 군</th>
                <th scope="col">지표</th>
                <th scope="col" className="r">값(원문)</th>
                <th scope="col" className="r">출처 회원</th>
                <th scope="col">대학식 추정 상위누백</th>
                <th scope="col">상태 · 진단</th>
                <th scope="col">식별</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.observation_token}>
                  <td className="num">{it.academic_year}</td>
                  <td>{it.university ?? "─"}</td>
                  <td>{[it.department, it.track, it.recruit_group && `${it.recruit_group}군`].filter(Boolean).join(" · ") || "─"}</td>
                  <td>{[it.metric_kind, it.statistic_label, it.cohort].filter(Boolean).join(" · ") || "─"}</td>
                  <td className="r num">
                    {it.metric_value_literal ?? "─"}
                    {it.metric_value_json_type && <small className="crv-type"> {it.metric_value_json_type}</small>}
                  </td>
                  <td className="r num">{it.source_member_count ?? "─"}</td>
                  <td>
                    <Percentiles item={it} />
                  </td>
                  <td>
                    {it.active_service === false && <span className="crv-badge hold">비활성</span>}
                    {[it.review_status, it.value_availability, it.management_status].filter(Boolean).map((s) => (
                      <span key={s} className="crv-badge">{s}</span>
                    ))}
                    {(it.hold_reasons ?? []).map((h) => (
                      <span key={h} className="crv-badge hold">{h}</span>
                    ))}
                    {(it.diagnostics?.missing_current_fields ?? []).map((f) => (
                      <span key={`m-${f}`} className="crv-badge hold">누락 {f}</span>
                    ))}
                    {(it.diagnostics?.integrity_reasons ?? []).map((r) => (
                      <span key={`i-${r}`} className="crv-badge hold">{r}</span>
                    ))}
                    {it.diagnostics?.overlap_marker_present && <span className="crv-badge">겹침 표시(중복 확정 아님)</span>}
                  </td>
                  <td className="crv-id">
                    {it.canonical_result_id && <div>정본 {it.canonical_result_id}</div>}
                    {it.source_result_id && it.source_result_id !== it.canonical_result_id && <div>대표 {it.source_result_id}</div>}
                    {it.offering_pk !== undefined && <div>모집행 {it.offering_pk ?? "─"}</div>}
                    {it.row_fingerprint && <div title={it.row_fingerprint}>지문 {it.row_fingerprint.slice(0, 12)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.next_cursor && (
        <Form action={PATH} prefetch={false} className="crv-next">
          <input type="hidden" name="q" value="1" />
          {[...filters].map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="cursor" value={page.next_cursor} />
          <button className="btn" type="submit">다음 범위 보기</button>
          <small className="crv-hint">한 번에 한 범위씩만 조회합니다(자동 전수 수집 없음).</small>
        </Form>
      )}
    </>
  );
}

/** 산출 누백은 서버가 준 정밀 문자열 그대로 보인다(반올림·0 대체 없음). 산출본이 없으면 그 사유 상태만 보인다 */
function Percentiles({ item }: { item: ReviewItem }) {
  const variants = item.calculated_percentiles;
  if (variants === undefined) return <>─</>;
  const state = item.percentile_state ?? "";
  const reviews = item.percentile_reviews ?? [];
  return (
    <div className="crv-pct">
      {variants.length === 0 && <span className="crv-badge hold">{STATE_LABEL[state] ?? state}</span>}
      {variants.length > 1 && <span className="crv-badge">{STATE_LABEL.multiple_variants}</span>}
      {variants.map((v, i) => (
        <div key={`${v.release_id}-${i}`} className="crv-pct-row">
          <span className={`crv-badge${v.status === "hold" ? " hold" : ""}`}>{STATE_LABEL[v.status] ?? v.status}</span>
          <span className={`crv-ox ${v.eligibility_ox === "O" ? "o" : "x"}`}>{v.eligibility_ox}</span>
          {v.upper_cumulative_percent !== null ? (
            <span className="num" title={`초과 ${v.strictly_above_percent ?? "─"}% · 동점 ${v.tie_share_percent ?? "─"}%`}>
              상위 {v.upper_cumulative_percent}%
            </span>
          ) : (
            <span className="crv-type">값 없음</span>
          )}
          {v.reason_code && <small className="crv-type">{v.reason_code}</small>}
        </div>
      ))}
      {reviews.length > 0 && (
        <div className="crv-rev">
          {reviews.map((r, i) => (
            <span key={`${r.item}-${i}`} className={`crv-badge${r.ox === "X" ? " hold" : ""}`}>
              {r.item} {r.ox} · {r.reason_code}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
