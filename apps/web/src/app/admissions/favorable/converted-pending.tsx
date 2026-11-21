import { AccessDenied, ConnectionError, type Caller, type JungsiSource } from "@/lib/api";

/** 판정 대기 모집단위 이름은 offering.read 로 건당 1회 받는다. 받지 못하면 번호 대신 '학과 정보 확인 중'으로 둔다 */
export async function ConvertedPendingList({ src, caller, items }: { src: JungsiSource; caller: Caller; items: { offeringId: string; score: string }[] }) {
  const rows = await Promise.all(items.map(async (it) => {
    try {
      return { ...it, o: (await src.readOffering(caller, it.offeringId))?.offering ?? null };
    } catch (e) {
      if (e instanceof ConnectionError || e instanceof AccessDenied) return { ...it, o: null };
      throw e;
    }
  }));
  return (
    <section className="fv-cp" aria-label="환산 완료·판정 대기">
      <h3>환산 완료·판정 대기 <b className="num">{rows.length}</b>곳</h3>
      <p className="fv-note">대학 반영 방식대로 내 점수는 계산했지만, 지원 판단에 필요한 이 모집단위의 분석 기준이 아직 없어 도전·핵심 검토·여유 후보로 나누지 않았습니다. 합격 가능성을 뜻하지 않습니다.</p>
      <ul>
        {rows.map((r) => (
          <li key={r.offeringId}>
            <span>{r.o ? `${r.o.university_name} ${r.o.department}` : "학과 정보 확인 중"}</span>
            <span>내 환산점수 <b className="num">{r.score}</b></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
