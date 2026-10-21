/** Real professional HTTP/service/projection paths, backed exclusively by invented ports. */
import { PROFESSIONAL_CONTRACT } from "./jungsi/application/professional_contract.generated.ts";
import { ProfessionalPolicy } from "./jungsi/application/professional_policy.ts";
import { ProfessionalService } from "./jungsi/application/professional_service.ts";
import { AccessError } from "./jungsi/application/access.ts";
import { nativeJsonText, type NativeObject } from "./jungsi/domain/json_value.ts";
import { initialScoreInputState } from "./jungsi/domain/score_input_rights.ts";
import { utcText } from "./jungsi/domain/time.ts";
import {
  assert,
  denied,
  equal,
  EXPIRY,
  fixture,
  HASH,
  NOW,
  ORG,
  OTHER,
  PROFILE,
  REPORT,
  scores,
  STUDENT,
} from "./professional_support.ts";
Deno.test("professional HTTP preserves actionable archived-student 409", async () => {
  const f = await fixture();
  f.f.students.set(STUDENT, { ...f.baseStudent, archived: true });
  const response = await f.handler(
    f.request("pro.overall.analyze", { profile_id: PROFILE, expected_profile_version: PROFILE }),
  );
  equal(response.status, 409);
  equal((await response.json()).error.code, "professional_student_archived");
});
Deno.test("professional HTTP preserves initial-overall-report prerequisite as 409", async () => {
  const f = await fixture();
  f.ports.analysis.analyze = () =>
    Promise.reject(new AccessError("professional_initial_report_required", 409));
  const response = await f.handler(
    f.request("pro.university.analyze", {
      profile_id: PROFILE,
      expected_profile_version: PROFILE,
      offering_id: "SYNTHETIC-offering",
    }),
  );
  equal(response.status, 409);
  equal((await response.json()).error.code, "professional_initial_report_required");
  equal(f.f.states.get(STUDENT)!.version, 1);
});
function input(operation: string): NativeObject {
  const table: Record<string, NativeObject> = {
    "pro.student.create": { display_name: "가상 신규 학생", expected_contract_version: 1 },
    "pro.student.update": { display_name: "가상 변경 이름", expected_version: 1 },
    "pro.student.archive": { expected_version: 1 },
    "pro.student.assign": { assigned_teacher_ids: [OTHER], expected_version: 1 },
    "pro.score.create": {
      exam_id: "SYNTHETIC-mock",
      pack_version: "SYNTHETIC-pack.v1",
      stage: "mock",
      confirmed: true,
      scores: scores(),
      expected_entry_version: 0,
    },
    "pro.overall.analyze": { profile_id: PROFILE, expected_profile_version: PROFILE },
    "pro.university.analyze": {
      profile_id: PROFILE,
      expected_profile_version: PROFILE,
      offering_id: "SYNTHETIC-offering",
    },
    "pro.candidates": { profile_id: PROFILE, expected_profile_version: PROFILE, filters: {} },
    "pro.bookmark.add": { report_id: REPORT, offering_id: "SYNTHETIC-offering" },
    "pro.report.export": { revision_id: 1 },
    "pro.correction.grant": {
      exam_id: "SYNTHETIC-mock",
      stage: "mock",
      ticket_ref: "SYNTHETIC-ticket",
      expected_version: 1,
    },
    "pro.retention.preview": {
      contract_id: "SYNTHETIC-contract",
      academic_year: 2027,
      official_deadline_reference: "https://synthetic.invalid/deadline",
      cutoff_at_utc: utcText(NOW),
    },
  };
  return table[operation] ?? {};
}
for (const route of PROFESSIONAL_CONTRACT.routes) {
  Deno.test("professional HTTP " + route.id + " executes authorized workflow", async () => {
    const admin = ["pro.member.list", "pro.student.assign", "pro.student.archive"].includes(
        route.id,
      ),
      f = await fixture(admin ? "org_admin" : "teacher");
    if (route.id === "pro.correction.grant" || route.id.startsWith("pro.retention.")) {
      f.f.accountRole = "admin";
    }
    if (route.id === "pro.score.create") {
      f.f.states.clear();
      f.f.profiles.clear();
      f.f.reports.clear();
    }
    const query: Record<string, string> = route.id === "pro.score.status"
      ? { exam_id: "SYNTHETIC-mock", pack_version: "SYNTHETIC-pack.v1", stage: "mock" }
      : route.id === "pro.bookmark.list"
      ? { report_id: REPORT }
      : {};
    const response = await f.handler(f.request(route.id, input(route.id), query));
    const text = await response.text();
    assert(
      response.status >= 200 && response.status < 300,
      route.id + ": " + response.status + " " + text,
    );
    assert(response.headers.get("cache-control")?.includes("no-store"));
    const json = JSON.parse(text);
    assert(/^[a-f0-9]{32}$/.test(json.request_id));
    assert(f.f.audits.length > 0);
    assert(f.f.settlements.length > 0);
  });
}
for (
  const [name, mutate, expected] of [
    ["missing relay", (r: Request) => r.headers.delete("X-Jungsi-Relay-Token"), 403],
    [
      "invalid relay",
      (r: Request) =>
        r.headers.set("X-Jungsi-Relay-Token", "SYNTHETIC-invalid-relay-00000000000000000000"),
      403,
    ],
    ["missing bearer", (r: Request) => r.headers.delete("authorization"), 401],
    [
      "invalid bearer",
      (r: Request) => r.headers.set("authorization", "Bearer SYNTHETIC-invalid"),
      401,
    ],
    ["missing CSRF", (r: Request) => r.headers.delete("X-Jungsi-CSRF-Verified"), 403],
    ["wrong origin", (r: Request) => r.headers.set("origin", "https://other.invalid"), 403],
  ] as const
) {
  Deno.test("professional HTTP rejects " + name + " before mutation", async () => {
    const f = await fixture(),
      request = f.request("pro.student.create", input("pro.student.create"));
    mutate(request);
    equal((await f.handler(request)).status, expected);
    equal(f.f.students.size, 1);
    equal(f.f.reserveCalls.length, 0);
  });
}
Deno.test("professional HTTP inactive account and duplicate query cannot consume rights", async () => {
  const f = await fixture();
  f.f.accountStatus = "inactive";
  equal((await f.handler(f.request("pro.student.list"))).status, 403);
  f.f.accountStatus = "active";
  const request = f.request("pro.student.list"),
    duplicate = new Request(request.url + "?limit=1&limit=2", request);
  equal((await f.handler(duplicate)).status, 422);
  equal(f.f.reserveCalls.length, 0);
});
Deno.test("professional HTTP rejects unknown tenant claims and oversized bodies", async () => {
  const f = await fixture();
  equal(
    (await f.handler(
      f.request("pro.student.create", {
        ...input("pro.student.create"),
        org_id: "SYNTHETIC-other",
      }),
    )).status,
    422,
  );
  equal(
    (await f.handler(
      f.request("pro.student.create", { ...input("pro.student.create"), memo: "X".repeat(70000) }),
    )).status,
    422,
  );
  equal(f.f.students.size, 1);
});
Deno.test("professional HTTP 429 retains Retry-After and safe error fields", async () => {
  const f = await fixture();
  f.f.rateFails = true;
  const response = await f.handler(f.request("pro.student.list"));
  equal(response.status, 429);
  equal(response.headers.get("Retry-After"), "7");
  const json = await response.json();
  equal(Object.keys(json.error), ["code"]);
  equal(json.error.code, "rate_limit_exceeded");
});
Deno.test("professional HTTP slow body is cancelled within the ingress deadline", async () => {
  const f = await fixture("teacher", 80),
    original = f.request("pro.student.create", input("pro.student.create"));
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = await f.handler(
    new Request(original.url, { method: "POST", headers: original.headers, body: stream }),
  );
  equal(response.status, 503);
  equal((await response.json()).error.code, "professional_request_timeout");
  assert(cancelled);
  equal(f.f.students.size, 1);
  equal(f.f.reserveCalls.length, 0);
});
Deno.test("professional session uses a separate tenant-latched transaction for every organization", async () => {
  const f = await fixture();
  f.f.organizations.push("SYNTHETIC-org-two");
  const response = await f.handler(f.request("pro.session"));
  equal(response.status, 200);
  const json = await response.json();
  equal(json.data.organizations.length, 2);
  equal(json.data.org_id, null);
  equal(json.data.contract_status, "selection_required");
  equal(f.f.transactionOrgs, [ORG, "SYNTHETIC-org-two"]);
  equal(f.f.reserveCalls.length, 1);
});
Deno.test("professional metadata cannot override server IDs or expose nested secret canaries", async () => {
  const f = await fixture();
  f.f.students.set(STUDENT, {
    ...f.baseStudent,
    metadata: {
      ...f.baseStudent.metadata,
      org_id: "SYNTHETIC-evil",
      student_id: "SYNTHETIC-evil",
      version: 999,
      account_token: "SYNTHETIC-SECRET-CANARY",
      model: { weights: "SYNTHETIC-SECRET-CANARY" },
    },
  });
  const response = await f.handler(f.request("pro.student.read")), text = await response.text();
  equal(response.status, 200);
  assert(!text.includes("SECRET-CANARY"));
  const json = JSON.parse(text);
  equal(json.data.org_id, ORG);
  equal(json.data.student_id, STUDENT);
  equal(json.data.version, 1);
});
Deno.test("professional cross-organization and unassigned lookups share the same 404", async () => {
  const f = await fixture(),
    first = new Request(
      f.request("pro.student.read").url.replace(ORG, "SYNTHETIC-other"),
      f.request("pro.student.read"),
    );
  const a = await f.handler(first);
  f.f.students.set(STUDENT, { ...f.baseStudent, assignedSubjectIds: [OTHER] });
  const b = await f.handler(f.request("pro.student.read"));
  equal(a.status, 404);
  equal(b.status, 404);
  equal((await a.json()).error, (await b.json()).error);
});
Deno.test("professional viewer cannot enter scores and org admin cannot grant support corrections", async () => {
  const viewer = await fixture("viewer");
  equal(
    (await viewer.handler(viewer.request("pro.score.create", input("pro.score.create")))).status,
    403,
  );
  const admin = await fixture("org_admin");
  equal(
    (await admin.handler(admin.request("pro.correction.grant", input("pro.correction.grant"))))
      .status,
    403,
  );
});
Deno.test("professional support correction requires fresh platform admin aal2 and exact ticket scope", async () => {
  const f = await fixture();
  f.f.accountRole = "admin";
  f.f.aal = "aal1";
  equal(
    (await f.handler(f.request("pro.correction.grant", input("pro.correction.grant")))).status,
    403,
  );
  f.f.aal = "aal2";
  const resolved = f.ports.authority.resolve;
  f.ports.authority.resolve = async (...args) => ({
    ...await resolved(...args),
    supportStudentId: "SYNTHETIC-other",
  });
  equal(
    (await f.handler(f.request("pro.correction.grant", input("pro.correction.grant")))).status,
    404,
  );
});
Deno.test("professional semantic rejection commits one attempt and replays without another save", async () => {
  const f = await fixture();
  f.f.states.clear();
  f.f.profiles.clear();
  f.f.semantic = "unobserved_standard_score";
  const first = await f.handler(f.request("pro.score.create", input("pro.score.create"))),
    second = await f.handler(f.request("pro.score.create", input("pro.score.create")));
  equal(first.status, 422);
  equal(second.status, 422);
  equal(f.f.states.get(STUDENT)!.version, 1);
  equal(f.f.profiles.size, 0);
  equal(f.f.requests.size, 1);
  assert((f.f.settlements.at(-1) as { replayed: boolean }).replayed);
});
Deno.test("professional failed audit rolls back student, seat-equivalent and idempotent receipt", async () => {
  const f = await fixture();
  f.f.auditFails = true;
  equal(
    (await f.handler(f.request("pro.student.create", input("pro.student.create")))).status,
    503,
  );
  equal(f.f.students.size, 1);
  equal(f.f.requests.size, 0);
  assert(f.f.settlements.some((s) => !(s as { success: boolean }).success));
});
Deno.test("professional final authority revocation rolls back the pending mutation", async () => {
  const f = await fixture(), record = f.ports.audit.record;
  f.ports.audit.record = async (...args) => {
    await record(...args);
    f.f.revoked = true;
  };
  equal(
    (await f.handler(f.request("pro.student.update", input("pro.student.update")))).status,
    403,
  );
  equal(f.f.students.get(STUDENT)!.version, 1);
  equal(f.f.requests.size, 0);
});
Deno.test("professional last seat and initial input are atomic under concurrent requests", async () => {
  const f = await fixture();
  for (let i = 2; i <= 29; i++) {
    f.f.students.set("SYNTHETIC-fill-" + i, { ...f.baseStudent, studentId: "SYNTHETIC-fill-" + i });
  }
  const results = await Promise.allSettled([
    f.service.execute(
      f.execution("pro.student.create", input("pro.student.create"), { key: "SYNTHETIC-A" }),
    ),
    f.service.execute(
      f.execution("pro.student.create", input("pro.student.create"), { key: "SYNTHETIC-B" }),
    ),
  ]);
  equal(results.filter((r) => r.status === "fulfilled").length, 1);
  equal(f.f.students.size, 30);
  const g = await fixture();
  g.f.states.clear();
  g.f.profiles.clear();
  const attempts = await Promise.allSettled([
    g.service.execute(
      g.execution("pro.score.create", input("pro.score.create"), { key: "SYNTHETIC-A" }),
    ),
    g.service.execute(
      g.execution("pro.score.create", input("pro.score.create"), { key: "SYNTHETIC-B" }),
    ),
  ]);
  equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  equal(g.f.states.get(STUDENT)!.version, 1);
  equal(g.f.profiles.size, 1);
});
Deno.test("professional analysis failure resumes from the saved profile without consuming another input", async () => {
  const f = await fixture();
  f.f.analysisFails = true;
  const r = f.execution("pro.overall.analyze", input("pro.overall.analyze"));
  await denied(() => f.service.execute(r), "professional_analysis_unavailable", 503);
  equal(f.f.states.get(STUDENT)!.version, 1);
  f.f.analysisFails = false;
  await f.service.execute(r);
  equal(f.f.states.get(STUDENT)!.version, 1);
  equal(f.f.profiles.size, 1);
  equal(f.f.history.length, 2);
});
Deno.test("professional twenty students can be processed sequentially under separate student rights", async () => {
  const f = await fixture();
  f.f.states.clear();
  f.f.profiles.clear();
  for (let i = 1; i <= 20; i++) {
    const studentId = "SYNTHETIC-twenty-" + i;
    f.f.students.set(studentId, { ...f.baseStudent, studentId });
    await f.service.execute(
      f.execution("pro.score.create", input("pro.score.create"), {
        params: { org_id: ORG, student_id: studentId },
        key: "SYNTHETIC-key-" + i,
      }),
    );
    const profileId = f.f.states.get(studentId)!.currentProfileId!;
    for (const operation of ["pro.overall.analyze", "pro.university.analyze", "pro.candidates"]) {
      await f.service.execute(
        f.execution(operation, {
          ...input(operation),
          profile_id: profileId,
          expected_profile_version: profileId,
        }, {
          params: { org_id: ORG, student_id: studentId },
          key: "SYNTHETIC-analysis-" + i + "-" + operation,
        }),
      );
    }
  }
  equal(f.f.profiles.size, 20);
  equal([...f.f.states.values()].filter((s) => s.initialAttemptId !== null).length, 20);
  equal(f.f.analysisCalls, 60);
});
Deno.test("professional stored-profile analysis remains available after the input window closes", async () => {
  const f = await fixture();
  const op = f.raw.operating_policy as NativeObject;
  op.stages = [{
    exam_id: "SYNTHETIC-mock",
    pack_version: "SYNTHETIC-pack.v1",
    input_scope_id: "SYNTHETIC-season",
    academic_year: 2027,
    stage: "provisional",
    window: {
      mode: "official",
      approved: true,
      source_ref: "https://synthetic.invalid/calendar",
      opens_at: utcText(NOW - 2000000n),
      closes_at: utcText(NOW - 1000000n),
    },
  }];
  f.f.profiles.set(PROFILE, { ...f.profile, stage: "provisional" });
  const policy = new ProfessionalPolicy(f.raw, {
    approvalSha256: HASH,
    registrySha256: HASH,
    selectionSha256: HASH,
    expiresAtUtc: EXPIRY,
  });
  const service = new ProfessionalService(f.ports, policy, PROFESSIONAL_CONTRACT);
  await service.execute(f.execution("pro.overall.analyze", input("pro.overall.analyze")));
  equal(f.f.states.get(STUDENT)!.version, 1);
});
Deno.test("professional saved pending result stays pending and print is private without share URLs", async () => {
  const f = await fixture(),
    response = await f.handler(f.request("pro.report.export", input("pro.report.export"))),
    text = await response.text();
  equal(response.status, 200);
  equal(JSON.parse(text).status, "pending");
  assert(!text.includes("share_url"));
  assert(!text.includes("access_token"));
  equal(JSON.parse(text).data.watermark.student_name, "가상 학생");
});
Deno.test("professional unknown input errors leave the initial right unused", async () => {
  const f = await fixture();
  f.f.states.set(STUDENT, initialScoreInputState());
  const request = input("pro.score.create");
  (request.scores as NativeObject).korean = { standard_score: "SYNTHETIC-invalid" };
  equal((await f.handler(f.request("pro.score.create", request))).status, 422);
  equal(f.f.states.get(STUDENT)!.version, 0);
  assert(nativeJsonText(f.f.audits).indexOf("SYNTHETIC-invalid") === -1);
});
