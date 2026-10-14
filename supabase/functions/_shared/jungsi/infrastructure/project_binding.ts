/** Composition-only project identity checks; never expose DSNs or tokens in receipts. */
import { AccessError } from "../application/access.ts";
export function databaseProjectRef(databaseUrl: string): string {
  try {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() !== databaseUrl) throw new Error();
    const u = new URL(databaseUrl), username = decodeURIComponent(u.username);
    const role = /^jungsi_backend_app(?:\.([a-z0-9]{20}))?$/.exec(username);
    const host = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
    const pool = /^(?:[a-z0-9-]+\.)*pooler\.supabase\.com$/.test(u.hostname);
    if (
      !["postgres:", "postgresql:"].includes(u.protocol) || !role || !u.password || u.hash ||
      !u.pathname || u.pathname === "/" || (!host && !pool) ||
      [...u.searchParams.keys()].some((k) => k !== "sslmode") ||
      u.searchParams.getAll("sslmode").length > 1 ||
      u.searchParams.has("sslmode") &&
        !["require", "verify-ca", "verify-full"].includes(u.searchParams.get("sslmode")!)
    ) throw new Error();
    if (host && role[1] && host[1] !== role[1]) throw new Error();
    const ref = role[1] ?? host?.[1];
    if (!ref) throw new Error();
    return ref;
  } catch {
    throw new AccessError("storage_configuration_invalid", 503);
  }
}
export function assertSupabaseProjectBinding(authUrl: string, databaseUrl: string): void {
  try {
    const u = new URL(authUrl), ref = databaseProjectRef(databaseUrl);
    if (
      u.protocol !== "https:" || u.username || u.password || u.port || u.pathname !== "/" ||
      u.search || u.hash || u.hostname !== ref + ".supabase.co"
    ) throw new Error();
  } catch {
    throw new AccessError("service_project_binding_invalid", 503);
  }
}
