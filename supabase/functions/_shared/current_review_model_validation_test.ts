/** Synthetic qualification/closure tests. No operational baseline or trusted production receipt is present. */
import {
  assertModelDisplay, BASELINE_CENSUS, createPinnedEvidenceVerifier, createReadModelAdmissionReviewHandler,
  EVIDENCE_CLAIM, MODEL_RECIPES, modelActivationClaim, modelEvidenceExpectations,
  observationEvidenceExpectations, prepareBaselineDryRun, prepareDeltaDryRun, qualifyModelObservation,
  REVOCATION_PAYLOAD, validateCoverage, validateModelAncestry, validateReadModelDescriptor,
} from "./current_review_model_validation.ts";
import { ANCESTRY, arrayOf, BINDING, bytesHex, compactProof, compareBytes, digestRecord, encodeRecord, IMPACT, isClosedRecord,
  LEAF, merkleTree, MODEL_ROW, ReadModelError, REF, ROOT, recordOf, SEAL, sha256Bytes, SOURCE_STATE } from "./current_review_model_codec.ts";
import type { RecordShape } from "./current_review_model_codec.ts";
import { CURRENT_REVIEW_FIELDS, REVIEW_QUERY_FIELDS } from "./current_admission_review.ts";
import type { CurrentReviewQuery } from "./current_admission_review.ts";
import type { CurrentKey } from "./current_admission_display.ts";
import {
  assert, equal, rejects, rejectsSync, SYNTHETIC_BATCH, SYNTHETIC_BUDGET,
  SYNTHETIC_HASH, syntheticWireInput,
} from "./current_review_model_codec_test.ts";
import type { SyntheticObject as Obj } from "./current_review_model_codec_test.ts";
import type { EvidenceExpectation, EvidenceTrustPolicy, PublisherDryRunOptions, QualifiedObservation, QualifiedObservationInput, ReadModelDescriptor,
  ReadModelRawPage, ReadModelReviewPorts, ReadModelSelectedRow, TrustedEvidenceVerifier } from "./current_review_model_validation.ts";

