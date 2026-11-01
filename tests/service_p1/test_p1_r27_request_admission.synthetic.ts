import { P1R27RequestAdmission } from "../../supabase/functions/_shared/jungsi/infrastructure/p1_r27_request_admission.ts";
import { verifyExpiryClockHttpScenarios } from "./p1_r27_expiry_clock_http.synthetic_support.ts";

const token = "S".repeat(48);
const relay = "R".repeat(48);
const h = (letter: string) => letter.repeat(64);
const pinNames = ["headSha256", "manifestSha256", "sourceHeadSha256", "scopeSha256", "indexSha256",
  "coverageSha256", "globalReceiptSha256", "consumerReceiptSha256", "consumerBuildSha256",
  "consumerContractSha256"] as const;
const pins = Object.fromEntries(pinNames.map((n, i) => [n, "0123456789"[i].repeat(64)])) as Record<typeof pinNames[number], string>;
const binding = {
  descriptorSha256: h("a"), expiresAtUtc: 900n,
  operations: ["history.snapshot.head", "history.snapshot.read"],
  readLimits: { maxBytes: 8192 },
  readViews: { snapshot: { scopeSha256: pins.scopeSha256, maxMetadataBytes: 4096 } },
};
const selector = (owner = "synthetic-user", op = "history.snapshot.read") => ({
  operation: op, session: { evaluatedAtUtc: 100n, user: { subjectId: owner, expiresAtUtc: 800n } },
});
const expected = () => ({
  headSha256: pins.headSha256, manifestSha256: pins.manifestSha256, scopeSha256: pins.scopeSha256,
  consumerBuildSha256: pins.consumerBuildSha256, consumerContractSha256: pins.consumerContractSha256,
});
const request = (value: string | undefined = token) => new Request("https://example.invalid/synthetic", {
  headers: value === undefined ? {} : { "X-Jungsi-P1-R27-Consumer-Credential": value },
});
async function sha(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function descriptor(changes: Record<string, unknown> = {}, credential = token) {
  return {
    format: "jungsi.p1-r27-server-admission/v1",
    status: "approved", purpose: "history_snapshot_r27_consumer",
    api_binding_sha256: binding.descriptorSha256,
    approval_reference_sha256: h("b"), deployment_evidence_sha256: h("c"),
    consumer_id: "synthetic-consumer", credential_sha256: await sha(credential),
    expires_at_utc_micros: "700",
    operations: ["history.snapshot.head", "history.snapshot.read"],
    max_extra_bytes: 4096, max_index_bytes: 2048, pins: { ...pins }, ...changes,
  };
}
async function env(desc?: unknown, relayValue = relay, rawOverride?: string) {
  const raw = rawOverride ?? (desc === undefined ? undefined : JSON.stringify(desc));
  const values = new Map<string, string>();
  if (raw !== undefined) {
    values.set("JUNGSI_P1_R27_CONSUMER_BINDING_JSON", raw);
    values.set("JUNGSI_P1_R27_CONSUMER_BINDING_SHA256", await sha(raw));
  }
  values.set("JUNGSI_RELAY_TOKEN", relayValue);
  return { get: (key: string) => values.get(key), values };
}
function check(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(work: () => unknown | Promise<unknown>) {
  let rejected = false;
  try { await work(); } catch (error) {
    rejected = true;
    const message = error instanceof Error ? error.message : "";
    check(!message.includes(token) && !message.includes("synthetic-user"), "secret or identity in error");
  }
  check(rejected, "expected rejection");
}
async function noAdmission(settings: { get(name: string): string | undefined }) {
  const req = request(), exec = selector(), guard = configGuard(req);
  await guard.prepare(settings, binding, req, exec);
  check(guard.take(exec, exec.session.user.subjectId) === undefined);
  guard.assertCurrent();
}
function configGuard(req: Request, now = () => 100n) {
  return new P1R27RequestAdmission(req, now);
}
async function issued(now = () => 100n) {
  const req = request(), exec = selector(), guard = configGuard(req, now), settings = await env(await descriptor());
  await guard.prepare(settings, binding, req, exec);
  const result = guard.take(exec, exec.session.user.subjectId);
  check(result);
  return { req, exec, guard, result, settings };
}
Deno.test("no R27 settings preserves no-admission v1 path", async () => {
  const req = request(undefined), exec = selector(), guard = configGuard(req);
  await guard.prepare(await env(), binding, req, exec);
  check(guard.take(exec, exec.session.user.subjectId) === undefined);
});
Deno.test("valid dedicated credential yields one request-local synchronous admission", async () => {
  const { result, guard } = await issued();
  check(Object.keys(result.trust.pins).length === 10);
  result.admission.assertBoundConsumer(expected());
  await rejects(() => result.admission.assertBoundConsumer(expected()));
  guard.close();
  for (const mode of ["detached", "call-undefined", "call-foreign", "bound"]) {
    const a = await issued();
    check(Object.isFrozen(a.result.admission));
    const method = a.result.admission.assertBoundConsumer;
    const hostile = Object.defineProperty({}, "used", { get() { throw new Error("receiver accessed"); } });
    if (mode === "detached") method(expected());
    if (mode === "call-undefined") method.call(undefined, expected());
    if (mode === "call-foreign") method.call(hostile, expected());
    if (mode === "bound") method.bind(hostile)(expected());
    a.guard.assertCurrent();
    await rejects(() => method(expected()));
    a.guard.close();
  }
  const left = await issued(), right = await issued();
  const first = left.result.admission.assertBoundConsumer;
  first.call(right.result.admission, expected());
  right.result.admission.assertBoundConsumer(expected());
  await rejects(() => first(expected()));
  await rejects(() => right.result.admission.assertBoundConsumer(expected()));
  left.guard.close(); right.guard.close();
  const closed = await issued(), detached = closed.result.admission.assertBoundConsumer;
  closed.guard.close();
  await rejects(() => detached(expected()));
});
Deno.test("missing and incorrect consumer credential do not authorize v2", async () => {
  for (const credential of [undefined, "Z".repeat(48), "bad,duplicate"]) {
    const req = credential === undefined ? new Request("https://example.invalid/") : request(credential);
    const exec = selector(), guard = configGuard(req);
    await guard.prepare(await env(await descriptor()), binding, req, exec);
    check(guard.take(exec, exec.session.user.subjectId) === undefined);
  }
});
Deno.test("a fresh authenticated user can obtain a distinct request capability", async () => {
  for (const owner of ["synthetic-user-a", "synthetic-user-b"]) {
    const req = request(), exec = selector(owner), guard = configGuard(req);
    await guard.prepare(await env(await descriptor()), binding, req, exec);
    const result = guard.take(exec, owner); check(result);
    result.admission.assertBoundConsumer(expected()); guard.close();
  }
});
Deno.test("request or user substitution and admission reuse fail", async () => {
  const req = request(), exec = selector(), guard = configGuard(req);
  await rejects(() => guard.prepare(envSync(), binding, request(), exec));
  function envSync() { return { get: (_: string) => undefined }; }
  const first = await issued();
  await rejects(() => first.guard.take(selector("other-user"), "other-user"));
  first.result.admission.assertBoundConsumer(expected());
  await rejects(() => first.result.admission.assertBoundConsumer(expected()));
  const second = await issued();
  second.exec.session.user.subjectId = "another-user";
  await rejects(() => second.result.admission.assertBoundConsumer(expected()));
  const third = await issued();
  third.guard.close();
  await rejects(() => third.result.admission.assertBoundConsumer(expected()));
});
Deno.test("operation mutation and unapproved operation cannot issue v2 admission", async () => {
  const issuedRequest = await issued();
  issuedRequest.exec.operation = "history.snapshot.head";
  await rejects(() => issuedRequest.result.admission.assertBoundConsumer(expected()));
  const req = request(), exec = selector(), guard = configGuard(req);
  const d = await descriptor({ operations: ["history.snapshot.head"] });
  await guard.prepare(await env(d), binding, req, exec);
  check(guard.take(exec, exec.session.user.subjectId) === undefined);
});
Deno.test("descriptor or user expiration rejects synchronously at use", async () => {
  let now = 100n;
  const a = await issued(() => now); now = 700n;
  await rejects(() => a.result.admission.assertBoundConsumer(expected()));
  now = 100n;
  const b = await issued(() => now); now = 800n;
  await rejects(() => b.result.admission.assertBoundConsumer(expected()));
});
Deno.test("partial settings, mismatched pin and bad digest issue no v2 capability", async () => {
  const desc = await descriptor(), settings = await env(desc);
  settings.values.delete("JUNGSI_P1_R27_CONSUMER_BINDING_SHA256");
  await noAdmission(settings);
  for (const bad of [
    await descriptor({ api_binding_sha256: h("f") }),
    await descriptor({ pins: { ...pins, scopeSha256: h("f") } }),
    await descriptor({ expires_at_utc_micros: "901" }),
    await descriptor({ expires_at_utc_micros: "100" }),
    await descriptor({ unknown: true }),
  ]) await noAdmission(await env(bad));
  const malformed = await env(desc); malformed.values.set("JUNGSI_P1_R27_CONSUMER_BINDING_SHA256", h("f"));
  await noAdmission(malformed);
});
Deno.test("descriptor parser rejects duplicate keys even with matching bytes digest", async () => {
  const desc = await descriptor();
  const raw = JSON.stringify(desc).replace('"status":"approved"', '"status":"approved","status":"approved"');
  await noAdmission(await env(undefined, relay, raw));
});
Deno.test("a shared relay credential cannot be used as dedicated consumer credential", async () => {
  const req = request(relay), exec = selector(), guard = configGuard(req);
  await guard.prepare(await env(await descriptor({}, relay)), binding, req, exec);
  check(guard.take(exec, exec.session.user.subjectId) === undefined);
});
Deno.test("pin substitution and limits fail closed", async () => {
  const a = await issued();
  await rejects(() => a.result.admission.assertBoundConsumer({ ...expected(), consumerBuildSha256: h("f") }));
  for (const bad of [
    await descriptor({ max_extra_bytes: 8193 }),
    await descriptor({ max_index_bytes: 4097 }),
    await descriptor({ operations: ["history.snapshot.read", "history.snapshot.read"] }),
    await descriptor({ pins: { ...pins, consumerContractSha256: "not-a-sha" } }),
  ]) await noAdmission(await env(bad));
});
Deno.test("returned capability does not contain credential or subject", async () => {
  const a = await issued();
  const text = JSON.stringify(a.result);
  check(!text.includes(token) && !text.includes("synthetic-user"));
});
Deno.test("v2 admission is rechecked after work for expiry and config revocation", async () => {
  let now = 100n;
  const a = await issued(() => now);
  a.result.admission.assertBoundConsumer(expected());
  a.guard.assertCurrent();
  now = 700n;
  await rejects(() => a.guard.assertCurrent());
  const b = await issued();
  b.result.admission.assertBoundConsumer(expected());
  b.settings.values.delete("JUNGSI_P1_R27_CONSUMER_BINDING_JSON");
  await rejects(() => b.guard.assertCurrent());
  const req = request(), exec = selector(), v1 = configGuard(req, () => 900n);
  await rejects(async () => v1.prepare(await env(await descriptor()), binding, req, exec));
  const cReq = request(), cExec = selector(), noV2 = configGuard(cReq);
  await noV2.prepare(await env(), binding, cReq, cExec);
  check(noV2.take(cExec, cExec.session.user.subjectId) === undefined);
  noV2.assertCurrent();
  const settings = await env(await descriptor());
  for (const value of [undefined, null, 100, "100", -1n, 101n]) {
    const badReq = request(), badExec = selector(); (badExec.session as any).evaluatedAtUtc = value;
    await rejects(() => configGuard(badReq).prepare(settings, binding, badReq, badExec));
  }
  for (const value of [99n, 100n]) {
    const okReq = request(), okExec = selector(); okExec.session.evaluatedAtUtc = value;
    const okGuard = configGuard(okReq); await okGuard.prepare(settings, binding, okReq, okExec);
    const result = okGuard.take(okExec, okExec.session.user.subjectId); check(result);
    result.admission.assertBoundConsumer(expected()); okGuard.close();
  }
  await verifyExpiryClockHttpScenarios();
});

Deno.test("unexpected environment and common relay failures are not swallowed", async () => {
  const settings=await env(await descriptor());
  const unexpected={get:(key:string)=>{
    if(key==="JUNGSI_P1_R27_CONSUMER_BINDING_JSON")throw new Error("SYNTHETIC_ENV_FAILURE");
    return settings.get(key);
  }};
  const req=request(),exec=selector();
  await rejects(()=>configGuard(req).prepare(unexpected,binding,req,exec));
  const noRelay={get:(key:string)=>key==="JUNGSI_RELAY_TOKEN"?undefined:settings.get(key)};
  const next=request(),nextExec=selector();
  await rejects(()=>configGuard(next).prepare(noRelay,binding,next,nextExec));
});
