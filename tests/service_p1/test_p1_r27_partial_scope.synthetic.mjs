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
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { bindR27ScopeIndex, assertR27ScopeIndex } from "../../supabase/functions/_shared/jungsi/application/history_r27_scope_index.ts";
import { prepareP1R27GlobalReceipt } from "../../supabase/functions/_shared/jungsi/application/p1_r27_release_gate.ts";
import { p1R27DeliveryDigest } from "../../supabase/functions/_shared/jungsi/application/p1_r27_delivery_digest.ts";
import { bindP1R27ConsumerGate, assertP1R27ConsumerGate } from "../../supabase/functions/_shared/jungsi/application/p1_r27_consumer_gate.ts";
import { bindReviewedR27Scope, combineReviewedR27Scopes, bindReviewedR27Links, projectStandaloneR27Row } from "../../supabase/functions/_shared/jungsi/application/r27_standalone.ts";
import { bindHistoricalReferencePublication } from "../../supabase/functions/_shared/jungsi/application/history_reference_estimates.ts";
import { bindFieldQualificationPublication } from "../../supabase/functions/_shared/jungsi/application/history_field_qualification.ts";
import { rebindP1R27Candidate, bindP1R27Evidence, composeP1R27Candidate, buildCandidateR27ScopeIndex, buildCandidateR27PartialScopeIndex, buildCandidateR27PartialBody } from "../../supabase/functions/_shared/jungsi/application/p1_r27_composition.ts";

const S = "a".repeat(64), H = "b".repeat(64), OLD = "c".repeat(64), PUB = "d".repeat(64), SCOPE = "e".repeat(64), EV = "f".repeat(64);
const rebindAuthority = { revoked:false, hang:false, calls:0, scopes:[], async assertCurrent(scope) {
  this.calls++; this.scopes.push(scope);
  assert.equal(typeof scope.source_head_sha256,"string");
  if(this.revoked) throw Error("SYN_APPROVAL_REVOKED");
  if(this.hang && scope.phase==="publication") return await new Promise(()=>{});
} };
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
  const previous = opts.previous ?? await previousPort(groups);
  const e = await evidenceFor(rows, opts.coverage ?? {}, previous.pub.publicationSha256);
  const context = await bindP1R27Evidence(e.manifestBytes, e.coverageBytes, e.pins);
  const scope = await scopes(rows), link = opts.linkContextFactory ? await opts.linkContextFactory(previous.pub.publicationSha256) : (opts.linkContext ?? await links(opts.links ?? []));
  const source = { calls: 0, finishes: 0, pages: e.pageBytes, failFinish: false,
    async readPage(index) { this.calls++; return this.pages[index]; },
    async assertSourceHead(head) { this.finishes++; assert.equal(head, H); if (this.failFinish) throw Error("SYN_SOURCE_CHANGED"); },
  };
  return { ...e, context, scope, link, previous, source,
    build: () => composeP1R27Candidate(previous, source, context, scope, link, "SYN-NEW-PAYLOAD",
      buildLimits()) };
}

