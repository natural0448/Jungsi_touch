/** Lossless lexical JSON reader for private native artifacts, not the HTTP DTO parser. */
import { ContractError, requireContract } from "./exact.ts";
export class JsonFloat {
  constructor(readonly lexeme: string) {
    Object.freeze(this);
  }
}
export type NativeJson = null | boolean | string | number | bigint | JsonFloat | NativeJson[] | {
  [key: string]: NativeJson;
};
export function parseNativeJson(text: string): NativeJson {
  let i = 0;
  const ws = () => {
    while (/[ \t\r\n]/.test(text[i] ?? "x")) i++;
  };
  function string(): string {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '"') {
        try {
          return JSON.parse(text.slice(start, i));
        } catch {
          break;
        }
      }
      if (c === "\\") i++;
    }
    throw new Error("native_json_invalid");
  }
  function read(depth: number): NativeJson {
    requireContract(depth <= 128, "native_json_depth");
    ws();
    const c = text[i];
    if (c === '"') return string();
    if (c === "{") {
      i++;
      ws();
      const result: { [key: string]: NativeJson } = Object.create(null);
      if (text[i] === "}") {
        i++;
        return result;
      }
      while (i < text.length) {
        requireContract(text[i] === '"', "native_json_invalid");
        const key = string();
        requireContract(!Object.hasOwn(result, key), "native_json_duplicate_key");
        ws();
        requireContract(text[i++] === ":", "native_json_invalid");
        result[key] = read(depth + 1);
        ws();
        if (text[i] === "}") {
          i++;
          return result;
        }
        requireContract(text[i++] === ",", "native_json_invalid");
        ws();
      }
    } else if (c === "[") {
      i++;
      ws();
      const result: NativeJson[] = [];
      if (text[i] === "]") {
        i++;
        return result;
      }
      while (i < text.length) {
        result.push(read(depth + 1));
        ws();
        if (text[i] === "]") {
          i++;
          return result;
        }
        requireContract(text[i++] === ",", "native_json_invalid");
        ws();
      }
    } else {
      for (const [token, value] of [["true", true], ["false", false], ["null", null]] as const) {
        if (text.startsWith(token, i)) {
          i += token.length;
          return value;
        }
      }
      const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
      if (m) {
        i += m[0].length;
        if (/[.eE]/.test(m[0])) return new JsonFloat(m[0]);
        const n = BigInt(m[0]);
        return n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(n)
          : n;
      }
    }
    throw new Error("native_json_invalid");
  }
  const value = read(0);
  ws();
  requireContract(i === text.length, "native_json_invalid");
  return value;
}
export function canonicalIntegerKeys(value: unknown): Map<bigint, NativeJson> {
  requireContract(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      !(value instanceof JsonFloat),
    "analysis_release_invalid",
  );
  const out = new Map<bigint, NativeJson>();
  for (const [key, child] of Object.entries(value)) {
    requireContract(key.length <= 128 && /^(0|[1-9][0-9]*)$/.test(key), "analysis_release_invalid");
    const n = BigInt(key);
    requireContract(!out.has(n), "analysis_release_invalid");
    out.set(n, child);
  }
  return out;
}

export function parseNativeObject(text: string): { [key: string]: NativeJson } {
  try {
    const value = parseNativeJson(text);
    requireContract(
      value !== null && typeof value === "object" && !Array.isArray(value) &&
        !(value instanceof JsonFloat),
      "storage_artifact_invalid",
    );
    return value as { [key: string]: NativeJson };
  } catch {
    throw new ContractError("storage_artifact_invalid");
  }
}
