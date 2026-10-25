import { assert, equal } from "./fixture.ts";
import { memberFixture, NOW, paid, rejects, report, request } from "./member_shortlist_fixture.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type { StoredReport } from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";
const edit = (selected = true, expected_revision = 0) =>
  request("member-shortlist.update", {
    selected,
    expected_revision,
    ...(expected_revision === 0
      ? { expected_legacy_source: { report_id: "SYNTHETIC-report", report_version: 1 } }
      : {}),
  });
Deno.test("member uninitialized print requires the exact legacy list source rather than another report", async () => {
  const f = memberFixture(), newest = report("SYNTHETIC-newest", 2);
  newest.body.shortlist = { "SYNTHETIC-b": { selected: true, changed_at: newest.updated_at } };
  f.reports.unshift({ ...newest, updated_at: "2026-10-25T00:00:01.000000Z" });
  const r = await f.service.execute({
    ...request(),
    query: { year: "2027", report_id: "SYNTHETIC-report" },
  });
  equal((r.items as NativeObject[]).map((i) => i.offering_id), ["SYNTHETIC-b"]);
  await rejects(
    () =>
      f.service.print({
        ...request(),
        operation: "report.export",
        params: { report_id: "SYNTHETIC-report" },
        query: { year: "2027", expected_report_version: "1", shortlist_revision: "0" },
      }),
    "revision_conflict",
    409,
  );
  const printed = await f.service.print({
    ...request(),
    operation: "report.export",
    params: { report_id: "SYNTHETIC-newest" },
    query: { year: "2027", expected_report_version: "2", shortlist_revision: "0" },
  });
  equal(
    ((printed.member_shortlist as NativeObject).items as NativeObject[]).map((i) => i.offering_id),
    ["SYNTHETIC-b"],
  );
  equal(f.counts.put, 0);
});
Deno.test("member shortlist final row lock serializes the actual legacy report writer through publication", async () => {
  const f = memberFixture();
  let writer: Promise<StoredReport> | undefined;
  f.afterLegacyLock(() => {
    const old = report(),
      body = {
        ...old.body,
        shortlist: {
          "SYNTHETIC-a": { selected: false, changed_at: "2026-10-25T00:00:01.000000Z" },
        },
      };
    writer = f.newWorker().platform.writeReport({
      owner: paid.user.subjectId,
      profileId: old.profile_id,
      reportId: old.report_id,
      body,
      expected: 1,
      nowUtc: NOW + 1000000n,
      operation: "shortlist.update",
      key: "SYNTHETIC-concurrent-legacy",
      digest: "d".repeat(64),
    });
  });
  const first = await f.service.execute(edit());
  assert(writer);
  const written = await writer;
  equal((first.items as NativeObject[]).map((i) => i.offering_id), ["SYNTHETIC-a", "SYNTHETIC-b"]);
  equal(written.revision, 2);
  const rowLock = f.statements.findIndex((s) => s.sql.endsWith("FOR SHARE OF r")),
    publication = f.statements.findIndex((s) =>
      s.sql.includes("INSERT INTO jungsi_backend.requests") &&
      s.args[1] === "member-shortlist.publication"
    ),
    legacyLock = f.statements.findIndex((s) =>
      s.sql.includes("WHERE report_id=$1 AND owner_id=$2 FOR UPDATE")
    );
  assert(rowLock >= 0 && publication > rowLock && legacyLock > publication);
  const saved = await f.repository.read(paid.user.subjectId, 2027);
  assert(saved?.document.items.some((i) => i.offering_id === "SYNTHETIC-a" && i.selected));
});
Deno.test("member shortlist same key across years has one commit and explicit digest409", async () => {
  const f = memberFixture(),
    base = {
      owner: paid.user.subjectId,
      expected: 0,
      expectedSha: null,
      key: "SYNTHETIC-cross-year",
      proof: { assessment: null, responseSha: "f".repeat(64) },
      now: "2026-10-25T00:00:00.000000Z",
      assertCurrent: () => Promise.resolve(),
    };
  const values = await Promise.allSettled([
    f.repository.rememberNoOp({
      ...base,
      year: 2027,
      digest: "a".repeat(64),
      expectedLegacy: { report_id: "SYNTHETIC-report", report_revision: 1 },
    }),
    f.repository.rememberNoOp({
      ...base,
      year: 2028,
      digest: "b".repeat(64),
      expectedLegacy: null,
    }),
  ]);
  equal(values.filter((v) => v.status === "fulfilled").length, 1);
  const lost = values.find((v) => v.status === "rejected");
  assert(lost?.status === "rejected");
  equal(lost.reason.code, "idempotency_conflict");
  equal(lost.reason.http, 409);
  equal(f.counts.put, 0);
  const locks = f.statements.filter((s) => s.sql.includes("pg_advisory_xact_lock"));
  equal(locks[0].args[0], locks[2].args[0]);
  assert(locks[1].args[0] !== locks[3].args[0]);
});
Deno.test("member shortlist reaching the selection limit then clearing it permits another school", async () => {
  const f = memberFixture(2);
  await f.service.execute(edit());
  const command = (id: string, selected: boolean, expected_revision: number, key: string) => ({
    ...request("member-shortlist.update", { selected, expected_revision }, undefined, key),
    params: { offering_id: id },
  });
  await rejects(
    () => f.service.execute(command("SYNTHETIC-c", true, 1, "SYNTHETIC-full")),
    "shortlist_limit_exceeded",
    409,
  );
  await f.service.execute(command("SYNTHETIC-a", false, 1, "SYNTHETIC-clear-a"));
  await f.service.execute(command("SYNTHETIC-b", false, 2, "SYNTHETIC-clear-b"));
  const v = await f.service.execute(command("SYNTHETIC-c", true, 3, "SYNTHETIC-new-c"));
  equal((v.items as NativeObject[]).map((i) => i.offering_id), ["SYNTHETIC-c"]);
  equal(v.revision, 4);
  equal(f.objects.size, 4);
});
Deno.test("member shortlist legacy GET preserves selections without JSON or metadata writes", async () => {
  const f = memberFixture(), v = await f.service.execute(request());
  equal(v.origin, "legacy_report");
  equal(v.revision, 0);
  equal((v.items as NativeObject[]).map((i) => i.offering_id), ["SYNTHETIC-a"]);
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 0);
  equal(f.counts.results, 1);
  equal(f.counts.catalog, 1);
});
Deno.test("member shortlist first explicit PUT keeps the entire legacy list", async () => {
  const f = memberFixture(), v = await f.service.execute(edit());
  equal(v.revision, 1);
  equal(v.origin, "member_json");
  equal((v.items as NativeObject[]).map((i) => i.offering_id), ["SYNTHETIC-a", "SYNTHETIC-b"]);
  equal(f.counts.dbInsert, 2);
  equal(f.reports[0].revision, 1);
  equal(Object.keys(f.reports[0].body.shortlist as NativeObject), ["SYNTHETIC-a"]);
});
Deno.test("member shortlist legacy same-state PUT records a small replay without JSON migration", async () => {
  const f = memberFixture(), r = edit();
  await f.service.execute({ ...r, params: { offering_id: "SYNTHETIC-a" } });
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 1);
});
Deno.test("member shortlist empty first read has revision0 and no hidden initialization", async () => {
  const f = memberFixture();
  f.reports.length = 0;
  const v = await f.service.execute(request());
  equal(v.origin, "empty");
  equal(v.updated_at, null);
  equal(v.items, []);
  equal(f.objects.size, 0);
});
Deno.test("member shortlist two devices have one winning revision and no lost selection", async () => {
  const f = memberFixture();
  const a = edit(),
    b = { ...edit(false), params: { offering_id: "SYNTHETIC-a" }, requestKey: "SYNTHETIC-other" };
  const values = await Promise.allSettled([
    f.newWorker().service.execute(a),
    f.newWorker().service.execute(b),
  ]);
  equal(values.filter((x) => x.status === "fulfilled").length, 1);
  const losing = values.find((x) => x.status === "rejected");
  assert(losing?.status === "rejected");
  equal(losing.reason.code, "revision_conflict");
  const current = await f.service.execute(request());
  equal(current.revision, 1);
  equal(f.records.size, 2);
});
Deno.test("member shortlist stale legacy revision cannot publish after JSON create", async () => {
  const f = memberFixture();
  f.afterPut(() => f.reports[0] = report("SYNTHETIC-report", 2));
  await rejects(() => f.service.execute(edit()), "revision_conflict", 409);
  equal(f.records.size, 0);
  equal(f.objects.size, 1);
});
Deno.test("member shortlist explicit PUT migration checks the latest report identity", async () => {
  const f = memberFixture();
  f.afterPut(() =>
    f.reports.unshift({ ...report("SYNTHETIC-new"), updated_at: "2026-10-25T00:00:01.000000Z" })
  );
  await rejects(() => f.service.execute(edit()), "revision_conflict", 409);
  equal(f.records.size, 0);
});
Deno.test("member shortlist identical request replays the exact published revision", async () => {
  const f = memberFixture(), r = edit();
  const first = await f.service.execute(r);
  const writes = f.counts.put;
  const second = await f.service.execute(r);
  equal(second, first);
  equal(f.counts.put, writes);
  equal(f.records.size, 2);
});
Deno.test("member shortlist changed expected revision requires a new idempotency key", async () => {
  const f = memberFixture();
  await f.service.execute(edit());
  await rejects(() => f.service.execute(edit(false, 1)), "idempotency_conflict", 409);
});
Deno.test("member shortlist unselect preserves old immutable JSON while current revision omits unselected entries", async () => {
  const f = memberFixture();
  await f.service.execute(edit());
  const r = { ...edit(false, 1), requestKey: "SYNTHETIC-remove" };
  const v = await f.service.execute(r);
  equal(v.revision, 2);
  equal((v.items as NativeObject[]).map((i) => i.offering_id), ["SYNTHETIC-a"]);
  equal(f.objects.size, 2);
  const d = await f.repository.read(paid.user.subjectId, 2027);
  assert(d);
  equal(d.document.items.find((i) => i.offering_id === "SYNTHETIC-b"), undefined);
  const previous = await f.repository.read(paid.user.subjectId, 2027, 1);
  assert(previous?.document.items.some((i) => i.offering_id === "SYNTHETIC-b" && i.selected));
});
Deno.test("member shortlist PUT response keeps optional selected report context", async () => {
  const f = memberFixture(), r = edit();
  const v = await f.service.execute({
    ...r,
    query: { year: "2027", report_id: "SYNTHETIC-report" },
  });
  equal((v.assessment_context as NativeObject).source, "selected_report");
  equal((v.assessment_context as NativeObject).report_id, "SYNTHETIC-report");
});
Deno.test("member shortlist rejects client owner/path and invalid years", async () => {
  const f = memberFixture();
  const queries: Record<string, string>[] = [{ year: "2027", owner: "other" }, { year: "27" }, {
    year: "2027",
    path: "evil",
  }];
  for (const query of queries) {
    await rejects(() => f.service.execute({ ...request(), query }), "invalid_request", 422);
  }
  equal(f.counts.put, 0);
});
Deno.test("member shortlist rejects free and expired users before private reads", async () => {
  const f = memberFixture();
  await rejects(
    () =>
      f.service.execute({
        ...request(),
        session: { ...paid, tier: "standard", paidUntilUtc: null },
      }),
    "paid_required",
    403,
  );
  await rejects(
    () =>
      f.service.execute({
        ...request(),
        session: { ...paid, user: { ...paid.user, expiresAtUtc: NOW - 1n } },
      }),
    "authentication_required",
    401,
  );
  equal(f.counts.legacy, 0);
});
Deno.test("member shortlist print binds old report and shortlist revisions after later edits", async () => {
  const f = memberFixture();
  await f.service.execute(edit());
  await f.service.execute({ ...edit(false, 1), requestKey: "SYNTHETIC-remove" });
  const v = await f.service.print({
    ...request(),
    operation: "report.export",
    params: { report_id: "SYNTHETIC-report" },
    query: { year: "2027", expected_report_version: "1", shortlist_revision: "1" },
  });
  equal(v.shortlist_revision, 1);
  equal(((v.member_shortlist as NativeObject).items as NativeObject[]).length, 2);
  equal((v.report as NativeObject).report_version, 1);
  equal(
    ((v.member_shortlist as NativeObject).assessment_context as NativeObject).report_version,
    1,
  );
  await rejects(
    () =>
      f.service.print({
        ...request(),
        operation: "report.export",
        params: { report_id: "SYNTHETIC-report" },
        query: { year: "2027", expected_report_version: "1", shortlist_revision: "99" },
      }),
    "revision_conflict",
    409,
  );
});
Deno.test("member shortlist no-op key cannot be reused for a different intent", async () => {
  const f = memberFixture(), r = { ...edit(), params: { offering_id: "SYNTHETIC-a" } };
  await f.service.execute(r);
  await rejects(
    () => f.service.execute({ ...r, body: { ...r.body as NativeObject, selected: false } }),
    "idempotency_conflict",
    409,
  );
  equal(f.counts.put, 0);
});
Deno.test("member shortlist no-op replay preserves exact legacy and assessment revisions", async () => {
  const f = memberFixture(),
    r = { ...edit(), params: { offering_id: "SYNTHETIC-a" } },
    first = await f.service.execute(r);
  const newer = { ...report("SYNTHETIC-report", 2), updated_at: "2026-10-25T00:00:01.000000Z" };
  newer.body.shortlist = {};
  f.reports.unshift(newer);
  equal(await f.service.execute(r), first);
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 1);
});
Deno.test("member shortlist empty no-op replay stays empty after another report appears", async () => {
  const f = memberFixture();
  f.reports.length = 0;
  const r = request("member-shortlist.update", { selected: false, expected_revision: 0 });
  const first = await f.service.execute(r);
  f.reports.push(report());
  equal(await f.service.execute(r), first);
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 1);
});
Deno.test("member shortlist replay detects changed display rather than returning a different first response", async () => {
  const f = memberFixture(), r = edit();
  await f.service.execute(r);
  f.setDisplayName("수정된 합성대학");
  await rejects(() => f.service.execute(r), "revision_conflict", 409);
});
Deno.test("member shortlist can remove a previously selected unavailable offering", async () => {
  const f = memberFixture();
  await f.service.execute(edit());
  f.setMissingCatalog("SYNTHETIC-b");
  const v = await f.service.execute({ ...edit(false, 1), requestKey: "SYNTHETIC-remove" });
  equal(v.revision, 2);
  equal((v.items as NativeObject[]).map((i) => i.offering_id), ["SYNTHETIC-a"]);
});
Deno.test("member shortlist rejects unapproved four-digit year before any private lookup", async () => {
  const f = memberFixture();
  await rejects(
    () => f.service.execute({ ...request(), query: { year: "2099" } }),
    "exam_not_available",
    422,
  );
  equal(f.counts.legacy, 0);
  equal(f.counts.get, 0);
});
Deno.test("member shortlist forty entries use one catalogue batch and one saved assessment query", async () => {
  const f = memberFixture();
  f.reports[0].body.shortlist = Object.fromEntries(
    Array.from(
      { length: 40 },
      (_, i) => ["SYNTHETIC-" + i, { selected: true, changed_at: f.reports[0].updated_at }],
    ),
  );
  const v = await f.service.execute(request());
  equal((v.items as NativeObject[]).length, 40);
  equal(f.counts.catalog, 1);
  equal(f.counts.results, 1);
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 0);
});

