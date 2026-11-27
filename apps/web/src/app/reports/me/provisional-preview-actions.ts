"use server";

import { getCaller, sessionOrDown, source } from "@/lib/api";
import { isFreeProvisional } from "@/lib/free-provisional";
import { INQUIRY_SUBJECTS, KOREAN_CHOICES, MATH_CHOICES, SECOND_LANGUAGE_SUBJECTS } from "@/lib/exam";
import { PreviewError, previewConverter, type PreviewResult } from "@/lib/provisional-preview";

/** 미리보기 한 줄. 저장하지 않는다 */
export type PreviewLine = { label: string; raw: number; max: number; result: PreviewResult };
export type PreviewState = { ok: true; lines: PreviewLine[] } | { ok: false; message: string; values?: Record<string, string> } | null;

const INQ = new Set(INQUIRY_SUBJECTS.flatMap((g) => g.subjects));
const intOf = (v: FormDataEntryValue | null, max: number): number | null => {
  const s = String(v ?? "").trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n <= max ? n : null;
};

/**
 * 수능 가채점 과목별 예상 성적 조회(대표님 결정 2026-11-20). 성적을 저장하지 않고 입력권도 쓰지 않는다.
 * 2페이지와 같은 규칙으로 유료 회원만 쓴다. 변환표는 화면 서버 KV 에서만 읽는다.
 */
export async function previewProvisional(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  const values = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
  const caller = await getCaller();
  const { session, down } = await sessionOrDown(source(), caller);
  if (down || (session?.member_tier !== "paid" && !isFreeProvisional(session))) return { ok: false, message: "이용권 회원으로 로그인한 뒤 다시 시도해 주세요.", values };

  const kc = String(fd.get("korean_choice") ?? ""), mc = String(fd.get("math_choice") ?? "");
  const i1 = String(fd.get("inq1") ?? ""), i2 = String(fd.get("inq2") ?? ""), sl = String(fd.get("sl_subject") ?? "");
  const korean = intOf(fd.get("korean"), 100), math = intOf(fd.get("math"), 100), english = intOf(fd.get("english"), 100);
  const history = intOf(fd.get("history"), 50), r1 = intOf(fd.get("inq1_raw"), 50), r2 = intOf(fd.get("inq2_raw"), 50);
  const slRaw = sl ? intOf(fd.get("sl_raw"), 50) : null;

  if (!(KOREAN_CHOICES as readonly string[]).includes(kc) || !(MATH_CHOICES as readonly string[]).includes(mc))
    return { ok: false, message: "국어·수학 선택과목을 골라 주세요. 선택과목마다 예상 점수가 다릅니다.", values };
  if (!INQ.has(i1) || !INQ.has(i2) || i1 === i2) return { ok: false, message: "탐구 두 과목을 서로 다르게 골라 주세요.", values };
  if (sl && !(SECOND_LANGUAGE_SUBJECTS as readonly string[]).includes(sl)) return { ok: false, message: "제2외국어/한문 과목을 다시 골라 주세요.", values };
  if ([korean, math, english].some((v) => v === null)) return { ok: false, message: "국어·수학·영어 원점수는 0~100 사이 정수입니다.", values };
  if ([history, r1, r2].some((v) => v === null)) return { ok: false, message: "한국사·탐구 원점수는 0~50 사이 정수입니다.", values };
  if (sl && slRaw === null) return { ok: false, message: "제2외국어/한문 원점수를 0~50 사이로 넣어 주세요. 보지 않았으면 '미응시'로 두세요.", values };

  const conv = await previewConverter();
  if (!conv) return { ok: false, message: "예상 성적 자료를 준비하고 있습니다. 잠시 뒤 다시 시도해 주세요.", values };
  try {
    const lines: PreviewLine[] = [
      { label: `국어 (${kc})`, raw: korean!, max: 100, result: conv({ area: "korean", choice: kc, raw: korean! }) },
      { label: `수학 (${mc})`, raw: math!, max: 100, result: conv({ area: "math", choice: mc, raw: math! }) },
      { label: "영어", raw: english!, max: 100, result: conv({ area: "english", raw: english! }) },
      { label: "한국사", raw: history!, max: 50, result: conv({ area: "korean_history", raw: history! }) },
      { label: `탐구 1 · ${i1}`, raw: r1!, max: 50, result: conv({ area: "inquiry", choice: i1, raw: r1! }) },
      { label: `탐구 2 · ${i2}`, raw: r2!, max: 50, result: conv({ area: "inquiry", choice: i2, raw: r2! }) },
    ];
    if (sl) lines.push({ label: `제2외국어/한문 · ${sl}`, raw: slRaw!, max: 50, result: conv({ area: "second_foreign_language_or_classical_chinese", raw: slRaw! }) });
    return { ok: true, lines };
  } catch (e) {
    if (e instanceof PreviewError) return { ok: false, message: "이 과목·점수는 예상 성적 자료에 없습니다. 입력을 확인해 주세요.", values };
    throw e;
  }
}
