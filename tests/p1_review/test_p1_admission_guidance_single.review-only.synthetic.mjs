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
import { PublicResponseProjection, publicJsonText } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { bindR27ScopeIndex, assertR27ScopeIndex } from "../../supabase/functions/_shared/jungsi/application/history_r27_scope_index.ts";
import { prepareP1R27GlobalReceipt } from "../../supabase/functions/_shared/jungsi/application/p1_r27_release_gate.ts";
import { bindP1R27ConsumerGate, assertP1R27ConsumerGate } from "../../supabase/functions/_shared/jungsi/application/p1_r27_consumer_gate.ts";
import { validateP1PreparedPartsGlobal } from "../../supabase/functions/_shared/jungsi/application/p1_r27_global_parts.ts";
import { bindHistoricalReferencePublication } from "../../supabase/functions/_shared/jungsi/application/history_reference_estimates.ts";
import { bindFieldQualificationPublication } from "../../supabase/functions/_shared/jungsi/application/history_field_qualification.ts";
import { bindReviewedR27Scope, combineReviewedR27Scopes, bindReviewedR27Links } from "../../supabase/functions/_shared/jungsi/application/r27_standalone.ts";
import { bindP1R27Evidence, composeP1R27Candidate, buildCandidateR27ScopeIndex, assertSealedR27Publication } from "../../supabase/functions/_shared/jungsi/application/p1_r27_composition.ts";

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

await test("single_source_without_field_review_stays_pending_through_existing_gate", async () => {
  const text="SYN OWNER GUIDANCE";
  const guidance={status:"verified_official",text,source_url:"https://example.edu/syn",source_as_of:"2026-01-01",source_document_sha256:"a".repeat(64),source_text_sha256:await hash(new TextEncoder().encode(text))};
  const methodText="SYN METHOD";
  const method={...guidance,text:methodText,source_text_sha256:await hash(new TextEncoder().encode(methodText))};
  const f=await fixture([sourceRow({applicant_eligibility:guidance,selection_method:{status:"pending",text:null,source_url:null,source_as_of:null}}),sourceRow({original_pk:"SYN-2",selection_method:method})]), out=await f.build();
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
  const global=await prepareP1R27GlobalReceipt(beforeGate,manifestBytes,indexBytes,indexSha,out.coverage_sha256,[Uint8Array.from(compressed)],limits,index),globalBytes=encode(global);
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
  await assert.rejects(new HistorySnapshotService({current:async()=>noGate,read:async()=>out.body,assertCurrent:async()=>{}},{nowUtc:()=>1n},SCOPE).read(sessionProbe,"SYN-V2",{}));
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
  const r=body.rows.find(r=>r.original_pk==="SYN-PK");
  assert.equal(r.r27_source.applicant_eligibility.text,null);
  assert.equal(r.r27_source.applicant_eligibility.status,"pending");
  assert.equal(r.r27_source.selection_method.status,"pending");
  assert.equal(body.rows.find(r=>r.original_pk==="SYN-2").r27_source.applicant_eligibility,undefined);
  assert.equal(body.rows.find(r=>r.original_pk==="SYN-2").r27_source.selection_method.text,null);
  await assert.rejects(service.read({...session,user:{...session.user,expiresAtUtc:1n}},"SYN-V2",{}));
  assert.equal(publicJsonText(projected).includes("source_document_sha256"),false);
  assert.equal(publicJsonText(projected).includes("source_text_sha256"),false);
  const changed=structuredClone(out.body);changed.rows.find(r=>r.original_pk==="SYN-PK").r27_source.applicant_eligibility.text="SYN TAMPERED";
  await assert.rejects(assertSealedR27Publication(index,indexBytes,[encode(changed)],beforeGate));
  const helperTarget={guide_head_sha256:"a".repeat(64),guide_row_sha256:"b".repeat(64),release_id:"SYN-RELEASE",offering_pk:"SYN-PHYSICAL"};
  const helperProof={applicant_eligibility:{decision:"VERIFIED",source_document_sha256:guidance.source_document_sha256,source_text_sha256:guidance.source_text_sha256,...helperTarget}};
  const noDisclosure=await guidanceFromExistingOwnerReview({applicant_eligibility:guidance},helperProof,helperTarget);
  assert.equal(noDisclosure.applicant_eligibility.text,text);assert.equal(noDisclosure.applicant_eligibility.source_url,null);assert.equal(noDisclosure.applicant_eligibility.source_as_of,null);
  const disclosed=await guidanceFromExistingOwnerReview({applicant_eligibility:guidance},helperProof,helperTarget,{applicant_eligibility:guidance.source_url},{applicant_eligibility:guidance.source_as_of});
  assert.equal(disclosed.applicant_eligibility.source_url,guidance.source_url);assert.equal(disclosed.applicant_eligibility.source_as_of,guidance.source_as_of);
  const mismatch=await guidanceFromExistingOwnerReview({applicant_eligibility:guidance},helperProof,helperTarget,{applicant_eligibility:"https://example.edu/wrong"},{applicant_eligibility:"2025-01-01"});
  assert.equal(mismatch.applicant_eligibility.source_url,null);assert.equal(mismatch.applicant_eligibility.source_as_of,null);
});


import { singleSnapshotPendingGuidance, guidanceFromExistingOwnerReview } from "../../supabase/functions/_shared/jungsi/application/p1_admission_guidance.review-only.ts";
await test("invalid_field_pending_without_blocking_other_rows",async()=>{const bad={status:"verified_official",text:"SYN BAD",source_url:null,source_as_of:null,source_document_sha256:"a".repeat(64),source_text_sha256:"0".repeat(64)};const f=await fixture([sourceRow({applicant_eligibility:bad}),sourceRow({original_pk:"SYN-NEIGHBOR"})]),out=await f.build(),r=out.body.rows.find(x=>x.original_pk==="SYN-PK");assert.equal(r.r27_source.applicant_eligibility.status,"pending");assert.equal(r.r27_source.applicant_eligibility.text,null);assert.ok(out.body.rows.some(x=>x.original_pk==="SYN-NEIGHBOR"));});
await test("source_page_or_head_change_rejected",async()=>{let f=await fixture([sourceRow()]);f.source.pages[0][5]^=1;await assert.rejects(f.build());f=await fixture([sourceRow()]);f.source.failFinish=true;await assert.rejects(f.build());});
await test("previous_snapshot_preserved_and_new_guidance_pending",async()=>{const old={r27_source:{applicant_eligibility:{status:"verified_official",text:"SYN OLD"}}};assert.equal(singleSnapshotPendingGuidance({},old).applicant_eligibility.status,"pending");assert.equal(old.r27_source.applicant_eligibility.text,"SYN OLD");});
console.log(JSON.stringify({status:"PASS_SYNTHETIC_SINGLE_REVIEW_ONLY",cases:results.length,case_names:results,owner:"NOT_CONNECTED",publication:"NOT_RUN"}));
