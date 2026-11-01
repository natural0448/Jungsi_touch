/** REVIEW ONLY: final-expiry candidate tests; all inputs and ports are synthetic. */
/** Synthetic review only; no env, live JWT, DB, private artifacts or file cleanup. */
import {
  createOfficialHistoryDisplayHandler,
  DB_FIELDS,
  OPERATIONS,
  sameJson,
} from "../../supabase/functions/_shared/official_history_display.ts";
import type {
  DisplayDescriptor,
  OfficialHistoryPorts,
  Row,
} from "../../supabase/functions/_shared/official_history_display.ts";
const SUBJECT = "00000000-0000-0000-0000-000000000001";
const NOW = Date.parse("2026-10-08T00:00:00Z"),
  TOKEN = "SYNTHETIC-relay-not-an-operating-secret-0000";
const assert = (v: unknown, message = "synthetic assertion failed") => {
  if (!v) throw new Error(message);
};
const equal = (a: unknown, b: unknown) => assert(sameJson(a, b), "synthetic typed equality failed");
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function synthetic(): DisplayDescriptor {
  const offer: Row = {
    offering_id: "2026:SYNTHETIC-A",
    academic_year: 2026,
    university_id: "SYNTHETIC-U",
    university_name: "SYNTHETIC University",
    campus: "SYNTHETIC Campus",
    department: "SYNTHETIC Department",
    track: "SYNTHETIC Reviewed Track",
    group: "가",
    region: "SYNTHETIC Region",
    wildcard_group: null,
    practical_required: false,
  };
  const history: Row[] = [], bindings: Row[] = [];
  for (const [i, value] of ["77.25", 0, null].entries()) {
    const row = { ...offer };
    delete row.practical_required;
    Object.assign(row, {
      metric_name: "SYNTHETIC metric " + i,
      metric_definition: "SYNTHETIC 75% definition",
      value,
      unit: "SYNTHETIC unit",
      original_scale: "SYNTHETIC original scale",
      publication_status: "published",
      source_url: "https://example.org/synthetic",
      source_as_of: null,
      verification_status: "verified_official",
    });
    history.push(row);
    const db: Row = Object.fromEntries(DB_FIELDS.map((k) => [k, null]));
    Object.assign(db, {
      release_id: "SYNTHETIC-source",
      result_id: "SYNTHETIC-cell-" + i,
      academic_year: 2026,
      school_id: "SYNTHETIC-school",
      university_code: "SYNTHETIC-code",
      university: "SYNTHETIC raw University",
      recruit_group: "가군",
      department: "SYNTHETIC Department",
      track: null,
      offering_pk: "SYNTHETIC-A",
      anchor_2027_pks: [],
      metric_kind: "SYNTHETIC metric",
      metric_value_literal: JSON.stringify(value),
      metric_value_numeric: value === null ? null : String(value),
      metric_value_json_type: value === null
        ? "null"
        : typeof value === "string"
        ? "string"
        : "number",
      cohort: "SYNTHETIC registered",
      statistic_label: "SYNTHETIC 75%",
      active_service: true,
      source_path: "SYNTHETIC/private/source",
      source_sha256: "a".repeat(64),
      source_location: {},
      source_review_status: "SYNTHETIC verified",
      original_record_locator: {},
      field_presence_types: { SYNTHETIC: true },
      row_fingerprint: "b".repeat(64),
    });
    bindings.push({
      native_history_index: i,
      offering_id: offer.offering_id,
      source_offering_pk: "SYNTHETIC-A",
      expected_db_row: db,
    });
  }
  return {
    format: "jungsi.official-history-display/v1",
    purpose: "official_history_display",
    environment: "local_verification",
    source_view: "jungsi_data_ingest.admission_results_curated_v21_1",
    engine_approved: false,
    production_allowed: false,
    nationwide_collection_complete: false,
    approval: {
      status: "approved",
      approval_id: "SYNTHETIC-display-approval",
      issued_at: "2026-10-08T00:00:00Z",
      expires_at: "2026-10-08T01:00:00Z",
      revoked: false,
      review_subjects: [SUBJECT],
      operations: [...OPERATIONS],
    },
    source_evidence: {
      metric_lineage_sha256: "c".repeat(64),
      offering_boundary_receipt_sha256: "d".repeat(64),
    },
    catalog: {
      format: "jungsi.catalog-release/v1",
      version: "SYNTHETIC-catalog-v1",
      status: "approved",
      as_of: "2026-10-08T00:00:00Z",
      offerings: [offer],
      history,
      nationwide_collection_complete: false,
      admission_probability_provided: false,
    },
    bindings,
  };
}
function fixture() {
  const descriptor = synthetic(),
    rows = descriptor.bindings.map((b) => copy(b.expected_db_row as Row)),
    calls: string[] = [];
  let paid: string | null = null, sub = SUBJECT;
  const ports: OfficialHistoryPorts = {
    async verifySession(token) {
      calls.push("verify");
      return await Promise.resolve(
        token === "SYNTHETIC-user" ? { subjectId: sub, expiresAt: NOW + 3600000 } : null,
      );
    },
    async loadDescriptor() {
      calls.push("descriptor");
      return await Promise.resolve(copy(descriptor));
    },
    async paidUntil() {
      calls.push("entitlement");
      return await Promise.resolve(paid);
    },
    async readRows() {
      calls.push("rows");
      return await Promise.resolve(copy(rows));
    },
  };
  const handler = createOfficialHistoryDisplayHandler(ports, {
    relayToken: TOKEN,
    pathPrefix: "/functions/v1/SYNTHETIC-display",
    environment: "local_verification",
    now: () => NOW,
  });
  const request = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    handler(
      new Request("https://example.org/functions/v1/SYNTHETIC-display" + path, {
        method,
        headers: {
          "X-Jungsi-Relay-Token": TOKEN,
          Authorization: "Bearer SYNTHETIC-user",
          ...headers,
        },
      }),
    );
  return {
    descriptor,
    rows,
    calls,
    ports,
    request,
    setPaid: (v: string | null) => {
      paid = v;
    },
    setSubject: (v: string) => {
      sub = v;
    },
  };
}