await test("partial_scope_holds_unknown_and_excludes_practical_with_pinned_public_counts", async () => {
  // Synthetic pins below check parsing/identity only; they never authorize actual scope.
  const typedRow=sourceRow({original_pk:"SYN-STRICT-TYPES"});
  const makeScope=async state=>{
    const bytes=encode({format:"jungsi.r27-reviewed-scope/v1",status:"approved_scope_mappings",source_sha256:S,
      grants:[{source:ident(typedRow),state,evidence_sha256:EV}]});
    return bindReviewedR27Scope(bytes,{receiptSha256:await hash(bytes),sourceSha256:S});
  };
  for(const state of ["eligible_non_practical","excluded_practical"]) {
    const context=await makeScope(state),row={...typedRow,scope:{state,evidence_sha256:EV}};
    const projected=projectStandaloneR27Row(row,undefined,S,context);
    assert.equal(projected.disposition,state==="eligible_non_practical"?"eligible":"excluded");
  }
  for(const state of [["eligible_non_practical"],["excluded_practical"],{},7,null,true]) {
    await assert.rejects(makeScope(state),/invalid_scope_grant/);
  }
  const eligibleScope=await makeScope("eligible_non_practical");
  for(const state of [["eligible_non_practical"],["review_pending"],{},7,null,true]) {
    const row={...typedRow,scope:{state,evidence_sha256:EV}};
    assert.throws(()=>projectStandaloneR27Row(row,undefined,S,eligibleScope),/invalid_scope/);
  }
  const pending=projectStandaloneR27Row({...typedRow,scope:{state:"review_pending",evidence_sha256:null}});
  assert.equal(pending.disposition,"held");
  const prior=target(historical(2026,{original_pk:"SYN-STRICT-PRIOR"}));
  const goodLink=await links([grant(typedRow,prior)]);
  const linked=projectStandaloneR27Row(typedRow,goodLink,S,eligibleScope);
  assert.equal(linked.row.history_link_status,"exact_reviewed");
  for(const bad of [["approved"],{},7,null,true]) {
    await assert.rejects(links([{...grant(typedRow,prior),review_state:bad}]),/invalid_link_grant/);
  }
  const a=sourceRow({original_pk:"SYN-INCLUDED",campus:null,group:null,quota_value:null,quota_literal_state:"null",quota_condition_text:"SYN CONDITIONAL"});
  const b=sourceRow({original_pk:"SYN-HOLD",scope:{state:"review_pending",evidence_sha256:null}});
  const c=sourceRow({original_pk:"SYN-EXCLUDED",scope:{state:"excluded_practical",evidence_sha256:EV}});
  const f=await fixture([a,b,c]), out=await f.build();
  await assert.rejects(buildCandidateR27ScopeIndex(out,f.context),/candidate_scope_unresolved/);
  await assert.rejects(buildCandidateR27PartialScopeIndex({...out},f.context),/candidate_partial_scope_unresolved/);
  const index=await buildCandidateR27PartialScopeIndex(out,f.context);
  assert.deepEqual([index.source_rows,index.included_rows,index.excluded_rows,index.review_pending_rows],[3,1,1,1]);
  assert.equal(index.coverage_status,"partial");
  assert.equal(index.entries.length,1);
  assert.equal(index.entries[0].original_pk,"SYN-INCLUDED");
  assert.equal(index.entries[0].campus,null);
  assert.equal(index.entries[0].group,null);
  assert.equal(nativeJsonText(index).includes("SYN-HOLD"),false);
  assert.equal(nativeJsonText(index).includes("SYN-EXCLUDED"),false);
  const partialBody=buildCandidateR27PartialBody(out,f.context,index);
  const raw=encode(partialBody), compressed=gzipSync(raw), decoded=gunzipSync(compressed);
  const part={...out.counts,gzipBytes:compressed.length,gzipSha256:await hash(compressed),
    decodedBytes:raw.length,decodedSha256:await hash(raw),objectKey:"SYN-PRIVATE-BODY"};
  const counts={rows:out.counts.rows,mapped_rows:out.counts.mappedRows,mapping_pending_rows:out.counts.mappingPendingRows,observations:0,schools:1};
  const wirePart={part_id:part.partId,payload_id:part.payloadId,object_key:part.objectKey,gzip_bytes:part.gzipBytes,gzip_sha256:part.gzipSha256,decoded_bytes:part.decodedBytes,decoded_sha256:part.decodedSha256,rows:part.rows,mapped_rows:part.mappedRows,mapping_pending_rows:part.mappingPendingRows};
  const manifest={format:"jungsi.history-snapshot-manifest/v1",status:"approved",snapshot_id:"SYN-PARTIAL",source_head_sha256:H,scope_sha256:SCOPE,
    generated_at:"2026-01-01T00:00:00Z",source_as_of:"2026-01-01",schema_version:"jungsi.history-snapshot/v2",
    normalization_rules_version:"SYN",normalization_rules_sha256:"1".repeat(64),selection_rules_version:"SYN",selection_rules_sha256:"2".repeat(64),
    counts,full:wirePart,parts:[]};
  const manifestBytes=encode(manifest), manifestSha=await hash(manifestBytes),indexBytes=encode(index),indexSha=await hash(indexBytes);
  const beforeGate=Object.freeze({snapshotId:"SYN-PARTIAL",publicationSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,
    generatedAt:manifest.generated_at,sourceAsOf:manifest.source_as_of,schemaVersion:manifest.schema_version,
    normalizationRulesVersion:"SYN",selectionRulesVersion:"SYN",expiresAtUtc:9999999n,
    counts:Object.freeze({...counts}),full:Object.freeze({...part}),parts:Object.freeze([])});
  const limits={maxParts:4,maxRows:20,maxDecodedBytes:262144,maxPartBytes:131072,maxDepth:64,maxTotalGzipBytes:262144,maxPartGzipBytes:131072,maxManifestBytes:65536,maxIndexBytes:65536,timeoutMs:5000};
  await assert.rejects(prepareP1R27GlobalReceipt(beforeGate,manifestBytes,indexBytes,indexSha,out.coverage_sha256,[Uint8Array.from(compressed)],limits));
  await assert.rejects(prepareP1R27GlobalReceipt(beforeGate,manifestBytes,indexBytes,indexSha,out.coverage_sha256,[Uint8Array.from(compressed)],limits,{...index}));
  const global=await prepareP1R27GlobalReceipt(beforeGate,manifestBytes,indexBytes,indexSha,out.coverage_sha256,[Uint8Array.from(compressed)],limits,index),globalBytes=encode(global);
  const consumer={format:"jungsi.p1-r27-consumer-approval/v2",status:"approved",manifest_sha256:manifestSha,source_head_sha256:H,scope_sha256:SCOPE,
    consumer_build_sha256:"3".repeat(64),consumer_contract_sha256:"4".repeat(64),r27_scope_key_supported:true,r27_partial_coverage_supported:true,expires_at_utc_micros:"9999999"};
  const consumerBytes=encode(consumer),headSha="5".repeat(64);
  const pins={headSha256:headSha,manifestSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,indexSha256:indexSha,coverageSha256:out.coverage_sha256,
    globalReceiptSha256:await hash(globalBytes),consumerReceiptSha256:await hash(consumerBytes),consumerBuildSha256:"3".repeat(64),consumerContractSha256:"4".repeat(64)};
  const legacyConsumer={...consumer,format:"jungsi.p1-r27-consumer-approval/v1"};
  delete legacyConsumer.r27_partial_coverage_supported;
  const legacyBytes=encode(legacyConsumer);
  await assert.rejects(bindP1R27ConsumerGate(beforeGate,indexBytes,globalBytes,legacyBytes,
    {...pins,consumerReceiptSha256:await hash(legacyBytes)},headSha,1n));
  const unsupportedBytes=encode({...consumer,r27_partial_coverage_supported:false});
  await assert.rejects(bindP1R27ConsumerGate(beforeGate,indexBytes,globalBytes,unsupportedBytes,
    {...pins,consumerReceiptSha256:await hash(unsupportedBytes)},headSha,1n));
  const gate=await bindP1R27ConsumerGate(beforeGate,indexBytes,globalBytes,consumerBytes,pins,headSha,1n);
  const boundIndex=await assertP1R27ConsumerGate(gate,beforeGate);
  const pub=Object.freeze({...beforeGate,r27ScopeIndex:boundIndex,r27Gate:gate});
  const port={async current(){return pub;},async read(){return parseNativeJson(new TextDecoder().decode(decoded));},async assertCurrent(){}};
  const service=new HistorySnapshotService(port,{nowUtc:()=>1n},SCOPE);
  const session={user:{subjectId:"SYN-USER",expiresAtUtc:9999999n},evaluatedAtUtc:1n,tier:"standard",paidUntilUtc:null};
  const head=await service.head(session,{});
  assert.deepEqual(head.r27_scope_coverage,{status:"partial",source_rows:3,included_rows:1,excluded_rows:1,review_pending_rows:1});
  const body=await service.read(session,"SYN-PARTIAL",{});
  const nullCampusRow=body.rows.find(r=>r.original_pk==="SYN-INCLUDED");
  assert.ok(nullCampusRow); assert.equal(nullCampusRow.campus,null);
  assert.equal(nullCampusRow.group,null);
  assert.equal(nullCampusRow.recruitment_count_with_stage.value,null);
  assert.equal(nullCampusRow.r27_source.quota.quota_value,null);
  assert.equal(nullCampusRow.r27_source.quota.quota_literal_state,"null");
  assert.equal(nullCampusRow.r27_source.quota.quota_condition_text,"SYN CONDITIONAL");
  assert.equal(nativeJsonText(body).includes("SYN-HOLD"),false);
  assert.equal(nativeJsonText(body).includes("SYN-EXCLUDED"),false);
  assert.equal(nativeJsonText(body).includes("SYN-PRIVATE-REF"),false);
  assert.deepEqual({...body.r27_scope_coverage},head.r27_scope_coverage);
  const missingNotice={...body}; delete missingNotice.r27_scope_coverage;
  await assert.rejects(validateQualifiedHistorySnapshotPayload(missingNotice,part,pub));
  const falseNotice={...body,r27_scope_coverage:{...body.r27_scope_coverage,review_pending_rows:0}};
  await assert.rejects(validateQualifiedHistorySnapshotPayload(falseNotice,part,pub));
  const registry=JSON.parse(readFileSync(new URL("../../src/jungsi_touch/application/public_response_schemas.json",import.meta.url),"utf8"));
  const projector=new PublicResponseProjection(registry,registry.operations.map(x=>({id:x.id,contract_ref:x.contract_ref})));
  assert.deepEqual({...projector.project("history.snapshot.head","standard",head).r27_scope_coverage},head.r27_scope_coverage);
  assert.doesNotThrow(()=>projector.project("history.snapshot.read","standard",body));
});
await test("partial_index_rejects_tampered_counts_and_empty_or_false_partial",async()=>{
  const f=await fixture([sourceRow({original_pk:"SYN-A"}),sourceRow({original_pk:"SYN-B",scope:{state:"review_pending",evidence_sha256:null}})]);
  const out=await f.build(), index=await buildCandidateR27PartialScopeIndex(out,f.context);
  for(const bad of [
    {...index,source_rows:3},
    {...index,review_pending_rows:0},
    {...index,coverage_status:"complete"},
    {...index,included_rows:0},
    {...index,excluded_rows:-1},
    {...index,extra_field:"SYN-PRIVATE"},
  ]) {
    const bytes=encode(bad);
    await assert.rejects(bindR27ScopeIndex(bytes,{indexSha256:await hash(bytes),publicationSha256:"1".repeat(64),
      sourceHeadSha256:H,scopeSha256:SCOPE,coverageSha256:out.coverage_sha256}));
  }
});
await test("partial_rejects_prior_held_2027_and_all_unknown",async()=>{
  const old=historical(2027,{original_pk:"SYN-OLD27",offering_id:"2027:SYN-OLD27",identity_review:{status:"review_pending",reason_code:"SYN_PENDING",variants:[]}});
  const pending=sourceRow({original_pk:"SYN-OLD27",scope:{state:"review_pending",evidence_sha256:null}});
  const f=await fixture([sourceRow({original_pk:"SYN-OK"}),pending],[[old]]);
  const out=await f.build();
  assert.ok(out.held_previous_rows.length>0);
  await assert.rejects(buildCandidateR27PartialScopeIndex(out,f.context),/candidate_partial_scope_unresolved/);
  const all=await fixture([sourceRow({original_pk:"SYN-ONLY",scope:{state:"review_pending",evidence_sha256:null}})]);
  await assert.rejects(buildCandidateR27PartialScopeIndex(await all.build(),all.context),/candidate_partial_scope_incomplete/);
});

await test("compose_head_assertions_require_exact_void",async()=>{
  for(const which of ["source","previous"]) {
    for(const value of [false,null,"throw"]) {
      const f=await fixture([sourceRow()]);
      const outcome=()=>{if(value==="throw")throw new Error("SYN_COMPOSE_"+which.toUpperCase()+"_EXCEPTION");return value;};
      if(which==="source")f.source.assertSourceHead=async expected=>{assert.equal(expected,H);return outcome();};
      else f.previous.assertCurrent=async expected=>{assert.equal(expected.previous_publication_sha256,f.previous.pub.publicationSha256);return outcome();};
      const expected=value==="throw"?new RegExp("SYN_COMPOSE_"+which.toUpperCase()+"_EXCEPTION"):
        new RegExp("compose_"+which+"_assert_invalid");
      await assert.rejects(f.build(),expected);
      if(which==="source")assert.equal(f.previous.finishes,0);
    }
  }
  const good=await (await fixture([sourceRow()])).build();
  assert.equal(good.status,"HOLD_UNPUBLISHED");
});


