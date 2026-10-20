import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SnapshotHeadDto, SnapshotPartPin } from "@/lib/dto";
import { ConnectionError, SnapshotChanged, type Caller, type JungsiSource } from "@/lib/api/source";

/*
  1페이지 전국 정리본(history.snapshot.*, 기획 1.9.95 · 담당자 연결계약 2026-10-20 v3 §4)의 화면 서버 쪽 보관.

  준비(워밍): 관리자가 관리 화면에서 한 번 실행한다. 현재판 head → manifest 의 분할을 순서대로 받아 각 분할의
  길이·SHA 를 pins 와 대조하고, 행 수·연결/미연결 수가 맞는지 확인한 뒤 학교별 묶음과 작은 검색 색인으로 나눠
  저장한다. 전부 끝나고 합계가 head 와 맞을 때만 마지막에 ready 표지를 쓴다. 일반 회원의 첫 방문에 분할 121개를
  받게 하지 않는다. 한 번에 몇 개씩만 처리해 요청 하나가 커지지 않게 한다(관리 화면이 이어서 부른다).

  조회: ready 표지 → 색인(메모리에 잠시) → 대학 20곳의 학교 묶음만 읽는다. 전체 원문을 한 값에 넣거나 매 검색마다
  전부 풀지 않는다. 현재판 확인(head)은 10분마다 한 번, 그때 요청한 회원의 인증으로 한다. 판이 바뀌었거나
  만료됐으면 옛 판을 성공처럼 보이지 않고 '새 판 준비 중'으로 멈춘다. 회원 확인(session)은 매 요청 화면에서 한다.

  보관 대상은 공개 발표 정리본뿐이다 — 개인 성적·리포트·토큰·cursor 는 넣지 않는다. 숫자는 원문 표기를
  그대로 문자열로 지닌다(JSON.parse 의 원문 접근으로 읽어 1.50 → 1.5 같은 변환이 없다). null 은 0 이 아니다.
*/

const FORMAT = 1;
const PARTS_PER_STEP = 6;
const SCHOOLS_PER_STEP = 40;
const HEAD_CHECK_MS = 10 * 60 * 1000;
const KEEP_SEC = 60 * 24 * 3600;

/* ── 저장소: 워커에서는 KV(JT_SHARED_CACHE), 로컬 개발(next dev)에서는 메모리 ── */

type Kv = {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};
const devStore: Map<string, string> = ((globalThis as { __jtP1Store?: Map<string, string> }).__jtP1Store ??= new Map());
async function kv(): Promise<Kv> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const b = (env as Record<string, unknown>).JT_SHARED_CACHE as Kv | undefined;
    if (b) return b;
  } catch {
    /* 워커 밖 */
  }
  return {
    get: async (k) => devStore.get(k) ?? null,
    put: async (k, v) => void devStore.set(k, v),
  };
}
async function getJson<T>(k: string): Promise<T | null> {
  const s = await (await kv()).get(k, "text");
  return s === null ? null : (JSON.parse(s) as T);
}
async function putJson(k: string, v: unknown) {
  await (await kv()).put(k, JSON.stringify(v), { expirationTtl: KEEP_SEC });
}

const ROOT = `p1s:v${FORMAT}`;
const READY_KEY = `${ROOT}:ready`;
const CHECK_KEY = `${ROOT}:checked`;

import type { Cell, Row, School } from "./p1-shape";
import { unitKey } from "./p1-shape";
export type { Cell, Row, School } from "./p1-shape";

