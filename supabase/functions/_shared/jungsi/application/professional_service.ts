/** Institutional workflow. No personal owner impersonation, raw SQL or calculation implementation. */
import { AccessError } from "./access.ts";
import type { RequestClockPort } from "./ports.ts";
import type {
  ApprovedAnalysisPort,
  OrganizationStudentRepositoryPort,
  ProfessionalAuditPort,
  ProfessionalAuthority,
  ProfessionalAuthorityPort,
  ProfessionalCommand,
  ProfessionalContract,
  ProfessionalCursorCodec,
  ProfessionalExecution,
  ProfessionalProfile,
  ProfessionalReport,
  ProfessionalResponse,
  ProfessionalRetentionPort,
  ProfessionalScope,
  ProfessionalStudent,
  ProfessionalUsagePort,
  StudentReportPort,
  StudentScoreInputPort,
} from "./professional_ports.ts";
import {
  ProfessionalPolicy,
  proFresh,
  proId,
  proInteger,
  proObject,
  proShape,
} from "./professional_policy.ts";
import { validateScoreStructure } from "./overall_analysis.ts";
import { SCORE_CONTENT_REJECTION_CODES } from "./score_input_service.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../domain/json_value.ts";
import { scoreInputBalance, type ScoreInputState } from "../domain/score_input_rights.ts";
import { utcInstant, utcText } from "../domain/time.ts";

