"use server";

import { seoulTime } from "@/lib/format";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import type { ScoresInput } from "@/lib/dto";
import { csatReleaseOn } from "@/lib/correction";
import { correctionInputClosed } from "@/lib/csat-release";
import { EXAM, csatOpen } from "@/lib/exam";
import { checkSecondLanguage } from "@/lib/second-language";

import type { ScoreDefaults } from "./score-form";

/** 실패하면 넣었던 값을 돌려준다. 양식은 이 값으로 다시 그려져 다시 치지 않아도 된다 */
export type ScoreFormState = { error: string; field?: string; values: ScoreDefaults; attempt: number } | null;

/** 서버 오류 코드 → 고칠 방법을 알려 주는 문장 */
const MESSAGE: Record<string, string> = {
  // 시험 공식 분포표에 없는 표준점수(422). 성적표를 옮겨 적다 틀린 경우가 대부분이다
  unobserved_standard_score: "이 시험 성적표에 나올 수 없는 표준점수가 있습니다. 국어·수학·탐구 표준점수를 성적표와 다시 대조해 주세요.",
  engine_input_code:"점수 범위를 확인해 주세요. 국어·수학 표준점수는 40~160, 탐구는 20~80, 등급은 1~9입니다.",
  invalid_request: "입력 칸을 다시 확인해 주세요.",
  invalid_choice: "선택과목을 목록에서 골라 주세요.",
  invalid_subject: "탐구 과목을 목록에서 골라 주세요.",
  invalid_second_language: "제2외국어/한문 과목과 등급(1~9)을 목록에서 골라 주세요. 응시하지 않았으면 '미응시'를 골라 주세요.",
  duplicate_inquiry: "탐구 두 과목은 서로 달라야 합니다.",
  pack_version_mismatch: "시험 자료가 새로 바뀌었습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.",
  revision_conflict: "다른 화면에서 리포트가 먼저 바뀌었습니다. 새로 고친 뒤 다시 저장해 주세요.",
  profile_not_found: "성적을 다시 저장해 주세요.",
  report_not_found: "리포트를 찾지 못했습니다. 성적을 새로 입력해 주세요.",
  score_input_exhausted: "이 시험 단계의 성적 입력 횟수를 모두 사용했습니다. 저장한 리포트는 그대로 볼 수 있고, 성적 정정은 고객센터에 요청해 주세요.",
  score_input_transition_pending: "성적 입력 기록을 새 기준으로 옮기는 중이라 지금은 저장할 수 없습니다. 입력 횟수는 쓰이지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
  paid_required: "성적 입력은 이용권 회원만 할 수 있습니다.",
};

/** 성적표에 없는 점수 등 정상 거절(입력 1회 소모)되는 코드 — 서버 SCORE_CONTENT_REJECTION_CODES 와 같다 */
const CONTENT_REJECTIONS = new Set([
  "unobserved_standard_score", "invalid_score", "invalid_integer", "invalid_grade",
  "invalid_reported_grade", "invalid_reported_percentile", "reported_grade_conflict", "reported_percentile_conflict",
]);


