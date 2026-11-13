/** Derive the member-owned storage document from an already authorized report.
 * This projection performs no scoring, I/O, authorization, or publication. */
import { AccessError } from "./access.ts";
import type { StoredProfile, StoredReport } from "./platform_repository.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";

function fail(): never {
  throw new AccessError("storage_result_invalid", 503);
}
function object(value: unknown): value is NativeObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    !(value instanceof JsonFloat);
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
function scalar(value: unknown): value is NativeJson {
  return value === null || typeof value === "string" || typeof value === "bigint" ||
    typeof value === "number" && Number.isFinite(value) || value instanceof JsonFloat;
}
function label(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 256) fail();
  return value.trim() ? value : null;
}

/** Restore missing public summaries only from a result bound to the same profile and rule. */
function restoreMissingSummaries(
  assessment: NativeObject,
  row: NativeObject,
  profile: StoredProfile,
): NativeObject {
  const restored = cloneNativeJson(assessment);
  const conversion = object(restored.conversion) ? restored.conversion : null;
  const percentile = object(restored.percentile) ? restored.percentile : null;
  const bound = (value: NativeObject | null): value is NativeObject =>
    value !== null && value.academic_year === 2027 &&
    value.profile_version === profile.profile_id && value.exam_id === profile.scores.exam_id &&
    value.pack_version === profile.scores.pack_version;
  const same = (a: unknown, b: unknown): boolean =>
    scalar(a) && a !== null && scalar(b) && b !== null &&
    nativeJsonText(a, true) === nativeJsonText(b, true);
  const scoreBound = bound(conversion) && conversion.status === "ready" &&
    identifier(conversion.rule_version) && row.rule_version === conversion.rule_version &&
    row.converted_score_status === "ready" &&
    same(row.converted_score, conversion.converted_score);
  if (!Object.hasOwn(restored, "converted_score") && scoreBound) {
    restored.converted_score = cloneNativeJson(row.converted_score as NativeJson);
  }
  const percentileBound = scoreBound && bound(percentile) && percentile.status === "ready" &&
    percentile.rule_version === conversion.rule_version &&
    identifier(percentile.curve_version) && row.curve_version === percentile.curve_version &&
    identifier(percentile.source_model_version) &&
    row.model_version === percentile.source_model_version && row.top_percent_status === "ready" &&
    same(row.converted_percentile, percentile.top_percent) &&
    same(row.top_percent, percentile.top_percent);
  if (!Object.hasOwn(restored, "converted_percentile") && percentileBound) {
    restored.converted_percentile = cloneNativeJson(row.converted_percentile as NativeJson);
  }
  return restored;
}

/** Input offerings are the exact approved catalogue rows already selected by the server.
 * Missing result components stay null. The existing API's `converted_percentile`
 * is retained only as its verified top-cumulative compatibility field. */
