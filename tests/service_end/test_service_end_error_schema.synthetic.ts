import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import schemas from "../../src/jungsi_touch/application/public_response_schemas.json" with {
  type: "json",
};
function assert(v: unknown) {
  if (!v) throw new Error("synthetic assertion failed");
}
const policies = schemas.operations.map(({ id, contract_ref }) => ({ id, contract_ref }));
const response = {
  status: "error",
  error: { code: "service_ended" },
  request_id: "SYNTHETIC-request",
};
Deno.test("legacy error schema without service ended rejects the code", () => {
  const legacy = structuredClone(schemas);
  legacy.schemas.safe_error_code.enum = legacy.schemas.safe_error_code.enum.filter((value) =>
    value !== "service_ended"
  );
  let rejected = false;
  try {
    new PublicResponseProjection(legacy, policies).auxiliary("error", response);
  } catch (e) {
    assert(e instanceof AccessError);
    rejected = true;
  }
  assert(rejected);
});
Deno.test("integrated error schema permits the declared service ended code", () => {
  const projected = new PublicResponseProjection(schemas, policies).auxiliary("error", response);
  assert(JSON.stringify(projected) === JSON.stringify(response));
});
