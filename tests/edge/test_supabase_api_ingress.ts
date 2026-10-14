import { syncPromise } from "./fixture.ts";
import { createSupabaseApiIngress } from "../../supabase/functions/_shared/jungsi/infrastructure/supabase_api_ingress.ts";
import { equal } from "./fixture.ts";
Deno.test("Supabase ingress removes only its exact function prefix and preserves query and headers", async () => {
  let calls = 0;
  const handler = createSupabaseApiIngress((request) =>
    syncPromise(() => {
      calls++;
      const url = new URL(request.url);
      equal(url.pathname, "/api/v1/offerings/search");
      equal(url.search, "?search=%EA%B0%80&limit=1");
      equal(request.headers.get("Authorization"), "Bearer SYNTHETIC-user");
      equal(request.headers.get("X-Jungsi-Relay-Token"), "SYNTHETIC-relay");
      return new Response("SYNTHETIC");
    })
  );
  const result = await handler(
    new Request(
      "https://synthetic.invalid/jungsi-api/api/v1/offerings/search?search=%EA%B0%80&limit=1",
      {
        headers: {
          Authorization: "Bearer SYNTHETIC-user",
          "X-Jungsi-Relay-Token": "SYNTHETIC-relay",
        },
      },
    ),
  );
  equal(result.status, 200);
  equal(calls, 1);
});
Deno.test("Supabase ingress preserves a write stream and idempotency without parsing it", async () => {
  const body = '{"SYNTHETIC":9007199254740993}';
  const handler = createSupabaseApiIngress(async (request) => {
    equal(request.method, "PUT");
    equal(new URL(request.url).pathname, "/api/v1/reports/SYNTHETIC-r/shortlist/SYNTHETIC-o");
    equal(request.headers.get("Idempotency-Key"), "SYNTHETIC-key");
    equal(await request.text(), body);
    return new Response(null, { status: 204 });
  });
  equal(
    (await handler(
      new Request(
        "https://synthetic.invalid/jungsi-api/api/v1/reports/SYNTHETIC-r/shortlist/SYNTHETIC-o",
        {
          method: "PUT",
          headers: { "Idempotency-Key": "SYNTHETIC-key" },
          body,
        },
      ),
    )).status,
    204,
  );
});
Deno.test("Supabase ingress rejects canonical or other function prefixes without calling application", async () => {
  let calls = 0;
  const handler = createSupabaseApiIngress(() =>
    syncPromise(() => {
      calls++;
      return new Response();
    })
  );
  for (
    const path of [
      "/api/v1/me",
      "/functions/v1/jungsi-api/api/v1/me",
      "/jungsi-apix/api/v1/me",
      "/official-history-display/api/v1/me",
      "/jungsi-api/../api/v1/me",
    ]
  ) {
    const response = await handler(new Request("https://synthetic.invalid" + path));
    equal(response.status, 404);
    equal(response.headers.get("Cache-Control"), "no-store");
  }
  equal(calls, 0);
});
