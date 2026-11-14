/** Synthetic test only: no DB, real releases or production authorization. */
import {
  readSnapshotRecruitmentBatch,
  type SnapshotBatchTrust,
  snapshotRecruitmentStage,
} from "./current_public_p1_snapshot_batch.ts";
import type { CurrentPublicCatalogPort, PublicCatalogRecord } from "./current_public_catalog.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./jungsi/application/api_dispatch.ts";
import { AccessError } from "./jungsi/application/access.ts";
import { nativeJsonSha256 } from "./jungsi/domain/json_value.ts";
const HEAD = "a".repeat(64),
  PUB = "b".repeat(64),
  SCOPE = "c".repeat(64),
  SNAP = "d".repeat(32),
  USER = "synthetic-user";
const assert = (v: unknown) => {
  if (!v) throw new Error("assertion_failed");
};
async function rejects(f: () => Promise<unknown>) {
  let failed = false;
  try {
    await f();
  } catch {
    failed = true;
  }
  assert(failed);
}
async function rejectsWith(f: () => Promise<unknown>, code: string, http: number) {
  try {
    await f();
  } catch (error) {
    assert(error instanceof AccessError && error.code === code && error.http === http);
    return;
  }
  throw new Error("expected_access_error");
}
function record(
  source: string,
  pk: string,
  value: bigint | number | string | null = 17n,
  stage: string | null = "initial",
): PublicCatalogRecord {
  return {
    key: [2027, "S", pk, "", `2027:${pk}`],
    row: {
      academic_year: 2027,
      school_id: "S",
      offering_pk: pk,
      offering_id: `2027:${pk}`,
      lookup_requested_id: source,
      active_service: true,
    },
    guide: {
      academic_year: 2027,
      school_id: "S",
      offering_pk: pk,
      offering_id: `2027:${pk}`,
      recruitment_link_status: "verified",
      active_service: true,
      quota_value: value,
      quota_literal_state: "numeric_literal",
      metadata: { quota_stage: stage },
    },
  };
}
function fixture() {
  const control = new AbortController();
  let lookups = 0, binds = 0, publications = 0;
  let activeExecution: ApiExecution | null = null;
  const state = {
    head: HEAD,
    decisions: ["ALLOW", "HOLD"],
    rows: [record("2026:A", "X"), record("2025:B", "Y")],
    changeBind: false,
    changeSnapshotBind: false,
    changeRequestPath: false,
    mutateParams: null as "add" | "delete" | "getter" | null,
    extraInitialParam: false,
    paramGetterReads: 0,
    changeOperationOnPublication: false,
    changeOperationOnBind: false,
    changeQueryOnBind: false,
    expiredSession: false,
    changeSnapshotHead: false,
    changeBindingField: null as
      | "snapshotPublication"
      | "snapshotPartSha256"
      | "correspondenceSha256"
      | null,
    partOverride: undefined as string | undefined,
    membershipByPart: null as Record<string, string[]> | null,
    mutateDecision: null as "decision" | "target" | "stage" | "base" | "rollover" | null,
    mutationCount: 0,
    snapshotOverride: null as string | null,
    relation: ["ALLOW", "ALLOW"] as string[],
    condition: "none" as "none" | "conditional" | "unknown",
    conditionText: null as string | null,
    conditions: [] as ("none" | "conditional" | "unknown")[],
    conditionTexts: [] as (string | null)[],
    baseEvidence: [] as ({
      status: "confirmed";
      initialValue: string | number | bigint;
    } | null)[],
    rolloverEvidence: [] as ({ status: "verified"; state: "unresolved" } | null)[],
    suppressTarget: [] as boolean[],
    suppressStage: [] as boolean[],
    badTargetHash: [] as boolean[],
    badBaseBinding: null as "target" | "head" | "hash" | null,
    badStageBinding: null as "target" | "head" | "hash" | null,
    badRolloverBinding: null as "target" | "head" | "hash" | null,
    stageOverrides: [] as ("initial" | "final" | null)[],
  };
  const request = {
    operation: "history.snapshot.read",
    session: {
      user: { subjectId: USER, expiresAtUtc: 900n },
      evaluatedAtUtc: 50n,
      tier: "standard",
      paidUntilUtc: null,
    },
    management: null,
    body: {},
    query: {},
    params: {},
    requestKey: null,
  } as ApiExecution;
  const boundary = {
    signal: control.signal,
    admission: Object.freeze({ permit: "test" }),
  } as ApiExecutionBoundary;
  const catalog: CurrentPublicCatalogPort = {
    publication: () => {
      publications++;
      if (state.changeOperationOnPublication && activeExecution && publications === 1) {
        (activeExecution as unknown as { operation: string }).operation = "history.snapshot.head";
      }
      return Promise.resolve({ version: "synthetic", sha256: PUB, expiresAtUtc: 1000n });
    },
    search: () => Promise.reject(new Error("unexpected_search")),
    lookup: async (subject, ids, recruitment) => {
      await Promise.resolve();
      lookups++;
      assert(subject === USER && recruitment && Object.isFrozen(ids));
      return {
        version: "synthetic",
        head: state.head,
        asOfUtc: 80n,
        rows: state.rows.filter((r) => ids.includes(String(r.row.lookup_requested_id))),
      };
    },
  };
  const trust: SnapshotBatchTrust = {
    bind: async (r, _b, snapshot, partId, ids, pub) => {
      await Promise.resolve();
      binds++;
      assert(Object.isFrozen(ids));
      if (state.changeRequestPath && binds === 1) {
        (r.params as Record<string, string>).snapshot_id = "another-snapshot";
      }
      if (state.mutateParams && binds === 1) {
        const params = r.params as Record<string, string>;
        if (state.mutateParams === "add") params.unexpected = "value";
        if (state.mutateParams === "delete") delete params.snapshot_id;
        if (state.mutateParams === "getter") {
          Object.defineProperty(params, "snapshot_id", {
            enumerable: true,
            configurable: true,
            get: () => {
              state.paramGetterReads++;
              return SNAP;
            },
          });
        }
      }
      if (state.changeQueryOnBind && binds === 1) {
        (r.query as Record<string, string>).part_id = "part-b";
      }
      if (state.changeOperationOnBind && binds === 1) {
        (r as unknown as { operation: string }).operation = "history.snapshot.head";
      }
      if (
        state.membershipByPart &&
        ids.some((id) => !state.membershipByPart![partId ?? "<full>"]?.includes(id))
      ) throw new AccessError("snapshot_part_not_found", 404);
      return {
        subject: USER,
        snapshot: state.snapshotOverride ??
          (state.changeSnapshotBind && binds > 1 ? "another-snapshot" : snapshot),
        snapshotPublication:
          (state.changeBindingField === "snapshotPublication" && binds > 1 ? "7" : "1")
            .repeat(64),
        snapshotSourceHead: state.changeSnapshotHead && binds > 1 ? "2".repeat(64) : "3".repeat(64),
        snapshotPart: state.partOverride ?? partId,
        snapshotPartSha256:
          (state.changeBindingField === "snapshotPartSha256" && binds > 1
            ? "7"
            : partId === "part-b"
            ? "4"
            : "5").repeat(64),
        correspondenceSha256:
          (state.changeBindingField === "correspondenceSha256" && binds > 1 ? "7" : "6").repeat(64),
        publication: pub.sha256,
        head: state.changeBind && binds > 1 ? "e".repeat(64) : HEAD,
        scopeRevision: SCOPE,
      };
    },
    classify: async (_r, _b, binding, rows) => {
      const decisions = await Promise.all(
        rows.map(async (r, i) => {
          const guide = r.guide!;
          const quota = guide.quota_value;
          const guideHash = await nativeJsonSha256(guide);
          const targetId = String(r.row.offering_id);
          const scope = (bad: "target" | "head" | "hash" | null) => ({
            targetId: bad === "target" ? "2027:OTHER" : targetId,
            guideHead: bad === "head" ? "9".repeat(64) : binding.head,
            guideRecordSha256: bad === "hash" ? "f".repeat(64) : guideHash,
          });
          const kind = typeof quota;
          const quotaNativeType: "missing" | "null" | "string" | "number" | "bigint" | "other" =
            !Object.hasOwn(guide, "quota_value")
              ? "missing"
              : quota === null
              ? "null"
              : kind === "string" || kind === "number" || kind === "bigint"
              ? kind
              : "other";
          const metadata = guide.metadata as { quota_stage?: unknown } | null;
          const stage = state.stageOverrides[i] !== undefined
            ? state.stageOverrides[i]
            : metadata?.quota_stage;
          return {
            sourceId: String(r.row.lookup_requested_id),
            targetId,
            decision: state.decisions[i] as "ALLOW" | "HOLD" | "EXCLUDE",
            relation: (state.relation[i] ?? "ALLOW") as "ALLOW" | "HOLD",
            condition: state.conditions[i] ?? state.condition,
            conditionText: state.conditionTexts[i] !== undefined
              ? state.conditionTexts[i]
              : state.conditionText,
            ...(state.suppressTarget[i] ? {} : {
              targetEvidence: {
                status: "verified" as const,
                ...scope(null),
                guideRecordSha256: state.badTargetHash[i] ? "f".repeat(64) : guideHash,
                quotaNativeType,
              },
            }),
            ...(state.suppressStage[i] || (stage !== "initial" && stage !== "final") ? {} : {
              stageEvidence: {
                status: "verified" as const,
                stage: stage as "initial" | "final",
                ...scope(i === 0 ? state.badStageBinding : null),
              },
            }),
            ...(state.baseEvidence[i]
              ? {
                baseRecruitmentEvidence: {
                  ...state.baseEvidence[i]!,
                  ...scope(i === 0 ? state.badBaseBinding : null),
                },
              }
              : {}),
            ...(state.rolloverEvidence[i]
              ? {
                rolloverEvidence: {
                  ...state.rolloverEvidence[i]!,
                  ...scope(i === 0 ? state.badRolloverBinding : null),
                },
              }
              : {}),
          };
        }),
      );
      const mode = state.mutateDecision;
      if (mode) {
        queueMicrotask(() =>
          queueMicrotask(() => {
            const d = decisions[0] as unknown as {
              condition: string;
              targetEvidence: { guideRecordSha256: string };
              stageEvidence: { stage: string };
              baseRecruitmentEvidence: { initialValue: bigint };
              rolloverEvidence: { state: string };
            };
            if (mode === "decision") d.condition = "unknown";
            if (mode === "target") d.targetEvidence.guideRecordSha256 = "f".repeat(64);
            if (mode === "stage") d.stageEvidence.stage = "final";
            if (mode === "base") d.baseRecruitmentEvidence.initialValue = 18n;
            if (mode === "rollover") d.rolloverEvidence.state = "forged";
            state.mutationCount++;
          })
        );
      }
      return decisions;
    },
  };
  const run = (
    ids: readonly string[] = ["2026:A", "2025:B"],
    t: SnapshotBatchTrust | null = trust,
    snapshot = SNAP,
    requestedSnapshot: unknown = snapshot,
    omitSnapshot = false,
    partId: unknown = undefined,
  ) => {
    if (state.expiredSession) {
      (request.session.user as unknown as { expiresAtUtc: bigint }).expiresAtUtc = 100n;
    }
    const execution = {
      ...request,
      params: omitSnapshot ? {} : {
        snapshot_id: requestedSnapshot,
        ...(state.extraInitialParam ? { unexpected: "value" } : {}),
      },
      query: partId === undefined ? {} : { part_id: partId },
    } as unknown as ApiExecution;
    activeExecution = execution;
    return readSnapshotRecruitmentBatch(
      execution,
      boundary,
      snapshot,
      ids,
      catalog,
      { nowUtc: () => 100n },
      t,
    );
  };
  return {
    state,
    control,
    run,
    get lookups() {
      return lookups;
    },
    get binds() {
      return binds;
    },
    get publications() {
      return publications;
    },
  };
}
Deno.test("one lookup returns approved reference and holds the other row", async () => {
  const f = fixture(), r = await f.run();
  assert(
    f.lookups === 1 && f.binds === 2 && r[0].status === "reference" && r[0].value === 17n &&
      r[0].displayValue === "17" &&
      r[1].status === "pending",
  );
});
Deno.test("no trusted binding fails before lookup", async () => {
  const f = fixture();
  await rejects(() => f.run(undefined, null));
  assert(f.lookups === 0);
});
Deno.test("missing row remains pending; explicit exclusion is not exposed", async () => {
  const f = fixture();
  f.state.rows = [record("2026:A", "X")];
  f.state.decisions = ["EXCLUDE"];
  const r = await f.run();
  assert(r[0].status === "excluded" && r[1].status === "pending");
});
Deno.test("changed current head, binding and mismatched row identity are rejected", async () => {
  const a = fixture();
  a.state.head = "e".repeat(64);
  await rejects(() => a.run());
  const b = fixture();
  b.state.changeBind = true;
  await rejects(() => b.run());
  const c = fixture();
  c.state.rows[0].guide!.school_id = "other";
  await rejects(() => c.run());
});
Deno.test("unverified relation stays pending without blocking another row", async () => {
  const f = fixture();
  f.state.rows[0].guide!.recruitment_link_status = "unqualified";
  f.state.rows[0].row.academic_year = 2026;
  f.state.rows[0].row.offering_id = "2026:A";
  f.state.decisions = ["ALLOW"];
  const r = await f.run();
  assert(r[0].status === "pending" && r[1].status === "reference");
  const g = fixture();
  await rejects(() => g.run(["2026:A", "2026:A"]));
  assert(g.lookups === 0);
});
Deno.test("initial zero is preserved while final or unknown zero stays pending", async () => {
  for (
    const [stage, status] of [["initial", "reference"], ["final", "pending"], [
      null,
      "pending",
    ]] as const
  ) {
    const f = fixture();
    f.state.rows = [record("2026:A", "X", 0n, stage)];
    f.state.decisions = ["ALLOW"];
    const r = await f.run(["2026:A"]);
    assert(r[0].status === status);
  }
});
Deno.test("aborted request fails before lookup", async () => {
  const f = fixture();
  f.control.abort();
  await rejects(() => f.run());
  assert(f.lookups === 0);
});

