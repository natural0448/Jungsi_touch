/** Synthetic only. No database, storage, network, credentials or actual student information. */
import { AccessError } from "./access.ts";
import { utcInstant } from "../domain/time.ts";
import { withVerifiedPersonalOwnerStorageScope } from "./personal_owner_storage_scope_candidate.ts";
import {
  assertPersonalStudentFilename,
  withPersonalSelfStudentFilename,
} from "./personal_self_student_filename_candidate.ts";
import { PersonalOwnerNamedR2Reader } from "../infrastructure/personal_owner_named_cache_r2_read_candidate.ts";
import {
  type ReferenceQuiescence,
  requireBooleanStopped,
  requireStoppedAndCurrent,
  requireVoidDrains,
} from "./reference_quiescence_fence.review-only.ts";
import { BoundedStudentReferenceBatchProvider } from "../infrastructure/student_reference_batch_provider_candidate.ts";
import { readCurrentStudentCache } from "./student_score_cache_read_candidate.ts";
import { runStudentCacheBoundedTurn } from "./student_score_cache_bounded_workflow_candidate.ts";
import { runPersonalOwnerCacheBoundedTurn } from "./personal_owner_cache_bounded_workflow_candidate.ts";
import { runVerifiedOwnerContinuationTurn } from "./personal_owner_durable_continuation_candidate.v3.ts";
import { readVerifiedOwnedStudentCacheCandidate } from "./owned_student_cache_internal_candidate.ts";
import { handleOwnedStudentCacheReadCandidate } from "./owned_student_cache_handler_candidate.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("synthetic assertion failed");
};

