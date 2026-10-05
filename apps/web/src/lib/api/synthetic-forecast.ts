import "server-only";
import { cookies } from "next/headers";
import type { ForecastCapabilitiesDto, ForecastDraftDto, ForecastPublicDto, ForecastStatus, ForecastTarget } from "@/lib/dto";
import { CATALOG } from "./synthetic-assessment";

/*
  관리 화면(학과별 예상 기준, DEV-007) 합성 응답. 1.7.0 forecast_* 계약의 흐름만 흉내 낸다.
  - 권한: 합성 '운영자' 상태에서만 editor·approver, 허용 학교 2곳. 회원 등급과 무관하다.
  - 상태: draft → validated → approved → published. 조정은 새 revision 이고 검증·승인을 잇지 않는다.
  - 모든 쓰기는 expected_revision·base_result_hash·policy_version 이 맞아야 하며 아니면 409.
  - 숫자는 지어낸 값이다. draft 는 이 브라우저 쿠키에만 남는다.
  쿠키는 4KB 를 넘으면 잘리므로 입력과 조정만 짧게 남기고 결과·해시·기록은 읽을 때 다시 만든다.
  result·adjustments·validation·approval·audit_events 의 안쪽 모양은 명세에 없어 이 파일이 임시로 정한 것이다.
*/

