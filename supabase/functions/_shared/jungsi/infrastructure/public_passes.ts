/** Read-only, request-local public pass reader. SQL execution is explicitly injected. */
import { AccessError } from "../application/access.ts";
import type { PublicPassPort, PublicPassState } from "../application/ports.ts";
import { utcInstant, utcText } from "../domain/time.ts";
export interface ReadonlyPassSqlPort {
  /** Native implementation must use a UTC read-only transaction with the SELECT-only backend role. */
  readOnlyOne(statement: string, parameters: readonly unknown[]): Promise<unknown>;
}
export const PASS_STATE_SQL =
  "SELECT c.oid IS NOT NULL,\n    meta_columns.rows, meta_constraints.rows,\n    CASE WHEN r.rolname=$1 THEN jsonb_build_array(\n      c.relrowsecurity,r.rolsuper,r.rolbypassrls,c.relowner=r.oid,\n      has_table_privilege(current_user,c.oid,'SELECT'),\n      has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),\n      has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES')) END,\n    meta_policies.rows, to_char(paid.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')\nFROM (SELECT to_regclass('public.jeongsi_passes') AS oid) target\nLEFT JOIN pg_catalog.pg_class c ON c.oid=target.oid\nLEFT JOIN pg_catalog.pg_roles r ON r.rolname=current_user\nLEFT JOIN LATERAL (\n  SELECT jsonb_agg(jsonb_build_array(column_name,udt_name,is_nullable)\n                   ORDER BY ordinal_position) AS rows\n  FROM information_schema.columns\n  WHERE table_schema='public' AND table_name='jeongsi_passes'\n) meta_columns ON true\nLEFT JOIN LATERAL (\n  SELECT jsonb_agg(jsonb_build_array(conname,contype::text,convalidated,\n                    pg_get_constraintdef(oid)) ORDER BY conname) AS rows\n  FROM pg_catalog.pg_constraint WHERE conrelid=c.oid\n) meta_constraints ON true\nLEFT JOIN LATERAL (\n  SELECT jsonb_agg(jsonb_build_array(polname,polcmd::text,polpermissive,\n    ARRAY(SELECT CASE WHEN role_id=0 THEN 'public' ELSE pg_get_userbyid(role_id) END\n          FROM unnest(polroles) AS policy_role(role_id)),\n    pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) AS rows\n  FROM pg_catalog.pg_policy WHERE polrelid=c.oid AND polcmd IN ('r','*')\n) meta_policies ON true\nLEFT JOIN LATERAL (\n  SELECT max(ends_at) AS expires_at FROM public.jeongsi_passes\n  WHERE user_id=$2 AND revoked_at IS NULL AND starts_at<=$3 AND ends_at>$4\n) paid ON true";
