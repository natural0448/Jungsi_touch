/** Invented identities and an in-memory SQL fixture; no network or database access. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { ApprovedOperatingPolicy } from "../../supabase/functions/_shared/jungsi/application/operating_policy.ts";
import { OverallAnalysisService } from "../../supabase/functions/_shared/jungsi/application/overall_analysis.ts";
import { ProfileReportService } from "../../supabase/functions/_shared/jungsi/application/profile_reports.ts";
import { ScoreInputService } from "../../supabase/functions/_shared/jungsi/application/score_input_service.ts";
import type { SessionSnapshot } from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
import { ContractError } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import { NativeExamPack } from "../../supabase/functions/_shared/jungsi/domain/exam_pack.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcInstant, utcText } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import { SupabaseScoreInputRepository } from "../../supabase/functions/_shared/jungsi/infrastructure/score_input_postgres.ts";
import {
  AUDIT_INSERT_SQL,
  PROFILE_INSERT_SQL,
  PROFILE_READ_SQL,
  REPORT_ACCESS_SQL,
  REPORT_INSERT_SQL,
  REPORT_READ_SQL,
  REPORT_REVISION_SQL,
  REPORT_UPDATE_SQL,
  REQUEST_INSERT_SQL,
  REQUEST_REPLAY_SQL,
  REVISION_INSERT_SQL,
  SupabasePlatformRepository,
} from "../../supabase/functions/_shared/jungsi/infrastructure/platform_postgres.ts";
import {
  type NativeSqlPool,
  type NativeSqlTransaction,
  RUNTIME_ROLE_SQL,
  SUBJECT_CONTEXT_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { syntheticNativePackData } from "./synthetic_exam_pack.ts";
import { assert, equal } from "./fixture.ts";
const A = "00000000-0000-0000-0000-000000000001",
  B = "00000000-0000-0000-0000-000000000002",
  NOW = utcInstant("2026-10-15T00:00:00Z"),
  HASH = "a".repeat(64);
const clock = { nowUtc: () => NOW };
function session(owner = A, paid = true): SessionSnapshot {
  return Object.freeze({
    user: Object.freeze({
      subjectId: owner,
      expiresAtUtc: NOW + 3600000000n,
      accountStatus: "active",
    }),
    evaluatedAtUtc: NOW,
    tier: paid ? "paid" : "standard",
    paidUntilUtc: paid ? NOW + 3600000000n : null,
    paidPassId: paid ? "1" : null,
  });
}
function scores(): NativeObject {
  return {
    exam_id: "SYNTHETIC-mock",
    pack_version: "SYNTHETIC-pack.v1",
    korean: { standard_score: 5 },
    math: { standard_score: 6 },
    inquiry: [{ subject: "가상탐구가", standard_score: 7 }, {
      subject: "가상탐구나",
      standard_score: 8,
    }],
  };
}
function policy(
  change: (r: NativeObject) => void = () => {},
): ApprovedOperatingPolicy {
  const expiry = utcText(NOW + 3600000000n);
  const raw: NativeObject = {
    format: "jungsi.score-input-policy/v1",
    status: "approved",
    purpose: "paid_score_input",
    approval_reference_sha256: HASH,
    version: "SYNTHETIC-policy-v2",
    rollout_id: "SYNTHETIC-rollout",
    calculation_version: "SYNTHETIC-calculation",
    expires_at: expiry,
    personal_daily_analysis_limit: "replaced_by_stage_rights",
    initial_saves: 1,
    correction_grants: 1,
    physical: {
      max_request_calculation_units: 100,
      max_request_runtime_milliseconds: 10000,
    },
    preview: { enabled: false, expires_at: expiry, allow_subjects: [] },
    stages: [{
      exam_id: "SYNTHETIC-mock",
      input_scope_id: "SYNTHETIC-canonical-season",
      pack_version: "SYNTHETIC-pack.v1",
      academic_year: 2027,
      stage: "mock",
      window: { mode: "policy_lifetime" },
    }],
  };
  change(raw);
  return new ApprovedOperatingPolicy(raw, {
    policyVersion: "SYNTHETIC-usage",
    approvalSha256: HASH,
    expiresAtUtc: NOW + 3600000000n,
    exams: new Map([["SYNTHETIC-mock", {
      packVersion: "SYNTHETIC-pack.v1",
      academicYear: 2027,
    }], ["SYNTHETIC-alias", {
      packVersion: "SYNTHETIC-pack.v1",
      academicYear: 2027,
    }]]),
    registrySha256: "b".repeat(64),
    selectionSha256: "c".repeat(64),
  });
}
async function denied(
  work: () => Promise<unknown>,
  code: string,
  http?: number,
) {
  let e: unknown;
  try {
    await work();
  } catch (x) {
    e = x;
  }
  assert(e instanceof AccessError || e instanceof ContractError);
  equal(e.code, code);
  if (http !== undefined) {
    assert(e instanceof AccessError);
    equal(e.http, http);
  }
}
type DbState = {
  profiles: Map<string, unknown[]>;
  requests: Map<string, unknown[]>;
  states: unknown[][];
  attempts: unknown[][];
  legacyLinks: {
    profileId: string;
    owner: string;
    scope: string;
    stage: string;
    rollout: string;
  }[];
  usage: number;
  corrections: unknown[][];
  reports: Map<string, unknown[]>;
  revisions: Map<string, unknown[]>;
  origins: {
    originId: string;
    owner: string;
    reportId: string;
    revision: number;
    component: string;
    operation: string;
    pass: string | null;
  }[];
  firstUse: Map<
    string,
    { owner: string; operation: string; access: string; basis: string }
  >;
};
function emptyDb(): DbState {
  return {
    profiles: new Map(),
    requests: new Map(),
    states: [],
    attempts: [],
    legacyLinks: [],
    usage: 0,
    corrections: [],
    reports: new Map(),
    revisions: new Map(),
    origins: [],
    firstUse: new Map(),
  };
}
/** Serializes transactions like max=1 and rejects native JS array bind parameters. This is not a PostgreSQL execution claim. */
class OneSlotPool implements NativeSqlPool {
  state = emptyDb();
  trace: {
    sql: string;
    parameters: readonly unknown[];
    subject: string | null;
  }[] = [];
  rolloutReady = true;
  rolloutDecision: ((parameters: readonly unknown[]) => boolean) | null = null;
  failDelivery = false;
  readonly passes = new Map([["1", A], ["2", A], ["3", B]]);
  active = 0;
  maximum = 0;
  commits = 0;
  rollbacks = 0;
  private tail = Promise.resolve();
  async transaction<T>(
    readOnly: boolean,
    work: (tx: NativeSqlTransaction) => Promise<T>,
  ): Promise<T> {
    const before = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => release = r);
    await before;
    this.active++;
    this.maximum = Math.max(this.maximum, this.active);
    const db = structuredClone(this.state);
    let subject: string | null = null;
    const query = async (
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<unknown[][]> => {
      // Preserve the asynchronous driver boundary in the single-slot fixture.
      await Promise.resolve();
      assert(
        parameters.every((v) =>
          v === null ||
          ["string", "boolean", "number", "bigint"].includes(typeof v)
        ),
        "All driver parameters must be scalar; arrays must cross as JSON text",
      );
      this.trace.push({ sql, parameters, subject });
      if (sql.startsWith("SET LOCAL")) return [];
      if (sql === SUBJECT_CONTEXT_SQL) {
        subject = parameters[0] as string;
        return [];
      }
      if (sql === RUNTIME_ROLE_SQL) {
        return [[
          "jungsi_backend_app",
          false,
          false,
          "on",
          readOnly ? "on" : "off",
          false,
          false,
          false,
          "UTC",
        ]];
      }
      if (sql === "SYNTHETIC_CONTEXT") return [[subject]];
      if (sql === "SYNTHETIC_RESERVE") {
        db.usage++;
        return [];
      }
      if (sql === "SYNTHETIC_SETTLE") return [];
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) return [[]];
      if (sql === PROFILE_INSERT_SQL) {
        assert(!readOnly);
        const row = [...parameters];
        row[4] = (row[4] as string).replace(/(?<!\.[0-9]{6})Z$/, ".000000Z");
        db.profiles.set(String(row[0]), row);
        return [];
      }
      if (sql === PROFILE_READ_SQL) {
        const r = db.profiles.get(String(parameters[0]));
        return r && r[1] === parameters[1] ? [r] : [];
      }
      if (sql === REQUEST_REPLAY_SQL) {
        return db.requests.has(parameters.slice(0, 3).join("|"))
          ? [db.requests.get(parameters.slice(0, 3).join("|"))!]
          : [];
      }
      if (sql === REQUEST_INSERT_SQL) {
        db.requests.set(parameters.slice(0, 3).join("|"), [
          parameters[3],
          parameters[4],
        ]);
        return [];
      }
      if (sql === AUDIT_INSERT_SQL) return [];
      if (sql.startsWith("SELECT command_id,ticket_ref,request_digest")) {
        const c = db.corrections.find((c) => c[1] === parameters[0] && c[9] === parameters[1]);
        return c ? [[c[0], c[5], c[10], c[2], c[3], c[4], c[7]]] : [];
      }
      if (
        sql ===
          "SELECT command_id FROM jungsi_backend.score_input_corrections WHERE ticket_ref=$1"
      ) {
        const c = db.corrections.find((c) => c[5] === parameters[0]);
        return c ? [[c[0]]] : [];
      }
      if (
        sql.startsWith("INSERT INTO jungsi_backend.score_input_corrections")
      ) {
        db.corrections.push([...parameters]);
        return [];
      }
      if (sql.startsWith("SELECT a.exam_id,a.stage,a.input_scope")) {
        const a = db.attempts.find((a) =>
          a[1] === parameters[0] && a[11] === parameters[1] &&
          a[10] === "accepted"
        );
        return a ? [[a[5], a[3], a[2]]] : [];
      }
      if (
        sql.startsWith(
          "SELECT profile_id FROM jungsi_backend.profiles WHERE profile_id=$1",
        )
      ) {
        const p = db.profiles.get(String(parameters[0]));
        return p && p[1] === parameters[1] ? [[p[0]]] : [];
      }
      if (sql === REPORT_INSERT_SQL) {
        db.reports.set(String(parameters[0]), [...parameters]);
        return [];
      }
      if (sql === REPORT_UPDATE_SQL) {
        const old = db.reports.get(String(parameters[3]));
        assert(old && old[1] === parameters[4]);
        db.reports.set(String(parameters[3]), [
          parameters[3],
          parameters[4],
          parameters[1],
          parameters[0],
          parameters[2],
        ]);
        return [];
      }
      if (sql === REVISION_INSERT_SQL) {
        const r = [...parameters];
        r[5] = (r[5] as string).replace(/(?<!\.[0-9]{6})Z$/, ".000000Z");
        db.revisions.set(String(parameters[0]) + "|" + parameters[3], r);
        return [];
      }
      if (sql === REPORT_REVISION_SQL) {
        const r = db.reports.get(String(parameters[0]));
        return r && r[1] === parameters[1] ? [[r[3]]] : [];
      }
      if (sql === REPORT_ACCESS_SQL) {
        const r = db.reports.get(String(parameters[0]));
        const p = r ? db.profiles.get(String(r[2])) : null;
        return r && p && r[1] === parameters[1] ? [[r[1], p[3]]] : [];
      }
      if (
        sql === REPORT_READ_SQL ||
        sql.includes("ORDER BY r.updated_at DESC,r.report_id DESC LIMIT 1")
      ) {
        const r = sql === REPORT_READ_SQL
          ? db.reports.get(String(parameters[0]))
          : [...db.reports.values()].filter((r) => r[1] === parameters[0] && r[2] === parameters[1])
            .sort((a, b) =>
              String(b[4]).localeCompare(String(a[4])) ||
              String(b[0]).localeCompare(String(a[0]))
            )[0];
        if (!r || sql === REPORT_READ_SQL && r[1] !== parameters[1]) return [];
        const v = db.revisions.get(String(r[0]) + "|" + r[3]);
        assert(v);
        return [v];
      }
      if (sql.startsWith("SELECT id::text FROM public.jeongsi_passes")) {
        return this.passes.get(String(parameters[0])) === parameters[1] ? [[parameters[0]]] : [];
      }
      if (sql.startsWith("INSERT INTO jungsi_backend.score_result_origins")) {
        for (const row of JSON.parse(parameters[0] as string)) {
          db.origins.push({
            originId: row.origin_id,
            owner: parameters[1] as string,
            reportId: parameters[2] as string,
            revision: Number(parameters[3]),
            component: row.component_key,
            operation: parameters[4] as string,
            pass: parameters[5] as string | null,
          });
        }
        return [];
      }
      if (
        sql.startsWith(
          "SELECT DISTINCT component_key FROM jungsi_backend.score_result_origins",
        )
      ) {
        return [
          ...new Set(
            db.origins.filter((o) =>
              o.owner === parameters[0] && o.reportId === parameters[1] &&
              o.revision <= Number(parameters[2])
            ).map((o) => o.component),
          ),
        ].map((v) => [v]);
      }
      if (sql.startsWith("SELECT l.saved_snapshot_basis")) return [];
      if (sql.startsWith("WITH origins AS MATERIALIZED")) {
        if (this.failDelivery) {
          throw new Error("SYNTHETIC-delivery-write-unavailable");
        }
        const components = JSON.parse(parameters[3] as string) as string[],
          revision = db.revisions.get(
            String(parameters[1]) + "|" + parameters[2],
          );
        const origins = revision
          ? db.origins.filter((o) =>
            o.owner === parameters[0] && o.reportId === parameters[1] &&
            o.revision <= Number(parameters[2]) &&
            components.includes(o.component)
          )
          : [];
        const paid = parameters[5] as boolean,
          targets = [
            ...new Set(
              origins.map((o) => paid ? parameters[4] as string : o.pass)
                .filter((v): v is string => v !== null),
            ),
          ];
        const eligible = targets.filter((pass) => this.passes.get(pass) === parameters[0]);
        for (const pass of eligible) {
          if (!db.firstUse.has(pass)) {
            const o = origins.find((o) => paid || o.pass === pass)!;
            db.firstUse.set(pass, {
              owner: parameters[0] as string,
              operation: o.operation,
              access: parameters[6] as string,
              basis: parameters[7] as string,
            });
          }
        }
        return [[
          String(origins.length),
          String(targets.length),
          String(eligible.length),
          String(
            targets.filter((pass) => db.firstUse.get(pass)?.owner === parameters[0]).length,
          ),
        ]];
      }
      if (sql.startsWith("SELECT to_char(u.first_result_at")) {
        const u = db.firstUse.get(String(parameters[1]));
        return u?.owner === parameters[0] ? [["2026-10-15T00:00:00.000000Z"]] : [];
      }
      if (sql.startsWith("SELECT version::text")) {
        let rows = db.states.filter((r) =>
          r[0] === parameters[0] && r[1] === parameters[1] &&
          r[2] === parameters[2]
        );
        if (parameters.length === 4) {
          rows = rows.filter((r) => r[3] === parameters[3]);
        } else {rows = rows.sort((a, b) => Number(b[3]) - Number(a[3])).slice(
            0,
            1,
          );}
        return rows.map((r) => [r[3], ...r.slice(4, 11)]);
      }
      if (
        sql.startsWith(
          "SELECT EXISTS(SELECT 1 FROM jungsi_backend.score_policy_rollouts",
        )
      ) {
        const ids = JSON.parse(parameters[4] as string) as string[];
        const mappings = JSON.parse(parameters[8] as string) as {
          exam_id: string;
          input_scope: string;
          stage: string;
        }[];
        const unmapped = [...db.profiles.values()].some((p) => {
          const exam = JSON.parse(p[2] as string).exam_id as string;
          if (p[1] !== parameters[3] || !ids.includes(exam)) return false;
          const a = db.attempts.find((item) =>
            item[1] === p[1] && item[11] === p[0] &&
            item[10] === "accepted"
          );
          const l = db.legacyLinks.find((item) => item.owner === p[1] && item.profileId === p[0]);
          if (!a && !l) return true;
          if (a && l && (a[2] !== l.scope || a[3] !== l.stage)) return true;
          if (a) {
            const anchored = db.states.some((st) =>
              st[0] === a[1] && st[1] === a[2] &&
              st[2] === a[3] && st[3] === a[4] && st[8] === a[0] && st[9] === "accepted" &&
              st[7] === a[11]
            );
            const approved = a[5] === exam && mappings.some((m) =>
              m.exam_id === exam &&
              m.input_scope === a[2] && m.stage === a[3]
            );
            return !anchored || !approved ||
              !parameters[5] && a[2] === parameters[6] && a[3] === parameters[7];
          }
          const approved = l!.rollout === parameters[0] &&
            mappings.some((m) =>
              m.exam_id === exam && m.input_scope === l!.scope && m.stage === l!.stage
            );
          return !approved ||
            !parameters[5] && l!.scope === parameters[6] && l!.stage === parameters[7];
        });
        return [[this.rolloutDecision?.(parameters) ?? this.rolloutReady, unmapped]];
      }
      if (sql.startsWith("INSERT INTO jungsi_backend.score_input_states")) {
        db.states.push([...parameters]);
        return [];
      }
      if (sql.startsWith("INSERT INTO jungsi_backend.score_input_attempts")) {
        db.attempts.push([...parameters]);
        return [];
      }
      if (sql.startsWith("SELECT attempt_id,request_digest")) {
        const a = db.attempts.find((a) =>
          a[1] === parameters[0] && a[7] === parameters[1] &&
          a[8] === parameters[2]
        );
        return a
          ? [[
            a[0],
            a[9],
            a[10],
            a[11],
            a[12],
            a[4],
            a[2],
            a[3],
            a[5],
            a[6],
            a[13],
          ]]
          : [];
      }
      if (
        sql.includes(
          "FROM jungsi_backend.reports r JOIN jungsi_backend.report_revisions",
        )
      ) return [];
      throw new Error("Unregistered synthetic SQL harness operation");
    };
    try {
      const result = await work({ query });
      if (!readOnly) this.state = db;
      this.commits++;
      return result;
    } catch (e) {
      this.rollbacks++;
      throw e;
    } finally {
      this.active--;
      release();
    }
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
function nativeFixture(p = policy(), pool = new OneSlotPool(), owner = A) {
  const sql = new SupabaseSqlTransport(pool).fork(),
    platform = new SupabasePlatformRepository(sql, { maxRecordBytes: 65536 }),
    repo = new SupabaseScoreInputRepository(sql, platform, p, clock);
  const pack = new NativeExamPack(syntheticNativePackData()),
    data = {
      getExamPack: () => Promise.resolve(pack),
      getTotalModel: () => Promise.resolve(null),
    },
    overall = new OverallAnalysisService(data),
    service = new ScoreInputService(repo, p, data, clock),
    verified = session(owner);
  const profile = new ProfileReportService(platform, data, clock, {
    mode: "rights",
    workflow: service,
  });
  const save = async (key = "SYNTHETIC-key", value = scores()) =>
    await repo.accept(
      owner,
      () =>
        profile.execute({
          operation: "score-profile.create",
          session: verified,
          management: null,
          body: { scores: value, confirmed: true },
          query: {},
          params: {},
          requestKey: key,
        }),
    );
  return {
    p,
    pool,
    sql,
    platform,
    repo,
    overall,
    service,
    profile,
    verified,
    save,
  };
}
export { A, B, clock, denied, HASH, nativeFixture, NOW, OneSlotPool, policy, scores, session };
