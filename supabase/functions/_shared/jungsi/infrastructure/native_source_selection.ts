import { hasAsciiControl } from "../domain/text.ts";
/** Exact private registry/selection pins. Selected raw sources are not engine or deployment acceptance. */
import { AccessError } from "../application/access.ts";
import { cloneNativeJson, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { utcInstant } from "../domain/time.ts";
import { SupabaseArtifactClient } from "./supabase_artifacts.ts";
export const NATIVE_RUNTIME_KINDS = [
  "exam_pack",
  "total_model",
  "catalog",
  "conversion",
  "percentile",
  "estimate_receipt",
  "analysis",
  "forecast_policy",
  "forecast_inputs",
  "forecast_context",
] as const;
export type NativeRuntimeKind = typeof NATIVE_RUNTIME_KINDS[number];
export type NativePayloadMode = "all" | "catalog_only" | "overall_only" | "university_only";
export interface PinnedSourceBytes {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly maxBytes: number;
}
export interface SelectedNativeArtifact {
  readonly entry: NativeObject;
  readonly payload: NativeObject;
}
function fail(code = "registry_format_invalid"): never {
  throw new AccessError(code, 503);
}
function object(value: unknown): NativeObject {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    value instanceof JsonFloat
  ) fail();
  return value as NativeObject;
}
function identity(kind: unknown, key: unknown): string {
  if (
    typeof kind !== "string" || !kind || typeof key !== "string" || !key.trim() ||
    hasAsciiControl(kind + key)
  ) fail();
  return JSON.stringify([kind, key]);
}
async function pinned(raw: PinnedSourceBytes): Promise<{ body: NativeObject; hash: string }> {
  if (
    !raw || !(raw.bytes instanceof Uint8Array) || !Number.isSafeInteger(raw.maxBytes) ||
    raw.maxBytes < 1 ||
    raw.bytes.length < 1 || raw.bytes.length > raw.maxBytes || typeof raw.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(raw.sha256)
  ) fail();
  // Copy before awaiting the digest so an external mutation cannot change the subsequently parsed bytes.
  const bytes = Uint8Array.from(raw.bytes), expected = raw.sha256;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
  if (hash !== expected) fail("registry_hash_invalid");
  try {
    return {
      body: object(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes))),
      hash,
    };
  } catch {
    fail();
  }
}
export class NativeSourceSelection {
  private readonly artifacts: ReadonlyMap<string, SelectedNativeArtifact>;
  private readonly references: ReadonlyMap<string, NativeObject>;
  private constructor(
    artifacts: ReadonlyMap<string, SelectedNativeArtifact>,
    readonly registryHash: string,
    readonly selectionHash: string,
    selected: ReadonlyMap<string, NativeObject>,
    readonly payloadMode: NativePayloadMode,
  ) {
    this.references = new Map([...selected].map(([id, entry]) => [id, cloneNativeJson(entry)]));
    this.artifacts = new Map([...artifacts].map(([id, row]) => [id, {
      entry: cloneNativeJson(row.entry),
      payload: cloneNativeJson(row.payload),
    }]));
    Object.freeze(this);
  }
  static async prepare(
    client: SupabaseArtifactClient,
    registrySource: PinnedSourceBytes,
    selectionSource: PinnedSourceBytes,
    payloadMode: NativePayloadMode = "all",
  ): Promise<NativeSourceSelection> {
    if (
      !(client instanceof SupabaseArtifactClient) ||
      !["all", "catalog_only", "overall_only", "university_only"].includes(payloadMode)
    ) {
      fail("storage_configuration_invalid");
    }
    const [registry, selection] = await Promise.all([
      pinned(registrySource),
      pinned(selectionSource),
    ]);
    if (
      registry.body.format !== "jungsi.data-registry/v1" || !Array.isArray(registry.body.entries) ||
      selection.body.format !== "jungsi.runtime-selection/v1" ||
      Object.keys(selection.body).sort().join(",") !== "format,required" ||
      !Array.isArray(selection.body.required) || !selection.body.required.length
    ) fail();
    const entries = new Map<string, NativeObject>();
    for (const raw of registry.body.entries) {
      const entry = object(raw), id = identity(entry.kind, entry.key);
      if (entries.has(id)) fail("registry_identity_conflict");
      client.validateReference(entry);
      entries.set(id, entry);
    }
    const chosen = new Map<string, NativeObject>();
    // Validate every selected approval before the first network read. Archive/staged entries stay unselected.
    for (const raw of selection.body.required) {
      const row = object(raw);
      if (
        Object.keys(row).sort().join(",") !== "key,kind" ||
        !NATIVE_RUNTIME_KINDS.includes(row.kind as NativeRuntimeKind)
      ) fail();
      const id = identity(row.kind, row.key);
      if (chosen.has(id)) fail("registry_identity_conflict");
      const entry = entries.get(id);
      if (!entry) fail("runtime_dependency_missing");
      client.validateSelectedReference(entry);
      if (entry.source_timezone != null && typeof entry.source_timezone !== "string") {
        fail("artifact_time_invalid");
      }
      chosen.set(id, entry);
    }
    if (payloadMode === "catalog_only" && [...chosen.values()].some((e) => e.kind !== "catalog")) {
      await client.assertSelectedMetadata([...chosen.values()]);
    }
    if (
      payloadMode === "overall_only" &&
      [...chosen.values()].some((e) => !["exam_pack", "total_model"].includes(e.kind as string))
    ) {
      await client.assertSelectedMetadata([...chosen.values()]);
    }
    if (
      payloadMode === "university_only" &&
      [...chosen.values()].some((e) => e.kind === "total_model")
    ) {
      await client.assertSelectedMetadata([...chosen.values()]);
    }
    const artifacts = new Map<string, SelectedNativeArtifact>();
    for (const [id, entry] of chosen) {
      if (payloadMode === "catalog_only" && entry.kind !== "catalog") continue;
      if (payloadMode === "university_only" && entry.kind === "total_model") continue;
      if (
        payloadMode === "overall_only" &&
        !["exam_pack", "total_model"].includes(entry.kind as string)
      ) continue;
      const verified = await client.artifact(entry), payload = verified.payload;
      if (Object.hasOwn(payload, "as_of") && payload.as_of !== null && payload.as_of !== "") {
        if (
          typeof payload.as_of !== "string" ||
          entry.source_timezone != null && typeof entry.source_timezone !== "string"
        ) fail();
        try {
          utcInstant(
            payload.as_of,
            typeof entry.source_timezone === "string" ? entry.source_timezone : undefined,
          );
        } catch {
          fail("artifact_time_invalid");
        }
      }
      artifacts.set(id, { entry, payload });
    }
    return new NativeSourceSelection(artifacts, registry.hash, selection.hash, chosen, payloadMode);
  }
  reference(kind: NativeRuntimeKind, key: string): NativeObject | null {
    const entry = this.references.get(identity(kind, key));
    return entry ? cloneNativeJson(entry) : null;
  }
  load(kind: NativeRuntimeKind, key: string): SelectedNativeArtifact | null {
    const id = identity(kind, key), row = this.artifacts.get(id);
    if (!row && this.references.has(id)) fail("runtime_dependency_not_loaded");
    return row
      ? { entry: cloneNativeJson(row.entry), payload: cloneNativeJson(row.payload) }
      : null;
  }
  identities(): readonly { kind: NativeRuntimeKind; key: string }[] {
    return Object.freeze(
      [...this.artifacts.values()].map(({ entry }) =>
        Object.freeze({ kind: entry.kind as NativeRuntimeKind, key: entry.key as string })
      ),
    );
  }
  privateReceipt(): NativeObject {
    return {
      format: "jungsi.native-source-selection/v1",
      status: "verified_source_bytes",
      registry_sha256: this.registryHash,
      selection_sha256: this.selectionHash,
      production_ready: false,
      engine_acceptance: "NOT_VERIFIED_BY_RAW_SOURCE_SELECTION",
      ...(this.payloadMode !== "all"
        ? {
          payload_mode: this.payloadMode,
          metadata_status: "validated_all_selected_references",
          selected_metadata_count: this.references.size,
          loaded_payload_count: this.artifacts.size,
          deferred_payload_count: this.references.size - this.artifacts.size,
        }
        : {}),
      artifacts: [...this.artifacts.values()].map(({ entry }) => ({
        kind: entry.kind,
        key: entry.key,
        version: entry.version,
        sha256: entry.sha256,
        bytes: entry.bytes,
      })),
    };
  }
}
