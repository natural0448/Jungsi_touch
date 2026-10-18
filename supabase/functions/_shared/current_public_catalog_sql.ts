/** Existing app-role/current-view reads only. No schema/RPC/index/write or engine path. */
import { AccessError } from "./jungsi/application/access.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import { nativeJsonSha256, type NativeObject } from "./jungsi/domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "./jungsi/domain/native_json.ts";
import { utcInstant } from "./jungsi/domain/time.ts";
import type { SupabaseSqlTransport } from "./jungsi/infrastructure/transaction_sql.ts";
/** Same recursive catalog-only metadata recipe as the reviewed source; JSON is cast at the native boundary. */
const CURRENT_REVIEW_METADATA_SQL = `WITH RECURSIVE seeds(oid) AS (
 SELECT to_regclass(qualified_name) FROM unnest(ARRAY(SELECT value FROM jsonb_array_elements_text($1::text::jsonb))) AS s(qualified_name)
), closure(oid) AS (
 SELECT oid FROM seeds WHERE oid IS NOT NULL UNION
 SELECT d.refobjid FROM closure x JOIN pg_catalog.pg_rewrite rw ON rw.ev_class=x.oid
 JOIN pg_catalog.pg_depend d ON d.objid=rw.oid AND d.classid='pg_rewrite'::regclass AND d.refclassid='pg_class'::regclass
 JOIN pg_catalog.pg_class child ON child.oid=d.refobjid JOIN pg_catalog.pg_namespace ns ON ns.oid=child.relnamespace
 WHERE ns.nspname='jungsi_data_ingest' AND child.relkind IN ('r','v')
) SELECT ns.nspname AS schema,c.relname AS relation,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force,
 to_jsonb(c.reloptions) AS reloptions,c.relowner=r.oid AS owner,
 has_table_privilege(current_user,c.oid,'SELECT') AS readable,
 has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable,
 has_table_privilege('anon',c.oid,'SELECT') AS anon_read,has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_read,
 CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) ELSE NULL END AS definition,
 (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum)
  FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
 FROM closure x JOIN pg_catalog.pg_class c ON c.oid=x.oid JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
 JOIN pg_catalog.pg_roles r ON r.rolname=current_user ORDER BY ns.nspname,c.relname LIMIT 129`;
import {
  CURRENT_PUBLIC_OPERATIONS,
  type CurrentPublicCatalogPort,
  type CurrentPublicKeySelectionPort,
  type PublicCatalogKey,
  type PublicCatalogKind,
  type PublicCatalogPage,
  type PublicCatalogPublication,
  type PublicCatalogQuery,
  type PublicCatalogRecord,
  type PublicPreparedKeyPage,
} from "./current_public_catalog.ts";
export const CURRENT_PUBLIC_SOURCE_VIEWS = {
  admissions: "jungsi_data_ingest.admission_results_current",
  offerings: "jungsi_data_ingest.guide_offerings_native_minimum3_current_v4",
  relations: "jungsi_data_ingest.guide_relations_native_minimum3_current_v4",
} as const;
export const CURRENT_PUBLIC_METADATA_SQL =
  `SELECT m.schema::text,m.relation::text,m.kind::text,m.rls,m.force,m.reloptions::text,m.owner,m.readable,m.writable,m.anon_read,m.authenticated_read,m.definition,m.columns::text FROM (${CURRENT_REVIEW_METADATA_SQL}) m`;
export const CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS = [
  "guide_compact_commands_v1",
  "guide_compact_commands_v3",
  "guide_dentalminimum_commands_v1",
  "guide_field_commands_v1",
  "guide_native_minimum3_commands_v4",
  "guide_pairfield_commands_v1",
  "guide_scope_commands_v1",
  "guide_trifield_commands_v1",
] as const;
export const CURRENT_PUBLIC_METADATA_SEEDS = [
  ...Object.values(CURRENT_PUBLIC_SOURCE_VIEWS),
  "jungsi_data_ingest.admission_observation_commands",
  ...CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((x) => "jungsi_data_ingest." + x),
];
export interface PublicCatalogDescriptor {
  format: "jungsi.current-public-catalog-publication/v2";
  version: string;
  issued_at: string;
  expires_at: string;
  approval_reference_sha256: string;
  consumer_binding_sha256: string;
  metadata_sha256: string;
  operations: readonly string[];
  source_views: typeof CURRENT_PUBLIC_SOURCE_VIEWS;
  general_publication_allowed: true;
  nationwide_current: true;
  active_service_only: true;
  incomplete_metadata: "hold_per_observation";
  order: "academic_year_school_offering_metric_canonical_C";
  counts: "unknown";
  engine_activation: false;
  max_page_rows: 101;
  guide_command_state: Record<string, { count: number; sha256: string }>;
  key_index: { object_key: string; bytes: number; sha256: string };
  coverage_receipt_sha256: string;
  admission_head: { command_id: string; payload_sha256: string };
}
function fail(code = "current_catalog_unavailable"): never {
  throw new AccessError(code, 503);
}
const record = (x: unknown): x is NativeObject =>
  x !== null && typeof x === "object" && !Array.isArray(x) &&
  !(x instanceof JsonFloat);
const hash = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
export async function verifyPublicCatalogDescriptor(
  bytes: Uint8Array,
  expectedSha256: string,
  clock: RequestClockPort,
): Promise<
  { descriptor: PublicCatalogDescriptor; publication: PublicCatalogPublication }