/** 색인: 학교 목록 + 모집단위별 [학교 순번, 묶음 키, 학과명들, 군들, 지역들, 발표 대학명들] */
type Index = { schools: School[]; units: [number, string, string, string, string, string][] };
export type Ready = {
  snapshot_id: string;
  publication_sha256: string;
  source_head_sha256: string;
  normalization_rules_version: string;
  selection_rules_version: string;
  generated_at: string;
  source_as_of: string | null;
  expires_at: string;
  counts: SnapshotHeadDto["counts"];
  warmed_at: string;
  pub: string;
};
type Progress = {
  snapshot_id: string;
  publication_sha256: string;
  done: string[];
  schoolParts: Record<string, string[]>;
  phase: "parts" | "schools" | "index" | "ready";
  schoolsDone: number;
  started_at: string;
};

/* ── 원문 그대로 읽기 ── */

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
function cell(o: unknown, extra?: "stage" | "cut"): Cell {
  const c = (o ?? {}) as Obj;
  const out: Cell = { v: str(c.value), s: String(c.status ?? ""), r: str(c.reason_code), u: str(c.unit), l: str(c.statistic_label) };
  if (c.value instanceof Raw) out.n = 1;
  if (extra === "stage") out.st = String(c.stage ?? "unspecified");
  if (extra === "cut") {
    out.b = str(c.basis_label);
    out.co = str(c.cohort_label ?? c.cohort);
  }
  const url = str(c.source_url);
  if (url) out.url = url;
  return out;
}
function compact(r: Obj): Row {
  const alt = (r.alternate_cut ?? {}) as Obj;
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
    rk: cell(r.final_additional_admission_rank),
    c50: cell(r.final_50_percent_cut, "cut"),
    c70: cell(r.final_70_percent_cut, "cut"),
    alt: {
      s: String(alt.status ?? ""),
      r: str(alt.reason_code),
      om: int(alt.omitted_other_basis_count ?? 0),
      e: Array.isArray(alt.entries) ? (alt.entries as unknown[]).map((e) => cell(e, "cut")) : [],
    },
  };
}

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

function checkHead(h: SnapshotHeadDto) {
  const HASH = /^[0-9a-f]{64}$/;
  if (h.format !== "jungsi.history-snapshot-head/v1" || h.status !== "approved" || !HASH.test(h.publication_sha256)) throw new Error("p1_head_invalid");
  if (h.delivery_mode !== "parts" || !Array.isArray(h.parts) || h.parts.length === 0) throw new Error("p1_head_unsupported_delivery");
  if (Date.parse(h.expires_at) <= Date.now()) throw new Error("p1_head_expired");
  const rows = h.parts.reduce((a, p) => a + p.rows, 0);
  if (rows !== h.counts.rows) throw new Error("p1_head_counts_mismatch");
}
async function pubKeyOf(h: Pick<SnapshotHeadDto, "publication_sha256" | "source_head_sha256" | "normalization_rules_version" | "selection_rules_version">) {
  const k = [FORMAT, "p1-public", h.publication_sha256, h.source_head_sha256, h.normalization_rules_version, h.selection_rules_version].join("|");
  return (await sha256(new TextEncoder().encode(k))).slice(0, 32);
}

/* ── 준비(관리자) ── */

export type WarmStatus =
  | { state: "running"; phase: Progress["phase"]; parts_done: number; parts_total: number; schools_done: number; schools_total: number }
  | { state: "ready"; ready: Ready }
  | { state: "changed" };

