import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  assertSupabaseProjectBinding,
  databaseProjectRef,
} from "../../supabase/functions/_shared/jungsi/infrastructure/project_binding.ts";
import { assert, equal } from "./fixture.ts";
const REF = "a".repeat(20), OTHER = "b".repeat(20), AUTH = "https://" + REF + ".supabase.co";
const DSN = "postgresql://jungsi_backend_app." + REF +
  ":SYNTHETIC-password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require";
function denied(run: () => unknown, code = "storage_configuration_invalid") {
  let e: unknown;
  try {
    run();
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.code, code);
  equal(e.http, 503);
}
Deno.test("project binding matches verified pooler routing and explicit direct DB origin", () => {
  equal(databaseProjectRef(DSN), REF);
  assertSupabaseProjectBinding(AUTH, DSN);
  const direct = "postgres://jungsi_backend_app:SYNTHETIC-password@db." + REF +
    ".supabase.co/postgres";
  equal(databaseProjectRef(direct), REF);
  assertSupabaseProjectBinding(AUTH, direct);
});
Deno.test("project binding rejects another Auth project and split user-host project routing", () => {
  denied(
    () => assertSupabaseProjectBinding("https://" + OTHER + ".supabase.co", DSN),
    "service_project_binding_invalid",
  );
  denied(() =>
    databaseProjectRef(
      "postgres://jungsi_backend_app." + OTHER + ":SYNTHETIC-password@db." + REF +
        ".supabase.co/postgres",
    )
  );
});
Deno.test("project binding cannot be overridden by DSN query host user password or options", () => {
  for (const key of ["host", "user", "username", "password", "options", "database", "port"]) {
    denied(() => databaseProjectRef(DSN + "&" + key + "=SYNTHETIC-override"));
  }
  denied(() => databaseProjectRef(DSN + "&sslmode=disable"));
});
Deno.test("project binding refuses owner credentials unknown projects and weak or ambiguous endpoints", () => {
  for (
    const d of [
      DSN.replace("jungsi_backend_app", "jungsi_backend_owner"),
      DSN.replace("jungsi_backend_app." + REF, "jungsi_backend_app"),
      DSN.replace(":SYNTHETIC-password", ""),
      DSN.replace("sslmode=require", "sslmode=disable"),
      DSN.replace("pooler.supabase.com", "example.com"),
    ]
  ) denied(() => databaseProjectRef(d));
  for (
    const url of [
      AUTH + "/path",
      AUTH + "?redirect=other",
      AUTH.replace("https:", "http:"),
      "https://user:secret@" + REF + ".supabase.co",
    ]
  ) denied(() => assertSupabaseProjectBinding(url, DSN), "service_project_binding_invalid");
});