> {
  if (
    !(bytes instanceof Uint8Array) || bytes.length > 16384 ||
    !hash(expectedSha256)
  ) fail("current_catalog_publication_unapproved");
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== expectedSha256) fail("current_catalog_publication_unapproved");
  let parsedDescriptor: unknown;
  try {
    parsedDescriptor = parseNativeJson(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    return fail("current_catalog_publication_unapproved");
  }
  if (!record(parsedDescriptor)) {
    return fail("current_catalog_publication_unapproved");
  }
  const d = parsedDescriptor as NativeObject;
  const fields = [
    "format",
    "version",
    "issued_at",
    "expires_at",
    "approval_reference_sha256",
    "consumer_binding_sha256",
    "metadata_sha256",
    "operations",
    "source_views",
    "general_publication_allowed",
    "nationwide_current",
    "active_service_only",
    "incomplete_metadata",
    "order",
    "counts",
    "engine_activation",
    "max_page_rows",
    "guide_command_state",
    "key_index",
    "coverage_receipt_sha256",
    "admission_head",
  ];
  if (
    !record(d) || Object.keys(d).length !== fields.length ||
    !fields.every((k) => Object.hasOwn(d, k)) ||
    d.format !== "jungsi.current-public-catalog-publication/v2" ||
    typeof d.version !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(d.version) ||
    !hash(d.approval_reference_sha256) || !hash(d.consumer_binding_sha256) ||
    !hash(d.metadata_sha256) || !Array.isArray(d.operations) ||
    d.operations.length !== 4 || new Set(d.operations).size !== 4 ||
    CURRENT_PUBLIC_OPERATIONS.some((x) => !(d.operations as unknown[]).includes(x)) ||
    !record(d.source_views) || Object.keys(d.source_views).length !== 3 ||
    Object.entries(CURRENT_PUBLIC_SOURCE_VIEWS).some(([k, v]) =>
      (d.source_views as NativeObject)[k] !== v
    ) || d.general_publication_allowed !== true ||
    d.nationwide_current !== true || d.active_service_only !== true ||
    d.incomplete_metadata !== "hold_per_observation" ||
    d.order !== "academic_year_school_offering_metric_canonical_C" ||
    d.counts !== "unknown" || d.engine_activation !== false ||
    d.max_page_rows !== 101
  ) fail("current_catalog_publication_unapproved");
  if (
    !record(d.guide_command_state) ||
    Object.keys(d.guide_command_state).length !==
      CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.length
  ) fail("current_catalog_publication_unapproved");
  for (const name of CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS) {
    const expected = (d.guide_command_state as NativeObject)[name];
    if (
      !record(expected) || Object.keys(expected).length !== 2 ||
      !Number.isSafeInteger(expected.count) || Number(expected.count) < 0 ||
      Number(expected.count) > 64 || !hash(expected.sha256)
    ) fail("current_catalog_publication_unapproved");
  }
  if (
    !record(d.key_index) || Object.keys(d.key_index).length !== 3 ||
    typeof d.key_index.object_key !== "string" || !d.key_index.object_key ||
    d.key_index.object_key.length > 512 ||
    d.key_index.object_key.split("/").some((p) =>
      !p || p === "." || p === ".." || !/^[-A-Za-z0-9_.]+$/.test(p)
    ) || !Number.isSafeInteger(d.key_index.bytes) ||
    Number(d.key_index.bytes) < 1 || Number(d.key_index.bytes) > 524288 ||
    !hash(d.key_index.sha256) || !hash(d.coverage_receipt_sha256) ||
    !record(d.admission_head) || Object.keys(d.admission_head).length !== 2 ||
    typeof d.admission_head.command_id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(d.admission_head.command_id) ||
    !hash(d.admission_head.payload_sha256)
  ) fail("current_catalog_publication_unapproved");
  let issued: bigint, expires: bigint;
  try {
    if (typeof d.issued_at !== "string" || typeof d.expires_at !== "string") {
      throw 0;
    }
    issued = utcInstant(d.issued_at);
    expires = utcInstant(d.expires_at);
  } catch {
    return fail("current_catalog_publication_unapproved");
  }
  const now = clock.nowUtc();
  if (issued! > now || expires! <= now || expires! <= issued!) {
    fail("current_catalog_publication_unapproved");
  }
  return {
    descriptor: d as unknown as PublicCatalogDescriptor,
    publication: {
      version: d.version as string,
      sha256: expectedSha256,
      expiresAtUtc: expires!,
    },
  };
}
const schema = "jungsi_data_ingest",
  A = CURRENT_PUBLIC_SOURCE_VIEWS.admissions,
  G = CURRENT_PUBLIC_SOURCE_VIEWS.offerings,
  R = CURRENT_PUBLIC_SOURCE_VIEWS.relations;
const C = (x: string) => `COALESCE(${x},'') COLLATE "C"`;
const offeringId = (alias: string) => `${alias}.offering_pk`;
const observationId = (alias: string) =>
  `('observation:'||encode(sha256(convert_to('current-public-observation|'||${alias}.academic_year::text||'|'||${alias}.canonical_result_id,'UTF8')),'hex'))`;
const metadata = (alias: string, keys: readonly string[]) =>
  `jsonb_build_object(${keys.map((k) => `'${k}',${alias}->'${k}'`).join(",")})`;
const guideMeta = (a: string) =>
  metadata(a + ".metadata", [
    "quota_stage",
    "source_url",
    "source_as_of",
    "deadline",
    "practical_required",
    "participation_conditions_status",
    "active_service",
    "campus",
    "wildcard_group",
  ]);
