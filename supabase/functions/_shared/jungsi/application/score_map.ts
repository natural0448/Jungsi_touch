/**
 * 3P '내 환산점수' score map. offerings.search attaches `my_score` per item from a
 * per-student table keyed by (owner, immutable confirmed profile, approved data pin, offering).
 * Missing rows are computed with the very same UniversityScoringService as university.analyze
 * and inserted (insert-only). The SQL store lives in infrastructure/score_map_postgres.ts. Everything here is best-effort: a failure never fails the search.
 */
import type { CatalogRelease } from "./catalog.ts";
import type { RequestClockPort } from "./ports.ts";
import {
  type ScoringResult,
  type UniversityScoringDataPort,
  UniversityScoringService,
} from "./university_scoring.ts";
import { nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat } from "../domain/native_json.ts";
import { utcText } from "../domain/time.ts";

export type MyScoreStatus = "ready" | "reference" | "pending";
export interface MyScore {
  readonly status: MyScoreStatus;
  readonly converted_score: string | null;
  readonly official_max_score: string | null;
  readonly reason_code: string | null;
}
export type MyScoreState = "no_profile" | "complete" | "partial" | "unavailable";
export interface ScoreMapProfile {
  readonly profile_id: string;
  readonly scores: NativeObject;
}
export interface ScoreMapStore {
  latestProfile(owner: string): Promise<ScoreMapProfile | null>;
  read(
    owner: string,
    profileId: string,
    pin: string,
    offeringIds: readonly string[],
  ): Promise<ReadonlyMap<string, MyScore>>;
  insert(
    owner: string,
    profileId: string,
    pin: string,
    rows: readonly (MyScore & { readonly offering_id: string })[],
    nowUtc: string,
  ): Promise<void>;
}
export interface ScoreMapDataPort extends UniversityScoringDataPort {
  getCatalog(): Promise<CatalogRelease | null>;
}
export interface ScoreMapLimits {
  /** Offerings newly calculated per search request (the page itself is at most 100). */
  readonly maxComputePerRequest: number;
  /** Wall-clock budget for new calculations per request, in milliseconds. */
  readonly computeBudgetMs: number;
}
export const SCORE_MAP_LIMITS: ScoreMapLimits = Object.freeze({
  maxComputePerRequest: 100,
  computeBudgetMs: 3000,
});

export const SCORE_MAP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const SCORE_MAP_OWNER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SCORE_MAP_PIN = /^[a-f0-9]{64}$/;
const DECIMAL = /^-?[0-9]{1,12}(\.[0-9]{1,30})?$/;
const REASON = /^[a-z0-9_]{1,80}$/;
const STATUSES: readonly MyScoreStatus[] = ["ready", "reference", "pending"];

export function scoreMapInvalid(): never {
  throw new Error("score_map_invalid");
}
function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") scoreMapInvalid();
  return v;
}
function decimal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "bigint" || typeof v === "number" || v instanceof JsonFloat
    ? String(v)
    : typeof v === "string"
    ? v
    : null;
  return s !== null && DECIMAL.test(s) ? s : null;
}
/** Validated, closed shape: never a free-form value from storage or the engine. */
export function myScore(value: {
  status: unknown;
  converted_score: unknown;
  official_max_score: unknown;
  reason_code: unknown;
}): MyScore {
  const status = value.status as MyScoreStatus;
  if (!STATUSES.includes(status)) scoreMapInvalid();
  const converted = decimal(value.converted_score),
    max = decimal(value.official_max_score),
    reason = text(value.reason_code);
  if ((status === "pending") !== (converted === null)) scoreMapInvalid();
  if (reason !== null && !REASON.test(reason)) scoreMapInvalid();
  if (status === "ready" && reason !== null) scoreMapInvalid();
  return Object.freeze({
    status,
    converted_score: converted,
    official_max_score: max,
    reason_code: reason,
  });
}
/** Same meaning as the analysis card: production ready, reference-only, or pending. */
export function myScoreOf(result: ScoringResult): MyScore {
  const s = result.state, converted = decimal(s.converted_score);
  const reason = s.reason_code !== null && REASON.test(s.reason_code)
    ? s.reason_code
    : s.reason_code === null
    ? null
    : "conversion_unavailable";
  if (result.ready && converted !== null) {
    return myScore({
      status: "ready",
      converted_score: converted,
      official_max_score: s.official_max_score,
      reason_code: null,
    });
  }
  if (converted !== null) {
    return myScore({
      status: "reference",
      converted_score: converted,
      official_max_score: s.official_max_score,
      reason_code: reason ?? "reference_conversion_not_production_approved",
    });
  }
  return myScore({
    status: "pending",
    converted_score: null,
    official_max_score: null,
    reason_code: reason ?? "conversion_release_missing",
  });
}
/** Engine reasons caused by the runtime (loading, storage, security), not by the data or scores. */
export function transientReason(reason: string | null): boolean {
  return reason !== null &&
    (/^(runtime|storage|security|backend|entitlement|artifact)_/.test(reason) ||
      /_(unavailable|timeout|not_loaded)$/.test(reason));
}
/** Pin of the approved data that produced a score: registry + selection of the live binding. */
export async function scoreMapPin(
  references: Readonly<Record<string, { readonly sha256: string }>>,
): Promise<string> {
  const registry = references.registry?.sha256, selection = references.selection?.sha256;
  if (!SCORE_MAP_PIN.test(String(registry)) || !SCORE_MAP_PIN.test(String(selection))) {
    scoreMapInvalid();
  }
  // v2: v1 rows from the first rollout were stored while search loaded catalog payloads only.
  return await nativeJsonSha256(["jungsi.score-map/v2", registry, selection]);
}

