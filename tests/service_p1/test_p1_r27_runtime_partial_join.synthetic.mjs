/** Fully synthetic P1 v1/v2 integration regression. No DB, Storage, network or output files. */
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { JsonFloat, parseNativeJson } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { nativeJsonText, nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  HISTORY_SNAPSHOT_SLOTS, HistorySnapshotService, validateHistorySnapshotPayload,
  validateQualifiedHistorySnapshotPayload,
} from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import { bindHistoricalReferencePublication } from "../../supabase/functions/_shared/jungsi/application/history_reference_estimates.ts";
import { bindFieldQualificationPublication } from "../../supabase/functions/_shared/jungsi/application/history_field_qualification.ts";
import { bindReviewedR27Scope, combineReviewedR27Scopes, bindReviewedR27Links } from "../../supabase/functions/_shared/jungsi/application/r27_standalone.ts";
import { bindP1R27Evidence, composeP1R27Candidate, buildCandidateR27PartialScopeIndex, buildCandidateR27PartialBody } from "../../supabase/functions/_shared/jungsi/application/p1_r27_composition.ts";

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
async function material(consumerMode="approved") {
 const included=sourceRow({original_pk:"SYN-INCLUDED"});
 const held=sourceRow({original_pk:"SYN-HOLD",scope:{state:"review_pending",evidence_sha256:null}});
 const excluded=sourceRow({original_pk:"SYN-EXCLUDED",scope:{state:"excluded_practical",evidence_sha256:EV}});
 const f=await fixture([included,held,excluded]),out=await f.build();
 assert.equal(out.held_rows.length,1);assert.equal(out.excluded_count,1);
 const index=await buildCandidateR27PartialScopeIndex(out,f.context);
 assert.deepEqual([index.source_rows,index.included_rows,index.excluded_rows,index.review_pending_rows],[3,1,1,1]);
 const body=buildCandidateR27PartialBody(out,f.context,index),raw=encode(body),gzip=Uint8Array.from(gzipSync(raw));
 const part={...out.counts,gzipBytes:gzip.length,gzipSha256:await hash(gzip),
   decodedBytes:raw.length,decodedSha256:await hash(raw),objectKey:PREFIX+"part-0.gz"};
 const counts={rows:out.counts.rows,mapped_rows:out.counts.mappedRows,
   mapping_pending_rows:out.counts.mappingPendingRows,observations:0,schools:1};
 const manifest={format:"jungsi.history-snapshot-manifest/v1",status:"approved",snapshot_id:"SYN-PARTIAL",
   source_head_sha256:H,scope_sha256:SCOPE,generated_at:"2026-10-15T00:00:00Z",source_as_of:"2026-10-14",
   schema_version:"jungsi.history-snapshot/v2",normalization_rules_version:"SYN-NORM",
   normalization_rules_sha256:"1".repeat(64),selection_rules_version:"SYN-SELECT",
   selection_rules_sha256:"2".repeat(64),counts,full:partWire(part),parts:[]};
 const manifestBytes=encode(manifest),manifestSha=await hash(manifestBytes),indexBytes=encode(index),indexSha=await hash(indexBytes);
 const publication=Object.freeze({snapshotId:"SYN-PARTIAL",publicationSha256:manifestSha,sourceHeadSha256:H,scopeSha256:SCOPE,
   generatedAt:manifest.generated_at,sourceAsOf:manifest.source_as_of,schemaVersion:manifest.schema_version,
   normalizationRulesVersion:"SYN-NORM",selectionRulesVersion:"SYN-SELECT",expiresAtUtc:EXP,
   counts:Object.freeze({...counts}),full:Object.freeze({...part}),parts:Object.freeze([])});
 const global=await prepareP1R27GlobalReceipt(publication,manifestBytes,indexBytes,indexSha,out.coverage_sha256,[gzip],LIMITS,index);
 const globalBytes=encode(global);
 const consumer={format:consumerMode==="legacy"?"jungsi.p1-r27-consumer-approval/v1":"jungsi.p1-r27-consumer-approval/v2",
   status:"approved",manifest_sha256:manifestSha,source_head_sha256:H,scope_sha256:SCOPE,
   consumer_build_sha256:"3".repeat(64),consumer_contract_sha256:"4".repeat(64),r27_scope_key_supported:true,
   ...(consumerMode==="legacy"?{}:{r27_partial_coverage_supported:consumerMode!=="unsupported"}),
   expires_at_utc_micros:String(EXP)};
 const consumerBytes=encode(consumer),pin=async(key,bytes)=>({object_key:PREFIX+key,bytes:bytes.length,sha256:await hash(bytes)});
 const review={format:"jungsi.history-snapshot-independent-review/v1",status:"approved",lineage:"SYN-LINEAGE",
   manifest_sha256:manifestSha,source_head_sha256:H,scope_sha256:SCOPE,normalization_rules_sha256:"1".repeat(64),
   selection_rules_sha256:"2".repeat(64),publisher_ref:"SYN-OWNER",reviewer_ref:"SYN-REVIEWER",
   r27_gate:{format:"jungsi.p1-r27-review-gate/v1",scope_index:await pin("index.json",indexBytes),
     global_receipt:await pin("global.json",globalBytes),consumer_receipt:await pin("consumer.json",consumerBytes)}};
 const reviewBytes=encode(review),head={format:"jungsi.history-snapshot-publication-head/v1",status:"approved",
   purpose:"p1-public-history",lineage:"SYN-LINEAGE",sequence:1,previous_head_sha256:"0".repeat(64),
   source_head_sha256:H,scope_sha256:SCOPE,normalization_rules_version:"SYN-NORM",normalization_rules_sha256:"1".repeat(64),
   selection_rules_version:"SYN-SELECT",selection_rules_sha256:"2".repeat(64),publisher_ref:"SYN-OWNER",
   reviewer_ref:"SYN-REVIEWER",manifest:await pin("manifest.json",manifestBytes),
   review_receipt:await pin("review.json",reviewBytes),expires_at:"2026-10-15T00:01:00Z"};
 const headSha=await nativeJsonSha256(head),pins={headSha256:headSha,manifestSha256:manifestSha,sourceHeadSha256:H,
   scopeSha256:SCOPE,indexSha256:indexSha,coverageSha256:out.coverage_sha256,
   globalReceiptSha256:await hash(globalBytes),consumerReceiptSha256:await hash(consumerBytes),
   consumerBuildSha256:"3".repeat(64),consumerContractSha256:"4".repeat(64)};
 return {f,out,index,indexBytes,indexSha,body,parts:[part],gzips:[gzip],manifest,manifestBytes,publication,
   global,globalBytes,consumer,consumerBytes,review,reviewBytes,head,headSha,pins};
}
async function sourceFixture(x,overrideTrust,overrideAdmission,options={}){
 const objects=new Map([[PREFIX+"manifest.json",x.manifestBytes],[PREFIX+"review.json",x.reviewBytes],[PREFIX+"index.json",x.indexBytes],[PREFIX+"global.json",x.globalBytes],[PREFIX+"consumer.json",x.consumerBytes],...x.parts.map((p,i)=>[p.objectKey,x.gzips[i]])]);
 const calls=[], rows={value:{releaseVersion:"SYN-LINEAGE:00000000000000000001",contentSha256:x.headSha,reviewStatus:"approved",metadataText:nativeJsonText(x.head)}};
 const binding={artifactKind:"SYN-P1",lineage:"SYN-LINEAGE",minimumSequence:1n,scopeSha256:SCOPE,normalizationRulesVersion:"SYN-NORM",normalizationRulesSha256:"1".repeat(64),selectionRulesVersion:"SYN-SELECT",selectionRulesSha256:"2".repeat(64),publisherReferences:["SYN-OWNER"],reviewerReferences:["SYN-REVIEWER"],objectPrefix:PREFIX,maxMetadataBytes:65536,maxGzipBytes:131072,maxDecodedBytes:131072,maxRows:20,maxParts:4,maxDepth:64,maxInMemoryBytes:16000000,expiresAtUtc:EXP};
 const storage={projectUrl:"https://abcdefghijklmnopqrst.supabase.co",secretKey:"sb_secret_SYNTHETIC",bucket:"synthetic-private",objectPrefix:"SYNTHETIC/",limits:{maxArtifactBytes:131072,maxBucketBytes:1000000,maxMetadataBytes:65536,requestTimeoutMs:5000}};
 const fetcher=async(url,init)=>{assert.equal(init.method,"GET");const u=String(url);calls.push(u);const data=u.endsWith("/bucket/synthetic-private")?encode({id:"synthetic-private",public:false,file_size_limit:1000000}):objects.get(decodeURIComponent(u.split("/object/authenticated/synthetic-private/")[1]??""));const r=new Response(data?Uint8Array.from(data):null,{status:data?200:404});Object.defineProperty(r,"url",{value:u});return r};
 const heads={latest:async()=>rows.value}, trust=overrideTrust===false?undefined:overrideTrust===undefined?{pins:x.pins,maxExtraBytes:65536,maxIndexBytes:65536}:overrideTrust;
 let admissionCalls=0;
 const defaultAdmission={assertBoundConsumer:input=>{admissionCalls++;assert.equal(input.headSha256,x.headSha);assert.equal(input.consumerBuildSha256,x.pins.consumerBuildSha256)}};
 const admission=overrideAdmission===false?undefined:overrideAdmission??defaultAdmission;
 const source=new HistorySnapshotSource(heads,binding,storage,{nowUtc:options.clock??(()=>NOW)},{maxReadBytes:16000000,maxResultBytes:131072n,runtimeMilliseconds:options.runtimeMilliseconds??5000},fetcher,trust,admission);
 return {source,calls,objects,rows,binding,storage,heads,fetcher,admissionCalls:()=>admissionCalls};
}

