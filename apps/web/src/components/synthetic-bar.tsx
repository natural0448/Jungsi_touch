import { setSyntheticStage, setSyntheticState } from "@/app/synthetic-actions";
import { source } from "@/lib/api";
import { SYN_STAGES, SYN_STATES, readSyntheticStage, readSyntheticState } from "@/lib/api/synthetic";

/**
 * 합성 응답으로 보는 중임을 알리고, 회원 상태를 이 브라우저에서 바꿔 보는 띠.
 * JUNGSI_API_MODE=live 가 되면 그려지지 않는다. 이 값은 권한이 아니다(서버가 판단).
 */
export async function SyntheticBar() {
  if (source().kind !== "synthetic") return null;
  const cur = await readSyntheticState();
  const stage = await readSyntheticStage();
  return (
    <aside className="synbar" aria-label="합성 응답 설정">
      <div className="wrap">
        <span className="tag">합성 응답</span>
        <span className="txt">API 연결 전 화면입니다. 대학·점수·판정은 모두 지어낸 예시입니다.</span>
        <span className="sp" />
        {SYN_STATES.map((s) => (
          <form key={s.v} action={setSyntheticState}>
            <input type="hidden" name="state" value={s.v} />
            <button className={cur === s.v ? "on" : undefined} aria-pressed={cur === s.v}>
              {s.label}
            </button>
          </form>
        ))}
        <span className="sep" aria-hidden="true">·</span>
        {SYN_STAGES.map((s) => (
          <form key={s.v} action={setSyntheticStage}>
            <input type="hidden" name="stage" value={s.v} />
            <button className={stage === s.v ? "on" : undefined} aria-pressed={stage === s.v}>
              {s.label}
            </button>
          </form>
        ))}
      </div>
    </aside>
  );
}
