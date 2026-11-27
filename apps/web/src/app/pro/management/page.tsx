import type { Metadata } from "next";
import Link from "@/components/link";
import { ConnectionNotice } from "@/components/connection-notice";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller } from "@/lib/api";
import { proSource } from "@/lib/api/pro-source";
import type { ProMemberPageDto, ProOrganization, ProStudentDto } from "@/lib/pro-dto";
import { proAccess } from "@/lib/pro-access";
import { ArchiveForm, AssignForm } from "./admin-forms";
import "../pro.css";

export const metadata: Metadata = { title: "기관 관리 · 정시터치 전문가용" };
export const dynamic = "force-dynamic";

/*
  전문가용 기관 관리(계약 pro.members). 기관 관리자만: 구성원 목록, 학생 담당 변경, 학생 보관.
  담당 변경·보관은 서버가 2단계 인증(aal2)을 다시 확인한다. 성적 정정 기능은 여기에 없다(고객센터 전용).
  구성원은 이름(기관 관리자에게만, 2026-11-13)·역할로 보인다. 이메일은 보이지 않고, 서버가 이름을 주지 않으면 구성원 번호로 보인다.
*/
export default async function Page({ searchParams }: PageProps<"/pro/management">) {
  const head = <PageHead kicker="전문가용" title="기관 관리" desc="구성원과 학생 담당을 관리합니다. 담당 변경·보관은 2단계 인증(OTP) 세션에서만 됩니다." />;
  const sp = await searchParams;
  const orgParam = typeof sp.org === "string" ? sp.org : "";
  const orgs = await proAccess();
  const org = orgs?.find((o) => String(o.org_id) === orgParam) ?? (orgs?.length === 1 ? orgs[0] : undefined);
  const back = <Link className="btn" href={`/pro?org=${encodeURIComponent(orgParam)}`}>전문가용 홈</Link>;
  if (!org) return <>{head}<div className="wrap pg-body"><section className="gate flat"><h2>기관을 찾을 수 없습니다</h2><div className="acts">{back}</div></section></div></>;

  const caller = await getCaller();
  const src = proSource();
  let svc: ProOrganization | undefined;
  let members: ProMemberPageDto | null = null;
  let students: ProStudentDto[] = [];
  try {
    svc = (await src.session(caller)).organizations.find((o) => o.org_id === String(org.org_id));
    if (svc?.role === "org_admin") {
      members = await src.listMembers(caller, svc.org_id);
      students = (await src.listStudents(caller, svc.org_id, { limit: 100 })).items;
    }
  } catch (e) {
    if (e instanceof ConnectionError) return <>{head}<ConnectionNotice e={e} /></>;
    if (!(e instanceof AccessDenied)) throw e;
  }
  if (!svc || svc.role !== "org_admin")
    return <>{head}<div className="wrap pg-body"><section className="gate flat"><h2>기관 관리자만 쓸 수 있는 화면입니다</h2><div className="acts">{back}</div></section></div></>;
  const ROLE = { teacher: "교사", viewer: "열람 전용", org_admin: "기관 관리자" } as const;
  const label = (id: string) => {
    const m = members?.items.find((x) => x.subject_id === id);
    return m ? (m.display_name || `구성원 ${m.member_id}`) : "확인 안 된 구성원";
  };

  return (
    <>
      {head}
      <div className="wrap pg-body pro">
        <div className="pro-sechd">{back}</div>
        <section className="pro-sec" aria-labelledby="mem-h">
          <h2 id="mem-h">구성원 <span className="num">{members?.items.length ?? 0}</span></h2>
          <div className="tblwrap">
            <table className="tb">
              <thead><tr><th scope="col">구성원</th><th scope="col">역할</th><th scope="col">상태</th></tr></thead>
              <tbody>
                {(members?.items ?? []).map((m) => (
                  <tr key={m.subject_id}><th scope="row">{m.display_name || `구성원 ${m.member_id}`}</th><td>{ROLE[m.role]}</td><td>{m.status === "active" ? "이용 중" : "해제됨"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pro-note">구성원 초대·해제·역할 변경은 에듀터치 마이페이지 &lsquo;소속 기관 &gt; 구성원 관리&rsquo;에서 합니다.</p>
        </section>
        <section className="pro-sec" aria-labelledby="asg-h">
          <h2 id="asg-h">학생 담당 <span className="num">{students.length}</span></h2>
          <div className="tblwrap">
            <table className="tb pro-students">
              <thead><tr><th scope="col">학생</th><th scope="col">지금 담당</th><th scope="col">담당 변경</th><th scope="col">보관</th></tr></thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.student_id}>
                    <th scope="row">{s.display_name}<small>{[s.class_label, s.class_number ? `${s.class_number}번` : null].filter(Boolean).join(" ")}</small></th>
                    <td>{s.assigned_teacher_ids.length ? s.assigned_teacher_ids.map(label).join(", ") : "없음"}</td>
                    <td><AssignForm orgId={svc!.org_id} studentId={s.student_id} version={s.version} assigned={s.assigned_teacher_ids} members={members?.items ?? []} idem={crypto.randomUUID()} /></td>
                    <td><ArchiveForm orgId={svc!.org_id} studentId={s.student_id} version={s.version} idem={crypto.randomUUID()} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pro-note">교사가 바뀌거나 해제돼도 학생 기록은 기관에 남습니다. 보관한 학생은 목록에서 숨겨지고, 계약 학생 수는 돌아오지 않습니다.</p>
        </section>
      </div>
    </>
  );
}
