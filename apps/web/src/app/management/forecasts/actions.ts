"use server";

import { redirect } from "next/navigation";
import { AccessDenied, ConnectionError, getCaller, source, type ForecastRevisionRef, type Result } from "@/lib/api";
import type { ForecastDraftDto, ForecastTarget } from "@/lib/dto";
import { MANAGEMENT_FORECASTS } from "@/lib/routes";

/*
  학과별 예상 기준 관리 작업(forecast.create·adjust·validate·approve·publish).
  - 요청 키(Idempotency-Key)는 화면을 그릴 때 정해 폼에 싣는다. 같은 폼의 재시도는 같은 키로 처음 결과를 받는다.
  - 상태·작성자·승인자·검증 통과 같은 값은 보내지 않는다. 서버가 정한다.
  - 거절(403·404·409·422)은 서버 코드 그대로 폼 아래에 보이고, 다음 제출에는 새 요청 키를 쓴다.
*/

export interface ForecastFormState {
  code: string | null;
  status: number | null;
  message: string | null;
  /** 거절된 요청은 그 키로 끝난다. 고쳐서 다시 보낼 때는 새 키를 쓴다(같은 키·다른 본문은 409). 연결 실패면 같은 키로 재시도 */
  key: string | null;
}

const MESSAGE: Record<number, string> = {
  401: "로그인이 필요합니다.",
  403: "이 작업을 할 관리 권한이 없거나 허용된 학교가 아닙니다.",
  404: "draft 를 찾을 수 없습니다. 허용 범위 밖의 draft 도 같은 안내가 나옵니다.",
  409: "다른 사람이 먼저 바꾸었거나 자료·정책 버전이 달라졌습니다. 화면을 새로 고친 뒤 다시 하세요.",
  413: "요청이 너무 큽니다.",
  422: "입력 형식이 맞지 않습니다. 값과 단위를 확인하세요.",
};

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function ref(fd: FormData): ForecastRevisionRef {
  return { expected_revision: Number(text(fd, "expected_revision")), base_result_hash: text(fd, "base_result_hash"), policy_version: text(fd, "policy_version") };
}

/** 대체값: 같은 단위로 명시한다. 범위는 아래<위, 구간 목록은 JSON 배열 */
function replacement(fd: FormData, target: ForecastTarget): unknown | null {
  const unit = text(fd, "unit") || null;
  if (target === "forecast_70") {
    const v = text(fd, "value");
    return v && Number.isFinite(Number(v)) ? { value: v, unit, definition: text(fd, "definition") || null } : null;
  }
  if (target === "acceptance_range") {
    const lo = text(fd, "lower");
    const hi = text(fd, "upper");
    if (!lo || !hi || !(Number(lo) < Number(hi))) return null;
    return { lower: lo, upper: hi, unit, definition: text(fd, "definition") || null };
  }
  try {
    const v = JSON.parse(text(fd, "ranges"));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export async function runForecast(_prev: ForecastFormState, fd: FormData): Promise<ForecastFormState> {
  const op = text(fd, "op");
  const key = text(fd, "key");
  const id = text(fd, "draft_id");
  const caller = await getCaller();
  const src = source();
  let res: Result<ForecastDraftDto>;
  try {
    if (op === "create") {
      res = await src.createForecastDraft(
        caller,
        text(fd, "offering_id"),
        { input_id: text(fd, "input_id"), input_version: text(fd, "input_version"), policy_id: text(fd, "policy_id"), policy_version: text(fd, "policy_version") },
        key,
      );
    } else if (op === "adjust") {
      const target = text(fd, "target") as ForecastTarget;
      const value = replacement(fd, target);
      if (value === null) return { code: "invalid_replacement", status: 422, message: "대체값을 확인하세요. 범위는 아래 값이 위 값보다 작아야 하고, 구간 목록은 JSON 배열이어야 합니다.", key };
      const evidence = text(fd, "evidence_refs").split(/[\s,]+/).filter(Boolean);
      res = await src.adjustForecastDraft(caller, id, { ...ref(fd), target, replacement: value, reason: text(fd, "reason"), evidence_refs: evidence }, key);
    } else if (op === "validate") {
      res = await src.validateForecastDraft(caller, id, ref(fd), key);
    } else if (op === "approve") {
      res = await src.approveForecastDraft(caller, id, { ...ref(fd), validation_receipt_hash: text(fd, "receipt"), reason: text(fd, "reason") }, key);
    } else if (op === "publish") {
      res = await src.publishForecastDraft(caller, id, { ...ref(fd), approval_receipt_hash: text(fd, "receipt") }, key);
    } else {
      return { code: "invalid_request", status: 422, message: MESSAGE[422], key };
    }
  } catch (e) {
    if (e instanceof AccessDenied) return { code: e.code, status: e.status, message: MESSAGE[e.status], key: crypto.randomUUID() };
    if (e instanceof ConnectionError) return { code: e.code, status: 503, message: "정시터치 서버에 연결할 수 없습니다. 잠시 뒤 같은 내용으로 다시 보내세요.", key };
    throw e;
  }
  if (!res.ok) return { code: res.code, status: res.status, message: MESSAGE[res.status] ?? "요청을 처리하지 못했습니다.", key: crypto.randomUUID() };
  redirect(`${MANAGEMENT_FORECASTS.path}?draft=${encodeURIComponent(res.value.draft_id)}`);
}