Deno.test("member initial print pins the GET legacy list independently after another report arrives", async () => {
  const f = memberFixture(), newer = report("SYNTHETIC-newest", 2);
  newer.body.shortlist = { "SYNTHETIC-b": { selected: true, changed_at: newer.updated_at } };
  f.reports.unshift({ ...newer, updated_at: "2026-10-25T00:00:01.000000Z" });
  const read = await f.service.execute({
    ...request(),
    query: { year: "2027", report_id: "SYNTHETIC-report" },
  });
  equal(read.legacy_source, { report_id: "SYNTHETIC-newest", report_version: 2 });
  f.reports.unshift({
    ...report("SYNTHETIC-after-get", 3),
    updated_at: "2026-10-25T00:00:02.000000Z",
  });
  const printed = await f.service.print({
    ...request(),
    operation: "report.export",
    params: { report_id: "SYNTHETIC-report" },
    query: {
      year: "2027",
      expected_report_version: "1",
      shortlist_revision: "0",
      legacy_source_report_id: "SYNTHETIC-newest",
      legacy_source_report_version: "2",
    },
  });
  const list = printed.member_shortlist as NativeObject;
  equal((printed.report as NativeObject).report_id, "SYNTHETIC-report");
  equal(list.legacy_source, read.legacy_source);
  equal(list.items, read.items);
  equal((list.assessment_context as NativeObject).report_id, "SYNTHETIC-report");
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 0);
  equal(f.records.size, 0);
});
Deno.test("member initial print can preserve an earlier legacy revision of the selected report", async () => {
  const f = memberFixture(), current = report("SYNTHETIC-report", 2);
  current.body.shortlist = { "SYNTHETIC-b": { selected: true, changed_at: current.updated_at } };
  f.reports.unshift({ ...current, updated_at: "2026-10-25T00:00:01.000000Z" });
  const printed = await f.service.print({
    ...request(),
    operation: "report.export",
    params: { report_id: "SYNTHETIC-report" },
    query: {
      year: "2027",
      expected_report_version: "2",
      shortlist_revision: "0",
      legacy_source_report_id: "SYNTHETIC-report",
      legacy_source_report_version: "1",
    },
  });
  equal((printed.report as NativeObject).report_version, 2);
  const list = printed.member_shortlist as NativeObject;
  equal(list.legacy_source, { report_id: "SYNTHETIC-report", report_version: 1 });
  equal((list.items as NativeObject[]).map((i) => i.offering_id), ["SYNTHETIC-a"]);
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 0);
});
Deno.test("member initial print rejects partial or malformed legacy pins before private lookups", async () => {
  const f = memberFixture(),
    base = { year: "2027", expected_report_version: "1", shortlist_revision: "0" };
  const cases: Record<string, string>[] = [
    { legacy_source_report_id: "SYNTHETIC-report" },
    { legacy_source_report_version: "1" },
    { legacy_source_report_id: "SYNTHETIC-report", legacy_source_report_version: "0" },
    { legacy_source_report_id: "SYNTHETIC-report", legacy_source_report_version: "1.5" },
    {
      legacy_source_report_id: "SYNTHETIC-report",
      legacy_source_report_version: "9007199254740992",
    },
  ];
  for (const pin of cases) {
    await rejects(
      () =>
        f.service.print({
          ...request(),
          operation: "report.export",
          params: { report_id: "SYNTHETIC-report" },
          query: { ...base, ...pin },
        }),
      pin.legacy_source_report_version === "0" ||
        pin.legacy_source_report_version === "9007199254740992"
        ? "invalid_revision"
        : "invalid_request",
      422,
    );
  }
  await rejects(
    () =>
      f.service.print({
        ...request(),
        operation: "report.export",
        params: { report_id: "SYNTHETIC-report" },
        query: { ...base, legacy_source_report_id: "../escape", legacy_source_report_version: "1" },
      }),
    "invalid_identifier",
    422,
  );
  equal(f.counts.legacy, 0);
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 0);
});
Deno.test("member stored JSON print rejects legacy pins rather than mixing selection generations", async () => {
  const f = memberFixture();
  await rejects(
    () =>
      f.service.print({
        ...request(),
        operation: "report.export",
        params: { report_id: "SYNTHETIC-report" },
        query: {
          year: "2027",
          expected_report_version: "1",
          shortlist_revision: "1",
          legacy_source_report_id: "SYNTHETIC-report",
          legacy_source_report_version: "1",
        },
      }),
    "invalid_request",
    422,
  );
  equal(f.counts.legacy, 0);
  equal(f.counts.get, 0);
  equal(f.counts.put, 0);
});
Deno.test("member initial print never substitutes another owner year or absent legacy revision", async () => {
  const f = memberFixture(),
    foreign = report("SYNTHETIC-foreign"),
    wrongYear = report("SYNTHETIC-other-year");
  f.reports.push({ ...foreign, owner_id: "00000000-0000-0000-0000-000000000002" });
  ((wrongYear.body.overall as NativeObject).exam as NativeObject).academic_year = 2028;
  f.reports.push(wrongYear);
  for (
    const [id, version] of [["SYNTHETIC-foreign", "1"], ["SYNTHETIC-other-year", "1"], [
      "SYNTHETIC-report",
      "99",
    ]]
  ) {
    await rejects(
      () =>
        f.service.print({
          ...request(),
          operation: "report.export",
          params: { report_id: "SYNTHETIC-report" },
          query: {
            year: "2027",
            expected_report_version: "1",
            shortlist_revision: "0",
            legacy_source_report_id: id,
            legacy_source_report_version: version,
          },
        }),
      "report_not_found",
      404,
    );
  }
  equal(f.counts.put, 0);
  equal(f.counts.dbInsert, 0);
  equal(f.records.size, 0);
});
