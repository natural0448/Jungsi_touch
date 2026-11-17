/** Server application coordination only. No caller, credential, private score or I/O promise is retained.
 * The store must serialize atomic() using native Durable Object SQLite transactions.
 * BFF authorization remains mandatory before every call. Binding absence is an error, never memory fallback.
 */
import type { SnapshotHeadDto } from "./dto";

export type PublicDocument = Record<string, unknown>;
export type CoordinationKind = "head" | "warm";
export type CoordinationToken = {
  kind: CoordinationKind; fence: number; nonce: string; expiresAt: number;
  generation: string | null; publication: string | null; step: number;
  writePrefix: string | null;
};
type Receipt = { fence: number; nonce: string; digest: string };
type Warm = {
  publication: string; generation: string; step: number; progress: PublicDocument | null;
  lease: CoordinationToken | null; receipts: Receipt[];
};
export type CoordinatorState = {
  format: "jungsi.p1-coordination/v1"; fence: number; headRevision: number;
  head: SnapshotHeadDto | null; checkedAt: number | null; headLease: CoordinationToken | null;
  headReceipt: Receipt | null; warm: Warm | null;
  ready: { value: PublicDocument; generation: string; step: number } | null;
  /** 관리자 '정리본 다시 만들기'(2026-11-16): 같은 판을 다시 만드는 동안 1페이지가 계속 쓰는 이전 준비본. 없을 수 있다 */
  standby?: PublicDocument | null;
};
export interface CoordinationStore {
  read(): CoordinatorState | null;
  atomic<T>(change: (current: CoordinatorState | null) => { state: CoordinatorState; result: T }): T;
}
export type CoordinationView = {
  head: SnapshotHeadDto | null; headRevision: number; headFresh: boolean;
  checking: boolean; warming: boolean; nextRetryAt: number | null;
  generation: string | null; step: number; progress: PublicDocument | null;
  ready: PublicDocument | null;
};
export type HeadClaim = { state: "cached"; view: CoordinationView } |
  { state: "busy"; view: CoordinationView } |
  { state: "claimed"; token: CoordinationToken; view: CoordinationView };
export type WarmClaim = { state: "ready"; view: CoordinationView } |
  { state: "busy"; view: CoordinationView } |
  { state: "claimed"; token: CoordinationToken; view: CoordinationView };
