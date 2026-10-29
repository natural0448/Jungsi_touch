/** Fully synthetic P1 v1/v2 integration regression. No DB, Storage, network or output files. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { JsonFloat, parseNativeJson } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { nativeJsonText, nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  HISTORY_SNAPSHOT_SLOTS, HistorySnapshotService, validateHistorySnapshotPayload,
  validateQualifiedHistorySnapshotPayload, validateQualifiedHistorySnapshotPayloadForPublisher,
} from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import { validateHistorySnapshotPayload as validateLegacy, validateQualifiedHistorySnapshotPayload as validateLegacyQualified, HistorySnapshotService as LegacyHistorySnapshotService } from "./fixtures/p1_history_snapshot_799.reference.ts";
import { PublicResponseProjection, publicJsonText } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { bindR27ScopeIndex, assertR27ScopeIndex } from "../../supabase/functions/_shared/jungsi/application/history_r27_scope_index.ts";
import { prepareP1R27GlobalReceipt } from "../../supabase/functions/_shared/jungsi/application/p1_r27_release_gate.ts";
import { bindP1R27ConsumerGate, assertP1R27ConsumerGate } from "../../supabase/functions/_shared/jungsi/application/p1_r27_consumer_gate.ts";
import { validateP1PreparedPartsGlobal } from "../../supabase/functions/_shared/jungsi/application/p1_r27_global_parts.ts";
import { bindHistoricalReferencePublication } from "../../supabase/functions/_shared/jungsi/application/history_reference_estimates.ts";
import { bindFieldQualificationPublication } from "../../supabase/functions/_shared/jungsi/application/history_field_qualification.ts";
import { bindReviewedR27Scope, combineReviewedR27Scopes, bindReviewedR27Links } from "../../supabase/functions/_shared/jungsi/application/r27_standalone.ts";
import { bindP1R27Evidence, composeP1R27Candidate, buildCandidateR27ScopeIndex } from "../../supabase/functions/_shared/jungsi/application/p1_r27_composition.ts";

const S = "a".repeat(64), H = "b".repeat(64), OLD = "c".repeat(64), PUB = "d".repeat(64), SCOPE = "e".repeat(64), EV = "f".repeat(64);
const results = [];
async function test(name, fn) { await fn(); results.push(name); }
const encode = x => new TextEncoder().encode(nativeJsonText(x));
const hash = async bytes => Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
const own = (x, k) => Object.hasOwn(x, k);
const ident = r => Object.fromEntries(["academic_year", "school_id", "original_pk", "campus", "admission_track", "group"].map(k => [k, r[k]]));
function sourceRow(overrides = {}) {
  return {
    academic_year: 2027, school_id: "SYN-SCHOOL", original_pk: "SYN-PK",
    campus: "SYN-CAMPUS", admission_track: "SYN-TRACK", group: "SYN-GROUP",
    university_name: "SYN SCHOOL", department: "SYN DEPARTMENT", region: "SYN REGION",
    scope: { state: "eligible_non_practical", evidence_sha256: EV }, source_ref: "SYN-PRIVATE-REF",
    quota_value: 0, quota_literal_state: "source_reported", quota_stage: null,
    quota_cell: { status: "pending_metadata", reason_code: "SYN_PENDING", unit: "명", source_as_of: "2026-01-01" },
    ...overrides,
  };
}
function emptyCell(slot) {
  const cut = slot.endsWith("percent_cut") || slot === "alternate_cut";
  return {
    value: null, unit: null, status: "not_published", reason_code: "SYN_UNPUBLISHED",
    source_url: null, source_as_of: null, statistic_label: null, cohort: null, source_context: null,
    ...(slot === "recruitment_count_with_stage" ? { stage: "unspecified" } : {}),
    ...(slot === "alternate_cut" ? { entries: [], omitted_other_basis_count: 0 } : {}),
    ...(cut ? { statistic_percent: slot === "final_50_percent_cut" ? 50 : slot === "final_70_percent_cut" ? 70 : 75,
      basis_code: null, basis_label: null, cohort_code: null, cohort_label: null, selection_rule_ref: null } : {}),
  };
}
function historical(year = 2026, overrides = {}) {
  const pk = overrides.original_pk ?? "SYN-OLD";
  return {
    offering_id: year + ":" + pk, academic_year: year, original_pk: pk, observation_key: null,
    mapping_status: "mapped", identity_review: { status: "source_consistent", reason_code: null, variants: [] },
    university_id: "SYN-SCHOOL", university_name: "SYN SCHOOL", region: null,
    campus: "SYN-CAMPUS", department: "SYN PRIOR", admission_track: "SYN-TRACK", group: "SYN-GROUP",
    ...Object.fromEntries(HISTORY_SNAPSHOT_SLOTS.map(slot => [slot, emptyCell(slot)])),
    ...overrides,
  };
}
async function scopes(rows) {
  const unique = new Map();
  for (const r of rows) if (r.scope.state !== "review_pending" && r.scope.evidence_sha256) {
    const g = { source: ident(r), state: r.scope.state, evidence_sha256: r.scope.evidence_sha256 };
    unique.set(JSON.stringify(g.source), g);
  }
  const contexts = [], grants = [...unique.values()];
  for (let i = 0; i < grants.length; i += 64) {
    const b = encode({ format: "jungsi.r27-reviewed-scope/v1", status: "approved_scope_mappings",
      source_sha256: S, grants: grants.slice(i, i + 64) });
    contexts.push(await bindReviewedR27Scope(b, { receiptSha256: await hash(b), sourceSha256: S }));
  }
  return contexts.length ? combineReviewedR27Scopes(contexts) : undefined;
}
async function links(grants) {
  if (!grants.length) return undefined;
  const b = encode({ format: "jungsi.r27-reviewed-links/v1", status: "approved_exact_mappings", source_sha256: S, grants });
  return bindReviewedR27Links(b, { receiptSha256: await hash(b), sourceSha256: S });
}
const grant = (r, target) => ({ source: ident(r), target, review_state: "approved", evidence_sha256: EV });
const target = r => ({ academic_year: r.academic_year, school_id: r.university_id, original_pk: r.original_pk,
  campus: r.campus, admission_track: r.admission_track, group: r.group });

async function evidenceFor(rows, overrides = {}, previousPub = PUB) {
  const pages = [];
  for (let i = 0; i < rows.length; i += 128) pages.push(rows.slice(i, i + 128));
  if (!pages.length) pages.push([]);
  const pageBytes = pages.map((items, index) => encode({ format: "jungsi.r27-source-page/v1",
    source_sha256: S, source_head_sha256: H, index, rows: items }));
  const pagePins = [];
  for (let i = 0; i < pageBytes.length; i++) pagePins.push({ sha256: await hash(pageBytes[i]), bytes: pageBytes[i].length, rows: pages[i].length });
  const coverage = {
    format: "jungsi.r27-coverage-receipt/v1", source_sha256: S, source_head_sha256: H,
    previous_publication_sha256: previousPub, previous_source_head_sha256: OLD, scope_sha256: SCOPE,
    snapshot_isolation: "repeatable_read", source_mode: "current_logical_view",
    head_rechecked: true, writer_stable: true, previous_scope_mapping_reviewed: true,
    expected_rows: rows.length, source_only: 0, view_only: 0, full_scope_duplicates: 0,
    unresolved_pk_groups: 0, value_mismatches: 0, numeric_mismatches: 0, null_presence_mismatches: 0, literal_mismatches: 0, ...overrides,
  };
  const coverageBytes = encode(coverage), coverageSha = await hash(coverageBytes);
  const manifestBytes = encode({ format: "jungsi.r27-page-manifest/v1", source_sha256: S,
    source_head_sha256: H, coverage_sha256: coverageSha, previous_publication_sha256: previousPub,
    previous_source_head_sha256: OLD, scope_sha256: SCOPE, expected_rows: rows.length, pages: pagePins });
  const pins = { manifest_sha256: await hash(manifestBytes), coverage_sha256: coverageSha,
    source_sha256: S, source_head_sha256: H, previous_publication_sha256: previousPub,
    previous_source_head_sha256: OLD, scope_sha256: SCOPE };
  return { pageBytes, coverageBytes, manifestBytes, pins };
}
async function previousPort(groups) {
  const parts=[], images=[];
  for (let i=0; i<groups.length; i++) {
    const rows=groups[i], partId="SYN-PART-"+i, payloadId="SYN-OLD-PAYLOAD";
    const raw=encode({format:"jungsi.history-snapshot/v1",payload_id:payloadId,part_id:partId,rows});
    const gzip=new Uint8Array(gzipSync(raw));
    images.push(gzip);
    parts.push({partId,payloadId,gzipBytes:gzip.length,gzipSha256:await hash(gzip),
      decodedBytes:raw.length,decodedSha256:await hash(raw),rows:rows.length,
      mappedRows:rows.filter(r=>r.mapping_status==="mapped").length,
      mappingPendingRows:rows.filter(r=>r.mapping_status==="mapping_pending").length,objectKey:"SYN-PRIVATE-"+i});
  }
  const counts={rows:groups.flat().length,mapped_rows:parts.reduce((n,p)=>n+p.mappedRows,0),
    mapping_pending_rows:parts.reduce((n,p)=>n+p.mappingPendingRows,0),observations:0,schools:0};
  const manifestParts=parts.map(p=>({part_id:p.partId,payload_id:p.payloadId,object_key:p.objectKey,
    gzip_bytes:p.gzipBytes,gzip_sha256:p.gzipSha256,decoded_bytes:p.decodedBytes,
    decoded_sha256:p.decodedSha256,rows:p.rows,mapped_rows:p.mappedRows,mapping_pending_rows:p.mappingPendingRows}));
  const manifestBytes=encode({format:"jungsi.history-snapshot-manifest/v1",status:"approved",snapshot_id:"SYN-OLD",
    source_head_sha256:OLD,scope_sha256:SCOPE,generated_at:"2026-01-01T00:00:00Z",source_as_of:"2026-01-01",
    schema_version:"jungsi.history-snapshot/v1",normalization_rules_version:"SYN-NORM",
    normalization_rules_sha256:"1".repeat(64),selection_rules_version:"SYN-SELECT",
    selection_rules_sha256:"2".repeat(64),counts,full:null,parts:manifestParts});
  const pub={snapshotId:"SYN-OLD",publicationSha256:await hash(manifestBytes),sourceHeadSha256:OLD,scopeSha256:SCOPE,
    generatedAt:"2026-01-01T00:00:00Z",sourceAsOf:"2026-01-01",schemaVersion:"jungsi.history-snapshot/v1",
    normalizationRulesVersion:"SYN-NORM",selectionRulesVersion:"SYN-SELECT",expiresAtUtc:9_999_999n,
    counts,full:null,parts};
  return {
    pub, manifestBytes, images, calls:0, finishes:0, failFinish:false,
    async readPinnedBatch(request) {
      this.calls++;
      assert.equal(typeof request.previous_publication_sha256, "string");
      return {publication:this.pub,manifest_bytes:this.manifestBytes,gzip_parts:this.images};
    },
    async assertCurrent(request) {
      this.finishes++; assert.equal(request.previous_publication_sha256,this.pub.publicationSha256);
      if(this.failFinish)throw Error("SYN_PREVIOUS_CHANGED");
    },
  };
}
function buildLimits(overrides={}) {
  return {max_baseline_parts:200,max_combined_rows:10000,max_body_bytes:10000000,
    max_baseline_gzip_bytes:10000000,max_baseline_decoded_bytes:10000000,
    max_part_gzip_bytes:1000000,max_part_decoded_bytes:1000000,max_depth:64,...overrides};
}
async function fixture(rows, groups = [[historical()]], opts = {}) {
  const previous = await previousPort(groups);
  const e = await evidenceFor(rows, opts.coverage ?? {}, previous.pub.publicationSha256);
  const context = await bindP1R27Evidence(e.manifestBytes, e.coverageBytes, e.pins);
  const scope = await scopes(rows), link = await links(opts.links ?? []);
  const source = { calls: 0, finishes: 0, pages: e.pageBytes, failFinish: false,
    async readPage(index) { this.calls++; return this.pages[index]; },
    async assertSourceHead(head) { this.finishes++; assert.equal(head, H); if (this.failFinish) throw Error("SYN_SOURCE_CHANGED"); },
  };
  return { ...e, context, scope, link, previous, source,
    build: () => composeP1R27Candidate(previous, source, context, scope, link, "SYN-NEW-PAYLOAD",
      buildLimits()) };
}

await test("v1_preserved_and_v2_requires_new_context", () => {
  const old = historical(), part = { payloadId: "SYN-PAYLOAD", partId: null, rows: 1, mappedRows: 1, mappingPendingRows: 0 };
  const body = { format: "jungsi.history-snapshot/v1", payload_id: part.payloadId, part_id: null, rows: [old] };
  assert.doesNotThrow(() => validateLegacy(body, part));
  assert.doesNotThrow(() => validateHistorySnapshotPayload(body, part));
  const old2027 = historical(2027);
  assert.throws(() => validateHistorySnapshotPayload({ ...body, format: "jungsi.history-snapshot/v2", rows: [old2027] }, part));
  assert.throws(() => validateLegacy({ ...body, format: "jungsi.history-snapshot/v2" }, part));
});
await test("new_pk_is_independent_and_zero_stage_null_are_preserved", async () => {
  const f = await fixture([sourceRow()]), out = await f.build();
  assert.equal(out.status, "HOLD_UNPUBLISHED");
  assert.equal(out.body.rows.length, 2);
  const row = out.body.rows.find(r => r.academic_year === 2027);
  assert.equal(row.original_pk, "SYN-PK");
  assert.equal(row.recruitment_count_with_stage.value, 0);
  assert.equal(row.recruitment_count_with_stage.stage, "unspecified");
  assert.equal(row.r27_source.quota.quota_value, 0);
  assert.equal(row.r27_source.quota.quota_stage, null);
  assert.equal(row.r27_source.quota_review_status, "stage_unknown");
  assert.equal(f.previous.finishes, 1);
  assert.equal(f.source.finishes, 1);
});
await test("absence_and_null_are_distinct", async () => {
  const a = sourceRow({ original_pk: "SYN-A" }), b = sourceRow({ original_pk: "SYN-B", quota_value: null, quota_literal_state: null, quota_stage: null });
  delete a.quota_value; delete a.quota_literal_state; delete a.quota_stage; delete a.quota_cell;
  const out = await (await fixture([a, b])).build();
  const x = out.body.rows.find(r => r.original_pk === "SYN-A").r27_source.quota;
  const y = out.body.rows.find(r => r.original_pk === "SYN-B").r27_source.quota;
  for (const k of ["quota_value","quota_literal_state","quota_stage"]) { assert.equal(own(x,k), false); assert.equal(own(y,k), true); assert.equal(y[k], null); }
  assert.equal(own(x, "quota_cell"), false);
});
await test("same_pk_different_scope_stays_separate", async () => {
  const a = sourceRow(), b = sourceRow({ campus: "SYN-OTHER-CAMPUS", admission_track: "SYN-OTHER-TRACK", group: "SYN-OTHER-GROUP" });
  const out = await (await fixture([a,b])).build();
  const rows = out.body.rows.filter(r => r.academic_year === 2027);
  assert.equal(rows.length, 2); assert.equal(rows[0].original_pk, rows[1].original_pk);
  assert.notEqual(rows[0].r27_source.scope_key, rows[1].r27_source.scope_key);
  assert.equal(rows[0].offering_id, rows[1].offering_id);
});
await test("conditional_final_is_not_promoted_and_literal_preserved", async () => {
  const a = sourceRow({ quota_value: 7, quota_literal_state: "conditional_carryover",
    quota_stage: "final", quota_condition_text: "SYN 수시 이월 조건" });
  const out = await (await fixture([a])).build(), row = out.body.rows.find(r => r.academic_year === 2027);
  assert.equal(row.r27_source.quota.quota_stage, "final");
  assert.equal(row.r27_source.quota.quota_condition_text, a.quota_condition_text);
  assert.equal(row.r27_source.quota_review_status, "condition_present");
  assert.equal(row.recruitment_count_with_stage.stage, "unspecified");
  const bad = structuredClone(out.body); bad.rows.find(r=>r.academic_year===2027).recruitment_count_with_stage.stage = "final";
  assert.throws(() => validateHistorySnapshotPayload(bad, out.counts));
});
await test("native_decimal_and_text_remain_distinct", async () => {
  const a = sourceRow({ original_pk: "SYN-A", quota_value: new JsonFloat("7.50") });
  const b = sourceRow({ original_pk: "SYN-B", quota_value: "7.50" });
  const out = await (await fixture([a,b])).build();
  assert.ok(out.body.rows.find(r=>r.original_pk==="SYN-A").r27_source.quota.quota_value instanceof JsonFloat);
  assert.equal(out.body.rows.find(r=>r.original_pk==="SYN-A").r27_source.quota.quota_value.lexeme, "7.50");
  assert.equal(typeof out.body.rows.find(r=>r.original_pk==="SYN-B").r27_source.quota.quota_value, "string");
});
await test("unknown_scope_held_confirmed_practical_excluded", async () => {
  const a = sourceRow({original_pk:"SYN-A"});
  const b = sourceRow({original_pk:"SYN-B", scope:{state:"review_pending",evidence_sha256:null}});
  const c = sourceRow({original_pk:"SYN-C", scope:{state:"excluded_practical",evidence_sha256:EV}});
  const out = await (await fixture([a,b,c])).build();
  assert.equal(out.held_rows.length,1); assert.equal(out.held_rows[0].original_pk,"SYN-B");
  assert.equal(out.excluded_count,1); assert.equal(out.body.rows.filter(r=>r.academic_year===2027).length,1);
});
await test("duplicate_full_scope_contradicts_zero_duplicate_receipt", async () => {
  const a=sourceRow(), b=sourceRow({quota_value:8});
  const f=await fixture([a,b]);
  await assert.rejects(f.build(),/coverage_source_scope_conflict/);
  assert.equal(f.pageBytes.length,1);
});
await test("old_2027_exact_scope_preserves_other_cells_and_updates_quota", async () => {
  const old=historical(2027,{original_pk:"SYN-PK",offering_id:"2027:SYN-PK"});
  old.competition_ratio = { ...emptyCell("competition_ratio"), value: "SYN-PREV", status:"pending_metadata", reason_code:"SYN_PENDING" };
  const out=await (await fixture([sourceRow({department:"SYN PRIOR"})],[ [old] ])).build();
  const row=out.body.rows[0];
  assert.equal(row.department,"SYN PRIOR");
  assert.equal(row.competition_ratio.value,"SYN-PREV");
  assert.equal(row.recruitment_count_with_stage.value,0);
  assert.equal(out.held_previous_rows.length,0);
});
await test("old_review_pending_is_held_without_duplicate_reintroduction", async () => {
  const old=historical(2027,{original_pk:"SYN-PK",offering_id:"2027:SYN-PK",
    identity_review:{status:"review_pending",reason_code:"SYN_UNRESOLVED",variants:[]}});
  const out=await (await fixture([sourceRow()],[[old]])).build();
  assert.equal(out.held_previous_rows.length,1);
  assert.equal(out.held_rows.length,1);
  assert.equal(out.held_rows[0].quota_value,0);
  assert.equal(out.body.rows.length,0);
});
await test("same_scope_conflicting_names_preserve_both_in_hold", async () => {
  const old=historical(2027,{original_pk:"SYN-PK",offering_id:"2027:SYN-PK"});
  const out=await (await fixture([sourceRow()],[[old]])).build();
  assert.equal(out.held_previous_rows.length,1); assert.equal(out.held_rows.length,1);
  assert.equal(out.body.rows.length,0);
  assert.equal(out.held_previous_rows[0].department,"SYN PRIOR");
  assert.equal(out.held_rows[0].department,"SYN DEPARTMENT");
});
await test("baseline_missing_current_is_preserved_in_hold", async () => {
  const old=historical(2027,{original_pk:"SYN-LEGACY",offering_id:"2027:SYN-LEGACY"});
  const out=await (await fixture([sourceRow()],[[old]])).build();
  assert.equal(out.held_previous_rows[0].original_pk,"SYN-LEGACY");
  assert.equal(out.body.rows.find(r=>r.academic_year===2027).original_pk,"SYN-PK");
});
await test("approved_historical_links_require_target_in_previous_p1", async () => {
  const src=sourceRow(), old=historical(2026), t=target(old), missing={...t,academic_year:2025,original_pk:"SYN-MISSING"};
  const f=await fixture([src],[[old]],{links:[grant(src,t),grant(src,missing)]});
  const out=await f.build(), v=out.body.rows.find(r=>r.academic_year===2027).r27_source;
  assert.equal(v.history_link_status,"partially_reviewed"); assert.equal(v.historical_links.length,1);
  assert.deepEqual(v.history_link_pending_years,[2025]);
});
await test("different_historical_scope_never_links", async () => {
  const src=sourceRow(), old=historical(), t={...target(old),campus:"SYN-DIFFERENT"};
  const out=await (await fixture([src],[[old]],{links:[grant(src,t)]})).build();
  const v=out.body.rows.find(r=>r.academic_year===2027).r27_source;
  assert.equal(v.historical_links.length,0); assert.deepEqual(v.history_link_pending_years,[2026]);
});
await test("bulk_uses_pages_not_per_row_reads", async () => {
  const rs=Array.from({length:257},(_,i)=>sourceRow({original_pk:"SYN-"+i}));
  const f=await fixture(rs,[[historical(2025)],[historical(2026)]]), out=await f.build();
  assert.equal(f.source.calls,3); assert.equal(f.previous.calls,1);
  assert.equal(out.body.rows.filter(r=>r.academic_year===2027).length,257);
});
await test("changed_source_page_rejected", async () => {
  const f=await fixture([sourceRow()]); f.source.pages[0][0]^=1;
  await assert.rejects(f.build(),/page_digest_mismatch/);
});
await test("baseline_manifest_and_gzip_tampering_are_rejected", async () => {
  let f=await fixture([sourceRow()]); f.previous.manifestBytes[0]^=1;
  await assert.rejects(f.build(),/baseline_manifest_digest_mismatch/);
  f=await fixture([sourceRow()]); f.previous.images[0][0]^=1;
  await assert.rejects(f.build(),/baseline_gzip_digest_mismatch/);
});
await test("escaped_quotes_in_baseline_are_parsed_and_preserved", async () => {
  const old=historical(2026,{university_name:'SYN "quoted" \\\\ text'});
  const out=await (await fixture([sourceRow()],[[old]])).build();
  assert.equal(out.body.rows[0].university_name,old.university_name);
});
await test("changed_source_or_prior_head_rejected_at_finish", async () => {
  let f=await fixture([sourceRow()]); f.source.failFinish=true;
  await assert.rejects(f.build(),/SYN_SOURCE_CHANGED/);
  f=await fixture([sourceRow()]); f.previous.failFinish=true;
  await assert.rejects(f.build(),/SYN_PREVIOUS_CHANGED/);
});
await test("coverage_cannot_hide_incomplete_current_view", async () => {
  for (const change of [{view_only:1},{source_only:1},{value_mismatches:1},{literal_mismatches:1},
    {full_scope_duplicates:1},{unresolved_pk_groups:1},{numeric_mismatches:1},{null_presence_mismatches:1},{source_mode:"one_release_only"},
    {snapshot_isolation:"read_committed"},{head_rechecked:false},{writer_stable:false},
    {previous_scope_mapping_reviewed:false}]) {
    const e=await evidenceFor([sourceRow()],change);
    await assert.rejects(bindP1R27Evidence(e.manifestBytes,e.coverageBytes,e.pins),/coverage_not_accepted/);
  }
});
await test("untrusted_fields_and_inconsistent_value_are_rejected", async () => {
  const out=await (await fixture([sourceRow()])).build(), body=structuredClone(out.body);
  const r=body.rows.find(x=>x.academic_year===2027);
  r.r27_source.quota.source_ref="SYN-PRIVATE"; assert.throws(()=>validateHistorySnapshotPayload(body,out.counts));
  delete r.r27_source.quota.source_ref; r.recruitment_count_with_stage.value=8;
  assert.throws(()=>validateHistorySnapshotPayload(body,out.counts));
});
await test("malformed_2027_cell_rejects_with_service_error", async () => {
  const out=await (await fixture([sourceRow()])).build(), body=structuredClone(out.body);
  body.rows.find(r=>r.academic_year===2027).recruitment_count_with_stage=null;
  assert.throws(()=>validateHistorySnapshotPayload(body,out.counts),error=>error.code==="snapshot_invalid" && error.http===503);
});
await test("source_reference_is_not_in_public_candidate", async () => {
  const out=await (await fixture([sourceRow()])).build();
  assert.equal(nativeJsonText(out.body).includes("SYN-PRIVATE-REF"),false);
});
await test("oversize_limits_and_prior_publication_mismatch_fail", async () => {
  const f=await fixture([sourceRow()]); f.previous.pub.publicationSha256="9".repeat(64);
  await assert.rejects(f.build(),/previous_head_mismatch/);
  const x=await fixture([sourceRow()]);
  await assert.rejects(composeP1R27Candidate(x.previous,x.source,x.context,x.scope,x.link,"SYN",
    buildLimits({max_baseline_parts:1,max_combined_rows:1,max_body_bytes:500000})),/combined_row_limit/);
});
await test("cross_school_same_pk_holds_both_and_validator_rejects_combination", async () => {
  const a=sourceRow(), b=sourceRow({school_id:"SYN-OTHER"});
  const f=await fixture([a,b]), out=await f.build();
  assert.equal(out.body.rows.filter(r=>r.academic_year===2027).length,0);
  assert.equal(out.held_rows.length,2);
  assert.ok(out.held_rows.every(r=>r.scope_review==="cross_school_pk_pending"));
  await assert.rejects(buildCandidateR27ScopeIndex(out,f.context),/candidate_scope_unresolved/);
  const outA=await (await fixture([a])).build(), outB=await (await fixture([b])).build();
  const rowA=outA.body.rows.find(r=>r.academic_year===2027), rowB=outB.body.rows.find(r=>r.academic_year===2027);
  const part={payloadId:"SYN-CROSS",partId:null,rows:2,mappedRows:2,mappingPendingRows:0};
  assert.throws(()=>validateHistorySnapshotPayload({format:"jungsi.history-snapshot/v2",
    payload_id:part.payloadId,part_id:null,rows:[rowA,rowB]},part));
});
await test("unmodified_799_service_and_registry_still_accept_v1", async () => {
  const previous=await previousPort([[historical()]]);
  const pub=previous.pub, part=pub.parts[0], raw=gunzipSync(previous.images[0]);
  const port={async current(){return pub;},async read(){return parseNativeJson(new TextDecoder().decode(raw));},
    async assertCurrent(){}};
  const session={user:{subjectId:"SYN-USER",expiresAtUtc:9999999n},evaluatedAtUtc:1n,tier:"standard",paidUntilUtc:null};
  const legacyService=new LegacyHistorySnapshotService(port,{nowUtc:()=>1n},SCOPE);
  const head=await legacyService.head(session,{}), body=await legacyService.read(session,pub.snapshotId,{part_id:part.partId});
  const registry=JSON.parse(readFileSync(new URL("./fixtures/p1_public_registry_799.reference.json",import.meta.url),"utf8"));
  const projector=new PublicResponseProjection(registry,registry.operations.map(x=>({id:x.id,contract_ref:x.contract_ref})));
  assert.equal(projector.project("history.snapshot.head","standard",head).schema_version,"jungsi.history-snapshot/v1");
  assert.equal(projector.project("history.snapshot.read","standard",body).format,"jungsi.history-snapshot/v1");
});
await test("2027_historical_reference_is_not_accepted_by_v2_scope", async () => {
  const out=await (await fixture([sourceRow()])).build(), body=structuredClone(out.body);
  body.rows.find(r=>r.academic_year===2027).historical_cutoff_references=[];
  assert.throws(()=>validateHistorySnapshotPayload(body,out.counts));
});
await test("prior_historical_reference_requires_new_publication_binding", async () => {
  const old=historical();
  const release="reference-percentile:"+"3".repeat(64);
  old.historical_cutoff_references=[{format:"jungsi.historical-cutoff-reference/v1",
    observation_id:"observation:"+"4".repeat(64),academic_year:2026,school_id:old.university_id,
    offering_pk:old.original_pk,value:"1.25",unit:"%",status:"model_estimated",label:"추정상위누백(전체응시자)",
    scope:"historical_admission_cutoff",method_id:"estimated-whole-cohort-percentile:"+"2".repeat(64),
    release_id:release,display_role:"independent_observation",statistic_label:null,
    reference_status:"CALCULATED_WHOLE_COHORT_MODEL_ESTIMATE",engine_approved:false,production_allowed:false}];
  const f=await fixture([sourceRow()],[[old]]);
  const descriptor={format:"jungsi.history-reference-estimates/v1",release_id:release,
    source_export_sha256:"4".repeat(64),head_readback_receipt_sha256:"5".repeat(64),
    metric:"estimated_upper_cumulative_percent_all_examinees",observation_count:1,school_count:1,
    engine_approved:false,production_allowed:false,display_scope:"historical_admission_only"};
  f.previous.pub.historicalReferences=bindHistoricalReferencePublication(descriptor,f.previous.pub.publicationSha256,OLD,SCOPE);
  const out=await f.build();
  assert.equal(out.rebind_required.length,1);
  assert.equal(out.rebind_required[0].kind,"historical_reference");
  assert.equal(out.body.rows[0].historical_cutoff_references[0].value,"1.25");
  await assert.rejects(buildCandidateR27ScopeIndex(out,f.context),/candidate_scope_unresolved/);
});
await test("prior_rank_string_and_qualification_are_preserved_for_rebind", async () => {
  const old=historical();
  old.identity_review={status:"review_pending",reason_code:"SYN_REVIEW",variants:[{
    university_name:"SYN SCHOOL",department:"SYN PRIOR",admission_track:"SYN-TRACK",group:"SYN-GROUP"}]};
  old.final_additional_admission_rank={...emptyCell("final_additional_admission_rank"),
    value:"17",status:"pending_metadata",reason_code:"SYN_REVIEW",unit:null,
    source_context:{observation_id:"observation:"+"8".repeat(64),identity_variant_index:0,scope_status:"review_pending"}};
  const rank=old.final_additional_admission_rank, subject={observation_id:rank.source_context.observation_id,
    academic_year:old.academic_year,offering_pk:old.original_pk,identity_variant_index:0};
  const grant={field:"final_additional_admission_rank",subject,expected_raw_cell_sha256:await nativeJsonSha256(rank),
    expected_native_value_type:"string",expected_raw_status:"pending_metadata",expected_raw_unit:null,
    expected_identity_review_sha256:await nativeJsonSha256(old.identity_review)};
  const authority="9".repeat(64),previous="7".repeat(64);
  const receipt=encode({format:"jungsi.history-field-qualification-receipt/v1",status:"approved_exact_fields",
    authority_sha256:authority,source_head_sha256:OLD,scope_sha256:SCOPE,
    expected_previous_manifest_sha256:previous,subjects:[grant]});
  const receiptSha=await hash(receipt), approval={...grant,authority_sha256:authority,qualification_receipt_sha256:receiptSha};
  const q={format:"jungsi.history-field-service-qualification/v1",authority_sha256:authority,
    qualification_receipt_sha256:receiptSha,subject,normalized_service_fields:{status:"verified_official",unit:"번"}};
  old.final_additional_admission_rank={...rank,service_qualification:q};
  const f=await fixture([sourceRow()],[[old]]);
  f.previous.pub.fieldQualification=await bindFieldQualificationPublication([approval],receipt,{
    publicationSha256:f.previous.pub.publicationSha256,sourceHeadSha256:OLD,scopeSha256:SCOPE,
    authoritySha256:authority,qualificationReceiptSha256:receiptSha,previousManifestSha256:previous,expectedSubjectCount:1});
  const out=await f.build(), candidateRank=out.body.rows[0].final_additional_admission_rank;
  assert.equal(candidateRank.value,"17"); assert.equal(typeof candidateRank.value,"string");
  assert.equal(own(candidateRank,"service_qualification"),false);
  assert.equal(out.rebind_required.length,1); assert.equal(out.rebind_required[0].kind,"field_qualification");
  assert.equal(out.rebind_required[0].row.final_additional_admission_rank.service_qualification.format,q.format);
  await assert.rejects(buildCandidateR27ScopeIndex(out,f.context),/candidate_scope_unresolved/);
});
await test("v2_head_read_projection_and_gzip_pins_use_service", async () => {
  const f=await fixture([sourceRow()]), out=await f.build();
  const raw=encode(out.body), compressed=gzipSync(raw), decoded=gunzipSync(compressed);
  const part={...out.counts, gzipBytes:compressed.length,gzipSha256:await hash(compressed),
    decodedBytes:raw.length,decodedSha256:await hash(raw),objectKey:"SYN-PRIVATE-BODY"};
  const counts={rows:out.counts.rows,mapped_rows:out.counts.mappedRows,mapping_pending_rows:out.counts.mappingPendingRows,observations:0,schools:1};
  const wirePart={part_id:part.partId,payload_id:part.payloadId,object_key:part.objectKey,gzip_bytes:part.gzipBytes,gzip_sha256:part.gzipSha256,decoded_bytes:part.decodedBytes,decoded_sha256:part.decodedSha256,rows:part.rows,mapped_rows:part.mappedRows,mapping_pending_rows:part.mappingPendingRows};
  const manifest={format:"jungsi.history-snapshot-manifest/v1",status:"approved",snapshot_id:"SYN-V2",source_head_sha256:H,scope_sha256:SCOPE,
    generated_at:"2026-01-01T00:00:00Z",source_as_of:"2026-01-01",schema_version:"jungsi.history-snapshot/v2",
    normalization_rules_version:"SYN",normalization_rules_sha256:"1".repeat(64),selection_rules_version:"SYN",selection_rules_sha256:"2".repeat(64),
    counts,full:wirePart,parts:[]};
  const manifestBytes=encode(manifest), manifestSha=await hash(manifestBytes);
  const beforeGate={snapshotId:"SYN-V2",publicationSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,
    generatedAt:manifest.generated_at,sourceAsOf:manifest.source_as_of,schemaVersion:manifest.schema_version,
    normalizationRulesVersion:"SYN",selectionRulesVersion:"SYN",expiresAtUtc:9999999n,
    counts:Object.freeze({...counts}),full:Object.freeze({...part}),parts:Object.freeze([])};
  const index=await buildCandidateR27ScopeIndex(out,f.context), indexBytes=encode(index),indexSha=await hash(indexBytes);
  const scopePins={indexSha256:indexSha,publicationSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,coverageSha256:out.coverage_sha256};
  const limits={maxParts:4,maxRows:20,maxDecodedBytes:262144,maxPartBytes:131072,maxDepth:64,maxTotalGzipBytes:262144,maxPartGzipBytes:131072,maxManifestBytes:65536,maxIndexBytes:65536,timeoutMs:5000};
  const global=await prepareP1R27GlobalReceipt(beforeGate,manifestBytes,indexBytes,indexSha,out.coverage_sha256,[Uint8Array.from(compressed)],limits),globalBytes=encode(global);
  const consumer={format:"jungsi.p1-r27-consumer-approval/v1",status:"approved",manifest_sha256:manifestSha,source_head_sha256:H,scope_sha256:SCOPE,
    consumer_build_sha256:"3".repeat(64),consumer_contract_sha256:"4".repeat(64),r27_scope_key_supported:true,expires_at_utc_micros:"9999999"};
  const consumerBytes=encode(consumer),headSha="5".repeat(64);
  const pins={headSha256:headSha,manifestSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,indexSha256:indexSha,coverageSha256:out.coverage_sha256,
    globalReceiptSha256:await hash(globalBytes),consumerReceiptSha256:await hash(consumerBytes),consumerBuildSha256:"3".repeat(64),consumerContractSha256:"4".repeat(64)};
  await assert.rejects(bindP1R27ConsumerGate(beforeGate,indexBytes,globalBytes,consumerBytes,{...pins,consumerBuildSha256:"0".repeat(64)},headSha,1n));
  const gate=await bindP1R27ConsumerGate(beforeGate,indexBytes,globalBytes,consumerBytes,pins,headSha,1n);
  const immutable=Object.freeze(beforeGate), boundIndex=await assertP1R27ConsumerGate(gate,immutable);
  const noGate=Object.freeze({...immutable,r27ScopeIndex:boundIndex});
  const sessionProbe={user:{subjectId:"SYN-USER",expiresAtUtc:9999999n},evaluatedAtUtc:1n,tier:"standard",paidUntilUtc:null};
  await assert.rejects(new HistorySnapshotService({current:async()=>noGate,read:async()=>out.body,assertCurrent:async()=>{}},{nowUtc:()=>1n},SCOPE).head(sessionProbe,{}));
  const pub=Object.freeze({...immutable,r27ScopeIndex:boundIndex,r27Gate:gate});
  let current=true;
  const port={async current(){if(!current)throw Error("changed");return pub;},
    async read(_p, selected){assert.equal(await hash(compressed),selected.gzipSha256);
      assert.equal(await hash(decoded),selected.decodedSha256);return parseNativeJson(new TextDecoder().decode(decoded));},
    async assertCurrent(){if(!current)throw Error("changed");}};
  const service=new HistorySnapshotService(port,{nowUtc:()=>1n},SCOPE);
  const session={user:{subjectId:"SYN-USER",expiresAtUtc:9999999n},evaluatedAtUtc:1n,tier:"standard",paidUntilUtc:null};
  const head=await service.head(session,{}); assert.equal(head.schema_version,"jungsi.history-snapshot/v2");
  const body=await service.read(session,"SYN-V2",{}); assert.equal(body.format,pub.schemaVersion);
  const registry=JSON.parse(readFileSync(new URL("../../src/jungsi_touch/application/public_response_schemas.json",import.meta.url),"utf8"));
  const projector=new PublicResponseProjection(registry,registry.operations.map(x=>({id:x.id,contract_ref:x.contract_ref})));
  const projected=projector.project("history.snapshot.read","standard",body);
  const paid=projector.project("history.snapshot.read","paid",body);
  assert.equal(publicJsonText(projected).includes("SYN-PRIVATE-REF"),false);
  assert.equal(publicJsonText(projected),publicJsonText(paid));
  assert.equal(await nativeJsonSha256(projected),await nativeJsonSha256(body));
  assert.equal(projector.project("history.snapshot.head","standard",head).schema_version,"jungsi.history-snapshot/v2");
  const oldRegistry=JSON.parse(readFileSync(new URL("./fixtures/p1_public_registry_799.reference.json",import.meta.url),"utf8"));
  const oldProjector=new PublicResponseProjection(oldRegistry,oldRegistry.operations.map(x=>({id:x.id,contract_ref:x.contract_ref})));
  assert.throws(()=>oldProjector.project("history.snapshot.head","standard",head));
  assert.throws(()=>oldProjector.project("history.snapshot.read","standard",body));
  const oldService=new LegacyHistorySnapshotService(port,{nowUtc:()=>1n},SCOPE);
  await assert.rejects(oldService.read(session,"SYN-V2",{}));
  await assert.rejects(validateQualifiedHistorySnapshotPayload(body,part,{...pub,schemaVersion:"jungsi.history-snapshot/v1"}));
  const row2027=structuredClone(body.rows.find(r=>r.academic_year===2027));
  row2027.identity_review={status:"metadata_pending",reason_code:"SYN_REVIEW",variants:[{
    university_name:"SYN SCHOOL",department:"SYN DEPARTMENT",admission_track:"SYN-TRACK",group:"SYN-GROUP"}]};
  const rank={...emptyCell("final_additional_admission_rank"),value:"17",status:"pending_metadata",
    reason_code:"SYN_REVIEW",unit:null,source_context:{observation_id:"observation:"+"8".repeat(64),
      identity_variant_index:0,scope_status:"review_pending"}};
  row2027.final_additional_admission_rank=rank;
  const subject={observation_id:rank.source_context.observation_id,academic_year:2027,offering_pk:row2027.original_pk,identity_variant_index:0};
  const grant={field:"final_additional_admission_rank",subject,expected_raw_cell_sha256:await nativeJsonSha256(rank),
    expected_native_value_type:"string",expected_raw_status:"pending_metadata",expected_raw_unit:null,
    expected_identity_review_sha256:await nativeJsonSha256(row2027.identity_review)};
  const authority="9".repeat(64),previous="7".repeat(64);
  const receipt=encode({format:"jungsi.history-field-qualification-receipt/v1",status:"approved_exact_fields",
    authority_sha256:authority,source_head_sha256:H,scope_sha256:SCOPE,expected_previous_manifest_sha256:previous,subjects:[grant]});
  const receiptSha=await hash(receipt), approval={...grant,authority_sha256:authority,qualification_receipt_sha256:receiptSha};
  const q={format:"jungsi.history-field-service-qualification/v1",authority_sha256:authority,
    qualification_receipt_sha256:receiptSha,subject,normalized_service_fields:{status:"verified_official",unit:"번"}};
  row2027.final_additional_admission_rank={...rank,service_qualification:q};
  const qualification=await bindFieldQualificationPublication([approval],receipt,{
    publicationSha256:pub.publicationSha256,sourceHeadSha256:H,scopeSha256:SCOPE,authoritySha256:authority,
    qualificationReceiptSha256:receiptSha,previousManifestSha256:previous,expectedSubjectCount:1});
  const onePart={...part,rows:1,mappedRows:1,mappingPendingRows:0};
  const oldRow={...row2027}; delete oldRow.r27_source;
  const legacyBody={format:"jungsi.history-snapshot/v1",payload_id:part.payloadId,part_id:null,rows:[oldRow]};
  await assert.doesNotReject(validateLegacyQualified(legacyBody,onePart,{...pub,schemaVersion:"jungsi.history-snapshot/v1",fieldQualification:qualification}));
  const v2Qualified={format:"jungsi.history-snapshot/v2",payload_id:part.payloadId,part_id:null,rows:[row2027]};
  await assert.rejects(validateQualifiedHistorySnapshotPayload(v2Qualified,onePart,Object.freeze({...pub,fieldQualification:qualification})));
  const tampered=structuredClone(body), altered=tampered.rows.find(r=>r.academic_year===2027);
  altered.r27_source.quota.quota_value=1; altered.recruitment_count_with_stage.value=1;
  assert.doesNotThrow(()=>validateHistorySnapshotPayload(tampered,part));
  await assert.rejects(validateQualifiedHistorySnapshotPayload(tampered,part,pub));
  const noIndex=new HistorySnapshotService({...port,async current(){return Object.freeze({...pub,r27ScopeIndex:undefined});}},{nowUtc:()=>1n},SCOPE);
  await assert.rejects(noIndex.head(session,{}));
  const fakeIndex=new HistorySnapshotService({...port,async current(){return Object.freeze({...pub,r27ScopeIndex:{kind:"verified_r27_scope_index"}});}},{nowUtc:()=>1n},SCOPE);
  await assert.rejects(fakeIndex.head(session,{}));
  const staleIndex=new HistorySnapshotService({...port,async current(){return Object.freeze({...pub,publicationSha256:"9".repeat(64)});}},{nowUtc:()=>1n},SCOPE);
  await assert.rejects(staleIndex.head(session,{}));
  const missingIndex={...index,entries:[]}, missingBytes=encode(missingIndex);
  const incomplete=await bindR27ScopeIndex(missingBytes,{...scopePins,indexSha256:await hash(missingBytes)});
  await assert.rejects(assertR27ScopeIndex(incomplete,pub.publicationSha256,H,SCOPE,body.rows));
  await assert.rejects(validateQualifiedHistorySnapshotPayload(body,part,Object.freeze({...pub,r27ScopeIndex:incomplete})));
  const conflicting={...index,entries:[...index.entries,{...index.entries[0],university_id:"SYN-OTHER"}]};
  const conflictBytes=encode(conflicting);
  await assert.rejects(bindR27ScopeIndex(conflictBytes,{...scopePins,indexSha256:await hash(conflictBytes)}));
  current=false; await assert.rejects(service.read(session,"SYN-V2",{}));
});
await test("publisher_global_parts_reject_duplicate_missing_and_oversize", async () => {
  const a=sourceRow({original_pk:"SYN-A"}), b=sourceRow({original_pk:"SYN-B"});
  const f=await fixture([a,b]), candidate=await f.build(), rows=candidate.body.rows;
  const index=await buildCandidateR27ScopeIndex(candidate,f.context), bytes=encode(index);
  const scopeIndex=await bindR27ScopeIndex(bytes,{indexSha256:await hash(bytes),publicationSha256:"1".repeat(64),
    sourceHeadSha256:H,scopeSha256:SCOPE,coverageSha256:candidate.coverage_sha256});
  const one={format:"jungsi.history-snapshot/v2",payload_id:"SYN-NEW-PAYLOAD",part_id:"SYN-PART-A",rows:[rows[0],rows[1]]};
  const two={format:"jungsi.history-snapshot/v2",payload_id:"SYN-NEW-PAYLOAD",part_id:"SYN-PART-B",rows:[rows[2]]};
  async function partSet(bodies) {
    const parts=[], contents=[];
    for (let i=0;i<bodies.length;i++) {
      const content=encode(bodies[i]); contents.push(content);
      parts.push({partId:bodies[i].part_id,payloadId:bodies[i].payload_id,gzipBytes:1,gzipSha256:"2".repeat(64),
        decodedBytes:content.length,decodedSha256:await hash(content),rows:bodies[i].rows.length,
        mappedRows:bodies[i].rows.filter(r=>r.mapping_status==="mapped").length,
        mappingPendingRows:bodies[i].rows.filter(r=>r.mapping_status==="mapping_pending").length,objectKey:"SYN-"+i});
    }
    const publication={snapshotId:"SYN-V2",publicationSha256:"1".repeat(64),sourceHeadSha256:H,scopeSha256:SCOPE,
      generatedAt:"2026-01-01T00:00:00Z",sourceAsOf:null,schemaVersion:"jungsi.history-snapshot/v2",
      normalizationRulesVersion:"SYN",selectionRulesVersion:"SYN",expiresAtUtc:9999999n,
      counts:{rows:3,mapped_rows:3,mapping_pending_rows:0,observations:0,schools:1},full:null,parts,r27ScopeIndex:scopeIndex};
    return {publication,contents,parts};
  }
  const limits={maxParts:2,maxRows:10,maxDecodedBytes:100000,maxPartBytes:100000,maxDepth:64};
  const good=await partSet([one,two]);
  const valid=await validateP1PreparedPartsGlobal(good.publication,good.contents,limits);
  assert.deepEqual(valid,{status:"HOLD_UNPUBLISHED",partsChecked:2,rowsChecked:3});
  const duplicate={...two,rows:[rows[1]]}, dup=await partSet([one,duplicate]);
  await assert.doesNotReject(validateQualifiedHistorySnapshotPayloadForPublisher(one,dup.parts[0],dup.publication));
  await assert.rejects(validateQualifiedHistorySnapshotPayload(one,dup.parts[0],dup.publication));
  await assert.doesNotReject(validateQualifiedHistorySnapshotPayloadForPublisher(duplicate,dup.parts[1],dup.publication));
  await assert.rejects(validateQualifiedHistorySnapshotPayload(duplicate,dup.parts[1],dup.publication));
  await assert.rejects(validateP1PreparedPartsGlobal(dup.publication,dup.contents,limits));
  const replacement=historical(2025,{original_pk:"SYN-DIFFERENT",offering_id:"2025:SYN-DIFFERENT"});
  const missing=await partSet([one,{...two,rows:[replacement]}]);
  await assert.rejects(validateP1PreparedPartsGlobal(missing.publication,missing.contents,limits));
  await assert.rejects(validateP1PreparedPartsGlobal(good.publication,good.contents.slice(0,1),limits));
  await assert.rejects(validateP1PreparedPartsGlobal(good.publication,good.contents,{...limits,maxRows:2}));
  await assert.rejects(validateP1PreparedPartsGlobal(good.publication,good.contents,{...limits,maxDecodedBytes:1}));
  const mutableLimits={...limits}, mutableBytes=good.contents.map(x=>Uint8Array.from(x));
  const pending=validateP1PreparedPartsGlobal(good.publication,mutableBytes,mutableLimits);
  mutableBytes[1][0]^=1; mutableLimits.maxRows=0;
  assert.equal((await pending).rowsChecked,3);
});
await test("assembled_candidate_is_sealed_and_cannot_be_rebound_after_mutation", async () => {
  const f=await fixture([sourceRow()]), candidate=await f.build();
  const row=candidate.body.rows.find(r=>r.academic_year===2027);
  assert.ok(Object.isFrozen(candidate) && Object.isFrozen(candidate.body) &&
    Object.isFrozen(candidate.body.rows) && Object.isFrozen(row.r27_source.quota));
  assert.throws(()=>{row.r27_source.quota.quota_value=9;},TypeError);
  const forgedBody=structuredClone(candidate.body), forgedRow=forgedBody.rows.find(r=>r.academic_year===2027);
  forgedRow.original_pk="SYN-FORGED"; forgedRow.offering_id="2027:SYN-FORGED";
  forgedRow.r27_source.scope_key=JSON.stringify([2027,forgedRow.university_id,forgedRow.original_pk,
    forgedRow.campus,forgedRow.admission_track,forgedRow.group]);
  forgedRow.r27_source.quota.quota_value=9; forgedRow.recruitment_count_with_stage.value=9;
  const forged={...candidate,body:forgedBody};
  assert.doesNotThrow(()=>validateHistorySnapshotPayload(forged.body,forged.counts));
  await assert.rejects(buildCandidateR27ScopeIndex(forged,f.context),/candidate_scope_unresolved/);
});
await test("held_rows_and_exclusion_count_are_sealed", async () => {
  const a=sourceRow(), b=sourceRow({original_pk:"SYN-HELD",scope:{state:"review_pending",evidence_sha256:null}});
  const f=await fixture([a,b]), candidate=await f.build();
  assert.equal(candidate.held_rows.length,1);
  await assert.rejects(buildCandidateR27ScopeIndex(candidate,f.context),/candidate_scope_unresolved/);
  assert.throws(()=>candidate.held_rows.pop(),TypeError);
  assert.throws(()=>{candidate.excluded_count=1;},TypeError);
  const forged={...candidate,held_rows:[],excluded_count:1};
  await assert.rejects(buildCandidateR27ScopeIndex(forged,f.context),/candidate_scope_unresolved/);
});
await test("independent_scope_and_value_mutation_is_rejected",async()=>{
  const f=await fixture([sourceRow()]), out=await f.build();const row=out.body.rows.find(r=>r.academic_year===2027);
  assert.throws(()=>{row.original_pk="SYN-CHANGED"},TypeError);
  assert.throws(()=>{row.r27_source.quota.quota_value=999},TypeError);
  const candidate={...out,body:structuredClone(out.body)}, r=candidate.body.rows.find(x=>x.academic_year===2027);
  r.original_pk="SYN-CHANGED";r.offering_id="2027:SYN-CHANGED";
  r.r27_source.scope_key=JSON.stringify([r.academic_year,r.university_id,r.original_pk,r.campus,r.admission_track,r.group]);
  r.r27_source.quota.quota_value=999;r.recruitment_count_with_stage.value=999;
  await assert.rejects(buildCandidateR27ScopeIndex(candidate,f.context));
});
await test("independent_held_and_excluded_counter_mutation_is_rejected",async()=>{
  const f=await fixture([sourceRow({original_pk:"SYN-OK"}),sourceRow({original_pk:"SYN-HOLD",scope:{state:"review_pending",evidence_sha256:null}})]),out=await f.build();
  assert.equal(out.held_rows.length,1);assert.throws(()=>{out.held_rows.length=0},TypeError);assert.throws(()=>{out.excluded_count=1},TypeError);
  await assert.rejects(buildCandidateR27ScopeIndex({...out,held_rows:[],excluded_count:1},f.context));
});
await test("independent_whole_part_duplicate_reader_boundary",async()=>{
  const f=await fixture([sourceRow({original_pk:"SYN-A"}),sourceRow({original_pk:"SYN-B"})]);
  const out=await f.build(),rows=out.body.rows,index=await buildCandidateR27ScopeIndex(out,f.context),indexBytes=encode(index);
  const scopeIndex=await bindR27ScopeIndex(indexBytes,{indexSha256:await hash(indexBytes),publicationSha256:"1".repeat(64),sourceHeadSha256:H,scopeSha256:SCOPE,coverageSha256:out.coverage_sha256});
  const bodies=[{format:"jungsi.history-snapshot/v2",payload_id:"SYN-NEW-PAYLOAD",part_id:"SYN-A",rows:[rows[0],rows[1]]},
    {format:"jungsi.history-snapshot/v2",payload_id:"SYN-NEW-PAYLOAD",part_id:"SYN-B",rows:[rows[1]]}];
  const raw=bodies.map(encode),parts=[];
  for(let i=0;i<2;i++)parts.push({partId:bodies[i].part_id,payloadId:bodies[i].payload_id,decodedBytes:raw[i].length,decodedSha256:await hash(raw[i]),rows:bodies[i].rows.length,mappedRows:bodies[i].rows.length,mappingPendingRows:0});
  const pub={snapshotId:"SYN-V2",publicationSha256:"1".repeat(64),sourceHeadSha256:H,scopeSha256:SCOPE,expiresAtUtc:9999999n,
    schemaVersion:"jungsi.history-snapshot/v2",counts:{rows:3,mapped_rows:3,mapping_pending_rows:0,observations:0,schools:1},full:null,parts,r27ScopeIndex:scopeIndex};
  await assert.doesNotReject(validateQualifiedHistorySnapshotPayloadForPublisher(bodies[0],parts[0],pub));
  await assert.rejects(validateQualifiedHistorySnapshotPayload(bodies[0],parts[0],pub));
  await assert.doesNotReject(validateQualifiedHistorySnapshotPayloadForPublisher(bodies[1],parts[1],pub));
  await assert.rejects(validateQualifiedHistorySnapshotPayload(bodies[1],parts[1],pub));
  await assert.rejects(validateP1PreparedPartsGlobal(pub,raw,{maxParts:2,maxRows:10,maxDecodedBytes:100000,maxPartBytes:100000,maxDepth:64}));
});
await test("independent_limits_reject_before_any_byte_copy",async()=>{
  const original=Uint8Array.prototype.set;let copies=0;
  Uint8Array.prototype.set=function(...args){copies++;return original.apply(this,args)};
  try {
    const limits={maxParts:2,maxRows:1,maxDecodedBytes:99,maxPartBytes:64,maxDepth:16};
    const part=(bytes,rows)=>({partId:"SYN-PART",decodedBytes:bytes,rows});
    const pub=parts=>({schemaVersion:"jungsi.history-snapshot/v2",parts,full:null,counts:{}});
    await assert.rejects(validateP1PreparedPartsGlobal(pub([part(65,1)]),[new Uint8Array(65)],limits));
    await assert.rejects(validateP1PreparedPartsGlobal(pub([part(50,0),part(50,0)]),[new Uint8Array(50),new Uint8Array(50)],limits));
    await assert.rejects(validateP1PreparedPartsGlobal(pub([part(40,2)]),[new Uint8Array(40)],limits));
    assert.equal(copies,0);
  } finally {Uint8Array.prototype.set=original;}
});
process.stdout.write(JSON.stringify({cases:results.length,status:"PASS_SYNTHETIC_ONLY",v1_and_v2_service:true})+"\n");
