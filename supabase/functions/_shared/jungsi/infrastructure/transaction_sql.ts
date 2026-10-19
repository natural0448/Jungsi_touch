/** App-role UTC/RLS transactions; the native driver is supplied by composition. */
import { AccessError } from "../application/access.ts";
import { utcInstant } from "../domain/time.ts";
import { PASS_STATE_SQL, type ReadonlyPassSqlPort } from "./public_passes.ts";
import { sqlJsonText } from "./sql_values.ts";

export interface NativeSqlTransaction {
  query(statement: string, parameters?: readonly unknown[]): Promise<unknown[][]>;
}
export interface NativeSqlPool {
  transaction<T>(readOnly: boolean, work: (tx: NativeSqlTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RUNTIME_ROLE_SQL = `SELECT current_user,r.rolsuper,r.rolbypassrls,
 current_setting('row_security'),current_setting('transaction_read_only'),
 pg_has_role(current_user,'jungsi_backend_owner','MEMBER'),
 pg_has_role(current_user,'jungsi_backend_owner','USAGE'),
 pg_has_role(current_user,'postgres','MEMBER'),current_setting('TimeZone')
 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;
export const SUBJECT_CONTEXT_SQL = `SELECT set_config('request.jwt.claim.sub',$1,true),
 set_config('request.jwt.claims',$2,true)`;
const PASS_WITH_RUNTIME_SQL = `WITH runtime_guard AS MATERIALIZED (
 SELECT true AS ok FROM pg_catalog.pg_roles r WHERE r.rolname=current_user
 AND current_user=$1 AND NOT r.rolsuper AND NOT r.rolbypassrls
 AND current_setting('row_security')='on'
 AND current_setting('transaction_read_only')='on' AND current_setting('TimeZone')='UTC'
 AND NOT pg_has_role(current_user,'jungsi_backend_owner','MEMBER')
 AND NOT pg_has_role(current_user,'jungsi_backend_owner','USAGE')
 AND NOT pg_has_role(current_user,'postgres','MEMBER')
), payload(exists_native,columns_native,constraints_native,role_native,policies_native,expiry_native,pass_id_native) AS (
${PASS_STATE_SQL}
) SELECT exists_native,columns_native::text,constraints_native::text,
 role_native::text,policies_native::text,expiry_native,pass_id_native
 FROM payload CROSS JOIN runtime_guard WHERE runtime_guard.ok`;
async function configure(tx: NativeSqlTransaction, subject: string | null): Promise<void> {
  await tx.query("SET LOCAL TIME ZONE 'UTC'");
  await tx.query("SET LOCAL row_security='on'");
  await tx.query("SET LOCAL statement_timeout='5000ms'");
  if (subject !== null) {
    await tx.query(SUBJECT_CONTEXT_SQL, [
      subject,
      JSON.stringify({ sub: subject, role: "authenticated" }),
    ]);
  }
}
function subjectId(value: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new AccessError("storage_identity_invalid", 503);
  }
  return value.toLowerCase();
}
function verifyRole(rows: unknown[][], readOnly: boolean): void {
  const expected = [
    "jungsi_backend_app",
    false,
    false,
    "on",
    readOnly ? "on" : "off",
    false,
    false,
    false,
    "UTC",
  ];
  if (
    !Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]) ||
    rows[0].length !== expected.length || rows[0].some((v, i) => v !== expected[i])
  ) throw new AccessError("storage_runtime_role_unverified", 503);
}
export class SupabaseSqlTransport implements ReadonlyPassSqlPort {
  private frame: { readonly subject: string; readonly tx: NativeSqlTransaction } | null = null;
  constructor(private readonly pool: NativeSqlPool, private readonly requestLocal = false) {}
  /** Reuse only the pool. Transaction state is confined to one request-local fork. */
  fork(): SupabaseSqlTransport {
    return new SupabaseSqlTransport(this.pool, true);
  }
  async requestWrite<T>(
    subject: string,
    work: (tx: NativeSqlTransaction) => Promise<T>,
  ): Promise<T> {
    if (!this.requestLocal || this.frame) {
      throw new AccessError("storage_transaction_context_invalid", 503);
    }
    const selected = subjectId(subject);
    return await this.run(false, selected, async (tx) => {
      this.frame = { subject: selected, tx };
      try {
        return await work(tx);
      } finally {
        this.frame = null;
      }
    });
  }
  async readOnlyOne(statement: string, parameters: readonly unknown[]): Promise<unknown> {
    if (
      statement !== PASS_STATE_SQL || !Array.isArray(parameters) || parameters.length !== 4 ||
      parameters[0] !== "jungsi_backend_app" ||
      parameters[1] !== null && (typeof parameters[1] !== "string" || !UUID.test(parameters[1])) ||
      typeof parameters[2] !== "string" || parameters[2] !== parameters[3] ||
      parameters[2].length > 40 || !parameters[2].endsWith("Z")
    ) throw new AccessError("entitlement_unavailable", 503);
    try {
      utcInstant(parameters[2] as string);
      return await this.pool.transaction(true, async (tx) => {
        const subject = parameters[1] === null ? null : subjectId(parameters[1] as string);
        await configure(tx, subject);
        // Metadata, role guard, maximum expiry and its stable pass ID are one positional-row query.
        const rows = await tx.query(PASS_WITH_RUNTIME_SQL, parameters);
        if (
          !Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]) ||
          rows[0].length !== 7
        ) {
          throw new AccessError("entitlement_unavailable", 503);
        }
        const result = [...rows[0]];
        for (const index of [1, 2, 3, 4]) {
          result[index] = result[index] === null ? null : sqlJsonText(result[index], 65536);
        }
        return result;
      });
    } catch {
      throw new AccessError("entitlement_unavailable", 503);
    }
  }
  async read<T>(subject: string, work: (tx: NativeSqlTransaction) => Promise<T>): Promise<T> {
    return await this.run(true, subject, work);
  }
  async write<T>(subject: string, work: (tx: NativeSqlTransaction) => Promise<T>): Promise<T> {
    return await this.run(false, subject, work);
  }
  private async run<T>(
    readOnly: boolean,
    subject: string,
    work: (tx: NativeSqlTransaction) => Promise<T>,
  ): Promise<T> {
    const selected = subjectId(subject);
    if (this.frame) {
      if (!this.requestLocal || this.frame.subject !== selected) {
        throw new AccessError("storage_transaction_context_invalid", 503);
      }
      return await work(this.frame.tx);
    }
    try {
      return await this.pool.transaction(readOnly, async (tx) => {
        await configure(tx, selected);
        verifyRole(await tx.query(RUNTIME_ROLE_SQL), readOnly);
        return await work(tx);
      });
    } catch (error) {
      if (error instanceof AccessError) throw error;
      throw new AccessError("storage_unavailable", 503);
    }
  }
  async close(): Promise<void> {
    await this.pool.close();
  }
  /** Server readiness metadata only; no user claims, row writes or migration execution. */
  async probeUsageSchema(): Promise<boolean> {
    try {
      return await this.pool.transaction(true, async (tx) => {
        await configure(tx, null);
        verifyRole(await tx.query(RUNTIME_ROLE_SQL), true);
        const rows = await tx.query(
          "SELECT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='005_usage_budget')",
        );
        if (
          !Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]) ||
          rows[0].length !== 1 || typeof rows[0][0] !== "boolean"
        ) throw new AccessError("storage_result_invalid", 503);
        return rows[0][0];
      });
    } catch (error) {
      if (error instanceof AccessError) throw error;
      throw new AccessError("storage_unavailable", 503);
    }
  }
}