const COOKIE = "jt_syn_fc";
const OLD_COOKIE = "jt_syn_forecast"; // 처음 판의 큰 쿠키. 지운다
const OPT = { path: "/jeongsi", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" as const, httpOnly: true };
export const SYN_ALLOWED_UNIVERSITIES = ["syn-gaon", "syn-haesol"];
const POLICY = "SYNTHETIC-forecast-policy-v1";
const MAX_DRAFTS = 4;

type Adj = { r: number; t: ForecastTarget; v: unknown; why: string; ev: string[]; at: string };
/** 쿠키에 남기는 최소 기록 */
type Rec = { id: string; o: string; r: number; st: ForecastStatus; inp: [string, string, string]; adj: Adj[]; val: string | null; apr: [string, string] | null; log: [string, number, string][] };
type Store = { d: Rec[]; k: Record<string, string>; n: number };
type Fail = { code: string; status: number };

async function load(): Promise<Store> {
  try {
    const raw = (await cookies()).get(COOKIE)?.value;
    if (raw) return JSON.parse(raw) as Store;
  } catch {}
  return { d: [], k: {}, n: 0 };
}

async function save(st: Store) {
  try {
    const jar = await cookies();
    jar.set(COOKIE, JSON.stringify(st), OPT);
    if (jar.get(OLD_COOKIE)) jar.set(OLD_COOKIE, "", { ...OPT, maxAge: 0 });
  } catch {}
}

function hash(v: unknown) {
  let h = 2166136261;
  for (const ch of JSON.stringify(v)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `syn-${h.toString(16).padStart(8, "0")}`;
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const universityOf = (offeringId: string) => CATALOG.find((o) => o.offering_id === offeringId)?.university_id ?? null;
const allowed = (r: Rec) => SYN_ALLOWED_UNIVERSITIES.includes(universityOf(r.o) ?? "");

export function capabilities(operator: boolean): ForecastCapabilitiesDto {
  return { format: "jungsi.forecast-capabilities/v1", capabilities: operator ? ["editor", "approver"] : [], university_ids: operator ? SYN_ALLOWED_UNIVERSITIES : [] };
}

/** 기본 산출(합성): 2024~2026 비교값의 가중 평균 → 70% 기준선, 별도 근거로 판단 구간 */
function baseValues(offeringId: string) {
  const seed = [...offeringId].reduce((a, c) => a + c.charCodeAt(0), 0) % 40;
  const c = 500 + seed * 10;
  return {
    forecast_70: { value: (c - 4).toFixed(2), unit: "점", definition: "올해 최종등록자 70% 예상 기준선(합성)" },
    acceptance_range: { lower: (c - 4).toFixed(2), upper: (c + 4).toFixed(2), unit: "점", definition: "지원 판단용 합격권(합성)" },
    category_ranges: [
      { category: "challenge", lower: (c - 12).toFixed(2), upper: (c - 4).toFixed(2) },
      { category: "core", lower: (c - 4).toFixed(2), upper: (c + 4).toFixed(2) },
      { category: "room", lower: (c + 4).toFixed(2), upper: (c + 20).toFixed(2) },
    ],
  };
}

function adopted(r: Rec) {
  let v: Record<string, unknown> = baseValues(r.o);
  for (const a of r.adj) v = { ...v, [a.t]: a.v };
  return v;
}

const resultHash = (r: Rec) => hash([r.o, r.r, adopted(r)]);

function toDto(r: Rec): ForecastDraftDto {
  const base = baseValues(r.o);
  const adp = adopted(r);
  const h = resultHash(r);
  return {
    format: "jungsi.forecast-draft/v1",
    draft_id: r.id,
    offering_id: r.o,
    revision: r.r,
    status: r.st,
    base_result_hash: h,
    policy_version: POLICY,
    result: {
      method: "weighted_mean",
      years: [2024, 2025, 2026],
      input_id: r.inp[0],
      input_version: r.inp[1],
      policy_id: r.inp[2],
      base,
      adjusted: r.adj.length ? adp : null,
      adopted: adp,
      ...(r.st === "published" ? { release_version: `syn-release-${r.id}-r${r.r}` } : {}),
    },
    adjustments: r.adj.map((a) => ({ revision: a.r, target: a.t, replacement: a.v, reason: a.why, evidence_refs: a.ev, at: a.at })),
    validation: r.val ? { receipt_hash: r.val, revision: r.r, checks: ["years_continuous", "unit_consistent", "ranges_non_overlapping"] } : null,
    approval: r.apr ? { receipt_hash: r.apr[0], revision: r.r, reason: r.apr[1] } : null,
    audit_events: r.log.map(([event, revision, at]) => ({ event, revision, at, actor: "synthetic-operator" })),
  };
}

export async function list(universityId?: string): Promise<ForecastDraftDto[]> {
  const st = await load();
  return st.d.filter((r) => allowed(r) && (!universityId || universityOf(r.o) === universityId)).map(toDto);
}

export async function read(id: string): Promise<ForecastDraftDto | null> {
  return (await list()).find((d) => d.draft_id === id) ?? null;
}

type Write = { expected_revision: number; base_result_hash: string; policy_version: string };

function conflict(r: Rec, body: Write): Fail | null {
  if (body.policy_version !== POLICY) return { code: "policy_version_mismatch", status: 409 };
  if (body.expected_revision !== r.r || body.base_result_hash !== resultHash(r)) return { code: "revision_conflict", status: 409 };
  return null;
}

const log = (r: Rec, event: string): Rec => ({ ...r, log: [...r.log, [event, r.r, now()] as [string, number, string]].slice(-8) });

async function mutate(key: string, run: (st: Store) => Rec | Fail): Promise<ForecastDraftDto | Fail> {
  const st = await load();
  const k = key.slice(0, 16);
  const prev = st.k[k] ? st.d.find((x) => x.id === st.k[k]) : undefined;
  if (prev) return toDto(prev); // 같은 키 재시도는 처음 결과
  const out = run(st);
  if ("code" in out) return out;
  st.k = Object.fromEntries(Object.entries({ ...st.k, [k]: out.id }).slice(-10));
  st.d = [...st.d.filter((x) => x.id !== out.id), out].slice(-MAX_DRAFTS);
  await save(st);
  return toDto(out);
}

function find(st: Store, id: string): Rec | Fail {
  return st.d.find((x) => x.id === id && allowed(x)) ?? { code: "forecast_draft_not_found", status: 404 };
}

export function create(offeringId: string, body: { input_id: string; input_version: string; policy_id: string; policy_version: string }, key: string) {
  return mutate(key, (st) => {
    const uni = universityOf(offeringId);
    if (!uni) return { code: "offering_not_found", status: 404 };
    if (!SYN_ALLOWED_UNIVERSITIES.includes(uni)) return { code: "forecast_scope_denied", status: 403 };
    if (!body.input_id || !body.input_version || !body.policy_id) return { code: "invalid_request", status: 422 };
    if (body.policy_version !== POLICY) return { code: "policy_version_mismatch", status: 409 };
    st.n += 1;
    const r: Rec = { id: `syn-fd-${st.n}`, o: offeringId, r: 1, st: "draft", inp: [body.input_id.slice(0, 40), body.input_version.slice(0, 20), body.policy_id.slice(0, 40)], adj: [], val: null, apr: null, log: [] };
    return log(r, "created");
  });
}

export function adjust(id: string, body: Write & { target: ForecastTarget; replacement: unknown; reason: string; evidence_refs: string[] }, key: string) {
  return mutate(key, (st) => {
    const r = find(st, id);
    if ("code" in r) return r;
    const c = conflict(r, body);
    if (c) return c;
    if (r.st === "published") return { code: "forecast_already_published", status: 409 };
    if (!body.reason.trim() || body.evidence_refs.length === 0) return { code: "invalid_request", status: 422 };
    const rev = r.r + 1;
    const a: Adj = { r: rev, t: body.target, v: body.replacement, why: body.reason.trim().slice(0, 40), ev: body.evidence_refs.slice(0, 3), at: now() };
    return log({ ...r, r: rev, st: "draft", adj: [...r.adj, a].slice(-3), val: null, apr: null }, "adjusted");
  });
}

export function validate(id: string, body: Write, key: string) {
  return mutate(key, (st) => {
    const r = find(st, id);
    if ("code" in r) return r;
    const c = conflict(r, body);
    if (c) return c;
    if (r.st !== "draft") return { code: "forecast_status_conflict", status: 409 };
    return log({ ...r, st: "validated", val: hash(["validation", resultHash(r)]) }, "validated");
  });
}

export function approve(id: string, body: Write & { validation_receipt_hash: string; reason: string }, key: string) {
  return mutate(key, (st) => {
    const r = find(st, id);
    if ("code" in r) return r;
    const c = conflict(r, body);
    if (c) return c;
    if (r.st !== "validated" || r.val !== body.validation_receipt_hash) return { code: "validation_receipt_mismatch", status: 409 };
    if (!body.reason.trim()) return { code: "invalid_request", status: 422 };
    return log({ ...r, st: "approved", apr: [hash(["approval", resultHash(r)]), body.reason.trim().slice(0, 40)] }, "approved");
  });
}

export function publish(id: string, body: Write & { approval_receipt_hash: string }, key: string) {
  return mutate(key, (st) => {
    const r = find(st, id);
    if ("code" in r) return r;
    const c = conflict(r, body);
    if (c) return c;
    if (r.st !== "approved" || r.apr?.[0] !== body.approval_receipt_hash) return { code: "approval_receipt_mismatch", status: 409 };
    return log({ ...r, st: "published" }, "published");
  });
}

/** 발행된 것만 공개한다. 내부 감사·담당자 기록은 빼고 근거 요약만 */
export async function published(offeringId: string): Promise<ForecastPublicDto> {
  const st = await load();
  const r = [...st.d].reverse().find((x) => x.o === offeringId && x.st === "published");
  const empty: ForecastPublicDto = {
    format: "jungsi.forecast-public/v1", status: "pending", reason_code: "forecast_not_published", offering_id: offeringId, release_version: null,
    forecast_70: null, expected_acceptance_range: null, category_ranges: null, basis_summary: null, issue_summaries: null, recommendation_reasons: null, adjustment_summary: null,
  };
  if (!r) return empty;
  const v = adopted(r) as ReturnType<typeof baseValues>;
  return {
    ...empty,
    status: "ready",
    reason_code: null,
    release_version: `syn-release-${r.id}-r${r.r}`,
    forecast_70: v.forecast_70,
    expected_acceptance_range: v.acceptance_range,
    category_ranges: v.category_ranges as ForecastPublicDto["category_ranges"],
    basis_summary: "2024~2026 같은 지표 비교값의 가중 평균(합성)",
    issue_summaries: [],
    recommendation_reasons: [],
    adjustment_summary: r.adj.length ? `상담 판단으로 ${r.adj.length}번 조정한 값입니다.` : null,
  };
}
