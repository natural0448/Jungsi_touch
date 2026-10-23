/** App-role, parameterized point reads of existing Guide views. No DDL, grants or engine activation. */
import { AccessError } from "../application/access.ts";
import {
  GUIDE_REFERENCE_FIELDS,
  type GuideRuleQuery,
  guideRuleQuery,
  type GuideRuleReferencePort,
  type GuideRuleSourceResult,
} from "../application/guide_rule_reference.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import { utcInstant } from "../domain/time.ts";
import { sqlJsonText } from "./sql_values.ts";
import { type NativeSqlTransaction, SupabaseSqlTransport } from "./transaction_sql.ts";
import {
  CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS,
  CURRENT_PUBLIC_GUIDE_COMMAND_SQL,
  CURRENT_PUBLIC_METADATA_SQL,
  CURRENT_PUBLIC_SOURCE_VIEWS,
} from "./guide_metadata_sql.ts";

export const GUIDE_RULE_SOURCE_VIEWS = {
  offerings: CURRENT_PUBLIC_SOURCE_VIEWS.offerings,
  relations: CURRENT_PUBLIC_SOURCE_VIEWS.relations,
  rules: "jungsi_data_ingest.guide_rules_native_minimum3_current_v4",
} as const;
export const GUIDE_RULE_METADATA_SEEDS = [
  ...Object.values(GUIDE_RULE_SOURCE_VIEWS),
  ...CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((name) => "jungsi_data_ingest." + name),
];
const G = GUIDE_RULE_SOURCE_VIEWS.offerings;
// These are the unchanged and native-field branches of the metadata-pinned current v4 view.
const R = "jungsi_data_ingest.guide_rules_compact_current_v3";
const E = GUIDE_RULE_SOURCE_VIEWS.relations;
/** Resolve the current exact binding first; it is not a caller-supplied rule/release selector. */
export const GUIDE_RULE_HEADER_SQL = `SELECT jsonb_build_object('release_id',release_id,
 'academic_year',academic_year,'offering_pk',offering_pk,'rule_sha256',score_rule_sha256,
 'school_id',school_id,'row_sha256',row_sha256,
 'source',jsonb_build_object('source_url',metadata->'source_url','source_as_of',metadata->'source_as_of',
 'source_year',metadata->'source_year'))::text
 FROM ${G} WHERE academic_year=$1::integer AND offering_pk=$2::text
 AND (metadata->'active_service') IS DISTINCT FROM 'false'::jsonb
 AND (metadata->'practical_required') IS DISTINCT FROM 'true'::jsonb LIMIT 2`;
/** Concrete release+hash parameters reach the existing rule indexes before JSON projection. */
export const GUIDE_RULE_POINT_SQL = `SELECT jsonb_build_object('release_id',r.release_id,
 'rule_sha256',r.rule_sha256,'engine_approved',r.engine_approved,
 'definition',(SELECT COALESCE(jsonb_object_agg(x.key,x.value),'{}'::jsonb) FROM jsonb_each(r.definition) x WHERE x.key=ANY($3::text[])),
 'evidence',jsonb_build_object('canonical_rule_status',r.evidence_reference->'canonical_rule_status',
 'original_source_census_complete',r.evidence_reference->'original_source_census_complete',
 'field_uncertainties',(SELECT COALESCE(jsonb_agg(a.value),'[]'::jsonb)
 FROM jsonb_array_elements(COALESCE(r.evidence_reference->'field_uncertainties','[]'::jsonb)) a(value)
 WHERE a.value->>'field'=ANY($4::text[])),
 'column_export_information',(SELECT COALESCE(jsonb_object_agg(x.key,x.value),'{}'::jsonb)
 FROM jsonb_each(COALESCE(r.evidence_reference->'column_export_information','{}'::jsonb)) x WHERE x.key=ANY($4::text[]))))::text
 FROM ${R} r WHERE release_id=$1::text AND rule_sha256=$2::text LIMIT 2`;
