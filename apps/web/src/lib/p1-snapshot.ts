import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SnapshotHeadDto, SnapshotPartPin } from "@/lib/dto";
import { ConnectionError, SnapshotChanged, type Caller, type JungsiSource } from "@/lib/api/source";
import { P1CoordinationCore, P1CoordinationError, localP1CoordinatorClient, p1CoordinatorClient, validatePublicHead,
  type CoordinatorState, type CoordinationStore, type CoordinationView, type PublicDocument } from "./p1-coordinator-core";
import { linkR27, unitKey, type Cell, type R27Coverage, type Row, type School } from "./p1-shape";
import { projectBackendValidatedRank } from "./p1-field-qualification";
import { ADIGA_FILL_KEY, parseAdigaFill, type AdigaFill } from "./p1-adiga-fill";
export type { Cell, Row, School } from "./p1-shape";

/** Only immutable public bundles live in KV. The actor owns head/progress/ready and fences every commit.
 * Credentials and request-scoped I/O promises never enter shared state. Authenticate at each page/action.
 * Version 1 is retained; a new namespace cannot accidentally consume its unfenced ready/progress keys.
 */
const FORMAT = 4;
const R27_SNAPSHOT_SCHEMA = "jungsi.history-snapshot/v2";
const PARTS_PER_STEP = 6;
/** Equals the warm lease (120s): no step can outlive it, so a check this fresh cannot lapse before the step commits. */
const WARM_HEAD_MARGIN_MS = 120000;
const SCHOOLS_PER_STEP = 12;
const INDEX_SCHOOLS_PER_STEP = 20;
const MAX_FRAGMENT_READS = 20;
const KEEP_SEC = 60 * 24 * 3600;
type Mode = "synthetic" | "live";
type Kv = { get(key: string, type: "text"): Promise<string | null>; put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> };
type Stub = { fetch(request: Request): Promise<Response> };
type Namespace = { getByName?: (name: string) => Stub; idFromName?: (name: string) => unknown; get?: (id: unknown) => Stub };
type Client = ReturnType<typeof p1CoordinatorClient>;
type Services = { kv: Kv; coordinator: Client };
type Local = { cache: Map<string, string>; state: CoordinatorState | null };
function env() { return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}; }
function configuredMode(): Mode { return env().JUNGSI_API_MODE === "synthetic" ? "synthetic" : "live"; }
function servicesFailure(error: unknown): never {
  if (error instanceof P1CoordinationError) throw new ConnectionError("unavailable", error.code);
  throw error;
}
async function services(mode: Mode): Promise<Services> {
  let bindings: Record<string, unknown> | null = null;
  try { bindings = (await getCloudflareContext({ async: true })).env as Record<string, unknown>; } catch { /* Explicit local synthetic mode is checked below. */ }
  const store = bindings?.JT_SHARED_CACHE as Kv | undefined, ns = bindings?.JT_P1_COORDINATOR as Namespace | undefined;
  // next dev 의 플랫폼 대역은 Durable Object 이름표만 주고 클래스를 띄우지 않는다(호출하면 internal error).
  // 명시한 합성+development 에서는 아래 메모리 상태 기계를 쓴다 — 배포(production)·live 는 이 분기를 타지 않는다
  const localDev = mode === "synthetic" && env().NODE_ENV === "development";
  if (!localDev && store && typeof store.get === "function" && typeof store.put === "function" && ns) {
    const actorName = mode === "live" ? "public-v4:live" : "public-v4:synthetic";
    const stub = ns.getByName ? ns.getByName(actorName) : ns.idFromName && ns.get ? ns.get(ns.idFromName(actorName)) : null;
    if (stub) return { kv: store, coordinator: p1CoordinatorClient(stub) };
  }
  if (mode !== "synthetic" || !["development", "test"].includes(env().NODE_ENV ?? ""))
    throw new ConnectionError("unconfigured", "p1_shared_coordination_unconfigured");
  const g = globalThis as { __jtP1ExplicitLocalV4?: Local };
  const local = g.__jtP1ExplicitLocalV4 ??= { cache: new Map(), state: null };
  const atomic: CoordinationStore = { read: () => local.state, atomic: change => { const next = change(local.state); local.state = next.state; return next.result; } };
  return { kv: { get: async k => local.cache.get(k) ?? null, put: async (k, v) => { local.cache.set(k, v); } }, coordinator: localP1CoordinatorClient(new P1CoordinationCore(atomic)) };
}
async function getJson<T>(store: Kv, key: string): Promise<T | null> {
  const text = await store.get(key, "text"); return text === null ? null : JSON.parse(text) as T;
}
async function putJson(store: Kv, key: string, value: unknown): Promise<void> {
  // A claim's fenced prefix is never reused by another execution. No mutable KV checkpoint exists.
  await store.put(key, JSON.stringify(value), { expirationTtl: KEEP_SEC });
}
function document(value: object): PublicDocument { return value as unknown as PublicDocument; }
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** One claimant performs the authenticated API read; other requests poll metadata for at most 3.5s.
 * Polling never holds another request's I/O promise. A busy boundary stays pending, never stale-ready.
 * (10-24 QA: 700ms was shorter than a cold head read, so overlapping visitors saw "checking"; the page also retries itself.)
 */
