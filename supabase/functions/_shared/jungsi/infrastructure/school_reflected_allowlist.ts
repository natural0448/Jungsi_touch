/**
 * 학교 반영 참고백분위 허가 목록(2027, 대표님 결정 2026-11-14) 읽기.
 *
 * 목록은 Git에 넣지 않는다. 비공개 Storage 파일로 두고, 비밀 설정
 * JUNGSI_SCHOOL_REFLECTED_ALLOWLIST({bucket, object_key, bytes, sha256, version})로
 * 지문을 고정한다. 설정이 없거나 형식이 틀리면 기능을 끈다(null).
 */
import type {
  ReflectedInquiryMode,
  ReflectedReferenceRule,
} from "../application/school_reflected_reference.ts";
import type {
  EligibilityConditions,
  EligibilityConditionsPort,
  SchoolReflectedRulesPort,
  YearCutoff,
  YearCutoffsPort,
} from "../application/school_reflected_projection.ts";
import { type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { SupabaseArtifactClient } from "./supabase_artifacts.ts";
import type { RuntimeEnvironment } from "./runtime_settings.ts";

export const SCHOOL_REFLECTED_SETTING = "JUNGSI_SCHOOL_REFLECTED_ALLOWLIST";
const FORMAT = "jungsi.school-reflected-reference-allowlist/v1";
const MODES: Readonly<Record<string, ReflectedInquiryMode>> = Object.freeze({
  n: "none",
  "2": "two_equal",
  p: "best1_percentile",
  s: "best1_standard",
});
const PK = /^[0-9]{6,20}$/;
const MAX_ROWS = 20000;

/** 지원 자격 조건 목록(2027, 대표님 결정 2026-11-15)의 비밀 설정 이름 */
export const ELIGIBILITY_CONDITIONS_SETTING = "JUNGSI_ELIGIBILITY_CONDITIONS";

/** 연도별 합격선 누적 백분위 목록(R9 명부, 대표님 결정 2026-11-15)의 비밀 설정 이름 */
export const YEAR_CUTOFFS_SETTING = "JUNGSI_YEAR_CUTOFF_REFERENCES";
/** 연도별 합격선 누적 백분위 목록의 비밀 설정. 형식은 학교 반영 허가 목록과 같다 */
export function yearCutoffsEntry(env: RuntimeEnvironment): Readonly<NativeObject> | null {
  return pinnedEntry(env, YEAR_CUTOFFS_SETTING);
}

/** 비밀 설정 하나를 읽어 검증한다. 틀리면 null(기능 꺼짐) */
export function schoolReflectedEntry(env: RuntimeEnvironment): Readonly<NativeObject> | null {
  return pinnedEntry(env, SCHOOL_REFLECTED_SETTING);
}
/** 지원 자격 조건 목록의 비밀 설정. 형식은 학교 반영 허가 목록과 같다 */
export function eligibilityConditionsEntry(env: RuntimeEnvironment): Readonly<NativeObject> | null {
  return pinnedEntry(env, ELIGIBILITY_CONDITIONS_SETTING);
}
function pinnedEntry(env: RuntimeEnvironment, name: string): Readonly<NativeObject> | null {
  const raw = env.get(name);
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const v = parseNativeJson(raw) as NativeObject;
    if (
      !v || typeof v !== "object" || Array.isArray(v) ||
      Object.keys(v).sort().join() !== "bucket,bytes,object_key,sha256,version" ||
      typeof v.bucket !== "string" || typeof v.object_key !== "string" ||
      typeof v.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(v.sha256) ||
      typeof v.version !== "string" || !v.version ||
      !(typeof v.bytes === "number" && Number.isSafeInteger(v.bytes) && v.bytes > 0)
    ) return null;
    return Object.freeze({ ...v });
  } catch {
    return null;
  }
}

