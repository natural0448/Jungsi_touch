/** Synthetic server-reference and native SQL boundary cases; no credentials or actual data. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  guideRuleQuery,
  GuideRuleReferenceService,
} from "../../supabase/functions/_shared/jungsi/application/guide_rule_reference.ts";
import type { ProfessionalPolicy } from "../../supabase/functions/_shared/jungsi/application/professional_policy.ts";
import type { ProfessionalScope } from "../../supabase/functions/_shared/jungsi/application/professional_ports.ts";
import {
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { parseNativeJson } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { utcInstant } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import {
  CurrentGuideRulePostgres,
  GUIDE_RULE_HEADER_SQL,
  GUIDE_RULE_LINEAGE_SQL,
  GUIDE_RULE_METADATA_SEEDS,
  GUIDE_RULE_NATIVE_BINDING_SQL,
  GUIDE_RULE_NATIVE_POINT_SQL,
  GUIDE_RULE_POINT_SQL,
  verifyGuideRuleSourceApproval,
} from "../../supabase/functions/_shared/jungsi/infrastructure/current_guide_rule_postgres.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import {
  CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS,
  CURRENT_PUBLIC_GUIDE_COMMAND_SQL,
  CURRENT_PUBLIC_METADATA_SQL,
} from "../../supabase/functions/_shared/jungsi/infrastructure/guide_metadata_sql.ts";

function assert(v: unknown, reason = "assertion_failed"): asserts v {
  if (!v) throw new Error(reason);
}
function equal(a: unknown, b: unknown): void {
  assert(nativeJsonText(a, true) === nativeJsonText(b, true));
}
async function denied(
  run: () => Promise<unknown>,
  code = "current_catalog_unavailable",
  http = 503,
) {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal([error.code, error.http], [code, http]);
}
const NOW = utcInstant("2026-10-23T00:00:00Z"), HASH = "a".repeat(64);
const SUBJECT = "00000000-0000-0000-0000-000000000001", PK = "synthetic-offering-27";
function rawRow(): NativeObject {
  return parseNativeJson(
    `{"academic_year":2027,"offering_pk":"${PK}","release_id":"synthetic-guide-v1","rule_sha256":"${HASH}","engine_approved":false,
   "definition":{"korean_ratio":12.0000000000000000001,"math_ratio":0,"english_ratio":null,"inquiry_subject_count":9007199254740993123,
   "english_grade_points":{"1":"0.0000","2":"-0.1250000000000000001"},"score_rule_id":"synthetic-rule-v1","score_rule_status":"partially_qualified",
   "field_presence_types":{"korean_ratio":"str","math_ratio":"int","english_ratio":"NoneType","history_ratio":"missing","inquiry_subject_count":"int"}},
   "evidence":{"column_export_information":{"korean_ratio":{"status":"pending_metadata","source_url":"https://official.synthetic.test/guide","source_path":"C:/private/guide.pdf"}}},
   "source":{"source_url":"https://official.synthetic.test/guide","source_year":2027,"source_as_of":null}}`,
  ) as NativeObject;
}
function rawLink(): NativeObject {
  return {
    from_year: 2026,
    from_pk: "synthetic-offering-26",
    to_year: 2027,
    to_pk: PK,
    kind: "identity",
    relation_type: "approved",
    relation_detail_type: null,
    relation_sha256: "b".repeat(64),
    constraints: { conditions: "synthetic target restriction" },
    lineage_button_link_allowed: true,
    endpoint_status: "both_current_offerings",
  };
}
function serviceFixture() {
  let row: NativeObject | null = rawRow(), links = [rawLink()], reads = 0, authorityChecks = 0;
  let deniedAccess = false, expireAfterRead = false;
  const scope = { authority: { user: { subjectId: SUBJECT } }, student: {} } as ProfessionalScope;
  const policy = {
    assertStudent(a: unknown, s: unknown, operation: string) {
      equal([a, s], [scope.authority, scope.student]);
      equal(operation, "pro.report.read");
      authorityChecks++;
      if (deniedAccess) throw new AccessError("professional_student_not_found", 404);
    },
  } as unknown as ProfessionalPolicy;
  const service = new GuideRuleReferenceService(
    {
      async readCurrent(subjectId, query) {
        await Promise.resolve();
        equal([subjectId, query], [SUBJECT, { academicYear: 2027, offeringPk: PK }]);
        reads++;
        if (expireAfterRead) deniedAccess = true;
        return {
          version: "synthetic-reference-v1",
          sourcePointerSha256: HASH,
          row,
          lineage: links,
        };
      },
    },
    { nowUtc: () => NOW },
    policy,
  );
  return {
    service,
    scope,
    setRow(v: NativeObject | null) {
      row = v;
    },
    setLinks(v: NativeObject[]) {
      links = v;
    },
    deny() {
      deniedAccess = true;
    },
    expireAfterRead() {
      expireAfterRead = true;
    },
    reads: () => reads,
    authorityChecks: () => authorityChecks,
  };
}
Deno.test("guide reference preserves exact decimal, large integer, grade string and actual zero", async () => {
  const f = serviceFixture(),
    result = await f.service.read(f.scope, 2027, PK),
    fields = result.fields as NativeObject;
  const value = (name: string) => (fields[name] as NativeObject).value;
  equal(value("korean_ratio"), (rawRow().definition as NativeObject).korean_ratio);
  equal(value("math_ratio"), 0);
  equal(value("inquiry_subject_count"), 9007199254740993123n);
  equal(value("english_grade_points"), { "1": "0.0000", "2": "-0.1250000000000000001" });
  equal([result.status, result.engine_approved, result.engine_activation, f.authorityChecks()], [
    "collected_reference",
    false,
    false,
    2,
  ]);
});
Deno.test("guide reference distinguishes absent from present null and preserves qualification", async () => {
  const f = serviceFixture(),
    result = await f.service.read(f.scope, 2027, PK),
    fields = result.fields as NativeObject;
  const absent = fields.history_ratio as NativeObject,
    nullable = fields.english_ratio as NativeObject;
  equal([absent.present, Object.hasOwn(absent, "value"), nullable.present, nullable.value], [
    false,
    false,
    true,
    null,
  ]);
  equal(result.qualification_status, "partially_qualified");
  equal((fields.korean_ratio as NativeObject).qualification, {
    status: "pending_metadata",
    source_url: "https://official.synthetic.test/guide",
  });
});
Deno.test("guide reference preserves field uncertainty and source census without claiming verification", async () => {
  const f = serviceFixture(), row = rawRow();
  (row.evidence as NativeObject).field_uncertainties = [{
    field: "math_ratio",
    status: "pending",
    reason: "synthetic_source_pending",
  }];
  (row.evidence as NativeObject).canonical_rule_status = "collected_partial";
  (row.evidence as NativeObject).original_source_census_complete = false;
  ((row.evidence as NativeObject).column_export_information as NativeObject).math_ratio = {
    unit: "%",
    method: "synthetic_same_year_rule",
    original_text: "synthetic official condition",
  };
  f.setRow(row);
  const dto = await f.service.read(f.scope, 2027, PK);
  const field = (dto.fields as NativeObject).math_ratio as NativeObject;
  equal(field.source_uncertainties, [{ status: "pending", reason: "synthetic_source_pending" }]);
  equal(field.verification_status, "pending_independent_qualification");
  equal(field.qualification, {
    unit: "%",
    method: "synthetic_same_year_rule",
    original_text: "synthetic official condition",
  });
  equal((dto.source_qualification as NativeObject).original_source_census_complete, false);
});
Deno.test("guide reference withholds a value with unsafe required uncertainty conditions", async () => {
  const f = serviceFixture(), row = rawRow();
  (row.evidence as NativeObject).field_uncertainties = [{
    field: "math_ratio",
    status: "pending",
    conditions: "C:/private/source.pdf",
  }];
  f.setRow(row);
  const field = ((await f.service.read(f.scope, 2027, PK)).fields as NativeObject)
    .math_ratio as NativeObject;
  equal(field.projection_status, "withheld");
  equal(Object.hasOwn(field, "value"), false);
});
for (
  const [name, value] of [["canonical_rule_status", "C:/private/source.pdf"], [
    "original_source_census_complete",
    0,
  ]] as const
) {
  Deno.test("guide reference rejects unsafe source qualification " + name, async () => {
    const f = serviceFixture(), row = rawRow();
    (row.evidence as NativeObject)[name] = value;
    f.setRow(row);
    await denied(() => f.service.read(f.scope, 2027, PK));
  });
}
Deno.test("guide reference rejects tenant authorization before data access", async () => {
  const f = serviceFixture();
  f.deny();
  await denied(() => f.service.read(f.scope, 2027, PK), "professional_student_not_found", 404);
  equal(f.reads(), 0);
});
for (
  const [year, key] of [[true, PK], [2023, PK], [2028, PK], [2027, "../other"], [2027, 10], [
    2027,
    "a';SELECT",
  ]]
) {
  Deno.test(
    "guide reference rejects unbounded query " + String(year) + " " + String(key),
    async () => {
      const f = serviceFixture();
      await denied(() => f.service.read(f.scope, year, key), "invalid_request", 422);
      equal(f.reads(), 0);
    },
  );
}
Deno.test("guide reference missing exact row stays pending", async () => {
  const f = serviceFixture();
  f.setRow(null);
  const result = await f.service.read(f.scope, 2027, PK);
  equal([result.status, result.missing_reason, Object.hasOwn(result, "fields")], [
    "pending",
    "guide_rule_not_available",
    false,
  ]);
});
for (const field of ["academic_year", "offering_pk", "engine_approved"]) {
  Deno.test("guide reference rejects source mismatch " + field, async () => {
    const f = serviceFixture(), row = rawRow();
    row[field] = field === "academic_year" ? 2026 : field === "engine_approved" ? true : "other";
    f.setRow(row);
    await denied(() => f.service.read(f.scope, 2027, PK));
  });
}
Deno.test("guide reference withholds unsafe nested field without fabricated null or rewritten value", async () => {
  const f = serviceFixture(), row = rawRow();
  (row.definition as NativeObject).korean_ratio = { source_path: "C:/private" };
  f.setRow(row);
  const result = await f.service.read(f.scope, 2027, PK);
  const field = (result.fields as NativeObject).korean_ratio as NativeObject;
  equal([field.present, field.projection_status, Object.hasOwn(field, "value")], [
    true,
    "withheld",
    false,
  ]);
});
for (
  const change of ([{ lineage_button_link_allowed: false }, { to_pk: "other" }, {
    endpoint_status: "missing",
  }] as NativeObject[])
) {
  Deno.test("guide reference refuses inferred lineage " + Object.keys(change)[0], async () => {
    const f = serviceFixture();
    f.setLinks([{ ...rawLink(), ...change }]);
    await denied(() => f.service.read(f.scope, 2027, PK));
  });
}
async function sqlFixture() {
  let now = NOW, commandReads = 0, pointReads = 0, activeReadOnly = true;
  let metadataReads = 0, headerReads = 0, bindingReads = 0, lineageReads = 0;
  let failure = "", resultRows = 1;
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
  const metadata = GUIDE_RULE_METADATA_SEEDS.map((name) => name.split(".")[1]).sort().map((
    relation,
  ) => ({
    schema: "jungsi_data_ingest",
    relation,
    kind: relation.includes("current") ? "v" : "r",
    rls: true,
    force: true,
    reloptions: relation.includes("current") ? ["security_invoker=true"] : null,
    owner: false,
    readable: true,
    writable: false,
    anon_read: false,
    authenticated_read: false,
    definition: relation.includes("current") ? "SELECT synthetic_metadata_only" : null,
    columns: [],
  }));
  const commands = Object.fromEntries(
    await Promise.all(
      CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map(async (
        name,
      ) => [name, { count: 0, sha256: await nativeJsonSha256([]) }]),
    ),
  );
  const clock = { nowUtc: () => now };
  const doc: NativeObject = {
    format: "jungsi.guide-rule-source-approval/v1",
    status: "approved_internal_read_only",
    version: "synthetic-source-v1",
    issued_at: "2026-10-22T00:00:00Z",
    expires_at: "2026-10-24T00:00:00Z",
    approval_reference_sha256: HASH,
    source_pointer_sha256: HASH,
    metadata_sha256: await nativeJsonSha256(metadata),
    guide_command_state: commands,
    engine_activation: false,
  };
  async function approved() {
    const bytes = new TextEncoder().encode(nativeJsonText(doc));
    const sha = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
    return await verifyGuideRuleSourceApproval(bytes, sha, clock);
  }
  const pool: NativeSqlPool = {
    async transaction(readOnly, work) {
      equal(readOnly, true);
      return await work({
        async query(sql, parameters = []) {
          await Promise.resolve();
          calls.push({ sql, parameters });
          if (sql === RUNTIME_ROLE_SQL) {
            return [["jungsi_backend_app", false, false, "on", "on", false, false, false, "UTC"]];
          }
          if (sql === "SELECT current_setting('transaction_read_only')") {
            return [[activeReadOnly ? "on" : "off"]];
          }
          if (sql === CURRENT_PUBLIC_METADATA_SQL) {
            metadataReads++;
            return metadata.map((
              m,
            ) => [
              m.schema,
              m.relation,
              m.kind,
              m.rls,
              m.force,
              m.reloptions === null ? null : nativeJsonText(m.reloptions),
              m.owner,
              failure === "unreadable" || failure === "metadata_acl_after" && metadataReads > 1
                ? false
                : m.readable,
              m.writable,
              m.anon_read,
              m.authenticated_read,
              failure === "metadata_definition_after" && metadataReads > 1 && m.definition !== null
                ? m.definition + "_changed"
                : m.definition,
              nativeJsonText(m.columns),
            ]);
          }
          if (sql === CURRENT_PUBLIC_GUIDE_COMMAND_SQL) {
            commandReads++;
            return CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((
              n,
              i,
            ) => [
              n,
              failure === "changed_commands" && commandReads > 1 && i === 0 ? "[{}]" : "[]",
            ]);
          }
          if (sql === GUIDE_RULE_HEADER_SQL) {
            headerReads++;
            equal(parameters, [2027, PK]);
            const r = rawRow();
            return Array.from(
              {
                length: failure === "missing_header" ||
                    failure === "header_appeared_after" && headerReads === 1
                  ? 0
                  : failure === "duplicate_header"
                  ? 2
                  : 1,
              },
              () => [
                nativeJsonText({
                  academic_year: 2027,
                  offering_pk: PK,
                  school_id: "999",
                  row_sha256: failure === "header_changed_after" && headerReads > 1
                    ? "c".repeat(64)
                    : HASH,
                  release_id: r.release_id,
                  rule_sha256: r.rule_sha256,
                  source: r.source,
                }),
              ],
            );
          }
          if (sql === GUIDE_RULE_NATIVE_BINDING_SQL) {
            bindingReads++;
            equal(parameters, ["999", 2027, PK]);
            if (!failure.startsWith("native_")) return [];
            if (
              failure === "native_disappeared_after" && bindingReads > 1 ||
              failure === "native_appeared_after" && bindingReads === 1
            ) return [];
            return Array.from(
              { length: failure === "native_duplicate" ? 2 : 1 },
              () => [nativeJsonText({
                base_rule_release_id: "synthetic-guide-v1",
                before_rule_sha256: "b".repeat(64),
                derived_rule_sha256: failure === "native_hash_changed" ? "c".repeat(64) : HASH,
                derived_row_sha256: failure === "native_row_changed" ? "c".repeat(64) : HASH,
                value_id: "synthetic-value-v1",
              })],
            );
          }
          if (sql === GUIDE_RULE_NATIVE_POINT_SQL) {
            pointReads++;
            equal(parameters.slice(0, 7), [
              "synthetic-guide-v1",
              "b".repeat(64),
              "999",
              2027,
              PK,
              HASH,
              "synthetic-value-v1",
            ]);
            return [[nativeJsonText(rawRow())]];
          }
          if (sql === GUIDE_RULE_POINT_SQL) {
            pointReads++;
            equal(parameters.slice(0, 2), ["synthetic-guide-v1", HASH]);
            if (failure === "query_error") {
              throw new Error("SYNTHETIC_INTERNAL_DIAGNOSTIC_MUST_NOT_ESCAPE");
            }
            const rule = rawRow();
            if (failure === "rule_hash_mismatch") rule.rule_sha256 = "b".repeat(64);
            if (failure === "rule_changed_after" && pointReads > 1) {
              (rule.definition as NativeObject).korean_ratio = 99;
            }
            return Array.from({ length: resultRows }, () => [nativeJsonText(rule)]);
          }
          if (sql === GUIDE_RULE_LINEAGE_SQL) {
            lineageReads++;
            if (failure === "expired_after_read") {
              now = utcInstant("2026-10-25T00:00:00Z");
            }
            return Array.from(
              { length: failure === "lineage_overflow" ? 65 : 1 },
              () => [nativeJsonText({
                ...rawLink(),
                ...(failure === "lineage_changed_after" && lineageReads > 1
                  ? { constraints: { conditions: ["changed synthetic condition"] } }
                  : {}),
              })],
            );
          }
          return [];
        },
      });
    },
    close() {
      return Promise.resolve();
    },
  };
  const source = new CurrentGuideRulePostgres(new SupabaseSqlTransport(pool), approved, clock);
  return {
    source,
    calls,
    doc,
    clock,
    approved,
    fail(v: string) {
      failure = v;
    },
    rows(v: number) {
      resultRows = v;
    },
    writeFrame() {
      activeReadOnly = false;
    },
    pointReads: () => pointReads,
  };
}
Deno.test("guide SQL uses existing app role read-only frame and exact key parameters", async () => {
  const f = await sqlFixture(),
    result = await f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK));
  equal([result.row?.offering_pk, result.lineage.length, f.pointReads()], [PK, 1, 2]);
  assert(f.calls.every((c) => !/^\s*(INSERT|UPDATE|DELETE|DROP|GRANT|TRUNCATE)\b/.test(c.sql)));
  equal(f.calls.filter((c) => c.sql === CURRENT_PUBLIC_GUIDE_COMMAND_SQL).length, 2);
  for (const sql of [CURRENT_PUBLIC_METADATA_SQL, GUIDE_RULE_HEADER_SQL, GUIDE_RULE_LINEAGE_SQL]) {
    equal(f.calls.filter((c) => c.sql === sql).length, 2);
  }
});
for (
  const failure of [
    "metadata_acl_after",
    "metadata_definition_after",
    "header_changed_after",
    "header_appeared_after",
    "native_disappeared_after",
    "native_appeared_after",
    "rule_changed_after",
    "lineage_changed_after",
  ]
) {
  Deno.test("guide SQL rejects source drift with unchanged command state " + failure, async () => {
    const f = await sqlFixture();
    f.fail(failure);
    await denied(() => f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK)));
  });
}
Deno.test("guide SQL resolves native overlay before the concrete previous-rule point read", async () => {
  const f = await sqlFixture();
  f.fail("native_present");
  const result = await f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK));
  equal(result.row?.rule_sha256, HASH);
  equal(f.calls.filter((x) => x.sql === GUIDE_RULE_POINT_SQL).length, 0);
});
for (const failure of ["native_duplicate", "native_hash_changed", "native_row_changed"]) {
  Deno.test("guide SQL rejects current native overlay mismatch " + failure, async () => {
    const f = await sqlFixture();
    f.fail(failure);
    await denied(() => f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK)));
    equal(f.pointReads(), 0);
  });
}
for (
  const failure of ["unreadable", "changed_commands", "expired_after_read", "lineage_overflow"]
) {
  Deno.test("guide SQL fails closed for " + failure, async () => {
    const f = await sqlFixture();
    f.fail(failure);
    await denied(() => f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK)));
  });
}
Deno.test("guide SQL wraps raw driver errors", async () => {
  const f = await sqlFixture();
  f.fail("query_error");
  await denied(
    () => f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK)),
    "storage_unavailable",
  );
});
Deno.test("guide SQL refuses duplicate exact rows", async () => {
  const f = await sqlFixture();
  f.rows(2);
  await denied(() => f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK)));
});
Deno.test("guide SQL refuses ambient write transaction", async () => {
  const f = await sqlFixture();
  f.writeFrame();
  await denied(() => f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK)));
  equal(f.pointReads(), 0);
});
Deno.test("guide source approval rejects unapproved or engine-activating documents before SQL", async () => {
  const f = await sqlFixture();
  f.doc.engine_activation = true;
  await denied(() => f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK)));
  equal(f.calls.length, 0);
});
Deno.test("guide source approval requires exact fingerprint", async () => {
  const f = await sqlFixture(), bytes = new TextEncoder().encode(nativeJsonText(f.doc));
  await denied(() => verifyGuideRuleSourceApproval(bytes, "b".repeat(64), f.clock));
});

Deno.test("guide reference preserves approved lineage restrictions without generating comparisons", async () => {
  const f = serviceFixture(), result = await f.service.read(f.scope, 2027, PK);
  equal((result.approved_lineage as NativeObject[])[0].constraints, {
    conditions: "synthetic target restriction",
  });
});
Deno.test("guide reference refuses unsafe lineage restrictions instead of dropping conditions", async () => {
  const f = serviceFixture();
  f.setLinks([{ ...rawLink(), constraints: { conditions: { source_path: "C:/private" } } }]);
  await denied(() => f.service.read(f.scope, 2027, PK));
});
for (const value of ["근거 C:/private/guide.pdf", { distribution: [1, 2] }]) {
  Deno.test("guide reference withholds embedded private field " + typeof value, async () => {
    const f = serviceFixture(), row = rawRow();
    (row.definition as NativeObject).math_ratio = value;
    f.setRow(row);
    const result = await f.service.read(f.scope, 2027, PK);
    const field = (result.fields as NativeObject).math_ratio as NativeObject;
    equal([field.present, field.projection_status, Object.hasOwn(field, "value")], [
      true,
      "withheld",
      false,
    ]);
  });
}
Deno.test("guide reference rechecks existing student authority after asynchronous source read", async () => {
  const f = serviceFixture();
  f.expireAfterRead();
  await denied(() => f.service.read(f.scope, 2027, PK), "professional_student_not_found", 404);
  equal([f.authorityChecks(), f.reads()], [2, 1]);
});
Deno.test("guide source approval malformed UTF8 remains a safe metadata rejection", async () => {
  const bytes = new Uint8Array([255]), f = await sqlFixture();
  const sha = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
  await denied(() => verifyGuideRuleSourceApproval(bytes, sha, f.clock));
});

for (const key of ["conditions", "exceptions", "original_label"]) {
  Deno.test(
    "guide reference withholds value when required qualifier is unsafe " + key,
    async () => {
      const f = serviceFixture(), r = rawRow();
      ((r.evidence as NativeObject).column_export_information as NativeObject).math_ratio = {
        status: "verified_official",
        [key]: { source_path: "C:/SYNTHETIC/private" },
      };
      f.setRow(r);
      const result = await f.service.read(f.scope, 2027, PK);
      const field = (result.fields as NativeObject).math_ratio as NativeObject;
      equal([
        field.present,
        field.projection_status,
        Object.hasOwn(field, "value"),
        field.missing_reason,
      ], [true, "withheld", false, "unsafe_required_qualification"]);
    },
  );
}
for (const field of ["original_field_type", "release_id", "rule_id", "qualification_status"]) {
  for (
    const [kind, value] of [["path", "C:/SYNTHETIC/private"], [
      "dsn",
      "postgresql://synthetic.invalid/db",
    ], ["bearer", "Bearer SYNTHETIC_DO_NOT_USE"]]
  ) {
    Deno.test("guide reference rejects private metadata " + field + " " + kind, async () => {
      const f = serviceFixture(), r = rawRow(), definition = r.definition as NativeObject;
      if (field === "original_field_type") {
        (definition.field_presence_types as NativeObject).math_ratio = value;
      } else if (field === "release_id") r.release_id = value;
      else definition[field === "rule_id" ? "score_rule_id" : "score_rule_status"] = value;
      f.setRow(r);
      await denied(() => f.service.read(f.scope, 2027, PK));
    });
  }
}
for (const failure of ["duplicate_header", "rule_hash_mismatch"]) {
  Deno.test("guide SQL refuses changed exact binding " + failure, async () => {
    const f = await sqlFixture();
    f.fail(failure);
    await denied(() => f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK)));
  });
}
Deno.test("guide SQL missing year-PK header never selects a historical rule", async () => {
  const f = await sqlFixture();
  f.fail("missing_header");
  const result = await f.source.readCurrent(SUBJECT, guideRuleQuery(2027, PK));
  equal([result.row, f.pointReads(), result.lineage.length], [null, 0, 0]);
});