const EXPECTED_COLUMNS: Readonly<Record<string, readonly [string, string]>> = {
  id: ["int8", "NO"],
  user_id: ["uuid", "NO"],
  starts_at: ["timestamptz", "NO"],
  ends_at: ["timestamptz", "NO"],
  note: ["text", "YES"],
  granted_by: ["uuid", "YES"],
  revoked_at: ["timestamptz", "YES"],
  revoked_by: ["uuid", "YES"],
  created_at: ["timestamptz", "NO"],
};
function expression(value: unknown): string | null {
  return typeof value === "string" ? value.replace(/[\s()]/g, "").toLowerCase() : null;
}
function rows(value: unknown, size: number, max: number): value is unknown[][] {
  return Array.isArray(value) && value.length <= max &&
    value.every((r) => Array.isArray(r) && r.length === size);
}
function requireSchema(state: unknown): string | null {
  if (!Array.isArray(state) || state.length !== 6 || state[0] !== true) {
    throw new AccessError("entitlement_schema_unverified", 503);
  }
  const [, _columns, constraints, role, policies, expiry] = state;
  const columns = _columns;
  if (
    !rows(columns, 3, 9) || columns.length !== 9 || new Set(columns.map((r) => r[0])).size !== 9 ||
    columns.some(([name, kind, nullable]) =>
      typeof name !== "string" || !Object.hasOwn(EXPECTED_COLUMNS, name) ||
      kind !== EXPECTED_COLUMNS[name][0] || nullable !== EXPECTED_COLUMNS[name][1]
    )
  ) throw new AccessError("entitlement_schema_unverified", 503);
  if (
    !rows(constraints, 4, 256) ||
    constraints.some(([name, kind, valid, def]) =>
      typeof name !== "string" || typeof kind !== "string" || typeof valid !== "boolean" ||
      typeof def !== "string"
    )
  ) throw new AccessError("entitlement_schema_unverified", 503);
  const period = constraints.some(([name, kind, valid, def]) =>
    name === "jeongsi_passes_period" && kind === "c" && valid === true &&
    expression(def) === "checkends_at>starts_at"
  );
  const fk = constraints.some(([, kind, valid, def]) =>
    kind === "f" && valid === true &&
    expression(def) === "foreignkeyuser_idreferencesauth.usersidondeletecascade"
  );
  const pk = constraints.some(([, kind, valid, def]) =>
    kind === "p" && valid === true && expression(def) === "primarykeyid"
  );
  if (!period || !fk || !pk) throw new AccessError("entitlement_schema_unverified", 503);
  const expected = [true, false, false, false, true, false, false];
  if (
    !Array.isArray(role) || role.length !== expected.length ||
    role.some((v, i) => typeof v !== "boolean" || v !== expected[i])
  ) throw new AccessError("entitlement_runtime_role_unverified", 503);
  if (
    !rows(policies, 6, 2) || policies.length !== 2 ||
    policies.some(([name, cmd, permissive, roles, _qual, check]) =>
      typeof name !== "string" || cmd !== "r" || permissive !== true || !Array.isArray(roles) ||
      roles.some((x) => typeof x !== "string") || check !== null
    )
  ) throw new AccessError("entitlement_rls_unverified", 503);
  const own = policies.find((r) => r[0] === "jeongsi_passes: select own or admin");
  const backend = policies.find((r) => r[0] === "jeongsi_passes: jungsi backend read");
  if (
    !own || !backend || (own[3] as string[]).length !== 1 || (own[3] as string[])[0] !== "public" ||
    !["auth.uid=user_idoris_admin", "auth.uid=user_idorpublic.is_admin"].includes(
      expression(own[4]) ?? "",
    ) ||
    (backend[3] as string[]).length !== 2 || new Set(backend[3] as string[]).size !== 2 ||
    !(backend[3] as string[]).includes("jungsi_backend_app") ||
    !(backend[3] as string[]).includes("jungsi_backend_owner") ||
    expression(backend[4]) !== "true"
  ) throw new AccessError("entitlement_rls_unverified", 503);
  if (expiry !== null && typeof expiry !== "string") {
    throw new AccessError("entitlement_result_invalid", 503);
  }
  return expiry;
}
export class PublicJeongsiPassesReader implements PublicPassPort {
  constructor(private readonly sql: ReadonlyPassSqlPort) {}
  async readCurrent(subjectId: string, nowUtc: bigint): Promise<PublicPassState> {
    if (
      typeof subjectId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId) ||
      typeof nowUtc !== "bigint"
    ) throw new AccessError("entitlement_identity_or_time_invalid", 503);
    let instant;
    try {
      instant = utcText(nowUtc);
    } catch {
      throw new AccessError("entitlement_identity_or_time_invalid", 503);
    }
    let raw;
    try {
      raw = await this.sql.readOnlyOne(PASS_STATE_SQL, [
        "jungsi_backend_app",
        subjectId,
        instant,
        instant,
      ]);
    } catch {
      throw new AccessError("entitlement_unavailable", 503);
    }
    const expiry = requireSchema(raw);
    let paidUntilUtc: bigint | null = null;
    if (expiry !== null) {
      try {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(expiry)) {
          throw new Error("expiry");
        }
        paidUntilUtc = utcInstant(expiry);
      } catch {
        throw new AccessError("entitlement_result_invalid", 503);
      }
      if (paidUntilUtc <= nowUtc) throw new AccessError("entitlement_result_invalid", 503);
    }
    return Object.freeze({
      authority: "public.jeongsi_passes",
      metadataVerified: true,
      subjectId,
      evaluatedAtUtc: nowUtc,
      paidUntilUtc,
    });
  }
}
