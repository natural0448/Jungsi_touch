/** SYNTHETIC REVIEW CANDIDATE ONLY. No DB, network, publisher or authorization. */
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { hasAsciiControl } from "../domain/text.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUIRED = [
  "academic_year",
  "school_id",
  "original_pk",
  "campus",
  "admission_track",
  "group",
  "scope",
  "source_ref",
] as const;
const QUOTA_FIELDS = [
  "quota_value",
  "quota_literal_state",
  "quota_stage",
  "quota_condition_text",
  "quota_cell",
] as const;
const PUBLIC_METADATA = ["university_name", "region", "department"] as const;
const IDENTITY = [
  "academic_year",
  "school_id",
  "original_pk",
  "campus",
  "admission_track",
  "group",
] as const;

function need(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
function exact(
  raw: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): NativeObject {
  need(
    raw !== null && typeof raw === "object" && !Array.isArray(raw) && !(raw instanceof JsonFloat),
    "invalid_object",
  );
  const keys = Reflect.ownKeys(raw);
  need(
    keys.every((k) => typeof k === "string" && (required.includes(k) || optional.includes(k))),
    "unknown_field",
  );
  const o = raw as NativeObject;
  for (const k of required) need(Object.hasOwn(o, k), "missing_field");
  for (const k of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, k);
    need(descriptor && descriptor.enumerable && "value" in descriptor, "invalid_property");
  }
  return o;
}
function text(x: unknown, max = 256): asserts x is string {
  need(
    typeof x === "string" && x.length > 0 && x.length <= max &&
      !hasAsciiControl(x),
    "invalid_text",
  );
}
function nullableText(x: unknown, max = 256): void {
  if (x !== null) text(x, max);
}
function scalar(x: unknown): void {
  need(
    x === null || typeof x === "string" || typeof x === "bigint" ||
      typeof x === "number" && Number.isSafeInteger(x) || x instanceof JsonFloat,
    "invalid_quota_value",
  );
  if (typeof x === "string") {
    need(x.length <= 4096 && !hasAsciiControl(x), "invalid_quota_value");
  }
  if (x instanceof JsonFloat) {
    need(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(x.lexeme), "invalid_quota_value");
  }
}
function identity(raw: unknown, year: "2027" | "past"): NativeObject {
  const v = exact(raw, IDENTITY);
  need(
    Number.isSafeInteger(v.academic_year) &&
      (year === "2027"
        ? v.academic_year === 2027
        : [2024, 2025, 2026].includes(Number(v.academic_year))),
    "invalid_year",
  );
  need(
    typeof v.school_id === "string" && ID.test(v.school_id) &&
      typeof v.original_pk === "string" && ID.test(v.original_pk),
    "invalid_identity",
  );
  for (const field of ["campus", "admission_track", "group"]) nullableText(v[field]);
  return cloneNativeJson(v);
}
function identityKey(v: NativeObject): string {
  return JSON.stringify(IDENTITY.map((k) => v[k]));
}
function rowIdentity(row: NativeObject): NativeObject {
  return identity(Object.fromEntries(IDENTITY.map((k) => [k, row[k]])), "2027");
}

