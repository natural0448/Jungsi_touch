import { syncPromise } from "./fixture.ts";
/** Invented private reports verify aggregate counts, ownership and immutable shortlist updates. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type {
  ApiExecution,
  ApiOperationId,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { CatalogService } from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import { ReportActionService } from "../../supabase/functions/_shared/jungsi/application/report_actions.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type { StoredReport } from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";
import { SyntheticNativeRepository } from "./synthetic_platform_repository.ts";
import { syntheticCatalog } from "./synthetic_catalog.ts";
import { assert, equal } from "./fixture.ts";
Deno.test("completed shortlist key rejects forbidden query before replay while normal replay stays stable", async () => {
  const f = fixture(),
    r = input("shortlist.update", { selected: false, expected_version: 1 }),
    first = await f.service.execute(r);
  const replays = f.repo.events.filter((e) => e === "replay").length;
  await denied(
    () => f.service.execute({ ...r, query: { unexpected: "SYNTHETIC" } }),
    "invalid_request",
    422,
  );
  equal(f.repo.events.filter((e) => e === "replay").length, replays);
  equal(f.repo.reports.get(RID)!.revision, 2);
  equal(await f.service.execute(r), first);
});
const OWNER = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002",
  THIRD = "00000000-0000-0000-0000-000000000003",
  NOW = 1700000000000000n;
const PID = "SYNTHETIC-profile",
  RID = "SYNTHETIC-report",
  OID = "SYNTHETIC-a",
  TIME = "2023-11-14T22:13:20Z";
function input(
  op: ApiOperationId,
  body: NativeObject = {},
  paid = true,
  key = "SYNTHETIC-key",
): ApiExecution {
  return {
    operation: op,
    session: {
      user: { subjectId: OWNER, expiresAtUtc: NOW + 1000000n },
      evaluatedAtUtc: NOW,
      tier: paid ? "paid" : "standard",
      paidUntilUtc: paid ? NOW + 500000n : null,
    },
    management: null,
    body,
    query: {},
    params: { report_id: RID, offering_id: OID },
    requestKey: key,
  };
}
function report(owner = OWNER, rid = RID, pid = PID, score = "10"): StoredReport {
  return {
    report_id: rid,
    owner_id: owner,
    profile_id: pid,
    revision: 1,
    updated_at: TIME,
    body: {
      overall: { total_standard_score: 26 },
      analyses: {
        [OID]: {
          status: "ready",
          category: "core",
          reason_code: null,
          converted_score: score,
          versions: { profile: pid, rule: "SYNTHETIC-rule.v1", curve: "SYNTHETIC-curve.v1" },
          private_source: "SYNTHETIC-PRIVATE",
        },
      },
      candidates: {
        basic_university_groups: [{ offerings: [{ offering: { offering_id: OID } }] }],
      },
      shortlist: { [OID]: { selected: true, profile_id: pid, assessment_status: "ready" } },
      catalog_version: "SYNTHETIC-catalog.v1",
      analysis_status: { status: "ready", reason_code: null },
    },
  };
}
function fixture() {
  const repo = new SyntheticNativeRepository();
  repo.profiles.set(PID, {
    profile_id: PID,
    owner_id: OWNER,
    scores: {},
    confirmed: true,
    created_at: TIME,
  });
  repo.reports.set(RID, report());
  let aggregateReads = 0;
  const original = repo.activeReports.bind(repo);
  repo.activeReports = async () => {
    aggregateReads++;
    return await original();
  };
  const clock = { nowUtc: () => NOW },
    catalog = new CatalogService({
      getCatalog() {
        return syncPromise(() => {
          return syntheticCatalog();
        });
      },
    }, clock);
  return {
    repo,
    service: new ReportActionService(repo, catalog, clock),
    clock,
    aggregateReads: () => aggregateReads,
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
Deno.test("shortlist false and no-op updates preserve immutable report revision semantics", async () => {
  const f = fixture(), before = f.repo.reports.get(RID)!;
  const changed = await f.service.execute(
    input("shortlist.update", { selected: false, expected_version: 1 }),
  );
  equal(changed.report_version, 2);
  equal(((changed.shortlist as NativeObject)[OID] as NativeObject).selected, false);
  equal(((before.body.shortlist as NativeObject)[OID] as NativeObject).selected, true);
  const unchanged = await f.service.execute(
    input("shortlist.update", { selected: false, expected_version: 2 }, true, "SYNTHETIC-noop"),
  );
  equal(unchanged.report_version, 2);
  equal(unchanged.updated_at, changed.updated_at);
});
Deno.test("shortlist replay reuses saved report and different selected value conflicts", async () => {
  const f = fixture(), r = input("shortlist.update", { selected: false, expected_version: 1 });
  const first = await f.service.execute(r);
  equal(await f.service.execute(r), first);
  await denied(
    () => f.service.execute({ ...r, body: { selected: true, expected_version: 1 } }),
    "idempotency_conflict",
    409,
  );
  equal(f.repo.reports.get(RID)!.revision, 2);
});
Deno.test("shortlist paid owner selected native type and revision guards preserve current data", async () => {
  const f = fixture();
  await denied(
    () =>
      f.service.execute(input("shortlist.update", { selected: true, expected_version: 1 }, false)),
    "paid_required",
    403,
  );
  await denied(
    () => f.service.execute(input("shortlist.update", { selected: "true", expected_version: 1 })),
    "invalid_selection",
    422,
  );
  await denied(
    () => f.service.execute(input("shortlist.update", { selected: true, expected_version: 2 })),
    "revision_conflict",
    409,
  );
  equal(f.repo.reports.get(RID)!.revision, 1);
  const r = input("shortlist.update", { selected: true, expected_version: 1 });
  await denied(
    () =>
      f.service.execute({
        ...r,
        session: { ...r.session, user: { ...r.session.user, subjectId: OTHER } },
      }),
    "report_not_found",
    404,
  );
});
Deno.test("shortlist cannot select a practical excluded offering", async () => {
  const f = fixture(), r = input("shortlist.update", { selected: true, expected_version: 1 });
  await denied(
    () => f.service.execute({ ...r, params: { ...r.params, offering_id: "SYNTHETIC-d" } }),
    "offering_not_found",
    404,
  );
  equal(f.repo.reports.get(RID)!.revision, 1);
  await groupLimitCase();
});
/** 같은 모집군 4개 한도: 다섯째 거절, 다른 군은 따로, 빼기는 언제나, 이전 초과분 유지. */
async function groupLimitCase() {
  const release = syntheticCatalog(), base = release.offerings[0];
  const ids = ["e", "f", "g", "h", "i"].map((x) => `SYNTHETIC-${x}`);
  const wide = {
    ...release,
    offerings: [
      ...release.offerings,
      ...ids.map((id) => ({ ...base, offering_id: id })),
    ],
  };
  const repo = new SyntheticNativeRepository(), clock = { nowUtc: () => NOW };
  repo.profiles.set(PID, {
    profile_id: PID,
    owner_id: OWNER,
    scores: {},
    confirmed: true,
    created_at: TIME,
  });
  const stored = report();
  const row = (selected: boolean) => ({
    selected,
    profile_id: PID,
    assessment_status: "ready",
  });
  stored.body.shortlist = {
    [OID]: row(false),
    ...Object.fromEntries(ids.map((id) => [id, row(true)])),
  };
  repo.reports.set(RID, stored);
  const service = new ReportActionService(
    repo,
    new CatalogService({ getCatalog: () => syncPromise(() => wide) }, clock),
    clock,
  );
  const call = (
    oid: string,
    selected: boolean,
    version: number,
    key: string,
  ) => {
    const r = input(
      "shortlist.update",
      { selected, expected_version: version },
      true,
      key,
    );
    return service.execute({ ...r, params: { ...r.params, offering_id: oid } });
  };
  // 한도 전에 다섯 개가 담겨 있어도 그대로 읽히고, 같은 군에 새로 담는 것만 막힌다
  await denied(
    () => call(OID, true, 1, "SYNTHETIC-limit-1"),
    "shortlist_limit_exceeded",
    409,
  );
  equal(repo.reports.get(RID)!.revision, 1);
  // 다른 군은 따로 센다
  equal(
    (await call("SYNTHETIC-b", true, 1, "SYNTHETIC-limit-2")).report_version,
    2,
  );
  // 빼기는 언제나 되고, 하나 뺀 뒤에도 넷이 남아 있으면 아직 못 담는다
  equal((await call(ids[0], false, 2, "SYNTHETIC-limit-3")).report_version, 3);
  await denied(
    () => call(OID, true, 3, "SYNTHETIC-limit-4"),
    "shortlist_limit_exceeded",
    409,
  );
  equal((await call(ids[1], false, 3, "SYNTHETIC-limit-5")).report_version, 4);
  const done = await call(OID, true, 4, "SYNTHETIC-limit-6");
  equal(done.report_version, 5);
  equal(((done.shortlist as NativeObject)[OID] as NativeObject).selected, true);
  // 이미 담긴 것을 다시 담는 요청은 한도와 무관하게 그대로다
  equal((await call(ids[2], true, 5, "SYNTHETIC-limit-7")).report_version, 5);
  // 운영 카탈로그처럼 전국 목록 없이 요청한 모집단위만 내주는 경우에도 이미 담긴 것의 군을 조회해 센다
  class PagedCatalog extends CatalogService {
    lookups = 0;
    constructor() {
      super({ getCatalog: () => syncPromise(() => ({ ...wide, offerings: [] })) }, clock);
    }
    override offering(_release: unknown, id: unknown): NativeObject {
      const row = wide.offerings.find((r) => r.offering_id === id);
      if (!row) throw new AccessError("offering_not_found", 404);
      return row;
    }
    override selectedOfferings(_owner: string, _year: number, wanted: readonly string[]) {
      this.lookups++;
      return Promise.resolve(
        new Map(
          wide.offerings.filter((r) => wanted.includes(r.offering_id as string)).map((r) =>
            [r.offering_id as string, r] as [string, NativeObject]
          ),
        ),
      );
    }
  }
  const pagedRepo = new SyntheticNativeRepository(), paged = new PagedCatalog();
  pagedRepo.profiles.set(PID, {
    profile_id: PID,
    owner_id: OWNER,
    scores: {},
    confirmed: true,
    created_at: TIME,
  });
  const full = report();
  full.body.shortlist = {
    [OID]: row(false),
    "SYNTHETIC-gone": row(true),
    ...Object.fromEntries(ids.slice(0, 4).map((id) => [id, row(true)])),
  };
  pagedRepo.reports.set(RID, full);
  const pagedService = new ReportActionService(pagedRepo, paged, clock);
  const pagedCall = (oid: string, selected: boolean, version: number, key: string) => {
    const r = input("shortlist.update", { selected, expected_version: version }, true, key);
    return pagedService.execute({ ...r, params: { ...r.params, offering_id: oid } });
  };
  await denied(
    () => pagedCall(OID, true, 1, "SYNTHETIC-paged-1"),
    "shortlist_limit_exceeded",
    409,
  );
  assert(paged.lookups > 0);
  equal((await pagedCall("SYNTHETIC-b", true, 1, "SYNTHETIC-paged-2")).report_version, 2);
  equal((await pagedCall(ids[0], false, 2, "SYNTHETIC-paged-3")).report_version, 3);
  equal((await pagedCall(OID, true, 3, "SYNTHETIC-paged-4")).report_version, 4);
}

