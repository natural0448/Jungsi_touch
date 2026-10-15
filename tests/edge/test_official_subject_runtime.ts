/** Invented graph and approvals only. No operating data, Auth, network or database writes. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { OverallAnalysisService } from "../../supabase/functions/_shared/jungsi/application/overall_analysis.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { NativeRuntimeRequest } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts";
import { readBasicRuntimeSettings } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_settings.ts";
import { SupabaseSqlTransport } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
import { SyntheticUniversityData } from "./synthetic_university.ts";
import {
  SYNTHETIC_RUNTIME_NOW,
  syntheticRuntimeBinding,
  syntheticRuntimePin,
} from "./synthetic_runtime_binding.ts";
async function subjectFixture(
  nullCount: boolean,
  requested: "overall.analyze" | "candidates.build" = "overall.analyze",
) {
  const source = new SyntheticUniversityData(), pack = source.pack!;
  const artifact = await syntheticRuntimePin(nativeJsonText(source.rawPack));
  const operations = ["score-profile.create", "overall.analyze", "report.read"];
  const f = await syntheticRuntimeBinding(
    (d) => {
      d.scope = { operations, artifacts: [{ kind: "exam_pack", key: pack.examId }] };
    },
    () => {},
    (bodies) => {
      bodies.registry = nativeJsonText({
        format: "jungsi.data-registry/v1",
        entries: [{
          kind: "exam_pack",
          key: pack.examId,
          version: pack.packVersion,
          bucket: "synthetic-private",
          object_key: "SYNTHETIC/exam-pack.json",
          bytes: artifact.bytes.length,
          sha256: artifact.sha256,
          status: "approved",
          engine_approved: true,
          production_allowed: true,
          archive_only: false,
          source_timezone: "Asia/Seoul",
        }],
      });
      bodies.selection = nativeJsonText({
        format: "jungsi.runtime-selection/v1",
        required: [{ kind: "exam_pack", key: pack.examId }],
      });
      bodies.usage_policy = nativeJsonText({
        format: "jungsi.runtime-usage-policy/v1",
        status: "approved",
        purpose: "jungsi-api-runtime",
        version: "SYNTHETIC-subject-policy",
        approval_reference_sha256: "a".repeat(64),
        expires_at: "2026-10-15T00:30:00Z",
        dimensions: [
          "request_window",
          "distinct_scores",
          "calculation_cost",
          "concurrent_jobs",
          "result_volume",
        ]
          .map((kind) => ({
            kind,
            period_seconds: kind === "concurrent_jobs" ? 1 : 60,
            ceiling: 10000,
            standard: 100,
            paid: 100,
          })),
        operations: operations.map((operation) => ({
          operation,
          reserved_result_bytes: 512,
          base_units: operation === "report.read" ? 0 : 2,
          per_offering_units: 0,
        })),
        exams: [{
          exam_id: pack.examId,
          pack_version: pack.packVersion,
          academic_year: pack.academicYear,
          ...(nullCount ? { eligible_offering_count: null } : {}),
        }],
      });
    },
  );
  let sqlCalls = 0;
  const calls: string[] = [];
  const context = new NativeRuntimeRequest(
    f.env,
    () => readBasicRuntimeSettings(f.env),
    () =>
      new SupabaseSqlTransport({
        transaction() {
          sqlCalls++;
          throw new Error("unexpected_synthetic_sql");
        },
        close() {
          return Promise.resolve();
        },
      }),
    { nowUtc: () => SYNTHETIC_RUNTIME_NOW },
    requested,
    (input) => {
      const url = String(input);
      calls.push(url);
      const path = new URL(url).pathname;
      let body: string | Uint8Array<ArrayBuffer>;
      if (path.includes("/bucket/")) {
        body = '{"id":"synthetic-private","public":false,"file_size_limit":65536}';
      } else if (
        path.endsWith("/exam-pack.json")
      ) body = artifact.bytes;
      else {
        const name = path.split("/").at(-1)!.replace(".json", "");
        assert(Object.hasOwn(f.body, name));
        body = f.body[name];
      }
      const response = new Response(body);
      Object.defineProperty(response, "url", { value: url });
      return Promise.resolve(response);
    },
  );
  return { context, source, pack, calls, sqlCalls: () => sqlCalls };
}
Deno.test("subject-only selected runtime returns subject scores and sum without catalog or total model", async () => {
  for (const nullCount of [false, true]) {
    const f = await subjectFixture(nullCount), data = await f.context.data();
    equal(await data.getCatalog(), null);
    equal(await data.getTotalModel(f.pack.examId, f.pack.packVersion), null);
    const result = await new OverallAnalysisService(data).analyze({
      user: { subjectId: "SYNTHETIC-owner", expiresAtUtc: SYNTHETIC_RUNTIME_NOW + 3600000000n },
      evaluatedAtUtc: SYNTHETIC_RUNTIME_NOW,
      tier: "paid",
      paidUntilUtc: SYNTHETIC_RUNTIME_NOW + 1800000000n,
    }, f.source.scores());
    assert(Array.isArray(result.subjects));
    equal(result.subjects.length, 4);
    assert(
      typeof result.total_standard_score === "number" ||
        typeof result.total_standard_score === "bigint",
    );
    assert(BigInt(result.total_standard_score) === 30n);
    const overall = result.overall as NativeObject;
    equal(overall.status, "pending");
    equal(overall.reason_code, "total_model_missing");
    equal(overall.top_percent, null);
    const exam = (await f.context.budget()).policy.exams.get(f.pack.examId)!;
    equal(Object.hasOwn(exam, "eligibleOfferingCount"), nullCount);
    equal(exam.eligibleOfferingCount, nullCount ? null : undefined);
    await f.context.assertCurrent();
    equal(f.sqlCalls(), 0);
    equal(f.calls.filter((url) => url.endsWith("/exam-pack.json")).length, 1);
  }
});
Deno.test("subject-only approval cannot enable candidate operations or fetch their data", async () => {
  const f = await subjectFixture(true, "candidates.build");
  let thrown: unknown;
  try {
    await f.context.data();
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof AccessError);
  equal(thrown.code, "operation_scope_not_approved");
  equal(thrown.http, 503);
  equal(f.calls.length, 0);
  equal(f.sqlCalls(), 0);
});
