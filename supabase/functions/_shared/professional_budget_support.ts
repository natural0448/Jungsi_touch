/** SQL protocol model for bounded usage tests. This is not native DB or deployment evidence. */
import { assert } from "./professional_support.ts";
import { NOW } from "./professional_support.ts";
import { utcText } from "./jungsi/domain/time.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SUBJECT_CONTEXT_SQL,
  SupabaseSqlTransport,
} from "./jungsi/infrastructure/transaction_sql.ts";
import * as Q from "./jungsi/infrastructure/usage_postgres.ts";
export function budgetSql(
  extension?: (statement: string, parameters: readonly unknown[]) => unknown[][] | undefined,
) {
  const windows = new Map<
      string,
      { capacity: bigint; used: bigint; reserved: bigint; end: string }
    >(),
    leases = new Map<string, unknown[]>(),
    organizations = new Map<string, { capacity: bigint; used: bigint }>(),
    institutionLeases = new Map<
      string,
      { state: string; bytes: string | null; owner: unknown; policy: unknown }
    >();
  const locks: unknown[][] = [], operations: unknown[] = [];
  let tail = Promise.resolve();
  const key = (p: readonly unknown[]) => p.map(String).join("|");
  const stamp = (value: unknown) => {
    const text = String(value);
    return text.includes(".") ? text : text.replace(/Z$/, ".000000Z");
  };
  const pool: NativeSqlPool = {
    close: async () => {},
    transaction: async (readOnly, work) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((done) => {
        release = done;
      });
      await previous;
      let org: string | null = null;
      const before = {
        windows: structuredClone(windows),
        leases: structuredClone(leases),
        organizations: structuredClone(organizations),
        institutionLeases: structuredClone(institutionLeases),
      };
      const restore = <K, V>(target: Map<K, V>, value: Map<K, V>) => {
        target.clear();
        for (const [k, v] of value) target.set(k, v);
      };
      try {
        return await work({
          query: async (statement, p = []) => {
            await Promise.resolve();
            if (statement === RUNTIME_ROLE_SQL) {
              return [[
                "jungsi_backend_app",
                false,
                false,
                "on",
                readOnly ? "on" : "off",
                false,
                false,
                false,
                "UTC",
              ]];
            }
            if (statement.startsWith("SET LOCAL") || statement === SUBJECT_CONTEXT_SQL) return [];
            if (statement.startsWith("SELECT set_config('jungsi.pro.org_id'")) {
              assert(org === null || org === p[0], "tenant latch");
              org = String(p[0]);
              return [[org]];
            }
            if (statement === Q.USAGE_VERSION_SQL) return [[true]];
            if (statement.includes("schema_versions WHERE version='007_professional_platform'")) {
              return [[true]];
            }
            if (statement === Q.USAGE_NOW_SQL) return [[stamp(utcText(NOW))]];
            if (statement === Q.USAGE_LOCK_SQL) {
              locks.push([...p]);
              return [[null]];
            }
            if (statement === Q.USAGE_EXPIRED_SQL) return [];
            if (statement === Q.USAGE_ACTIVE_EXPIRY_SQL) {
              const active = [...leases.values()].filter((r) =>
                r[1] === p[0] && r[2] === p[1] && r[4] === "active"
              );
              return [[active.length ? stamp(active[0][6]) : null]];
            }
            if (statement === Q.USAGE_WINDOW_INSERT_SQL) {
              const id = key(p.slice(0, 6));
              if (!windows.has(id)) {
                windows.set(id, {
                  capacity: BigInt(String(p[7])),
                  used: 0n,
                  reserved: 0n,
                  end: String(p[6]),
                });
              }
              return [];
            }
            if (statement === Q.USAGE_WINDOW_READ_SQL) {
              const w = windows.get(key(p))!;
              return [[String(w.capacity), String(w.used), String(w.reserved), stamp(w.end)]];
            }
            if (statement === Q.USAGE_WINDOW_CHANGE_SQL) {
              const w = windows.get(key(p.slice(0, 6)))!,
                used = w.used + BigInt(String(p[6])),
                reserved = w.reserved + BigInt(String(p[7]));
              if (used < 0n || reserved < 0n || used + reserved > w.capacity) return [];
              w.used = used;
              w.reserved = reserved;
              return [[String(used)]];
            }
            if (statement === Q.USAGE_LEASE_INSERT_SQL) {
              leases.set(String(p[0]), [...p, null]);
              operations.push(p[3]);
              return [];
            }
            if (statement === Q.USAGE_LEASE_READ_SQL) {
              const r = leases.get(String(p[0]));
              return r && r[1] === p[1] && r[2] === p[2]
                ? [[r[4], r[8], stamp(r[5]), stamp(r[6]), r[10]]]
                : [];
            }
            if (statement === Q.USAGE_LEASE_FINISH_SQL) {
              const r = leases.get(String(p[0]))!;
              if (r[4] !== "active") return [];
              r[4] = p[3];
              r[7] = p[4];
              r[10] = p[5];
              return [[p[0]]];
            }
            const additional = extension?.(statement, p);
            if (additional !== undefined) return additional;
            if (statement.includes("jungsi_professional.")) {
              assert(org === p[0], "institution RLS scope");
              const id = key(p.slice(0, 6));
              if (statement.startsWith("INSERT INTO jungsi_professional.usage_windows")) {
                if (!organizations.has(id)) {
                  organizations.set(id, { capacity: BigInt(String(p[7])), used: 0n });
                }
                return [];
              }
              if (
                statement.startsWith("SELECT capacity::text,used_units::text,reserved_units::text")
              ) {
                const w = organizations.get(id)!;
                return [[String(w.capacity), String(w.used), "0"]];
              }
              if (statement.startsWith("UPDATE jungsi_professional.usage_windows")) {
                const w = organizations.get(id)!;
                if (w.used >= w.capacity) return [];
                w.used++;
                return [[String(w.used)]];
              }
              if (statement.startsWith("INSERT INTO jungsi_professional.usage_leases")) {
                institutionLeases.set(key(p.slice(0, 3)), {
                  state: "active",
                  bytes: null,
                  owner: p[3],
                  policy: p[5],
                });
                return [];
              }
              if (statement.startsWith("SELECT state,result_bytes::text")) {
                const r = institutionLeases.get(key(p.slice(0, 3)));
                return r && r.owner === p[3] && r.policy === p[4] ? [[r.state, r.bytes]] : [];
              }
              if (
                statement.startsWith("UPDATE jungsi_professional.usage_leases SET state='expired'")
              ) return [];
              if (statement.startsWith("UPDATE jungsi_professional.usage_leases SET state=$6")) {
                const r = institutionLeases.get(key(p.slice(0, 3)))!;
                r.state = String(p[5]);
                r.bytes = String(p[6]);
                return [[p[2]]];
              }
            }
            throw new Error("Unexpected synthetic SQL: " + statement.slice(0, 80));
          },
        });
      } catch (error) {
        restore(windows, before.windows);
        restore(leases, before.leases);
        restore(organizations, before.organizations);
        restore(institutionLeases, before.institutionLeases);
        throw error;
      } finally {
        release();
      }
    },
  };
  return {
    sql: new SupabaseSqlTransport(pool).fork(),
    pool,
    windows,
    leases,
    organizations,
    institutionLeases,
    locks,
    operations,
  };
}
