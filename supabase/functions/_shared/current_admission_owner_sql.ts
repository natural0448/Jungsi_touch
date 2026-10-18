/** Owner current review: bounded current keys joined to the pinned percentile view semantics. */
import { DisplayError } from "./official_history_display.ts";
import type { Row } from "./official_history_display.ts";
import { buildCurrentReviewLivePayloadSql } from "./current_admission_review_sql.ts";
import { OWNER_PERCENTILE_FIELDS } from "./current_admission_owner.ts";
const schema = "jungsi_data_ingest";
const fail = () => new DisplayError("current_review_scope_unverified");
function once(sql: string, from: string, to: string): string {
  if (sql.split(from).length !== 2) throw fail();
  return sql.replace(from, () => to);
}
export function buildOwnerCurrentReviewPayloadSql(metadata: Row[]): string {
  const row = metadata.find((r) =>
    r.schema === schema &&
    r.relation === "admission_result_percentiles_current" && r.kind === "v"
  );
  if (!row || typeof row.definition !== "string") throw fail();
  let definition = row.definition.trim().replace(/;$/, "");
  if (!/^SELECT\s/i.test(definition) || definition.includes(";")) throw fail();
  for (
    const [relation, bounded] of [
      ["admission_results_current", "bounded_percentile_current"],
      ["admission_percentile_heads_v1", "bounded_percentile_heads"],
      ["admission_percentile_reviews_v1", "bounded_application_reviews"],
      ["admission_percentile_members_v1", "bounded_percentile_members"],
      ["admission_percentile_values_v1", "bounded_percentile_values"],
      ["admission_percentile_methods_v1", "bounded_percentile_methods"],
    ]
  ) definition = once(definition, schema + "." + relation, bounded);
  let sql = buildCurrentReviewLivePayloadSql(metadata);
  sql = once(
    sql,
    "WHERE r.is_representative=true AND",
    "WHERE r.is_representative=true AND ($15::text='' OR r.canonical_result_id=$15::text) AND",
  );
  sql = once(
    sql,
    "AND v.active_service=true AND v.academic_year=ANY",
    "AND ($14::text='all' OR ($14::text='active' AND v.active_service=true) OR ($14::text='inactive' AND v.active_service=false)) AND ($16::text='' OR v.offering_pk=$16::text) AND v.academic_year=ANY",
  );
  const wire = "jsonb_build_object(" +
    OWNER_PERCENTILE_FIELDS.map((k) =>
      "'" + k + "',v." + k +
      ([
          "metric_value_numeric",
          "upper_cumulative_percent",
          "strictly_above_percent",
          "tie_share_percent",
          "source_definition_ref",
        ].includes(k)
        ? "::text"
        : "")
    ).join(",") + ")";
  const ctes = `), bounded_percentile_heads AS MATERIALIZED (
 SELECT h.* FROM ${schema}.admission_percentile_heads_v1 h WHERE h.head_name='current'
), percentile_head AS MATERIALIZED (
 SELECT jsonb_build_object('release_id',h.release_id,'updated_at',to_char(h.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'command_id',r.command_id,'command_sha256',r.command_sha256,'manifest_sha256',r.manifest_sha256) AS wire
 FROM bounded_percentile_heads h JOIN ${schema}.admission_percentile_releases_v1 r ON r.release_id=h.release_id
), bounded_percentile_current AS MATERIALIZED (
 SELECT c.* FROM page_current p JOIN bounded_current c ON c.canonical_result_id=p.canonical_result_id
), bounded_application_reviews AS MATERIALIZED (
 SELECT r.* FROM page_current p CROSS JOIN bounded_percentile_heads h
 CROSS JOIN LATERAL (SELECT x.* FROM ${schema}.admission_percentile_reviews_v1 x
  WHERE x.release_id=h.release_id AND x.canonical_result_id=p.canonical_result_id AND x.item='actual_cutoff_percentile_application' OFFSET 0) r
), bounded_percentile_members AS MATERIALIZED (
 SELECT l.* FROM page_current p CROSS JOIN bounded_percentile_heads h
 CROSS JOIN LATERAL (SELECT x.* FROM ${schema}.admission_percentile_members_v1 x
  WHERE x.release_id=h.release_id AND x.canonical_result_id=p.canonical_result_id OFFSET 0) l
), bounded_percentile_values AS MATERIALIZED (
 SELECT v.* FROM ${schema}.admission_percentile_values_v1 v
 WHERE v.value_id=ANY(ARRAY(SELECT l.value_id FROM bounded_percentile_members l))
), bounded_percentile_methods AS MATERIALIZED (
 SELECT m.* FROM ${schema}.admission_percentile_methods_v1 m
 WHERE m.method_id=ANY(ARRAY(SELECT v.method_id FROM bounded_percentile_values v))
), bounded_percentile_variants AS MATERIALIZED (${definition}
), percentile_variants AS (
 SELECT p.canonical_result_id,(SELECT jsonb_agg(x.wire ORDER BY x.method_id COLLATE "C",x.reason_code COLLATE "C") FROM (
  SELECT ${wire} AS wire,v.method_id,v.reason_code FROM bounded_percentile_variants v
  WHERE v.canonical_result_id=p.canonical_result_id ORDER BY v.method_id COLLATE "C",v.reason_code COLLATE "C" LIMIT 17) x) AS wire
 FROM page_current p
), percentile_reviews AS (
 SELECT p.canonical_result_id,(SELECT jsonb_agg(jsonb_build_object('item',x.item,'ox',x.ox,'reason_code',x.reason_code,'evidence_ref',x.evidence_ref) ORDER BY x.item COLLATE "C") FROM (
  SELECT r.item,r.ox,r.reason_code,r.evidence_ref FROM ${schema}.admission_percentile_reviews_v1 r CROSS JOIN bounded_percentile_heads h
  WHERE r.release_id=h.release_id AND r.canonical_result_id=p.canonical_result_id ORDER BY r.item COLLATE "C" LIMIT 17) x) AS wire
 FROM page_current p
), payload AS (`;
  sql = once(sql, "), payload AS (", ctes);
  sql = once(
    sql,
    "'population',COALESCE(l.population_wire,'[]'::jsonb)) AS observation",
    "'population',COALESCE(l.population_wire,'[]'::jsonb),'percentiles',COALESCE(v.wire,'[]'::jsonb),'percentile_reviews',COALESCE(r.wire,'[]'::jsonb)) AS observation",
  );
  sql = once(
    sql,
    "LEFT JOIN population l ON l.result_id=p.canonical_result_id",
    "LEFT JOIN population l ON l.result_id=p.canonical_result_id LEFT JOIN percentile_variants v ON v.canonical_result_id=p.canonical_result_id LEFT JOIN percentile_reviews r ON r.canonical_result_id=p.canonical_result_id",
  );
  sql = once(
    sql,
    "NULL::text AS school_count,",
    "NULL::text AS school_count,(SELECT wire FROM percentile_head) AS percentile_head,(SELECT count(*)::integer FROM scan_keys) AS scanned_rows,",
  );
  return sql;
}