/** 한 단계만 진행한다. 관리 화면이 ready 가 될 때까지 이어서 부른다. 같은 판이면 끊겼던 곳부터 이어 간다 */
export async function warmStep(src: JungsiSource, caller: Caller): Promise<WarmStatus> {
  const head = await src.readSnapshotHead(caller);
  checkHead(head);
  const pub = await pubKeyOf(head);
  const P = `${ROOT}:${pub}`;
  const cur = await getJson<Ready>(READY_KEY);
  if (cur && cur.pub === pub && cur.snapshot_id === head.snapshot_id) return { state: "ready", ready: cur };

  let pg = await getJson<Progress>(`${P}:warm`);
  if (!pg || pg.snapshot_id !== head.snapshot_id || pg.publication_sha256 !== head.publication_sha256) {
    pg = { snapshot_id: head.snapshot_id, publication_sha256: head.publication_sha256, done: [], schoolParts: {}, phase: "parts", schoolsDone: 0, started_at: new Date().toISOString() };
  }
  const total = head.parts.length;
  const schoolIds = () => Object.keys(pg.schoolParts).sort();
  const status = (): WarmStatus => ({ state: "running", phase: pg.phase, parts_done: pg.done.length, parts_total: total, schools_done: pg.schoolsDone, schools_total: schoolIds().length });

  try {
    if (pg.phase === "parts") {
      const next = head.parts.filter((p) => !pg.done.includes(p.part_id)).slice(0, PARTS_PER_STEP);
      for (const pin of next) {
        const text = await verifiedText(await src.readSnapshotPart(caller, head.snapshot_id, pin.part_id), pin);
        const body = parseLossless(text) as Obj;
        if (body.format !== "jungsi.history-snapshot/v1" || body.part_id !== pin.part_id || body.payload_id !== pin.payload_id || !Array.isArray(body.rows)) throw new Error(`p1_part_invalid ${pin.part_id}`);
        const rows = (body.rows as Obj[]).map((r) => [String(r.university_id ?? ""), compact(r)] as const);
        const mapped = rows.filter(([, r]) => r.pk !== null).length;
        if (rows.length !== pin.rows || mapped !== pin.mapped_rows || rows.length - mapped !== pin.mapping_pending_rows) throw new Error(`p1_part_counts_mismatch ${pin.part_id}`);
        const bySchool: Record<string, Row[]> = {};
        for (const [u, r] of rows) {
          if (!/^[A-Za-z0-9._:-]{1,64}$/.test(u)) throw new Error(`p1_part_invalid ${pin.part_id}`);
          (bySchool[u] ??= []).push(r);
        }
        await putJson(`${P}:frag:${pin.part_id}`, bySchool);
        for (const u of Object.keys(bySchool)) (pg.schoolParts[u] ??= []).push(pin.part_id);
        pg.done.push(pin.part_id);
        await putJson(`${P}:warm`, pg);
      }
      if (pg.done.length === total) {
        pg.phase = "schools";
        await putJson(`${P}:warm`, pg);
      }
      return status();
    }

    if (pg.phase === "schools") {
      const ids = schoolIds();
      const batch = ids.slice(pg.schoolsDone, pg.schoolsDone + SCHOOLS_PER_STEP);
      const frags = new Map<string, Record<string, Row[]>>();
      for (const u of batch) {
        const rows: Row[] = [];
        for (const part of pg.schoolParts[u]) {
          if (!frags.has(part)) frags.set(part, (await getJson<Record<string, Row[]>>(`${P}:frag:${part}`)) ?? {});
          rows.push(...(frags.get(part)![u] ?? []));
        }
        await putJson(`${P}:school:${u}`, rows);
      }
      pg.schoolsDone += batch.length;
      if (pg.schoolsDone >= ids.length) pg.phase = "index";
      await putJson(`${P}:warm`, pg);
      return status();
    }

    if (pg.phase === "index") {
      const ids = schoolIds();
      const schools: School[] = [];
      const units: Index["units"] = [];
      let rowsTotal = 0;
      let pendingTotal = 0;
      for (const u of ids) {
        const rows = (await getJson<Row[]>(`${P}:school:${u}`)) ?? [];
        rowsTotal += rows.length;
        const latest = [...rows].sort((a, b) => b.y - a.y);
        const names = [...new Set(latest.map((r) => r.n))];
        const regions = [...new Set(rows.map((r) => r.rg).filter((x): x is string => !!x))];
        const by = new Map<string, Row[]>();
        for (const r of rows) by.set(unitKey(r), [...(by.get(unitKey(r)) ?? []), r]);
        const si = schools.length;
        let pending = 0;
        for (const [k, rs] of by) {
          if (k.startsWith("ob:")) pending++;
          const uniq = (f: (r: Row) => string | null) => [...new Set(rs.map(f).filter((x): x is string => !!x))].join("\n");
          units.push([si, k, uniq((r) => r.d), uniq((r) => r.g), uniq((r) => r.rg), uniq((r) => r.n)]);
        }
        pendingTotal += pending;
        schools.push({ id: u, name: names[0] ?? u, names, region: regions.length === 1 ? regions[0] : regions.join("·") || null, units: by.size - pending, pending });
      }
      if (rowsTotal !== head.counts.rows || ids.length !== head.counts.schools) throw new Error("p1_totals_mismatch");
      const pendingRows = head.counts.mapping_pending_rows;
      if (pendingTotal !== pendingRows) throw new Error("p1_pending_mismatch");
      schools.sort((a, b) => a.name.localeCompare(b.name, "ko"));
      // 학교 순번을 정렬 뒤 순서로 다시 맞춘다
      const order = new Map(schools.map((s, i) => [s.id, i]));
      const fixed = units.map(([si, ...rest]) => [order.get(ids[si])!, ...rest] as Index["units"][number]);
      await putJson(`${P}:index`, { schools, units: fixed } satisfies Index);
      const ready: Ready = {
        snapshot_id: head.snapshot_id,
        publication_sha256: head.publication_sha256,
        source_head_sha256: head.source_head_sha256,
        normalization_rules_version: head.normalization_rules_version,
        selection_rules_version: head.selection_rules_version,
        generated_at: head.generated_at,
        source_as_of: head.source_as_of,
        expires_at: head.expires_at,
        counts: head.counts,
        warmed_at: new Date().toISOString(),
        pub,
      };
      pg.phase = "ready";
      await putJson(`${P}:warm`, pg);
      await putJson(READY_KEY, ready); // 모든 확인이 끝난 뒤 마지막에 쓴다
      await putJson(CHECK_KEY, { at: Date.now(), snapshot_id: ready.snapshot_id, publication_sha256: ready.publication_sha256 });
      memReady = null;
      return { state: "ready", ready };
    }
    return status();
  } catch (e) {
    if (e instanceof SnapshotChanged) {
      await putJson(`${P}:warm`, null);
      return { state: "changed" };
    }
    throw e;
  }
}

