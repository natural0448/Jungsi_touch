/** Private, immutable member school-result objects. Report publication/CAS is a separate port. */
import { AccessError } from "../application/access.ts";
import { resultObject } from "../application/paid_result_components.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeObject } from "../domain/native_json.ts";
import { memberBytesSha, type MemberJsonStorageSettings } from "./member_json_storage.ts";

export interface MemberSchoolResultIdentity {
  readonly owner: string;
  readonly academicYear: number;
  readonly reportId: string;
  /** Revision that produced this immutable object, not necessarily the latest report revision. */
  readonly reportRevision: number;
  readonly currentReportRevision?: number;
  readonly profileId: string;
  readonly profileFingerprint: string;
  readonly examId: string;
  readonly packVersion: string;
}

/** Internal only: never send object keys or storage credentials to a browser. */
export interface MemberSchoolResultReference {
  readonly object_key: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly source_report_revision: number;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const DOCUMENT_FIELDS = [
  "academic_year",
  "exam_id",
  "format",
  "native_result_hash",
  "offerings",
  "owner_binding",
  "pack_version",
  "profile_fingerprint",
  "profile_id",
  "report_id",
  "report_revision",
];
const OFFERING_FIELDS = [
  "offering_id",
  "university_name",
  "department",
  "assessment",
  "converted_score",
  "converted_score_status",
  "converted_score_reason",
  "score_basis",
  "converted_percentile",
  "top_percent",
  "top_percent_status",
  "top_percent_reason",
  "rule_version",
  "conversion_version",
  "curve_version",
  "model_version",
];
function fail(code = "storage_result_invalid"): never {
  throw new AccessError(code, 503);
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function exact(value: unknown, fields: readonly string[]): value is NativeObject {
  return resultObject(value) && Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field));
}
function nullableText(value: unknown): boolean {
  return value === null || typeof value === "string" && value.length <= 256;
}
function nullableScalar(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "bigint" ||
    typeof value === "number" && Number.isFinite(value) || value instanceof JsonFloat;
}
function validateIdentity(identity: MemberSchoolResultIdentity): void {
  if (
    !identity || typeof identity.owner !== "string" || !UUID.test(identity.owner) ||
    !positive(identity.academicYear) ||
    identity.academicYear < 1000 || identity.academicYear > 9999 ||
    !positive(identity.reportRevision) || typeof identity.reportId !== "string" ||
    identity.currentReportRevision !== undefined &&
      (!positive(identity.currentReportRevision) ||
        identity.currentReportRevision < identity.reportRevision) ||
    !ID.test(identity.reportId) || typeof identity.profileId !== "string" ||
    !ID.test(identity.profileId) || typeof identity.profileFingerprint !== "string" ||
    !HASH.test(identity.profileFingerprint) || typeof identity.examId !== "string" ||
    !ID.test(identity.examId) || typeof identity.packVersion !== "string" ||
    !ID.test(identity.packVersion)
  ) fail();
}
function stableIdentity(identity: MemberSchoolResultIdentity): MemberSchoolResultIdentity {
  if (!identity || typeof identity !== "object") fail();
  const bound = Object.freeze({
    owner: identity.owner,
    academicYear: identity.academicYear,
    reportId: identity.reportId,
    reportRevision: identity.reportRevision,
    profileId: identity.profileId,
    ...(identity.currentReportRevision === undefined
      ? {}
      : { currentReportRevision: identity.currentReportRevision }),
    profileFingerprint: identity.profileFingerprint,
    examId: identity.examId,
    packVersion: identity.packVersion,
  });
  validateIdentity(bound);
  return bound;
}

export class MemberSchoolResultsStorage {
  private readonly settings!: MemberJsonStorageSettings;
  constructor(settings: MemberJsonStorageSettings, private readonly fetcher: typeof fetch = fetch) {
    let url: URL;
    try {
      url = new URL(settings.projectUrl);
    } catch {
      return fail("storage_configuration_invalid");
    }
    if (
      url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") ||
      url.origin !== settings.projectUrl || url.username || url.password ||
      !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(settings.bucket) ||
      !settings.prefix.endsWith("/") || /[\\%\s]/.test(settings.prefix) ||
      settings.prefix.slice(0, -1).split("/").some((part) =>
        !part || part === "." || part === ".."
      ) ||
      !settings.secretKey || /[\r\n]/.test(settings.secretKey) ||
      [settings.maxBytes, settings.maxItems, settings.timeoutMs].some((value) => !positive(value))
    ) fail("storage_configuration_invalid");
    this.settings = Object.freeze({ ...settings });
  }

  private prefix(identity: MemberSchoolResultIdentity): string {
    validateIdentity(identity);
    return `${this.settings.prefix}${identity.owner}/${identity.academicYear}/school-results/` +
      `${identity.reportId}/${String(identity.reportRevision).padStart(16, "0")}/`;
  }

  private validateReference(
    reference: MemberSchoolResultReference,
    identity: MemberSchoolResultIdentity,
  ): void {
    if (
      !resultObject(reference) ||
      Object.keys(reference).sort().join(",") !==
        "bytes,object_key,sha256,source_report_revision" ||
      typeof reference.sha256 !== "string" || !HASH.test(reference.sha256) ||
      !positive(reference.bytes) || reference.bytes > this.settings.maxBytes ||
      reference.source_report_revision !== identity.reportRevision ||
      reference.object_key !== `${this.prefix(identity)}${reference.sha256}.json`
    ) fail();
  }

