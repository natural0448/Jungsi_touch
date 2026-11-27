/**
 * 수능 가채점 과목별 예상 성적 미리보기(대표님 결정 2026-11-20, 담당자 v50 정정 v2).
 * - 학생이 넣은 선택과목·원점수로 과목별 예상 표준점수·백분위·등급 '범위'만 보여 준다. 저장하지 않고 입력권도 쓰지 않는다.
 * - 변환표(jungsi.csat-provisional-raw-conversion/v1)는 담당자 비공개 자료라 저장소·브라우저에 넣지 않고 화면 서버 KV(PREVIEW_KEY)에만 둔다.
 *   읽을 때 바이트 지문·시험·판·앵커 지문을 아래 고정값과 대조하고, 하나라도 다르면 쓰지 않는다.
 * - 원점수가 낮아 근거가 부족한 행(담당자 167행)은 표준점수·백분위 없이 등급 범위만 돌려준다.
 * - 계산 규칙은 담당자 참조 코드 A3_v50_subject_score_preview.review.v1.ts 와 같다.
 */
export const PREVIEW_KEY = "csat-provisional-conversion:v1";
export const PREVIEW_PIN = {
  examId: "2027-csat-provisional",
  version: "20261120.csat-provisional-raw-conversion.review.v1",
  sha256: "ac70faeb689398a4ca80ada353ae423e62f4e66df25acbad181f32ff465a4faf",
  anchorSha256: "7288bb2d0b4455cf4aef21e1975cd3adc297348561745618829e8368f3d9203a",
} as const;

export type Range = { low: number; high: number };
export type StandardRange = Range & { central: number };
export type RelativeArea = "korean" | "math" | "inquiry";
export type AbsoluteArea = "english" | "korean_history" | "second_foreign_language_or_classical_chinese";
export type PreviewInput = { area: RelativeArea; choice: string; raw: number } | { area: AbsoluteArea; raw: number };
export type PreviewResult = { standard: StandardRange | null; percentile: Range | null; grade: Range };
type Row = { raw: number; standard: StandardRange | null; percentile: Range | null; grade: Range };
type Conversion = {
  format: string;
  exam_id: string;
  academic_year: number;
  version: string;
  anchor_pack_sha256: string;
  subjects: Record<string, { area: RelativeArea; choice?: string; raw_max: number; rows: Row[] }>;
  absolute: Partial<Record<AbsoluteArea, { raw_min: number; grade: number }[]>>;
};
export type Converter = (input: PreviewInput) => PreviewResult;

export class PreviewError extends Error {}
const need = (ok: unknown, code: string) => { if (!ok) throw new PreviewError(code); };
const intIn = (v: unknown, lo: number, hi: number): v is number => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;
const rangeIn = (v: Range | null | undefined, lo: number, hi: number): v is Range => !!v && intIn(v.low, lo, hi) && intIn(v.high, v.low, hi);

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** 바이트를 고정값과 대조하고 변환 함수를 돌려준다. pin 은 시험용으로만 바꾼다 */
export async function loadConverter(bytes: Uint8Array, pin: { examId: string; version: string; sha256: string; anchorSha256: string } = PREVIEW_PIN): Promise<Converter> {
  need(hex(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))) === pin.sha256, "preview_digest_mismatch");
  const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Conversion;
  need(
    data.format === "jungsi.csat-provisional-raw-conversion/v1" && data.exam_id === pin.examId && data.academic_year === 2027 &&
      data.version === pin.version && data.anchor_pack_sha256 === pin.anchorSha256,
    "preview_artifact_mismatch",
  );
  return (input) => {
    if ("choice" in input) {
      const max = input.area === "inquiry" ? 50 : 100;
      need(Object.hasOwn(data.subjects, input.choice), "preview_subject_invalid");
      const s = data.subjects[input.choice];
      need(s.area === input.area && s.raw_max === max && intIn(input.raw, 0, max), "preview_raw_invalid");
      const row = s.rows[input.raw];
      need(row?.raw === input.raw && rangeIn(row.grade, 1, 9), "preview_row_invalid");
      const grade = { low: row.grade.low, high: row.grade.high };
      if (row.standard === null && row.percentile === null) return { standard: null, percentile: null, grade };
      need(rangeIn(row.standard, 0, 500) && intIn(row.standard!.central, row.standard!.low, row.standard!.high) && rangeIn(row.percentile, 0, 100), "preview_row_invalid");
      return { standard: { low: row.standard!.low, central: row.standard!.central, high: row.standard!.high }, percentile: { low: row.percentile!.low, high: row.percentile!.high }, grade };
    }
    const max = input.area === "english" ? 100 : 50;
    const cuts = data.absolute[input.area];
    need(Array.isArray(cuts) && intIn(input.raw, 0, max), "preview_raw_invalid");
    const g = cuts!.find((r) => input.raw >= r.raw_min)?.grade;
    need(intIn(g, 1, 9), "preview_grade_invalid");
    return { standard: null, percentile: null, grade: { low: g!, high: g! } };
  };
}

let cached: { at: number; conv: Converter } | null = null;
const TTL_MS = 10 * 60_000;

/** 화면 서버 KV 에서 변환표를 읽는다. 없거나 지문이 다르면 null(미리보기를 열지 않는다) */
export async function previewConverter(): Promise<Converter | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.conv;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = (await getCloudflareContext({ async: true })).env as Record<string, unknown>;
    const kv = env.JT_SHARED_CACHE as { get(k: string, t: "arrayBuffer"): Promise<ArrayBuffer | null> } | undefined;
    if (!kv || typeof kv.get !== "function") return null;
    const buf = await kv.get(PREVIEW_KEY, "arrayBuffer");
    if (!buf) return null;
    const conv = await loadConverter(new Uint8Array(buf));
    cached = { at: Date.now(), conv };
    return conv;
  } catch {
    return null;
  }
}
