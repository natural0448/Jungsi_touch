/** Retained metadata-only SQL recipe. Separate parity tests bind it to the current public provider. */
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
export const CURRENT_PUBLIC_GUIDE_COMMAND_SQL = CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((
  name,
  i,
) =>
  `SELECT '${name}'::text AS relation,COALESCE((SELECT jsonb_agg(jsonb_build_object('command_id',x.command_id,'payload_sha256',x.payload_sha256,'status',x.status) ORDER BY x.command_id) FROM (SELECT command_id,payload_sha256,status FROM jungsi_data_ingest.${name} ORDER BY command_id LIMIT $${
    i + 1
  }::integer) x),'[]'::jsonb)::text AS commands`
).join(" UNION ALL ");