function guideWire(a: string, link = "'unrequested'::text"): string {
  return `jsonb_build_object('release_id',${a}.release_id,'academic_year',${a}.academic_year,'school_id',${a}.school_id,'offering_pk',${a}.offering_pk,'university_code',${a}.university_code,'university',${a}.university,'department',${a}.department,'track',${a}.track,'recruit_group',${a}.recruit_group,'location',${a}.location,'campus',${a}.metadata->'campus','wildcard_group',${a}.metadata->'wildcard_group','quota_value',${a}.quota_value,'quota_literal_state',${a}.quota_literal_state,'metadata',${
    guideMeta(a)
  },'active_service',${a}.metadata->'active_service','practical_required',${a}.metadata->'practical_required','source_kind','current_guide','recruitment_link_status',${link})`;
}
const admissionWire = (a: string) =>
  `jsonb_build_object('academic_year',${a}.academic_year,'school_id',${a}.school_id,'offering_pk',${a}.offering_pk,'university_code',${a}.university_code,'university',${a}.university,'department',${a}.department,'track',${a}.track,'recruit_group',${a}.recruit_group,'active_service',${a}.active_service,'canonical_result_id',${a}.canonical_result_id,'metric_kind',${a}.metric_kind,'statistic_label',${a}.statistic_label,'cohort',${a}.cohort,'metric_value_literal',${a}.metric_value_literal,'metric_value_json_type',${a}.metric_value_json_type,'metric_value_numeric',${a}.metric_value_numeric::text,'curation_fields',${
    metadata(a + ".curation_fields", [
      "metric_definition",
      "unit",
      "original_scale",
      "source_url",
      "source_as_of",
      "qualification_status",
      "publication_status",
    ])
  },'source_location',${metadata(a + ".source_location", ["source_url", "url", "source_as_of"])})`;
/** Bounded command PK inventories are compared against the separately approved publication.
 * No guide offering/head full digest or unindexed timestamp scan is performed. */
export const CURRENT_PUBLIC_GUIDE_COMMAND_SQL = CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((
  name,
  i,
) =>
  `SELECT '${name}'::text AS relation,COALESCE((SELECT jsonb_agg(jsonb_build_object('command_id',x.command_id,'payload_sha256',x.payload_sha256,'status',x.status) ORDER BY x.command_id) FROM (SELECT command_id,payload_sha256,status FROM jungsi_data_ingest.${name} ORDER BY command_id LIMIT $${
    i + 1
  }::integer) x),'[]'::jsonb)::text AS commands`
).join(" UNION ALL ");
const headCTE =
  `admission_head AS MATERIALIZED (SELECT command_id,payload_sha256,to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at FROM ${schema}.admission_observation_commands WHERE COALESCE((receipt->>'management_events')::integer,0)>0 ORDER BY recorded_at DESC,command_id DESC LIMIT 1),
source_head AS (SELECT jsonb_build_object('admission',(SELECT to_jsonb(h) FROM admission_head h)) AS wire)`;
const headSelect =
  `SELECT (SELECT wire FROM source_head)::text,to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),COALESCE((SELECT jsonb_agg(wire ORDER BY year,school COLLATE "C",offering COLLATE "C",metric COLLATE "C",tie COLLATE "C") FROM payload),'[]'::jsonb)::text`;
/** Light key projection of the pinned current/source recipes; no numeric/source body expansion. */
const currentHeader = (field: string, cast = "") =>
  `CASE WHEN o.core_patch ? '${field}' THEN (o.core_patch->>'${field}')${cast} WHEN h.core_patch ? '${field}' THEN (h.core_patch->>'${field}')${cast} ELSE s.${field} END`;
/** The curation branch supplies all core fields in the pinned source view. Read it once;
 * immutable source existence uses the existing (release_id,result_id) primary key. */
const currentKeyHeaderCTE =
  `public_plain_members AS MATERIALIZED (SELECT r.canonical_result_id,r.source_result_id,r.source_release_id FROM jungsi_data_ingest.admission_observation_registry r WHERE r.is_representative=true AND r.academic_year=$12::integer AND NOT EXISTS(SELECT 1 FROM jungsi_data_ingest.curation_overlays c WHERE c.result_id=r.source_result_id AND c.base_release_id=r.source_release_id AND c.release_id=r.source_curation_release_id)),public_registered_headers AS NOT MATERIALIZED (
 SELECT r.canonical_result_id,f.academic_year,f.school_id,f.university,f.department,f.metric_kind,f.offering_pk,f.recruit_group,f.active_service
 FROM jungsi_data_ingest.admission_observation_registry r JOIN jungsi_data_ingest.admission_results b ON b.result_id=r.source_result_id AND b.release_id=r.source_release_id
 JOIN jungsi_data_ingest.curation_overlays c ON c.result_id=r.source_result_id AND c.base_release_id=r.source_release_id AND c.release_id=r.source_curation_release_id
 CROSS JOIN LATERAL jsonb_to_record(c.after_core) f(academic_year integer,school_id text,university text,department text,metric_kind text,offering_pk text,recruit_group text,active_service boolean) WHERE r.is_representative=true AND r.academic_year=$12::integer
 UNION ALL
 SELECT r.canonical_result_id,e.academic_year,e.school_id,e.university,e.department,e.metric_kind,e.offering_pk,e.recruit_group,e.active_service
 FROM public_plain_members r CROSS JOIN LATERAL (SELECT e.academic_year,e.school_id,e.university,e.department,e.metric_kind,e.offering_pk,e.recruit_group,e.active_service FROM jungsi_data_ingest.admission_results_effective e WHERE e.result_id=r.source_result_id AND e.release_id=r.source_release_id AND e.academic_year=$12::integer OFFSET 0) e
),public_header_current AS NOT MATERIALIZED (SELECT s.canonical_result_id,s.academic_year,s.school_id,s.university,s.department,s.metric_kind,${
    currentHeader("offering_pk")
  } AS offering_pk,${currentHeader("recruit_group")} AS recruit_group,${
    currentHeader("active_service", "::boolean")
  } AS active_service
 FROM public_registered_headers s LEFT JOIN LATERAL (SELECT h.core_patch FROM jungsi_data_ingest.admission_observation_heads h WHERE h.canonical_result_id=s.canonical_result_id OFFSET 0) h ON true LEFT JOIN LATERAL (SELECT o.core_patch FROM jungsi_data_ingest.admission_observation_overrides o WHERE o.canonical_result_id=s.canonical_result_id OFFSET 0) o ON true)`;
