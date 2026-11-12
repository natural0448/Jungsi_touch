import { readVerifiedPersonalNamedOwnerCache } from "./personal_owner_named_cache_handler_candidate.ts";
import { assertPersonalStudentFilename } from "./personal_self_student_filename_candidate.ts";
import { utcInstant } from "../domain/time.ts";

// Preserve async callback behavior: execute immediately and turn throws into rejections.
function syntheticPromise<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error);
  }
}
const OWNER = "00000000-0000-0000-0000-000000000001",
  STUDENT = "00000000-0000-0000-0000-000000000002";
const NOW = utcInstant("2026-11-13T00:00:00Z");
function fixture() {
  const signal = new AbortController().signal, boundary = { signal, admission: Object.freeze({}) };
  const request = {
    operation: "student-reference.compare",
    session: {
      user: { subjectId: OWNER, expiresAtUtc: NOW + 10000000n },
      evaluatedAtUtc: NOW,
      tier: "paid",
      paidUntilUtc: NOW + 10000000n,
    },
    management: null,
    body: { profile_id: "profile-1", expected_version: 1 },
    params: { report_id: "report-1" },
    query: {},
    requestKey: null,
  };
  const scope = {
    repository: {
      lookupAccess: () => syntheticPromise(() => ({ ownerId: OWNER, confirmed: true })),
      getReport: () =>
        syntheticPromise(() => ({
          owner_id: OWNER,
          report_id: "report-1",
          profile_id: "profile-1",
          revision: 1,
          body: {},
        })),
      getProfile: () =>
        syntheticPromise(() => ({
          owner_id: OWNER,
          profile_id: "profile-1",
          confirmed: true,
          scores: {},
        })),
    },
    workflow: { assertProfile: async () => {} },
    clock: { nowUtc: () => NOW },
    assertActiveAdmission: async () => {},
    awaitQuiescence: async () => {},
  };
  const names = {
    issue: () =>
      syntheticPromise(() => ({
        state: "verified",
        ownerUuid: OWNER,
        studentUuid: STUDENT,
        studentName: "가상학생",
        receipt: Object.freeze({}),
      })),
    assertCurrent: async () => {},
    awaitQuiescence: () => syntheticPromise(() => true),
  };
  const pins = Object.fromEntries(
    [
      "profileSha256",
      "examSha256",
      "sourceSha256",
      "ruleSha256",
      "engineSha256",
      "cdfSha256",
      "tiePolicySha256",
      "relationSha256",
      "attendanceSha256",
      "policySha256",
      "scopeSha256",
    ].map((k) => [k, "a".repeat(64)]),
  );
  const cache = {
    issue: () =>
      syntheticPromise(() => ({
        kind: "personal_owner",
        ownerUuid: OWNER,
        profileId: "profile-1",
        reportId: "report-1",
        reportRevision: 1,
        academicYear: 2027,
        totalRows: 1,
        maxRows: 1,
        maxBytes: 100,
        pins,
      })),
    assertCurrent: async () => {},
    verifyCoverage: () => syntheticPromise(() => true),
    awaitQuiescence: () => syntheticPromise(() => true),
  };
  return {
    request,
    boundary,
    scope,
    names,
    cache,
    input: { reportId: "report-1", profileId: "profile-1", reportRevision: 1 },
  };
}
function assert(v: unknown): asserts v {
  if (!v) throw Error("synthetic assertion failed");
}
Deno.test("application factory receives live verified student token and keeps scope", async () => {
  const f = fixture();
  let calls = 0, heads = 0;
  const out = await readVerifiedPersonalNamedOwnerCache(
    f.request as never,
    f.boundary,
    f.input,
    f.scope as never,
    f.names as never,
    f.cache as never,
    (token) => {
      calls++;
      assert(token.studentUuid === STUDENT);
      return {
        head: (grant, signal) =>
          syntheticPromise(() => {
            heads++;
            assertPersonalStudentFilename(token, grant, signal);
            return null;
          }),
        bytes: () =>
          syntheticPromise(() => {
            throw Error("unexpected body");
          }),
      };
    },
  );
  assert(calls === 1 && heads === 1 && out.state === "pending");
});
Deno.test("missing student identity never starts storage factory", async () => {
  const f = fixture();
  let calls = 0;
  const names = { ...f.names, issue: () => syntheticPromise(() => ({ state: "pending" })) };
  const out = await readVerifiedPersonalNamedOwnerCache(
    f.request as never,
    f.boundary,
    f.input,
    f.scope as never,
    names as never,
    f.cache as never,
    () => {
      calls++;
      throw Error("unexpected");
    },
  );
  assert(calls === 0 && out.state === "pending");
});
Deno.test("unauthorized owner never starts storage factory", async () => {
  const f = fixture();
  let calls = 0;
  f.scope.repository.lookupAccess = () =>
    syntheticPromise(() => ({ ownerId: "00000000-0000-0000-0000-000000000003", confirmed: true }));
  let failed = false;
  try {
    await readVerifiedPersonalNamedOwnerCache(
      f.request as never,
      f.boundary,
      f.input,
      f.scope as never,
      f.names as never,
      f.cache as never,
      () => {
        calls++;
        throw Error("unexpected");
      },
    );
  } catch {
    failed = true;
  }
  assert(failed && calls === 0);
});
