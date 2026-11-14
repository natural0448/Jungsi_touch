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
import type { SchoolReflectedRulesPort } from "../application/school_reflected_projection.ts";
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

/** 비밀 설정 하나를 읽어 검증한다. 틀리면 null(기능 꺼짐) */
export function schoolReflectedEntry(env: RuntimeEnvironment): Readonly<NativeObject> | null {
  const raw = env.get(SCHOOL_REFLECTED_SETTING);
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
