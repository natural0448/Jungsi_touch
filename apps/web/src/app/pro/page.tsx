import type { Metadata } from "next";
import Link from "@/components/link";
import { LockIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { edutouch, loginHref } from "@/lib/links";
import { KIND_LABEL, ROLE_LABEL, daysUntil, proAccess, type ProOrg } from "@/lib/pro-access";
import { plainDate } from "@/lib/format";
import "./pro.css";

export const metadata: Metadata = { title: "정시터치 전문가용" };
export const dynamic = "force-dynamic";

/*
  정시터치 전문가용 홈(계획서 v3, 2026-10-21). 학교·학원이 단체로 구매하면 담당 교사가 학생 여러 명의 성적을 넣고
  학생별 기록을 다시 연다. 들어오는 권한은 에듀터치 jeongsi_pro_access()(활성 계약 구성원만)로, 학생 기록 권한은
  정시터치 서비스가 요청마다 확인한다. 이 화면은 기관·계약·파기일 띠와 학생 목록 자리까지 — 학생 API 연결 전이다.
*/
export default async function Page({ searchParams }: PageProps<"/pro">) {
  const head = <PageHead kicker="전문가용" title="정시터치 전문가용" desc="담당 학생의 성적을 입력하고, 학생별 분석 기록을 언제든 다시 열어 상담에 쓰세요." />;
  const orgs = await proAccess();
  if (orgs === null)
    return (
      <>
        {head}
        <div className="wrap pg-body">
          <section className="gate flat">
            <h2>소속 기관을 지금 확인할 수 없습니다</h2>
            <p>잠시 뒤 다시 열어 주세요. 계속되면 고객센터에 알려 주세요.</p>
          </section>
        </div>
      </>
    );
  if (orgs.length === 0) return <>{head}<NoAccess /></>;

  const sp = await searchParams;
  const want = typeof sp.org === "string" ? Number(sp.org) : NaN;
  // 고른 기관이 내 활성 기관 목록에 있을 때만 쓴다(주소의 번호를 그대로 믿지 않는다)
  const org = orgs.find((o) => o.org_id === want) ?? (orgs.length === 1 ? orgs[0] : null);

  return (
    <>
      {head}
      <div className="wrap pg-body pro">
        {orgs.length > 1 && (
          <nav className="pro-orgs" aria-label="기관 선택">
            {orgs.map((o) => (
              <Link key={o.org_id} href={`/pro?org=${o.org_id}`} className={org?.org_id === o.org_id ? "on" : undefined} aria-current={org?.org_id === o.org_id ? "true" : undefined}>
                {o.org_name}
              </Link>
            ))}
          </nav>
        )}
        {!org ? (
          <section className="gate flat">
            <h2>이용할 기관을 골라 주세요</h2>
          </section>
        ) : (
          <>
            <OrgBand o={org} />
            <section className="pro-sec" aria-labelledby="students-h">
              <div className="pro-sechd">
                <h2 id="students-h">담당 학생</h2>
              </div>
              <div className="pro-empty">
                <p>학생 목록·추가·학생별 성적 입력과 분석은 정시터치 서비스 연결 뒤 열립니다(준비 중).</p>
                <p className="sub">학생 기록은 기관 소유로 저장되며, 담당 교사와 기관 관리자만 볼 수 있습니다. 학생에게는 상담 리포트를 PDF 또는 인쇄물로 전달해 주세요.</p>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

/** 기관·역할·계약 기간·학생 수·파기일 띠. 파기일이 2주 안이면 강조 */
function OrgBand({ o }: { o: ProOrg }) {
  const left = daysUntil(o.purge_on);
  return (
    <section className="pro-band" aria-label="소속 기관">
      <div className="org">
        <b>{o.org_name}</b>
        <span>{KIND_LABEL[o.org_kind]} · {ROLE_LABEL[o.role]}</span>
      </div>
      <dl>
        <div><dt>대상</dt><dd>{o.academic_year}학년도</dd></div>
        <div><dt>계약 기간</dt><dd className="num">{plainDate(o.starts_on)} ~ {plainDate(o.ends_on)}</dd></div>
        <div><dt>학생 수</dt><dd className="num">{o.seats}명</dd></div>
        <div className={left <= 14 ? "warn" : undefined}>
          <dt>학생 기록 파기</dt>
          <dd className="num">{plainDate(o.purge_on)}{left >= 0 && ` (D-${left})`}</dd>
        </div>
      </dl>
      {left <= 14 && <p className="pro-purge">파기일이 가까워졌습니다. 필요한 학생 리포트는 파기일 전에 PDF로 저장해 주세요. 파기일 0시부터 학생 기록을 볼 수 없습니다.</p>}
    </section>
  );
}

function NoAccess() {
  return (
    <div className="wrap pg-body">
      <section className="gate" aria-labelledby="pro-gate-h">
        <div className="ic"><LockIcon size={20} /></div>
        <h2 id="pro-gate-h">전문가용은 이용 계약을 맺은 학교·학원의 구성원만 쓸 수 있습니다</h2>
        <p>기관 관리자에게 초대를 받았다면 에듀터치 마이페이지 &lsquo;소속 기관&rsquo;에서 수락해 주세요. 계약이 끝났거나 아직 시작 전이면 이 화면이 열리지 않습니다.</p>
        <div className="acts">
          <a className="btn p" href={edutouch("/mypage")}>에듀터치 마이페이지</a>
          <a className="btn" href={loginHref("/pro")}>다른 계정으로 로그인</a>
        </div>
      </section>
    </div>
  );
}
