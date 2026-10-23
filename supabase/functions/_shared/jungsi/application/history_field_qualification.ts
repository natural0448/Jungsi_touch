/** Exact field grants from an independently approved P1 review receipt. No writer or activation. */
import { AccessError } from "./access.ts";
import { cloneNativeJson, nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";

const HASH = /^[a-f0-9]{64}$/;
const CID = /^(?:observation|admission):[a-f0-9]{64}$/;
const PK = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SLOT = "final_additional_admission_rank";
const verifiedPublications = new WeakMap<object, string>();
function fail(): never {
  throw new AccessError("snapshot_invalid", 503);
}
function dataKeys(raw: object): string[] {
  const keys = Reflect.ownKeys(raw);
  if (keys.some((k) => typeof k !== "string")) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (
      !descriptor || !descriptor.enumerable || !("value" in descriptor) ||
      descriptor.get || descriptor.set
    ) fail();
  }
  return keys as string[];
}
/** Detach/freeze plain native data before any await. Accessors are never evaluated. */
export function detachedQualificationSnapshot(
  raw: unknown,
  depth = 0,
  count = { n: 0 },
): unknown {
  if (depth > 16 || ++count.n > 65536) fail();
  if (raw === null || typeof raw === "boolean" || typeof raw === "bigint") {
    return raw;
  }
  if (typeof raw === "string") {
    if (raw.length > 32768) fail();
    return raw;
  }
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) fail();
    return raw;
  }
  if (!raw || typeof raw !== "object") fail();
  if (raw instanceof JsonFloat) {
    const keys = dataKeys(raw),
      descriptor = Object.getOwnPropertyDescriptor(raw, "lexeme");
    if (
      Object.getPrototypeOf(raw) !== JsonFloat.prototype || keys.length !== 1 ||
      keys[0] !== "lexeme" ||
      !descriptor || typeof descriptor.value !== "string" ||
      descriptor.value.length > 1024 ||
      !/^-?(?:0|[1-9][0-9]*)(?:[.][0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(
        descriptor.value,
      )
    ) fail();
    return new JsonFloat(descriptor.value);
  }
  if (Array.isArray(raw)) {
    const keys = Reflect.ownKeys(raw),
      length = Object.getOwnPropertyDescriptor(raw, "length");
    if (
      Object.getPrototypeOf(raw) !== Array.prototype || !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) || length.value < 0 ||
      length.value > 4096 ||
      keys.length !== length.value + 1 || keys.some((k) => typeof k !== "string")
    ) fail();
    const copy = [];
    for (let i = 0; i < length.value; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, String(i));
      if (
        !descriptor || !descriptor.enumerable || !("value" in descriptor) ||
        descriptor.get || descriptor.set
      ) fail();
      copy.push(
        detachedQualificationSnapshot(descriptor.value, depth + 1, count),
      );
    }
    return Object.freeze(copy);
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail();
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of dataKeys(raw)) {
    copy[key] = detachedQualificationSnapshot(
      Object.getOwnPropertyDescriptor(raw, key)!.value,
      depth + 1,
      count,
    );
  }
  return Object.freeze(copy);
}
function exact(raw: unknown, keys: readonly string[]): NativeObject {
  if (
    !raw || typeof raw !== "object" || Array.isArray(raw) ||
    raw instanceof JsonFloat ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  ) fail();
  const own = dataKeys(raw);
  if (own.length !== keys.length || keys.some((k) => !Object.hasOwn(raw, k))) {
    fail();
  }
  return raw as NativeObject;
}
function hash(raw: unknown): string {
  if (typeof raw !== "string" || !HASH.test(raw)) fail();
  return raw;
}
function subject(raw: unknown): NativeObject {
  const r = exact(raw, [
    "observation_id",
    "academic_year",
    "offering_pk",
    "identity_variant_index",
  ]);
  if (
    typeof r.observation_id !== "string" || !CID.test(r.observation_id) ||
    typeof r.offering_pk !== "string" || !PK.test(r.offering_pk) ||
    !Number.isSafeInteger(r.academic_year) ||
    ![2024, 2025, 2026, 2027].includes(Number(r.academic_year)) ||
    !Number.isSafeInteger(r.identity_variant_index) ||
    Number(r.identity_variant_index) < 0 ||
    Number(r.identity_variant_index) > 15
  ) fail();
  return r;
}

/** Only the existing trusted current-manifest loader may supply this context.
 * Its approved independent review must bind the manifest plus authority/receipt scopes.
 * Public requests and q objects must never construct/register this context.
 */
export interface VerifiedQualificationPublication {
  readonly publicationSha256: string;
  readonly sourceHeadSha256: string;
  readonly scopeSha256: string;
  readonly approvals: readonly NativeObject[];
}

/** A body without q may still belong to a qualified publication. Validate the same
 * factory seal and parent pins before deciding whether a rank must carry q.
 */
