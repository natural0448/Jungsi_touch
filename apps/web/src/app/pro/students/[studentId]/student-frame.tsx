import Link from "@/components/link";
import type { ProStudentDto } from "@/lib/pro-dto";
import { proTabHref } from "@/lib/pro-p4";

/*
  전문가용 학생 탭(2026-11-23 대표님 결정): ① 성적 입력 → ② 유리한 대학 찾기 → ③ 전체 대학·학과 가능성 보기 → ④ 정시 리포트.
  ②·③은 개인용 3·4페이지와 같은 화면이고, ③에서 담은 학교와 분석은 ④에 모인다.
*/
export type ProTab = "" | "favorable" | "possibilities" | "report";
const TABS: { tab: ProTab; label: string }[] = [
  { tab: "", label: "① 성적 입력" },
  { tab: "favorable", label: "② 유리한 대학 찾기" },
  { tab: "possibilities", label: "③ 전체 대학·학과 가능성 보기" },
  { tab: "report", label: "④ 정시 리포트" },
];

/** 화면 위 '지금 보는 학생' 띠 — 학생을 잘못 고른 채 입력·담기하지 않도록 고정한다 */
export function StudentBar({ student, orgName }: { student: ProStudentDto; orgName: string }) {
  const cls = [student.class_label, student.class_number ? `${student.class_number}번` : null].filter(Boolean).join(" ");
  return (
    <div className="pro-student-bar" role="status" aria-label="지금 보는 학생">
      <div className="wrap">
        <span className="lab">지금 보는 학생</span>
        <b>{student.display_name}</b>
        {cls && <span className="cls">{cls}</span>}
        <span className="org">{orgName}</span>
      </div>
    </div>
  );
}

export function StudentTabs({ orgId, studentId, active }: { orgId: string; studentId: string; active: ProTab }) {
  return (
    <nav className="pro-tabs" aria-label="학생 화면">
      <div className="wrap">
        {TABS.map((t) => (
          <Link key={t.tab || "input"} href={proTabHref(orgId, studentId, t.tab)} className={t.tab === active ? "on" : undefined} aria-current={t.tab === active ? "page" : undefined} prefetch={false}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