/** 서버의 JSON 읽기는 소수(37.5 등)를 JsonFloat로 준다. 정수는 number다 */
function weight(raw: unknown): number {
  const v = raw instanceof JsonFloat ? Number(raw.lexeme) : raw;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1000) {
    throw new Error("school_reflected_allowlist_invalid");
  }
  return v;
}
/** 검증된 파일 내용을 규칙 지도로 바꾼다. 하나라도 틀리면 전체를 버린다 */
export function parseSchoolReflectedAllowlist(
  payload: Readonly<NativeObject>,
  version: string,
): ReadonlyMap<string, ReflectedReferenceRule> {
  if (
    payload.format !== FORMAT || payload.academic_year !== 2027 || payload.version !== version ||
    !Array.isArray(payload.rows) || !payload.rows.length || payload.rows.length > MAX_ROWS
  ) throw new Error("school_reflected_allowlist_invalid");
  const out = new Map<string, ReflectedReferenceRule>();
  for (const row of payload.rows) {
    if (!Array.isArray(row) || row.length !== 6) {
      throw new Error("school_reflected_allowlist_invalid");
    }
    const [pk, k, m, i, mode, note] = row as unknown[];
    if (
      typeof pk !== "string" || !PK.test(pk) || out.has(pk) || typeof mode !== "string" ||
      !Object.hasOwn(MODES, mode) || (note !== 0 && note !== 1)
    ) throw new Error("school_reflected_allowlist_invalid");
    out.set(
      pk,
      Object.freeze({
        offeringId: pk,
        korean: weight(k),
        math: weight(m),
        inquiry: weight(i),
        inquiryMode: MODES[mode],
        eligibilityNote: note === 1,
      }),
    );
  }
  return out;
}

const ELIGIBILITY_FORMAT = "jungsi.eligibility-conditions/v1";
const AREAS = new Set(["국어", "수학", "영어", "탐구", "한국사", "제2외국어/한문"]);
const MATH = new Set(["확률과통계", "미적분", "기하"]);
const DOMAINS = new Set(["사회", "과학", "직업"]);
function names(v: unknown, allowed: ReadonlySet<string>, empty: boolean): readonly string[] | null {
  if (v === null) return null;
  if (
    !Array.isArray(v) || (!empty && !v.length) || v.length > 8 ||
    v.some((x) => typeof x !== "string" || !allowed.has(x)) || new Set(v).size !== v.length
  ) throw new Error("eligibility_conditions_invalid");
  return Object.freeze([...v as string[]]);
}
function note(v: unknown, notes: readonly string[]): string | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v >= notes.length) {
    throw new Error("eligibility_conditions_invalid");
  }
  return notes[v];
}
/** 검증된 파일 내용을 모집행 PK별 조건으로 바꾼다. 하나라도 틀리면 전체를 버린다 */
export function parseEligibilityConditions(
  payload: Readonly<NativeObject>,
  version: string,
): ReadonlyMap<string, EligibilityConditions> {
  const notes = payload.notes;
  if (
    payload.format !== ELIGIBILITY_FORMAT || payload.academic_year !== 2027 ||
    payload.version !== version || !Array.isArray(notes) || notes.length > MAX_ROWS ||
    notes.some((n) => typeof n !== "string" || !n || n.length > 300) ||
    !Array.isArray(payload.rows) || !payload.rows.length || payload.rows.length > MAX_ROWS
  ) throw new Error("eligibility_conditions_invalid");
  const text = notes as string[];
  const out = new Map<string, EligibilityConditions>();
  for (const row of payload.rows) {
    if (!Array.isArray(row) || row.length !== 6) throw new Error("eligibility_conditions_invalid");
    const [pk, areas, math, mathNote, domains, inquiryNote] = row as unknown[];
    if (typeof pk !== "string" || !PK.test(pk) || out.has(pk)) {
      throw new Error("eligibility_conditions_invalid");
    }
    out.set(
      pk,
      Object.freeze({
        requiredAreas: names(areas, AREAS, true),
        mathChoices: names(math, MATH, false),
        mathNote: note(mathNote, text),
        inquiryDomains: names(domains, DOMAINS, false),
        inquiryNote: note(inquiryNote, text),
      }),
    );
  }
  return out;
}

const eligibilityCache = new Map<string, Promise<ReadonlyMap<string, EligibilityConditions>>>();

export class StorageEligibilityConditions implements EligibilityConditionsPort {
  constructor(
    private readonly entry: Readonly<NativeObject> | null,
    private readonly client: () => Promise<SupabaseArtifactClient>,
  ) {}
  async conditions(): Promise<ReadonlyMap<string, EligibilityConditions> | null> {
    const entry = this.entry;
    if (!entry) return null;
    const key = entry.sha256 as string;
    let pending = eligibilityCache.get(key);
    if (!pending) {
      pending = (async () => {
        const artifact = await (await this.client()).pinnedArtifact(entry);
        return parseEligibilityConditions(artifact.payload, entry.version as string);
      })();
      eligibilityCache.set(key, pending);
      pending.catch(() => eligibilityCache.delete(key));
    }
    try {
      return await pending;
    } catch {
      return null;
    }
  }
}