await test("new_2027_unknown_cells_are_not_falsely_unpublished_or_75_percent",async()=>{
  const f=await fixture([sourceRow()]), candidate=await f.build();
  const row=candidate.body.rows.find(x=>x.academic_year===2027);
  for(const slot of HISTORY_SNAPSHOT_SLOTS.filter(x=>x!=="recruitment_count_with_stage")){
    assert.equal(row[slot].value,null);
    assert.equal(row[slot].status,"pending_value_missing");
    assert.equal(row[slot].reason_code,"R27_OTHER_DATA_NOT_REVIEWED");
  }
  for(const slot of ["final_50_percent_cut","final_70_percent_cut","alternate_cut"])
    assert.equal(row[slot].statistic_percent,null);
});
await test("v2_2027_unmapped_row_cannot_bypass_scope_index",()=>{
  const row=historical(2027,{offering_id:null,original_pk:null,observation_key:"observation:"+"1".repeat(64),
    mapping_status:"mapping_pending",identity_review:{status:"mapping_pending",reason_code:"SYN_PENDING",variants:[]}});
  const body={format:"jungsi.history-snapshot/v2",payload_id:"SYN-P",part_id:null,rows:[row]};
  const part={payloadId:"SYN-P",partId:null,rows:1,mappedRows:0,mappingPendingRows:1};
  assert.throws(()=>validateHistorySnapshotPayload(body,part));
});
await test("old_2027_substantive_quota_is_preserved_or_held",async()=>{
  const old=historical(2027,{original_pk:"SYN-PK",offering_id:"2027:SYN-PK",department:"SYN DEPARTMENT"});
  old.recruitment_count_with_stage={...old.recruitment_count_with_stage,value:44,status:"pending_metadata",reason_code:"SYN_PREVIOUS",unit:"명"};
  const same=await (await fixture([sourceRow({quota_value:44})],[[old]])).build();
  assert.deepEqual({...same.body.rows[0].recruitment_count_with_stage},old.recruitment_count_with_stage);
  for(const source of [
    sourceRow({quota_value:null}),
    sourceRow({quota_value:45}),
    sourceRow({quota_value:44,quota_stage:"initial"}),
    sourceRow({quota_value:44,quota_condition_text:"SYN-CONDITIONAL"}),
  ]) {
    const candidate=await (await fixture([source],[[old]])).build();
    assert.equal(candidate.held_previous_rows.length,1);
    assert.deepEqual({...candidate.held_previous_rows[0].recruitment_count_with_stage},old.recruitment_count_with_stage);
  }
  const priorNotPublished=historical(2027,{original_pk:"SYN-PK",offering_id:"2027:SYN-PK",department:"SYN DEPARTMENT"});
  const conflict=await (await fixture([sourceRow({quota_value:44})],[[priorNotPublished]])).build();
  assert.equal(conflict.held_previous_rows.length,1);
  assert.equal(conflict.held_previous_rows[0].recruitment_count_with_stage.status,"not_published");
});
await test("sealed_partial_rejects_changed_historical_rows_even_if_manifest_is_rehashed",async()=>{
  const f=await fixture([sourceRow({original_pk:"SYN-A"}),sourceRow({original_pk:"SYN-B",scope:{state:"review_pending",evidence_sha256:null}})]);
  const out=await f.build(), index=await buildCandidateR27PartialScopeIndex(out,f.context), body=structuredClone(buildCandidateR27PartialBody(out,f.context,index));
  const historicalRow=body.rows.find(x=>x.academic_year===2026);
  historicalRow.competition_ratio={...historicalRow.competition_ratio,value:"SYN-TAMPER",status:"pending_metadata",reason_code:"SYN-CHANGED"};
  const raw=encode(body),compressed=gzipSync(raw), part={...out.counts,gzipBytes:compressed.length,gzipSha256:await hash(compressed),
    decodedBytes:raw.length,decodedSha256:await hash(raw),objectKey:"SYN-PRIVATE"};
  const counts={rows:out.counts.rows,mapped_rows:out.counts.mappedRows,mapping_pending_rows:out.counts.mappingPendingRows,observations:0,schools:1};
  const wire={part_id:part.partId,payload_id:part.payloadId,object_key:part.objectKey,gzip_bytes:part.gzipBytes,gzip_sha256:part.gzipSha256,decoded_bytes:part.decodedBytes,decoded_sha256:part.decodedSha256,rows:part.rows,mapped_rows:part.mappedRows,mapping_pending_rows:part.mappingPendingRows};
  const manifest={format:"jungsi.history-snapshot-manifest/v1",status:"approved",snapshot_id:"SYN-TAMPERED",source_head_sha256:H,scope_sha256:SCOPE,generated_at:"2026-01-01T00:00:00Z",source_as_of:"2026-01-01",schema_version:"jungsi.history-snapshot/v2",normalization_rules_version:"SYN",normalization_rules_sha256:"1".repeat(64),selection_rules_version:"SYN",selection_rules_sha256:"2".repeat(64),counts,full:wire,parts:[]};
  const manifestBytes=encode(manifest), indexBytes=encode(index);
  const pub={snapshotId:"SYN-TAMPERED",publicationSha256:await hash(manifestBytes),sourceHeadSha256:H,scopeSha256:SCOPE,
    generatedAt:manifest.generated_at,sourceAsOf:manifest.source_as_of,schemaVersion:manifest.schema_version,normalizationRulesVersion:"SYN",selectionRulesVersion:"SYN",expiresAtUtc:9999999n,counts,full:part,parts:[]};
  const limits={maxParts:4,maxRows:20,maxDecodedBytes:262144,maxPartBytes:131072,maxDepth:64,maxTotalGzipBytes:262144,maxPartGzipBytes:131072,maxManifestBytes:65536,maxIndexBytes:65536,timeoutMs:5000};
  await assert.rejects(prepareP1R27GlobalReceipt(pub,manifestBytes,indexBytes,await hash(indexBytes),out.coverage_sha256,[Uint8Array.from(compressed)],limits,index),/candidate_rows_changed/);
});


await test("old_unknown_reason_and_labels_cannot_be_erased",async()=>{
  for(const changed of [
    {reason_code:"SYN_OLD_REASON"},
    {statistic_label:"SYN_ORIGINAL_LABEL"},
    {cohort:"SYN_ORIGINAL_COHORT"},
  ]) {
    const old=historical(2027,{original_pk:"SYN-PK",offering_id:"2027:SYN-PK",department:"SYN DEPARTMENT"});
    old.recruitment_count_with_stage={...old.recruitment_count_with_stage,status:"pending_value_missing",reason_code:"R27_OTHER_DATA_NOT_REVIEWED",...changed};
    const conflict=await (await fixture([sourceRow({quota_value:44})],[[old]])).build();
    assert.equal(conflict.held_previous_rows.length,1);
    assert.deepEqual({...conflict.held_previous_rows[0].recruitment_count_with_stage},old.recruitment_count_with_stage);
  }
});


await test("old_quota_unit_conflicts_are_held_and_explicit_unspecified_stage_is_supported",async()=>{
  const old=historical(2027,{original_pk:"SYN-PK",offering_id:"2027:SYN-PK",department:"SYN DEPARTMENT"});
  old.recruitment_count_with_stage={...old.recruitment_count_with_stage,value:44,status:"pending_metadata",reason_code:"SYN_PREV",unit:"명"};
  const same=sourceRow({quota_value:44,quota_stage:"unspecified",quota_cell:{status:"pending_metadata",reason_code:"SYN_META",unit:"명",source_as_of:null}});
  const accepted=await (await fixture([same],[[old]])).build();
  assert.equal(accepted.held_previous_rows.length,0);
  assert.deepEqual({...accepted.body.rows[0].recruitment_count_with_stage},old.recruitment_count_with_stage);
  const diff=sourceRow({quota_value:44,quota_stage:"unspecified",quota_cell:{status:"pending_metadata",reason_code:"SYN_META",unit:"번",source_as_of:null}});
  const held=await (await fixture([diff],[[old]])).build();
  assert.equal(held.held_previous_rows.length,1);
});