export interface ReviewedR27Links {
  readonly kind: "reviewed_r27_links";
}
export interface R27ReviewBinding {
  readonly source_head_sha256: string;
  readonly previous_publication_sha256: string;
  readonly previous_source_head_sha256: string;
  readonly scope_sha256: string;
  readonly authority_sha256: string;
}
export interface R27LinkPin {
  readonly receiptSha256: string;
  readonly sourceSha256: string;
  readonly reviewBinding?: R27ReviewBinding;
}
type Grant = {
  source: NativeObject;
  target: NativeObject;
  evidence: string;
  explicitScope: boolean;
};
type LinkData = { sourceSha: string; grants: readonly Grant[]; binding: R27ReviewBinding | null };
const sealed = new WeakMap<ReviewedR27Links, LinkData>();
/** Preserve exactly the input view, without invoking a caller-provided iterator. */
function snapshotReceiptBytes(bytes: Uint8Array, failure: string): Uint8Array<ArrayBuffer> {
  const getByteLength = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;
  need(bytes instanceof Uint8Array && typeof getByteLength === "function", failure);
  const length = Reflect.apply(getByteLength, bytes, []) as number;
  need(length > 0 && length <= 131072, failure);
  const copy = new Uint8Array(new ArrayBuffer(length));
  Uint8Array.prototype.set.call(copy, bytes);
  return copy;
}
async function sha(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw.buffer))]
    .map((x) => x.toString(16).padStart(2, "0")).join("");
}
function dataPin(pin: unknown): R27LinkPin {
  const p = exact(pin, ["receiptSha256", "sourceSha256"], ["reviewBinding"]);
  const receiptSha256 = Object.getOwnPropertyDescriptor(p, "receiptSha256")?.value;
  const sourceSha256 = Object.getOwnPropertyDescriptor(p, "sourceSha256")?.value;
  need(
    typeof receiptSha256 === "string" && HASH.test(receiptSha256) &&
      typeof sourceSha256 === "string" && HASH.test(sourceSha256),
    "invalid_link_pin",
  );
  if (!Object.hasOwn(p, "reviewBinding")) return Object.freeze({ receiptSha256, sourceSha256 });
  const fields = [
    "source_head_sha256",
    "previous_publication_sha256",
    "previous_source_head_sha256",
    "scope_sha256",
    "authority_sha256",
  ] as const;
  const raw = exact(p.reviewBinding, fields);
  for (const field of fields) {
    need(typeof raw[field] === "string" && HASH.test(raw[field] as string), "invalid_link_pin");
  }
  const reviewBinding = Object.freeze(
    Object.fromEntries(fields.map((k) => [k, raw[k]])) as unknown as R27ReviewBinding,
  );
  return Object.freeze({ receiptSha256, sourceSha256, reviewBinding });
}
/** The caller must obtain the trusted pin from its approved descriptor, not a request body.
 * SHA matching does not authenticate the issuer. The same copied bytes are hashed and parsed.
 */