/** Select the current native overlay before joining its concrete previous-rule hash. */
export const GUIDE_RULE_NATIVE_BINDING_SQL = `SELECT jsonb_build_object(
 'base_rule_release_id',base_rule_release_id,'before_rule_sha256',before_rule_sha256,
 'derived_rule_sha256',derived_rule_sha256,'derived_row_sha256',derived_row_sha256,
 'value_id',value_id)::text FROM jungsi_data_ingest.guide_native_minimum3_fields_v4
 WHERE school_id=$1::text AND academic_year=$2::integer AND offering_pk=$3::text LIMIT 2`;
/** Exact projection of the current native v4 branch; no new calculation or historical fallback. */
export const GUIDE_RULE_NATIVE_POINT_SQL = `WITH r AS MATERIALIZED(
 SELECT definition,evidence_reference FROM ${R} WHERE release_id=$1::text AND rule_sha256=$2::text),
 x AS MATERIALIZED(SELECT * FROM jungsi_data_ingest.guide_native_minimum3_fields_v4
 WHERE school_id=$3::text AND academic_year=$4::integer AND offering_pk=$5::text
 AND derived_rule_sha256=$6::text AND value_id=$7::text),
 v AS MATERIALIZED(SELECT value_json FROM jungsi_data_ingest.guide_native_minimum3_values_v4
 WHERE value_id=$7::text), projected AS (
 SELECT x.base_rule_release_id AS release_id,x.derived_rule_sha256 AS rule_sha256,
 r.definition || jsonb_build_object(x.field_name,v.value_json,'field_presence_types',
 (r.definition->'field_presence_types') || jsonb_build_object(x.field_name,'string')) AS definition,
 r.evidence_reference || jsonb_build_object('field_uncertainties',
 (SELECT COALESCE(jsonb_agg(a.value ORDER BY a.ord),'[]'::jsonb)
 FROM jsonb_array_elements(r.evidence_reference->'field_uncertainties') WITH ORDINALITY a(value,ord)
 WHERE COALESCE(a.value->>'field','')<>x.field_name),'column_export_information',
 (r.evidence_reference->'column_export_information') ||
 (x.correction_reference->'current_column_export_information_patch')) AS evidence_reference
 FROM r CROSS JOIN x CROSS JOIN v)
 SELECT jsonb_build_object('release_id',r.release_id,'rule_sha256',r.rule_sha256,
 'engine_approved',false,
 'definition',(SELECT COALESCE(jsonb_object_agg(a.key,a.value),'{}'::jsonb)
 FROM jsonb_each(r.definition) a WHERE a.key=ANY($8::text[])),
 'evidence',jsonb_build_object('canonical_rule_status',r.evidence_reference->'canonical_rule_status',
 'original_source_census_complete',r.evidence_reference->'original_source_census_complete',
 'field_uncertainties',(SELECT COALESCE(jsonb_agg(a.value),'[]'::jsonb)
 FROM jsonb_array_elements(COALESCE(r.evidence_reference->'field_uncertainties','[]'::jsonb)) a(value)
 WHERE a.value->>'field'=ANY($9::text[])),
 'column_export_information',
 (SELECT COALESCE(jsonb_object_agg(a.key,a.value),'{}'::jsonb)
 FROM jsonb_each(COALESCE(r.evidence_reference->'column_export_information','{}'::jsonb)) a
 WHERE a.key=ANY($9::text[]))))::text FROM projected r LIMIT 2`;
