/** Synthetic-only TypeScript port of the existing bounded-service tests. */
import type { ApiExecution, ApiExecutionBoundary } from "./jungsi/application/api_dispatch.ts";
import type { NativeJson } from "./jungsi/domain/native_json.ts";
import type { CurrentPublicCatalogPort, PublicCatalogRecord } from "./current_public_catalog.ts";
import type {
  Own2027NativeQuota,
  Own2027SelectionKey,
  Own2027SelectionTrust,
} from "./current_public_r27_selection.ts";

const test = Deno.test;
const assert = {
  equal(a: unknown, b: unknown): void {
    if (!Object.is(a, b)) throw Error("assert_equal");
  },
  deepEqual(a: unknown, b: unknown): void {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw Error("assert_deep_equal");
  },
  ok(v: unknown): void {
    if (!v) throw Error("assert_truthy");
  },
  async rejects(work: Promise<unknown>, pattern: RegExp): Promise<void> {
    let caught = null;
    try {
      await work;
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof Error) || !pattern.test(caught.message)) throw Error("assert_rejects");
  },
};
import {
  CurrentPublicR27BoundedService,
  OWN_2027_CANDIDATE_MAX_KEYS,
} from "./current_public_r27_bounded.ts";

const USER = "00000000-0000-0000-0000-000000000001";
const PUB = "a".repeat(64), HEAD = "b".repeat(64), OTHER = "c".repeat(64);
const clock = { nowUtc: () => 100n };
const keys = (n: number): Own2027SelectionKey[] =>
  Array.from({ length: n }, (_, i) => ({
    academic_year: 2027,
    school_id: "S1",
    offering_pk: "P" + String(i + 1).padStart(4, "0"),
  }));
function row(id: string, value: NativeJson = 0n): PublicCatalogRecord {
  const pk = id.slice(5);
  return {
    key: [2027, "S1", pk, "", id],
    row: {
      academic_year: 2027,
      school_id: "S1",
      offering_pk: pk,
      offering_id: id,
      active_service: true,
      practical_required: false,
      source_kind: "current_guide",
    },
    guide: {
      academic_year: 2027,
      school_id: "S1",
      offering_pk: pk,
      offering_id: id,
      active_service: true,
      practical_required: false,
      recruitment_link_status: "verified",
      quota_value: value,
      quota_literal_state: "numeric_literal",
      metadata: { quota_stage: "initial" },
    },
  };
}
type FixtureOptions = {
  changedPub?: number;
  prefixFailure?: boolean;
  missing?: boolean;
  wrongHead?: boolean;
  badFinalWhole?: boolean;
};
type MutableBoundary = { -readonly [K in keyof ApiExecutionBoundary]: ApiExecutionBoundary[K] };

