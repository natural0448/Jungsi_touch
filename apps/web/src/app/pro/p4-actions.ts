"use server";

import { revalidatePath } from "next/cache";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import { proSource } from "@/lib/api/pro-source";
import { loadPrintExtras } from "@/app/admissions/possibilities/print-extras";
import type { Extras } from "@/app/admissions/possibilities/extras-actions";
import { FAVORITE_LIMIT } from "@/lib/favorites";
import { setProFavorite } from "@/lib/pro-favorites";
import { loadProForAction, proP4 } from "@/lib/pro-p4";
import { PICK_GROUP_LIMIT, PICK_TOTAL_LIMIT } from "@/lib/picked-view";

/*
  전문가용 학생 탭 ②·③에서 개인용과 같은 별표·담기·펼친 상세 버튼이 눌렸을 때(2026-11-23). 버튼이 보낸 pro_org·pro_student 로
  학생을 다시 읽어(전문가용 서버가 기관·담당을 확인) 그 학생 쪽으로 저장한다. 화면이 보낸 모집단위 이름·군은 믿지 않고
  전문가용 서버 카탈로그에서 다시 읽는다.
*/
type Result = { error: string | null };
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function scopeOf(fd: FormData) {
  const org = String(fd.get("pro_org") ?? ""), student = String(fd.get("pro_student") ?? ""), report = String(fd.get("pro_report") ?? "");
  const id = String(fd.get("offering_id") ?? "");
  return ID.test(org) && ID.test(student) && ID.test(id) ? { org, student, report, id } : null;
}
function failText(e: unknown, failed: string): string | null {
  if (e instanceof AccessDenied) return `${failed}. ${e.status === 401 ? "다시 로그인해 주세요." : "이 학생을 볼 수 있는 권한을 확인해 주세요."}`;
  if (e instanceof ConnectionError) return `${failed}. 잠시 뒤 다시 눌러 주세요.`;
  return null;
}

/** 별표(학생별 즐겨찾기) */
export async function proToggleFavorite(fd: FormData): Promise<Result> {
  const s = scopeOf(fd);
  const on = fd.get("on") === "1";
  const failed = on ? "즐겨찾기에 넣지 못했습니다" : "즐겨찾기에서 빼지 못했습니다";
  if (!s) return { error: "화면을 새로 열어 다시 눌러 주세요." };
  try {
    const caller = await getCaller();
    const got = await loadProForAction(caller, s.org, s.student, s.report);
    if (got.kind !== "ok") return { error: `${failed}. 화면을 새로 열어 다시 눌러 주세요.` };
    const v = got.view;
    if (!v.canEdit) return { error: "담당 교사만 즐겨찾기를 바꿀 수 있습니다." };
    let offering = { offering_id: s.id, academic_year: 0, university_id: "", university_name: "", campus: null, department: "", track: null, group: "", region: null, wildcard_group: null } as import("@/lib/dto").OfferingDto;
    if (on) {
      const r = await proP4(caller, v, { offering_ids: [s.id] });
      const item = r.search?.items?.find((o) => o.offering_id === s.id);
      if (!item) return { error: r.failed === "no_report" ? "성적을 먼저 저장해 주세요." : "지금 목록에서 찾을 수 없는 모집단위입니다." };
      offering = item;
    }
    const res = await setProFavorite(v.svc.org_id, v.student.student_id, offering, on);
    if (res === "limit") return { error: `즐겨찾기는 학생마다 ${FAVORITE_LIMIT}개까지 넣을 수 있습니다. 하나를 빼고 다시 눌러 주세요.` };
    if (res === "signin") return { error: "다시 로그인해 주세요." };
    if (res === "failed") return { error: `${failed}. 잠시 뒤 다시 눌러 주세요.` };
  } catch (e) {
    const t = failText(e, failed);
    if (t) return { error: t };
    throw e;
  }
  revalidatePath("/pro", "layout");
  return { error: null };
}

