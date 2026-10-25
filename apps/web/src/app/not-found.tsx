import Link from "next/link";
import { page } from "@/lib/routes";

/** 없는 주소. 네 화면으로 바로 갈 수 있게 한다(옛 주소는 next.config 의 넘김이 먼저 처리한다) */
export default function NotFound() {
  return (
    <div className="wrap pg-body">
      <section className="gate" aria-labelledby="nf-h">
        <h2 id="nf-h">없는 화면입니다</h2>
        <p>주소가 바뀌었거나 잘못 입력됐을 수 있습니다. 아래에서 원하는 화면으로 이동해 주세요.</p>
        <div className="acts">
          <Link className="btn p" href={page("PAGE-01").path} prefetch={false}>
            {page("PAGE-01").label}
          </Link>
          <Link className="btn" href={page("PAGE-02").path} prefetch={false}>
            {page("PAGE-02").label}
          </Link>
        </div>
      </section>
    </div>
  );
}
