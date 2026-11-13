import type { Metadata } from "next";
import Form from "next/form";
import Link from "@/components/link";
import { ConnectionNotice } from "@/components/connection-notice";
import { LockIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller } from "@/lib/api";
import { proSource } from "@/lib/api/pro-source";
import { edutouch, loginHref } from "@/lib/links";
import type { ProOrganization, ProStudentPageDto } from "@/lib/pro-dto";
import { KIND_LABEL, ROLE_LABEL, daysUntil, proAccess, type ProOrg } from "@/lib/pro-access";
import { plainDate, seoulDate } from "@/lib/format";
import { StudentForm } from "./student-form";
import "./pro.css";

export const metadata: Metadata = { title: "정시터치 전문가용" };
export const dynamic = "force-dynamic";

/*
  정시터치 전문가용 홈(계획서 v3 · 전문가용 서비스 계약 1.9.99 pro.home). 들어오는 권한은 에듀터치 jeongsi_pro_access()
  (활성 계약 구성원만), 학생 기록·좌석·담당 권한은 전문가용 서비스(jungsi-pro-api)가 요청마다 판단한다.
  화면: 기관·계약·파기일 띠 → 담당 학생 목록(이름·반 검색) → 학생 추가(좌석 1명 사용).
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
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 40) || undefined;
  const want = one(sp.org);
  // 고른 기관이 내 활성 기관 목록에 있을 때만 쓴다(주소의 번호를 그대로 믿지 않는다)
  const org = orgs.find((o) => String(o.org_id) === want) ?? (orgs.length === 1 ? orgs[0] : null);
  const q = one(sp.q);
  const adding = sp.add === "1";

  let svc: ProOrganization | null = null;
  let page: ProStudentPageDto | null = null;
  let down: ConnectionError | null = null;
  if (org) {
    const caller = await getCaller();
    const src = proSource();
    try {
      svc = (await src.session(caller)).organizations.find((o) => o.org_id === String(org.org_id)) ?? null;
      if (svc) page = await src.listStudents(caller, svc.org_id, { limit: 50, q });
    } catch (e) {
      if (e instanceof ConnectionError) down = e;
      else if (!(e instanceof AccessDenied)) throw e;
    }
  }
  const orgQ = org ? `org=${org.org_id}` : "";

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
            <OrgBand o={org} svc={svc} />
            {down ? (
              <ConnectionNotice e={down} />
            ) : !svc ? (
              <section className="pro-empty">
                <p>전문가용 서비스에서 이 기관의 계약을 아직 확인하지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
              </section>
            ) : (
              <section className="pro-sec" aria-labelledby="students-h">
                <div className="pro-sechd">
                  <h2 id="students-h">
                    {svc.role === "org_admin" ? "기관 학생" : "담당 학생"} <span className="num">{page?.items.length ?? 0}</span>
                  </h2>
                  <Form action="/pro" prefetch={false} className="pro-search" role="search">
                    <input type="hidden" name="org" value={String(org.org_id)} />
                    <input type="search" name="q" defaultValue={q} placeholder="이름·반 검색" maxLength={40} />
                    <button className="btn" type="submit">검색</button>
                  </Form>
                  <Link className="btn" href={`/pro/guide?${orgQ}`}>정시 기본 안내</Link>
                  {svc.role === "org_admin" && <Link className="btn" href={`/pro/management?${orgQ}`}>기관 관리</Link>}
                  {svc.role !== "viewer" && !adding && (
                    <Link className="btn p" href={`/pro?${orgQ}&add=1`}>학생 추가</Link>
                  )}
                </div>
                {adding && svc.role !== "viewer" && (
                  svc.contract_version === undefined ? (
                    <p className="pro-empty">학생 추가는 서버가 계약 판 정보를 알려 준 뒤 열립니다(연결 준비 중).</p>
                  ) : svc.remaining_student_count > 0 ? (
                    <StudentForm orgId={svc.org_id} idem={crypto.randomUUID()} contractVersion={svc.contract_version} onDone={`/pro?${orgQ}`} />
                  ) : (
                    <p className="pro-empty">계약한 학생 수({svc.contracted_student_count}명)를 모두 사용했습니다. 기관 관리자에게 계약 학생 수 조정을 요청해 주세요.</p>
                  )
                )}
                {page && page.items.length > 0 ? (
                  <div className="tblwrap">
                    <table className="tb pro-students">
                      <thead>
                        <tr>
                          <th scope="col">반·번호</th>
                          <th scope="col">이름</th>
                          <th scope="col">태그</th>
                          <th scope="col">추가한 날</th>
                          <th scope="col"><span className="sr">열기</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.items.map((s) => (
                          <tr key={s.student_id}>
                            <td className="num">{[s.class_label, s.class_number ? `${s.class_number}번` : null].filter(Boolean).join(" ") || "─"}</td>
                            <th scope="row">
                              <Link href={`/pro/students/${encodeURIComponent(s.student_id)}?${orgQ}`}>{s.display_name}</Link>
                            </th>
                            <td>{s.tags.length ? s.tags.map((t) => <span key={t} className="tag">{t}</span>) : "─"}</td>
                            <td className="num">{seoulDate(s.created_at_utc)}</td>
                            <td className="r"><Link className="btn" href={`/pro/students/${encodeURIComponent(s.student_id)}?${orgQ}`}>열기</Link></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="pro-empty">
                    <p>{q ? `‘${q}’에 맞는 학생이 없습니다.` : "아직 추가한 학생이 없습니다. '학생 추가'로 담당 학생을 넣어 주세요."}</p>
                  </div>
                )}
                {page?.has_more && <p className="pro-note">학생이 더 있습니다. 이름이나 반으로 검색해 주세요.</p>}
                <p className="pro-note">학생 기록은 기관 소유로 저장되며, 담당 교사와 기관 관리자만 볼 수 있습니다. 학생에게는 상담 리포트를 PDF 또는 인쇄물로 전달해 주세요.</p>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** 기관·역할·계약 기간·학생 수·파기일 띠. 학생 수는 서비스의 사용/남은 수, 파기일이 2주 안이면 강조 */
function OrgBand({ o, svc }: { o: ProOrg; svc: ProOrganization | null }) {
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
        <div>
          <dt>학생 수</dt>
          <dd className="num">{svc ? `${svc.used_student_count} / ${svc.contracted_student_count}명 (남은 ${svc.remaining_student_count}명)` : `${o.seats}명`}</dd>
        </div>
        <div className={left <= 14 ? "warn" : undefined}>
          <dt>학생 기록 파기</dt>
          <dd className="num">{plainDate(o.purge_on)}{left >= 0 && ` (D-${left})`}</dd>
        </div>
      </dl>
      {left <= 14
        ? <p className="pro-purge">파기일이 가까워졌습니다. 필요한 학생 리포트는 파기일 전에 PDF로 저장해 주세요. 파기일 0시부터 학생 기록을 볼 수 없습니다.</p>
        : <p className="pro-save">계약 기간이 끝나면 전문가용 화면과 학생 기록을 볼 수 없습니다. 충원 합격 발표는 2월 중순까지 이어지니, 상담에 쓸 학생 리포트는 {plainDate(o.ends_on)}까지 PDF로 저장해 두세요.</p>}
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
