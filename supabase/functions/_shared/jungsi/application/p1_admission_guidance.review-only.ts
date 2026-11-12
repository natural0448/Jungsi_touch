/** Review candidate: shape and source-text integrity, not issuer authorization.
 * Only the existing server Owner descriptor/page binding and publication gate can
 * authorize delivery. A hash, a status string, or this module alone grants nothing. */
import { AccessError } from "./access.ts";
import { hasAsciiControl } from "../domain/text.ts";
import { calendarDate } from "../domain/time.ts";
import type { NativeObject } from "../domain/json_value.ts";
const HASH = /^[a-f0-9]{64}$/;
export const ADMISSION_GUIDANCE_FIELDS = ["applicant_eligibility", "selection_method"] as const;
function fail(): never {
  throw new AccessError("snapshot_invalid", 503);
}
function exact(raw: unknown, keys: readonly string[]): NativeObject {
  if (
    !raw || typeof raw !== "object" || Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  ) fail();
  const actual = Reflect.ownKeys(raw);
  if (
    actual.length !== keys.length || actual.some((k) => typeof k !== "string" || !keys.includes(k))
  ) fail();
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    if (!d || !d.enumerable || !("value" in d)) fail();
  }
  return raw as NativeObject;
}
function publicUrl(raw: unknown): void {
  if (typeof raw !== "string" || raw.length > 2048 || hasAsciiControl(raw)) fail();
  try {
    const u = new URL(raw);
    if (
      !["http:", "https:"].includes(u.protocol) || !u.hostname || u.username || u.password ||
      u.hostname.endsWith(".supabase.co") || u.hostname === "localhost" ||
      u.hostname.includes(":") ||
      /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(u.hostname) ||
      /\/storage\/v1\//.test(decodeURIComponent(u.pathname).toLowerCase()) ||
      [...u.searchParams.keys()].some((k) =>
        /token|authorization|api[_-]?key|signature|credential|secret|password|cookie|^x-amz-|^x-goog-/i
          .test(k)
      ) ||
      /token|api[_-]?key|signature|secret/i.test(u.hash)
    ) fail();
  } catch {
    fail();
  }
}
/** Public shape only. This function does not verify Owner/source authority. */
export function validatePublicAdmissionGuidance(raw: unknown): NativeObject {
  const v = exact(raw, ["status", "text", "source_url", "source_as_of"]);
  if (v.status === "pending") {
    if (v.text !== null || v.source_url !== null || v.source_as_of !== null) fail();
  } else if (v.status === "verified_official") {
    if (
      typeof v.text !== "string" || !v.text.trim() || v.text.length > 2048 ||
      hasAsciiControl(v.text.replaceAll("\n", ""))
    ) fail();
    if (v.source_url !== null) publicUrl(v.source_url);
    if (v.source_as_of !== null) {
      try {
        if (typeof v.source_as_of !== "string") fail();
        calendarDate(v.source_as_of as string);
      } catch {
        fail();
      }
    }
  } else fail();
  return { status: v.status, text: v.text, source_url: v.source_url, source_as_of: v.source_as_of };
}
/** Private Owner evidence remains in the source page and never enters the DTO. */
export function projectOwnerAdmissionGuidance(raw: unknown): NativeObject {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
  const status = Object.getOwnPropertyDescriptor(raw, "status")?.value;
  const names = ["status", "text", "source_url", "source_as_of"];
  const v = exact(
    raw,
    status === "verified_official"
      ? [...names, "source_document_sha256", "source_text_sha256"]
      : names,
  );
  const result = validatePublicAdmissionGuidance(Object.fromEntries(names.map((k) => [k, v[k]])));
  if (
    status === "verified_official" &&
    (typeof v.source_document_sha256 !== "string" || !HASH.test(v.source_document_sha256) ||
      typeof v.source_text_sha256 !== "string" || !HASH.test(v.source_text_sha256))
  ) fail();
  return result;
}
/** The existing Owner must attest that the document/span applies to this exact row.
 * This checks exact text bytes only; it does not infer document or issuer approval. */
