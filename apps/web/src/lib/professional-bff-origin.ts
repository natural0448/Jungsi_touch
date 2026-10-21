/** Pure origin decision. The server generates proof only after this decision succeeds. */
export type ProfessionalMutationOrigin =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly status: 403 | 503; readonly code: "professional_csrf_failed" | "pro_bff_origin_not_configured" };

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
