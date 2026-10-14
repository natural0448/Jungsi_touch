/** Invented values exercise the production projection algorithm with small contract fixtures. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  publicJsonText,
  PublicResponseProjection,
} from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { assert, equal } from "./fixture.ts";

const EXPECTED = [{ id: "session.read", contract_ref: "SYNTHETIC" }];
function fixture() {
  const text = { type: "string", nullable: false }, number = { type: "number", nullable: false };
  const leaf = {
    type: "object",
    nullable: false,
    properties: { title: text, value: number },
    required: ["title", "value"],
    optional: [] as string[],
  };
  const standard = {
    type: "object",
    nullable: false,
    properties: {
      items: { type: "array", nullable: false, items: { ref: "leaf", nullable: false } },
      count: { type: "integer", nullable: false },
      missing: { type: "string", nullable: true },
    },
    required: ["items", "count", "missing"],
    optional: [] as string[],
  };
  const paid = {
    ...standard,
    properties: { ...standard.properties, paid_result: text },
    optional: ["paid_result"],
  };
  const root = { ref: "standard", nullable: false };
  return {
    format: "jungsi.public-response-schemas/v1",
    operations: [{
      ...EXPECTED[0],
      roots: { standard: root, paid: { ref: "paid", nullable: false } },
    }],
    auxiliary_roots: { error: root, readiness: root },
    schemas: { leaf, standard, paid },
  };
}
function denied(run: () => unknown) {
  let error: unknown;
  try {
    run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, "security_policy_unavailable");
  equal(error.http, 503);
}
const result = () => ({
  items: [{ title: "SYNTHETIC", value: 1, token: "SYNTHETIC-PRIVATE" }],
  count: 0,
  missing: null,
  secret: "SYNTHETIC-PRIVATE",
  paid_result: "SYNTHETIC-PAID",
});
Deno.test("public projection removes unapproved fields recursively for standard members", () => {
  const p = new PublicResponseProjection(fixture(), EXPECTED);
  equal(p.project("session.read", "standard", result()), {
    items: [{ title: "SYNTHETIC", value: 1 }],
    count: 0,
    missing: null,
  });
});
Deno.test("public projection keeps only the paid root's approved extra field", () => {
  const p = new PublicResponseProjection(fixture(), EXPECTED);
  equal(p.project("session.read", "paid", result()), {
    items: [{ title: "SYNTHETIC", value: 1 }],
    count: 0,
    missing: null,
    paid_result: "SYNTHETIC-PAID",
  });
});
Deno.test("public projection preserves zero and null and rejects missing required fields", () => {
  const p = new PublicResponseProjection(fixture(), EXPECTED), row = result();
  equal((p.project("session.read", "standard", row) as { count: number }).count, 0);
  denied(() => p.project("session.read", "standard", { items: row.items, count: 0 }));
});
Deno.test("public projection rejects bool as count and integer-like float wrappers", () => {
  const p = new PublicResponseProjection(fixture(), EXPECTED);
  for (const count of [true, "0", new JsonFloat("0.0"), Number.NaN, 9007199254740992]) {
    denied(() => p.project("session.read", "standard", { ...result(), count }));
  }
});
Deno.test("public wire serialization preserves large integer and decimal literal types", () => {
  const p = new PublicResponseProjection(fixture(), EXPECTED);
  const projected = p.project("session.read", "standard", {
    ...result(),
    count: 9007199254740993n,
    items: [{ title: "SYNTHETIC", value: new JsonFloat("1.00") }],
  });
  equal(
    publicJsonText(projected),
    '{"items":[{"title":"SYNTHETIC","value":1.00}],"count":9007199254740993,"missing":null}',
  );
});
Deno.test("public projection rejects nonfinite numbers and invalid decimal injection", () => {
  const p = new PublicResponseProjection(fixture(), EXPECTED);
  for (
    const value of [
      Infinity,
      new JsonFloat("1e9999"),
      new JsonFloat("0x10"),
      new JsonFloat('0,"secret":1'),
    ]
  ) {
    denied(() =>
      p.project("session.read", "standard", { ...result(), items: [{ title: "SYNTHETIC", value }] })
    );
  }
});
Deno.test("public projection owns an independent registry snapshot", () => {
  const source = fixture(), p = new PublicResponseProjection(source, EXPECTED);
  source.schemas.standard.required.push("secret");
  equal((p.project("session.read", "standard", result()) as { count: number }).count, 0);
});
Deno.test("public registry rejects operation mismatch duplicate and absent coverage", () => {
  const a = fixture();
  a.operations.push(a.operations[0]);
  denied(() => new PublicResponseProjection(a, EXPECTED));
  denied(() =>
    new PublicResponseProjection(fixture(), [{ id: "other", contract_ref: "SYNTHETIC" }])
  );
  denied(() => new PublicResponseProjection(fixture(), []));
});
Deno.test("public registry rejects cycles and malformed required optional coverage", () => {
  const a = fixture();
  (a.schemas.leaf.properties.value as unknown) = { ref: "leaf", nullable: false };
  denied(() => new PublicResponseProjection(a, EXPECTED));
  const b = fixture();
  b.schemas.standard.optional.push("count");
  denied(() => new PublicResponseProjection(b, EXPECTED));
});
Deno.test("public projection rejects unknown operation and custom class objects", () => {
  const p = new PublicResponseProjection(fixture(), EXPECTED);
  denied(() => p.project("unknown", "standard", result()));
  denied(() => p.project("session.read", "standard", new Date()));
});
Deno.test("public auxiliary roots use the same recursive restrictions", () => {
  const p = new PublicResponseProjection(fixture(), EXPECTED);
  equal(p.auxiliary("error", result()), p.project("session.read", "standard", result()));
});
Deno.test("public serializer rejects undefined and unapproved class values", () => {
  denied(() => publicJsonText(undefined));
  denied(() => publicJsonText(new Date()));
  denied(() => publicJsonText(new JsonFloat("NaN")));
});