await test("partial_candidate_cannot_be_repackaged_as_complete_index",async()=>{
  const f=await fixture([sourceRow({original_pk:"SYN-A"}),sourceRow({original_pk:"SYN-B",scope:{state:"review_pending",evidence_sha256:null}})]);
  const out=await f.build(), partial=await buildCandidateR27PartialScopeIndex(out,f.context);
  const fakeIndex={format:"jungsi.r27-global-scope-index/v1",source_head_sha256:partial.source_head_sha256,scope_sha256:partial.scope_sha256,coverage_sha256:partial.coverage_sha256,entries:partial.entries};
  const raw=encode(out.body),compressed=gzipSync(raw),part={...out.counts,gzipBytes:compressed.length,gzipSha256:await hash(compressed),decodedBytes:raw.length,decodedSha256:await hash(raw),objectKey:"SYN-PRIVATE"};
  const counts={rows:out.counts.rows,mapped_rows:out.counts.mappedRows,mapping_pending_rows:out.counts.mappingPendingRows,observations:0,schools:1};
  const wire={part_id:part.partId,payload_id:part.payloadId,object_key:part.objectKey,gzip_bytes:part.gzipBytes,gzip_sha256:part.gzipSha256,decoded_bytes:part.decodedBytes,decoded_sha256:part.decodedSha256,rows:part.rows,mapped_rows:part.mappedRows,mapping_pending_rows:part.mappingPendingRows};
  const manifest={format:"jungsi.history-snapshot-manifest/v1",status:"approved",snapshot_id:"SYN-FALSE-FULL",source_head_sha256:H,scope_sha256:SCOPE,generated_at:"2026-01-01T00:00:00Z",source_as_of:"2026-01-01",schema_version:"jungsi.history-snapshot/v2",normalization_rules_version:"SYN",normalization_rules_sha256:"1".repeat(64),selection_rules_version:"SYN",selection_rules_sha256:"2".repeat(64),counts,full:wire,parts:[]};
  const manifestBytes=encode(manifest),indexBytes=encode(fakeIndex);
  const pub={snapshotId:"SYN-FALSE-FULL",publicationSha256:await hash(manifestBytes),sourceHeadSha256:H,scopeSha256:SCOPE,generatedAt:manifest.generated_at,sourceAsOf:manifest.source_as_of,schemaVersion:manifest.schema_version,normalizationRulesVersion:"SYN",selectionRulesVersion:"SYN",expiresAtUtc:9999999n,counts,full:part,parts:[]};
  const limits={maxParts:4,maxRows:20,maxDecodedBytes:262144,maxPartBytes:131072,maxDepth:64,maxTotalGzipBytes:262144,maxPartGzipBytes:131072,maxManifestBytes:65536,maxIndexBytes:65536,timeoutMs:5000};
  await assert.rejects(prepareP1R27GlobalReceipt(pub,manifestBytes,indexBytes,await hash(indexBytes),out.coverage_sha256,[Uint8Array.from(compressed)],limits,fakeIndex),/candidate_index_unsealed/);
});


await test("exact_prior_unknown_placeholder_can_receive_new_quota_without_losing_other_cells",async()=>{
  const old=historical(2027,{original_pk:"SYN-PK",offering_id:"2027:SYN-PK",department:"SYN DEPARTMENT"});
  old.recruitment_count_with_stage={...old.recruitment_count_with_stage,status:"pending_value_missing",reason_code:"R27_OTHER_DATA_NOT_REVIEWED"};
  old.competition_ratio={...old.competition_ratio,value:"SYN-PREV",status:"pending_metadata",reason_code:"SYN_PENDING"};
  const result=await (await fixture([sourceRow()],[[old]])).build();
  assert.equal(result.body.rows[0].recruitment_count_with_stage.value,0);
  assert.equal(result.body.rows[0].competition_ratio.value,"SYN-PREV");
  assert.equal(result.held_previous_rows.length,0);
});


async function linksV2(grants, previousPublication = PUB, changes = {}) {
  const reviewBinding={source_head_sha256:H,previous_publication_sha256:previousPublication,
    previous_source_head_sha256:OLD,scope_sha256:SCOPE,authority_sha256:EV,...changes};
  const b = encode({format:"jungsi.r27-reviewed-links/v2",status:"approved_exact_mappings",
    source_sha256:S,review_binding:reviewBinding,grants});
  return bindReviewedR27Links(b,{receiptSha256:await hash(b),sourceSha256:S,reviewBinding});
}
function v2grant(r,t) {
  const states = id => Object.fromEntries(["campus","admission_track","group"].map(k=>[k,id[k]===null?"confirmed_null":"confirmed_value"]));
  const src=ident(r);
  return {source:src,target:t,review_state:"approved",evidence_sha256:EV,source_field_states:states(src),target_field_states:states(t)};
}
await test("v2_reviewed_changes_survive_composition_and_v1_stays_held", async()=>{
  for (const [row,old] of [
    [sourceRow({campus:null}),historical(2026,{campus:null})],
    [sourceRow(),historical(2026,{admission_track:"SYN-PREV-TRACK"})],
    [sourceRow(),historical(2026,{group:"SYN-PREV-GROUP"})],
  ]) {
    const tg=target(old);
    const result=await (await fixture([row],[[old]],{linkContextFactory:pub=>linksV2([v2grant(row,tg)],pub)})).build();
    const current=result.body.rows.find(r=>r.academic_year===2027);
    assert.equal(current.r27_source.history_link_status,"exact_reviewed");
    assert.deepEqual(current.r27_source.historical_links.map(x=>({...x})),[tg]);
    const legacy=await (await fixture([row],[[old]],{links:[grant(row,tg)]})).build();
    assert.equal(legacy.body.rows.find(r=>r.academic_year===2027).r27_source.history_link_status,"conflict_pending");
  }
});
await test("v2_missing_or_unknown_scope_cannot_become_confirmed_null",async()=>{
  const row=sourceRow({campus:null}), tg=target(historical(2026,{campus:null})), g=v2grant(row,tg);
  for (const state of ["unknown","absent","confirmed_value",null]) {
    const bad=structuredClone(g); bad.source_field_states.campus=state;
    await assert.rejects(linksV2([bad]));
  }
  const missing=structuredClone(g); delete missing.target_field_states.campus;
  await assert.rejects(linksV2([missing]));
  const bytes=encode({format:"jungsi.r27-reviewed-links/v2",status:"approved_exact_mappings",source_sha256:S,grants:[g]});
  await assert.rejects(bindReviewedR27Links(bytes,{receiptSha256:"0".repeat(64),sourceSha256:S}));
});
await test("v2_cross_school_and_ambiguous_target_are_held",async()=>{
  const a=sourceRow({original_pk:"SYN-A"}), b=sourceRow({original_pk:"SYN-B"}), old=historical();
  const cross={...target(old),school_id:"SYN-OTHER-SCHOOL"};
  const crossContext=await linksV2([v2grant(a,cross)]);
  const crossing=projectStandaloneR27Row(a,crossContext,S,await scopes([a]));
  assert.equal(crossing.row.history_link_status,"conflict_pending");
  const duplicate=await (await fixture([a,b],[[old]],{linkContextFactory:pub=>linksV2([v2grant(a,target(old)),v2grant(b,target(old))],pub)})).build();
  for(const row of duplicate.body.rows.filter(x=>x.academic_year===2027)) {
    assert.equal(row.r27_source.history_link_status,"conflict_pending");
    assert.equal(row.r27_source.historical_links.length,0);
  }
});


await test("v2_duplicated_historical_identity_never_links",async()=>{
  const row=sourceRow(), old=historical();
  const f=await fixture([row],[[old,structuredClone(old)]],{linkContextFactory:pub=>linksV2([v2grant(row,target(old))],pub)});
  await assert.rejects(f.build(),error=>error.code==="snapshot_invalid" && error.http===503);
});


await test("v2_receipt_rejects_replay_against_other_heads_or_scope",async()=>{
  const row=sourceRow(), old=historical(), g=v2grant(row,target(old));
  for (const changed of [
    {source_head_sha256:"1".repeat(64)},
    {previous_publication_sha256:"2".repeat(64)},
    {previous_source_head_sha256:"3".repeat(64)},
    {scope_sha256:"4".repeat(64)},
  ]) {
    const f=await fixture([row],[[old]],{linkContextFactory:pub=>linksV2([g],pub,changed)});
    await assert.rejects(f.build(),/review_binding_mismatch/);
  }
  const binding={source_head_sha256:H,previous_publication_sha256:PUB,
    previous_source_head_sha256:OLD,scope_sha256:SCOPE,authority_sha256:EV};
  const raw=encode({format:"jungsi.r27-reviewed-links/v2",status:"approved_exact_mappings",
    source_sha256:S,review_binding:binding,grants:[g]});
  await assert.rejects(bindReviewedR27Links(raw,{receiptSha256:await hash(raw),sourceSha256:S}));
  await assert.rejects(bindReviewedR27Links(raw,{receiptSha256:await hash(raw),sourceSha256:S,
    reviewBinding:{...binding,authority_sha256:"9".repeat(64)}}),/review_binding_mismatch/);
});


