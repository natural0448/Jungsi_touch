/** Invented SQL-wire examples; no live school data or database mutation. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import {
  requireSqlTextColumns,
  sqlArrayText,
  sqlDateText,
  sqlDecimalText,
  sqlIntegerText,
  sqlJsonText,
  sqlObjectText,
  sqlUtcText,
} from "../../supabase/functions/_shared/jungsi/infrastructure/sql_values.ts";
import { assert, equal } from "./fixture.ts";
function denied(run: () => unknown) {
  let error: unknown;
  try {
    run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, "storage_result_invalid");
  equal(error.http, 503);
}
Deno.test("SQL text preserves integer float huge integer and precise decimal as distinct native types", () => {
  const x = sqlObjectText(
    '{"i":2,"f":2.0,"n":9007199254740993,"d":0.123456789012345678901234567890}',
  );
  equal(x.i, 2);
  assert(x.f instanceof JsonFloat);
  equal(x.f.lexeme, "2.0");
  assert(x.n === 9007199254740993n);
  assert(x.d instanceof JsonFloat);
  equal(x.d.lexeme, "0.123456789012345678901234567890");
});
Deno.test("SQL JSON arrays retain order empty null bool and nested native arrays", () => {
  const x = sqlArrayText('[[],null,false,{"items":[0,2.0,"2"]}]');
  equal(x.slice(0, 3), [[], null, false]);
  const items = (x[3] as Record<string, unknown>).items as unknown[];
  equal(items[0], 0);
  assert(items[1] instanceof JsonFloat);
  equal(items[2], "2");
});
Deno.test("SQL JSON string containing array syntax remains a string", () => {
  equal(sqlJsonText('"[1,2]"'), "[1,2]");
  denied(() => sqlArrayText('"[1,2]"'));
  denied(() => sqlObjectText("[1,2]"));
});
Deno.test("SQL already parsed objects arrays numbers and Dates cannot be promoted to original payload", () => {
  for (const x of [{ value: 2 }, [1, 2], 2, null, new Date(0), new JsonFloat("2.0")]) {
    denied(() => sqlJsonText(x));
  }
});
Deno.test("SQL duplicate JSON keys fail including escaped and nested duplicates", () => {
  for (
    const x of ['{"value":2,"value":2.0}', '{"value":1,"v\\u0061lue":2}', '[{"value":1,"value":2}]']
  ) denied(() => sqlJsonText(x));
});
Deno.test("SQL JSON malformed text nonfinite trailing content and byte budget fail safely", () => {
  for (const x of ['{"value":NaN}', "[1,]", '{"value":1}x', '{"value":Infinity}']) {
    denied(() => sqlJsonText(x));
  }
  denied(() => sqlJsonText('"가"', 4));
  equal(sqlJsonText('"가"', 5), "가");
});
Deno.test("SQL integer text is exact and cannot coerce decimals bool or unsafe driver numbers", () => {
  equal(sqlIntegerText("2"), 2);
  assert(sqlIntegerText("9007199254740993") === 9007199254740993n);
  for (const x of [2, 2.0, true, "2.0", " 2", "+2", "02", "2e0"]) denied(() => sqlIntegerText(x));
});
Deno.test("SQL numeric preserves decimal scale without binary floating point", () => {
  equal(sqlDecimalText("2.0").lexeme, "2.0");
  equal(
    sqlDecimalText("0.12345678901234567890123456789").lexeme,
    "0.12345678901234567890123456789",
  );
  for (const x of [2, null, "NaN", "Infinity", "2/3", " 2"]) denied(() => sqlDecimalText(x));
});
Deno.test("SQL UTC keeps microseconds and calendar dates remain separate", () => {
  equal(sqlUtcText("2026-10-14T00:00:00.123456Z"), "2026-10-14T00:00:00.123456Z");
  equal(sqlDateText("2026-10-14"), "2026-10-14");
  for (
    const x of [
      new Date(0),
      "2026-10-14T00:00:00Z",
      "2026-10-14T09:00:00.123456+09:00",
      "2026-02-30T00:00:00.000001Z",
    ]
  ) denied(() => sqlUtcText(x));
  for (const x of [new Date(0), "2026-02-30", "2026-10-14T00:00:00Z"]) denied(() => sqlDateText(x));
});
Deno.test("SQL driver requires structural float date and array columns to be explicitly text", () => {
  requireSqlTextColumns([{ type: 25 }, { type: 16 }, { type: 23 }, { type: 20 }, { type: 1700 }]);
  for (const type of [114, 3802, 199, 3807, 1007, 1009, 1082, 1114, 1184, 700, 701]) {
    denied(() => requireSqlTextColumns([{ type }]));
  }
});
