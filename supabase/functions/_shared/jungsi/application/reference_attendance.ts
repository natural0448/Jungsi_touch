/** User self-attestation bound by the server to one already confirmed profile and exam. */
import { AccessError } from "./access.ts";
import type { StoredProfile } from "./platform_repository.ts";
import { JsonFloat } from "../domain/native_json.ts";
export const ATTENDANCE_AREAS = [
  "korean",
  "math",
  "english",
  "korean_history",
  "inquiry_1",
  "inquiry_2",
] as const;
export type AttendanceArea = typeof ATTENDANCE_AREAS[number];
export type AttendanceConfirmation = Readonly<
  {
    profileId: string;
    examId: string;
    packVersion: string;
    areas: Readonly<Record<AttendanceArea, boolean>>;
    kind: "self_reported";
  }
>;
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
}
/** False, null, absence and a mismatched profile are unconfirmed; malformed types are invalid. */
export function referenceAttendance(
  raw: unknown,
  profile: StoredProfile,
): AttendanceConfirmation | null {
  if (raw === undefined || raw === null) return null;
  if (
    !object(raw) ||
    Object.keys(raw).some((k) =>
      !["profile_id", "exam_id", "pack_version", ...ATTENDANCE_AREAS].includes(k)
    )
  ) throw new AccessError("invalid_request", 422);
  for (const k of ["profile_id", "exam_id", "pack_version"]) {
    if (raw[k] !== undefined && raw[k] !== null && typeof raw[k] !== "string") {
      throw new AccessError("invalid_request", 422);
    }
  }
  for (const k of ATTENDANCE_AREAS) {
    if (raw[k] !== undefined && raw[k] !== null && typeof raw[k] !== "boolean") {
      throw new AccessError("invalid_request", 422);
    }
  }
  if (
    raw.profile_id !== profile.profile_id || raw.exam_id !== profile.scores.exam_id ||
    raw.pack_version !== profile.scores.pack_version ||
    typeof profile.scores.exam_id !== "string" || typeof profile.scores.pack_version !== "string"
  ) return null;
  const areas = Object.fromEntries(ATTENDANCE_AREAS.map((k) => [k, raw[k] === true])) as Record<
    AttendanceArea,
    boolean
  >;
  return Object.freeze({
    profileId: profile.profile_id,
    examId: profile.scores.exam_id,
    packVersion: profile.scores.pack_version,
    areas: Object.freeze(areas),
    kind: "self_reported",
  });
}
export function attendanceAllowed(
  required: readonly AttendanceArea[],
  confirmation: AttendanceConfirmation | null | undefined,
  profile: string,
  exam: string,
  pack: string,
): boolean {
  return !required.length ||
    !!confirmation && confirmation.kind === "self_reported" && confirmation.profileId === profile &&
      confirmation.examId === exam && confirmation.packVersion === pack &&
      required.every((k) => confirmation.areas[k] === true);
}