export async function bindReviewedR27Links(
  bytes: Uint8Array,
  trustedPin: R27LinkPin,
): Promise<ReviewedR27Links> {
  const pin = dataPin(trustedPin);
  const copy = snapshotReceiptBytes(bytes, "invalid_link_receipt");
  need(await sha(copy) === pin.receiptSha256, "link_receipt_sha_mismatch");
  const core = exact(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(copy)), [
    "format",
    "status",
    "source_sha256",
    "grants",
  ], ["review_binding"]);
  const v2 = core.format === "jungsi.r27-reviewed-links/v2";
  if (v2) {
    const fields = [
      "source_head_sha256",
      "previous_publication_sha256",
      "previous_source_head_sha256",
      "scope_sha256",
      "authority_sha256",
    ] as const;
    const binding = exact(core.review_binding, fields);
    need(
      pin.reviewBinding && fields.every((k) => binding[k] === pin.reviewBinding![k]),
      "review_binding_mismatch",
    );
  } else {
    need(!Object.hasOwn(core, "review_binding") && !pin.reviewBinding, "review_binding_mismatch");
  }
  need(
    ["jungsi.r27-reviewed-links/v1", "jungsi.r27-reviewed-links/v2"].includes(
      String(core.format),
    ) &&
      core.status === "approved_exact_mappings" &&
      core.source_sha256 === pin.sourceSha256 && Array.isArray(core.grants) &&
      core.grants.length <= 64,
    "invalid_link_receipt",
  );
  const grants: Grant[] = core.grants.map((raw) => {
    const g = exact(raw, [
      "source",
      "target",
      "review_state",
      "evidence_sha256",
      ...(v2 ? ["source_field_states", "target_field_states"] : []),
    ]);
    need(
      g.review_state === "approved" && typeof g.evidence_sha256 === "string" &&
        HASH.test(g.evidence_sha256),
      "invalid_link_grant",
    );
    const source = identity(g.source, "2027"), target = identity(g.target, "past");
    if (v2) {
      // A trusted, independently approved receipt must explicitly certify each field.
      // Missing or unknown is not evidence of a confirmed null.
      for (
        const [rawStates, value] of [[g.source_field_states, source], [
          g.target_field_states,
          target,
        ]] as const
      ) {
        const states = exact(rawStates, ["campus", "admission_track", "group"]);
        for (const field of ["campus", "admission_track", "group"]) {
          need(
            states[field] === (value[field] === null ? "confirmed_null" : "confirmed_value"),
            "unconfirmed_link_scope",
          );
        }
      }
    }
    return { source, target, evidence: g.evidence_sha256, explicitScope: v2 };
  });
  const ctx = Object.freeze({ kind: "reviewed_r27_links" as const });
  sealed.set(ctx, { sourceSha: pin.sourceSha256, grants, binding: pin.reviewBinding ?? null });
  return ctx;
}
export function combineReviewedR27Links(contexts: readonly ReviewedR27Links[]): ReviewedR27Links {
  need(
    Array.isArray(contexts) && contexts.length > 0 && contexts.length <= 512,
    "link_context_required",
  );
  let sourceSha: string | null = null;
  let binding: R27ReviewBinding | null = null;
  const grants: Grant[] = [];
  for (const ctx of contexts) {
    const data = sealed.get(ctx);
    need(data && (sourceSha === null || sourceSha === data.sourceSha), "link_source_changed");
    sourceSha = data.sourceSha;
    if (data.binding) {
      need(
        binding === null || JSON.stringify(binding) === JSON.stringify(data.binding),
        "review_binding_mismatch",
      );
      binding = data.binding;
    }
    grants.push(...data.grants);
    need(grants.length <= 20000, "link_bound");
  }
  need(sourceSha !== null, "link_context_required");
  const result = Object.freeze({ kind: "reviewed_r27_links" as const });
  sealed.set(result, { sourceSha, grants, binding });
  return result;
}
/** V2 publication preparation must use exactly the heads and scope independently
 * bound to the approved descriptor. The authority pin is not issuer authentication. */