await test("independently_qualified_old_rank_is_preserved_but_new_index_remains_blocked",async()=>{
  const old=historical();
  old.identity_review={status:"review_pending",reason_code:"SYN-REVIEW",variants:[{
    university_name:"SYN SCHOOL",department:"SYN PRIOR",admission_track:"SYN-TRACK",group:"SYN-GROUP"
  }]};
  const subject={observation_id:"observation:"+S,academic_year:2026,offering_pk:old.original_pk,identity_variant_index:0};
  old.final_additional_admission_rank={...old.final_additional_admission_rank,value:"17",
    status:"pending_metadata",reason_code:"SYN-RAW",source_context:{
      observation_id:subject.observation_id,identity_variant_index:0,scope_status:"review_pending"
    }};
  const approval={field:"final_additional_admission_rank",subject,
    expected_raw_cell_sha256:await nativeJsonSha256(old.final_additional_admission_rank),
    expected_native_value_type:"string",expected_raw_status:"pending_metadata",expected_raw_unit:null,
    expected_identity_review_sha256:await nativeJsonSha256(old.identity_review)};
  const oldReceipt=encode({format:"jungsi.history-field-qualification-receipt/v1",status:"approved_exact_fields",
    authority_sha256:EV,source_head_sha256:OLD,scope_sha256:SCOPE,
    expected_previous_manifest_sha256:"6".repeat(64),subjects:[approval]});
  const oldReceiptSha=await hash(oldReceipt);
  const oldDescriptor=[{...approval,authority_sha256:EV,qualification_receipt_sha256:oldReceiptSha}];
  old.final_additional_admission_rank.service_qualification={format:"jungsi.history-field-service-qualification/v1",
    authority_sha256:EV,qualification_receipt_sha256:oldReceiptSha,subject,
    normalized_service_fields:{status:"verified_official",unit:"번"}};
  const previous=await previousPort([[old]]);
  previous.pub.fieldQualification=await bindFieldQualificationPublication(oldDescriptor,oldReceipt,{
    publicationSha256:previous.pub.publicationSha256,sourceHeadSha256:OLD,scopeSha256:SCOPE,
    authoritySha256:EV,qualificationReceiptSha256:oldReceiptSha,previousManifestSha256:"6".repeat(64),
    expectedSubjectCount:1});
  const f=await fixture([sourceRow()],[],{previous});
  const candidate=await f.build();
  assert.equal(candidate.rebind_required.length,1);
  assert.equal(candidate.rebind_required[0].kind,"field_qualification");
  assert.equal(nativeJsonText(candidate.rebind_required[0].row.final_additional_admission_rank.service_qualification),
    nativeJsonText(old.final_additional_admission_rank.service_qualification));
  const prior=candidate.body.rows.find(x=>x.academic_year===2026);
  assert.equal(prior.final_additional_admission_rank.value,"17");
  assert.equal(Object.hasOwn(prior.final_additional_admission_rank,"service_qualification"),false);
  await assert.rejects(buildCandidateR27ScopeIndex(candidate,f.context),/candidate_scope_unresolved/);
});


await test("unreviewed_link_cannot_cross_sealed_publisher_but_untrusted_all_pins_are_not_authority",async()=>{
  const row=sourceRow(), old=historical(2026,{group:"SYN-OLD-GROUP"});
  const f=await fixture([row],[[old]]),candidate=await f.build();
  const genuineIndex=await buildCandidateR27ScopeIndex(candidate,f.context);
  const forgedBody=structuredClone(candidate.body);
  const current=forgedBody.rows.find(x=>x.academic_year===2027);
  assert.equal(current.r27_source.history_link_status,"not_reviewed");
  current.r27_source.history_link_status="exact_reviewed";
  current.r27_source.historical_links=[target(old)];
  // Shape alone accepts the claimed same-school mapping; the approval gate is essential.
  assert.doesNotThrow(()=>validateHistorySnapshotPayload(forgedBody,candidate.counts));
  const fakeIndex=structuredClone(genuineIndex);
  fakeIndex.entries[0].row_sha256=await nativeJsonSha256(current);
  const raw=encode(forgedBody),compressed=gzipSync(raw);
  const part={...candidate.counts,gzipBytes:compressed.length,gzipSha256:await hash(compressed),
    decodedBytes:raw.length,decodedSha256:await hash(raw),objectKey:"SYN-PRIVATE"};
  const counts={rows:candidate.counts.rows,mapped_rows:candidate.counts.mappedRows,
    mapping_pending_rows:candidate.counts.mappingPendingRows,observations:0,schools:1};
  const wire={part_id:part.partId,payload_id:part.payloadId,object_key:part.objectKey,
    gzip_bytes:part.gzipBytes,gzip_sha256:part.gzipSha256,decoded_bytes:part.decodedBytes,
    decoded_sha256:part.decodedSha256,rows:part.rows,mapped_rows:part.mappedRows,
    mapping_pending_rows:part.mappingPendingRows};
  const manifest={format:"jungsi.history-snapshot-manifest/v1",status:"approved",snapshot_id:"SYN-FORGED",
    source_head_sha256:H,scope_sha256:SCOPE,generated_at:"2026-01-01T00:00:00Z",
    source_as_of:"2026-01-01",schema_version:"jungsi.history-snapshot/v2",
    normalization_rules_version:"SYN",normalization_rules_sha256:"1".repeat(64),
    selection_rules_version:"SYN",selection_rules_sha256:"2".repeat(64),counts,full:wire,parts:[]};
  const manifestBytes=encode(manifest),indexBytes=encode(fakeIndex),indexSha=await hash(indexBytes);
  const pub=Object.freeze({snapshotId:"SYN-FORGED",publicationSha256:await hash(manifestBytes),
    sourceHeadSha256:H,scopeSha256:SCOPE,generatedAt:manifest.generated_at,sourceAsOf:manifest.source_as_of,
    schemaVersion:manifest.schema_version,normalizationRulesVersion:"SYN",selectionRulesVersion:"SYN",
    expiresAtUtc:9999999n,counts:Object.freeze(counts),full:Object.freeze(part),parts:Object.freeze([])});
  const limits={maxParts:4,maxRows:20,maxDecodedBytes:262144,maxPartBytes:131072,maxDepth:64,
    maxTotalGzipBytes:262144,maxPartGzipBytes:131072,maxManifestBytes:65536,maxIndexBytes:65536,timeoutMs:5000};
  await assert.rejects(prepareP1R27GlobalReceipt(pub,manifestBytes,indexBytes,indexSha,
    candidate.coverage_sha256,[Uint8Array.from(compressed)],limits,fakeIndex),/candidate_index_unsealed/);
  // If an attacker also controls the supposedly trusted descriptor pins, a forged JSON
  // receipt can be made internally consistent. Hash checking is not issuer authentication.
  const global={format:"jungsi.p1-r27-global-validation/v1",status:"global_checks_passed",
    manifest_sha256:pub.publicationSha256,source_head_sha256:H,scope_sha256:SCOPE,
    coverage_sha256:candidate.coverage_sha256,index_sha256:indexSha,
    delivery_sha256:await p1R27DeliveryDigest(pub),parts_checked:1,rows_checked:counts.rows};
  const consumer={format:"jungsi.p1-r27-consumer-approval/v1",status:"approved",
    manifest_sha256:pub.publicationSha256,source_head_sha256:H,scope_sha256:SCOPE,
    consumer_build_sha256:"3".repeat(64),consumer_contract_sha256:"4".repeat(64),
    r27_scope_key_supported:true,expires_at_utc_micros:"9999999"};
  const globalBytes=encode(global),consumerBytes=encode(consumer),head="5".repeat(64);
  const pins={headSha256:head,manifestSha256:pub.publicationSha256,sourceHeadSha256:H,
    scopeSha256:SCOPE,indexSha256:indexSha,coverageSha256:candidate.coverage_sha256,
    globalReceiptSha256:await hash(globalBytes),consumerReceiptSha256:await hash(consumerBytes),
    consumerBuildSha256:"3".repeat(64),consumerContractSha256:"4".repeat(64)};
  const gate=await bindP1R27ConsumerGate(pub,indexBytes,globalBytes,consumerBytes,pins,head,1n);
  const boundIndex=await assertP1R27ConsumerGate(gate,pub);
  const forgedPub=Object.freeze({...pub,r27ScopeIndex:boundIndex,r27Gate:gate});
  const read=await validateQualifiedHistorySnapshotPayload(forgedBody,part,forgedPub);
  assert.equal(read.rows.find(x=>x.academic_year===2027).r27_source.history_link_status,"exact_reviewed");
});