Deno.test("end admission on all official display routes precedes session and rows", async () => {
  const f = fixture(),
    end = Date.parse("2027-01-07T15:00:00Z"),
    prefix = "/functions/v1/SYNTHETIC-display";
  const handler = createOfficialHistoryDisplayHandler(f.ports, {
    relayToken: TOKEN,
    pathPrefix: prefix,
    environment: "local_verification",
    now: () => end,
  });
  for (
    const path of [
      "/api/v1/me",
      "/api/v1/admission-history",
      "/api/v1/offerings/search",
      "/api/v1/offerings/SYNTHETIC-A",
      "/api/v1/offerings/SYNTHETIC-A/recruitment",
    ]
  ) {
    const r = await handler(
      new Request("https://synthetic.invalid" + prefix + path, {
        headers: { "X-Jungsi-Relay-Token": TOKEN },
      }),
    );
    equal(r.status, 403);
    equal((await r.json()).error.code, "service_ended");
  }
  equal(f.calls, []);
});
Deno.test("official display accepted before boundary can finish after it", async () => {
  const f = fixture(),
    end = Date.parse("2027-01-07T15:00:00Z"),
    prefix = "/functions/v1/SYNTHETIC-display";
  let clock = end - 1;
  f.descriptor.approval.issued_at = "2027-01-07T14:00:00Z";
  f.descriptor.approval.expires_at = "2027-01-07T16:00:00Z";
  f.ports.verifySession = async () => {
    clock = end + 1000;
    return await Promise.resolve({ subjectId: SUBJECT, expiresAt: end + 3600000 });
  };
  const handler = createOfficialHistoryDisplayHandler(f.ports, {
    relayToken: TOKEN,
    pathPrefix: prefix,
    environment: "local_verification",
    now: () => clock,
  });
  const r = await handler(
    new Request("https://synthetic.invalid" + prefix + "/api/v1/me", {
      headers: { "X-Jungsi-Relay-Token": TOKEN, Authorization: "Bearer SYNTHETIC-user" },
    }),
  );
  equal(r.status, 200);
  equal((await r.json()).format, "jungsi.session/v1");
  equal(clock, end + 1000);
});
Deno.test("official display relay failure is still first after cutoff", async () => {
  const f = fixture(), prefix = "/functions/v1/SYNTHETIC-display";
  const handler = createOfficialHistoryDisplayHandler(f.ports, {
    relayToken: TOKEN,
    pathPrefix: prefix,
    environment: "local_verification",
    now: () => Date.parse("2027-01-07T15:00:00Z"),
  });
  const r = await handler(new Request("https://synthetic.invalid" + prefix + "/api/v1/me"));
  equal(r.status, 403);
  equal((await r.json()).error.code, "relay_authentication_failed");
  equal(f.calls, []);
});

