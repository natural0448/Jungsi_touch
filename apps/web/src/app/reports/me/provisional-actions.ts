"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { csatReleaseOn } from "@/lib/correction";
import { correctionInputClosed } from "@/lib/csat-release";
import { CSAT_EXAM, csatOpen, csatOpensAt } from "@/lib/exam";
import { seoulDateTime, seoulTime } from "@/lib/format";
import { buildProvisionalScores, type ProvisionalValues } from "@/lib/provisional-report";

export type { ProvisionalValues };
export type ProvisionalFormState = { error: string; values: ProvisionalValues; attempt: number } | null;

const int = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? undefined : Number(v);
};

/** 서버 오류 코드 → 고칠 방법을 알려 주는 문장 */
const MESSAGE: Record<string, string> = {
  invalid_request: "입력 칸을 다시 확인해 주세요.",
  invalid_choice: "국어·수학 선택과목을 목록에서 골라 주세요.",
  invalid_subject: "탐구 과목을 목록에서 골라 주세요.",
  invalid_inquiry: "탐구 과목을 목록에서 골라 주세요.",
  invalid_score: "원점수 범위를 확인해 주세요. 국어·수학·영어는 0~100, 한국사·탐구·제2외국어/한문은 0~50입니다.",
  invalid_integer: "원점수는 정수로 넣어 주세요.",
  invalid_second_language: "제2외국어/한문 과목과 원점수(0~50)를 확인해 주세요. 보지 않았으면 과목을 '미응시'로 두세요.",
  duplicate_inquiry: "탐구 두 과목은 서로 달라야 합니다.",
  pack_version_mismatch: "시험 자료가 새로 바뀌었습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.",
  revision_conflict: "다른 화면에서 리포트가 먼저 바뀌었습니다. 새로 고친 뒤 다시 저장해 주세요.",
  score_input_exhausted: "수능 가채점 성적 입력 횟수를 모두 사용했습니다. 저장한 리포트는 그대로 볼 수 있고, 정정은 이 화면에서 한 번 요청할 수 있습니다.",
  score_stage_closed: "지금은 수능 가채점 성적을 입력할 수 있는 기간이 아닙니다. 입력 횟수는 쓰이지 않았습니다.",
  score_input_transition_pending: "성적 입력 기록을 새 기준으로 옮기는 중이라 지금은 저장할 수 없습니다. 입력 횟수는 쓰이지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
  paid_required: "성적 입력은 이용권 회원만 할 수 있습니다.",
};

const partial = (code: string) =>
  `가채점 성적은 저장됐지만 예상 위치 계산을 끝내지 못했습니다. 같은 성적을 다시 저장하지 말고 잠시 뒤 이 화면을 다시 열어 주세요. (문의 번호 ${code})`;

/**
 * 수능 가채점 저장(2026-11-12 최종관리자 결정: 원점수 입력, 2026-11-21 대표님 확정: 11-23 0시 전환).
 * score-profile.create(stage provisional, 원점수) → overall.analyze. 가채점과 실채점은 입력 횟수를 따로 센다(서버 단계별 입력권).
 * 같은 화면에서 두 번 눌러도 같은 요청 키(idem)라 한 번만 저장된다.
 */
export async function submitProvisional(prev: ProvisionalFormState, fd: FormData): Promise<ProvisionalFormState> {
  const values: ProvisionalValues = {
    korean_choice: String(fd.get("korean_choice") ?? "") || undefined,
    korean: int(fd, "korean"),
    math_choice: String(fd.get("math_choice") ?? "") || undefined,
    math: int(fd, "math"),
    inq1: String(fd.get("inq1") ?? "") || undefined,
    inq1_raw: int(fd, "inq1_raw"),
    inq2: String(fd.get("inq2") ?? "") || undefined,
    inq2_raw: int(fd, "inq2_raw"),
    english: int(fd, "english"),
    history: int(fd, "history"),
    sl_subject: String(fd.get("sl_subject") ?? "") || undefined,
    sl_raw: int(fd, "sl_raw"),
  };
  const fail = (error: string): ProvisionalFormState => ({ error, values, attempt: (prev?.attempt ?? 0) + 1 });
  // 전환 전에 열려 있던 화면에서 보내도 서버로 보내지 않는다(입력 횟수를 쓰지 않는다)
  if (!csatOpen()) return fail(`수능 가채점 입력은 ${seoulDateTime(csatOpensAt().toISOString())}부터 열립니다. 지금은 저장하지 않았고 입력 횟수도 쓰이지 않았습니다.`);
  const built = buildProvisionalScores(values, CSAT_EXAM);
  if (!built.ok) return fail(built.error);
  if (fd.get("confirm") !== "on") return fail("저장 전 확인 창에서 입력값을 확인하고 '이대로 저장'을 눌러 주세요.");
  const key = String(fd.get("idem") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(key)) return fail("화면을 새로 고친 뒤 다시 저장해 주세요.");
  const reportId = String(fd.get("report_id") ?? "") || undefined;
  const version = int(fd, "report_version");

  const caller = await getCaller();
  const src = source();
  // 수능 성적표 배부일이 지나면 승인받은 가채점 정정도 저장하지 않는다(2026-10-29 사용자 결정, 본체 관리자 설정)
  const st = await src.readScoreInputStatus(caller, CSAT_EXAM.exam_id).catch(() => null);
  if (st?.stage === "provisional" && correctionInputClosed(st, await csatReleaseOn(st.academic_year)))
    return fail("수능 성적표가 배부되어 가채점 정정 입력 기간이 끝났습니다. 실채점 성적은 실채점 단계에서 입력해 주세요.");
  let step = "성적 저장";
  try {
    const profile = await src.createScoreProfile(caller, built.scores, true, `${key}:profile`, "provisional");
    if (!profile.ok) return fail(MESSAGE[profile.code] ?? `저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요. (문의 번호 ${profile.code})`);
    step = "예상 위치 계산";
    const report = await src.analyzeOverall(caller, { profile_id: profile.value.profile_id, ...(reportId ? { report_id: reportId, expected_version: version } : {}) }, `${key}:report`);
    if (!report.ok) return fail(partial(report.code));
  } catch (e) {
    if (step !== "성적 저장" && (e instanceof AccessDenied || e instanceof ConnectionError)) return fail(partial(e.code));
    if (e instanceof AccessDenied) return fail("로그인이 필요합니다. 다시 로그인한 뒤 저장해 주세요.");
    if (e instanceof ConnectionError)
      return fail(
        e.kind === "rate_limited"
          ? `같은 계정의 요청이 겹쳐 잠시 제한되었습니다. 보통 몇 초 뒤 다시 저장하면 됩니다. 입력한 값은 그대로 남아 있습니다.${e.retryAt ? ` (늦어도 ${seoulTime(e.retryAt.toISOString())} 이후)` : ""}`
          : `정시터치 서버에 연결할 수 없어 저장하지 못했습니다. 잠시 뒤 다시 저장해 주세요. (${step} 단계 · 문의 번호 ${e.code})`,
      );
    throw e;
  }
  // 자바스크립트 없이 보낸 양식은 basePath 가 붙지 않은 주소로 돌아가므로 직접 붙인다
  const viaJs = (await headers()).has("next-action");
  redirect(viaJs ? "/reports/me" : "/jeongsi/reports/me");
}
