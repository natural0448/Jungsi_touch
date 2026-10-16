/** Immutable stage rights. Authentication and legacy validation belong to application ports. */
import { ContractError } from "./exact.ts";
export const SCORE_INPUT_STAGES = ["mock", "provisional", "final"] as const;
export type ScoreInputStage = typeof SCORE_INPUT_STAGES[number];
export interface ScoreInputState {
  readonly version: number;
  readonly initialAttemptId: string | null;
  readonly correctionGrantId: string | null;
  readonly correctionAttemptId: string | null;
  readonly currentProfileId: string | null;
  readonly lastAttemptId: string | null;
  readonly lastOutcome: "accepted" | "rejected" | null;
  readonly lastRejectionCode: string | null;
}
export interface ScoreInputBalance {
  readonly initialUsed: 0 | 1;
  readonly initialRemaining: 0 | 1;
  readonly correctionGranted: 0 | 1;
  readonly correctionUsed: 0 | 1;
  readonly correctionRequestRemaining: 0 | 1;
  readonly effectiveSaveRemaining: 0 | 1;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function check(value: unknown, code: string): asserts value {
  if (!value) throw new ContractError(code);
}
export function assertScoreInputState(state: ScoreInputState): void {
  check(
    state && typeof state === "object" && !Array.isArray(state) &&
      Number.isSafeInteger(state.version) && state.version >= 0,
    "score_input_state_invalid",
  );
  for (
    const value of [
      state.initialAttemptId,
      state.correctionGrantId,
      state.correctionAttemptId,
      state.currentProfileId,
      state.lastAttemptId,
    ]
  ) {
    check(
      value === null || typeof value === "string" && ID.test(value),
      "score_input_state_invalid",
    );
  }
  check([null, "accepted", "rejected"].includes(state.lastOutcome), "score_input_state_invalid");
  check(
    (state.lastAttemptId === null) === (state.lastOutcome === null),
    "score_input_state_invalid",
  );
  check(
    state.lastOutcome === "rejected"
      ? typeof state.lastRejectionCode === "string" &&
        /^[a-z][a-z0-9_]{0,63}$/.test(state.lastRejectionCode)
      : state.lastRejectionCode === null,
    "score_input_state_invalid",
  );
  check(
    state.lastOutcome !== "accepted" || state.currentProfileId !== null,
    "score_input_state_invalid",
  );
  check(
    state.correctionGrantId === null || state.initialAttemptId !== null,
    "score_input_state_invalid",
  );
  check(
    state.correctionAttemptId === null || state.correctionGrantId !== null,
    "score_input_state_invalid",
  );
  check(
    state.version !== 0 ||
      [
        state.initialAttemptId,
        state.correctionGrantId,
        state.correctionAttemptId,
        state.currentProfileId,
        state.lastAttemptId,
      ].every((value) => value === null),
    "score_input_state_invalid",
  );
}
/** Only repositories that positively verified the rollout and existing profiles may use this. */
export function initialScoreInputState(): ScoreInputState {
  return Object.freeze({
    version: 0,
    initialAttemptId: null,
    correctionGrantId: null,
    correctionAttemptId: null,
    currentProfileId: null,
    lastAttemptId: null,
    lastOutcome: null,
    lastRejectionCode: null,
  });
}
export function scoreInputBalance(state: ScoreInputState): ScoreInputBalance {
  assertScoreInputState(state);
  return Object.freeze({
    initialUsed: state.initialAttemptId === null ? 0 : 1,
    initialRemaining: state.initialAttemptId === null ? 1 : 0,
    correctionGranted: state.correctionGrantId === null ? 0 : 1,
    correctionUsed: state.correctionAttemptId === null ? 0 : 1,
    correctionRequestRemaining: state.correctionGrantId === null ? 1 : 0,
    effectiveSaveRemaining: state.initialAttemptId === null ||
        state.correctionGrantId !== null && state.correctionAttemptId === null
      ? 1
      : 0,
  });
}
function nextVersion(state: ScoreInputState): number {
  check(Number.isSafeInteger(state.version + 1), "score_input_state_invalid");
  return state.version + 1;
}
export function consumeScoreInput(
  state: ScoreInputState,
  attemptId: string,
  profileId: string | null,
  previewExempt: boolean,
  rejectionCode: string | null = null,
): ScoreInputState {
  assertScoreInputState(state);
  check(
    typeof attemptId === "string" && ID.test(attemptId) &&
      (profileId === null || typeof profileId === "string" && ID.test(profileId)) &&
      typeof previewExempt === "boolean",
    "score_input_state_invalid",
  );
  check(
    profileId === null
      ? typeof rejectionCode === "string" &&
        /^[a-z][a-z0-9_]{0,63}$/.test(rejectionCode)
      : rejectionCode === null,
    "score_input_state_invalid",
  );
  const changed: ScoreInputState = {
    ...state,
    version: nextVersion(state),
    lastAttemptId: attemptId,
    lastOutcome: profileId === null ? "rejected" : "accepted",
    lastRejectionCode: rejectionCode,
  };
  const next = { ...changed };
  if (!previewExempt) {
    check(scoreInputBalance(state).effectiveSaveRemaining === 1, "score_input_exhausted");
    if (state.initialAttemptId === null) next.initialAttemptId = attemptId;
    else next.correctionAttemptId = attemptId;
  }
  if (profileId !== null) next.currentProfileId = profileId;
  return Object.freeze(next);
}
export function grantScoreCorrection(
  state: ScoreInputState,
  commandId: string,
  expectedVersion: number,
): ScoreInputState {
  assertScoreInputState(state);
  check(
    Number.isSafeInteger(expectedVersion) && expectedVersion >= 1 &&
      state.version === expectedVersion,
    "score_input_version_conflict",
  );
  check(typeof commandId === "string" && ID.test(commandId), "score_input_state_invalid");
  check(
    state.initialAttemptId !== null && state.correctionGrantId === null,
    "score_correction_unavailable",
  );
  return Object.freeze({ ...state, version: nextVersion(state), correctionGrantId: commandId });
}