/** 담기·빼기(학생 리포트의 담은 학교, pro.bookmark). 전체 15곳·같은 군 5곳(개인용과 같은 한도) */
export async function proTogglePick(fd: FormData): Promise<Result> {
  const s = scopeOf(fd);
  const selected = fd.get("selected") === "1";
  const failed = selected ? "담지 못했습니다" : "빼지 못했습니다";
  if (!s) return { error: `${failed}. 화면을 새로 열어 다시 눌러 주세요.` };
  try {
    const caller = await getCaller();
    const got = await loadProForAction(caller, s.org, s.student, s.report);
    if (got.kind !== "ok" || !got.view.shown) return { error: `${failed}. 성적을 먼저 저장해 주세요.` };
    const v = got.view, shown = got.view.shown;
    if (!v.canEdit) return { error: "담당 교사만 담을 수 있습니다." };
    const picked = Object.entries(shown.published_result.shortlist ?? {}).filter(([, e]) => e?.selected).map(([id]) => id);
    const src = proSource();
    if (selected) {
      if (picked.includes(s.id)) return { error: null };
      if (picked.length >= PICK_TOTAL_LIMIT) return { error: `핵심 지원 학교는 ${PICK_TOTAL_LIMIT}곳까지 담을 수 있습니다. 담은 곳 하나를 빼고 다시 담아 주세요.` };
      // 같은 모집군 5곳 — 담은 곳과 새로 담을 곳의 군을 전문가용 서버 카탈로그에서 읽는다
      const r = await proP4(caller, v, { offering_ids: [...picked, s.id] });
      const items = r.search?.items ?? [];
      const group = items.find((o) => o.offering_id === s.id)?.group;
      if (!group) return { error: "지금 목록에서 찾을 수 없는 모집단위입니다." };
      // 카탈로그는 한 모집단위를 여러 줄(지표별)로 둘 수 있어 번호로 한 번씩만 센다(2026-11-23: 가군 3곳인데 5곳 한도로 막혔다)
      const sameGroup = new Set(items.filter((o) => picked.includes(o.offering_id) && o.group === group).map((o) => o.offering_id));
      if (sameGroup.size >= PICK_GROUP_LIMIT) {
        return { error: `같은 모집군에는 ${PICK_GROUP_LIMIT}개까지 담을 수 있습니다. 담은 곳 하나를 빼고 다시 담아 주세요.` };
      }
      const res = await src.addBookmark(caller, v.svc.org_id, v.student.student_id, shown.report_id, s.id, crypto.randomUUID());
      if (!res.ok) return { error: `${failed}. 잠시 뒤 다시 눌러 주세요. (문의 번호 ${res.code})` };
    } else {
      const res = await src.removeBookmark(caller, v.svc.org_id, v.student.student_id, shown.report_id, s.id, crypto.randomUUID());
      if (!res.ok && res.code !== "professional_bookmark_not_found") return { error: `${failed}. 잠시 뒤 다시 눌러 주세요. (문의 번호 ${res.code})` };
    }
  } catch (e) {
    const t = failText(e, failed);
    if (t) return { error: t };
    throw e;
  }
  revalidatePath("/pro", "layout");
  return { error: null };
}

/**
 * 펼친 모집단위의 2027 모집 정보·발행 기준·1페이지 학년도별 성적(개인용 loadExtras 와 같은 자료).
 * 학생 성적은 쓰지 않는다. 선생님 계정에 모집 정보 조회 권한이 없으면 그 칸은 '미공개'로 그린다(인쇄본과 같은 방법).
 */
export async function loadProExtras(offeringId: string, university = ""): Promise<Extras> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(offeringId) || typeof university !== "string" || university.length > 100) return { ok: false, code: "invalid_request" };
  // 2026-11-24: 선생님 계정의 개인용 서버 조회가 요청 한도(429) 재시도에 묶여 펼친 상세가 끝없이 '모으고 있습니다'였다.
  // 6초 안에 못 받으면 모집 정보·발행 기준은 '미공개'로 그리고 판정 카드는 바로 보인다(인쇄본과 같은 확정 표시)
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 6000));
  const got = await Promise.race([loadPrintExtras(source(), await getCaller(), [{ offering_id: offeringId, university_name: university }]), timeout]);
  return got?.[offeringId] ?? { ok: false, code: "request_timeout" };
}