await test("qualified_rank_rebinds_with_new_receipt_and_final_manifest_without_losing_original",async()=>{
  const old=historical();
  old.identity_review={status:"review_pending",reason_code:"SYN-REVIEW",variants:[{
    university_name:"SYN SCHOOL",department:"SYN PRIOR",admission_track:"SYN-TRACK",group:"SYN-GROUP"}]};
  const subject={observation_id:"observation:"+S,academic_year:2026,offering_pk:old.original_pk,identity_variant_index:0};
  old.final_additional_admission_rank={...old.final_additional_admission_rank,value:"17",
    status:"pending_metadata",reason_code:"SYN-RAW",source_context:{
      observation_id:subject.observation_id,identity_variant_index:0,scope_status:"review_pending"}};
  const approval={field:"final_additional_admission_rank",subject,
    expected_raw_cell_sha256:await nativeJsonSha256(old.final_additional_admission_rank),
    expected_native_value_type:"string",expected_raw_status:"pending_metadata",expected_raw_unit:null,
    expected_identity_review_sha256:await nativeJsonSha256(old.identity_review)};
  const oldBytes=encode({format:"jungsi.history-field-qualification-receipt/v1",status:"approved_exact_fields",
    authority_sha256:EV,source_head_sha256:OLD,scope_sha256:SCOPE,
    expected_previous_manifest_sha256:"6".repeat(64),subjects:[approval]});
  const oldSha=await hash(oldBytes),oldDescriptor=[{...approval,authority_sha256:EV,qualification_receipt_sha256:oldSha}];
  old.final_additional_admission_rank.service_qualification={format:"jungsi.history-field-service-qualification/v1",
    authority_sha256:EV,qualification_receipt_sha256:oldSha,subject,
    normalized_service_fields:{status:"verified_official",unit:"번"}};
  const previous=await previousPort([[old]]);
  previous.pub.fieldQualification=await bindFieldQualificationPublication(oldDescriptor,oldBytes,{
    publicationSha256:previous.pub.publicationSha256,sourceHeadSha256:OLD,scopeSha256:SCOPE,
    authoritySha256:EV,qualificationReceiptSha256:oldSha,previousManifestSha256:"6".repeat(64),expectedSubjectCount:1});
  const f=await fixture([sourceRow()],[],{previous}),candidate=await f.build();
  const newAuthority="8".repeat(64);
  const qBytes=encode({format:"jungsi.history-field-qualification-receipt/v1",status:"approved_exact_fields",
    authority_sha256:newAuthority,source_head_sha256:H,scope_sha256:SCOPE,
    expected_previous_manifest_sha256:previous.pub.publicationSha256,subjects:[approval]});
  const qSha=await hash(qBytes),descriptor=[{...approval,authority_sha256:newAuthority,qualification_receipt_sha256:qSha}];
  const proof={qualification:{descriptor_approvals:descriptor,receipt_bytes:qBytes,authority_sha256:newAuthority,
    receipt_sha256:qSha,expected_subject_count:1},reference:null};
  await assert.rejects(rebindP1R27Candidate(candidate,f.context,f.source,f.previous,rebindAuthority,
    {...proof,qualification:{...proof.qualification,receipt_sha256:"0".repeat(64)}}));
  assert.equal(candidate.rebind_required.length,1);
  const rebound=await rebindP1R27Candidate(candidate,f.context,f.source,f.previous,rebindAuthority,proof);
  assert.equal(rebound.rebind_required.length,0);
  assert.equal(candidate.rebind_required.length,1);
  const current=rebound.body.rows.find(x=>x.academic_year===2026);
  assert.equal(current.final_additional_admission_rank.value,"17");
  assert.equal(current.final_additional_admission_rank.status,"pending_metadata");
  assert.equal(current.final_additional_admission_rank.service_qualification.subject.observation_id,subject.observation_id);
  assert.equal(current.final_additional_admission_rank.service_qualification.qualification_receipt_sha256,qSha);
  const index=await buildCandidateR27ScopeIndex(rebound,f.context),indexBytes=encode(index);
  const raw=encode(rebound.body),compressed=gzipSync(raw);
  const part={...rebound.counts,gzipBytes:compressed.length,gzipSha256:await hash(compressed),
    decodedBytes:raw.length,decodedSha256:await hash(raw),objectKey:"SYN-PRIVATE"};
  const counts={rows:rebound.counts.rows,mapped_rows:rebound.counts.mappedRows,
    mapping_pending_rows:rebound.counts.mappingPendingRows,observations:0,schools:1};
  const wire={part_id:part.partId,payload_id:part.payloadId,object_key:part.objectKey,
    gzip_bytes:part.gzipBytes,gzip_sha256:part.gzipSha256,decoded_bytes:part.decodedBytes,
    decoded_sha256:part.decodedSha256,rows:part.rows,mapped_rows:part.mappedRows,
    mapping_pending_rows:part.mappingPendingRows};
  const manifest={format:"jungsi.history-snapshot-manifest/v1",status:"approved",snapshot_id:"SYN-REBOUND",
    source_head_sha256:H,scope_sha256:SCOPE,generated_at:"2026-01-01T00:00:00Z",source_as_of:"2026-01-01",
    schema_version:"jungsi.history-snapshot/v2",normalization_rules_version:"SYN",normalization_rules_sha256:"1".repeat(64),
    selection_rules_version:"SYN",selection_rules_sha256:"2".repeat(64),counts,full:wire,parts:[]};
  const manifestBytes=encode(manifest),manifestSha=await hash(manifestBytes);
  const fieldQualification=await bindFieldQualificationPublication(descriptor,qBytes,{
    publicationSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,authoritySha256:newAuthority,
    qualificationReceiptSha256:qSha,previousManifestSha256:previous.pub.publicationSha256,expectedSubjectCount:1});
  const pub={snapshotId:"SYN-REBOUND",publicationSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,
    generatedAt:manifest.generated_at,sourceAsOf:manifest.source_as_of,schemaVersion:manifest.schema_version,
    normalizationRulesVersion:"SYN",selectionRulesVersion:"SYN",expiresAtUtc:9999999n,counts,full:part,parts:[],fieldQualification};
  const limits={maxParts:4,maxRows:20,maxDecodedBytes:262144,maxPartBytes:131072,maxDepth:64,
    maxTotalGzipBytes:262144,maxPartGzipBytes:131072,maxManifestBytes:65536,maxIndexBytes:65536,timeoutMs:5000};
  const receipt=await prepareP1R27GlobalReceipt(pub,manifestBytes,indexBytes,await hash(indexBytes),
    rebound.coverage_sha256,[Uint8Array.from(compressed)],limits,index);
  assert.equal(receipt.status,"global_checks_passed");
  assert.ok(rebindAuthority.scopes.some(x=>x.phase==="candidate" && x.publication_sha256===null));
  assert.ok(rebindAuthority.scopes.some(x=>x.phase==="publication" && x.publication_sha256===manifestSha));
  await test("rebind_assertions_require_void_at_candidate_and_publication",async()=>{
    const seen={source:0,previous:0,authority:0};
    const modes={source:null,previous:null,authority:null};
    const reset=()=>{for(const key of Object.keys(seen)){seen[key]=0;modes[key]=null;}};
    const outcome=(key)=>{
      seen[key]++;
      const m=modes[key];
      if(!m || seen[key]!==m.at)return undefined;
      if(m.value==="throw")throw new Error("SYN_REBIND_"+key.toUpperCase()+"_EXCEPTION");
      return m.value;
    };
    const source={...f.source,async assertSourceHead(expected){await f.source.assertSourceHead(expected);return outcome("source");}};
    const previousPort={...f.previous,async assertCurrent(expected){await f.previous.assertCurrent(expected);return outcome("previous");}};
    const authority={async assertCurrent(input){await rebindAuthority.assertCurrent(input);return outcome("authority");}};
    for(const which of ["source","previous","authority"]) {
      for(const value of [false,null,"throw"]) {
        for(const at of [1,2]) {
          reset();modes[which]={at,value};
          const expected=value==="throw"?new RegExp("SYN_REBIND_"+which.toUpperCase()+"_EXCEPTION"):
            new RegExp("rebind_"+which+"_assert_invalid");
          await assert.rejects(rebindP1R27Candidate(candidate,f.context,source,previousPort,authority,proof),expected);
          assert.equal(seen[which],at);assert.equal(candidate.rebind_required.length,1);
        }
      }
    }
    reset();
    const guarded=await rebindP1R27Candidate(candidate,f.context,source,previousPort,authority,proof);
    const guardedIndex=await buildCandidateR27ScopeIndex(guarded,f.context), guardedBytes=encode(guardedIndex);
    assert.equal(nativeJsonText(guarded.body,true),nativeJsonText(rebound.body,true));
    assert.equal(nativeJsonText(guardedIndex,true),nativeJsonText(index,true));
    for(const which of ["source","previous","authority"]) {
      for(const value of [false,null,"throw"]) {
        reset();modes[which]={at:1,value};
        const expected=value==="throw"?new RegExp("SYN_REBIND_"+which.toUpperCase()+"_EXCEPTION"):
          new RegExp("rebind_"+which+"_assert_invalid");
        await assert.rejects(prepareP1R27GlobalReceipt(pub,manifestBytes,guardedBytes,await hash(guardedBytes),
          guarded.coverage_sha256,[Uint8Array.from(compressed)],limits,guardedIndex),expected);
        assert.equal(seen[which],1);
      }
    }
    reset();
    const ok=await prepareP1R27GlobalReceipt(pub,manifestBytes,guardedBytes,await hash(guardedBytes),
      guarded.coverage_sha256,[Uint8Array.from(compressed)],limits,guardedIndex);
    assert.equal(ok.status,"global_checks_passed");
  });
  rebindAuthority.hang=true;
  await assert.rejects(prepareP1R27GlobalReceipt(pub,manifestBytes,indexBytes,await hash(indexBytes),
    rebound.coverage_sha256,[Uint8Array.from(compressed)],{...limits,timeoutMs:30},index),
    error=>error.code==="snapshot_invalid");
  rebindAuthority.hang=false;
  rebindAuthority.revoked=true;
  await assert.rejects(prepareP1R27GlobalReceipt(pub,manifestBytes,indexBytes,await hash(indexBytes),
    rebound.coverage_sha256,[Uint8Array.from(compressed)],limits,index),/SYN_APPROVAL_REVOKED/);
  rebindAuthority.revoked=false;
  const partialF=await fixture([sourceRow(),sourceRow({original_pk:"SYN-HOLD",
    scope:{state:"review_pending",evidence_sha256:null}})],[],{previous});
  const partialCandidate=await partialF.build();
  const partialRebound=await rebindP1R27Candidate(partialCandidate,partialF.context,
    partialF.source,partialF.previous,rebindAuthority,proof);
  const partialIndex=await buildCandidateR27PartialScopeIndex(partialRebound,partialF.context);
  const partialBody=buildCandidateR27PartialBody(partialRebound,partialF.context,partialIndex);
  const partialOld=partialBody.rows.find(x=>x.academic_year===2026);
  assert.equal(partialOld.final_additional_admission_rank.value,"17");
  assert.equal(partialOld.final_additional_admission_rank.service_qualification.qualification_receipt_sha256,qSha);
  assert.equal(partialBody.r27_scope_coverage.status,"partial");
  f.source.failFinish=true;
  await assert.rejects(rebindP1R27Candidate(candidate,f.context,f.source,f.previous,rebindAuthority,proof),/SYN_SOURCE_CHANGED/);
});