export function assertReviewedR27LinkBinding(
  ctx: ReviewedR27Links | undefined,
  expected: Pick<
    R27ReviewBinding,
    | "source_head_sha256"
    | "previous_publication_sha256"
    | "previous_source_head_sha256"
    | "scope_sha256"
  >,
): void {
  if (ctx === undefined) return;
  const data = sealed.get(ctx);
  need(data, "unsealed_link_context");
  if (data.binding) {
    const fields = [
      "source_head_sha256",
      "previous_publication_sha256",
      "previous_source_head_sha256",
      "scope_sha256",
    ] as const;
    need(fields.every((k) => data.binding![k] === expected[k]), "review_binding_mismatch");
  }
}
export interface ReviewedR27Scope {
  readonly kind: "reviewed_r27_scope";
}
type ScopeGrant = { source: NativeObject; state: string; evidence: string };
type ScopeData = { sourceSha: string; grants: readonly ScopeGrant[] };
const sealedScopes = new WeakMap<ReviewedR27Scope, ScopeData>();
/** The trusted pin must come from a separately verified descriptor. */
export async function bindReviewedR27Scope(
  bytes: Uint8Array,
  trustedPin: R27LinkPin,
): Promise<ReviewedR27Scope> {
  const pin = dataPin(trustedPin);
  const copy = snapshotReceiptBytes(bytes, "invalid_scope_receipt");
  need(await sha(copy) === pin.receiptSha256, "scope_receipt_sha_mismatch");
  const core = exact(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(copy)), [
    "format",
    "status",
    "source_sha256",
    "grants",
  ]);
  need(
    core.format === "jungsi.r27-reviewed-scope/v1" && core.status === "approved_scope_mappings" &&
      core.source_sha256 === pin.sourceSha256 && Array.isArray(core.grants) &&
      core.grants.length <= 64,
    "invalid_scope_receipt",
  );
  const grants: ScopeGrant[] = core.grants.map((raw) => {
    const g = exact(raw, ["source", "state", "evidence_sha256"]);
    need(
      typeof g.state === "string" &&
        ["eligible_non_practical", "excluded_practical"].includes(g.state) &&
        typeof g.evidence_sha256 === "string" && HASH.test(g.evidence_sha256),
      "invalid_scope_grant",
    );
    return {
      source: identity(g.source, "2027"),
      state: g.state,
      evidence: g.evidence_sha256,
    };
  });
  const ctx = Object.freeze({ kind: "reviewed_r27_scope" as const });
  sealedScopes.set(ctx, { sourceSha: pin.sourceSha256, grants });
  return ctx;
}
export function combineReviewedR27Scopes(contexts: readonly ReviewedR27Scope[]): ReviewedR27Scope {
  need(
    Array.isArray(contexts) && contexts.length > 0 && contexts.length <= 512,
    "scope_context_required",
  );
  let sourceSha: string | null = null;
  const grants: ScopeGrant[] = [];
  for (const ctx of contexts) {
    const data = sealedScopes.get(ctx);
    need(data && (sourceSha === null || sourceSha === data.sourceSha), "scope_source_changed");
    sourceSha = data.sourceSha;
    grants.push(...data.grants);
    need(grants.length <= 20000, "scope_bound");
  }
  need(sourceSha !== null, "scope_context_required");
  const result = Object.freeze({ kind: "reviewed_r27_scope" as const });
  sealedScopes.set(result, { sourceSha, grants });
  return result;
}
function compileScope(ctx?: ReviewedR27Scope): {
  sourceSha: string | null;
  bySource: Map<string, ScopeGrant>;
  conflicts: Set<string>;
} {
  const bySource = new Map<string, ScopeGrant>(), conflicts = new Set<string>();
  if (ctx === undefined) return { sourceSha: null, bySource, conflicts };
  const data = sealedScopes.get(ctx);
  need(data, "unsealed_scope_context");
  for (const grant of data.grants) {
    const key = identityKey(grant.source);
    if (bySource.has(key)) conflicts.add(key);
    else bySource.set(key, grant);
  }
  return { sourceSha: data.sourceSha, bySource, conflicts };
}

/** Review-only result: source campus remains ABSENT and is never equated with a grant value. */
export interface R27AbsentCampusScopeReview {
  readonly source_index: number;
  readonly source_campus: "ABSENT";
  readonly grant_campus: "NULL" | "PRESENT" | "UNKNOWN";
  readonly scope_result: "SCOPE_CANDIDATE" | "SCOPE_EXCLUDED" | "SCOPE_HELD" | "SCOPE_UNREVIEWED";
}

/**
 * Batch-match only already source-pinned ABSENT-campus rows to a sealed scope.
 * This does not approve current recruitment, quota, prior decisions, history, or
 * publication; the caller must preserve the original page location separately.
 */
