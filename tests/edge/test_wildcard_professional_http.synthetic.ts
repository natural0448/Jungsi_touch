/** Actual professional HTTP/transaction path using only fictional in-memory data and a fake verifier. */
import {
  ACTOR,
  assert,
  equal,
  fixture,
  NOW,
  ORG,
  ORIGIN,
  OTHER,
  PROFILE,
  RELAY,
  REPORT,
  STUDENT,
} from "../../supabase/functions/_shared/professional_support.ts";
import { ProfessionalApprovedAnalysis } from "../../supabase/functions/_shared/jungsi/application/professional_analysis.ts";
import type { ApprovedAnalysisPort } from "../../supabase/functions/_shared/jungsi/application/professional_ports.ts";
import type { WildcardRuntimeGate } from "../../supabase/functions/_shared/jungsi/application/wildcard_runtime_gate.ts";
import type {
  WildcardBatchBinding,
  WildcardBatchRecord,
} from "../../supabase/functions/_shared/jungsi/application/wildcard_candidate_review.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { syntheticNativePackData } from "./synthetic_exam_pack.ts";
import { PROFESSIONAL_CONTRACT } from "../../supabase/functions/_shared/jungsi/application/professional_contract.generated.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import {
  createProfessionalHandler,
  professionalMutationGuard,
} from "../../supabase/functions/_shared/jungsi/infrastructure/professional_http.ts";