export type CommitResult = { replayed: boolean; view: CoordinationView };
export class P1CoordinationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const MAX_MIN_FRESH_MS = 300000;
const forbidden = new Set(["authorization", "accesstoken", "refreshtoken", "cookie", "caller", "scores", "reportid", "cursor", "subjectid", "session", "jwt", "secret", "userid", "ownerid", "role", "roles", "permission", "permissions", "capabilities", "entitlement", "entitlements", "claims", "aal", "paidpassid", "paiduntil", "__proto__", "prototype", "constructor"]);
export function coordinationError(code: string): never { throw new P1CoordinationError(code); }
function integer(v: unknown, low = 0): v is number { return Number.isSafeInteger(v) && Number(v) >= low; }
function safeValue(v: unknown, depth = 0): void {
  if (depth > 32) coordinationError("p1_coordinator_metadata_invalid");
  if (v === null || typeof v === "boolean") return;
  if (typeof v === "number") { if (!integer(v)) coordinationError("p1_coordinator_metadata_invalid"); return; }
  if (typeof v === "string") {
    if (v.length > 131072 || /^Bearer\s/i.test(v) || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(v) || /^sb_secret_/.test(v)) coordinationError("p1_coordinator_private_value");
    return;
  }
  if (!v || typeof v !== "object") coordinationError("p1_coordinator_metadata_invalid");
  if (Array.isArray(v)) {
    if (v.length > 4096) coordinationError("p1_coordinator_metadata_invalid");
    for (const x of v) safeValue(x, depth + 1);
  } else {
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) coordinationError("p1_coordinator_metadata_invalid");
    for (const [k, x] of Object.entries(v)) {
      if (forbidden.has(k.toLowerCase().replace(/[_-]/g, "")) || ["__proto__", "prototype", "constructor"].includes(k)) coordinationError("p1_coordinator_private_value");
      safeValue(x, depth + 1);
    }
  }
}
export function publicDocument(v: unknown): PublicDocument {
  if (!v || typeof v !== "object" || Array.isArray(v)) coordinationError("p1_coordinator_metadata_invalid");
  safeValue(v);
  if (new TextEncoder().encode(JSON.stringify(v)).length > 131072) coordinationError("p1_coordinator_metadata_too_large");
  return structuredClone(v) as PublicDocument;
}
/** 2027 부분 발행 표시. schema v2 에서만, 정확한 5키, 포함+제외+검토 중 = 원천 행, 포함·검토 중은 1 이상(서버 index v2 규칙) */
export function r27Coverage(value: unknown, schemaVersion: unknown): boolean {
  if (schemaVersion !== "jungsi.history-snapshot/v2" || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>, counts = ["source_rows", "included_rows", "excluded_rows", "review_pending_rows"];
  return Object.keys(c).length === 5 && c.status === "partial" && counts.every(k => integer(c[k])) &&
    Number(c.included_rows) >= 1 && Number(c.review_pending_rows) >= 1 &&
    Number(c.included_rows) + Number(c.excluded_rows) + Number(c.review_pending_rows) === Number(c.source_rows);
}
export function validatePublicHead(value: unknown, now: number): SnapshotHeadDto {
  const h = publicDocument(value);
  const keys = ["format", "status", "snapshot_id", "publication_sha256", "source_head_sha256", "generated_at", "source_as_of", "schema_version", "normalization_rules_version", "selection_rules_version", "counts", "delivery_mode", "full", "parts", "expires_at"];
  if (Object.keys(h).some(k => !keys.includes(k) && k !== "r27_scope_coverage") || keys.some(k => !(k in h)) ||
      ("r27_scope_coverage" in h && !r27Coverage(h.r27_scope_coverage, h.schema_version)) ||
      h.format !== "jungsi.history-snapshot-head/v1" || h.status !== "approved" ||
      typeof h.snapshot_id !== "string" || !ID.test(h.snapshot_id) ||
      typeof h.publication_sha256 !== "string" || !HASH.test(h.publication_sha256) ||
      typeof h.source_head_sha256 !== "string" || !HASH.test(h.source_head_sha256) ||
      ["schema_version", "normalization_rules_version", "selection_rules_version"].some(k => typeof h[k] !== "string" || !(h[k] as string).length || (h[k] as string).length > 128 || /[\u0000-\u001f\u007f]/.test(h[k] as string)) ||
      typeof h.generated_at !== "string" || !Number.isFinite(Date.parse(h.generated_at)) ||
      !(h.source_as_of === null || typeof h.source_as_of === "string" && Number.isFinite(Date.parse(h.source_as_of))) ||
      typeof h.expires_at !== "string" || !Number.isFinite(Date.parse(h.expires_at)) || Date.parse(h.expires_at) <= now ||
      h.delivery_mode !== "parts" || h.full !== null || !Array.isArray(h.parts) || h.parts.length < 1 || h.parts.length > 256) coordinationError("p1_head_invalid");
  const c = publicDocument(h.counts), allowedCounts = ["rows", "mapped_rows", "mapping_pending_rows", "schools", "observations"];
  if (Object.keys(c).some(k => !allowedCounts.includes(k)) || ["rows", "mapped_rows", "mapping_pending_rows", "schools"].some(k => !integer(c[k])) || (c.observations !== undefined && !integer(c.observations)) || Number(c.rows) !== Number(c.mapped_rows) + Number(c.mapping_pending_rows)) coordinationError("p1_head_invalid");
  const seen = new Set<string>(); let rows = 0, mapped = 0, pending = 0;
  const partKeys = ["part_id", "payload_id", "gzip_bytes", "gzip_sha256", "decoded_bytes", "decoded_sha256", "rows", "mapped_rows", "mapping_pending_rows"];
  for (const value of h.parts) {
    const p = publicDocument(value);
    if (Object.keys(p).some(k => !partKeys.includes(k)) || partKeys.some(k => !(k in p)) ||
        typeof p.part_id !== "string" || !ID.test(p.part_id) || seen.has(p.part_id) || typeof p.payload_id !== "string" || !ID.test(p.payload_id) ||
        ["gzip_sha256", "decoded_sha256"].some(k => typeof p[k] !== "string" || !HASH.test(p[k] as string)) ||
        ["gzip_bytes", "decoded_bytes", "rows"].some(k => !integer(p[k], 1)) ||
        ["mapped_rows", "mapping_pending_rows"].some(k => !integer(p[k])) || Number(p.rows) !== Number(p.mapped_rows) + Number(p.mapping_pending_rows)) coordinationError("p1_head_invalid");
    seen.add(p.part_id); rows += Number(p.rows); mapped += Number(p.mapped_rows); pending += Number(p.mapping_pending_rows);
  }
  if (rows !== c.rows || mapped !== c.mapped_rows || pending !== c.mapping_pending_rows) coordinationError("p1_head_invalid");
  return h as unknown as SnapshotHeadDto;
}
function initial(): CoordinatorState {
  return { format: "jungsi.p1-coordination/v1", fence: 0, headRevision: 0, head: null, checkedAt: null, headLease: null, headReceipt: null, warm: null, ready: null };
}
export function coordinatorState(raw: CoordinatorState | null): CoordinatorState {
  if (raw === null) return initial();
  const keys = ["format", "fence", "headRevision", "head", "checkedAt", "headLease", "headReceipt", "warm", "ready"];
  if (!raw || raw.format !== "jungsi.p1-coordination/v1" || !integer(raw.fence) || !integer(raw.headRevision) ||
      Object.keys(raw).some(k => !keys.includes(k) && k !== "standby") || keys.some(k => !(k in raw)) ||
      !(raw.checkedAt === null || integer(raw.checkedAt)) ||
      new TextEncoder().encode(JSON.stringify(raw)).length > 524288) coordinationError("p1_coordinator_state_invalid");
  safeValue(raw);
  if (raw.head !== null) validatePublicHead(raw.head, 0);
  if (raw.head === null && raw.checkedAt !== null) coordinationError("p1_coordinator_state_invalid");
  const receipt = (r: Receipt) => {
    if (!r || Object.keys(r).length !== 3 || !integer(r.fence, 1) || r.fence > raw.fence || typeof r.nonce !== "string" || !ID.test(r.nonce) || typeof r.digest !== "string" || !HASH.test(r.digest)) coordinationError("p1_coordinator_state_invalid");
  };
  if (raw.headReceipt !== null) receipt(raw.headReceipt);
  if (raw.headLease !== null && (commandToken(raw.headLease).kind !== "head" || raw.headLease.fence > raw.fence)) coordinationError("p1_coordinator_state_invalid");
  if (raw.warm !== null) {
    const w = raw.warm;
    if (!w || !ID.test(w.generation) || !HASH.test(w.publication) || !integer(w.step) || !Array.isArray(w.receipts) || w.receipts.length > 256 || !raw.head || w.publication !== raw.head.publication_sha256) coordinationError("p1_coordinator_state_invalid");
    if (w.progress !== null) publicDocument(w.progress);
    w.receipts.forEach(receipt);
    if (w.lease !== null && (commandToken(w.lease).kind !== "warm" || w.lease.fence > raw.fence || w.lease.generation !== w.generation || w.lease.step !== w.step)) coordinationError("p1_coordinator_state_invalid");
  }
  if (raw.ready !== null) {
    if (!raw.warm || raw.ready.generation !== raw.warm.generation || !integer(raw.ready.step, 1) || raw.ready.step !== raw.warm.step) coordinationError("p1_coordinator_state_invalid");
    publicDocument(raw.ready.value);
  }
  if (raw.standby !== undefined && raw.standby !== null) {
    publicDocument(raw.standby);
    if (!raw.head || raw.standby.publication_sha256 !== raw.head.publication_sha256) coordinationError("p1_coordinator_state_invalid");
  }
  return structuredClone(raw);
}
const sameToken = (a: CoordinationToken | null, b: CoordinationToken) => a !== null && JSON.stringify(a) === JSON.stringify(b);
const sameReceipt = (r: Receipt, t: CoordinationToken) => r.fence === t.fence && r.nonce === t.nonce;
export class P1CoordinationCore {
  private readonly store: CoordinationStore;
  private readonly clock: () => number;
  private readonly nonce: () => string;
  constructor(store: CoordinationStore, clock: () => number = Date.now, nonce: () => string = () => crypto.randomUUID()) {
    this.store = store; this.clock = clock; this.nonce = nonce;
  }
  private now(): number { const now = this.clock(); if (!integer(now)) coordinationError("p1_coordinator_clock_invalid"); return now; }
  /** margin: a cached check must stay fresh this much longer. Warm steps pass one so a step started near the 10-minute edge does not lapse mid-step (11-06 seq18). */
  private fresh(s: CoordinatorState, now: number, margin = 0): boolean {
    return s.head !== null && s.checkedAt !== null && now >= s.checkedAt && now - s.checkedAt < 600000 - margin && Date.parse(s.head.expires_at) > now + margin;
  }
  private view(s: CoordinatorState, now: number): CoordinationView {
    const fresh = this.fresh(s, now), headLease = s.headLease && s.headLease.expiresAt > now, warmLease = s.warm?.lease && s.warm.lease.expiresAt > now;
    return structuredClone({ head: s.head, headRevision: s.headRevision, headFresh: fresh, checking: !!headLease, warming: !!warmLease,
      nextRetryAt: headLease ? s.headLease!.expiresAt : warmLease ? s.warm!.lease!.expiresAt : null,
      generation: s.warm?.generation ?? null, step: s.warm?.step ?? 0, progress: s.warm?.progress ?? null,
      ready: fresh && s.ready && s.ready.value.publication_sha256 === s.head!.publication_sha256 ? s.ready.value
        : fresh && !s.ready && s.standby && s.standby.publication_sha256 === s.head!.publication_sha256 ? s.standby : null });
  }
  private token(s: CoordinatorState, kind: CoordinationKind, now: number, generation: string | null, step: number): CoordinationToken {
    if (!integer(s.fence + 1, 1)) coordinationError("p1_coordinator_fence_exhausted");
    const nonce = this.nonce(); if (!ID.test(nonce)) coordinationError("p1_coordinator_nonce_invalid");
    s.fence++;
    return { kind, fence: s.fence, nonce, expiresAt: now + (kind === "head" ? 30000 : 120000), generation,
      publication: s.head?.publication_sha256 ?? null, step,
      writePrefix: kind === "warm" ? `p1c:v1:${generation}:f${s.fence}:${nonce}` : null };
  }
  inspect(): CoordinationView { return this.view(coordinatorState(this.store.read()), this.now()); }
  /** 표시 전용(3페이지 연도별 근거). 10분 머리 확인이 지났어도 만료 전이고 머리와 같은 판인 준비본을 읽기만 한다. 상태는 바꾸지 않는다(11-17). */
  peek(): CoordinationView {
    const s = coordinatorState(this.store.read()), now = this.now(), v = this.view(s, now);
    if (!v.ready && s.head && s.ready && s.ready.value.publication_sha256 === s.head.publication_sha256 && Date.parse(s.head.expires_at) > now)
      v.ready = structuredClone(s.ready.value);
    return v;
  }
  claimHead(afterRevision?: number, minFreshMs = 0): HeadClaim {
    const now = this.now();
    return this.store.atomic<HeadClaim>(raw => {
      const s = coordinatorState(raw);
      if (afterRevision !== undefined && (!integer(afterRevision) || afterRevision > s.headRevision)) coordinationError("p1_coordinator_revision_invalid");
      if (!integer(minFreshMs) || minFreshMs > MAX_MIN_FRESH_MS) coordinationError("p1_coordinator_request_invalid");
      if (this.fresh(s, now, minFreshMs) && (afterRevision === undefined || s.headRevision > afterRevision)) return { state: s, result: { state: "cached", view: this.view(s, now) } };
      if (s.headLease && s.headLease.expiresAt > now) return { state: s, result: { state: "busy", view: this.view(s, now) } };
      s.headLease = this.token(s, "head", now, null, s.headRevision);
      return { state: s, result: { state: "claimed", token: s.headLease, view: this.view(s, now) } };
    });
  }
  commitHead(token: CoordinationToken, head: unknown, digest: string): CommitResult {
    const now = this.now(), next = validatePublicHead(head, now);
    if (!HASH.test(digest)) coordinationError("p1_coordinator_digest_invalid");
    return this.store.atomic<CommitResult>(raw => {
      const s = coordinatorState(raw);
      if (s.headReceipt && sameReceipt(s.headReceipt, token)) {
        if (s.headReceipt.digest !== digest) coordinationError("p1_coordinator_replay_conflict");
        return { state: s, result: { replayed: true, view: this.view(s, now) } };
      }
      if (token.kind !== "head" || !sameToken(s.headLease, token) || token.expiresAt <= now) coordinationError("p1_coordinator_fence_stale");
      // Every approved public pin is immutable for a ready generation, including rules and counts.
      const changed = canonical(s.head) !== canonical(next);
      s.head = next; s.checkedAt = now; s.headRevision++; s.headLease = null;
      s.headReceipt = { fence: token.fence, nonce: token.nonce, digest };
      // 대기본 칸은 비면 지운다: 옛 코드로 되돌려도 저장 형식이 그대로 읽히게
      if (changed) { s.warm = null; s.ready = null; delete s.standby; }
      return { state: s, result: { replayed: false, view: this.view(s, now) } };
    });
  }
  failHead(token: CoordinationToken): CoordinationView {
    const now = this.now();
    return this.store.atomic(raw => {
      const s = coordinatorState(raw);
      if (sameToken(s.headLease, token)) s.headLease = null;
      return { state: s, result: this.view(s, now) };
    });
  }
  claimWarm(publication: string): WarmClaim {
    const now = this.now();
    return this.store.atomic<WarmClaim>(raw => {
      const s = coordinatorState(raw);
      if (!this.fresh(s, now)) coordinationError("p1_head_check_required");
      if (publication !== s.head!.publication_sha256) coordinationError("p1_publication_changed");
      if (s.ready) return { state: s, result: { state: "ready", view: this.view(s, now) } };
      if (s.warm?.lease && s.warm.lease.expiresAt > now) return { state: s, result: { state: "busy", view: this.view(s, now) } };
      if (!s.warm) {
        const generation = this.nonce(); if (!ID.test(generation)) coordinationError("p1_coordinator_nonce_invalid");
        s.warm = { publication, generation, step: 0, progress: null, lease: null, receipts: [] };
      }
      s.warm.lease = this.token(s, "warm", now, s.warm.generation, s.warm.step);
      return { state: s, result: { state: "claimed", token: s.warm.lease, view: this.view(s, now) } };
    });
  }
  commitWarm(token: CoordinationToken, progress: unknown, ready: unknown, digest: string): CommitResult {
    const now = this.now(), document = publicDocument(progress), result = ready === null ? null : publicDocument(ready);
    if (!HASH.test(digest)) coordinationError("p1_coordinator_digest_invalid");
    return this.store.atomic<CommitResult>(raw => {
      const s = coordinatorState(raw), w = s.warm;
      if (!w || w.generation !== token.generation) coordinationError("p1_coordinator_fence_stale");
      const receipt = w.receipts.find(r => sameReceipt(r, token));
      if (receipt) {
        if (receipt.digest !== digest) coordinationError("p1_coordinator_replay_conflict");
        return { state: s, result: { replayed: true, view: this.view(s, now) } };
      }
      if (!this.fresh(s, now)) coordinationError("p1_head_check_required");
      if (token.kind !== "warm" || !sameToken(w.lease, token) || token.expiresAt <= now || token.step !== w.step || token.publication !== s.head!.publication_sha256) coordinationError("p1_coordinator_fence_stale");
      if (result && (result.snapshot_id !== s.head!.snapshot_id || result.publication_sha256 !== s.head!.publication_sha256 || result.source_head_sha256 !== s.head!.source_head_sha256 ||
          result.normalization_rules_version !== s.head!.normalization_rules_version || result.selection_rules_version !== s.head!.selection_rules_version ||
          result.generated_at !== s.head!.generated_at || result.source_as_of !== s.head!.source_as_of ||
          canonical(result.counts) !== canonical(s.head!.counts) || result.expires_at !== s.head!.expires_at ||
          typeof result.index_key !== "string" || !result.index_key.startsWith(token.writePrefix! + ":"))) coordinationError("p1_coordinator_ready_invalid");
      if (w.receipts.length >= 256) coordinationError("p1_coordinator_step_limit");
      w.progress = document; w.step++; w.lease = null; w.receipts.push({ fence: token.fence, nonce: token.nonce, digest });
      if (result) { s.ready = { value: result, generation: w.generation, step: w.step }; delete s.standby; }
      return { state: s, result: { replayed: false, view: this.view(s, now) } };
    });
  }
  /**
   * 관리자 '정리본 다시 만들기'(2026-11-16). 같은 판의 준비본을 대기본으로 옮기고 새 세대로 처음부터 다시 만든다.
   * 새 준비본이 올라오기 전까지 1페이지는 대기본을 그대로 쓴다. 판이 바뀌면 대기본도 지운다(commitHead).
   * 진행 중인 준비가 있으면 건드리지 않는다.
   */
  rebuildWarm(publication: string): CoordinationView {
    const now = this.now();
    return this.store.atomic(raw => {
      const s = coordinatorState(raw);
      if (!this.fresh(s, now)) coordinationError("p1_head_check_required");
      if (publication !== s.head!.publication_sha256) coordinationError("p1_publication_changed");
      if (s.warm?.lease && s.warm.lease.expiresAt > now) coordinationError("p1_rebuild_busy");
      if (!s.ready) return { state: s, result: this.view(s, now) };
      s.standby = s.ready.value; s.ready = null; s.warm = null;
      return { state: s, result: this.view(s, now) };
    });
  }
  failWarm(token: CoordinationToken): CoordinationView {
    const now = this.now();
    return this.store.atomic(raw => {
      const s = coordinatorState(raw);
      if (s.warm && sameToken(s.warm.lease, token)) s.warm.lease = null;
      return { state: s, result: this.view(s, now) };
    });
  }
}

export type CoordinatorCommand =
  | { op: "inspect" }
  | { op: "peek" }
  | { op: "claimHead"; afterRevision?: number; minFreshMs?: number }
  | { op: "commitHead"; token: CoordinationToken; head: SnapshotHeadDto }
  | { op: "failHead"; token: CoordinationToken }
  | { op: "claimWarm"; publication: string }
  | { op: "commitWarm"; token: CoordinationToken; progress: PublicDocument; ready: PublicDocument | null }
  | { op: "failWarm"; token: CoordinationToken }
  | { op: "rebuildWarm"; publication: string };
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
}
async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
function commandToken(value: unknown): CoordinationToken {
  if (!value || typeof value !== "object" || Array.isArray(value)) coordinationError("p1_coordinator_request_invalid");
  const t = value as Record<string, unknown>, keys = ["kind", "fence", "nonce", "expiresAt", "generation", "publication", "step", "writePrefix"];
  if (Object.keys(t).some(k => !keys.includes(k)) || keys.some(k => !(k in t)) ||
      !["head", "warm"].includes(String(t.kind)) || !integer(t.fence, 1) ||
      typeof t.nonce !== "string" || !ID.test(t.nonce) || !integer(t.expiresAt) || !integer(t.step) ||
      ![t.generation, t.publication, t.writePrefix].every(v => v === null || typeof v === "string")) coordinationError("p1_coordinator_request_invalid");
  if (t.publication !== null && !HASH.test(t.publication as string) ||
      t.kind === "head" && (t.generation !== null || t.writePrefix !== null) ||
      t.kind === "warm" && (typeof t.generation !== "string" || !ID.test(t.generation) || t.publication === null ||
        t.writePrefix !== `p1c:v1:${t.generation}:f${t.fence}:${t.nonce}`)) coordinationError("p1_coordinator_request_invalid");
  return { kind: t.kind as CoordinationKind, fence: Number(t.fence), nonce: t.nonce,
    expiresAt: Number(t.expiresAt), generation: t.generation as string | null, publication: t.publication as string | null,
    step: Number(t.step), writePrefix: t.writePrefix as string | null };
}
/** Shared production/dev/test command path. SHA work happens BEFORE the short store transaction.
 * No callback or request-scoped promise is stored. BFF still authenticates every invocation.
 */
