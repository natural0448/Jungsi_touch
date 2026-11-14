/**
 * REVIEW ONLY: bounded app-role read of six independently authorized Guide rule bindings.
 * It does not change views/RLS, activate a rule, serve a DTO or install a runtime factory.
 * Full original evidence stays private and must pass the existing safe projection boundary.
 */
import { AccessError } from "../application/access.ts";
import { requireVoidDrains } from "../application/reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import { guideRuleQuery } from "../application/guide_rule_reference.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import { sqlJsonText } from "./sql_values.ts";
import { type NativeSqlTransaction, SupabaseSqlTransport } from "./transaction_sql.ts";
import {
  GUIDE_RULE_METADATA_SEEDS,
  type GuideRuleSourceApproval,
} from "./current_guide_rule_postgres.ts";
import {
  CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS,
  CURRENT_PUBLIC_GUIDE_COMMAND_SQL,
  CURRENT_PUBLIC_METADATA_SQL,
} from "./guide_metadata_sql.ts";

/**
 * Guide's exact current (year, offering PK) determines release + rule hash. The current rule
 * view is tried first; ONLY a current-view miss may read the physical composite primary key.
 * Never select a different release by hash alone.
 * All result material stays internal; provider must preserve but never log evidence_reference.
 */
export const CURRENT_GUIDE_PHYSICAL_BATCH_SQL = `WITH requested AS MATERIALIZED (
 SELECT (x.value->>'academicYear')::smallint AS academic_year,
        x.value->>'offeringPk' AS offering_pk,x.ordinality AS ord
 FROM jsonb_array_elements($1::text::jsonb) WITH ORDINALITY AS x(value,ordinality)
)
SELECT k.ord::text,(g.offering_pk IS NOT NULL),
 CASE WHEN c.release_id IS NOT NULL THEN 'current_view'
      WHEN f.release_id IS NOT NULL THEN 'exact_physical' ELSE 'missing' END,
 CASE WHEN g.offering_pk IS NULL THEN NULL
      WHEN octet_length(h.body::text)<=$2::integer THEN h.body::text ELSE NULL END,
 CASE WHEN c.release_id IS NULL AND f.release_id IS NULL THEN NULL
      WHEN octet_length(p.body::text)<=$2::integer THEN p.body::text ELSE NULL END
FROM requested k
LEFT JOIN LATERAL (
 SELECT release_id,academic_year,offering_pk,score_rule_sha256,school_id,row_sha256,metadata
 FROM jungsi_data_ingest.guide_offerings_native_minimum3_current_v4 q
 WHERE q.academic_year=k.academic_year AND q.offering_pk=k.offering_pk
 AND (q.metadata->'active_service') IS DISTINCT FROM 'false'::jsonb
 AND (q.metadata->'practical_required') IS DISTINCT FROM 'true'::jsonb LIMIT 2
) g ON true
LEFT JOIN LATERAL (
 SELECT release_id,rule_sha256,definition,evidence_reference,engine_approved
 FROM jungsi_data_ingest.guide_rules_native_minimum3_current_v4 q
 WHERE q.release_id=g.release_id AND q.rule_sha256=g.score_rule_sha256 LIMIT 2
) c ON true
LEFT JOIN LATERAL (
 SELECT release_id,rule_sha256,definition,evidence_reference,engine_approved
 FROM jungsi_data_ingest.guide_score_rules q
 WHERE c.release_id IS NULL AND q.release_id=g.release_id AND q.rule_sha256=g.score_rule_sha256 LIMIT 2
) f ON true
CROSS JOIN LATERAL (SELECT jsonb_build_object('release_id',g.release_id,'academic_year',g.academic_year,
 'offering_pk',g.offering_pk,'rule_sha256',g.score_rule_sha256,'school_id',g.school_id,
 'row_sha256',g.row_sha256,'source',jsonb_build_object('source_url',g.metadata->'source_url',
 'source_as_of',g.metadata->'source_as_of','source_year',g.metadata->'source_year')) AS body) h
CROSS JOIN LATERAL (SELECT jsonb_build_object('release_id',COALESCE(c.release_id,f.release_id),
 'rule_sha256',COALESCE(c.rule_sha256,f.rule_sha256),
 'engine_approved',COALESCE(c.engine_approved,f.engine_approved),
 'definition',COALESCE(c.definition,f.definition),
 'evidence_reference',COALESCE(c.evidence_reference,f.evidence_reference)) AS body) p
ORDER BY k.ord`;

