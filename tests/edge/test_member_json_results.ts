import { assert, equal } from "./fixture.ts";
import { MemberJsonResults } from "../../supabase/functions/_shared/jungsi/application/member_json_results.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { memberFixture, OWNER, rejects, request } from "./member_shortlist_fixture.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
Deno.test("member saved results retain actual zero and pending reason", async () => {
  const f = memberFixture(), v = await f.service.execute(request());
  const i = (v.items as NativeObject[])[0];
  equal((i.assessment as NativeObject).converted_score, "0");
  equal((i.assessment as NativeObject).status, "pending");
  equal(i.assessment_reason_code, null);
});
Deno.test("member saved result miss returns null and reason without calculation", async () => {
  const f = memberFixture();
  f.reports[0].body.analyses = {};
  const v = await f.service.execute(request());
  const i = (v.items as NativeObject[])[0];
  equal(i.assessment, null);
  equal(i.assessment_reason_code, "saved_assessment_missing");
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 0);
});
Deno.test("member current profile miss never borrows an old report assessment", async () => {
  const f = memberFixture();
  f.setCurrent(false);
  const v = await f.service.execute(request());
  equal(v.assessment_context, null);
  equal((v.items as NativeObject[])[0].assessment, null);
  const selected = await f.service.execute({
    ...request(),
    query: { year: "2027", report_id: "SYNTHETIC-report" },
  });
  equal((selected.assessment_context as NativeObject).source, "selected_report");
});
Deno.test("member exact selected report absence does not substitute latest", async () => {
  const f = memberFixture();
  await rejects(
    () =>
      f.service.execute({ ...request(), query: { year: "2027", report_id: "SYNTHETIC-absent" } }),
    "report_not_found",
    404,
  );
});
Deno.test("member results reject wrong owner and extra unrequested analyses", async () => {
  const context = {
    owner: OWNER,
    year: 2027,
    report_id: "SYNTHETIC-r",
    report_revision: 1,
    profile_id: "SYNTHETIC-p",
    exam_id: "SYNTHETIC-e",
    pack_version: "SYNTHETIC-v",
    source: "current_profile" as const,
  };
  for (
    const v of [{ context: { ...context, owner: "other" }, analyses: {} as NativeObject }, {
      context,
      analyses: { unrequested: { status: "ready" } } as NativeObject,
    }]
  ) {
    await rejects(
      () =>
        new MemberJsonResults({ read: () => Promise.resolve(v) }, 100).read(OWNER, 2027, [
          "SYNTHETIC-a",
        ], null),
      "storage_result_invalid",
    );
  }
});
Deno.test("member native saved decimal and missing status survive batch read", async () => {
  const value = new JsonFloat("0.00"),
    r = new MemberJsonResults({
      read: () =>
        Promise.resolve({
          context: {
            owner: OWNER,
            year: 2027,
            report_id: "SYNTHETIC-r",
            report_revision: 1,
            profile_id: "SYNTHETIC-p",
            exam_id: "SYNTHETIC-e",
            pack_version: "SYNTHETIC-v",
            source: "current_profile",
          },
          analyses: {
            "SYNTHETIC-a": { converted_score: value, percentile: null, status: "pending" },
          },
        }),
    }, 100);
  const v = await r.read(OWNER, 2027, ["SYNTHETIC-a"], null);
  assert(v.assessments.get("SYNTHETIC-a")?.converted_score instanceof JsonFloat);
  equal((v.assessments.get("SYNTHETIC-a")!.converted_score as JsonFloat).lexeme, "0.00");
  equal(v.assessments.get("SYNTHETIC-a")?.percentile, null);
});
Deno.test("member results enforce bounded unique requested IDs before repository", async () => {
  let calls = 0;
  const r = new MemberJsonResults({
    read: () => {
      calls++;
      return Promise.resolve(null);
    },
  }, 1);
  await rejects(() => r.read(OWNER, 2027, ["a", "b"], null), "storage_result_invalid");
  await rejects(() => r.read(OWNER, 2027, ["a", "a"], null), "storage_result_invalid");
  equal(calls, 0);
});
Deno.test("member saved result SQL serializes IDs as JSON text for the native transport", async () => {
  const f = memberFixture();
  await f.service.execute(request());
  const statement = f.statements.find((s) =>
    s.sql.includes("jsonb_array_elements_text($3::text::jsonb)")
  );
  assert(statement);
  equal(typeof statement.args[2], "string");
  equal(JSON.parse(String(statement.args[2])), ["SYNTHETIC-a"]);
  assert(!statement.sql.includes("unnest($3::text[])"));
});
Deno.test("member saved assessments reject another profile or pack binding", async () => {
  const f = memberFixture();
  f.reports[0].body.analyses = {
    "SYNTHETIC-a": { status: "ready", versions: { profile: "SYNTHETIC-other" } },
  };
  await rejects(() => f.service.execute(request()), "storage_result_invalid");
});
