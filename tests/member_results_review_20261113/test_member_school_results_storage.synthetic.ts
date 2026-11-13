import {
  MemberSchoolResultsStorage,
  type MemberSchoolResultIdentity,
} from "../../supabase/functions/_shared/jungsi/infrastructure/member_school_results_storage.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { projectMemberSchoolResults } from "../../supabase/functions/_shared/jungsi/application/member_school_results.ts";
import type { StoredProfile, StoredReport } from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";

const identity: MemberSchoolResultIdentity = {
  owner: "00000000-0000-4000-8000-000000000001",
  academicYear: 2027,
  reportId: "synthetic-report",
  reportRevision: 3,
  profileId: "synthetic-profile",
  profileFingerprint: "a".repeat(64),
  examId: "synthetic-exam",
  packVersion: "synthetic-pack",
};
const settings = {
  projectUrl: "https://example.supabase.co",
  bucket: "private-results",
  prefix: "member/",
  secretKey: "synthetic-only-key",
  maxBytes: 65536,
  maxItems: 100,
  timeoutMs: 5000,
};
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(work: () => Promise<unknown>): Promise<void> {
  let rejected = false;
  try {
    await work();
  } catch {
    rejected = true;
  }
  assert(rejected, "expected rejection");
}
async function document(): Promise<NativeObject> {
  const value: NativeObject = {
    format: "jungsi.member-school-results/v1",
    owner_binding: identity.owner,
    profile_id: identity.profileId,
    profile_fingerprint: identity.profileFingerprint,
    report_id: identity.reportId,
    report_revision: identity.reportRevision,
    academic_year: identity.academicYear,
    exam_id: identity.examId,
    pack_version: identity.packVersion,
    offerings: [{
      offering_id: "2027:synthetic",
      university_name: "Synthetic University",
      department: "Synthetic Department",
      assessment: null,
      converted_score: 0,
      converted_score_status: "ready",
      converted_score_reason: null,
      score_basis: "synthetic",
      converted_percentile: null,
      top_percent: null,
      top_percent_status: "pending",
      top_percent_reason: null,
      rule_version: "synthetic-rule",
      conversion_version: "synthetic-conversion",
      curve_version: null,
      model_version: null,
    }],
  };
  return { ...value, native_result_hash: await nativeJsonSha256(value) };
}
function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  let requests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    requests++;
    const url = String(input).replace("/object/authenticated/", "/object/");
    if (init?.method === "POST") {
      assert(new Headers(init.headers).get("x-upsert") === "false", "immutable write required");
      assert(init.body instanceof Uint8Array, "native bytes required");
      if (objects.has(url)) return new Response(null, { status: 409 });
      objects.set(url, Uint8Array.from(init.body));
      return new Response(null, { status: 201 });
    }
    const body = objects.get(url);
    return body ? new Response(Uint8Array.from(body), { status: 200 }) :
      new Response(null, { status: 404 });
  };
  return { objects, fetcher, count: () => requests };
}

Deno.test("member result is stored and read with null and zero intact", async () => {
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const ref = await store.create(identity, await document());
  const result = await store.read(identity, ref);
  const row = (result.offerings as NativeObject[])[0];
  assert(row.converted_score === 0 && row.converted_percentile === null && row.top_percent === null,
    "zero and missing values must stay distinct");
  assert(row.offering_id === "2027:synthetic", "offering PK must survive");
});

Deno.test("another owner or report revision cannot read a reference", async () => {
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const ref = await store.create(identity, await document());
  const before = mock.count();
  await rejects(() => store.read({ ...identity, owner: "00000000-0000-4000-8000-000000000002" }, ref));
  await rejects(() => store.read({ ...identity, reportRevision: 4 }, ref));
  assert(mock.count() === before, "reject mismatched identity before storage access");
});

Deno.test("a tampered result or wrong profile is never uploaded", async () => {
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const bad = await document();
  bad.native_result_hash = "b".repeat(64);
  await rejects(() => store.create(identity, bad));
  const valid = await document();
  await rejects(() => store.create({ ...identity, profileFingerprint: "b".repeat(64) }, valid));
  assert(mock.count() === 0, "validation must happen before storage access");
});

Deno.test("repeated identical create verifies the existing immutable object", async () => {
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const doc = await document();
  const first = await store.create(identity, doc), second = await store.create(identity, doc);
  assert(first.sha256 === second.sha256 && mock.objects.size === 1, "idempotent object expected");
});

Deno.test("mismatched or oversized stored bytes fail verification", async () => {
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const ref = await store.create(identity, await document());
  const key = [...mock.objects.keys()][0];
  mock.objects.set(key, new Uint8Array(ref.bytes + 1));
  await rejects(() => store.read(identity, ref));
});

Deno.test("duplicate PKs and unlisted fields cannot enter the private result", async () => {
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const value = await document(), row = (value.offerings as NativeObject[])[0];
  value.offerings = [row, row];
  const body = { ...value };
  delete body.native_result_hash;
  value.native_result_hash = await nativeJsonSha256(body);
  await rejects(() => store.create(identity, value));
  const extra = await document();
  (extra.offerings as NativeObject[])[0].unlisted = "synthetic";
  const extraBody = { ...extra };
  delete extraBody.native_result_hash;
  extra.native_result_hash = await nativeJsonSha256(extraBody);
  await rejects(() => store.create(identity, extra));
  assert(mock.count() === 0, "invalid PKs must fail before storage access");
});