export interface ProfessionalOutcome {
  readonly response: ProfessionalResponse | null;
  readonly error: { readonly code: string; readonly http: number } | null;
}
export interface ProfessionalDelivery<T> {
  readonly value: T;
  readonly bytes: bigint;
}
export interface ProfessionalServicePorts {
  readonly authority: ProfessionalAuthorityPort;
  readonly students: OrganizationStudentRepositoryPort;
  readonly scores: StudentScoreInputPort;
  readonly reports: StudentReportPort;
  readonly analysis: ApprovedAnalysisPort;
  readonly usage: ProfessionalUsagePort;
  readonly audit: ProfessionalAuditPort;
  readonly retention: ProfessionalRetentionPort;
  readonly cursor: ProfessionalCursorCodec;
  readonly clock: RequestClockPort;
}
function notFound(): never {
  throw new AccessError("professional_student_not_found", 404);
}
function memberRole(a: ProfessionalAuthority, allowed: readonly string[]): void {
  if (a.mode !== "member" || !a.membership?.active || !allowed.includes(a.membership.role)) {
    throw new AccessError("professional_access_denied", 403);
  }
}
function profileDto(p: ProfessionalProfile): NativeObject {
  return {
    profile_id: p.profileId,
    profile_version: p.profileId,
    confirmed: p.confirmed,
    created_at: utcText(p.createdAtUtc),
  };
}
function reportDto(r: ProfessionalReport): NativeObject {
  const b = r.body;
  return {
    format: "jungsi.persisted-report/v1",
    report_id: r.reportId,
    report_version: r.revision,
    profile_id: r.profileId,
    updated_at: utcText(r.createdAtUtc),
    overall: cloneNativeJson(b.overall),
    analyses: cloneNativeJson(b.analyses),
    candidates: cloneNativeJson(b.candidates),
    shortlist: cloneNativeJson(b.shortlist),
    analysis_status: cloneNativeJson(b.analysis_status),
  };
}
function studentDto(s: ProfessionalStudent): NativeObject {
  return {
    org_id: s.orgId,
    student_id: s.studentId,
    display_name: s.metadata.display_name,
    class_label: s.metadata.class_label,
    class_number: s.metadata.class_number,
    tags: cloneNativeJson(s.metadata.tags),
    memo: s.metadata.memo,
    archived: s.archived,
    version: s.version,
    assigned_teacher_ids: [...s.assignedSubjectIds],
    created_at_utc: utcText(s.createdAtUtc),
  };
}
function storedReportDto(r: ProfessionalReport): NativeObject {
  return {
    org_id: r.orgId,
    student_id: r.studentId,
    report_id: r.reportId,
    revision_id: r.revision,
    exam_id: r.examId,
    stage: r.stage,
    profile_id: r.profileId,
    published_result: reportDto(r),
    counseling_reasons: [...r.reasons],
    created_at_utc: utcText(r.createdAtUtc),
  };
}
export class ProfessionalService {
  private readonly routes = new Map<string, ProfessionalContract["routes"][number]>();
  constructor(
    private readonly ports: ProfessionalServicePorts,
    readonly policy: ProfessionalPolicy,
    contract: ProfessionalContract,
  ) {
    for (const r of contract.routes) {
      if (this.routes.has(r.id) || !r.id.startsWith("pro.")) {
        throw new AccessError("professional_contract_unavailable", 503);
      }
      this.routes.set(r.id, r);
    }
    if (this.routes.size !== 21) throw new AccessError("professional_contract_unavailable", 503);
  }
  private fresh(r: ProfessionalExecution, deadline: bigint): bigint {
    const now = this.ports.clock.nowUtc();
    proFresh(r.user, now);
    this.policy.assertLive(now);
    if (now >= deadline) throw new AccessError("professional_request_timeout", 503);
    return now;
  }
  private async scope(
    r: ProfessionalExecution,
    a: ProfessionalAuthority,
    deadline: bigint,
  ): Promise<ProfessionalScope> {
    this.policy.assertAuthority(a, this.fresh(r, deadline));
    await this.ports.students.bindScope(a);
    const student = r.params.student_id
      ? await this.ports.students.student(a, proId(r.params.student_id))
      : null;
    if (r.params.student_id) {
      this.policy.assertStudent(a, student, r.operation, this.fresh(r, deadline));
    }
    return { authority: a, student };
  }
  async execute<T = ProfessionalOutcome>(
    r: ProfessionalExecution,
    complete?: (outcome: ProfessionalOutcome) => Promise<ProfessionalDelivery<T>>,
  ): Promise<T> {
    const route = this.routes.get(r.operation);
    if (!route) throw new AccessError("route_not_found", 404);
    proShape(r.body, [], route.request.body_fields);
    proShape(r.query, [], route.request.query_fields);
    if (route.request.Idempotency_Key_required !== (r.key !== null)) {
      throw new AccessError("invalid_request", 422);
    }
    const start = r.startedAtUtc ?? this.ports.clock.nowUtc(),
      deadline = start + this.policy.operating.maxRequestRuntimeMilliseconds * 1000n;
    this.fresh(r, deadline);
    const finish = complete ??
      ((outcome: ProfessionalOutcome) =>
        Promise.resolve({
          value: outcome as T,
          bytes: BigInt(new TextEncoder().encode(nativeJsonText(outcome)).length),
        }));
    const authorities = r.operation === "pro.session"
      ? await this.ports.authority.organizations(r.user, start)
      : [
        await this.ports.authority.resolve(
          r.user,
          proId(r.params.org_id),
          r.operation === "pro.correction.grant"
            ? "support"
            : r.operation.startsWith("pro.retention.")
            ? "retention"
            : "member",
          start,
          r.operation === "pro.correction.grant" ? proId(r.body.ticket_ref) : undefined,
        ),
      ];
    if (!authorities.length) throw new AccessError("professional_access_denied", 403);
    if (r.operation === "pro.session") {
      return await this.sessionRequest(r, authorities, deadline, finish);
    }
    const authority = authorities[0];
    this.policy.assertAuthority(authority, this.fresh(r, deadline));
    const command: ProfessionalCommand | null = r.key === null ? null : {
      key: proId(r.key),
      operation: r.operation,
      digest: await nativeJsonSha256([
        r.operation,
        r.params,
        r.body,
        await this.policy.contextSha256(),
      ]),
    };
    let examId: string | null = null, knownReplay = false;
    const initial = await this.ports.students.transaction(r.user, async () => {
      const s = await this.scope(r, authority, deadline);
      if (r.operation === "pro.score.create") {
        examId = this.policy.stage(
          authority,
          r.body.exam_id,
          r.body.pack_version,
          r.body.stage,
          this.fresh(r, deadline),
          false,
        ).examId;
      }
      if (
        ["pro.overall.analyze", "pro.university.analyze", "pro.candidates"].includes(r.operation)
      ) {
        const profile = await this.ports.scores.profile(s, proId(r.body.profile_id));
        if (!profile) throw new AccessError("professional_profile_not_found", 404);
        examId = this.policy.stage(
          authority,
          profile.examId,
          profile.packVersion,
          profile.stage,
          this.fresh(r, deadline),
          false,
        ).examId;
      }
      if (command) {
        try {
          knownReplay = await this.ports.students.replay(s, command) !== null;
        } catch (error) {
          if (!(error instanceof AccessError) || error.http !== 409) throw error;
        }
      }
      await this.ports.authority.assertCurrent(authority, this.fresh(r, deadline));
      return s;
    });
    // Admission is separate, so failed business transactions retain request accounting.
    const lease = await this.ports.usage.reserve(initial, r.operation, command, {
      examId,
      maximumCalculationUnits: this.policy.operating.maxRequestCalculationUnits,
      replay: knownReplay,
    });
    let readyToCommit = false;
    try {
      return await this.ports.students.transaction(r.user, async () => {
        await this.ports.authority.assertCurrent(authority, this.fresh(r, deadline));
        const scope = await this.scope(r, authority, deadline);
        let outcome: ProfessionalOutcome;
        const replay = command ? await this.ports.students.replay(scope, command) : null;
        if (replay) {
          const stored = proShape(replay.result, ["response", "error"]);
          outcome = stored as unknown as ProfessionalOutcome;
        } else {
          outcome = await this.dispatch(r, scope, deadline);
          if (command) {
            await this.ports.students.remember(scope, command, outcome as unknown as NativeObject);
          }
        }
        let auditScope = scope;
        if (r.operation === "pro.student.create" && outcome.response?.studentId) {
          const created = await this.ports.students.student(authority, outcome.response.studentId);
          if (!created) notFound();
          auditScope = { authority, student: created };
        }
        await this.ports.students.bindScope(authority);
        await this.ports.audit.record(auditScope, {
          requestId: r.requestId,
          operation: r.operation,
          result: outcome.error ? "rejected" : "success",
          ticketRef: authority.ticketRef,
        });
        await this.verifyResult(r, scope, outcome, deadline);
        const delivery = await finish(outcome);
        await this.ports.analysis.assertCurrent();
        if (
          typeof delivery.bytes !== "bigint" || delivery.bytes < 0n ||
          delivery.bytes > BigInt(this.policy.maxResultBytes)
        ) throw new AccessError("professional_result_limit_exceeded", 503);
        await this.ports.usage.finish(initial, lease, true, delivery.bytes, replay !== null);
        for (const a of authorities) {
          this.policy.assertAuthority(a, this.fresh(r, deadline));
          await this.ports.authority.assertCurrent(a, this.fresh(r, deadline));
        }
        readyToCommit = true;
        return delivery.value;
      });
    } catch (error) {
      // Once the callback returned, a COMMIT acknowledgement may be indeterminate. Never auto-resave.
      if (!readyToCommit) await this.ports.usage.finish(initial, lease, false, 0n);
      throw error;
    }
  }
  private async verifyResult(
    r: ProfessionalExecution,
    scope: ProfessionalScope,
    outcome: ProfessionalOutcome,
    deadline: bigint,
  ): Promise<void> {
    const a = scope.authority;
    if (scope.student) {
      const current = await this.ports.students.student(a, scope.student.studentId);
      this.policy.assertStudent(a, current, r.operation, this.fresh(r, deadline));
    }
    if (r.operation === "pro.student.list" && outcome.response) {
      const data = proObject(outcome.response.data);
      if (!Array.isArray(data.items)) throw new AccessError("professional_result_invalid", 503);
      for (const item of data.items) {
        const row = proObject(item),
          current = await this.ports.students.student(a, proId(row.student_id));
        this.policy.assertStudent(a, current, "pro.student.read", this.fresh(r, deadline));
        if (!current || current.version !== row.version) {
          throw new AccessError("professional_version_conflict", 409);
        }
      }
    }
  }
  private metadata(value: NativeObject, previous?: NativeObject): NativeObject {
    const out: NativeObject = previous
      ? cloneNativeJson(previous)
      : { display_name: "", class_label: null, class_number: null, tags: [], memo: null };
    for (const key of ["display_name", "class_label", "class_number", "tags", "memo"]) {
      if (!Object.hasOwn(value, key)) continue;
      const v = value[key];
      if (key === "tags") {
        if (
          !Array.isArray(v) || v.length > this.policy.maxTags || v.some((x) =>
            typeof x !== "string" || !x.trim() || x.length > this.policy.maxTextCharacters
          ) || new Set(v).size !== v.length
        ) {
          throw new AccessError("invalid_request", 422);
        }
      } else if (
        v !== null &&
        (typeof v !== "string" ||
          v.length >
            (key === "memo" ? this.policy.maxMemoCharacters : this.policy.maxTextCharacters))
      ) throw new AccessError("invalid_request", 422);
      if (key === "display_name" && (typeof v !== "string" || !v.trim())) {
        throw new AccessError("invalid_request", 422);
      }
      out[key] = cloneNativeJson(v);
    }
    if (typeof out.display_name !== "string" || !out.display_name.trim()) {
      throw new AccessError("invalid_request", 422);
    }
    return out;
  }
  private response(
    scope: ProfessionalScope,
    data: NativeObject,
    studentId = scope.student?.studentId ?? null,
  ): ProfessionalOutcome {
    return {
      error: null,
      response: { orgId: scope.authority.contract.orgId, studentId, data, reasons: [] },
    };
  }
  private async annotatedReport(
    scope: ProfessionalScope,
    saved: ProfessionalReport,
  ): Promise<ProfessionalReport> {
    // Current interest selections are separate annotations; immutable calculated revisions remain unchanged.
    return {
      ...saved,
      body: {
        ...saved.body,
        shortlist: await this.ports.reports.bookmarks(
          scope,
          saved.reportId,
          this.policy.maxRosterRows,
        ),
      },
    };
  }
  private async page(
    r: ProfessionalExecution,
    scope: ProfessionalScope,
    rows: readonly NativeObject[],
    deadline: bigint,
  ): Promise<NativeObject> {
    let limit = Math.min(20, this.policy.maxPageRows);
    if (r.query.limit !== undefined) {
      if (!/^[1-9][0-9]{0,5}$/.test(r.query.limit)) throw new AccessError("invalid_request", 422);
      limit = Number(r.query.limit);
    }
    if (limit > this.policy.maxPageRows) throw new AccessError("invalid_request", 422);
    const now = this.fresh(r, deadline), filters = { ...r.query };
    delete filters.cursor;
    const binding = {
      purpose: r.operation,
      subject: r.user.subjectId,
      org: scope.authority.contract.orgId,
      student: scope.student?.studentId ?? null,
      policy: await this.policy.contextSha256(),
      source_version: scope.authority.sourceVersion,
      filters_sha256: await nativeJsonSha256(filters),
      rows_sha256: await nativeJsonSha256(rows),
    };
    let offset = 0;
    if (r.query.cursor) {
      const cursor = await this.ports.cursor.open(r.query.cursor);
      if (typeof cursor.expires_at_utc !== "string" || utcInstant(cursor.expires_at_utc) <= now) {
        throw new AccessError("professional_cursor_expired", 409);
      }
      if (await nativeJsonSha256(cursor.binding) !== await nativeJsonSha256(binding)) {
        throw new AccessError("professional_cursor_changed", 409);
      }
      offset = proInteger(cursor.offset);
      if (offset > rows.length) throw new AccessError("professional_cursor_changed", 409);
    }
    const items = rows.slice(offset, offset + limit), hasMore = offset + items.length < rows.length;
    const expiry = [
      r.user.expiresAtUtc,
      scope.authority.contract.expiresAtUtc,
      this.policy.expiresAtUtc,
      now + this.policy.cursorLifetimeMicroseconds,
    ].reduce((a, b) => a < b ? a : b);
    return {
      items,
      next_cursor: hasMore
        ? await this.ports.cursor.seal({
          binding,
          offset: offset + items.length,
          expires_at_utc: utcText(expiry),
        })
        : null,
      has_more: hasMore,
    };
  }
  private async sessionRequest<T>(
    r: ProfessionalExecution,
    authorities: readonly ProfessionalAuthority[],
    deadline: bigint,
    finish: (outcome: ProfessionalOutcome) => Promise<ProfessionalDelivery<T>>,
  ): Promise<T> {
    const organizations: NativeObject[] = [];
    const scope: ProfessionalScope = { authority: authorities[0], student: null };
    this.policy.assertAuthority(scope.authority, this.fresh(r, deadline));
    const lease = await this.ports.usage.reserve(scope, r.operation, null, {
      examId: null,
      maximumCalculationUnits: this.policy.operating.maxRequestCalculationUnits,
      replay: false,
    });
    let settlementAttempted = false;
    try {
      for (const a of authorities) {
        this.policy.assertAuthority(a, this.fresh(r, deadline));
        const row = await this.ports.students.transaction(r.user, async () => {
          await this.ports.students.bindScope(a);
          await this.ports.authority.assertCurrent(a, this.fresh(r, deadline));
          const used = await this.ports.students.seatUsage(a);
          if (used > a.contract.studentCapacity) {
            throw new AccessError("professional_contract_capacity_changed", 409);
          }
          await this.ports.audit.record({ authority: a, student: null }, {
            requestId: r.requestId,
            operation: "pro.session",
            result: "success",
            ticketRef: null,
          });
          await this.ports.authority.assertCurrent(a, this.fresh(r, deadline));
          return {
            org_id: a.contract.orgId,
            org_name: a.contract.orgName,
            contract_id: a.contract.contractId,
            academic_year: a.contract.academicYear,
            // 학생 추가의 expected_contract_version 근거(권한 원본의 계약 판). 2026-10-21 화면 담당 Owner
            contract_version: a.contract.version,
            role: a.membership!.role,
            contract_status: "active",
            contract_expires_at: utcText(a.contract.expiresAtUtc),
            contracted_student_count: a.contract.studentCapacity,
            used_student_count: used,
            remaining_student_count: a.contract.studentCapacity - used,
          };
        });
        organizations.push(row);
      }
      const chosen = organizations.length === 1 ? organizations[0] : null;
      const outcome: ProfessionalOutcome = {
        error: null,
        response: {
          orgId: chosen ? proId(chosen.org_id) : null,
          studentId: null,
          reasons: [],
          data: {
            organizations,
            org_id: chosen?.org_id ?? null,
            role: chosen?.role ?? null,
            contract_status: chosen ? "active" : "selection_required",
            contract_expires_at: chosen?.contract_expires_at ?? null,
            contracted_student_count: chosen?.contracted_student_count ?? null,
            used_student_count: chosen?.used_student_count ?? null,
            remaining_student_count: chosen?.remaining_student_count ?? null,
          },
        },
      };
      const delivery = await finish(outcome);
      if (delivery.bytes < 0n || delivery.bytes > BigInt(this.policy.maxResultBytes)) {
        throw new AccessError("professional_result_limit_exceeded", 503);
      }
      for (const a of authorities) {
        await this.ports.authority.assertCurrent(a, this.fresh(r, deadline));
      }
      settlementAttempted = true;
      await this.ports.usage.finish(scope, lease, true, delivery.bytes);
      this.fresh(r, deadline);
      return delivery.value;
    } catch (error) {
      if (!settlementAttempted) await this.ports.usage.finish(scope, lease, false, 0n);
      throw error;
    }
  }
  private status(
    scope: ProfessionalScope,
    stage: ReturnType<ProfessionalPolicy["stage"]>,
    state: ScoreInputState,
    reportId: string | null,
  ): NativeObject {
    const b = scoreInputBalance(state);
    return {
      org_id: scope.authority.contract.orgId,
      student_id: scope.student!.studentId,
      exam_id: stage.examId,
      pack_version: stage.packVersion,
      stage: stage.stage,
      initial_used: b.initialUsed,
      initial_remaining: b.initialRemaining,
      correction_granted: b.correctionGranted,
      correction_used: b.correctionUsed,
      entry_version: state.version,
      current_profile_id: state.currentProfileId,
      current_report_id: reportId,
      last_rejection_code: state.lastRejectionCode,
    };
  }
  private async selectedProfile(
    r: ProfessionalExecution,
    scope: ProfessionalScope,
    deadline: bigint,
  ): Promise<ProfessionalProfile> {
    const p = await this.ports.scores.profile(scope, proId(r.body.profile_id));
    if (!p) throw new AccessError("professional_profile_not_found", 404);
    if (r.body.expected_profile_version !== p.profileId) {
      throw new AccessError("professional_version_conflict", 409);
    }
    const stage = this.policy.stage(
      scope.authority,
      p.examId,
      p.packVersion,
      p.stage,
      this.fresh(r, deadline),
      false,
    );
    const state = await this.ports.scores.state(scope, stage);
    if (state.currentProfileId !== p.profileId) {
      throw new AccessError("professional_version_conflict", 409);
    }
    return p;
  }
  private async dispatch(
    r: ProfessionalExecution,
    scope: ProfessionalScope,
    deadline: bigint,
  ): Promise<ProfessionalOutcome> {
    const a = scope.authority, body = r.body, op = r.operation;
    if (op === "pro.student.list") {
      memberRole(a, ["teacher", "org_admin"]);
      proShape(r.query, [], ["limit", "cursor", "q", "class_label"]);
      const all = await this.ports.students.students(a, this.policy.maxRosterRows),
        q = r.query.q?.normalize("NFKC").toLocaleLowerCase("ko-KR") ?? "";
      if (
        q.length > this.policy.maxTextCharacters ||
        (r.query.class_label?.length ?? 0) > this.policy.maxTextCharacters
      ) throw new AccessError("invalid_request", 422);
      const rows = all.filter((s) =>
        (!r.query.class_label || s.metadata.class_label === r.query.class_label) &&
        (!q ||
          [s.metadata.display_name, s.metadata.class_label, s.metadata.class_number].some((v) =>
            typeof v === "string" && v.normalize("NFKC").toLocaleLowerCase("ko-KR").includes(q)
          ))
      ).map(studentDto);
      return this.response(scope, await this.page(r, scope, rows, deadline));
    }
    if (op === "pro.member.list") {
      memberRole(a, ["org_admin"]);
      proShape(r.query, [], ["limit", "cursor"]);
      const rows = (await this.ports.authority.members(a)).map((m) => ({
        member_id: m.memberId,
        subject_id: m.subjectId,
        role: m.role,
        status: m.active ? "active" : "inactive",
        version: m.version,
      }));
      return this.response(scope, {
        org_id: a.contract.orgId,
        ...await this.page(r, scope, rows, deadline),
      });
    }
    if (op === "pro.student.create") {
      memberRole(a, ["teacher", "org_admin"]);
      proShape(body, ["display_name", "expected_contract_version"], [
        "class_label",
        "class_number",
        "tags",
        "memo",
      ]);
      const c = {
        key: r.key!,
        operation: op,
        digest: await nativeJsonSha256([op, r.params, body, await this.policy.contextSha256()]),
      };
      const student = await this.ports.students.create(
        a,
        this.metadata(body),
        proInteger(body.expected_contract_version, 1),
        c,
      );
      return this.response(scope, studentDto(student), student.studentId);
    }
    if (op.startsWith("pro.retention.")) {
      if (a.mode !== "retention") throw new AccessError("professional_access_denied", 403);
      if (op === "pro.retention.notice-targets") {
        return this.response(scope, await this.ports.retention.noticeTargets(a));
      }
      proShape(body, [
        "contract_id",
        "academic_year",
        "official_deadline_reference",
        "cutoff_at_utc",
      ]);
      return this.response(scope, await this.ports.retention.preview(a, body));
    }
    const student = scope.student;
    if (!student) notFound();
    this.policy.assertStudent(a, student, op, this.fresh(r, deadline));
    if (
      student.archived &&
      [
        "pro.score.create",
        "pro.overall.analyze",
        "pro.university.analyze",
        "pro.candidates",
        "pro.bookmark.add",
      ].includes(op)
    ) throw new AccessError("professional_student_archived", 409);
    if (op === "pro.student.read") return this.response(scope, studentDto(student));
    if (op === "pro.student.update") {
      proShape(body, ["expected_version"], [
        "display_name",
        "class_label",
        "class_number",
        "tags",
        "memo",
      ]);
      if (Object.keys(body).length < 2) throw new AccessError("invalid_request", 422);
      return this.response(
        scope,
        studentDto(
          await this.ports.students.update(
            scope,
            this.metadata(body, student.metadata),
            proInteger(body.expected_version, 1),
          ),
        ),
      );
    }
    if (op === "pro.student.archive") {
      proShape(body, ["expected_version"]);
      return this.response(
        scope,
        studentDto(await this.ports.students.archive(scope, proInteger(body.expected_version, 1))),
      );
    }
    if (op === "pro.student.assign") {
      proShape(body, ["assigned_teacher_ids", "expected_version"]);
      if (!Array.isArray(body.assigned_teacher_ids)) throw new AccessError("invalid_request", 422);
      const ids = body.assigned_teacher_ids.map(proId),
        members = await this.ports.authority.members(a);
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) =>
          !members.some((m) =>
            m.subjectId === id && m.active && ["teacher", "viewer"].includes(m.role)
          )
        )
      ) throw new AccessError("invalid_request", 422);
      const changed = await this.ports.students.assign(
        scope,
        ids,
        proInteger(body.expected_version, 1),
      );
      return this.response(scope, {
        org_id: changed.orgId,
        student_id: changed.studentId,
        assigned_teacher_ids: [...changed.assignedSubjectIds],
        version: changed.version,
      });
    }
    if (op === "pro.score.status" || op === "pro.score.create" || op === "pro.correction.grant") {
      const input = op === "pro.score.status" ? r.query : body;
      if (op === "pro.score.status") proShape(input, ["exam_id", "pack_version", "stage"]);
      else if (op === "pro.score.create") {
        proShape(body, [
          "exam_id",
          "pack_version",
          "stage",
          "scores",
          "confirmed",
          "expected_entry_version",
        ]);
      } else proShape(body, ["exam_id", "stage", "ticket_ref", "expected_version"]);
      const selected = op === "pro.correction.grant"
        ? this.policy.operating.stage(input.exam_id, input.stage, this.fresh(r, deadline))
        : null;
      const stage = this.policy.stage(
        a,
        input.exam_id,
        selected?.packVersion ?? input.pack_version,
        input.stage,
        this.fresh(r, deadline),
        op !== "pro.score.status",
      );
      if (op === "pro.score.status") {
        const state = await this.ports.scores.state(scope, stage),
          reports = await this.ports.reports.reports(scope, this.policy.maxRosterRows);
        return this.response(
          scope,
          this.status(
            scope,
            stage,
            state,
            reports.find((x) => x.profileId === state.currentProfileId)?.reportId ?? null,
          ),
        );
      }
      const c = {
        key: r.key!,
        operation: op,
        digest: await nativeJsonSha256([op, r.params, body, await this.policy.contextSha256()]),
      };
      if (op === "pro.correction.grant") {
        if (
          a.mode !== "support" || a.ticketRef !== body.ticket_ref ||
          a.supportExamId !== stage.examId || a.supportStage !== stage.stage
        ) notFound();
        const state = await this.ports.scores.correction(
          scope,
          stage,
          proInteger(body.expected_version, 1),
          proId(body.ticket_ref),
          c,
        );
        return this.response(scope, this.status(scope, stage, state, null));
      }
      if (body.confirmed !== true) throw new AccessError("invalid_request", 422);
      const raw = proObject(body.scores);
      if (
        raw.exam_id !== undefined && raw.exam_id !== stage.examId ||
        raw.pack_version !== undefined && raw.pack_version !== stage.packVersion
      ) throw new AccessError("invalid_request", 422);
      const scores = validateScoreStructure({
        ...raw,
        exam_id: stage.examId,
        pack_version: stage.packVersion,
      }) as NativeObject;
      const code = await this.ports.analysis.validateScores(a, stage, scores);
      if (
        code !== null &&
        !SCORE_CONTENT_REJECTION_CODES.includes(
          code as typeof SCORE_CONTENT_REJECTION_CODES[number],
        )
      ) throw new AccessError("professional_analysis_unavailable", 503);
      const saved = await this.ports.scores.save(
        scope,
        stage,
        proInteger(body.expected_entry_version),
        scores,
        c,
        code,
      );
      if (code !== null) return { response: null, error: { code, http: 422 } };
      if (!saved.profile) throw new AccessError("professional_storage_unavailable", 503);
      return this.response(scope, {
        org_id: a.contract.orgId,
        student_id: student.studentId,
        profile: profileDto(saved.profile),
      });
    }
    if (["pro.overall.analyze", "pro.university.analyze", "pro.candidates"].includes(op)) {
      const profile = await this.selectedProfile(r, scope, deadline),
        analyzed = await this.ports.analysis.analyze(scope, profile, op, body);
      const report = await this.ports.reports.publish(
        scope,
        profile,
        op,
        analyzed.result,
        analyzed.reasons,
        analyzed.assessments,
      );
      return this.response(scope, {
        org_id: a.contract.orgId,
        student_id: student.studentId,
        ...(op === "pro.overall.analyze"
          ? { report: reportDto(await this.annotatedReport(scope, report)) }
          : op === "pro.university.analyze"
          ? { assessment: analyzed.result }
          : { candidates: analyzed.result }),
      });
    }
    if (op === "pro.report.list") {
      proShape(r.query, [], ["limit", "cursor"]);
      const rows = (await this.ports.reports.reports(scope, this.policy.maxRosterRows)).map(
        storedReportDto,
      );
      return this.response(scope, {
        org_id: a.contract.orgId,
        student_id: student.studentId,
        ...await this.page(r, scope, rows, deadline),
      });
    }
    if (op === "pro.report.read" || op === "pro.report.export") {
      const revision = op === "pro.report.export" ? proInteger(body.revision_id, 1) : undefined;
      const saved = await this.ports.reports.report(scope, proId(r.params.report_id), revision);
      if (!saved) throw new AccessError("professional_report_not_found", 404);
      const report = await this.annotatedReport(scope, saved);
      if (op === "pro.report.read") return this.response(scope, storedReportDto(report));
      const now = this.fresh(r, deadline),
        teacher = (await nativeJsonSha256([a.contract.orgId, r.user.subjectId])).slice(0, 12);
      return this.response(scope, {
        org_id: a.contract.orgId,
        student_id: student.studentId,
        snapshot: {
          format: "jungsi.counseling-snapshot/v1",
          status: "ready",
          snapshot_version: report.revision,
          generated_at: utcText(now),
          report: reportDto(report),
        },
        watermark: {
          organization_name: a.contract.orgName,
          teacher_code: "teacher-" + teacher,
          printed_at_seoul: new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            dateStyle: "medium",
            timeStyle: "long",
          }).format(new Date(Number(now / 1000n))),
          student_name: student.metadata.display_name,
        },
        counseling_reasons: [...report.reasons],
      });
    }
    if (op === "pro.bookmark.list") {
      proShape(r.query, ["report_id"]);
      return this.response(scope, {
        org_id: a.contract.orgId,
        student_id: student.studentId,
        shortlist: await this.ports.reports.bookmarks(
          scope,
          proId(r.query.report_id),
          this.policy.maxRosterRows,
        ),
      });
    }
    if (op === "pro.bookmark.add") {
      proShape(body, ["report_id", "offering_id"]);
      const report = await this.ports.reports.report(scope, proId(body.report_id));
      if (!report) throw new AccessError("professional_report_not_found", 404);
      await this.ports.analysis.assertOffering(scope, proId(body.offering_id));
      return this.response(scope, {
        org_id: a.contract.orgId,
        student_id: student.studentId,
        shortlist: await this.ports.reports.addBookmark(
          scope,
          report,
          proId(body.offering_id),
          this.policy.maxRosterRows,
        ),
      });
    }
    throw new AccessError("route_not_found", 404);
  }
}
