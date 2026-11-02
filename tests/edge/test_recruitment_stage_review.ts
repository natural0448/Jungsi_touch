/** Synthetic internal DTO checks. No public route, authority, DB or publication. */
import {
  assembleRecruitmentStageReview as build,
  readOperatingRecruitmentStages,
} from "../../supabase/functions/_shared/jungsi/application/recruitment_stage_review.ts";
import { assert, equal } from "./fixture.ts";

const id = {
  academic_year: 2027,
  school_id: "SYN-SCHOOL",
  original_pk: "SYN-PK",
  campus: "SYN-CAMPUS",
  admission_track: "SYN-TRACK",
  group: "SYN-GROUP",
};
const proof = (override: Record<string, unknown> = {}) => ({
  identity: { ...id },
  source_revision_sha256: "a".repeat(64),
  source_sha256: "b".repeat(64),
  source_ref: "SYN-PUBLIC-SOURCE",
  approval_disposition: "approved_public_source",
  ...override,
});
const fact = (
  stage: string,
  value: unknown,
  state = "reported",
  override: Record<string, unknown> = {},
) => ({ stage, state, value, unit: "명", proof: proof(), ...override });
const initial = (value: unknown, override: Record<string, unknown> = {}) =>
  fact("initial", value, "reported", override);
const final = (
  value: unknown,
  state = "reported",
  override: Record<string, unknown> = {},
) => fact("final", value, state, override);
const input = (override: Record<string, unknown> = {}) => ({
  format: "jungsi.recruitment-stage-source-review/v1",
  identity: { ...id },
  source_revision_sha256: "a".repeat(64),
  legacy_quota: { quota_value: 0, quota_stage: "initial" },
  release_disposition: "hold",
  facts: [initial(0), final(null, "pending")],
  condition: { text: "SYN-CARRYOVER-CONDITION", proof: proof() },
  ...override,
});
function at(raw: unknown, path: string): unknown {
  let value = raw;
  for (const key of path.split(".")) {
    assert(value !== null && typeof value === "object");
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
function is(actual: unknown, expected: unknown) {
  assert(Object.is(actual, expected));
}
function throws(action: () => unknown, code: RegExp) {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Error && code.test(caught.message));
}
function without(raw: Record<string, unknown>, field: string) {
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== field),
  );
}