const H = (x: string) => x.repeat(64);
const A = "SYNTHETIC-offering-a", B = "SYNTHETIC-offering-b";
function rows(): NativeObject[] {
  return [
    {
      offering_id: A,
      academic_year: 2027,
      university_id: "SYNTHETIC-u-a",
      university_name: "가상대가",
      department: "가상학과",
      region: "가상지역가",
      wildcard_group: "nursing",
      practical_required: false,
    },
    {
      offering_id: B,
      academic_year: 2027,
      university_id: "SYNTHETIC-u-b",
      university_name: "가상대나",
      department: "가상학과",
      region: "가상지역나",
      wildcard_group: "health",
      practical_required: false,
    },
    {
      offering_id: "SYNTHETIC-old",
      academic_year: 2026,
      university_id: "SYNTHETIC-old-u",
      university_name: "가상대옛",
      region: "가상지역가",
      wildcard_group: "nursing",
      practical_required: false,
    },
    {
      offering_id: "SYNTHETIC-practical",
      academic_year: 2027,
      university_id: "SYNTHETIC-practical-u",
      university_name: "가상실기",
      region: "가상지역가",
      wildcard_group: "health",
      practical_required: true,
    },
  ];
}
function data() {
  const pack = new NativeExamPack(syntheticNativePackData());
  return {
    getExamPack: () => Promise.resolve(pack),
    getTotalModel: () => Promise.resolve(null),
    getCatalog: () =>
      Promise.resolve({
        version: "SYNTHETIC-catalog",
        status: "approved",
        asOfUtc: NOW,
        offerings: rows(),
        history: [],
      }),
    getConversion: () => Promise.resolve(null),
    getPercentile: () => Promise.resolve(null),
    getAnalysis: () => Promise.resolve(null),
    assertCurrentSelection: () => Promise.resolve(),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Read = WildcardRuntimeGate["evidence"]["read"];
function install(f: Fixture, gate: WildcardRuntimeGate | null) {
  const bridge = new ProfessionalApprovedAnalysis(
    () => Promise.resolve(data()),
    f.ports.reports,
    f.policy,
    f.clock,
    { maximumOfferings: 20, unitsPerOffering: 1n, reservedCandidateUnits: 20n },
    gate,
  );
  (f.ports as unknown as { analysis: ApprovedAnalysisPort }).analysis = bridge;
}
function fakeGate(f: Fixture, events: string[], read?: Read) {
  let calls = 0, seen: readonly string[] = [];
  const gate: WildcardRuntimeGate = {
    selectionPolicySha256: H("e"),
    evidenceReleaseSha256: H("d"),
    budgetPolicySha256: H("f"),
    consumerReceiptSha256: H("9"),
    maximumRows: 20,
    maximumSnapshotBytes: 1000000,
    maximumEvidenceBytes: 200000,
    maximumRuntimeMilliseconds: 500,
    verifyAdmission: (scope, admission, requirements, signal) => {
      assert(
        scope.subjectId === ACTOR && scope.organizationId === ORG && scope.studentId === STUDENT,
      );
      assert(scope.operation === "pro.candidates" && scope.audience === "professional");
      assert(
        !!admission && f.f.reserveCalls.length > 0 &&
          requirements.requirePhysicalCancellationAndSettlement && !signal.aborted,
      );
      events.push("verify");
      return Promise.resolve();
    },
    evidence: {
      read: (binding, signal, limit) => {
        calls++;
        seen = binding.offeringIds;
        events.push("provider");
        equal(limit, 200000);
        if (read) return read(binding, signal, limit);
        return Promise.resolve({
          binding,
          records: binding.offeringIds.map((offeringId) => ({
            offeringId,
            groupClassification: "approved" as const,
            group: "nursing",
            stability: null,
          })),
        });
      },
      cancelAndWait: () => {
        events.push("cancel-ack");
        return Promise.resolve();
      },
    },
  };
  return { gate, calls: () => calls, seen: () => seen };
}
const input: NativeObject = {
  profile_id: PROFILE,
  expected_profile_version: PROFILE,
  filters: { region: "가상지역가" },
};
function privateView(f: Fixture): NativeObject {
  const candidates = f.f.reports.get(REPORT)!.body.candidates as NativeObject;
  return candidates._wildcard_selection_view as NativeObject;
}
Deno.test("professional HTTP default OFF keeps baseline output and reserves once", async () => {
  const a = await fixture(), b = await fixture();
  install(a, null);
  install(b, null);
  const first = await a.handler(a.request("pro.candidates", input));
  const second = await b.handler(b.request("pro.candidates", input));
  assert(first.status === 200, await first.clone().text());
  equal(second.status, 200);
  const x = await first.json(), y = await second.json();
  delete x.request_id;
  delete y.request_id;
  equal(x, y);
  equal(a.f.reserveCalls.length, 1);
  equal(a.f.settlements.length, 1);
  assert(!Object.hasOwn(x.data.candidates, "wildcard_selection"));
});
Deno.test("professional HTTP reserved filtered scope reaches synthetic provider and same-key replay", async () => {
  const f = await fixture(), events: string[] = [], g = fakeGate(f, events);
  install(f, g.gate);
  const first = await f.handler(f.request("pro.candidates", input));
  assert(first.status === 200, await first.clone().text());
  equal(g.seen(), [A]);
  equal(g.calls(), 1);
  equal(f.f.reports.get(REPORT)!.revision, 2);
  assert(events.indexOf("verify") < events.indexOf("provider"));
  const output = await first.json();
  assert(!Object.hasOwn(output.data.candidates, "wildcard_selection"));
  assert((privateView(f).wildcard_selection as NativeObject).status === "pending");
  const second = await f.handler(f.request("pro.candidates", input));
  assert(second.status === 200, await second.clone().text());
  equal(g.calls(), 1);
  equal(f.f.reports.get(REPORT)!.revision, 2);
  equal((f.f.settlements[1] as { replayed: boolean }).replayed, true);
});
Deno.test("professional missing signal or unauthorized student never reaches provider", async () => {
  const f = await fixture(), events: string[] = [], g = fakeGate(f, events);
  install(f, g.gate);
  let rejected = false;
  try {
    await f.service.execute(f.execution("pro.candidates", input));
  } catch {
    rejected = true;
  }
  assert(rejected);
  equal(g.calls(), 0);
  equal(f.f.reports.get(REPORT)!.revision, 1);
  const other = await fixture(), more: string[] = [], h = fakeGate(other, more);
  install(other, h.gate);
  other.f.students.set(STUDENT, { ...other.baseStudent, assignedSubjectIds: [OTHER] });
  const response = await other.handler(other.request("pro.candidates", input));
  equal(response.status, 404);
  equal(h.calls(), 0);
  equal(other.f.reserveCalls.length, 0);
});
Deno.test("professional cancellation waits synthetic stop and rolls back before late result", async () => {
  const f = await fixture(), events: string[] = [], abort = new AbortController();
  let begin!: () => void,
    finish!: (
      result: { binding: WildcardBatchBinding; records: readonly WildcardBatchRecord[] },
    ) => void;
  let binding!: WildcardBatchBinding, stopped = false;
  const started = new Promise<void>((resolve) => begin = resolve);
  const g = fakeGate(f, events, (b, signal) => {
    binding = b;
    signal.addEventListener("abort", () => {
      stopped = true;
    }, { once: true });
    begin();
    return new Promise((resolve) => finish = resolve);
  });
  const provider = {
    ...g.gate.evidence,
    cancelAndWait: () => {
      assert(stopped);
      events.push("cancel-ack");
      return Promise.resolve();
    },
  };
  install(f, { ...g.gate, evidence: provider });
  const request = new Request(f.request("pro.candidates", input), { signal: abort.signal });
  const pending = f.handler(request);
  await Promise.race([
    started,
    pending.then(() => {
      throw new Error("provider not reached");
    }),
  ]);
  abort.abort();
  const response = await pending;
  equal(response.status, 503);
  equal(f.f.reports.get(REPORT)!.revision, 1);
  assert(events.includes("cancel-ack"));
  equal((f.f.settlements[0] as { success: boolean }).success, false);
  finish({ binding, records: [] });
  await Promise.resolve();
  await Promise.resolve();
  equal(f.f.reports.get(REPORT)!.revision, 1);
});
Deno.test("professional gate rejects missing physical cancellation contract", async () => {
  const f = await fixture(), events: string[] = [], g = fakeGate(f, events);
  install(f, { ...g.gate, evidence: { read: g.gate.evidence.read } });
  equal((await f.handler(f.request("pro.candidates", input))).status, 503);
  equal(g.calls(), 0);
  equal(f.f.reports.get(REPORT)!.revision, 1);
});

Deno.test("professional unapproved physical stop evidence fails before provider", async () => {
  const f = await fixture(), events: string[] = [], g = fakeGate(f, events);
  install(f, {
    ...g.gate,
    verifyAdmission: () => Promise.reject(new Error("SYNTHETIC-cancellation-not-approved")),
  });
  equal((await f.handler(f.request("pro.candidates", input))).status, 503);
  equal(g.calls(), 0);
  equal(f.f.reports.get(REPORT)!.revision, 1);
  equal((f.f.settlements[0] as { success: boolean }).success, false);
});
Deno.test("professional synthetic sidecar deadline stops before settlement and ignores late result", async () => {
  const f = await fixture(), events: string[] = [];
  let finish!: (
    result: { binding: WildcardBatchBinding; records: readonly WildcardBatchRecord[] },
  ) => void;
  let binding!: WildcardBatchBinding, stopped = false;
  const g = fakeGate(f, events, (b, signal) => {
    binding = b;
    signal.addEventListener("abort", () => {
      stopped = true;
      events.push("synthetic-io-stopped");
    }, { once: true });
    return new Promise((resolve) => finish = resolve);
  });
  const evidence = {
    ...g.gate.evidence,
    cancelAndWait: () => {
      assert(stopped);
      events.push("cancel-ack");
      return Promise.resolve();
    },
  };
  install(f, { ...g.gate, maximumRuntimeMilliseconds: 5, evidence });
  const response = await f.handler(f.request("pro.candidates", input));
  equal(response.status, 503);
  equal(f.f.reports.get(REPORT)!.revision, 1);
  assert(events.includes("cancel-ack"));
  equal((f.f.settlements[0] as { success: boolean }).success, false);
  finish({ binding, records: [] });
  await Promise.resolve();
  await Promise.resolve();
  equal(f.f.reports.get(REPORT)!.revision, 1);
});

function verifiedHandler(
  f: Fixture,
  events: string[],
  revokeAfterFirst = false,
  rejectProof = false,
  revokeAtFinalAuthentication = false,
) {
  let authentications = 0, revokedAtFinalAuthentication = false;
  const oldFinish = f.ports.usage.finish;
  (f.ports.usage as unknown as { finish: typeof oldFinish }).finish = async (...args) => {
    events.push("settlement");
    return await oldFinish(...args);
  };
  return createProfessionalHandler({
    contract: PROFESSIONAL_CONTRACT,
    relay: new RelayBoundary(RELAY),
    sessions: {
      verifyUserBearer: (token) => {
        authentications++;
        if (revokeAtFinalAuthentication && authentications === 3) {
          revokedAtFinalAuthentication = true;
        }
        return Promise.resolve(token === "SYNTHETIC-bearer" ? f.user() : null);
      },
    },
    clock: f.clock,
    projection: f.projection,
    service: () => Promise.resolve(f.service),
    mutationGuard: professionalMutationGuard(ORIGIN),
    maximumRequestMilliseconds: 1000,
    wildcardProjectionAuthority: {
      resolve: (operation, user, response, boundary, signal) => {
        events.push("proof-source");
        if (rejectProof) return Promise.reject(new Error("SYNTHETIC-proof-source-down"));
        assert(operation === "pro.candidates" && user.subjectId === ACTOR && !signal.aborted);
        assert(
          boundary.scope.authority.contract.orgId === ORG &&
            boundary.scope.student?.studentId === STUDENT,
        );
        assert(boundary.admission.id.startsWith("SYNTHETIC-lease"));
        const report = f.f.reports.get(REPORT)!;
        assert(report.orgId === ORG && report.studentId === STUDENT && report.revision === 2);
        const candidates = (response.data as NativeObject).candidates as NativeObject;
        const expected = nativeJsonText(candidates._wildcard_selection_view, true);
        let checks = 0, currentChecks = 0;
        // This fake represents a separately verified writer/revision receipt; it is not production proof.
        return Promise.resolve({
          assertCurrent: () => {
            events.push("proof-current");
            currentChecks++;
            return (revokeAfterFirst && currentChecks > 1) || revokedAtFinalAuthentication
              ? Promise.reject(new Error("SYNTHETIC-revoked"))
              : Promise.resolve();
          },
          authorizes: (
            { operation: op, root, privateView }: {
              operation: string;
              root: unknown;
              privateView: unknown;
            },
          ) => {
            events.push("projection-proof");
            checks++;
            const envelope = root as NativeObject;
            return op === "pro.candidates" && envelope.org_id === ORG &&
              envelope.student_id === STUDENT &&
              nativeJsonText(privateView, true) === expected && (!revokeAfterFirst || checks <= 2);
          },
        });
      },
    },
  });
}
Deno.test("professional verified revision survives both projections and exact settled bytes", async () => {
  const f = await fixture(), events: string[] = [], g = fakeGate(f, events);
  install(f, g.gate);
  const response = await verifiedHandler(f, events)(f.request("pro.candidates", input));
  assert(response.status === 200, await response.clone().text());
  const body = await response.text(), output = JSON.parse(body);
  equal(output.data.candidates.wildcard_selection.status, "pending");
  equal(events.filter((x) => x === "projection-proof").length, 4);
  assert(
    events.indexOf("settlement") > events.indexOf("projection-proof") &&
      events.lastIndexOf("projection-proof") > events.indexOf("settlement"),
  );
  equal(
    (f.f.settlements[0] as { bytes: bigint }).bytes,
    BigInt(new TextEncoder().encode(body).length),
  );
});
Deno.test("professional final revision proof revocation suppresses response after settlement", async () => {
  const f = await fixture(), events: string[] = [], g = fakeGate(f, events);
  install(f, g.gate);
  const response = await verifiedHandler(f, events, true)(f.request("pro.candidates", input));
  equal(response.status, 503);
  equal(f.f.reports.get(REPORT)!.revision, 2);
  assert(events.includes("settlement"));
  assert(!(await response.text()).includes("wildcard_selection"));
});

Deno.test("professional old report skips proof source and unavailable proof preserves legacy cards", async () => {
  const old = await fixture(), oldEvents: string[] = [];
  install(old, null);
  const legacy = await verifiedHandler(old, oldEvents, false, true)(
    old.request("pro.candidates", input),
  );
  equal(legacy.status, 200);
  assert(!oldEvents.includes("proof-source"));
  const newer = await fixture(), events: string[] = [], g = fakeGate(newer, events);
  install(newer, g.gate);
  const fallback = await verifiedHandler(newer, events, false, true)(
    newer.request("pro.candidates", input),
  );
  equal(fallback.status, 200);
  assert(events.includes("proof-source"));
  const dto = await fallback.json(),
    saved = newer.f.reports.get(REPORT)!.body.candidates as NativeObject;
  assert(!Object.hasOwn(dto.data.candidates, "wildcard_selection"));
  equal(dto.data.candidates.wildcards.length, (saved.wildcards as unknown[]).length);
});

Deno.test("professional final reauthentication revocation rejects before response", async () => {
  const f = await fixture(), events: string[] = [], g = fakeGate(f, events);
  install(f, g.gate);
  const response = await verifiedHandler(f, events, false, false, true)(
    f.request("pro.candidates", input),
  );
  equal(response.status, 503);
  equal(f.f.reports.get(REPORT)!.revision, 2);
  equal(f.f.settlements.length, 1);
  assert(!(await response.text()).includes("wildcard_selection"));
});
