/*
  브라우저에서 같은 계정으로 보내는 쓰기·추가 조회를 한 줄로 세운다(2026-11-21 대표님 지적).
  정시터치 서버는 계정당 동시 요청 수를 제한한다(유료 2·일반 1, 넘치면 429). 담기를 여러 번 빠르게 누르거나
  여러 줄을 잇달아 펼치면 같은 화면이 스스로 요청을 겹쳐 서로 막혔다. 여기서 하나씩 차례로 보낸다.
  화면을 새로 고치면 줄도 새로 시작한다(브라우저 탭 하나 안에서만 쓰는 대기열).
*/
let tail: Promise<unknown> = Promise.resolve();

/** 앞에 넣은 일이 끝난 뒤(성공·실패 무관) run 을 시작한다. 결과·오류는 그대로 돌려준다 */
export function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const next = tail.then(run, run);
  tail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