Deno.test("25 keys use three bounded lookups under the shard limit", async () => {
  const f = fixture(), ids = Array.from({ length: 25 }, (_, i) => `2026:P${i}`);
  f.state.rows = ids.map((id, i) => record(id, `T${i}`));
  f.state.decisions = ids.map(() => "ALLOW");
  const r = await f.run(ids);
  assert(f.lookups === 3 && r.length === 25 && r.every((x) => x.status === "reference"));
});

Deno.test("conditional count stays pending even if a stage is present", async () => {
  const f = fixture();
  f.state.rows[0].guide!.quota_literal_state = "conditional_carryover";
  const r = await f.run();
  assert(r[0].status === "pending");
});
Deno.test("numeric literal string remains a reference, malformed or zero string stays pending", async () => {
  for (
    const [raw, expected] of [["37", "reference"], ["0", "pending"], [
      "37 people",
      "pending",
    ]] as const
  ) {
    const f = fixture();
    f.state.rows = [record("2026:A", "X", raw, null)];
    f.state.decisions = ["ALLOW"];
    const r = await f.run(["2026:A"]);
    assert(r[0].status === expected);
  }
});
Deno.test("confirmed scope exclusion of final zero remains distinct", async () => {
  const f = fixture();
  f.state.rows = [record("2026:A", "X", 0n, "final")];
  f.state.decisions = ["EXCLUDE"];
  const r = await f.run(["2026:A"]);
  assert(r[0].status === "excluded");
});

