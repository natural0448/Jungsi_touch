/** Fully synthetic P1 v1/v2 integration regression. No DB, Storage, network or output files. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { JsonFloat, parseNativeJson } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { nativeJsonText, nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  HISTORY_SNAPSHOT_SLOTS, HistorySnapshotService, validateHistorySnapshotPayload,
  validateQualifiedHistorySnapshotPayload,
} from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import { validateHistorySnapshotPayload as validateLegacy, validateQualifiedHistorySnapshotPayload as validateLegacyQualified, HistorySnapshotService as LegacyHistorySnapshotService } from "./fixtures/p1_history_snapshot_799.reference.ts";
import { PublicResponseProjection, publicJsonText } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { bindR27ScopeIndex } from "../../supabase/functions/_shared/jungsi/application/history_r27_scope_index.ts";
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

import { prepareP1R27GlobalReceipt } from "../../supabase/functions/_shared/jungsi/application/p1_r27_release_gate.ts";
import { bindP1R27ConsumerGate, assertP1R27ConsumerGate } from "../../supabase/functions/_shared/jungsi/application/p1_r27_consumer_gate.ts";
import { HistorySnapshotSource } from "../../supabase/functions/_shared/jungsi/infrastructure/history_snapshot_source.ts";

const NOW=BigInt(Date.parse("2026-10-15T00:00:00.000Z"))*1000n, EXP=NOW+60000000n, PREFIX="SYNTHETIC/snapshot/";
const LIMITS={maxParts:4,maxRows:20,maxDecodedBytes:262144,maxPartBytes:131072,maxDepth:64,maxTotalGzipBytes:262144,maxPartGzipBytes:131072,maxManifestBytes:65536,maxIndexBytes:65536,timeoutMs:5000};
const partWire=p=>({part_id:p.partId,payload_id:p.payloadId,object_key:p.objectKey,gzip_bytes:p.gzipBytes,gzip_sha256:p.gzipSha256,decoded_bytes:p.decodedBytes,decoded_sha256:p.decodedSha256,rows:p.rows,mapped_rows:p.mappedRows,mapping_pending_rows:p.mappingPendingRows});
async function material(n=2){
 const f=await fixture(Array.from({length:n},(_,i)=>sourceRow({original_pk:"SYN-"+i})));const out=await f.build(),index=await buildCandidateR27ScopeIndex(out,f.context),indexBytes=encode(index),indexSha=await hash(indexBytes);
 const rs=out.body.rows,bodies=[{format:"jungsi.history-snapshot/v2",payload_id:"SYN-PAYLOAD",part_id:"SYN-PART-A",rows:[rs[0],rs[1]]},{format:"jungsi.history-snapshot/v2",payload_id:"SYN-PAYLOAD",part_id:"SYN-PART-B",rows:rs.slice(2)}];
 const parts=[],gzips=[];
 for(let i=0;i<bodies.length;i++){const raw=encode(bodies[i]),gzip=Uint8Array.from(gzipSync(raw));gzips.push(gzip);parts.push({partId:bodies[i].part_id,payloadId:bodies[i].payload_id,gzipBytes:gzip.length,gzipSha256:await hash(gzip),decodedBytes:raw.length,decodedSha256:await hash(raw),rows:bodies[i].rows.length,mappedRows:bodies[i].rows.filter(r=>r.mapping_status==="mapped").length,mappingPendingRows:bodies[i].rows.filter(r=>r.mapping_status==="mapping_pending").length,objectKey:PREFIX+"part-"+i+".gz"})}
 const counts={rows:rs.length,mapped_rows:rs.length,mapping_pending_rows:0,observations:0,schools:1};
 const manifest={format:"jungsi.history-snapshot-manifest/v1",status:"approved",snapshot_id:"SYN-V2",source_head_sha256:H,scope_sha256:SCOPE,
  generated_at:"2026-10-15T00:00:00Z",source_as_of:"2026-10-14",schema_version:"jungsi.history-snapshot/v2",normalization_rules_version:"SYN-NORM",normalization_rules_sha256:"1".repeat(64),selection_rules_version:"SYN-SELECT",selection_rules_sha256:"2".repeat(64),counts,full:null,parts:parts.map(partWire)};
 const manifestBytes=encode(manifest),manifestSha=await hash(manifestBytes);
 const publication={snapshotId:"SYN-V2",publicationSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,generatedAt:manifest.generated_at,sourceAsOf:manifest.source_as_of,schemaVersion:manifest.schema_version,normalizationRulesVersion:"SYN-NORM",selectionRulesVersion:"SYN-SELECT",expiresAtUtc:EXP,counts,full:null,parts};
 const global=await prepareP1R27GlobalReceipt(publication,manifestBytes,indexBytes,indexSha,out.coverage_sha256,gzips,LIMITS,index),globalBytes=encode(global);
 const consumer={format:"jungsi.p1-r27-consumer-approval/v1",status:"approved",manifest_sha256:manifestSha,source_head_sha256:H,scope_sha256:SCOPE,consumer_build_sha256:"3".repeat(64),consumer_contract_sha256:"4".repeat(64),r27_scope_key_supported:true,expires_at_utc_micros:String(EXP)};
 const consumerBytes=encode(consumer),pin=async(key,bytes)=>({object_key:PREFIX+key,bytes:bytes.length,sha256:await hash(bytes)});
 const review={format:"jungsi.history-snapshot-independent-review/v1",status:"approved",lineage:"SYN-LINEAGE",manifest_sha256:manifestSha,source_head_sha256:H,scope_sha256:SCOPE,normalization_rules_sha256:"1".repeat(64),selection_rules_sha256:"2".repeat(64),publisher_ref:"SYN-OWNER",reviewer_ref:"SYN-REVIEWER",
  r27_gate:{format:"jungsi.p1-r27-review-gate/v1",scope_index:await pin("index.json",indexBytes),global_receipt:await pin("global.json",globalBytes),consumer_receipt:await pin("consumer.json",consumerBytes)}};
 const reviewBytes=encode(review),head={format:"jungsi.history-snapshot-publication-head/v1",status:"approved",purpose:"p1-public-history",lineage:"SYN-LINEAGE",sequence:1,previous_head_sha256:"0".repeat(64),source_head_sha256:H,scope_sha256:SCOPE,normalization_rules_version:"SYN-NORM",normalization_rules_sha256:"1".repeat(64),selection_rules_version:"SYN-SELECT",selection_rules_sha256:"2".repeat(64),publisher_ref:"SYN-OWNER",reviewer_ref:"SYN-REVIEWER",manifest:await pin("manifest.json",manifestBytes),review_receipt:await pin("review.json",reviewBytes),expires_at:"2026-10-15T00:01:00Z"};
 const headSha=await nativeJsonSha256(head),pins={headSha256:headSha,manifestSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,indexSha256:indexSha,coverageSha256:out.coverage_sha256,globalReceiptSha256:await hash(globalBytes),consumerReceiptSha256:await hash(consumerBytes),consumerBuildSha256:"3".repeat(64),consumerContractSha256:"4".repeat(64)};
 return {f,out,index,indexBytes,indexSha,bodies,parts,gzips,manifest,manifestBytes,publication,global,globalBytes,consumer,consumerBytes,review,reviewBytes,head,headSha,pins};
}
async function sourceFixture(x,overrideTrust,overrideAdmission){
 const objects=new Map([[PREFIX+"manifest.json",x.manifestBytes],[PREFIX+"review.json",x.reviewBytes],[PREFIX+"index.json",x.indexBytes],[PREFIX+"global.json",x.globalBytes],[PREFIX+"consumer.json",x.consumerBytes],...x.parts.map((p,i)=>[p.objectKey,x.gzips[i]])]);
 const calls=[], rows={value:{releaseVersion:"SYN-LINEAGE:00000000000000000001",contentSha256:x.headSha,reviewStatus:"approved",metadataText:nativeJsonText(x.head)}};
 const binding={artifactKind:"SYN-P1",lineage:"SYN-LINEAGE",minimumSequence:1n,scopeSha256:SCOPE,normalizationRulesVersion:"SYN-NORM",normalizationRulesSha256:"1".repeat(64),selectionRulesVersion:"SYN-SELECT",selectionRulesSha256:"2".repeat(64),publisherReferences:["SYN-OWNER"],reviewerReferences:["SYN-REVIEWER"],objectPrefix:PREFIX,maxMetadataBytes:65536,maxGzipBytes:131072,maxDecodedBytes:131072,maxRows:20,maxParts:4,maxDepth:64,maxInMemoryBytes:16000000,expiresAtUtc:EXP};
 const storage={projectUrl:"https://abcdefghijklmnopqrst.supabase.co",secretKey:"sb_secret_SYNTHETIC",bucket:"synthetic-private",objectPrefix:"SYNTHETIC/",limits:{maxArtifactBytes:131072,maxBucketBytes:1000000,maxMetadataBytes:65536,requestTimeoutMs:5000}};
 const fetcher=async(url,init)=>{assert.equal(init.method,"GET");const u=String(url);calls.push(u);const data=u.endsWith("/bucket/synthetic-private")?encode({id:"synthetic-private",public:false,file_size_limit:1000000}):objects.get(decodeURIComponent(u.split("/object/authenticated/synthetic-private/")[1]??""));const r=new Response(data?Uint8Array.from(data):null,{status:data?200:404});Object.defineProperty(r,"url",{value:u});return r};
 const heads={latest:async()=>rows.value}, trust=overrideTrust===false?undefined:overrideTrust===undefined?{pins:x.pins,maxExtraBytes:65536,maxIndexBytes:65536}:overrideTrust;
 let admissionCalls=0;
 const defaultAdmission={assertBoundConsumer:input=>{admissionCalls++;assert.equal(input.headSha256,x.headSha);assert.equal(input.consumerBuildSha256,x.pins.consumerBuildSha256)}};
 const admission=overrideAdmission===false?undefined:overrideAdmission??defaultAdmission;
 const source=new HistorySnapshotSource(heads,binding,storage,{nowUtc:()=>NOW},{maxReadBytes:16000000,maxResultBytes:131072n,runtimeMilliseconds:5000},fetcher,trust,admission);
 return {source,calls,objects,rows,binding,storage,heads,fetcher,admissionCalls:()=>admissionCalls};
}
await test("publisher binds all compressed parts and consumer binds exact trusted receipts",async()=>{
 const x=await material();assert.equal(x.global.parts_checked,2);assert.equal(x.global.rows_checked,3);
 const gate=await bindP1R27ConsumerGate(x.publication,x.indexBytes,x.globalBytes,x.consumerBytes,x.pins,x.headSha,NOW);
 const immutable=Object.freeze({...x.publication,counts:Object.freeze({...x.publication.counts}),parts:Object.freeze(x.parts.map(p=>Object.freeze({...p})))});
 const index=await assertP1R27ConsumerGate(gate,immutable),bound=Object.freeze({...immutable,r27ScopeIndex:index,r27Gate:gate});
 for(let i=0;i<x.parts.length;i++)await assert.doesNotReject(validateQualifiedHistorySnapshotPayload(x.bodies[i],bound.parts[i],bound));
});
await test("publisher rejects missing changed swapped gzip and forged manifest or index",async()=>{
 const x=await material(),run=(p,m,idx,z)=>prepareP1R27GlobalReceipt(p,m,idx,x.indexSha,x.out.coverage_sha256,z,LIMITS,x.index);
 await assert.rejects(run(x.publication,x.manifestBytes,x.indexBytes,x.gzips.slice(0,1)));
 const bad=x.gzips.map(v=>Uint8Array.from(v));bad[0][0]^=1;await assert.rejects(run(x.publication,x.manifestBytes,x.indexBytes,bad));
 await assert.rejects(run(x.publication,x.manifestBytes,x.indexBytes,[x.gzips[1],x.gzips[0]]));
 const changed=Uint8Array.from(x.manifestBytes);changed[0]^=1;await assert.rejects(run(x.publication,changed,x.indexBytes,x.gzips));
 const changedIndex=Uint8Array.from(x.indexBytes);changedIndex[0]^=1;await assert.rejects(run(x.publication,x.manifestBytes,changedIndex,x.gzips));
});
await test("publisher rejects full plus parts and altered manifest descriptor",async()=>{
 const x=await material();await assert.rejects(prepareP1R27GlobalReceipt({...x.publication,full:{...x.parts[0],partId:null}},x.manifestBytes,x.indexBytes,x.indexSha,x.out.coverage_sha256,x.gzips,LIMITS,x.index));
 await assert.rejects(prepareP1R27GlobalReceipt({...x.publication,parts:[{...x.parts[0],objectKey:PREFIX+"other"},x.parts[1]]},x.manifestBytes,x.indexBytes,x.indexSha,x.out.coverage_sha256,x.gzips,LIMITS,x.index));
});
await test("consumer refuses missing or changed head, receipts, build and expired acceptance",async()=>{
 const x=await material(),bind=(p,g,c,t,h= x.headSha,now=NOW)=>bindP1R27ConsumerGate(p,x.indexBytes,g,c,t,h,now);
 await assert.rejects(bind(x.publication,x.globalBytes,x.consumerBytes,x.pins,"0".repeat(64)));
 const bad=Uint8Array.from(x.globalBytes);bad[0]^=1;await assert.rejects(bind(x.publication,bad,x.consumerBytes,x.pins));
 await assert.rejects(bind(x.publication,x.globalBytes,x.consumerBytes,{...x.pins,consumerBuildSha256:"0".repeat(64)}));
 const c=encode({...x.consumer,expires_at_utc_micros:String(EXP-1n)});await assert.rejects(bind(x.publication,x.globalBytes,c,{...x.pins,consumerReceiptSha256:await hash(c)}));
 await assert.rejects(bind(x.publication,x.globalBytes,x.consumerBytes,x.pins,x.headSha,EXP));
});
await test("source adapter verifies fixed pins then reads selected part only",async()=>{
 const x=await material(),f=await sourceFixture(x);const p=await f.source.current();assert.equal(p.schemaVersion,"jungsi.history-snapshot/v2");
 assert.equal(f.calls.length,6);assert.equal(f.admissionCalls(),1);assert.equal(f.calls.filter(v=>v.includes("index.json")).length,1);assert.equal(f.calls.filter(v=>v.includes("global.json")).length,1);assert.equal(f.calls.filter(v=>v.includes("consumer.json")).length,1);
 const body=await f.source.read(p,p.parts[0]);assert.equal(body.rows.length,2);assert.equal(f.calls.length,7);assert.equal(f.calls.filter(v=>v.includes("part-1.gz")).length,0);
 const rep=await f.source.representation(body);assert.equal(rep.publicationSha256,x.publication.publicationSha256);assert.equal(rep.bytes.length,x.parts[0].gzipBytes);
});
await test("source adapter stays closed without pins or for changed approved head",async()=>{
 const x=await material(),f=await sourceFixture(x,false);await assert.rejects(f.source.current());assert.equal(f.calls.filter(v=>v.includes("index.json")).length,0);
 const g=await sourceFixture(x);g.rows.value={...g.rows.value,contentSha256:"9".repeat(64)};await assert.rejects(g.source.current());
});
await test("source adapter rejects changed pinned metadata and revoked head",async()=>{
 const x=await material(),f=await sourceFixture(x);f.objects.set(PREFIX+"global.json",new Uint8Array([1,2,3]));await assert.rejects(f.source.current());
 const g=await sourceFixture(x);const p=await g.source.current();g.rows.value={...g.rows.value,reviewStatus:"revoked"};await assert.rejects(g.source.read(p,p.parts[0]));
});


import { createApiHandler } from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import { syntheticApiPolicies } from "./synthetic_api_contract.ts";
import schemaJson from "../../src/jungsi_touch/application/public_response_schemas.json" with { type: "json" };

const RELAY="SYNTHETIC-relay-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", OWNER="00000000-0000-0000-0000-000000000001";
const extra=[{id:"history.snapshot.head",method:"GET",path:"/api/v1/admission-history/snapshot/head",member_tiers:["standard","paid"],report_owner:false,confirmed_score_profile:false},
{id:"history.snapshot.read",method:"GET",path:"/api/v1/admission-history/snapshots/{snapshot_id}",member_tiers:["standard","paid"],report_owner:false,confirmed_score_profile:false},
{id:"report.list-own",method:"GET",path:"/api/v1/me/reports",member_tiers:["standard","paid"],report_owner:false,confirmed_score_profile:false}];
function apiFixture(source,tier){
 const policies=[...syntheticApiPolicies(),...extra],expected=policies.map(p=>({id:p.id,contract_ref:"SYNTHETIC"}));
 const operations=expected.map(p=>{const real=schemaJson.operations.find(x=>x.id===p.id);assert.ok(real);return {...p,roots:real.roots}});
 const projection=new PublicResponseProjection({...schemaJson,operations},expected),service=new HistorySnapshotService(source,{nowUtc:()=>NOW},SCOPE),events=[];
 const ports={relay:new RelayBoundary(RELAY),clock:{nowUtc:()=>NOW},projection,readViewScope:{assert:async()=>{events.push("scope")}},
  sessions:{verifyUserBearer:async()=>({subjectId:OWNER,expiresAtUtc:EXP})},
  passes:{readCurrent:async(subjectId,evaluatedAtUtc)=>({authority:"public.jeongsi_passes",metadataVerified:true,subjectId,evaluatedAtUtc,paidUntilUtc:tier==="paid"?EXP:null})},
  reports:{lookupAccess:async()=>null},authorities:{readCurrent:async()=>null},resources:{readScope:async()=>null},
  business:{execute:async req=>{events.push("business");return service.read(req.session,req.params.snapshot_id,req.query)}},
  budget:{run:async(_r,work)=>{events.push("reserve");const v=await work();events.push("settle");return v}},
  completion:{accept:async(_r,work)=>await work(),current:async()=>await source.assertCurrent(await source.current()),deliver:async()=>{}},
  representation:{encode:async(_r,value)=>{const v=await source.representation(value);return {body:v.bytes,status:200,etag:v.etag,gzip:true,snapshotId:v.snapshotId,publicationSha256:v.publicationSha256}}}};
 return {handler:createApiHandler(policies,ports),events};
}
function httpRequest(relay=true){return new Request("https://synthetic.invalid/api/v1/admission-history/snapshots/SYN-V2?part_id=SYN-PART-B",{headers:{Authorization:"Bearer SYNTHETIC",...(relay?{"X-Jungsi-Relay-Token":RELAY}:{})}})}
await test("synthetic HTTP standard and paid use v2 gate projection and exact pinned gzip",async()=>{
 const x=await material();for(const tier of ["standard","paid"]){const f=await sourceFixture(x),api=apiFixture(f.source,tier),r=await api.handler(httpRequest());
  assert.equal(r.status,200);assert.equal(r.headers.get("Content-Encoding"),"gzip");assert.equal(r.headers.get("X-Publication-SHA256"),x.publication.publicationSha256);
  const gzip=Uint8Array.from(new Uint8Array(await r.arrayBuffer()));assert.deepEqual(gzip,x.gzips[1]);const body=JSON.parse(gunzipSync(gzip).toString("utf8"));
  assert.equal(body.format,"jungsi.history-snapshot/v2");assert.equal(body.rows.length,1);assert.equal(body.rows[0].academic_year,2027);assert.equal(typeof body.rows[0].r27_source.scope_key,"string");
  assert.equal(f.calls.filter(v=>v.includes("part-0.gz")).length,0);assert.equal(f.calls.filter(v=>v.includes("part-1.gz")).length,1);
  assert.ok(api.events.includes("scope")&&api.events.includes("business")&&api.events.includes("settle"));}
});
await test("synthetic HTTP bad relay and missing trusted pins never expose a v2 body",async()=>{
 const x=await material(),f=await sourceFixture(x),a=apiFixture(f.source,"standard"),bad=await a.handler(httpRequest(false));assert.equal(bad.status,403);assert.equal(f.calls.length,0);
 const g=await sourceFixture(x,false),b=apiFixture(g.source,"standard"),unapproved=await b.handler(httpRequest());assert.equal(unapproved.status,503);assert.equal(g.calls.filter(v=>v.includes("index.json")).length,0);
});


await test("a differently approved but unpinned newer head cannot enable v2",async()=>{
 const x=await material(),f=await sourceFixture(x),changed={...x.head,sequence:2};
 f.rows.value={...f.rows.value,releaseVersion:"SYN-LINEAGE:00000000000000000002",contentSha256:await nativeJsonSha256(changed),metadataText:nativeJsonText(changed)};
 await assert.rejects(f.source.current());assert.equal(f.calls.filter(v=>v.includes("index.json")).length,0);
});
await test("repinned but semantically forged global receipt still fails delivery comparison",async()=>{
 const x=await material(),forged=encode({...x.global,delivery_sha256:"0".repeat(64)}),pins={...x.pins,globalReceiptSha256:await hash(forged)};
 await assert.rejects(bindP1R27ConsumerGate(x.publication,x.indexBytes,forged,x.consumerBytes,pins,x.headSha,NOW));
});
await test("scope proof metadata reads are constant as synthetic row count increases",async()=>{
 for(const n of [2,8]){const x=await material(n),f=await sourceFixture(x),p=await f.source.current();
  assert.equal(f.calls.length,6);assert.equal(f.calls.filter(v=>v.includes("index.json")).length,1);
  const body=await f.source.read(p,p.parts[1]);assert.equal(body.rows.length,n-1);assert.equal(f.calls.length,7);
 }
});


await test("pinned receipt alone cannot enable v2 without trusted request consumer admission",async()=>{
 const x=await material(),missing=await sourceFixture(x,undefined,false);await assert.rejects(missing.source.current());assert.equal(missing.calls.filter(v=>v.includes("index.json")).length,0);
 const denied=await sourceFixture(x,undefined,{assertBoundConsumer:()=>{throw new Error("SYNTHETIC_DENY")}});await assert.rejects(denied.source.current());assert.equal(denied.calls.filter(v=>v.includes("index.json")).length,0);
 const asyncPort=await sourceFixture(x,undefined,{assertBoundConsumer:()=>Promise.resolve()});await assert.rejects(asyncPort.source.current());assert.equal(asyncPort.calls.filter(v=>v.includes("index.json")).length,0);
});
await test("consumer admission receives immutable pinned input once per request",async()=>{
 const x=await material();let calls=0;const f=await sourceFixture(x,undefined,{assertBoundConsumer:input=>{calls++;assert.equal(Object.isFrozen(input),true);assert.equal(input.manifestSha256,x.publication.publicationSha256);assert.throws(()=>{input.headSha256="0".repeat(64)})}});
 const p=await f.source.current();await f.source.current();await f.source.read(p,p.parts[0]);assert.equal(calls,1);
});
await test("consumer rejects an index without independently bound gate",async()=>{
 const x=await material(),index=await bindR27ScopeIndex(x.indexBytes,{indexSha256:x.indexSha,publicationSha256:x.publication.publicationSha256,sourceHeadSha256:H,scopeSha256:SCOPE,coverageSha256:x.out.coverage_sha256});
 const p=Object.freeze({...x.publication,counts:Object.freeze({...x.publication.counts}),parts:Object.freeze(x.parts.map(v=>Object.freeze({...v}))),r27ScopeIndex:index});
 const source={current:async()=>p,read:async()=>x.bodies[0],assertCurrent:async()=>{}};const service=new HistorySnapshotService(source,{nowUtc:()=>NOW},SCOPE);
 const session={user:{subjectId:OWNER,expiresAtUtc:EXP},evaluatedAtUtc:NOW,tier:"standard",paidUntilUtc:null};
 await assert.rejects(service.head(session,{}));await assert.rejects(validateQualifiedHistorySnapshotPayload(x.bodies[0],p.parts[0],p));
});
await test("consumer gate rejects altered immutable part descriptors and mutable publication",async()=>{
 const x=await material(),gate=await bindP1R27ConsumerGate(x.publication,x.indexBytes,x.globalBytes,x.consumerBytes,x.pins,x.headSha,NOW);
 await assert.rejects(assertP1R27ConsumerGate(gate,x.publication));
 const changed=Object.freeze({...x.publication,counts:Object.freeze({...x.publication.counts}),parts:Object.freeze(x.parts.map((p,i)=>Object.freeze(i?{...p,objectKey:PREFIX+"other.gz"}:{...p})))});
 await assert.rejects(assertP1R27ConsumerGate(gate,changed));
});

await test("consumer rejects frozen accessor without invoking getter",async()=>{
 const x=await material(),gate=await bindP1R27ConsumerGate(x.publication,x.indexBytes,x.globalBytes,x.consumerBytes,x.pins,x.headSha,NOW);let invoked=false;
 const p={...x.publication,parts:Object.freeze(x.parts.map(v=>Object.freeze({...v})))};Object.defineProperty(p,"counts",{enumerable:true,get(){invoked=true;throw Error("SYNTHETIC_GETTER")}});Object.freeze(p);
 await assert.rejects(assertP1R27ConsumerGate(gate,p));assert.equal(invoked,false);
});
await test("opaque consumer gate cannot be forged",async()=>{
 const x=await material(),index=await bindR27ScopeIndex(x.indexBytes,{indexSha256:x.indexSha,publicationSha256:x.publication.publicationSha256,sourceHeadSha256:H,scopeSha256:SCOPE,coverageSha256:x.out.coverage_sha256});
 const p=Object.freeze({...x.publication,counts:Object.freeze({...x.publication.counts}),parts:Object.freeze(x.parts.map(v=>Object.freeze({...v}))),r27ScopeIndex:index,r27Gate:Object.freeze({kind:"verified_p1_r27_consumer_gate"})});
 const service=new HistorySnapshotService({current:async()=>p,read:async()=>x.bodies[0],assertCurrent:async()=>{}},{nowUtc:()=>NOW},SCOPE);const session={user:{subjectId:OWNER,expiresAtUtc:EXP},evaluatedAtUtc:NOW,tier:"standard",paidUntilUtc:null};
 await assert.rejects(service.head(session,{}));
});
await test("gate and scope capability must be the same bound instance",async()=>{
 const x=await material(),gate=await bindP1R27ConsumerGate(x.publication,x.indexBytes,x.globalBytes,x.consumerBytes,x.pins,x.headSha,NOW);
 const other=await bindR27ScopeIndex(x.indexBytes,{indexSha256:x.indexSha,publicationSha256:x.publication.publicationSha256,sourceHeadSha256:H,scopeSha256:SCOPE,coverageSha256:x.out.coverage_sha256});
 const p=Object.freeze({...x.publication,counts:Object.freeze({...x.publication.counts}),parts:Object.freeze(x.parts.map(v=>Object.freeze({...v}))),r27ScopeIndex:other,r27Gate:gate});
 const service=new HistorySnapshotService({current:async()=>p,read:async()=>x.bodies[0],assertCurrent:async()=>{}},{nowUtc:()=>NOW},SCOPE);const session={user:{subjectId:OWNER,expiresAtUtc:EXP},evaluatedAtUtc:NOW,tier:"standard",paidUntilUtc:null};
 await assert.rejects(service.head(session,{}));
});
process.stdout.write(JSON.stringify({cases:results.length,status:"PASS_SYNTHETIC_ONLY",v2_source_gate:true,synthetic_http:true,actual_data:false})+"\n");