Deno.test("the authorized report projection round-trips through private member storage", async () => {
  const scores: NativeObject = { exam_id: identity.examId, pack_version: identity.packVersion };
  const profile: StoredProfile = {
    owner_id: identity.owner, profile_id: identity.profileId, confirmed: true,
    created_at: "2026-01-01T00:00:00Z", scores,
  };
  const report: StoredReport = {
    owner_id: identity.owner, profile_id: identity.profileId, report_id: identity.reportId,
    revision: identity.reportRevision, updated_at: "2026-01-01T00:00:00Z",
    body: {
      overall: { exam: { academic_year: 2027, exam_id: identity.examId }, pack_version: identity.packVersion },
      analyses: {
        "2027:synthetic": {
          offering_id: "2027:synthetic",
          conversion: {
            status: "ready", converted_score: "0", profile_version: identity.profileId,
            exam_id: identity.examId, pack_version: identity.packVersion, academic_year: 2027,
            rule_version: "synthetic-rule", release_version: "synthetic-conversion",
          },
          percentile: {
            status: "pending", top_percent: null, profile_version: identity.profileId,
            exam_id: identity.examId, pack_version: identity.packVersion, academic_year: 2027,
          },
        },
      },
    },
  };
  const exactIdentity = { ...identity, profileFingerprint: await nativeJsonSha256(scores) };
  const projected = await projectMemberSchoolResults(identity.owner, profile, report, [{
    academic_year: 2027, offering_id: "2027:synthetic", university_name: "Synthetic University",
    department: null,
  }]);
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const ref = await store.create(exactIdentity, projected);
  const restored = await store.read(exactIdentity, ref);
  const row = (restored.offerings as NativeObject[])[0];
  assert(row.offering_id === "2027:synthetic" && row.converted_score === "0" &&
    row.converted_percentile === null && row.department === null,
  "projection fields and distinct null/zero must survive storage");
});

Deno.test("existing ready percentile alias is retained without fabricating a different metric", async () => {
  const value = await document(), row = (value.offerings as NativeObject[])[0];
  row.top_percent = "12.3";
  row.converted_percentile = "12.3";
  row.top_percent_status = "ready";
  const body = { ...value };
  delete body.native_result_hash;
  value.native_result_hash = await nativeJsonSha256(body);
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const ref = await store.create(identity, value);
  const restored = await store.read(identity, ref);
  const actual = (restored.offerings as NativeObject[])[0];
  assert(actual.converted_percentile === "12.3" && actual.top_percent === "12.3",
    "verified compatibility value must survive");
  row.converted_percentile = "87.7";
  body.offerings = value.offerings;
  value.native_result_hash = await nativeJsonSha256(body);
  await rejects(() => store.create(identity, value));
});

Deno.test("precise converted scores keep their native decimal value", async () => {
  const value = await document(), row = (value.offerings as NativeObject[])[0];
  row.converted_score = new JsonFloat("123.450000000000000001");
  const body = { ...value };
  delete body.native_result_hash;
  value.native_result_hash = await nativeJsonSha256(body);
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const ref = await store.create(identity, value);
  const actual = ((await store.read(identity, ref)).offerings as NativeObject[])[0].converted_score;
  assert(actual instanceof JsonFloat && actual.lexeme === "123.450000000000000001",
    "native decimal precision must survive storage");
});

Deno.test("the full existing analysis DTO is preserved for report consumers", async () => {
  const value = await document(), row = (value.offerings as NativeObject[])[0];
  row.assessment = {
    offering_id: "2027:synthetic", status: "pending", category: "pending",
    reason_code: "synthetic-reason", years: [{ academic_year: 2026, converted_score: "0" }],
    conversion: { converted_score: "0", rule_version: "synthetic-rule" },
    percentile: { top_percent: null, status: "pending" },
  };
  const expected = nativeJsonText(row.assessment, true), body = { ...value };
  delete body.native_result_hash;
  value.native_result_hash = await nativeJsonSha256(body);
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const ref = await store.create(identity, value);
  const restored = ((await store.read(identity, ref)).offerings as NativeObject[])[0];
  assert(nativeJsonText(restored.assessment, true) === expected, "analysis DTO must survive exactly");
});

Deno.test("invalid identity types are rejected before any storage request", async () => {
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const value = await document();
  await rejects(() => store.create({ ...identity, reportId: undefined as unknown as string }, value));
  await rejects(() => store.create({ ...identity, examId: null as unknown as string }, value));
  assert(mock.count() === 0, "identity must be validated before I/O");
});

Deno.test("identity cannot change while an immutable object is being written", async () => {
  const mock = memoryStorage();
  let markStarted!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => markStarted = resolve);
  const gate = new Promise<void>((resolve) => release = resolve);
  const fetcher: typeof fetch = async (input, init) => {
    if (init?.method === "POST") {
      markStarted();
      await gate;
    }
    return await mock.fetcher(input, init);
  };
  const store = new MemberSchoolResultsStorage(settings, fetcher), mutable = { ...identity };
  const pending = store.create(mutable, await document());
  await started;
  mutable.owner = "00000000-0000-4000-8000-000000000002";
  release();
  const ref = await pending;
  assert(ref.object_key.includes(identity.owner), "the authenticated owner must remain bound");
  await store.read(identity, ref);
});

Deno.test("a later report revision can retain its verified earlier result reference", async () => {
  const mock = memoryStorage(), store = new MemberSchoolResultsStorage(settings, mock.fetcher);
  const ref = await store.create(identity, await document());
  assert(ref.source_report_revision === identity.reportRevision, "source revision must be explicit");
  const restored = await store.read({ ...identity, currentReportRevision: 4 }, ref);
  assert(restored.report_revision === 3, "source document revision must stay unchanged");
  const before = mock.count();
  await rejects(() => store.read({ ...identity, currentReportRevision: 2 }, ref));
  assert(mock.count() === before, "future result must be rejected before I/O");
});
