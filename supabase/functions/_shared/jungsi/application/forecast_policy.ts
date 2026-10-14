/** Forecast drafts, replacement adjustments, validation, independent approval and publication. */
import { AccessError } from "./access.ts";
import type { ApiBusinessPort, ApiExecution } from "./api_dispatch.ts";
import { evaluateForecastRelease } from "./forecast_assessment.ts";
import {
  forecastDigest,
  forecastNumber,
  forecastObject,
  forecastPolicyDecimal,
  forecastRequire,
  forecastTruthy,
  generateForecast,
  validateForecastPolicyResult,
  validateForecastRanges,
  validateForecastResult,
} from "./forecast_calculation.ts";
import {
  forecastDraftDto,
  pendingPublicForecast,
  publicForecastContext,
  publishedForecastDto,
} from "./forecast_dto.ts";
import type {
  ForecastInputPort,
  ForecastRepositoryPort,
  ForecastTransactionPort,
} from "./forecast_ports.ts";
import {
  authorizeManagement,
  MANAGEMENT_OPERATIONS,
  type ManagementDecision,
  type ManagementOperation,
  requireManagementUniversity,
} from "./management_access.ts";
import type { ManagementResourcePort, RequestClockPort } from "./ports.ts";
import type { StoredProfile } from "./platform_repository.ts";
import { sessionDto, type SessionSnapshot } from "./session_service.ts";
import type { ScoringResult } from "./university_scoring.ts";
import type { PercentileResult } from "./university_percentile.ts";
import type { PublishedForecastPort } from "./university_analysis.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../domain/json_value.ts";
import { type NativeJson } from "../domain/native_json.ts";
import { pythonTrim, unicodeCompare } from "../domain/text.ts";
import { utcText } from "../domain/time.ts";
export const FORECAST_OPERATIONS = [...MANAGEMENT_OPERATIONS, "forecast.published.read"] as const;
function id(v: unknown): string {
  forecastRequire(
    typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v),
    "invalid_identifier",
  );
  return v;
}
function rev(v: unknown): number {
  forecastRequire(typeof v === "number" && Number.isSafeInteger(v) && v > 0, "invalid_revision");
  return v;
}
function shape(
  v: unknown,
  required: readonly string[] = [],
  optional: readonly string[] = [],
): NativeObject {
  const r = forecastObject(v, "invalid_request");
  forecastRequire(
    required.every((k) => Object.hasOwn(r, k)) &&
      Object.keys(r).every((k) => [...required, ...optional].includes(k)),
    "invalid_request",
  );
  return r;
}
function equal(a: unknown, b: unknown): boolean {
  return nativeJsonText(a, true) === nativeJsonText(b, true);
}
function objectArray(v: unknown): NativeObject[] {
  forecastRequire(Array.isArray(v), "forecast_release_invalid", 503);
  return v.map((x) => forecastObject(x, "forecast_release_invalid", 503));
}
async function receiptValid(
  value: NativeObject,
  key: "receipt_hash" | "approval_hash",
): Promise<boolean> {
  const remainder = Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
  return typeof value[key] === "string" && value[key] === await forecastDigest(remainder);
}
export class ForecastPolicyService implements ApiBusinessPort, PublishedForecastPort {
  constructor(
    private readonly repository: ForecastRepositoryPort,
    private readonly inputs: ForecastInputPort,
    private readonly resources: ManagementResourcePort,
    private readonly clock: RequestClockPort,
    private readonly uuid: () => string = () => crypto.randomUUID().replaceAll("-", ""),
  ) {}
  private fresh(s: SessionSnapshot): bigint {
    forecastRequire(
      s?.user && typeof s.user.subjectId === "string" && s.user.subjectId.trim() &&
        typeof s.user.expiresAtUtc === "bigint" && typeof s.evaluatedAtUtc === "bigint",
      "authentication_required",
      401,
    );
    const now = this.clock.nowUtc();
    sessionDto(s, now);
    return now;
  }
  private newId(prefix: string): string {
    const value = this.uuid();
    forecastRequire(/^[a-f0-9]{32}$/.test(value), "forecast_release_invalid", 503);
    return prefix + value;
  }
  private async authorize(
    session: SessionSnapshot,
    operation: ManagementOperation,
    params: Readonly<Record<string, string>>,
    port: ForecastRepositoryPort | ForecastTransactionPort,
  ): Promise<ManagementDecision> {
    const decision = await authorizeManagement(session.user, port, this.fresh(session), operation);
    if (params.draft_id) {
      const did = id(params.draft_id),
        scope = "transact" in port
          ? await port.draftScope(session.user.subjectId, did)
          : await port.draftScope(did);
      forecastRequire(scope !== null && scope.draftId === did, "forecast_not_found", 404);
      requireManagementUniversity(decision, scope.universityId);
    }
    if (operation === "forecast.create") {
      const oid = id(params.offering_id),
        scope = await this.resources.readScope("offering", oid, session.user.subjectId);
      forecastRequire(
        scope !== null && scope.kind === "offering" && scope.id === oid,
        "forecast_not_found",
        404,
      );
      requireManagementUniversity(decision, scope.universityId);
    }
    return decision;
  }
  async execute(request: ApiExecution): Promise<NativeObject> {
    const { operation: op, session, params, query, body } = request;
    forecastRequire(
      FORECAST_OPERATIONS.includes(op as typeof FORECAST_OPERATIONS[number]),
      "route_not_found",
      404,
    );
    this.fresh(session);
    if (op === "forecast.published.read") {
      forecastRequire(session.tier === "paid", "paid_required", 403);
      shape(body);
      shape(query);
      const oid = id(params.offering_id),
        release = await this.validatedRelease(oid, session.user.subjectId);
      this.fresh(session);
      if (!release) return pendingPublicForecast(oid, "forecast_release_missing");
      try {
        publicForecastContext(release.context);
      } catch (e) {
        if (e instanceof AccessError) return pendingPublicForecast(oid, e.code);
        throw e;
      }
      return publishedForecastDto(release);
    }
    const management = op as ManagementOperation,
      decision = await this.authorize(session, management, params, this.repository);
    if (op === "forecast.capabilities") {
      shape(body);
      shape(query);
      this.fresh(session);
      return {
        format: "jungsi.forecast-capabilities/v1",
        capabilities: [...decision.capabilities],
        university_ids: [...decision.universityIds],
      };
    }
    if (op === "forecast.list") {
      shape(body);
      shape(query, [], ["university_id"]);
      const rows = await this.repository.list(
        session.user.subjectId,
        decision,
        query.university_id || null,
      );
      this.fresh(session);
      return { format: "jungsi.forecast-list/v1", items: rows.map(forecastDraftDto) };
    }
    if (op === "forecast.read") {
      shape(body);
      shape(query);
      const r = await this.repository.get(session.user.subjectId, id(params.draft_id), decision);
      forecastRequire(r !== null, "forecast_not_found", 404);
      this.fresh(session);
      return forecastDraftDto(r);
    }
    // Query checks precede every transaction/replay, following current user authority.
    shape(query);
    const key = id(request.requestKey), requestHash = await nativeJsonSha256({ body, params });
    const result = await this.repository.transact(
      session.user.subjectId,
      management,
      key,
      requestHash,
      this.fresh(session),
      (store) => this.authorize(session, management, params, store),
      (store, current) => this.mutate(store, management, session, current, body, params),
    );
    this.fresh(session);
    return result;
  }
  private async mutate(
    store: ForecastTransactionPort,
    operation: ManagementOperation,
    session: SessionSnapshot,
    decision: ManagementDecision,
    bodyRaw: unknown,
    params: Readonly<Record<string, string>>,
  ): Promise<NativeObject> {
    const actor = session.user.subjectId, now = utcText(this.fresh(session));
    let record: NativeObject, expected: number | null = null;
    if (operation === "forecast.create") {
      const body = shape(bodyRaw, ["input_id", "input_version", "policy_id", "policy_version"]),
        oid = id(params.offering_id),
        inputs = await this.inputs.inputs(oid, id(body.input_id), id(body.input_version)),
        policy = await this.inputs.policy(id(body.policy_id), id(body.policy_version));
      forecastRequire(
        inputs.version === body.input_version && policy.version === body.policy_version,
        "forecast_base_version_conflict",
        409,
      );
      const result = generateForecast(inputs, policy), context = forecastObject(result.context);
      forecastRequire(context.offering_id === oid, "forecast_offering_mismatch");
      forecastRequire(
        context.input_version === body.input_version &&
          context.policy_version === body.policy_version &&
          equal(context, await this.inputs.currentContext(oid)),
        "forecast_base_version_conflict",
        409,
      );
      requireManagementUniversity(decision, context.university_id as string);
      record = {
        draft_id: this.newId("forecast-"),
        revision: 1,
        status: "draft",
        context,
        input_id: body.input_id,
        policy_id: body.policy_id,
        input_version: inputs.version,
        input_hash: await forecastDigest(inputs),
        policy_version: policy.version,
        policy_hash: await forecastDigest(policy),
        base_result: cloneNativeJson(result),
        base_result_hash: await forecastDigest(result),
        result,
        contributors: [actor],
        adjustments: [],
        validation: null,
        approval: null,
        created_at: now,
        updated_at: now,
        created_by: actor,
        events: [{ action: "create", actor, at: now }],
      };
    } else {
      const stored = await store.get(id(params.draft_id), decision);
      forecastRequire(stored !== null, "forecast_not_found", 404);
      record = cloneNativeJson(stored);
      requireManagementUniversity(decision, forecastObject(record.context).university_id as string);
      expected = rev(record.revision);
      const optional: Partial<Record<ManagementOperation, readonly string[]>> = {
        "forecast.adjust": ["target", "replacement", "reason", "evidence_refs"],
        "forecast.validate": [],
        "forecast.approve": ["validation_receipt_hash", "reason"],
        "forecast.publish": ["approval_receipt_hash"],
      };
      const body = shape(
        bodyRaw,
        ["expected_revision", "base_result_hash", "policy_version"],
        optional[operation] ?? [],
      );
      forecastRequire(expected === rev(body.expected_revision), "revision_conflict", 409);
      forecastRequire(
        body.base_result_hash === record.base_result_hash &&
          await forecastDigest(record.base_result) === record.base_result_hash,
        "forecast_base_version_conflict",
        409,
      );
      forecastRequire(record.status !== "published", "forecast_already_published", 409);
      forecastRequire(
        body.policy_version === record.policy_version,
        "forecast_base_version_conflict",
        409,
      );
      const context = forecastObject(record.context),
        policy = await this.inputs.policy(id(record.policy_id), id(record.policy_version)),
        inputs = await this.inputs.inputs(
          id(context.offering_id),
          id(record.input_id),
          id(record.input_version),
        );
      forecastRequire(
        await forecastDigest(policy) === record.policy_hash &&
          await forecastDigest(inputs) === record.input_hash &&
          equal(await this.inputs.currentContext(id(context.offering_id)), context),
        "forecast_base_version_conflict",
        409,
      );
      if (operation === "forecast.adjust") {
        const target = body.target, allowed = policy.adjustable_targets;
        forecastRequire(
          Array.isArray(allowed) && allowed.includes(target),
          "forecast_adjustment_forbidden",
        );
        forecastRequire(
          typeof body.reason === "string" && pythonTrim(body.reason) !== "" &&
            Array.isArray(body.evidence_refs) && body.evidence_refs.length > 0,
          "forecast_adjustment_evidence_missing",
        );
        const refs = inputs.approved_evidence_refs ?? [];
        forecastRequire(
          Array.isArray(refs) && body.evidence_refs.every((r) => refs.includes(r)),
          "forecast_adjustment_evidence_unapproved",
        );
        const replacement = cloneNativeJson(
            forecastObject(body.replacement, "forecast_adjustment_invalid"),
          ),
          result = forecastObject(record.result),
          precise = forecastObject(result.exact_values);
        if (target === "category_ranges") {
          shape(replacement, ["ranges"]);
          validateForecastRanges(replacement.ranges);
          for (const r of objectArray(replacement.ranges)) shape(r, ["category", "lower", "upper"]);
          precise.category_ranges = cloneNativeJson(replacement.ranges);
          const spec = forecastObject(policy.acceptance_range);
          result.category_ranges = objectArray(replacement.ranges).map((r) => ({
            category: r.category,
            lower: forecastPolicyDecimal(forecastNumber(r.lower), spec),
            upper: forecastPolicyDecimal(forecastNumber(r.upper), spec),
          }));
        } else {
          forecastRequire(
            target === "forecast_70" || target === "acceptance_range",
            "forecast_adjustment_invalid",
          );
          shape(
            replacement,
            target === "forecast_70" ? ["value", "unit"] : ["lower", "upper", "unit"],
          );
          forecastRequire(replacement.unit === context.unit, "forecast_adjustment_unit_mismatch");
          const fields = target === "forecast_70" ? ["value"] : ["lower", "upper"];
          for (const f of fields) forecastNumber(replacement[f]);
          const value = forecastObject(result[target]);
          forecastRequire(value.status === "ready", "forecast_adjustment_base_pending", 409);
          precise[target] = target === "forecast_70"
            ? forecastNumber(replacement.value).toString()
            : Object.fromEntries(fields.map((f) => [f, forecastNumber(replacement[f]).toString()]));
          const spec = forecastObject(policy[target]);
          for (const f of fields) {
            value[f] = forecastPolicyDecimal(forecastNumber(replacement[f]), spec);
          }
        }
        await validateForecastResult(result);
        const contributors = record.contributors;
        forecastRequire(
          Array.isArray(contributors) && contributors.every((x) => typeof x === "string"),
          "forecast_release_invalid",
          503,
        );
        record.contributors = [...new Set([...contributors, actor])].sort((a, b) =>
          unicodeCompare(a as string, b as string)
        );
        const adjustments = record.adjustments;
        forecastRequire(Array.isArray(adjustments), "forecast_release_invalid", 503);
        adjustments.push({
          target,
          replacement,
          reason: body.reason,
          evidence_refs: cloneNativeJson(body.evidence_refs),
          actor,
          at: now,
          base_result_hash: record.base_result_hash,
        });
        Object.assign(record, { status: "draft", validation: null, approval: null });
      } else if (operation === "forecast.validate") {
        let receipt: NativeObject;
        try {
          receipt = await validateForecastPolicyResult(record.result, policy);
        } catch (e) {
          if (!(e instanceof AccessError)) throw e;
          receipt = {
            status: "failed",
            reason_code: e.code,
            result_hash: await forecastDigest(record.result),
          };
        }
        Object.assign(receipt, {
          validated_revision: expected + 1,
          input_hash: record.input_hash,
          policy_hash: record.policy_hash,
          at: now,
          actor,
        });
        receipt.receipt_hash = await forecastDigest(receipt);
        Object.assign(record, {
          validation: receipt,
          approval: null,
          status: receipt.status === "passed" ? "validated" : "draft",
        });
      } else if (operation === "forecast.approve") {
        const receipt = record.validation;
        forecastRequire(
          record.status === "validated" && receipt !== null &&
            forecastObject(receipt).status === "passed",
          "forecast_validation_required",
          409,
        );
        const v = forecastObject(receipt);
        forecastRequire(
          body.validation_receipt_hash === v.receipt_hash && v.validated_revision === expected &&
            v.result_hash === await forecastDigest(record.result) &&
            await receiptValid(v, "receipt_hash"),
          "forecast_validation_stale",
          409,
        );
        forecastRequire(
          typeof policy.require_independent_approver === "boolean",
          "forecast_approval_policy_missing",
        );
        const contributors = record.contributors;
        forecastRequire(Array.isArray(contributors), "forecast_release_invalid", 503);
        forecastRequire(
          !policy.require_independent_approver || !contributors.includes(actor),
          "forecast_independent_approver_required",
          403,
        );
        const selfContributor = contributors.includes(actor);
        if (selfContributor) {
          const editDecision = await authorizeManagement(
            session.user,
            store,
            this.fresh(session),
            "forecast.adjust",
          );
          requireManagementUniversity(editDecision, context.university_id as string);
        }
        forecastRequire(
          typeof body.reason === "string" && pythonTrim(body.reason) !== "",
          "forecast_approval_reason_missing",
        );
        const approval: NativeObject = {
          approved_revision: expected + 1,
          result_hash: await forecastDigest(record.result),
          validation_hash: v.receipt_hash,
          policy_hash: record.policy_hash,
          require_independent_approver: policy.require_independent_approver,
          authority_verification: {
            university_id: context.university_id,
            checked_capabilities: selfContributor ? ["editor", "approver"] : ["approver"],
            at: now,
          },
          actor,
          at: now,
          reason: body.reason,
        };
        approval.approval_hash = await forecastDigest(approval);
        Object.assign(record, { status: "approved", approval });
      } else if (operation === "forecast.publish") {
        const raw = record.approval;
        forecastRequire(
          record.status === "approved" && raw !== null,
          "forecast_approval_required",
          409,
        );
        const approval = forecastObject(raw);
        forecastRequire(
          typeof policy.require_independent_approver === "boolean" &&
            approval.require_independent_approver === policy.require_independent_approver,
          "forecast_approval_stale",
          409,
        );
        forecastRequire(
          body.approval_receipt_hash === approval.approval_hash &&
            approval.approved_revision === expected &&
            approval.result_hash === await forecastDigest(record.result) &&
            await receiptValid(approval, "approval_hash"),
          "forecast_approval_stale",
          409,
        );
        const validation = forecastObject(record.validation);
        forecastRequire(
          await receiptValid(validation, "receipt_hash") &&
            approval.validation_hash === validation.receipt_hash,
          "forecast_validation_stale",
          409,
        );
        const release: NativeObject = {
          release_id: this.newId("release-"),
          context: cloneNativeJson(context),
          result: cloneNativeJson(record.result),
          draft_id: record.draft_id,
          draft_revision: expected,
          base_result: cloneNativeJson(record.base_result),
          eligibility_policy: cloneNativeJson(policy.eligibility_policy ?? null),
          policy_id: record.policy_id,
          policy_version: record.policy_version,
          policy_hash: record.policy_hash,
          input_id: record.input_id,
          input_version: record.input_version,
          input_hash: record.input_hash,
          validation_hash: validation.receipt_hash,
          approval_hash: approval.approval_hash,
          require_independent_approver: policy.require_independent_approver,
          adjustments: cloneNativeJson(record.adjustments),
          published_at: now,
          published_by: actor,
        };
        release.release_hash = await forecastDigest(release);
        await store.publish(release, decision);
        Object.assign(record, { status: "published", release_id: release.release_id });
      } else throw new AccessError("route_not_found", 404);
      record.revision = expected + 1;
      record.updated_at = now;
      const events = record.events;
      forecastRequire(Array.isArray(events), "forecast_release_invalid", 503);
      events.push({ action: operation, actor, at: now });
    }
    await store.put(record, expected, decision);
    return forecastDraftDto(record);
  }
  async validatedRelease(offeringId: string, subjectId: string): Promise<NativeObject | null> {
    return await this.validateRelease(
      offeringId,
      await this.repository.published(subjectId, offeringId),
    );
  }
  async validatedReleases(
    offeringIds: readonly string[],
    verifiedSubjectId: string,
  ): Promise<ReadonlyMap<string, NativeObject | AccessError | null>> {
    forecastRequire(
      Array.isArray(offeringIds) &&
        offeringIds.every((x) => typeof x === "string" && pythonTrim(x) !== ""),
      "forecast_release_invalid",
      503,
    );
    const ids = [...new Set(offeringIds)];
    if (!ids.length) return new Map();
    const rows = await this.repository.publishedMany(verifiedSubjectId, ids);
    forecastRequire(
      rows instanceof Map && rows.size === ids.length && ids.every((x) => rows.has(x)),
      "forecast_release_invalid",
      503,
    );
    const result = new Map<string, NativeObject | AccessError | null>();
    for (const oid of ids) {
      const row = rows.get(oid)!;
      if (row instanceof AccessError) {
        result.set(oid, row);
        continue;
      }
      try {
        result.set(oid, await this.validateRelease(oid, row));
      } catch (e) {
        result.set(
          oid,
          e instanceof AccessError ? e : new AccessError("forecast_release_invalid", 503),
        );
      }
    }
    return result;
  }
  private async validateRelease(
    offeringId: string,
    release: NativeObject | null,
  ): Promise<NativeObject | null> {
    if (release === null) return null;
    try {
      const { release_hash: claimed, ...pinned } = cloneNativeJson(
        forecastObject(release, "forecast_release_invalid", 503),
      );
      forecastRequire(
        claimed === await forecastDigest(pinned) && forecastTruthy(release.approval_hash) &&
          forecastTruthy(release.validation_hash),
        "forecast_release_invalid",
        503,
      );
      const context = forecastObject(release.context, "forecast_release_invalid", 503);
      forecastRequire(
        equal(context, await this.inputs.currentContext(offeringId)) &&
          context.input_version === release.input_version &&
          context.policy_version === release.policy_version,
        "forecast_base_version_conflict",
        409,
      );
      const inputs = await this.inputs.inputs(
          offeringId,
          id(release.input_id),
          id(release.input_version),
        ),
        policy = await this.inputs.policy(id(release.policy_id), id(release.policy_version));
      forecastRequire(
        inputs.version === release.input_version && policy.version === release.policy_version &&
          await forecastDigest(inputs) === release.input_hash &&
          await forecastDigest(policy) === release.policy_hash,
        "forecast_base_version_conflict",
        409,
      );
      await validateForecastPolicyResult(release.result, policy);
      forecastRequire(
        typeof policy.require_independent_approver === "boolean" &&
          typeof release.require_independent_approver === "boolean" &&
          release.require_independent_approver === policy.require_independent_approver,
        "forecast_release_invalid",
        503,
      );
    } catch (e) {
      if (e instanceof AccessError) throw e;
      throw new AccessError("forecast_release_invalid", 503);
    }
    return release;
  }
  async evaluateRelease(
    offering: Readonly<NativeObject>,
    profile: StoredProfile,
    conversion: ScoringResult,
    percentile: PercentileResult,
    release: Readonly<NativeObject>,
    historicalMetrics: readonly NativeJson[],
  ): Promise<NativeObject> {
    return await evaluateForecastRelease(
      offering,
      profile,
      conversion,
      percentile,
      release,
      historicalMetrics,
    );
  }
}
