import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { JsonFloat, parseNativeJson } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { nativeJsonText, nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { HISTORY_SNAPSHOT_SLOTS } from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import { bindFieldQualificationPublication } from "../../supabase/functions/_shared/jungsi/application/history_field_qualification.ts";
import { bindReviewedR27Scope, combineReviewedR27Scopes, bindReviewedR27Links } from "../../supabase/functions/_shared/jungsi/application/r27_standalone.ts";
import { bindP1R27Evidence, composeP1R27Candidate, preflightP1MultipartInputs } from "../../supabase/functions/_shared/jungsi/application/p1_r27_composition.ts";
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

const preflightLimits = (overrides = {}) => ({ ...buildLimits(), max_source_total_bytes: 10_000_000, ...overrides });
const run = (f, lim = preflightLimits()) => preflightP1MultipartInputs(f.previous, f.source, f.context, f.scope, f.link, lim);
function oldPending(i) {
  return historical(2025, { offering_id: null, original_pk: null, observation_key: `observation:${i.toString(16).padStart(64, "0")}`, mapping_status: "mapping_pending", identity_review: { status: "mapping_pending", reason_code: "SYN_PENDING", variants: [] } });
}

await test("real validators accept per-part synthetic history and retain 85 pending as unpublished input", async () => {
  const pending = Array.from({ length: 85 }, (_, i) => oldPending(i));
  const h = historical(2026), cell = h.recruitment_count_with_stage;
  cell.value = new JsonFloat("9.71000000000000009"); cell.status = "pending_metadata";
  const f = await fixture([sourceRow()], [pending.slice(0, 43), pending.slice(43), [h]]);
  const before = f.previous.images.map((x) => Buffer.from(x).toString("hex"));
  const result = await run(f);
  assert.equal(result.status, "HOLD_UNPUBLISHED"); assert.equal(result.publication_ready, false);
  assert.equal(result.baseline_parts, 3); assert.equal(result.baseline_rows, 86); assert.equal(result.baseline_pending_rows, 85);
  assert.equal(result.source_rows, 1); assert.equal(result.prior_decisions, "NOT_VERIFIED");
  assert.equal(result.schools_observations, "NOT_VERIFIED"); assert.equal(result.output_parts, "NOT_BUILT");
  assert.deepEqual(f.previous.images.map((x) => Buffer.from(x).toString("hex")), before);
  assert.equal(parseNativeJson('9.71000000000000009').lexeme, "9.71000000000000009");
});

await test("missing track or group is rejected without conversion to null", async () => {
  for (const field of ["admission_track", "group"]) {
    const original = sourceRow(), f = await fixture([original]), bad = { ...original }; delete bad[field];
    const e = await evidenceFor([bad], {}, f.previous.pub.publicationSha256);
    f.context = await bindP1R27Evidence(e.manifestBytes, e.coverageBytes, e.pins); f.source.pages = e.pageBytes;
    await assert.rejects(run(f), /source_required_field_missing/);
  }
});

await test("absent campus stays page-bound UNKNOWN without changing source or becoming confirmed null", async () => {
  for (const campus of [null,"SYN-CAMPUS"]) {
    const original=sourceRow({campus}), f=await fixture([original]), absent={...original}; delete absent.campus;
    const e=await evidenceFor([absent],{},f.previous.pub.publicationSha256);
    f.context=await bindP1R27Evidence(e.manifestBytes,e.coverageBytes,e.pins); f.source.pages=e.pageBytes;
    const originalBytes=Buffer.from(e.pageBytes[0]).toString("hex"), result=await run(f);
    assert.equal(result.source_rows,1); assert.equal(result.source_scope_only_candidates,1); assert.equal(result.source_scope_only_held,0);
    assert.equal(result.source_scope_reconciliation,"NOT_VERIFIED"); assert.equal(result.source_campus_absent.length,1);
    const proof=result.source_campus_absent[0]; assert.equal(proof.presence,"ABSENT");
    assert.equal(proof.grant_campus,campus===null?"NULL":"PRESENT"); assert.equal(proof.scope_result,"SCOPE_CANDIDATE");
    assert.equal(proof.page_sha256,await hash(e.pageBytes[0])); assert.equal(Object.hasOwn(absent,"campus"),false);
    assert.equal(Buffer.from(e.pageBytes[0]).toString("hex"),originalBytes);
    const parsed=parseNativeJson(new TextDecoder().decode(e.pageBytes[0])); assert.equal(Object.hasOwn(parsed.rows[0],"campus"),false);
    assert.equal(result.prior_decisions,"NOT_VERIFIED"); assert.equal(result.publication_ready,false);
  }
});

await test("ambiguous grant campuses remain held instead of selecting a value", async () => {
  const a=sourceRow({campus:null}), b=sourceRow({campus:"SYN-CAMPUS"}), f=await fixture([a,b]), absent={...a}; delete absent.campus;
  const e=await evidenceFor([absent],{},f.previous.pub.publicationSha256);
  f.context=await bindP1R27Evidence(e.manifestBytes,e.coverageBytes,e.pins); f.source.pages=e.pageBytes;
  const result=await run(f); assert.equal(result.source_scope_only_candidates,0); assert.equal(result.source_scope_only_held,1);
  assert.equal(result.source_campus_absent[0].grant_campus,"UNKNOWN"); assert.equal(result.source_campus_absent[0].scope_result,"SCOPE_HELD");
  assert.equal(result.publication_ready,false);
});

await test("absent campus does not convert quota zero, null or missing stage", async () => {
  for (const value of [0,null]) {
    const original=sourceRow({campus:null,quota_value:value}), f=await fixture([original]), absent={...original};
    delete absent.campus; delete absent.quota_stage;
    const e=await evidenceFor([absent],{},f.previous.pub.publicationSha256);
    f.context=await bindP1R27Evidence(e.manifestBytes,e.coverageBytes,e.pins); f.source.pages=e.pageBytes;
    const result=await run(f), parsed=parseNativeJson(new TextDecoder().decode(e.pageBytes[0]));
    assert.equal(result.source_scope_only_candidates,1); assert.equal(result.source_campus_absent[0].presence,"ABSENT");
    assert.equal(parsed.rows[0].quota_value,value); assert.equal(Object.hasOwn(parsed.rows[0],"quota_stage"),false);
    assert.equal(result.prior_decisions,"NOT_VERIFIED"); assert.equal(result.publication_ready,false);
  }
});

await test("same school and PK with conflicting track or group is held when campus is absent", async () => {
  for (const field of ["admission_track","group"]) {
    const a=sourceRow({[field]:"SYN-A"}), b=sourceRow({[field]:"SYN-B"}), f=await fixture([a,b]);
    const a0={...a},b0={...b}; delete a0.campus;delete b0.campus;
    const e=await evidenceFor([a0,b0],{},f.previous.pub.publicationSha256);
    f.context=await bindP1R27Evidence(e.manifestBytes,e.coverageBytes,e.pins); f.source.pages=e.pageBytes;
    const result=await run(f); assert.equal(result.source_scope_only_candidates,0); assert.equal(result.source_scope_only_held,2);
    assert.ok(result.source_campus_absent.every((p)=>p.scope_result==="SCOPE_HELD"));
  }
});

await test("same PK conflicts across campus presence and separate source pages hold only related claims", async () => {
  for (const variant of ["same_track", "different_track", "different_group"]) {
    const present = sourceRow({ campus: null });
    const other = sourceRow({ campus: "SYN-OTHER-CAMPUS",
      ...(variant === "different_track" ? { admission_track: "SYN-OTHER-TRACK" } : {}),
      ...(variant === "different_group" ? { group: "SYN-OTHER-GROUP" } : {}) });
    const grant2 = variant === "same_track" ? present : other;
    const unrelated = Array.from({ length: 127 }, (_, i) => sourceRow({ original_pk: `SYN-OTHER-${i}` }));
    const f = await fixture([present, ...unrelated, ...(variant === "same_track" ? [] : [grant2])]);
    const absent = { ...grant2 }; delete absent.campus;
    const e = await evidenceFor([present, ...unrelated, absent], {}, f.previous.pub.publicationSha256);
    f.context = await bindP1R27Evidence(e.manifestBytes, e.coverageBytes, e.pins); f.source.pages = e.pageBytes;
    const result = await run(f);
    assert.equal(result.source_pages, 2); assert.equal(result.source_rows, 129);
    assert.equal(result.source_scope_only_candidates, 127); assert.equal(result.source_scope_only_held, 2);
    assert.equal(result.source_campus_absent[0].scope_result, "SCOPE_HELD");
    assert.equal(result.status, "HOLD_UNPUBLISHED"); assert.equal(result.publication_ready, false);
    assert.equal(result.source_scope_reconciliation, "NOT_VERIFIED");
  }
});

await test("same PK collisions hold present-campus and formerly excluded claims", async () => {
  const a = sourceRow({ campus: null });
  const b = sourceRow({ campus: "SYN-CAMPUS-B", admission_track: "SYN-OTHER-TRACK" });
  const unrelated = sourceRow({ original_pk: "SYN-OTHER" });
  // Fully specified, independently scoped claims remain separate; this is
  // still preflight only and does not establish any physical target or seal.
  const variants = [
    ...["campus", "admission_track", "group"].map((field) =>
      sourceRow({ ...a, [field]: field === "group" ? "SYN-GROUP-B" : "SYN-VARIANT" })),
    b,
  ];
  for (const other of variants) {
    const same = await fixture([a, other, unrelated]);
    const both = await run(same);
    assert.equal(both.source_scope_only_candidates, 3); assert.equal(both.source_scope_only_held, 0);
    assert.equal(both.source_scope_reconciliation, "NOT_VERIFIED");
    assert.equal(both.publication_ready, false);
  }
  // An identical full scope is not a distinct claim, even when quota differs.
  const duplicate = await fixture([a, { ...a, quota_value: 7 }, unrelated]);
  const duplicated = await run(duplicate);
  assert.equal(duplicated.source_scope_only_candidates, 1);
  assert.equal(duplicated.source_scope_only_held, 2);
  const excluded = sourceRow({ campus: null, scope: { state: "excluded_practical", evidence_sha256: EV } });
  const eligible = sourceRow({ campus: "SYN-CAMPUS-B" });
  const mixed = await fixture([excluded, eligible, unrelated]);
  const absent = { ...eligible }; delete absent.campus;
  const e = await evidenceFor([excluded, absent, unrelated], {}, mixed.previous.pub.publicationSha256);
  mixed.context = await bindP1R27Evidence(e.manifestBytes, e.coverageBytes, e.pins); mixed.source.pages = e.pageBytes;
  const reviewed = await run(mixed);
  assert.equal(reviewed.source_scope_only_candidates, 1); assert.equal(reviewed.source_scope_only_held, 2);
  assert.equal(reviewed.source_campus_absent[0].scope_result, "SCOPE_HELD");
  assert.equal(reviewed.publication_ready, false);
});

await test("source page also honors the requested max_depth before schema validation", async () => {
  const original = sourceRow(), f = await fixture([original]), limits = preflightLimits({ max_depth: 5 });
  assert.equal((await run(f, limits)).publication_ready, false);
  const deep = { ...original, unexpected_depth: { nested: { nested: { nested: {} } } } };
  const e = await evidenceFor([deep], {}, f.previous.pub.publicationSha256);
  f.context = await bindP1R27Evidence(e.manifestBytes, e.coverageBytes, e.pins); f.source.pages = e.pageBytes;
  await assert.rejects(run(f, limits), /baseline_depth_limit/);
});

await test("explicit null is a separate input value and does not issue prior-decision approval", async () => {
  const f = await fixture([sourceRow({ campus: null, admission_track: null, group: null })]), result = await run(f);
  assert.equal(result.source_rows, 1); assert.equal(result.source_campus_absent.length, 0); assert.equal(result.prior_decisions, "NOT_VERIFIED"); assert.equal(result.publication_ready, false);
});

await test("existing q requires real previous qualified context and never authorizes the new publication", async () => {
  const old=historical();
  old.identity_review={status:"review_pending",reason_code:"SYN-REVIEW",variants:[{university_name:"SYN SCHOOL",department:"SYN PRIOR",admission_track:"SYN-TRACK",group:"SYN-GROUP"}]};
  const subject={observation_id:"observation:"+S,academic_year:2026,offering_pk:old.original_pk,identity_variant_index:0};
  old.final_additional_admission_rank={...old.final_additional_admission_rank,value:"17",status:"pending_metadata",reason_code:"SYN-RAW",source_context:{observation_id:subject.observation_id,identity_variant_index:0,scope_status:"review_pending"}};
  const approval={field:"final_additional_admission_rank",subject,expected_raw_cell_sha256:await nativeJsonSha256(old.final_additional_admission_rank),expected_native_value_type:"string",expected_raw_status:"pending_metadata",expected_raw_unit:null,expected_identity_review_sha256:await nativeJsonSha256(old.identity_review)};
  const oldReceipt=encode({format:"jungsi.history-field-qualification-receipt/v1",status:"approved_exact_fields",authority_sha256:EV,source_head_sha256:OLD,scope_sha256:SCOPE,expected_previous_manifest_sha256:"6".repeat(64),subjects:[approval]});
  const oldReceiptSha=await hash(oldReceipt), descriptor=[{...approval,authority_sha256:EV,qualification_receipt_sha256:oldReceiptSha}];
  old.final_additional_admission_rank.service_qualification={format:"jungsi.history-field-service-qualification/v1",authority_sha256:EV,qualification_receipt_sha256:oldReceiptSha,subject,normalized_service_fields:{status:"verified_official",unit:"번"}};
  const previous=await previousPort([[old]]), rows=[sourceRow()], e=await evidenceFor(rows,{},previous.pub.publicationSha256);
  const context=await bindP1R27Evidence(e.manifestBytes,e.coverageBytes,e.pins), scope=await scopes(rows);
  const source={async readPage(i){return e.pageBytes[i]},async assertSourceHead(head){assert.equal(head,H)}};
  await assert.rejects(preflightP1MultipartInputs(previous,source,context,scope,undefined,preflightLimits()));
  previous.pub.fieldQualification=await bindFieldQualificationPublication(descriptor,oldReceipt,{publicationSha256:previous.pub.publicationSha256,sourceHeadSha256:OLD,scopeSha256:SCOPE,authoritySha256:EV,qualificationReceiptSha256:oldReceiptSha,previousManifestSha256:"6".repeat(64),expectedSubjectCount:1});
  const result=await preflightP1MultipartInputs(previous,source,context,scope,undefined,preflightLimits());
  assert.equal(result.baseline_qualified_rows,1); assert.equal(result.new_qualification_publication_binding,"NOT_RUN");
  assert.equal(result.publication_ready,false); assert.equal(result.output_parts,"NOT_BUILT");
});

await test("a source scope candidate is not a prior-decision approval", async () => {
  const f = await fixture([sourceRow()]), result = await run(f);
  assert.equal(result.source_scope_only_candidates, 1); assert.equal(result.prior_decisions, "NOT_VERIFIED");
  assert.equal(result.output_parts, "NOT_BUILT"); assert.equal(result.publication_ready, false);
});

await test("unverified initial stage stays unspecified while native source stage and zero are preserved", async () => {
  const initial=await fixture([sourceRow({quota_value:0,quota_stage:"initial"})]);
  const candidate=await initial.build(), row=candidate.body.rows.find((x)=>x.academic_year===2027);
  assert.equal(row.recruitment_count_with_stage.value,0); assert.equal(row.recruitment_count_with_stage.stage,"unspecified");
  assert.equal(row.r27_source.quota.quota_stage,"initial");
  const conditional=await fixture([sourceRow({quota_value:0,quota_stage:"initial",quota_literal_state:"conditional_transfer"})]);
  const conditioned=(await conditional.build()).body.rows.find((x)=>x.academic_year===2027);
  assert.equal(conditioned.recruitment_count_with_stage.value,0); assert.equal(conditioned.recruitment_count_with_stage.stage,"unspecified");
  assert.equal(conditioned.r27_source.quota_review_status,"condition_present");
  for(const stage of [null,"final"]) {
    const f=await fixture([sourceRow({quota_stage:stage})]), c=await f.build(), r=c.body.rows.find((x)=>x.academic_year===2027);
    assert.equal(r.recruitment_count_with_stage.stage,"unspecified");
  }
  const absent=sourceRow();delete absent.quota_stage;
  const f=await fixture([absent]), c=await f.build(), r=c.body.rows.find((x)=>x.academic_year===2027);
  assert.equal(r.recruitment_count_with_stage.stage,"unspecified"); assert.equal(Object.hasOwn(r.r27_source.quota,"quota_stage"),false);
});

await test("explicit review-pending scope stays held and is not promoted by a different grant", async () => {
  const other=sourceRow({original_pk:"SYN-OTHER"}), f=await fixture([other]);
  const held=sourceRow({scope:{state:"review_pending",evidence_sha256:null}});
  const e=await evidenceFor([held],{},f.previous.pub.publicationSha256);
  f.context=await bindP1R27Evidence(e.manifestBytes,e.coverageBytes,e.pins); f.source.pages=e.pageBytes;
  const result=await run(f);
  assert.equal(result.source_scope_only_candidates,0); assert.equal(result.source_scope_only_held,1);
  assert.equal(result.prior_decisions,"NOT_VERIFIED"); assert.equal(result.publication_ready,false);
});

await test("global duplicate identities across parts fail closed", async () => {
  const a = historical(2026), f = await fixture([sourceRow()], [[a], [a]]);
  await assert.rejects(run(f), /baseline_global_duplicate/);
});

await test("previous head and source head are checked before and after their reads", async () => {
  const f = await fixture([sourceRow()]); await run(f);
  assert.equal(f.previous.calls, 1); assert.equal(f.previous.finishes, 3);
  assert.equal(f.source.calls, 1); assert.equal(f.source.finishes, 2);
  const stalePrevious = await fixture([sourceRow()]); stalePrevious.previous.failFinish = true;
  await assert.rejects(run(stalePrevious), /SYN_PREVIOUS_CHANGED/); assert.equal(stalePrevious.previous.calls, 0);
  const staleSource = await fixture([sourceRow()]); staleSource.source.failFinish = true;
  await assert.rejects(run(staleSource), /SYN_SOURCE_CHANGED/); assert.equal(staleSource.source.calls, 0);
});

await test("false or null from current-head assertions is rejected", async () => {
  for (const value of [false, null]) {
    const a = await fixture([sourceRow()]); a.previous.assertCurrent = async () => value;
    await assert.rejects(run(a), /previous_assert_invalid/); assert.equal(a.previous.calls, 0);
    const b = await fixture([sourceRow()]); b.source.assertSourceHead = async () => value;
    await assert.rejects(run(b), /source_assert_invalid/); assert.equal(b.source.calls, 0);
  }
  for (const which of ["previous", "source"]) {
    for (const at of (which === "previous" ? [1, 2, 3] : [1, 2])) {
      for (const value of [false, null, "throw"]) {
        const f=await fixture([sourceRow()]); let calls=0;
        const port=which==="previous"?f.previous:f.source;
        const method=which==="previous"?"assertCurrent":"assertSourceHead";
        const original=port[method].bind(port);
        port[method]=async (...args)=>{
          await original(...args);calls++;
          if(calls!==at)return undefined;
          if(value==="throw")throw new Error("SYN_PREFLIGHT_"+which.toUpperCase()+"_EXCEPTION");
          return value;
        };
        const expected=value==="throw"?new RegExp("SYN_PREFLIGHT_"+which.toUpperCase()+"_EXCEPTION"):
          new RegExp(which+"_assert_invalid");
        await assert.rejects(run(f),expected);assert.equal(calls,at);
      }
    }
  }
  assert.equal((await run(await fixture([sourceRow()]))).status,"HOLD_UNPUBLISHED");
});

await test("compressed and source page alterations fail their own pins", async () => {
  const badPart = await fixture([sourceRow()]); badPart.previous.images[0][0] ^= 1;
  await assert.rejects(run(badPart), /baseline_gzip_digest_mismatch/);
  const badPage = await fixture([sourceRow()]); badPage.source.pages[0][0] ^= 1;
  await assert.rejects(run(badPage), /page_digest_mismatch/);
});

await test("part and compressed input arrays reject getters and sparse elements", async () => {
  for (const kind of ["parts", "gzip", "sparse"]) {
    const f=await fixture([sourceRow()]); let invoked=0;
    const arr=kind==="parts"?f.previous.pub.parts:f.previous.images;
    if(kind==="sparse") delete arr[0];
    else {const original=arr[0];Object.defineProperty(arr,"0",{enumerable:true,configurable:true,get(){invoked++;return original}})}
    await assert.rejects(run(f),/baseline_array_invalid/); assert.equal(invoked,0);
  }
  const shared = (input) => {
    const out = new Uint8Array(new SharedArrayBuffer(input.length));
    out.set(input);
    return out;
  };
  const e = await evidenceFor([sourceRow()]);
  await assert.rejects(bindP1R27Evidence(shared(e.manifestBytes), e.coverageBytes, e.pins), /invalid_bytes/);
  await assert.rejects(bindP1R27Evidence(e.manifestBytes, shared(e.coverageBytes), e.pins), /invalid_bytes/);
  const page = await fixture([sourceRow()]);
  page.source.pages[0] = shared(page.source.pages[0]);
  await assert.rejects(run(page), /invalid_bytes/);
  const previous = await fixture([sourceRow()]);
  previous.previous.images[0] = shared(previous.previous.images[0]);
  await assert.rejects(run(previous), /invalid_bytes/);
  const copy = new Uint8Array(e.manifestBytes); let invoked = 0;
  for (const key of ["byteLength", "buffer", Symbol.iterator]) {
    Object.defineProperty(copy, key, { get() { invoked++; throw Error("SYN_SPOOFED_PROPERTY"); } });
  }
  await bindP1R27Evidence(copy, e.coverageBytes, e.pins);
  assert.equal(invoked, 0);
});

await test("source bytes and all input rows, including held rows, consume explicit budgets", async () => {
  const a=await fixture([sourceRow()]);
  await assert.rejects(run(a,preflightLimits({max_source_total_bytes:1})),/source_byte_limit/); assert.equal(a.source.calls,0);
  const held=sourceRow({scope:{state:"review_pending",evidence_sha256:null}}), b=await fixture([held]);
  await assert.rejects(run(b,preflightLimits({max_combined_rows:1})),/combined_row_limit/); assert.equal(b.source.calls,0);
  const missing=preflightLimits(); delete missing.max_source_total_bytes;
  const c=await fixture([sourceRow()]); await assert.rejects(run(c,missing),/invalid_evidence/);
});

await test("mutable limits are snapshotted before the first asynchronous boundary", async () => {
  const f = await fixture([sourceRow()]), lim = preflightLimits({ max_baseline_decoded_bytes: 1 });
  const pending = run(f, lim); lim.max_baseline_decoded_bytes = 268_435_457;
  await assert.rejects(pending, /baseline_byte_limit/);
  let invoked = 0; const getter = preflightLimits();
  Object.defineProperty(getter, "max_baseline_parts", { enumerable: true, get() { invoked++; return 200; } });
  await assert.rejects(run(f, getter), /invalid_evidence/); assert.equal(invoked, 0);
});

await test("combined source and baseline cannot exceed the existing row limit", async () => {
  const f = await fixture([sourceRow()]);
  await assert.rejects(run(f, preflightLimits({ max_combined_rows: 1 })), /combined_row_limit/);
});

await test("unsealed evidence and missing scope context do not create publication authority", async () => {
  const f = await fixture([sourceRow()]);
  await assert.rejects(preflightP1MultipartInputs(f.previous, f.source, {}, f.scope, f.link, preflightLimits()), /evidence_not_bound/);
  await assert.rejects(preflightP1MultipartInputs(f.previous, f.source, f.context, {}, f.link, preflightLimits()), /unsealed_scope_context/);
});

await test("151 synthetic parts and 15476 prior rows above 64 MiB are validated part by part", async () => {
  const count=15_476, nParts=151, groups=[], template=historical(2026), paddedU="u".repeat(1900), paddedD="d".repeat(1900), paddedT="t".repeat(1100);
  let index=0;
  for(let p=0;p<nParts;p++){
    const group=[], n=Math.floor(count/nParts)+(p<count%nParts?1:0);
    for(let j=0;j<n;j++,index++){
      const isPending=index<85,pk=`SYN-OLD-${index}`;
      group.push({...template,academic_year:2026,original_pk:isPending?null:pk,offering_id:isPending?null:`2026:${pk}`,
        observation_key:isPending?`observation:${index.toString(16).padStart(64,"0")}`:null,
        mapping_status:isPending?"mapping_pending":"mapped",
        identity_review:isPending?{status:"mapping_pending",reason_code:"SYN_PENDING",variants:[]}:template.identity_review,
        university_name:paddedU,department:paddedD,admission_track:paddedT});
    }
    groups.push(group);
  }
  const f=await fixture([sourceRow()],groups);
  const result=await run(f,preflightLimits({max_baseline_parts:151,max_combined_rows:15_477,max_body_bytes:67_108_864,
    max_baseline_gzip_bytes:134_217_728,max_baseline_decoded_bytes:268_435_456,max_part_gzip_bytes:16_777_216,max_part_decoded_bytes:67_108_864,max_depth:128}));
  assert.equal(result.baseline_parts,151); assert.equal(result.baseline_rows,15_476); assert.equal(result.baseline_pending_rows,85);
  assert.ok(result.baseline_decoded_bytes>67_108_864); assert.equal(result.output_parts,"NOT_BUILT"); assert.equal(result.publication_ready,false);
});

console.log(JSON.stringify({ status: "PASS_SYNTHETIC_PRELIGHT_ONLY", tests: results.length, cases: results, db_calls: 0, storage_calls: 0, output_parts: "NOT_BUILT", publication: "NOT_RUN" }));