Deno.test("a held source relation takes precedence over target exclusion", async () => {
  const f = fixture();
  f.state.rows = [
    record("2026:A", "X"),
    record("2025:B", "X"),
    record("2024:C", "Y"),
  ];
  f.state.decisions = ["EXCLUDE", "EXCLUDE", "ALLOW"];
  f.state.relation = ["HOLD", "ALLOW", "ALLOW"];
  const r = await f.run(["2026:A", "2025:B", "2024:C"]);
  assert(r[0].status === "pending" && r[1].status === "excluded" && r[2].status === "reference");
});

Deno.test("existing snapshot IDs retain their full contract and same-snapshot binding", async () => {
  const ids = [
    SNAP,
    "A",
    "snapshot-v3:Alpha_01.test",
    "p1v3-" + "a".repeat(32),
    "Z" + "a".repeat(127),
  ];
  for (const snapshot of ids) {
    const f = fixture();
    const rows = await f.run(undefined, undefined, snapshot);
    assert(f.binds === 2 && f.lookups === 1 && rows[0].status === "reference");
  }
  const changed = fixture();
  changed.state.changeSnapshotBind = true;
  await rejects(() => changed.run(undefined, undefined, "snapshot-v3:Alpha_01.test"));
  assert(changed.binds === 2 && changed.lookups === 1);
  const mismatched = fixture();
  mismatched.state.snapshotOverride = "another-snapshot";
  await rejects(() => mismatched.run(undefined, undefined, "snapshot-v3:Alpha_01.test"));
  assert(mismatched.binds === 1 && mismatched.lookups === 0);
});