export async function dispatchP1Command(core: P1CoordinationCore, command: unknown): Promise<unknown> {
  if (!command || typeof command !== "object" || Array.isArray(command)) coordinationError("p1_coordinator_request_invalid");
  const b = command as Record<string, unknown>, op = b.op;
  const fields: Record<string, string[]> = { inspect: ["op"], peek: ["op"], claimHead: ["op", "afterRevision", "minFreshMs"], commitHead: ["op", "token", "head"], failHead: ["op", "token"], claimWarm: ["op", "publication"], commitWarm: ["op", "token", "progress", "ready"], failWarm: ["op", "token"], rebuildWarm: ["op", "publication"] };
  if (typeof op !== "string" || !Object.hasOwn(fields, op) || Object.keys(b).some(k => !fields[op].includes(k)) || fields[op].some(k => k !== "afterRevision" && k !== "minFreshMs" && !(k in b))) coordinationError("p1_coordinator_request_invalid");
  switch (op) {
    case "inspect": return core.inspect();
    case "peek": return core.peek();
    case "claimHead": return core.claimHead(b.afterRevision as number | undefined, (b.minFreshMs ?? 0) as number);
    case "commitHead": return core.commitHead(commandToken(b.token), b.head, await digest(b.head));
    case "failHead": return core.failHead(commandToken(b.token));
    case "claimWarm": return core.claimWarm(b.publication as string);
    case "commitWarm": return core.commitWarm(commandToken(b.token), b.progress, b.ready, await digest({ progress: b.progress, ready: b.ready }));
    case "failWarm": return core.failWarm(commandToken(b.token));
    case "rebuildWarm":
      if (typeof b.publication !== "string" || !HASH.test(b.publication)) coordinationError("p1_coordinator_request_invalid");
      return core.rebuildWarm(b.publication);
  }
  return coordinationError("p1_coordinator_request_invalid");
}
export function localP1CoordinatorClient(core: P1CoordinationCore) {
  return p1CoordinatorClient({ fetch: async request => {
    try { return Response.json({ result: await dispatchP1Command(core, await request.json()) }); }
    catch (error) {
      const code = error instanceof P1CoordinationError ? error.code : "p1_coordinator_unavailable";
      return Response.json({ error: { code } }, { status: 409 });
    }
  } });
}
/** No requests or promises are cached. The namespace stub is a native internal binding. */
export function p1CoordinatorClient(stub: { fetch(request: Request): Promise<Response> }) {
  async function invoke<T>(command: CoordinatorCommand): Promise<T> {
    const response = await stub.fetch(new Request("https://p1-coordinator.internal/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) }));
    const body = await response.json() as { result?: T; error?: { code?: string } };
    if (!response.ok || !("result" in body)) coordinationError(body.error?.code ?? "p1_coordinator_unavailable");
    return body.result as T;
  }
  return {
    inspect: () => invoke<CoordinationView>({ op: "inspect" }),
    peek: () => invoke<CoordinationView>({ op: "peek" }),
    claimHead: (afterRevision?: number, minFreshMs?: number) => invoke<HeadClaim>({ op: "claimHead", ...(afterRevision === undefined ? {} : { afterRevision }), ...(minFreshMs === undefined ? {} : { minFreshMs }) }),
    commitHead: (token: CoordinationToken, head: SnapshotHeadDto) => invoke<CommitResult>({ op: "commitHead", token, head }),
    failHead: (token: CoordinationToken) => invoke<CoordinationView>({ op: "failHead", token }),
    claimWarm: (publication: string) => invoke<WarmClaim>({ op: "claimWarm", publication }),
    commitWarm: (token: CoordinationToken, progress: PublicDocument, ready: PublicDocument | null = null) => invoke<CommitResult>({ op: "commitWarm", token, progress, ready }),
    failWarm: (token: CoordinationToken) => invoke<CoordinationView>({ op: "failWarm", token }),
    rebuildWarm: (publication: string) => invoke<CoordinationView>({ op: "rebuildWarm", publication }),
  };
}
