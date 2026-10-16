import {
  readApprovedRuntimeBinding,
  readBasicRuntimeSettings,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_settings.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  SYNTHETIC_RUNTIME_NOW,
  syntheticRuntimeBinding,
  syntheticRuntimePin,
} from "./synthetic_runtime_binding.ts";
import { assert, equal } from "./fixture.ts";
async function denied(run: () => unknown) {
  let error: unknown;
  try {
    await run();
  } catch (value) {
    error = value;
  }
  assert(error instanceof AccessError);
  equal(error.http, 503);
}
Deno.test("runtime settings require explicit CA and preserve PEM bytes for native TLS validation", async () => {
  const f = await syntheticRuntimeBinding(), settings = readBasicRuntimeSettings(f.env);
  equal(settings.database.databaseCa, f.values.JUNGSI_DATABASE_CA);
  for (
    const ca of [
      undefined,
      "",
      "C:/SYNTHETIC/ca.pem",
      "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----",
    ]
  ) {
    if (ca === undefined) delete f.values.JUNGSI_DATABASE_CA;
    else f.values.JUNGSI_DATABASE_CA = ca;
    await denied(() => readBasicRuntimeSettings(f.env));
  }
});
Deno.test("runtime settings bind one project and refuse owner or migration database roles", async () => {
  for (
    const patch of [{ SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co" }, {
      DATABASE_URL: "postgresql://postgres:SYNTHETIC@db.abcdefghijklmnopqrst.supabase.co/postgres",
    }]
  ) {
    const f = await syntheticRuntimeBinding();
    Object.assign(f.values, patch);
    await denied(() => readBasicRuntimeSettings(f.env));
  }
});
Deno.test("runtime approved binding preserves exact source pins and paid worker lease distinction", async () => {
  const f = await syntheticRuntimeBinding(), binding = await f.load();
  equal(
    binding.references.head.sha256,
    (f.descriptor.sources as NativeObject).head &&
      ((f.descriptor.sources as NativeObject).head as NativeObject).sha256,
  );
  equal(binding.usageStoreLimits.runtimeHardLimitSeconds.toString(), "400");
  equal(binding.usageStoreLimits.leaseSeconds.toString(), "406");
  equal(binding.operations.length, 25);
  equal(
    binding.operations.filter((id) =>
      ["score-input.status.read", "score-input.correction.grant", "report.sample.read"].includes(id)
    ).length,
    3,
  );
  equal(
    binding.operations.filter((id) =>
      !["score-input.status.read", "score-input.correction.grant", "report.sample.read"].includes(
        id,
      )
    ).length,
    22,
  );
  equal(binding.artifacts, [{ kind: "catalog", key: "service" }]);
});
Deno.test("runtime unapproved wrong-purpose or expired descriptor cannot enable data", async () => {
  for (
    const patch of [{ status: "prepared" }, { purpose: "legacy-review" }, {
      expires_at: "2026-10-14T23:59:59Z",
    }]
  ) {
    const f = await syntheticRuntimeBinding((d) => Object.assign(d, patch));
    await denied(f.load);
  }
});
Deno.test("runtime missing descriptor source pin or size cap fails without a default", async () => {
  for (
    const name of [
      "JUNGSI_API_BINDING_JSON",
      "JUNGSI_API_BINDING_SHA256",
      "JUNGSI_API_BINDING_MAX_BYTES",
    ]
  ) {
    const f = await syntheticRuntimeBinding();
    delete f.values[name];
    await denied(f.load);
  }
});
Deno.test("runtime refuses wrong raw hash altered scope duplicate operations and unbound object prefix", async () => {
  const changed = await syntheticRuntimeBinding();
  changed.values.JUNGSI_API_BINDING_JSON += " ";
  await denied(changed.load);
  for (
    const mutate of [
      (
        d: NativeObject,
      ) => ((d.scope as NativeObject).operations = ["session.read", "session.read"]),
      (
        d: NativeObject,
      ) => (((d.sources as NativeObject).head as NativeObject).object_key = "OTHER/head.json"),
      (d: NativeObject) => ((d.scope as NativeObject).operations = ["SYNTHETIC-unregistered"]),
    ]
  ) {
    const f = await syntheticRuntimeBinding(mutate);
    await denied(f.load);
  }
});
Deno.test("runtime numeric limits reject booleans floats null and worker-length lease", async () => {
  for (const value of [true, null, new JsonFloat("64e0"), 0]) {
    const f = await syntheticRuntimeBinding((
      d,
    ) => (((d.limits as NativeObject).read as NativeObject).max_requests = value));
    await denied(f.load);
  }
  const f = await syntheticRuntimeBinding((
    d,
  ) => (((d.limits as NativeObject).usage_store as NativeObject).lease_seconds = 405));
  await denied(f.load);
});
Deno.test("runtime parsing does not use client-provided approval or silently load local env files", async () => {
  const f = await syntheticRuntimeBinding(), basic = readBasicRuntimeSettings(f.env);
  await denied(() =>
    readApprovedRuntimeBinding({ get: () => undefined }, basic, SYNTHETIC_RUNTIME_NOW)
  );
});

