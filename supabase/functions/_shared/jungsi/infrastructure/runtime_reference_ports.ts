/** Server-only injection point. No issuer, configuration, credential or production grant is supplied. */
import { AccessError } from "../application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type { NativeObject } from "../domain/json_value.ts";
import type {
  ChunkedReferenceTailSelection,
  NativeReferenceTailSelection,
  ReferenceTailPort,
  ReferenceTailSelection,
} from "../application/reference_percentile.ts";
import type { ReferenceCandidateScopePort } from "../application/reference_candidate_scope.ts";
import type { PlatformRepositoryPort } from "../application/platform_repository.ts";
import type { CatalogService } from "../application/catalog.ts";
import type { RequestClockPort } from "../application/ports.ts";
import type { ScoreInputWorkflowPort } from "../application/score_input_ports.ts";
import type { ApiHttpPorts } from "./api_http.ts";
import type { NativeRuntimeRequest } from "./runtime_context.ts";
import type { RuntimeReferenceLease } from "./runtime_reference_lease.ts";
type ReferenceRuntimeRequest =
  & Pick<NativeRuntimeRequest, "binding" | "controls" | "data">
  & Partial<Pick<NativeRuntimeRequest, "referencePercentileDbReader">>;

export interface RuntimeReferencePorts {
  readonly tail: ReferenceTailPort;
  readonly candidateScope: ReferenceCandidateScopePort | null;
  readonly projectionAuthority: NonNullable<ApiHttpPorts["referenceProjectionAuthority"]>;
}
/** Implemented only by a separately approved server-side issuer. It must verify exact published
 * reference selection, source/model/axis compatibility, owning report and permissions, and use
 * controls.fetcher plus the existing bounded private-storage client. It must physically stop and
 * await all I/O on cancellation before scope settlement. Factory presence is not authority. */
