import "./crawl-policy.test.mjs";
import "./pro-tips.test.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { professionalMutationOrigin } from "../src/lib/professional-bff-origin.ts";

const origin = "https://synthetic-bff.invalid";
const h = (input = {}) => new Headers(input);
test("same-origin browser mutation gets the exact configured origin", () => {
  assert.deepEqual(professionalMutationOrigin(origin, h({ origin, "sec-fetch-site": "same-origin" })), { ok: true, origin });
});
test("exact origin remains required for same-site requests", () => {
  assert.equal(professionalMutationOrigin(origin, h({ origin: "https://other.synthetic-bff.invalid", "sec-fetch-site": "same-site" })).ok, false);
});
test("foreign origin is rejected even with a forged verified header", () => {
  assert.deepEqual(professionalMutationOrigin(origin, h({ origin: "https://untrusted.invalid", "x-jungsi-csrf-verified": "1" })), { ok: false, status: 403, code: "professional_csrf_failed" });
});
test("missing browser origin is rejected even with a forged verified header", () => {
  assert.equal(professionalMutationOrigin(origin, h({ "x-jungsi-csrf-verified": "1" })).ok, false);
});
test("cross-site fetch metadata is rejected", () => {
  assert.equal(professionalMutationOrigin(origin, h({ origin, "sec-fetch-site": "cross-site" })).ok, false);
});
test("older clients without fetch metadata still require exact browser origin", () => {
  assert.deepEqual(professionalMutationOrigin(origin, h({ origin })), { ok: true, origin });
});
test("missing deployment origin fails closed as configuration error", () => {
  assert.deepEqual(professionalMutationOrigin(undefined, h({ origin })), { ok: false, status: 503, code: "pro_bff_origin_not_configured" });
});
test("non-HTTPS origin configuration is not accepted", () => {
  assert.equal(professionalMutationOrigin("http://synthetic-bff.invalid", h({ origin: "http://synthetic-bff.invalid" })).ok, false);
});
test("configuration must be an origin without path, query, credentials or trailing slash", () => {
  for (const invalid of [origin + "/path", origin + "/", origin + "?x=1", origin + "#x", "https://user:password@synthetic-bff.invalid"]) {
    assert.deepEqual(professionalMutationOrigin(invalid, h({ origin: invalid })), { ok: false, status: 503, code: "pro_bff_origin_not_configured" });
  }
});
test("unknown fetch metadata cannot assert same-origin", () => {
  assert.equal(professionalMutationOrigin(origin, h({ origin, "sec-fetch-site": "none" })).ok, false);
});

// Load the actual server adapter with only framework/fixture dependencies replaced.
// fetch never leaves this process, and all tokens and identifiers below are invented.
registerHooks({ resolve(specifier, context, nextResolve) {
  const js = (code) => ({ url: "data:text/javascript," + encodeURIComponent(code), shortCircuit: true });
  if (specifier === "server-only") return js("export {};");
  if (specifier === "next/headers") return js("export async function headers(){ return globalThis.__proOriginHeaders; }");
  if (context.parentURL?.endsWith("/api/pro-source.ts")) {
    if (specifier === "./index") return js("export function apiMode(){return 'live';}");
    if (specifier === "./synthetic-assessment") return js("export const CATALOG=[]; export function assess(){throw Error('not used');} export function buildCandidates(){throw Error('not used');}");
    if (specifier === "./synthetic-report") return js("export function computeOverall(){throw Error('not used');} export function computeProvisional(){throw Error('not used');}");
    if (specifier === "./synthetic-tips") return js("export function buildTips(){throw Error('not used');}");
    if (specifier === "./synthetic") return js("export function readSyntheticState(){throw Error('not used in live transport verification');}");
    if (specifier === "./source" || specifier === "../professional-bff-origin") return nextResolve(new URL(specifier + ".ts", context.parentURL).href, context);
  }
  return nextResolve(specifier, context);
} });
const { proSource } = await import("../src/lib/api/pro-source.ts");
const caller = { accessToken: "invented-jwt-for-offline-transport-only" };
async function withTransport(headers, configured, work) {
  const priorFetch = globalThis.fetch;
  const prior = Object.fromEntries(["JUNGSI_PRO_API_URL", "JUNGSI_PRO_BFF_ORIGIN", "JUNGSI_RELAY_TOKEN"].map((k) => [k, process.env[k]]));
  const calls = [];
  try {
    process.env.JUNGSI_PRO_API_URL = "https://synthetic-api.invalid/functions/v1/pro";
    if (configured === undefined) delete process.env.JUNGSI_PRO_BFF_ORIGIN;
    else process.env.JUNGSI_PRO_BFF_ORIGIN = configured;
    process.env.JUNGSI_RELAY_TOKEN = "invented-relay-for-offline-transport-only";
    globalThis.__proOriginHeaders = headers;
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ data: { student_id: "synthetic-student" } }, { status: 201 }); };
    await work(calls);
  } finally {
    globalThis.fetch = priorFetch;
    for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete globalThis.__proOriginHeaders;
  }
}
test("actual adapter sends proof, relay and exact bearer after browser-origin validation", async () => {
  await withTransport(h({ origin, "sec-fetch-site": "same-origin" }), origin, async (calls) => {
    const result = await proSource().createStudent(caller, "synthetic-org", { display_name: "가상 학생", class_label: null, class_number: null, tags: [], memo: null }, 2, "synthetic-idempotency");
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, "https://synthetic-api.invalid/functions/v1/pro/api/v1/pro/organizations/synthetic-org/students");
    assert.equal(init.headers.get("origin"), origin);
    assert.equal(init.headers.get("x-jungsi-csrf-verified"), "1");
    assert.equal(init.headers.get("authorization"), "Bearer " + caller.accessToken);
    assert.equal(init.headers.get("x-jungsi-relay-token"), "invented-relay-for-offline-transport-only");
    assert.equal(JSON.parse(init.body).expected_contract_version, 2);
    assert.equal(init.cache, "no-store");
  });
});
test("actual adapter rejects foreign Origin before fetch despite forged proof header", async () => {
  await withTransport(h({ origin: "https://untrusted.invalid", "x-jungsi-csrf-verified": "1" }), origin, async (calls) => {
    await assert.rejects(proSource().createStudent(caller, "synthetic-org", {}, 2, "synthetic-idempotency"), (e) => e.status === 403 && e.code === "professional_csrf_failed");
    assert.equal(calls.length, 0);
  });
});
test("actual adapter rejects missing deployment origin before fetch", async () => {
  await withTransport(h({ origin }), undefined, async (calls) => {
    await assert.rejects(proSource().createStudent(caller, "synthetic-org", {}, 2, "synthetic-idempotency"), (e) => e.kind === "unconfigured" && e.code === "pro_bff_origin_not_configured");
    assert.equal(calls.length, 0);
  });
});
