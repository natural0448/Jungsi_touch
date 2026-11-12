/**
 * Review-only adapter for the independently extracted 2027 Guide lineage JSONL.
 * It does not grant scope/link authority, read a database, publish, or install a runtime.
 * Its output is suitable only as an input candidate to existing r27 source-page validation;
 * separately bound scope/link receipts, source pages and head evidence remain mandatory.
 */
import { AccessError } from "./access.ts";
import { type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson, parseNativeJson } from "../domain/native_json.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const LINE_LIMIT = 1_048_576;

export type R27LineageCandidatePins = Readonly<{
  /** SHA of the exact, independently verified source JSONL bytes, not an approved head. */
  sourceSha256: string;
  sourceHeadSha256: string;
  previousPublicationSha256: string;
  previousSourceHeadSha256: string;
  scopeSha256: string;
}>;

export type R27LineageResolvedRow = Readonly<{
  academicYear: 2027;
  offeringPk: string;
  schoolId: string;
  /** These values, including null, are independently checked rather than inferred. */
  campus: string | null;
  admissionTrack: string | null;
  group: string | null;
  sourceRef: string | null;
  scopeState: "eligible_non_practical" | "excluded_practical" | "review_pending";
  scopeEvidenceSha256: string | null;
}>;
export type R27LineageResolution =
  | Readonly<{ state: "HOLD"; academicYear: 2027; offeringPk: string }>
  | Readonly<{ state: "VERIFIED"; row: R27LineageResolvedRow }>;

/**
 * Independent Owner-side authority, not supplied by this candidate. It must verify that the
 * exact parsed rows came from the pinned source file and verified Guide/head, authenticate
 * its issuer, review campus/track/group/source and current scope, and return one resolution
 * per input in the same order. It must not turn path hashes into reviewed history links.
 * Resolution is one bounded batch, never a school- or offering-at-a-time database call.
 * Any I/O must have physically stopped before either authority promise settles, including on
 * abort; a rejection or AbortSignal alone is not proof that an underlying read has stopped.
 */
export interface R27LineagePageAuthority {
  assertCurrent(pins: R27LineageCandidatePins, signal: AbortSignal): Promise<void>;
  resolveExact(
    pins: R27LineageCandidatePins,
    records: readonly NativeObject[],
    signal: AbortSignal,
  ): Promise<readonly R27LineageResolution[]>;
}

export type R27LineagePageItem = Readonly<{
  academicYear: 2027;
  offeringPk: string;
  state: "SOURCE_CANDIDATE" | "HOLD";
  /** Private candidate input only; the approved scope/link receipts are separately required. */
  sourceRow: NativeObject | null;
}>;

function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function obj(value: unknown): NativeObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonFloat) {
    fail();
  }
  return value as NativeObject;
}
function txt(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !Array.from(value).some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127);
}
function nullable(value: unknown): value is string | null {
  return value === null || txt(value);
}
function scalar(value: NativeJson): boolean {
  return value === null || typeof value === "string" || typeof value === "bigint" ||
    typeof value === "number" && Number.isSafeInteger(value) || value instanceof JsonFloat;
}
function deepFreeze(value: NativeJson): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child as NativeJson);
  Object.freeze(value);
}

/**
 * Reads only supplied JSONL lines; the caller must bind these lines to the exact source file.
 * It never resolves a historical relation or promotes the unassessed service scope to approved.
 * HOLD entries are returned rather than replaced with a fabricated campus, source or quota.
 */
