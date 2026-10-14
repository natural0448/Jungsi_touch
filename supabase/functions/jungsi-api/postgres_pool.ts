/** Concrete pinned Postgres composition; foundation stays local and driver-free. */
import "../_shared/node_compat_bootstrap.ts";
import postgres from "npm:postgres@3.4.5";
import { AccessError } from "../_shared/jungsi/application/access.ts";
import { databaseProjectRef } from "../_shared/jungsi/infrastructure/project_binding.ts";
import { requireSqlTextColumns } from "../_shared/jungsi/infrastructure/sql_values.ts";
import type {
  NativeSqlPool,
  NativeSqlTransaction,
} from "../_shared/jungsi/infrastructure/transaction_sql.ts";

export interface PostgresPoolSettings {
  readonly databaseUrl: string;
  readonly databaseCa: string;
}
export function createNativePostgresPool(config: PostgresPoolSettings): NativeSqlPool {
  databaseProjectRef(config.databaseUrl);
  try {
    const u = new URL(config.databaseUrl);
    const username = decodeURIComponent(u.username);
    if (
      !["postgres:", "postgresql:"].includes(u.protocol) ||
      !/^jungsi_backend_app(?:\.[a-z0-9]{20})?$/.test(username) ||
      !/^(?:[a-z0-9-]+\.)*(?:supabase\.co|pooler\.supabase\.com)$/.test(u.hostname) ||
      u.hash || !config.databaseCa.includes("-----BEGIN CERTIFICATE-----") ||
      ["disable", "allow", "prefer"].includes(u.searchParams.get("sslmode") ?? "")
    ) throw new Error();
  } catch {
    throw new AccessError("storage_configuration_invalid", 503);
  }
  const sql = postgres(config.databaseUrl, {
    ssl: { rejectUnauthorized: true, ca: config.databaseCa },
    prepare: false,
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    max_lifetime: 60,
    debug: false,
    fetch_types: false,
    onnotice: () => {},
    connection: { application_name: "jungsi-service-api" },
    types: {
      timestamp_text: { to: 1184, from: [1114, 1184], serialize: String, parse: String },
      date_text: { to: 1082, from: [1082], serialize: String, parse: String },
      json_text: { to: 3802, from: [114, 3802], serialize: String, parse: String },
    },
  });
  return {
    async transaction<T>(
      readOnly: boolean,
      work: (tx: NativeSqlTransaction) => Promise<T>,
    ): Promise<T> {
      const mode = readOnly
        ? "isolation level repeatable read read only"
        : "isolation level read committed read write";
      const result = await sql.begin(mode, async (tx) => {
        const value = await work({
          async query(statement, parameters = []) {
            if (
              typeof statement !== "string" || statement.includes("\0") ||
              parameters.some((v) =>
                v !== null &&
                  !["string", "number", "boolean"].includes(typeof v) ||
                typeof v === "number" && !Number.isFinite(v)
              )
            ) throw new AccessError("storage_parameters_invalid", 503);
            const rows = await tx.unsafe(statement, [...parameters] as never[]).values();
            if (rows.length && !Array.isArray(rows.columns)) {
              throw new AccessError("storage_result_invalid", 503);
            }
            requireSqlTextColumns(rows.columns ?? []);
            return rows as unknown[][];
          },
        });
        return { value };
      });
      return (result as unknown as { value: T }).value;
    },
    async close() {
      await sql.end({ timeout: 1 });
    },
  };
}
