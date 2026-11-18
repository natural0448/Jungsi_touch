import { CurrentPublicCatalogService } from "../../supabase/functions/_shared/current_public_catalog.ts";
import type { CurrentPublicCatalogPort, PublicCatalogCursorPort, PublicCatalogPage } from "../../supabase/functions/_shared/current_public_catalog.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

const now = 1760000000000000n;
const subject = "00000000-0000-4000-8000-000000000001";
const clock = { nowUtc: () => now };
function ok(x: unknown, label = "assertion_failed"): asserts x { if (!x) throw new Error(label); }
async function rejects(work: () => Promise<unknown>, code: string) {
  try { await work(); } catch (e) { if (e instanceof AccessError && e.code === code) return; throw e; }
  throw new Error("expected_" + code);
}
function fixture(options: { unqualified?: boolean; changedPublication?: boolean } = {}) {
  let publicationCount = 0;
  const observed: { subject?: string; year?: number; pks?: readonly string[]; checks: number } = { checks: 0 };
  const guard = { signal: new AbortController().signal, maxBytes: 16384,
    assertActive() { observed.checks++; }, settle(_: number) {} };
  const row: NativeObject = { academic_year: 2027, school_id: "school1", offering_pk: "abc",
    offering_id: "2027:abc", university_code: "UNI1", university: "가상대",
    department: "합성학과", track: "합성전형", recruit_group: "가",
    active_service: true, practical_required: false, source_kind: "current_guide" };
  const guide: NativeObject = { campus: null, location: null, wildcard_group: null,
    active_service: true, practical_required: false,
    metadata: { practical_required: false,
      participation_conditions_status: options.unqualified ? "unknown" : "verified" } };
  const page: PublicCatalogPage = { version: "approved-catalog", head: "b".repeat(64), asOfUtc: now,
    rows: [{ key: [2027, "school1", "abc", "", "2027:abc"], row, guide }], nextAfter: null };
  const port = {
    publication: async () => { publicationCount++;
      return { version: "approved-catalog", sha256: options.changedPublication && publicationCount > 1 ?
        "c".repeat(64) : "a".repeat(64), expiresAtUtc: now + 1000000n }; },
    lookupSavedGuide: async (s: string, y: number, p: readonly string[]) => {
      observed.subject = s; observed.year = y; observed.pks = p; return page;
    },
  } as unknown as CurrentPublicCatalogPort;
  const service = new CurrentPublicCatalogService({ getCatalog: async () => null }, port, clock,
    {} as PublicCatalogCursorPort);
  return { service, guard, observed };
}
Deno.test("4P guide: original year and PK are bound to the authenticated subject", async () => {
  const f = fixture();
  const out = await f.service.selectedSavedGuideOfferings(subject, 2027, ["2027:abc", "2026:else"], f.guard);
  ok(f.observed.subject === subject && f.observed.year === 2027 && f.observed.pks?.join() === "abc");
  ok(out.rows.get("2027:abc")?.university_id === "UNI1");
  ok(out.version === "current:" + "b".repeat(40) && f.observed.checks > 0);
});
Deno.test("4P guide: unverified eligibility stays out of result", async () => {
  const f = fixture({ unqualified: true });
  const out = await f.service.selectedSavedGuideOfferings(subject, 2027, ["2027:abc"], f.guard);
  ok(out.rows.size === 0);
});
Deno.test("4P guide: changed publication during lookup is rejected", async () => {
  const f = fixture({ changedPublication: true });
  await rejects(() => f.service.selectedSavedGuideOfferings(subject, 2027, ["2027:abc"], f.guard),
    "current_catalog_state_unapproved");
});
Deno.test("4P guide: duplicate IDs and requests over 100 are rejected", async () => {
  const f = fixture();
  await rejects(() => f.service.selectedSavedGuideOfferings(subject, 2027, ["2027:abc", "2027:abc"], f.guard),
    "current_catalog_page_invalid");
  await rejects(() => f.service.selectedSavedGuideOfferings(subject, 2027,
    Array.from({ length: 101 }, (_, i) => "2027:x" + i), f.guard), "current_catalog_page_invalid");
});