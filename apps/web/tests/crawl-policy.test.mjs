import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { CRAWL_ROBOTS } from "../src/lib/crawl-policy.ts";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
class SyntheticNextResponse extends Response {
  static next() { return new SyntheticNextResponse(null); }
}
function loadProxy(env = {}) {
  const code = stripTypeScriptTypes(read("../src/proxy.ts"), { mode: "transform" })
    .replace(/^import[^\n]+\n/gm, "")
    .replaceAll("export async function proxy", "async function proxy")
    .replaceAll("export const config", "const config");
  let authCalls = 0;
  const forbidden = () => { authCalls++; throw new Error("No real auth or data request allowed"); };
  const value = new Function("NextResponse", "createServerClient", "ignoreCookieWrites", "noRefreshFetch", "CRAWL_ROBOTS", "process", code + "; return {proxy, config};")
    (SyntheticNextResponse, forbidden, () => {}, forbidden, CRAWL_ROBOTS, { env });
  return { ...value, authCalls: () => authCalls };
}
function nextConfig() {
  const code = stripTypeScriptTypes(read("../next.config.ts"), { mode: "transform" });
  const start = code.indexOf("const nextConfig =");
  const end = code.indexOf("export default nextConfig;");
  assert.ok(start > 0 && end > start);
  return new Function("appRoot", "CRAWL_ROBOTS", code.slice(start, end) + ";return nextConfig;")("/SYNTHETIC-app", CRAWL_ROBOTS);
}
test("crawl policy config covers the exact basePath without widening other EduTouch paths", async () => {
  const c = nextConfig(); assert.equal(c.basePath, "/jeongsi");
  const h = await c.headers(); assert.equal(h.length, 1); assert.equal(h[0].source, "/:path*");
  assert.equal(h[0].basePath, undefined); // Next's documented basePath prefix remains enabled.
  assert.deepEqual(h[0].headers, [{ key: "X-Robots-Tag", value: CRAWL_ROBOTS }]);
  assert.equal(h[0].has, undefined); assert.equal(h[0].missing, undefined); // not conditional on UA/auth/status
  const redirects = await c.redirects(); assert.equal(redirects.length, 5);
  assert.ok(redirects.every((r) => r.permanent === false));
});
test("crawl policy root HTML metadata carries all approved directives", () => {
  const layout = read("../src/app/layout.tsx");
  const m = layout.match(/export const metadata: Metadata = (\{[\s\S]*?\n\});/);
  assert.ok(m); const metadata = new Function("CRAWL_ROBOTS", "return (" + m[1] + ");")(CRAWL_ROBOTS);
  assert.equal(metadata.robots, "noindex, nofollow, noarchive, nosnippet");
});
test("crawl policy normal proxy retains no-store and adds HTTP directives across data and print paths", async () => {
  const f = loadProxy();
  for (const pathname of ["/", "/reports/me", "/pro/students/SYNTHETIC/print", "/api/SYNTHETIC", "/admin", "/does-not-exist"]) {
    const response = await f.proxy({ nextUrl: { pathname } });
    assert.equal(response.status, 200); assert.equal(response.headers.get("x-robots-tag"), CRAWL_ROBOTS);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(f.authCalls(), 0);
});
test("crawl policy preview denial remains closed and has HTML plus HTTP directives", async () => {
  const f = loadProxy({ JEONGSI_ACCESS_GATE: "preview" });
  const response = await f.proxy({ nextUrl: { pathname: "/pro" } });
  assert.equal(response.status, 403); assert.equal(response.headers.get("x-robots-tag"), CRAWL_ROBOTS);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok((await response.text()).includes(`<meta name="robots" content="${CRAWL_ROBOTS}">`));
  assert.equal(f.authCalls(), 0);
});
test("crawl policy changes add no user-agent authorization or broad robots auth exception", () => {
  const proxy = read("../src/proxy.ts");
  assert.ok(!/user-agent/i.test(proxy)); assert.ok(!/robots\.txt/.test(proxy));
  assert.ok(proxy.includes('process.env.JEONGSI_ACCESS_GATE === "preview"'));
});

test("crawl policy never treats ordinary or AI user-agent text as preview authorization", async () => {
  for (const agent of ["ordinary-browser", "Googlebot", "GPTBot", "ClaudeBot"]) {
    const f = loadProxy({ JEONGSI_ACCESS_GATE: "preview" });
    const response = await f.proxy({ nextUrl: { pathname: "/reports/me" }, headers: new Headers({ "user-agent": agent }) });
    assert.equal(response.status, 403); assert.equal(response.headers.get("x-robots-tag"), CRAWL_ROBOTS);
    assert.equal(f.authCalls(), 0);
  }
});
