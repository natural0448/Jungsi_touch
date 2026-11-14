// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
/** Synthetic existing selection only; no new registry data or operating writes. */
import { ExistingReferenceCandidateScope } from "../../supabase/functions/_shared/jungsi/infrastructure/existing_reference_candidate_scope.ts";
import { assert, equal } from "./fixture.ts";
const H = (s: string) => s.repeat(64);
const request = {
  subjectId: "owner",
  reportId: "report",
  reportRevision: 1,
  profileId: "profile",
  academicYear: 2027,
  examId: "exam",
  scoreBasis: "standard",
  catalogVersion: "catalog",
};
async function denied(f: () => Promise<unknown>) {
  let yes = false;
  try {
    await f();
  } catch {
    yes = true;
  }
  assert(yes);
}
function fixture() {
  const state = { selected: H("2"), ids: ["2027:1", "2027:2"], active: true, guards: 0 };
  const provider = {
    async referenceSelection(signal: AbortSignal) {
      if (signal.aborted) throw Error("abort");
      return {
        registrySha256: H("1"),
        selectionSha256: state.selected,
        approvalReferenceSha256: H("3"),
        tails: [{}],
      };
    },
    referenceTailOfferings(year: number, exam: string) {
      if (year !== 2027 || exam !== "exam") throw Error("wrong year");
      return state.ids;
    },
  };
  const guard = async (signal: AbortSignal) => {
    state.guards++;
    if (signal.aborted || !state.active) throw Error("inactive");
  };
  const scope = new ExistingReferenceCandidateScope(
    provider,
    guard,
    H("1"),
    H("2"),
    H("4"),
    H("5"),
    3,
    1024,
    8000,
  );
  return { scope, state };
}
Deno.test("existing selected scope reuses same year and PK without new receipt", async () => {
  const f = fixture(), s = new AbortController().signal;
  equal(await f.scope.offeringIds(request, s, 1024), ["2027:1", "2027:2"]);
  assert(f.state.guards >= 4);
});
Deno.test("existing scope rejects a changed selection, duplicate or over-limit IDs", async () => {
  for (const mode of ["head", "duplicate", "limit"]) {
    const f = fixture(), s = new AbortController().signal;
    if (mode === "head") f.state.selected = H("f");
    if (mode === "duplicate") f.state.ids = ["2027:1", "2027:1"];
    if (mode === "limit") f.state.ids = ["2027:1", "2027:2", "2027:3", "2027:4"];
    await denied(() => f.scope.offeringIds(request, s, 1024));
  }
});
Deno.test("existing scope awaits physically cancelled head reads", async () => {
  const ctrl = new AbortController();
  let began!: () => void, stopped = false;
  const started = new Promise<void>((r) => {
    began = r;
  });
  const provider = {
    async referenceSelection(signal: AbortSignal) {
      return await new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => {
          stopped = true;
          reject(Error("stopped"));
        }, { once: true });
        began();
      });
    },
    referenceTailOfferings() {
      return [];
    },
  };
  const scope = new ExistingReferenceCandidateScope(
    provider,
    async () => {},
    H("1"),
    H("2"),
    H("4"),
    H("5"),
    3,
    1024,
    8000,
  );
  const work = scope.assertCurrent(request, ctrl.signal).catch(() => {});
  await started;
  ctrl.abort();
  await scope.cancelAndWait();
  await work;
  assert(stopped);
});