  private async validateDocument(
    document: NativeObject,
    identity: MemberSchoolResultIdentity,
  ): Promise<void> {
    validateIdentity(identity);
    if (
      !exact(document, DOCUMENT_FIELDS) || document.format !== "jungsi.member-school-results/v1" ||
      document.owner_binding !== identity.owner ||
      document.academic_year !== identity.academicYear ||
      document.report_id !== identity.reportId ||
      document.report_revision !== identity.reportRevision ||
      document.profile_id !== identity.profileId ||
      document.profile_fingerprint !== identity.profileFingerprint ||
      document.exam_id !== identity.examId || document.pack_version !== identity.packVersion ||
      typeof document.native_result_hash !== "string" || !HASH.test(document.native_result_hash) ||
      !Array.isArray(document.offerings) || document.offerings.length > this.settings.maxItems
    ) fail();
    const ids = new Set<string>();
    for (const row of document.offerings) {
      if (
        !exact(row, OFFERING_FIELDS) || typeof row.offering_id !== "string" ||
        !ID.test(row.offering_id) || ids.has(row.offering_id) ||
        row.assessment !== null && (!resultObject(row.assessment) ||
            row.assessment.offering_id !== undefined &&
              row.assessment.offering_id !== row.offering_id) ||
        !nullableText(row.university_name) || !nullableText(row.department) ||
        !["ready", "pending"].includes(String(row.converted_score_status)) ||
        !["ready", "pending"].includes(String(row.top_percent_status)) ||
        !nullableScalar(row.converted_score) || !nullableScalar(row.converted_percentile) ||
        !nullableScalar(row.top_percent) ||
        [
          row.converted_score_reason,
          row.score_basis,
          row.top_percent_reason,
          row.rule_version,
          row.conversion_version,
          row.curve_version,
          row.model_version,
        ].some((item) => !nullableText(item))
      ) fail();
      if (
        row.converted_score_status === "ready" && row.converted_score === null ||
        row.top_percent_status === "ready" && (
            row.top_percent === null || row.converted_percentile !== null &&
              nativeJsonText(row.converted_percentile, true) !==
                nativeJsonText(row.top_percent, true)
          ) ||
        row.top_percent_status === "pending" &&
          (row.top_percent !== null || row.converted_percentile !== null)
      ) fail();
      ids.add(row.offering_id);
    }
    const content: NativeObject = { ...document };
    delete content.native_result_hash;
    if (await nativeJsonSha256(content) !== document.native_result_hash) fail();
  }

  private async request(
    reference: MemberSchoolResultReference,
    body?: Uint8Array,
    signal?: AbortSignal,
  ): Promise<Response> {
    const write = body !== undefined;
    const key = reference.object_key.split("/").map((part) => encodeURIComponent(part)).join("/");
    const url = `${this.settings.projectUrl}/storage/v1/object/${write ? "" : "authenticated/"}` +
      `${this.settings.bucket}/${key}`;
    try {
      const response = await this.fetcher(url, {
        method: write ? "POST" : "GET",
        headers: {
          apikey: this.settings.secretKey,
          ...(write
            ? { "Content-Type": "application/json", "x-upsert": "false" }
            : { Accept: "application/octet-stream" }),
          "Cache-Control": "no-store",
        },
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(this.settings.timeoutMs)])
          : AbortSignal.timeout(this.settings.timeoutMs),
        ...(write ? { body: Uint8Array.from(body) } : {}),
      });
      if (response.redirected || response.url && response.url !== url) fail("storage_unavailable");
      return response;
    } catch {
      fail("storage_unavailable");
    }
  }

  async read(
    identity: MemberSchoolResultIdentity,
    reference: MemberSchoolResultReference,
    signal?: AbortSignal,
  ): Promise<NativeObject> {
    const bound = stableIdentity(identity);
    this.validateReference(reference, bound);
    const ref = Object.freeze({
      object_key: reference.object_key,
      sha256: reference.sha256,
      bytes: reference.bytes,
      source_report_revision: reference.source_report_revision,
    });
    const response = await this.request(ref, undefined, signal);
    if (response.status !== 200) {
      await response.body?.cancel();
      fail("storage_unavailable");
    }
    const reader = response.body?.getReader();
    if (!reader) fail();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > ref.bytes) {
          await reader.cancel();
          fail();
        }
        chunks.push(next.value);
      }
    } catch {
      try {
        await reader.cancel();
      } catch { /* A failed read is never accepted. */ }
      fail("storage_unavailable");
    } finally {
      reader.releaseLock();
    }
    if (size !== ref.bytes) fail();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (await memberBytesSha(bytes) !== ref.sha256) fail();
    let document: NativeObject;
    try {
      document = parseNativeObject(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return fail();
    }
    await this.validateDocument(document, bound);
    return document;
  }

  /** Create immutable content, then read and verify the exact bytes. No report is published here. */
  async create(
    identity: MemberSchoolResultIdentity,
    value: NativeObject,
  ): Promise<MemberSchoolResultReference> {
    const bound = stableIdentity(identity);
    const bytes = new TextEncoder().encode(nativeJsonText(value, true));
    if (!bytes.length || bytes.length > this.settings.maxBytes) fail();
    let document: NativeObject;
    try {
      document = parseNativeObject(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return fail();
    }
    await this.validateDocument(document, bound);
    const sha256 = await memberBytesSha(bytes);
    const reference = Object.freeze({
      object_key: `${this.prefix(bound)}${sha256}.json`,
      sha256,
      bytes: bytes.length,
      source_report_revision: bound.reportRevision,
    });
    const response = await this.request(reference, bytes);
    if (![200, 201, 409].includes(response.status)) {
      await response.body?.cancel();
      fail("storage_unavailable");
    }
    await response.body?.cancel();
    await this.read(bound, reference);
    return reference;
  }
}