/** Reuse the reviewed bounded-definition technique only after the final page keys. */
export function buildCurrentPublicPayloadSql(
  metadata: readonly Record<string, unknown>[],
  statement: string,
): string {
  if (!statement.includes("/*public-bounded-current*/")) return statement;
  const definition = (name: string) => {
    const row = metadata.find((m) =>
      m.schema === "jungsi_data_ingest" && m.relation === name && m.kind === "v"
    );
    if (!row || typeof row.definition !== "string") {
      fail("current_catalog_schema_unapproved");
    }
    const sql = (row.definition as string).trim().replace(/;$/, "");
    if (!/^SELECT\s/i.test(sql) || sql.includes(";")) {
      fail("current_catalog_schema_unapproved");
    }
    return sql;
  };
  const once = (sql: string, from: string, to: string) => {
    if (sql.split(from).length !== 2) fail("current_catalog_schema_unapproved");
    return sql.replace(from, () => to);
  };
  const effective = once(
    definition("admission_results_effective"),
    "jungsi_data_ingest.admission_results",
    "public_bounded_physical",
  );
  const source = once(
    once(
      definition("admission_results_source_current"),
      "jungsi_data_ingest.admission_observation_registry",
      "public_bounded_registry",
    ),
    "jungsi_data_ingest.admission_results_effective",
    "public_bounded_effective",
  );
  const current = once(
    once(
      definition("admission_results_current"),
      "jungsi_data_ingest.admission_results_source_current",
      "public_bounded_source",
    ),
    "jungsi_data_ingest.admission_observation_registry",
    "public_bounded_registry",
  );
  const prepared = statement.includes("v->>'sourceKind'");
  const ctes =
    `public_bounded_registry AS MATERIALIZED (SELECT r.* FROM page_keys k CROSS JOIN LATERAL (SELECT d.* FROM jungsi_data_ingest.admission_observation_registry d WHERE d.canonical_result_id=k.canonical_result_id AND d.is_representative=true ${
      prepared ? "AND k.source_kind='admission'" : ""
    } OFFSET 0) r),
 public_bounded_physical AS MATERIALIZED (SELECT b.* FROM public_bounded_registry d CROSS JOIN LATERAL (SELECT intake.* FROM jungsi_data_ingest.admission_results intake WHERE intake.release_id=d.source_release_id AND intake.result_id=d.source_result_id OFFSET 0) b),
 public_bounded_effective AS MATERIALIZED (${effective}),public_bounded_source AS MATERIALIZED (${source}),public_bounded_current AS MATERIALIZED (${current}),`;
  return once(statement, "/*public-bounded-current*/", ctes);
}
const guideColumns = (a: string) =>
  `${a}.release_id,${a}.academic_year,${a}.offering_pk,${a}.school_id,${a}.university_code,${a}.university,${a}.location,${a}.department,${a}.track,${a}.recruit_group,${a}.quota_value,${a}.quota_literal_state,${a}.row_sha256,${a}.anchor_2027_pks,${
    guideMeta(a)
  } AS metadata`;
const admissionColumns = (a: string) =>
  `${a}.academic_year,${a}.school_id,${a}.offering_pk,${a}.university_code,${a}.university,${a}.department,${a}.track,${a}.recruit_group,${a}.active_service,${a}.canonical_result_id,${a}.metric_kind,CASE WHEN ${a}.metric_value_json_type IN ('array','object') THEN NULL::text ELSE ${a}.metric_value_literal END AS metric_value_literal,${a}.metric_value_json_type,${a}.metric_value_numeric,${a}.statistic_label,${a}.cohort,${
    metadata(a + ".curation_fields", [
      "metric_definition",
      "unit",
      "original_scale",
      "source_url",
      "source_as_of",
      "qualification_status",
      "publication_status",
    ])
  } AS curation_fields,${
    metadata(a + ".source_location", ["source_url", "url", "source_as_of"])
  } AS source_location`;
const serviceGuide = (a: string) =>
  `(${a}.metadata->'active_service') IS DISTINCT FROM 'false'::jsonb AND (${a}.metadata->'practical_required') IS DISTINCT FROM 'true'::jsonb`;
const filters = (a: string) =>
  `($1::integer IS NULL OR ${a}.academic_year=$1::integer) AND ($2::text='' OR strpos(lower(COALESCE(${a}.university,'')),$2::text)>0) AND ($3::text='' OR strpos(lower(COALESCE(${a}.department,'')),$3::text)>0) AND ($5::text='' OR lower(COALESCE(${a}.recruit_group,''))=$5::text)`;