const SYNTHETIC_ALIASES: Readonly<Record<string, string>> = {
  DATABASE_URL: "JUNGSI_DISPLAY_DATABASE_URL",
  JUNGSI_DATABASE_CA: "JUNGSI_DISPLAY_DATABASE_CA",
  SUPABASE_PUBLISHABLE_KEY: "JUNGSI_DISPLAY_PUBLISHABLE_KEY",
  SUPABASE_SECRET_KEY: "JUNGSI_DISPLAY_STORAGE_SECRET",
};
Deno.test("runtime resolver reuses only the four explicit display aliases when canonical is absent", async () => {
  const f = await syntheticRuntimeBinding(), expected = readBasicRuntimeSettings(f.env);
  const secret = f.values.SUPABASE_SECRET_KEY;
  for (const [name, alias] of Object.entries(SYNTHETIC_ALIASES)) {
    f.values[alias] = f.values[name];
    Reflect.deleteProperty(f.values, name);
  }
  equal(readBasicRuntimeSettings(f.env), expected);
  equal((await f.load()).storage.secretKey, secret);
});
Deno.test("runtime resolver canonical values win over different display alias values", async () => {
  const f = await syntheticRuntimeBinding(), expected = readBasicRuntimeSettings(f.env);
  for (const alias of Object.values(SYNTHETIC_ALIASES)) {
    f.values[alias] = "SYNTHETIC-must-not-be-used";
  }
  equal(readBasicRuntimeSettings(f.env), expected);
  equal((await f.load()).storage.secretKey, f.values.SUPABASE_SECRET_KEY);
});
Deno.test("runtime resolver empty canonical values remain errors with a valid display alias", async () => {
  for (const [name, alias] of Object.entries(SYNTHETIC_ALIASES)) {
    const f = await syntheticRuntimeBinding();
    f.values[alias] = f.values[name];
    f.values[name] = "";
    await denied(() => f.load());
  }
});
Deno.test("runtime resolver never falls back to privileged migration defaults or plural key arrays", async () => {
  for (
    const [name, forbidden] of [
      ["DATABASE_URL", "SUPABASE_DB_URL"],
      ["DATABASE_URL", "JUNGSI_MIGRATION_DATABASE_URL"],
      ["JUNGSI_DATABASE_CA", "SUPABASE_DB_CA"],
      ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS"],
      ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"],
      ["SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS"],
      ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    ]
  ) {
    const f = await syntheticRuntimeBinding(), value = f.values[name];
    Reflect.deleteProperty(f.values, name);
    f.values[forbidden] = forbidden.endsWith("KEYS") ? JSON.stringify([value]) : value;
    await denied(() => f.load());
  }
});
Deno.test("runtime resolver cannot turn display descriptor bucket or prefix into engine approval", async () => {
  for (
    const [name, forbidden] of [
      ["JUNGSI_SUPABASE_STORAGE_BUCKET", "DISPLAY_STORAGE_BUCKET"],
      ["JUNGSI_SUPABASE_STORAGE_PREFIX", "DISPLAY_PATH_PREFIX"],
      ["JUNGSI_API_BINDING_JSON", "DISPLAY_DESCRIPTOR_JSON"],
      ["JUNGSI_API_BINDING_SHA256", "DISPLAY_DESCRIPTOR_SHA256"],
      ["JUNGSI_API_BINDING_MAX_BYTES", "DISPLAY_DESCRIPTOR_MAX_BYTES"],
    ]
  ) {
    const f = await syntheticRuntimeBinding(), value = f.values[name];
    Reflect.deleteProperty(f.values, name);
    f.values[forbidden] = value;
    await denied(() => f.load());
  }
});

Deno.test("runtime binding preserves pretty JSON LF and CRLF raw bytes with exact original hashes", async () => {
  for (const newline of ["\n", "\r\n"]) {
    const f = await syntheticRuntimeBinding();
    const raw = JSON.stringify(f.descriptor, null, 2).replaceAll("\n", newline) + newline;
    const pin = await syntheticRuntimePin(raw);
    f.values.JUNGSI_API_BINDING_JSON = raw;
    f.values.JUNGSI_API_BINDING_SHA256 = pin.sha256;
    equal((await f.load()).descriptorSha256, pin.sha256);
    f.values.JUNGSI_API_BINDING_JSON = raw + " ";
    await denied(() => f.load());
  }
});
Deno.test("runtime binding refuses empty or whitespace-only raw JSON even with its exact hash", async () => {
  for (const raw of ["", " ", "\n", "\r\n"]) {
    const f = await syntheticRuntimeBinding(), pin = await syntheticRuntimePin(raw);
    f.values.JUNGSI_API_BINDING_JSON = raw;
    f.values.JUNGSI_API_BINDING_SHA256 = pin.sha256;
    await denied(() => f.load());
  }
});
