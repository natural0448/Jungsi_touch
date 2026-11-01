/** Stage-specific transition tests using the shared in-memory fixture. */
import type { ApprovedOperatingPolicy } from "../../supabase/functions/_shared/jungsi/application/operating_policy.ts";
import { scoreInputBalance } from "../../supabase/functions/_shared/jungsi/domain/score_input_rights.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { assert, equal } from "./fixture.ts";
import {
  A,
  denied,
  nativeFixture,
  NOW,
  policy,
  scores,
  session,
} from "./synthetic_score_input_policy.ts";
function multiStagePolicy(): ApprovedOperatingPolicy {
  return policy((raw) => {
    const stages = raw.stages as NativeObject[];
    const base = stages[0];
    for (const stage of ["provisional", "final"]) {
      stages.push({
        ...base,
        stage,
        window: {
          mode: "official",
          approved: true,
          source_ref: "https://example.invalid/SYNTHETIC-official",
          opens_at: utcText(NOW - 1000000n),
          closes_at: utcText(NOW + 1000000000n),
        },
      });
    }
  });
}
Deno.test("approved different stages retain independent input rights for the same exact exam", async () => {
  const p = multiStagePolicy(), f = nativeFixture(p);
  await f.save("SYNTHETIC-mock-entry");
  for (const stage of ["provisional", "final"]) {
    await f.repo.accept(A, () =>
      f.profile.execute({
        operation: "score-profile.create",
        session: f.verified,
        management: null,
        body: { scores: scores(), confirmed: true, stage },
        query: {},
        params: {},
        requestKey: "SYNTHETIC-" + stage,
      }));
  }
  equal(f.pool.state.profiles.size, 3);
  equal(f.pool.state.attempts.length, 3);
  for (const stage of ["mock", "provisional", "final"]) {
    const context = p.context(f.verified, "SYNTHETIC-mock", stage, NOW, false);
    const state = await f.repo.state(context);
    equal(scoreInputBalance(state).initialUsed, 1);
    equal(scoreInputBalance(state).correctionGranted, 0);
    assert(typeof state.currentProfileId === "string");
  }
});
Deno.test("another stage never hides unregistered legacy or a same-stage profile with no state", async () => {
  const p = multiStagePolicy(), f = nativeFixture(p);
  await f.save("SYNTHETIC-existing");
  const provisional = p.context(f.verified, "SYNTHETIC-mock", "provisional", NOW, false);
  equal((await f.repo.state(provisional)).version, 0);
  f.pool.state.profiles.set("SYNTHETIC-unknown", [
    "SYNTHETIC-unknown",
    A,
    JSON.stringify(scores()),
    true,
    "2026-10-15T00:00:00.000000Z",
  ]);
  await denied(() => f.repo.state(provisional), "score_input_transition_pending", 503);
  const sameStage = nativeFixture(p);
  sameStage.pool.state.profiles.set("SYNTHETIC-target", [
    "SYNTHETIC-target",
    A,
    JSON.stringify(scores()),
    true,
    "2026-10-15T00:00:00.000000Z",
  ]);
  sameStage.pool.state.legacyLinks.push({
    profileId: "SYNTHETIC-target",
    owner: A,
    scope: "SYNTHETIC-canonical-season",
    stage: "provisional",
    rollout: "SYNTHETIC-rollout",
  });
  await denied(() => sameStage.repo.state(provisional), "score_input_transition_pending", 503);
});
Deno.test("other-stage legacy mapping must match the approved rollout and exact exam policy", async () => {
  const p = multiStagePolicy();
  const current = p.context(session(A), "SYNTHETIC-mock", "provisional", NOW, false);
  for (
    const [stage, rollout, permitted] of [
      ["mock", "SYNTHETIC-rollout", true],
      ["mock", "SYNTHETIC-old-rollout", false],
      ["other", "SYNTHETIC-rollout", false],
    ] as const
  ) {
    const f = nativeFixture(p);
    f.pool.state.profiles.set("SYNTHETIC-legacy-stage", [
      "SYNTHETIC-legacy-stage",
      A,
      JSON.stringify(scores()),
      true,
      "2026-10-15T00:00:00.000000Z",
    ]);
    f.pool.state.legacyLinks.push({
      profileId: "SYNTHETIC-legacy-stage",
      owner: A,
      scope: "SYNTHETIC-canonical-season",
      stage,
      rollout,
    });
    if (permitted) equal((await f.repo.state(current)).version, 0);
    else await denied(() => f.repo.state(current), "score_input_transition_pending", 503);
  }
});
Deno.test("other-stage accepted mapping requires matching exact exam and original accepted state", async () => {
  for (const kind of ["other-exam", "missing-anchor", "conflicting-link"] as const) {
    const p = multiStagePolicy(), f = nativeFixture(p);
    await f.save("SYNTHETIC-first-" + kind);
    const attempt = f.pool.state.attempts[0];
    if (kind === "other-exam") attempt[5] = "SYNTHETIC-alias";
    if (kind === "missing-anchor") f.pool.state.states[0][8] = "SYNTHETIC-other-attempt";
    if (kind === "conflicting-link") {
      f.pool.state.legacyLinks.push({
        profileId: String(attempt[11]),
        owner: A,
        scope: "SYNTHETIC-canonical-season",
        stage: "final",
        rollout: "SYNTHETIC-rollout",
      });
    }
    const provisional = p.context(f.verified, "SYNTHETIC-mock", "provisional", NOW, false);
    await denied(() => f.repo.state(provisional), "score_input_transition_pending", 503);
  }
});