/** 관리 화면 표시용: 저장된 ready 표지와 진행 상태(요청 없음) */
export async function warmInfo(): Promise<{ ready: Ready | null }> {
  return { ready: await getJson<Ready>(READY_KEY) };
}

/* ── 조회(회원) ── */

let memReady: { at: number; v: Ready | null } | null = null;
const memIndex = new Map<string, Index>();
const memSchool = new Map<string, Row[]>();

export type Current = { state: "ready"; ready: Ready } | { state: "none" | "changed" | "expired" };

/**
 * 지금 보여 줄 수 있는 정리본. 회원 확인은 호출한 쪽이 먼저 끝낸다. 10분이 지났으면 이 회원의 인증으로 head 를
 * 한 번 확인한다(실패는 그대로 올린다 — 확인 못 한 상태를 성공으로 바꾸지 않는다)
 */
export async function currentSnapshot(src: JungsiSource, caller: Caller): Promise<Current> {
  const now = Date.now();
  if (!memReady || now - memReady.at > 30_000) memReady = { at: now, v: await getJson<Ready>(READY_KEY) };
  const ready = memReady.v;
  if (!ready) return { state: "none" };
  if (Date.parse(ready.expires_at) <= now) return { state: "expired" };
  const checked = await getJson<{ at: number; snapshot_id: string; publication_sha256: string }>(CHECK_KEY);
  if (!checked || now - checked.at > HEAD_CHECK_MS || checked.snapshot_id !== ready.snapshot_id) {
    const head = await src.readSnapshotHead(caller);
    await putJson(CHECK_KEY, { at: now, snapshot_id: head.snapshot_id, publication_sha256: head.publication_sha256 });
    if (head.snapshot_id !== ready.snapshot_id || head.publication_sha256 !== ready.publication_sha256 || (await pubKeyOf(head)) !== ready.pub) return { state: "changed" };
  } else if (checked.publication_sha256 !== ready.publication_sha256) return { state: "changed" };
  return { state: "ready", ready };
}

