import { PageHead } from "./page-head";

/** 아직 만들지 않은 화면. 만든 것처럼 보이지 않게 무엇이 남았는지 그대로 적는다 */
export function PendingPage({ number, label, note }: { number: number; label: string; note: string }) {
  return (
    <>
      <PageHead kicker={`PAGE ${number}`} title={label} />
      <div className="wrap pg-body">
        <section className="gate">
          <h2>이 화면은 아직 만들지 않았습니다</h2>
          <p>{note}</p>
        </section>
      </div>
    </>
  );
}
