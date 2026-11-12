/** Synthetic only: no external network, database, storage, credentials, or timers beyond this file. */
import { AccessError } from "./access.ts";
import {
  REFERENCE_DURABLE_FENCE_IMPLEMENTED,
  type ReferenceQuiescence,
  requireReferenceDurableFence,
  requireStoppedAndCurrent,
} from "./reference_quiescence_fence.review-only.ts";
import { BoundedStudentReferenceBatchProvider } from "../infrastructure/student_reference_batch_provider_candidate.ts";
import { handlePersonalOwnerReferenceBatch } from "./personal_owner_reference_batch_handler_candidate.ts";
import { handleOwnedStudentReferenceBatch } from "./owned_student_reference_batch_handler_candidate.ts";

// Preserve async callback behavior: execute immediately and turn throws into rejections.
function syntheticPromise<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error);
  }
}
const assert = (value: unknown): void => {
  if (!value) throw new Error("synthetic assertion failed");
};
const proof = (physical: "stopped" | "unknown", current: boolean): ReferenceQuiescence =>
  Object.freeze({ physical, current });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
async function denied(work: () => Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof AccessError && caught.http === 503);
}
Deno.test("no durable fence means source and handlers fail before any adapter I/O", async () => {
  let calls = 0;
  const touch = () => {
    calls++;
    return Promise.resolve();
  };
  const provider = new BoundedStudentReferenceBatchProvider({
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
  } as never);
  await denied(() => provider.load({} as never, {} as never, []));
  await denied(() =>
    handlePersonalOwnerReferenceBatch({} as never, {} as never, {} as never, "test", {} as never)
  );
  await denied(() =>
    handleOwnedStudentReferenceBatch({} as never, {} as never, {} as never, "test", {} as never)
  );
  assert(calls === 0 && REFERENCE_DURABLE_FENCE_IMPLEMENTED === false);
  let failed = false;
  try {
    requireReferenceDurableFence();
  } catch (error) {
    failed = error instanceof AccessError;
  }
  assert(failed);
});
Deno.test("verified stopped and current permits success", async () => {
  await requireStoppedAndCurrent(
    () => syntheticPromise(() => proof("stopped", true)),
    () => syntheticPromise(() => proof("stopped", true)),
  );
});
Deno.test("stopped but stale is a normal safe failure", async () => {
  let settlement = "none";
  try {
    await requireStoppedAndCurrent(
      () => syntheticPromise(() => proof("stopped", false)),
      () => syntheticPromise(() => proof("stopped", true)),
    );
    settlement = "success";
  } catch (error) {
    assert(error instanceof AccessError && error.http === 503);
    settlement = "failure";
  }
  assert(settlement === "failure");
});
Deno.test("unknown physical stop does not trigger failure or success settlement", async () => {
  let settlement = "none", deliveryCalls = 0;
  void requireStoppedAndCurrent(
    () => syntheticPromise(() => proof("unknown", false)),
    () =>
      syntheticPromise(() => {
        deliveryCalls++;
        return proof("stopped", true);
      }),
  ).then(() => {
    settlement = "success";
  }, () => {
    settlement = "failure";
  });
  await tick();
  assert(deliveryCalls === 1 && settlement === "none");
});
Deno.test("failed drain still attempts the other drain and cannot trigger normal settlement", async () => {
  let settlement = "none", deliveryCalls = 0;
  void requireStoppedAndCurrent(
    () =>
      syntheticPromise(() => {
        throw new Error("synthetic stop not proven");
      }),
    () =>
      syntheticPromise(() => {
        deliveryCalls++;
        return proof("stopped", true);
      }),
  ).then(() => {
    settlement = "success";
  }, () => {
    settlement = "failure";
  });
  await tick();
  assert(settlement === "none" && deliveryCalls === 1);
});
Deno.test("malformed or legacy boolean proof never grants settlement", async () => {
  let settlement = "none";
  void requireStoppedAndCurrent(
    () => syntheticPromise(() => true as unknown as ReferenceQuiescence),
    () => syntheticPromise(() => proof("stopped", true)),
  ).then(() => {
    settlement = "success";
  }, () => {
    settlement = "failure";
  });
  await tick();
  assert(settlement === "none");
});
