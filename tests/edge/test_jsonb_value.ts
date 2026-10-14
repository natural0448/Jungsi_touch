/** Invented derived JSONB inputs only; immutable source spellings remain separate. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { nativeJsonText } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import {
  JsonFloat,
  parseNativeJson,
} from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { nativeJsonbText } from "../../supabase/functions/_shared/jungsi/infrastructure/jsonb_value.ts";
import { assert, equal } from "./fixture.ts";

Deno.test("derived JSONB decimals expand exactly and always retain a float marker", () => {
  const vectors: Record<string, string> = {
    "1e0": "1.0",
    "1e3": "1000.0",
    "-0e0": "0.0",
    "0e-3": "0.000",
    "1e-3": "0.001",
    "1.20e2": "120.0",
    "1.20e1": "12.0",
    "1.20e0": "1.20",
    "0.00120e3": "1.20",
    "0.001e3": "1.0",
    "-12.3e-2": "-0.123",
    "9007199254740993e0": "9007199254740993.0",
    "1e+0003": "1000.0",
    "0.0": "0.0",
    "-0.00": "0.00",
    "2.00": "2.00",
    "0.001e9": "1000000.0",
  };
  for (const [input, expected] of Object.entries(vectors)) {
    const value = new JsonFloat(input);
    equal(nativeJsonbText(value, 1000), expected);
    assert(parseNativeJson(expected) instanceof JsonFloat);
    equal(value.lexeme, input);
  }
});
Deno.test("derived decimal conversion does not rewrite strings keys or integers", () => {
  const value = parseNativeJson(
    '{"1e0":"1e3","escaped":"a\\"1e0","unicode":"한국어","nested":[1e0,1,9007199254740993,null,false,[],{"x":-0e0}]}',
  );
  const source = nativeJsonText(value);
  const derived = nativeJsonbText(value, 1000);
  equal(
    source,
    '{"1e0":"1e3","escaped":"a\\"1e0","unicode":"한국어","nested":[1e0,1,9007199254740993,null,false,[],{"x":-0e0}]}',
  );
  equal(
    derived,
    '{"1e0":"1e3","escaped":"a\\"1e0","unicode":"한국어","nested":[1.0,1,9007199254740993,null,false,[],{"x":0.0}]}',
  );
  equal(nativeJsonText(value), source);
});
Deno.test("derived decimal expansion enforces exact total UTF8 reservation before allocation", () => {
  const value = parseNativeJson('{"text":"한국어","n":1e3,"m":1e0}');
  const expected = '{"text":"한국어","n":1000.0,"m":1.0}';
  const size = new TextEncoder().encode(expected).byteLength;
  equal(nativeJsonbText(value, size), expected);
  for (const max of [size - 1, 0, -1, NaN, Infinity, 1.5]) {
    let e: unknown;
    try {
      nativeJsonbText(value, max);
    } catch (x) {
      e = x;
    }
    assert(e instanceof AccessError);
    equal(e.code, "storage_parameters_invalid");
  }
  equal(nativeJsonbText(new JsonFloat("0.001e9"), 9), "1000000.0");
});
Deno.test("oversized exponent and invalid native value fail before any SQL operation", () => {
  for (
    const value of [
      new JsonFloat("1e10000000000000"),
      new JsonFloat("1e-10000000000000"),
      new JsonFloat("1e10000"),
      new JsonFloat("NaN"),
      { v: undefined },
      new Date(0),
    ]
  ) {
    let e: unknown;
    try {
      nativeJsonbText(value, 100);
    } catch (x) {
      e = x;
    }
    assert(e instanceof AccessError);
    equal(e.code, "storage_parameters_invalid");
  }
});
