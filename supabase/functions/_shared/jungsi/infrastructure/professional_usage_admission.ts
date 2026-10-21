/** One database transaction combines institution-wide admission and existing teacher/global counters. */
import { AccessError } from "../application/access.ts";
import type { ProfessionalScope } from "../application/professional_ports.ts";
import type { ProfessionalUsageAdmissionPort } from "../application/professional_usage.ts";
import type {
  UsageLease,
  UsageReservationDecision,
  UsageReservationRequest,
} from "../application/usage_budget.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { sqlIntegerText, sqlUtcText } from "./sql_values.ts";
import { type NativeSqlTransaction, SupabaseSqlTransport } from "./transaction_sql.ts";
import { SupabaseProfessionalUsageBudgetStore } from "./professional_usage_postgres.ts";
import { USAGE_NOW_SQL } from "./usage_postgres.ts";
function fail(): never {
  throw new AccessError("professional_storage_unavailable", 503);
}
function row(rows: unknown[][], width: number): unknown[] {
  if (rows.length !== 1 || rows[0].length !== width) fail();
  return rows[0];
}
function integer(v: unknown): bigint {
  const value = BigInt(sqlIntegerText(v));
  if (value < 0n) fail();
  return value;
}
export class SupabaseProfessionalUsageAdmission implements ProfessionalUsageAdmissionPort {
  constructor(
    private readonly sql: SupabaseSqlTransport,
    private readonly shared: SupabaseProfessionalUsageBudgetStore,
    private readonly hasBusinessFrame: () => boolean = () => false,
  ) {}
  private async tenant(tx: NativeSqlTransaction, scope: ProfessionalScope): Promise<void> {
    await tx.query("SELECT set_config('jungsi.pro.org_id',$1,true)", [
      scope.authority.contract.orgId,
    ]);
  }
  async reserve(
    scope: ProfessionalScope,
    request: UsageReservationRequest,
    limits: { period: bigint; capacity: bigint },
  ): Promise<UsageReservationDecision> {
    const a = scope.authority, c = a.contract;
    if (request.owner !== a.user.subjectId || limits.period < 1n || limits.capacity < 1n) fail();
    return await this.sql.requestWrite(request.owner, async (tx) => {
      await this.tenant(tx, scope);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          "jungsi.pro.usage\0" + c.orgId + "\0" + c.contractId + "\0" + request.policyVersion,
        ),
      );
      await tx.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        String(new DataView(digest).getBigInt64(0, false)),
      ]);
      const now = utcInstant(sqlUtcText(row(await tx.query(USAGE_NOW_SQL), 1)[0])),
        period = limits.period * 1000000n;
      const start = now / period * period, end = start + period;
      const params = [
        c.orgId,
        c.contractId,
        request.policyVersion,
        "ORGANIZATION",
        String(limits.period),
        utcText(start),
      ];
      await tx.query(
        `INSERT INTO jungsi_professional.usage_windows(org_id,contract_id,policy_version,scope_key,dimension,period_seconds,window_start,window_end,capacity)
 VALUES($1,$2,$3,$4,'request_window',$5::bigint,$6::timestamptz,$7::timestamptz,$8::bigint) ON CONFLICT DO NOTHING`,
        [...params, utcText(end), String(limits.capacity)],
      );
      const current = row(
        await tx.query(
          `SELECT capacity::text,used_units::text,reserved_units::text FROM jungsi_professional.usage_windows
 WHERE org_id=$1 AND contract_id=$2 AND policy_version=$3 AND scope_key=$4 AND dimension='request_window' AND period_seconds=$5::bigint AND window_start=$6::timestamptz FOR UPDATE`,
          params,
        ),
        3,
      );
      if (integer(current[0]) !== limits.capacity || integer(current[2]) !== 0n) fail();
      const denied = integer(current[1]) >= limits.capacity;
      if (!denied) {
        row(
          await tx.query(
            `UPDATE jungsi_professional.usage_windows SET used_units=used_units+1
 WHERE org_id=$1 AND contract_id=$2 AND policy_version=$3 AND scope_key=$4 AND dimension='request_window' AND period_seconds=$5::bigint AND window_start=$6::timestamptz AND used_units<capacity RETURNING used_units::text`,
            params,
          ),
          1,
        );
      }
      // Shared store reuses this same request-local SQL frame, including the original lock/key protocol.
      const decision = await this.shared.reserve(request);
      if (!decision.allowed) return decision;
      if (denied) {
        await this.shared.settle(decision.lease, "failure", { resultBytes: 0n, replayed: true });
        return {
          allowed: false,
          code: "rate_limit_exceeded",
          retryAfterSeconds: Math.max(1, Number((end - now + 999999n) / 1000000n)),
        };
      }
      await tx.query(
        `UPDATE jungsi_professional.usage_leases SET state='expired',settled_at=$4::timestamptz
 WHERE org_id=$1 AND contract_id=$2 AND policy_version=$3 AND state='active' AND expires_at<=$4::timestamptz`,
        [c.orgId, c.contractId, request.policyVersion, utcText(now)],
      );
      await tx.query(
        `INSERT INTO jungsi_professional.usage_leases(org_id,contract_id,lease_id,actor_id,student_id,policy_version,operation,shared_lease_id,state,demands,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$3,'active','[]'::jsonb,$8::timestamptz)`,
        [
          c.orgId,
          c.contractId,
          decision.lease.id,
          request.owner,
          scope.student?.studentId ?? null,
          request.policyVersion,
          request.operation,
          utcText(decision.lease.expiresAtUtc),
        ],
      );
      return decision;
    });
  }
  async settle(
    scope: ProfessionalScope,
    lease: UsageLease,
    success: boolean,
    resultBytes: bigint,
    replayed: boolean,
  ): Promise<void> {
    const a = scope.authority;
    if (lease.owner !== a.user.subjectId) fail();
    const settle = async (tx: NativeSqlTransaction) => {
      await this.tenant(tx, scope);
      const held = row(
        await tx.query(
          `SELECT state,result_bytes::text FROM jungsi_professional.usage_leases
 WHERE org_id=$1 AND contract_id=$2 AND lease_id=$3 AND actor_id=$4 AND policy_version=$5 AND shared_lease_id=$3 FOR UPDATE`,
          [a.contract.orgId, a.contract.contractId, lease.id, lease.owner, lease.policyVersion],
        ),
        2,
      );
      const outcome = success ? "success" : "failure", bytes = success ? resultBytes : 0n;
      if (held[0] !== "active" && (held[0] !== outcome || integer(held[1]) !== bytes)) fail();
      await this.shared.settle(lease, outcome, { resultBytes: bytes, replayed });
      if (held[0] === "active") {
        row(
          await tx.query(
            `UPDATE jungsi_professional.usage_leases SET state=$6,result_bytes=$7::bigint,settled_at=clock_timestamp()
 WHERE org_id=$1 AND contract_id=$2 AND lease_id=$3 AND actor_id=$4 AND policy_version=$5 AND state='active' RETURNING lease_id`,
            [
              a.contract.orgId,
              a.contract.contractId,
              lease.id,
              lease.owner,
              lease.policyVersion,
              outcome,
              String(bytes),
            ],
          ),
          1,
        );
      }
    };
    if (this.hasBusinessFrame()) await this.sql.write(lease.owner, settle);
    else await this.sql.requestWrite(lease.owner, settle);
  }
}