await test("historical_reference_rebind_preserves_value_and_checks_final_export_pin",async()=>{
  const old=historical();
  const release="reference-percentile:"+"3".repeat(64),newExport="4".repeat(64);
  old.historical_cutoff_references=[{
    format:"jungsi.historical-cutoff-reference/v1",observation_id:"observation:"+"1".repeat(64),
    academic_year:2026,school_id:old.university_id,offering_pk:old.original_pk,value:"1.2300",unit:"%",
    status:"model_estimated",label:"추정상위누백(전체응시자)",scope:"historical_admission_cutoff",
    method_id:"estimated-whole-cohort-percentile:"+"2".repeat(64),release_id:release,
    display_role:"independent_observation",statistic_label:null,
    reference_status:"CALCULATED_WHOLE_COHORT_MODEL_ESTIMATE",engine_approved:false,production_allowed:false}];
  const previous=await previousPort([[old]]);
  const descriptor=(exportSha)=>({format:"jungsi.history-reference-estimates/v1",release_id:release,
    source_export_sha256:exportSha,head_readback_receipt_sha256:"5".repeat(64),
    metric:"estimated_upper_cumulative_percent_all_examinees",observation_count:1,school_count:1,
    engine_approved:false,production_allowed:false,display_scope:"historical_admission_only"});
  previous.pub.historicalReferences=bindHistoricalReferencePublication(descriptor("7".repeat(64)),
    previous.pub.publicationSha256,OLD,SCOPE);
  const f=await fixture([sourceRow()],[],{previous}),candidate=await f.build();
  assert.equal(candidate.rebind_required.length,1);
  assert.equal(candidate.rebind_required[0].kind,"historical_reference");
  const preserved=candidate.rebind_required[0].row;
  const rowKey=JSON.stringify([preserved.academic_year,preserved.university_id,preserved.original_pk,
    preserved.campus,preserved.admission_track,preserved.group]);
  const entry={row_key:rowKey,previous_row_sha256:await nativeJsonSha256(preserved),
    references_sha256:await nativeJsonSha256(preserved.historical_cutoff_references)};
  const refBytes=encode({format:"jungsi.p1-history-reference-rebind/v1",status:"approved_exact_carry_forward",
    authority_sha256:EV,source_head_sha256:H,previous_publication_sha256:previous.pub.publicationSha256,
    previous_source_head_sha256:OLD,scope_sha256:SCOPE,export_sha256:newExport,entries:[entry]});
  const proof={qualification:null,reference:{receipt_bytes:refBytes,receipt_sha256:await hash(refBytes),authority_sha256:EV}};
  await assert.rejects(rebindP1R27Candidate(candidate,f.context,f.source,f.previous,rebindAuthority,
    {...proof,reference:{...proof.reference,authority_sha256:"8".repeat(64)}}),/reference_receipt_mismatch/);
  for(const changed of [
    {source_head_sha256:"9".repeat(64),entries:[entry]},
    {source_head_sha256:H,entries:[{...entry,previous_row_sha256:"9".repeat(64)}]},
    {source_head_sha256:H,entries:[{...entry,references_sha256:"9".repeat(64)}]},
    {source_head_sha256:H,entries:[entry,entry]},
  ]) {
    const tampered=encode({format:"jungsi.p1-history-reference-rebind/v1",status:"approved_exact_carry_forward",
      authority_sha256:EV,source_head_sha256:changed.source_head_sha256,
      previous_publication_sha256:previous.pub.publicationSha256,previous_source_head_sha256:OLD,
      scope_sha256:SCOPE,export_sha256:newExport,entries:changed.entries});
    await assert.rejects(rebindP1R27Candidate(candidate,f.context,f.source,f.previous,rebindAuthority,
      {...proof,reference:{...proof.reference,receipt_bytes:tampered,receipt_sha256:await hash(tampered)}}));
  }
  const rebound=await rebindP1R27Candidate(candidate,f.context,f.source,f.previous,rebindAuthority,proof);
  assert.equal(candidate.rebind_required.length,1);
  assert.equal(rebound.rebind_required.length,0);
  assert.equal(rebound.body.rows.find(x=>x.academic_year===2026).historical_cutoff_references[0].value,"1.2300");
  const index=await buildCandidateR27ScopeIndex(rebound,f.context),indexBytes=encode(index);
  const raw=encode(rebound.body),compressed=gzipSync(raw);
  const part={...rebound.counts,gzipBytes:compressed.length,gzipSha256:await hash(compressed),
    decodedBytes:raw.length,decodedSha256:await hash(raw),objectKey:"SYN-PRIVATE"};
  const counts={rows:rebound.counts.rows,mapped_rows:rebound.counts.mappedRows,
    mapping_pending_rows:rebound.counts.mappingPendingRows,observations:0,schools:1};
  const wire={part_id:part.partId,payload_id:part.payloadId,object_key:part.objectKey,
    gzip_bytes:part.gzipBytes,gzip_sha256:part.gzipSha256,decoded_bytes:part.decodedBytes,
    decoded_sha256:part.decodedSha256,rows:part.rows,mapped_rows:part.mappedRows,mapping_pending_rows:part.mappingPendingRows};
  const manifest={format:"jungsi.history-snapshot-manifest/v1",status:"approved",snapshot_id:"SYN-REF-REBOUND",
    source_head_sha256:H,scope_sha256:SCOPE,generated_at:"2026-01-01T00:00:00Z",source_as_of:"2026-01-01",
    schema_version:"jungsi.history-snapshot/v2",normalization_rules_version:"SYN",normalization_rules_sha256:"1".repeat(64),
    selection_rules_version:"SYN",selection_rules_sha256:"2".repeat(64),counts,full:wire,parts:[]};
  const manifestBytes=encode(manifest),manifestSha=await hash(manifestBytes);
  const basePub={snapshotId:"SYN-REF-REBOUND",publicationSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,
    generatedAt:manifest.generated_at,sourceAsOf:manifest.source_as_of,schemaVersion:manifest.schema_version,
    normalizationRulesVersion:"SYN",selectionRulesVersion:"SYN",expiresAtUtc:9999999n,counts,full:part,parts:[]};
  const limits={maxParts:4,maxRows:20,maxDecodedBytes:262144,maxPartBytes:131072,maxDepth:64,
    maxTotalGzipBytes:262144,maxPartGzipBytes:131072,maxManifestBytes:65536,maxIndexBytes:65536,timeoutMs:5000};
  const bad={...basePub,historicalReferences:bindHistoricalReferencePublication(descriptor("9".repeat(64)),manifestSha,H,SCOPE)};
  await assert.rejects(prepareP1R27GlobalReceipt(bad,manifestBytes,indexBytes,await hash(indexBytes),
    rebound.coverage_sha256,[Uint8Array.from(compressed)],limits,index),/reference_export_mismatch/);
  const good={...basePub,historicalReferences:bindHistoricalReferencePublication(descriptor(newExport),manifestSha,H,SCOPE)};
  const receipt=await prepareP1R27GlobalReceipt(good,manifestBytes,indexBytes,await hash(indexBytes),
    rebound.coverage_sha256,[Uint8Array.from(compressed)],limits,index);
  assert.equal(receipt.status,"global_checks_passed");
  previous.failFinish=true;
  await assert.rejects(rebindP1R27Candidate(candidate,f.context,f.source,previous,rebindAuthority,proof),/SYN_PREVIOUS_CHANGED/);
});


