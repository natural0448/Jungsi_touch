import { syncPromise } from "./fixture.ts";
/** Sequential invented application-test repository. Native transaction tests are separate. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type {
  PlatformRepositoryPort,
  ProfileWrite,
  ReportWrite,
  StoredMutation,
  StoredProfile,
  StoredReport,
} from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";
import { nativeJsonText } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { parseNativeJson } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
function clone<T>(v: T): T {
  return parseNativeJson(nativeJsonText(v)) as T;
}
export class SyntheticNativeRepository implements PlatformRepositoryPort {
  readonly profiles = new Map<string, StoredProfile>();
  readonly reports = new Map<string, StoredReport>();
  readonly requests = new Map<string, { digest: string; result: StoredMutation }>();
  readonly events: string[] = [];
  private key(owner: string, op: string, key: string) {
    return [owner, op, key].join("\0");
  }
  replay(owner: string, operation: string, key: string, digest: string) {
    return syncPromise(() => {
      this.events.push("replay");
      const saved = this.requests.get(this.key(owner, operation, key));
      if (!saved) return null;
      if (saved.digest !== digest) throw new AccessError("idempotency_conflict", 409);
      return clone(saved.result);
    });
  }
  async createProfile(input: ProfileWrite): Promise<StoredProfile> {
    const op = input.operation ?? "score-profile.create",
      saved = await this.replay(input.owner, op, input.key, input.digest);
    if (saved) return saved as StoredProfile;
    this.events.push("create-profile");
    const result: StoredProfile = {
      profile_id: "profile-SYNTHETIC-" + (this.profiles.size + 1),
      owner_id: input.owner,
      scores: clone(input.scores),
      confirmed: input.confirmed,
      created_at: utcText(input.nowUtc),
    };
    this.profiles.set(result.profile_id, clone(result));
    this.requests.set(this.key(input.owner, op, input.key), {
      digest: input.digest,
      result: clone(result),
    });
    return clone(result);
  }
  getProfile(owner: string, pid: string) {
    return syncPromise(() => {
      this.events.push("get-profile");
      const r = this.profiles.get(pid);
      return r?.owner_id === owner ? clone(r) : null;
    });
  }
  getReport(owner: string, rid: string) {
    return syncPromise(() => {
      this.events.push("get-report");
      const r = this.reports.get(rid);
      return r?.owner_id === owner ? clone(r) : null;
    });
  }
  lookupAccess(owner: string, rid: string) {
    return syncPromise(() => {
      this.events.push("access");
      const r = this.reports.get(rid), p = r ? this.profiles.get(r.profile_id) : null;
      return r?.owner_id === owner && p?.owner_id === owner
        ? { ownerId: owner, confirmed: p.confirmed }
        : null;
    });
  }
  async writeReport(input: ReportWrite): Promise<StoredReport> {
    const saved = await this.replay(input.owner, input.operation, input.key, input.digest);
    if (saved) return saved as StoredReport;
    const p = this.profiles.get(input.profileId);
    if (p?.owner_id !== input.owner) throw new AccessError("profile_not_found", 404);
    const previous = input.reportId ? this.reports.get(input.reportId) : null;
    if (input.reportId && previous?.owner_id !== input.owner) {
      throw new AccessError("report_not_found", 404);
    }
    if (previous && previous.revision !== input.expected) {
      throw new AccessError("revision_conflict", 409);
    }
    let result: StoredReport;
    if (previous && input.noOp) result = clone(previous);
    else {
      this.events.push("write-report");
      result = {
        report_id: input.reportId ?? "report-SYNTHETIC-" + (this.reports.size + 1),
        owner_id: input.owner,
        profile_id: input.profileId,
        revision: previous ? previous.revision + 1 : 1,
        body: clone(input.body),
        updated_at: utcText(input.nowUtc),
      };
      this.reports.set(result.report_id, clone(result));
    }
    this.requests.set(this.key(input.owner, input.operation, input.key), {
      digest: input.digest,
      result: clone(result),
    });
    return clone(result);
  }
  activeReports() {
    return syncPromise(() => {
      return [...this.reports.values()].map(clone);
    });
  }
}
