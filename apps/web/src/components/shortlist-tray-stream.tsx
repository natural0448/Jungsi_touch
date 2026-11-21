import "server-only";
import { ShortlistTray } from "@/components/shortlist-tray";
import { AccessDenied, ConnectionError, type Caller, type JungsiSource } from "@/lib/api";
import type { OfferingDto, ReportDto, ShortlistEntryDto } from "@/lib/dto";
import type { PickedItem } from "@/lib/shortlist";

/*
  3·4페이지 핵심 지원 학교 띠(2026-11-10 부담당자 보완 요청).
  지금 목록에 없는 담은 곳은 이름·모집군을 offering.read(건당 1회)로 받는다. 군별 담은 수(가군 2/4 …)를 세려면
  모집군이 필요해(대표님 요청 2026-11-22) 이름과 함께 모두 받은 뒤 띠를 한 번에 그린다. 부르는 쪽은 Suspense(fallback 없음)로 감싸
  목록은 띠를 기다리지 않는다. 받지 못한 곳은 '지금 목록에서 찾을 수 없는 모집단위'로 두고 전체 수에만 센다.
*/
export async function StreamTray({ report, known, src, caller, other }: { report: ReportDto; known: OfferingDto[]; src: JungsiSource; caller: Caller; other: "PAGE-03" | "PAGE-04" }) {
  const byId = new Map(known.map((o) => [o.offering_id, o]));
  const entries = Object.entries(report.shortlist ?? {}).filter(([, e]) => e.selected);
  const item = (id: string, entry: ShortlistEntryDto, offering: OfferingDto | null): PickedItem => ({ offering, offering_id: id, entry, assessment: report.analyses?.[id] ?? null });
  const items = await Promise.all(
    entries.map(async ([id, e]) => {
      const hit = byId.get(id);
      if (hit) return item(id, e, hit);
      try {
        return item(id, e, (await src.readOffering(caller, id))?.offering ?? null);
      } catch (err) {
        if (err instanceof ConnectionError || err instanceof AccessDenied) return item(id, e, null);
        throw err;
      }
    }),
  );
  return <ShortlistTray items={items} other={other} />;
}