const after = (a: string, metric: string, tie: string) =>
  `($6::integer IS NULL OR (${a}.academic_year,${C(a + ".school_id")},${C(a + ".offering_pk")},${
    C(metric)
  },${
    C(tie)
  })>($6::integer,$7::text COLLATE "C",$8::text COLLATE "C",$9::text COLLATE "C",$10::text COLLATE "C"))`;
const historyOrder = (a: string) =>
  `${a}.academic_year,${C(a + ".school_id")},${C(a + ".offering_pk")},${C(a + ".metric_kind")},${
    C(a + ".canonical_result_id")
  }`;
/** Explicit light keys only; no original JSON body is materialized before the page. */
function historySql(region: boolean): string {
  const selected =
    `SELECT v.academic_year,v.school_id,v.offering_pk,v.metric_kind,v.canonical_result_id FROM public_header_current v WHERE v.academic_year=$12::integer AND v.active_service=true AND v.academic_year=ANY(ARRAY[2024,2025,2026]) AND ${
      filters("v")
    } AND ${after("v", "v.metric_kind", "v.canonical_result_id")}`;
  const keys = region
    ? `candidate_keys AS MATERIALIZED (${selected}),
 candidate_regions AS MATERIALIZED (SELECT g.academic_year,g.offering_pk,CASE WHEN min(g.location)=max(g.location) THEN min(g.location) END AS region FROM ${G} g JOIN (SELECT DISTINCT academic_year,offering_pk FROM candidate_keys WHERE offering_pk IS NOT NULL) k ON k.academic_year=g.academic_year AND k.offering_pk=g.offering_pk WHERE ${
      serviceGuide("g")
    } GROUP BY g.academic_year,g.offering_pk),
 page_keys AS MATERIALIZED (SELECT k.academic_year,k.school_id,k.offering_pk,k.metric_kind,k.canonical_result_id FROM candidate_keys k JOIN candidate_regions r ON r.academic_year=k.academic_year AND r.offering_pk=k.offering_pk WHERE lower(COALESCE(r.region,''))=$4::text ORDER BY ${
      historyOrder("k")
    } LIMIT $11::integer)`
    : `page_keys AS MATERIALIZED (${selected} AND $4::text='' ORDER BY ${
      historyOrder("v")
    } LIMIT $11::integer)`;
  return `WITH ${headCTE},${currentKeyHeaderCTE},${keys},/*public-bounded-current*/
 page_current AS MATERIALIZED (SELECT ${
    admissionColumns("v")
  },jsonb_build_array(k.academic_year,COALESCE(k.school_id,''),COALESCE(k.offering_pk,''),COALESCE(k.metric_kind,''),k.canonical_result_id) AS expected_key FROM page_keys k JOIN public_bounded_current v ON v.canonical_result_id=k.canonical_result_id AND v.academic_year=k.academic_year),
 page_guide_rows AS MATERIALIZED (SELECT ${
    guideColumns("g")
  } FROM (SELECT DISTINCT academic_year,offering_pk FROM page_keys WHERE offering_pk IS NOT NULL) k CROSS JOIN LATERAL (SELECT ${
    guideColumns("selected")
  } FROM ${G} selected WHERE selected.academic_year=k.academic_year AND selected.offering_pk=k.offering_pk OFFSET 0) g WHERE ${
    serviceGuide("g")
  }),
 page_guide AS MATERIALIZED (SELECT g.academic_year,g.offering_pk,CASE WHEN count(*)=1 THEN min((${
    guideWire("g")
  })::text)::jsonb ELSE jsonb_build_object('location',CASE WHEN min(g.location)=max(g.location) THEN min(g.location) END,'metadata','{}'::jsonb) END AS wire FROM page_guide_rows g GROUP BY g.academic_year,g.offering_pk),
 payload AS (SELECT p.academic_year AS year,COALESCE(p.school_id,'') AS school,COALESCE(p.offering_pk,'') AS offering,COALESCE(p.metric_kind,'') AS metric,p.canonical_result_id AS tie,jsonb_build_object('key',p.expected_key,'row',${
    admissionWire("p")
  },'guide',g.wire) AS wire FROM page_current p LEFT JOIN page_guide g ON g.academic_year=p.academic_year AND g.offering_pk=p.offering_pk) ${headSelect}`;
}
export const CURRENT_PUBLIC_HISTORY_SQL = historySql(false);
export const CURRENT_PUBLIC_HISTORY_REGION_SQL = historySql(true);
export const CURRENT_PUBLIC_OFFERINGS_SQL = `WITH ${headCTE},page_offerings AS MATERIALIZED (
 SELECT ${
  guideColumns("g")
} FROM ${G} g WHERE g.academic_year=ANY(ARRAY[2024,2025,2026,2027]) AND ${serviceGuide("g")} AND ${
  filters("g")
} AND ($4::text='' OR lower(COALESCE(g.location,''))=$4::text) AND ${
  after("g", "''::text", "g.release_id")
}
 ORDER BY g.academic_year,${C("g.school_id")},${
  C("g.offering_pk")
},g.release_id COLLATE "C" LIMIT $11::integer
),payload AS (SELECT g.academic_year AS year,COALESCE(g.school_id,'') AS school,g.offering_pk AS offering,''::text AS metric,g.release_id AS tie,
 jsonb_build_object('key',jsonb_build_array(g.academic_year,COALESCE(g.school_id,''),g.offering_pk,'',g.release_id),'row',${
  guideWire("g")
},'guide',${guideWire("g")}) AS wire FROM page_offerings g) ${headSelect}`;
/** Prepared keys are private metadata; every value and guide body is reread in one DB snapshot. */
const preparedKeysCTE = `page_keys AS MATERIALIZED (
 SELECT (v->'key'->>0)::integer AS academic_year,v->'key'->>1 AS school_id,v->'key'->>2 AS offering_pk,v->'key'->>3 AS metric_kind,v->'key'->>4 AS canonical_result_id,v->>'sourceKind' AS source_kind,v->>'nativeOfferingId' AS native_offering_id,v->>'expectedFingerprint' AS expected_fingerprint,v->'key' AS expected_key
 FROM jsonb_array_elements($1::text::jsonb) v
)`;
export const CURRENT_PUBLIC_HISTORY_BY_KEYS_SQL =
  `WITH ${headCTE},${preparedKeysCTE},/*public-bounded-current*/
 page_current AS MATERIALIZED (
 SELECT ${
    admissionColumns("v")
  },v.row_fingerprint,k.expected_key,k.native_offering_id,k.expected_fingerprint FROM page_keys k JOIN public_bounded_current v ON v.canonical_result_id=k.canonical_result_id AND v.academic_year=k.academic_year WHERE k.source_kind='admission' AND v.active_service=true
 ),page_guide_rows AS MATERIALIZED (SELECT ${
    guideColumns("g")
  } FROM (SELECT DISTINCT academic_year,offering_pk FROM page_keys WHERE offering_pk IS NOT NULL AND offering_pk<>'') k CROSS JOIN LATERAL (SELECT ${
    guideColumns("selected")
  } FROM ${G} selected WHERE selected.academic_year=k.academic_year AND selected.offering_pk=k.offering_pk OFFSET 0) g),
 page_guide AS MATERIALIZED (SELECT g.academic_year,g.offering_pk,CASE WHEN count(*)=1 THEN jsonb_agg(${
    guideWire("g")
  })->0 ELSE NULL END AS wire,bool_or(g.metadata->'practical_required'='true'::jsonb OR g.metadata->'active_service'='false'::jsonb) AS service_excluded FROM page_guide_rows g GROUP BY g.academic_year,g.offering_pk),
 selected_guides AS MATERIALIZED (SELECT ${
    guideColumns("g")
  },k.expected_key,k.expected_fingerprint FROM page_keys k CROSS JOIN LATERAL (SELECT ${
    guideColumns("selected")
  } FROM ${G} selected WHERE k.source_kind='guide' AND selected.academic_year=k.academic_year AND selected.offering_pk=k.offering_pk AND selected.release_id=k.canonical_result_id OFFSET 0) g WHERE ${
    serviceGuide("g")
  }),
 payload AS (
 SELECT p.academic_year AS year,COALESCE(p.school_id,'') AS school,COALESCE(p.offering_pk,'') AS offering,COALESCE(p.metric_kind,'') AS metric,p.canonical_result_id AS tie,
 jsonb_build_object('key',p.expected_key,'row',${
    admissionWire("p")
  }||jsonb_build_object('row_fingerprint',p.row_fingerprint),'guide',g.wire) AS wire FROM page_current p LEFT JOIN page_guide g ON g.academic_year=p.academic_year AND g.offering_pk=p.offering_pk WHERE g.service_excluded IS DISTINCT FROM true
 UNION ALL SELECT g.academic_year,COALESCE(g.school_id,''),g.offering_pk,''::text,g.release_id,jsonb_build_object('key',g.expected_key,'row',${
    guideWire("g")
  }||jsonb_build_object('row_fingerprint',g.row_sha256),'guide',${
    guideWire("g")
  }) FROM selected_guides g
 ) ${headSelect}`;
