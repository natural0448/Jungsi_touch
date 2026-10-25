import { assert, equal } from "./fixture.ts";
import { memberFixture, OTHER, OWNER, rejects, request } from "./member_shortlist_fixture.ts";
const put = () =>
  request("member-shortlist.update", {
    selected: true,
    expected_revision: 0,
    expected_legacy_source: { report_id: "SYNTHETIC-report", report_version: 1 },
  });
Deno.test("member JSON concrete adapter uses create-only objects and small SQL refs", async () => {
  const f = memberFixture();
  await f.service.execute(put());
  for (const v of f.records.values()) {
    assert(v.result.length < 1024);
    assert(!v.result.includes("analyses"));
    assert(!v.result.includes("selected"));
  }
  assert([...f.objects.keys()][0].includes("/0000000000000001/"));
});
Deno.test("member JSON published missing object is an error rather than empty list", async () => {
  const f = memberFixture();
  await f.service.execute(put());
  f.setStatus(404);
  await rejects(() => f.service.execute(request()), "storage_unavailable");
});
Deno.test("member JSON 403 never falls back to legacy or triggers another write", async () => {
  const f = memberFixture();
  await f.service.execute(put());
  f.setStatus(403);
  const writes = f.counts.put, legacy = f.counts.legacy;
  await rejects(() => f.service.execute(request()), "storage_unavailable");
  equal(f.counts.put, writes);
  equal(f.counts.legacy, legacy);
});
Deno.test("member JSON 5xx remains a dependency failure", async () => {
  const f = memberFixture();
  await f.service.execute(put());
  f.setStatus(503);
  await rejects(() => f.repository.read(OWNER, 2027), "storage_unavailable");
});
Deno.test("member JSON byte tampering fails exact length or SHA", async () => {
  const f = memberFixture();
  await f.service.execute(put());
  f.setCorrupt(true);
  await rejects(() => f.repository.read(OWNER, 2027), "storage_result_invalid");
});
Deno.test("member JSON client namespace and revision injection are rejected before HTTP", async () => {
  const f = memberFixture(),
    ref = {
      object_key: `jungsi-api/member-json/${OTHER}/2027/shortlist/0000000000000001/${
        "a".repeat(64)
      }.json`,
      sha256: "a".repeat(64),
      bytes: 10,
      revision: 1,
    };
  await rejects(() => f.storage.read(OWNER, 2027, ref), "storage_result_invalid");
  equal(f.counts.get, 0);
});
Deno.test("member JSON write-before-publication crash preserves orphan and recovers once", async () => {
  const f = memberFixture();
  f.afterPut(() => {
    throw new Error("synthetic response lost");
  });
  await rejects(() => f.service.execute(put()), "storage_unavailable");
  equal(f.records.size, 0);
  equal(f.objects.size, 1);
  const v = await f.service.execute(put());
  equal(v.revision, 1);
  equal(f.objects.size, 1);
  equal(f.records.size, 2);
});
Deno.test("member JSON another owner cannot discover the current publication", async () => {
  const f = memberFixture();
  await f.service.execute(put());
  const r = await f.repository.read(OTHER, 2027);
  equal(r, null);
  equal(await f.repository.read(OWNER, 2028), null);
});