Deno.test("invalid snapshot IDs are rejected before catalog or trust access", async () => {
  const invalid = [
    "",
    "-bad",
    ".bad",
    "_bad",
    "A/B",
    "A B",
    "A?B",
    "A\nB",
    "가",
    "A".repeat(129),
    null,
    123,
  ];
  for (const snapshot of invalid) {
    const f = fixture();
    await rejectsWith(
      () => f.run(undefined, undefined, snapshot as unknown as string),
      "invalid_request",
      422,
    );
    assert(f.publications === 0 && f.binds === 0 && f.lookups === 0);
  }
});

Deno.test("request snapshot is required and must match the internal snapshot", async () => {
  const missing = fixture();
  await rejectsWith(
    () => missing.run(undefined, undefined, "valid-id", undefined, true),
    "invalid_request",
    422,
  );
  assert(missing.publications === 0 && missing.binds === 0 && missing.lookups === 0);
  const invalid = fixture();
  await rejectsWith(
    () => invalid.run(undefined, undefined, "valid-id", "bad/id"),
    "invalid_request",
    422,
  );
  assert(invalid.publications === 0 && invalid.binds === 0 && invalid.lookups === 0);
  const mismatch = fixture();
  await rejectsWith(
    () => mismatch.run(undefined, undefined, "valid-id", "other-id"),
    "publication_changed",
    409,
  );
  assert(mismatch.publications === 0 && mismatch.binds === 0 && mismatch.lookups === 0);
  const malformedInternal = fixture();
  await rejectsWith(
    () => malformedInternal.run(undefined, undefined, "bad/id", "valid-id"),
    "security_policy_unavailable",
    503,
  );
  assert(malformedInternal.publications === 0 && malformedInternal.binds === 0);
});

Deno.test("mutating the request snapshot during binding fails before lookup", async () => {
  const f = fixture();
  f.state.changeRequestPath = true;
  await rejects(() => f.run(undefined, undefined, "valid-id"));
  assert(f.binds === 1 && f.lookups === 0);
});

Deno.test("missing literal state cannot establish absence of conditions", async () => {
  const f = fixture();
  f.state.rows[0].guide!.quota_literal_state = null;
  const r = await f.run();
  assert(r[0].status === "pending");
});
Deno.test("numeric strings retain explicit initial and final stages", async () => {
  for (const stage of ["initial", "final"] as const) {
    const f = fixture();
    f.state.rows = [record("2026:A", "X", "37", stage)];
    f.state.decisions = ["ALLOW"];
    const r = await f.run(["2026:A"]);
    assert(r[0].status === "reference" && r[0].stage === stage);
  }
});

Deno.test("condition must be independently known and conditional text is retained", async () => {
  const f = fixture();
  f.state.condition = "unknown";
  const pending = await f.run();
  assert(pending[0].status === "pending");
  f.state.condition = "conditional";
  f.state.conditionText = "synthetic condition";
  const shown = await f.run();
  assert(shown[0].status === "reference" && shown[0].conditionText === "synthetic condition");
  assert(shown[0].status === "reference" && shown[0].carryoverStatus === undefined);
});

Deno.test("confirmed initial recruitment survives unresolved carryover without hiding other rows", async () => {
  const f = fixture();
  f.state.decisions = ["ALLOW", "ALLOW"];
  f.state.conditions = ["unknown", "none"];
  f.state.baseEvidence = [{ status: "confirmed", initialValue: 17n }];
  f.state.rolloverEvidence = [{ status: "verified", state: "unresolved" }];
  const rows = await f.run();
  assert(
    rows.length === 2 && rows[0].status === "reference" && rows[0].value === 17n &&
      rows[0].displayValue === "17" && rows[0].stage === "initial" &&
      rows[0].carryoverStatus === "unresolved" && rows[1].status === "reference",
  );
});

Deno.test("unknown or contradictory base counts preserve pending rows without inventing zero", async () => {
  for (const scenario of ["missing", "mismatch", "type_mismatch"] as const) {
    const f = fixture();
    f.state.decisions = ["ALLOW", "ALLOW"];
    f.state.conditions = ["unknown", "none"];
    f.state.baseEvidence = [{
      status: "confirmed",
      initialValue: scenario === "mismatch" ? 18n : scenario === "type_mismatch" ? "17" : 17n,
    }];
    f.state.rolloverEvidence = [{ status: "verified", state: "unresolved" }];
    if (scenario === "missing") f.state.rows[0].guide!.quota_value = null;
    const rows = await f.run();
    assert(
      rows.length === 2 && rows[0].sourceId === "2026:A" && rows[0].status === "pending" &&
        rows[1].status === "reference",
    );
  }
});

