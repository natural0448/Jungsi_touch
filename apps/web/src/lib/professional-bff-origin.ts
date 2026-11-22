/** Pure origin decision. The server generates proof only after this decision succeeds. */
export type ProfessionalMutationOrigin =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly status: 403 | 503; readonly code: "professional_csrf_failed" | "pro_bff_origin_not_configured" };

/**
 * 화면을 그리는 중에 보내는 전문가용 계산 요청(2026-11-23, ③ 가능성 보기의 학교별 판정·검색 pro.university.analyze).
 * 저장된 값을 바꾸지 않고 응답에만 싣는 요청이라, 페이지 요청에는 없는 Origin 대신 페이지 요청의 출처 표시(Sec-Fetch-Site)가
 * 같은 사이트이거나 주소 직접 입력(none)일 때만 보낸다. 다른 사이트에서 끌어온 요청이면 보내지 않는다.
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
  // 페이지 요청은 본체가 정시터치로 넘기며 Origin 을 바꿔 붙일 수 있어(2026-11-23 운영: ③ 판정 요청이 보내지지 않았다)
  // Origin 은 보지 않고 브라우저의 출처 표시(Sec-Fetch-Site)만 본다
  const site = incoming.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site" && site !== "none") return { ok: false, status: 403, code: "professional_csrf_failed" };
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
