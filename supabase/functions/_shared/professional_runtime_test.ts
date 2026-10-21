/** Native composition with exact-bearer Auth, private Storage and SQL protocol fakes only. */
import { NativeProfessionalRuntime } from "./jungsi/infrastructure/professional_runtime.ts";
import { PROFESSIONAL_CONTRACT } from "./jungsi/application/professional_contract.generated.ts";
import { nativeJsonText, type NativeObject } from "./jungsi/domain/json_value.ts";
import { utcText } from "./jungsi/domain/time.ts";
import {
  SYNTHETIC_RUNTIME_URL,
  syntheticRuntimeBinding,
  syntheticRuntimePin,
} from "../../../tests/edge/synthetic_runtime_binding.ts";
import schemas from "../../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
import { budgetSql } from "./professional_budget_support.ts";
import {
  ACTOR,
  assert,
  equal,
  EXPIRY,
  HASH,
  NOW,
  ORG,
  ORIGIN,
  policyRaw,
} from "./professional_support.ts";
function jwt(): string {
  const encode = (v: unknown) =>
    btoa(JSON.stringify(v)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return encode({ alg: "HS256", typ: "JWT" }) + "." +
    encode({
      sub: ACTOR,
      iss: SYNTHETIC_RUNTIME_URL + "/auth/v1",
      exp: Number(EXPIRY / 1000000n),
      aal: "aal2",
    }) + ".SYNTHETIC";
}
async function nativeFixture(change?: (raw: NativeObject) => void, initialSeats = 0) {
  const shared: NativeObject = {
    format: "jungsi.runtime-usage-policy/v1",
    status: "approved",
    version: "SYNTHETIC-policy",
    expires_at: utcText(EXPIRY),
    dimensions: [
      { kind: "request_window", period_seconds: 60, standard: 100, paid: 100, ceiling: 100 },
      { kind: "distinct_scores", period_seconds: 86400, standard: 3, paid: 10, ceiling: 10 },
      { kind: "calculation_cost", period_seconds: 86400, standard: 100, paid: 100, ceiling: 100 },
      { kind: "concurrent_jobs", period_seconds: 1, standard: 1, paid: 1, ceiling: 1 },
      {
        kind: "result_volume",
        period_seconds: 60,
        standard: 100000,
        paid: 100000,
        ceiling: 100000,
      },
    ],
  };
  const original = await syntheticRuntimeBinding((r) => {
    r.expires_at = utcText(EXPIRY);
  }, (head) => {
    head.expires_at = utcText(EXPIRY);
  }, (body) => {
    body.usage_policy = nativeJsonText(shared);
  });
  const sources = original.descriptor.sources as NativeObject;
  const raw: NativeObject = {
    format: "jungsi.professional-runtime/v1",
    status: "approved",
    approval_reference_sha256: HASH,
    expires_at: utcText(EXPIRY),
    registry_sha256: (sources.registry as NativeObject).sha256,
    selection_sha256: (sources.selection as NativeObject).sha256,
    policy: policyRaw(),
    metadata_max_bytes: 65536,
    approved_bff_origin: ORIGIN,
    lease: { lease_seconds: 406, runtime_hard_limit_seconds: 400, clock_margin_seconds: 5 },
    analysis_limits: { maximum_offerings: 1, units_per_offering: 1 },
    retention_records: [],
    authority_function: {
      status: "approved",
      schema: "synthetic",
      name: "authority",
      owner: "synthetic_owner",
      definitionSha256: HASH,
      maxResultBytes: 65536,
    },
    usage: {
      format: "jungsi.professional-usage/v1",
      status: "approved",
      approval_reference_sha256: HASH,
      expires_at: utcText(EXPIRY),
      shared_policy_version: "SYNTHETIC-policy",
      shared_capacity_tier: "paid",
      organization_window: { period_seconds: 60, requests_per_contracted_student: 4 },
      operations: PROFESSIONAL_CONTRACT.routes.map((r) => ({
        operation: r.id,
        maximum_result_bytes: 10000,
        calculation_units:
          ["pro.score.create", "pro.overall.analyze", "pro.university.analyze", "pro.candidates"]
              .includes(r.id)
            ? 1
            : 0,
      })),
    },
  };
  change?.(raw);
  const text = nativeJsonText(raw), pin = await syntheticRuntimePin(text);
  const values = {
    ...original.values,
    JUNGSI_PRO_RUNTIME_SETTINGS: text,
    JUNGSI_PRO_RUNTIME_SETTINGS_SHA256: pin.sha256,
    JUNGSI_PRO_METADATA_KEYRING: JSON.stringify({
      active_key_id: "SYNTHETIC-key",
      keys: [{ key_id: "SYNTHETIC-key", key_hex: "07".repeat(32) }],
    }),
    JUNGSI_DISPLAY_CURSOR_KEY_HEX: "08".repeat(32),
  } as Record<string, string>;
  let authorityCalls = 0, audits = 0, seats = initialSeats;
  const fetchCalls: string[] = [];
  const students = new Map<
      string,
      { org: string; contract: string; year: string; sealed: string; assigned: string[] }
    >(),
    receipts = new Map<string, [unknown, unknown]>();
  const authority = (): NativeObject => ({
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
        contracted_student_count: 20,
        approved_exam_ids: ["SYNTHETIC-mock"],
      },
      members: [{
        org_id: ORG,
        member_id: "SYNTHETIC-member",
        subject_id: ACTOR,
        role: "teacher",
        version: 1,
        active: true,
      }],
      source_version: "SYNTHETIC-source",
    }],
  });
  const db = budgetSql((statement, parameters) => {
    if (statement.includes("pg_get_userbyid")) {
      return [[
        "synthetic_owner",
        "s",
        false,
        "3802",
        "{search_path=pg_catalog}",
        HASH,
        false,
        false,
        true,
      ]];
    }
    if (statement.includes('"synthetic"."authority"')) {
      equal(parameters[0], ACTOR);
      authorityCalls++;
      return [[nativeJsonText(authority())]];
    }
    if (statement.startsWith("SELECT count(*)::text FROM jungsi_professional.seat_allocations")) {
      equal(parameters[0], ORG);
      return [[String(seats)]];
    }
    if (statement.startsWith("INSERT INTO jungsi_professional.students")) {
      students.set(String(parameters[1]), {
        org: String(parameters[0]),
        contract: String(parameters[2]),
        year: String(parameters[3]),
        sealed: String(parameters[4]),
        assigned: [],
      });
      return [];
    }
    if (statement.startsWith("INSERT INTO jungsi_professional.seat_allocations")) {
      seats++;
      return [];
    }
    if (statement.startsWith("INSERT INTO jungsi_professional.assignments")) {
      students.get(String(parameters[1]))!.assigned = [String(parameters[2])];
      return [];
    }
    if (statement.startsWith("SELECT s.org_id,s.student_id")) {
      const s = students.get(String(parameters[1]));
      return s && s.org === parameters[0]
        ? [[
          s.org,
          parameters[1],
          s.contract,
          s.year,
          "1",
          false,
          JSON.stringify(s.assigned),
          utcText(NOW).replace("Z", ".000000Z"),
          s.sealed,
        ]]
        : [];
    }
    if (
      statement.startsWith(
        "SELECT digest,sealed_result FROM jungsi_professional.operation_requests",
      )
    ) {
      const row = receipts.get(parameters.map(String).join("|"));
      return row ? [[...row]] : [];
    }
    if (statement.startsWith("INSERT INTO jungsi_professional.operation_requests")) {
      receipts.set(parameters.slice(0, 5).map(String).join("|"), [parameters[5], parameters[6]]);
      return [];
    }
    if (statement.startsWith("INSERT INTO jungsi_professional.audit_events")) {
      equal(parameters[0], ORG);
      audits++;
      return [];
    }
    return undefined;
  });
  const token = jwt();
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), h = new Headers(init?.headers);
    fetchCalls.push(url);
    let body: string, status = 200;
    if (url.includes("/auth/v1/user")) {
      if (h.get("authorization") !== "Bearer " + token) {
        status = 401;
        body = "{}";
      } else body = JSON.stringify({ id: ACTOR });
      equal(h.get("apikey"), values.SUPABASE_PUBLISHABLE_KEY);
    } else if (url.includes("/rest/v1/profiles?")) {
      equal(h.get("authorization"), "Bearer " + token);
      assert(url.includes("id=eq." + ACTOR));
      body = '[{"status":"active","role":"member"}]';
    } else if (url.includes("/bucket/")) {
      body = '{"id":"synthetic-private","public":false,"file_size_limit":65536}';
    } else {
      const name = url.split("/").at(-1)!.replace(/\.json$/, "");
      body = original.body[name];
      assert(typeof body === "string", "unexpected synthetic Storage URL " + url);
    }
    const response = new Response(body, { status });
    Object.defineProperty(response, "url", { value: url });
    return Promise.resolve(response);
  }) as typeof fetch;
  const runtime = new NativeProfessionalRuntime({
    environment: { get: (name) => values[name] },
    responseSchemas: schemas,
    createPool: () => db.pool,
    clock: { nowUtc: () => NOW },
    fetcher,
  });
  const request = () =>
    new Request(
      "https://synthetic.invalid/functions/v1/jungsi-pro-api" +
        PROFESSIONAL_CONTRACT.routes.find((r) => r.id === "pro.session")!.path,
      {
        headers: {
          Authorization: "Bearer " + token,
          "X-Jungsi-Relay-Token": values.JUNGSI_RELAY_TOKEN,
        },
      },
    );
  const createRequest = () =>
    new Request(
      "https://synthetic.invalid/functions/v1/jungsi-pro-api" +
        PROFESSIONAL_CONTRACT.routes.find((r) => r.id === "pro.student.create")!.path.replace(
          "{org_id}",
          ORG,
        ),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "X-Jungsi-Relay-Token": values.JUNGSI_RELAY_TOKEN,
          Origin: ORIGIN,
          "X-Jungsi-CSRF-Verified": "1",
          "Content-Type": "application/json",
          "Idempotency-Key": "SYNTHETIC-create",
        },
        body: JSON.stringify({ display_name: "가상 연결 학생", expected_contract_version: 1 }),
      },
    );
  return {
    runtime,
    request,
    createRequest,
    db,
    students,
    receipts,
    fetchCalls,
    values,
    authorityCalls: () => authorityCalls,
    audits: () => audits,
    seats: () => seats,
  };
}
Deno.test("professional native composition preserves exhausted-contract 409 without adding a student", async () => {
  const f = await nativeFixture(undefined, 20), response = await f.runtime.fetch(f.createRequest());
  equal(response.status, 409);
  equal((await response.json()).error.code, "student_seat_limit_reached");
  equal(f.students.size, 0);
  equal(f.receipts.size, 0);
  equal(f.seats(), 20);
  assert(![...f.db.leases.values()].some((lease) => lease[4] === "active"));
});
Deno.test("professional native composition creates one encrypted student and seat with idempotent replay", async () => {
  const f = await nativeFixture(),
    first = await f.runtime.fetch(f.createRequest()),
    firstText = await first.text();
  equal(first.status, 201);
  const a = JSON.parse(firstText);
  const again = await f.runtime.fetch(f.createRequest()), b = await again.json();
  equal(again.status, 201);
  equal(a.data.student_id, b.data.student_id);
  equal(f.seats(), 1);
  equal(f.students.size, 1);
  equal(f.receipts.size, 1);
  assert(![...f.students.values()][0].sealed.includes("가상 연결 학생"));
  assert(!String([...f.receipts.values()][0][1]).includes("가상 연결 학생"));
  equal(f.audits(), 2);
  assert([...f.db.leases.values()].every((lease) => lease[4] === "success"));
});
Deno.test("professional native composition executes session with exact-bearer Auth Storage authority SQL and settlement", async () => {
  const f = await nativeFixture(),
    response = await f.runtime.fetch(f.request()),
    text = await response.text();
  equal(response.status, 200);
  const json = JSON.parse(text);
  equal(json.data.org_id, ORG);
  equal(json.data.used_student_count, 0);
  equal(json.data.remaining_student_count, 20);
  assert(f.authorityCalls() >= 3);
  equal(f.audits(), 1);
  equal(f.fetchCalls.filter((url) => url.includes("/auth/v1/user")).length, 2);
  equal(f.fetchCalls.filter((url) => url.includes("/rest/v1/profiles?")).length, 2);
  assert([...f.db.leases.values()].every((lease) => lease[4] === "success"));
  assert([...f.db.institutionLeases.values()].every((lease) => lease.state === "success"));
  assert(!text.includes("key_hex"));
});
Deno.test("professional native composition rejects unbound source fingerprints before authority or accounting", async () => {
  const f = await nativeFixture((raw) => {
      raw.registry_sha256 = "b".repeat(64);
    }),
    response = await f.runtime.fetch(f.request());
  equal(response.status, 503);
  equal(f.authorityCalls(), 0);
  equal(f.db.leases.size, 0);
});
Deno.test("professional native composition preserves the existing worker and lease lifetime contract", async () => {
  const f = await nativeFixture((raw) => {
      raw.lease = { lease_seconds: 10, runtime_hard_limit_seconds: 1, clock_margin_seconds: 1 };
    }),
    response = await f.runtime.fetch(f.request());
  equal(response.status, 503);
  equal(f.authorityCalls(), 0);
  equal(f.db.leases.size, 0);
});
Deno.test("professional native composition rejects an invalid real-Auth boundary before Storage and SQL", async () => {
  const f = await nativeFixture(), request = f.request();
  request.headers.set("authorization", "Bearer SYNTHETIC-invalid");
  const response = await f.runtime.fetch(request);
  equal(response.status, 401);
  equal(f.authorityCalls(), 0);
  equal(f.db.leases.size, 0);
  assert(!f.fetchCalls.some((url) => url.includes("/storage/v1/")));
});