Deno.test("independently confirmed initial zero keeps its type and unresolved carryover", async () => {
  for (const value of [0n, 0, "0"] as const) {
    const f = fixture();
    f.state.rows[0] = record("2026:A", "X", value, "initial");
    f.state.decisions = ["ALLOW", "ALLOW"];
    f.state.conditions = ["unknown", "none"];
    f.state.baseEvidence = [{ status: "confirmed", initialValue: value }];
    f.state.rolloverEvidence = [{ status: "verified", state: "unresolved" }];
    const rows = await f.run();
    assert(
      rows[0].status === "reference" && rows[0].value === value &&
        typeof rows[0].value === typeof value && rows[0].displayValue === "0" &&
        rows[0].stage === "initial" && rows[0].carryoverStatus === "unresolved" &&
        rows[1].status === "reference",
    );
    f.state.baseEvidence = [];
    assert((await f.run())[0].status === "pending");
    f.state.baseEvidence = [{ status: "confirmed", initialValue: value }];
    f.state.suppressStage[0] = true;
    assert((await f.run())[0].status === "pending");
  }
});

Deno.test("unconfirmed conditional-only recruitment remains pending", async () => {
  const f = fixture();
  f.state.decisions = ["HOLD", "ALLOW"];
  f.state.conditions = ["conditional", "none"];
  f.state.conditionTexts = ["synthetic unconfirmed carryover", null];
  f.state.rows[0].guide!.quota_literal_state = "conditional_carryover";
  const rows = await f.run();
  assert(rows.length === 2 && rows[0].status === "pending" && rows[1].status === "reference");
});

Deno.test("conditional carryover final is not inferred from stage metadata", async () => {
  const f = fixture();
  f.state.decisions = ["ALLOW", "ALLOW"];
  f.state.conditions = ["conditional", "none"];
  f.state.conditionTexts = ["synthetic conditional notice", null];
  f.state.rows[0] = record("2026:A", "X", 17n, "final");
  f.state.rows[0].guide!.quota_literal_state = "conditional_carryover";
  const rows = await f.run();
  assert(rows[0].status === "pending" && rows[1].status === "reference");
});

Deno.test("missing or mismatched independent target evidence holds only that row", async () => {
  for (const mode of ["missing", "mismatch"] as const) {
    const f = fixture();
    f.state.decisions = ["ALLOW", "ALLOW"];
    if (mode === "missing") f.state.suppressTarget[0] = true;
    else f.state.badTargetHash[0] = true;
    const rows = await f.run();
    assert(rows[0].status === "pending" && rows[1].status === "reference");
  }
  const excluded = fixture();
  excluded.state.decisions = ["EXCLUDE", "ALLOW"];
  excluded.state.suppressTarget[0] = true;
  const rows = await excluded.run();
  assert(rows[0].status === "pending" && rows[1].status === "reference");
});

Deno.test("unverified stage becomes unknown and maps to unspecified", async () => {
  const f = fixture();
  f.state.decisions = ["ALLOW", "ALLOW"];
  f.state.suppressStage[0] = true;
  const rows = await f.run();
  assert(rows[0].status === "reference" && rows[0].stage === "unknown");
  assert(
    rows[0].status === "reference" && snapshotRecruitmentStage(rows[0].stage) === "unspecified",
  );
  assert(rows[1].status === "reference" && rows[1].stage === "initial");
  assert(snapshotRecruitmentStage("initial") === "initial");
  assert(snapshotRecruitmentStage("final") === "final");
});

Deno.test("reference count keeps native type separate from display text", async () => {
  for (const value of [17n, 17, "17"] as const) {
    const f = fixture();
    f.state.rows = [record("2026:A", "X", value, "initial")];
    f.state.decisions = ["ALLOW"];
    const rows = await f.run(["2026:A"]);
    assert(
      rows[0].status === "reference" && typeof rows[0].value === typeof value &&
        rows[0].value === value && rows[0].displayValue === "17",
    );
  }
});

Deno.test("same target conflicting Guide counts, types or stages hold only that target", async () => {
  for (const mode of ["count", "type", "stage"] as const) {
    const f = fixture();
    f.state.rows = [
      record("2026:A", "X", 17n, "initial"),
      record(
        "2025:B",
        "X",
        mode === "count" ? 18n : mode === "type" ? 17 : 17n,
        mode === "stage" ? "final" : "initial",
      ),
      record("2024:C", "Y", 17n, "initial"),
    ];
    f.state.decisions = ["ALLOW", "ALLOW", "ALLOW"];
    f.state.relation = ["ALLOW", "ALLOW", "ALLOW"];
    const rows = await f.run(["2026:A", "2025:B", "2024:C"]);
    assert(rows[0].status === "pending" && rows[1].status === "pending");
    assert(rows[2].status === "reference");
  }
});

Deno.test("relation-only hold does not spread conflicting Guide data to another source", async () => {
  const f = fixture();
  f.state.rows = [record("2026:A", "X", 18n), record("2025:B", "X", 17n)];
  f.state.decisions = ["ALLOW", "ALLOW"];
  f.state.relation = ["HOLD", "ALLOW"];
  f.state.suppressTarget[0] = true;
  const rows = await f.run();
  assert(rows[0].status === "pending" && rows[1].status === "reference");
});

