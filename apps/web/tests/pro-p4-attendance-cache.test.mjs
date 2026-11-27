import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const src = new URL("../src/lib/", import.meta.url);
const target = process.env.JUNGSI_PRO_P4_FIXTURE
  ? pathToFileURL(process.env.JUNGSI_PRO_P4_FIXTURE).href
  : new URL("pro-p4.ts", src).href;
const data = s => "data:text/javascript," + encodeURIComponent(s);
const ports = new Map([
  ["server-only", data("export {}")],
  ["@/lib/report-pure", data("export const schoolDisplayOf = () => ({});")],
  ["@/lib/candidate-eligibility", new URL("candidate-eligibility.ts", src).href],
  ["@/lib/api", data("export class AccessDenied extends Error{}; export class ConnectionError extends Error{};")],
  ["@/lib/api/pro-source", data("export const proSource = () => globalThis.__proP4AttendanceSource; export const validId = () => true;")],
  ["@/lib/exam", data("export const EXAM = {}; export const stageOf = () => null;")],
  ["@/lib/pro-access", data("export const proAccess = async () => [];")],
  ["@/lib/pro-stage", data("export const currentStage = async () => null;")],
]);
registerHooks({ resolve(id, context, next) { return next(ports.get(id) ?? id, context); } });

const { proP4 } = await import(target);
const id = "2027:9000000001";
const band = { basis: "reference_threshold", source: "g", code: "stable", school_score: { central: "267", low: "267", high: "267" } };
const candidates = { reference_threshold_summary: { complete: true }, reference_university_groups: [{ offerings: [{ offering: { offering_id: id }, reference_band: band }] }] };
const p = { svc: { org_id: "test-org" }, student: { student_id: "test-student" }, shown: { report_id: "test-report", profile_id: "test-profile" } };
const req = { offering_ids: [id] };

test("expert equal-profile requests recheck the active policy and retain only the numeric score on conflict", async () => {
  const calls = [];
  globalThis.__proP4AttendanceSource = {
    async analyzeP4(...args) {
      calls.push(args);
      return { ok: true, value: { candidates: calls.length === 1 ? candidates : { ...candidates, csat_condition_unmet: [id] } } };
    },
  };
  const first = await proP4({}, p, req);
  const second = await proP4({}, p, req);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(1, 4), calls[1].slice(1, 4));
  assert.notEqual(calls[0][4], calls[1][4], "older idempotent output cannot be replayed for a fresh judgment request");
  assert.equal(first.bands[id], band);
  assert.deepEqual(second.bands[id], { ...band, held: true });
  assert.equal(second.bands[id].school_score.central, "267");
  assert.deepEqual(second.groups[0].offerings[0].reference_band, second.bands[id]);
  assert.equal(candidates.reference_university_groups[0].offerings[0].reference_band.held, undefined);
  assert.equal(second.min[id], "condition");
});