const YEAR_CUTOFFS_FORMAT = "jungsi.year-cutoff-references/v1";
const OBSERVATION = /^(?:observation|admission):[a-f0-9]{64}$/;
const PERCENT = /^(?:100(?:\.0+)?|[0-9]{1,2}(?:\.[0-9]{1,6})?)$/;
/**
 * 검증된 파일 내용을 2027 모집행 PK별 학년도 합격선 목록으로 바꾼다. 하나라도 틀리면 전체를 버린다.
 * 행: [2027 PK, [[학년도, 관측값 ID, 발표 지표 번호, 합격선 누적 백분위 문자열], ...]](한 모집행 최대 24개:
 * 학년도 3개 × 발표 지표 여러 개, 담당자 R9 명부 v5 최대 19개)
 */
export function parseYearCutoffs(
  payload: Readonly<NativeObject>,
  version: string,
): ReadonlyMap<string, readonly YearCutoff[]> {
  const labels = payload.metrics;
  if (
    payload.format !== YEAR_CUTOFFS_FORMAT || payload.academic_year !== 2027 ||
    payload.version !== version || !Array.isArray(labels) || !labels.length ||
    labels.length > 200 || labels.some((n) => typeof n !== "string" || !n || n.length > 60) ||
    !Array.isArray(payload.rows) || !payload.rows.length || payload.rows.length > MAX_ROWS
  ) throw new Error("year_cutoffs_invalid");
  const text = labels as string[];
  const out = new Map<string, readonly YearCutoff[]>();
  for (const row of payload.rows) {
    if (!Array.isArray(row) || row.length !== 2) throw new Error("year_cutoffs_invalid");
    const [pk, items] = row as unknown[];
    if (
      typeof pk !== "string" || !PK.test(pk) || out.has(pk) || !Array.isArray(items) ||
      !items.length || items.length > 24
    ) throw new Error("year_cutoffs_invalid");
    const seen = new Set<string>();
    const list: YearCutoff[] = [];
    for (const item of items) {
      if (!Array.isArray(item) || item.length !== 4) throw new Error("year_cutoffs_invalid");
      const [year, observation, label, value] = item as unknown[];
      if (
        typeof year !== "number" || ![2024, 2025, 2026].includes(year) ||
        typeof observation !== "string" || !OBSERVATION.test(observation) ||
        seen.has(observation) ||
        typeof label !== "number" || !Number.isSafeInteger(label) || label < 0 ||
        label >= text.length || typeof value !== "string" || !PERCENT.test(value)
      ) throw new Error("year_cutoffs_invalid");
      seen.add(observation);
      list.push(Object.freeze({
        academicYear: year,
        observationId: observation,
        publishedMetric: text[label],
        cutoffTopPercent: value,
      }));
    }
    list.sort((a, b) => b.academicYear - a.academicYear);
    out.set(pk, Object.freeze(list));
  }
  return out;
}

const yearCache = new Map<string, Promise<ReadonlyMap<string, readonly YearCutoff[]>>>();

export class StorageYearCutoffs implements YearCutoffsPort {
  constructor(
    private readonly entry: Readonly<NativeObject> | null,
    private readonly client: () => Promise<SupabaseArtifactClient>,
  ) {}
  async cutoffs(): Promise<ReadonlyMap<string, readonly YearCutoff[]> | null> {
    const entry = this.entry;
    if (!entry) return null;
    const key = entry.sha256 as string;
    let pending = yearCache.get(key);
    if (!pending) {
      pending = (async () => {
        const artifact = await (await this.client()).pinnedArtifact(entry);
        return parseYearCutoffs(artifact.payload, entry.version as string);
      })();
      yearCache.set(key, pending);
      pending.catch(() => yearCache.delete(key));
    }
    try {
      return await pending;
    } catch {
      return null;
    }
  }
}

/** 격리 실행 단위(isolate) 안에서 같은 지문의 목록은 한 번만 읽는다 */
const cache = new Map<string, Promise<ReadonlyMap<string, ReflectedReferenceRule>>>();

export class StorageSchoolReflectedRules implements SchoolReflectedRulesPort {
  constructor(
    private readonly entry: Readonly<NativeObject> | null,
    private readonly client: () => Promise<SupabaseArtifactClient>,
  ) {}
  async rules(): Promise<ReadonlyMap<string, ReflectedReferenceRule> | null> {
    const entry = this.entry;
    if (!entry) return null;
    const key = entry.sha256 as string;
    let pending = cache.get(key);
    if (!pending) {
      pending = (async () => {
        const artifact = await (await this.client()).pinnedArtifact(entry);
        return parseSchoolReflectedAllowlist(artifact.payload, entry.version as string);
      })();
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
    }
    try {
      return await pending;
    } catch {
      return null;
    }
  }
}