export async function verifyOwnerAdmissionGuidanceRow(row: unknown): Promise<void> {
  if (!row || typeof row !== "object" || Array.isArray(row)) fail();
  for (const field of ADMISSION_GUIDANCE_FIELDS) {
    if (Object.hasOwn(row, field)) {
      const value = (row as NativeObject)[field], projection = projectOwnerAdmissionGuidance(value);
      if (projection.status === "verified_official") {
        const digest = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(projection.text as string),
          ),
        );
        const textHash = [...digest].map((v) => v.toString(16).padStart(2, "0")).join("");
        if (textHash !== (value as NativeObject).source_text_sha256) fail();
      }
    }
  }
}

/** A source claim alone never authorizes display. An unavailable or invalid field
 * remains pending while other rows and fields remain independently usable. */
export function pendingAdmissionGuidance(): NativeObject {
  return { status: "pending", text: null, source_url: null, source_as_of: null };
}
export async function candidateOwnerAdmissionGuidance(raw: unknown): Promise<NativeObject> {
  try {
    const output = projectOwnerAdmissionGuidance(raw);
    await verifyOwnerAdmissionGuidanceRow({ applicant_eligibility: raw } as NativeObject);
    return output;
  } catch {
    return pendingAdmissionGuidance();
  }
}

/** Optional field results of the existing Owner review, never a new authority.
 * Target data must come from that same Owner bridge's already checked resolver. */
export async function guidanceFromExistingOwnerReview(
  source: NativeObject,
  rawReview: unknown,
  target: Readonly<Record<string, unknown>>,
  rawPublicUrlReview?: unknown,
  rawSourceDateReview?: unknown,
): Promise<NativeObject> {
  const result: NativeObject = {};
  for (const field of ADMISSION_GUIDANCE_FIELDS) {
    if (!Object.hasOwn(source, field)) continue;
    result[field] = pendingAdmissionGuidance();
    try {
      const sourceValue = source[field] as NativeObject;
      const candidate = await candidateOwnerAdmissionGuidance(sourceValue);
      if (
        candidate.status !== "verified_official" || !rawReview || typeof rawReview !== "object" ||
        Array.isArray(rawReview)
      ) continue;
      const raw = Object.getOwnPropertyDescriptor(rawReview, field)?.value;
      const proof = exact(raw, [
        "decision",
        "source_document_sha256",
        "source_text_sha256",
        "guide_head_sha256",
        "guide_row_sha256",
        "release_id",
        "offering_pk",
      ]);
      if (
        proof.decision === "VERIFIED" &&
        proof.source_document_sha256 === sourceValue.source_document_sha256 &&
        proof.source_text_sha256 === sourceValue.source_text_sha256 &&
        (["guide_head_sha256", "guide_row_sha256", "release_id", "offering_pk"] as const).every((
          k,
        ) => proof[k] === target[k])
      ) {
        const approvedUrl = rawPublicUrlReview && typeof rawPublicUrlReview === "object" &&
            !Array.isArray(rawPublicUrlReview)
          ? Object.getOwnPropertyDescriptor(rawPublicUrlReview, field)?.value
          : undefined;
        const approvedDate = rawSourceDateReview && typeof rawSourceDateReview === "object" &&
            !Array.isArray(rawSourceDateReview)
          ? Object.getOwnPropertyDescriptor(rawSourceDateReview, field)?.value
          : undefined;
        result[field] = {
          ...candidate,
          source_url: approvedUrl === candidate.source_url ? candidate.source_url : null,
          source_as_of: approvedDate === candidate.source_as_of ? candidate.source_as_of : null,
        };
      }
    } catch { /* an invalid individual field is pending, never a different row */ }
  }
  return result;
}

/** Single composer lacks per-field Owner review. Keep the current row and carry
 * only a pending marker; the previous immutable snapshot retains its old value. */
export function singleSnapshotPendingGuidance(
  projected: NativeObject,
  previous: NativeObject | undefined,
): NativeObject {
  const result: NativeObject = {};
  const prior = previous?.r27_source as NativeObject | undefined;
  for (const field of ADMISSION_GUIDANCE_FIELDS) {
    if (Object.hasOwn(projected, field) || (prior && Object.hasOwn(prior, field))) {
      result[field] = pendingAdmissionGuidance();
    }
  }
  return result;
}
