/** Cryptographic, native-authority and source-failure boundaries using invented data only. */
import {
  ProfessionalCursor,
  ProfessionalOperationCipher,
  ProfessionalStudentMetadataCipher,
} from "./jungsi/infrastructure/professional_crypto.ts";
import { SupabaseProfessionalAuthority } from "./jungsi/infrastructure/professional_authority.ts";
import { SupabaseProfessionalStore } from "./jungsi/infrastructure/professional_postgres.ts";
import { ProfessionalService } from "./jungsi/application/professional_service.ts";
import { PROFESSIONAL_CONTRACT } from "./jungsi/application/professional_contract.generated.ts";
import {
  createProfessionalHandler,
  professionalMutationGuard,
} from "./jungsi/infrastructure/professional_http.ts";
import { RelayBoundary } from "./jungsi/infrastructure/auth_relay.ts";
import { budgetSql } from "./professional_budget_support.ts";
import { NativeProfessionalRuntime } from "./jungsi/infrastructure/professional_runtime.ts";
import { ProfessionalApprovedAnalysis } from "./jungsi/application/professional_analysis.ts";
import { NativeExamPack } from "./jungsi/domain/exam_pack.ts";
import { nativeJsonText, type NativeObject } from "./jungsi/domain/json_value.ts";
import { utcText } from "./jungsi/domain/time.ts";
import { syntheticNativePackData } from "../../../tests/edge/synthetic_exam_pack.ts";
import schemas from "../../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import {
  ACTOR,
  assert,
  denied,
  equal,
  EXPIRY,
  fixture,
  HASH,
  NOW,
  ORG,
  ORIGIN,
  OTHER,
  PROFILE,
  RELAY,
  REPORT,
  scores,
  STUDENT,
} from "./professional_support.ts";
Deno.test("professional stored bookmarks round-trip into single report and print without mutating calculated revisions", async () => {
  const f = await fixture();
  await f.service.execute(
    f.execution("pro.overall.analyze", { profile_id: PROFILE, expected_profile_version: PROFILE }),
  );
  const report = f.f.reports.get(REPORT)!,
    before = nativeJsonText(report.body),
    bookmarks = new Map<string, string>(),
    stamp = utcText(NOW).replace("Z", ".000000Z");
  const db = budgetSql((statement, p) => {
    if (statement.startsWith("SELECT v.org_id,v.student_id")) {
      equal(p[0], ORG);
      equal(p[1], STUDENT);
      return [[
        ORG,
        STUDENT,
        REPORT,
        String(report.revision),
        PROFILE,
        report.examId,
        report.stage,
        nativeJsonText(report.body),
        nativeJsonText([...report.reasons]),
        stamp,
      ]];
    }
    if (statement.startsWith("INSERT INTO jungsi_professional.bookmarks")) {
      equal(p[0], ORG);
      equal(p[1], STUDENT);
      bookmarks.set(String(p[3]), stamp);
      return [];
    }
    if (statement.startsWith("SELECT pg_advisory_xact_lock")) return [];
    if (statement.startsWith("INSERT INTO jungsi_professional.bookmark_events")) {
      // 합성 저장소: remove 는 지금 담겨 있을 때만 기록(RETURNING), add 는 마지막이 remove 일 때만(여기서는 위 bookmarks 가 대신)
      equal(p[0], ORG);
      equal(p[1], STUDENT);
      if (statement.includes("$6,'remove'")) {
        if (!bookmarks.has(String(p[3]))) return [];
        bookmarks.delete(String(p[3]));
        return [[p[5]]];
      }
      return [];
    }
    if (statement.startsWith("SELECT offering_id,")) {
      return [...bookmarks].map(([id, time]) => [id, time]);
    }
    return undefined;
  });
  const store = new SupabaseProfessionalStore(
    db.sql,
    new ProfessionalStudentMetadataCipher({
      activeKeyId: "SYNTHETIC-key",
      keys: [{ keyId: "SYNTHETIC-key", bytes: new Uint8Array(32).fill(9) }],
    }, 4096),
    f.clock,
    1048576,
  );
  const service = new ProfessionalService(
    {
      ...f.ports,
      reports: store,
      students: {
        ...f.ports.students,
        transaction: (user, work) =>
          store.transaction(user, () => f.ports.students.transaction(user, work)),
        bindScope: async (a) => {
          await f.ports.students.bindScope(a);
          await store.bindScope(a);
        },
      },
    },
    f.policy,
    PROFESSIONAL_CONTRACT,
  );
  const handler = createProfessionalHandler({
    contract: PROFESSIONAL_CONTRACT,
    relay: new RelayBoundary(RELAY),
    sessions: { verifyUserBearer: () => Promise.resolve(f.user()) },
    clock: f.clock,
    projection: f.projection,
    service: () => Promise.resolve(service),
    mutationGuard: professionalMutationGuard(ORIGIN),
    maximumRequestMilliseconds: 1000,
  });
  equal(
    (await handler(
      f.request("pro.bookmark.add", { report_id: REPORT, offering_id: "SYNTHETIC-offering" }),
    )).status,
    200,
  );
  const read = await handler(f.request("pro.report.read")),
    printed = await handler(f.request("pro.report.export", { revision_id: report.revision })),
    list = await handler(f.request("pro.bookmark.list", {}, { report_id: REPORT }));
  equal(read.status, 200);
  equal(printed.status, 200);
  equal(list.status, 200);
  assert((await read.json()).data.published_result.shortlist["SYNTHETIC-offering"].selected);
  assert((await printed.json()).data.snapshot.report.shortlist["SYNTHETIC-offering"].selected);
  assert((await list.json()).data.shortlist["SYNTHETIC-offering"].selected);
  equal(nativeJsonText(report.body), before);
  equal(store.isTransactionActive(), false);
  // 2026-11-13 담은 학교 빼기: 빼면 목록에서 사라지고, 다시 빼면 404, 다시 담으면 돌아온다
  const removeBody = { report_id: REPORT, offering_id: "SYNTHETIC-offering" };
  // 동작마다 다른 요청 키(같은 키는 재전송으로 보고 앞 결과를 돌려준다)
  const keyed = (r: Request, key: string) => {
    const h = new Headers(r.headers);
    h.set("Idempotency-Key", key);
    return new Request(r, { headers: h });
  };
  equal(
    (await handler(keyed(f.request("pro.bookmark.remove", removeBody), "SYNTHETIC-remove-1")))
      .status,
    200,
  );
  const afterRemove = await handler(f.request("pro.bookmark.list", {}, { report_id: REPORT }));
  equal(afterRemove.status, 200);
  assert((await afterRemove.json()).data.shortlist["SYNTHETIC-offering"] === undefined);
  equal(
    (await handler(keyed(f.request("pro.bookmark.remove", removeBody), "SYNTHETIC-remove-2")))
      .status,
    404,
  );
  equal(
    (await handler(keyed(f.request("pro.bookmark.add", removeBody), "SYNTHETIC-readd-1"))).status,
    200,
  );
  const readded = await handler(f.request("pro.bookmark.list", {}, { report_id: REPORT }));
  assert((await readded.json()).data.shortlist["SYNTHETIC-offering"].selected);
  equal(nativeJsonText(report.body), before);
  equal(store.isTransactionActive(), false);
});
Deno.test("professional ciphertext bounds include encoding overhead without expanding plaintext limits", async () => {
  const ring = {
    activeKeyId: "SYNTHETIC-key",
    keys: [{ keyId: "SYNTHETIC-key", bytes: new Uint8Array(32).fill(7) }],
  };
  for (const [plainLimit, ciphertextLimit] of [[1048576, 2097152], [8388608, 16777216]]) {
    const cipher = plainLimit === 1048576
        ? new ProfessionalStudentMetadataCipher(ring, plainLimit)
        : new ProfessionalOperationCipher(ring, plainLimit),
      payload = { text: "X".repeat(plainLimit - 100) };
    const sealed = await cipher.seal(ORG, STUDENT, payload),
      size = new TextEncoder().encode(sealed).length;
    assert(size > plainLimit && size <= ciphertextLimit);
    equal((await cipher.open(ORG, STUDENT, sealed)).text, payload.text);
    await denied(
      () => cipher.seal(ORG, STUDENT, { text: "X".repeat(plainLimit) }),
      "professional_crypto_unavailable",
      503,
    );
  }
});
Deno.test("professional metadata rotation reads old keys and resists cross-org/student tampering", async () => {
  const old = { keyId: "SYNTHETIC-old", bytes: new Uint8Array(32).fill(1) },
    next = { keyId: "SYNTHETIC-new", bytes: new Uint8Array(32).fill(2) };
  const first = new ProfessionalStudentMetadataCipher(
      { activeKeyId: old.keyId, keys: [old] },
      4096,
    ),
    current = new ProfessionalStudentMetadataCipher(
      { activeKeyId: next.keyId, keys: [old, next] },
      4096,
    );
  const sealed = await first.seal(ORG, STUDENT, { display_name: "가상 보존 학생" });
  equal(await current.open(ORG, STUDENT, sealed), { display_name: "가상 보존 학생" });
  await denied(
    () => current.open("SYNTHETIC-other-org", STUDENT, sealed),
    "professional_protected_value_invalid",
    503,
  );
  await denied(
    () => current.open(ORG, "SYNTHETIC-other-student", sealed),
    "professional_protected_value_invalid",
    503,
  );
  assert(!sealed.includes("가상 보존 학생"));
  assert((await current.seal(ORG, STUDENT, {})).includes(next.keyId));
});
Deno.test("professional cipher captures the active key and rejects unknown or modified envelopes", async () => {
  const ring = {
      activeKeyId: "SYNTHETIC-key",
      keys: [{ keyId: "SYNTHETIC-key", bytes: new Uint8Array(32).fill(3) }],
    },
    cipher = new ProfessionalStudentMetadataCipher(ring, 4096);
  ring.activeKeyId = "SYNTHETIC-unknown";
  const text = await cipher.seal(ORG, STUDENT, {});
  assert(text.includes("SYNTHETIC-key"));
  const envelope = JSON.parse(text);
  envelope.key_id = "SYNTHETIC-unknown";
  await denied(
    () => cipher.open(ORG, STUDENT, JSON.stringify(envelope)),
    "professional_protected_value_invalid",
  );
  envelope.key_id = "SYNTHETIC-key";
  envelope.ciphertext = "A".repeat(envelope.ciphertext.length);
  await denied(
    () => cipher.open(ORG, STUDENT, JSON.stringify(envelope)),
    "professional_protected_value_invalid",
  );
});
Deno.test("professional cursor is encrypted and purpose-separated from student metadata", async () => {
  const key = new Uint8Array(32).fill(4),
    cursor = new ProfessionalCursor(key),
    cipher = new ProfessionalStudentMetadataCipher({
      activeKeyId: "cursor",
      keys: [{ keyId: "cursor", bytes: key }],
    }, 4096);
  const token = await cursor.seal({ binding: { student: STUDENT }, offset: 1 });
  equal(await cursor.open(token), { binding: { student: STUDENT }, offset: 1 });
  assert(!token.includes(STUDENT));
  await denied(() => cursor.open(awaitableCipherToken()), "professional_cursor_invalid", 422);
  function awaitableCipherToken(): string {
    return "SYNTHETIC-invalid-token";
  }
  await denied(
    async () => cursor.open(btoa(await cipher.seal(ORG, STUDENT, {})).replaceAll("=", "")),
    "professional_cursor_invalid",
    422,
  );
});
function authorityFixture() {
  const state = {
    capacity: 30,
    memberVersion: 1,
    sourceVersion: "SYNTHETIC-source",
    calls: 0,
    owner: "synthetic_owner",
    hash: HASH,
  };
  const row = (): NativeObject => ({
    format: "jungsi.professional-authority/v1",
    subject_id: ACTOR,
    account_status: "active",
    account_role: "member",
    organizations: [{
      contract: {
        org_id: ORG,
        org_name: "가상 기관",
        contract_id: "SYNTHETIC-contract",
        academic_year: 2027,
        version: 1,
        status: "active",
        starts_at_utc: utcText(NOW - 1n),
        expires_at_utc: utcText(EXPIRY),
        contracted_student_count: state.capacity,
        approved_exam_ids: ["SYNTHETIC-mock"],
      },
      members: [{
        org_id: ORG,
        member_id: "SYNTHETIC-member",
        subject_id: ACTOR,
        role: "teacher",
        version: state.memberVersion,
        active: true,
      }],
      source_version: state.sourceVersion,
    }],
  });
  const adapter = new SupabaseProfessionalAuthority({
    status: "approved",
    schema: "synthetic",
    name: "authority",
    owner: "synthetic_owner",
    definitionSha256: HASH,
    maxResultBytes: 65536,
  }, async (statement) => {
    await Promise.resolve();
    state.calls++;
    return statement.includes("pg_get_userbyid")
      ? [[
        state.owner,
        "s",
        false,
        "3802",
        "{search_path=pg_catalog}",
        state.hash,
        false,
        false,
        true,
      ]]
      : [[nativeJsonText(row())]];
  });
  const user = {
    subjectId: ACTOR,
    expiresAtUtc: EXPIRY,
    accountStatus: "active",
    accountRole: "member",
    assuranceLevel: "aal2" as const,
  };
  return { state, adapter, user };
}
/**
 * 2026-11-13 구성원 이름(013 jeongsi_pro_member_names): 기관 관리자에게만, 승인 지문이 맞을 때만 이름.
 * 새 Deno.test 를 늘리지 않고(묶음 시험 수 고정) 기존 권한 시험 안에서 부른다
 */
