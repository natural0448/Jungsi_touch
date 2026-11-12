/** REVIEW_ONLY. Ports must independently authenticate the issuer and current
 * reference, source/head, part, row, literal, projection and scope. No IO here.
 * Compact UTF-8 JSON compatibility is limited to checked string-valued cells.
 */
import { nativeJsonSha256 } from "../domain/json_value.ts";
import { parseNativeJson } from "../domain/native_json.ts";
import { nativeValueSha256 } from "./recruitment_final_qualification.ts";
// This codec mirrors the unchanged qualification file pinned below. Actual loaded
// code identity must be independently verified by the issuer before activation.
const QUALIFICATION_SOURCE_SHA256 =
  "0481232414ef418dae02e26ae5a4a30708f199904136671e3ba16ec2c078ca40";
async function serviceCellEnvelopeSha(cell: Obj): Promise<string> {
  return await nativeJsonSha256({
    codec: "jungsi.p1-recruitment-prior-cell-native-json/v1",
    value_json_type: "string",
    value_runtime_type: "string",
    cell,
  });
}
type Obj = Record<string, unknown>;
type Pins = Readonly<
  {
    approved_reference_sha256: string;
    approved_reference_schema: string;
    current_source_head_sha256: string;
    current_p1_manifest_sha256: string;
    approved_scope_sha256: string;
    authority_sha256: string;
  }
>;
type Selector = Readonly<{ academic_year: number; school_id: string; offering_pk: string }>;
const HASH = /^[a-f0-9]{64}$/,
  CID = /^(?:observation|admission):[a-f0-9]{64}$/,
  ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENCODING = "SHA256 compact sorted-key UTF-8 JSON; scalar native types preserved";
