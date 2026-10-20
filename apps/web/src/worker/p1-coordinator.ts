/** Native Cloudflare Durable Object (fetch API). Source registration only; no resource is created here.
 * SQLite is private coordinator storage, not Workers KV or the admissions database.
 * There is no network fetch, caller identity, credential, or cross-request promise in this object.
 */
import {
  P1CoordinationCore, P1CoordinationError, coordinatorState, coordinationError, dispatchP1Command,
  type CoordinationStore, type CoordinatorState,
} from "../lib/p1-coordinator-core";

export type P1SqlCursor = { toArray(): Record<string, unknown>[] };
export type P1SqlStorage = { exec(sql: string, ...bindings: (string | number)[]): P1SqlCursor };
export type P1ObjectState = { storage: { sql: P1SqlStorage; transactionSync<T>(work: () => T): T } };
const TABLE = "p1_coordinator_state";
class SqliteCoordinationStore implements CoordinationStore {
  private readonly ctx: P1ObjectState;
  constructor(ctx: P1ObjectState) {
    this.ctx = ctx;
    // Synchronous initialization only. Never blockConcurrencyWhile around external I/O.
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)`);
  }
  private encoded(): string | null {
    const rows = this.ctx.storage.sql.exec(`SELECT body FROM ${TABLE} WHERE id=1`).toArray();
    if (rows.length > 1 || rows.length === 1 && typeof rows[0].body !== "string") coordinationError("p1_coordinator_state_invalid");
    return rows.length ? rows[0].body as string : null;
  }
  private decode(raw: string | null): CoordinatorState | null {
    if (raw === null) return null;
    try { return coordinatorState(JSON.parse(raw) as CoordinatorState); }
    catch { return coordinationError("p1_coordinator_state_invalid"); }
  }
  read(): CoordinatorState | null { return this.decode(this.encoded()); }
  atomic<T>(change: (current: CoordinatorState | null) => { state: CoordinatorState; result: T }): T {
    return this.ctx.storage.transactionSync(() => {
      const before = this.encoded(), next = change(this.decode(before));
      const encoded = JSON.stringify(coordinatorState(next.state));
      if (encoded !== before) this.ctx.storage.sql.exec(`INSERT INTO ${TABLE}(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`, encoded);
      return next.result;
    });
  }
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader(); if (!reader) coordinationError("p1_coordinator_request_invalid");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > 262144) { await reader.cancel(); coordinationError("p1_coordinator_request_too_large"); }
      parts.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) coordinationError("p1_coordinator_request_invalid");
  return value;
}
export class P1SnapshotCoordinator {
  private readonly core: P1CoordinationCore;
  constructor(ctx: P1ObjectState, _env?: unknown) { void _env; this.core = new P1CoordinationCore(new SqliteCoordinationStore(ctx)); }
  async fetch(request: Request): Promise<Response> {
    const headers = { "Cache-Control": "no-store" };
    try {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/command") coordinationError("p1_coordinator_request_invalid");
      const result = await dispatchP1Command(this.core, await body(request));
      return Response.json({ result }, { headers });
    } catch (error) {
      const code = error instanceof P1CoordinationError ? error.code : "p1_coordinator_unavailable";
      return Response.json({ error: { code } }, { status: code === "p1_coordinator_unavailable" || code === "p1_coordinator_state_invalid" ? 503 : 409, headers });
    }
  }
}
