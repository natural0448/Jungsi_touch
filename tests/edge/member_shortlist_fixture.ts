/** Synthetic app-role transaction/storage boundary; no network or credentials. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import type { ApiExecution } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import { MemberShortlistService } from "../../supabase/functions/_shared/jungsi/application/member_shortlist.ts";
import { MemberJsonResults } from "../../supabase/functions/_shared/jungsi/application/member_json_results.ts";
import type { StoredReport } from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";
import {
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { MemberJsonStorage } from "../../supabase/functions/_shared/jungsi/infrastructure/member_json_storage.ts";
import {
  MEMBER_LEGACY_EXACT_SQL,
  MEMBER_LEGACY_LOCK_SQL,
  MEMBER_LEGACY_SQL,
  MEMBER_POINTER_INSERT_SQL,
  MEMBER_PUBLICATION_SQL,
  MEMBER_REPLAY_SQL,
  MEMBER_RESULTS_SQL,
  MEMBER_REVISION_SQL,
  SupabaseMemberShortlist,
  SupabaseMemberShortlistLegacy,
} from "../../supabase/functions/_shared/jungsi/infrastructure/member_shortlist_postgres.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
import {
  AUDIT_INSERT_SQL,
  REPORT_READ_SQL,
  REPORT_REVISION_SQL,
  REPORT_UPDATE_SQL,
  REQUEST_REPLAY_SQL,
  REVISION_INSERT_SQL,
  SupabasePlatformRepository,
} from "../../supabase/functions/_shared/jungsi/infrastructure/platform_postgres.ts";
import { parseNativeJson } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
export const OWNER = "00000000-0000-0000-0000-000000000001",
  OTHER = "00000000-0000-0000-0000-000000000002";
export const NOW = 1792886400000000n, TIME = "2026-10-25T00:00:00.000000Z";
export const paid = {
  user: { subjectId: OWNER, expiresAtUtc: NOW + 1000000000n },
  evaluatedAtUtc: NOW,
  tier: "paid" as const,
  paidUntilUtc: NOW + 1000000000n,
};
export async function rejects(work: () => Promise<unknown>, code: string, http = 503) {
  try {
    await work();
    throw new Error("expected rejection");
  } catch (e) {
    assert(e instanceof AccessError);
    equal(e.code, code);
    equal(e.http, http);
  }
}
export function report(id = "SYNTHETIC-report", revision = 1): StoredReport {
  return {
    owner_id: OWNER,
    report_id: id,
    profile_id: "SYNTHETIC-profile",
    revision,
    updated_at: TIME,
    body: {
      overall: {
        exam: { academic_year: 2027, exam_id: "SYNTHETIC-exam", pack_version: "SYNTHETIC-pack" },
      },
      analyses: {
        "SYNTHETIC-a": { status: "pending", converted_score: "0", reason_code: "reference_only" },
      },
      shortlist: { "SYNTHETIC-a": { selected: true, changed_at: TIME } },
      candidates: null,
      analysis_status: { status: "pending" },
    },
  };
}
export function request(
  operation: "member-shortlist.read" | "member-shortlist.update" = "member-shortlist.read",
  body: NativeObject = {},
  query: Record<string, string> = { year: "2027" },
  key = "SYNTHETIC-key",
): ApiExecution {
  return {
    operation,
    session: paid,
    management: null,
    body,
    query,
    params: operation === "member-shortlist.update" ? { offering_id: "SYNTHETIC-b" } : {},
    requestKey: operation === "member-shortlist.update" ? key : null,
  };
}
export function memberFixture(maxItems = 100) {
  const objects = new Map<string, Uint8Array>(),
    records = new Map<
      string,
      { owner: string; op: string; key: string; digest: string; result: string }
    >(),
    reports: StoredReport[] = [report()];
  const counts = { get: 0, put: 0, dbInsert: 0, catalog: 0, results: 0, legacy: 0, fresh: 0 };
  const statements: { sql: string; args: readonly unknown[] }[] = [];
  let missingCatalog: string | null = null,
    displayName = "합성대학",
    afterLegacyLock: (() => void) | null = null;
  let tail = Promise.resolve(),
    storageStatus: number | null = null,
    corrupt = false,
    current = true,
    afterPut: (() => void) | null = null;
  const makeFetcher = (frame: { active: number }) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert(frame.active === 0, "Storage must be outside short metadata transactions");
      const key = new URL(String(input)).pathname.split("/jungsi-private-artifacts/")[1];
      if (init?.method === "POST") {
        counts.put++;
        equal(new Headers(init.headers).get("x-upsert"), "false");
        if (objects.has(key)) return new Response(null, { status: 409 });
        objects.set(key, new Uint8Array(await new Response(init.body).arrayBuffer()));
        if (afterPut) {
          const f = afterPut;
          afterPut = null;
          f();
        }
        return new Response(null, { status: 201 });
      }
      counts.get++;
      if (storageStatus) return new Response(null, { status: storageStatus });
      const b = objects.get(key);
      return new Response(b ? (corrupt ? new Uint8Array([123]) : Uint8Array.from(b)) : null, {
        status: b ? 200 : 404,
      });
    }) as typeof fetch;
  const pick = (owner: unknown, year: unknown, rid: unknown = null, rv: unknown = null) =>
    reports.filter((r) =>
      r.owner_id === owner &&
      String(
          (r.body.overall as NativeObject).exam &&
            ((r.body.overall as NativeObject).exam as NativeObject).academic_year,
        ) === String(year) &&
      (!rid || r.report_id === rid) && (!rv || r.revision === Number(rv))
    ).sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at) || b.report_id.localeCompare(a.report_id)
    )[0];
  const makePool = (frame: { active: number }): NativeSqlPool => ({
    close: () => Promise.resolve(),
    transaction: async (readOnly, work) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((r) => release = r);
      await previous;
      const before = new Map(records);
      frame.active++;
      try {
        return await work({
          query: (sql, args = []) => {
            statements.push({ sql, args });
            if (sql === RUNTIME_ROLE_SQL) {
              return Promise.resolve([[
                "jungsi_backend_app",
                false,
                false,
                "on",
                readOnly ? "on" : "off",
                false,
                false,
                false,
                "UTC",
              ]]);
            }
            if (
              sql.startsWith("SET LOCAL") || sql.includes("set_config") ||
              sql.includes("pg_advisory_xact_lock")
            ) return Promise.resolve([]);
            if (sql === MEMBER_PUBLICATION_SQL || sql === MEMBER_REVISION_SQL) {
              const rows = [...records.values()].filter((r) =>
                r.owner === args[0] && r.op === "member-shortlist.publication" &&
                (sql === MEMBER_REVISION_SQL
                  ? r.key === args[1]
                  : r.key.startsWith(String(args[1]).slice(0, -1)))
              ).sort((a, b) => b.key.localeCompare(a.key));
              return Promise.resolve(rows.slice(0, 1).map((r) => [r.result]));
            }
            if (sql === MEMBER_REPLAY_SQL) {
              const r = records.get(`${args[0]}|member-shortlist.update|${args[1]}`);
              return Promise.resolve(r ? [[r.digest, r.result]] : []);
            }
            if (sql === REQUEST_REPLAY_SQL) {
              const r = records.get(`${args[0]}|${args[1]}|${args[2]}`);
              return Promise.resolve(r ? [[r.digest, r.result]] : []);
            }
            if (
              sql ===
                "SELECT profile_id FROM jungsi_backend.profiles WHERE profile_id=$1 AND owner_id=$2"
            ) {
              return Promise.resolve(
                args[0] === "SYNTHETIC-profile" && args[1] === OWNER ? [[args[0]]] : [],
              );
            }
            if (sql === REPORT_REVISION_SQL) {
              const r = reports.filter((r) =>
                r.owner_id === args[1] && r.report_id === args[0]
              ).sort((a, b) =>
                b.revision - a.revision
              )[0];
              return Promise.resolve(r ? [[String(r.revision)]] : []);
            }
            if (sql === REPORT_UPDATE_SQL || sql === AUDIT_INSERT_SQL) return Promise.resolve([]);
            if (sql === REVISION_INSERT_SQL) {
              reports.unshift({
                report_id: String(args[0]),
                owner_id: String(args[1]),
                profile_id: String(args[2]),
                revision: Number(args[3]),
                body: parseNativeJson(String(args[4])) as NativeObject,
                updated_at: String(args[5]),
              });
              return Promise.resolve([]);
            }
            if (sql === REPORT_READ_SQL) {
              const r = reports.filter((r) =>
                r.owner_id === args[1] && r.report_id === args[0]
              ).sort((a, b) =>
                b.revision - a.revision
              )[0];
              return Promise.resolve(
                r
                  ? [[
                    r.report_id,
                    r.owner_id,
                    r.profile_id,
                    String(r.revision),
                    nativeJsonText(r.body),
                    r.updated_at,
                  ]]
                  : [],
              );
            }
            if (sql === MEMBER_POINTER_INSERT_SQL) {
              assert(!readOnly);
              const [owner, op, key, digest, result] = args.map(String),
                k = `${owner}|${op}|${key}`;
              assert(!records.has(k));
              records.set(k, { owner, op, key, digest, result });
              counts.dbInsert++;
              return Promise.resolve([]);
            }
            if (sql === MEMBER_LEGACY_SQL || sql === MEMBER_LEGACY_LOCK_SQL) {
              counts.legacy++;
              const r = pick(args[0], args[1]);
              if (sql === MEMBER_LEGACY_LOCK_SQL && afterLegacyLock) {
                const callback = afterLegacyLock;
                afterLegacyLock = null;
                callback();
              }
              return Promise.resolve(
                r
                  ? [[
                    r.report_id,
                    String(r.revision),
                    r.updated_at,
                    nativeJsonText(r.body.shortlist),
                  ]]
                  : [],
              );
            }
            if (sql === MEMBER_LEGACY_EXACT_SQL) {
              const r = pick(args[0], args[1], args[3], args[4]);
              return Promise.resolve(
                r
                  ? [[
                    r.report_id,
                    String(r.revision),
                    r.updated_at,
                    nativeJsonText(r.body.shortlist),
                  ]]
                  : [],
              );
            }
            if (sql === MEMBER_RESULTS_SQL) {
              counts.results++;
              const r = current || args[3] ? pick(args[0], args[1], args[3], args[4]) : undefined;
              const all = r?.body.analyses as NativeObject | undefined,
                selected = Object.fromEntries(
                  (JSON.parse(String(args[2])) as string[]).filter((id) =>
                    all && Object.hasOwn(all, id)
                  ).map((id) => [id, all![id]]),
                );
              return Promise.resolve(
                r
                  ? [[
                    r.report_id,
                    String(r.revision),
                    r.profile_id,
                    "SYNTHETIC-exam",
                    "SYNTHETIC-pack",
                    nativeJsonText(selected),
                    null,
                    null,
                    null,
                    null,
                    null,
                  ]]
                  : [],
              );
            }
            if (sql.startsWith("SELECT v.profile_id,v.body::text")) {
              const r = pick(args[0], args[3], args[1], args[2]);
              return Promise.resolve(
                r ? [[r.profile_id, nativeJsonText(r.body), r.updated_at, null, null, null]] : [],
              );
            }
            throw new Error("unexpected synthetic SQL");
          },
        });
      } catch (e) {
        records.clear();
        for (const [k, v] of before) records.set(k, v);
        throw e;
      } finally {
        frame.active--;
        release();
      }
    },
  });
  const makeWorker = () => {
    const frame = { active: 0 }, pool = makePool(frame), fetcher = makeFetcher(frame);
    const sql = new SupabaseSqlTransport(pool),
      storage = new MemberJsonStorage({
        projectUrl: "https://synthetic.supabase.co",
        bucket: "jungsi-private-artifacts",
        prefix: "jungsi-api/member-json/",
        secretKey: "SYNTHETIC-secret",
        maxBytes: 1048576,
        maxItems,
        timeoutMs: 1000,
      }, fetcher);
    const legacy = new SupabaseMemberShortlistLegacy(sql, 1048576, maxItems),
      repository = new SupabaseMemberShortlist(sql, storage, legacy, 4096);
    const platform = new SupabasePlatformRepository(sql, {
      maxRecordBytes: 1048576,
      serializeMemberShortlist: true,
    });
    const service = new MemberShortlistService(
      repository,
      legacy,
      {
        lookup: (_owner, year, ids) => {
          counts.catalog++;
          equal(year, 2027);
          return Promise.resolve(
            new Map(
              ids.filter((id) => id !== missingCatalog).map(
                (id) => [id, {
                  offering_id: id,
                  academic_year: year,
                  university_id: "SYNTHETIC-u",
                  university_name: displayName,
                  campus: null,
                  department: "합성학과",
                  group: "가",
                  track: "일반",
                  region: null,
                  wildcard_group: null,
                }],
              ),
            ),
          );
        },
      },
      new MemberJsonResults(legacy, maxItems),
      { nowUtc: () => NOW },
      maxItems,
      new Set([2027]),
      () => {
        counts.fresh++;
        return Promise.resolve();
      },
    );
    return { storage, repository, legacy, service, fetcher, sql, platform };
  };
  const worker = makeWorker();
  return {
    ...worker,
    newWorker: makeWorker,
    objects,
    records,
    reports,
    counts,
    statements,
    afterLegacyLock: (callback: () => void) => afterLegacyLock = callback,
    setMissingCatalog: (v: string | null) => missingCatalog = v,
    setDisplayName: (v: string) => displayName = v,
    setStatus: (s: number | null) => storageStatus = s,
    setCorrupt: (v: boolean) => corrupt = v,
    setCurrent: (v: boolean) => current = v,
    afterPut: (f: () => void) => afterPut = f,
  };
}