const PROJECTION_CODEC = "sql_numeric_integer_canonical_decimal/v1";
const PIN = [
  "approved_reference_sha256",
  "approved_reference_schema",
  "current_source_head_sha256",
  "current_p1_manifest_sha256",
  "approved_scope_sha256",
  "authority_sha256",
] as const;
const SEL = ["academic_year", "school_id", "offering_pk"] as const;
const READ = [
  "academic_year",
  "school_id",
  "offering_pk",
  "admission_track",
  "recruit_group",
  "p1_part_id",
  "p1_part_sha256",
  "p1_row_1based",
  "existing_canonical_result_id",
  "identity_variant_index",
  "previous_cell",
  "metric_value_json_type",
  "metric_value_literal",
  "numeric_projection",
  "raw_source_row_sha256",
] as const;
const CELL = [
  "value",
  "unit",
  "status",
  "reason_code",
  "source_url",
  "source_as_of",
  "statistic_label",
  "cohort",
  "source_context",
  "stage",
] as const;
const PROOF = [
  "disposition",
  "subject_sha256",
  "authority_sha256",
  "approved_reference_sha256",
  "current_source_head_sha256",
  "current_p1_manifest_sha256",
  "approved_scope_sha256",
  "current_p1_part_sha256",
  "previous_cell_binding",
  "part_bytes_verified",
  "same_snapshot_verified",
  "source_row_verified",
  "metric_literal_verified",
  "numeric_projection_verified",
  "fingerprint_codec_verified",
  "approved_request_scope_sha256",
  "approved_request_scope_count",
  "request_scope_binding",
  "source_metric_binding",
  "source_production_allowed",
  "source_cohort_sha256",
  "source_cohort_binding",
  "source_announced_groups",
  "source_announced_groups_binding",
  "target_membership_sha256",
  "target_membership_binding",
  "target_cell_group_sha256",
  "target_cell_selection",
  "target_cell_selected_observation_id",
] as const;
const SCOPE_AUTH_PROOF = [
  "disposition",
  "authority_sha256",
  "approved_reference_sha256",
  "current_source_head_sha256",
  "current_p1_manifest_sha256",
  "approved_scope_sha256",
  "approved_request_scope_sha256",
  "approved_request_scope_count",
  "request_scope_binding",
] as const;
class BindingError extends Error {}
function need(v: unknown, code: string): asserts v {
  if (!v) throw new BindingError(code);
}
function rec(v: unknown, keys: readonly string[]): Obj {
  need(v !== null && typeof v === "object" && !Array.isArray(v), "SHAPE");
  const proto = Object.getPrototypeOf(v);
  need(proto === null || proto === Object.prototype, "SHAPE");
  const all = Reflect.ownKeys(v), out: Obj = {};
  need(
    all.length === keys.length && all.every((k) => typeof k === "string" && keys.includes(k)),
    "KEYS",
  );
  for (const k of all) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    need(d && d.enumerable && "value" in d, "PROPERTY");
    Object.defineProperty(out, k, { value: d.value, enumerable: true });
  }
  return Object.freeze(out);
}
function text(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 4096) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = v.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function hash(v: unknown): v is string {
  return typeof v === "string" && HASH.test(v);
}
function id(v: unknown): v is string {
  return typeof v === "string" && ID.test(v);
}
function cellSnapshot(raw: unknown): Obj {
  const c = rec(raw, CELL);
  need(text(c.value), "UNSUPPORTED_CELL_TYPE");
  for (
    const k of ["unit", "reason_code", "source_url", "source_as_of", "statistic_label", "cohort"]
  ) need(c[k] === null || text(c[k]), "UNSUPPORTED_CELL_TYPE");
  need(
    [
      "verified_official",
      "pending_metadata",
      "pending_value_type",
      "pending_value_missing",
      "not_published",
    ].includes(c.status as string) &&
      ["initial", "carryover", "final", "unspecified"].includes(c.stage as string),
    "CELL_STATE",
  );
  let context: Obj | null = null;
  if (c.source_context !== null) {
    context = rec(c.source_context, ["observation_id", "identity_variant_index", "scope_status"]);
    need(
      typeof context.observation_id === "string" && CID.test(context.observation_id),
      "CELL_CONTEXT",
    );
    need(
      Number.isSafeInteger(context.identity_variant_index) &&
        Number(context.identity_variant_index) >= 0 &&
        Number(context.identity_variant_index) <= 15 &&
        ["source_consistent", "review_pending"].includes(context.scope_status as string),
      "CELL_CONTEXT",
    );
  }
  return Object.freeze({ ...c, source_context: context });
}
function copyBytes(v: unknown): Uint8Array<ArrayBuffer> {
  const proto = Object.getPrototypeOf(Uint8Array.prototype),
    tag = Object.getOwnPropertyDescriptor(proto, Symbol.toStringTag)?.get,
    length = Object.getOwnPropertyDescriptor(proto, "byteLength")?.get;
  need(tag && length && Reflect.apply(tag, v, []) === "Uint8Array", "REFERENCE_BYTES");
  const n = Reflect.apply(length, v, []);
  need(Number.isSafeInteger(n) && n > 0 && n <= 262144, "REFERENCE_BYTES");
  const out = new Uint8Array(n);
  Uint8Array.prototype.set.call(out, v as Uint8Array);
  return out;
}
async function sha(b: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}
function object(v: unknown): Obj {
  need(v !== null && typeof v === "object" && !Array.isArray(v), "REFERENCE_SHAPE");
  const p = Object.getPrototypeOf(v);
  need(p === null || p === Object.prototype, "REFERENCE_SHAPE");
  return v as Obj;
}

type RequestScope = Readonly<{
  codec: string;
  approved_reference_sha256: string;
  current_source_head_sha256: string;
  current_p1_manifest_sha256: string;
  approved_scope_sha256: string;
  qualification_source_sha256: string;
  selectors: readonly Selector[];
  request_scope_sha256: string;
  request_scope_count: number;
}>;
type ChunkMeta = Readonly<
  {
    chunk_index: number;
    selector_count: number;
    include_reference: boolean;
    max_authorization_calls: 0 | 1;
    max_read_calls: 1;
    max_verify_calls: 1;
  }