import { NativeRuntimeRequest } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts";
const CRED="SyntheticCredential_".repeat(3), RELAY="SyntheticRelay_".repeat(4), OWNER="SYNTHETIC-owner";
async function environmentFor(x, supplied=CRED) {
  const config={format:"jungsi.p1-r27-server-admission/v1",status:"approved",
    purpose:"history_snapshot_r27_consumer",api_binding_sha256:"a".repeat(64),
    approval_reference_sha256:"b".repeat(64),deployment_evidence_sha256:"c".repeat(64),
    consumer_id:"SYNTHETIC-CLIENT",credential_sha256:await hash(new TextEncoder().encode(CRED)),
    expires_at_utc_micros:String(EXP),operations:["history.snapshot.head","history.snapshot.read"],
    max_extra_bytes:65536,max_index_bytes:65536,pins:x.pins};
  const raw=JSON.stringify(config), values=new Map([
    ["JUNGSI_P1_R27_CONSUMER_BINDING_JSON",raw],
    ["JUNGSI_P1_R27_CONSUMER_BINDING_SHA256",await hash(new TextEncoder().encode(raw))],
    ["JUNGSI_RELAY_TOKEN",RELAY],
  ]);
  return {env:{get:key=>values.get(key)}, values, request:new Request("https://example.invalid/synthetic",{
    headers:supplied===null?{}:{"X-Jungsi-P1-R27-Consumer-Credential":supplied}})};
}
function execution(operation="history.snapshot.read") {
 return {operation,session:{user:{subjectId:OWNER,expiresAtUtc:EXP},evaluatedAtUtc:NOW,tier:"standard",paidUntilUtc:null},
  management:null,body:{},query:{},params:{snapshot_id:"SYN-PARTIAL"},requestKey:null};
}
async function contextFor(x, options={}) {
 const f=await sourceFixture(x,false,false), setting=await environmentFor(x,options.credential===undefined?CRED:options.credential);
 if(options.noConfig){setting.values.delete("JUNGSI_P1_R27_CONSUMER_BINDING_JSON");setting.values.delete("JUNGSI_P1_R27_CONSUMER_BINDING_SHA256")}
 if(options.mode==="partial")setting.values.delete("JUNGSI_P1_R27_CONSUMER_BINDING_SHA256");
 if(options.mode==="bad_digest")setting.values.set("JUNGSI_P1_R27_CONSUMER_BINDING_SHA256","f".repeat(64));
 if(options.mode==="malformed"){
  setting.values.set("JUNGSI_P1_R27_CONSUMER_BINDING_JSON","{");
  setting.values.set("JUNGSI_P1_R27_CONSUMER_BINDING_SHA256",await hash(new TextEncoder().encode("{")));
 }
 if(options.mode==="expired"||options.mode==="wrong_scope"){
  const d=JSON.parse(setting.values.get("JUNGSI_P1_R27_CONSUMER_BINDING_JSON"));
  if(options.mode==="expired")d.expires_at_utc_micros=String(NOW);
  if(options.mode==="wrong_scope")d.pins.scopeSha256="f".repeat(64);
  const raw=JSON.stringify(d);
  setting.values.set("JUNGSI_P1_R27_CONSUMER_BINDING_JSON",raw);
  setting.values.set("JUNGSI_P1_R27_CONSUMER_BINDING_SHA256",await hash(new TextEncoder().encode(raw)));
 }
 const bound={descriptorSha256:"a".repeat(64),expiresAtUtc:EXP,
  operations:["history.snapshot.head","history.snapshot.read"],readLimits:{maxBytes:16000000},
  readViews:{snapshot:f.binding},projectUrl:f.storage.projectUrl,storage:f.storage,
  usageStoreLimits:{runtimeHardLimitSeconds:5n}};
 const fakeSql={read:async(subject,work)=>{
   assert.equal(subject,OWNER);
   return await work({query:async()=>[[f.rows.value.releaseVersion,f.rows.value.contentSha256,
    f.rows.value.reviewStatus,f.rows.value.metadataText]]});
 }};
 const ctx=new NativeRuntimeRequest(setting.env,()=>({}),()=>fakeSql,{nowUtc:()=>NOW},
   options.operation??"history.snapshot.read",f.fetcher);
 ctx.binding=async()=>bound;
 ctx.controls=async()=>({fetcher:f.fetcher});
 ctx.budget=async()=>({policy:{responseLimit:()=>131072n}});
 const selected=execution(options.operation??"history.snapshot.read");
 await ctx.prepareP1R27(setting.request,selected);
 return {ctx,selected,setting,...f};
}

