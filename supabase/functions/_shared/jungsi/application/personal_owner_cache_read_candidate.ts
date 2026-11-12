/** Request-scoped personal-owner cache read. No student UUID equivalence or bucket is installed. */
import { AccessError } from "./access.ts";
import { requireBooleanStopped } from "./reference_quiescence_fence.review-only.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import {
  assertPersonalOwnerStorageIdentity,
  type PersonalOwnerStorageIdentity,
} from "./personal_owner_storage_scope_candidate.ts";
import {
  type StudentCacheFiveFields,
  type StudentCacheKey,
  type StudentCachePins,
  validateStudentCacheFiveFields,
  validateStudentCachePins,
} from "./student_score_cache_bounded_workflow_candidate.ts";
import { nativeJsonSha256 } from "../domain/json_value.ts";
import { parseNativeJson } from "../domain/native_json.ts";
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
export type PersonalOwnerCacheGrant = Readonly<{
  kind: "personal_owner";
  ownerUuid: string;
  profileId: string;
  reportId: string;
  reportRevision: number;
  academicYear: 2027;
  totalRows: number;
  maxRows: number;
  maxBytes: number;
  pins: StudentCachePins;
}>;
export type PersonalOwnerCacheHead = Readonly<{
  kind: "personal_owner";
  ownerUuid: string;
  profileId: string;
  reportId: string;
  reportRevision: number;
  academicYear: 2027;
  version: string;
  payloadSha256: string;
  payloadBytes: number;
  coverageSha256: string;
  totalRows: number;
  pins: StudentCachePins;
}>;
export interface PersonalOwnerPrivateReadPort {
  head(grant: PersonalOwnerCacheGrant, signal: AbortSignal): Promise<PersonalOwnerCacheHead | null>;
  bytes(
    grant: PersonalOwnerCacheGrant,
    head: PersonalOwnerCacheHead,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}
/** Independently issues current scope/pins, checks actual storage and complete 2027 coverage.
 * Implementations must prove server ownership, source/head/format and real shared admission;
 * caller-supplied hashes or JSON shapes do not grant access. No authority is installed here. */
export interface PersonalOwnerCacheReadAuthority {
  issue(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    identity: PersonalOwnerStorageIdentity,
  ): Promise<PersonalOwnerCacheGrant>;
  assertCurrent(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    identity: PersonalOwnerStorageIdentity,
    grant: PersonalOwnerCacheGrant,
    head: PersonalOwnerCacheHead | null,
    storage: PersonalOwnerPrivateReadPort,
  ): Promise<void>;
  verifyCoverage(
    grant: PersonalOwnerCacheGrant,
    head: PersonalOwnerCacheHead,
    keys: readonly StudentCacheKey[],
    signal: AbortSignal,
  ): Promise<boolean>;
  awaitQuiescence(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export type PersonalOwnerCacheResult = Readonly<
  { state: "pending"; rows: null } | { state: "ready"; rows: readonly StudentCacheFiveFields[] }
>;
function closed(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length &&
    keys.every((k) =>
      typeof k === "string" && fields.includes(k) &&
      !!Object.getOwnPropertyDescriptor(value, k)?.enumerable &&
      "value" in Object.getOwnPropertyDescriptor(value, k)!
    );
}
const GRANT = [
  "kind",
  "ownerUuid",
  "profileId",
  "reportId",
  "reportRevision",
  "academicYear",
  "totalRows",
  "maxRows",
  "maxBytes",
  "pins",
];
const HEAD = [
  "kind",
  "ownerUuid",
  "profileId",
  "reportId",
  "reportRevision",
  "academicYear",
  "version",
  "payloadSha256",
  "payloadBytes",
  "coverageSha256",
  "totalRows",
  "pins",
];
async function sha(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))].map((
    b,
  ) => b.toString(16).padStart(2, "0")).join("");
}
/** Callable only inside withVerifiedPersonalOwnerStorageScope; no filename or name is returned. */
export async function readCurrentPersonalOwnerCache(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  identity: PersonalOwnerStorageIdentity,
  authority: PersonalOwnerCacheReadAuthority,
  storage: PersonalOwnerPrivateReadPort,
): Promise<PersonalOwnerCacheResult> {
  assertPersonalOwnerStorageIdentity(request, boundary, identity);
  if (
    !authority || typeof authority.issue !== "function" ||
    typeof authority.assertCurrent !== "function" ||
    typeof authority.verifyCoverage !== "function" ||
    typeof authority.awaitQuiescence !== "function" ||
    !storage || typeof storage.head !== "function" || typeof storage.bytes !== "function"
  ) fail();
  const signal = boundary.signal;
  const active = () => assertPersonalOwnerStorageIdentity(request, boundary, identity);
  try {
    const raw = await authority.issue(request, boundary, identity);
    active();
    if (
      !closed(raw, GRANT) || raw.kind !== "personal_owner" ||
      raw.ownerUuid !== identity.ownerUuid ||
      raw.profileId !== identity.profileId || raw.reportId !== identity.reportId ||
      raw.reportRevision !== identity.reportRevision ||
      raw.academicYear !== 2027 || !Number.isSafeInteger(raw.totalRows) ||
      Number(raw.totalRows) < 1 ||
      !Number.isSafeInteger(raw.maxRows) || Number(raw.maxRows) < Number(raw.totalRows) ||
      Number(raw.maxRows) > 100000 ||
      !Number.isSafeInteger(raw.maxBytes) || Number(raw.maxBytes) < 1 ||
      Number(raw.maxBytes) > 67108864
    ) fail();
    const grant: PersonalOwnerCacheGrant = Object.freeze({
      kind: "personal_owner",
      ownerUuid: identity.ownerUuid,
      profileId: identity.profileId,
      reportId: identity.reportId,
      reportRevision: identity.reportRevision,
      academicYear: 2027,
      totalRows: Number(raw.totalRows),
      maxRows: Number(raw.maxRows),
      maxBytes: Number(raw.maxBytes),
      pins: validateStudentCachePins(raw.pins),
    });
    const current = async (head: PersonalOwnerCacheHead | null) => {
      active();
      await authority.assertCurrent(request, boundary, identity, grant, head, storage);
      active();
    };
    await current(null);
    const found = await storage.head(grant, signal);
    await current(null);
    if (found === null) return Object.freeze({ state: "pending", rows: null });
    if (
      !closed(found, HEAD) || found.kind !== "personal_owner" ||
      found.ownerUuid !== grant.ownerUuid ||
      found.profileId !== grant.profileId || found.reportId !== grant.reportId ||
      found.reportRevision !== grant.reportRevision ||
      found.academicYear !== 2027 || found.totalRows !== grant.totalRows ||
      typeof found.version !== "string" || !ID.test(found.version) ||
      typeof found.payloadSha256 !== "string" || !HASH.test(found.payloadSha256) ||
      typeof found.coverageSha256 !== "string" || !HASH.test(found.coverageSha256) ||
      !Number.isSafeInteger(found.payloadBytes) || Number(found.payloadBytes) < 1 ||
      Number(found.payloadBytes) > grant.maxBytes
    ) fail();
    const pins = validateStudentCachePins(found.pins);
    if (await nativeJsonSha256(pins) !== await nativeJsonSha256(grant.pins)) fail();
    const head: PersonalOwnerCacheHead = Object.freeze({
      kind: "personal_owner",
      ownerUuid: grant.ownerUuid,
      profileId: grant.profileId,
      reportId: grant.reportId,
      reportRevision: grant.reportRevision,
      academicYear: 2027,
      version: found.version,
      payloadSha256: found.payloadSha256,
      payloadBytes: Number(found.payloadBytes),
      coverageSha256: found.coverageSha256,
      totalRows: grant.totalRows,
      pins,
    });
    await current(head);
    const rawBytes = await storage.bytes(grant, head, signal);
    active();
    if (!(rawBytes instanceof Uint8Array) || rawBytes.byteLength !== head.payloadBytes) fail();
    const bytes = Uint8Array.from(rawBytes);
    if (await sha(bytes) !== head.payloadSha256) fail();
    await current(head);
    const parsed = parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (
      !Array.isArray(parsed) || parsed.length !== head.totalRows || parsed.length > grant.maxRows
    ) fail();
    const rows = Object.freeze(parsed.map(validateStudentCacheFiveFields));
    const keys = Object.freeze(rows.map((r) => r.학교및학교PK값));
    if (new Set(keys.map((k) => JSON.stringify([k.학교PK, k.모집행PK]))).size !== keys.length) {
      fail();
    }
    if (await authority.verifyCoverage(grant, head, keys, signal) !== true) fail();
    await current(head);
    return Object.freeze({ state: "ready", rows });
  } finally {
    await requireBooleanStopped(() => authority.awaitQuiescence(request, boundary, signal));
  }
}