export const SYNTHETIC_NOW = Date.parse("2026-10-10T03:17:00.000Z");
export const SYNTHETIC_AT = "2026-10-10T03:17:00.000000Z";
export const SYNTHETIC_PRODUCER = "00000000-0000-4000-8000-000000000010";
export const SYNTHETIC_VERIFIER = "00000000-0000-4000-8000-000000000020";
export const SYNTHETIC_REVIEWER = "00000000-0000-4000-8000-000000000030";
export const SYNTHETIC_APPROVER = "00000000-0000-4000-8000-000000000040";
export const SYNTHETIC_REVOCATION_ISSUER = "00000000-0000-4000-8000-000000000050";
export function clone<T>(value: T): T { return structuredClone(value); }
export function syntheticRef(label: string): Obj {
  return { evidence_id: `synthetic-${label}`, evidence_kind: "synthetic_fixture",
    immutable_version: "synthetic-v1", bytes: 1, sha256: SYNTHETIC_HASH,
    issuer_actor: SYNTHETIC_VERIFIER, recorded_at: SYNTHETIC_AT };
}
export function syntheticQualifiedInput(id = "synthetic-canonical-001", school: string | null = "synthetic-school"): QualifiedObservationInput {
  return { ...syntheticWireInput(id, school), source29_receipt: syntheticRef(`source29-${id}`),
    native32_receipt: syntheticRef(`native32-${id}`), native32_expected_digest: "cc".repeat(32), component_policy_sha256: "55".repeat(32),
    qualification_receipt: syntheticRef(`qualification-${id}`) };
}
export function syntheticCoverage(): Obj {
  const domain = (label: string) => ({ classification: "COMPLETE", effect_rules_sha256: SYNTHETIC_HASH,
    event_inventory_receipt: syntheticRef(`${label}-inventory`), before_root_receipt: syntheticRef(`${label}-before`),
    after_root_receipt: syntheticRef(`${label}-after`), coverage_proof_receipt: syntheticRef(`${label}-proof`) });
  return { coverage_version: "synthetic-closed-coverage-v2", source_change: domain("source"),
    correction: domain("correction"), curation: domain("curation"), school_scope: domain("school"),
    member: domain("member"), population: domain("population"), flag: domain("flag"), out_of_command: domain("outside"),
    writer_fence: { lease_id: "synthetic-exclusive-lease", lease_receipt: syntheticRef("writer-lease"),
      writer_scope_sha256: SYNTHETIC_HASH, begin_at: "2026-10-10T03:00:00.000000Z",
      end_at: "2026-10-10T04:00:00.000000Z", begin_state_sha256: SYNTHETIC_HASH,
      end_state_sha256: SYNTHETIC_HASH, allowed_writers_receipt: syntheticRef("allowed-writers"),
      out_of_protocol_write_check: syntheticRef("out-of-protocol") },
    state_registration: { mechanism_id: "synthetic-registration", mechanism_definition_sha256: SYNTHETIC_HASH,
      parent_registration_receipt: syntheticRef("parent-registration"), target_registration_receipt: syntheticRef("target-registration"),
      latest_snapshot_binding_receipt: syntheticRef("snapshot-registration") } };
}
export function syntheticAncestry(deltas: number): Obj {
  const ids = Array.from({ length: deltas + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
  return { head_batch_id: ids[0], entries: ids.map((id, i) => ({ depth: i, batch_id: id,
    batch_kind: i === deltas ? "baseline" : "delta", manifest_sha256: i === 0 ? null : SYNTHETIC_HASH,
    parent_batch_id: ids[i + 1] ?? null, parent_manifest_sha256: ids[i + 1] ? SYNTHETIC_HASH : null })) };
}

// These keys are generated, non-exportable, and synthetic. Neither a private key nor
// a producer-supplied bool/hash is used as the receiver's independent trust pin.
const SYNTHETIC_SIGNED_EVIDENCE: RecordShape = [["format", "T"], ["evidence_id", "T"],
  ["evidence_kind", "T"], ["immutable_version", "T"], ["issuer_actor", "U"], ["recorded_at", "Z"],
  ["not_before", "Z"], ["expires_at", "Z"], ["revoked", "B"], ["claim", recordOf(EVIDENCE_CLAIM)]];
export interface SyntheticAuthority {
  issuerKeys: ReadonlyMap<string, CryptoKey>;
  policy: EvidenceTrustPolicy;
  bytes: Map<string, Uint8Array>;
  payloads: Map<string, Obj>;
  sign(id: string, claim: Obj, overrides?: Obj): Promise<Obj>;
  revoke(receiptHashes?: string[], actors?: string[], overrides?: Obj): Promise<void>;
  verifier(): TrustedEvidenceVerifier;
}
export async function createSyntheticAuthority(): Promise<SyntheticAuthority> {
  const pairs = new Map<string, CryptoKeyPair>();
  for (const actor of [SYNTHETIC_VERIFIER, SYNTHETIC_APPROVER, SYNTHETIC_REVOCATION_ISSUER]) {
    pairs.set(actor, await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]) as CryptoKeyPair);
  }
  const issuerKeys = new Map([...pairs].map(([actor, pair]) => [actor, pair.publicKey]));
  const bytes = new Map<string, Uint8Array>(), payloads = new Map<string, Obj>();
  let revocationBytes = new Uint8Array();
  const policy: EvidenceTrustPolicy = {
    issuerRoles: new Map<string, ReadonlySet<"qualifier" | "verifier" | "approver" | "revocation">>([
      [SYNTHETIC_VERIFIER, new Set(["qualifier", "verifier"])], [SYNTHETIC_APPROVER, new Set(["approver"])],
      [SYNTHETIC_REVOCATION_ISSUER, new Set(["revocation"])]]),
    revocationIssuer: SYNTHETIC_REVOCATION_ISSUER, revocationPolicySha256: "bb".repeat(32),
    revocationSnapshotSha256: SYNTHETIC_HASH, maximumRevocationValidityMicros: 3_600_000_000n,
    async loadPinnedRevocationSnapshot() { return revocationBytes; },
  };
  const authority: SyntheticAuthority = { issuerKeys, policy, bytes, payloads,
    async sign(id, claim, overrides = {}) {
      const payload: Obj = { format: "jungsi.current-review-evidence/v2", evidence_id: `synthetic-${id}`,
        evidence_kind: "synthetic_independent_signature", immutable_version: "synthetic-v1",
        issuer_actor: SYNTHETIC_VERIFIER, recorded_at: SYNTHETIC_AT,
        not_before: "2026-10-10T03:00:00.000000Z", expires_at: "2026-10-10T04:00:00.000000Z",
        revoked: false, claim, ...overrides };
      const pair = pairs.get(payload.issuer_actor as string) ?? pairs.get(SYNTHETIC_VERIFIER)!;
      const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey,
        new Uint8Array(encodeRecord(SYNTHETIC_SIGNED_EVIDENCE, payload, SYNTHETIC_BUDGET)).buffer));
      const raw = new TextEncoder().encode(JSON.stringify({ payload, signature_hex: bytesHex(signature) }));
      const ref: Obj = { evidence_id: payload.evidence_id, evidence_kind: payload.evidence_kind,
        immutable_version: payload.immutable_version, bytes: raw.length, sha256: await sha256Bytes(raw),
        issuer_actor: payload.issuer_actor, recorded_at: payload.recorded_at };
      bytes.set(ref.sha256 as string, raw); payloads.set(ref.sha256 as string, payload); return ref;
    },
    async revoke(receiptHashes = [], actors = [], overrides = {}) {
      const payload = { format: "jungsi.current-review-evidence-revocations/v2", purpose: "current_admission_review",
        issuer_actor: SYNTHETIC_REVOCATION_ISSUER, as_of: "2026-10-10T03:00:00.000000Z",
        expires_at: "2026-10-10T04:00:00.000000Z", policy_sha256: "bb".repeat(32),
        revoked_receipt_sha256: receiptHashes, revoked_issuer_actors: actors, ...overrides };
      const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", pairs.get(SYNTHETIC_REVOCATION_ISSUER)!.privateKey,
        new Uint8Array(encodeRecord(REVOCATION_PAYLOAD, payload, SYNTHETIC_BUDGET)).buffer));
      revocationBytes = new TextEncoder().encode(JSON.stringify({ payload, signature_hex: bytesHex(signature) }));
      policy.revocationSnapshotSha256 = await sha256Bytes(revocationBytes);
    },
    verifier() { return createPinnedEvidenceVerifier(issuerKeys, async (refs) => refs.map((ref) => {
      const raw = bytes.get(ref.sha256 as string); assert(raw, "synthetic receipt absent"); return raw;
    }), SYNTHETIC_BUDGET, policy); },
  };
  await authority.revoke(); return authority;
}
export function syntheticClaim(domain = "synthetic_known_claim", digest = SYNTHETIC_HASH): Obj {
  return { purpose: "current_admission_review", tenant_key: "synthetic-tenant", command_id: "synthetic-command",
    payload_sha256: "44".repeat(32), definition_sha256: "55".repeat(32), source_projection_sha256: "66".repeat(32),
    model_projection_sha256: "77".repeat(32), selection_scope_sha256: "88".repeat(32),
    tenant_mapping_sha256: "99".repeat(32), claim_domain: domain, claim_digest: digest,
    completeness_state_id: "synthetic-source-complete", completeness_state_sha256: "aa".repeat(32),
    source_dependency_closure_sha256: SYNTHETIC_HASH, content_recipe_sha256: SYNTHETIC_HASH,
    model_row_recipe_sha256: SYNTHETIC_HASH, binding_recipe_sha256: SYNTHETIC_HASH, codec_spec_sha256: SYNTHETIC_HASH };
}
export const SYNTHETIC_RELAY = "synthetic-server-relay-generated-fixture-only";
export const SYNTHETIC_CURSOR_SECRET = new Uint8Array(32).fill(17);
export const SYNTHETIC_PREFIX = "/functions/v1/synthetic-current-review-model";
export interface SyntheticRuntimeFixture {
  descriptor: ReadModelDescriptor; authority: SyntheticAuthority; modelRows: Obj[];
  selected: ReadModelSelectedRow[]; rawPage(q: CurrentReviewQuery, after: CurrentKey | null): ReadModelRawPage;
}
export async function createSyntheticRuntimeFixture(count = 2): Promise<SyntheticRuntimeFixture> {
  assert(Number.isSafeInteger(count) && count >= 2 && count <= 140);
  const authority = await createSyntheticAuthority(), modelRows: Obj[] = [], leaves: string[] = [];
  const tenant = "synthetic-tenant", ancestry = syntheticAncestry(0);
  const sourceState = { command_id: "synthetic-command", payload_sha256: "44".repeat(32),
    definition_sha256: "55".repeat(32), source_projection_sha256: "66".repeat(32),
    completeness_state_id: "synthetic-source-complete", completeness_state_sha256: "aa".repeat(32),
    coverage_receipt_sha256: SYNTHETIC_HASH, source_dependency_closure_sha256: SYNTHETIC_HASH,
    content_recipe_sha256: SYNTHETIC_HASH, model_row_recipe_sha256: SYNTHETIC_HASH,
    binding_recipe_sha256: SYNTHETIC_HASH, codec_spec_sha256: SYNTHETIC_HASH };
  for (let index = 0; index < count; index++) {
    const input = syntheticQualifiedInput(`synthetic-canonical-${String(index + 1).padStart(3, "0")}`, index % 2 ? "" : null);
    const q = await qualifyModelObservation(input, sourceState.source_projection_sha256, "77".repeat(32), SYNTHETIC_BUDGET);
    const row = { tenant_key: tenant, batch_id: SYNTHETIC_BATCH, canonical_result_id: q.canonicalId,
      operation: "upsert", filters: q.filters, raw: q.raw, representative: q.representative,
      content_digest: q.contentDigest, member_digest: q.memberDigest, population_digest: q.populationDigest,
      display: q.display, display_digest: q.displayDigest, before_content_digest: null,
      impact_entry_sha256: SYNTHETIC_HASH, qualification_receipt_sha256: SYNTHETIC_HASH };
    modelRows.push(row); leaves.push(await digestRecord("current_review_leaf_v2", LEAF,
      { tenant_key: tenant, batch_id: SYNTHETIC_BATCH, leaf_index: index, canonical_result_id: q.canonicalId,
        model_row_digest: await digestRecord(MODEL_RECIPES.row, MODEL_ROW, row, SYNTHETIC_BUDGET) }, SYNTHETIC_BUDGET));
  }
  const tree = await merkleTree(leaves, tenant, SYNTHETIC_BATCH, SYNTHETIC_BUDGET);
  const sourceDigest = await digestRecord("current_review_source_state_v2", SOURCE_STATE, sourceState, SYNTHETIC_BUDGET);
  const ancestryDigest = await digestRecord("current_review_ancestry_v2", ANCESTRY, ancestry, SYNTHETIC_BUDGET);
  const root = { tenant_key: tenant, batch_id: SYNTHETIC_BATCH, batch_kind: "baseline", parent_batch_id: null,
    parent_manifest_sha256: null, source_state_digest: sourceDigest, model_projection_sha256: "77".repeat(32),
    selection_scope_sha256: "88".repeat(32), tenant_mapping_sha256: "99".repeat(32),
    content_recipe: MODEL_RECIPES.content, model_row_recipe: MODEL_RECIPES.row, binding_recipe: MODEL_RECIPES.binding,
    transition_manifest_sha256: SYNTHETIC_HASH, ancestry_digest: ancestryDigest, staged_change_count: count,
    upsert_count: count, retract_count: 0, expected_effective_observation_count: count,
    expected_effective_school_tuple_count: 2, change_merkle_root: tree.root, verification_plan_sha256: SYNTHETIC_HASH,
    producer_actor: SYNTHETIC_PRODUCER, created_at: SYNTHETIC_AT };
  const rootHash = await digestRecord("current_review_root_manifest_v2", ROOT, root, SYNTHETIC_BUDGET);
  const binding = { tenant_key: tenant, tenant_mapping_sha256: "99".repeat(32), source_state: sourceState,
    model_projection_sha256: "77".repeat(32), selection_scope_sha256: "88".repeat(32), head_batch_id: SYNTHETIC_BATCH,
    head_manifest_sha256: rootHash, ancestry_digest: ancestryDigest, transition_manifest_sha256: SYNTHETIC_HASH,
    content_recipe: MODEL_RECIPES.content, model_row_recipe: MODEL_RECIPES.row, binding_recipe: MODEL_RECIPES.binding };
  const seal = { tenant_key: tenant, batch_id: SYNTHETIC_BATCH, batch_manifest_sha256: rootHash,
    binding_sha256: await digestRecord(MODEL_RECIPES.binding, BINDING, binding, SYNTHETIC_BUDGET),
    ancestry_digest: ancestryDigest, source_state_digest: sourceDigest, transition_manifest_sha256: SYNTHETIC_HASH,
    tenant_mapping_sha256: "99".repeat(32), producer_actor: SYNTHETIC_PRODUCER, verifier_actor: SYNTHETIC_VERIFIER,
    verification_receipt_sha256: SYNTHETIC_HASH, approval_receipt_sha256: SYNTHETIC_HASH, sealed_at: SYNTHETIC_AT };
  const descriptor: ReadModelDescriptor = { format: "jungsi.current-review-read-model/v2", purpose: "current_admission_review",
    environment: "local_verification", source_view: "jungsi_data_ingest.admission_results_current",
    allowed_years: [2024, 2025, 2026, 2027], projection_version: "synthetic-read-model-v2",
    root, binding, seal, ancestry, ancestor_roots: [], model_metadata_sha256: SYNTHETIC_HASH,
    activation_receipt: syntheticRef("activation-placeholder"),
    approval: { status: "approved", approval_id: "synthetic-narrow-approval", issued_at: "2026-10-10T03:00:00.000000Z",
      expires_at: "2026-10-10T04:00:00.000000Z", revoked: false, review_subjects: [SYNTHETIC_REVIEWER], operations: ["current.review.search"] },
    engine_approved: false, production_allowed: false, general_publication_allowed: false, nationwide_collection_complete: false };
  descriptor.activation_receipt = await authority.sign("activation", await modelActivationClaim(descriptor, SYNTHETIC_BUDGET), { issuer_actor: SYNTHETIC_APPROVER });
  const selected = modelRows.map((row, index) => ({ model_row_hex: bytesHex(encodeRecord(MODEL_ROW, row, SYNTHETIC_BUDGET)),
    leaf_index: String(index), proof_hex: bytesHex(compactProof(tree.proofs[index])) }));
  return { descriptor, authority, modelRows, selected,
    rawPage(q, after) {
      const start = after ? modelRows.findIndex((r) => r.canonical_result_id === after[4]) + 1 : 0;
      assert(start >= 0, "synthetic unknown key");
      return { root: clone(root), binding: clone(binding), seal: clone(seal), ancestry: clone(ancestry), ancestorRoots: [],
        currentSourceState: clone(sourceState), grantNotBefore: descriptor.approval.issued_at, grantExpiresAt: descriptor.approval.expires_at,
        asOf: SYNTHETIC_AT, matchingObservationCount: String(count),
        matchingSourceSchoolCount: "2", rows: clone(selected.slice(start, start + q.limit + 1)) };
    } };
}
export function syntheticRequest(query = "", options: { relay?: string | null; bearer?: string | null; method?: string } = {}): Request {
  const headers = new Headers();
  if (options.relay !== null) headers.set("X-Jungsi-Relay-Token", options.relay ?? SYNTHETIC_RELAY);
  if (options.bearer !== null) headers.set("Authorization", `Bearer ${options.bearer ?? "synthetic-reviewer-bearer"}`);
  return new Request(`https://synthetic.invalid${SYNTHETIC_PREFIX}/api/v1/review/current-admissions${query}`, { method: options.method ?? "GET", headers });
}
export function syntheticHandler(ports: ReadModelReviewPorts, now = () => SYNTHETIC_NOW): (request: Request) => Promise<Response> {
  return createReadModelAdmissionReviewHandler(ports, { relayToken: SYNTHETIC_RELAY, cursorKey: SYNTHETIC_CURSOR_SECRET,
    pathPrefix: SYNTHETIC_PREFIX, environment: "local_verification", budget: SYNTHETIC_BUDGET, now });
}
export function syntheticPorts(fixture: SyntheticRuntimeFixture): ReadModelReviewPorts {
  return { async verifySession(token) { return token === "synthetic-reviewer-bearer" ? { subjectId: SYNTHETIC_REVIEWER, expiresAt: SYNTHETIC_NOW + 600_000 } : null; },
    async loadDescriptor() { return clone(fixture.descriptor); }, evidence: fixture.authority.verifier(),
    async readPage(_d, q, after) { return fixture.rawPage(q, after); } };
}