export type PhysicalGuideKey = Readonly<{ academicYear: number; offeringPk: string }>;
/** Exact, independently approved miss scope; not supplied by the student or API request. */
export type PhysicalGuideBinding = Readonly<
  PhysicalGuideKey & {
    schoolId: string;
    releaseId: string;
    ruleSha256: string;
  }
>;
export type PhysicalGuideRuleRead = Readonly<{
  key: PhysicalGuideKey;
  status: "collected_reference" | "pending";
  /** Internal provenance, not a public API field. Null when the exact binding was not found. */
  header: NativeObject | null;
  /** Full exact-release definition/evidence is private; a separate safe projector is required. */
  rule: NativeObject | null;
  provenance: "current_view" | "exact_physical" | "missing";
  engineActivation: false;
}>;
export interface PhysicalGuideRuleGrant {
  readonly approval: GuideRuleSourceApproval;
  /** Exact six reviewed bindings, tied by authority to this descriptor/head and scope. */
  readonly authorizedBindings: readonly PhysicalGuideBinding[];
  readonly maxRecordBytes: number;
  readonly maxBatchBytes: number;
}
/** Independent request/session/scope authority; none is installed by this candidate. */
export interface PhysicalGuideRuleAuthority {
  /** Authenticate user/paid access, verified six-binding scope and approved descriptor before I/O.
   * Any issue I/O must be physically stopped before the promise settles, even on abort. */
  issue(request: ApiExecution, boundary: ApiExecutionBoundary): Promise<PhysicalGuideRuleGrant>;
  /** Bind exact subject, request, admission, source descriptor, SQL transport and physical budget. */
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: PhysicalGuideRuleGrant,
    sql: SupabaseSqlTransport,
  ): Promise<void>;
  /** Independently bind each exact-release definition and original evidence to the reviewed
   * source/receipt. A same rule SHA from a different release is not that proof. */
  assertExactRows(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: PhysicalGuideRuleGrant,
    rows: readonly PhysicalGuideRuleRead[],
  ): Promise<void>;
  /** Resolves only after all started database/authority I/O physically stops, including on abort. */
  awaitQuiescence(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    grant: PhysicalGuideRuleGrant,
  ): Promise<void>;
}
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function fail(): never {
  throw new AccessError("current_catalog_unavailable", 503);
}
function obj(v: unknown): v is NativeObject {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
function freezeTree(v: unknown): void {
  if (!v || typeof v !== "object" || Object.isFrozen(v)) return;
  for (const x of Object.values(v)) freezeTree(x);
  Object.freeze(v);
}
function parse(v: unknown, max: number): unknown {
  try {
    return sqlJsonText(v, max);
  } catch {
    return fail();
  }
}
function readGrant(v: PhysicalGuideRuleGrant, clock: RequestClockPort): PhysicalGuideRuleGrant {
  if (
    !v || !v.approval || !Number.isSafeInteger(v.maxRecordBytes) || v.maxRecordBytes < 1 ||
    v.maxRecordBytes > 65_536 || !Number.isSafeInteger(v.maxBatchBytes) ||
    v.maxBatchBytes < v.maxRecordBytes || v.maxBatchBytes > 8_388_608 ||
    !HASH.test(v.approval.metadataSha256) || !HASH.test(v.approval.sourcePointerSha256) ||
    typeof v.approval.expiresAtUtc !== "bigint" || v.approval.expiresAtUtc <= clock.nowUtc() ||
    !v.approval.guideCommands || !Array.isArray(v.authorizedBindings) ||
    v.authorizedBindings.length !== 6 || typeof v.approval.version !== "string" ||
    !ID.test(v.approval.version)
  ) fail();
  const commands: Record<string, Readonly<{ count: number; sha256: string }>> = {};
  for (const name of CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS) {
    const c = v.approval.guideCommands[name];
    if (
      !c || !Number.isSafeInteger(c.count) || c.count < 0 || c.count > 64 || !HASH.test(c.sha256)
    ) fail();
    commands[name] = Object.freeze({ count: c.count, sha256: c.sha256 });
  }
  if (
    Object.keys(v.approval.guideCommands).length !== CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.length
  ) fail();
  const approval = Object.freeze({
    version: v.approval.version,
    sourcePointerSha256: v.approval.sourcePointerSha256,
    metadataSha256: v.approval.metadataSha256,
    expiresAtUtc: v.approval.expiresAtUtc,
    guideCommands: Object.freeze(commands),
  });
  const bindings = v.authorizedBindings.map((b) => {
    if (
      !b || typeof b !== "object" || typeof b.schoolId !== "string" ||
      !/^[0-9]{3}$/.test(b.schoolId) ||
      typeof b.releaseId !== "string" || !ID.test(b.releaseId) ||
      typeof b.ruleSha256 !== "string" || !HASH.test(b.ruleSha256)
    ) fail();
    const k = guideRuleQuery(b.academicYear, b.offeringPk);
    return Object.freeze({
      academicYear: k.academicYear,
      offeringPk: k.offeringPk,
      schoolId: b.schoolId,
      releaseId: b.releaseId,
      ruleSha256: b.ruleSha256,
    });
  });
  if (new Set(bindings.map((b) => JSON.stringify([b.academicYear, b.offeringPk]))).size !== 6) {
    fail();
  }
  // Existing server-side descriptor verification is mandatory; structural hashes alone
  // cannot establish its issuer. The independent authority verifies it before each read.
  return Object.freeze({
    approval,
    authorizedBindings: Object.freeze(bindings),
    maxRecordBytes: v.maxRecordBytes,
    maxBatchBytes: v.maxBatchBytes,
  });
}
async function metadata(
  tx: NativeSqlTransaction,
  approval: GuideRuleSourceApproval,
  signal: AbortSignal,
): Promise<void> {
  const rows = await tx.query(CURRENT_PUBLIC_METADATA_SQL, [
    JSON.stringify(GUIDE_RULE_METADATA_SEEDS),
  ], signal);
  if (rows.length < GUIDE_RULE_METADATA_SEEDS.length || rows.length > 128) fail();
  const names = [
    "schema",
    "relation",
    "kind",
    "rls",
    "force",
    "reloptions",
    "owner",
    "readable",
    "writable",
    "anon_read",
    "authenticated_read",
    "definition",
    "columns",
  ];
  const values = rows.map((r) => {
    if (!Array.isArray(r) || r.length !== names.length) fail();
    const m = Object.fromEntries(
      names.map((
        k,
        i,
      ) => [k, i === 5 || i === 12 ? r[i] === null ? null : parse(r[i], 65_536) : r[i]]),
    );
    if (
      m.schema !== "jungsi_data_ingest" || !["r", "v"].includes(String(m.kind)) ||
      m.owner !== false || m.readable !== true || m.writable !== false ||
      m.anon_read !== false || m.authenticated_read !== false ||
      m.kind === "r" && (m.rls !== true || m.force !== true) ||
      m.kind === "v" &&
        (!Array.isArray(m.reloptions) || !m.reloptions.includes("security_invoker=true"))
    ) fail();
    return m;
  });
  if (
    await nativeJsonSha256(values) !== approval.metadataSha256 ||
    GUIDE_RULE_METADATA_SEEDS.some((s) => !values.some((m) => m.relation === s.split(".")[1]))
  ) fail();
}
async function commands(
  tx: NativeSqlTransaction,
  approval: GuideRuleSourceApproval,
  signal: AbortSignal,
): Promise<void> {
  if (
    Object.keys(approval.guideCommands).length !== CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.length
  ) fail();
  const items = CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((name) => {
    const v = approval.guideCommands[name];
    if (
      !v || !Number.isSafeInteger(v.count) || v.count < 0 || v.count > 64 || !HASH.test(v.sha256)
    ) fail();
    return v;
  });
  const rows = await tx.query(
    CURRENT_PUBLIC_GUIDE_COMMAND_SQL,
    items.map((v) => v.count + 1),
    signal,
  );
  if (rows.length !== items.length) fail();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== 2 || rows[i][0] !== CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS[i]) fail();
    const headers = parse(rows[i][1], 65_536);
    if (
      !Array.isArray(headers) || headers.length !== items[i].count ||
      await nativeJsonSha256(headers) !== items[i].sha256
    ) fail();
  }
}

