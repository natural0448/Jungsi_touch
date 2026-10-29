import { assertAdmissionMicros } from "../application/service_end_admission.ts";
/** Native institutional composition. Missing Owner source/configuration is a safe unavailable response. */
import { AccessError } from "../application/access.ts";
import type { ApiOperationId } from "../application/api_dispatch.ts";
import type { RequestClockPort, VerifiedUser } from "../application/ports.ts";
import { ProfessionalApprovedAnalysis } from "../application/professional_analysis.ts";
import { PROFESSIONAL_CONTRACT } from "../application/professional_contract.generated.ts";
import {
  ProfessionalPolicy,
  proId,
  proInteger,
  proObject,
} from "../application/professional_policy.ts";
import { ProfessionalProjection } from "../application/professional_projection.ts";
import { ProfessionalService } from "../application/professional_service.ts";
import { ProfessionalSharedUsage } from "../application/professional_usage.ts";
import { parseNativeJson } from "../domain/native_json.ts";
import { utcInstant } from "../domain/time.ts";
import { RelayBoundary, safeFailure } from "./auth_relay.ts";
import {
  type ProfessionalAuthorityFunctionBinding,
  SupabaseProfessionalAuthority,
} from "./professional_authority.ts";
import {
  ProfessionalCursor,
  type ProfessionalMetadataKeyRing,
  ProfessionalOperationCipher,
  ProfessionalStudentMetadataCipher,
} from "./professional_crypto.ts";
import { createProfessionalHandler, professionalMutationGuard } from "./professional_http.ts";
import {
  type ProfessionalRetentionAuthority,
  SupabaseProfessionalStore,
} from "./professional_postgres.ts";
import { SupabaseProfessionalUsageAdmission } from "./professional_usage_admission.ts";
import { SupabaseProfessionalUsageBudgetStore } from "./professional_usage_postgres.ts";
import { NativeRuntimeRequest } from "./runtime_context.ts";
import {
  type BasicRuntimeSettings,
  readBasicRuntimeSettings,
  resolveRuntimeEnvironment,
  type RuntimeEnvironment,
} from "./runtime_settings.ts";
import { SupabaseNativeAuth } from "./supabase_auth.ts";
import { type NativeSqlPool, SupabaseSqlTransport } from "./transaction_sql.ts";
import { BoundVerifiedSessionProvider } from "./verified_session.ts";
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function hex(value: unknown, bytes: number): Uint8Array {
  if (typeof value !== "string" || value.length !== bytes * 2 || !/^[a-f0-9]+$/.test(value)) fail();
  return Uint8Array.from(value.match(/../g)!, (v) => parseInt(v, 16));
}
async function settings(env: RuntimeEnvironment, now: bigint) {
  const raw = env.get("JUNGSI_PRO_RUNTIME_SETTINGS"),
    expected = env.get("JUNGSI_PRO_RUNTIME_SETTINGS_SHA256");
  if (
    typeof raw !== "string" || new TextEncoder().encode(raw).length > 1048576 ||
    typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)
  ) fail();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== expected) fail();
  const r = proObject(parseNativeJson(raw));
  if (
    r.format !== "jungsi.professional-runtime/v1" || r.status !== "approved" ||
    typeof r.approval_reference_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(r.approval_reference_sha256) || typeof r.expires_at !== "string"
  ) fail();
  const expiresAtUtc = utcInstant(r.expires_at);
  if (expiresAtUtc <= now) fail();
  const metadata = env.get("JUNGSI_PRO_METADATA_KEYRING"),
    cursor = env.get("JUNGSI_DISPLAY_CURSOR_KEY_HEX");
  if (!metadata || metadata.length > 32768) fail();
  const ring = proObject(parseNativeJson(metadata));
  if (!Array.isArray(ring.keys)) fail();
  const metadataRing: ProfessionalMetadataKeyRing = {
    activeKeyId: proId(ring.active_key_id),
    keys: ring.keys.map((value) => {
      const k = proObject(value);
      return { keyId: proId(k.key_id), bytes: hex(k.key_hex, 32) };
    }),
  };
  const policy = new ProfessionalPolicy(r.policy, {
    approvalSha256: r.approval_reference_sha256,
    registrySha256: String(r.registry_sha256),
    selectionSha256: String(r.selection_sha256),
    expiresAtUtc,
  });
  const lease = proObject(r.lease), analysis = proObject(r.analysis_limits);
  return {
    raw: r,
    policy,
    expiresAtUtc,
    metadataRing,
    cursor: hex(cursor, 32),
    metadataBytes: proInteger(r.metadata_max_bytes, 64),
    lease: {
      leaseSeconds: BigInt(proInteger(lease.lease_seconds, 1)),
      runtimeHardLimitSeconds: BigInt(proInteger(lease.runtime_hard_limit_seconds, 1)),
      clockMarginSeconds: BigInt(proInteger(lease.clock_margin_seconds)),
    },
    analysis: {
      maximumOfferings: proInteger(analysis.maximum_offerings, 1),
      unitsPerOffering: BigInt(proInteger(analysis.units_per_offering, 1)),
    },
  };
}
/** These names select approved data-release decoders only; they never dispatch personal business or budget actions. */
function dataConsumer(operation: string): ApiOperationId {
  const names: Record<string, ApiOperationId> = {
    "pro.score.create": "score-profile.create",
    "pro.overall.analyze": "overall.analyze",
    "pro.university.analyze": "university.analyze",
    "pro.candidates": "candidates.build",
    "pro.bookmark.add": "offering.read",
  };
  return names[operation] ?? "session.read";
}
export class NativeProfessionalRuntime {
  private readonly pools = new Map<string, SupabaseSqlTransport>();
  private readonly clock: RequestClockPort;
  private readonly projection: ProfessionalProjection;
  constructor(
    private readonly config: {
      readonly environment: RuntimeEnvironment;
      readonly responseSchemas: unknown;
      readonly createPool: (settings: BasicRuntimeSettings["database"]) => NativeSqlPool;
      readonly clock?: RequestClockPort;
      readonly fetcher?: typeof fetch;
    },
  ) {
    this.clock = config.clock ?? { nowUtc: () => BigInt(Date.now()) * 1000n };
    this.projection = new ProfessionalProjection(PROFESSIONAL_CONTRACT, config.responseSchemas);
  }
  readonly fetch = async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID().replaceAll("-", "");
    try {
      const ingressStartedAtUtc = this.clock.nowUtc();
      // Reject unauthenticated traffic before decoding private policy or creating a database pool.
      const env = resolveRuntimeEnvironment(this.config.environment),
        relay = new RelayBoundary(env.get("JUNGSI_RELAY_TOKEN") ?? null);
      await relay.verify(request.headers);
      assertAdmissionMicros(this.clock.nowUtc());
      const approved = await settings(env, this.clock.nowUtc()),
        basic = readBasicRuntimeSettings(env),
        key = JSON.stringify(basic.database);
      let base = this.pools.get(key);
      if (!base) {
        if (this.pools.size >= 4) fail();
        base = new SupabaseSqlTransport(this.config.createPool(basic.database));
        this.pools.set(key, base);
      }
      const sql = base.fork(),
        auth = new SupabaseNativeAuth(basic.auth, this.config.fetcher),
        sessions = new BoundVerifiedSessionProvider(auth, auth);
      let serviceValue: Promise<ProfessionalService> | undefined;
      const service = (operation: string, user: VerifiedUser) =>
        serviceValue ??= (async () => {
          const context = new NativeRuntimeRequest(
            env,
            () => basic,
            () => sql,
            this.clock,
            dataConsumer(operation),
            this.config.fetcher,
          );
          const binding = await context.binding(), controls = await context.controls();
          await controls.current();
          if (
            binding.references.registry.sha256 !== approved.policy.registrySha256 ||
            binding.references.selection.sha256 !== approved.policy.selectionSha256 ||
            approved.expiresAtUtc > binding.expiresAtUtc ||
            approved.lease.leaseSeconds !== binding.usageStoreLimits.leaseSeconds ||
            approved.lease.runtimeHardLimitSeconds !==
              binding.usageStoreLimits.runtimeHardLimitSeconds ||
            approved.lease.clockMarginSeconds !== binding.usageStoreLimits.clockMarginSeconds ||
            approved.policy.operating.maxRequestRuntimeMilliseconds >
              binding.usageStoreLimits.runtimeHardLimitSeconds * 1000n
          ) fail();
          const shared = proObject(
            parseNativeJson(
              new TextDecoder("utf-8", { fatal: true }).decode(await controls.read("usage_policy")),
            ),
          );
          const retention = (
            a: Parameters<
              NonNullable<ConstructorParameters<typeof SupabaseProfessionalStore>[4]>
            >[0],
          ): Promise<ProfessionalRetentionAuthority> => {
            const records = approved.raw.retention_records;
            if (!Array.isArray(records)) fail();
            const matches = records.map(proObject).filter((r) =>
              r.org_id === a.contract.orgId && r.contract_id === a.contract.contractId &&
              r.academic_year === a.contract.academicYear
            );
            if (matches.length !== 1) {
              throw new AccessError("professional_retention_unavailable", 503);
            }
            const r = matches[0];
            if (
              typeof r.official_deadline_reference !== "string" ||
              typeof r.purge_at_utc !== "string" || !Array.isArray(r.authorized_member_ids)
            ) {
              fail();
            }
            return Promise.resolve({
              maximumRows: proInteger(r.maximum_rows, 1),
              officialDeadlineReference: r.official_deadline_reference,
              purgeAtUtc: utcInstant(r.purge_at_utc),
              noticeDaysBefore: proInteger(r.notice_days_before, 1) as 14 | 3,
              authorizedMemberIds: r.authorized_member_ids.map(proId),
            });
          };
          const store = new SupabaseProfessionalStore(
            sql,
            new ProfessionalStudentMetadataCipher(approved.metadataRing, approved.metadataBytes),
            this.clock,
            approved.policy.maxResultBytes,
            retention,
            new ProfessionalOperationCipher(
              approved.metadataRing,
              approved.policy.maxResultBytes,
            ),
          );
          const authority = new SupabaseProfessionalAuthority(
            proObject(
              approved.raw.authority_function,
            ) as unknown as ProfessionalAuthorityFunctionBinding,
            (statement, parameters) => store.authorityQuery(user.subjectId, statement, parameters),
          );
          const usageRaw = proObject(approved.raw.usage), costs = usageRaw.operations;
          if (!Array.isArray(costs)) fail();
          const candidate = costs.map(proObject).find((c) => c.operation === "pro.candidates"),
            university = costs.map(proObject).find((c) => c.operation === "pro.university.analyze");
          if (
            !candidate || !university ||
            BigInt(proInteger(university.calculation_units, 1)) < approved.analysis.unitsPerOffering
          ) fail();
          const analysis = new ProfessionalApprovedAnalysis(
            () => context.data(),
            store,
            approved.policy,
            this.clock,
            {
              ...approved.analysis,
              reservedCandidateUnits: BigInt(proInteger(candidate.calculation_units, 1)),
            },
          );
          const usage = new ProfessionalSharedUsage(
            usageRaw,
            shared,
            new SupabaseProfessionalUsageAdmission(
              sql,
              new SupabaseProfessionalUsageBudgetStore(sql, approved.lease),
              () => store.isTransactionActive(),
            ),
            this.clock,
            approved.policy.approvalSha256,
            () => context.assertCurrent(),
          );
          return new ProfessionalService(
            {
              authority,
              students: store,
              scores: store,
              reports: store,
              audit: store,
              retention: store,
              analysis,
              usage,
              cursor: new ProfessionalCursor(approved.cursor),
              clock: this.clock,
            },
            approved.policy,
            PROFESSIONAL_CONTRACT,
          );
        })();
      return await createProfessionalHandler({
        contract: PROFESSIONAL_CONTRACT,
        relay,
        sessions,
        clock: this.clock,
        projection: this.projection,
        service,
        mutationGuard: professionalMutationGuard(String(approved.raw.approved_bff_origin)),
        maximumRequestMilliseconds: Number(approved.policy.operating.maxRequestRuntimeMilliseconds),
        ingressStartedAtUtc,
      })(request);
    } catch (error) {
      return safeFailure(error, requestId);
    }
  };
}