function expiryFixture() {
 const f=fixture(),end=Date.parse("2027-01-07T15:00:00Z"),prefix="/functions/v1/SYNTHETIC-display";
 let clock=end-1, expiry=end+3_600_000;
 f.descriptor.approval.issued_at="2027-01-07T14:00:00Z";f.descriptor.approval.expires_at="2027-01-07T16:00:00Z";
 f.setPaid("2027-01-07T16:00:00Z");
 f.ports.verifySession=async()=>({subjectId:SUBJECT,expiresAt:expiry});
 const original=f.ports.readRows;
 f.ports.readRows=async(d)=>{const rows=await original(d);clock=end+1000;return rows;};
 const handler=createOfficialHistoryDisplayHandler(f.ports,{relayToken:TOKEN,pathPrefix:prefix,environment:"local_verification",now:()=>clock});
 const request=(path="/api/v1/offerings/search")=>handler(new Request("https://synthetic.invalid"+prefix+path,{headers:{"X-Jungsi-Relay-Token":TOKEN,Authorization:"Bearer SYNTHETIC-user"}}));
 return {f,end,request,setClock:(v:number)=>{clock=v;},setExpiry:(v:number)=>{expiry=v;},clock:()=>clock};
}
Deno.test("FINAL: expired session blocks fetched rows",async()=>{
 const x=expiryFixture();x.setExpiry(x.end);const r=await x.request(),text=await r.text();
 equal(r.status,401);equal(JSON.parse(text).error.code,"authentication_required");assert(!text.includes("SYNTHETIC metric"));assert(x.f.calls.includes("rows"));
});
Deno.test("FINAL: expired paid pass blocks fetched rows",async()=>{
 const x=expiryFixture();x.f.setPaid("2027-01-07T15:00:00Z");const r=await x.request(),text=await r.text();
 equal(r.status,503);equal(JSON.parse(text).error.code,"entitlement_unavailable");assert(!text.includes("SYNTHETIC metric"));
});
Deno.test("FINAL: expired approval blocks fetched rows",async()=>{
 const x=expiryFixture();x.f.descriptor.approval.expires_at="2027-01-07T15:00:00Z";const r=await x.request(),text=await r.text();
 equal(r.status,503);equal(JSON.parse(text).error.code,"official_history_scope_unverified");assert(!text.includes("SYNTHETIC metric"));
});
Deno.test("FINAL: non-expired admission crossing end still returns normally",async()=>{
 const x=expiryFixture();const r=await x.request();equal(r.status,200);assert(x.clock()>x.end);
});
Deno.test("FINAL: invalid final clock fails closed",async()=>{
 const x=expiryFixture(),original=x.f.ports.readRows;x.f.ports.readRows=async(d)=>{const rows=await original(d);x.setClock(NaN);return rows;};
 const r=await x.request();equal(r.status,503);equal((await r.json()).error.code,"security_policy_unavailable");
});
Deno.test("FINAL: backward final clock fails closed",async()=>{
 const x=expiryFixture(),original=x.f.ports.readRows;x.f.ports.readRows=async(d)=>{const rows=await original(d);x.setClock(x.end-2);return rows;};
 const r=await x.request();equal(r.status,503);equal((await r.json()).error.code,"security_policy_unavailable");
});
Deno.test("FINAL: changed pinned descriptor is refused",async()=>{
 const x=expiryFixture(),original=x.f.ports.readRows;x.f.ports.readRows=async(d)=>{const rows=await original(d);d.approval.revoked=true;return rows;};
 const r=await x.request();equal(r.status,503);equal((await r.json()).error.code,"official_history_scope_unverified");
});
Deno.test("FINAL: session endpoint expiry at exact completion is denied",async()=>{
 const x=expiryFixture();x.setExpiry(x.end);x.f.ports.verifySession=async()=>{x.setClock(x.end);return {subjectId:SUBJECT,expiresAt:x.end};};
 const r=await x.request("/api/v1/me");equal(r.status,401);equal((await r.json()).error.code,"authentication_required");
});
Deno.test("FINAL: all five read paths allow already admitted and otherwise valid requests",async()=>{
 for(const path of ["/api/v1/me","/api/v1/admission-history","/api/v1/offerings/search","/api/v1/offerings/2026%3ASYNTHETIC-A","/api/v1/offerings/2026%3ASYNTHETIC-A/recruitment"]){
  const x=expiryFixture();x.f.ports.verifySession=async()=>{x.setClock(x.end+1000);return {subjectId:SUBJECT,expiresAt:x.end+3600000}};
  equal((await x.request(path)).status,200);
 }
});
Deno.test("FINAL: unrepresentable microsecond clock fails closed",async()=>{
 const x=expiryFixture(),original=x.f.ports.readRows;x.f.ports.readRows=async(d)=>{const rows=await original(d);x.setClock(Number.MAX_SAFE_INTEGER);return rows;};
 const r=await x.request();equal(r.status,503);equal((await r.json()).error.code,"security_policy_unavailable");
});
function validationTimeFixture(sessionExpiry:number,approvalExpiry:string,passExpiry:string,offsets:number[]) {
 const f=fixture(),end=Date.parse("2027-01-07T15:00:00Z"),prefix="/functions/v1/SYNTHETIC-display";let index=0;
 f.descriptor.approval.issued_at="2027-01-07T14:00:00Z";f.descriptor.approval.expires_at=approvalExpiry;f.setPaid(passExpiry);
 f.ports.verifySession=async()=>({subjectId:SUBJECT,expiresAt:sessionExpiry});
 const handler=createOfficialHistoryDisplayHandler(f.ports,{relayToken:TOKEN,pathPrefix:prefix,environment:"local_verification",now:()=>end+offsets[Math.min(index++,offsets.length-1)]});
 return handler(new Request("https://synthetic.invalid"+prefix+"/api/v1/me",{headers:{"X-Jungsi-Relay-Token":TOKEN,Authorization:"Bearer SYNTHETIC-user"}}));
}
Deno.test("FINAL: session expiring during approval revalidation is denied",async()=>{
 const end=Date.parse("2027-01-07T15:00:00Z"),r=await validationTimeFixture(end,"2027-01-07T16:00:00Z","2027-01-07T16:00:00Z",[-10,-1,0]);
 equal(r.status,401);equal((await r.json()).error.code,"authentication_required");
});
Deno.test("FINAL: approval expiring during its own revalidation is denied",async()=>{
 const end=Date.parse("2027-01-07T15:00:00Z"),r=await validationTimeFixture(end+3600000,"2027-01-07T15:00:00Z","2027-01-07T16:00:00Z",[-10,-1,0]);
 equal(r.status,503);equal((await r.json()).error.code,"official_history_scope_unverified");
});
Deno.test("FINAL: pass expiring during approval revalidation is denied",async()=>{
 const end=Date.parse("2027-01-07T15:00:00Z"),r=await validationTimeFixture(end+3600000,"2027-01-07T16:00:00Z","2027-01-07T15:00:00Z",[-10,-1,0]);
 equal(r.status,503);equal((await r.json()).error.code,"entitlement_unavailable");
});
Deno.test("FINAL: crossing global end while still authorized can complete",async()=>{
 const end=Date.parse("2027-01-07T15:00:00Z"),r=await validationTimeFixture(end+3600000,"2027-01-07T16:00:00Z","2027-01-07T16:00:00Z",[-10,-1,0]);
 equal(r.status,200);
});
Deno.test("FINAL: backward clock during approval revalidation is denied",async()=>{
 const end=Date.parse("2027-01-07T15:00:00Z"),r=await validationTimeFixture(end+3600000,"2027-01-07T16:00:00Z","2027-01-07T16:00:00Z",[-10,-1,-2]);
 equal(r.status,503);equal((await r.json()).error.code,"security_policy_unavailable");
});
