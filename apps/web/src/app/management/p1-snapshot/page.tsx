import type { Metadata } from "next";
import { PageHead } from "@/components/page-head";
import { isEdutouchAdmin } from "@/lib/admin";
import { seoulDateTime } from "@/lib/format";
import { warmInfo } from "@/lib/p1-snapshot";
import { WarmRunner } from "./runner";
import { ConnectionError } from "@/lib/api/source";

export const metadata: Metadata = { title: "1페이지 정리본 준비" };
export const dynamic = "force-dynamic";

/*
  관리 전용: 1페이지 전국 정리본 준비(워밍, 담당자 연결계약 v3 §4-2). 현재판 head 와 분할 전부를 관리자 인증으로
  받아 pins(길이·SHA)·행 수를 대조하고 학교별 묶음·검색 색인으로 저장한다. 모두 맞을 때만 ready 를 올린다.
  일반 회원 방문은 저장본만 읽는다. 소비자 4개 화면의 번호·탭에 넣지 않는다.
*/
export default async function Page() {
  const head = <PageHead kicker="관리" title="1페이지 정리본 준비" desc="대학 발표 입시결과 정리본의 현재판을 받아 검증하고 1페이지에 반영합니다." />;
  if (!(await isEdutouchAdmin()))
    return (
      <>
        {head}
        <div className="wrap pg-body">
          <section className="gate flat">
            <h2>에듀터치 관리자만 쓸 수 있는 화면입니다</h2>
          </section>
        </div>
      </>
    );
  let ready: Awaited<ReturnType<typeof warmInfo>>["ready"];
  try { ({ ready } = await warmInfo()); }
  catch (error) {
    if (!(error instanceof ConnectionError)) throw error;
    return <>{head}<div className="wrap pg-body"><section className="gate flat"><h2>공유 준비 저장소 연결이 필요합니다</h2><p>운영용 저장소와 준비 조정자가 연결되지 않아 준비를 시작하지 않았습니다. 설정을 확인한 뒤 다시 열어 주세요.</p></section></div></>;
  }
  return (
    <>
      {head}
      <div className="wrap pg-body" style={{ display: "grid", gap: 16 }}>
        <section className="gate flat" style={{ textAlign: "left" }}>
          <h2>지금 1페이지가 쓰는 판</h2>
          {ready ? (
            <p>
              {ready.snapshot_id} · 발행 SHA {ready.publication_sha256.slice(0, 12)}… · 행 {ready.counts.rows}(연결 {ready.counts.mapped_rows} · 미연결 {ready.counts.mapping_pending_rows}) · 학교 {ready.counts.schools}
              <br />
              정리본 생성 {seoulDateTime(ready.generated_at)} · 준비 완료 {seoulDateTime(ready.warmed_at)} · 확인 기한 {seoulDateTime(ready.expires_at)}
            </p>
          ) : (
            <p>아직 준비된 판이 없습니다. 1페이지는 &lsquo;자료 준비 중&rsquo;으로 보입니다.</p>
          )}
        </section>
        <WarmRunner />
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          한 단계에서 분할을 최대 6개 순서대로 받습니다. 여러 탭에서 시작해도 같은 판은 한 작업만 진행합니다. 동시 처리 제한은 잠시 뒤 이어 하고, 그 밖의 실패는 멈춥니다. 판이 바뀌면 새 판을 처음부터 준비합니다.
        </p>
      </div>
    </>
  );
}
