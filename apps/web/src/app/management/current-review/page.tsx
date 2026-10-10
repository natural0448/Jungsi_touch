import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import { ConnectionNotice } from "@/components/connection-notice";
import { PageHead } from "@/components/page-head";
import { apiMode, getCaller, sessionOrDown, source } from "@/lib/api";
import { loginHref } from "@/lib/links";
import "./review.css";

export const metadata: Metadata = { title: "현재 입결 전수 검수" };
export const dynamic = "force-dynamic";

/*
  관리·화면팀 전용 전수 검수 화면(현재 정본, 담당자 즉시연결 전달문 2026-10-10 v2).
  소비자 4개 화면·22 API 와 분리된 검수 경로 호출만 한다. 브라우저 → 이 서버(BFF) →
  current-admission-review Edge 함수. apikey(공개키)·relay·검수자 토큰은 서버에서만 붙이고
  브라우저·HTML 에 내보내지 않는다. cursor 는 불투명 문자열 그대로 전달하며 해독·재작성·
  기록하지 않는다. 전체 건수는 서버가 세지 않으므로(count_status=unknown) 미계산으로 표기하고
  0 이나 페이지 건수로 대신하지 않는다. 자동 전수 수집 루프는 만들지 않는다 — '다음 범위'
  버튼으로 한 번씩만 이어 본다(I/O 경고 고려). 정본 변경 409 는 처음부터 새 조회로 안내한다.
*/

const PATH = "/management/current-review";
const LIMIT = 100;
const FILTER_KEYS = ["academic_year", "university_q", "department_q", "track", "group", "metric_kind", "cohort"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

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
}

type Fetched =
  | { kind: "unconfigured"; missing: string[] }
  | { kind: "no_token" }
  | { kind: "error"; status: number; code: string | null; requestId: string | null }
  | { kind: "stale" }
  | { kind: "ok"; page: ReviewPage };

/*
  방문자 접근 통제(담당자 독립 검토 지적, 2026-10-10): 검수 조회를 시작하기 전에
  방문자의 인증된 세션을 서버에서 먼저 확인하고(무로그인·만료 세션은 Edge 호출 없이 거절),
  Edge 에 보내는 사용자 토큰은 모드별로 방문자 자격에 맞춘다.
  - live  : 방문자 본인의 Supabase access token 을 그대로 전달한다 — 백엔드의 승인 검수
            subject 검사가 실제 방문자에게 적용되고, 공통 검수 토큰은 아예 쓰지 않는다.
            미승인 계정·일반 회원은 Edge 의 403(subject/권한) 거절이 그대로 보인다.
  - local : 검수 PC 전용(apiMode 가 loopback JUNGSI_API_URL 일 때만 성립, 로컬 검증 서버도
            127.0.0.1 bind). 로그인 세션 확인을 통과한 뒤에만 검수 토큰 파일을 읽는다.
  - synthetic/unconfigured : 검수 연결 없음 안내만 보이고 Edge 를 호출하지 않는다.
*/
async function reviewBearer(visitorToken: string | null): Promise<string | { kind: "unconfigured"; missing: string[] } | { kind: "no_token" }> {
  const mode = apiMode();
  if (mode === "live") return visitorToken ?? { kind: "no_token" };
  if (mode !== "local") return { kind: "unconfigured", missing: ["JUNGSI_API_MODE(live 또는 local)"] };
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
  if (res.status === 409) return { kind: "stale" };
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
    else if (got.kind === "no_token")
      body = <p className="crv-note">검수용 사용자 토큰이 없습니다. live 모드는 로그인 세션을 새로 만들고, 검수 PC(local 모드)는 로그인 스크립트(edge_login.py)로 토큰 파일을 갱신한 뒤 새로고침하세요.</p>;
    else if (got.kind === "stale")
      body = (
        <p className="crv-note">
          조회 중 현재 정본이 변경되었습니다(409). 이전 페이지와 섞지 않도록 <Link href={hrefFirst(filters)}>처음부터 다시 조회</Link>하세요.
        </p>
      );
    else if (got.kind === "error")
      body = (
        <p className="crv-note">
          서버가 요청을 거절했습니다 — HTTP {got.status}
          {got.code ? ` · ${got.code}` : ""}{got.requestId ? ` · 요청 ID ${got.requestId}` : ""}.{" "}
          {got.status === 401 ? "검수 로그인 토큰이 만료됐을 수 있습니다(로그인 스크립트 재실행 후 새로고침)." : "같은 내용이 반복되면 상태·코드·요청 ID 를 담당자에게 전달하세요."}
        </p>
      );
    else body = <Results page={got.page} filters={filters} />;
  }

  return (
    <>
      {head}
      <div className="crv">
        <section className="crv-search">
          <Form action={PATH}>
            <input type="hidden" name="q" value="1" />
            <div className="crv-grid">
              <label>학년도<input name="academic_year" inputMode="numeric" placeholder="2024~2027" defaultValue={filters.get("academic_year") ?? ""} /></label>
              <label>대학(부분)<input name="university_q" placeholder="예: 강원" defaultValue={filters.get("university_q") ?? ""} /></label>
              <label>학과(부분)<input name="department_q" placeholder="예: 간호" defaultValue={filters.get("department_q") ?? ""} /></label>
              <label>전형(정확값)<input name="track" defaultValue={filters.get("track") ?? ""} /></label>
              <label>모집군(정확값)<input name="group" defaultValue={filters.get("group") ?? ""} /></label>
              <label>지표 종류(정확값)<input name="metric_kind" defaultValue={filters.get("metric_kind") ?? ""} /></label>
              <label>집단(정확값)<input name="cohort" defaultValue={filters.get("cohort") ?? ""} /></label>
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

function Results({ page, filters }: { page: ReviewPage; filters: Map<FilterKey, string> }) {
  const items = page.items ?? [];
  return (
    <>
      <p className="crv-meta num">
        응답 {page.format} · {page.query_mode} · 이 범위 {items.length}건 · 전체 건수 미계산(count_status: {page.count_status}) ·{" "}
        {page.publication_status === "not_published" ? "검수 상태 표기(미발행) — 자료가 없다는 뜻이 아님" : page.publication_status}
      </p>
      {items.length === 0 ? (
        <p className="crv-hint">{page.next_cursor ? "이 범위에는 결과가 없지만 다음 범위가 남아 있습니다 — 아래에서 이어 보세요." : "조회 완료 — 조건에 맞는 관측이 없습니다."}</p>
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
                <th scope="col">상태</th>
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
                    {[it.review_status, it.value_availability].filter(Boolean).map((s) => (
                      <span key={s} className="crv-badge">{s}</span>
                    ))}
                    {(it.hold_reasons ?? []).map((h) => (
                      <span key={h} className="crv-badge hold">{h}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.next_cursor && (
        <Form action={PATH} className="crv-next">
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
