/** Shared atomic usage reservations. Requires separately adopted prepared migration 005. */
import { AccessError } from "../application/access.ts";
import { verifyAdministratorUsageProof } from "../application/administrator_usage_policy.ts";
import { BUDGET_OPERATIONS } from "../application/request_budget.ts";
import {
  BUDGET_KINDS,
  type BudgetKind,
  type UsageBudgetStorePort,
  type UsageLease,
  type UsageReservationDecision,
  type UsageReservationRequest,
  type UsageStoreLimits,
} from "../application/usage_budget.ts";
import { nativeJsonText } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { sqlArrayText, sqlIntegerText, sqlUtcText } from "./sql_values.ts";
import { type NativeSqlTransaction, SupabaseSqlTransport } from "./transaction_sql.ts";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MICROSECOND = 1000000n;
export const USAGE_NOW_SQL =
  `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export const USAGE_VERSION_SQL =
  "SELECT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='005_usage_budget')";
export const USAGE_LOCK_SQL = "SELECT pg_advisory_xact_lock($1::bigint)";
export const USAGE_EXPIRED_SQL =
  `SELECT lease_id::text,reserved_demands::text FROM jungsi_backend.usage_budget_leases
 WHERE owner_id=$1 AND policy_version=$2 AND state='active' AND expires_at<=$3::timestamptz FOR UPDATE`;
export const USAGE_WINDOW_INSERT_SQL = `INSERT INTO jungsi_backend.usage_budget_windows
 (owner_id,policy_version,scope_key,dimension,period_seconds,window_start,window_end,capacity)
 VALUES($1,$2,$3,$4,$5::bigint,$6::timestamptz,$7::timestamptz,$8::bigint) ON CONFLICT DO NOTHING`;
export const USAGE_WINDOW_READ_SQL = `SELECT capacity::text,used_units::text,reserved_units::text,
 to_char(window_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 FROM jungsi_backend.usage_budget_windows WHERE owner_id=$1 AND policy_version=$2 AND scope_key=$3
 AND dimension=$4 AND period_seconds=$5::bigint AND window_start=$6::timestamptz FOR UPDATE`;
export const USAGE_IDENTITY_READ_SQL =
  `SELECT EXISTS(SELECT 1 FROM jungsi_backend.usage_budget_identities
 WHERE owner_id=$1 AND policy_version=$2 AND scope_key=$3 AND dimension=$4
 AND period_seconds=$5::bigint AND window_start=$6::timestamptz AND fingerprint_sha256=$7)`;
export const USAGE_WINDOW_CHANGE_SQL = `UPDATE jungsi_backend.usage_budget_windows
 SET used_units=used_units+$7::bigint,reserved_units=reserved_units+$8::bigint
 WHERE owner_id=$1 AND policy_version=$2 AND scope_key=$3 AND dimension=$4
 AND period_seconds=$5::bigint AND window_start=$6::timestamptz
 AND used_units+$7::bigint>=0 AND reserved_units+$8::bigint>=0
 AND used_units+reserved_units+$7::bigint+$8::bigint<=capacity RETURNING used_units::text`;
export const USAGE_IDENTITY_INSERT_SQL = `INSERT INTO jungsi_backend.usage_budget_identities
 (owner_id,policy_version,scope_key,dimension,period_seconds,window_start,fingerprint_sha256,created_at)
 VALUES($1,$2,$3,$4,$5::bigint,$6::timestamptz,$7,$8::timestamptz)`;
export const USAGE_LEASE_INSERT_SQL = `INSERT INTO jungsi_backend.usage_budget_leases
 (lease_id,owner_id,policy_version,operation,state,created_at,expires_at,settled_at,reserved_demands,denial_code)
 VALUES($1::uuid,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::timestamptz,$9::jsonb,$10)`;
export const USAGE_LEASE_READ_SQL = `SELECT state,reserved_demands::text,
 to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),result_bytes::text
 FROM jungsi_backend.usage_budget_leases WHERE lease_id=$1::uuid AND owner_id=$2 AND policy_version=$3 FOR UPDATE`;
export const USAGE_LEASE_FINISH_SQL =
  `UPDATE jungsi_backend.usage_budget_leases SET state=$4,settled_at=$5::timestamptz,result_bytes=$6::bigint
 WHERE lease_id=$1::uuid AND owner_id=$2 AND policy_version=$3 AND state='active' RETURNING lease_id::text`;
export const USAGE_ACTIVE_EXPIRY_SQL =
  `SELECT to_char(min(expires_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 FROM jungsi_backend.usage_budget_leases WHERE owner_id=$1 AND policy_version=$2 AND state='active' AND expires_at>$3::timestamptz`;
interface Counter {
  kind: BudgetKind;
  scope: string;
  periodSeconds: bigint;
  start: bigint;
  end: bigint;
  units: bigint;
  capacity: bigint;
  ceiling: bigint;
  fingerprint?: string;
}
interface Held {
  kind: "calculation_cost" | "concurrent_jobs" | "result_volume";
  scope: string;
  periodSeconds: bigint;
  start: bigint;
  units: bigint;
}
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function one(rows: unknown[][], size: number): unknown[] {
  if (
    !Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]) || rows[0].length !== size
  ) unavailable();
  return rows[0];
}
function natural(v: unknown): bigint {
  const value = sqlIntegerText(v);
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) unavailable();
  return n;
}
function key(
  owner: string,
  policy: string,
  c: Pick<Counter, "scope" | "kind" | "periodSeconds" | "start">,
): unknown[] {
  return [owner, policy, c.scope, c.kind, String(c.periodSeconds), utcText(c.start)];
}
function heldJson(items: Held[]): string {
  return nativeJsonText(
    items.map((c) => ({
      kind: c.kind,
      scope: c.scope,
      period_seconds: String(c.periodSeconds),
      window_start: utcText(c.start),
      units: String(c.units),
    })),
  );
}
function readHeld(value: unknown): Held[] {
  const list = sqlArrayText(value, 32768);
  if (list.length > 64) unavailable();
  const found = new Set<string>();
  return list.map((v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v) || v instanceof JsonFloat) {
      unavailable();
    }
    const names = ["kind", "scope", "period_seconds", "window_start", "units"];
    if (
      Object.keys(v).length !== names.length || names.some((k) => !Object.hasOwn(v, k)) ||
      !["calculation_cost", "concurrent_jobs", "result_volume"].includes(v.kind as string) ||
      typeof v.scope !== "string" || !ID.test(v.scope) || typeof v.window_start !== "string"
    ) unavailable();
    const period = natural(v.period_seconds),
      units = natural(v.units),
      start = utcInstant(v.window_start);
    if (period < 1n || units < 1n || utcText(start) !== v.window_start) unavailable();
    const signature = [v.kind, v.scope, String(period), v.window_start].join("\0");
    if (found.has(signature)) unavailable();
    found.add(signature);
    return { kind: v.kind as Held["kind"], scope: v.scope, periodSeconds: period, start, units };
  });
}
async function lock(tx: NativeSqlTransaction, owner: string, policy: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("jungsi.usage\0" + owner + "\0" + policy),
    ),
  );
  await tx.query(USAGE_LOCK_SQL, [String(new DataView(bytes.buffer).getBigInt64(0, false))]);
}
export class SupabaseUsageBudgetStore implements UsageBudgetStorePort {
  private readonly leaseSeconds: bigint;
  constructor(private readonly sql: SupabaseSqlTransport, limits: UsageStoreLimits) {
    if (
      !limits || typeof limits.leaseSeconds !== "bigint" ||
      typeof limits.runtimeHardLimitSeconds !== "bigint" ||
      typeof limits.clockMarginSeconds !== "bigint" || limits.runtimeHardLimitSeconds < 1n ||
      limits.clockMarginSeconds < 0n ||
      limits.leaseSeconds <= limits.runtimeHardLimitSeconds + limits.clockMarginSeconds
    ) unavailable();
    this.leaseSeconds = limits.leaseSeconds;
  }
  private async begin(tx: NativeSqlTransaction, owner: string, policy: string): Promise<bigint> {
    if (one(await tx.query(USAGE_VERSION_SQL), 1)[0] !== true) unavailable();
    await lock(tx, owner, policy);
    const now = utcInstant(sqlUtcText(one(await tx.query(USAGE_NOW_SQL), 1)[0]));
    const stale = await tx.query(USAGE_EXPIRED_SQL, [owner, policy, utcText(now)]);
    if (
      !Array.isArray(stale) ||
      stale.some((r) =>
        !Array.isArray(r) || r.length !== 2 || typeof r[0] !== "string" || !UUID.test(r[0])
      )
    ) unavailable();
    for (const row of stale) {
      await this.consume(tx, owner, policy, readHeld(row[1]));
      one(
        await tx.query(USAGE_LEASE_FINISH_SQL, [
          row[0],
          owner,
          policy,
          "expired",
          utcText(now),
          null,
        ]),
        1,
      );
    }
    return now;
  }
  private async consume(
    tx: NativeSqlTransaction,
    owner: string,
    policy: string,
    items: Held[],
    outcome: "success" | "failure" | "expired" = "expired",
    resultBytes?: bigint,
  ): Promise<void> {
    for (const c of items) {
      let consumed = c.kind === "concurrent_jobs" ? 0n : c.units;
      if (c.kind === "result_volume" && outcome !== "expired") {
        if (outcome === "success" && (typeof resultBytes !== "bigint" || resultBytes > c.units)) {
          unavailable();
        }
        consumed = outcome === "failure" ? 0n : resultBytes!;
      }
      const row = one(
        await tx.query(USAGE_WINDOW_CHANGE_SQL, [
          ...key(owner, policy, c),
          String(consumed),
          String(-c.units),
        ]),
        1,
      );
      natural(row[0]);
    }
  }
  private validate(request: UsageReservationRequest): void {
    if (
      !request || typeof request.owner !== "string" || !UUID.test(request.owner) ||
      typeof request.policyVersion !== "string" || !ID.test(request.policyVersion) ||
      !BUDGET_OPERATIONS.includes(request.operation as typeof BUDGET_OPERATIONS[number]) ||
      !Array.isArray(request.demands) || request.demands.length < 1 || request.demands.length > 64
    ) unavailable();
    const keys = new Set<string>();
    const exempt = verifyAdministratorUsageProof(
      request.administratorProof,
      request,
      request.administratorProof?.issuedAtUtc ?? 0n,
    );
    let requests = 0;
    let concurrent = 0;
    for (const d of request.demands) {
      if (
        !d || !BUDGET_KINDS.includes(d.kind) || typeof d.scope !== "string" || !ID.test(d.scope) ||
        typeof d.periodSeconds !== "bigint" || d.periodSeconds < 1n ||
        typeof d.capacity !== "bigint" || d.capacity < 0n || typeof d.ceiling !== "bigint" ||
        d.ceiling < d.capacity || typeof d.units !== "bigint" || d.units < 0n ||
        d.kind === "distinct_scores" &&
          (d.units !== 1n || typeof d.fingerprint !== "string" ||
            !/^[a-f0-9]{64}$/.test(d.fingerprint)) ||
        d.kind !== "distinct_scores" && d.fingerprint !== undefined
      ) unavailable();
      if (exempt.includes(d.kind) && d.periodSeconds === 86400n) unavailable();
      if (d.kind === "request_window") {
        if (d.units !== 1n) unavailable();
        requests++;
      }
      if (
        d.kind === "concurrent_jobs" &&
        (d.units !== 1n || d.periodSeconds !== 1n || d.scope !== "GLOBAL")
      ) unavailable();
      if (d.kind === "concurrent_jobs") concurrent++;
      const signature = [d.kind, d.scope, String(d.periodSeconds)].join("\0");
      if (keys.has(signature)) unavailable();
      keys.add(signature);
    }
    if (!requests && !exempt.includes("request_window")) unavailable();
    if (request.administratorProof && concurrent !== 1) unavailable();
  }
  async reserve(request: UsageReservationRequest): Promise<UsageReservationDecision> {
    this.validate(request);
    const { owner, policyVersion: policy, operation } = request;
    try {
      return await this.sql.write(owner, async (tx) => {
        const now = await this.begin(tx, owner, policy),
          id = crypto.randomUUID(),
          counters: Counter[] = [],
          blocked: Counter[] = [];
        // Check database time under the existing advisory lock before touching counters.
        verifyAdministratorUsageProof(request.administratorProof, request, now);
        for (const d of request.demands) {
          const period = d.periodSeconds * MICROSECOND;
          let index = now / period;
          if (now < 0n && now % period !== 0n) index--;
          const c: Counter = d.kind === "concurrent_jobs"
            ? { ...d, start: 0n, end: utcInstant("9999-12-31T23:59:59.999999Z") }
            : { ...d, start: index * period, end: (index + 1n) * period };
          const params = key(owner, policy, c);
          await tx.query(USAGE_WINDOW_INSERT_SQL, [...params, utcText(c.end), String(c.ceiling)]);
          const row = one(await tx.query(USAGE_WINDOW_READ_SQL, params), 4),
            capacity = natural(row[0]),
            used = natural(row[1]),
            reserved = natural(row[2]);
          if (
            capacity !== c.ceiling || utcInstant(sqlUtcText(row[3])) !== c.end ||
            used + reserved > capacity
          ) unavailable();
          if (c.kind === "distinct_scores") {
            const found =
              one(await tx.query(USAGE_IDENTITY_READ_SQL, [...params, c.fingerprint]), 1)[0];
            if (typeof found !== "boolean") unavailable();
            if (found) c.units = 0n;
          }
          if (used + reserved + c.units > c.capacity) blocked.push(c);
          counters.push(c);
        }
        // An authenticated refused job still spends each available request allowance.
        for (
          const c of counters.filter((c) => c.kind === "request_window" && !blocked.includes(c))
        ) {
          natural(
            one(
              await tx.query(USAGE_WINDOW_CHANGE_SQL, [...key(owner, policy, c), "1", "0"]),
              1,
            )[0],
          );
        }
        if (blocked.length) {
          const code = blocked.some((c) =>
              c.kind === "request_window" || c.kind === "concurrent_jobs"
            )
            ? "rate_limit_exceeded"
            : "analysis_quota_exceeded";
          let retry = 1n;
          for (const c of blocked) {
            let deadline = c.end;
            if (c.kind === "concurrent_jobs") {
              const active =
                one(await tx.query(USAGE_ACTIVE_EXPIRY_SQL, [owner, policy, utcText(now)]), 1)[0];
              if (active !== null) {
                const expiry = utcInstant(sqlUtcText(active));
                if (expiry < deadline) deadline = expiry;
              } else unavailable();
            }
            const seconds = (deadline - now + MICROSECOND - 1n) / MICROSECOND;
            if (seconds > retry) retry = seconds;
          }
          if (retry > BigInt(Number.MAX_SAFE_INTEGER)) unavailable();
          await tx.query(USAGE_LEASE_INSERT_SQL, [
            id,
            owner,
            policy,
            operation,
            "denied",
            utcText(now),
            utcText(now),
            utcText(now),
            "[]",
            code,
          ]);
          return {
            allowed: false,
            code,
            retryAfterSeconds: Number(retry),
          } as UsageReservationDecision;
        }
        const held: Held[] = [];
        for (const c of counters) {
          if (c.kind === "request_window" || c.units === 0n) continue;
          const params = key(owner, policy, c);
          if (c.kind === "distinct_scores") {
            natural(
              one(await tx.query(USAGE_WINDOW_CHANGE_SQL, [...params, String(c.units), "0"]), 1)[0],
            );
            await tx.query(USAGE_IDENTITY_INSERT_SQL, [...params, c.fingerprint, utcText(now)]);
          } else {
            natural(
              one(await tx.query(USAGE_WINDOW_CHANGE_SQL, [...params, "0", String(c.units)]), 1)[0],
            );
            held.push({
              kind: c.kind,
              scope: c.scope,
              periodSeconds: c.periodSeconds,
              start: c.start,
              units: c.units,
            });
          }
        }
        const expires = now + this.leaseSeconds * MICROSECOND;
        await tx.query(USAGE_LEASE_INSERT_SQL, [
          id,
          owner,
          policy,
          operation,
          "active",
          utcText(now),
          utcText(expires),
          null,
          heldJson(held),
          null,
        ]);
        return {
          allowed: true,
          lease: Object.freeze({
            id,
            owner,
            policyVersion: policy,
            createdAtUtc: now,
            expiresAtUtc: expires,
          }),
        } as UsageReservationDecision;
      });
    } catch {
      throw new AccessError("security_policy_unavailable", 503);
    }
  }
  async settle(
    lease: UsageLease,
    outcome: "success" | "failure",
    usage?: { readonly resultBytes?: bigint },
  ): Promise<void> {
    if (
      !lease || typeof lease.owner !== "string" || !UUID.test(lease.owner) ||
      typeof lease.id !== "string" || !UUID.test(lease.id) ||
      typeof lease.policyVersion !== "string" || !ID.test(lease.policyVersion) ||
      typeof lease.createdAtUtc !== "bigint" || typeof lease.expiresAtUtc !== "bigint" ||
      !["success", "failure"].includes(outcome) ||
      usage?.resultBytes !== undefined &&
        (typeof usage.resultBytes !== "bigint" || usage.resultBytes < 0n)
    ) unavailable();
    try {
      await this.sql.write(lease.owner, async (tx) => {
        const now = await this.begin(tx, lease.owner, lease.policyVersion),
          row = one(
            await tx.query(USAGE_LEASE_READ_SQL, [lease.id, lease.owner, lease.policyVersion]),
            5,
          );
        if (
          utcInstant(sqlUtcText(row[2])) !== lease.createdAtUtc ||
          utcInstant(sqlUtcText(row[3])) !== lease.expiresAtUtc
        ) unavailable();
        const resultBytes = outcome === "failure" ? 0n : usage?.resultBytes ?? 0n;
        if (row[0] === outcome) {
          if (row[4] === null || natural(row[4]) !== resultBytes) unavailable();
          return;
        }
        if (row[0] !== "active" || lease.expiresAtUtc <= now) unavailable();
        await this.consume(
          tx,
          lease.owner,
          lease.policyVersion,
          readHeld(row[1]),
          outcome,
          usage?.resultBytes,
        );
        one(
          await tx.query(USAGE_LEASE_FINISH_SQL, [
            lease.id,
            lease.owner,
            lease.policyVersion,
            outcome,
            utcText(now),
            String(resultBytes),
          ]),
          1,
        );
      });
    } catch {
      throw new AccessError("security_policy_unavailable", 503);
    }
  }
}