Deno.test("shortlist without catalog is a pending dependency and does not update report", async () => {
  const f = fixture(),
    catalog = new CatalogService({
      getCatalog() {
        return syncPromise(() => {
          return null;
        });
      },
    }, f.clock),
    service = new ReportActionService(f.repo, catalog, f.clock);
  await denied(
    () => service.execute(input("shortlist.update", { selected: false, expected_version: 1 })),
    "catalog_release_missing",
    503,
  );
  equal(f.repo.reports.get(RID)!.revision, 1);
});
Deno.test("statistics compares exact scores and emits competition ties without owner identifiers", async () => {
  const f = fixture();
  f.repo.reports.set(
    "SYNTHETIC-other",
    report(OTHER, "SYNTHETIC-other", "SYNTHETIC-profile-other", "12"),
  );
  f.repo.reports.set(
    "SYNTHETIC-third",
    report(THIRD, "SYNTHETIC-third", "SYNTHETIC-profile-third", "20/2"),
  );
  const r = await f.service.execute(input("statistics.read"));
  equal(r.status, "ready");
  equal(r.recommended_count, 3);
  equal(r.selected_count, 3);
  equal(r.recommended_rank, {
    rank: 2,
    tie_count: 2,
    population_count: 3,
    tie_policy: "competition",
  });
  equal(r.selected_rank, r.recommended_rank);
  equal(r.scope, "service_users_not_actual_university_applicants");
  const text = JSON.stringify(r);
  assert(
    !text.includes(OWNER) && !text.includes(OTHER) && !text.includes(THIRD) &&
      !text.includes("SYNTHETIC-PRIVATE"),
  );
  assert(!Object.hasOwn(r.versions as NativeObject, "profile"));
});
Deno.test("statistics version and current selection scope do not merge incompatible analyses", async () => {
  const f = fixture(), other = report(OTHER, "SYNTHETIC-other", "SYNTHETIC-profile-other", "12");
  ((other.body.analyses as NativeObject)[OID] as NativeObject).versions = {
    profile: "other",
    rule: "SYNTHETIC-different",
    curve: "SYNTHETIC-curve.v1",
  };
  f.repo.reports.set(other.report_id, other);
  const own = f.repo.reports.get(RID)!;
  ((own.body.shortlist as NativeObject)[OID] as NativeObject).profile_id =
    "SYNTHETIC-stale-profile";
  const r = await f.service.execute(input("statistics.read"));
  equal(r.recommended_count, 1);
  equal(r.selected_count, 0);
  equal(r.selected_rank, null);
});
Deno.test("statistics uses one latest report per student and retains chronological microseconds", async () => {
  const f = fixture(),
    early = report(OTHER, "SYNTHETIC-a-old", "SYNTHETIC-p-old", "30"),
    late = report(OTHER, "SYNTHETIC-z-new", "SYNTHETIC-p-new", "9");
  f.repo.reports.set(early.report_id, { ...early, updated_at: "2023-11-14T22:13:20.000001Z" });
  f.repo.reports.set(late.report_id, { ...late, updated_at: "2023-11-14T22:13:20.000002Z" });
  const r = await f.service.execute(input("statistics.read"));
  equal(r.recommended_count, 2);
  equal(r.recommended_rank, {
    rank: 1,
    tie_count: 1,
    population_count: 2,
    tie_policy: "competition",
  });
});
Deno.test("statistics pending own assessment preserves null counts and skips other student reads", async () => {
  const f = fixture(), r = f.repo.reports.get(RID)!;
  r.body.analyses = {};
  const out = await f.service.execute(input("statistics.read"));
  equal(out.status, "pending");
  equal(out.recommended_count, null);
  equal(out.selected_count, null);
  equal(f.aggregateReads(), 0);
});
Deno.test("statistics needs confirmed score profile before aggregate access", async () => {
  const f = fixture(), p = f.repo.profiles.get(PID)!;
  f.repo.profiles.set(PID, { ...p, confirmed: false });
  await denied(
    () => f.service.execute(input("statistics.read")),
    "score_confirmation_required",
    409,
  );
  equal(f.aggregateReads(), 0);
});
