import type { SampleReportDto, ScoreInputStatusDto } from "@/lib/dto";
import { seoulDate, seoulDateTime } from "@/lib/format";
import { PASS_HREF, SUPPORT_HREF } from "@/lib/links";

/*
  2페이지 입력권·예시 리포트 표시(기획 1.9.95, 담당자 연결계약 v3 §10).
  숫자는 score-input-status 응답 그대로 쓰고 추정하지 않는다. 예시 리포트는 가상 학생 견본이며 실제 개인 성적으로 꾸미지 않는다.
*/

const AREA: Record<string, string> = { korean: "국어", math: "수학", inquiry1: "탐구 1", inquiry2: "탐구 2" };

/** 입력 가능 여부: 열린 단계이고(서버 판단) 남은 저장 횟수가 있거나 미리보기 예외일 때 */
export function canInput(st: ScoreInputStatusDto | null): boolean {
  if (!st || !st.paid_input_allowed || st.stage_state !== "open") return false;
  return st.input_limit_mode === "preview_exempt" || (st.effective_save_remaining ?? 0) > 0;
}

/** 이 시험 단계의 입력권 상태 한 줄 */
export function InputStatus({ st }: { st: ScoreInputStatusDto }) {
  const window =
    st.stage_state === "not_open"
      ? `입력은 ${st.opens_at ? seoulDateTime(st.opens_at) : "공식 개방"}부터 열립니다.`
      : st.stage_state === "closed"
        ? `이 단계의 입력 기간이 ${st.closes_at ? seoulDate(st.closes_at) : ""} 끝났습니다.`
        : null;
  return (
    <div className="rp-rights">
      <b>{st.academic_year}학년도 성적 입력</b>
      {st.input_limit_mode === "preview_exempt" ? (
        <span>미리보기 계정 — 입력 횟수를 세지 않습니다</span>
      ) : (
        <span>
          최초 입력 남음 <b className="num">{st.initial_remaining}</b>회 · 정정 요청 가능 <b className="num">{st.correction_request_remaining}</b>회
          {st.correction_granted > st.correction_used && <> · 승인된 정정 남음 <b className="num">{st.correction_granted - st.correction_used}</b>회</>}
        </span>
      )}
      {window && <span className="warn">{window}</span>}
    </div>
  );
}

/** 입력할 수 없는 유료 회원 안내(이미 1회 사용 등). 정정은 고객센터 */
export function NoInput({ st }: { st: ScoreInputStatusDto | null }) {
  return (
    <section className="rp-empty">
      {st === null ? (
        <p>지금은 성적 입력 상태를 확인할 수 없어 저장을 열지 않았습니다. 잠시 뒤 다시 열어 주세요. 입력 횟수는 쓰이지 않았습니다.</p>
      ) : st.stage_state !== "open" ? (
        <p>이 시험 단계는 지금 성적을 입력할 수 있는 기간이 아닙니다.</p>
      ) : (
        <p>
          이 시험 단계의 성적 입력 1회를 이미 사용했습니다. 저장한 리포트는 계속 볼 수 있습니다. 성적표와 다르게 저장했다면 <a href={SUPPORT_HREF}>고객센터</a>에 정정을 요청해 주세요
          {st.correction_request_remaining > 0 ? `(남은 정정 요청 ${st.correction_request_remaining}회)` : ""}.
        </p>
      )}
    </section>
  );
}

/** 무료 회원: 가상 학생 견본 리포트 + 이용권 안내 */
export function SampleReport({ s }: { s: SampleReportDto | null }) {
  return (
    <section className="rp-sample" aria-labelledby="sample-h">
      <div className="rp-sechd">
        <h2 id="sample-h">예시 리포트 <small>{s?.label ?? "가상 학생 견본"} · 실제 성적이 아닙니다</small></h2>
      </div>
      {s ? (
        <>
          <div className="tblwrap">
            <table className="tb">
              <thead>
                <tr>
                  <th scope="col">과목</th>
                  <th scope="col" className="r">표준점수</th>
                </tr>
              </thead>
              <tbody>
                {s.report.subjects.map((x) => (
                  <tr key={x.area}>
                    <th scope="row">{AREA[x.area] ?? x.area}</th>
                    <td className="r num">{x.standard_score}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">표준점수 합</th>
                  <td className="r num"><b>{s.report.total_standard_score}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="rp-foot">
            견본은 화면 구성을 보여 드리는 가상 학생 자료이며 저장되지 않습니다
            {s.report.overall.status !== "estimated" && " — 전체 위치는 견본에서 계산하지 않습니다"}.
          </p>
        </>
      ) : (
        <p className="rp-foot">예시 리포트를 지금 불러오지 못했습니다.</p>
      )}
      <div className="rp-lock">
        <div>
          <h2>내 성적 입력과 전체 위치는 이용권으로 열립니다</h2>
          <p>이용권이 있으면 시험 단계마다 성적을 1회 입력하고, 전체 응시자 중 내 위치와 대학 분석을 볼 수 있습니다.</p>
        </div>
        <a className="btn t" href={PASS_HREF}>이용권 보기</a>
      </div>
    </section>
  );
}