export const GUIDE_RULE_NEW_POINT_SQL = GUIDE_RULE_POINT_SQL.replace(
  `FROM ${R} r`,
  "FROM jungsi_data_ingest.guide_score_rules r",
);
/** The approved flag and both current endpoints are required; names never create a link. */
export const GUIDE_RULE_LINEAGE_SQL =
  `SELECT jsonb_build_object('from_year',r.from_year,'from_pk',r.from_pk,
 'to_year',r.to_year,'to_pk',r.to_pk,'kind',r.kind,'relation_type',r.relation_type,
 'relation_detail_type',r.relation_detail_type,'lineage_button_link_allowed',r.lineage_button_link_allowed,
 'endpoint_status',r.endpoint_status,'relation_sha256',r.relation_sha256,
 'constraints',(SELECT COALESCE(jsonb_object_agg(x.key,x.value),'{}'::jsonb) FROM jsonb_each(r.metadata) x
 WHERE x.key IN ('conditions','exceptions','restrictions','target_restrictions','scope_conditions',
 'recruitment_conditions','relation_field','use_for_anchor','confidence')))::text
FROM ${E} r WHERE r.from_year=2026 AND r.to_year=2027 AND r.lineage_button_link_allowed=true
 AND r.endpoint_status='both_current_offerings'
 AND (($1::integer=2026 AND r.from_pk=$2::text) OR ($1::integer=2027 AND r.to_pk=$2::text))
 AND EXISTS(SELECT 1 FROM ${G} a WHERE a.academic_year=r.from_year AND a.offering_pk=r.from_pk
 AND (a.metadata->'active_service') IS DISTINCT FROM 'false'::jsonb
 AND (a.metadata->'practical_required') IS DISTINCT FROM 'true'::jsonb)
 AND EXISTS(SELECT 1 FROM ${G} b WHERE b.academic_year=r.to_year AND b.offering_pk=r.to_pk
 AND (b.metadata->'active_service') IS DISTINCT FROM 'false'::jsonb
 AND (b.metadata->'practical_required') IS DISTINCT FROM 'true'::jsonb)
 ORDER BY r.from_pk COLLATE "C",r.to_pk COLLATE "C",r.relation_sha256 COLLATE "C" LIMIT 65`;