export async function projectMemberSchoolResults(
  owner: string,
  profile: StoredProfile,
  report: StoredReport,
  offerings: readonly Readonly<NativeObject>[],
): Promise<NativeObject> {
  if (
    !identifier(owner) || !profile || !report || profile.owner_id !== owner ||
    report.owner_id !== owner || report.profile_id !== profile.profile_id ||
    !identifier(profile.profile_id) || !identifier(report.report_id) ||
    profile.confirmed !== true || !Number.isSafeInteger(report.revision) || report.revision < 1 ||
    !object(profile.scores) || !object(report.body) || !object(report.body.overall) ||
    !object(report.body.overall.exam) || report.body.overall.exam.academic_year !== 2027 ||
    !identifier(profile.scores.exam_id) || !identifier(profile.scores.pack_version) ||
    report.body.overall.exam.exam_id !== profile.scores.exam_id ||
    report.body.overall.pack_version !== profile.scores.pack_version ||
    !object(report.body.analyses) || !Array.isArray(offerings) || offerings.length > 100
  ) fail();
  const analyses = report.body.analyses;
  const seen = new Set<string>();
  const results: NativeJson[] = [];
  for (const offering of offerings) {
    if (
      !object(offering) || offering.academic_year !== 2027 || !identifier(offering.offering_id) ||
      seen.has(offering.offering_id)
    ) fail();
    const id = offering.offering_id;
    seen.add(id);
    const analysis = analyses[id];
    if (analysis !== undefined && !object(analysis)) fail();
    const conversion = object(analysis) && object(analysis.conversion) ? analysis.conversion : null;
    const percentile = object(analysis) && object(analysis.percentile) ? analysis.percentile : null;
    if (object(analysis) && analysis.offering_id !== undefined && analysis.offering_id !== id) {
      fail();
    }
    if (
      conversion && (conversion.profile_version !== profile.profile_id ||
        conversion.exam_id !== profile.scores.exam_id ||
        conversion.pack_version !== profile.scores.pack_version ||
        conversion.academic_year !== 2027 ||
        !["ready", "pending"].includes(String(conversion.status)) ||
        !scalar(conversion.converted_score) ||
        conversion.status === "ready" && conversion.converted_score === null)
    ) fail();
    if (
      percentile && (percentile.profile_version !== profile.profile_id ||
        percentile.exam_id !== profile.scores.exam_id ||
        percentile.pack_version !== profile.scores.pack_version ||
        percentile.academic_year !== 2027 ||
        !["ready", "pending"].includes(String(percentile.status)) ||
        !scalar(percentile.top_percent) ||
        percentile.status === "ready" && percentile.top_percent === null ||
        percentile.status === "pending" && percentile.top_percent !== null)
    ) fail();
    const percentileBound = percentile?.status === "ready" && conversion?.status === "ready" &&
      identifier(conversion.rule_version) && percentile.rule_version === conversion.rule_version &&
      identifier(percentile.curve_version) && identifier(percentile.source_model_version);
    let compatibilityPercentile: NativeJson = null;
    if (percentileBound && percentile && object(analysis)) {
      if (!Object.hasOwn(analysis, "converted_percentile")) {
        compatibilityPercentile = cloneNativeJson(percentile.top_percent);
      } else if (
        scalar(analysis.converted_percentile) && analysis.converted_percentile !== null &&
        nativeJsonText(analysis.converted_percentile) === nativeJsonText(percentile.top_percent)
      ) {
        compatibilityPercentile = cloneNativeJson(analysis.converted_percentile);
      }
    }
    results.push({
      offering_id: id,
      university_name: label(offering.university_name),
      department: label(offering.department),
      assessment: object(analysis) ? cloneNativeJson(analysis) : null,
      converted_score: conversion ? cloneNativeJson(conversion.converted_score) : null,
      converted_score_status: conversion && typeof conversion.status === "string"
        ? conversion.status
        : "pending",
      converted_score_reason: conversion && typeof conversion.reason_code === "string"
        ? conversion.reason_code
        : null,
      score_basis: conversion && typeof conversion.score_basis === "string"
        ? conversion.score_basis
        : null,
      converted_percentile: compatibilityPercentile,
      top_percent: percentileBound && percentile ? cloneNativeJson(percentile.top_percent) : null,
      top_percent_status: percentileBound ? "ready" : "pending",
      top_percent_reason: percentile?.status === "ready" && !percentileBound
        ? "percentile_binding_incomplete"
        : percentile && typeof percentile.reason_code === "string"
        ? percentile.reason_code
        : null,
      rule_version: conversion && typeof conversion.rule_version === "string"
        ? conversion.rule_version
        : null,
      conversion_version: conversion && typeof conversion.release_version === "string"
        ? conversion.release_version
        : null,
      curve_version: percentile && typeof percentile.curve_version === "string"
        ? percentile.curve_version
        : null,
      model_version: percentile && typeof percentile.source_model_version === "string"
        ? percentile.source_model_version
        : null,
    });
  }
  const document: NativeObject = {
    format: "jungsi.member-school-results/v1",
    owner_binding: owner,
    profile_id: profile.profile_id,
    profile_fingerprint: await nativeJsonSha256(profile.scores),
    report_id: report.report_id,
    report_revision: report.revision,
    academic_year: 2027,
    exam_id: profile.scores.exam_id,
    pack_version: profile.scores.pack_version,
    offerings: results,
  };
  return { ...document, native_result_hash: await nativeJsonSha256(document) };
}

/** Prepare all selected results in bounded immutable objects. This does not write
 * them or advance a report. A caller must verify every object before publishing
 * all of their references together through the report's existing CAS. */
