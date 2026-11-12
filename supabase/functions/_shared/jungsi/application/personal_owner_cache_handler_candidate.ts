/** Personal owner-scoped cache entry point. Does not change the student-ID contract. */
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import {
  type PersonalOwnerStorageScopePorts,
  withVerifiedPersonalOwnerStorageScope,
} from "./personal_owner_storage_scope_candidate.ts";
import {
  type PersonalOwnerCacheReadAuthority,
  type PersonalOwnerCacheResult,
  type PersonalOwnerPrivateReadPort,
  readCurrentPersonalOwnerCache,
} from "./personal_owner_cache_read_candidate.ts";
/** Caller still needs exact public projection, real authority, approved bucket/head and budget. */
export async function readVerifiedPersonalOwnerCache(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  input: Readonly<{ reportId: string; profileId: string; reportRevision: number }>,
  scope: PersonalOwnerStorageScopePorts,
  authority: PersonalOwnerCacheReadAuthority,
  storage: PersonalOwnerPrivateReadPort,
): Promise<PersonalOwnerCacheResult> {
  return await withVerifiedPersonalOwnerStorageScope(
    request,
    boundary,
    input,
    scope,
    (identity) => readCurrentPersonalOwnerCache(request, boundary, identity, authority, storage),
  );
}