export function reviewR27AbsentCampusScope(
  inputs: readonly unknown[],
  expectedSourceSha: string,
  context: ReviewedR27Scope,
): readonly R27AbsentCampusScopeReview[] {
  const data = sealedScopes.get(context);
  need(
    data && HASH.test(expectedSourceSha) && data.sourceSha === expectedSourceSha,
    "unsealed_scope_context",
  );
  need(Array.isArray(inputs) && inputs.length <= 20000, "scope_bound");
  const noCampus = (r: NativeObject) =>
    JSON.stringify([r.academic_year, r.school_id, r.original_pk, r.admission_track, r.group]);
  const baseKey = (r: NativeObject) =>
    JSON.stringify([r.academic_year, r.school_id, r.original_pk]);
  const grants = new Map<string, ScopeGrant[]>();
  for (const grant of data.grants) {
    const key = noCampus(grant.source), current = grants.get(key) ?? [];
    current.push(grant);
    grants.set(key, current);
  }
  const rows = inputs.map((raw) => {
    const row = exact(raw, REQUIRED.filter((field) => field !== "campus"), [
      ...QUOTA_FIELDS,
      ...PUBLIC_METADATA,
    ]);
    need(
      !Object.hasOwn(row, "campus") && row.academic_year === 2027 &&
        typeof row.school_id === "string" && ID.test(row.school_id) &&
        typeof row.original_pk === "string" && ID.test(row.original_pk),
      "invalid_identity",
    );
    nullableText(row.admission_track);
    nullableText(row.group);
    nullableText(row.source_ref, 4096);
    const scope = exact(row.scope, ["state", "evidence_sha256"]);
    need(
      typeof scope.state === "string" &&
        ["eligible_non_practical", "excluded_practical", "review_pending"].includes(scope.state) &&
        (scope.evidence_sha256 === null ||
          typeof scope.evidence_sha256 === "string" && HASH.test(scope.evidence_sha256)),
      "invalid_scope",
    );
    for (const field of PUBLIC_METADATA) if (Object.hasOwn(row, field)) nullableText(row[field]);
    if (Object.hasOwn(row, "quota_value")) scalar(row.quota_value);
    for (const field of ["quota_literal_state", "quota_stage", "quota_condition_text"]) {
      if (Object.hasOwn(row, field)) {
        nullableText(row[field], field === "quota_condition_text" ? 4096 : 256);
      }
    }
    let quotaMeta: NativeObject | null = null;
    if (Object.hasOwn(row, "quota_cell") && row.quota_cell !== null) {
      quotaMeta = exact(row.quota_cell, [], ["status", "reason_code", "unit", "source_as_of"]);
      for (const k of Object.keys(quotaMeta)) {
        nullableText(quotaMeta[k], k === "reason_code" ? 128 : 256);
      }
    }
    return { row, scope, quotaMeta };
  });
  const keyCounts = new Map<string, number>(), variants = new Map<string, Set<string>>();
  for (const { row } of rows) {
    const key = noCampus(row), base = baseKey(row), set = variants.get(base) ?? new Set<string>();
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    set.add(JSON.stringify([row.admission_track, row.group]));
    variants.set(base, set);
  }
  return Object.freeze(rows.map(({ row, scope, quotaMeta }, source_index) => {
    const matches = grants.get(noCampus(row)) ?? [],
      grant = matches.length === 1 ? matches[0] : undefined;
    const ambiguous = matches.length > 1 || (keyCounts.get(noCampus(row)) ?? 0) > 1 ||
      (variants.get(baseKey(row))?.size ?? 0) > 1;
    const bound = grant && scope.state === grant.state && scope.evidence_sha256 === grant.evidence;
    const quotaConflict = quotaMeta?.status === "verified_official" &&
      (!Object.hasOwn(row, "quota_value") || row.quota_value === null || row.quota_value === "");
    const scope_result: R27AbsentCampusScopeReview["scope_result"] =
      ambiguous || scope.state === "review_pending" || quotaConflict
        ? "SCOPE_HELD"
        : !bound
        ? "SCOPE_UNREVIEWED"
        : grant.state === "excluded_practical"
        ? "SCOPE_EXCLUDED"
        : "SCOPE_CANDIDATE";
    return Object.freeze({
      source_index,
      source_campus: "ABSENT" as const,
      grant_campus: !grant
        ? "UNKNOWN" as const
        : grant.source.campus === null
        ? "NULL" as const
        : "PRESENT" as const,
      scope_result,
    });
  }));
}
type Resolved = { target: NativeObject; targetKey: string };
function compileLinks(ctx?: ReviewedR27Links): {
  sourceSha: string | null;
  bySource: Map<string, Map<number, Resolved>>;
  conflicts: Map<string, Set<number>>;
} {
  const bySource = new Map<string, Map<number, Resolved>>(), reverse = new Map<string, string>();
  const conflicts = new Map<string, Set<number>>();
  const conflict = (key: string, year: number) => {
    const years = conflicts.get(key) ?? new Set<number>();
    years.add(year);
    conflicts.set(key, years);
  };
  if (ctx === undefined) return { sourceSha: null, bySource, conflicts };
  const data = sealed.get(ctx);
  need(data, "unsealed_link_context");
  for (const grant of data.grants) {
    const skey = identityKey(grant.source), tkey = identityKey(grant.target);
    const year = Number(grant.target.academic_year);
    const scopeFields = ["school_id", "campus", "admission_track", "group"];
    if (
      grant.source.school_id !== grant.target.school_id ||
      (!grant.explicitScope &&
        scopeFields.some((k) =>
          grant.source[k] === null || grant.target[k] === null ||
          grant.source[k] !== grant.target[k]
        ))
    ) {
      conflict(skey, year);
      continue;
    }
    const existing = bySource.get(skey) ?? new Map<number, Resolved>();
    if (existing.has(year)) conflict(skey, year);
    else existing.set(year, { target: grant.target, targetKey: tkey });
    bySource.set(skey, existing);
    const prior = reverse.get(tkey);
    if (prior !== undefined && prior !== skey) {
      conflict(prior, year);
      conflict(skey, year);
    } else reverse.set(tkey, skey);
  }
  return { sourceSha: data.sourceSha, bySource, conflicts };
}
type LinkIndex = ReturnType<typeof compileLinks>;
type ScopeIndex = ReturnType<typeof compileScope>;
type Disposition = "eligible" | "held" | "excluded";
export interface StandaloneProjection {
  readonly disposition: Disposition;
  readonly row: NativeObject | null;
}