export interface AttachedScores {
  readonly items: NativeObject[];
  readonly state: MyScoreState;
}
export class ScoreMapService {
  constructor(
    private readonly store: ScoreMapStore,
    private readonly data: ScoreMapDataPort,
    private readonly pin: () => Promise<string>,
    private readonly clock: RequestClockPort,
    private readonly limits: ScoreMapLimits = SCORE_MAP_LIMITS,
    private readonly now: () => number = () => performance.now(),
  ) {}
  /** Adds `my_score` to every search item. Never throws; failures leave `my_score: null`. */
  async attach(subject: string, items: readonly NativeObject[]): Promise<AttachedScores> {
    const empty = (state: MyScoreState): AttachedScores => ({
      items: items.map((item) => ({ ...item, my_score: null })),
      state,
    });
    try {
      const ids = items.map((item) => item.offering_id);
      if (
        ids.some((id) => typeof id !== "string" || !SCORE_MAP_ID.test(id)) ||
        new Set(ids).size !== ids.length
      ) {
        return empty("unavailable");
      }
      const profile = await this.store.latestProfile(subject);
      if (!profile) return empty("no_profile");
      if (!items.length) return { items: [], state: "complete" };
      const pin = await this.pin();
      const saved = await this.store.read(subject, profile.profile_id, pin, ids as string[]);
      // Reference and pending entries cannot prove the current request's attendance or
      // availability. Keep historical rows untouched and recalculate those entries.
      const found = new Map<string, MyScore>(
        [...saved].filter(([, score]) => score.status === "ready"),
      );
      const missing = (ids as string[]).filter((id) => !found.has(id));
      if (missing.length) await this.compute(subject, profile, pin, missing, found);
      const out = items.map((item) => ({
        ...item,
        my_score: found.has(item.offering_id as string)
          ? { ...found.get(item.offering_id as string)! }
          : null,
      }));
      return {
        items: out,
        state: out.every((item) => item.my_score !== null) ? "complete" : "partial",
      };
    } catch {
      return empty("unavailable");
    }
  }
  private async compute(
    subject: string,
    profile: ScoreMapProfile,
    pin: string,
    missing: readonly string[],
    found: Map<string, MyScore>,
  ): Promise<void> {
    const catalog = await this.data.getCatalog();
    if (!catalog) return;
    const wanted = new Set(missing), rows = new Map<string, NativeObject>();
    for (const row of catalog.offerings) {
      const id = row.offering_id;
      if (typeof id === "string" && wanted.has(id) && !rows.has(id)) rows.set(id, row);
    }
    const scoring = new UniversityScoringService(this.data), start = this.now();
    const computed: (MyScore & { offering_id: string })[] = [];
    let completed = 0;
    await scoring.batch(async () => {
      for (const id of missing) {
        const row = rows.get(id);
        if (!row) {
          // Search-only rows without an analysis catalog row: shown as pending, never stored.
          found.set(
            id,
            myScore({
              status: "pending",
              converted_score: null,
              official_max_score: null,
              reason_code: "analysis_catalog_missing",
            }),
          );
          continue;
        }
        if (
          completed >= this.limits.maxComputePerRequest ||
          this.now() - start >= this.limits.computeBudgetMs
        ) continue;
        try {
          const score = myScoreOf(await scoring.calculate(row, profile));
          // A runtime/storage failure is not a data answer: leave it null (계산 중), never store it.
          if (score.status === "pending" && transientReason(score.reason_code)) continue;
          found.set(id, score);
          completed++;
          // Pending can be transient; reference values require fresh request context.
          if (score.status === "ready") computed.push({ offering_id: id, ...score });
        } catch {
          // Left null (계산 중); the next request retries it.
        }
      }
    });
    if (!computed.length) return;
    try {
      await this.store.insert(
        subject,
        profile.profile_id,
        pin,
        computed,
        utcText(this.clock.nowUtc()),
      );
    } catch {
      // Shown now, stored on a later request.
    }
  }
}
