/** Explicit professional policy. Missing limits or authority never mean unlimited access. */
import { AccessError } from "./access.ts";
import { ApprovedOperatingPolicy } from "./operating_policy.ts";
import type { VerifiedUser } from "./ports.ts";
import type { ProfessionalAuthority, ProfessionalStudent } from "./professional_ports.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { cloneNativeJson, nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { utcInstant } from "../domain/time.ts";

export function proId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new AccessError("invalid_identifier", 422);
  }
  return value;
}
export function proInteger(value: unknown, minimum = 0): number {
  if (typeof value === "bigint") {
    if (value < BigInt(minimum) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new AccessError("invalid_request", 422);
    }
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new AccessError("invalid_request", 422);
  }
  return value;
}
export function proObject(value: unknown): NativeObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonFloat) {
    throw new AccessError("invalid_request", 422);
  }
  return value as NativeObject;
}
export function proShape(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): NativeObject {
  const row = proObject(value);
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw new AccessError("invalid_request", 422);
  }
  return row;
}
export function proFresh(user: VerifiedUser, now: bigint): void {
  if (typeof now !== "bigint" || user.expiresAtUtc <= now) {
    throw new AccessError("authentication_required", 401);
  }
  if (user.accountStatus !== "active") throw new AccessError("professional_access_denied", 403);
}
export function proFreshAdmin(user: VerifiedUser, now: bigint): void {
  proFresh(user, now);
  if (user.accountRole !== "admin" || user.assuranceLevel !== "aal2") {
    throw new AccessError("professional_access_denied", 403);
  }
}
function unavailable(): never {
  throw new AccessError("professional_policy_unavailable", 503);
}
export class ProfessionalPolicy {
  readonly version: string;
  readonly approvalSha256: string;
  readonly expiresAtUtc: bigint;
  readonly operating: ApprovedOperatingPolicy;
  readonly maxPageRows: number;
  readonly maxRosterRows: number;
  readonly maxBodyBytes: number;
  readonly maxResultBytes: number;
  readonly maxTags: number;
  readonly maxTextCharacters: number;
  readonly maxMemoCharacters: number;
  readonly cursorLifetimeMicroseconds: bigint;
  readonly registrySha256: string;
  readonly selectionSha256: string;
  constructor(
    raw: NativeJson,
    binding: {
      readonly approvalSha256: string;
      readonly registrySha256: string;
      readonly selectionSha256: string;
      readonly expiresAtUtc: bigint;
    },
  ) {
    try {
      const r = proShape(cloneNativeJson(raw), [
        "format",
        "status",
        "purpose",
        "version",
        "approval_reference_sha256",
        "expires_at",
        "exams",
        "limits",
        "operating_policy",
      ]);
      if (
        r.format !== "jungsi.professional-policy/v1" || r.status !== "approved" ||
        r.purpose !== "professional_student_analysis" ||
        r.approval_reference_sha256 !== binding.approvalSha256 ||
        !/^[a-f0-9]{64}$/.test(binding.approvalSha256) || !Array.isArray(r.exams)
      ) unavailable();
      this.version = proId(r.version);
      if (
        ![binding.registrySha256, binding.selectionSha256].every((v) => /^[a-f0-9]{64}$/.test(v))
      ) unavailable();
      this.registrySha256 = binding.registrySha256;
      this.selectionSha256 = binding.selectionSha256;
      this.approvalSha256 = binding.approvalSha256;
      if (typeof r.expires_at !== "string") unavailable();
      this.expiresAtUtc = utcInstant(r.expires_at);
      if (this.expiresAtUtc > binding.expiresAtUtc) unavailable();
      const limits = proShape(r.limits, [
        "max_page_rows",
        "max_roster_rows",
        "max_body_bytes",
        "max_result_bytes",
        "max_tags",
        "max_text_characters",
        "max_memo_characters",
        "cursor_lifetime_seconds",
      ]);
      this.maxPageRows = proInteger(limits.max_page_rows, 1);
      this.maxRosterRows = proInteger(limits.max_roster_rows, 1);
      this.maxBodyBytes = proInteger(limits.max_body_bytes, 1);
      this.maxResultBytes = proInteger(limits.max_result_bytes, 1);
      this.maxTags = proInteger(limits.max_tags, 1);
      this.maxTextCharacters = proInteger(limits.max_text_characters, 1);
      this.maxMemoCharacters = proInteger(limits.max_memo_characters, 1);
      this.cursorLifetimeMicroseconds = BigInt(proInteger(limits.cursor_lifetime_seconds, 1)) *
        1000000n;
      if (
        this.maxPageRows > this.maxRosterRows || this.maxBodyBytes > 1048576 ||
        this.maxResultBytes > 8388608
      ) unavailable();
      const exams = new Map<string, { packVersion: string; academicYear: number }>();
      for (const value of r.exams) {
        const exam = proShape(value, ["exam_id", "pack_version", "academic_year"]),
          examId = proId(exam.exam_id);
        if (exams.has(examId)) unavailable();
        exams.set(examId, {
          packVersion: proId(exam.pack_version),
          academicYear: proInteger(exam.academic_year, 1),
        });
      }
      if (!exams.size) unavailable();
      this.operating = new ApprovedOperatingPolicy(r.operating_policy, {
        policyVersion: this.version,
        approvalSha256: binding.approvalSha256,
        expiresAtUtc: this.expiresAtUtc,
        exams,
        registrySha256: binding.registrySha256,
        selectionSha256: binding.selectionSha256,
      });
    } catch {
      unavailable();
    }
  }
  assertLive(now: bigint): void {
    if (typeof now !== "bigint" || now >= this.expiresAtUtc) unavailable();
    this.operating.assertLive(now);
  }
  contextSha256(): Promise<string> {
    return nativeJsonSha256({
      policy: this.version,
      approval: this.approvalSha256,
      registry: this.registrySha256,
      selection: this.selectionSha256,
      calculation: this.operating.calculationVersion,
    });
  }
  stage(
    authority: ProfessionalAuthority,
    exam: unknown,
    pack: unknown,
    stage: unknown,
    now: bigint,
    requireOpen = true,
  ) {
    this.assertLive(now);
    const selected = this.operating.stage(exam, stage, now, requireOpen);
    if (
      selected.packVersion !== pack || selected.academicYear !== authority.contract.academicYear ||
      !authority.contract.approvedExamIds.includes(selected.examId)
    ) throw new AccessError("professional_exam_unavailable", 503);
    return selected;
  }
  assertAuthority(authority: ProfessionalAuthority, now: bigint): void {
    this.assertLive(now);
    proFresh(authority.user, now);
    const c = authority.contract;
    if (c.startsAtUtc > now || c.expiresAtUtc <= now) {
      throw new AccessError("professional_contract_inactive", 403);
    }
    if (
      !Number.isSafeInteger(c.studentCapacity) || c.studentCapacity < 1 ||
      !Number.isSafeInteger(c.version) || c.version < 1
    ) unavailable();
    if (
      authority.mode === "member" &&
      (!authority.membership?.active ||
        authority.membership.subjectId !== authority.user.subjectId ||
        authority.membership.orgId !== c.orgId)
    ) {
      throw new AccessError("professional_access_denied", 403);
    }
    if (authority.mode !== "member") proFreshAdmin(authority.user, now);
  }
  assertStudent(
    authority: ProfessionalAuthority,
    student: ProfessionalStudent | null,
    operation: string,
    now: bigint,
  ): asserts student is ProfessionalStudent {
    this.assertAuthority(authority, now);
    if (
      !student || student.orgId !== authority.contract.orgId ||
      student.contractId !== authority.contract.contractId ||
      student.academicYear !== authority.contract.academicYear
    ) {
      throw new AccessError("professional_student_not_found", 404);
    }
    if (authority.mode === "support") {
      if (
        operation !== "pro.correction.grant" || authority.supportStudentId !== student.studentId ||
        !authority.ticketRef
      ) throw new AccessError("professional_student_not_found", 404);
      return;
    }
    if (authority.mode !== "member") throw new AccessError("professional_access_denied", 403);
    const role = authority.membership!.role,
      assigned = student.assignedSubjectIds.includes(authority.user.subjectId);
    if (role !== "org_admin" && !assigned) {
      throw new AccessError("professional_student_not_found", 404);
    }
    const teacherOnly = [
      "pro.score.create",
      "pro.overall.analyze",
      "pro.university.analyze",
      "pro.candidates",
      "pro.bookmark.add",
      "pro.bookmark.remove",
    ];
    if (teacherOnly.includes(operation) && (role !== "teacher" || !assigned)) {
      throw new AccessError("professional_access_denied", 403);
    }
    if (["pro.student.assign", "pro.student.archive"].includes(operation)) {
      if (role !== "org_admin" || authority.user.assuranceLevel !== "aal2") {
        throw new AccessError("professional_access_denied", 403);
      }
    }
    if (
      role === "viewer" &&
      !["pro.report.list", "pro.report.read", "pro.bookmark.list", "pro.report.export"].includes(
        operation,
      )
    ) {
      throw new AccessError("professional_access_denied", 403);
    }
    if (operation === "pro.correction.grant") {
      throw new AccessError("professional_access_denied", 403);
    }
  }
}