function project(
  raw: unknown,
  links: LinkIndex,
  scopes: ScopeIndex,
  retainExcluded = false,
): StandaloneProjection {
  const source = exact(raw, REQUIRED, [...QUOTA_FIELDS, ...PUBLIC_METADATA]),
    ident = rowIdentity(source);
  const scope = exact(source.scope, ["state", "evidence_sha256"]);
  need(
    typeof scope.state === "string" &&
      ["eligible_non_practical", "excluded_practical", "review_pending"].includes(scope.state),
    "invalid_scope",
  );
  need(
    scope.evidence_sha256 === null ||
      typeof scope.evidence_sha256 === "string" && HASH.test(scope.evidence_sha256),
    "invalid_scope_evidence",
  );
  nullableText(source.source_ref, 4096);
  for (const field of PUBLIC_METADATA) {
    if (Object.hasOwn(source, field)) nullableText(source[field]);
  }
  if (Object.hasOwn(source, "quota_value")) scalar(source.quota_value);
  for (const field of ["quota_literal_state", "quota_stage", "quota_condition_text"]) {
    if (Object.hasOwn(source, field)) {
      nullableText(source[field], field === "quota_condition_text" ? 4096 : 256);
    }
  }
  let quotaMeta: NativeObject | null = null;
  if (Object.hasOwn(source, "quota_cell") && source.quota_cell !== null) {
    quotaMeta = exact(source.quota_cell, [], ["status", "reason_code", "unit", "source_as_of"]);
    for (const k of Object.keys(quotaMeta)) {
      nullableText(quotaMeta[k], k === "reason_code" ? 128 : 256);
    }
  }
  const quotaConflict = quotaMeta?.status === "verified_official" &&
    (!Object.hasOwn(source, "quota_value") || source.quota_value === null ||
      source.quota_value === "");
  const key = identityKey(ident), approved = scopes.bySource.get(key);
  const scopeBound = approved !== undefined && !scopes.conflicts.has(key) &&
    scope.state === approved.state && scope.evidence_sha256 === approved.evidence;
  const scopeDisposition: Disposition = scope.state === "excluded_practical" && scopeBound
    ? "excluded"
    : scope.state === "eligible_non_practical" && scopeBound
    ? "eligible"
    : "held";
  const disposition: Disposition = scopeDisposition === "eligible" && quotaConflict
    ? "held"
    : scopeDisposition;
  const targets = links.bySource.get(key),
    conflictYears = links.conflicts.get(key) ?? new Set<number>();
  const linked = targets
    ? [...targets.entries()].filter(([year]) => !conflictYears.has(year))
      .sort(([a], [b]) => a - b).map(([, item]) => cloneNativeJson(item.target))
    : [];
  const pendingYears = [...conflictYears].sort((a, b) => a - b);
  const out: NativeObject = {
    ...ident,
    scope_review: scopeDisposition === "eligible" ? "eligible" : "review_pending",
    history_link_status: pendingYears.length
      ? linked.length ? "partially_reviewed" : "conflict_pending"
      : linked.length
      ? "exact_reviewed"
      : "not_reviewed",
    history_link_pending_years: pendingYears,
    historical_links: linked,
  };
  for (const field of PUBLIC_METADATA) if (Object.hasOwn(source, field)) out[field] = source[field];
  for (const field of QUOTA_FIELDS) {
    if (Object.hasOwn(source, field)) {
      const value = source[field];
      if (field === "quota_cell" && value !== null) {
        const meta = exact(value, [], ["status", "reason_code", "unit", "source_as_of"]);
        out[field] = Object.fromEntries(Object.keys(meta).map((k) => [k, meta[k]])) as NativeObject;
      } else out[field] = value instanceof JsonFloat ? new JsonFloat(value.lexeme) : value;
    }
  }
  const conditionPresent = typeof source.quota_condition_text === "string" ||
    source.quota_literal_state === "conditional_transfer" ||
    source.quota_literal_state === "conditional_carryover";
  out.quota_review_status = quotaConflict
    ? "source_conflict"
    : conditionPresent
    ? "condition_present"
    : !Object.hasOwn(source, "quota_stage") || source.quota_stage === null
    ? "stage_unknown"
    : "source_stage_only";
  return { disposition, row: disposition === "excluded" && !retainExcluded ? null : out };
}
/** Single explicitly supplied 2027 source row. Never chooses a legacy binding. */
export function projectStandaloneR27Row(
  raw: unknown,
  links?: ReviewedR27Links,
  expectedSourceSha?: string,
  scopeContext?: ReviewedR27Scope,
): StandaloneProjection {
  const index = compileLinks(links), scopes = compileScope(scopeContext);
  need(
    (index.sourceSha === null || index.sourceSha === expectedSourceSha) &&
      (scopes.sourceSha === null || scopes.sourceSha === expectedSourceSha),
    "review_source_changed",
  );
  return project(raw, index, scopes);
}
export interface R27BatchPage {
  readonly source_sha256: string;
  readonly rows: readonly unknown[];
  readonly next_cursor: string | null;
}
export interface R27PagedSource {
  readPage(
    request: {
      readonly source_sha256: string;
      readonly cursor: string | null;
      readonly limit: number;
    },
  ): Promise<R27BatchPage>;
}
export interface R27BatchOptions {
  readonly source_sha256: string;
  readonly expected_rows: number;
  readonly page_size: number;
  readonly max_pages: number;
  readonly max_rows: number;
}
/** Synthetic page port only. Source coverage and authority must be verified externally. */
export async function buildStandaloneR27(
  port: R27PagedSource,
  options: R27BatchOptions,
  links?: ReviewedR27Links,
  scopeContext?: ReviewedR27Scope,
): Promise<
  {
    readonly status: "HOLD_UNPUBLISHED";
    readonly rows: readonly NativeObject[];
    readonly held: readonly NativeObject[];
    readonly excluded: readonly NativeObject[];
    readonly excluded_count: number;
  }
