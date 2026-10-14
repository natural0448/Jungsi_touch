import {
  pythonDecimalText,
  pythonDefaultStrJsonSha256,
} from "../../supabase/functions/_shared/jungsi/domain/python_json_digest.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal } from "./fixture.ts";
Deno.test("Python Decimal compatibility keeps sign scale and scientific notation without Number conversion", () => {
  const rows = {
    "1e0": "1",
    "1.20": "1.20",
    "1.20e2": "120",
    "-0e0": "-0",
    "0e3": "0E+3",
    "0.0000000": "0E-7",
    "0.000001": "0.000001",
    "0.0000001": "1E-7",
    "123e-9": "1.23E-7",
    "9007199254740993e0": "9007199254740993",
  };
  for (const [a, b] of Object.entries(rows)) equal(pythonDecimalText(a), b);
});
Deno.test("Python default=str model digest is explicit and differs from source numeric serialization", async () => {
  const value = { c: new JsonFloat("1e-7"), b: 2, a: new JsonFloat("1.20") },
    text = '{"a":"1.20","b":2,"c":"1E-7"}';
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  const expected = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("");
  equal(await pythonDefaultStrJsonSha256(value), expected);
  assert(await nativeJsonSha256(value) !== expected);
});