>;
export interface TrustedCellEvidenceBatchPort {
  assertLive(pins: Pins): Promise<void>;
  /** Must wrap the full callback with the existing shared budget, including actual costs. */
  executeWithSharedBudget(pins: Pins, meta: ChunkMeta, work: () => Promise<void>): Promise<void>;
  /** Independently authorize the entire exact selector set before the first read. */
  authorizeRequestScope(pins: Pins, requestScope: RequestScope): Promise<unknown>;
  readTrustedSnapshotBatch(
    pins: Pins,
    selectors: readonly Selector[],
    includeReference: boolean,
    requestScope: RequestScope,
  ): Promise<unknown>;
  /** Before reading, the trusted read port must enforce the independently approved exact request scope.
   * The issuer must independently authorize the complete request selector set and count,
   * not merely echo its caller-supplied hash; each returned proof binds that authorization.
   */
  verifyBindingsBatch(
    pins: Pins,
    requestScope: RequestScope,
    subjects: readonly Obj[],
  ): Promise<unknown>;
}
function dense(raw: unknown, max: number): unknown[] {
  need(Array.isArray(raw), "ARRAY");
  const len = Object.getOwnPropertyDescriptor(raw, "length"), keys = Reflect.ownKeys(raw);
  need(
    len && "value" in len && Number.isSafeInteger(len.value) && len.value >= 0 &&
      len.value <= max && keys.length === len.value + 1,
    "ARRAY",
  );
  const out: unknown[] = [];
  for (let i = 0; i < len.value; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    need(d && d.enumerable && "value" in d, "ARRAY");
    out.push(d.value);
  }
  return out;
}
function sourceGroupSet(raw: unknown): readonly string[] {
  const values = dense(raw, 16);
  need(
    values.length > 0 && values.every((v) =>
      text(v) && v.length > 0 && v.length <= 1024 &&
      ![...v].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
    ) && new Set(values).size === values.length,
    "ISSUER_SOURCE_GROUPS",
  );
  return Object.freeze(values as string[]);
}
function key(s: Obj): string {
  return JSON.stringify([s.academic_year, s.offering_pk]);
}
function status(s: Obj, reason: string): Obj {
  return Object.freeze({
    academic_year: s.academic_year,
    school_id: s.school_id,
    offering_pk: s.offering_pk,
    action: "HOLD",
    reason_code: reason,
  });
}
function batchHold(reason: string): Obj {
  return Object.freeze({ action: "HOLD_ALL", reason_code: reason, publication_ready: false });
}
export async function bindP1QuotaFingerprintBatch(
  rawPins: unknown,
  rawSelectors: unknown,
  port: TrustedCellEvidenceBatchPort,
): Promise<Obj> {
  try {
    const p = rec(rawPins, PIN);
    need(
      [
        "approved_reference_sha256",
        "current_source_head_sha256",
        "current_p1_manifest_sha256",
        "approved_scope_sha256",
        "authority_sha256",
      ].every((k) => hash(p[k])) && typeof p.approved_reference_schema === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/.test(p.approved_reference_schema),
      "PINS",
    );
    const selectors = dense(rawSelectors, 2048).map((x) => rec(x, SEL));
    need(selectors.length > 0, "SELECTOR");
    const seen = new Set<string>();
    for (const s of selectors) {
      need(
        Number.isSafeInteger(s.academic_year) &&
          [2024, 2025, 2026].includes(Number(s.academic_year)) && id(s.school_id) &&
          id(s.offering_pk),
        "SELECTOR",
      );
      need(!seen.has(key(s)), "DUPLICATE_SELECTOR");
      seen.add(key(s));
    }
    need(
      port && typeof port.assertLive === "function" &&
        typeof port.executeWithSharedBudget === "function" &&
        typeof port.authorizeRequestScope === "function" &&
        typeof port.readTrustedSnapshotBatch === "function" &&
        typeof port.verifyBindingsBatch === "function",
      "TRUSTED_PORT",
    );
    const pins = p as unknown as Pins,
      live = port.assertLive.bind(port),
      budget = port.executeWithSharedBudget.bind(port),
      authorize = port.authorizeRequestScope.bind(port),
      read = port.readTrustedSnapshotBatch.bind(port),
      verify = port.verifyBindingsBatch.bind(port);
    let referenceIndex: Map<string, Obj[]> | null = null;
    let requestScope: RequestScope | null = null;
    let independentlyAuthorizedScope: string | null = null;
    let referenceTargetCount = 0;
    let referenceCoverage = "SUBSET_OR_DIFFERENT";
    const results: Obj[] = [];
    for (let offset = 0; offset < selectors.length; offset += 100) {
      const chunk = Object.freeze(
          selectors.slice(offset, offset + 100),
        ) as unknown as readonly Selector[],
        include = offset === 0;
      const meta = Object.freeze({
        chunk_index: offset / 100,
        selector_count: chunk.length,
        include_reference: include,
        max_authorization_calls: include ? 1 as const : 0 as const,
        max_read_calls: 1 as const,
        max_verify_calls: 1 as const,
      });
      let starts = 0, finished = false, chunkResults: Obj[] = [];
      const budgetResult = await budget(pins, meta, async () => {
        starts++;
        need(starts === 1, "BUDGET_PROTOCOL");
        need(await live(pins) === undefined, "PORT_PROTOCOL");
        if (include) {
          const ordered = selectors.map((s) =>
            Object.freeze({
              academic_year: s.academic_year as number,
              school_id: s.school_id as string,
              offering_pk: s.offering_pk as string,
            })
          );
          ordered.sort((a, b) =>
            a.academic_year - b.academic_year ||
            (a.school_id < b.school_id ? -1 : a.school_id > b.school_id ? 1 : 0) ||
            (a.offering_pk < b.offering_pk ? -1 : a.offering_pk > b.offering_pk ? 1 : 0)
          );
          const body = Object.freeze({
            codec: "jungsi.p1-quota-bridge-request-scope/v1",
            approved_reference_sha256: pins.approved_reference_sha256,
            current_source_head_sha256: pins.current_source_head_sha256,
            current_p1_manifest_sha256: pins.current_p1_manifest_sha256,
            approved_scope_sha256: pins.approved_scope_sha256,
            qualification_source_sha256: QUALIFICATION_SOURCE_SHA256,
            selectors: Object.freeze(ordered),
          });
          requestScope = Object.freeze({
            ...body,
            request_scope_sha256: await nativeJsonSha256(body),
            request_scope_count: ordered.length,
          });
        }
        need(requestScope !== null, "REQUEST_SCOPE_MISSING");
        const scope: RequestScope = requestScope;
        if (include) {
          const approval = rec(await authorize(pins, scope), SCOPE_AUTH_PROOF);
          need(
            approval.disposition === "approved" &&
              approval.authority_sha256 === pins.authority_sha256 &&
              approval.approved_reference_sha256 === pins.approved_reference_sha256 &&
              approval.current_source_head_sha256 === pins.current_source_head_sha256 &&
              approval.current_p1_manifest_sha256 === pins.current_p1_manifest_sha256 &&
              approval.approved_scope_sha256 === pins.approved_scope_sha256 &&
              approval.approved_request_scope_sha256 === scope.request_scope_sha256 &&
              approval.approved_request_scope_count === scope.request_scope_count &&
              approval.request_scope_binding === "independent_exact_approved",
            "REQUEST_SCOPE_UNAUTHORIZED",
          );
          independentlyAuthorizedScope = scope.request_scope_sha256;
        } else {
          need(
            independentlyAuthorizedScope === scope.request_scope_sha256,
            "REQUEST_SCOPE_UNAUTHORIZED",
          );
        }
        const b = rec(await read(pins, chunk, include, scope), ["reference_bytes", "rows"]),
          rawRows = dense(b.rows, 100);
        need(rawRows.length === chunk.length, "READ_COUNT");
        const snapshots = rawRows.map((raw) => {
          try {
            const r = rec(raw, READ),
              cell = cellSnapshot(r.previous_cell),
              projection = rec(r.numeric_projection, ["codec", "literal"]);
            return { r, cell, projection, error: null };
          } catch (error) {
            return {
              r: null,
              cell: null,
              projection: null,
              error: error instanceof BindingError ? error.message : "ROW_INVALID",
            };
          }
        });
        if (include) {
          const bytes = copyBytes(b.reference_bytes), refSha = await sha(bytes);
          need(refSha === pins.approved_reference_sha256, "REFERENCE_HASH");
          const root = object(
            parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
          );
          need(
            root.schema === pins.approved_reference_schema &&
              root.original_p1_manifest_sha256 === pins.current_p1_manifest_sha256,
            "REFERENCE_HEAD",
          );
          need(Array.isArray(root.targets) && root.targets.length <= 2048, "REFERENCE_TARGETS");
          referenceIndex = new Map<string, Obj[]>();
          for (const raw of root.targets) {
            const target = object(raw), k = key(target);
            need(
              Number.isSafeInteger(target.academic_year) && id(target.school_id) &&
                id(target.offering_pk) && !referenceIndex.has(k),
              "REFERENCE_DUPLICATE_OR_INVALID",
            );
            referenceIndex.set(k, [target]);
          }
          referenceTargetCount = referenceIndex.size;
          if (
            referenceIndex.size === selectors.length &&
            selectors.every((s) => referenceIndex!.get(key(s))?.[0].school_id === s.school_id)
          ) {
            referenceCoverage = "ALL_REFERENCE_TARGETS_REQUESTED";
          }
        } else need(b.reference_bytes === null && referenceIndex !== null, "REFERENCE_REPEATED");
        need(referenceIndex !== null, "REFERENCE_MISSING");
        const index = referenceIndex,
          subjects: Obj[] = [],
          slots: number[] = [],
          local: Obj[] = chunk.map((s) => status(s as unknown as Obj, "ROW_NOT_VERIFIED"));
        for (let i = 0; i < chunk.length; i++) {
          const s = chunk[i] as unknown as Obj, snap = snapshots[i];
          if (snap.error !== null) {
            local[i] = status(s, snap.error);
            continue;
          }
          try {
            const r = snap.r!, cell = snap.cell!, projection = snap.projection!;
            need(
              r.academic_year === s.academic_year && r.school_id === s.school_id &&
                r.offering_pk === s.offering_pk,
              "READ_SCOPE",
            );
            need(
              text(r.admission_track) && r.admission_track.length > 0 &&
                text(r.recruit_group) && r.recruit_group.length > 0 &&
                ![...r.admission_track, ...r.recruit_group].some((ch) =>
                  ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127
                ),
              "READ_RELATION",
            );
            need(
              id(r.p1_part_id) && hash(r.p1_part_sha256) && Number.isSafeInteger(r.p1_row_1based) &&
                Number(r.p1_row_1based) > 0,
              "PART_IDENTITY",
            );
            need(
              typeof r.existing_canonical_result_id === "string" &&
                CID.test(r.existing_canonical_result_id) &&
                Number.isSafeInteger(r.identity_variant_index) &&
                Number(r.identity_variant_index) >= 0 && Number(r.identity_variant_index) <= 15,
              "OBSERVATION",
            );
            need(
              hash(r.raw_source_row_sha256) && r.metric_value_json_type === "string" &&
                text(r.metric_value_literal),
              "SOURCE_LITERAL",
            );
            const decoded = parseNativeJson(r.metric_value_literal as string);
            need(
              typeof decoded === "string" && text(decoded) && decoded === cell.value &&
                /^\d{1,1024}$/.test(decoded),
              "SOURCE_LITERAL",
            );
            need(
              projection.codec === PROJECTION_CODEC && typeof projection.literal === "string" &&
                /^(?:0|[1-9]\d{0,1023})$/.test(projection.literal),
              "PROJECTION_CODEC",
            );
            need(decoded.replace(/^0+(?=\d)/, "") === projection.literal, "PROJECTION_MISMATCH");
            const matches = index.get(key(s)) ?? [];
            need(matches.length === 1, "REFERENCE_TARGETS");
            const target = matches[0];
            need(
              target.school_id === s.school_id && target.p1_part_id === r.p1_part_id &&
                target.p1_part_sha256 === r.p1_part_sha256 &&
                target.p1_row_1based === r.p1_row_1based,
              "REFERENCE_PART",
            );
            need(
              target.existing_canonical_result_id === r.existing_canonical_result_id &&
                target.identity_variant_index_candidate === r.identity_variant_index,
              "REFERENCE_IDENTITY",
            );
            need(
              target.expected_cell_fingerprint_encoding === ENCODING &&
                hash(target.expected_cell_sha256),
              "REFERENCE_CODEC",
            );
            const context = cell.source_context as Obj | null,
              binding = context === null
                ? "missing_context_verified"
                : context.scope_status === "review_pending"
                ? "existing_context_review_pending_verified"
                : "source_consistent_verified";
            need(
              target.context_case ===
                  (context === null ? "NULL_CONTEXT_CANDIDATE" : "EXISTING_ID_CONTEXT") &&
                (context === null ||
                  context.observation_id === r.existing_canonical_result_id &&
                    context.identity_variant_index === r.identity_variant_index),
              "REFERENCE_CONTEXT",
            );
            const dataSha = await nativeJsonSha256(cell);
            need(dataSha === target.expected_cell_sha256, "CELL_FINGERPRINT");
            const sourceNativeValueSha = await nativeValueSha256(decoded);
            const serviceSha = await serviceCellEnvelopeSha(cell);
            need(hash(serviceSha), "SERVICE_CELL_HASH");
            const literalSha = await sha(
              new TextEncoder().encode(r.metric_value_literal as string),
            );
            const projectionSha = await nativeJsonSha256({
              codec: projection.codec,
              literal: projection.literal,
            });
            const subject = Object.freeze({
              codec: "jungsi.p1-quota-fingerprint-binding/native-json-v1",
              qualification_source_sha256: QUALIFICATION_SOURCE_SHA256,
              request_scope_sha256: scope.request_scope_sha256,
              request_scope_count: scope.request_scope_count,
              approved_reference_sha256: pins.approved_reference_sha256,
              approved_reference_schema: pins.approved_reference_schema,
              current_source_head_sha256: pins.current_source_head_sha256,
              current_p1_manifest_sha256: pins.current_p1_manifest_sha256,
              approved_scope_sha256: pins.approved_scope_sha256,
              authority_sha256: pins.authority_sha256,
              academic_year: s.academic_year,
              school_id: s.school_id,
              offering_pk: s.offering_pk,
              admission_track: r.admission_track,
              recruit_group: r.recruit_group,
              p1_part_id: r.p1_part_id,
              p1_part_sha256: r.p1_part_sha256,
              p1_row_1based: r.p1_row_1based,
              existing_canonical_result_id: r.existing_canonical_result_id,
              identity_variant_index: r.identity_variant_index,
              fingerprint_encoding: ENCODING,
              data_team_cell_sha256: dataSha,
              service_previous_cell_sha256: serviceSha,
              previous_cell_binding: binding,
              metric_value_json_type: r.metric_value_json_type,
              source_native_value_sha256: sourceNativeValueSha,
              metric_literal_utf8_sha256: literalSha,
              numeric_projection_codec: projection.codec,
              numeric_projection_sha256: projectionSha,
              raw_source_row_sha256: r.raw_source_row_sha256,
              chunk_index: meta.chunk_index,
            });
            const subjectSha = await nativeJsonSha256(subject);
            subjects.push(Object.freeze({ ...subject, subject_sha256: subjectSha }));
            slots.push(i);
          } catch (error) {
            local[i] = status(s, error instanceof BindingError ? error.message : "ROW_INVALID");
          }
        }
        if (subjects.length > 0) {
          const proofs = dense(await verify(pins, scope, Object.freeze(subjects)), 100);
          need(proofs.length === subjects.length, "PROOF_COUNT");
          for (let j = 0; j < subjects.length; j++) {
            const i = slots[j], s = chunk[i] as unknown as Obj, subject = subjects[j];
            try {
              const proof = rec(proofs[j], PROOF);
              need(
                proof.disposition === "approved" && proof.subject_sha256 === subject.subject_sha256,
                "ISSUER_APPROVAL",
              );
              need(
                proof.authority_sha256 === pins.authority_sha256 &&
                  proof.approved_reference_sha256 === pins.approved_reference_sha256 &&
                  proof.current_source_head_sha256 === pins.current_source_head_sha256 &&
                  proof.current_p1_manifest_sha256 === pins.current_p1_manifest_sha256 &&
                  proof.approved_scope_sha256 === pins.approved_scope_sha256 &&
                  proof.current_p1_part_sha256 === subject.p1_part_sha256 &&
                  proof.previous_cell_binding === subject.previous_cell_binding,
                "ISSUER_SCOPE",
              );
              need(
                proof.approved_request_scope_sha256 === scope.request_scope_sha256 &&
                  proof.approved_request_scope_count === scope.request_scope_count &&
                  proof.request_scope_binding === "independent_exact_approved",
                "ISSUER_REQUEST_SCOPE",
              );
              need(
                proof.part_bytes_verified === true && proof.same_snapshot_verified === true &&
                  proof.source_row_verified === true && proof.metric_literal_verified === true &&
                  proof.numeric_projection_verified === true &&
                  proof.fingerprint_codec_verified === true,
                "ISSUER_ATTESTATION",
              );
              const announced = sourceGroupSet(proof.source_announced_groups);
              need(
                proof.source_metric_binding === "approved_recruitment_final_count" &&
                  typeof proof.source_production_allowed === "boolean" &&
                  hash(proof.source_cohort_sha256) && proof.source_cohort_binding === "approved" &&
                  proof.source_announced_groups_binding === "approved" &&
                  typeof subject.recruit_group === "string" &&
                  announced.includes(subject.recruit_group) &&
                  hash(proof.target_membership_sha256) &&
                  proof.target_membership_binding === "approved",
                "ISSUER_COHORT_OR_MEMBERSHIP",
              );
              need(
                hash(proof.target_cell_group_sha256) &&
                  proof.target_cell_selection === "single_selection_approved" &&
                  proof.target_cell_selected_observation_id ===
                    subject.existing_canonical_result_id,
                "ISSUER_SELECTION",
              );
              local[i] = Object.freeze({
                academic_year: s.academic_year,
                school_id: s.school_id,
                offering_pk: s.offering_pk,
                action: "BOUND_REVIEW_ONLY",
                subject_sha256: subject.subject_sha256,
                data_team_cell_sha256: subject.data_team_cell_sha256,
                service_previous_cell_sha256: subject.service_previous_cell_sha256,
                existing_canonical_result_id: subject.existing_canonical_result_id,
                source_metric_binding: proof.source_metric_binding,
                source_production_allowed: proof.source_production_allowed,
                source_cohort_sha256: proof.source_cohort_sha256,
                metric_value_json_type: subject.metric_value_json_type,
                source_native_value_sha256: subject.source_native_value_sha256,
                metric_literal_utf8_sha256: subject.metric_literal_utf8_sha256,
                raw_source_row_sha256: subject.raw_source_row_sha256,
                source_announced_groups: announced,
                target_membership_sha256: proof.target_membership_sha256,
                target_cell_group_sha256: proof.target_cell_group_sha256,
                target_cell_selection: proof.target_cell_selection,
                target_cell_selected_observation_id: proof.target_cell_selected_observation_id,
              });
            } catch (error) {
              local[i] = status(s, error instanceof BindingError ? error.message : "PROOF_INVALID");
            }
          }
        }
        need(await live(pins) === undefined, "PORT_PROTOCOL");
        chunkResults = local;
        finished = true;
      });
      need(
        budgetResult === undefined && starts === 1 && finished &&
          chunkResults.length === chunk.length,
        "BUDGET_PROTOCOL",
      );
      results.push(...chunkResults);
    }
    // Only fully approved member proofs contribute to cross-chunk source consistency.
    const signatures = new Map<string, Set<string>>();
    for (const row of results) {
      if (row.action !== "BOUND_REVIEW_ONLY") continue;
      const observation = row.existing_canonical_result_id as string;
      const values = signatures.get(observation) ?? new Set<string>();
      values.add(
        JSON.stringify([
          row.academic_year,
          row.school_id,
          row.source_cohort_sha256,
          row.source_production_allowed,
          [...row.source_announced_groups as readonly string[]].sort(),
          row.metric_value_json_type,
          row.source_native_value_sha256,
          row.metric_literal_utf8_sha256,
          row.raw_source_row_sha256,
        ]),
      );
      signatures.set(observation, values);
    }
    for (let i = 0; i < results.length; i++) {
      const row = results[i];
      if (
        row.action === "BOUND_REVIEW_ONLY" &&
        (signatures.get(row.existing_canonical_result_id as string)?.size ?? 0) > 1
      ) {
        results[i] = status(row, "SOURCE_OBSERVATION_CONFLICT");
      }
    }
    const finalScope = requestScope as RequestScope | null;
    need(finalScope !== null, "REQUEST_SCOPE_MISSING");
    return Object.freeze({
      action: results.some((x) => x.action === "HOLD") ? "PARTIAL_REVIEW_ONLY" : "REVIEW_ONLY",
      publication_ready: false,
      requested_scope_count: selectors.length,
      requested_scope_sha256: finalScope.request_scope_sha256,
      request_scope_authorization: results.every((x) => x.action === "BOUND_REVIEW_ONLY")
        ? "INDEPENDENTLY_APPROVED_EXACT_REQUEST"
        : "NOT_PROVEN_FOR_ALL",
      reference_target_count: referenceTargetCount,
      reference_target_coverage: referenceCoverage,
      results: Object.freeze(results),
    });
  } catch (error) {
    return batchHold(error instanceof BindingError ? error.message : "EVIDENCE_UNAVAILABLE");
  }
}