export interface GuideRuleSourceApproval {
  readonly version: string;
  readonly sourcePointerSha256: string;
  readonly metadataSha256: string;
  readonly expiresAtUtc: bigint;
  readonly guideCommands: Readonly<Record<string, { count: number; sha256: string }>>;
}
function unavailable(): never {
  throw new AccessError("current_catalog_unavailable", 503);
}
const object = (v: unknown): v is NativeObject =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function parsed(value: unknown, max = 65536): unknown {
  try {
    return sqlJsonText(value, max);
  } catch {
    return unavailable();
  }
}
/** Caller supplies an approved server-side fingerprint, never an untrusted request hash. */
export async function verifyGuideRuleSourceApproval(
  bytes: Uint8Array,
  expectedSha256: string,
  clock: RequestClockPort,
): Promise<GuideRuleSourceApproval> {
  if (!(bytes instanceof Uint8Array) || bytes.length > 16384 || !hash(expectedSha256)) {
    unavailable();
  }
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== expectedSha256) unavailable();
  let value: unknown;
  try {
    value = parsed(new TextDecoder("utf-8", { fatal: true }).decode(bytes), 16384);
  } catch {
    return unavailable();
  }
  const fields = [
    "format",
    "status",
    "version",
    "issued_at",
    "expires_at",
    "approval_reference_sha256",
    "source_pointer_sha256",
    "metadata_sha256",
    "guide_command_state",
    "engine_activation",
  ];
  if (
    !object(value) || Object.keys(value).length !== fields.length ||
    !fields.every((k) => Object.hasOwn(value, k)) ||
    value.format !== "jungsi.guide-rule-source-approval/v1" ||
    value.status !== "approved_internal_read_only" || value.engine_activation !== false ||
    typeof value.version !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.version) ||
    !hash(value.approval_reference_sha256) || !hash(value.source_pointer_sha256) ||
    !hash(value.metadata_sha256) || !object(value.guide_command_state)
  ) unavailable();
  const commands = value.guide_command_state;
  const approvedCommands: Record<string, { count: number; sha256: string }> = {};
  if (Object.keys(commands).length !== CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.length) unavailable();
  for (const name of CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS) {
    const item = commands[name];
    if (
      !object(item) || Object.keys(item).length !== 2 || !Object.hasOwn(item, "count") ||
      !Object.hasOwn(item, "sha256") || typeof item.count !== "number" ||
      !Number.isSafeInteger(item.count) || item.count < 0 || item.count > 64 || !hash(item.sha256)
    ) unavailable();
    approvedCommands[name] = Object.freeze({ count: item.count, sha256: item.sha256 });
  }
  let issued: bigint, expires: bigint;
  try {
    if (typeof value.issued_at !== "string" || typeof value.expires_at !== "string") throw 0;
    issued = utcInstant(value.issued_at);
    expires = utcInstant(value.expires_at);
  } catch {
    return unavailable();
  }
  if (issued! > clock.nowUtc() || expires! <= clock.nowUtc() || expires! <= issued!) unavailable();
  return Object.freeze({
    version: value.version,
    sourcePointerSha256: value.source_pointer_sha256,
    metadataSha256: value.metadata_sha256,
    expiresAtUtc: expires!,
    guideCommands: Object.freeze(approvedCommands),
  });
}
export class CurrentGuideRulePostgres implements GuideRuleReferencePort {
  constructor(
    private readonly sql: SupabaseSqlTransport,
    private readonly load: () => Promise<GuideRuleSourceApproval>,
    private readonly clock: RequestClockPort,
  ) {}
  private live(value: GuideRuleSourceApproval): void {
    if (
      !value || typeof value.expiresAtUtc !== "bigint" ||
      value.expiresAtUtc <= this.clock.nowUtc() ||
      !hash(value.sourcePointerSha256) || !hash(value.metadataSha256)
    ) unavailable();
  }
  private async commands(tx: NativeSqlTransaction, value: GuideRuleSourceApproval): Promise<void> {
    const rows = await tx.query(
      CURRENT_PUBLIC_GUIDE_COMMAND_SQL,
      CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((n) => value.guideCommands[n].count + 1),
    );
    if (rows.length !== CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.length) unavailable();
    for (let i = 0; i < rows.length; i++) {
      const name = CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS[i], expected = value.guideCommands[name];
      if (rows[i].length !== 2 || rows[i][0] !== name) unavailable();
      const headers = parsed(rows[i][1]);
      if (
        !Array.isArray(headers) || headers.length !== expected.count ||
        await nativeJsonSha256(headers) !== expected.sha256
      ) unavailable();
    }
  }
  async readCurrent(subjectId: string, input: GuideRuleQuery): Promise<GuideRuleSourceResult> {
    const query = guideRuleQuery(input.academicYear, input.offeringPk),
      approval = await this.load();
    this.live(approval);
    return await this.sql.read(subjectId, async (tx) => {
      // Reject a surrounding write frame: this port needs a dedicated read-only transaction.
      const isolation = await tx.query("SELECT current_setting('transaction_read_only')");
      if (isolation.length !== 1 || isolation[0].length !== 1 || isolation[0][0] !== "on") {
        unavailable();
      }
      // The pool interface promises read-only, not repeatable-read isolation. Recheck the
      // same bounded metadata and exact source reads before returning any selected value.
      const observed: {
        statement: string;
        parameters: readonly unknown[];
        rows: unknown[][];
      }[] = [];
      const read = async (
        statement: string,
        parameters: readonly unknown[],
      ): Promise<unknown[][]> => {
        const rows = await tx.query(statement, parameters);
        observed.push({ statement, parameters, rows });
        return rows;
      };
      const rows = await read(CURRENT_PUBLIC_METADATA_SQL, [
        JSON.stringify(GUIDE_RULE_METADATA_SEEDS),
      ]);
      if (rows.length < GUIDE_RULE_METADATA_SEEDS.length || rows.length > 128) unavailable();
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
      const metadata = rows.map((r) => {
        if (r.length !== names.length) unavailable();
        const m = Object.fromEntries(
          names.map((
            k,
            i,
          ) => [k, i === 5 || i === 12 ? r[i] === null ? null : parsed(r[i]) : r[i]]),
        );
        if (
          m.schema !== "jungsi_data_ingest" || !["r", "v"].includes(String(m.kind)) ||
          m.owner !== false || m.readable !== true || m.writable !== false ||
          m.anon_read !== false ||
          m.authenticated_read !== false ||
          m.kind === "r" && (m.rls !== true || m.force !== true) ||
          m.kind === "v" &&
            (!Array.isArray(m.reloptions) || !m.reloptions.includes("security_invoker=true"))
        ) unavailable();
        return m;
      });
      if (
        await nativeJsonSha256(metadata) !== approval.metadataSha256 ||
        GUIDE_RULE_METADATA_SEEDS.some((s) => !metadata.some((m) => m.relation === s.split(".")[1]))
      ) unavailable();
      await this.commands(tx, approval);
      const headers = await read(GUIDE_RULE_HEADER_SQL, [query.academicYear, query.offeringPk]);
      if (headers.length > 1 || headers.some((r) => r.length !== 1)) unavailable();
      const header = headers.length ? parsed(headers[0][0]) : null;
      if (
        header !== null && (!object(header) || header.academic_year !== query.academicYear ||
          header.offering_pk !== query.offeringPk || typeof header.release_id !== "string" ||
          header.release_id.length > 128 || !hash(header.rule_sha256) ||
          typeof header.school_id !== "string" || !/^[0-9]{3}$/.test(header.school_id) ||
          !hash(header.row_sha256))
      ) unavailable();
      let raw: NativeObject | null = null;
      if (object(header)) {
        const bindings = await read(GUIDE_RULE_NATIVE_BINDING_SQL, [
          header.school_id,
          query.academicYear,
          query.offeringPk,
        ]);
        if (bindings.length > 1 || bindings.some((r) => r.length !== 1)) unavailable();
        const binding = bindings.length ? parsed(bindings[0][0]) : null;
        if (
          binding !== null && (!object(binding) ||
            binding.base_rule_release_id !== header.release_id ||
            binding.derived_rule_sha256 !== header.rule_sha256 ||
            binding.derived_row_sha256 !== header.row_sha256 || !hash(binding.before_rule_sha256) ||
            typeof binding.value_id !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(binding.value_id))
        ) unavailable();
        const fields = [
          ...GUIDE_REFERENCE_FIELDS,
          "field_presence_types",
          "score_rule_id",
          "score_rule_status",
        ];
        const result = object(binding)
          ? await read(GUIDE_RULE_NATIVE_POINT_SQL, [
            binding.base_rule_release_id,
            binding.before_rule_sha256,
            header.school_id,
            query.academicYear,
            query.offeringPk,
            binding.derived_rule_sha256,
            binding.value_id,
            fields,
            [...GUIDE_REFERENCE_FIELDS],
          ])
          : await read(
            (header.release_id as string).startsWith("guide-native-minimum3:v4:")
              ? GUIDE_RULE_NEW_POINT_SQL
              : GUIDE_RULE_POINT_SQL,
            [
              header.release_id,
              header.rule_sha256,
              fields,
              [...GUIDE_REFERENCE_FIELDS],
            ],
          );
        if (result.length !== 1 || result[0].length !== 1) unavailable();
        const rule = parsed(result[0][0]);
        if (
          !object(rule) || rule.release_id !== header.release_id ||
          rule.rule_sha256 !== header.rule_sha256
        ) unavailable();
        raw = {
          ...rule,
          academic_year: header.academic_year,
          offering_pk: header.offering_pk,
          source: header.source,
        };
      }
      const links = raw === null || ![2026, 2027].includes(query.academicYear)
        ? []
        : await read(GUIDE_RULE_LINEAGE_SQL, [query.academicYear, query.offeringPk]);
      if (links.length > 64 || links.some((r) => r.length !== 1)) unavailable();
      const lineage = links.map((r) => {
        const v = parsed(r[0]);
        if (!object(v)) unavailable();
        return v;
      });
      for (const check of observed) {
        const finalRows = await tx.query(check.statement, check.parameters);
        if (
          finalRows.length !== check.rows.length ||
          await nativeJsonSha256(finalRows) !== await nativeJsonSha256(check.rows)
        ) unavailable();
      }
      await this.commands(tx, approval);
      this.live(approval);
      return Object.freeze({
        version: approval.version,
        sourcePointerSha256: approval.sourcePointerSha256,
        row: raw as NativeObject | null,
        lineage,
      });
    });
  }
}
