import { NextResponse, type NextRequest } from "next/server";
import { isEdutouchAdmin } from "@/lib/admin";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase/server";

/*
  에듀터치 관리자 페이지(/admin/jeongsi/corrections)의 '승인' 버튼이 보내는 곳(2026-10-28 사용자 결정).
  정정권 승인(score-input.correction.grant)은 relay 토큰이 있는 정시터치 서버만 부를 수 있어 여기서 한다.
  요청 줄(에듀터치 public.jeongsi_correction_requests)을 관리자 세션으로 읽어 회원·시험·단계·요청 시 입력 판을 그대로 쓰고,
  접수 번호는 jcr-<요청 번호>, 멱등키는 줄에 저장된 grant_key 라 다시 눌러도 정정권이 두 번 생기지 않는다.
  서버는 관리자 aal2(OTP)·판 일치·단계당 1회를 다시 확인한다. 성공하면 줄을 '승인'으로 바꾸고 관리자 페이지로 돌아간다.
*/

const BACK = "/admin/jeongsi/corrections";
const SAME_SITE = new Set(["https://edutouch.co.kr", "https://www.edutouch.co.kr"]);

function back(request: NextRequest, id: string, result: string) {
  const origin = request.headers.get("origin");
  const base = origin && SAME_SITE.has(origin) ? origin : "https://edutouch.co.kr";
  return NextResponse.redirect(`${base}${BACK}?id=${encodeURIComponent(id)}&r=${encodeURIComponent(result)}`, 303);
}

export async function POST(request: NextRequest) {
  // 다른 사이트에서 관리자 브라우저로 보낸 요청을 막는다(같은 에듀터치 주소에서 온 양식만)
  const origin = request.headers.get("origin");
  if (!origin || !SAME_SITE.has(origin)) return new NextResponse("forbidden", { status: 403 });
  const fd = await request.formData().catch(() => null);
  const id = String(fd?.get("id") ?? "");
  if (!/^\d{1,18}$/.test(id)) return back(request, id, "invalid_request");
  if (!(await isEdutouchAdmin())) return back(request, id, "not_admin");

  const supabase = await supabaseServer();
  if (!supabase) return back(request, id, "unavailable");
  const { data: row } = await supabase
    .from("jeongsi_correction_requests")
    .select("id, user_id, exam_id, stage, entry_version, status, grant_key")
    .eq("id", Number(id))
    .maybeSingle();
  if (!row) return back(request, id, "not_found");
  if (row.status !== "pending") return back(request, id, "not_pending");

  try {
    const r = await source().grantScoreCorrection(
      await getCaller(),
      { subject_id: row.user_id, exam_id: row.exam_id, stage: row.stage, ticket_ref: `jcr-${row.id}`, expected_version: row.entry_version },
      row.grant_key,
    );
    if (!r.ok) return back(request, id, r.code);
  } catch (e) {
    if (e instanceof AccessDenied) return back(request, id, e.code);
    if (e instanceof ConnectionError) return back(request, id, `unavailable:${e.code}`);
    throw e;
  }

  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("jeongsi_correction_requests")
    .update({ status: "approved", handled_by: me.user?.id ?? null, handled_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending");
  // 에듀터치 관리자 작업 기록(본체 lib/admin/guard logAdmin 과 같은 표·칸). 실패해도 승인은 그대로
  if (me.user) {
    await supabase
      .from("admin_logs")
      .insert({ actor_id: me.user.id, action: "jeongsi.correction.approve", target: "jeongsi_correction_requests", target_id: String(row.id), detail: { stage: row.stage }, ip: request.headers.get("x-edutouch-client-ip"), user_agent: request.headers.get("user-agent") })
      .then(() => undefined, () => undefined);
  }
  return back(request, id, error ? "granted_not_recorded" : "ok");
}
