import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  type OwnReportListPort,
  type OwnReportListRow,
  OwnReportListService,
} from "../../supabase/functions/_shared/jungsi/application/own_report_list.ts";
import { OwnReportCursor } from "../../supabase/functions/_shared/jungsi/infrastructure/own_report_cursor.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { assert, equal } from "./fixture.ts";
const OWNER = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002";
const NOW = 1700000000000000n;
const session = {
  user: { subjectId: OWNER, expiresAtUtc: NOW + 1000000000n },
  evaluatedAtUtc: NOW,
  tier: "standard" as const,
  paidUntilUtc: null,
};
const row = (id: string, time = NOW - 1n): OwnReportListRow => ({
  reportId: id,
  reportOwner: OWNER,
  profileOwner: OWNER,
  examId: "SYNTHETIC-exam",
  stage: "provisional",
  isCurrent: true,
  revision: 2,
  updatedAtUtc: time,
});
async function rejects(work: () => Promise<unknown>, code: string, http: number) {
  try {
    await work();
    throw new Error("expected rejection");
  } catch (e) {
    assert(e instanceof AccessError);
    equal(e.code, code);
    equal(e.http, http);
  }
}
function fixture(records: readonly OwnReportListRow[]) {
  const calls: Parameters<OwnReportListPort["read"]>[0][] = [];
  let now = NOW;
  const cursors = new OwnReportCursor(new Uint8Array(32).fill(17), 4096);
  const service = new OwnReportListService(
    {
      read: (input) => {
        calls.push(input);
        return Promise.resolve(records);
      },
    },
    cursors,
    { nowUtc: () => now },
    60000000n,
  );
  return { service, cursors, calls, setNow: (n: bigint) => now = n };
}
Deno.test("own report list projects only own summaries with bounded lookahead", async () => {
  const f = fixture([row("SYNTHETIC-b"), row("SYNTHETIC-a", NOW - 2n)]);
  const result = await f.service.execute(session, { limit: "1" });
  equal(f.calls[0].owner, OWNER);
  equal(f.calls[0].take, 2);
  equal(result.items.length, 1);
  equal(result.has_more, true);
  assert(typeof result.next_cursor === "string");
  equal(Object.keys(result.items[0]).sort(), [
    "exam_id",
    "is_current",
    "report_id",
    "report_version",
    "stage",
    "updated_at",
  ]);
  assert(!JSON.stringify(result).includes(OWNER));
  const c = await f.cursors.open(result.next_cursor);
  equal(c.owner, OWNER);
  equal(c.afterReportId, "SYNTHETIC-b");
});
Deno.test("own report list empty result is a successful empty page", async () => {
  const result = await fixture([]).service.execute(session, {});
  equal(result.items, []);
  equal(result.has_more, false);
  equal(result.next_cursor, null);
});
Deno.test("own report discovery preserves an unknown legacy exam as null without broadening exam filters", async () => {
  const legacy = { ...row("SYNTHETIC-legacy"), examId: null };
  const result = await fixture([legacy]).service.execute(session, {});
  equal(result.items[0].exam_id, null);
  await rejects(
    () => fixture([legacy]).service.execute(session, { exam_id: "SYNTHETIC-exam" }),
    "storage_result_invalid",
    503,
  );
});
Deno.test("own report keyset uses the same ASCII C order for mixed IDs at one microsecond", async () => {
  const ids = ["SYNTHETIC-a", "SYNTHETIC-A", "SYNTHETIC-9", "SYNTHETIC:9", "SYNTHETIC.9"];
  const expected = [...ids].sort().reverse();
  const f = fixture(expected.map((id) => row(id)));
  const result = await f.service.execute(session, { limit: "4" });
  equal(result.items.map((x) => x.report_id), expected.slice(0, 4));
  assert(result.next_cursor !== null);
  const position = await f.cursors.open(result.next_cursor);
  equal(position.afterReportId, expected[3]);
  const next = fixture([row(expected[4])]);
  const second = await next.service.execute(session, { limit: "4", cursor: result.next_cursor });
  equal(second.items.map((x) => x.report_id), [expected[4]]);
  equal(second.next_cursor, null);
});
Deno.test("own report list rejects invalid limit and client owner filters before storage", async () => {
  const f = fixture([]);
  const queries: Record<string, string>[] = [{ limit: "0" }, { limit: "21" }, { limit: "01" }, {
    owner: OTHER,
  }, {
    exam_id: "bad/id",
  }];
  for (const q of queries) {
    await rejects(
      () => f.service.execute(session, q),
      q.exam_id ? "invalid_identifier" : "invalid_request",
      422,
    );
  }
  equal(f.calls.length, 0);
});
Deno.test("own report cursor binds owner, filter and expiry", async () => {
  const f = fixture([]);
  const token = await f.cursors.seal({
    format: "jungsi.own-report-cursor/v1",
    owner: OWNER,
    examId: "SYNTHETIC-exam",
    asOfUtc: "2023-11-14T22:13:20.000000Z",
    expiresAtUtc: "2023-11-14T22:14:20.000000Z",
    afterUpdatedAtUtc: "2023-11-14T22:13:19.999999Z",
    afterReportId: "SYNTHETIC-a",
  });
  await rejects(
    () =>
      f.service.execute({ ...session, user: { ...session.user, subjectId: OTHER } }, {
        cursor: token,
        exam_id: "SYNTHETIC-exam",
      }),
    "invalid_cursor",
    422,
  );
  await rejects(
    () => f.service.execute(session, { cursor: token, exam_id: "SYNTHETIC-other" }),
    "invalid_cursor",
    422,
  );
  f.setNow(NOW + 60000000n);
  await rejects(
    () => f.service.execute(session, { cursor: token, exam_id: "SYNTHETIC-exam" }),
    "cursor_expired",
    409,
  );
  equal(f.calls.length, 0);
});
Deno.test("own report cursor rejects tampering, unknown purpose and malformed encoding", async () => {
  const f = fixture([]);
  const token = await f.cursors.seal({
    format: "jungsi.own-report-cursor/v1",
    owner: OWNER,
    examId: null,
    asOfUtc: "2023-11-14T22:13:20.000000Z",
    expiresAtUtc: "2023-11-14T22:14:20.000000Z",
    afterUpdatedAtUtc: "2023-11-14T22:13:19.999999Z",
    afterReportId: "SYNTHETIC-a",
  });
  const parts = token.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  for (const bad of [parts.join("."), token.replace(/^rl1/, "other"), "rl1.x.x", ""]) {
    await rejects(() => f.cursors.open(bad), "invalid_cursor", 422);
  }
});
Deno.test("own report list fails closed on foreign, duplicate and out-of-order repository rows", async () => {
  for (
    const records of [
      [{ ...row("SYNTHETIC-a"), profileOwner: OTHER }],
      [row("SYNTHETIC-a"), row("SYNTHETIC-a")],
      [row("SYNTHETIC-a"), row("SYNTHETIC-b")],
      [{ ...row("SYNTHETIC-a"), revision: 0 }],
      [{ ...row("SYNTHETIC-a"), stage: "bad" as never }],
      [{ ...row("SYNTHETIC-a"), stage: null, isCurrent: true }],
      [{ ...row("SYNTHETIC-a"), isCurrent: "false" as never }],
      [row("SYNTHETIC-a", NOW + 1n)],
    ]
  ) {
    await rejects(
      () => fixture(records).service.execute(session, {}),
      "storage_result_invalid",
      503,
    );
  }
});