async function checkedHead(src: JungsiSource, caller: Caller, coordinator: Client, afterRevision?: number, minFreshMs?: number): Promise<CoordinationView | null> {
  let claim = await coordinator.claimHead(afterRevision, minFreshMs);
  for (const ms of [100, 200, 400, 800, 1000, 1000]) {
    if (claim.state !== "busy") break;
    await pause(ms); claim = await coordinator.claimHead(afterRevision, minFreshMs);
  }
  if (claim.state === "busy") return null;
  if (claim.state === "cached") return claim.view;
  try {
    const head = validatePublicHead(await src.readSnapshotHead(caller), Date.now());
    return (await coordinator.commitHead(claim.token, head)).view;
  } catch (error) {
    await coordinator.failHead(claim.token).catch(() => undefined);
    throw error;
  }
}
type Index = { schools: School[]; units: [number, string, string, string, string, string][]; school_keys: Record<string, string> };
type IndexSegment = { schools: School[]; units: Index["units"]; rows: number; pending: number };

/** Duplicate scope keys are held locally: they cannot identify one current offering. */
function currentScopeCounts(rows: readonly Row[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.y === 2027 && r.pk !== null && typeof r.scope27 === "string" && r.scope27.length > 0)
      counts.set(r.scope27, (counts.get(r.scope27) ?? 0) + 1);
  }
  return counts;
}
/** Only a server-verified 2027 recruitment row anchors a current-year group. */
function isCurrentRecruitment(r: Row, scopes: ReadonlyMap<string, number>): boolean {
  return r.y === 2027 && r.pk !== null && typeof r.scope27 === "string" &&
    r.scope27.length > 0 && scopes.get(r.scope27) === 1 && r.q27 !== undefined;
}
function hasCurrentRecruitment(rows: readonly Row[], scopes: ReadonlyMap<string, number>): boolean {
  return rows.some(r => isCurrentRecruitment(r, scopes));
}
export type Ready = {
  snapshot_id: string; publication_sha256: string; source_head_sha256: string;
  /** Older v1 cached ready records may omit this field. */
  schema_version?: string;
  normalization_rules_version: string; selection_rules_version: string;
  generated_at: string; source_as_of: string | null; expires_at: string; counts: SnapshotHeadDto["counts"];
  r27_scope_coverage?: R27Coverage;
  warmed_at: string; pub: string; index_key: string; cache_mode: Mode;
};
type Progress = {
  snapshot_id: string; publication_sha256: string; done: string[]; part_keys: Record<string, string>;
  schoolParts: Record<string, string[]>; school_keys: Record<string, string>;
  school_assembly?: { school_id: string; next_fragment: number; key: string; write_prefix: string; step: number };
  phase: "parts" | "schools" | "index" | "ready"; schoolsDone: number; indexDone: number;
  index_segments: string[]; started_at: string;
};
type PartialSchool = {
  format: "jungsi.p1-school-partial/v1"; snapshot_id: string; publication_sha256: string; generation: string;
  school_id: string; fragment_ids: string[]; rows: Row[];
};

class Raw {
  constructor(public text: string) {}
}
function parseLossless(text: string): unknown {
  let ok = true;
  const v = JSON.parse(text, function (_k, val, ctx?: { source?: string }) {
    if (typeof val === "number") {
      if (!ctx || typeof ctx.source !== "string") ok = false;
      return new Raw(ctx?.source ?? String(val));
    }
    return val;
  });
  if (!ok) throw new Error("p1_lossless_parse_unavailable");
  return v;
}
type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Raw ? v.text : String(v));
const int = (v: unknown): number => (v instanceof Raw ? Number(v.text) : Number(v));
function cell(o: unknown, extra?: "stage" | "cut", qualifiedRankRow?: Obj): Cell {
  const c = (o ?? {}) as Obj;
  const out: Cell = { v: str(c.value), s: String(c.status ?? ""), r: str(c.reason_code), u: str(c.unit), l: str(c.statistic_label) };
  if (c.value instanceof Raw) out.n = 1;
  if (Object.hasOwn(c, "service_qualification")) {
    // This payload came through the authenticated, backend-validating API and checked part pins.
    // No frontend descriptor/grant registry is created from q itself.
    out.sq = projectBackendValidatedRank(qualifiedRankRow ? "final_additional_admission_rank" : "other", c, qualifiedRankRow,
      value => value instanceof Raw ? value.text : typeof value === "number" ? String(value) : null);
  }
  if (extra === "stage") out.st = String(c.stage ?? "unspecified");
  if (extra === "cut") {
    out.b = str(c.basis_label);
    out.co = str(c.cohort_label ?? c.cohort);
    out.p = c.statistic_percent === null || c.statistic_percent === undefined ? null : int(c.statistic_percent);
    out.bc = str(c.basis_code);
    out.cc = str(c.cohort_code);
  }
  out.at = str(c.source_as_of);
  const context = c.source_context as Obj | null | undefined;
  out.ctx = context ? { identity_variant_index: int(context.identity_variant_index), scope_status: String(context.scope_status) } : null;
  const url = str(c.source_url);
  if (url) out.url = url;
  // 발표 용도. 실제 입결 / 다른 학년도 산식으로 다시 계산한 참고값 / 미확인. 모르는 값은 버린다(기존 v1 과 같게)
  const role = ((c.publication_context ?? null) as Obj | null)?.publication_role;
  if (role === "actual_result" || role === "simulation_reference" || role === "unresolved") out.pr = role;
  return out;
}
function compact(r: Obj): Row {
  const alt = (r.alternate_cut ?? {}) as Obj;
  if (Object.hasOwn(alt, "service_qualification")) throw new Error("p1_field_qualification_invalid");
  const idr = (r.identity_review ?? null) as Obj | null;
  return {
    y: int(r.academic_year),
    pk: str(r.original_pk),
    ob: str(r.observation_key),
    n: String(r.university_name ?? ""),
    d: String(r.department ?? ""),
    t: str(r.admission_track),
    g: str(r.group),
    c: str(r.campus),
    rg: str(r.region),
    idv: Array.isArray(idr?.variants) ? (idr.variants as unknown[]).length : 0,
    rc: cell(r.recruitment_count_with_stage, "stage"),
    cr: cell(r.competition_ratio),
    ad: cell(r.additional_admission_count),
    rk: cell(r.final_additional_admission_rank, undefined, r),
    c50: cell(r.final_50_percent_cut, "cut"),
    c70: cell(r.final_70_percent_cut, "cut"),
    alt: {
      s: String(alt.status ?? ""),
      r: str(alt.reason_code),
      om: int(alt.omitted_other_basis_count ?? 0),
      e: Array.isArray(alt.entries) ? (alt.entries as unknown[]).map((e) => cell(e, "cut")) : [],
    },
    ...r27Of(r),
    ...historicalRefsOf(r),
  };
}
/**
 * 서버 검증(history_reference_estimates.ts)을 통과한 참고 관측만 옮긴다. 값 원문만 남기고 관측 ID 는 화면 자료에 넣지 않는다.
 * 모양이 다르면 버린다(뜻을 지어내지 않는다).
 */