export async function projectMemberSchoolResultBatches(
  owner: string,
  profile: StoredProfile,
  report: StoredReport,
  offerings: readonly Readonly<NativeObject>[],
  maxPerBatch = 100,
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<NativeObject[]> {
  if (
    !profile || !report || !object(profile.scores) || !object(report.body) ||
    !Array.isArray(offerings) || !Number.isSafeInteger(maxPerBatch) ||
    maxPerBatch < 1 || maxPerBatch > 100 || !Number.isSafeInteger(maxBytes) || maxBytes < 1
  ) fail();
  // Work from a stable snapshot even when hashing yields to the event loop.
  const safeProfile: StoredProfile = { ...profile, scores: cloneNativeJson(profile.scores) };
  const safeReport: StoredReport = { ...report, body: cloneNativeJson(report.body) };
  const safeOfferings = offerings.map((row) => cloneNativeJson(row as NativeObject));
  const ids = new Set<string>();
  for (const row of safeOfferings) {
    if (
      !object(row) || row.academic_year !== 2027 || !identifier(row.offering_id) ||
      ids.has(row.offering_id)
    ) fail();
    ids.add(row.offering_id);
  }
  if (!safeOfferings.length) {
    // Still validate the report/profile instead of silently accepting another owner.
    await projectMemberSchoolResults(owner, safeProfile, safeReport, []);
    return [];
  }
  const documents: NativeObject[] = [];
  let offset = 0;
  while (offset < safeOfferings.length) {
    let size = Math.min(maxPerBatch, safeOfferings.length - offset);
    for (;;) {
      const document = await projectMemberSchoolResults(
        owner,
        safeProfile,
        safeReport,
        safeOfferings.slice(offset, offset + size),
      );
      if (new TextEncoder().encode(nativeJsonText(document, true)).byteLength <= maxBytes) {
        documents.push(document);
        offset += size;
        break;
      }
      if (size === 1) fail();
      size = Math.max(1, Math.floor(size / 2));
    }
  }
  return documents;
}

/** Combine independently verified private objects with legacy inline analyses.
 * The caller must retrieve each object through the ownership-bound storage port;
 * these checks additionally reject mismatched reports and conflicting PKs. */
export async function composeMemberSchoolResults(
  owner: string,
  profile: StoredProfile,
  report: StoredReport,
  documents: readonly Readonly<NativeObject>[],
): Promise<{ analyses: NativeObject; offerings: NativeObject[] }> {
  if (
    !profile || !report || profile.owner_id !== owner || report.owner_id !== owner ||
    report.profile_id !== profile.profile_id || !profile.confirmed ||
    !object(profile.scores) || !object(report.body) || !object(report.body.analyses) ||
    !identifier(profile.scores.exam_id) || !identifier(profile.scores.pack_version) ||
    !Number.isSafeInteger(report.revision) || report.revision < 1 ||
    !Array.isArray(documents)
  ) fail();
  const safeProfile: StoredProfile = { ...profile, scores: cloneNativeJson(profile.scores) };
  const safeReport: StoredReport = { ...report, body: cloneNativeJson(report.body) };
  const safeDocuments = documents.map((document) => cloneNativeJson(document as NativeObject));
  const fingerprint = await nativeJsonSha256(safeProfile.scores);
  const analyses = cloneNativeJson(safeReport.body.analyses as NativeObject);
  const rows: NativeObject[] = [];
  const ids = new Set<string>();
  for (const document of safeDocuments) {
    if (
      !object(document) || document.format !== "jungsi.member-school-results/v1" ||
      document.owner_binding !== owner || document.report_id !== safeReport.report_id ||
      document.profile_id !== safeProfile.profile_id ||
      document.profile_fingerprint !== fingerprint ||
      document.academic_year !== 2027 || document.exam_id !== safeProfile.scores.exam_id ||
      document.pack_version !== safeProfile.scores.pack_version ||
      typeof document.report_revision !== "number" ||
      !Number.isSafeInteger(document.report_revision) ||
      document.report_revision < 1 || document.report_revision > safeReport.revision ||
      !Array.isArray(document.offerings) || document.offerings.length > 100 ||
      typeof document.native_result_hash !== "string"
    ) fail();
    const content = { ...document };
    delete content.native_result_hash;
    if (await nativeJsonSha256(content) !== document.native_result_hash) fail();
    for (const row of document.offerings) {
      if (!object(row) || !identifier(row.offering_id) || ids.has(row.offering_id)) fail();
      ids.add(row.offering_id);
      if (row.assessment !== null) {
        if (
          !object(row.assessment) || row.assessment.offering_id !== undefined &&
            row.assessment.offering_id !== row.offering_id
        ) fail();
        const previous = analyses[row.offering_id];
        if (
          previous !== undefined &&
          nativeJsonText(previous, true) !== nativeJsonText(row.assessment, true)
        ) fail();
        analyses[row.offering_id] = restoreMissingSummaries(row.assessment, row, safeProfile);
      }
      rows.push(cloneNativeJson(row));
    }
  }
  return { analyses, offerings: rows };
}
