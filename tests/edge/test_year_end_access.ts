/** Synthetic boundary checks; no DB, network, credentials, or operating policy registration. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { utcInstant, utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import {
  readApprovedRuntimeBinding,
  readBasicRuntimeSettings,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_settings.ts";
import { syntheticRuntimeBinding } from "./synthetic_runtime_binding.ts";
import { assert, equal } from "./fixture.ts";

const END = "2026-12-31T15:00:00.000000Z";

async function seasonFixture() {
  return await syntheticRuntimeBinding(
    (binding) => binding.expires_at = END,
    (head) => head.expires_at = END,
  );
}

Deno.test("year-end access includes all December31 KST and ends at January1 local midnight", () => {
  equal(utcText(utcInstant(END)), "2026-12-31T15:00:00Z");
  assert(utcInstant(END) - utcInstant("2026-12-31T14:59:59.999999Z") === 1n);
});

Deno.test("explicit renewed binding remains valid after old November22 and through last December31 microsecond", async () => {
  const f = await seasonFixture();
  for (const text of ["2026-11-22T00:00:00Z", "2026-12-31T14:59:59.999999Z"]) {
    const binding = await readApprovedRuntimeBinding(
      f.env,
      readBasicRuntimeSettings(f.env),
      utcInstant(text),
    );
    assert(binding.expiresAtUtc === utcInstant(END));
  }
});

Deno.test("renewed binding rejects the exact season endpoint and later with safe503", async () => {
  const f = await seasonFixture();
  for (const text of [END, "2027-01-01T00:00:00Z"]) {
    let error: unknown;
    try {
      await readApprovedRuntimeBinding(f.env, readBasicRuntimeSettings(f.env), utcInstant(text));
    } catch (value) {
      error = value;
    }
    assert(error instanceof AccessError);
    equal(error.http, 503);
  }
});

Deno.test("year-end renewal does not change scopes limits leases or silently extend old bindings", async () => {
  const old = await syntheticRuntimeBinding(), extended = await seasonFixture();
  equal(extended.descriptor.scope, old.descriptor.scope);
  equal(extended.descriptor.limits, old.descriptor.limits);
  const binding = await extended.load(), original = await old.load();
  equal(
    Object.entries(binding.usageStoreLimits).map(([k, v]) => [k, v.toString()]),
    Object.entries(original.usageStoreLimits).map(([k, v]) => [k, v.toString()]),
  );
  equal(binding.readLimits, original.readLimits);
  equal(binding.operations, original.operations);
  let error: unknown;
  try {
    await readApprovedRuntimeBinding(
      old.env,
      readBasicRuntimeSettings(old.env),
      utcInstant("2026-12-01T00:00:00Z"),
    );
  } catch (value) {
    error = value;
  }
  assert(error instanceof AccessError);
  equal(error.http, 503);
});
