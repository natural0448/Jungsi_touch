/** One request owns one binding, read budget, current-head reader and native provider graph. */
import { AccessError } from "../application/access.ts";
import type { ApiOperationId } from "../application/api_dispatch.ts";
import { CatalogService } from "../application/catalog.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { RepositoryUsageReplays } from "../application/usage_service.ts";
import { NativeDataProvider } from "./native_data_provider.ts";
import { NativeSourceSelection } from "./native_source_selection.ts";
import { SupabaseArtifactClient } from "./supabase_artifacts.ts";
import { SupabaseScoreInputRepository } from "./score_input_postgres.ts";
import { SupabasePlatformRepository } from "./platform_postgres.ts";
import { SupabaseForecastRepository } from "./forecast_postgres.ts";
import { SupabaseUsageBudgetStore } from "./usage_postgres.ts";
import { RuntimeRequestBudget, RuntimeUsagePolicy } from "./runtime_budget.ts";
import { RuntimeReadBudget, SupabaseRuntimeControls } from "./runtime_controls.ts";
import {
  type ApprovedRuntimeBinding,
  type BasicRuntimeSettings,
  readApprovedRuntimeBinding,
  type RuntimeEnvironment,
} from "./runtime_settings.ts";
import { SupabaseSqlTransport } from "./transaction_sql.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import type { NativeObject } from "../domain/json_value.ts";
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
export class NativeRuntimeRequest {
  private bindingValue?: Promise<ApprovedRuntimeBinding>;
  private controlsValue?: Promise<SupabaseRuntimeControls>;
  private platformValue?: Promise<SupabasePlatformRepository>;
  private forecastsValue?: Promise<SupabaseForecastRepository>;
  private budgetValue?: Promise<RuntimeRequestBudget>;
  private dataValue?: Promise<NativeDataProvider>;
  private scoresValue?: Promise<SupabaseScoreInputRepository>;
  constructor(
    private readonly env: RuntimeEnvironment,
    private readonly basic: () => BasicRuntimeSettings,
    private readonly sql: () => SupabaseSqlTransport,
    private readonly clock: RequestClockPort,
    private readonly operation: ApiOperationId | "health.ready" | null,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  binding(): Promise<ApprovedRuntimeBinding> {
    this.bindingValue ??= (async () => {
      const binding = await readApprovedRuntimeBinding(this.env, this.basic(), this.clock.nowUtc());
      if (this.operation === null) fail();
      if (this.operation !== "health.ready" && !binding.operations.includes(this.operation)) {
        throw new AccessError("operation_scope_not_approved", 503);
      }
      return binding;
    })();
    return this.bindingValue;
  }
  controls(): Promise<SupabaseRuntimeControls> {
    this.controlsValue ??= (async () => {
      const binding = await this.binding();
      return new SupabaseRuntimeControls(
        binding,
        this.clock,
        new RuntimeReadBudget(binding.readLimits),
        this.fetcher,
      );
    })();
    return this.controlsValue;
  }
  platform(): Promise<SupabasePlatformRepository> {
    this.platformValue ??= (async () => {
      const binding = await this.binding();
      return new SupabasePlatformRepository(this.sql(), {
        maxRecordBytes: binding.repositoryLimits.maxRecordBytes,
      });
    })();
    return this.platformValue;
  }
  forecasts(): Promise<SupabaseForecastRepository> {
    this.forecastsValue ??= (async () => {
      const binding = await this.binding(), limits = binding.repositoryLimits;
      return new SupabaseForecastRepository(this.sql(), {
        maxRecordBytes: limits.maxRecordBytes,
        maxListRows: limits.maxForecastRows,
        maxBatchIds: limits.maxBatchIds,
      });
    })();
    return this.forecastsValue;
  }
  budget(): Promise<RuntimeRequestBudget> {
    this.budgetValue ??= (async () => {
      const [binding, controls, platform] = await Promise.all([
        this.binding(),
        this.controls(),
        this.platform(),
      ]);
      await controls.current();
      const bytes = await controls.read("usage_policy"),
        replays = new RepositoryUsageReplays(platform);
      const policy = new RuntimeUsagePolicy(bytes, binding, platform, this.clock, replays);
      return new RuntimeRequestBudget(
        policy,
        new SupabaseUsageBudgetStore(this.sql(), binding.usageStoreLimits),
        this.clock,
        replays,
        controls,
      );
    })();
    return this.budgetValue;
  }
  scoreInputs(): Promise<SupabaseScoreInputRepository> {
    this.scoresValue ??= (async () => {
      const [budget, platform] = await Promise.all([this.budget(), this.platform()]);
      const policy = budget.policy.operating;
      if (!policy) throw new AccessError("score_input_policy_unavailable", 503);
      return new SupabaseScoreInputRepository(this.sql(), platform, policy, this.clock);
    })();
    return this.scoresValue;
  }
  private assertArtifactScope(raw: Uint8Array, binding: ApprovedRuntimeBinding): void {
    let selected: NativeObject;
    try {
      const value = parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      if (
        value === null || typeof value !== "object" || Array.isArray(value) ||
        value instanceof JsonFloat
      ) fail();
      selected = value;
    } catch {
      fail();
    }
    if (selected.format !== "jungsi.runtime-selection/v1" || !Array.isArray(selected.required)) {
      fail();
    }
    const expected = new Set(binding.artifacts.map((a) => JSON.stringify([a.kind, a.key])));
    const found = new Set<string>();
    for (const item of selected.required) {
      if (
        item === null || typeof item !== "object" || Array.isArray(item) ||
        item instanceof JsonFloat
      ) fail();
      const identity = JSON.stringify([item.kind, item.key]);
      if (!expected.has(identity) || found.has(identity)) fail();
      found.add(identity);
    }
    if (found.size !== expected.size) fail();
  }
  data(): Promise<NativeDataProvider> {
    this.dataValue ??= (async () => {
      const [binding, controls] = await Promise.all([this.binding(), this.controls()]);
      await controls.current();
      const [registry, selection] = await Promise.all([
        controls.read("registry"),
        controls.read("selection"),
      ]);
      this.assertArtifactScope(selection, binding);
      const snapshot = await NativeSourceSelection.prepare(
        new SupabaseArtifactClient(
          { projectUrl: binding.projectUrl, ...binding.storage },
          controls.fetcher,
        ),
        {
          bytes: registry,
          sha256: binding.references.registry.sha256,
          maxBytes: binding.references.registry.bytes,
        },
        {
          bytes: selection,
          sha256: binding.references.selection.sha256,
          maxBytes: binding.references.selection.bytes,
        },
      );
      const data = new NativeDataProvider(snapshot, {
        heads: controls,
        clock: this.clock,
        approvalReferenceSha256: binding.approvalReferenceSha256,
        expiresAtUtc: binding.expiresAtUtc,
      });
      await data.preflight();
      const policy = (await this.budget()).policy;
      for (const exam of policy.exams.values()) {
        const pack = await data.getExamPack(exam.examId);
        if (
          !pack || pack.packVersion !== exam.packVersion || pack.academicYear !== exam.academicYear
        ) fail();
        if (this.operation === "candidates.build") {
          const catalog = new CatalogService(data, this.clock), release = await catalog.catalog();
          if (
            !release || BigInt(
                catalog.serviceRows(release).filter((o) => o.academic_year === exam.academicYear)
                  .length,
              ) !== exam.eligibleOfferingCount
          ) fail();
        }
      }
      await controls.current();
      policy.assertLive();
      return data;
    })();
    return this.dataValue;
  }
  async assertCurrent(): Promise<void> {
    if (this.bindingValue) {
      const controls = await this.controls();
      await controls.current();
    }
    if (this.budgetValue) (await this.budget()).policy.assertLive();
  }
}