async function expect503(work) {
 let error;
 try { await work(); } catch (e) { error=e; }
 assert.ok(error,"expected safe failure");
 assert.equal(error.http,503);
}
await test("request context partial v2 head and body preserve pinned coverage and exclude held rows",async()=>{
 const x=await material(),h=await contextFor(x,{operation:"history.snapshot.head"});
 const head=await h.ctx.readView(h.selected);h.ctx.assertP1R27Current();h.ctx.closeP1R27();
 const b=await contextFor(x),body=await b.ctx.readView(b.selected);b.ctx.assertP1R27Current();
 const expected={status:"partial",source_rows:3,included_rows:1,excluded_rows:1,review_pending_rows:1};
 assert.deepEqual({...head.r27_scope_coverage},expected);
 assert.deepEqual({...body.r27_scope_coverage},expected);
 assert.equal(head.publication_sha256,x.pins.manifestSha256);
 const visible=body.rows.filter(r=>r.academic_year===2027);
 assert.equal(visible.length,1);assert.equal(visible[0].original_pk,"SYN-INCLUDED");
 assert.equal(visible[0].recruitment_count_with_stage.value,0);
 const publicText=nativeJsonText({head,body});
 for(const marker of ["SYN-HOLD","SYN-EXCLUDED","SYN-PRIVATE-REF"])assert.equal(publicText.includes(marker),false);
 const source=await b.ctx.snapshot(OWNER),pub=await source.current();
 const altered={...body,r27_scope_coverage:{...body.r27_scope_coverage,review_pending_rows:0}};
 const absent={...body};delete absent.r27_scope_coverage;
 await assert.rejects(validateQualifiedHistorySnapshotPayload(altered,pub.full,pub));
 await assert.rejects(validateQualifiedHistorySnapshotPayload(absent,pub.full,pub));
 b.ctx.closeP1R27();
});
await test("missing or incorrect dedicated credential blocks both partial head and direct read",async()=>{
 const x=await material();
 for(const credential of [null,"incorrect"])for(const operation of ["history.snapshot.head","history.snapshot.read"]){
  const f=await contextFor(x,{credential,operation});
  await expect503(()=>f.ctx.readView(f.selected));
  assert.equal(f.calls.some(v=>v.includes("index.json")||v.includes("part-0.gz")),false);
  f.ctx.closeP1R27();
 }
});
await test("repinned legacy or unsupported consumer approval cannot release partial head or body",async()=>{
 for(const mode of ["legacy","unsupported"])for(const operation of ["history.snapshot.head","history.snapshot.read"]){
  const x=await material(mode),f=await contextFor(x,{operation});
  await expect503(()=>f.ctx.readView(f.selected));
  assert.equal(f.calls.some(v=>v.includes("consumer.json")),true);
  assert.equal(f.calls.some(v=>v.includes("part-0.gz")),false);
  f.ctx.closeP1R27();
 }
});
console.log(JSON.stringify({result:"SYNTHETIC_ONLY",passed:results.length,cases:results}));
