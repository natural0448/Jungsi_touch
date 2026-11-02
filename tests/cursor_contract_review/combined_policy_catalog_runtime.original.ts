/** REVIEW ONLY: isolated 799 wiring candidate; not a deployed 859c source. */
/** Explicit combined-policy20 factory. Exact14 and read-view17 factories remain separate. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  COMBINED_POLICY_CONSUMER_OPERATION_IDS,
  MEMBER_SHORTLIST_CONSUMER_OPERATION_IDS,
} from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import type { CatalogDataPort } from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import type { RequestClockPort } from "../../supabase/functions/_shared/jungsi/application/ports.ts";
import { nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type {
  ApprovedRuntimeBinding,
  RuntimeEnvironment,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_settings.ts";
import type { SupabaseSqlTransport } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import {
  CurrentPublicCatalogCursor,
  type CurrentPublicCatalogPort,
  CurrentPublicCatalogService,
  type PublicCatalogCursorPort,
} from "../../supabase/functions/_shared/current_public_catalog.ts";
import {
  CurrentPublicCatalogSql,
  verifyPublicCatalogDescriptor,
} from "../../supabase/functions/_shared/current_public_catalog_sql.ts";
import { CurrentPublicMetadataKeyIndex } from "../../supabase/functions/_shared/current_public_key_index.ts";
import { currentPublicKeyObjectReader } from "../../supabase/functions/_shared/current_public_key_storage.ts";
import {
  ObservedCurrentPublicCatalogService,
  observeKeySelection,
  SearchDiagnostic,
  type ServerOnlySink,
} from "../../supabase/functions/_shared/search_failure_diagnostic.ts";
function createBoundCatalogService(
  data: CatalogDataPort,
  clock: RequestClockPort,
  sql: () => SupabaseSqlTransport,
  env: RuntimeEnvironment,
  context: {
    binding(): Promise<ApprovedRuntimeBinding>;
    controls(): Promise<{ fetcher: typeof fetch }>;
    searchDiagnostic?: ServerOnlySink;
  },
  memberJson = false,
): CurrentPublicCatalogService {
  const trace = new SearchDiagnostic(context.searchDiagnostic);
  let verified: ReturnType<typeof verifyPublicCatalogDescriptor> | undefined,
    cipher: CurrentPublicCatalogCursor | undefined,
    reader: CurrentPublicCatalogSql | undefined;
  const key = () => {
    if (cipher) return cipher;
    const hex = env.get("JUNGSI_DISPLAY_CURSOR_KEY_HEX");
    if (typeof hex !== "string" || !/^[a-f0-9]{64}$/i.test(hex)) {
      throw new AccessError("security_policy_unavailable", 503);
    }
    return cipher = new CurrentPublicCatalogCursor(
      Uint8Array.from(hex.match(/../g)!, (x) => parseInt(x, 16)),
    );
  };
  const load = () =>
    verified ??= (async () => {
      const binding = await context.binding();
      // The new candidate can serve existing20 under the preserved v3 settings during rollout.
      // New member operations still require the separate v4 binding gate in composition.
      const memberActive = memberJson && binding.memberJson !== undefined;
      if (
        !binding.readViews ||
        binding.consumerGeneration !== (memberActive ? "member-json-22" : "operating-admin-20") ||
        binding.operations.length !== (memberActive ? 22 : 20) ||
        new Set(binding.operations).size !== (memberActive ? 22 : 20) ||
        (memberActive
          ? MEMBER_SHORTLIST_CONSUMER_OPERATION_IDS
          : COMBINED_POLICY_CONSUMER_OPERATION_IDS).some((id) => !binding.operations.includes(id))
      ) throw new AccessError("operation_scope_not_approved", 503);
      const raw = env.get("JUNGSI_CURRENT_PUBLIC_CATALOG_BINDING"),
        sha = env.get("JUNGSI_CURRENT_PUBLIC_CATALOG_BINDING_SHA256");
      if (typeof raw !== "string" || typeof sha !== "string") {
        throw new AccessError(
          "current_catalog_publication_unapproved",
          503,
        );
      }
      const result = await verifyPublicCatalogDescriptor(new TextEncoder().encode(raw), sha, clock);
      if (
        result.descriptor.consumer_binding_sha256 !== binding.descriptorSha256
      ) throw new AccessError("current_catalog_publication_unapproved", 503);
      key();
      return result;
    })();
  const port = async () => {
    if (reader) return reader;
    const [{ descriptor }, binding, controls] = await Promise.all([
      load(),
      context.binding(),
      context.controls(),
    ]);
    const index = observeKeySelection(
      new CurrentPublicMetadataKeyIndex({
        requiredFormat: "jungsi.current-public-key-index/v3",
        root: descriptor.key_index,
        metadataSha256: descriptor.metadata_sha256,
        guideCommandStateSha256: await nativeJsonSha256(descriptor.guide_command_state),
        admissionHead: descriptor.admission_head,
        coverageReceiptSha256: descriptor.coverage_receipt_sha256,
      }, currentPublicKeyObjectReader(binding, controls.fetcher)),
      trace,
    );
    return reader = new CurrentPublicCatalogSql(sql(), load, clock, index);
  };
  const current: CurrentPublicCatalogPort = {
    publication: async () => {
      const p = (await load()).publication;
      if (clock.nowUtc() >= p.expiresAtUtc) {
        throw new AccessError("current_catalog_publication_unapproved", 503);
      }
      return p;
    },
    search: async (...args) => (await port()).search(...args),
    lookup: async (...args) => (await port()).lookup(...args),
  };
  const cursor: PublicCatalogCursorPort = {
    seal: (...args) => key().seal(...args),
    open: (...args) => key().open(...args),
  };
  return new ObservedCurrentPublicCatalogService(data, current, clock, cursor, trace);
}

export function createCombinedPolicyCatalogService(
  ...args: Parameters<typeof createBoundCatalogService>
): CurrentPublicCatalogService {
  return createBoundCatalogService(args[0], args[1], args[2], args[3], args[4], false);
}
export function createMemberShortlistCatalogService(
  ...args: Parameters<typeof createBoundCatalogService>
): CurrentPublicCatalogService {
  return createBoundCatalogService(args[0], args[1], args[2], args[3], args[4], true);
}
