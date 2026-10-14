import { syncPromise } from "./fixture.ts";
import { ForecastPolicyService } from "../../supabase/functions/_shared/jungsi/application/forecast_policy.ts";
import { forecastDigest } from "../../supabase/functions/_shared/jungsi/application/forecast_calculation.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type {
  ApiExecution,
  ApiOperationId,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { cloneNativeJson } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { SyntheticForecastRepository } from "./synthetic_forecast_repository.ts";
import { syntheticForecastFixture } from "./synthetic_forecast.ts";
import { assert, equal } from "./fixture.ts";
const EDITOR = "SYNTHETIC-editor",
  APPROVER = "SYNTHETIC-approver",
  NOW = 1700000000000000n;
function fixture() {
  const repository = new SyntheticForecastRepository(),
    raw = syntheticForecastFixture();
  repository.authorities.set(EDITOR, {
    edit: ["SYNTHETIC-U"],
    approve: ["SYNTHETIC-U"],
  });
  repository.authorities.set(APPROVER, { edit: [], approve: ["SYNTHETIC-U"] });
  let ids = 0, calls = 0;
  const inputs = {
    inputs(_oid: string, _id: string, version: string) {
      return syncPromise(() => {
        calls++;
        if (version !== raw.inputs.version) {
          throw new AccessError("forecast_input_missing", 503);
        }
        return cloneNativeJson(raw.inputs);
      });
    },
    policy(_id: string, version: string) {
      return syncPromise(() => {
        calls++;
        if (version !== raw.policy.version) {
          throw new AccessError("forecast_policy_missing", 503);
        }
        return cloneNativeJson(raw.policy);
      });
    },
    currentContext() {
      return syncPromise(() => {
        calls++;
        return cloneNativeJson(raw.inputs.context as NativeObject);
      });
    },
  };
  const resources = {
    readScope(_kind: "offering" | "draft", id: string) {
      return syncPromise(() => {
        return { kind: "offering" as const, id, universityId: "SYNTHETIC-U" };
      });
    },
  };
  const service = new ForecastPolicyService(repository, inputs, resources, {
    nowUtc: () => NOW,
  }, () => String(++ids).padStart(32, "0"));
  let key = 0;
  function execution(
    op: ApiOperationId,
    record: NativeObject | null = null,
    actor = EDITOR,
    extra: NativeObject = {},
    requestKey?: string,
  ): ApiExecution {
    const body = record
      ? {
        expected_revision: record.revision,
        base_result_hash: record.base_result_hash,
        policy_version: record.policy_version,
        ...extra,
      }
      : {
        input_id: "SYNTHETIC-input-id",
        input_version: "SYNTHETIC-input",
        policy_id: "SYNTHETIC-policy-id",
        policy_version: "SYNTHETIC-policy",
        ...extra,
      };
    return {
      operation: op,
      body,
      query: {},
      params: record ? { draft_id: record.draft_id as string } : { offering_id: "SYNTHETIC-O" },
      requestKey: requestKey ?? "SYNTHETIC-" + String(++key),
      management: null,
      session: {
        user: {
          subjectId: actor,
          expiresAtUtc: NOW + 1000000n,
          assuranceLevel: "aal2",
          accountStatus: "active",
        },
        evaluatedAtUtc: NOW,
        tier: "paid",
        paidUntilUtc: NOW + 500000n,
      },
    };
  }
  const call = (
    op: ApiOperationId,
    record: NativeObject | null = null,
    actor = EDITOR,
    extra: NativeObject = {},
    requestKey?: string,
  ) => service.execute(execution(op, record, actor, extra, requestKey));
  const create = () => call("forecast.create");
  const validate = (r: NativeObject) => call("forecast.validate", r);
  const approve = (r: NativeObject, actor = APPROVER) =>
    call("forecast.approve", r, actor, {
      validation_receipt_hash: (r.validation as NativeObject).receipt_hash,
      reason: "합성 검토 완료",
    });
  return {
    repository,
    raw,
    inputs,
    service,
    execution,
    call,
    create,
    validate,
    approve,
    calls: () => calls,
  };
}
async function denied(run: () => Promise<unknown>, code: string, http: number) {
  let e: unknown;
  try {
    await run();
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError);
  equal(e.code, code);
  equal(e.http, http);
}
Deno.test("forecast full synthetic lifecycle appends immutable revisions and publishes closed student DTO", async () => {
  const f = fixture(),
    a = await f.create(),
    b = await f.validate(a),
    c = await f.approve(b),
    d = await f.call("forecast.publish", c, APPROVER, {
      approval_receipt_hash: (c.approval as NativeObject).approval_hash,
    });
  equal(d.status, "published");
  equal(d.revision, 4);
  equal(
    f.repository.revisions.get((a.draft_id as string) + "\0" + "1")!.status,
    "draft",
  );
  const r = f.execution("forecast.published.read");
  const publicResult = await f.service.execute({
    ...r,
    body: {},
    requestKey: null,
  });
  equal((publicResult.forecast_70 as NativeObject).value, "56");
  equal(publicResult.status, "published");
  assert(!Object.hasOwn(publicResult, "published_by"));
  assert(!Object.hasOwn(publicResult, "exact_values"));
});
Deno.test("forecast independent approver is required by the adopted true policy", async () => {
  const f = fixture(), r = await f.validate(await f.create());
  await denied(
    () => f.approve(r, EDITOR),
    "forecast_independent_approver_required",
    403,
  );
  equal(f.repository.drafts.get(r.draft_id as string)!.status, "validated");
});
Deno.test("forecast explicit approved false policy supports same actor publication and verified reread", async () => {
  const f = fixture();
  f.raw.policy.require_independent_approver = false;
  const approved = await f.approve(await f.validate(await f.create()), EDITOR);
  equal(
    (f.repository.drafts.get(approved.draft_id as string)!.approval as NativeObject)
      .require_independent_approver,
    false,
  );
  await f.call("forecast.publish", approved, EDITOR, {
    approval_receipt_hash: (approved.approval as NativeObject).approval_hash,
  });
  const release = await f.service.validatedRelease("SYNTHETIC-O", EDITOR);
  assert(release !== null);
  equal(release.require_independent_approver, false);
  const read = f.execution("forecast.published.read");
  const dto = await f.service.execute({ ...read, body: {}, requestKey: null });
  equal(dto.status, "published");
  assert(!Object.hasOwn(dto, "require_independent_approver"));
});
Deno.test("forecast false self-approval requires current editor and approver for the same school", async () => {
  for (const edit of [[], ["SYNTHETIC-other-school"]]) {
    const f = fixture();
    f.raw.policy.require_independent_approver = false;
    const validated = await f.validate(await f.create());
    f.repository.authorities.set(EDITOR, { edit, approve: ["SYNTHETIC-U"] });
    await denied(
      () => f.approve(validated, EDITOR),
      edit.length ? "forecast_not_found" : "forecast_forbidden",
      edit.length ? 404 : 403,
    );
    equal(f.repository.drafts.get(validated.draft_id as string)!.status, "validated");
  }
});
Deno.test("forecast false independent approver needs no editor capability and later revocation preserves prior approval evidence", async () => {
  const f = fixture();
  f.raw.policy.require_independent_approver = false;
  const approved = await f.approve(await f.validate(await f.create()), EDITOR);
  const stored = f.repository.drafts.get(approved.draft_id as string)!;
  const verified = cloneNativeJson((stored.approval as NativeObject).authority_verification);
  equal((verified as NativeObject).checked_capabilities, ["editor", "approver"]);
  f.repository.authorities.set(EDITOR, { edit: [], approve: ["SYNTHETIC-U"] });
  await f.call("forecast.publish", approved, EDITOR, {
    approval_receipt_hash: (approved.approval as NativeObject).approval_hash,
  });
  equal(
    (f.repository.drafts.get(approved.draft_id as string)!.approval as NativeObject)
      .authority_verification,
    verified,
  );
  equal(
    (await f.service.validatedRelease("SYNTHETIC-O", EDITOR))!.require_independent_approver,
    false,
  );
  const other = fixture();
  other.raw.policy.require_independent_approver = false;
  const independent = await other.approve(await other.validate(await other.create()));
  equal(independent.status, "approved");
});
Deno.test("forecast absent or nonboolean approval policy is rejected before draft creation", async () => {
  for (const value of [undefined, null, "false"]) {
    const f = fixture();
    if (value === undefined) delete f.raw.policy.require_independent_approver;
    else f.raw.policy.require_independent_approver = value;
    await denied(() => f.create(), "forecast_approval_policy_missing", 422);
    equal(f.repository.drafts.size, 0);
  }
});
Deno.test("forecast release policy flag must match the verified policy even with recomputed object hash", async () => {
  for (const value of [undefined, null, "false", true]) {
    const f = fixture();
    f.raw.policy.require_independent_approver = false;
    const approved = await f.approve(await f.validate(await f.create()), EDITOR);
    await f.call("forecast.publish", approved, EDITOR, {
      approval_receipt_hash: (approved.approval as NativeObject).approval_hash,
    });
    const stored = [...f.repository.releases.values()][0];
    if (value === undefined) delete stored.require_independent_approver;
    else stored.require_independent_approver = value;
    const { release_hash: _hash, ...body } = stored;
    stored.release_hash = await forecastDigest(body);
    await denied(
      () => f.service.validatedRelease("SYNTHETIC-O", EDITOR),
      "forecast_release_invalid",
      503,
    );
  }
});
Deno.test("forecast management requires AAL2 active own account before body or inputs", async () => {
  for (
    const [patch, code, http] of [
      [{ assuranceLevel: "aal1" as const }, "management_mfa_required", 403],
      [{ accountStatus: null }, "management_account_state_unverified", 503],
      [{ accountStatus: "blocked" }, "management_account_inactive", 403],
    ] as const
  ) {
    const f = fixture(), r = f.execution("forecast.create");
    await denied(
      () =>
        f.service.execute({
          ...r,
          session: { ...r.session, user: { ...r.session.user, ...patch } },
        }),
      code,
      http,
    );
    equal(f.calls(), 0);
    equal(f.repository.drafts.size, 0);
  }
});
Deno.test("paid membership grants no management role and staff free membership is independent", async () => {
  const f = fixture();
  await denied(
    () => f.call("forecast.create", null, "SYNTHETIC-student"),
    "forecast_forbidden",
    403,
  );
  const r = f.execution("forecast.create");
  const created = await f.service.execute({
    ...r,
    session: { ...r.session, tier: "standard", paidUntilUtc: null },
  });
  equal(created.status, "draft");
  const pub = f.execution("forecast.published.read");
  await denied(
    () =>
      f.service.execute({
        ...pub,
        body: {},
        session: { ...pub.session, tier: "standard", paidUntilUtc: null },
      }),
    "paid_required",
    403,
  );
});
Deno.test("forecast adjustment is a single exact replacement that invalidates validation and preserves base", async () => {
  const f = fixture(),
    a = await f.validate(await f.create()),
    extra = {
      target: "forecast_70",
      replacement: { value: "56.004", unit: "점" },
      reason: "가상 근거 조정",
      evidence_refs: ["SYNTHETIC-manual"],
    };
  const b = await f.call(
    "forecast.adjust",
    a,
    EDITOR,
    extra,
    "SYNTHETIC-adjust",
  );
  equal(
    await f.call("forecast.adjust", a, EDITOR, extra, "SYNTHETIC-adjust"),
    b,
  );
  equal(
    ((b.base_result as NativeObject).forecast_70 as NativeObject).value,
    "56",
  );
  equal(((b.result as NativeObject).forecast_70 as NativeObject).value, "56");
  equal(b.validation, null);
  equal(
    (f.repository.drafts.get(a.draft_id as string)!.result as NativeObject)
      .exact_values !== null,
    true,
  );
  const precise = ((f.repository.drafts.get(a.draft_id as string)!.result as NativeObject)
    .exact_values as NativeObject).forecast_70;
  equal(precise, "14001/250");
});
Deno.test("forecast validation preserves a failed receipt and prevents its approval", async () => {
  const f = fixture(),
    a = await f.create(),
    adjusted = await f.call("forecast.adjust", a, EDITOR, {
      target: "acceptance_range",
      replacement: { lower: "53", upper: "58", unit: "점" },
      reason: "가상 조정 검수",
      evidence_refs: ["SYNTHETIC-manual"],
    }),
    v = await f.validate(adjusted);
  equal((v.validation as NativeObject).status, "failed");
  equal(
    (v.validation as NativeObject).reason_code,
    "forecast_core_range_mismatch",
  );
  await denied(() => f.approve(v), "forecast_validation_required", 409);
});
Deno.test("forecast role for one school cannot expand approval from another school", async () => {
  const f = fixture(), r = await f.validate(await f.create());
  f.repository.authorities.set(APPROVER, {
    edit: ["SYNTHETIC-U"],
    approve: ["SYNTHETIC-other"],
  });
  await denied(() => f.approve(r), "forecast_not_found", 404);
});
Deno.test("forecast transaction rechecks a revoked role before returning a saved response", async () => {
  const f = fixture(),
    request = f.execution("forecast.create"),
    a = await f.service.execute(request),
    replays = f.repository.events.filter((x) => x === "replay").length;
  f.repository.beforeTransaction = () =>
    f.repository.authorities.set(EDITOR, { edit: [], approve: [] });
  await denied(() => f.service.execute(request), "forecast_forbidden", 403);
  equal(f.repository.events.filter((x) => x === "replay").length, replays);
  equal(f.repository.drafts.size, 1);
  equal(a.status, "draft");
});
Deno.test("forecast concurrent revision requests have one winner in the synthetic transaction model", async () => {
  const f = fixture(),
    r = await f.create(),
    results = await Promise.all([1, 2].map(async (i) => {
      try {
        return (await f.call(
          "forecast.validate",
          r,
          EDITOR,
          {},
          "SYNTHETIC-race-" + String(i),
        )).status;
      } catch (e) {
        return (e as AccessError).code;
      }
    }));
  equal(results.filter((x) => x === "validated").length, 1);
  equal(results.filter((x) => x === "revision_conflict").length, 1);
  equal(f.repository.drafts.get(r.draft_id as string)!.revision, 2);
});
Deno.test("forecast stale base hash or changed pinned policy cannot mutate a draft", async () => {
  const f = fixture(), a = await f.create();
  await denied(
    () =>
      f.call("forecast.validate", a, EDITOR, {
        base_result_hash: "0".repeat(64),
      }),
    "forecast_base_version_conflict",
    409,
  );
  (f.raw.policy.forecast_70 as NativeObject).minimum_years = 2;
  await denied(() => f.validate(a), "forecast_base_version_conflict", 409);
  equal(f.repository.drafts.get(a.draft_id as string)!.revision, 1);
});
Deno.test("forecast receipt self hash cannot be trusted after stored receipt fields change", async () => {
  const f = fixture(),
    r = await f.validate(await f.create()),
    stored = f.repository.drafts.get(r.draft_id as string)!;
  (stored.validation as NativeObject).actor = "SYNTHETIC-altered";
  await denied(() => f.approve(r), "forecast_validation_stale", 409);
});
Deno.test("forecast all completed write keys reject extra query before transaction and preserve normal replay", async () => {
  const f = fixture(), requests: ApiExecution[] = [];
  const create = f.execution("forecast.create");
  requests.push(create);
  const a = await f.service.execute(create);
  const adjust = f.execution("forecast.adjust", a, EDITOR, {
    target: "forecast_70",
    replacement: { value: "56", unit: "점" },
    reason: "가상 재실행 검수",
    evidence_refs: ["SYNTHETIC-manual"],
  });
  requests.push(adjust);
  const adjusted = await f.service.execute(adjust);
  const validate = f.execution("forecast.validate", adjusted);
  requests.push(validate);
  const b = await f.service.execute(validate);
  const approve = f.execution("forecast.approve", b, APPROVER, {
    validation_receipt_hash: (b.validation as NativeObject).receipt_hash,
    reason: "합성 독립 검토",
  });
  requests.push(approve);
  const c = await f.service.execute(approve);
  const publish = f.execution("forecast.publish", c, APPROVER, {
    approval_receipt_hash: (c.approval as NativeObject).approval_hash,
  });
  requests.push(publish);
  await f.service.execute(publish);
  for (const r of requests) {
    const before = f.repository.events.filter((e) => e === "transact").length;
    await denied(
      () => f.service.execute({ ...r, query: { unexpected: "SYNTHETIC" } }),
      "invalid_request",
      422,
    );
    equal(f.repository.events.filter((e) => e === "transact").length, before);
    await f.service.execute(r);
  }
});
Deno.test("forecast management DTO excludes private storage context result hashes and exact values", async () => {
  const f = fixture(),
    a = await f.create(),
    stored = f.repository.drafts.get(a.draft_id as string)!;
  stored.secret = "SYNTHETIC-PRIVATE";
  (stored.context as NativeObject).secret = "SYNTHETIC-PRIVATE";
  (stored.result as NativeObject).secret = "SYNTHETIC-PRIVATE";
  const r = f.execution("forecast.read", a),
    dto = await f.service.execute({ ...r, body: {} }),
    text = JSON.stringify(dto);
  assert(!text.includes("SYNTHETIC-PRIVATE"));
  assert(!text.includes("exact_values"));
  assert(!Object.hasOwn(dto, "input_hash"));
  assert(!Object.hasOwn(dto, "policy_hash"));
});
Deno.test("forecast published release is bound to current entire context and pinned artifacts", async () => {
  const f = fixture(),
    a = await f.create(),
    b = await f.validate(a),
    c = await f.approve(b);
  await f.call("forecast.publish", c, APPROVER, {
    approval_receipt_hash: (c.approval as NativeObject).approval_hash,
  });
  (f.raw.inputs.context as NativeObject).catalog_version = "SYNTHETIC-changed";
  const r = f.execution("forecast.published.read");
  await denied(
    () => f.service.execute({ ...r, body: {} }),
    "forecast_base_version_conflict",
    409,
  );
});
