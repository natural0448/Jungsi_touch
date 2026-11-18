/** Approved read-only authority function adapter. No guessed EduTouch relation or grant. */
import { AccessError } from "../application/access.ts";
import type {
  ProfessionalAuthority,
  ProfessionalAuthorityPort,
  ProfessionalMembership,
} from "../application/professional_ports.ts";
import {
  proFresh,
  proFreshAdmin,
  proId,
  proInteger,
  proObject,
} from "../application/professional_policy.ts";
import type { VerifiedUser } from "../application/ports.ts";
import { nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { sqlObjectText } from "./sql_values.ts";

export interface ProfessionalAuthorityFunctionBinding {
  readonly status: "approved";
  readonly schema: string;
  readonly name: string;
  readonly owner: string;
  readonly definitionSha256: string;
  readonly maxResultBytes: number;
}
export type ProfessionalAuthorityQuery = (
  statement: string,
  parameters: readonly unknown[],
) => Promise<unknown[][]>;
const ARGUMENTS = "uuid,text,text,text,timestamp with time zone";
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
function fail(): never {
  throw new AccessError("professional_authority_unavailable", 503);
}
function list(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 2000) fail();
  return value.map(proId);
}
function member(value: unknown, orgId: string): ProfessionalMembership {
  const r = proObject(value);
  if (
    r.org_id !== orgId || !["teacher", "org_admin", "viewer"].includes(String(r.role)) ||
    typeof r.active !== "boolean"
  ) fail();
  return {
    orgId,
    memberId: proId(r.member_id),
    subjectId: proId(r.subject_id),
    role: r.role as ProfessionalMembership["role"],
    version: proInteger(r.version, 1),
    active: r.active,
  };
}
export class SupabaseProfessionalAuthority implements ProfessionalAuthorityPort {
  private readonly functionName: string;
  private readonly receipts = new WeakMap<
    ProfessionalAuthority,
    { fingerprint: string; members: readonly ProfessionalMembership[] }
  >();
  constructor(
    private readonly binding: ProfessionalAuthorityFunctionBinding,
    private readonly query: ProfessionalAuthorityQuery,
    /** 선택: 구성원 이름 함수(013 jeongsi_pro_member_names(uuid,text,text[])). 없으면 이름 없이 동작한다 */
    private readonly namesBinding: ProfessionalAuthorityFunctionBinding | null = null,
  ) {
    if (
      !binding || binding.status !== "approved" || !IDENTIFIER.test(binding.schema) ||
      !IDENTIFIER.test(binding.name) ||
      !IDENTIFIER.test(binding.owner) || !/^[a-f0-9]{64}$/.test(binding.definitionSha256) ||
      !Number.isSafeInteger(binding.maxResultBytes) || binding.maxResultBytes < 1 ||
      binding.maxResultBytes > 1048576
    ) fail();
    this.functionName = '"' + binding.schema + '"."' + binding.name + '"';
  }
  private async read(
    user: VerifiedUser,
    orgId: string | null,
    mode: string,
    now: bigint,
    ticket: string | null,
  ): Promise<NativeObject> {
    proFresh(user, now);
    if (mode === "support" || mode === "retention") proFreshAdmin(user, now);
    const signature = this.binding.schema + "." + this.binding.name + "(" + ARGUMENTS + ")";
    const metadata = await this.query(
      `SELECT pg_get_userbyid(p.proowner),p.provolatile::text,p.proretset,
 p.prorettype::text,p.proconfig::text,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
 has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),
 has_function_privilege('jungsi_backend_app',p.oid,'EXECUTE')
 FROM pg_proc p WHERE p.oid=to_regprocedure($1)`,
      [signature],
    );
    if (metadata.length !== 1 || metadata[0].length !== 9) fail();
    const m = metadata[0];
    if (
      m[0] !== this.binding.owner || m[1] !== "s" || m[2] !== false || m[3] !== "3802" ||
      m[4] !== "{search_path=pg_catalog}" || m[5] !== this.binding.definitionSha256 ||
      m[6] !== false || m[7] !== false || m[8] !== true
    ) fail();
    const result = await this.query(
      `SELECT ${this.functionName}($1::uuid,$2::text,$3::text,$4::text,$5::timestamptz)::text`,
      [user.subjectId, orgId, mode, ticket, utcText(now)],
    );
    if (result.length !== 1 || result[0].length !== 1) fail();
    const row = sqlObjectText(result[0][0], this.binding.maxResultBytes);
    if (
      row.format !== "jungsi.professional-authority/v1" || row.subject_id !== user.subjectId ||
      row.account_status !== "active" || !Array.isArray(row.organizations)
    ) fail();
    if (mode !== "member" && mode !== "list") {
      proFreshAdmin(user, now);
      if (row.account_role !== "admin") throw new AccessError("professional_access_denied", 403);
    }
    return row;
  }
  private async decode(
    user: VerifiedUser,
    raw: unknown,
    mode: ProfessionalAuthority["mode"],
    now: bigint,
    ticket: string | null,
  ): Promise<ProfessionalAuthority> {
    const row = proObject(raw), c = proObject(row.contract), orgId = proId(c.org_id);
    if (
      c.status !== "active" || typeof c.starts_at_utc !== "string" ||
      typeof c.expires_at_utc !== "string" || typeof row.source_version !== "string" ||
      !Array.isArray(row.members)
    ) fail();
    if (typeof c.org_name !== "string" || !c.org_name.trim() || c.org_name.length > 256) fail();
    if (mode !== "member" && row.authorized_mode !== mode) {
      throw new AccessError("professional_access_denied", 403);
    }
    const members = row.members.map((v) => member(v, orgId));
    if (new Set(members.map((m) => m.subjectId)).size !== members.length) fail();
    const membership = members.find((m) => m.subjectId === user.subjectId) ?? null;
    const a: ProfessionalAuthority = Object.freeze({
      user,
      mode,
      sourceVersion: proId(row.source_version),
      evaluatedAtUtc: now,
      contract: Object.freeze({
        orgId,
        orgName: c.org_name,
        contractId: proId(c.contract_id),
        academicYear: proInteger(c.academic_year, 1),
        version: proInteger(c.version, 1),
        startsAtUtc: utcInstant(c.starts_at_utc),
        expiresAtUtc: utcInstant(c.expires_at_utc),
        studentCapacity: proInteger(c.contracted_student_count, 1),
        approvedExamIds: list(c.approved_exam_ids),
      }),
      membership,
      ticketRef: mode === "support" ? proId(row.ticket_ref) : null,
      supportStudentId: mode === "support" ? proId(row.student_id) : null,
      supportExamId: mode === "support" ? proId(row.exam_id) : null,
      supportStage:
        mode === "support" && ["mock", "provisional", "final"].includes(String(row.stage))
          ? row.stage as ProfessionalAuthority["supportStage"]
          : null,
    });
    if (a.contract.startsAtUtc > now || a.contract.expiresAtUtc <= now) {
      throw new AccessError("professional_contract_inactive", 403);
    }
    if (mode === "member" && !membership?.active) {
      throw new AccessError("professional_student_not_found", 404);
    }
    if (mode === "support" && (a.ticketRef !== ticket || a.supportStage === null)) {
      throw new AccessError("professional_student_not_found", 404);
    }
    const fingerprint = await nativeJsonSha256({
      mode,
      source_version: a.sourceVersion,
      contract: {
        org_id: a.contract.orgId,
        contract_id: a.contract.contractId,
        academic_year: a.contract.academicYear,
        version: a.contract.version,
        starts_at: String(a.contract.startsAtUtc),
        expires_at: String(a.contract.expiresAtUtc),
        capacity: a.contract.studentCapacity,
        exams: [...a.contract.approvedExamIds].sort(),
      },
      members: [...members].sort((x, y) => x.subjectId.localeCompare(y.subjectId)).map((m) => ({
        member_id: m.memberId,
        subject_id: m.subjectId,
        role: m.role,
        version: m.version,
        active: m.active,
      })),
      ticket: a.ticketRef,
      support_student: a.supportStudentId,
      support_exam: a.supportExamId,
      support_stage: a.supportStage,
    });
    this.receipts.set(a, { fingerprint, members });
    return a;
  }
  async organizations(user: VerifiedUser, now: bigint): Promise<readonly ProfessionalAuthority[]> {
    const row = await this.read(user, null, "list", now, null);
    const result = await Promise.all(
      (row.organizations as unknown[]).map((v) => this.decode(user, v, "member", now, null)),
    );
    if (new Set(result.map((a) => a.contract.orgId)).size !== result.length) fail();
    return result;
  }
  async resolve(
    user: VerifiedUser,
    orgId: string,
    mode: ProfessionalAuthority["mode"],
    now: bigint,
    ticketRef?: string,
  ): Promise<ProfessionalAuthority> {
    const row = await this.read(user, proId(orgId), mode, now, ticketRef ?? null);
    if ((row.organizations as unknown[]).length !== 1) {
      throw new AccessError("professional_student_not_found", 404);
    }
    const a = await this.decode(
      user,
      (row.organizations as unknown[])[0],
      mode,
      now,
      ticketRef ?? null,
    );
    if (a.contract.orgId !== orgId) throw new AccessError("professional_student_not_found", 404);
    return a;
  }
  async assertCurrent(authority: ProfessionalAuthority, now: bigint): Promise<void> {
    const proof = this.receipts.get(authority);
    if (!proof) fail();
    const current = await this.resolve(
      authority.user,
      authority.contract.orgId,
      authority.mode,
      now,
      authority.ticketRef ?? undefined,
    );
    if (this.receipts.get(current)?.fingerprint !== proof.fingerprint) {
      throw new AccessError("professional_authority_changed", 409);
    }
  }
  /**
   * 기관 관리자에게만 같은 기관 구성원 이름. 함수 지문·주인·권한이 승인 값과 다르거나 읽기에 실패하면
   * 이름 없이(빈 객체) 돌려준다 — 이름이 없어도 구성원 목록 자체는 막지 않는다
   */
  async memberNames(authority: ProfessionalAuthority): Promise<Readonly<Record<string, string>>> {
    const proof = this.receipts.get(authority), b = this.namesBinding;
    if (!proof) fail();
    if (authority.membership?.role !== "org_admin") {
      throw new AccessError("professional_access_denied", 403);
    }
    if (
      !b || b.status !== "approved" || !IDENTIFIER.test(b.schema) || !IDENTIFIER.test(b.name) ||
      !IDENTIFIER.test(b.owner) || !/^[a-f0-9]{64}$/.test(b.definitionSha256) ||
      !Number.isSafeInteger(b.maxResultBytes) || b.maxResultBytes < 1 || b.maxResultBytes > 1048576
    ) return {};
    try {
      const metadata = await this.query(
        `SELECT pg_get_userbyid(p.proowner),p.provolatile::text,p.proretset,
 p.prorettype::text,p.proconfig::text,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
 has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),
 has_function_privilege('jungsi_backend_app',p.oid,'EXECUTE')
 FROM pg_proc p WHERE p.oid=to_regprocedure($1)`,
        [b.schema + "." + b.name + "(uuid,text,text[])"],
      );
      const m = metadata[0];
      if (
        metadata.length !== 1 || m.length !== 9 || m[0] !== b.owner || m[1] !== "s" ||
        m[2] !== false || m[3] !== "3802" || m[4] !== "{search_path=pg_catalog}" ||
        m[5] !== b.definitionSha256 || m[6] !== false || m[7] !== false || m[8] !== true
      ) return {};
      // 013 함수는 한 번에 구성원 번호 최대 100개를 받는다. 승인 명단의 번호만 100개씩 나눠 묻는다
      const ids = [...new Set(proof.members.map((x) => x.memberId))]
        .filter((id) => /^[0-9]{1,18}$/.test(id));
      const known = new Set(ids), out: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 100) {
        const result = await this.query(
          `SELECT "${b.schema}"."${b.name}"($1::uuid,$2::text,
 ARRAY(SELECT jsonb_array_elements_text($3::jsonb)))::text`,
          [
            authority.user.subjectId,
            authority.contract.orgId,
            JSON.stringify(ids.slice(i, i + 100)),
          ],
        );
        if (result.length !== 1 || result[0].length !== 1) return {};
        const row = sqlObjectText(result[0][0], b.maxResultBytes);
        for (const [id, name] of Object.entries(row)) {
          if (known.has(id) && typeof name === "string" && name.trim() && name.length <= 40) {
            out[id] = name.trim();
          }
        }
      }
      return out;
    } catch {
      return {};
    }
  }
  members(authority: ProfessionalAuthority): Promise<readonly ProfessionalMembership[]> {
    const proof = this.receipts.get(authority);
    if (!proof) fail();
    if (authority.membership?.role !== "org_admin") {
      throw new AccessError("professional_access_denied", 403);
    }
    return Promise.resolve(proof.members);
  }
}