> {
  need(port && typeof port.readPage === "function", "invalid_source");
  const rawOptions = exact(options, [
    "source_sha256",
    "expected_rows",
    "page_size",
    "max_pages",
    "max_rows",
  ]);
  const cfg = Object.freeze({
    source_sha256: rawOptions.source_sha256,
    expected_rows: rawOptions.expected_rows,
    page_size: rawOptions.page_size,
    max_pages: rawOptions.max_pages,
    max_rows: rawOptions.max_rows,
  }) as unknown as R27BatchOptions;
  const readPage = port.readPage.bind(port);
  need(typeof cfg.source_sha256 === "string" && HASH.test(cfg.source_sha256), "invalid_source");
  need(
    Number.isSafeInteger(cfg.expected_rows) && cfg.expected_rows >= 0 &&
      Number.isSafeInteger(cfg.page_size) && cfg.page_size > 0 && cfg.page_size <= 128 &&
      Number.isSafeInteger(cfg.max_pages) && cfg.max_pages > 0 && cfg.max_pages <= 512 &&
      Number.isSafeInteger(cfg.max_rows) && cfg.max_rows >= 0 && cfg.max_rows <= 20000 &&
      cfg.expected_rows <= cfg.max_rows,
    "invalid_batch_limits",
  );
  const index = compileLinks(links), scopes = compileScope(scopeContext);
  need(
    (index.sourceSha === null || index.sourceSha === cfg.source_sha256) &&
      (scopes.sourceSha === null || scopes.sourceSha === cfg.source_sha256),
    "review_source_changed",
  );
  const rows: NativeObject[] = [],
    held: NativeObject[] = [],
    excludedRows: NativeObject[] = [],
    cursors = new Set<string>();
  const received: { key: string; projection: StandaloneProjection }[] = [],
    counts = new Map<string, number>();
  let cursor: string | null = null, seen = 0, pages = 0, excluded = 0;
  do {
    need(pages < cfg.max_pages, "page_budget_exhausted");
    const rawPage = await readPage(
      Object.freeze({ source_sha256: cfg.source_sha256, cursor, limit: cfg.page_size }),
    );
    const page = exact(rawPage, ["source_sha256", "rows", "next_cursor"]);
    pages++;
    need(
      page.source_sha256 === cfg.source_sha256 && Array.isArray(page.rows) &&
        page.rows.length <= cfg.page_size,
      "source_page_mismatch",
    );
    need(
      page.next_cursor === null ||
        typeof page.next_cursor === "string" && page.next_cursor.length > 0 &&
          page.next_cursor.length <= 1024,
      "invalid_cursor",
    );
    if (page.next_cursor !== null) {
      need(page.rows.length > 0 && !cursors.has(page.next_cursor as string), "repeated_cursor");
      cursors.add(page.next_cursor as string);
    }
    for (const raw of page.rows) {
      const source = exact(raw, REQUIRED, [...QUOTA_FIELDS, ...PUBLIC_METADATA]);
      const key = identityKey(rowIdentity(source));
      counts.set(key, (counts.get(key) ?? 0) + 1);
      seen++;
      need(seen <= cfg.max_rows && seen <= cfg.expected_rows, "row_budget_exhausted");
      received.push({ key, projection: project(source, index, scopes, true) });
    }
    cursor = page.next_cursor as string | null;
  } while (cursor !== null);
  need(seen === cfg.expected_rows, "incomplete_source_snapshot");
  for (const { key, projection } of received) {
    if ((counts.get(key) ?? 0) > 1) {
      need(projection.row !== null, "duplicate_row_missing");
      held.push({
        ...projection.row,
        scope_review: "duplicate_identity_pending",
        history_link_status: "duplicate_identity_pending",
        history_link_pending_years: [],
        historical_links: [],
      });
    } else if (projection.disposition === "excluded") {
      excluded++;
      excludedRows.push(projection.row!);
    } else if (projection.disposition === "held") held.push(projection.row!);
    else rows.push(projection.row!);
  }
  return {
    status: "HOLD_UNPUBLISHED",
    rows,
    held,
    excluded: excludedRows,
    excluded_count: excluded,
  };
}
