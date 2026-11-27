import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

registerHooks({ resolve(specifier, context, next) {
  const parent = context.parentURL;
  if (parent?.endsWith(".ts") && specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    return next(new URL(`${specifier}.ts`, parent).href, context);
  }
  return next(specifier, context);
} });

const target = process.env.JUNGSI_ELIGIBILITY_FIXTURE
  ? pathToFileURL(process.env.JUNGSI_ELIGIBILITY_FIXTURE).href
  : new URL("../src/lib/candidate-eligibility.ts", import.meta.url).href;
const { blockedCandidateIds, confirmedIneligibleIds, holdIneligibleBand, isConfirmedIneligible, recommendableCandidates, withCandidateEligibility } = await import(target);

const offering = offering_id => ({ offering_id, university_id: "U", department: "학과", group: "가" });
const assessed = (id, assessment = { status: "ready" }) => ({ offering: offering(id), assessment });
const reference = (id, automatic_candidate = true) => ({ offering: offering(id), reference_band: { code: "stable", automatic_candidate } });
const group = offerings => ({ university_id: "U", offerings });
const pushed = { offering_id: "raw", category: "ineligible", reason_code: "original" };
const snapshot = {
  analyses: {
    local: { offering_id: "local", status: "ineligible", reason_code: "designated_subject_not_taken", converted_score: "267" },
    eligibility_status: { offering_id: "eligibility_status", status: "ready", eligibility_status: "ineligible" },
    stale: { offering_id: "stale", status: "ineligible" },
    raw: { offering_id: "raw", status: "ineligible", reason_code: "replacement" },
    wrong: { offering_id: "another", status: "ineligible" },
    unclear: { offering_id: "unclear", eligibility_status: "needs_confirmation" },
  },
  stale_analysis_ids: ["stale"],
  shortlist: { local: { selected: true } },
  candidates: {
    ineligible_offerings: [pushed], csat_condition_unmet: ["server"], csat_minimum_partial: ["partial"],
    basic_university_groups: [group([assessed("local"), assessed("nested", { status: "ineligible" }), assessed("ok")])],
    reference_university_groups: [group([reference("local"), reference("server"), reference("partial"), reference("manual-only", false), reference("stale"), reference("ok")])],
    wildcards: [assessed("raw"), assessed("ok")],
    wildcard_selection: { status: "ready", card_stability: [{ offering_id: "raw" }, { offering_id: "ok" }] },
  },
};

test("current assessment veto dominates a ready candidate without rewriting stored material", () => {
  const projected = withCandidateEligibility(snapshot);
  assert.deepEqual(projected.candidates.ineligible_offerings, [pushed,
    { offering_id: "local", category: "ineligible", reason_code: "designated_subject_not_taken" },
    { offering_id: "eligibility_status", category: "ineligible", reason_code: "eligibility_not_met" },
  ]);
  assert.deepEqual(confirmedIneligibleIds({ analyses: snapshot.analyses, stale_analysis_ids: snapshot.stale_analysis_ids }), new Set(["local", "eligibility_status", "raw"]));
  assert.equal(isConfirmedIneligible(snapshot, "stale"), false);
  assert.equal(isConfirmedIneligible(snapshot, "wrong"), false);
  assert.deepEqual(blockedCandidateIds(projected.candidates), new Set(["server", "partial", "raw", "local", "eligibility_status"]));
  assert.equal(projected.shortlist, snapshot.shortlist);
  assert.equal(projected.analyses.local.converted_score, "267");
  assert.equal(projected.candidates.reference_university_groups, snapshot.candidates.reference_university_groups);
  assert.equal(withCandidateEligibility(projected), projected);
});

test("basic, reference and wildcard views share veto and preserve approved card order", () => {
  const actual = recommendableCandidates(snapshot.candidates, snapshot);
  const ids = rows => rows.map(row => row.offering.offering_id);
  assert.deepEqual(ids(actual.basic_university_groups[0].offerings), ["ok"]);
  assert.deepEqual(ids(actual.reference_university_groups[0].offerings), ["stale", "ok"]);
  assert.deepEqual(ids(actual.wildcards), ["ok"]);
  assert.deepEqual(actual.wildcard_selection.card_stability, [{ offering_id: "ok" }]);
  assert.equal(snapshot.candidates.wildcards.length, 2);
});

test("eligibility hides a conflicting band while retaining its numeric score", () => {
  const band = { code: "stable", school_score: { central: "267", low: "267", high: "267" } };
  assert.equal(holdIneligibleBand(band, false), band);
  assert.deepEqual(holdIneligibleBand(band, true), { ...band, held: true });
  assert.equal(holdIneligibleBand(null, true), null);
});

test("one malformed candidate payload field does not drop the valid parts of a report", () => {
  const oldReport = { ...snapshot, candidates: {
    ...snapshot.candidates, reference_university_groups: {},
    ineligible_offerings: [null], wildcard_selection: { status: "ready" },
  } };
  const actual = recommendableCandidates(oldReport.candidates, oldReport);
  assert.deepEqual(actual.basic_university_groups[0].offerings.map(row => row.offering.offering_id), ["ok"]);
  assert.deepEqual(actual.wildcard_selection.card_stability, []);
  assert.equal(actual.reference_university_groups, null);
});
