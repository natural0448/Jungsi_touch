/** Request-local, owner-scoped reference delivery across legacy and new factory modes. */
import { AccessError, authorizeReport } from "../application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "../application/api_dispatch.ts";
import type { PlatformRepositoryPort } from "../application/platform_repository.ts";
import type { ReferenceProjectionAuthority } from "../application/public_response.ts";
import type { ApiHttpPorts } from "./api_http.ts";
import type { RuntimeReferenceLease } from "./runtime_reference_lease.ts";
import type { RuntimeReferencePorts } from "./runtime_reference_ports.ts";
import { resolveReferenceTransition } from "./reference_projection_transition.ts";
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
export function savedReportProjectionAuthority(input: {
  readonly repository: Pick<
    PlatformRepositoryPort,
    "lookupAccess" | "getReport" | "getReportRevision"
  >;
  readonly lease: RuntimeReferenceLease;
  readonly factoryConfigured: boolean;
  readonly reference: (
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
  ) => Promise<RuntimeReferencePorts | null>;
  readonly legacy: (
    request: ApiExecution,
    result: unknown,
    admission: unknown,
    signal: AbortSignal,
  ) => Promise<ReferenceProjectionAuthority | null>;
  readonly receipt: (signal: AbortSignal) => Promise<Readonly<{ assertCurrent(): void }>>;
}): NonNullable<ApiHttpPorts["referenceProjectionAuthority"]> {
  return {
    async resolve(r, result, admission, signal) {
      const visible = r.operation === "report.export" && object(result) ? result.report : result;
      if (
        !object(visible) || typeof visible.report_id !== "string" ||
        typeof visible.profile_id !== "string" ||
        typeof visible.report_version !== "number" ||
        r.params.report_id !== undefined && r.params.report_id !== visible.report_id
      ) return null;
      const owner = r.session.user.subjectId, reportId = visible.report_id;
      const readOwnedCurrent = async () => {
        await authorizeReport(r.session.user, reportId, {
          find: (id) => input.repository.lookupAccess(owner, id),
        }, false);
        const record = await input.repository.getReport(owner, reportId);
        if (
          !record || record.owner_id !== owner || record.report_id !== reportId ||
          record.profile_id !== visible.profile_id ||
          record.revision !== visible.report_version
        ) return null;
        return record;
      };
      return await resolveReferenceTransition({
        signal,
        readOwnedCurrent,
        readRevision: async (record, revision, scopeSignal) => {
          if (!input.repository.getReportRevision || scopeSignal.aborted) {
            throw new AccessError("security_policy_unavailable", 503);
          }
          const value = await input.repository.getReportRevision(
            owner,
            reportId,
            revision,
            scopeSignal,
          );
          if (
            scopeSignal.aborted ||
            value && (value.owner_id !== record.owner_id || value.report_id !== record.report_id ||
                value.profile_id !== record.profile_id || value.revision !== revision)
          ) {
            throw new AccessError("security_policy_unavailable", 503);
          }
          return value;
        },
        resolveLegacy: async () => {
          if (input.factoryConfigured) {
            if (!await input.reference(r, { admission, signal })) {
              return null;
            }
          } else {
            const saved = await readOwnedCurrent();
            if (!saved || Object.hasOwn(saved.body, "_reference_evidence")) return null;
          }
          return await input.legacy(r, result, admission, signal);
        },
        resolveProven: async () => {
          const ports = await input.reference(r, { admission, signal });
          return ports
            ? await ports.projectionAuthority.resolve(r, result, admission, signal)
            : null;
        },
        captureReceipt: async (s) => {
          await input.lease.assert(r, { admission, signal: s });
          return await input.receipt(s);
        },
        assertSettledRequest: (s) => input.lease.assertSettled(r, { admission, signal: s }),
      });
    },
  };
}
