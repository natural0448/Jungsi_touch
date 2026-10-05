import "server-only";
import { cookies } from "next/headers";
import type { CategoryRangeDto, ForecastCapabilitiesDto, ForecastDraftDto, ForecastPublicDto, ForecastReplacement, ForecastResultDto, ForecastStatus, ForecastTarget } from "@/lib/dto";
import { CATALOG } from "./synthetic-assessment";

/*
  관리 화면(학과별 예상 기준, DEV-007) 합성 응답. develop 1.7.1 의 forecast_policy·forecast_dto 흐름을 흉내 낸다.
  - 권한: 합성 '운영자' 상태에서만 editor·approver, 허용 학교 2곳. 회원 등급과 무관하다.
  - 쓰기(조정·검증·승인·발행)마다 revision 이 1 오른다. base_result_hash 는 생성 때 값 그대로다.
  - expected_revision·base_result_hash·policy_version 이 다르면 409. 검증·승인 영수증이 낡았으면 409.
  - 숫자는 지어낸 값이다. 쿠키 4KB 를 넘지 않게 입력과 조정만 짧게 남기고 나머지는 읽을 때 다시 만든다.
*/

const COOKIE = "jt_syn_fc2";
const OLD = ["jt_syn_forecast", "jt_syn_fc"]; // 이전 판의 쿠키. 지운다
const OPT = { path: "/jeongsi", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" as const, httpOnly: true };
export const SYN_ALLOWED_UNIVERSITIES = ["syn-gaon", "syn-haesol"];
const POLICY = "SYNTHETIC-forecast-policy-v1";
const ACTOR = "synthetic-operator";
const MAX_DRAFTS = 4;

type Adj = { t: ForecastTarget; v: ForecastReplacement; why: string; ev: string[]; at: string };
/** 쿠키에 남기는 최소 기록 */
type Rec = {
  id: string;
  o: string;
  r: number;
  st: ForecastStatus;
  c: string; // created_at
  u: string; // updated_at
  adj: Adj[];
  val: [number, string] | null; // [검증한 revision, at]
  apr: [number, string, string] | null; // [승인한 revision, 이유, at]
  rel: string | null;
  log: [string, string][];
};
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
    for (const name of OLD) if (jar.get(name)) jar.set(name, "", { ...OPT, maxAge: 0 });
  } catch {}
}