function observation(q: QualifiedObservation, label: string): Obj {
  return { in_approved_scope: true, academic_year: q.filters.academic_year, school_id: q.filters.school_id,
    university_code: q.filters.university_code, active_service: true, content_digest: q.contentDigest,
    current_wire_receipt: q.qualificationReceipt, representative: { release_id: q.representative.release_id,
      result_id: q.representative.result_id, source_row_fingerprint: q.representative.source_row_fingerprint,
      effective_row_fingerprint: q.representative.effective_row_fingerprint },
    member_multiset: { element_count: q.display.source_member_count, recipe: "current_review_member_multiset_v2",
      exact_digest: q.memberDigest, qualification_receipt: syntheticRef(`member-proof-${label}`) },
    population_multiset: { element_count: (q.display.link_scopes as unknown[]).length, recipe: "current_review_population_multiset_v2",
      exact_digest: q.populationDigest, qualification_receipt: syntheticRef(`population-proof-${label}`) },
    corrected_filter_digest: q.filterDigest, display17_digest: q.displayDigest,
    original_source29_validation_receipt: q.source29Receipt, native_canonical32_validation_receipt: q.native32Receipt,
    component_validation_policy_sha256: q.componentPolicySha256 };
}
async function syntheticIdDigest(ids: string[]): Promise<string> {
  return await digestRecord("current_review_canonical_id_set_v2", [["ids", arrayOf("T")]], { ids }, SYNTHETIC_BUDGET);
}
async function signExpectations(authority: SyntheticAuthority, expectations: EvidenceExpectation[]): Promise<Map<string, Obj>> {
  const refs = new Map<string, Obj>(), claims = new Map<string, string>();
  for (const e of expectations) {
    const id = e.reference.evidence_id as string, claim = JSON.stringify(e.claim);
    if (claims.has(id)) { equal(claims.get(id), claim, "a synthetic receipt cannot sign contradictory slots"); continue; }
    claims.set(id, claim);
    refs.set(id, await authority.sign(id.replace(/^synthetic-/, ""), e.claim,
      { evidence_kind: e.requiredKind ?? "synthetic_independent_signature",
        issuer_actor: e.requiredIssuer ?? (e.requiredRole === "approver" ? SYNTHETIC_APPROVER : SYNTHETIC_VERIFIER) }));
  }
  return refs;
}
function replaceReferences<T>(value: T, refs: Map<string, Obj>): T {
  const walk = (x: unknown): unknown => {
    if (isClosedRecord(x, REF)) return clone(refs.get(x.evidence_id as string) ?? x);
    if (Array.isArray(x)) return x.map(walk);
    if (x !== null && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]));
    return x;
  }; return walk(value) as T;
}
export interface SyntheticPublisherFixture { authority: SyntheticAuthority; manifest: Obj; inputs: QualifiedObservationInput[]; options: PublisherDryRunOptions }
export async function createSyntheticBaselineFixture(): Promise<SyntheticPublisherFixture> {
  const authority = await createSyntheticAuthority(), inputs = [syntheticQualifiedInput("synthetic-canonical-001", null), syntheticQualifiedInput("synthetic-canonical-002", "")];
  const state: Obj = { command_id: "synthetic-command", payload_sha256: "44".repeat(32), definition_sha256: "55".repeat(32),
    source_projection_sha256: "66".repeat(32), content_recipe: MODEL_RECIPES.content, model_row_recipe: MODEL_RECIPES.row,
    binding_recipe: MODEL_RECIPES.binding, completeness_state_id: "synthetic-source-complete", completeness_state_sha256: "aa".repeat(32),
    coverage_receipt: syntheticRef("baseline-target-coverage"), source_dependency_closure_sha256: SYNTHETIC_HASH,
    content_recipe_sha256: SYNTHETIC_HASH, model_row_recipe_sha256: SYNTHETIC_HASH, binding_recipe_sha256: SYNTHETIC_HASH, codec_spec_sha256: SYNTHETIC_HASH };
  const ids = ["synthetic-canonical-001", "synthetic-canonical-002"], idHash = await syntheticIdDigest(ids);
  const qs = await Promise.all(inputs.map((input) => qualifyModelObservation(input, "66".repeat(32), "77".repeat(32), SYNTHETIC_BUDGET)));
  const coverage = syntheticCoverage();
  const manifest: Obj = { manifest_version: "current_review_baseline_census_v2", baseline_id: SYNTHETIC_BATCH,
    tenant_key: "synthetic-tenant", tenant_mapping_sha256: "99".repeat(32), target_state: state,
    scope: { allowed_years: [2024, 2025, 2026, 2027], selection_scope_sha256: "88".repeat(32), model_projection_sha256: "77".repeat(32),
      qualification_rules_sha256: SYNTHETIC_HASH, canonical_universe_receipt: syntheticRef("baseline-canonical-universe"), dependency_rules_sha256: SYNTHETIC_HASH },
    coverage, census: qs.map((q) => ({ canonical_result_id: q.canonicalId, observation: observation(q, q.canonicalId) })),
    school_frequencies: [{ school_id: null, university_code: "synthetic-code", multiplicity: 1, frequency_evidence: syntheticRef("baseline-null-tuple") },
      { school_id: "", university_code: "synthetic-code", multiplicity: 1, frequency_evidence: syntheticRef("baseline-empty-tuple") }],
    checkpoints: [{ chunk_id: "synthetic-baseline-chunk-001", approved_ids_sha256: idHash,
      source_before_state_sha256: "aa".repeat(32), source_after_state_sha256: "aa".repeat(32), definition_sha256: "55".repeat(32),
      qualification_receipt: syntheticRef("baseline-checkpoint"), bytes_read: 20, bytes_written: 20, elapsed_micros: 100,
      lease_receipt: (coverage.writer_fence as Obj).lease_receipt, canonical_ids: ids }],
    producer_actor: SYNTHETIC_PRODUCER, verifier_actor: SYNTHETIC_VERIFIER,
    verification_receipt: syntheticRef("baseline-independent-verification"),
    approval_receipt: { ...syntheticRef("baseline-independent-approval"), issuer_actor: SYNTHETIC_APPROVER } };
  const expectations = [...await modelEvidenceExpectations(manifest, BASELINE_CENSUS, SYNTHETIC_BUDGET)];
  for (const q of qs) expectations.push(...await observationEvidenceExpectations(manifest, q, SYNTHETIC_BUDGET));
  const signed = await signExpectations(authority, expectations);
  const options: PublisherDryRunOptions = { budget: SYNTHETIC_BUDGET, evidence: authority.verifier(), now: SYNTHETIC_NOW,
    verificationPlanSha256: SYNTHETIC_HASH, createdAt: SYNTHETIC_AT, maximumObservations: 2 };
  return { authority, manifest: replaceReferences(manifest, signed), inputs: replaceReferences(inputs, signed), options };
}
export interface SyntheticDeltaFixture extends SyntheticPublisherFixture { ancestry: Obj }
export async function createSyntheticDeltaFixture(): Promise<SyntheticDeltaFixture> {
  const baseline = await createSyntheticBaselineFixture(), parent = await prepareBaselineDryRun(baseline.manifest, baseline.inputs, baseline.options);
  const parentState = clone(baseline.manifest.target_state as Obj); parentState.coverage_receipt = syntheticRef("delta-parent-coverage");
  const targetState = { ...clone(parentState), command_id: "synthetic-command-delta", payload_sha256: "dd".repeat(32),
    completeness_state_id: "synthetic-delta-complete", completeness_state_sha256: "ee".repeat(32), coverage_receipt: syntheticRef("delta-target-coverage") };
  const ids = ["synthetic-canonical-001", "synthetic-canonical-002"], affectedHash = await syntheticIdDigest(ids);
  const input = syntheticQualifiedInput(ids[1], ""); input.current.department = "합성정정학과"; input.native32_expected_digest = "d2".repeat(32);
  input.source29_receipt = syntheticRef("delta-source29"); input.native32_receipt = syntheticRef("delta-native32"); input.qualification_receipt = syntheticRef("delta-qualified-wire");
  const q = await qualifyModelObservation(input, "66".repeat(32), "77".repeat(32), SYNTHETIC_BUDGET);
  const census = baseline.manifest.census as Obj[], before = census.map((e) => clone(e.observation as Obj));
  const chunk = "synthetic-delta-chunk-001", batch = "00000000-0000-4000-8000-000000000101";
  const ancestry: Obj = { head_batch_id: batch, entries: [{ depth: 0, batch_id: batch, batch_kind: "delta", manifest_sha256: null,
    parent_batch_id: SYNTHETIC_BATCH, parent_manifest_sha256: parent.rootManifestSha256 }, { depth: 1, batch_id: SYNTHETIC_BATCH,
    batch_kind: "baseline", manifest_sha256: parent.rootManifestSha256, parent_batch_id: null, parent_manifest_sha256: null }] };
  const event = (id: string, index: number, canonical: string, type: string, start: string, end: string): Obj => ({
    event_id: id, command_id: "synthetic-command-delta", command_payload_sha256: "dd".repeat(32), change_type: type,
    ordinal: index, before_state_sha256: start, after_state_sha256: end, before_evidence: syntheticRef(`${id}-before`),
    after_evidence: syntheticRef(`${id}-after`), before_canonical_ids: [canonical], after_canonical_ids: type === "flag" ? [] : [canonical],
    dependency_edge_receipt: syntheticRef(`${id}-edge`), reason_codes: [`synthetic_${type}`] });
  const coverage = syntheticCoverage();
  const manifest: Obj = { manifest_version: "current_review_dependency_impact_v2", tenant_key: "synthetic-tenant", tenant_mapping_sha256: "99".repeat(32),
    parent_batch_id: SYNTHETIC_BATCH, parent_batch_manifest_sha256: parent.rootManifestSha256, parent_state: parentState, target_state: targetState,
    scope: { ...(baseline.manifest.scope as Obj), canonical_universe_receipt: syntheticRef("delta-universe") }, coverage,
    command_events: [event("synthetic-event-001", 0, ids[0], "flag", "aa".repeat(32), SYNTHETIC_HASH),
      event("synthetic-event-002", 1, ids[1], "correction", SYNTHETIC_HASH, "ee".repeat(32))],
    dependency_closure: { rules_sha256: SYNTHETIC_HASH, event_root_ids: ["synthetic-event-001", "synthetic-event-002"],
      edge_inventory_receipt: syntheticRef("delta-edge-inventory"), fixed_point_receipt: syntheticRef("delta-fixed-point"),
      before_canonical_ids: ids, after_canonical_ids: [ids[1]], affected_union_ids: ids, affected_union_sha256: affectedHash, unknown_edges: [] },
    impacts: [{ canonical_result_id: ids[0], before: before[0], after: null, operation: "retract", reason_codes: ["synthetic_flag"],
      origin_event_ids: ["synthetic-event-001"], dependency_evidence: syntheticRef("delta-retract-dependency"), qualification_receipt: syntheticRef("delta-retract-qualification") },
      { canonical_result_id: ids[1], before: before[1], after: observation(q, "delta-after"), operation: "upsert", reason_codes: ["synthetic_correction"],
        origin_event_ids: ["synthetic-event-002"], dependency_evidence: syntheticRef("delta-upsert-dependency"), qualification_receipt: syntheticRef("delta-upsert-impact-qualification") }],
    outside_unchanged: { parent_universe_receipt: syntheticRef("delta-outside-universe"), excluded_affected_ids_sha256: affectedHash,
      parent_outside_commitment: syntheticRef("delta-outside-parent"), target_outside_commitment: syntheticRef("delta-outside-target"),
      dependency_domains_complete_receipt: syntheticRef("delta-outside-domains"), writer_fence_receipt: syntheticRef("delta-outside-fence"),
      equivalence_proof_receipt: syntheticRef("delta-outside-equivalence"), exceptions: [] },
    counts: { parent_observation_count: 2, parent_school_tuple_count: 2, upsert_new_count: 0, retract_old_count: 1, replaced_count: 1,
      target_observation_count: 1, touched_school_tuples: [
        { school_id: null, university_code: "synthetic-code", parent_multiplicity: 1, removed_multiplicity: 1, added_multiplicity: 0,
          target_multiplicity: 0, frequency_evidence: syntheticRef("delta-null-frequency") },
        { school_id: "", university_code: "synthetic-code", parent_multiplicity: 1, removed_multiplicity: 1, added_multiplicity: 1,
          target_multiplicity: 1, frequency_evidence: syntheticRef("delta-empty-frequency") }],
      target_school_tuple_count: 1, parent_count_receipt: syntheticRef("delta-count-parent"),
      target_count_receipt: syntheticRef("delta-count-target"), count_equivalence_receipt: syntheticRef("delta-count-equivalence") },
    checkpoints: [{ chunk_id: chunk, approved_ids_sha256: affectedHash, source_before_state_sha256: "ee".repeat(32),
      source_after_state_sha256: "ee".repeat(32), definition_sha256: "55".repeat(32), qualification_receipt: syntheticRef("delta-checkpoint"),
      bytes_read: 20, bytes_written: 20, elapsed_micros: 100, lease_receipt: (coverage.writer_fence as Obj).lease_receipt }],
    producer_actor: SYNTHETIC_PRODUCER, verifier_actor: SYNTHETIC_VERIFIER, verification_receipt: syntheticRef("delta-independent-verification"),
    approval_receipt: { ...syntheticRef("delta-independent-approval"), issuer_actor: SYNTHETIC_APPROVER } };
  const expectations = [...await modelEvidenceExpectations(manifest, IMPACT, SYNTHETIC_BUDGET), ...await observationEvidenceExpectations(manifest, q, SYNTHETIC_BUDGET)];
  const signed = await signExpectations(baseline.authority, expectations);
  return { authority: baseline.authority, manifest: replaceReferences(manifest, signed), inputs: replaceReferences([input], signed), ancestry,
    options: { ...baseline.options, checkpointCoverage: [{ chunk_id: chunk, canonical_ids: ids }] } };
}