/** One bulk lookup, at most 100 requested IDs. Verified lineage alone can resolve to 2027. */
export const CURRENT_PUBLIC_LOOKUP_SQL =
  `WITH RECURSIVE ${headCTE},ids AS MATERIALIZED (SELECT value AS id FROM jsonb_array_elements_text($1::text::jsonb)),original AS MATERIALIZED (
 SELECT ${guideColumns("g")} FROM ${G} g JOIN ids i ON ${offeringId("g")}=i.id WHERE ${
    serviceGuide("g")
  }
),walk(original_year,original_pk,year,pk,depth) AS (
 SELECT g.academic_year,g.offering_pk,g.academic_year,g.offering_pk,0 FROM original g
 UNION ALL SELECT w.original_year,w.original_pk,r.to_year,r.to_pk,w.depth+1 FROM walk w JOIN ${R} r ON r.from_year=w.year AND r.from_pk=w.pk WHERE $2::boolean AND r.lineage_button_link_allowed=true AND r.to_year>r.from_year AND r.to_year<=2027 AND w.depth<3
),targets AS MATERIALIZED (SELECT w.original_year,w.original_pk,array_agg(DISTINCT w.pk ORDER BY w.pk) AS pks FROM walk w JOIN original g ON g.academic_year=w.original_year AND g.offering_pk=w.original_pk WHERE w.year=2027 AND (w.original_year=2027 OR (jsonb_typeof(g.anchor_2027_pks)='array' AND g.anchor_2027_pks ? w.pk)) GROUP BY w.original_year,w.original_pk),selected AS MATERIALIZED (
 SELECT ${guideColumns("g")},${
    offeringId("g")
  } AS requested_id,CASE WHEN NOT $2::boolean THEN 'unrequested' WHEN g.academic_year=2027 THEN 'verified' WHEN cardinality(t.pks)=1 AND n.offering_pk IS NOT NULL THEN 'verified' ELSE 'unqualified' END AS link_status,
 CASE WHEN $2::boolean AND g.academic_year<>2027 AND cardinality(t.pks)=1 AND n.offering_pk IS NOT NULL THEN to_jsonb(n) ELSE to_jsonb(g) END AS selected_guide
 FROM original g LEFT JOIN targets t ON t.original_year=g.academic_year AND t.original_pk=g.offering_pk LEFT JOIN ${G} n ON $2::boolean AND cardinality(t.pks)=1 AND n.academic_year=2027 AND n.offering_pk=t.pks[1] AND ${
    serviceGuide("n")
  }
),selected_guide AS MATERIALIZED (SELECT ${
    guideColumns("g")
  },s.link_status,s.requested_id FROM selected s CROSS JOIN LATERAL jsonb_populate_record(NULL::${schema}.guide_offerings,s.selected_guide) g),
missing_current AS MATERIALIZED (SELECT ${
    admissionColumns("v")
  } FROM ${A} v JOIN ids i ON i.id=CASE WHEN v.offering_pk IS NULL THEN ${
    observationId("v")
  } ELSE ${
    offeringId("v")
  } END WHERE v.active_service=true AND NOT EXISTS(SELECT 1 FROM ${G} g WHERE ${
    offeringId("g")
  }=i.id) ORDER BY v.academic_year,${C("v.school_id")},${
    C("v.offering_pk")
  },v.canonical_result_id COLLATE "C" LIMIT 101),
payload AS (
 SELECT g.academic_year AS year,COALESCE(g.school_id,'') AS school,g.offering_pk AS offering,''::text AS metric,g.release_id AS tie,jsonb_build_object('key',jsonb_build_array(g.academic_year,COALESCE(g.school_id,''),g.offering_pk,'',g.release_id),'row',${
    guideWire("g", "g.link_status")
  }||jsonb_build_object('lookup_requested_id',g.requested_id),'guide',${
    guideWire("g", "g.link_status")
  }) AS wire FROM selected_guide g
 UNION ALL SELECT v.academic_year,COALESCE(v.school_id,''),COALESCE(v.offering_pk,''),COALESCE(v.metric_kind,''),v.canonical_result_id,jsonb_build_object('key',jsonb_build_array(v.academic_year,COALESCE(v.school_id,''),COALESCE(v.offering_pk,''),COALESCE(v.metric_kind,''),v.canonical_result_id),'row',${
    admissionWire("v")
  },'guide',NULL) FROM missing_current v
) ${headSelect}`;
export const CURRENT_PUBLIC_PREPARED_RECRUITMENT_SQL = CURRENT_PUBLIC_LOOKUP_SQL
  .replace(
    "ids AS MATERIALIZED (SELECT value AS id FROM jsonb_array_elements_text($1::text::jsonb)),original",
    `${preparedKeysCTE},/*public-bounded-current*/ids AS MATERIALIZED (SELECT native_offering_id AS id,academic_year,offering_pk FROM page_keys),original`,
  )
  .replace(
    `FROM ${G} g JOIN ids i ON ${offeringId("g")}=i.id`,
    `FROM ids i CROSS JOIN LATERAL (SELECT ${
      guideColumns("selected")
    } FROM ${G} selected WHERE selected.academic_year=i.academic_year AND selected.offering_pk=i.offering_pk OFFSET 0) g`,
  )
  .replace(
    `FROM ${A} v JOIN ids i`,
    `FROM public_bounded_current v JOIN ids i`,
  );