Deno.test("same target conflicting stage or base proofs hold that target only", async () => {
  for (const mode of ["stage", "base"] as const) {
    const f = fixture();
    f.state.rows = [record("2026:A", "X"), record("2025:B", "X"), record("2024:C", "Y")];
    f.state.decisions = ["ALLOW", "ALLOW", "ALLOW"];
    f.state.relation = ["ALLOW", "ALLOW", "ALLOW"];
    if (mode === "stage") f.state.stageOverrides = ["initial", "final"];
    else {
      f.state.conditions = ["unknown", "unknown", "none"];
      f.state.baseEvidence = [
        { status: "confirmed", initialValue: 17n },
        { status: "confirmed", initialValue: 18n },
      ];
      f.state.rolloverEvidence = [
        { status: "verified", state: "unresolved" },
        { status: "verified", state: "unresolved" },
      ];
    }
    const rows = await f.run(["2026:A", "2025:B", "2024:C"]);
    assert(rows[0].status === "pending" && rows[1].status === "pending");
    assert(rows[2].status === "reference");
  }
});
Deno.test("same-target hold affects all links; relation hold affects only its own link", async () => {
  const f = fixture();
  f.state.rows[1] = record("2025:B", "X");
  const held = await f.run();
  assert(held.every((r) => r.status === "pending"));
  f.state.decisions = ["ALLOW", "ALLOW"];
  f.state.relation = ["ALLOW", "HOLD"];
  const mixed = await f.run();
  assert(mixed[0].status === "reference" && mixed[1].status === "pending");
});
Deno.test("malformed condition evidence fails closed", async () => {
  const f = fixture();
  f.state.condition = "conditional";
  f.state.conditionText = null;
  await rejects(() => f.run());
});

Deno.test("no general condition can coexist with independent unresolved rollover", async () => {
  for (const value of [0n, 0, "0", 17n, 17, "17"] as const) {
    const f = fixture();
    f.state.rows[0] = record("2026:A", "X", value, "initial");
    f.state.decisions = ["ALLOW", "ALLOW"];
    f.state.conditions = ["none", "none"];
    f.state.baseEvidence = [{ status: "confirmed", initialValue: value }];
    f.state.rolloverEvidence = [{ status: "verified", state: "unresolved" }];
    const rows = await f.run();
    assert(
      rows[0].status === "reference" && rows[0].value === value &&
        typeof rows[0].value === typeof value && rows[0].displayValue === String(value) &&
        rows[0].stage === "initial" && rows[0].conditionText === null &&
        rows[0].carryoverStatus === "unresolved" && rows[1].status === "reference",
    );
  }
  const noRollover = fixture();
  noRollover.state.decisions = ["ALLOW", "ALLOW"];
  noRollover.state.conditions = ["unknown", "none"];
  noRollover.state.baseEvidence = [{ status: "confirmed", initialValue: 17n }];
  const rows = await noRollover.run();
  assert(rows[0].status === "reference" && rows[0].carryoverStatus === undefined);
  const literal = fixture();
  literal.state.decisions = ["ALLOW", "ALLOW"];
  literal.state.rows[0].guide!.quota_literal_state = "conditional_carryover";
  literal.state.baseEvidence = [{ status: "confirmed", initialValue: 17n }];
  literal.state.rolloverEvidence = [{ status: "verified", state: "unresolved" }];
  const literalRows = await literal.run();
  assert(literalRows[0].status === "reference" && literalRows[0].carryoverStatus === "unresolved");
});

Deno.test("independent rollover with final stage holds only that target without base evidence", async () => {
  for (const decision of ["ALLOW", "EXCLUDE"] as const) {
    const f = fixture();
    f.state.rows = [
      record("2026:A", "X", 17n, "final"),
      record("2025:B", "X", 17n, "final"),
      record("2024:C", "Y", 17n, "initial"),
    ];
    f.state.decisions = [decision, decision, "ALLOW"];
    f.state.relation = ["ALLOW", "ALLOW", "ALLOW"];
    f.state.rolloverEvidence = [{ status: "verified", state: "unresolved" }];
    const rows = await f.run(["2026:A", "2025:B", "2024:C"]);
    assert(rows[0].status === "pending" && rows[1].status === "pending");
    assert(rows[2].status === "reference");
  }
  const noBase = fixture();
  noBase.state.decisions = ["ALLOW", "ALLOW"];
  noBase.state.rolloverEvidence = [{ status: "verified", state: "unresolved" }];
  const rows = await noBase.run();
  assert(rows[0].status === "pending" && rows[1].status === "reference");
});

Deno.test("verified stage conflict holds the affected target, even before exclusion", async () => {
  for (const [guide, proof] of [["initial", "final"], ["final", "initial"]] as const) {
    for (const decision of ["ALLOW", "EXCLUDE"] as const) {
      const f = fixture();
      f.state.rows = [
        record("2026:A", "X", 17n, guide),
        record("2025:B", "X", 17n, guide),
        record("2024:C", "Y", 17n, "initial"),
      ];
      f.state.decisions = [decision, decision, "ALLOW"];
      f.state.stageOverrides = [proof];
      f.state.suppressStage = [false, true, false];
      const rows = await f.run(["2026:A", "2025:B", "2024:C"]);
      assert(rows[0].status === "pending" && rows[1].status === "pending");
      assert(rows[2].status === "reference");
    }
  }
  const held = fixture();
  held.state.rows = [record("2026:A", "X"), record("2025:B", "X")];
  held.state.decisions = ["ALLOW", "ALLOW"];
  held.state.relation = ["HOLD", "ALLOW"];
  held.state.stageOverrides = ["final"];
  held.state.suppressTarget[0] = true;
  const rows = await held.run();
  assert(rows[0].status === "pending" && rows[1].status === "reference");
});

