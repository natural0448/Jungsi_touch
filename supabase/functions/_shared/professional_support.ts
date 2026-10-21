/** Synthetic in-memory port fixture only. No environment, network, native DB or real identities. */
import { AccessError } from "./jungsi/application/access.ts";
import { PROFESSIONAL_CONTRACT } from "./jungsi/application/professional_contract.generated.ts";
import { ProfessionalPolicy } from "./jungsi/application/professional_policy.ts";
import {
  ProfessionalService,
  type ProfessionalServicePorts,
} from "./jungsi/application/professional_service.ts";
import type {
  ProfessionalAuthority,
  ProfessionalCommand,
  ProfessionalExecution,
  ProfessionalProfile,
  ProfessionalReport,
  ProfessionalScope,
  ProfessionalStudent,
} from "./jungsi/application/professional_ports.ts";
import { ProfessionalProjection } from "./jungsi/application/professional_projection.ts";
import { OverallAnalysisService } from "./jungsi/application/overall_analysis.ts";
import { blockedOffering } from "./jungsi/application/offering_analysis.ts";
import { RequestLimitError } from "./jungsi/application/request_budget.ts";
import { NativeExamPack } from "./jungsi/domain/exam_pack.ts";
import { cloneNativeJson, nativeJsonText, type NativeObject } from "./jungsi/domain/json_value.ts";
import {
  consumeScoreInput,
  grantScoreCorrection,
  initialScoreInputState,
  type ScoreInputState,
} from "./jungsi/domain/score_input_rights.ts";
import { utcInstant, utcText } from "./jungsi/domain/time.ts";
import { RelayBoundary } from "./jungsi/infrastructure/auth_relay.ts";
import {
  createProfessionalHandler,
  professionalMutationGuard,
} from "./jungsi/infrastructure/professional_http.ts";
import { syntheticNativePackData } from "../../../tests/edge/synthetic_exam_pack.ts";
import schemas from "../../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
export const NOW = utcInstant("2026-10-21T00:00:00Z"),
  EXPIRY = utcInstant("2026-11-01T00:00:00Z"),
  ACTOR = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002",
  HASH = "a".repeat(64),
  ORG = "SYNTHETIC-org",
  STUDENT = "SYNTHETIC-student",
  PROFILE = "SYNTHETIC-profile",
  REPORT = "SYNTHETIC-report",
  RELAY = "SYNTHETIC-relay-token-00000000000000000000",
  ORIGIN = "https://synthetic.invalid";
