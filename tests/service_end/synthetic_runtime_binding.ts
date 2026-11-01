/** Invented configuration, control bytes and resource limits. Never approved deployment input. */
import { API_OPERATION_IDS } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
import {
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { utcInstant } from "../../supabase/functions/_shared/jungsi/domain/time.ts";
import {
  readApprovedRuntimeBinding,
  readBasicRuntimeSettings,
  type RuntimeEnvironment,
} from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_settings.ts";
export const SYNTHETIC_RUNTIME_URL = "https://abcdefghijklmnopqrst.supabase.co";
export const SYNTHETIC_RUNTIME_NOW = utcInstant("2026-10-15T00:00:00Z");
export async function syntheticRuntimePin(text: string) {
  const bytes = new TextEncoder().encode(text);
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { bytes, sha256 };
}
export async function syntheticRuntimeBinding(
  change: (raw: NativeObject) => void = () => {},
  changeHead: (raw: NativeObject) => void = () => {},
  changeControlBodies: (bodies: Record<string, string>) => void = () => {},
) {
  const scope = {
    operations: [...API_OPERATION_IDS],
    artifacts: [{ kind: "catalog", key: "service" }],
  };
  const body: Record<string, string> = {
    registry: '{"format":"jungsi.data-registry/v1","entries":[]}',
    selection:
      '{"format":"jungsi.runtime-selection/v1","required":[{"kind":"catalog","key":"service"}]}',
    usage_policy: '{"format":"jungsi.runtime-usage-policy/v1","version":"SYNTHETIC-policy"}',
  };
  const sources: NativeObject = {};
  changeControlBodies(body);
  for (const name of Object.keys(body)) {
    const pin = await syntheticRuntimePin(body[name]);
    sources[name] = {
      object_key: "SYNTHETIC/" + name + ".json",
      bytes: pin.bytes.length,
      sha256: pin.sha256,
    };
  }
  const head: NativeObject = {
    format: "jungsi.native-selection-head/v1",
    status: "approved",
    purpose: "jungsi-api-runtime",
    project_url: SYNTHETIC_RUNTIME_URL,
    scope_sha256: await nativeJsonSha256(scope),
    registry_sha256: (sources.registry as NativeObject).sha256,
    selection_sha256: (sources.selection as NativeObject).sha256,
    usage_policy_sha256: (sources.usage_policy as NativeObject).sha256,
    approval_reference_sha256: "a".repeat(64),
    expires_at: "2026-10-15T01:00:00Z",
  };
  changeHead(head);
  body.head = nativeJsonText(head);
  const headPin = await syntheticRuntimePin(body.head);
  sources.head = {
    object_key: "SYNTHETIC/head.json",
    bytes: headPin.bytes.length,
    sha256: headPin.sha256,
  };
  const descriptor: NativeObject = {
    format: "jungsi.edge-api-binding/v1",
    status: "approved",
    purpose: "jungsi-api-runtime",
    project_url: SYNTHETIC_RUNTIME_URL,
    approval_reference_sha256: "a".repeat(64),
    expires_at: "2026-10-15T01:00:00Z",
    worker_plan: "paid",
    scope,
    sources,
    limits: {
      storage: {
        max_artifact_bytes: 65536,
        max_bucket_bytes: 65536,
        max_metadata_bytes: 1024,
        request_timeout_ms: 1000,
      },
      read: { max_requests: 64, max_bytes: 65536 },
      repositories: {
        max_record_bytes: 65536,
        max_forecast_rows: 8,
        max_batch_ids: 8,
      },
      usage_store: {
        lease_seconds: 406,
        runtime_hard_limit_seconds: 400,
        clock_margin_seconds: 5,
      },
    },
  };
  change(descriptor);
  const updatedScopeHash = await nativeJsonSha256(descriptor.scope);
  if (
    updatedScopeHash !== head.scope_sha256 &&
    head.scope_sha256 === await nativeJsonSha256(scope) &&
    descriptor.scope !== scope
  ) {
    head.scope_sha256 = updatedScopeHash;
    body.head = nativeJsonText(head);
    const updatedHead = await syntheticRuntimePin(body.head);
    Object.assign((descriptor.sources as NativeObject).head as NativeObject, {
      bytes: updatedHead.bytes.length,
      sha256: updatedHead.sha256,
    });
  }
  const raw = nativeJsonText(descriptor), pin = await syntheticRuntimePin(raw);
  const values: Record<string, string> = {
    SUPABASE_URL: SYNTHETIC_RUNTIME_URL,
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_SYNTHETIC",
    DATABASE_URL:
      "postgresql://jungsi_backend_app.abcdefghijklmnopqrst:SYNTHETIC@aws-0.synthetic.pooler.supabase.com:6543/postgres?sslmode=verify-full",
    JUNGSI_DATABASE_CA: "-----BEGIN CERTIFICATE-----\nMA==\n-----END CERTIFICATE-----\n",
    JUNGSI_RELAY_TOKEN: "SYNTHETIC-relay-runtime-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    SUPABASE_SECRET_KEY: "sb_secret_SYNTHETIC",
    JUNGSI_SUPABASE_STORAGE_BUCKET: "synthetic-private",
    JUNGSI_SUPABASE_STORAGE_PREFIX: "SYNTHETIC/",
    JUNGSI_API_BINDING_JSON: raw,
    JUNGSI_API_BINDING_SHA256: pin.sha256,
    JUNGSI_API_BINDING_MAX_BYTES: "65536",
  };
  const env: RuntimeEnvironment = { get: (name) => values[name] };
  return {
    env,
    values,
    descriptor,
    head,
    body,
    load: () =>
      readApprovedRuntimeBinding(
        env,
        readBasicRuntimeSettings(env),
        SYNTHETIC_RUNTIME_NOW,
      ),
  };
}