Deno.test("RM qualification: representative exactness and unique member IDs are mandatory", async () => {
  const input = syntheticQualifiedInput();
  const q = await qualifyModelObservation(input, SYNTHETIC_HASH, SYNTHETIC_HASH, SYNTHETIC_BUDGET);
  equal(q.canonicalId, "synthetic-canonical-001");
  equal(q.display.source_member_count, 1); equal(q.raw, { literal: "0", json_type: "number", numeric_text: "0" });
  equal(q.display.value_availability, "present");
  equal(q.representative, { release_id: "synthetic-release-001", result_id: input.current.source_result_id,
    source_row_fingerprint: "22".repeat(32), effective_row_fingerprint: "22".repeat(32), source_member_count: 1 });
  for (const mutate of [
    (x: QualifiedObservationInput) => { x.members[0].is_representative = false; },
    (x: QualifiedObservationInput) => { x.current.source_result_id = "synthetic-other-source"; },
    (x: QualifiedObservationInput) => { x.current.source_row_fingerprint = "44".repeat(32); },
    (x: QualifiedObservationInput) => { x.current.release_id = "synthetic-other-release"; },
    (x: QualifiedObservationInput) => { x.current.source_member_count = 2; },
    (x: QualifiedObservationInput) => { x.current.result_id = "synthetic-wrong-current-id"; },
    (x: QualifiedObservationInput) => { x.members.push({ ...x.members[0] }); x.current.source_member_count = 2; },
    (x: QualifiedObservationInput) => { x.members.push({ ...x.members[0], result_id: "synthetic-other-source" }); x.current.source_member_count = 2; },
  ]) { const invalid = clone(input); mutate(invalid); await rejects(() => qualifyModelObservation(invalid, SYNTHETIC_HASH, SYNTHETIC_HASH, SYNTHETIC_BUDGET)); }
});

