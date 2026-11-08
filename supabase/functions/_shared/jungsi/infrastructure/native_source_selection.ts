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
  "reference_conversion",
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
/**
 * Isolate-level reuse of a verified selection (and its decoded releases) for the same exact
 * registry/selection/approval/expiry pins. Freshness is still checked per request by the provider.
 */
export interface PreparedSelectionEntry {
  readonly selection: NativeSourceSelection;
  readonly decoded: Map<string, unknown>;
}
/**
 * Holds the in-flight or completed preparation per exact pin key, so concurrent cold requests in one
 * isolate share a single prepare+preflight. A failed preparation is removed and never served.
 */
export class PreparedSelectionCache {
  private readonly rows = new Map<string, Promise<PreparedSelectionEntry>>();
  constructor(private readonly maxEntries = 4) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 8) fail();
  }
  get(key: string): Promise<PreparedSelectionEntry> | undefined {
    const row = this.rows.get(key);
    if (row) {
      this.rows.delete(key);
      this.rows.set(key, row);
    }
    return row;
  }
  set(key: string, row: Promise<PreparedSelectionEntry>): void {
    row.catch(() => this.remove(key, row));
    this.rows.delete(key);
    this.rows.set(key, row);
    while (this.rows.size > this.maxEntries) this.rows.delete(this.rows.keys().next().value!);
  }
  remove(key: string, row: Promise<PreparedSelectionEntry>): void {
    if (this.rows.get(key) === row) this.rows.delete(key);
  }
}
export class NativeSourceSelection {
  private readonly artifacts: Map<string, SelectedNativeArtifact>;
  private readonly referenceLoads = new Map<string, Promise<SelectedNativeArtifact | null>>();
  private readonly references: ReadonlyMap<string, NativeObject>;
  private constructor(
    artifacts: ReadonlyMap<string, SelectedNativeArtifact>,
    readonly registryHash: string,
    readonly selectionHash: string,
    selected: ReadonlyMap<string, NativeObject>,
    readonly payloadMode: NativePayloadMode,
    private readonly client: SupabaseArtifactClient,
    shared = false,
  ) {
    // prepare()/rebind() are the only callers and hands over freshly parsed/copied objects nobody else holds,
    // so a second deep copy here only costs CPU (catalog ~1 MiB per request).
    this.references = shared ? selected : new Map(selected);
    // rebind() shares the verified, never-mutated artifact map so loaded rule bodies are reused.
    this.artifacts = shared ? artifacts as Map<string, SelectedNativeArtifact> : new Map(artifacts);
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
      if (entry.kind === "reference_conversion") client.validateReferenceCalculation(entry);
      else client.validateSelectedReference(entry);
      if (entry.source_timezone != null && typeof entry.source_timezone !== "string") {
        fail("artifact_time_invalid");
      }
      chosen.set(id, entry);
    }
    if (
      [...chosen.values()].some((e) => e.kind === "reference_conversion") ||
      payloadMode === "catalog_only" && [...chosen.values()].some((e) => e.kind !== "catalog") ||
      payloadMode === "overall_only" &&
        [...chosen.values()].some((e) =>
          !["exam_pack", "total_model"].includes(e.kind as string)
        ) ||
      payloadMode === "university_only" &&
        [...chosen.values()].some((e) => e.kind === "total_model")
    ) {
      await client.assertSelectedMetadata([...chosen.values()]);
    }
    const artifacts = new Map<string, SelectedNativeArtifact>();
    for (const [id, entry] of chosen) {
      // Metadata and approval remain complete; reference bodies are selected by trusted PK routing.
      if (entry.kind === "reference_conversion") continue;
      if (payloadMode === "catalog_only" && entry.kind !== "catalog") continue;
      if (payloadMode === "university_only" && entry.kind === "total_model") continue;
      if (
        payloadMode === "overall_only" &&
        !["exam_pack", "total_model"].includes(entry.kind as string)
      ) continue;
      const verified = entry.kind === "reference_conversion"
          ? await client.referenceCalculationArtifact(entry)
          : await client.artifact(entry),
        payload = verified.payload;
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
    return new NativeSourceSelection(
      artifacts,
      registry.hash,
      selection.hash,
      chosen,
      payloadMode,
      client,
    );
  }
  /** Same verified selection served through a new request's storage client. */
  rebind(client: SupabaseArtifactClient): NativeSourceSelection {
    if (!(client instanceof SupabaseArtifactClient)) fail("storage_configuration_invalid");
    return new NativeSourceSelection(
      this.artifacts,
      this.registryHash,
      this.selectionHash,
      this.references,
      this.payloadMode,
      client,
      true,
    );
  }
  /** Count without copying every reference entry. */
  referenceCount(): number {
    let n = 0;
    for (const e of this.references.values()) if (e.kind === "reference_conversion") n++;
    return n;
  }
  /** Exact selected identity check without copying (used for production-conversion routing). */
  has(kind: NativeRuntimeKind, key: string): boolean {
    return this.references.has(identity(kind, key));
  }
  /**
   * Read-only view of an already loaded payload for bounded internal checks. Callers MUST NOT mutate
   * or retain it; use load() when a mutable copy is needed.
   */
  peekPayload(kind: NativeRuntimeKind, key: string): Readonly<NativeObject> | null {
    const id = identity(kind, key), row = this.artifacts.get(id);
    if (!row && this.references.has(id)) fail("runtime_dependency_not_loaded");
    return row ? row.payload : null;
  }
  referenceMetadata(): readonly { key: string; entry: NativeObject }[] {
    return [...this.references.values()].filter((e) => e.kind === "reference_conversion")
      .map((e) => ({ key: e.key as string, entry: cloneNativeJson(e) }));
  }
  async loadReference(key: string): Promise<SelectedNativeArtifact | null> {
    if (this.payloadMode === "overall_only" || this.payloadMode === "catalog_only") {
      fail("runtime_dependency_not_loaded");
    }
    const id = identity("reference_conversion", key), entry = this.references.get(id);
    if (!entry) return null;
    const loaded = this.artifacts.get(id);
    if (loaded && !this.referenceLoads.has(id)) {
      return { entry: cloneNativeJson(loaded.entry), payload: cloneNativeJson(loaded.payload) };
    }
    if (!this.referenceLoads.has(id)) {
      this.referenceLoads.set(
        id,
        (async () => {
          const verified = await this.client.referenceCalculationArtifact(entry);
          const value = {
            entry: cloneNativeJson(entry),
            payload: cloneNativeJson(verified.payload),
          };
          this.artifacts.set(id, value);
          return value;
        })(),
      );
    }
    const value = await this.referenceLoads.get(id)!;
    return value
      ? { entry: cloneNativeJson(value.entry), payload: cloneNativeJson(value.payload) }
      : null;
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
      ...(this.referenceCount()
        ? {
          reference_calculation_payloads: "ON_DEMAND_REQUEST_SCOPED_RULE_KEY_CACHE",
          selected_reference_metadata_count: this.referenceCount(),
          loaded_reference_payload_count:
            [...this.artifacts.values()].filter((v) => v.entry.kind === "reference_conversion")
              .length,
        }
        : {}),
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