/** 성적 저장 뒤 전체 분석 단계에서 멈췄을 때. 공개 오류코드만 붙인다 */
const partial = (code: string) =>
  `성적은 저장됐지만 전체 분석을 완료하지 못했습니다. 같은 성적을 다시 저장하지 말고 잠시 뒤 이 화면을 다시 열어 주세요. (전체 분석 단계 · 문의 번호 ${code})`;

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
    sl_subject: String(fd.get("sl_subject") ?? "") || undefined,
    sl_grade: int(fd, "sl_grade"),
  };
  const fail = (error: string, field?: string): ScoreFormState => ({ error, field, values, attempt: (prev?.attempt ?? 0) + 1 });
  // 2026-11-23 0시 수능 가채점 전환 뒤에는 9월 모의평가 표준점수를 받지 않는다(서버도 9월 단계를 닫는다). 전환 전에 열어 둔 화면에서 보내도
  // 서버로 보내지 않아 입력 횟수를 쓰지 않는다. 저장한 9월 리포트는 지난 기록에서 그대로 볼 수 있다
  if (csatOpen()) return fail("9월 모의평가 성적 입력은 수능 가채점 전환과 함께 끝났습니다. 화면을 새로 고치면 수능 가채점 원점수를 넣을 수 있습니다. 입력 횟수는 쓰이지 않았습니다.");
  const ks = int(fd, "korean"), ms = int(fd, "math"), i1 = int(fd, "inq1_score"), i2 = int(fd, "inq2_score");
  const s1 = String(fd.get("inq1") ?? ""), s2 = String(fd.get("inq2") ?? "");
  if ([ks, ms, i1, i2].some((v) => v === undefined || Number.isNaN(v)) || !s1 || !s2) return fail("국어·수학·탐구 두 과목의 표준점수를 모두 넣어 주세요.");
  // 제2외국어/한문 필수 선택(2026-11-22 대표님 결정). 미선택·과목만 고르고 등급 없음은 서버로 보내기 전에 막는다(입력 횟수를 쓰지 않는다)
  const sl = checkSecondLanguage(String(fd.get("sl_subject") ?? ""), int(fd, "sl_grade"), "grade");
  if (!sl.ok) return fail(sl.error, sl.field);
  if (fd.get("confirm") !== "on") return fail("저장 전 확인 창에서 입력값을 확인하고 '이대로 저장'을 눌러 주세요.", "confirm");

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
    // 제2외국어/한문: '미응시'를 직접 고른 경우만 null(서버의 미응시 표기)
    second_language: sl.taken ? { subject: sl.taken.subject, grade: sl.taken.value } : null,
  };
  const key = String(fd.get("idem") ?? "");
  const reportId = String(fd.get("report_id") ?? "") || undefined;
  const version = int(fd, "report_version");

  const caller = await getCaller();
  const src = source();
  // 수능 성적표 배부일이 지나면 승인받은 가채점 정정도 저장하지 않는다(2026-10-29 사용자 결정, 본체 관리자 설정)
  const release = await csatReleaseOn();
  if (release) {
    const st = await src.readScoreInputStatus(caller, EXAM.exam_id).catch(() => null);
    if (st?.stage === "provisional" && correctionInputClosed(st, await csatReleaseOn(st.academic_year)))
      return fail("수능 성적표가 배부되어 가채점 정정 입력 기간이 끝났습니다. 실채점 성적은 실채점 단계에서 입력해 주세요.");
  }
  // 어느 단계에서 멈췄는지(성적 저장 / 전체 분석). 성적만 저장된 부분 성공을 구분하려고 문구에 붙인다
  let step = "성적 저장";
  try {
    const profile = await src.createScoreProfile(caller, scores, true, `${key}:profile`);
    // 문장이 없는 코드는 사유 코드를 같이 보여 준다 — 담당자가 서버 기록과 맞춰 볼 수 있게
    if (!profile.ok) {
      // 정상 거절은 이 단계의 입력 1회를 쓴다. 남은 정정 횟수는 서버 상태를 다시 읽어 그대로 안내한다(추정하지 않는다)
      if (profile.status === 422 && CONTENT_REJECTIONS.has(profile.code)) {
        const st = await src.readScoreInputStatus(caller, EXAM.exam_id).catch(() => null);
        const left = st ? `남은 성적 정정 가능 횟수는 ${st.correction_request_remaining}회이며, 정정은 고객센터에 요청해 주세요.` : "정정은 고객센터에 요청해 주세요.";
        return fail(`실제 성적표의 표준점수를 입력하지 않아 정상적인 계산이 불가능합니다. ${left} (문의 번호 ${profile.code})`);
      }
      return fail(MESSAGE[profile.code] ?? `저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요. (문의 번호 ${profile.code})`);
    }
    step = "전체 분석";
    const report = await src.analyzeOverall(caller, { profile_id: profile.value.profile_id, ...(reportId ? { report_id: reportId, expected_version: version } : {}) }, `${key}:report`);
    // 새 리포트는 서버 입력 상태의 현재 리포트가 되므로 따로 기억하지 않는다(계정 기준, 2026-11-04 사용자 결정)
    if (!report.ok) return fail(partial(report.code));
  } catch (e) {
    // 성적은 저장됐고 분석만 못 한 경우: 어떤 실패든 같은 부분 성공 안내. 성적을 다시 저장하라고 하지 않는다
    // (다시 저장하면 새 성적 기록이 생기고 하루 한도를 쓴다). 자동 재시도·새 키도 만들지 않는다
    if (step === "전체 분석" && (e instanceof AccessDenied || e instanceof ConnectionError)) return fail(partial(e.code));
    if (e instanceof AccessDenied) return fail("로그인이 필요합니다. 다시 로그인한 뒤 저장해 주세요.");
    if (e instanceof ConnectionError)
      return fail(
        e.kind === "rate_limited" && e.code === "analysis_quota_exceeded"
          ? `오늘 분석할 수 있는 서로 다른 성적 조합을 모두 썼습니다. 이미 저장한 성적과 리포트는 그대로 볼 수 있습니다.${e.retryAt ? ` ${seoulTime(e.retryAt.toISOString())} 이후 다시 저장할 수 있습니다.` : ""}`
          : e.kind === "rate_limited"
          ? `같은 계정의 요청이 겹쳐 잠시 제한되었습니다. 보통 몇 초 뒤 다시 저장하면 됩니다. 입력한 값은 그대로 남아 있습니다.${e.retryAt ? ` (늦어도 ${seoulTime(e.retryAt.toISOString())} 이후)` : ""}`
          : `정시터치 서버에 연결할 수 없어 저장하지 못했습니다. 잠시 뒤 다시 저장해 주세요. (${step} 단계 · 문의 번호 ${e.code})`,
      );
    throw e;
  }
  // 자바스크립트 없이 보낸 양식은 basePath 가 붙지 않은 주소로 돌아가므로 직접 붙인다
  const viaJs = (await headers()).has("next-action");
  redirect(viaJs ? "/reports/me" : "/jeongsi/reports/me");
}