Deno.test("RM qualification: raw numeric lexemes, actual null, missing, string0 and held values remain distinct", async () => {
  const cases: [unknown, unknown, unknown, string, unknown][] = [
    ["1.00", "number", "1", "present", "1.00"], ["1e0", "number", "1.000", "present", "1e0"],
    ["-0", "number", "0", "present", "-0"], ['"0"', "string", null, "present", '"0"'],
    ['""', "string", null, "present", '""'], ["null", "null", null, "actual_null", "null"],
    [null, null, null, "missing", null], ["0", "number", "1", "held", null],
    ["true", "boolean", null, "held", null], ["1.0", "integer", "1", "held", null],
  ];
  const digests = new Set<string>();
  for (const [literal, type, numeric, availability, shown] of cases) {
    const input = syntheticQualifiedInput(); Object.assign(input.current, { metric_value_literal: literal,
      metric_value_json_type: type, metric_value_numeric: numeric });
    const q = await qualifyModelObservation(input, SYNTHETIC_HASH, SYNTHETIC_HASH, SYNTHETIC_BUDGET);
    equal(q.raw, { literal, json_type: type, numeric_text: numeric });
    equal(q.display.value_availability, availability); equal(q.display.metric_value_literal, shown);
    if (availability === "held" || availability === "missing") equal(q.display.metric_value_numeric_text, null);
    assertModelDisplay(q.display, SYNTHETIC_BUDGET); digests.add(q.contentDigest);
  }
  equal(digests.size, cases.length, "raw value evidence must not be normalized away");
});

Deno.test("RM qualification: source JSON lexemes retain precision and reject duplicate keys", async () => {
  const input = syntheticQualifiedInput(); input.current.curation_fields = '{"synthetic_decimal":9007199254740993.123456789}';
  const q = await qualifyModelObservation(input, SYNTHETIC_HASH, SYNTHETIC_HASH, SYNTHETIC_BUDGET);
  assert(typeof q.contentDigest === "string");
  const invalid = clone(input); invalid.current.curation_fields = '{"x":1,"x":2}';
  await rejects(() => qualifyModelObservation(invalid, SYNTHETIC_HASH, SYNTHETIC_HASH, SYNTHETIC_BUDGET));
});

Deno.test("RM qualification: POP duplicates retain multiplicity while forward references forbid individual inference", async () => {
  const input = syntheticQualifiedInput(); input.population.push({ ...input.population[0] });
  const q = await qualifyModelObservation(input, SYNTHETIC_HASH, SYNTHETIC_HASH, SYNTHETIC_BUDGET);
  equal((q.display.link_scopes as Obj[]).length, 2);
  assert((q.display.hold_reasons as string[]).includes("aggregate_or_forward_reference"));
  equal(q.display.official_metadata, { metric_definition: null, unit: null, original_scale: null,
    source_url: null, source_as_of: null, publication_status: null });
  for (const patch of [{ result_id: "synthetic-other" }, { academic_year: 2026 }, { population_reference_year: null }, { link_kind: "" }]) {
    const invalid = clone(input); Object.assign(invalid.population[0], patch);
    await rejects(() => qualifyModelObservation(invalid, SYNTHETIC_HASH, SYNTHETIC_HASH, SYNTHETIC_BUDGET));
  }
});

Deno.test("RM display: private fields, publication claims and held raw values fail closed", async () => {
  const q = await qualifyModelObservation(syntheticQualifiedInput(), SYNTHETIC_HASH, SYNTHETIC_HASH, SYNTHETIC_BUDGET);
  for (const invalid of [{ ...q.display, offering_pk: "synthetic-private-pk-marker" },
    { ...q.display, review_status: "published" }, { ...q.display, hold_reasons: [] },
    { ...q.display, official_metadata: { ...(q.display.official_metadata as Obj), source_url: "https://synthetic.invalid/source" } },
    { ...q.display, value_availability: "held", metric_value_literal: "0", metric_value_numeric_text: "0" }]) {
    rejectsSync(() => assertModelDisplay(invalid, SYNTHETIC_BUDGET));
  }
});

Deno.test("RM coverage: seven source areas plus out-of-command, fence and registration are compulsory", () => {
  const coverage = syntheticCoverage(); validateCoverage(coverage, SYNTHETIC_BUDGET);
  for (const domain of ["source_change", "correction", "curation", "school_scope", "member", "population", "flag", "out_of_command"]) {
    const missing = clone(coverage); delete missing[domain]; rejectsSync(() => validateCoverage(missing, SYNTHETIC_BUDGET));
    for (const classification of ["UNKNOWN", "PARTIAL", "NOT_READY", true]) {
      const invalid = clone(coverage); (invalid[domain] as Obj).classification = classification;
      rejectsSync(() => validateCoverage(invalid, SYNTHETIC_BUDGET));
    }
  }
  for (const mutate of [
    (x: Obj) => { delete x.writer_fence; }, (x: Obj) => { delete x.state_registration; },
    (x: Obj) => { (x.writer_fence as Obj).lease_id = ""; },
    (x: Obj) => { (x.writer_fence as Obj).end_at = "2026-10-10T03:00:00.000000Z"; },
    (x: Obj) => { (x.state_registration as Obj).mechanism_id = ""; },
    (x: Obj) => { (x.state_registration as Obj).latest_snapshot_binding_receipt = true; },
  ]) { const invalid = clone(coverage); mutate(invalid); rejectsSync(() => validateCoverage(invalid, SYNTHETIC_BUDGET)); }
});

Deno.test("RM ancestry: baseline plus at most four deltas, exact depth/parent/hash and no cycles", () => {
  validateModelAncestry(syntheticAncestry(0), SYNTHETIC_BUDGET);
  validateModelAncestry(syntheticAncestry(4), SYNTHETIC_BUDGET);
  rejectsSync(() => validateModelAncestry(syntheticAncestry(5), SYNTHETIC_BUDGET));
  for (const mutate of [
    (x: Obj) => { x.head_batch_id = "00000000-0000-4000-8000-000000000099"; },
    (x: Obj) => { (x.entries as Obj[])[0].manifest_sha256 = SYNTHETIC_HASH; },
    (x: Obj) => { (x.entries as Obj[])[1].depth = 0; },
    (x: Obj) => { (x.entries as Obj[])[0].parent_batch_id = SYNTHETIC_BATCH; },
    (x: Obj) => { (x.entries as Obj[])[0].parent_manifest_sha256 = "66".repeat(32); },
    (x: Obj) => { (x.entries as Obj[])[1].manifest_sha256 = null; },
    (x: Obj) => { (x.entries as Obj[])[4].batch_kind = "delta"; },
    (x: Obj) => { (x.entries as Obj[])[4].parent_batch_id = SYNTHETIC_BATCH; },
    (x: Obj) => { (x.entries as Obj[])[1].batch_id = SYNTHETIC_BATCH; },
  ]) { const invalid = syntheticAncestry(4); mutate(invalid); rejectsSync(() => validateModelAncestry(invalid, SYNTHETIC_BUDGET)); }
  equal(MODEL_RECIPES, { content: "current_review_content_wire_v2", row: "current_review_model_row_v2", binding: "current_review_model_binding_v2" });
});

Deno.test("RM trust: independent Ed25519 receipt accepts one exact claim and denies every altered binding", async () => {
  const authority = await createSyntheticAuthority(), claim = syntheticClaim();
  const reference = await authority.sign("known-claim", claim), verifier = authority.verifier();
  await verifier.verifyBatch([{ reference, claim }], SYNTHETIC_NOW);
  for (const field of ["purpose", "tenant_key", "command_id", "payload_sha256", "definition_sha256", "source_projection_sha256",
    "model_projection_sha256", "selection_scope_sha256", "tenant_mapping_sha256", "claim_domain", "claim_digest", "completeness_state_id",
    "completeness_state_sha256", "source_dependency_closure_sha256", "content_recipe_sha256", "model_row_recipe_sha256", "binding_recipe_sha256", "codec_spec_sha256"]) {
    const bad = clone(claim); bad[field] = field.endsWith("sha256") || field === "claim_digest" ? "ee".repeat(32) : "synthetic-wrong";
    await rejects(() => verifier.verifyBatch([{ reference, claim: bad }], SYNTHETIC_NOW));
  }
  rejectsSync(() => createPinnedEvidenceVerifier(new Map(), async () => [], SYNTHETIC_BUDGET, authority.policy));
  await rejects(() => verifier.verifyBatch([{ reference: { ...reference, bytes: Number(reference.bytes) + 1 }, claim }], SYNTHETIC_NOW));
  await rejects(() => createPinnedEvidenceVerifier(authority.issuerKeys, async () => [], SYNTHETIC_BUDGET, authority.policy).verifyBatch([{ reference, claim }], SYNTHETIC_NOW));
});

Deno.test("RM trust: forged, expired, revoked, unpinned issuer and producer bool/hash-only receipts fail", async () => {
  const authority = await createSyntheticAuthority(), claim = syntheticClaim();
  for (const [name, overrides] of [["revoked", { revoked: true }], ["expired", { expires_at: "2026-10-10T03:10:00.000000Z" }],
    ["future", { not_before: "2026-10-10T03:30:00.000000Z" }], ["producer", { issuer_actor: SYNTHETIC_PRODUCER }]] as [string, Obj][]) {
    const reference = await authority.sign(name, claim, overrides);
    await rejects(() => authority.verifier().verifyBatch([{ reference, claim }], SYNTHETIC_NOW));
  }
  const reference = await authority.sign("signature-tamper", claim);
  const raw = authority.bytes.get(reference.sha256 as string)!;
  const forged = JSON.parse(new TextDecoder().decode(raw)); forged.signature_hex = "00".repeat(64);
  const forgedBytes = new TextEncoder().encode(JSON.stringify(forged));
  const forgedRef = { ...reference, bytes: forgedBytes.length, sha256: await sha256Bytes(forgedBytes) };
  authority.bytes.set(forgedRef.sha256 as string, forgedBytes);
  await rejects(() => authority.verifier().verifyBatch([{ reference: forgedRef, claim }], SYNTHETIC_NOW));
  for (const value of [{ verified: true, payload_sha256: SYNTHETIC_HASH }, { sha256: SYNTHETIC_HASH }, true]) {
    const unsigned = new TextEncoder().encode(JSON.stringify(value));
    const unsignedRef = { ...reference, bytes: unsigned.length, sha256: await sha256Bytes(unsigned) };
    authority.bytes.set(unsignedRef.sha256 as string, unsigned);
    await rejects(() => authority.verifier().verifyBatch([{ reference: unsignedRef, claim }], SYNTHETIC_NOW));
  }
});

