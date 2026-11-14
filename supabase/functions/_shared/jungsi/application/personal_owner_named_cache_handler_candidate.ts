/** Internal only: exact UUID_student-name file under independently verified self-student scope. */
import type { ApiExecution, ApiExecutionBoundary } from "./api_dispatch.ts";
import {
  type PersonalOwnerStorageScopePorts,
  withVerifiedPersonalOwnerStorageScope,
} from "./personal_owner_storage_scope_candidate.ts";
import {
  type PersonalSelfStudentNameAuthority,
  withPersonalSelfStudentFilename,
} from "./personal_self_student_filename_candidate.ts";
import {
  type PersonalOwnerCacheReadAuthority,
  type PersonalOwnerCacheResult,
  readCurrentPersonalOwnerCache,
} from "./personal_owner_cache_read_candidate.ts";
import type { PersonalOwnerPrivateReadPort } from "./personal_owner_cache_read_candidate.ts";
import type { PersonalStudentFilenameResult } from "./personal_self_student_filename_candidate.ts";

/** Server composition supplies a reader; this factory grants no identity or storage authority. */
export type NamedOwnerStorageFactory = (
  name: Extract<PersonalStudentFilenameResult, { state: "ready" }>,
) => PersonalOwnerPrivateReadPort;
/** No client name, student UUID or profile display name can authorize the filename. */
export async function readVerifiedPersonalNamedOwnerCache(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  input: Readonly<{ reportId: string; profileId: string; reportRevision: number }>,
  scope: PersonalOwnerStorageScopePorts,
  nameAuthority: PersonalSelfStudentNameAuthority,
  cacheAuthority: PersonalOwnerCacheReadAuthority,
  storageForName: NamedOwnerStorageFactory,
): Promise<PersonalOwnerCacheResult> {
  return await withVerifiedPersonalOwnerStorageScope(
    request,
    boundary,
    input,
    scope,
    async (identity) =>
      await withPersonalSelfStudentFilename(
        request,
        boundary,
        identity,
        nameAuthority,
        async (name) => {
          if (name.state !== "ready") {
            return Object.freeze({
              state: "pending" as const,
              rows: null,
            });
          }
          const storage = storageForName(name);
          return await readCurrentPersonalOwnerCache(
            request,
            boundary,
            identity,
            cacheAuthority,
            storage,
          );
        },
      ),
  );
}