/** The returned evidence is internal: do not place it into a response, cache log, or filename. */
export async function readCurrentPhysicalGuideRulesBatch(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  input: readonly PhysicalGuideKey[],
  sql: SupabaseSqlTransport,
  clock: RequestClockPort,
  authority: PhysicalGuideRuleAuthority,
): Promise<readonly PhysicalGuideRuleRead[]> {
  if (
    !request || !boundary?.admission || !boundary.signal || boundary.signal.aborted ||
    !Array.isArray(input) || input.length !== 6 ||
    !(sql instanceof SupabaseSqlTransport) || !clock || typeof clock.nowUtc !== "function" ||
    !authority || typeof authority.issue !== "function" ||
    typeof authority.assertCurrent !== "function" ||
    typeof authority.assertExactRows !== "function" ||
    typeof authority.awaitQuiescence !== "function"
  ) fail();
  const keys = Object.freeze(input.map((k) => {
    if (!k || typeof k !== "object") fail();
    const v = guideRuleQuery(k.academicYear, k.offeringPk);
    return Object.freeze({ academicYear: v.academicYear, offeringPk: v.offeringPk });
  }));
  if (
    new Set(keys.map((k) => JSON.stringify([k.academicYear, k.offeringPk]))).size !== keys.length
  ) fail();
  const signal = boundary.signal,
    admission = boundary.admission,
    subject = request.session.user.subjectId;
  const grant = readGrant(await authority.issue(request, boundary), clock);
  const approved = new Map(
    grant.authorizedBindings.map((b) =>
      [JSON.stringify([b.academicYear, b.offeringPk]), b] as const
    ),
  );
  if (keys.some((k) => !approved.has(JSON.stringify([k.academicYear, k.offeringPk])))) fail();
  const active = async () => {
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.session.user.subjectId !== subject || grant.approval.expiresAtUtc <= clock.nowUtc()
    ) fail();
    await authority.assertCurrent(request, boundary, grant, sql);
    if (
      signal.aborted || boundary.signal !== signal || boundary.admission !== admission ||
      request.session.user.subjectId !== subject || grant.approval.expiresAtUtc <= clock.nowUtc()
    ) fail();
  };
  try {
    await active();
    const output = await sql.read(subject, async (tx) => {
      const readOnly = await tx.query(
        "SELECT current_setting('transaction_read_only')",
        [],
        signal,
      );
      if (readOnly.length !== 1 || readOnly[0].length !== 1 || readOnly[0][0] !== "on") fail();
      await metadata(tx, grant.approval, signal);
      await commands(tx, grant.approval, signal);
      await active();
      const parameters = [JSON.stringify(keys), grant.maxRecordBytes] as const;
      const first = await tx.query(CURRENT_GUIDE_PHYSICAL_BATCH_SQL, parameters, signal);
      // A duplicate Guide identity or duplicate physical binding is ambiguous: fail closed.
      if (first.length !== keys.length) fail();
      let bytes = 0;
      const result = first.map((r, i): PhysicalGuideRuleRead => {
        if (
          !Array.isArray(r) || r.length !== 5 || r[0] !== String(i + 1) ||
          typeof r[1] !== "boolean" ||
          !["current_view", "exact_physical", "missing"].includes(String(r[2]))
        ) fail();
        const header = r[1] ? parse(r[3], grant.maxRecordBytes) : null;
        const hasRule = r[2] !== "missing";
        const rule = hasRule ? parse(r[4], grant.maxRecordBytes) : null;
        if (r[1] && !obj(header) || hasRule && !obj(rule) || !r[1] && hasRule) fail();
        const expected = approved.get(JSON.stringify([keys[i].academicYear, keys[i].offeringPk]));
        if (!expected) fail();
        if (
          obj(header) && (header.academic_year !== keys[i].academicYear ||
            header.offering_pk !== keys[i].offeringPk || typeof header.release_id !== "string" ||
            header.release_id.length < 1 || header.release_id.length > 128 ||
            typeof header.school_id !== "string" || !/^[0-9]{3}$/.test(header.school_id) ||
            typeof header.row_sha256 !== "string" || !HASH.test(header.row_sha256) ||
            header.school_id !== expected.schoolId || header.release_id !== expected.releaseId ||
            header.rule_sha256 !== expected.ruleSha256)
        ) fail();
        if (
          obj(rule) && (!obj(header) || rule.release_id !== header.release_id ||
            rule.rule_sha256 !== header.rule_sha256 || rule.engine_approved !== false ||
            !obj(rule.definition) || !obj(rule.evidence_reference))
        ) fail();
        bytes += new TextEncoder().encode(nativeJsonText({ header, rule }, true)).length;
        if (bytes > grant.maxBatchBytes) fail();
        freezeTree(header);
        freezeTree(rule);
        return Object.freeze({
          key: keys[i],
          status: obj(rule) ? "collected_reference" : "pending",
          header: obj(header) ? header : null,
          rule: obj(rule) ? rule : null,
          provenance: r[2] as PhysicalGuideRuleRead["provenance"],
          engineActivation: false,
        });
      });
      await active();
      const second = await tx.query(CURRENT_GUIDE_PHYSICAL_BATCH_SQL, parameters, signal);
      if (await nativeJsonSha256(first) !== await nativeJsonSha256(second)) fail();
      await metadata(tx, grant.approval, signal);
      await commands(tx, grant.approval, signal);
      await authority.assertExactRows(request, boundary, grant, Object.freeze(result));
      await active();
      return Object.freeze(result);
    }, signal);
    await active();
    return output;
  } finally {
    await requireVoidDrains([() => authority.awaitQuiescence(request, boundary, grant)]);
  }
}
