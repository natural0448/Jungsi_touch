// Invented inputs only; async test doubles preserve the order of the real ports.
// deno-lint-ignore-file require-await
import { assert, equal } from "../../../tests/edge/fixture.ts";
import { SyntheticReferenceBytes } from "../../../tests/edge/synthetic_school_reference.ts";
import { PinnedSchoolReferenceSource } from "./jungsi/infrastructure/school_reference_source.ts";
import { ATTENDANCE_AREAS } from "./jungsi/application/reference_attendance.ts";
import {
  type MyScore,
  scoreMapPin,
  ScoreMapService,
  type ScoreMapStore,
} from "./jungsi/application/score_map.ts";
import { utcInstant } from "./jungsi/domain/time.ts";
import type { NativeObject } from "./jungsi/domain/json_value.ts";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const OLD_REFERENCE: MyScore = {
  status: "reference",
  converted_score: "99",
  official_max_score: "100",
  reason_code: "reference_conversion_not_production_approved",
};
const OLD_PENDING: MyScore = {
  status: "pending",
  converted_score: null,
  official_max_score: null,
  reason_code: "conversion_release_missing",
};
const OLD_READY: MyScore = {
  status: "ready",
  converted_score: "22",
  official_max_score: "36",
  reason_code: null,
};
async function setup(required: boolean, cached?: MyScore) {
  const bytes = new SyntheticReferenceBytes();
  if (required) (bytes.body.domain as NativeObject).required_attendance = [...ATTENDANCE_AREAS];
  await bytes.seal();
  const synthetic = bytes.university, reference = new PinnedSchoolReferenceSource(bytes);
  const profile = synthetic.profile();
  (profile.scores.inquiry as NativeObject[])[0].percentile = 31;
  (profile.scores.inquiry as NativeObject[])[1].percentile = 17;
  const state = {
    mode: "reference" as "reference" | "missing" | "approved",
    reads: 0,
    inserts: 0,
    attempts: 0,
  };
  const rows = new Map<string, MyScore>();
  const oid = synthetic.offering.offering_id as string;
  if (cached) rows.set(oid, cached);
  const store: ScoreMapStore = {
    async latestProfile(owner) {
      return owner === OWNER ? profile : null;
    },
    async read(owner) {
      assert(owner === OWNER);
      state.reads++;
      return new Map(rows);
    },
    async insert(owner, pid, _pin, values) {
      assert(owner === OWNER && pid === profile.profile_id);
      state.inserts++;
      // Same insert-only conflict behavior as migration 011.
      for (const { offering_id, ...score } of values) {
        if (!rows.has(offering_id)) rows.set(offering_id, score);
      }
    },
  };
  const data = {
    getExamPack: synthetic.getExamPack.bind(synthetic),
    async getConversion(id: string) {
      state.attempts++;
      return state.mode === "approved" ? await synthetic.getConversion(id) : null;
    },
    async getReference(id: string) {
      return state.mode === "reference" ? await reference.getReference(id) : null;
    },
    async getCatalog() {
      return {
        version: "SYNTHETIC-catalog",
        status: "approved" as const,
        asOfUtc: 1n,
        offerings: [synthetic.offering],
        history: [],
      };
    },
  };
  const pin = () =>
    scoreMapPin({ registry: { sha256: "a".repeat(64) }, selection: { sha256: "b".repeat(64) } });
  const clock = { nowUtc: () => utcInstant("2026-11-10T00:00:00Z") };
  const service = new ScoreMapService(store, data, pin, clock);
  return { service, state, rows, oid, items: [synthetic.offering], clock, pin, store, data };
}
Deno.test("cached reference cannot bypass required self reported attendance", async () => {
  const f = await setup(true, OLD_REFERENCE);
  const out = await f.service.attach(OWNER, f.items);
  const score = out.items[0].my_score as NativeObject;
  equal(score.status, "pending");
  equal(score.reason_code, "reference_attendance_confirmation_required");
  equal(score.converted_score, null);
  equal(f.rows.get(f.oid), OLD_REFERENCE);
  equal(f.state.inserts, 0);
  equal(f.state.attempts, 1);
});
Deno.test("reference without attendance requirement remains visible after verification", async () => {
  const f = await setup(false, OLD_REFERENCE);
  const out = await f.service.attach(OWNER, f.items);
  const score = out.items[0].my_score as NativeObject;
  equal(score.status, "reference");
  equal(score.converted_score, "31.00");
  equal(score.reason_code, "reference_conversion_not_production_approved");
  equal(f.rows.get(f.oid), OLD_REFERENCE);
  equal(f.state.inserts, 0);
});
Deno.test("transient pending is not inserted and can become approved ready", async () => {
  const f = await setup(false);
  f.state.mode = "missing";
  const first = await f.service.attach(OWNER, f.items);
  equal((first.items[0].my_score as NativeObject).status, "pending");
  equal(f.state.inserts, 0);
  equal(f.rows.size, 0);
  f.state.mode = "approved";
  const second = await f.service.attach(OWNER, f.items);
  equal((second.items[0].my_score as NativeObject).status, "ready");
  equal(f.state.inserts, 1);
  equal(f.rows.get(f.oid)?.status, "ready");
});
Deno.test("historical pending never masks newly ready score and is not modified", async () => {
  const f = await setup(false, OLD_PENDING);
  f.state.mode = "approved";
  const first = await f.service.attach(OWNER, f.items);
  equal((first.items[0].my_score as NativeObject).status, "ready");
  equal(f.rows.get(f.oid), OLD_PENDING);
  const second = await f.service.attach(OWNER, f.items);
  equal((second.items[0].my_score as NativeObject).status, "ready");
  equal(f.state.attempts, 2);
});
Deno.test("approved cached score stays available to its owner only", async () => {
  const f = await setup(false, OLD_READY);
  const first = await f.service.attach(OWNER, f.items);
  equal(first.items[0].my_score, OLD_READY);
  equal(f.state.attempts, 0);
  const other = await f.service.attach(OTHER, f.items);
  equal(other.state, "no_profile");
  equal(other.items[0].my_score, null);
  equal(f.state.reads, 1);
});
Deno.test("reference results count toward unchanged per request calculation limit", async () => {
  const f = await setup(false);
  const another = { ...f.items[0], offering_id: "SYNTHETIC-other" };
  const data = {
    ...f.data,
    async getCatalog() {
      return {
        version: "SYNTHETIC-catalog",
        status: "approved" as const,
        asOfUtc: 1n,
        offerings: [f.items[0], another],
        history: [],
      };
    },
  };
  const service = new ScoreMapService(f.store, data, f.pin, f.clock, {
    maxComputePerRequest: 1,
    computeBudgetMs: 3000,
  });
  const out = await service.attach(OWNER, [f.items[0], another]);
  equal((out.items[0].my_score as NativeObject).status, "reference");
  equal(out.items[1].my_score, null);
  equal(f.state.attempts, 1);
});