Deno.test("expired session and operation mutation stop before further port calls", async () => {
  const expired = fixture();
  expired.state.expiredSession = true;
  await rejects(() => expired.run());
  assert(expired.publications === 0 && expired.binds === 0 && expired.lookups === 0);
  for (const point of ["publication", "bind"] as const) {
    const f = fixture();
    if (point === "publication") f.state.changeOperationOnPublication = true;
    else f.state.changeOperationOnBind = true;
    await rejects(() => f.run());
    assert(f.lookups === 0 && f.binds === (point === "bind" ? 1 : 0));
  }
});

Deno.test("snapshot part membership, query mutation and independent head are bound", async () => {
  const f = fixture();
  f.state.membershipByPart = { "part-a": ["2026:A"], "part-b": ["2025:B"] };
  const valid = await f.run(["2026:A"], undefined, SNAP, SNAP, false, "part-a");
  assert(valid[0].status === "reference");
  await rejects(() => f.run(["2026:A"], undefined, SNAP, SNAP, false, "part-b"));
  const mutate = fixture();
  mutate.state.changeQueryOnBind = true;
  await rejects(() => mutate.run(["2026:A"], undefined, SNAP, SNAP, false, "part-a"));
  assert(mutate.lookups === 0);
  const mismatch = fixture();
  mismatch.state.partOverride = "part-b";
  await rejects(() => mismatch.run(["2026:A"], undefined, SNAP, SNAP, false, "part-a"));
  const changedHead = fixture();
  changedHead.state.changeSnapshotHead = true;
  await rejects(() => changedHead.run());
  for (
    const field of ["snapshotPublication", "snapshotPartSha256", "correspondenceSha256"] as const
  ) {
    const changed = fixture();
    changed.state.changeBindingField = field;
    await rejects(() => changed.run());
  }
  const invalid = fixture();
  await rejectsWith(
    () => invalid.run(["2026:A"], undefined, SNAP, SNAP, false, ""),
    "invalid_request",
    422,
  );
  assert(invalid.publications === 0);
});

Deno.test("async mutation cannot alter a frozen decision or its evidence", async () => {
  for (const mode of ["decision", "target", "stage", "base", "rollover"] as const) {
    const f = fixture();
    f.state.decisions = ["ALLOW", "ALLOW"];
    f.state.mutateDecision = mode;
    if (mode === "base" || mode === "rollover") {
      f.state.baseEvidence = [{ status: "confirmed", initialValue: 17n }];
      f.state.rolloverEvidence = [{ status: "verified", state: "unresolved" }];
    }
    const rows = await f.run();
    assert(f.state.mutationCount === 1);
    assert(rows[0].status === "reference" && rows[0].value === 17n && rows[0].stage === "initial");
    if (mode === "base" || mode === "rollover") {
      assert(rows[0].status === "reference" && rows[0].carryoverStatus === "unresolved");
    }
    assert(rows[1].status === "reference");
  }
});

Deno.test("confirmed recruitment with an unknown count preserves the pending source row", async () => {
  const f = fixture();
  f.state.decisions = ["ALLOW", "ALLOW"];
  f.state.rows[0].guide!.quota_value = null;
  const rows = await f.run();
  assert(rows.length === 2 && rows[0].sourceId === "2026:A" && rows[0].status === "pending");
  assert(rows[1].status === "reference");
});

Deno.test("held relation unknown condition does not contaminate a verified relation", async () => {
  const f = fixture();
  f.state.rows = [record("2026:A", "X"), record("2025:B", "X"), record("2024:C", "Y")];
  f.state.decisions = ["ALLOW", "ALLOW", "ALLOW"];
  f.state.relation = ["HOLD", "ALLOW", "ALLOW"];
  f.state.conditions = ["unknown", "none", "none"];
  const rows = await f.run(["2026:A", "2025:B", "2024:C"]);
  assert(rows[0].status === "pending" && rows[1].status === "reference");
  assert(rows[2].status === "reference");
});

Deno.test("target condition conflicts and target decisions remain target-wide", async () => {
  for (
    const mode of ["condition", "held_verified_condition", "target_hold", "target_exclude"] as const
  ) {
    const f = fixture();
    f.state.rows = [record("2026:A", "X"), record("2025:B", "X"), record("2024:C", "Y")];
    f.state.decisions = ["ALLOW", "ALLOW", "ALLOW"];
    f.state.relation = ["ALLOW", "ALLOW", "ALLOW"];
    if (mode === "condition" || mode === "held_verified_condition") {
      f.state.conditions = ["none", "conditional", "none"];
      f.state.conditionTexts = [null, "verified condition", null];
      if (mode === "held_verified_condition") f.state.relation = ["HOLD", "ALLOW", "ALLOW"];
    } else if (mode === "target_hold") {
      f.state.decisions = ["HOLD", "ALLOW", "ALLOW"];
    } else {
      f.state.decisions = ["EXCLUDE", "EXCLUDE", "ALLOW"];
      f.state.relation = ["HOLD", "ALLOW", "ALLOW"];
      f.state.conditions = ["unknown", "none", "none"];
    }
    const rows = await f.run(["2026:A", "2025:B", "2024:C"]);
    assert(rows[0].status === "pending");
    assert(rows[1].status === (mode === "target_exclude" ? "excluded" : "pending"));
    assert(rows[2].status === "reference");
  }
});