Deno.test("RM HTTP: explicit opt-in signed review serves public18, query9 and cursor100+40 with snapshot counts", async () => {
  const fixture = await createSyntheticRuntimeFixture(140), ports = syntheticPorts(fixture);
  const queries: CurrentReviewQuery[] = [], subjects: string[] = [];
  ports.readPage = async (_d, q, after, subject) => { queries.push(clone(q)); subjects.push(subject); return fixture.rawPage(q, after); };
  const handler = syntheticHandler(ports), first = await handler(syntheticRequest("?limit=100"));
  equal(first.status, 200); assert(first.headers.get("Cache-Control")?.includes("no-store"));
  const page = await first.json(); equal(page.items.length, 100); equal(page.matching_observation_count, 140);
  equal(page.matching_source_school_count, 2); assert(typeof page.next_cursor === "string");
  equal(CURRENT_REVIEW_FIELDS, "observation_token,academic_year,university,department,track,recruit_group,metric_kind,metric_value_literal,metric_value_json_type,metric_value_numeric_text,cohort,statistic_label,source_member_count,link_scopes,official_metadata,review_status,value_availability,hold_reasons".split(","));
  equal(REVIEW_QUERY_FIELDS, "academic_year,university_q,department_q,track,group,metric_kind,cohort,limit,cursor".split(","));
  for (const item of page.items) { equal(Object.keys(item).sort(), [...CURRENT_REVIEW_FIELDS].sort()); equal(item.metric_value_literal, "0"); equal(item.source_member_count, 1); }
  const second = await handler(syntheticRequest(`?limit=100&cursor=${encodeURIComponent(page.next_cursor)}`));
  equal(second.status, 200); const tail = await second.json(); equal(tail.items.length, 40); equal(tail.next_cursor, null);
  equal(tail.matching_observation_count, 140); equal(tail.matching_source_school_count, 2);
  equal(new Set([...page.items, ...tail.items].map((item) => item.observation_token)).size, 140);
  equal(queries.length, 2); equal(Object.keys(queries[0]).sort(), [...REVIEW_QUERY_FIELDS].sort()); equal(subjects, [SYNTHETIC_REVIEWER, SYNTHETIC_REVIEWER]);
  const body = JSON.stringify([page, tail]);
  for (const marker of ["synthetic-private", "synthetic://", "synthetic-canonical-", "source_row_fingerprint", "model_row_hex", "batch_manifest_sha256", "qualification_receipt", "offering_pk"]) {
    assert(!body.includes(marker), `private marker leaked: ${marker}`);
  }
  equal(page.publication_status, "not_published"); equal(page.status, "review");
});

Deno.test("RM HTTP: relay precedes session; authentication and reviewer allowlist precede data; paid cannot override", async () => {
  const fixture = await createSyntheticRuntimeFixture(), ports = syntheticPorts(fixture);
  let sessions = 0, descriptors = 0, reads = 0;
  ports.verifySession = async (token) => { sessions++; return { subjectId: token === "synthetic-paid-other" ? SYNTHETIC_PRODUCER : SYNTHETIC_REVIEWER,
    expiresAt: SYNTHETIC_NOW + 600_000, synthetic_tier: "paid" }; };
  ports.loadDescriptor = async () => { descriptors++; return clone(fixture.descriptor); };
  ports.readPage = async (_d, q, after) => { reads++; return fixture.rawPage(q, after); };
  const handler = syntheticHandler(ports);
  for (const relay of [null, "synthetic-wrong", SYNTHETIC_RELAY + "," + SYNTHETIC_RELAY, "synthetic internal relay whitespace"]) {
    const result = await handler(syntheticRequest("", { relay })); equal(result.status, 403); assert(result.headers.get("Cache-Control")?.includes("no-store"));
  }
  equal([sessions, descriptors, reads], [0, 0, 0]);
  equal((await handler(syntheticRequest("", { bearer: null }))).status, 401); equal([sessions, descriptors, reads], [0, 0, 0]);
  equal((await handler(syntheticRequest("", { bearer: "synthetic-paid-other" }))).status, 403); equal(reads, 0);
  ports.verifySession = async () => null;
  equal((await handler(syntheticRequest())).status, 401); equal(reads, 0);
  ports.verifySession = async () => ({ subjectId: SYNTHETIC_REVIEWER, expiresAt: SYNTHETIC_NOW });
  equal((await handler(syntheticRequest())).status, 401); equal(reads, 0);
});

Deno.test("RM HTTP: unknown/duplicate/invalid query and unsupported path/method deny before page reads", async () => {
  const fixture = await createSyntheticRuntimeFixture(), ports = syntheticPorts(fixture); let reads = 0;
  ports.readPage = async (_d, q, after) => { reads++; return fixture.rawPage(q, after); };
  const handler = syntheticHandler(ports);
  for (const [query, status] of [["?school_id=synthetic-school", 400], ["?limit=100&limit=40", 422], ["?limit=101", 400],
    ["?limit=0", 400], ["?academic_year=2023", 400], ["?university_q=%00", 400]] as [string, number][]) {
    const response = await handler(syntheticRequest(query)); equal(response.status, status); assert(response.headers.get("Cache-Control")?.includes("no-store"));
  }
  equal((await handler(syntheticRequest("", { method: "POST" }))).status, 404);
  equal((await handler(new Request("https://synthetic.invalid/other"))).status, 404); equal(reads, 0);
});

Deno.test("RM HTTP: descriptor purpose, approval, false flags and independent activation pin are mandatory", async () => {
  const fixture = await createSyntheticRuntimeFixture();
  for (const mutate of [
    (d: Obj) => { d.purpose = "synthetic-other-purpose"; }, (d: Obj) => { d.engine_approved = true; },
    (d: Obj) => { d.production_allowed = true; }, (d: Obj) => { d.general_publication_allowed = true; },
    (d: Obj) => { d.nationwide_collection_complete = true; }, (d: Obj) => { d.model_metadata_sha256 = "ee".repeat(32); },
    (d: Obj) => { (d.approval as Obj).revoked = true; }, (d: Obj) => { (d.approval as Obj).expires_at = SYNTHETIC_AT; },
    (d: Obj) => { d.activation_receipt = true; },
  ]) {
    const ports = syntheticPorts(fixture); const d = clone(fixture.descriptor); mutate(d as unknown as Obj); let reads = 0;
    ports.loadDescriptor = async () => d; ports.readPage = async (_descriptor, q, after) => { reads++; return fixture.rawPage(q, after); };
    const result = await syntheticHandler(ports)(syntheticRequest()); equal(result.status, 503); equal(reads, 0);
    assert(result.headers.get("Cache-Control")?.includes("no-store"));
  }
  await validateReadModelDescriptor(fixture.descriptor, "local_verification", SYNTHETIC_NOW, SYNTHETIC_BUDGET);
});

Deno.test("RM HTTP: Merkle row/proof tamper, count bounds and bulk row cap are safe 503", async () => {
  const fixture = await createSyntheticRuntimeFixture(140);
  for (const mutate of [
    (raw: ReadModelRawPage) => { raw.rows[0].model_row_hex = raw.rows[0].model_row_hex.slice(0, -2) + "ff"; },
    (raw: ReadModelRawPage) => { raw.rows[0].proof_hex = "00".repeat(raw.rows[0].proof_hex.length / 2); },
    (raw: ReadModelRawPage) => { raw.rows[0].leaf_index = "140"; },
    (raw: ReadModelRawPage) => { raw.matchingObservationCount = "141"; },
    (raw: ReadModelRawPage) => { raw.matchingSourceSchoolCount = "141"; },
    (raw: ReadModelRawPage) => { raw.rows = clone(fixture.selected); },
  ]) {
    const ports = syntheticPorts(fixture); ports.readPage = async (_d, q, after) => { const raw = fixture.rawPage(q, after); mutate(raw); return raw; };
    const response = await syntheticHandler(ports)(syntheticRequest("?limit=100")); equal(response.status, 503);
    const body = await response.text(); assert(!body.includes("model_row_hex") && !body.includes("synthetic-private"));
  }
});

