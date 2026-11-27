/** Pure origin decision. The server generates proof only after this decision succeeds. */
export type ProfessionalMutationOrigin =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly status: 403 | 503; readonly code: "professional_csrf_failed" | "pro_bff_origin_not_configured" };

/**
 * 화면을 그리는 중에 보내는 전문가용 계산 요청(2026-11-23, ③ 가능성 보기의 학교별 판정·검색 pro.university.analyze).
 * 저장된 값을 바꾸지 않고 응답에만 싣는 요청이라 설정된 BFF 출처만 확인한다(아래 설명).
 */
export function professionalRenderOrigin(
  configured: string | undefined,
  incoming: Pick<Headers, "get">,
): ProfessionalMutationOrigin {
  try {
    if (!configured) throw new Error("missing");
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.origin !== configured || url.username || url.password) throw new Error("invalid");
  } catch {
    return { ok: false, status: 503, code: "pro_bff_origin_not_configured" };
  }
  // 페이지 요청은 본체가 정시터치로 넘기며 Origin·Sec-Fetch-Site 를 바꿔 붙인다(2026-11-23 운영: 두 번 모두 professional_csrf_failed 로
  // ③ 판정 요청이 보내지지 않았다). 이 요청은 저장을 바꾸지 않는 계산이고, 로그인·기관·담당 학생은 전문가용 서버가 매번 다시
  // 확인하므로 브라우저 출처 표시는 보지 않는다(쓰기 요청은 professionalMutationOrigin 그대로)
  void incoming;
  return { ok: true, origin: configured };
}

export function professionalMutationOrigin(
  configured: string | undefined,
  incoming: Pick<Headers, "get">,
): ProfessionalMutationOrigin {
  try {
    if (!configured) throw new Error("missing");
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.origin !== configured || url.username || url.password) throw new Error("invalid");
  } catch {
    return { ok: false, status: 503, code: "pro_bff_origin_not_configured" };
  }
  // Read the original browser request, not a client-supplied 'verified' flag.
  if (incoming.get("origin") !== configured) return { ok: false, status: 403, code: "professional_csrf_failed" };
  const site = incoming.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site") return { ok: false, status: 403, code: "professional_csrf_failed" };
  return { ok: true, origin: configured };
}
