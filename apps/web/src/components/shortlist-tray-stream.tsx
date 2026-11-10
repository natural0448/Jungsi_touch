import "server-only";
import { Suspense } from "react";
import { ShortlistTray } from "@/components/shortlist-tray";
import { AccessDenied, ConnectionError, type Caller, type JungsiSource } from "@/lib/api";
import type { OfferingDto, ReportDto, ShortlistEntryDto } from "@/lib/dto";
import type { PickedItem } from "@/lib/shortlist";

/*
  3·4페이지 핵심 지원 학교 띠(2026-11-10 부담당자 보완 요청).
  담은 곳의 개수와 지금 목록에 있는 곳의 이름은 리포트만으로 바로 그리고, 목록에 없는 곳의 이름(offering.read, 건당 1회)만
  뒤이어 채운다. 이름을 받지 못하면 '외 n곳'으로 두고 화면은 그대로 둔다.
*/
export function StreamTray({ report, known, src, caller, other }: { report: ReportDto; known: OfferingDto[]; src: JungsiSource; caller: Caller; other: "PAGE-03" | "PAGE-04" }) {
  const byId = new Map(known.map((o) => [o.offering_id, o]));
  const entries = Object.entries(report.shortlist ?? {}).filter(([, e]) => e.selected);
  const item = (id: string, entry: ShortlistEntryDto, offering: OfferingDto | null): PickedItem => ({ offering, offering_id: id, entry, assessment: report.analyses?.[id] ?? null });
  const shown = entries.filter(([id]) => byId.has(id)).map(([id, e]) => item(id, e, byId.get(id)!));
  const rest = entries.filter(([id]) => !byId.has(id));
  if (rest.length === 0) return <ShortlistTray items={shown} other={other} />;
  const names = (
    <Suspense fallback={<span className="wait">외 {rest.length}곳 이름 불러오는 중</span>}>
      <RestNames rest={rest} src={src} caller={caller} />
    </Suspense>
  );
  return <ShortlistTray items={shown} other={other} more={{ count: rest.length, names }} />;
}

async function RestNames({ rest, src, caller }: { rest: [string, ShortlistEntryDto][]; src: JungsiSource; caller: Caller }) {
  let rows: { id: string; entry: ShortlistEntryDto; offering: OfferingDto | null }[] | null = null;
  try {
    rows = await Promise.all(rest.map(async ([id, entry]) => ({ id, entry, offering: (await src.readOffering(caller, id))?.offering ?? null })));
  } catch (e) {
    if (!(e instanceof ConnectionError || e instanceof AccessDenied)) throw e;
  }
  if (!rows) return <span className="wait">외 {rest.length}곳</span>;
  return (
    <>
      {rows.map((r) => (
        <span key={r.id} className={r.entry.assessment_status === "needs_revalidation" ? "stale" : undefined}>
          {r.offering ? `${r.offering.university_name} ${r.offering.department}` : "카탈로그에 없는 모집단위"}
        </span>
      ))}
    </>
  );
}
