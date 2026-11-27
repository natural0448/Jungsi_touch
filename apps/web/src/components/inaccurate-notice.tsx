import Link from "@/components/link";
import { inaccurateText } from "@/lib/score-validity";
import { page } from "@/lib/routes";

/**
 * 부정확 입력 상태 안내(2026-11-22 대표님 결정). 2페이지는 분석 대신 이 안내만, 3·4페이지는 직접 들어와도 이 안내와 정정 길만 보인다.
 * correctHref: 정정 요청(또는 자동 승인된 가채점 정정 입력)으로 가는 주소. null 이면 정정을 더 할 수 없다는 안내만 둔다.
 */
export function InaccurateNotice({ name, correctHref, provisional = true, back = false }: { name: string; correctHref: string | null; provisional?: boolean; back?: boolean }) {
  return (
    <section className="gate flat" aria-labelledby="inacc-h">
      <h2 id="inacc-h">{inaccurateText(name)}</h2>
      {correctHref ? (
        <p>
          성적 정정권 1회를 써서 정정을 요청해 주세요.{provisional ? " 가채점 원점수 정정은 사진 없이 바로 승인되어 곧바로 다시 입력할 수 있습니다." : ""}
        </p>
      ) : (
        <p>이 단계의 성적 정정은 이미 사용했거나 지금은 요청할 수 없습니다. 궁금한 점은 고객센터로 알려 주세요.</p>
      )}
      <div className="acts">
        {correctHref && <Link className="btn p" href={correctHref}>성적 정정 요청</Link>}
        {back && <Link className="btn" href={page("PAGE-02").path}>{page("PAGE-02").label}</Link>}
      </div>
    </section>
  );
}