function hash(v: unknown) {
  let h = 2166136261;
  for (const ch of JSON.stringify(v)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `syn-${h.toString(16).padStart(8, "0")}`;
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const offering = (id: string) => CATALOG.find((o) => o.offering_id === id) ?? null;
const allowed = (r: Rec) => SYN_ALLOWED_UNIVERSITIES.includes(offering(r.o)?.university_id ?? "");

export function capabilities(operator: boolean): ForecastCapabilitiesDto {
  return { format: "jungsi.forecast-capabilities/v1", capabilities: operator ? ["editor", "approver"] : [], university_ids: operator ? SYN_ALLOWED_UNIVERSITIES : [] };
}

/** 기본 산출(합성): 2024~2026 비교값의 가중 평균 → 70% 기준선, 별도 근거로 판단 구간 */
function baseResult(offeringId: string): ForecastResultDto {
  const seed = [...offeringId].reduce((a, c) => a + c.charCodeAt(0), 0) % 40;
  const c = 500 + seed * 10;
  const f = (v: number) => v.toFixed(2);
  return {
    forecast_70: { status: "ready", reason_code: null, value: f(c - 4), unit: "점", definition: "올해 최종등록자 70% 예상 기준선(합성)", version: "SYNTHETIC-forecast-v1" },
    acceptance_range: { status: "ready", reason_code: null, lower: f(c - 4), upper: f(c + 4), unit: "점", definition: "지원 판단용 합격권(합성)", policy_version: POLICY },
    category_ranges: [
      { category: "challenge", lower: f(c - 12), upper: f(c - 4) },
      { category: "core", lower: f(c - 4), upper: f(c + 4) },
      { category: "room", lower: f(c + 4), upper: f(c + 20) },
    ],
  };
}

const fix = (v: string) => Number(v).toFixed(2);

function applied(r: Rec): ForecastResultDto {
  const out = baseResult(r.o);
  for (const a of r.adj) {
    if (a.t === "forecast_70" && "value" in a.v) out.forecast_70 = { ...out.forecast_70, value: fix(a.v.value) };
    else if (a.t === "acceptance_range" && "lower" in a.v) out.acceptance_range = { ...out.acceptance_range, lower: fix(a.v.lower), upper: fix(a.v.upper) };
    else if (a.t === "category_ranges" && "ranges" in a.v) out.category_ranges = a.v.ranges.map((x) => ({ category: x.category, lower: fix(x.lower), upper: fix(x.upper) }));
  }
  return out;
}

function toDto(r: Rec): ForecastDraftDto {
  const o = offering(r.o)!;
  const result = applied(r);
  const resultHash = hash(result);
  const baseHash = hash([r.o, baseResult(r.o)]);
  const validation = r.val
    ? { status: "passed" as const, reason_code: null, checks: ["years_continuous", "unit_consistent", "ranges_non_overlapping"], validated_revision: r.val[0], result_hash: resultHash, receipt_hash: hash(["validation", r.id, r.val[0], resultHash]), at: r.val[1] }
    : null;
  const approval =
    r.apr && validation
      ? { approved_revision: r.apr[0], result_hash: resultHash, validation_hash: validation.receipt_hash, approval_hash: hash(["approval", r.id, r.apr[0], resultHash]), reason: r.apr[1], at: r.apr[2] }
      : null;
  return {
    format: "jungsi.forecast-draft/v1",
    draft_id: r.id,
    offering_id: r.o,
    revision: r.r,
    status: r.st,
    base_result_hash: baseHash,
    policy_version: POLICY,
    context: {
      offering_id: r.o, offering_lineage_id: r.o.replace(/-\d{4}$/, ""), academic_year: o.academic_year, university_id: o.university_id, campus: o.campus,
      department: o.department, track: o.track, group: o.group, exam_id: "SYNTHETIC-2027-09", source_pack_version: "SYNTHETIC-pack-v1", catalog_version: "SYNTHETIC-catalog-v1",
      analysis_version: "SYNTHETIC-analysis-v1", rule_id: `SYNTHETIC-rule-${o.university_id}`, rule_version: "v1", curve_version: "SYNTHETIC-univ-curve-v1",
      population_id: "SYNTHETIC-2027-09-whole_complete", score_scope: "국어·수학·탐구 반영 합(합성)", score_scale_id: "SYNTHETIC-scale", bonus_treatment: "none", unit: "점",
    },
    result,
    base_result: baseResult(r.o),
    created_at: r.c,
    updated_at: r.u,
    adjustments: r.adj.map((a) => ({ target: a.t, replacement: a.v, reason: a.why, evidence_refs: a.ev, actor: ACTOR, at: a.at, base_result_hash: baseHash })),
    validation,
    approval,
    audit_events: r.log.map(([action, at]) => ({ action, actor: ACTOR, at })),
  };
}

export async function list(universityId?: string): Promise<ForecastDraftDto[]> {
  const st = await load();
  return st.d.filter((r) => allowed(r) && (!universityId || offering(r.o)?.university_id === universityId)).map(toDto);
}

export async function read(id: string): Promise<ForecastDraftDto | null> {
  return (await list()).find((d) => d.draft_id === id) ?? null;
}

type Write = { expected_revision: number; base_result_hash: string; policy_version: string };

function conflict(r: Rec, body: Write): Fail | null {
  if (r.r !== body.expected_revision) return { code: "revision_conflict", status: 409 };
  if (body.base_result_hash !== toDto(r).base_result_hash || body.policy_version !== POLICY) return { code: "forecast_base_version_conflict", status: 409 };
  if (r.st === "published") return { code: "forecast_already_published", status: 409 };
  return null;
}

/** 쓰기 공통: 성공하면 revision 을 올리고 기록을 남긴다 */
function step(r: Rec, op: string, patch: Partial<Rec>): Rec {
  const at = now();
  return { ...r, ...patch, r: r.r + 1, u: at, log: [...r.log, [op, at] as [string, string]].slice(-8) };
}

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
  return st.d.find((x) => x.id === id && allowed(x)) ?? { code: "forecast_not_found", status: 404 };
}

export function create(offeringId: string, body: { input_id: string; input_version: string; policy_id: string; policy_version: string }, key: string) {
  return mutate(key, (st) => {
    const o = offering(offeringId);
    if (!o) return { code: "offering_not_found", status: 404 };
    if (!SYN_ALLOWED_UNIVERSITIES.includes(o.university_id)) return { code: "forecast_forbidden", status: 403 };
    if (!body.input_id || !body.input_version || !body.policy_id) return { code: "invalid_request", status: 422 };
    if (body.policy_version !== POLICY) return { code: "forecast_base_version_conflict", status: 409 };
    st.n += 1;
    const at = now();
    return { id: `syn-fd-${st.n}`, o: offeringId, r: 1, st: "draft", c: at, u: at, adj: [], val: null, apr: null, rel: null, log: [["forecast.create", at]] };
  });
}

function validRanges(v: CategoryRangeDto[]) {
  return v.length > 0 && v.every((x) => Number(x.lower) < Number(x.upper)) && [...v].sort((a, b) => Number(a.lower) - Number(b.lower)).every((x, i, a) => i === 0 || Number(a[i - 1].upper) <= Number(x.lower));
}

export function adjust(id: string, body: Write & { target: ForecastTarget; replacement: ForecastReplacement; reason: string; evidence_refs: string[] }, key: string) {
  return mutate(key, (st) => {
    const r = find(st, id);
    if ("code" in r) return r;
    const c = conflict(r, body);
    if (c) return c;
    if (!body.reason.trim() || body.evidence_refs.length === 0) return { code: "forecast_adjustment_evidence_missing", status: 422 };
    const v = body.replacement;
    if (body.target === "category_ranges") {
      if (!("ranges" in v) || !validRanges(v.ranges)) return { code: "forecast_adjustment_invalid", status: 422 };
    } else {
      if (!("unit" in v) || v.unit !== "점") return { code: "forecast_adjustment_unit_mismatch", status: 422 };
      if (body.target === "forecast_70" && !("value" in v)) return { code: "forecast_adjustment_invalid", status: 422 };
      if (body.target === "acceptance_range" && !("lower" in v && Number(v.lower) < Number(v.upper))) return { code: "forecast_adjustment_invalid", status: 422 };
    }
    const a: Adj = { t: body.target, v, why: body.reason.trim().slice(0, 40), ev: body.evidence_refs.slice(0, 3), at: now() };
    return step(r, "forecast.adjust", { st: "draft", adj: [...r.adj, a].slice(-3), val: null, apr: null });
  });
}

export function validate(id: string, body: Write, key: string) {
  return mutate(key, (st) => {
    const r = find(st, id);
    if ("code" in r) return r;
    const c = conflict(r, body);
    if (c) return c;
    return step(r, "forecast.validate", { st: "validated", val: [r.r + 1, now()], apr: null });
  });
}

export function approve(id: string, body: Write & { validation_receipt_hash: string; reason: string }, key: string) {
  return mutate(key, (st) => {
    const r = find(st, id);
    if ("code" in r) return r;
    const c = conflict(r, body);
    if (c) return c;
    const d = toDto(r);
    if (r.st !== "validated" || !d.validation) return { code: "forecast_validation_required", status: 409 };
    if (body.validation_receipt_hash !== d.validation.receipt_hash || d.validation.validated_revision !== r.r) return { code: "forecast_validation_stale", status: 409 };
    if (!body.reason.trim()) return { code: "forecast_approval_reason_missing", status: 422 };
    return step(r, "forecast.approve", { st: "approved", apr: [r.r + 1, body.reason.trim().slice(0, 40), now()] });
  });
}

export function publish(id: string, body: Write & { approval_receipt_hash: string }, key: string) {
  return mutate(key, (st) => {
    const r = find(st, id);
    if ("code" in r) return r;
    const c = conflict(r, body);
    if (c) return c;
    const d = toDto(r);
    if (r.st !== "approved" || !d.approval) return { code: "forecast_approval_required", status: 409 };
    if (body.approval_receipt_hash !== d.approval.approval_hash || d.approval.approved_revision !== r.r) return { code: "forecast_approval_stale", status: 409 };
    return step(r, "forecast.publish", { st: "published", rel: `syn-release-${r.id}-r${r.r}` });
  });
}

/** 발행된 것만 공개한다. 담당자·감사 기록은 빼고 공개 근거만 */
export async function published(offeringId: string): Promise<ForecastPublicDto> {
  const st = await load();
  const r = [...st.d].reverse().find((x) => x.o === offeringId && x.st === "published");
  const empty: ForecastPublicDto = {
    format: "jungsi.forecast-public/v1", status: "pending", reason_code: "forecast_release_missing", offering_id: offeringId, release_version: null, context: null,
    policy_version: null, input_version: null, forecast_70: null, expected_acceptance_range: null, category_ranges: [], basis_summary: null, issue_summaries: [],
    recommendation_reasons: [], adjustment_summary: { applied: false, reason: null, version: null },
  };
  if (!r) return empty;
  const d = toDto(r);
  const c = d.context;
  return {
    ...empty,
    status: "published",
    reason_code: null,
    release_version: r.rel,
    context: {
      offering_id: c.offering_id, academic_year: c.academic_year, exam_id: c.exam_id, source_pack_version: c.source_pack_version, catalog_version: c.catalog_version,
      rule_id: c.rule_id, rule_version: c.rule_version, curve_version: c.curve_version, analysis_version: c.analysis_version, score_scale_id: c.score_scale_id,
      score_scope: c.score_scope, bonus_treatment: c.bonus_treatment, population_id: c.population_id, comparison_metric: "converted_score", unit: "점", direction: "higher_is_better", tie_policy: null,
    },
    policy_version: POLICY,
    input_version: "v1",
    forecast_70: d.result.forecast_70,
    expected_acceptance_range: d.result.acceptance_range,
    category_ranges: d.result.category_ranges,
    basis_summary: "forecast_70: 승인된 비교자료 및 정책 적용 / acceptance_range: 승인된 비교자료 및 정책 적용(합성)",
    recommendation_reasons: [{ code: "approved_forecast_70", text: "승인된 forecast_70 비교자료와 정책에 따라 기준을 산출했습니다.", evidence_refs: ["SYN-ev-1"] }],
    adjustment_summary: { applied: r.adj.length > 0, reason: r.adj.map((a) => a.why).join(" / ") || null, version: r.adj.length ? r.rel : null },
  };
}

export const SYN_FORECAST_POLICY = POLICY;
