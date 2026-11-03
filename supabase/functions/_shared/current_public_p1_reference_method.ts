/**
 * 로컬 검토용: 기존 method 원문과 호출자가 이미 고정한 자료판의 CDF 참조를 대조한다.
 * 이 함수는 release/head, DB 권한, 원관측 revision 또는 서비스 공개를 승인하지 않는다.
 * 원문과 CDF 경로·모형 내용은 반환하지 않는다.
 */
import { JsonFloat, parseNativeJson } from "./jungsi/domain/native_json.ts";

type Evidence = Readonly<{
  methodId: string;
  methodRowSha256: string;
  cdfSourceSha256: string;
  /** 누백 관측이 원래 속한 학년도와 학교코드다. 2027 대상 코드가 아니다. */
  academicYear: number;
  sourceSchoolId: string;
  /** 호출자가 같은 release의 고정된 manifest에서 제공한 assets 객체. */
  manifestAssets: unknown;
}>;

const HASH = /^[a-f0-9]{64}$/;
const METRIC = "estimated_upper_cumulative_percent_all_examinees";
const MISSING = Symbol("missing");

function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonFloat) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/** 외부 객체의 getter를 실행하지 않고 열거 가능한 자기 데이터 값만 복사한다. */
function ownValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable && "value" in descriptor ? descriptor.value : MISSING;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => ownValue(value, key) !== MISSING);
}

function positiveInteger(value: unknown): boolean {
  return typeof value === "bigint" ? value > 0n :
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * DB method_json TEXT의 한 줄 전체(끝 LF 포함)를 해시한다. 파싱은 CDF 자산값을
 * await 전에 복사하기 위해 먼저 수행하지만, 해시가 맞기 전에는 통과를 반환하지 않는다.
 * parser 오류는 이 method의 불일치로 처리한다. true는 공급된 고정 자료판에 대한
 * 원문·method·원래 학교/연도·CDF 참조의 일치만 의미한다. 호출자는 자료판·release와
 * 기존 승인 byte 예산을 따로 검증한다. 임의의 새 전역 입력 크기 한도는 만들지 않는다.
 */
export async function matchesOriginalMethodAndCdf(rawMethodText: unknown, evidence: Evidence): Promise<boolean> {
  if (typeof rawMethodText !== "string" || !rawMethodText.endsWith("\n") || !object(evidence)) return false;
  const expectedMethodId = ownValue(evidence, "methodId");
  const expectedMethodHash = ownValue(evidence, "methodRowSha256");
  const expectedCdfHash = ownValue(evidence, "cdfSourceSha256");
  const expectedYear = ownValue(evidence, "academicYear");
  const expectedSchool = ownValue(evidence, "sourceSchoolId");
  const assets = ownValue(evidence, "manifestAssets");
  if (typeof expectedMethodId !== "string" || !expectedMethodId ||
      typeof expectedMethodHash !== "string" || !HASH.test(expectedMethodHash) ||
      typeof expectedCdfHash !== "string" || !HASH.test(expectedCdfHash) ||
      typeof expectedYear !== "number" || ![2024, 2025, 2026, 2027].includes(expectedYear) ||
      typeof expectedSchool !== "string" || !expectedSchool || !object(assets)) return false;

  // JSONL 줄 안에는 리터럴 개행이 없고, 마지막 CRLF/LF 원문은 그대로 보존한다.
  const content = rawMethodText.slice(0, -1);
  const beforeOptionalCR = content.endsWith("\r") ? content.slice(0, -1) : content;
  if (beforeOptionalCR.includes("\r") || beforeOptionalCR.includes("\n")) return false;
  const bytes = new TextEncoder().encode(rawMethodText);
  if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== rawMethodText) return false;

  let parsed: ReturnType<typeof parseNativeJson>;
  try { parsed = parseNativeJson(rawMethodText); } catch { return false; }
  if (!object(parsed)) return false;
  const source = ownValue(parsed, "source_CDF");
  const meta = ownValue(parsed, "native_score_and_source_definition_metadata");
  if (!object(source) || !exactKeys(source, ["$asset_ref"]) || !object(meta)) return false;
  const assetId = ownValue(source, "$asset_ref");
  if (typeof assetId !== "string" || !assetId) return false;
  const asset = ownValue(assets, assetId);
  if (!object(asset)) return false;
  const file = ownValue(asset, "file_reference");
  if (!object(file) || !exactKeys(file, ["path", "bytes", "sha256"])) return false;

  // 모든 비교값은 첫 비동기 작업 전에 복사하며 이후 evidence/manifest를 다시 읽지 않는다.
  const snapshot = Object.freeze({
    expectedMethodId, expectedMethodHash, expectedCdfHash, expectedYear, expectedSchool,
    methodId: ownValue(parsed, "method_id"), metric: ownValue(parsed, "metric"),
    year: ownValue(meta, "academic_year"), school: ownValue(meta, "school_id"),
    path: ownValue(file, "path"), size: ownValue(file, "bytes"), cdfHash: ownValue(file, "sha256"),
  });
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return hash === snapshot.expectedMethodHash && snapshot.methodId === snapshot.expectedMethodId &&
    snapshot.metric === METRIC && snapshot.year === snapshot.expectedYear && snapshot.school === snapshot.expectedSchool &&
    typeof snapshot.path === "string" && snapshot.path.length > 0 && positiveInteger(snapshot.size) &&
    snapshot.cdfHash === snapshot.expectedCdfHash;
}
