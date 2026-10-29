/** One request owns one binding, read budget, current-head reader and native provider graph. */
import { AccessError } from "../application/access.ts";
import type { ApiOperationId } from "../application/api_dispatch.ts";
import { CATALOG_OPERATIONS, CatalogService } from "../application/catalog.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { RepositoryUsageReplays } from "../application/usage_service.ts";
import { NativeDataProvider } from "./native_data_provider.ts";
import { NativeSourceSelection } from "./native_source_selection.ts";
import { SupabaseArtifactClient, type VerifiedArtifactCache } from "./supabase_artifacts.ts";
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
import { NativeExamPack } from "../domain/exam_pack.ts";
import type { NativeObject } from "../domain/json_value.ts";
import { nativeJsonText } from "../domain/json_value.ts";
import type { BudgetRequest } from "../application/request_budget.ts";
import type { ApiExecution } from "../application/api_dispatch.ts";
import { HistorySnapshotService } from "../application/history_snapshot.ts";
import { OwnReportListService } from "../application/own_report_list.ts";
import { publicJsonText } from "../application/public_response.ts";
import {
  HistorySnapshotSource,
  snapshotBytesSha256,
  SupabaseSnapshotHead,
} from "./history_snapshot_source.ts";
import { SupabaseOwnReportList } from "./own_report_list_postgres.ts";
import { OwnReportCursor } from "./own_report_cursor.ts";
import { MemberShortlistService } from "../application/member_shortlist.ts";
import { MemberJsonResults } from "../application/member_json_results.ts";
import { MemberJsonStorage } from "./member_json_storage.ts";
import {
  SupabaseMemberShortlist,
  SupabaseMemberShortlistLegacy,
} from "./member_shortlist_postgres.ts";
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
  private snapshotValue?: Promise<HistorySnapshotSource>;
  private snapshotOwner?: string;
  constructor(
    private readonly env: RuntimeEnvironment,
    private readonly basic: () => BasicRuntimeSettings,
    private readonly sql: () => SupabaseSqlTransport,
    private readonly clock: RequestClockPort,
    private readonly operation: ApiOperationId | "health.ready" | null,
    private readonly fetcher: typeof fetch = fetch,
    private readonly artifactCache?: VerifiedArtifactCache,
    private readonly ifNoneMatch: string | null = null,
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
        serializeMemberShortlist: binding.memberJson !== undefined,
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
        (request, result) => this.measureResult(request, result),
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
  async assertReadViewScope(): Promise<void> {
    const binding = await this.binding();
    if (!binding.readViews) throw new AccessError("operation_scope_not_approved", 503);
  }
  async assertMemberShortlistScope(): Promise<void> {
    const b = await this.binding();
    if (!b.memberJson) throw new AccessError("operation_scope_not_approved", 503);
  }
  async memberShortlist(catalog: CatalogService): Promise<MemberShortlistService> {
    await this.assertMemberShortlistScope();
    const [b, controls] = await Promise.all([this.binding(), this.controls()]), m = b.memberJson!;
    const storage = new MemberJsonStorage({
      projectUrl: b.projectUrl,
      bucket: b.storage.bucket,
      prefix: m.prefix,
      secretKey: b.storage.secretKey,
      maxBytes: m.maxObjectBytes,
      maxItems: m.maxItems,
      timeoutMs: b.storage.limits.requestTimeoutMs,
    }, controls.fetcher);
    const legacy = new SupabaseMemberShortlistLegacy(
      this.sql(),
      b.repositoryLimits.maxRecordBytes,
      m.maxItems,
    );
    const approvedYears = new Set(
      [...(await this.budget()).policy.exams.values()].map((e) => e.academicYear),
    );
    return new MemberShortlistService(
      new SupabaseMemberShortlist(this.sql(), storage, legacy, b.storage.limits.maxMetadataBytes),
      legacy,
      { lookup: (owner, year, ids) => catalog.selectedOfferings(owner, year, ids) },
      new MemberJsonResults(legacy, m.maxItems),
      this.clock,
      m.maxItems,
      approvedYears,
      () => this.assertCurrent(),
    );
  }
  private snapshot(owner: string): Promise<HistorySnapshotSource> {
    if (this.snapshotOwner !== undefined && this.snapshotOwner !== owner) fail();
    this.snapshotOwner = owner;
    this.snapshotValue ??= (async () => {
      const [binding, controls, budget] = await Promise.all([
        this.binding(),
        this.controls(),
        this.budget(),
      ]);
      if (!binding.readViews) fail();
      return new HistorySnapshotSource(
        new SupabaseSnapshotHead(this.sql(), owner),
        binding.readViews.snapshot,
        { projectUrl: binding.projectUrl, ...binding.storage },
        this.clock,
        {
          maxReadBytes: binding.readLimits.maxBytes,
          maxResultBytes: budget.policy.responseLimit("history.snapshot.read"),
          runtimeMilliseconds: Number(binding.usageStoreLimits.runtimeHardLimitSeconds * 1000n),
        },
        controls.fetcher,
      );
    })();
    return this.snapshotValue;
  }
  async readView(request: ApiExecution): Promise<unknown> {
    await this.assertReadViewScope();
    const binding = await this.binding();
    if (request.operation === "report.list-own") {
      const hex = this.env.get("JUNGSI_DISPLAY_CURSOR_KEY_HEX");
      if (typeof hex !== "string" || !/^[a-f0-9]{64}$/i.test(hex) || !binding.readViews) fail();
      const remaining = binding.expiresAtUtc - this.clock.nowUtc(),
        configured = binding.readViews.cursorLifetimeMicroseconds;
      if (remaining < 1n) fail();
      return await new OwnReportListService(
        new SupabaseOwnReportList(
          this.sql(),
          (await this.budget()).policy.operating ?? null,
          this.clock,
        ),
        new OwnReportCursor(
          Uint8Array.from(hex.match(/../g)!, (x) => parseInt(x, 16)),
          binding.readViews.maxCursorCharacters,
        ),
        this.clock,
        configured < remaining ? configured : remaining,
      ).execute(request.session, request.query);
    }
    const source = await this.snapshot(request.session.user.subjectId),
      service = new HistorySnapshotService(
        source,
        this.clock,
        binding.readViews!.snapshot.scopeSha256,
      );
    if (request.operation === "history.snapshot.head") {
      return await service.head(request.session, request.query);
    }
    if (request.operation === "history.snapshot.read") {
      return await service.read(request.session, request.params.snapshot_id, request.query);
    }
    fail();
  }
  private conditional(etag: string): boolean {
    return this.ifNoneMatch === etag || this.ifNoneMatch === "*";
  }
  async encodeReadView(
    request: Pick<BudgetRequest, "operation" | "session">,
    result: unknown,
  ): Promise<
    {
      body: Uint8Array<ArrayBuffer> | null;
      status: 200 | 304;
      etag: string;
      gzip: boolean;
      snapshotId?: string;
      publicationSha256?: string;
    } | null
  > {
    if (request.operation === "history.snapshot.read") {
      const wire = await (await this.snapshot(request.session.user.subjectId)).representation(
          result,
        ),
        cached = this.conditional(wire.etag);
      return {
        body: cached ? null : wire.bytes,
        status: cached ? 304 : 200,
        etag: wire.etag,
        gzip: true,
        snapshotId: wire.snapshotId,
        publicationSha256: wire.publicationSha256,
      };
    }
    if (request.operation === "history.snapshot.head") {
      const bytes = new TextEncoder().encode(publicJsonText(result)),
        etag = '"' + await snapshotBytesSha256(bytes) + '"',
        cached = this.conditional(etag);
      return { body: cached ? null : bytes, status: cached ? 304 : 200, etag, gzip: false };
    }
    return null;
  }
  private async measureResult(request: BudgetRequest, result: unknown): Promise<bigint> {
    const wire = await this.encodeReadView(request, result);
    return wire
      ? BigInt(wire.body?.length ?? 0)
      : BigInt(new TextEncoder().encode(nativeJsonText(result)).length);
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
      const catalogOnly = CATALOG_OPERATIONS.some((id) => id === this.operation);
      const universityOnly = ["university.analyze", "candidates.build"].some((id) =>
        id === this.operation
      );
      const snapshot = await NativeSourceSelection.prepare(
        new SupabaseArtifactClient(
          { projectUrl: binding.projectUrl, ...binding.storage },
          controls.fetcher,
          this.artifactCache
            ? {
              cache: this.artifactCache,
              onReuse: (bytes) => controls.reuseArtifact(bytes),
            }
            : undefined,
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
        catalogOnly
          ? "catalog_only"
          : universityOnly
          ? "university_only"
          : this.operation === "overall.analyze" || this.operation === "score-profile.create"
          ? "overall_only"
          : "all",
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
        if (catalogOnly) {
          const reference = snapshot.reference("exam_pack", exam.examId);
          if (
            !reference || reference.version !== exam.packVersion ||
            Object.hasOwn(reference, "academic_year") &&
              reference.academic_year !== exam.academicYear
          ) fail();
          continue;
        }
        if (universityOnly) {
          // Revalidate the same immutable body already decoded under preflight fresh heads.
          const raw = snapshot.load("exam_pack", exam.examId);
          const pack = raw ? new NativeExamPack(raw.payload) : null;
          if (
            !pack || pack.packVersion !== exam.packVersion ||
            pack.academicYear !== exam.academicYear
          ) fail();
          if (this.operation === "candidates.build") {
            const catalog = snapshot.load("catalog", "service")?.payload;
            if (
              !catalog || !Array.isArray(catalog.offerings) ||
              BigInt(
                  catalog.offerings.filter((row) =>
                    row !== null && typeof row === "object" && !Array.isArray(row) &&
                    !(row instanceof JsonFloat) && row.practical_required === false &&
                    row.academic_year === exam.academicYear
                  ).length,
                ) !== exam.eligibleOfferingCount
            ) fail();
          }
          continue;
        }
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
    if (this.snapshotValue) {
      const source = await this.snapshotValue;
      await source.assertCurrent(await source.current());
    }
  }
}
