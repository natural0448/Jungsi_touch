import { Suspense } from "react";
import { StatsLine } from "@/components/offering-parts";
import type { StatisticsDto } from "@/lib/dto";

/** 모집단위별 추천·선택 집계(live-statistics). 학교 목록보다 늦게 와도 되므로 받는 동안 이 줄만 비워 둔다(2026-11-10 나눠 그리기) */
export type StatsPromise = Promise<Map<string, StatisticsDto | null>>;

async function Slot({ p, id }: { p: StatsPromise; id: string }) {
  return <StatsLine s={(await p).get(id)} />;
}

/** k: 화면 조건(필터·펼친 학교). 조건이 바뀌는 전환에서 이 줄만 기다리고 학교 목록은 먼저 바뀌게 경계를 새로 만든다 */
export function StatsSlot({ p, id, k }: { p: StatsPromise; id: string; k: string }) {
  return (
    <Suspense key={k} fallback={<span className="stats wait">추천·선택 집계 불러오는 중</span>}>
      <Slot p={p} id={id} />
    </Suspense>
  );
}