function fixture(options: FixtureOptions = {}) {
  const request: ApiExecution = {
    operation: "recruitment.read",
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
  };
  const boundary: MutableBoundary = {
    signal: new AbortController().signal,
    admission: Object.freeze({ synthetic: true }),
  };
  const calls: { lookup: string[][]; whole: number[]; chunk: number[]; publication: number } = {
    lookup: [],
    whole: [],
    chunk: [],
    publication: 0,
  };
  const prefixError = new Error("synthetic_index_12_prefix_limit");
  const current: CurrentPublicCatalogPort = {
    async publication() {
      await Promise.resolve();
      calls.publication++;
      return {
        version: options.changedPub === calls.publication ? "changed" : "synthetic-catalog",
        sha256: PUB,
        expiresAtUtc: 1000n,
      };
    },
    async lookup(subject, ids, recruitment) {
      await Promise.resolve();
      assert.equal(subject, USER);
      assert.equal(recruitment, true);
      calls.lookup.push([...ids]);
      if (options.prefixFailure && calls.lookup.length === 2) throw prefixError;
      let rows = ids.map((id, i) => row(id, i === 1 ? null : 0n));
      if (options.missing) rows = rows.slice(1);
      return {
        version: "synthetic-catalog",
        head: options.wrongHead && calls.lookup.length === 2 ? OTHER : HEAD,
        asOfUtc: 80n,
        rows,
      };
    },
    async search() {
      await Promise.resolve();
      throw Error("unexpected_search");
    },
  };
  const whole: Own2027SelectionTrust = {
    async bind(req, bd, scope, publication) {
      await Promise.resolve();
      assert.equal(req, request);
      assert.equal(bd, boundary);
      assert.ok(Object.isFrozen(scope));
      calls.whole.push(scope.length);
      return {
        subject_id: USER,
        publication_sha256: publication.sha256,
        head_sha256: options.badFinalWhole && calls.whole.length === 2 ? OTHER : HEAD,
      };
    },
  };
  const chunk: Own2027SelectionTrust = {
    async bind(req, bd, scope, publication) {
      await Promise.resolve();
      assert.equal(req, request);
      assert.equal(bd, boundary);
      calls.chunk.push(scope.length);
      return { subject_id: USER, publication_sha256: publication.sha256, head_sha256: HEAD };
    },
  };
  const service = new CurrentPublicR27BoundedService(current, clock, whole, chunk);
  return {
    calls,
    boundary,
    prefixError,
    run: (input: unknown) => service.selectedOwn2027Guides(request, boundary, input),
  };
}
function quota(q: Own2027NativeQuota): NativeJson {
  if (q.state !== "present") throw Error("expected_present_quota");
  return q.value;
}
for (const [n, sizes] of [[1, [1]], [36, [36]], [101, [100, 1]]] as const) {
  test("bounded lookup " + n, async () => {
    const f = fixture(), input = keys(n), result = await f.run(input);
    assert.deepEqual(f.calls.lookup.map((x) => x.length), sizes);
    assert.deepEqual(f.calls.lookup.flat(), input.map((x) => "2027:" + x.offering_pk));
    assert.deepEqual(result.items.map((x) => x.offering_pk), input.map((x) => x.offering_pk));
    assert.ok(result.items.every((x) => x.status === "HOLD"));
    assert.equal(quota(result.items[0].quota_native), 0n);
    if (n > 1) assert.equal(quota(result.items[1].quota_native), null);
    assert.deepEqual(f.calls.whole, [n, n]);
    assert.equal(f.calls.chunk.length, sizes.length * 2);
  });
}
test("missing source remains an explicit HOLD in original position", async () => {
  const f = fixture({ missing: true }), input = keys(3), result = await f.run(input);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].offering_pk, input[0].offering_pk);
  assert.ok(result.items[0].reasons.includes("NOT_RETURNED"));
  assert.equal(result.items[0].quota_native.state, "absent");
});
test("duplicates and unapproved bounds fail before lookup", async () => {
  const f = fixture(), input = keys(2);
  input[1] = { ...input[0], school_id: "S2" };
  await assert.rejects(f.run(input), /current_catalog_page_invalid/);
  await assert.rejects(
    f.run(keys(OWN_2027_CANDIDATE_MAX_KEYS + 1)),
    /current_catalog_page_invalid/,
  );
  assert.equal(f.calls.lookup.length, 0);
});
test("mid-chunk head or publication change fails the whole request", async () => {
  for (const opt of [{ wrongHead: true }, { changedPub: 4 }, { badFinalWhole: true }]) {
    const f = fixture(opt);
    await assert.rejects(f.run(keys(101)), /current_catalog_(page_invalid|state_unapproved)/);
    assert.ok(f.calls.lookup.length <= 2);
  }
});
test("existing prefix-limit error propagates without per-row fallback", async () => {
  const f = fixture({ prefixFailure: true });
  let error;
  try {
    await f.run(keys(101));
  } catch (caught) {
    error = caught;
  }
  assert.equal(error, f.prefixError);
  assert.deepEqual(f.calls.lookup.map((x) => x.length), [100, 1]);
});
test("shared admission is required before lookups", async () => {
  const f = fixture();
  f.boundary.admission = null;
  await assert.rejects(f.run(keys(36)), /security_policy_unavailable/);
  assert.equal(f.calls.lookup.length, 0);
});