function historicalRefsOf(r: Obj): Pick<Row, "hr"> {
  const list = r.historical_cutoff_references;
  if (!Array.isArray(list)) return {};
  const values = (list as Obj[]).filter(e => e && typeof e === "object" &&
    e.format === "jungsi.historical-cutoff-reference/v1" && e.unit === "%" && e.status === "model_estimated" &&
    e.display_role === "independent_observation" && e.production_allowed === false && e.engine_approved === false &&
    int(e.academic_year) === int(r.academic_year))
    .map(e => (e.value instanceof Raw ? e.value.text : str(e.value)))
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return values.length ? { hr: values } : {};
}
/** 2027 모집행의 r27_source 만 옮긴다. 모집인원·조건 원문은 그대로, 과거 연결은 서버가 검토 확인한 것만 */
function r27Of(r: Obj): Pick<Row, "q27" | "hl" | "scope27" | "ae27"> {
  const s = r.r27_source as Obj | undefined;
  if (int(r.academic_year) !== 2027 || !s || typeof s !== "object") return {};
  const q = (s.quota ?? {}) as Obj, qc = (q.quota_cell ?? null) as Obj | null;
  const links = Array.isArray(s.historical_links) ? (s.historical_links as Obj[]) : [];
  const rawEligibility = s.applicant_eligibility;
  const eligibility = rawEligibility && typeof rawEligibility === "object" && !Array.isArray(rawEligibility)
    ? rawEligibility as Obj : undefined;
  return {
    q27: { v: str(q.quota_value), ls: str(q.quota_literal_state), st: str(q.quota_stage), ct: str(q.quota_condition_text),
      cs: qc ? str(qc.status) : null, rs: String(s.quota_review_status ?? "") },
    scope27: str(s.scope_key) ?? undefined,
    ...(eligibility ? { ae27: {
      status: eligibility.status === "verified_official" ? "verified_official" as const : "pending" as const,
      text: typeof eligibility.text === "string" ? eligibility.text : null,
    } } : {}),
    hl: links.map(l => ({ academic_year: int(l.academic_year), school_id: str(l.school_id),
      original_pk: str(l.original_pk), campus: str(l.campus), admission_track: str(l.admission_track), group: str(l.group) })),
  };
}
/** 분할 본문의 부분 발행 표시(무손실 파싱 숫자). 키가 다르면 head 와 같아질 수 없는 값으로 둔다 */
function rawCoverage(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== 5) return { status: "invalid" };
  return Object.fromEntries(Object.entries(v as Obj).map(([k, x]) => [k, x instanceof Raw ? Number(x.text) : x]));
}
const canonicalCoverage = (v: unknown) => (v === undefined ? "" : JSON.stringify(v, ["status", "source_rows", "included_rows", "excluded_rows", "review_pending_rows"]));

/* ── 받은 bytes 검증 ── */

