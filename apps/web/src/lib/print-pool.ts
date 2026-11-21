/*
  인쇄 화면이 담은 학교(최대 15곳)마다 상세 자료를 미리 받을 때 쓰는 작은 대기열(2026-11-22 대표님 결정).
  정시터치 서버는 계정당 동시 요청 수를 제한한다(유료 2·일반 1, 넘치면 429). limit 개씩만 함께 보내고,
  결과는 넣은 순서 그대로 돌려준다. 하나가 실패해도 나머지는 계속한다(실패한 자리는 onError 값).
*/
export async function mapPool<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>, onError: (e: unknown, item: T) => R): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await run(items[i], i);
      } catch (e) {
        out[i] = onError(e, items[i]);
      }
    }
  };
  const n = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}