export interface RuntimeReferenceFactory {
  create(input: {
    readonly request: ApiExecution;
    readonly boundary: ApiExecutionBoundary;
    readonly runtime: ReferenceRuntimeRequest;
    readonly repository: Pick<
      PlatformRepositoryPort,
      "getReport" | "getReportRevision" | "lookupAccess"
    >;
    readonly catalog: CatalogService;
    readonly clock: RequestClockPort;
    readonly workflow: ScoreInputWorkflowPort;
    /** Share this resolver with every source in the same request; never across requests. */
    readonly scopeSignal: (signal?: AbortSignal) => AbortSignal;
    readonly assertActive: (signal?: AbortSignal) => Promise<void>;
    /** Settled receipt only; must not call a provider or perform I/O. */
    readonly assertReceipt: () => void;
  }): Promise<RuntimeReferencePorts | null>;
}
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
export async function bindRuntimeReferencePorts(
  factory: RuntimeReferenceFactory,
  lease: RuntimeReferenceLease,
  runtime: ReferenceRuntimeRequest,
  services: Pick<
    Parameters<RuntimeReferenceFactory["create"]>[0],
    "repository" | "catalog" | "clock" | "workflow"
  >,
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
): Promise<RuntimeReferencePorts | null> {
  // Keep the actual request signal and admission identity immutable across awaits.
  boundary = Object.freeze({ signal: boundary.signal, admission: boundary.admission });
  const active = (signal?: AbortSignal) => lease.assert(request, boundary, signal);
  await active();
  const ports = await factory.create(
    Object.freeze({
      request,
      boundary,
      runtime,
      ...services,
      scopeSignal: (signal?: AbortSignal) => lease.scopeSignal(request, boundary, signal),
      assertActive: active,
      assertReceipt: () => lease.assertSettled(request, boundary),
    }),
  );
  await active();
  if (ports === null) return null;
  if (
    !ports ||
    (!ports.tail?.getReferenceTail && !ports.tail?.getChunkedReferenceTail &&
      !ports.tail?.getNativeReferenceTail) ||
    typeof ports.projectionAuthority?.resolve !== "function"
  ) unavailable();
  const source = ports.tail.getReferenceTail?.bind(ports.tail);
  const tail: ReferenceTailPort = {
    async getReferenceTail(id, signal) {
      if (!source) return null;
      if (signal?.aborted) unavailable();
      await active(signal);
      const selected = await source(id, signal);
      await active(signal);
      if (signal?.aborted) unavailable();
      if (selected === null) return null;
      if (
        typeof selected.assertCurrent !== "function" ||
        typeof selected.assertCompatible !== "function"
      ) unavailable();
      const wrapped: ReferenceTailSelection = Object.freeze({
        projection: selected.projection,
        binding: selected.binding,
        assertCurrent: async (signal?: AbortSignal) => {
          await active(signal);
          await selected.assertCurrent(signal);
          await active(signal);
        },
        assertCompatible: async (identity: Readonly<NativeObject>, signal?: AbortSignal) => {
          await active(signal);
          await selected.assertCompatible(identity, signal);
          await active(signal);
        },
        ...(selected.verifiedProvenance
          ? {
            verifiedProvenance: async (identity: Readonly<NativeObject>, signal?: AbortSignal) => {
              if (signal?.aborted) unavailable();
              await active(signal);
              const value = await selected.verifiedProvenance!(identity, signal);
              await active(signal);
              if (signal?.aborted) unavailable();
              return value;
            },
          }
          : {}),
      });
      return wrapped;
    },
    ...(ports.tail.getChunkedReferenceTail
      ? {
        async getChunkedReferenceTail(id: string, signal?: AbortSignal) {
          if (signal?.aborted) unavailable();
          await active(signal);
          const selected = await ports.tail.getChunkedReferenceTail!(id, signal);
          await active(signal);
          if (signal?.aborted) unavailable();
          if (selected === null) return null;
          if (
            typeof selected.assertCurrent !== "function" ||
            typeof selected.assertCompatible !== "function"
          ) unavailable();
          const wrapped: ChunkedReferenceTailSelection = Object.freeze({
            projection: selected.projection,
            binding: selected.binding,
            assertCurrent: async (s?: AbortSignal) => {
              await active(s);
              await selected.assertCurrent(s);
              await active(s);
            },
            assertCompatible: async (i: Readonly<NativeObject>, s?: AbortSignal) => {
              await active(s);
              await selected.assertCompatible(i, s);
              await active(s);
            },
            ...(selected.verifiedProvenance
              ? {
                verifiedProvenance: async (i: Readonly<NativeObject>, s?: AbortSignal) => {
                  if (s?.aborted) unavailable();
                  await active(s);
                  const value = await selected.verifiedProvenance!(i, s);
                  await active(s);
                  if (s?.aborted) unavailable();
                  return value;
                },
              }
              : {}),
          });
          return wrapped;
        },
      }
      : {}),
    ...(ports.tail.getNativeReferenceTail
      ? {
        async getNativeReferenceTail(id: string, signal?: AbortSignal) {
          if (signal?.aborted) unavailable();
          await active(signal);
          const selected = await ports.tail.getNativeReferenceTail!(id, signal);
          await active(signal);
          if (signal?.aborted) unavailable();
          if (selected === null) return null;
          if (
            typeof selected.assertCurrent !== "function" ||
            typeof selected.assertCompatible !== "function"
          ) unavailable();
          const wrapped: NativeReferenceTailSelection = Object.freeze({
            projection: selected.projection,
            binding: selected.binding,
            assertCurrent: async (s?: AbortSignal) => {
              await active(s);
              await selected.assertCurrent(s);
              await active(s);
            },
            assertCompatible: async (i: Readonly<NativeObject>, s?: AbortSignal) => {
              await active(s);
              await selected.assertCompatible(i, s);
              await active(s);
            },
            ...(selected.verifiedProvenance
              ? {
                verifiedProvenance: async (i: Readonly<NativeObject>, s?: AbortSignal) => {
                  if (s?.aborted) unavailable();
                  await active(s);
                  const value = await selected.verifiedProvenance!(i, s);
                  await active(s);
                  if (s?.aborted) unavailable();
                  return value;
                },
              }
              : {}),
          });
          return wrapped;
        },
      }
      : {}),
  };
  const originalScope = ports.candidateScope;
  let candidateScope: ReferenceCandidateScopePort | null = null;
  if (originalScope) {
    candidateScope = {
      sourceSha256: originalScope.sourceSha256,
      selectionSha256: originalScope.selectionSha256,
      budgetPolicySha256: originalScope.budgetPolicySha256,
      consumerReceiptSha256: originalScope.consumerReceiptSha256,
      maximumRows: originalScope.maximumRows,
      maximumEvidenceBytes: originalScope.maximumEvidenceBytes,
      maximumRuntimeMilliseconds: originalScope.maximumRuntimeMilliseconds,
      async verifyAdmission(scope, admission, requirements, signal) {
        if (admission !== boundary.admission || signal.aborted) unavailable();
        await active(signal);
        await originalScope.verifyAdmission(scope, admission, requirements, signal);
        await active(signal);
        if (signal.aborted) unavailable();
      },
      async readOfferingIds(scope, signal, maximumBytes) {
        if (signal.aborted) unavailable();
        await active(signal);
        const result = await originalScope.readOfferingIds(scope, signal, maximumBytes);
        await active(signal);
        if (signal.aborted) unavailable();
        return result;
      },
      // Cleanup must still run after abort, including all tail/selection I/O, before lease settlement.
      cancelAndWait: () => originalScope.cancelAndWait(),
    };
  }
  const projectionAuthority: NonNullable<ApiHttpPorts["referenceProjectionAuthority"]> = {
    async resolve(r, result, admission, signal) {
      if (r !== request || admission !== boundary.admission || signal !== boundary.signal) {
        unavailable();
      }
      await active();
      const proof = await ports.projectionAuthority.resolve(r, result, admission, signal);
      await active();
      if (proof === null) return null;
      if (
        typeof proof.assertCurrent !== "function" || typeof proof.assertSettled !== "function" ||
        typeof proof.authorizes !== "function"
      ) unavailable();
      return Object.freeze({
        assertCurrent: async (s: AbortSignal) => {
          if (s !== boundary.signal) unavailable();
          await active();
          await proof.assertCurrent(s);
          await active();
        },
        assertSettled: (s: AbortSignal) => {
          if (s !== boundary.signal) unavailable();
          lease.assertSettled(request, boundary);
          proof.assertSettled!(s);
          lease.assertSettled(request, boundary);
        },
        authorizes: proof.authorizes.bind(proof),
      });
    },
  };
  return Object.freeze({ tail, candidateScope, projectionAuthority });
}