// Preserve async callback behavior: execute immediately and turn throws into rejections.
function syntheticPromise<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error);
  }
}
const OWNER = "00000000-0000-0000-0000-000000000001";
const STUDENT = "00000000-0000-0000-0000-000000000002";
const NOW = utcInstant("2026-11-13T00:00:00Z");
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
function fixture() {
  const controller = new AbortController(),
    signal = controller.signal,
    boundary = { signal, admission: Object.freeze({}) };
  const request = {
    operation: "student-reference.compare",
    session: {
      user: { subjectId: OWNER, expiresAtUtc: NOW + 10000000n },
      evaluatedAtUtc: NOW,
      tier: "paid",
      paidUntilUtc: NOW + 10000000n,
    },
    management: null,
    body: { profile_id: "profile-1", expected_version: 1, offering_ids: [] },
    params: { report_id: "report-1" },
    query: {},
    requestKey: null,
  };
  const repo = {
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
  };
  const ports = {
    repository: repo,
    workflow: { assertProfile: async () => {} },
    clock: { nowUtc: () => NOW },
    assertActiveAdmission: async () => {},
    awaitQuiescence: async () => {},
  };
  return { request, boundary, ports, controller };
}
async function inside<T>(
  fn: (x: ReturnType<typeof fixture>, identity: unknown) => Promise<T>,
): Promise<T> {
  const f = fixture();
  return await withVerifiedPersonalOwnerStorageScope(
    f.request as never,
    f.boundary,
    { reportId: "report-1", profileId: "profile-1", reportRevision: 1 },
    f.ports as never,
    async (identity) => await fn(f, identity),
  );
}
Deno.test("missing student UUID stays pending and performs no named R2 access", async () => {
  let calls = 0;
  await inside(async (f, identity) => {
    const authority = {
      issue: () =>
        syntheticPromise(() => ({
          state: "verified",
          ownerUuid: OWNER,
          studentName: "가상학생",
          receipt: Object.freeze({}),
        })),
      assertCurrent: async () => {},
      awaitQuiescence: () => syntheticPromise(() => true),
    };
    await withPersonalSelfStudentFilename(
      f.request as never,
      f.boundary,
      identity as never,
      authority as never,
      (result) =>
        syntheticPromise(() => {
          assert(result.state === "pending");
          if (result.state === "ready") calls++;
        }),
    );
  });
  assert(calls === 0);
});
Deno.test("verified distinct student UUID binds exact filename and token expires with scope", async () => {
  let saved: unknown = null, key = "", proofSignal: AbortSignal | null = null;
  const grant = {
    ownerUuid: OWNER,
    profileId: "profile-1",
    reportId: "report-1",
    reportRevision: 1,
  };
  await inside(async (f, identity) => {
    const authority = {
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
    await withPersonalSelfStudentFilename(
      f.request as never,
      f.boundary,
      identity as never,
      authority as never,
      async (name, signal) => {
        assert(name.state === "ready");
        if (name.state !== "ready") return;
        assert(
          name.logicalFilename === STUDENT + "_가상학생.json" &&
            !name.logicalFilename.startsWith(OWNER),
        );
        saved = name;
        proofSignal = signal;
        const bucket = {
          head: (k: string) =>
            syntheticPromise(() => {
              key = k;
              return null;
            }),
          get: () => syntheticPromise(() => null),
        };
        const reader = new PersonalOwnerNamedR2Reader(bucket, "synthetic/", name);
        let crossScope = false, crossSignal = false;
        try {
          await reader.head({ ...grant, profileId: "other" } as never, signal);
        } catch {
          crossScope = true;
        }
        try {
          await reader.head(grant as never, new AbortController().signal);
        } catch {
          crossSignal = true;
        }
        assert(crossScope && crossSignal && key === "");
        assert(await reader.head(grant as never, signal) === null);
      },
    );
  });
  assert(key === "synthetic/" + STUDENT + "_가상학생.json");
  let denied = false;
  try {
    assertPersonalStudentFilename(saved as never, grant, proofSignal as never);
  } catch (e) {
    denied = e instanceof AccessError;
  }
  assert(denied);
});
Deno.test("fabricated filename token is rejected before any object read", async () => {
  let calls = 0, failed = false;
  const bucket = {
    head: () =>
      syntheticPromise(() => {
        calls++;
        return null;
      }),
    get: () => syntheticPromise(() => null),
  };
  const forged = {
    state: "ready",
    studentUuid: STUDENT,
    logicalFilename: STUDENT + "_가상학생.json",
  } as const;
  const reader = new PersonalOwnerNamedR2Reader(bucket, "synthetic/", forged);
  try {
    await reader.head({ ownerUuid: OWNER } as never, new AbortController().signal);
  } catch {
    failed = true;
  }
  assert(failed && calls === 0);
});
Deno.test("throwing accessor and proxy proof remain UNKNOWN without settlement", async () => {
  for (
    const value of [
      Object.defineProperty({ current: true }, "physical", {
        get() {
          throw new Error("synthetic getter");
        },
      }),
      new Proxy({}, {
        getOwnPropertyDescriptor() {
          throw new Error("synthetic trap");
        },
      }),
    ]
  ) {
    let settled = false;
    void requireStoppedAndCurrent(
      () => syntheticPromise(() => value as ReferenceQuiescence),
      () => syntheticPromise(() => Object.freeze({ physical: "stopped", current: true })),
    ).then(() => {
      settled = true;
    }, () => {
      settled = true;
    });
    await tick();
    assert(!settled);
  }
});
Deno.test("false boolean and throwing void drain stay UNKNOWN", async () => {
  let a = false, b = false, c = false, calls = 0;
  void requireBooleanStopped(() => syntheticPromise(() => false)).then(() => {
    a = true;
  }, () => {
    a = true;
  });
  void requireVoidDrains([() =>
    syntheticPromise(() => {
      throw new Error("synthetic error");
    }), () =>
    syntheticPromise(() => {
      calls++;
    })])
    .then(() => {
      b = true;
    }, () => {
      b = true;
    });
  void requireVoidDrains([() => syntheticPromise(() => false as unknown as void)]).then(() => {
    c = true;
  }, () => {
    c = true;
  });
  await tick();
  assert(!a && !b && !c && calls === 1);
});
Deno.test("draining an unstarted source seals it before any later load", async () => {
  let calls = 0;
  const touch = () => {
    calls++;
    return Promise.resolve();
  };
  const source = new BoundedStudentReferenceBatchProvider(
    {
      sql: {},
      budget: {},
      metadataAuthority: {},
      snapshot: {},
      selectPart: () => {
        calls++;
        return null;
      },
      authority: {
        assertContext: touch,
        issue: touch,
        assertIssued: touch,
        assertMetadataHead: touch,
        awaitQuiescence: touch,
      },
    } as never,
  );
  const signal = new AbortController().signal,
    boundary = { signal, admission: {} },
    request = {} as never;
  const result = await source.awaitQuiescence(request, boundary, signal);
  assert(
    result.physical === "stopped" && (source as unknown as { sealed: boolean }).sealed === true,
  );
  let denied = false;
  try {
    await source.load(request, boundary, []);
  } catch (e) {
    denied = e instanceof AccessError;
  }
  assert(denied && calls === 0);
});
Deno.test("new cache and worker entrypoints are fenced before dependency I/O", async () => {
  let calls = 0;
  const fake = new Proxy({}, {
    get() {
      calls++;
      return () => {
        calls++;
      };
    },
  });
  const attempts = [
    () => readCurrentStudentCache({} as never, {} as never, fake as never, fake as never),
    () =>
      readVerifiedOwnedStudentCacheCandidate({} as never, {} as never, {} as never, fake as never),
    () =>
      handleOwnedStudentCacheReadCandidate(
        {} as never,
        {} as never,
        {} as never,
        "test",
        fake as never,
      ),
    () => runStudentCacheBoundedTurn({} as never, {} as never, fake as never, fake as never),
    () =>
      runPersonalOwnerCacheBoundedTurn(
        {} as never,
        {} as never,
        {} as never,
        fake as never,
        fake as never,
      ),
    () =>
      runVerifiedOwnerContinuationTurn(
        {} as never,
        {} as never,
        {} as never,
        null,
        fake as never,
        fake as never,
        fake as never,
        fake as never,
        fake as never,
      ),
  ];
  for (const attempt of attempts) {
    let denied = false;
    try {
      await attempt();
    } catch (e) {
      denied = e instanceof AccessError;
    }
    assert(denied);
  }
  assert(calls === 0);
});
Deno.test("revoked token after GET cancels acquired body before failure", async () => {
  let cancelled = 0, release: (() => void) | null = null;
  try {
    await inside(async (f, identity) => {
      const authority = {
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
      await withPersonalSelfStudentFilename(
        f.request as never,
        f.boundary,
        identity as never,
        authority as never,
        async (name, signal) => {
          if (name.state !== "ready") throw new Error("expected ready");
          const grant = {
            ownerUuid: OWNER,
            profileId: "profile-1",
            reportId: "report-1",
            reportRevision: 1,
            maxBytes: 10,
            totalRows: 1,
          };
          const raw = {
            kind: "personal_owner",
            ownerUuid: OWNER,
            profileId: "profile-1",
            reportId: "report-1",
            reportRevision: 1,
            academicYear: 2027,
            payloadSha256: "a".repeat(64),
            payloadBytes: 1,
            coverageSha256: "b".repeat(64),
            totalRows: 1,
            pins: {},
          };
          const bucket = {
            head: (key: string) =>
              syntheticPromise(() => ({
                key,
                version: "v1",
                size: 1,
                customMetadata: { "cache-head": JSON.stringify(raw) },
              })),
            get: (key: string) =>
              new Promise<
                { key: string; version: string; size: number; body: ReadableStream<Uint8Array> }
              >((resolve) => {
                release = () =>
                  resolve({
                    key,
                    version: "v1",
                    size: 1,
                    body: new ReadableStream({
                      cancel() {
                        cancelled++;
                      },
                    }),
                  });
              }),
          };
          const reader = new PersonalOwnerNamedR2Reader(bucket, "synthetic/", name);
          const head = await reader.head(grant as never, signal);
          assert(head !== null);
          const pending = reader.bytes(grant as never, head!, signal).catch(() => null);
          f.controller.abort();
          if (!release) throw new Error("GET not started");
          (release as () => void)();
          await pending;
        },
      );
    });
  } catch { /* cancellation invalidates the enclosing owner scope */ }
  assert(cancelled === 1);
});
Deno.test("failed cancellation of acquired body remains UNKNOWN", async () => {
  let cancelled = 0, settled = false, release: (() => void) | null = null;
  void inside(async (f, identity) => {
    const authority = {
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
    await withPersonalSelfStudentFilename(
      f.request as never,
      f.boundary,
      identity as never,
      authority as never,
      async (name, signal) => {
        if (name.state !== "ready") throw new Error("expected ready");
        const grant = {
          ownerUuid: OWNER,
          profileId: "profile-1",
          reportId: "report-1",
          reportRevision: 1,
          maxBytes: 10,
          totalRows: 1,
        };
        const raw = {
          kind: "personal_owner",
          ownerUuid: OWNER,
          profileId: "profile-1",
          reportId: "report-1",
          reportRevision: 1,
          academicYear: 2027,
          payloadSha256: "a".repeat(64),
          payloadBytes: 1,
          coverageSha256: "b".repeat(64),
          totalRows: 1,
          pins: {},
        };
        const bucket = {
          head: (key: string) =>
            syntheticPromise(() => ({
              key,
              version: "v1",
              size: 1,
              customMetadata: { "cache-head": JSON.stringify(raw) },
            })),
          get: (key: string) =>
            new Promise<
              { key: string; version: string; size: number; body: ReadableStream<Uint8Array> }
            >((resolve) => {
              release = () =>
                resolve({
                  key,
                  version: "v1",
                  size: 1,
                  body: new ReadableStream({
                    cancel() {
                      cancelled++;
                      throw new Error("synthetic cancellation failure");
                    },
                  }),
                });
            }),
        };
        const reader = new PersonalOwnerNamedR2Reader(bucket, "synthetic/", name);
        const head = await reader.head(grant as never, signal);
        assert(head !== null);
        const pending = reader.bytes(grant as never, head!, signal);
        f.controller.abort();
        if (!release) throw new Error("GET not started");
        (release as () => void)();
        await pending;
      },
    );
  }).then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  await tick();
  assert(cancelled === 1 && !settled);
});
