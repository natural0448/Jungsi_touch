import { ContractError } from "../../supabase/functions/_shared/jungsi/domain/exact.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal } from "./fixture.ts";
Deno.test("private JSON serialization preserves decimal lexical value nested arrays and exact integers", () => {
  const v = { n: 9007199254740993n, decimal: new JsonFloat("2.0"), items: [null, [], false] };
  equal(nativeJsonText(v), '{"n":9007199254740993,"decimal":2.0,"items":[null,[],false]}');
  const c = cloneNativeJson(v);
  assert(c.n === 9007199254740993n);
  assert(c.decimal instanceof JsonFloat);
  equal(c.decimal.lexeme, "2.0");
  assert(c !== v);
  assert(c.items !== v.items);
});
Deno.test("private JSON cannot serialize Dates cyclic sparse undefined unsafe or nonfinite values", () => {
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  for (
    const v of [
      new Date(0),
      cyclic,
      new Array(1),
      { value: undefined },
      NaN,
      Infinity,
      9007199254740992,
      new JsonFloat("NaN"),
    ]
  ) {
    let e: unknown;
    try {
      nativeJsonText(v);
    } catch (x) {
      e = x;
    }
    assert(e instanceof ContractError);
  }
});
Deno.test("private canonical digest sorts by Unicode code point and preserves native numeric type", async () => {
  equal(nativeJsonText({ "😀": 1, "\ue000": 2, a: 3 }, true), '{"a":3,"":2,"😀":1}');
  equal(await nativeJsonSha256({ b: 2, a: 1 }), await nativeJsonSha256({ a: 1, b: 2 }));
  assert(await nativeJsonSha256({ a: 2 }) !== await nativeJsonSha256({ a: new JsonFloat("2.0") }));
});

Deno.test("explicit SQL decimal with integral text retains its declared numeric type", () => {
  const cloned = cloneNativeJson({ numeric: new JsonFloat("2") });
  assert(cloned.numeric instanceof JsonFloat);
  equal(cloned.numeric.lexeme, "2.0");
});
