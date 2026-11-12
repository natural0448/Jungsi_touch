/** Offline synthetic integration. No real data, keys, DB, Storage or publisher. */
const test = Deno.test;
import assert from "node:assert/strict";
import {
  buildLimits,
  encode,
  fixture,
  grant,
  H,
  hash,
  historical,
  sourceRow,
  target,
} from "./fixture.bridge.v2.synthetic.mjs";
import { nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { CurrentPublicR27BoundedService } from "../../supabase/functions/_shared/current_public_r27_bounded.ts";
import { composeSelectedP1R27Candidate } from "../../supabase/functions/_shared/p1_r27_selection_bridge.ts";

const USER = "00000000-0000-0000-0000-000000000001";
const CAT = "8".repeat(64), HEAD = "9".repeat(64);
function makeRows(n, changes = () => ({})) {
  return Array.from(
    { length: n },
    (_, i) => sourceRow({ original_pk: "SYN-" + String(i).padStart(4, "0"), ...changes(i) }),
  );
}
async function setup(rows, options = {}) {
  const previous = historical(),
    f = await fixture(rows, [[previous]], {
      links: rows.length ? [grant(rows[0], target(previous))] : [],
    });
  if (options.fragment) {
    const pages = [];
    for (let i = 0; i < rows.length; i += options.fragment) {
      pages.push(
        encode({
          format: "jungsi.r27-source-page/v1",
          source_sha256: f.pins.source_sha256,
          source_head_sha256: f.pins.source_head_sha256,
          index: pages.length,
          rows: rows.slice(i, i + options.fragment),
        }),
      );
    }
    const pagePins = [];
    for (let i = 0; i < pages.length; i++) {
      pagePins.push({
        sha256: await hash(pages[i]),
        bytes: pages[i].length,
        rows: Math.min(options.fragment, rows.length - i * options.fragment),
      });
    }
    f.pageBytes = pages;
    f.source.pages = pages;
    f.manifestBytes = encode({
      format: "jungsi.r27-page-manifest/v1",
      source_sha256: f.pins.source_sha256,
      source_head_sha256: f.pins.source_head_sha256,
      coverage_sha256: f.pins.coverage_sha256,
      previous_publication_sha256: f.pins.previous_publication_sha256,
      previous_source_head_sha256: f.pins.previous_source_head_sha256,
      scope_sha256: f.pins.scope_sha256,
      expected_rows: rows.length,
      pages: pagePins,
    });
    f.pins = { ...f.pins, manifest_sha256: await hash(f.manifestBytes) };
  }
  const request = {
    operation: "recruitment.read",
    session: {
      user: { subjectId: USER, expiresAtUtc: 900n },
      evaluatedAtUtc: 50n,
      tier: "standard",
      paidUntilUtc: null,
    },
    management: null,
    body: {},
    query: {},
    params: {},
    requestKey: null,
  };
  const controller = new AbortController();
  const boundary = { signal: controller.signal, admission: Object.freeze({ synthetic: true }) };
  const byId = new Map(rows.map((r) => ["2027:" + r.original_pk, r]));
  const calls = {
    lookups: [],
    pages: [],
    scopes: [],
    pins: 0,
    live: 0,
    selectionCurrent: 0,
    sourceBatches: 0,
    sourceAuthorizations: 0,
    wholeScopes: [],
  };
  const publication = { version: "SYN-CATALOG", sha256: CAT, expiresAtUtc: 1000n };
  const current = {
    async publication() {
      await Promise.resolve();
      return publication;
    },
    async search() {
      await Promise.resolve();
      throw Error("unexpected_search");
    },
    async lookup(subject, ids, recruitment) {
      await Promise.resolve();
      assert.equal(subject, USER);
      assert.equal(recruitment, true);
      calls.lookups.push([...ids]);
      return {
        version: "SYN-CATALOG",
        head: options.wrongSelectionHead ? "7".repeat(64) : HEAD,
        asOfUtc: 80n,
        rows: [...ids].sort().map((id) => {
          const r = byId.get(id), pk = r.original_pk;
          const base = {
            academic_year: 2027,
            school_id: r.school_id,
            offering_pk: pk,
            offering_id: id,
            active_service: true,
            practical_required: false,
          };
          const guide = { ...base, recruitment_link_status: "verified", metadata: {} };
          if (Object.hasOwn(r, "quota_value") && !options.omitQuota) {
            guide.quota_value = r.quota_value;
          }
          if (Object.hasOwn(r, "quota_literal_state")) {
            guide.quota_literal_state = r.quota_literal_state;
          }
          if (Object.hasOwn(r, "quota_stage")) guide.metadata.quota_stage = r.quota_stage;
          return {
            key: [2027, r.school_id, pk, "", id],
            row: { ...base, source_kind: "current_guide" },
            guide,
          };
        }),
      };
    },
  };
  const wholeGuard = {
    async bind(_request, _boundary, scope) {
      await Promise.resolve();
      calls.wholeScopes.push(scope.length);
      return { subject_id: USER, publication_sha256: CAT, head_sha256: HEAD };
    },
  };
  const chunkGuard = {
    async bind() {
      await Promise.resolve();
      return { subject_id: USER, publication_sha256: CAT, head_sha256: HEAD };
    },
  };
  const selector = new CurrentPublicR27BoundedService(
    current,
    { nowUtc: () => 100n },
    wholeGuard,
    chunkGuard,
  );
  const sourceBatch = {
    async readPages(pages, pins, gate) {
      await Promise.resolve();
      calls.sourceBatches++;
      assert.equal(calls.sourceAuthorizations, 1);
      assert.equal(pins.source_head_sha256, H);
      assert.equal(gate.signal, boundary.signal);
      assert.equal(gate.admission, boundary.admission);
      assert.equal(gate.request, request);
      return pages.map((p) => f.source.pages[p.index]);
    },
    async assertSourceHead(head, gate) {
      await Promise.resolve();
      assert.equal(gate.admission, boundary.admission);
      return f.source.assertSourceHead(head);
    },
  };
  const baseline = {
    async readPinnedBatch(query, gate) {
      assert.equal(gate.request, request);
      assert.equal(gate.boundary, boundary);
      assert.equal(gate.signal, boundary.signal);
      assert.equal(gate.admission, boundary.admission);
      const result = await f.previous.readPinnedBatch(query);
      if (options.changeAdmissionDuringBaseline) boundary.admission = { synthetic: "changed" };
      if (options.abortDuringBaseline) controller.abort();
      return result;
    },
    async assertCurrent(query, gate) {
      assert.equal(gate.request, request);
      assert.equal(gate.signal, boundary.signal);
      assert.equal(gate.admission, boundary.admission);
      return await f.previous.assertCurrent(query);
    },
  };
  const issuer = {
    async assertPins(p, gate) {
      await Promise.resolve();
      assert.equal(gate.signal, boundary.signal);
      assert.equal(gate.admission, boundary.admission);
      assert.equal(p.source_head_sha256, H);
      calls.pins++;
      if (options.badPins) throw Error("SYN_PIN_REJECTED");
    },
    async assertSourcePages(requested, pins, gate) {
      await Promise.resolve();
      calls.sourceAuthorizations++;
      const manifest = JSON.parse(new TextDecoder().decode(f.manifestBytes));
      const expectedPages = manifest.pages.map((page, index) => ({
        index,
        sha256: page.sha256,
        bytes: page.bytes,
        rows: page.rows,
      }));
      assert.equal(
        requested.manifest_sha256,
        options.rejectAuthorizationField === "manifest" ? "0".repeat(64) : f.pins.manifest_sha256,
      );
      assert.equal(requested.source_sha256, f.pins.source_sha256);
      assert.equal(
        requested.source_head_sha256,
        options.rejectAuthorizationField === "head" ? "0".repeat(64) : f.pins.source_head_sha256,
      );
      assert.equal(
        requested.scope_sha256,
        options.rejectAuthorizationField === "scope" ? "0".repeat(64) : f.pins.scope_sha256,
      );
      assert.equal(requested.previous_publication_sha256, f.pins.previous_publication_sha256);
      assert.equal(requested.previous_source_head_sha256, f.pins.previous_source_head_sha256);
      assert.equal(
        requested.subject_id,
        options.rejectAuthorizationField === "subject" ? "SYN-OTHER" : USER,
      );
      assert.equal(requested.page_count, expectedPages.length);
      assert.equal(requested.expected_rows, rows.length);
      assert.equal(requested.declared_bytes, expectedPages.reduce((n, p) => n + p.bytes, 0));
      assert.deepEqual(
        requested.pages,
        options.rejectAuthorizationField === "pages" ? [] : expectedPages,
      );
      assert.equal(pins.manifest_sha256, requested.manifest_sha256);
      assert.equal(gate.request, request);
      assert.equal(gate.boundary, boundary);
      assert.equal(gate.admission, boundary.admission);
      assert.equal(gate.signal, boundary.signal);
      if (options.denySourceAuthorization) throw Error("SYN_SOURCE_UNAUTHORIZED");
      if (options.falseSourceAuthorization) return false;
    },
    async assertScope(scope, gate) {
      assert.equal(gate.signal, boundary.signal);
      assert.equal(gate.admission, boundary.admission);
      assert.equal(scope.rows, rows.length);
      assert.equal(
        scope.ordered_keys_sha256,
        await nativeJsonSha256(rows.map((r) => ({
          academic_year: 2027,
          school_id: r.school_id,
          offering_pk: r.original_pk,
        }))),
      );
      calls.scopes.push(scope);
      if (options.badScope) throw Error("SYN_SCOPE_REJECTED");
    },
    async assertBatch(subjects, selectionHead, publicationSha, pins, gate) {
      await Promise.resolve();
      assert.equal(gate.signal, boundary.signal);
      assert.equal(gate.admission, boundary.admission);
      assert.equal(selectionHead, HEAD);
      assert.equal(publicationSha, CAT);
      assert.equal(pins.source_head_sha256, H);
      assert.ok(subjects.every((s) => s.selection_reasons.includes("CONDITIONAL_SOURCE_UNPROVEN")));
      assert.ok(subjects.every((s) => s.selection_reasons.includes("NULL_ORIGIN_UNPROVEN")));
      assert.ok(subjects.every((s) => s.selection_reasons.includes("PRACTICAL_EVIDENCE_UNPROVEN")));
      calls.pages.push(subjects);
      if (options.badPage) throw Error("SYN_ROW_UNAPPROVED");
      if (options.falsePage) return false;
    },
    async assertSelectionCurrent(head, pub, pins, gate) {
      await Promise.resolve();
      assert.equal(head, HEAD);
      assert.equal(pub, CAT);
      assert.equal(pins.source_head_sha256, H);
      assert.equal(gate.signal, boundary.signal);
      assert.equal(gate.admission, boundary.admission);
      calls.selectionCurrent++;
      if (options.staleSelection) throw Error("SYN_SELECTION_STALE");
      if (options.falseSelection) return false;
    },
    async assertLive() {
      await Promise.resolve();
      calls.live++;
      if (options.revoked && calls.live >= 3) throw Error("SYN_REVOKED");
    },
  };
  const run = () =>
    composeSelectedP1R27Candidate(
      request,
      boundary,
      selector,
      issuer,
      baseline,
      sourceBatch,
      f.manifestBytes,
      f.coverageBytes,
      f.pins,
      f.scope,
      f.link,
      "SYN-BRIDGE",
      buildLimits({ max_body_bytes: options.maxBodyBytes ?? 10_000_000 }),
      {
        maxPages: 512,
        maxRows: options.maxRows ?? 2000,
        maxSourceBytes: options.maxSourceBytes ?? 4_000_000,
        timeoutMs: options.timeoutMs ?? 30_000,
      },
    );
  return { ...f, request, boundary, controller, calls, issuer, run };
}

test("same source bytes and native quota reach real producer; source-only condition is identified", async () => {
  const rows = makeRows(1, () => ({ quota_condition_text: "SYN-CONDITION", quota_value: 0 }));
  const f = await setup(rows), before = Uint8Array.from(f.pageBytes[0]);
  const result = await f.run();
  assert.equal(result.publication_ready, false);
  assert.equal(result.candidate.status, "HOLD_UNPUBLISHED");
  assert.equal(result.candidate.body.rows.length, 2);
  const produced = result.candidate.body.rows.find((r) => r.academic_year === 2027);
  assert.equal(produced.r27_source.quota.quota_condition_text, "SYN-CONDITION");
  assert.equal(produced.recruitment_count_with_stage.value, 0);
  assert.equal(f.calls.pages[0][0].source_only_fields.quota_condition_text, "present");
  assert.deepEqual(f.pageBytes[0], before);
  assert.equal(f.previous.calls, 1);
  assert.ok(f.previous.finishes >= 2);
  assert.ok(f.source.finishes >= 2);
});
test("101-key source uses bounded 100+1 logical lookups and preserves source ordering", async () => {
  const rows = makeRows(101), f = await setup(rows), result = await f.run();
  assert.deepEqual(f.calls.lookups.map((x) => x.length), [100, 1]);
  assert.deepEqual(f.calls.lookups.flat(), rows.map((r) => "2027:" + r.original_pk));
  assert.deepEqual(f.calls.pages.map((page) => page.length), [100, 1]);
  assert.equal(result.candidate.body.rows.length, 102);
});
test("missing or false issuer authorization fails before any publication candidate", async () => {
  for (
    const opt of [{ badPins: true }, { badScope: true }, { badPage: true }, { falsePage: true }, {
      revoked: true,
    }]
  ) {
    const f = await setup(makeRows(1), opt);
    await assert.rejects(f.run());
  }
});
test("altered source bytes or wrong page index fail before selection", async () => {
  const f = await setup(makeRows(2));
  f.source.pages[0] = Uint8Array.from(f.source.pages[0]);
  f.source.pages[0][0] ^= 1;
  await assert.rejects(f.run(), /source_digest/);
  assert.equal(f.calls.lookups.length, 0);
  const g = await setup(makeRows(2));
  const page = JSON.parse(new TextDecoder().decode(g.pageBytes[0]));
  page.index = 1;
  g.source.pages[0] = encode(page);
  await assert.rejects(g.run(), /source_digest|source_page/);
});
test("null stays distinct from absent, and mismatch fails closed", async () => {
  const f = await setup(makeRows(1, () => ({ quota_value: null })));
  const result = await f.run();
  const produced = result.candidate.body.rows.find((r) => r.academic_year === 2027);
  assert.equal(produced.recruitment_count_with_stage.value, null);
  const g = await setup(makeRows(1, () => ({ quota_value: null })), { omitQuota: true });
  await assert.rejects(g.run(), /native_value_mismatch/);
});
test("revoked selection head and failed previous-head recheck do not return candidates", async () => {
  const f = await setup(makeRows(1), { wrongSelectionHead: true });
  await assert.rejects(f.run());
  const g = await setup(makeRows(1));
  g.previous.failFinish = true;
  await assert.rejects(g.run(), /SYN_PREVIOUS_CHANGED/);
});
test("shared admission and abort are checked before source reads", async () => {
  const f = await setup(makeRows(1));
  f.boundary.admission = null;
  await assert.rejects(f.run(), /admission_unavailable/);
  assert.equal(f.source.calls, 0);
  assert.equal(f.previous.calls, 0);
  assert.equal(f.calls.sourceBatches, 0);
  const g = await setup(makeRows(1));
  g.controller.abort();
  await assert.rejects(g.run(), /admission_unavailable/);
  assert.equal(g.source.calls, 0);
  assert.equal(g.previous.calls, 0);
  assert.equal(g.calls.sourceBatches, 0);
});
test("existing source head recheck cannot be replaced by a false return", async () => {
  const f = await setup(makeRows(1));
  f.source.assertSourceHead = () => Promise.resolve(false);
  await assert.rejects(f.run(), /issuer_protocol/);
});
test("catalog selection head is independently rechecked before and after composition", async () => {
  const f = await setup(makeRows(1));
  await f.run();
  assert.equal(f.calls.selectionCurrent, 2);
  const g = await setup(makeRows(1), { staleSelection: true });
  await assert.rejects(g.run(), /SYN_SELECTION_STALE/);
  const h = await setup(makeRows(1), { falseSelection: true });
  await assert.rejects(h.run(), /issuer_protocol/);
});
test("multiple source pages preserve each original page and every ordered key", async () => {
  const rows = makeRows(257), f = await setup(rows);
  const before = f.pageBytes.map((p) => Uint8Array.from(p));
  const result = await f.run();
  assert.equal(f.source.calls, 0);
  assert.equal(f.calls.sourceBatches, 1);
  assert.deepEqual(f.calls.lookups.map((ids) => ids.length), [100, 100, 57]);
  assert.deepEqual(f.calls.lookups.flat(), rows.map((r) => "2027:" + r.original_pk));
  assert.deepEqual(f.calls.pages.map((page) => page.length), [100, 100, 57]);
  assert.deepEqual(
    f.calls.pages.flat().map((item) => item.page_index),
    rows.map((_, i) => Math.floor(i / 128)),
  );
  assert.deepEqual(f.pageBytes, before);
  const projected = result.candidate.body.rows.filter((r) => r.academic_year === 2027);
  assert.deepEqual(projected.map((r) => r.original_pk), rows.map((r) => r.original_pk));
  assert.equal(result.publication_ready, false);
});
test("fragmented page counts never become per-row catalog or issuer calls", async () => {
  for (const [n, sizes] of [[1, [1]], [36, [36]], [101, [100, 1]], [257, [100, 100, 57]]]) {
    const rows = makeRows(n), f = await setup(rows, { fragment: 1 }), result = await f.run();
    assert.deepEqual(f.calls.lookups.map((x) => x.length), sizes);
    assert.deepEqual(f.calls.lookups.flat(), rows.map((r) => "2027:" + r.original_pk));
    assert.equal(f.calls.sourceBatches, 1);
    assert.deepEqual(f.calls.pages.map((page) => page.length), sizes);
    assert.deepEqual(f.calls.pages.flat().map((x) => x.page_index), rows.map((_, i) => i));
    assert.equal(result.candidate.body.rows.filter((r) => r.academic_year === 2027).length, n);
    assert.equal(result.publication_ready, false);
  }
});
test("more than 1000 keys use multiple internal bounded calls without a national cap", async () => {
  const rows = makeRows(1001), f = await setup(rows), result = await f.run();
  assert.deepEqual(f.calls.lookups.map((x) => x.length), [
    100,
    100,
    100,
    100,
    100,
    100,
    100,
    100,
    100,
    100,
    1,
  ]);
  assert.deepEqual(f.calls.wholeScopes, [1000, 1000, 1, 1]);
  assert.deepEqual(f.calls.pages.map((x) => x.length), [
    100,
    100,
    100,
    100,
    100,
    100,
    100,
    100,
    100,
    100,
    1,
  ]);
  assert.deepEqual(f.calls.lookups.flat(), rows.map((r) => "2027:" + r.original_pk));
  assert.equal(f.calls.sourceBatches, 1);
  assert.equal(result.candidate.body.rows.filter((r) => r.academic_year === 2027).length, 1001);
  assert.equal(result.publication_ready, false);
});
test("baseline admission mutation or cancellation blocks the returned candidate", async () => {
  for (const options of [{ changeAdmissionDuringBaseline: true }, { abortDuringBaseline: true }]) {
    const f = await setup(makeRows(1), options);
    await assert.rejects(f.run(), /bridge_cancelled_or_expired/);
    assert.equal(f.previous.calls, 1);
  }
});
test("source order survives sorted catalog response and source-only values remain native", async () => {
  const rows = makeRows(4).reverse();
  rows[0].quota_value = "003";
  delete rows[1].quota_value;
  const f = await setup(rows), result = await f.run();
  const projected = result.candidate.body.rows.filter((r) => r.academic_year === 2027);
  assert.deepEqual(projected.map((r) => r.original_pk), rows.map((r) => r.original_pk));
  assert.equal(projected[0].recruitment_count_with_stage.value, "003");
  assert.equal(Object.hasOwn(projected[1].r27_source.quota, "quota_value"), false);
  assert.equal(result.publication_ready, false);
});

test("source manifest page authorization is mandatory and happens before any source read", async () => {
  for (
    const options of [
      { denySourceAuthorization: true },
      { falseSourceAuthorization: true },
      { rejectAuthorizationField: "manifest" },
      { rejectAuthorizationField: "head" },
      { rejectAuthorizationField: "scope" },
      { rejectAuthorizationField: "subject" },
      { rejectAuthorizationField: "pages" },
    ]
  ) {
    const f = await setup(makeRows(1), options);
    await assert.rejects(f.run());
    assert.equal(f.calls.sourceAuthorizations, 1);
    assert.equal(f.calls.sourceBatches, 0);
    assert.equal(f.calls.lookups.length, 0);
    assert.equal(f.previous.calls, 0);
    assert.equal(f.previous.finishes, 0);
    assert.equal(f.source.finishes, 0);
  }
});
test("full key scope is independently rechecked after authorized source read", async () => {
  const f = await setup(makeRows(1), { badScope: true });
  await assert.rejects(f.run(), /SYN_SCOPE_REJECTED/);
  assert.equal(f.calls.sourceAuthorizations, 1);
  assert.equal(f.calls.sourceBatches, 1);
  assert.equal(f.calls.lookups.length, 0);
});
test("6081 synthetic sources use globally ordered bounded 100-key lookup and issuer batches", async () => {
  const rows = makeRows(6081),
    f = await setup(rows, {
      maxRows: 6081,
      maxSourceBytes: 16_000_000,
      maxBodyBytes: 64_000_000,
      timeoutMs: 60_000,
    });
  const r = await f.run();
  const expected = Array(60).fill(100).concat([81]);
  assert.equal(f.calls.sourceAuthorizations, 1);
  assert.equal(f.calls.sourceBatches, 1);
  assert.deepEqual(f.calls.lookups.map((x) => x.length), expected);
  assert.deepEqual(f.calls.pages.map((x) => x.length), expected);
  assert.deepEqual(f.calls.lookups.flat(), rows.map((x) => "2027:" + x.original_pk));
  const expectedKeys = rows.map((x) => ({
    academic_year: 2027,
    school_id: x.school_id,
    offering_pk: x.original_pk,
  }));
  const issuerKeys = f.calls.pages.flat().map((x) => x.subject);
  const projected = r.candidate.body.rows.filter((x) => x.academic_year === 2027);
  const outputKeys = projected.map((x) => ({
    academic_year: x.academic_year,
    school_id: x.university_id,
    offering_pk: x.original_pk,
  }));
  assert.deepEqual(issuerKeys, expectedKeys);
  assert.deepEqual(outputKeys, expectedKeys);
  assert.equal(projected.length, 6081);
  assert.equal(r.publication_ready, false);
});