export async function prepareR27LineagePageCandidate(
  lines: readonly string[],
  pins: R27LineageCandidatePins,
  signal: AbortSignal,
  authority: R27LineagePageAuthority,
): Promise<readonly R27LineagePageItem[]> {
  if (
    !Array.isArray(lines) || lines.length < 1 || lines.length > 128 || !pins ||
    ![
      pins.sourceSha256,
      pins.sourceHeadSha256,
      pins.previousPublicationSha256,
      pins.previousSourceHeadSha256,
      pins.scopeSha256,
    ].every((v) => typeof v === "string" && HASH.test(v)) ||
    !signal || signal.aborted || !authority || typeof authority.assertCurrent !== "function" ||
    typeof authority.resolveExact !== "function"
  ) fail();
  const pin = Object.freeze({ ...pins });
  const records: NativeObject[] = [];
  const keys = new Set<string>();
  for (const line of lines) {
    if (typeof line !== "string" || new TextEncoder().encode(line).length > LINE_LIMIT) fail();
    const raw = obj(parseNativeJson(line));
    const guide = obj(raw.guide);
    if (
      raw.academicYear !== 2027 || typeof raw.offeringPk !== "string" || !ID.test(raw.offeringPk) ||
      typeof guide.school_id !== "string" || !ID.test(guide.school_id) ||
      !Array.isArray(raw.historical_keys) || typeof raw.service_scope !== "string"
    ) fail();
    if (keys.has(raw.offeringPk)) fail();
    keys.add(raw.offeringPk);
    deepFreeze(raw);
    records.push(raw);
  }
  const stableRecords = Object.freeze(records);
  await authority.assertCurrent(pin, signal);
  if (signal.aborted) fail();
  const resolved = await authority.resolveExact(pin, stableRecords, signal);
  if (signal.aborted || !Array.isArray(resolved) || resolved.length !== records.length) fail();
  const output: R27LineagePageItem[] = [];
  for (let i = 0; i < records.length; i++) {
    const raw = records[i], guide = obj(raw.guide), resolution = resolved[i];
    const id = raw.offeringPk as string;
    if (!resolution || typeof resolution !== "object") fail();
    if (resolution.state === "HOLD") {
      if (resolution.academicYear !== 2027 || resolution.offeringPk !== id) fail();
      output.push(
        Object.freeze({ academicYear: 2027, offeringPk: id, state: "HOLD", sourceRow: null }),
      );
      continue;
    }
    if (resolution.state !== "VERIFIED") fail();
    const r = resolution.row;
    if (
      !r || r.academicYear !== 2027 || r.offeringPk !== id || r.schoolId !== guide.school_id ||
      !nullable(r.campus) || !nullable(r.admissionTrack) || !nullable(r.group) ||
      !nullable(r.sourceRef) ||
      !["eligible_non_practical", "excluded_practical", "review_pending"].includes(r.scopeState) ||
      !(r.scopeEvidenceSha256 === null ||
        typeof r.scopeEvidenceSha256 === "string" && HASH.test(r.scopeEvidenceSha256)) ||
      r.scopeState !== "review_pending" && r.scopeEvidenceSha256 === null
    ) fail();
    // Any nonempty published Guide spelling must agree with the independently verified identity.
    if (
      txt(guide.track) && guide.track !== r.admissionTrack ||
      txt(guide.recruit_group) && guide.recruit_group !== r.group
    ) fail();
    const row: NativeObject = {
      academic_year: 2027,
      school_id: r.schoolId,
      original_pk: id,
      campus: r.campus,
      admission_track: r.admissionTrack,
      group: r.group,
      source_ref: r.sourceRef,
      scope: { state: r.scopeState, evidence_sha256: r.scopeEvidenceSha256 },
    };
    for (
      const [input, target] of [["university", "university_name"], [
        "department",
        "department",
      ]] as const
    ) {
      const value = guide[input];
      if (value === null || txt(value)) row[target] = value;
      else fail();
    }
    if (guide.quota_native_json !== null) {
      if (typeof guide.quota_native_json !== "string") fail();
      const quota = parseNativeJson(guide.quota_native_json);
      if (!scalar(quota)) fail();
      row.quota_value = quota;
    }
    // Unsupported literal-state metadata stops this candidate; never turn it into zero.
    if (guide.quota_literal_state === null || txt(guide.quota_literal_state)) {
      row.quota_literal_state = guide.quota_literal_state;
    } else fail();
    deepFreeze(row);
    output.push(
      Object.freeze({
        academicYear: 2027,
        offeringPk: id,
        state: "SOURCE_CANDIDATE",
        sourceRow: row,
      }),
    );
  }
  await authority.assertCurrent(pin, signal);
  if (signal.aborted) fail();
  return Object.freeze(output);
}