async function index(ready: Ready): Promise<Index> {
  let ix = memIndex.get(ready.pub);
  if (!ix) {
    ix = (await getJson<Index>(`${ROOT}:${ready.pub}:index`)) ?? undefined;
    if (!ix) throw new ConnectionError("unavailable", "p1_snapshot_index_missing");
    memIndex.clear();
    memIndex.set(ready.pub, ix);
  }
  return ix;
}
async function school(ready: Ready, id: string): Promise<Row[]> {
  const k = `${ready.pub}:${id}`;
  let rows = memSchool.get(k);
  if (!rows) {
    rows = (await getJson<Row[]>(`${ROOT}:${ready.pub}:school:${id}`)) ?? undefined;
    if (!rows) throw new ConnectionError("unavailable", "p1_snapshot_school_missing");
    if (memSchool.size >= 120) memSchool.delete(memSchool.keys().next().value as string);
    memSchool.set(k, rows);
  }
  return rows;
}

export const PAGE_SCHOOLS = 20;
const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, "").toLowerCase();

export type SearchResult = {
  total_schools: number;
  total_units: number;
  total_pending: number;
  page: number;
  pages: number;
  schools: { school: School; rows: Row[]; keys: Set<string> }[];
};

/** 학교·학과·지역·군 조건으로 색인을 거른 뒤 그 쪽의 대학 20곳 묶음만 읽는다 */
export async function searchSnapshot(ready: Ready, q: { university?: string; unit?: string; region?: string; group?: string; page?: number }): Promise<SearchResult> {
  const ix = await index(ready);
  const uq = q.university ? norm(q.university) : "";
  const dq = q.unit ? norm(q.unit) : "";
  const schoolHit = ix.schools.map((s) => !uq || s.names.some((n) => norm(n).includes(uq)));
  const matched = new Map<number, Set<string>>();
  let units = 0;
  let pending = 0;
  for (const [si, key, deps, groups, regions, names] of ix.units) {
    if (!schoolHit[si] && !(uq && names.split("\n").some((n) => norm(n).includes(uq)))) continue;
    if (dq && !deps.split("\n").some((d) => norm(d).includes(dq))) continue;
    if (q.group && !groups.split("\n").includes(q.group)) continue;
    if (q.region && !regions.split("\n").includes(q.region)) continue;
    let set = matched.get(si);
    if (!set) matched.set(si, (set = new Set()));
    set.add(key);
    if (key.startsWith("ob:")) pending++;
    else units++;
  }
  const order = [...matched.keys()].sort((a, b) => a - b);
  const pages = Math.max(1, Math.ceil(order.length / PAGE_SCHOOLS));
  const page = Math.min(Math.max(1, q.page ?? 1), pages);
  const slice = order.slice((page - 1) * PAGE_SCHOOLS, page * PAGE_SCHOOLS);
  const schools = await Promise.all(
    slice.map(async (si) => {
      const s = ix.schools[si];
      const keys = matched.get(si)!;
      const rows = (await school(ready, s.id)).filter((r) => keys.has(unitKey(r)));
      return { school: s, rows, keys };
    }),
  );
  return { total_schools: order.length, total_units: units, total_pending: pending, page, pages, schools };
}

/** 펼친 모집단위 하나의 행(학교 묶음에서 그 단위만) */
export async function unitRows(ready: Ready, schoolId: string, key: string): Promise<Row[]> {
  return (await school(ready, schoolId)).filter((r) => unitKey(r) === key);
}
