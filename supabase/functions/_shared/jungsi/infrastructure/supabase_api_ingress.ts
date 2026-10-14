/** Supabase forwards the function-name prefix; application routes remain /api/v1. */
import { AccessError } from "../application/access.ts";
import { safeFailure } from "./auth_relay.ts";
export const JUNGSI_API_FUNCTION_NAME = "jungsi-api";
export function createSupabaseApiIngress(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  if (typeof handler !== "function") throw new AccessError("security_policy_unavailable", 503);
  const prefix = "/" + JUNGSI_API_FUNCTION_NAME;
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith(prefix + "/")) {
        throw new AccessError("route_not_found", 404);
      }
      url.pathname = url.pathname.slice(prefix.length);
      // Preserve the stream, method, user Bearer, server relay and cancellation signal.
      return await handler(new Request(url, request));
    } catch (error) {
      return safeFailure(error, crypto.randomUUID());
    }
  };
}