Deno.test("stage review initial zero condition and explicit pending null remain separate", () => {
  const out = build(input());
  is(at(out, "stages.initial.value"), 0);
  is(at(out, "stages.final.value"), null);
  is(at(out, "stages.final.state"), "pending");
  is(at(out, "condition.text"), "SYN-CARRYOVER-CONDITION");
  is(out.public_payload, null);
  is(out.calculation_quota, null);
  is(out.publication_allowed, false);
});
Deno.test("stage review independently reported final zero stays zero", () => {
  const out = build(input({ facts: [initial(0), final(0)] }));
  is(at(out, "stages.final.value"), 0);
  is(at(out, "stages.final.state"), "reported");
});
Deno.test("stage review positive final does not overwrite initial", () => {
  const out = build(input({ facts: [initial(0), final(3)] }));
  is(at(out, "stages.initial.value"), 0);
  is(at(out, "stages.final.value"), 3);
});
Deno.test("stage review absent initial never becomes zero", () => {
  const out = build(
    input({ legacy_quota: {}, facts: [final(null, "pending")] }),
  );
  is(at(out, "stages.initial.state"), "not_supplied");
  assert(!Object.hasOwn(at(out, "stages.initial") as object, "value"));
});
Deno.test("stage review absent final differs from explicit pending null", () => {
  const out = build(input({ facts: [initial(0)] }));
  is(at(out, "stages.final.value_present"), false);
  assert(!Object.hasOwn(at(out, "stages.final") as object, "value"));
  is(at(build(input()), "stages.final.value_present"), true);
});
Deno.test("stage review pending source withholds all facts and condition", () => {
  const out = build(
    input({
      facts: [
        initial(0, {
          proof: proof({ approval_disposition: "review_pending" }),
        }),
      ],
    }),
  );
  is(out.stages, null);
  is(out.condition, null);
  is(out.source_disposition, "review_pending");
});
Deno.test("stage review source assertion is never issuer verification", () => {
  const out = build(input());
  is(
    out.source_disposition,
    "source_port_asserted_approved_NOT_AUTHORITY_VERIFIED",
  );
  is(out.public_payload, null);
});
Deno.test("stage review missing source evidence is rejected", () => {
  throws(
    () =>
      build(
        input({
          facts: [initial(0, { proof: without(proof(), "source_ref") })],
        }),
      ),
    /missing_field/,
  );
});
for (
  const field of [
    "school_id",
    "original_pk",
    "campus",
    "admission_track",
    "group",
  ]
) {
  Deno.test("stage review cross scope " + field + " is rejected", () => {
    throws(
      () =>
        build(
          input({
            facts: [
              initial(0, {
                proof: proof({ identity: { ...id, [field]: "SYN-OTHER" } }),
              }),
            ],
          }),
        ),
      /source_scope_mismatch/,
    );
  });
}
Deno.test("stage review facts from different source revisions cannot join", () => {
  throws(
    () =>
      build(
        input({
          facts: [
            initial(0),
            final(3, "reported", {
              proof: proof({ source_revision_sha256: "f".repeat(64) }),
            }),
          ],
        }),
      ),
    /source_binding_mismatch/,
  );
});
Deno.test("stage review numeric string and bigint preserve native types", () => {
  for (const value of ["0", 0n]) {
    const out = build(
      input({
        legacy_quota: { quota_value: value, quota_stage: "initial" },
        facts: [initial(value)],
      }),
    );
    is(at(out, "stages.initial.value"), value);
  }
});
Deno.test("stage review legacy string conflict is rejected", () => {
  throws(
    () =>
      build(
        input({ legacy_quota: { quota_value: "0", quota_stage: "initial" } }),
      ),
    /legacy_stage_conflict/,
  );
});
Deno.test("stage review leaves input and legacy quota unchanged", () => {
  const raw = input(), before = structuredClone(raw);
  build(raw);
  equal(raw, before);
});
Deno.test("stage review pending zero is rejected", () => {
  throws(
    () => build(input({ facts: [initial(0), final(0, "pending")] })),
    /pending_requires_explicit_null/,
  );
});
Deno.test("stage review duplicate stages cannot replace evidence", () => {
  throws(
    () => build(input({ facts: [initial(0), initial(0)] })),
    /duplicate_stage/,
  );
});
Deno.test("stage review condition alone cannot manufacture counts", () => {
  const out = build(input({ legacy_quota: {}, facts: [] }));
  is(at(out, "stages.initial.state"), "not_supplied");
  is(at(out, "stages.final.state"), "not_supplied");
  is(at(out, "condition.text"), "SYN-CARRYOVER-CONDITION");
});
Deno.test("stage review caller cannot inject release approval or private fields", () => {
  throws(
    () => build(input({ release_disposition: "approved" })),
    /release_cannot_be_approved_here/,
  );
  throws(() => build(input({ secret: "SYN-NO" })), /unknown_field/);
});
Deno.test("stage review operating entry refuses caller approval flags", async () => {
  let caught: unknown;
  try {
    await readOperatingRecruitmentStages({ verified: true, approved: true });
  } catch (error) {
    caught = error;
  }
  assert(
    caught instanceof Error &&
      caught.message === "STAGE_SOURCE_AND_CONSUMER_NOT_BOUND",
  );
});
Deno.test("stage review empty facts and condition do not assert approval", () => {
  const out = build(input({ legacy_quota: {}, facts: [], condition: null }));
  is(out.source_disposition, "review_pending");
  is(out.stages, null);
});
Deno.test("stage review legacy bigint conflict is rejected", () => {
  throws(
    () =>
      build(
        input({ legacy_quota: { quota_value: 0n, quota_stage: "initial" } }),
      ),
    /legacy_stage_conflict/,
  );
});
for (const field of ["campus", "admission_track", "group"]) {
  Deno.test("stage review invisible scope " + field + " is rejected", () => {
    throws(
      () => build(input({ identity: { ...id, [field]: " \u200b\u0301" } })),
      /incomplete_scope/,
    );
  });
}
Deno.test("stage review invisible source reference is rejected", () => {
  throws(
    () =>
      build(
        input({
          facts: [
            initial(0, { proof: proof({ source_ref: " \u2060\u0301" }) }),
          ],
        }),
      ),
    /source_binding_mismatch/,
  );
});
Deno.test("stage review whitespace and invisible condition text are rejected", () => {
  for (const text of ["   ", "\u200b", "\u0301"]) {
    throws(
      () => build(input({ condition: { text, proof: proof() } })),
      /invalid_condition/,
    );
  }
});
Deno.test("stage review visible scope preserves original whitespace", () => {
  const identity = { ...id, campus: " SYN-CAMPUS " };
  const boundProof = proof({ identity });
  const raw = input({
    identity,
    facts: [initial(0, { proof: boundProof })],
    condition: { text: "SYN-CONDITION", proof: boundProof },
  });
  const before = structuredClone(raw), out = build(raw);
  is(at(out, "identity.campus"), " SYN-CAMPUS ");
  equal(raw, before);
});
Deno.test("stage review pending unit must be explicit and may be null", () => {
  throws(
    () =>
      build(
        input({ facts: [initial(0), without(final(null, "pending"), "unit")] }),
      ),
    /missing_field/,
  );
  is(
    at(
      build(
        input({ facts: [initial(0), final(null, "pending", { unit: null })] }),
      ),
      "stages.final.unit",
    ),
    null,
  );
});
Deno.test("stage review reported unit is mandatory and persons", () => {
  throws(
    () => build(input({ facts: [without(initial(0), "unit")] })),
    /missing_field/,
  );
  throws(
    () => build(input({ facts: [initial(0, { unit: null })] })),
    /invalid_reported_count/,
  );
});