function parsed(value: unknown, max = 4_194_304): unknown {
  if (
    typeof value !== "string" || new TextEncoder().encode(value).length > max
  ) fail("current_catalog_page_invalid");
  try {
    return parseNativeJson(value as string);
  } catch {
    return fail("current_catalog_page_invalid");
  }
}
export class CurrentPublicCatalogSql implements CurrentPublicCatalogPort {
  constructor(
    private readonly sql: SupabaseSqlTransport,
    private readonly load: () => Promise<
      {
        descriptor: PublicCatalogDescriptor;
        publication: PublicCatalogPublication;
      }
    >,
    private readonly clock: RequestClockPort,
    private readonly keys: CurrentPublicKeySelectionPort,
  ) {}
  async publication(): Promise<PublicCatalogPublication> {
    const { publication } = await this.load();
    if (this.clock.nowUtc() >= publication.expiresAtUtc) {
      fail("current_catalog_publication_unapproved");
    }
    return publication;
  }
  private async read(
    subject: string,
    statement: string,
    parameters: readonly unknown[],
    resumed = false,
    prepared?: PublicPreparedKeyPage,
    comparePreparedRows = true,
  ): Promise<PublicCatalogPage> {
    const { descriptor, publication } = await this.load();
    await this.publication();
    return await this.sql.read(subject, async (tx) => {
      const rows = await tx.query(CURRENT_PUBLIC_METADATA_SQL, [
        JSON.stringify(CURRENT_PUBLIC_METADATA_SEEDS),
      ]);
      if (!rows.length || rows.length > 128) {
        fail("current_catalog_schema_unapproved");
      }
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
      const metadata = rows.map((row) => {
        if (row.length !== 13) fail("current_catalog_schema_unapproved");
        const v = Object.fromEntries(
          names.map((k, i) => [
            k,
            i === 5 || i === 12 ? row[i] === null ? null : parsed(row[i]) : row[i],
          ]),
        );
        if (
          v.schema !== "jungsi_data_ingest" || v.owner !== false ||
          v.readable !== true || v.writable !== false ||
          v.anon_read !== false || v.authenticated_read !== false ||
          v.kind === "r" && (v.rls !== true || v.force !== true) ||
          v.kind === "v" &&
            (!Array.isArray(v.reloptions) ||
              !v.reloptions.includes("security_invoker=true"))
        ) fail("current_catalog_schema_unapproved");
        return v;
      });
      const changed = (): never => {
        throw new AccessError(
          resumed ? "cursor_version_mismatch" : "current_catalog_state_unapproved",
          resumed ? 409 : 503,
        );
      };
      if (await nativeJsonSha256(metadata) !== descriptor.metadata_sha256) {
        changed();
      }
      for (const name of CURRENT_PUBLIC_METADATA_SEEDS) {
        const [, rel] = name.split(".");
        if (!metadata.some((m) => m.relation === rel)) {
          fail("current_catalog_schema_unapproved");
        }
      }
      const commandRows = await tx.query(
        CURRENT_PUBLIC_GUIDE_COMMAND_SQL,
        CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((name) =>
          descriptor.guide_command_state[name].count + 1
        ),
      );
      if (
        commandRows.length !== CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.length
      ) fail("current_catalog_schema_unapproved");
      for (let i = 0; i < commandRows.length; i++) {
        const row = commandRows[i],
          name = CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS[i],
          expected = descriptor.guide_command_state[name];
        if (row.length !== 2 || row[0] !== name) {
          fail("current_catalog_schema_unapproved");
        }
        const headers = parsed(row[1], 65536);
        if (!Array.isArray(headers) || headers.length > 65) {
          return fail("current_catalog_schema_unapproved");
        }
        if (
          headers.length !== expected.count ||
          await nativeJsonSha256(headers) !== expected.sha256
        ) changed();
      }
      const result = await tx.query(
        buildCurrentPublicPayloadSql(metadata, statement),
        parameters,
      );
      if (result.length !== 1 || result[0].length !== 3) {
        fail("current_catalog_page_invalid");
      }
      const [headText, asOfText, body] = result[0],
        head = parsed(headText, 16384),
        items = parsed(body);
      if (
        !record(head) || !record(head.admission) || !Array.isArray(items) ||
        items.length > 101 || typeof asOfText !== "string"
      ) fail("current_catalog_page_invalid");
      if (
        !record(head.admission) ||
        head.admission.command_id !== descriptor.admission_head.command_id ||
        head.admission.payload_sha256 !==
          descriptor.admission_head.payload_sha256
      ) changed();
      if (prepared) {
        if (
          prepared.indexSha256 !== descriptor.key_index.sha256 ||
          prepared.coverage !== "all_eligible_current_db_observations_at_head" ||
          prepared.admissionHead.command_id !==
            descriptor.admission_head.command_id ||
          prepared.admissionHead.payload_sha256 !==
            descriptor.admission_head.payload_sha256
        ) changed();
        if (comparePreparedRows) {
          const expected = new Map(
            prepared.keys.map((k) => [JSON.stringify(k.key), k]),
          );
          if (
            expected.size !== prepared.keys.length ||
            items.length !== expected.size
          ) changed();
          for (const raw of items) {
            if (!record(raw) || !Array.isArray(raw.key) || !record(raw.row)) {
              fail("current_catalog_page_invalid");
            }
            const selected = expected.get(JSON.stringify(raw.key));
            if (
              !selected ||
              selected.expectedFingerprint !== null &&
                raw.row.row_fingerprint !== selected.expectedFingerprint
            ) changed();
            expected.delete(JSON.stringify(raw.key));
          }
          if (expected.size) changed();
        }
      }
      let asOf: bigint;
      try {
        asOf = utcInstant(asOfText as string);
      } catch {
        return fail("current_catalog_page_invalid");
      }
      const page = {
        version: publication.version,
        head: await nativeJsonSha256({
          metadata: descriptor.metadata_sha256,
          guide_commands: descriptor.guide_command_state,
          head,
        }),
        asOfUtc: asOf!,
        rows: items as unknown as PublicCatalogRecord[],
      };
      await this.publication();
      return page;
    });
  }
  async search(
    subject: string,
    kind: PublicCatalogKind,
    q: PublicCatalogQuery,
    after: PublicCatalogKey | null,
  ): Promise<PublicCatalogPage> {
    if (
      !["history", "offerings"].includes(kind) ||
      !Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > 100
    ) fail("current_catalog_page_invalid");
    const selected = await this.keys.select(kind, q, after);
    if (selected.keys.length > q.limit + 1) {
      fail("current_catalog_page_invalid");
    }
    const page = await this.read(
      subject,
      CURRENT_PUBLIC_HISTORY_BY_KEYS_SQL,
      [JSON.stringify(selected.keys)],
      after !== null,
      selected,
    );
    return { ...page, nextAfter: selected.nextAfter };
  }
  async lookup(
    subject: string,
    ids: readonly string[],
    recruitment: boolean,
  ): Promise<PublicCatalogPage> {
    if (
      !Array.isArray(ids) || !ids.length || ids.length > 100 ||
      new Set(ids).size !== ids.length ||
      ids.some((x) => typeof x !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x)) ||
      typeof recruitment !== "boolean"
    ) fail("current_catalog_page_invalid");
    const selected = await this.keys.resolve(ids, recruitment);
    if (selected.keys.length > ids.length) fail("current_catalog_page_invalid");
    if (!recruitment) {
      return await this.read(
        subject,
        CURRENT_PUBLIC_HISTORY_BY_KEYS_SQL,
        [JSON.stringify(selected.keys)],
        false,
        selected,
      );
    }
    return await this.read(
      subject,
      CURRENT_PUBLIC_PREPARED_RECRUITMENT_SQL,
      [JSON.stringify(selected.keys), true],
      false,
      selected,
      false,
    );
  }
}