Deno.test("own report list keeps independent stage current flags and unknown legacy state", async () => {
  const records: OwnReportListRow[] = [
    { ...row("SYNTHETIC-c"), stage: "final", isCurrent: true },
    { ...row("SYNTHETIC-b"), stage: "provisional", isCurrent: true },
    { ...row("SYNTHETIC-a"), stage: null, isCurrent: null },
  ];
  const result = await fixture(records).service.execute(session, {});
  equal(result.items.map(({ stage, is_current }) => [stage, is_current]), [
    ["final", true],
    ["provisional", true],
    [null, null],
  ]);
});

/** Synthetic closed contract; the repository registry has its own Python projection checks. */
function ownListProjection(): PublicResponseProjection {
  const contract = "backend_platform_contract.dto_schemas.own_report_list";
  const object = (properties: Record<string, unknown>, required: string[]) => ({
    type: "object",
    nullable: false,
    properties,
    required,
    optional: [],
  });
  const item = object({
    report_id: { type: "string", nullable: false },
    exam_id: { type: "string", nullable: true },
    report_version: { type: "integer", nullable: false },
    updated_at: { type: "string", nullable: false },
    stage: { type: "string", nullable: true, enum: ["mock", "provisional", "final"] },
    is_current: { type: "boolean", nullable: true },
  }, ["report_id", "exam_id", "report_version", "updated_at", "stage", "is_current"]);
  const list = object({
    format: { type: "string", nullable: false, enum: ["jungsi.own-report-list/v1"] },
    items: { type: "array", nullable: false, items: item },
    next_cursor: { type: "string", nullable: true },
    has_more: { type: "boolean", nullable: false },
  }, ["format", "items", "next_cursor", "has_more"]);
  const root = { ref: "own_report_list", nullable: false };
  return new PublicResponseProjection({
    format: "jungsi.public-response-schemas/v1",
    schemas: {
      own_report_list: list,
      unused: { type: "string", nullable: false },
    },
    operations: [{
      id: "report.list-own",
      contract_ref: contract,
      roots: { standard: root, paid: root },
    }],
    auxiliary_roots: {
      error: { ref: "unused", nullable: false },
      readiness: { ref: "unused", nullable: false },
    },
  }, [{ id: "report.list-own", contract_ref: contract }]);
}
function tierSession(tier: "standard" | "paid") {
  return tier === "paid" ? { ...session, tier, paidUntilUtc: NOW + 1000000n } : session;
}
Deno.test("own report list preserves present all-null current flags in JSON and role projection", async () => {
  const records: OwnReportListRow[] = [
    { ...row("SYNTHETIC-b"), stage: "final", isCurrent: null },
    { ...row("SYNTHETIC-a", NOW - 2n), examId: null, stage: null, isCurrent: null },
  ];
  for (const tier of ["standard", "paid"] as const) {
    const result = await fixture(records).service.execute(tierSession(tier), {});
    const projected = ownListProjection().project("report.list-own", tier, result);
    for (
      const wire of [JSON.parse(JSON.stringify(result)), JSON.parse(JSON.stringify(projected))]
    ) {
      equal(wire.items.length, 2);
      equal(wire.items.map((item: { stage: unknown }) => item.stage), ["final", null]);
      for (const item of wire.items) {
        assert(Object.hasOwn(item, "is_current"));
        equal(item.is_current, null);
      }
    }
  }
});
Deno.test("own report list preserves mixed current flags across exams and stages", async () => {
  const records: OwnReportListRow[] = [
    { ...row("SYNTHETIC-e"), examId: "SYNTHETIC-exam-A", stage: "final", isCurrent: true },
    {
      ...row("SYNTHETIC-d", NOW - 2n),
      examId: "SYNTHETIC-exam-A",
      stage: "provisional",
      isCurrent: true,
    },
    {
      ...row("SYNTHETIC-c", NOW - 3n),
      examId: "SYNTHETIC-exam-A",
      stage: "final",
      isCurrent: false,
    },
    {
      ...row("SYNTHETIC-b", NOW - 4n),
      examId: "SYNTHETIC-exam-B",
      stage: "provisional",
      isCurrent: null,
    },
    { ...row("SYNTHETIC-a", NOW - 5n), examId: "SYNTHETIC-exam-C", stage: null, isCurrent: null },
  ];
  const expected = [
    ["SYNTHETIC-e", "SYNTHETIC-exam-A", "final", true],
    ["SYNTHETIC-d", "SYNTHETIC-exam-A", "provisional", true],
    ["SYNTHETIC-c", "SYNTHETIC-exam-A", "final", false],
    ["SYNTHETIC-b", "SYNTHETIC-exam-B", "provisional", null],
    ["SYNTHETIC-a", "SYNTHETIC-exam-C", null, null],
  ];
  for (const tier of ["standard", "paid"] as const) {
    const result = await fixture(records).service.execute(tierSession(tier), {});
    const projected = ownListProjection().project("report.list-own", tier, result);
    for (
      const wire of [JSON.parse(JSON.stringify(result)), JSON.parse(JSON.stringify(projected))]
    ) {
      equal(
        wire.items.map((
          item: { report_id: unknown; exam_id: unknown; stage: unknown; is_current: unknown },
        ) => [item.report_id, item.exam_id, item.stage, item.is_current]),
        expected,
      );
      assert(wire.items.every((item: object) => Object.hasOwn(item, "is_current")));
    }
  }
});