export function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
export function equal(actual: unknown, expected: unknown): void {
  if (nativeJsonText(actual) !== nativeJsonText(expected)) {
    throw new Error("Synthetic mismatch: " + nativeJsonText([actual, expected]));
  }
}
export async function denied(
  work: () => Promise<unknown>,
  code: string,
  http?: number,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    assert(error instanceof AccessError);
    equal(error.code, code);
    if (http !== undefined) equal(error.http, http);
    return;
  }
  throw new Error("expected denial");
}
export function scores(): NativeObject {
  return {
    exam_id: "SYNTHETIC-mock",
    pack_version: "SYNTHETIC-pack.v1",
    korean: { standard_score: 5 },
    math: { standard_score: 6 },
    inquiry: [{ subject: "가상탐구가", standard_score: 7 }, {
      subject: "가상탐구나",
      standard_score: 8,
    }],
  };
}
export function policyRaw(runtime = 1000): NativeObject {
  return {
    format: "jungsi.professional-policy/v1",
    status: "approved",
    purpose: "professional_student_analysis",
    version: "SYNTHETIC-pro-policy",
    approval_reference_sha256: HASH,
    expires_at: utcText(EXPIRY),
    exams: [{ exam_id: "SYNTHETIC-mock", pack_version: "SYNTHETIC-pack.v1", academic_year: 2027 }],
    limits: {
      max_page_rows: 30,
      max_roster_rows: 200,
      max_body_bytes: 65536,
      max_result_bytes: 1048576,
      max_tags: 5,
      max_text_characters: 100,
      max_memo_characters: 500,
      cursor_lifetime_seconds: 60,
    },
    operating_policy: {
      format: "jungsi.score-input-policy/v1",
      status: "approved",
      purpose: "paid_score_input",
      approval_reference_sha256: HASH,
      version: "SYNTHETIC-pro-policy",
      rollout_id: "SYNTHETIC-rollout",
      calculation_version: "SYNTHETIC-calc",
      expires_at: utcText(EXPIRY),
      personal_daily_analysis_limit: "replaced_by_stage_rights",
      initial_saves: 1,
      correction_grants: 1,
      physical: { max_request_calculation_units: 1000, max_request_runtime_milliseconds: runtime },
      preview: { enabled: false, allow_subjects: [], expires_at: utcText(EXPIRY) },
      stages: [{
        exam_id: "SYNTHETIC-mock",
        pack_version: "SYNTHETIC-pack.v1",
        input_scope_id: "SYNTHETIC-season",
        academic_year: 2027,
        stage: "mock",
        window: { mode: "policy_lifetime" },
      }],
    },
  };
}
export async function fixture(
  role: "teacher" | "org_admin" | "viewer" = "teacher",
  runtime = 1000,
) {
  const raw = policyRaw(runtime),
    policy = new ProfessionalPolicy(raw, {
      approvalSha256: HASH,
      registrySha256: HASH,
      selectionSha256: HASH,
      expiresAtUtc: EXPIRY,
    });
  const f = {
    now: NOW,
    role,
    accountStatus: "active",
    accountRole: "member",
    aal: "aal2" as "aal1" | "aal2",
    authorityVersion: 1,
    revoked: false,
    allowSupport: true,
    semantic: null as string | null,
    auditFails: false,
    analysisFails: false,
    rateFails: false,
    finalCalls: 0,
    analysisCalls: 0,
    organizations: [ORG],
    transactionOrgs: [] as string[],
    reserveCalls: [] as unknown[],
    settlements: [] as unknown[],
    audits: [] as unknown[],
    students: new Map<string, ProfessionalStudent>(),
    profiles: new Map<string, ProfessionalProfile>(),
    reports: new Map<string, ProfessionalReport>(),
    history: [] as ProfessionalReport[],
    states: new Map<string, ScoreInputState>(),
    requests: new Map<string, { digest: string; result: NativeObject }>(),
    bookmarks: {} as NativeObject,
  };
  const clock = { nowUtc: () => f.now },
    user = () => ({
      subjectId: ACTOR,
      expiresAtUtc: EXPIRY,
      accountStatus: f.accountStatus,
      accountRole: f.accountRole,
      assuranceLevel: f.aal,
    });
  const authority = (
    orgId = ORG,
    mode: ProfessionalAuthority["mode"] = "member",
    ticket?: string,
  ): ProfessionalAuthority => ({
    user: user(),
    contract: {
      orgId,
      orgName: "가상 기관",
      contractId: "SYNTHETIC-contract",
      academicYear: 2027,
      version: f.authorityVersion,
      startsAtUtc: NOW - 1n,
      expiresAtUtc: EXPIRY,
      studentCapacity: 30,
      approvedExamIds: ["SYNTHETIC-mock"],
    },
    membership: mode === "member"
      ? {
        orgId,
        memberId: "SYNTHETIC-member",
        subjectId: ACTOR,
        role: f.role,
        version: f.authorityVersion,
        active: !f.revoked,
      }
      : null,
    mode,
    sourceVersion: "SYNTHETIC-source-" + f.authorityVersion,
    evaluatedAtUtc: f.now,
    ticketRef: ticket ?? null,
    supportStudentId: mode === "support" ? STUDENT : null,
    supportExamId: mode === "support" ? "SYNTHETIC-mock" : null,
    supportStage: mode === "support" ? "mock" : null,
  });
  const baseStudent: ProfessionalStudent = {
    orgId: ORG,
    studentId: STUDENT,
    contractId: "SYNTHETIC-contract",
    academicYear: 2027,
    version: 1,
    archived: false,
    assignedSubjectIds: [ACTOR],
    createdAtUtc: NOW,
    metadata: {
      display_name: "가상 학생",
      class_label: null,
      class_number: null,
      tags: [],
      memo: null,
    },
  };
  f.students.set(STUDENT, baseStudent);
  const profile: ProfessionalProfile = {
    orgId: ORG,
    studentId: STUDENT,
    profileId: PROFILE,
    version: 1,
    examId: "SYNTHETIC-mock",
    packVersion: "SYNTHETIC-pack.v1",
    stage: "mock",
    confirmed: true,
    scores: scores(),
    createdAtUtc: NOW,
  };
  f.profiles.set(PROFILE, profile);
  f.states.set(
    STUDENT,
    consumeScoreInput(initialScoreInputState(), "SYNTHETIC-attempt", PROFILE, false),
  );
  const pack = new NativeExamPack(syntheticNativePackData()),
    overall = await new OverallAnalysisService({
      getExamPack: async () => await pack,
      getTotalModel: async () => await null,
    }).analyze(
      { user: user(), evaluatedAtUtc: NOW, tier: "standard", paidUntilUtc: null },
      scores(),
    );
  const baseReport: ProfessionalReport = {
    orgId: ORG,
    studentId: STUDENT,
    reportId: REPORT,
    revision: 1,
    profileId: PROFILE,
    examId: profile.examId,
    stage: "mock",
    body: {
      overall: overall as NativeObject,
      analyses: {},
      candidates: null,
      shortlist: {},
      catalog_version: null,
      analysis_status: { status: "pending", reason_code: "offering_analysis_not_requested" },
    },
    reasons: [],
    createdAtUtc: NOW,
  };
  f.reports.set(REPORT, baseReport);
  f.history.push(baseReport);
  let bound: string | null = null, tail = Promise.resolve();
  const requestKey = (s: ProfessionalScope, c: ProfessionalCommand) =>
    [
      s.authority.user.subjectId,
      s.authority.contract.orgId,
      s.student?.studentId ?? "ORG",
      c.operation,
      c.key,
    ].join("/");
  const student = async (a: ProfessionalAuthority, id: string) => {
    await Promise.resolve();
    const s = f.students.get(id);
    return s && s.orgId === a.contract.orgId &&
        (a.mode !== "member" || a.membership?.role === "org_admin" ||
          s.assignedSubjectIds.includes(a.user.subjectId))
      ? s
      : null;
  };
  const change = async (
    s: ProfessionalScope,
    patch: Partial<ProfessionalStudent>,
    expected: number,
  ) => {
    await Promise.resolve();
    const old = f.students.get(s.student!.studentId)!;
    if (old.version !== expected) throw new AccessError("professional_version_conflict", 409);
    const value = { ...old, ...patch, version: old.version + 1 };
    f.students.set(old.studentId, value);
    return value;
  };
  const ports: ProfessionalServicePorts = {
    clock,
    authority: {
      organizations: async () => await f.organizations.map((id) => authority(id)),
      resolve: async (_u, org, mode, _now, ticket) => {
        await Promise.resolve();
        if (org !== ORG) throw new AccessError("professional_student_not_found", 404);
        if (
          mode !== "member" && (!f.allowSupport || f.accountRole !== "admin" || f.aal !== "aal2")
        ) throw new AccessError("professional_access_denied", 403);
        return authority(org, mode, ticket);
      },
      members: async (
        a,
      ) =>
        await [{
          orgId: a.contract.orgId,
          memberId: "SYNTHETIC-member",
          subjectId: ACTOR,
          role: f.role,
          version: f.authorityVersion,
          active: !f.revoked,
        }, {
          orgId: a.contract.orgId,
          memberId: "SYNTHETIC-other-member",
          subjectId: OTHER,
          role: "teacher",
          version: 1,
          active: true,
        }],
      assertCurrent: async (a) => {
        await Promise.resolve();
        f.finalCalls++;
        if (f.revoked || a.sourceVersion !== "SYNTHETIC-source-" + f.authorityVersion) {
          throw new AccessError("professional_authority_changed", 403);
        }
      },
    },
    students: {
      transaction: async (_u, work) => {
        const prior = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await prior;
        const before = {
          students: structuredClone(f.students),
          profiles: structuredClone(f.profiles),
          states: structuredClone(f.states),
          reports: structuredClone(f.reports),
          history: structuredClone(f.history),
          requests: structuredClone(f.requests),
          bookmarks: structuredClone(f.bookmarks),
          audits: [...f.audits],
        };
        try {
          return await work();
        } catch (error) {
          Object.assign(f, before);
          throw error;
        } finally {
          bound = null;
          release();
        }
      },
      bindScope: async (a) => {
        await Promise.resolve();
        if (bound && bound !== a.contract.orgId) {
          throw new AccessError("professional_storage_unavailable", 503);
        }
        bound = a.contract.orgId;
        f.transactionOrgs.push(bound);
      },
      students: async (a) =>
        await [...f.students.values()].filter((s) =>
          s.orgId === a.contract.orgId &&
          (a.membership?.role === "org_admin" || s.assignedSubjectIds.includes(ACTOR))
        ),
      student,
      seatUsage: async (a) =>
        await [...f.students.values()].filter((s) => s.orgId === a.contract.orgId).length,
      create: async (a, metadata, expected) => {
        await Promise.resolve();
        if (expected !== a.contract.version) {
          throw new AccessError("professional_version_conflict", 409);
        }
        if (
          [...f.students.values()].filter((s) => s.orgId === a.contract.orgId).length >=
            a.contract.studentCapacity
        ) throw new AccessError("professional_contract_capacity_exhausted", 409);
        const value = {
          ...baseStudent,
          orgId: a.contract.orgId,
          studentId: "SYNTHETIC-student-" + (f.students.size + 1),
          metadata,
          assignedSubjectIds: [ACTOR],
        };
        f.students.set(value.studentId, value);
        return value;
      },
      update: (s, metadata, expected) => change(s, { metadata }, expected),
      archive: (s, expected) => change(s, { archived: true }, expected),
      assign: (s, ids, expected) => change(s, { assignedSubjectIds: ids }, expected),
      replay: async (s, c) => {
        await Promise.resolve();
        const value = f.requests.get(requestKey(s, c));
        if (value && value.digest !== c.digest) {
          throw new AccessError("professional_version_conflict", 409);
        }
        return value ?? null;
      },
      remember: async (s, c, value) => {
        await Promise.resolve();
        f.requests.set(requestKey(s, c), { digest: c.digest, result: cloneNativeJson(value) });
      },
    },
    scores: {
      state: async (s) => await f.states.get(s.student!.studentId) ?? initialScoreInputState(),
      save: async (s, stage, expected, value, _c, rejection) => {
        await Promise.resolve();
        const old = f.states.get(s.student!.studentId) ?? initialScoreInputState();
        if (expected !== old.version) throw new AccessError("score_input_version_conflict", 409);
        const id = "SYNTHETIC-profile-" + (f.profiles.size + 1),
          p = rejection ? null : {
            ...profile,
            studentId: s.student!.studentId,
            profileId: id,
            scores: value,
            stage: stage.stage,
          };
        const state = consumeScoreInput(
          old,
          "SYNTHETIC-attempt-" + (old.version + 1),
          p?.profileId ?? null,
          false,
          rejection,
        );
        f.states.set(s.student!.studentId, state);
        if (p) f.profiles.set(id, p);
        return { state, profile: p };
      },
      correction: async (s, _stage, expected, _ticket, _c) => {
        await Promise.resolve();
        const state = grantScoreCorrection(
          f.states.get(s.student!.studentId)!,
          "SYNTHETIC-correction",
          expected,
        );
        f.states.set(s.student!.studentId, state);
        return state;
      },
      profile: async (s, id) => {
        await Promise.resolve();
        const p = f.profiles.get(id);
        return p?.orgId === s.authority.contract.orgId && p.studentId === s.student!.studentId
          ? p
          : null;
      },
    },
    reports: {
      reports: async (s) =>
        await [...f.reports.values()].filter((r) =>
          r.orgId === s.authority.contract.orgId && r.studentId === s.student!.studentId
        ),
      report: async (s, id, revision) => {
        await Promise.resolve();
        const r = revision === undefined
          ? f.reports.get(id)
          : f.history.find((r) => r.reportId === id && r.revision === revision);
        return r?.orgId === s.authority.contract.orgId && r.studentId === s.student!.studentId
          ? r
          : null;
      },
      publish: async (s, p, op, result, reasons, assessments) => {
        await Promise.resolve();
        const old = [...f.reports.values()].find((r) => r.profileId === p.profileId),
          body = old ? cloneNativeJson(old.body) : {
            overall: result,
            analyses: {},
            candidates: null,
            shortlist: {},
            catalog_version: null,
            analysis_status: {
              status: "pending",
              reason_code: "offering_analysis_not_requested",
            },
          };
        if (op === "pro.overall.analyze") body.overall = result;
        else if (op === "pro.university.analyze") {
          (body.analyses as NativeObject)[result.offering_id as string] = result;
        } else {
          body.candidates = result;
          Object.assign(body.analyses as NativeObject, assessments ?? {});
        }
        const r = {
          ...baseReport,
          reportId: old?.reportId ?? "SYNTHETIC-report-" + (f.reports.size + 1),
          studentId: s.student!.studentId,
          profileId: p.profileId,
          revision: (old?.revision ?? 0) + 1,
          body,
          reasons,
        };
        f.reports.set(r.reportId, r);
        f.history.push(r);
        return r;
      },
      bookmarks: async () => await f.bookmarks,
      addBookmark: async (_s, r, offering) => {
        await Promise.resolve();
        f.bookmarks[offering] = {
          selected: true,
          changed_at: utcText(NOW),
          assessment_status: "needs_revalidation",
          profile_id: r.profileId,
          catalog_version: null,
        };
        return f.bookmarks;
      },
    },
    analysis: {
      validateScores: async () => await f.semantic,
      analyze: async (_s, _p, op, input) => {
        await Promise.resolve();
        f.analysisCalls++;
        if (f.analysisFails) throw new AccessError("professional_analysis_unavailable", 503);
        return {
          result: op === "pro.overall.analyze"
            ? overall as NativeObject
            : op === "pro.university.analyze"
            ? blockedOffering(input.offering_id, "analysis_release_missing")
            : {
              status: "pending",
              reason_code: "approved_candidates_missing",
              basic_university_groups: [],
              wildcards: [],
              pending_offerings: [],
              outside_offerings: [],
              ineligible_offerings: [],
              catalog_version: "SYNTHETIC-catalog",
            },
          reasons: [],
          assessments: {},
        };
      },
      assertOffering: async () => {},
      assertCurrent: async () => {},
    },
    usage: {
      reserve: async (_s, op, _c, context) => {
        await Promise.resolve();
        f.reserveCalls.push({ op, context });
        if (f.rateFails) throw new RequestLimitError("rate_limit_exceeded", 7);
        return { id: "SYNTHETIC-lease-" + f.reserveCalls.length, expiresAtUtc: EXPIRY };
      },
      finish: async (_s, lease, success, bytes, replayed) => {
        await Promise.resolve();
        f.settlements.push({ id: lease.id, success, bytes, replayed: replayed ?? false });
      },
    },
    audit: {
      record: async (_s, event) => {
        await Promise.resolve();
        if (f.auditFails) throw new AccessError("professional_storage_unavailable", 503);
        f.audits.push(event);
      },
    },
    retention: {
      preview: async (a, input) =>
        await ({
          org_id: a.contract.orgId,
          contract_id: a.contract.contractId,
          academic_year: 2027,
          official_deadline_reference: input.official_deadline_reference,
          cutoff_at_utc: input.cutoff_at_utc,
          manifest_sha256: HASH,
          counts: { students: 1, profiles: 1, report_revisions: 1 },
          expected_previous_fingerprints: { students: [], profiles: [], revisions: [] },
          approval_required: true,
        }),
      noticeTargets: async (a) =>
        await ({
          org_id: a.contract.orgId,
          contract_id: a.contract.contractId,
          due_at_utc: utcText(NOW),
          notice_days_before: 14,
          authorized_member_ids: ["SYNTHETIC-member"],
          counts: { students: 1 },
        }),
    },
    cursor: {
      seal: async (value) => await nativeJsonText(value),
      open: async (value) => await JSON.parse(value),
    },
  };
  const service = new ProfessionalService(ports, policy, PROFESSIONAL_CONTRACT),
    projection = new ProfessionalProjection(PROFESSIONAL_CONTRACT, schemas);
  const handler = createProfessionalHandler({
    contract: PROFESSIONAL_CONTRACT,
    relay: new RelayBoundary(RELAY),
    sessions: {
      verifyUserBearer: async (token) => await token === "SYNTHETIC-bearer" ? user() : null,
    },
    clock,
    projection,
    service: async () => await service,
    mutationGuard: professionalMutationGuard(ORIGIN),
    maximumRequestMilliseconds: runtime,
  });
  const execution = (
    operation: string,
    body: NativeObject = {},
    extra: Partial<ProfessionalExecution> = {},
  ): ProfessionalExecution => ({
    operation,
    user: user(),
    params: { org_id: ORG, student_id: STUDENT, report_id: REPORT },
    query: {},
    body,
    key:
      PROFESSIONAL_CONTRACT.routes.find((r) => r.id === operation)!.request.Idempotency_Key_required
        ? "SYNTHETIC-key"
        : null,
    requestId: "b".repeat(32),
    ...extra,
  });
  const request = (
    operation: string,
    input: NativeObject = {},
    query: Record<string, string> = {},
  ) => {
    const route = PROFESSIONAL_CONTRACT.routes.find((r) => r.id === operation)!;
    let path = route.path.replaceAll("{org_id}", ORG).replaceAll("{student_id}", STUDENT)
      .replaceAll("{report_id}", REPORT);
    if (Object.keys(query).length) path += "?" + new URLSearchParams(query);
    const h: Record<string, string> = {
      Authorization: "Bearer SYNTHETIC-bearer",
      "X-Jungsi-Relay-Token": RELAY,
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "X-Jungsi-CSRF-Verified": "1",
    };
    if (route.request.Idempotency_Key_required) h["Idempotency-Key"] = "SYNTHETIC-key";
    return new Request("https://synthetic.invalid" + path, {
      method: route.method,
      headers: h,
      ...(route.method === "GET" ? {} : { body: nativeJsonText(input) }),
    });
  };
  return {
    f,
    ports,
    policy,
    raw,
    user,
    authority,
    service,
    handler,
    projection,
    execution,
    request,
    clock,
    baseStudent,
    profile,
    baseReport,
  };
}
