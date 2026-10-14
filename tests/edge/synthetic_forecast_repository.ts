import { syncPromise } from "./fixture.ts";
/** Sequential/queued synthetic forecast repository. Actual native SQL QA is separate. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  type ManagementDecision,
  type ManagementOperation,
  requireManagementUniversity,
} from "../../supabase/functions/_shared/jungsi/application/management_access.ts";
import type {
  ForecastDraftScope,
  ForecastRepositoryPort,
  ForecastTransactionPort,
} from "../../supabase/functions/_shared/jungsi/application/forecast_ports.ts";
import type { ForecastAuthorityState } from "../../supabase/functions/_shared/jungsi/application/ports.ts";
import {
  cloneNativeJson,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcInstant } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { unicodeCompare } from "../../supabase/functions/_shared/jungsi/domain/text.ts";
export class SyntheticForecastRepository implements ForecastRepositoryPort {
  readonly productionAllowed = false;
  drafts = new Map<string, NativeObject>();
  revisions = new Map<string, NativeObject>();
  releases = new Map<string, NativeObject>();
  requests = new Map<string, { hash: string; result: NativeObject }>();
  readonly authorities = new Map<
    string,
    { edit: readonly string[]; approve: readonly string[] }
  >();
  readonly events: string[] = [];
  beforeTransaction: (() => void) | null = null;
  private tail: Promise<void> = Promise.resolve();
  readCurrent(
    subjectId: string,
    evaluatedAtUtc: bigint,
  ): Promise<ForecastAuthorityState> {
    return syncPromise(() => {
      this.events.push("authority");
      const caps = this.authorities.get(subjectId) ?? { edit: [], approve: [] },
        universityIds = [...new Set([...caps.edit, ...caps.approve])].sort(
          unicodeCompare,
        );
      return {
        authority: "jungsi_backend.forecast_authorities",
        subjectId,
        evaluatedAtUtc,
        edit: caps.edit.length > 0,
        approve: caps.approve.length > 0,
        universityIds,
        editUniversityIds: [...caps.edit],
        approveUniversityIds: [...caps.approve],
      };
    });
  }
  draftScope(
    _subject: string,
    id: string,
  ): Promise<ForecastDraftScope | null> {
    return syncPromise(() => {
      this.events.push("scope");
      const r = this.drafts.get(id);
      return r
        ? {
          draftId: id,
          universityId: (r.context as NativeObject).university_id as string,
        }
        : null;
    });
  }
  get(subject: string, id: string, d: ManagementDecision) {
    return syncPromise(() => {
      this.events.push("get");
      const r = this.drafts.get(id);
      return r && subject === d.subjectId &&
          d.universityIds.includes(
            (r.context as NativeObject).university_id as string,
          )
        ? cloneNativeJson(r)
        : null;
    });
  }
  list(
    subject: string,
    d: ManagementDecision,
    university: string | null,
  ) {
    return syncPromise(() => {
      return [...this.drafts.values()].filter((r) =>
        subject === d.subjectId &&
        d.universityIds.includes(
          (r.context as NativeObject).university_id as string,
        ) &&
        (!university || (r.context as NativeObject).university_id === university)
      ).map(cloneNativeJson);
    });
  }
  published(_subject: string, oid: string): Promise<NativeObject | null> {
    return syncPromise(() => {
      const rows = [...this.releases.values()].filter((r) =>
        (r.context as NativeObject).offering_id === oid
      ).sort((a, b) => {
        const x = utcInstant(a.published_at as string),
          y = utcInstant(b.published_at as string);
        return x < y
          ? 1
          : x > y
          ? -1
          : unicodeCompare(b.release_id as string, a.release_id as string);
      });
      return rows[0] ? cloneNativeJson(rows[0]) : null;
    });
  }
  async publishedMany(subject: string, ids: readonly string[]) {
    return new Map(
      await Promise.all(
        ids.map(async (id) => [id, await this.published(subject, id)] as const),
      ),
    );
  }
  async transact(
    subject: string,
    operation: ManagementOperation,
    key: string,
    hash: string,
    _now: bigint,
    authorize: (t: ForecastTransactionPort) => Promise<ManagementDecision>,
    mutate: (
      t: ForecastTransactionPort,
      d: ManagementDecision,
    ) => Promise<NativeObject>,
  ): Promise<NativeObject> {
    this.events.push("transact");
    this.beforeTransaction?.();
    const previous = this.tail;
    let unlock: () => void = () => {};
    this.tail = new Promise<void>((r) => unlock = r);
    await previous;
    try {
      const drafts = new Map(
          [...this.drafts].map(([k, v]) => [k, cloneNativeJson(v)]),
        ),
        revisions = new Map(this.revisions),
        releases = new Map(this.releases),
        requestId = [subject, operation, key].join("\0");
      const store: ForecastTransactionPort = {
        readCurrent: this.readCurrent.bind(this),
        draftScope: (id) =>
          syncPromise(() => {
            const r = drafts.get(id);
            return r
              ? {
                draftId: id,
                universityId: (r.context as NativeObject).university_id as string,
              }
              : null;
          }),
        get: (id, d) =>
          syncPromise(() => {
            const r = drafts.get(id);
            if (!r) return null;
            requireManagementUniversity(
              d,
              (r.context as NativeObject).university_id as string,
            );
            return cloneNativeJson(r);
          }),
        put: (record, expected, d) =>
          syncPromise(() => {
            requireManagementUniversity(
              d,
              (record.context as NativeObject).university_id as string,
            );
            const id = record.draft_id as string, old = drafts.get(id);
            if (
              expected === null ? old !== undefined : old?.revision !== expected
            ) throw new AccessError("revision_conflict", 409);
            if (record.revision !== (expected === null ? 1 : expected + 1)) {
              throw new AccessError("revision_conflict", 409);
            }
            drafts.set(id, cloneNativeJson(record));
            revisions.set(
              id + "\0" + String(record.revision),
              cloneNativeJson(record),
            );
          }),
        publish: (release, d) =>
          syncPromise(() => {
            requireManagementUniversity(
              d,
              (release.context as NativeObject).university_id as string,
            );
            if (d.operation !== "forecast.publish") {
              throw new AccessError("forecast_forbidden", 403);
            }
            releases.set(release.release_id as string, cloneNativeJson(release));
          }),
      };
      const decision = await authorize(store);
      this.events.push("replay");
      const saved = this.requests.get(requestId);
      if (saved) {
        if (saved.hash !== hash) {
          throw new AccessError("idempotency_conflict", 409);
        }
        requireManagementUniversity(
          decision,
          (saved.result.context as NativeObject).university_id as string,
        );
        return cloneNativeJson(saved.result);
      }
      const result = await mutate(store, decision);
      this.drafts = drafts;
      this.revisions = revisions;
      this.releases = releases;
      this.requests.set(requestId, { hash, result: cloneNativeJson(result) });
      this.events.push("commit");
      return cloneNativeJson(result);
    } finally {
      unlock();
    }
  }
}