export async function assertFieldQualificationPublication(
  publicationInput: VerifiedQualificationPublication | null,
  publicationSha256: string,
  sourceHeadSha256: string,
  scopeSha256: string,
): Promise<readonly NativeObject[]> {
  if (!publicationInput || !verifiedPublications.has(publicationInput)) fail();
  const seal = verifiedPublications.get(publicationInput);
  const snapshot = detachedQualificationSnapshot(
    publicationInput,
  ) as VerifiedQualificationPublication;
  if (
    snapshot.publicationSha256 !== hash(publicationSha256) ||
    snapshot.sourceHeadSha256 !== hash(sourceHeadSha256) ||
    snapshot.scopeSha256 !== hash(scopeSha256) ||
    await nativeJsonSha256(snapshot) !== seal
  ) fail();
  return snapshot.approvals;
}

/** Read-only receipt contract. The existing current-manifest source loader must supply these pins
 * from its approved independent review, never from a request, q or the sidecar itself.
 * The receipt is created before the new parts; it contains no future new-manifest hash.
 */
export async function bindFieldQualificationPublication(
  descriptorApprovalsInput: unknown,
  receiptBytes: Uint8Array,
  trustedPinsInput: {
    readonly publicationSha256: string;
    readonly sourceHeadSha256: string;
    readonly scopeSha256: string;
    readonly authoritySha256: string;
    readonly qualificationReceiptSha256: string;
    readonly previousManifestSha256: string;
    readonly expectedSubjectCount: number;
  },
): Promise<VerifiedQualificationPublication> {
  if (
    !(receiptBytes instanceof Uint8Array) || receiptBytes.length < 1 ||
    receiptBytes.length > 24576
  ) fail();
  const receiptSnapshot = Uint8Array.from(receiptBytes);
  const descriptorApprovals = detachedQualificationSnapshot(
    descriptorApprovalsInput,
  );
  const trustedPins = exact(detachedQualificationSnapshot(trustedPinsInput), [
    "publicationSha256",
    "sourceHeadSha256",
    "scopeSha256",
    "authoritySha256",
    "qualificationReceiptSha256",
    "previousManifestSha256",
    "expectedSubjectCount",
  ]) as unknown as typeof trustedPinsInput;
  for (const [key, value] of Object.entries(trustedPins)) {
    if (key !== "expectedSubjectCount") hash(value);
  }
  if (
    ![1, 2].includes(trustedPins.expectedSubjectCount) ||
    !Number.isSafeInteger(trustedPins.expectedSubjectCount) ||
    !(receiptBytes instanceof Uint8Array) || receiptBytes.length < 1 ||
    receiptBytes.length > 24576
  ) fail();
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", receiptSnapshot),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== trustedPins.qualificationReceiptSha256) fail();
  let raw: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      receiptSnapshot,
    );
    let depth = 0, quoted = false, escaped = false;
    for (const c of text) {
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{" || c === "[") {
        if (++depth > 16) fail();
      } else if (c === "}" || c === "]") {
        if (--depth < 0) fail();
      }
    }
    if (quoted || depth !== 0) fail();
    raw = parseNativeJson(text);
  } catch {
    fail();
  }
  const receipt = exact(raw, [
    "format",
    "status",
    "authority_sha256",
    "source_head_sha256",
    "scope_sha256",
    "expected_previous_manifest_sha256",
    "subjects",
  ]);
  if (
    receipt.format !== "jungsi.history-field-qualification-receipt/v1" ||
    receipt.status !== "approved_exact_fields" ||
    receipt.authority_sha256 !== trustedPins.authoritySha256 ||
    receipt.source_head_sha256 !== trustedPins.sourceHeadSha256 ||
    receipt.scope_sha256 !== trustedPins.scopeSha256 ||
    receipt.expected_previous_manifest_sha256 !==
      trustedPins.previousManifestSha256 ||
    !Array.isArray(receipt.subjects) ||
    receipt.subjects.length !== trustedPins.expectedSubjectCount
  ) fail();
  const seen = new Set<string>();
  const approvals = receipt.subjects.map((raw) => {
    const a = exact(raw, [
      "field",
      "subject",
      "expected_raw_cell_sha256",
      "expected_native_value_type",
      "expected_raw_status",
      "expected_raw_unit",
      "expected_identity_review_sha256",
    ]);
    const s = subject(a.subject);
    const identity = String(s.observation_id) + ":" + s.academic_year + ":" +
      s.offering_pk + ":" +
      s.identity_variant_index;
    if (seen.has(identity)) fail();
    seen.add(identity);
    if (
      a.field !== SLOT || a.expected_native_value_type !== "string" ||
      a.expected_raw_status !== "pending_metadata" ||
      a.expected_raw_unit !== null
    ) fail();
    hash(a.expected_raw_cell_sha256);
    hash(a.expected_identity_review_sha256);
    return {
      ...cloneNativeJson(a),
      authority_sha256: trustedPins.authoritySha256,
      qualification_receipt_sha256: digest,
    };
  });
  // An extra descriptor subject, even with a valid authority/hash pair, is not authorized.
  if (
    !Array.isArray(descriptorApprovals) ||
    descriptorApprovals.length !== approvals.length ||
    await nativeJsonSha256(descriptorApprovals) !==
      await nativeJsonSha256(approvals)
  ) fail();
  const context = detachedQualificationSnapshot({
    publicationSha256: trustedPins.publicationSha256,
    sourceHeadSha256: trustedPins.sourceHeadSha256,
    scopeSha256: trustedPins.scopeSha256,
    approvals,
  }) as VerifiedQualificationPublication;
  verifiedPublications.set(context, await nativeJsonSha256(context));
  return context;
}