Deno.test("RM HTTP: unknown first source state is 503; stale same-snapshot cursor is 409", async () => {
  const fixture = await createSyntheticRuntimeFixture(140), ports = syntheticPorts(fixture);
  ports.readPage = async () => { throw new ReadModelError("current_review_model_state_unapproved"); };
  equal((await syntheticHandler(ports)(syntheticRequest("?limit=100"))).status, 503);
  const validPorts = syntheticPorts(fixture), handler = syntheticHandler(validPorts);
  const first = await handler(syntheticRequest("?limit=100")); equal(first.status, 200); const page = await first.json();
  validPorts.readPage = async () => { throw new ReadModelError("current_review_model_state_unapproved"); };
  const refreshed = await handler(syntheticRequest(`?limit=100&cursor=${encodeURIComponent(page.next_cursor)}`)); equal(refreshed.status, 409);
  validPorts.readPage = async (_d, q, after) => { const raw = fixture.rawPage(q, after);
    raw.currentSourceState = { ...raw.currentSourceState, payload_sha256: "ee".repeat(32) }; return raw; };
  const stale = await handler(syntheticRequest(`?limit=100&cursor=${encodeURIComponent(page.next_cursor)}`)); equal(stale.status, 409);
});

Deno.test("RM HTTP: refreshed approved descriptor invalidates the old cursor before another data read", async () => {
  const fixture = await createSyntheticRuntimeFixture(140), ports = syntheticPorts(fixture); let reads = 0;
  ports.readPage = async (_d, q, after) => { reads++; return fixture.rawPage(q, after); };
  const handler = syntheticHandler(ports), first = await handler(syntheticRequest("?limit=100"));
  equal(first.status, 200); const page = await first.json();
  const refreshed = clone(fixture.descriptor); refreshed.projection_version = "synthetic-approved-refresh-v2";
  refreshed.activation_receipt = await fixture.authority.sign("refreshed-activation", await modelActivationClaim(refreshed, SYNTHETIC_BUDGET), { issuer_actor: SYNTHETIC_APPROVER });
  ports.loadDescriptor = async () => refreshed;
  const response = await handler(syntheticRequest(`?limit=100&cursor=${encodeURIComponent(page.next_cursor)}`)); equal(response.status, 409); equal(reads, 1);
});

Deno.test("RM HTTP: dependency exceptions are redacted and session expiry after read prevents success", async () => {
  const fixture = await createSyntheticRuntimeFixture(), ports = syntheticPorts(fixture);
  ports.readPage = async () => { throw new Error("synthetic-private-pk-marker synthetic://private/forbidden-marker"); };
  const result = await syntheticHandler(ports)(syntheticRequest()); equal(result.status, 503);
  const body = await result.text(); assert(!body.includes("synthetic-private") && !body.includes("synthetic://"));
  const expiring = syntheticPorts(fixture); let now = SYNTHETIC_NOW;
  expiring.verifySession = async () => ({ subjectId: SYNTHETIC_REVIEWER, expiresAt: SYNTHETIC_NOW + 1000 });
  expiring.readPage = async (_d, q, after) => { now += 1000; return fixture.rawPage(q, after); };
  equal((await syntheticHandler(expiring, () => now)(syntheticRequest())).status, 401);
});

Deno.test("RM trust: independently pinned current revocation snapshot overrides an older signed revoked:false", async () => {
  const authority = await createSyntheticAuthority(), claim = syntheticClaim();
  const reference = await authority.sign("later-revoked", claim), verifier = authority.verifier();
  await verifier.verifyBatch([{ reference, claim }], SYNTHETIC_NOW);
  await authority.revoke([reference.sha256 as string]);
  await rejects(() => verifier.verifyBatch([{ reference, claim }], SYNTHETIC_NOW));
  await authority.revoke([], [SYNTHETIC_VERIFIER]);
  await rejects(() => verifier.verifyBatch([{ reference, claim }], SYNTHETIC_NOW));
  await authority.revoke([], [], { expires_at: SYNTHETIC_AT });
  await rejects(() => verifier.verifyBatch([{ reference, claim }], SYNTHETIC_NOW));
  await authority.revoke([], [], { purpose: "synthetic-other-purpose" });
  await rejects(() => verifier.verifyBatch([{ reference, claim }], SYNTHETIC_NOW));
  await authority.revoke(); authority.policy.revocationSnapshotSha256 = "ee".repeat(32);
  await rejects(() => verifier.verifyBatch([{ reference, claim }], SYNTHETIC_NOW));
});

Deno.test("RM trust: explicit qualifier/verifier/approver roles, exact issuer and required evidence kind are separate", async () => {
  const authority = await createSyntheticAuthority(), claim = syntheticClaim();
  const reference = await authority.sign("qualifier-only", claim);
  await authority.verifier().verifyBatch([{ reference, claim, requiredRole: "qualifier", requiredIssuer: SYNTHETIC_VERIFIER }], SYNTHETIC_NOW);
  for (const extra of [{ requiredRole: "approver" as const }, { requiredIssuer: SYNTHETIC_APPROVER },
    { forbiddenIssuer: SYNTHETIC_VERIFIER }, { requiredKind: "current_review_original_source29_validation" }]) {
    await rejects(() => authority.verifier().verifyBatch([{ reference, claim, ...extra }], SYNTHETIC_NOW));
  }
  const approved = await authority.sign("approver-only", claim, { issuer_actor: SYNTHETIC_APPROVER });
  await authority.verifier().verifyBatch([{ reference: approved, claim, requiredRole: "approver", forbiddenIssuer: SYNTHETIC_PRODUCER }], SYNTHETIC_NOW);
});

Deno.test("RM baseline: closed independent signed census qualifies original29/native32 and counts null/empty school tuples separately", async () => {
  const f = await createSyntheticBaselineFixture(), result = await prepareBaselineDryRun(f.manifest, f.inputs, f.options);
  equal(result.status, "VALIDATED_DRY_RUN_ONLY"); equal(result.deploymentAllowed, false); equal(result.sealCreated, false);
  equal(result.changes.length, 2); equal(result.root.upsert_count, 2); equal(result.root.retract_count, 0);
  equal(String(result.root.expected_effective_observation_count), "2"); equal(String(result.root.expected_effective_school_tuple_count), "2");
  equal(result.changes.map((row) => (row.filters as Obj).school_id), [null, ""]);
  equal(result.changes.map((row) => row.operation), ["upsert", "upsert"]);
  const expectations = await modelEvidenceExpectations(f.manifest, BASELINE_CENSUS, SYNTHETIC_BUDGET);
  const paths = expectations.map((e) => e.claim.claim_domain as string);
  assert(paths.some((path) => path.includes("coverage.out_of_command")));
  assert(paths.some((path) => path.includes("writer_fence")) && paths.some((path) => path.includes("state_registration")));
  assert(paths.some((path) => path.includes("school_frequencies")) && paths.some((path) => path.includes("checkpoints")));
  for (const e of expectations) assert(typeof e.requiredKind === "string" && e.requiredKind.startsWith("current_review_"));
  const q = await qualifyModelObservation(f.inputs[0], "66".repeat(32), "77".repeat(32), SYNTHETIC_BUDGET);
  const component = await observationEvidenceExpectations(f.manifest, q, SYNTHETIC_BUDGET);
  equal(component.map((e) => e.requiredKind), ["current_review_current35_member32_pop7_qualification", "current_review_original_source29_validation", "current_review_native_canonical32_validation"]);
});

Deno.test("RM baseline: census/frequency/checkpoint/component omissions and producer self-verification deny", async () => {
  const f = await createSyntheticBaselineFixture();
  for (const mutate of [
    (m: Obj) => { (m.census as Obj[]).pop(); },
    (m: Obj) => { (m.census as Obj[])[1].canonical_result_id = "synthetic-canonical-001"; },
    (m: Obj) => { (m.school_frequencies as Obj[]).pop(); },
    (m: Obj) => { (m.school_frequencies as Obj[])[1].school_id = null; },
    (m: Obj) => { (m.school_frequencies as Obj[])[0].multiplicity = 2; },
    (m: Obj) => { (m.checkpoints as Obj[])[0].canonical_ids = ["synthetic-canonical-001"]; },
    (m: Obj) => { m.checkpoints = []; },
    (m: Obj) => { ((m.census as Obj[])[0].observation as Obj).original_source29_validation_receipt = null; },
    (m: Obj) => { ((m.census as Obj[])[0].observation as Obj).native_canonical32_validation_receipt = null; },
    (m: Obj) => { m.verifier_actor = SYNTHETIC_PRODUCER; },
    (m: Obj) => { m.producer_verified = true; },
  ]) { const invalid = clone(f.manifest); mutate(invalid); await rejects(() => prepareBaselineDryRun(invalid, f.inputs, f.options)); }
  await rejects(() => prepareBaselineDryRun(f.manifest, f.inputs.slice(0, 1), f.options));
  await rejects(() => prepareBaselineDryRun(f.manifest, f.inputs, { ...f.options, maximumObservations: 1 }));
  const changed = clone(f.inputs); changed[0].native32_expected_digest = "ee".repeat(32);
  await rejects(() => prepareBaselineDryRun(f.manifest, changed, f.options));
});

Deno.test("RM baseline: valid signature for other source area/fence/registration/frequency facts cannot be reused", async () => {
  const f = await createSyntheticBaselineFixture();
  for (const mutate of [
    (m: Obj) => { ((m.coverage as Obj).out_of_command as Obj).effect_rules_sha256 = "ee".repeat(32); },
    (m: Obj) => { ((m.coverage as Obj).writer_fence as Obj).lease_id = "synthetic-different-lease"; },
    (m: Obj) => { ((m.coverage as Obj).state_registration as Obj).mechanism_id = "synthetic-other-registration"; },
    (m: Obj) => { ((m.coverage as Obj).source_change as Obj).event_inventory_receipt = ((m.coverage as Obj).member as Obj).event_inventory_receipt; },
    (m: Obj) => { (m.checkpoints as Obj[])[0].bytes_read = 21; },
    (m: Obj) => { (m.target_state as Obj).codec_spec_sha256 = "ee".repeat(32); },
    (m: Obj) => { m.approval_receipt = m.verification_receipt; },
  ]) { const invalid = clone(f.manifest); mutate(invalid); await rejects(() => prepareBaselineDryRun(invalid, f.inputs, f.options)); }
  await f.authority.revoke([(f.manifest.verification_receipt as Obj).sha256 as string]);
  await rejects(() => prepareBaselineDryRun(f.manifest, f.inputs, f.options));
});