Deno.test("held relation propagates only independently target-bound contradictions", async () => {
  for (const bound of [true, false]) {
    const f = fixture();
    f.state.rows = [
      record("2026:A", "X", 17n, null),
      record("2025:B", "X", 17n, null),
      record("2024:C", "Y"),
    ];
    f.state.decisions = ["ALLOW", "ALLOW", "ALLOW"];
    f.state.relation = ["HOLD", "ALLOW", "ALLOW"];
    f.state.stageOverrides = ["final", null];
    f.state.rolloverEvidence[0] = { status: "verified", state: "unresolved" };
    f.state.suppressTarget[0] = !bound;
    const rows = await f.run(["2026:A", "2025:B", "2024:C"]);
    assert(rows[0].status === "pending");
    assert(rows[1].status === (bound ? "pending" : "reference"));
    if (!bound) {
      assert(
        rows[1].status === "reference" && rows[1].stage === "unknown" && rows[1].value === 17n,
      );
    }
    assert(rows[2].status === "reference");
  }
  const cross = fixture();
  cross.state.rows = [
    record("2026:A", "X", 17n, null),
    record("2025:B", "X", 17n, null),
    record("2024:C", "Y"),
  ];
  cross.state.decisions = ["EXCLUDE", "EXCLUDE", "ALLOW"];
  cross.state.relation = ["HOLD", "ALLOW", "ALLOW"];
  cross.state.stageOverrides = ["final", null];
  cross.state.rolloverEvidence[1] = { status: "verified", state: "unresolved" };
  const rows = await cross.run(["2026:A", "2025:B", "2024:C"]);
  assert(rows[0].status === "pending" && rows[1].status === "pending");
  assert(rows[2].status === "reference");
});

Deno.test("snapshot path parameters reject added, removed or getter mutations", async () => {
  for (const mode of ["add", "delete", "getter"] as const) {
    const f = fixture();
    f.state.mutateParams = mode;
    await rejects(() => f.run());
    assert(f.lookups === 0 && f.state.paramGetterReads === 0);
  }
  const extra = fixture();
  extra.state.extraInitialParam = true;
  await rejectsWith(() => extra.run(), "invalid_request", 422);
  assert(extra.publications === 0);
});

Deno.test("unbound target evidence cannot propagate another source's stage or rollover claim", async () => {
  for (const field of ["target", "head", "hash"] as const) {
    for (const kind of ["stage", "rollover"] as const) {
      const f = fixture();
      const guide = kind === "stage" ? "initial" : null;
      f.state.rows = [record("2026:A", "X", 17n, guide), record("2025:B", "X", 17n, guide)];
      f.state.decisions = ["ALLOW", "ALLOW"];
      f.state.relation = ["HOLD", "ALLOW"];
      f.state.stageOverrides = ["final", kind === "stage" ? "initial" : null];
      if (kind === "stage") f.state.badStageBinding = field;
      else {
        f.state.badRolloverBinding = field;
        f.state.rolloverEvidence[0] = { status: "verified", state: "unresolved" };
      }
      const rows = await f.run();
      assert(rows[0].status === "pending" && rows[1].status === "reference");
    }
  }
});

Deno.test("confirmed base recruitment with exclusion or hold affects only its target", async () => {
  for (const decision of ["EXCLUDE", "HOLD"] as const) {
    const f = fixture();
    f.state.rows = [record("2026:A", "X"), record("2025:B", "X"), record("2024:C", "Y")];
    f.state.decisions = [decision, decision, "ALLOW"];
    f.state.baseEvidence = [{ status: "confirmed", initialValue: 17n }];
    const rows = await f.run(["2026:A", "2025:B", "2024:C"]);
    assert(rows[0].status === "pending" && rows[1].status === "pending");
    assert(rows[2].status === "reference");
  }
  const unbound = fixture();
  unbound.state.rows = [record("2026:A", "X"), record("2025:B", "X"), record("2024:C", "Y")];
  unbound.state.decisions = ["EXCLUDE", "EXCLUDE", "ALLOW"];
  unbound.state.baseEvidence = [{ status: "confirmed", initialValue: 17n }];
  unbound.state.badBaseBinding = "head";
  const rows = await unbound.run(["2026:A", "2025:B", "2024:C"]);
  assert(rows[0].status === "pending" && rows[1].status === "excluded");
  assert(rows[2].status === "reference");
});

Deno.test("independent final evidence with unresolved rollover holds even an excluded target", async () => {
  for (const rolloverIndex of [0, 1] as const) {
    const f = fixture();
    f.state.rows = [
      record("2026:A", "X", 17n, null),
      record("2025:B", "X", 17n, null),
      record("2024:C", "Y"),
    ];
    f.state.decisions = ["EXCLUDE", "EXCLUDE", "ALLOW"];
    f.state.stageOverrides = ["final", null];
    f.state.rolloverEvidence[rolloverIndex] = { status: "verified", state: "unresolved" };
    const rows = await f.run(["2026:A", "2025:B", "2024:C"]);
    assert(rows[0].status === "pending" && rows[1].status === "pending");
    assert(rows[2].status === "reference");
  }
});