async function memberNameChecks() {
  const NAMES_HASH = "c".repeat(64);
  let namesHash = NAMES_HASH, role = "org_admin";
  const row = () => ({
    format: "jungsi.professional-authority/v1",
    subject_id: ACTOR,
    account_status: "active",
    account_role: "member",
    organizations: [{
      contract: {
        org_id: ORG,
        org_name: "가상 기관",
        contract_id: "SYNTHETIC-contract",
        academic_year: 2027,
        version: 1,
        status: "active",
        starts_at_utc: utcText(NOW - 1n),
        expires_at_utc: utcText(EXPIRY),
        contracted_student_count: 30,
        approved_exam_ids: ["SYNTHETIC-mock"],
      },
      members: [
        { org_id: ORG, member_id: "1", subject_id: ACTOR, role, version: 1, active: true },
        {
          org_id: ORG,
          member_id: "2",
          subject_id: "SYNTHETIC-teacher",
          role: "teacher",
          version: 1,
          active: true,
        },
      ],
      source_version: "SYNTHETIC-source",
    }],
  });
  const binding = (name: string, hash: string) => ({
    status: "approved" as const,
    schema: "synthetic",
    name,
    owner: "synthetic_owner",
    definitionSha256: hash,
    maxResultBytes: 65536,
  });
  const make = (withNames: boolean) =>
    new SupabaseProfessionalAuthority(binding("authority", HASH), async (statement, params) => {
      await Promise.resolve();
      if (statement.includes("pg_get_userbyid")) {
        const names = String(params[0]).includes("member_names");
        return [[
          "synthetic_owner",
          "s",
          false,
          "3802",
          "{search_path=pg_catalog}",
          names ? namesHash : HASH,
          false,
          false,
          true,
        ]];
      }
      if (statement.includes('"member_names"')) {
        // 승인 명단의 구성원 번호만 보낸다
        equal(params[2], JSON.stringify(["1", "2"]));
        return [[nativeJsonText({ "1": " 가상 관리자 ", "2": "가상 교사", "999": "다른 기관" })]];
      }
      return [[nativeJsonText(row())]];
    }, withNames ? binding("member_names", NAMES_HASH) : null);
  const user = {
    subjectId: ACTOR,
    expiresAtUtc: EXPIRY,
    accountStatus: "active",
    accountRole: "member",
    assuranceLevel: "aal2" as const,
  };
  const admin = make(true), a = await admin.resolve(user, ORG, "member", NOW);
  // 같은 기관 구성원 이름만, 앞뒤 공백 정리, 모르는 번호는 버린다
  equal(await admin.memberNames(a), { "1": "가상 관리자", "2": "가상 교사" });
  // 이름 함수가 설정에 없으면 이름 없이
  const none = make(false);
  equal(await none.memberNames(await none.resolve(user, ORG, "member", NOW)), {});
  // 함수 지문이 승인 값과 다르면 이름 없이(목록은 막지 않음)
  namesHash = "d".repeat(64);
  equal(await admin.memberNames(await admin.resolve(user, ORG, "member", NOW)), {});
  // 교사는 이름을 받지 못한다
  role = "teacher";
  const teacher = make(true);
  await denied(
    async () => await teacher.memberNames(await teacher.resolve(user, ORG, "member", NOW)),
    "professional_access_denied",
    403,
  );
}
Deno.test("professional authority tolerates evaluation-time changes while rejecting contract/member changes", async () => {
  await memberNameChecks();
  const f = authorityFixture(), a = await f.adapter.resolve(f.user, ORG, "member", NOW);
  await f.adapter.assertCurrent(a, NOW + 1000n);
  f.state.capacity--;
  await denied(
    () => f.adapter.assertCurrent(a, NOW + 2000n),
    "professional_authority_changed",
    409,
  );
  f.state.capacity++;
  f.state.memberVersion++;
  await denied(
    () => f.adapter.assertCurrent(a, NOW + 3000n),
    "professional_authority_changed",
    409,
  );
});
Deno.test("professional authority rejects unapproved native definition and unissued receipts", async () => {
  const f = authorityFixture();
  f.state.hash = "b".repeat(64);
  await denied(
    () => f.adapter.resolve(f.user, ORG, "member", NOW),
    "professional_authority_unavailable",
    503,
  );
  const g = await fixture();
  await denied(
    () => f.adapter.assertCurrent(g.authority(), NOW),
    "professional_authority_unavailable",
    503,
  );
});
Deno.test("professional support privilege is checked before querying the native authority function", async () => {
  const f = authorityFixture();
  await denied(
    () => f.adapter.resolve(f.user, ORG, "support", NOW, "SYNTHETIC-ticket"),
    "professional_access_denied",
    403,
  );
  equal(f.state.calls, 0);
});
Deno.test("professional runtime missing approval stays unavailable without any native DB connection", async () => {
  let pools = 0;
  const runtime = new NativeProfessionalRuntime({
    environment: { get: () => undefined },
    responseSchemas: schemas,
    createPool: () => {
      pools++;
      throw new Error("SYNTHETIC-SECRET-CANARY");
    },
  });
  const response = await runtime.fetch(new Request("https://synthetic.invalid/api/v1/pro/session"));
  equal(response.status, 503);
  equal(pools, 0);
  assert(!(await response.text()).includes("SECRET-CANARY"));
});
Deno.test("professional native engine bridge uses unchanged pack validation and approved pending total model", async () => {
  const f = await fixture(), pack = new NativeExamPack(syntheticNativePackData());
  let fresh = 0;
  const data = {
    getExamPack: async () => await pack,
    getTotalModel: async () => await null,
    getCatalog: async () => await null,
    getConversion: async () => await null,
    getPercentile: async () => await null,
    getAnalysis: async () => await null,
    assertCurrentSelection: async () => {
      await Promise.resolve();
      fresh++;
    },
  };
  // 2026-11-13: 대학 찾기 비용은 모집단위 수와 떼어 센다(횟수) — 4,500곳이어도 1회 비용 1이 허용되고, 0은 거절
  new ProfessionalApprovedAnalysis(async () => await data, f.ports.reports, f.policy, f.clock, {
    maximumOfferings: 4500,
    unitsPerOffering: 1n,
    reservedCandidateUnits: 1n,
  });
  await denied(
    () =>
      Promise.resolve(
        new ProfessionalApprovedAnalysis(
          async () => await data,
          f.ports.reports,
          f.policy,
          f.clock,
          {
            maximumOfferings: 4500,
            unitsPerOffering: 1n,
            reservedCandidateUnits: 0n,
          },
        ),
      ),
    "professional_policy_unavailable",
    503,
  );
  const bridge = new ProfessionalApprovedAnalysis(
    async () => await data,
    f.ports.reports,
    f.policy,
    f.clock,
    { maximumOfferings: 20, unitsPerOffering: 1n, reservedCandidateUnits: 20n },
  );
  const stage = f.policy.stage(f.authority(), "SYNTHETIC-mock", "SYNTHETIC-pack.v1", "mock", NOW);
  equal(await bridge.validateScores(f.authority(), stage, scores()), null);
  const bad = scores();
  bad.korean = { standard_score: 999 };
  assert(await bridge.validateScores(f.authority(), stage, bad) !== null);
  const scope = { authority: f.authority(), student: f.baseStudent },
    result = await bridge.analyze(scope, f.profile, "pro.overall.analyze", {});
  equal((result.result.overall as NativeObject).status, "pending");
  assert(fresh > 0);
});
Deno.test("professional cursor binding rejects filter changes and expiry", async () => {
  const f = await fixture();
  f.f.students.set("SYNTHETIC-second", { ...f.baseStudent, studentId: "SYNTHETIC-second" });
  const first = await f.service.execute(
      f.execution("pro.student.list", {}, { query: { limit: "1" } }),
    ),
    cursor = ((first as { response: { data: NativeObject } }).response.data.next_cursor) as string;
  await denied(
    () =>
      f.service.execute(
        f.execution("pro.student.list", {}, { query: { limit: "1", q: "changed", cursor } }),
      ),
    "professional_cursor_changed",
    409,
  );
  f.f.now += 61000000n;
  await denied(
    () => f.service.execute(f.execution("pro.student.list", {}, { query: { limit: "1", cursor } })),
    "professional_cursor_expired",
    409,
  );
});
Deno.test("professional nested report secrets are removed while counseling connection remains explicit", async () => {
  const f = await fixture();
  const r = f.f.reports.values().next().value!;
  (r.body.overall as NativeObject).private_source = { token: "SYNTHETIC-SECRET-CANARY" };
  r.body.model_weights = ["SYNTHETIC-SECRET-CANARY"];
  const response = await f.handler(f.request("pro.report.read")), text = await response.text();
  equal(response.status, 200);
  assert(!text.includes("SECRET-CANARY"));
  assert(JSON.parse(text).reason_codes.includes("counseling_basis_not_connected"));
});
Deno.test("professional reassignment removes teacher access without changing organization ownership", async () => {
  const f = await fixture();
  f.f.students.set(STUDENT, { ...f.baseStudent, assignedSubjectIds: [OTHER], version: 2 });
  equal((await f.handler(f.request("pro.report.read"))).status, 404);
  equal(f.f.students.get(STUDENT)!.orgId, ORG);
  equal(f.f.reports.size, 1);
});