Deno.test("RM delta: independently signed correction+retract retain before digests, exact counts and admitted baseline ancestry", async () => {
  const f = await createSyntheticDeltaFixture(), result = await prepareDeltaDryRun(f.manifest, f.inputs, f.ancestry, f.options);
  equal(result.status, "VALIDATED_DRY_RUN_ONLY"); equal(result.deploymentAllowed, false); equal(result.sealCreated, false);
  equal(result.changes.map((row) => row.operation), ["retract", "upsert"]);
  equal(result.changes[0].display, null); equal(result.changes[0].filters, null);
  equal((result.changes[1].display as Obj).department, "합성정정학과");
  assert(typeof result.changes[0].before_content_digest === "string" && typeof result.changes[1].before_content_digest === "string");
  equal(result.root.upsert_count, 1); equal(result.root.retract_count, 1);
  equal(String(result.root.expected_effective_observation_count), "1"); equal(String(result.root.expected_effective_school_tuple_count), "1");
  equal((result.ancestry.entries as Obj[]).length, 2);
});

Deno.test("RM delta: valid independent signatures cannot substitute mismatched observation facts for qualified row bytes", async () => {
  const f = await createSyntheticDeltaFixture();
  const resignAndVerify = async (manifest: Obj): Promise<{ manifest: Obj; inputs: QualifiedObservationInput[] }> => {
    const q = await qualifyModelObservation(f.inputs[0], (manifest.target_state as Obj).source_projection_sha256 as string,
      (manifest.scope as Obj).model_projection_sha256 as string, SYNTHETIC_BUDGET);
    const expectations = [...await modelEvidenceExpectations(manifest, IMPACT, SYNTHETIC_BUDGET),
      ...await observationEvidenceExpectations(manifest, q, SYNTHETIC_BUDGET)];
    const signed = await signExpectations(f.authority, expectations);
    const next = { manifest: replaceReferences(manifest, signed), inputs: replaceReferences(f.inputs, signed) };
    const qualified = await qualifyModelObservation(next.inputs[0], (manifest.target_state as Obj).source_projection_sha256 as string,
      (manifest.scope as Obj).model_projection_sha256 as string, SYNTHETIC_BUDGET);
    await f.options.evidence.verifyBatch([...await modelEvidenceExpectations(next.manifest, IMPACT, SYNTHETIC_BUDGET),
      ...await observationEvidenceExpectations(next.manifest, qualified, SYNTHETIC_BUDGET)], SYNTHETIC_NOW);
    return next;
  };
  const equivalent = clone(f.manifest), equivalentAfter = (equivalent.impacts as Obj[])[1].after as Obj;
  equivalentAfter.academic_year = "2027";
  (equivalentAfter.member_multiset as Obj).element_count = "1";
  (equivalentAfter.population_multiset as Obj).element_count = "1";
  const equivalentSigned = await resignAndVerify(equivalent);
  equal((await prepareDeltaDryRun(equivalentSigned.manifest, equivalentSigned.inputs, f.ancestry, f.options)).status, "VALIDATED_DRY_RUN_ONLY");
  const changes: [string, (after: Obj) => void][] = [
    ["academic_year", (o) => { o.academic_year = 2026; }],
    ["school_id", (o) => { o.school_id = "synthetic-other-school"; }],
    ["university_code", (o) => { o.university_code = "synthetic-other-code"; }],
    ["active_service", (o) => { o.active_service = false; }],
    ["in_approved_scope", (o) => { o.in_approved_scope = false; }],
    ...["release_id", "result_id", "source_row_fingerprint", "effective_row_fingerprint"].map((field): [string, (after: Obj) => void] =>
      [`representative.${field}`, (o) => { (o.representative as Obj)[field] = "synthetic-other-representative"; }]),
    ["member_count", (o) => { (o.member_multiset as Obj).element_count = 2; }],
    ["member_recipe", (o) => { (o.member_multiset as Obj).recipe = "synthetic-other-member-recipe"; }],
    ["member_digest", (o) => { (o.member_multiset as Obj).exact_digest = "ee".repeat(32); }],
    ["population_count", (o) => { (o.population_multiset as Obj).element_count = 2; }],
    ["population_recipe", (o) => { (o.population_multiset as Obj).recipe = "synthetic-other-population-recipe"; }],
    ["population_digest", (o) => { (o.population_multiset as Obj).exact_digest = "ee".repeat(32); }],
    ["content_digest", (o) => { o.content_digest = "ee".repeat(32); }],
    ["filter_digest", (o) => { o.corrected_filter_digest = "ee".repeat(32); }],
    ["display_digest", (o) => { o.display17_digest = "ee".repeat(32); }],
  ];
  for (const [field, change] of changes) {
    const manifest = clone(f.manifest), after = (manifest.impacts as Obj[])[1].after as Obj;
    change(after);
    if (field === "school_id" || field === "university_code") {
      // Keep school-count arithmetic consistent with the signed altered observation.
      // Admission must still reject: the generated row would use q's original tuple.
      const counts = manifest.counts as Obj, tuples = counts.touched_school_tuples as Obj[];
      tuples[1].added_multiplicity = 0; tuples[1].target_multiplicity = 0;
      tuples.push({ school_id: after.school_id, university_code: after.university_code, parent_multiplicity: 0,
        removed_multiplicity: 0, added_multiplicity: 1, target_multiplicity: 1,
        frequency_evidence: syntheticRef(`delta-altered-${field}-frequency`) });
      const shape: RecordShape = [["school_id", { nullable: "T" }], ["university_code", { nullable: "T" }]];
      tuples.sort((a, b) => compareBytes(encodeRecord(shape, { school_id: a.school_id, university_code: a.university_code }, SYNTHETIC_BUDGET),
        encodeRecord(shape, { school_id: b.school_id, university_code: b.university_code }, SYNTHETIC_BUDGET)));
    }
    const signed = await resignAndVerify(manifest);
    await rejects(() => prepareDeltaDryRun(signed.manifest, signed.inputs, f.ancestry, f.options),
      ["active_service", "in_approved_scope"].includes(field) ? undefined : "current_review_observation_meaning_mismatch");
  }
});

Deno.test("RM delta: checkpoint set coverage, unknown edges, outside exceptions and count arithmetic deny incomplete claims", async () => {
  const f = await createSyntheticDeltaFixture();
  await rejects(() => prepareDeltaDryRun(f.manifest, f.inputs, f.ancestry, { ...f.options, checkpointCoverage: undefined }));
  await rejects(() => prepareDeltaDryRun(f.manifest, f.inputs, f.ancestry, { ...f.options,
    checkpointCoverage: [{ chunk_id: "synthetic-delta-chunk-001", canonical_ids: ["synthetic-canonical-001"] }] }));
  for (const mutate of [
    (m: Obj) => { (m.dependency_closure as Obj).unknown_edges = ["synthetic-unresolved-edge"]; },
    (m: Obj) => { (m.outside_unchanged as Obj).exceptions = ["synthetic-unknown-outside-change"]; },
    (m: Obj) => { (m.counts as Obj).target_observation_count = 2; },
    (m: Obj) => { (m.counts as Obj).target_school_tuple_count = 2; },
    (m: Obj) => { (m.counts as Obj).replaced_count = 0; },
    (m: Obj) => { (m.impacts as Obj[])[0].operation = "upsert"; },
    (m: Obj) => { (m.impacts as Obj[])[1].origin_event_ids = ["synthetic-not-an-event"]; },
    (m: Obj) => { m.checkpoints = []; },
    (m: Obj) => { (m.checkpoints as Obj[])[0].approved_ids_sha256 = "ee".repeat(32); },
  ]) { const invalid = clone(f.manifest); mutate(invalid); await rejects(() => prepareDeltaDryRun(invalid, f.inputs, f.ancestry, f.options)); }
});

Deno.test("RM HTTP: private live grant period must equal approval and expire before an HTTP success", async () => {
  const fixture = await createSyntheticRuntimeFixture();
  for (const mutate of [
    (raw: ReadModelRawPage) => { raw.grantNotBefore = "2026-10-10T03:01:00.000000Z"; },
    (raw: ReadModelRawPage) => { raw.grantExpiresAt = "2026-10-10T03:20:00.000000Z"; },
    (raw: ReadModelRawPage) => { raw.grantExpiresAt = SYNTHETIC_AT; },
  ]) {
    const ports = syntheticPorts(fixture); ports.readPage = async (_d, q, after) => { const raw = fixture.rawPage(q, after); mutate(raw); return raw; };
    const response = await syntheticHandler(ports)(syntheticRequest()); equal(response.status, 403);
    const body = await response.text(); assert(!body.includes("grantNotBefore") && !body.includes("grantExpiresAt"));
  }
});
