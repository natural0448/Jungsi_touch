"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import type { ScoresInput } from "@/lib/dto";
import { EXAM } from "@/lib/exam";
import { setReportId } from "@/lib/report-ref";

import type { ScoreDefaults } from "./score-form";

/** 실패하면 넣었던 값을 돌려준다. 양식은 이 값으로 다시 그려져 다시 치지 않아도 된다 */
export type ScoreFormState = { error: string; field?: string; values: ScoreDefaults; attempt: number } | null;

/** 서버 오류 코드 → 고칠 방법을 알려 주는 문장 */
const MESSAGE: Record<string, string> = {
  engine_input_code: "점수 범위를 확인해 주세요. 국어·수학 표준점수는 40~160, 탐구는 20~80, 등급은 1~9입니다.",
  invalid_request: "입력 칸을 다시 확인해 주세요.",
  invalid_choice: "선택과목을 목록에서 골라 주세요.",
  invalid_subject: "탐구 과목을 목록에서 골라 주세요.",
  duplicate_inquiry: "탐구 두 과목은 서로 달라야 합니다.",
  pack_version_mismatch: "시험 자료가 새로 바뀌었습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.",
  revision_conflict: "다른 화면에서 리포트가 먼저 바뀌었습니다. 새로 고친 뒤 다시 저장해 주세요.",
  profile_not_found: "성적을 다시 저장해 주세요.",
  report_not_found: "리포트를 찾지 못했습니다. 성적을 새로 입력해 주세요.",
};

const int = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? undefined : Number(v);
};

/**
 * 성적 저장: score-profile.create(확인한 성적) → overall.analyze(새 리포트 또는 같은 리포트의 새 revision).
 * 같은 화면에서 두 번 눌러도 같은 요청 키(idem)를 써서 한 번만 저장된다.
 */
export async function submitScores(prev: ScoreFormState, fd: FormData): Promise<ScoreFormState> {
  const values: ScoreDefaults = {
    korean_choice: String(fd.get("korean_choice") ?? "") || undefined,
    korean: int(fd, "korean"),
    math_choice: String(fd.get("math_choice") ?? "") || undefined,
    math: int(fd, "math"),
    inq1: String(fd.get("inq1") ?? "") || undefined,
    inq1_score: int(fd, "inq1_score"),
    inq2: String(fd.get("inq2") ?? "") || undefined,
    inq2_score: int(fd, "inq2_score"),
    english: int(fd, "english"),
    history: int(fd, "history"),
  };
  const fail = (error: string, field?: string): ScoreFormState => ({ error, field, values, attempt: (prev?.attempt ?? 0) + 1 });
  const ks = int(fd, "korean"), ms = int(fd, "math"), i1 = int(fd, "inq1_score"), i2 = int(fd, "inq2_score");
  const s1 = String(fd.get("inq1") ?? ""), s2 = String(fd.get("inq2") ?? "");
  if ([ks, ms, i1, i2].some((v) => v === undefined || Number.isNaN(v)) || !s1 || !s2) return fail("국어·수학·탐구 두 과목의 표준점수를 모두 넣어 주세요.");
  if (fd.get("confirm") !== "on") return fail("입력한 성적이 성적표와 같은지 확인하고 체크해 주세요.", "confirm");

  const scores: ScoresInput = {
    exam_id: EXAM.exam_id,
    pack_version: EXAM.pack_version,
    korean: { standard_score: ks!, ...(fd.get("korean_choice") ? { choice: String(fd.get("korean_choice")) } : {}) },
    math: { standard_score: ms!, ...(fd.get("math_choice") ? { choice: String(fd.get("math_choice")) } : {}) },
    inquiry: [
      { subject: s1, standard_score: i1! },
      { subject: s2, standard_score: i2! },
    ],
    ...(int(fd, "english") !== undefined ? { english_grade: int(fd, "english") } : {}),
    ...(int(fd, "history") !== undefined ? { korean_history_grade: int(fd, "history") } : {}),
  };
  const key = String(fd.get("idem") ?? "");
  const reportId = String(fd.get("report_id") ?? "") || undefined;
  const version = int(fd, "report_version");

  const caller = await getCaller();
  const src = source();
  try {
    const profile = await src.createScoreProfile(caller, scores, true, `${key}:profile`);
    if (!profile.ok) return fail(MESSAGE[profile.code] ?? "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    const report = await src.analyzeOverall(caller, { profile_id: profile.value.profile_id, ...(reportId ? { report_id: reportId, expected_version: version } : {}) }, `${key}:report`);
    if (!report.ok) return fail(MESSAGE[report.code] ?? "리포트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    await setReportId(report.value.report_id);
  } catch (e) {
    if (e instanceof AccessDenied) return fail("로그인이 필요합니다. 다시 로그인한 뒤 저장해 주세요.");
    if (e instanceof ConnectionError) return fail("정시터치 서버에 연결할 수 없어 저장하지 못했습니다. 잠시 뒤 다시 저장해 주세요.");
    throw e;
  }
  // 자바스크립트 없이 보낸 양식은 basePath 가 붙지 않은 주소로 돌아가므로 직접 붙인다
  const viaJs = (await headers()).has("next-action");
  redirect(viaJs ? "/reports/me" : "/jeongsi/reports/me");
}