/** Validate a scoped optional q without mutating any original source field.
 * The normal legacy cell validation remains mandatory outside this helper.
 */
export async function validateFieldServiceQualification(
  slot: string,
  rawCellInput: NativeObject,
  rowInput: NativeObject,
  currentPublicationSha256: string,
  publicationInput: VerifiedQualificationPublication | null,
): Promise<NativeObject | null> {
  const rawCell = detachedQualificationSnapshot(rawCellInput) as NativeObject;
  const row = detachedQualificationSnapshot(rowInput) as NativeObject;
  if (!Object.hasOwn(rawCell, "service_qualification")) return null;
  if (
    slot !== SLOT || !publicationInput ||
    !verifiedPublications.has(publicationInput)
  ) fail();
  const seal = verifiedPublications.get(publicationInput);
  const publication = detachedQualificationSnapshot(
    publicationInput,
  ) as VerifiedQualificationPublication;
  if (await nativeJsonSha256(publication) !== seal) fail();
  if (
    hash(publication.publicationSha256) !== hash(currentPublicationSha256) ||
    !Array.isArray(publication.approvals) || publication.approvals.length < 1 ||
    publication.approvals.length > 2
  ) fail();
  hash(publication.sourceHeadSha256);
  hash(publication.scopeSha256);
  const q = exact(rawCell.service_qualification, [
    "format",
    "authority_sha256",
    "qualification_receipt_sha256",
    "subject",
    "normalized_service_fields",
  ]);
  if (q.format !== "jungsi.history-field-service-qualification/v1") fail();
  hash(q.authority_sha256);
  hash(q.qualification_receipt_sha256);
  const selected = subject(q.subject);
  const normalized = exact(q.normalized_service_fields, ["status", "unit"]);
  if (normalized.status !== "verified_official" || normalized.unit !== "번") {
    fail();
  }
  const context = exact(rawCell.source_context, [
    "observation_id",
    "identity_variant_index",
    "scope_status",
  ]);
  const review = exact(row.identity_review, [
    "status",
    "reason_code",
    "variants",
  ]);
  if (
    row.mapping_status !== "mapped" ||
    row.academic_year !== selected.academic_year ||
    row.original_pk !== selected.offering_pk ||
    context.observation_id !== selected.observation_id ||
    context.identity_variant_index !== selected.identity_variant_index ||
    !["source_consistent", "review_pending"].includes(
      String(context.scope_status),
    ) ||
    !["source_consistent", "metadata_pending", "review_pending"].includes(
      String(review.status),
    ) ||
    !Array.isArray(review.variants) || review.variants.length > 16 ||
    Number(selected.identity_variant_index) >= review.variants.length
  ) fail();
  // These authorizations come from an independently approved descriptor, never q itself.
  const matches: NativeObject[] = [];
  const seen = new Set<string>();
  for (const raw of publication.approvals) {
    const approval = exact(raw, [
      "field",
      "authority_sha256",
      "qualification_receipt_sha256",
      "subject",
      "expected_raw_cell_sha256",
      "expected_native_value_type",
      "expected_raw_status",
      "expected_raw_unit",
      "expected_identity_review_sha256",
    ]);
    const s = subject(approval.subject);
    const identity = String(s.observation_id) + ":" + s.academic_year + ":" +
      s.offering_pk + ":" +
      s.identity_variant_index;
    if (seen.has(identity)) fail();
    seen.add(identity);
    if (
      approval.field !== SLOT ||
      approval.expected_native_value_type !== "string" ||
      approval.expected_raw_status !== "pending_metadata" ||
      approval.expected_raw_unit !== null
    ) fail();
    hash(approval.authority_sha256);
    hash(approval.qualification_receipt_sha256);
    hash(approval.expected_raw_cell_sha256);
    hash(approval.expected_identity_review_sha256);
    if (
      approval.authority_sha256 === q.authority_sha256 &&
      approval.qualification_receipt_sha256 ===
        q.qualification_receipt_sha256 &&
      Object.keys(selected).every((k) => selected[k] === s[k])
    ) matches.push(approval);
  }
  if (matches.length !== 1) fail();
  const approval = matches[0];
  if (
    typeof rawCell.value !== "string" ||
    !/^(?:0|[1-9][0-9]{0,1023})$/.test(rawCell.value) ||
    rawCell.status !== approval.expected_raw_status ||
    rawCell.unit !== approval.expected_raw_unit
  ) fail();
  const original = Object.fromEntries(
    Object.entries(rawCell).filter(([k]) => k !== "service_qualification"),
  );
  try {
    if (
      await nativeJsonSha256(original) !== approval.expected_raw_cell_sha256 ||
      await nativeJsonSha256(review) !==
        approval.expected_identity_review_sha256
    ) fail();
  } catch {
    fail();
  }
  return cloneNativeJson(q);
}