await test("both_reference_and_qualification_require_separate_proofs_for_same_row",async()=>{
  const old=historical(),release="reference-percentile:"+"3".repeat(64);
  old.identity_review={status:"review_pending",reason_code:"SYN-REVIEW",variants:[{
    university_name:"SYN SCHOOL",department:"SYN PRIOR",admission_track:"SYN-TRACK",group:"SYN-GROUP"}]};
  const subject={observation_id:"observation:"+S,academic_year:2026,offering_pk:old.original_pk,identity_variant_index:0};
  old.final_additional_admission_rank={...old.final_additional_admission_rank,value:"17",
    status:"pending_metadata",reason_code:"SYN-RAW",source_context:{
      observation_id:subject.observation_id,identity_variant_index:0,scope_status:"review_pending"}};
  const approval={field:"final_additional_admission_rank",subject,
    expected_raw_cell_sha256:await nativeJsonSha256(old.final_additional_admission_rank),
    expected_native_value_type:"string",expected_raw_status:"pending_metadata",expected_raw_unit:null,
    expected_identity_review_sha256:await nativeJsonSha256(old.identity_review)};
  const oldBytes=encode({format:"jungsi.history-field-qualification-receipt/v1",status:"approved_exact_fields",
    authority_sha256:EV,source_head_sha256:OLD,scope_sha256:SCOPE,
    expected_previous_manifest_sha256:"6".repeat(64),subjects:[approval]});
  const oldSha=await hash(oldBytes),oldDescriptor=[{...approval,authority_sha256:EV,qualification_receipt_sha256:oldSha}];
  old.final_additional_admission_rank.service_qualification={format:"jungsi.history-field-service-qualification/v1",
    authority_sha256:EV,qualification_receipt_sha256:oldSha,subject,
    normalized_service_fields:{status:"verified_official",unit:"번"}};
  old.historical_cutoff_references=[{format:"jungsi.historical-cutoff-reference/v1",
    observation_id:"observation:"+"1".repeat(64),academic_year:2026,school_id:old.university_id,
    offering_pk:old.original_pk,value:"1.2300",unit:"%",status:"model_estimated",label:"추정상위누백(전체응시자)",
    scope:"historical_admission_cutoff",method_id:"estimated-whole-cohort-percentile:"+"2".repeat(64),
    release_id:release,display_role:"independent_observation",statistic_label:null,
    reference_status:"CALCULATED_WHOLE_COHORT_MODEL_ESTIMATE",engine_approved:false,production_allowed:false}];
  const previous=await previousPort([[old]]);
  previous.pub.fieldQualification=await bindFieldQualificationPublication(oldDescriptor,oldBytes,{
    publicationSha256:previous.pub.publicationSha256,sourceHeadSha256:OLD,scopeSha256:SCOPE,
    authoritySha256:EV,qualificationReceiptSha256:oldSha,previousManifestSha256:"6".repeat(64),expectedSubjectCount:1});
  const descriptor={format:"jungsi.history-reference-estimates/v1",release_id:release,
    source_export_sha256:"7".repeat(64),head_readback_receipt_sha256:"5".repeat(64),
    metric:"estimated_upper_cumulative_percent_all_examinees",observation_count:1,school_count:1,
    engine_approved:false,production_allowed:false,display_scope:"historical_admission_only"};
  previous.pub.historicalReferences=bindHistoricalReferencePublication(descriptor,previous.pub.publicationSha256,OLD,SCOPE);
  const f=await fixture([sourceRow()],[],{previous}),candidate=await f.build();
  assert.equal(candidate.rebind_required.length,2);
  const preserved=candidate.rebind_required.find(x=>x.kind==="historical_reference").row;
  const rowKey=JSON.stringify([preserved.academic_year,preserved.university_id,preserved.original_pk,
    preserved.campus,preserved.admission_track,preserved.group]);
  const refBytes=encode({format:"jungsi.p1-history-reference-rebind/v1",status:"approved_exact_carry_forward",
    authority_sha256:EV,source_head_sha256:H,previous_publication_sha256:previous.pub.publicationSha256,
    previous_source_head_sha256:OLD,scope_sha256:SCOPE,export_sha256:"4".repeat(64),
    entries:[{row_key:rowKey,previous_row_sha256:await nativeJsonSha256(preserved),
      references_sha256:await nativeJsonSha256(preserved.historical_cutoff_references)}]});
  const newAuthority="8".repeat(64);
  const qBytes=encode({format:"jungsi.history-field-qualification-receipt/v1",status:"approved_exact_fields",
    authority_sha256:newAuthority,source_head_sha256:H,scope_sha256:SCOPE,
    expected_previous_manifest_sha256:previous.pub.publicationSha256,subjects:[approval]});
  const qSha=await hash(qBytes);
  const proof={qualification:{descriptor_approvals:[{...approval,authority_sha256:newAuthority,
    qualification_receipt_sha256:qSha}],receipt_bytes:qBytes,authority_sha256:newAuthority,
    receipt_sha256:qSha,expected_subject_count:1},reference:{receipt_bytes:refBytes,
    receipt_sha256:await hash(refBytes),authority_sha256:EV}};
  await assert.rejects(rebindP1R27Candidate(candidate,f.context,f.source,f.previous,rebindAuthority,
    {...proof,reference:null}));
  await assert.rejects(rebindP1R27Candidate(candidate,f.context,f.source,f.previous,rebindAuthority,
    {...proof,qualification:null}));
  const next=await rebindP1R27Candidate(candidate,f.context,f.source,f.previous,rebindAuthority,proof);
  assert.equal(next.rebind_required.length,0);
  const oldRow=next.body.rows.find(x=>x.academic_year===2026);
  assert.equal(oldRow.final_additional_admission_rank.value,"17");
  assert.equal(oldRow.final_additional_admission_rank.service_qualification.qualification_receipt_sha256,qSha);
  assert.equal(oldRow.historical_cutoff_references[0].value,"1.2300");
  assert.ok(await buildCandidateR27ScopeIndex(next,f.context));
});

process.stdout.write(JSON.stringify({cases:results.length,status:"PASS_SYNTHETIC_ONLY",v1_and_v2_service:true})+"\n");
