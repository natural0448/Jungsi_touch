import "server-only";
import { cookies } from "next/headers";

/*
  내 리포트 번호(report_id)를 이 브라우저에 기억해 둔다.
  overall.analyze 가 돌려준 번호를 다음 방문에 report.read 로 다시 읽기 위한 표시일 뿐이며,
  남의 번호를 넣어도 서버가 소유권을 확인해 같은 404 로 막는다(라우팅 명세 '권한과 응답 경계').
  다른 기기에서 내 리포트를 찾는 API 는 아직 없다(service_spec pending).
*/

const NAME = "jt_report_id";

export async function getReportId(): Promise<string | null> {
  const v = (await cookies()).get(NAME)?.value;
  return v && /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null;
}

export async function setReportId(id: string) {
  (await cookies()).set(NAME, id, { path: "/jeongsi", maxAge: 60 * 60 * 24 * 180, sameSite: "lax", httpOnly: true });
}