async function sha256(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as BufferSource);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}
async function gunzip(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/** 압축 그대로 받았으면 gzip pins, 풀린 원문이면 decoded pins 와 길이·SHA 를 맞춘다(서로 바꿔 비교하지 않는다) */
async function verifiedText(got: Uint8Array, pin: SnapshotPartPin): Promise<string> {
  let decoded = got;
  if (got[0] === 0x1f && got[1] === 0x8b) {
    if (got.length !== pin.gzip_bytes || (await sha256(got)) !== pin.gzip_sha256) throw new Error(`p1_gzip_pin_mismatch ${pin.part_id}`);
    decoded = await gunzip(got);
  }
  if (decoded.length !== pin.decoded_bytes || (await sha256(decoded)) !== pin.decoded_sha256) throw new Error(`p1_decoded_pin_mismatch ${pin.part_id}`);
  return new TextDecoder("utf-8", { fatal: true }).decode(decoded);
}

async function pubKeyOf(h: Pick<SnapshotHeadDto, "publication_sha256" | "source_head_sha256" | "normalization_rules_version" | "selection_rules_version">) {
  const k = [FORMAT, "p1-public", h.publication_sha256, h.source_head_sha256, h.normalization_rules_version, h.selection_rules_version].join("|");
  return (await sha256(new TextEncoder().encode(k))).slice(0, 32);
}


/* ── 준비(관리자) ── */
export type WarmStatus =
  | { state: "running"; phase: Progress["phase"]; parts_done: number; parts_total: number; schools_done: number; schools_total: number; retry_after_ms?: number }
  | { state: "ready"; ready: Ready }
  | { state: "changed" };
function initialProgress(head: SnapshotHeadDto): Progress {
  return { snapshot_id: head.snapshot_id, publication_sha256: head.publication_sha256, done: [], part_keys: {}, schoolParts: {}, school_keys: {}, phase: "parts", schoolsDone: 0, indexDone: 0, index_segments: [], started_at: new Date().toISOString() };
}
function running(pg: Progress, total: number, retry = 0): WarmStatus {
  return { state: "running", phase: pg.phase, parts_done: pg.done.length, parts_total: total, schools_done: pg.schoolsDone,
    schools_total: Object.keys(pg.schoolParts).length, ...(retry ? { retry_after_ms: retry } : {}) };
}
async function cacheValue<T>(store: Kv, key: string | undefined): Promise<T> {
  if (!key) throw new ConnectionError("unavailable", "p1_cache_reference_missing");
  const value = await getJson<T>(store, key);
  if (value === null) throw new ConnectionError("unavailable", "p1_cache_visibility_pending");
  return value;
}
async function readyOf(view: CoordinationView, mode: Mode): Promise<Ready | null> {
  if (!view.headFresh || !view.head || !view.ready) return null;
  const r = view.ready as unknown as Ready, h = view.head;
  if ((h.schema_version === R27_SNAPSHOT_SCHEMA && r.schema_version !== h.schema_version) ||
      r.snapshot_id !== h.snapshot_id || r.publication_sha256 !== h.publication_sha256 || r.source_head_sha256 !== h.source_head_sha256 ||
      r.normalization_rules_version !== h.normalization_rules_version || r.selection_rules_version !== h.selection_rules_version ||
      r.expires_at !== h.expires_at || Date.parse(r.expires_at) <= Date.now() || r.cache_mode !== mode ||
      canonicalCoverage(r.r27_scope_coverage) !== canonicalCoverage(h.r27_scope_coverage) ||
      r.pub !== await pubKeyOf(h) || typeof r.index_key !== "string") throw new ConnectionError("unavailable", "p1_ready_binding_invalid");
  return r;
}

/** One fenced step. Partial writes use unique keys and cannot overwrite a later step or ready marker. */
export async function warmStep(src: JungsiSource, caller: Caller): Promise<WarmStatus> {
  try { return await coordinatedWarmStep(src, caller); } catch (error) { return servicesFailure(error); }
}
async function coordinatedWarmStep(src: JungsiSource, caller: Caller): Promise<WarmStatus> {
  const mode = src.kind, { kv: store, coordinator } = await services(mode);
  // A step reads up to PARTS_PER_STEP parts and must commit before the 10-minute head check lapses (11-06 seq18 p1_head_check_required).
  const view = await checkedHead(src, caller, coordinator, undefined, WARM_HEAD_MARGIN_MS);
  if (!view?.head) return running(initialProgress({ snapshot_id: "checking", publication_sha256: "" } as SnapshotHeadDto), 0, 1000);
  const head = view.head, pub = await pubKeyOf(head), claim = await coordinator.claimWarm(head.publication_sha256);
  if (claim.state === "ready") {
    const ready = await readyOf(claim.view, mode);
    if (!ready) throw new ConnectionError("unavailable", "p1_ready_binding_invalid");
    return { state: "ready", ready };
  }
  const pg = (claim.view.progress ? structuredClone(claim.view.progress) as unknown as Progress : initialProgress(head));
  if (pg.snapshot_id !== head.snapshot_id || pg.publication_sha256 !== head.publication_sha256) throw new SnapshotChanged();
  if (claim.state === "busy") return running(pg, head.parts.length, 1000);
  const token = claim.token, P = token.writePrefix!;
  const write = async (key: string, value: unknown) => {
    if (Date.now() >= token.expiresAt) throw new P1CoordinationError("p1_coordinator_fence_stale");
    await putJson(store, key, value);
    if (Date.now() >= token.expiresAt) throw new P1CoordinationError("p1_coordinator_fence_stale");
  };
  try {
    let ready: Ready | null = null;
    if (pg.phase === "parts") {
      const next = head.parts.filter(p => !pg.done.includes(p.part_id)).slice(0, PARTS_PER_STEP);
      for (const pin of next) {
        const text = await verifiedText(await src.readSnapshotPart(caller, head.snapshot_id, pin.part_id), pin);
        const body = parseLossless(text) as Obj;
        const format = head.schema_version === "jungsi.history-snapshot/v2" ? "jungsi.history-snapshot/v2" : "jungsi.history-snapshot/v1";
        if (body.format !== format || body.part_id !== pin.part_id || body.payload_id !== pin.payload_id || !Array.isArray(body.rows) ||
            canonicalCoverage(rawCoverage(body.r27_scope_coverage)) !== canonicalCoverage(head.r27_scope_coverage)) throw new Error(`p1_part_invalid ${pin.part_id}`);
        const rows = (body.rows as Obj[]).map(r => [String(r.university_id ?? ""), compact(r)] as const);
        const mapped = rows.filter(([, r]) => r.pk !== null).length;
        if (rows.length !== pin.rows || mapped !== pin.mapped_rows || rows.length - mapped !== pin.mapping_pending_rows) throw new Error(`p1_part_counts_mismatch ${pin.part_id}`);
        const bySchool: Record<string, Row[]> = {};
        for (const [u, r] of rows) {
          if (!/^[A-Za-z0-9._:-]{1,64}$/.test(u)) throw new Error(`p1_part_invalid ${pin.part_id}`);
          (bySchool[u] ??= []).push(r);
        }
        const key = `${P}:frag:${pin.part_id}`;
        await write(key, bySchool); pg.part_keys[pin.part_id] = key;
        for (const u of Object.keys(bySchool)) (pg.schoolParts[u] ??= []).push(pin.part_id);
        pg.done.push(pin.part_id);
      }
      if (pg.done.length === head.parts.length) pg.phase = "schools";
    } else if (pg.phase === "schools") {
      const ids = Object.keys(pg.schoolParts).sort(), frags = new Map<string, Record<string, Row[]>>();
      if (pg.school_assembly && pg.school_assembly.school_id !== ids[pg.schoolsDone])
        throw new ConnectionError("unavailable", "p1_cache_partial_binding_invalid");
      let completed = 0;
      for (const u of ids.slice(pg.schoolsDone, pg.schoolsDone + SCHOOLS_PER_STEP)) {
        const parts = pg.schoolParts[u], pending = pg.school_assembly;
        let rows: Row[] = [], at = 0;
        if (pending) {
          const generationPrefix = `p1c:v1:${token.generation}:f`;
          const stamp = typeof pending.write_prefix === "string" && pending.write_prefix.startsWith(generationPrefix)
            ? /^([1-9][0-9]*):([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/.exec(pending.write_prefix.slice(generationPrefix.length)) : null;
          const previousFence = stamp ? Number(stamp[1]) : NaN;
          if (pending.school_id !== u || !Number.isSafeInteger(pending.next_fragment) || pending.next_fragment < 1 ||
              pending.next_fragment >= parts.length || !Number.isSafeInteger(pending.step) || pending.step !== token.step - 1 ||
              !Number.isSafeInteger(previousFence) || previousFence >= token.fence ||
              pending.key !== `${pending.write_prefix}:school-partial:${u}`)
            throw new ConnectionError("unavailable", "p1_cache_partial_binding_invalid");
          const cached = await cacheValue<PartialSchool>(store, pending.key);
          if (cached.format !== "jungsi.p1-school-partial/v1" || cached.snapshot_id !== head.snapshot_id ||
              cached.publication_sha256 !== head.publication_sha256 || cached.generation !== token.generation || cached.school_id !== u ||
              !Array.isArray(cached.fragment_ids) || cached.fragment_ids.length !== pending.next_fragment ||
              cached.fragment_ids.some((part, i) => part !== parts[i]) || !Array.isArray(cached.rows))
            throw new ConnectionError("unavailable", "p1_cache_partial_binding_invalid");
          rows = cached.rows; at = pending.next_fragment;
        }
        const start = at;
        for (; at < parts.length; at++) {
          const part = parts[at];
          if (!frags.has(part)) {
            if (frags.size === MAX_FRAGMENT_READS) break;
            frags.set(part, await cacheValue<Record<string, Row[]>>(store, pg.part_keys[part]));
          }
          const found = frags.get(part)![u];
          if (!found) throw new ConnectionError("unavailable", "p1_cache_reference_missing");
          rows.push(...found);
        }
        if (at === start) break;
        if (at < parts.length) {
          const key = `${P}:school-partial:${u}`;
          await write(key, { format: "jungsi.p1-school-partial/v1", snapshot_id: head.snapshot_id,
            publication_sha256: head.publication_sha256, generation: token.generation!, school_id: u,
            fragment_ids: parts.slice(0, at), rows } satisfies PartialSchool);
          pg.school_assembly = { school_id: u, next_fragment: at, key, write_prefix: P, step: token.step };
          break;
        }
        const key = `${P}:school:${u}`; await write(key, linkR27(rows, u)); pg.school_keys[u] = key; completed++;
        delete pg.school_assembly;
      }
      pg.schoolsDone += completed;
      if (pg.schoolsDone === ids.length) pg.phase = "index";
    } else if (pg.phase === "index") {
      const ids = Object.keys(pg.schoolParts).sort(), segment: IndexSegment = { schools: [], units: [], rows: 0, pending: 0 };
      for (let at = pg.indexDone; at < Math.min(ids.length, pg.indexDone + INDEX_SCHOOLS_PER_STEP); at++) {
        const u = ids[at], rows = await cacheValue<Row[]>(store, pg.school_keys[u]); segment.rows += rows.length;
        const names = [...new Set([...rows].sort((a, b) => b.y - a.y).map(r => r.n))];
        const by = new Map<string, Row[]>();
        for (const r of rows) by.set(unitKey(r), [...(by.get(unitKey(r)) ?? []), r]);
        const isR27 = head.schema_version === R27_SNAPSHOT_SCHEMA;
        const scopes = isR27 ? currentScopeCounts(rows) : new Map<string, number>();
        const currentRows: Row[] = [];
        let rawPending = 0, visiblePending = 0, visibleUnits = 0;
        for (const [k, rs] of by) {
          if (k.startsWith("ob:")) rawPending++;
          // 2027 모집행 중심 목록(대표님 결정 2026-11-16): 2027 모집행에 연결되지 않은 과거 전용 묶음은 목록에 따로 두지 않는다(원본 캐시에는 보존)
          if (isR27 && !hasCurrentRecruitment(rs, scopes)) continue;
          if (k.startsWith("ob:")) visiblePending++;
          visibleUnits++;
          const conditionRows = isR27 ? rs.filter(r => isCurrentRecruitment(r, scopes)) : rs;
          if (isR27) currentRows.push(...conditionRows);
          const uniq = (source: readonly Row[], f: (r: Row) => string | null) => [...new Set(source.map(f).filter((x): x is string => !!x))].join("\n");
          // Past department and school names are searchable aliases, but current-year
          // enrollment filters must never inherit a historical group or region.
          segment.units.push([at, k, uniq(rs, r => r.d), uniq(conditionRows, r => r.g), uniq(conditionRows, r => r.rg), uniq(rs, r => r.n)]);
        }
        // Head counts cover all original rows, including unverified current groups.
        segment.pending += rawPending;
        const regions = [...new Set((isR27 ? currentRows : rows).map(r => r.rg).filter((x): x is string => !!x))];
        const name = isR27 ? currentRows[0]?.n ?? names[0] ?? u : names[0] ?? u;
        segment.schools.push({ id: u, name, names, region: regions.length === 1 ? regions[0] : regions.join("·") || null, units: visibleUnits - visiblePending, pending: visiblePending });
      }
      const segmentKey = `${P}:index-segment:${pg.indexDone}`; await write(segmentKey, segment);
      pg.index_segments.push(segmentKey); pg.indexDone += segment.schools.length;
      if (pg.indexDone === ids.length) {
        const all = await Promise.all(pg.index_segments.map(key => cacheValue<IndexSegment>(store, key)));
        const schools = all.flatMap(s => s.schools), units = all.flatMap(s => s.units);
        if (all.reduce((n, s) => n + s.rows, 0) !== head.counts.rows || schools.length !== head.counts.schools || all.reduce((n, s) => n + s.pending, 0) !== head.counts.mapping_pending_rows) throw new Error("p1_totals_mismatch");
        schools.sort((a, b) => a.name.localeCompare(b.name, "ko"));
        const order = new Map(schools.map((s, i) => [s.id, i]));
        const index: Index = { schools, units: units.map(([si, ...rest]) => [order.get(ids[si])!, ...rest]), school_keys: pg.school_keys };
        const indexKey = `${P}:index`; await write(indexKey, index);
        // Revalidate the actual head after construction. A newer publication invalidates this lease.
        const beforeFinalCheck = await coordinator.inspect();
        const finalView = await checkedHead(src, caller, coordinator, beforeFinalCheck.headRevision);
        if (!finalView?.head || await pubKeyOf(finalView.head) !== pub) throw new SnapshotChanged();
        ready = { snapshot_id: head.snapshot_id, publication_sha256: head.publication_sha256, source_head_sha256: head.source_head_sha256,
          schema_version: head.schema_version,
          normalization_rules_version: head.normalization_rules_version, selection_rules_version: head.selection_rules_version,
          generated_at: head.generated_at, source_as_of: head.source_as_of, expires_at: head.expires_at, counts: head.counts,
          ...(head.r27_scope_coverage ? { r27_scope_coverage: head.r27_scope_coverage } : {}),
          warmed_at: new Date().toISOString(), pub, index_key: indexKey, cache_mode: mode };
        pg.phase = "ready";
      }
    }
    const committed = await coordinator.commitWarm(token, document(pg), ready ? document(ready) : null);
    if (ready) {
      const confirmed = await readyOf(committed.view, mode);
      if (!confirmed) throw new ConnectionError("unavailable", "p1_ready_binding_invalid");
      return { state: "ready", ready: confirmed };
    }
    return running(pg, head.parts.length);
  } catch (error) {
    await coordinator.failWarm(token).catch(() => undefined);
    if (error instanceof SnapshotChanged) {
      await checkedHead(src, caller, coordinator, view.headRevision).catch(() => null);
      return { state: "changed" };
    }
    if (error instanceof P1CoordinationError && error.code === "p1_coordinator_fence_stale") {
      const latest = await coordinator.inspect();
      return running((latest.progress as unknown as Progress | null) ?? initialProgress(head), head.parts.length, 1000);
    }
    throw error;
  }
}

/**
 * 관리자 '정리본 다시 만들기'(2026-11-16). 같은 판(발행판)의 정리본을 처음부터 다시 만든다 — 화면 정리본 형식이 바뀌어
 * 새 칸을 채워야 할 때 새 발행판을 내지 않고 쓴다. 다시 만드는 동안 1페이지는 이전 준비본(대기본)을 그대로 쓴다.
 * 시작만 한다. 이어서 준비 단계(warmStep)를 끝까지 부른다.
 */
export async function rebuildStart(src: JungsiSource, caller: Caller): Promise<WarmStatus> {
  try {
    const { coordinator } = await services(src.kind);
    const view = await checkedHead(src, caller, coordinator, undefined, WARM_HEAD_MARGIN_MS);
    if (!view?.head) return running(initialProgress({ snapshot_id: "checking", publication_sha256: "" } as SnapshotHeadDto), 0, 1000);
    await coordinator.rebuildWarm(view.head.publication_sha256);
    return running(initialProgress(view.head), view.head.parts.length);
  } catch (error) { return servicesFailure(error); }
}

/** 대학어디가 빈칸 채움 표(2026-11-17 대표님 결정). 읽지 못하면 null — 채우지 않을 뿐 화면은 그대로 보인다. 5분마다 다시 읽는다. */
let fillCache: { at: number; fill: AdigaFill | null } | null = null;
export async function loadAdigaFill(): Promise<AdigaFill | null> {
  if (configuredMode() !== "live") return null;
  if (fillCache && Date.now() - fillCache.at < 5 * 60 * 1000) return fillCache.fill;
  let fill: AdigaFill | null = null;
  try { fill = parseAdigaFill(await (await services("live")).kv.get(ADIGA_FILL_KEY, "text")); } catch { fill = null; }
  fillCache = { at: Date.now(), fill };
  return fill;
}

/** Admin status only; an unfresh actor never exposes the stored ready as current. */
/** 관리 화면용. stale: 현재판 확인 기한(10분)이 지나 아직 다시 확인하지 않은 상태 — 준비본이 없는 것과 구분한다(10-24 Root 관측).
 * 오래된 판을 준비 완료로 인정하지는 않는다(ready 는 그대로 null). */
export async function warmInfo(): Promise<{ ready: Ready | null; stale: { snapshot_id: string } | null }> {
  try {
    const mode = configuredMode(), { coordinator } = await services(mode), view = await coordinator.inspect();
    const ready = await readyOf(view, mode);
    return { ready, stale: !ready && view.head && !view.headFresh ? { snapshot_id: view.head.snapshot_id } : null };
  }
  catch (error) { return servicesFailure(error); }
}

/**
 * 3페이지 연도별 근거의 1페이지 성적 칸 전용(표시만). 저장된 준비본이 만료 전이면 서비스 API 머리 확인 없이 쓴다
 * (2026-11-17 대표님 요청: 펼침이 10~15초 늦음). 머리 확인 기한(10분)이 지난 준비본도 만료 전이면 같은 공개 자료다.
 * 준비본이 없거나 묶음이 맞지 않으면 null — 칸은 '자료 없음'으로 남는다. 1페이지 자체는 그대로 currentSnapshot 을 쓴다.
 */
export async function displayReady(): Promise<Ready | null> {
  try {
    const mode = configuredMode(), { coordinator } = await services(mode), view = await coordinator.peek();
    if (!view.head || !view.ready) return null;
    return await readyOf({ ...view, headFresh: true }, mode);
  } catch { return null; }
}

/* ── 조회(회원): no shared I/O promises or private results ── */
const memIndex = new Map<string, Index>(), memSchool = new Map<string, Row[]>();
export type Current = { state: "ready"; ready: Ready } | { state: "none" | "changed" | "expired" | "checking" };
export async function currentSnapshot(src: JungsiSource, caller: Caller): Promise<Current> {
  try {
    const { coordinator } = await services(src.kind), previous = await coordinator.inspect();
    const current = await checkedHead(src, caller, coordinator);
    if (!current) return { state: "checking" };
    const ready = await readyOf(current, src.kind);
    if (ready) return { state: "ready", ready };
    if (previous.head && current.head && await pubKeyOf(previous.head) !== await pubKeyOf(current.head)) return { state: "changed" };
    return { state: "none" };
  } catch (error) { return servicesFailure(error); }
}
async function index(ready: Ready): Promise<Index> {
  let ix = memIndex.get(ready.index_key);
  if (!ix) {
    ix = await cacheValue<Index>((await services(ready.cache_mode)).kv, ready.index_key);
    if (!Array.isArray(ix.schools) || !Array.isArray(ix.units) || !ix.school_keys) throw new ConnectionError("unavailable", "p1_snapshot_index_missing");
    memIndex.clear(); memIndex.set(ready.index_key, ix);
  }
  return ix;
}
async function school(ready: Ready, id: string): Promise<Row[]> {
  const k = `${ready.index_key}:${id}`;
  let rows = memSchool.get(k);
  if (!rows) {
    const ix = await index(ready); rows = await cacheValue<Row[]>((await services(ready.cache_mode)).kv, ix.school_keys[id]);
    if (!Array.isArray(rows)) throw new ConnectionError("unavailable", "p1_snapshot_school_missing");
    if (memSchool.size >= 120) memSchool.delete(memSchool.keys().next().value as string);
    memSchool.set(k, rows);
  }
  return rows;
}
export const PAGE_SCHOOLS = 20;
const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, "").toLowerCase();
export type SearchResult = { total_schools: number; total_units: number; total_pending: number; page: number; pages: number; schools: { school: School; rows: Row[]; keys: Set<string> }[] };
/** 쉼표(, ， 、)로 나눈 여러 검색어. 하나라도 맞으면 찾는다(10-24: "강원대, 홍익대"가 한 글자열로 취급돼 0건이었다) */
const terms = (s?: string) => (s ?? "").split(/[,，、]/).map(norm).filter(Boolean).slice(0, 10);
const anyHit = (qs: string[], hay: string[]) => qs.some(q => hay.some(h => norm(h).includes(q)));
export async function searchSnapshot(ready: Ready, q: { university?: string; unit?: string; region?: string; group?: string; page?: number }): Promise<SearchResult> {
  const ix = await index(ready), uq = terms(q.university), dq = terms(q.unit);
  const schoolHit = ix.schools.map(s => !uq.length || anyHit(uq, s.names));
  const matched = new Map<number, Set<string>>(); let units = 0, pending = 0;
  for (const [si, key, deps, groups, regions, names] of ix.units) {
    if (!schoolHit[si] && !(uq.length && anyHit(uq, names.split("\n")))) continue;
    if (dq.length && !anyHit(dq, deps.split("\n"))) continue;
    // 발표 표기가 '다'와 '다군'으로 섞여 있어 '군'을 떼고 비교한다(10-24 QA)
    if (q.group && !groups.split("\n").some(g => g.replace(/군$/, "") === q.group)) continue;
    if (q.region && !regions.split("\n").includes(q.region)) continue;
    let set = matched.get(si); if (!set) matched.set(si, set = new Set()); set.add(key);
    if (key.startsWith("ob:")) pending++; else units++;
  }
  const order = [...matched.keys()].sort((a, b) => a - b), pages = Math.max(1, Math.ceil(order.length / PAGE_SCHOOLS));
  const requestedPage = Number.isSafeInteger(q.page) ? q.page! : 1, page = Math.min(Math.max(1, requestedPage), pages);
  const schools = await Promise.all(order.slice((page - 1) * PAGE_SCHOOLS, page * PAGE_SCHOOLS).map(async si => {
    const s = ix.schools[si], keys = matched.get(si)!;
    return { school: s, rows: (await school(ready, s.id)).filter(r => keys.has(unitKey(r))), keys };
  }));
  return { total_schools: order.length, total_units: units, total_pending: pending, page, pages, schools };
}
/**
 * 3페이지 연도별 근거의 '대학 발표 입시결과' 칸(2026-11-17 대표님 결정 1-가): 2027 모집행(pk)과 같은 묶음의
 * 1페이지 2024~2026 행. 대학 이름으로 학교를 찾고, 그 학교에서 이 2027 행과 같은 표시 키를 가진 과거 행만 돌려준다.
 */
export async function pastRowsFor2027(ready: Ready, university: string, pk27: string): Promise<Row[]> {
  const ix = await index(ready), q = norm(university);
  const exact = ix.schools.filter(s => s.names.some(n => norm(n) === q));
  for (const s of exact.length ? exact : ix.schools.filter(s => s.names.some(n => norm(n).includes(q)))) {
    const rows = await school(ready, s.id);
    const anchor = rows.find(r => r.y === 2027 && r.pk === pk27);
    if (!anchor) continue;
    const key = unitKey(anchor);
    return rows.filter(r => r.y < 2027 && unitKey(r) === key);
  }
  return [];
}
export async function unitRows(ready: Ready, schoolId: string, key: string): Promise<Row[]> {
  return (await schoolUnitRows(ready, schoolId, [key]))[key] ?? [];
}
/** 한 학교의 여러 모집단위를 한 번에. 2027 모집행에 연결된 묶음만 돌려준다(과거 전용·미검증 2027 묶음은 빈 목록). */
export async function schoolUnitRows(ready: Ready, schoolId: string, keys: readonly string[]): Promise<Record<string, Row[]>> {
  const allRows = await school(ready, schoolId);
  const isR27 = ready.schema_version === R27_SNAPSHOT_SCHEMA, scopes = isR27 ? currentScopeCounts(allRows) : new Map<string, number>();
  const wanted = new Set(keys), by = new Map<string, Row[]>();
  for (const r of allRows) { const k = unitKey(r); if (wanted.has(k)) by.set(k, [...(by.get(k) ?? []), r]); }
  const out: Record<string, Row[]> = {};
  for (const k of wanted) { const rows = by.get(k) ?? []; out[k] = isR27 && !hasCurrentRecruitment(rows, scopes) ? [] : rows; }
  return out;
}
