/** Synthetic values; existing descriptor verifier and service, no operating IO. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcInstant, utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { safeFailure } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import {
  comparePublicCatalogKeys,
  CURRENT_PUBLIC_OPERATIONS,
  CurrentPublicCatalogCursor,
  type CurrentPublicCatalogPort,
  CurrentPublicCatalogService,
  type PublicCatalogRecord,
} from "../../supabase/functions/_shared/current_public_catalog.ts";
import {
  CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS,
  CURRENT_PUBLIC_SOURCE_VIEWS,
  verifyPublicCatalogDescriptor,
} from "../../supabase/functions/_shared/current_public_catalog_sql.ts";
import { publicKeyRawHash } from "../../supabase/functions/_shared/current_public_key_index.ts";
import {
  CurrentPublicBoundCursor,
  executeWithExistingCatalogTrust,
} from "../../supabase/functions/_shared/current_public_bound_cursor.ts";

const NOW = utcInstant("2026-10-19T00:00:00Z");
const SECRET = new Uint8Array(32).fill(7), H = (c: string) => c.repeat(64);
const SUBJECT = "00000000-0000-0000-0000-000000000001";
function assert(value: unknown): asserts value {
  if (!value) throw new Error("assertion_failed");
}
function equal(a: unknown, b: unknown): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("not_equal");
}
async function denied(work: () => Promise<unknown>, code: string, http: number): Promise<void> {
  try {
    await work();
  } catch (error) {
    assert(error instanceof AccessError);
    equal([error.code, error.http], [code, http]);
    return;
  }
  throw new Error("expected_denial");
}
function row(n: number): PublicCatalogRecord {
  const pk = `SYN-PK-${n}`;
  const item: NativeObject = {
    academic_year: 2027,
    school_id: "SYN-SCHOOL",
    offering_pk: pk,
    offering_id: `2027:${pk}`,
    university: "Synthetic University",
    department: "Synthetic Department",
    track: null,
    recruit_group: "가",
    source_kind: "current_guide",
    active_service: true,
    practical_required: false,
    quota_value: n === 1 ? null : 0,
  };
  return {
    key: [2027, "SYN-SCHOOL", pk, "", `2027:${pk}`],
    row: item,
    guide: { campus: null, location: null, wildcard_group: null, active_service: true },
  };
}
function request(q: Record<string, string>, subject = SUBJECT, paid = true): ApiExecution {
  return {
    operation: "offerings.search",
    session: {
      user: { subjectId: subject, expiresAtUtc: NOW + 100_000_000n },
      evaluatedAtUtc: NOW,
      tier: paid ? "paid" : "standard",
      paidUntilUtc: paid ? NOW + 100_000_000n : null,
    },
    management: null,
    body: {},
    query: { academic_year: "2027", ...q },
    params: {},
    requestKey: null,
  };
}
function fixture() {
  const d = {
    format: "jungsi.current-public-catalog-publication/v2",
    version: "SYN-V1",
    issued_at: "2026-10-01T00:00:00Z",
    expires_at: utcText(NOW + 10_000_000n),
    approval_reference_sha256: H("1"),
    consumer_binding_sha256: H("2"),
    metadata_sha256: H("3"),
    operations: [...CURRENT_PUBLIC_OPERATIONS],
    source_views: { ...CURRENT_PUBLIC_SOURCE_VIEWS },
    general_publication_allowed: true,
    nationwide_current: true,
    active_service_only: true,
    incomplete_metadata: "hold_per_observation",
    order: "academic_year_school_offering_metric_canonical_C",
    counts: "unknown",
    engine_activation: false,
    max_page_rows: 101,
    guide_command_state: Object.fromEntries(
      CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((name) => [name, { count: 0, sha256: H("4") }]),
    ),
    key_index: { object_key: "synthetic/index.json", bytes: 10, sha256: H("5") },
    coverage_receipt_sha256: H("6"),
    admission_head: { command_id: "SYN-HEAD", payload_sha256: H("7") },
  };
  const state = {
    now: NOW,
    head: H("8"),
    runtimeHash: H("2"),
    runtimeScope: H("9"),
    runtimeExpires: NOW + 30_000_000n,
    searches: 0,
    onSearch: null as (() => void) | null,
  };
  const clock = { nowUtc: () => state.now };
  const verified = async () => {
    const bytes = new TextEncoder().encode(nativeJsonText(d, true));
    return await verifyPublicCatalogDescriptor(bytes, await publicKeyRawHash(bytes), clock);
  };
  const existing = async () => ({
    ...await verified(),
    runtime: {
      descriptorSha256: state.runtimeHash,
      scopeSha256: state.runtimeScope,
      expiresAtUtc: state.runtimeExpires,
    },
  });
  const rows = [row(1), row(2), row(3)];
  const current: CurrentPublicCatalogPort = {
    publication: async () => (await verified()).publication,
    search: async (_subject, _kind, q, after) => {
      await Promise.resolve();
      state.searches++;
      state.onSearch?.();
      return {
        version: d.version,
        head: state.head,
        asOfUtc: state.now,
        rows: rows.filter((r) => !after || comparePublicCatalogKeys(r.key, after) > 0).slice(
          0,
          q.limit + 1,
        ),
      };
    },
    lookup: () => Promise.reject(new Error("unexpected_lookup")),
  };
  const data = { getCatalog: () => Promise.resolve(null) };
  const run = async (
    q: Record<string, string>,
    options?: { subject?: string; paid?: boolean; secret?: Uint8Array; legacy?: boolean },
  ) => {
    const req = request(q, options?.subject, options?.paid);
    if (options?.legacy) {
      return await new CurrentPublicCatalogService(
        data,
        current,
        clock,
        new CurrentPublicCatalogCursor(options.secret ?? SECRET),
      ).execute(req);
    }
    return await executeWithExistingCatalogTrust({
      request: req,
      data,
      current,
      clock,
      secret: options?.secret ?? SECRET,
      existing,
    });
  };
  const first = async (legacy = false) => {
    const result = await run({ limit: "1" }, { legacy });
    assert(typeof result.next_cursor === "string");
    return result.next_cursor;
  };
  const reissue = () => {
    d.version = "SYN-V2";
    d.issued_at = "2026-10-02T00:00:00Z";
  };
  return { d, state, run, first, reissue, existing, clock };
}
function ids(value: NativeObject): unknown[] {
  return (value.items as NativeObject[]).map((v) => v.offering_id);
}

Deno.test("same descriptor and query advance without a new authority", async () => {
  const f = fixture(), token = await f.first();
  const page = await f.run({ limit: "2", cursor: token });
  equal(ids(page), ["2027:SYN-PK-2", "2027:SYN-PK-3"]);
  equal(page.next_cursor, null);
});
Deno.test("only descriptive descriptor reissue continues V2, while V1 retains its old 409", async () => {
  const f = fixture(), old = await f.first(true), token = await f.first();
  f.reissue();
  await denied(() => f.run({ cursor: old }), "cursor_version_mismatch", 409);
  const page = await f.run({ limit: "1", cursor: token });
  equal(ids(page), ["2027:SYN-PK-2"]);
  assert(typeof page.next_cursor === "string");
  const third = await f.run({ limit: "1", cursor: page.next_cursor });
  equal(ids(third), ["2027:SYN-PK-3"]);
  equal(third.next_cursor, null);
});
Deno.test("semantic index, approval and runtime scope changes fail closed", async () => {
  for (const kind of ["index", "approval", "runtimeScope"] as const) {
    const f = fixture(), token = await f.first();
    if (kind === "index") f.d.key_index.sha256 = H("a");
    if (kind === "approval") f.d.approval_reference_sha256 = H("a");
    if (kind === "runtimeScope") f.state.runtimeScope = H("a");
    await denied(() => f.run({ cursor: token }), "cursor_version_mismatch", 409);
    equal(f.state.searches, 1);
  }
});
Deno.test("changed query or head rejects the page", async () => {
  const f = fixture(), token = await f.first();
  await denied(() => f.run({ cursor: token, group: "가" }), "cursor_version_mismatch", 409);
  f.state.head = H("a");
  await denied(() => f.run({ cursor: token }), "cursor_version_mismatch", 409);
});
Deno.test("runtime binding mismatch and expired runtime authorization fail closed", async () => {
  const f = fixture(), token = await f.first();
  f.state.runtimeHash = H("a");
  await denied(() => f.run({ cursor: token }), "security_policy_unavailable", 503);
  const g = fixture(), other = await g.first();
  g.state.runtimeExpires = NOW;
  await denied(() => g.run({ cursor: other }), "security_policy_unavailable", 503);
});
Deno.test("subject, paid access, expiry, truncation, and key rotation remain enforced", async () => {
  const f = fixture(), token = await f.first();
  await denied(() => f.run({ cursor: token }, { subject: "SYN-OTHER" }), "invalid_cursor", 400);
  await denied(() => f.run({ cursor: token }, { paid: false }), "paid_required", 403);
  await denied(() => f.run({ cursor: token.slice(0, -2) }), "invalid_cursor", 400);
  await denied(
    () => f.run({ cursor: token }, { secret: new Uint8Array(32).fill(8) }),
    "invalid_cursor",
    400,
  );
  f.state.now = NOW + 10_000_000n;
  await denied(() => f.run({ cursor: token }), "current_catalog_publication_unapproved", 503);
});
Deno.test("safe HTTP failure projection retains cursor 409 and 400", async () => {
  for (
    const [code, status] of [["cursor_version_mismatch", 409], ["invalid_cursor", 400]] as const
  ) {
    const response = safeFailure(new AccessError(code, status), "SYN-REQUEST");
    equal(response.status, status);
    const body = await response.json();
    equal(body.error.code, code);
  }
});

Deno.test("expiry extension never extends the original cursor lifetime", async () => {
  const f = fixture(), token = await f.first();
  f.d.expires_at = utcText(NOW + 20_000_000n);
  const page = await f.run({ limit: "1", cursor: token });
  assert(typeof page.next_cursor === "string");
  f.state.now = NOW + 10_000_000n;
  await denied(() => f.run({ cursor: page.next_cursor as string }), "invalid_cursor", 400);
});
Deno.test("a shorter descriptor expiry caps all subsequent continuation", async () => {
  const f = fixture(), token = await f.first();
  f.d.expires_at = utcText(NOW + 5_000_000n);
  const page = await f.run({ limit: "1", cursor: token });
  assert(typeof page.next_cursor === "string");
  f.d.expires_at = utcText(NOW + 20_000_000n);
  f.state.now = NOW + 5_000_000n;
  await denied(() => f.run({ cursor: page.next_cursor as string }), "invalid_cursor", 400);
});
Deno.test("descriptor replacement within the current page cannot mix states", async () => {
  const f = fixture(), token = await f.first();
  f.state.onSearch = () => f.reissue();
  await denied(() => f.run({ cursor: token }), "current_catalog_page_invalid", 503);
});
Deno.test("V2 preserves a long valid cursor without truncation", async () => {
  const f = fixture();
  const trust = await f.existing();
  const cursor = new CurrentPublicBoundCursor(SECRET, f.existing, f.clock);
  const binding = {
    subject: SUBJECT,
    operation: "offerings" as const,
    query: H("a"),
    publication: trust.publication.sha256,
    expires: trust.publication.expiresAtUtc.toString(),
  };
  const key: [number, string, string, string, string] = [
    2027,
    "x".repeat(256),
    "x".repeat(256),
    "x".repeat(256),
    "x".repeat(256),
  ];
  const token = await cursor.seal(binding, H("8"), key);
  assert(token.length > 1600 && token.length < 4096);
  const opened = await cursor.open(token, binding, NOW);
  equal(opened.after, key);
});

Deno.test("expiration during the last page discards its result", async () => {
  const f = fixture();
  const first = await f.run({ limit: "2" });
  assert(typeof first.next_cursor === "string");
  f.d.expires_at = utcText(NOW + 20_000_000n);
  f.state.onSearch = () => {
    f.state.now = NOW + 10_000_000n;
  };
  await denied(
    () => f.run({ limit: "2", cursor: first.next_cursor as string }),
    "invalid_cursor",
    400,
  );
});

Deno.test("unknown and zero synthetic quotas do not remove approved recruitment rows", async () => {
  const f = fixture();
  const result = await f.run({ limit: "3" });
  equal(ids(result), ["2027:SYN-PK-1", "2027:SYN-PK-2", "2027:SYN-PK-3"]);
});
Deno.test("revoked descriptor authorization fails the existing verifier", async () => {
  const f = fixture(), token = await f.first();
  f.d.active_service_only = false;
  await denied(() => f.run({ cursor: token }), "current_catalog_publication_unapproved", 503);
});
Deno.test("descriptor version labels remain the existing public response values", async () => {
  const f = fixture();
  const first = await f.run({ limit: "1" });
  assert(typeof first.next_cursor === "string");
  f.reissue();
  const second = await f.run({ limit: "1", cursor: first.next_cursor });
  equal([first.catalog_version, second.catalog_version], ["SYN-V1", "SYN-V2"]);
});
