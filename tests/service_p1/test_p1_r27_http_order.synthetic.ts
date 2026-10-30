/** Explicit candidate-only router and binding checks; no operating installation or private I/O. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  type ApiExecution,
  type ApiRoutePolicy,
  READ_VIEW_CONSUMER_OPERATION_IDS,
  READ_VIEW_OPERATION_IDS,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import {
  type ApiHttpPorts,
  createApiHandler,
} from "../../supabase/functions/_shared/jungsi/infrastructure/api_http.ts";
import { RelayBoundary } from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";
import {
  publicJsonText,
  PublicResponseProjection,
} from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { HistorySnapshotService } from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { SYNTHETIC_QUALIFICATION_SCHEMA_JSON } from "../edge/synthetic_history_qualification.ts";
import {
  syntheticSnapshotPublication,
  syntheticSnapshotStatisticsBody,
} from "../edge/synthetic_history_snapshot.ts";
import { syntheticApiPolicies } from "../edge/synthetic_api_contract.ts";
import {
  SYNTHETIC_RUNTIME_NOW as NOW,
  syntheticRuntimeBinding,
} from "../edge/synthetic_runtime_binding.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal } from "../edge/fixture.ts";
const RELAY = "SYNTHETIC-relay-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  OWNER = "00000000-0000-0000-0000-000000000001";
const extra: ApiRoutePolicy[] = [{
  id: "history.snapshot.head",
  method: "GET",
  path: "/api/v1/admission-history/snapshot/head",
  member_tiers: ["standard", "paid"],
  report_owner: false,
  confirmed_score_profile: false,
}, {
  id: "history.snapshot.read",
  method: "GET",
  path: "/api/v1/admission-history/snapshots/{snapshot_id}",
  member_tiers: ["standard", "paid"],
  report_owner: false,
  confirmed_score_profile: false,
}, {
  id: "report.list-own",
  method: "GET",
  path: "/api/v1/me/reports",
  member_tiers: ["standard", "paid"],
  report_owner: false,
  confirmed_score_profile: false,
}];
function fixture(
  options: {
    extended?: boolean;
    scopeFailure?: boolean;
    notModified?: boolean;
    finalFailure?: boolean;
    expire?: boolean;
  } = {},
) {
  const policies = [...syntheticApiPolicies(), ...(options.extended ? extra : [])],
    expected = policies.map((p) => ({ id: p.id, contract_ref: "SYNTHETIC" })),
    root = {
      type: "object",
      nullable: false,
      properties: { shown: { type: "string", nullable: false } },
      required: ["shown"],
      optional: [],
    };
  const projection = new PublicResponseProjection({
    format: "jungsi.public-response-schemas/v1",
    schemas: { result: root },
    operations: expected.map((p) => ({
      ...p,
      roots: {
        standard: { ref: "result", nullable: false },
        paid: { ref: "result", nullable: false },
      },
    })),
    auxiliary_roots: {
      error: { ref: "result", nullable: false },
      readiness: { ref: "result", nullable: false },
    },
  }, expected);
  const events: string[] = [];
  let now = NOW;
  const ports: ApiHttpPorts = {
    relay: new RelayBoundary(RELAY),
    clock: { nowUtc: () => now },
    projection,
    sessions: {
      verifyUserBearer: () => {
        events.push("auth");
        return Promise.resolve({ subjectId: OWNER, expiresAtUtc: NOW + 1000000n });
      },
    },
    passes: {
      readCurrent: (subjectId, evaluatedAtUtc) => {
        events.push("membership");
        return Promise.resolve({
          authority: "public.jeongsi_passes" as const,
          metadataVerified: true,
          subjectId,
          evaluatedAtUtc,
          paidUntilUtc: null,
        });
      },
    },
    reports: { lookupAccess: () => Promise.resolve(null) },
    authorities: { readCurrent: () => Promise.reject(new Error("unexpected management")) },
    resources: { readScope: () => Promise.reject(new Error("unexpected scope")) },
    business: {
      execute: () => {
        events.push("business");
        return Promise.resolve({ shown: "SYNTHETIC-public" });
      },
    },
    budget: {
      run: async (_r, work) => {
        events.push("reserve");
        const value = await work();
        events.push("settle");
        if (options.expire) now = NOW + 1000000n;
        return value;
      },
    },
    completion: {
      accept: (_r, work) => work(),
      current: () => {
        events.push("finish");
        return options.finalFailure
          ? Promise.reject(new AccessError("publication_changed", 409))
          : Promise.resolve();
      },
      deliver: () => {
        events.push("deliver");
        return Promise.resolve();
      },
    },
    ...(options.extended
      ? {
        readViewScope: {
          assert: () => {
            events.push("candidate_scope");
            return options.scopeFailure
              ? Promise.reject(new AccessError("operation_scope_not_approved", 503))
              : Promise.resolve();
          },
        },
      }
      : {}),
    ...(options.notModified
      ? {
        representation: {
          encode: () => {
            events.push("encode304");
            return Promise.resolve({
              body: null,
              status: 304 as const,
              etag: '"' + "a".repeat(64) + '"',
              gzip: true,
            });
          },
        },
      }
      : {}),
  };
  return { ports, policies, events, handler: createApiHandler(policies, ports) };
}
function request(path: string) {
  return new Request("https://synthetic.invalid" + path, {
    headers: {
      Authorization: "Bearer SYNTHETIC-user",
      "X-Jungsi-Relay-Token": RELAY,
      "If-None-Match": '"' + "a".repeat(64) + '"',
    },
  });
}
async function denied(work: () => unknown | Promise<unknown>) {
  let e: unknown;
  try {
    await work();
  } catch (error) {
    e = error;
  }
  assert(e instanceof AccessError);
}

import { P1R27RequestAdmission } from "../../supabase/functions/_shared/jungsi/infrastructure/p1_r27_request_admission.ts";
const R27_TEST_TOKEN = "SyntheticConsumer_".repeat(3);
const R27_KEYS = ["headSha256","manifestSha256","sourceHeadSha256","scopeSha256","indexSha256",
 "coverageSha256","globalReceiptSha256","consumerReceiptSha256","consumerBuildSha256","consumerContractSha256"] as const;
const R27_PINS = Object.fromEntries(R27_KEYS.map((k,i)=>[k,"0123456789"[i].repeat(64)])) as
 Record<typeof R27_KEYS[number],string>;
const r27Binding = {descriptorSha256:"a".repeat(64),expiresAtUtc:NOW+900000n,
 operations:["history.snapshot.head","history.snapshot.read"],readLimits:{maxBytes:8192},
 readViews:{snapshot:{scopeSha256:R27_PINS.scopeSha256,maxMetadataBytes:4096}}};
async function r27sha(text:string):Promise<string>{
 return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))]
  .map(n=>n.toString(16).padStart(2,"0")).join("");
}
async function r27env(){
 const descriptor={format:"jungsi.p1-r27-server-admission/v1",status:"approved",
  purpose:"history_snapshot_r27_consumer",api_binding_sha256:r27Binding.descriptorSha256,
  approval_reference_sha256:"b".repeat(64),deployment_evidence_sha256:"c".repeat(64),
  consumer_id:"SYNTHETIC-CONSUMER",credential_sha256:await r27sha(R27_TEST_TOKEN),
  expires_at_utc_micros:String(NOW+800000n),operations:["history.snapshot.read"],
  max_extra_bytes:4096,max_index_bytes:2048,pins:R27_PINS};
 const text=JSON.stringify(descriptor), expected=await r27sha(text), entries=new Map([
  ["JUNGSI_P1_R27_CONSUMER_BINDING_JSON",text],
  ["JUNGSI_P1_R27_CONSUMER_BINDING_SHA256",expected],["JUNGSI_RELAY_TOKEN",RELAY]]);
 return {get:(key:string)=>entries.get(key)};
}
function r27request(relay:string|undefined=RELAY,bearer:string|null="Bearer SYNTHETIC-user"){
 const headers=new Headers({"X-Jungsi-P1-R27-Consumer-Credential":R27_TEST_TOKEN});
 if(relay!==undefined)headers.set("X-Jungsi-Relay-Token",relay);
 if(bearer!==null)headers.set("Authorization",bearer);
 return new Request("https://synthetic.invalid/api/v1/admission-history/snapshots/SYNTHETIC-SNAPSHOT",{headers});
}
Deno.test("HTTP authenticates relay, user and membership before independent R27 admission",async()=>{
 const f=fixture({extended:true}), req=r27request(), guard=new P1R27RequestAdmission(req,()=>NOW);
 let calls=0;
 (f.ports.business as {execute: (r: ApiExecution) => Promise<unknown>}).execute=async (r)=>{
  calls++; f.events.push("r27_credential");
  await guard.prepare(await r27env(),r27Binding,req,r);
  const input=guard.take(r,r.session.user.subjectId);assert(input);
  input.admission.assertBoundConsumer({headSha256:R27_PINS.headSha256,manifestSha256:R27_PINS.manifestSha256,
    scopeSha256:R27_PINS.scopeSha256,consumerBuildSha256:R27_PINS.consumerBuildSha256,
    consumerContractSha256:R27_PINS.consumerContractSha256});
  return {shown:"SYNTHETIC-public"};
 };
 const response=await f.handler(req);
 equal(response.status,200);equal(calls,1);
 assert(f.events.indexOf("auth")<f.events.indexOf("membership"));
 assert(f.events.indexOf("membership")<f.events.indexOf("r27_credential"));
 assert(f.events.indexOf("reserve")<f.events.indexOf("r27_credential"));
 guard.assertCurrent();guard.close();
});
Deno.test("HTTP missing relay or bearer never reaches independent R27 credential verification",async()=>{
 for (const testCase of ["relay","bearer"]){
  const f=fixture({extended:true});
  const req=testCase==="relay"?r27request("bad"):r27request(RELAY,null);
  let calls=0;
  (f.ports.business as {execute: (r: ApiExecution) => Promise<unknown>}).execute=async ()=>{
   calls++;return {shown:"SYNTHETIC-public"};
  };
  const response=await f.handler(req);
  assert(response.status===401||response.status===403);
  equal(calls,0);
 }
});

Deno.test("HTTP invalid consumer settings return 503 without credential or user leakage",async()=>{
 const f=fixture({extended:true}),req=r27request(),guard=new P1R27RequestAdmission(req,()=>NOW);
 const configured=await r27env();
 const badEnv={get:(key:string)=>key==="JUNGSI_P1_R27_CONSUMER_BINDING_SHA256"?"f".repeat(64):configured.get(key)};
 (f.ports.business as {execute:(r:ApiExecution)=>Promise<unknown>}).execute=async(r)=>{
   await guard.prepare(badEnv,r27Binding,req,r);
   if (!guard.take(r,r.session.user.subjectId)) throw new AccessError("snapshot_unavailable",503);
   return {shown:"SYNTHETIC-public"};
 };
 const response=await f.handler(req),text=await response.text();
 equal(response.status,503);assert(!text.includes(R27_TEST_TOKEN));assert(!text.includes(OWNER));
 guard.close();
});

Deno.test("HTTP v1 path survives invalid optional R27 configuration",async()=>{
 const f=fixture({extended:true}),req=r27request(),guard=new P1R27RequestAdmission(req,()=>NOW);
 const configured=await r27env();
 const badEnv={get:(key:string)=>key==="JUNGSI_P1_R27_CONSUMER_BINDING_SHA256"?"f".repeat(64):configured.get(key)};
 (f.ports.business as {execute:(r:ApiExecution)=>Promise<unknown>}).execute=async(r)=>{
   await guard.prepare(badEnv,r27Binding,req,r);
   equal(guard.take(r,r.session.user.subjectId),undefined);
   return {shown:"SYNTHETIC-v1"};
 };
 const response=await f.handler(req),text=await response.text();
 equal(response.status,200);assert(text.includes("SYNTHETIC-v1"));assert(!text.includes(R27_TEST_TOKEN));
 guard.close();
});
