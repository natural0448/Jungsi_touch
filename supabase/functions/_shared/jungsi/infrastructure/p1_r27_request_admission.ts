/**
 * REVIEW ONLY: request-local v2 consumer admission.
 * The two descriptor settings are trusted only when provisioned by an independently
 * authorized Owner process. A SHA match or an "approved" string is not issuer authentication.
 * The credential authenticates its holder, not the bytes of the running consumer build.
 */
import { JsonFloat, parseNativeJson } from "../domain/native_json.ts";
import { AccessError } from "../application/access.ts";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{43,128}$/;
const OPS = ["history.snapshot.head", "history.snapshot.read"] as const;
const PIN_NAMES = [
  "headSha256",
  "manifestSha256",
  "sourceHeadSha256",
  "scopeSha256",
  "indexSha256",
  "coverageSha256",
  "globalReceiptSha256",
  "consumerReceiptSha256",
  "consumerBuildSha256",
  "consumerContractSha256",
] as const;

type PinName = typeof PIN_NAMES[number];
type Pins = Readonly<Record<PinName, string>>;
type Environment = { get(name: string): string | undefined };
type Execution = {
  readonly operation: string;
  readonly session: {
    readonly evaluatedAtUtc: bigint;
    readonly user: { readonly subjectId: string; readonly expiresAtUtc: bigint };
  };
};
type Binding = {
  readonly descriptorSha256: string;
  readonly expiresAtUtc: bigint;
  readonly operations: readonly string[];
  readonly readLimits: { readonly maxBytes: number };
  readonly readViews?: {
    readonly snapshot: { readonly scopeSha256: string; readonly maxMetadataBytes: number };
  };
};
type Trust = Readonly<{ pins: Pins; maxExtraBytes: number; maxIndexBytes: number }>;
type AdmissionInput = Readonly<
  Pick<
    Pins,
    | "headSha256"
    | "manifestSha256"
    | "scopeSha256"
    | "consumerBuildSha256"
    | "consumerContractSha256"
  >
>;
export interface P1R27RequestInputs {
  readonly trust: Trust;
  readonly admission: { assertBoundConsumer(input: AdmissionInput): void };
}
type Config = Readonly<{
  trust: Trust;
  credentialSha: string;
  expires: bigint;
  operations: readonly string[];
  configText: string;
  configSha: string;
}>;

class P1R27ValidationFailure extends Error {
  constructor() {
    super("p1_r27_admission_unavailable");
  }
}
function invalid(): never {
  // Fixed text only: safeFailure maps this to a generic 503.
  throw new P1R27ValidationFailure();
}
function closed(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonFloat) {
    invalid();
  }
  const object = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(object);
  if (keys.length !== names.length || names.some((name) => !Object.hasOwn(object, name))) invalid();
  const out: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid();
    out[name] = descriptor.value;
  }
  return out;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) invalid();
  return value;
}
function positive(value: unknown, max: number): number {
  if (
    !Number.isSafeInteger(max) || max < 1 || typeof value !== "number" ||
    !Number.isSafeInteger(value) || value < 1 || value > max
  ) invalid();
  return value;
}
function instant(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value)) invalid();
  return BigInt(value);
}
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function unhex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g)!, (part) => Number.parseInt(part, 16));
}
/** Native WebCrypto verification, never emit either token or its derived digest. */
async function sameDigest(
  left: Uint8Array<ArrayBuffer>,
  right: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const algorithm = { name: "HMAC", hash: "SHA-256" };
  const message = new TextEncoder().encode("jungsi.p1-r27-consumer-credential/v1");
  const expected = await crypto.subtle.importKey("raw", left, algorithm, false, ["verify"]);
  const actual = await crypto.subtle.importKey("raw", right, algorithm, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", actual, message);
  return await crypto.subtle.verify("HMAC", expected, signature, message);
}
async function readConfig(env: Environment, binding: Binding, now: bigint): Promise<Config | null> {
  const raw = env.get("JUNGSI_P1_R27_CONSUMER_BINDING_JSON");
  const expected = env.get("JUNGSI_P1_R27_CONSUMER_BINDING_SHA256");
  if (raw === undefined && expected === undefined) return null;
  if (typeof raw !== "string" || typeof expected !== "string" || !HASH.test(expected)) invalid();
  const textBytes = new TextEncoder().encode(raw);
  if (!textBytes.length || textBytes.length > 16384 || hex(await digest(textBytes)) !== expected) {
    invalid();
  }
  let parsed: unknown;
  try {
    parsed = parseNativeJson(raw);
  } catch {
    return invalid();
  }
  const d = closed(parsed, [
    "format",
    "status",
    "purpose",
    "api_binding_sha256",
    "approval_reference_sha256",
    "deployment_evidence_sha256",
    "consumer_id",
    "credential_sha256",
    "expires_at_utc_micros",
    "operations",
    "max_extra_bytes",
    "max_index_bytes",
    "pins",
  ]);
  if (
    d.format !== "jungsi.p1-r27-server-admission/v1" || d.status !== "approved" ||
    d.purpose !== "history_snapshot_r27_consumer" ||
    hash(d.api_binding_sha256) !== binding.descriptorSha256 ||
    typeof d.consumer_id !== "string" || !ID.test(d.consumer_id)
  ) invalid();
  hash(d.approval_reference_sha256);
  hash(d.deployment_evidence_sha256);
  const credentialSha = hash(d.credential_sha256);
  const pinData = closed(d.pins, PIN_NAMES);
  const pins = Object.freeze(
    Object.fromEntries(PIN_NAMES.map((key) => [key, hash(pinData[key])])),
  ) as unknown as Pins;
  if (!binding.readViews || pins.scopeSha256 !== binding.readViews.snapshot.scopeSha256) invalid();
  const expires = instant(d.expires_at_utc_micros);
  if (typeof now !== "bigint" || now < 0n || expires <= now || expires > binding.expiresAtUtc) {
    invalid();
  }
  if (
    !Array.isArray(d.operations) || !d.operations.length || d.operations.length > OPS.length ||
    d.operations.some((operation) =>
      typeof operation !== "string" ||
      !OPS.includes(operation as typeof OPS[number]) || !binding.operations.includes(operation)
    ) ||
    new Set(d.operations).size !== d.operations.length
  ) invalid();
  const maxExtraBytes = positive(d.max_extra_bytes, binding.readLimits.maxBytes);
  const maxIndexBytes = positive(
    d.max_index_bytes,
    Math.min(binding.readViews.snapshot.maxMetadataBytes, 8388608),
  );
  if (maxIndexBytes > maxExtraBytes) invalid();

  return Object.freeze({
    trust: Object.freeze({ pins, maxExtraBytes, maxIndexBytes }),
    credentialSha,
    expires,
    operations: Object.freeze([...d.operations] as string[]),
    configText: raw,
    configSha: expected,
  });
}

/** This guard is constructed once for the actual Request in the server composition root. */
export class P1R27RequestAdmission {
  #request: Request | null;
  #clock: () => bigint;
  #lastNow: bigint | null = null;
  #active = true;
  #prepared = false;
  #claimed = false;
  #used = false;
  #execution: Execution | null = null;
  #subject = "";
  #operation = "";
  #userExpiry = 0n;
  #trust: Trust | null = null;
  #descriptorExpiry = 0n;
  #env: Environment | null = null;
  #configText = "";
  #configSha = "";

  constructor(request: Request, clock: () => bigint) {
    this.#request = request;
    this.#clock = clock;
  }
  /** Reject invalid or backwards guard time samples; no coercion or silent fallback. */
  #readNow(): bigint {
    const now = this.#clock();
    if (
      typeof now !== "bigint" || now < 0n ||
      this.#lastNow !== null && now < this.#lastNow
    ) invalid();
    this.#lastNow = now;
    return now;
  }
  /** Called by the business branch only after relay, session and member checks. */
  async prepare(
    env: Environment,
    binding: Binding,
    request: Request,
    execution: Execution,
  ): Promise<void> {
    if (!this.#active || this.#prepared || request !== this.#request) invalid();
    this.#prepared = true;
    const now = this.#readNow(), user = execution?.session?.user;
    if (
      !OPS.includes(execution?.operation as typeof OPS[number]) ||
      typeof execution?.session?.evaluatedAtUtc !== "bigint" ||
      execution.session.evaluatedAtUtc < 0n || execution.session.evaluatedAtUtc > now ||
      !user || typeof user.subjectId !== "string" || !user.subjectId.trim() ||
      typeof user.expiresAtUtc !== "bigint"
    ) invalid();
    if (user.expiresAtUtc <= now) throw new AccessError("authentication_required", 401);
    this.#execution = execution;
    this.#subject = user.subjectId;
    this.#operation = execution.operation;
    this.#userExpiry = user.expiresAtUtc;
    let config: Config | null;
    try {
      config = await readConfig(env, binding, now);
    } catch (error) {
      // Only malformed/unapproved optional R27 configuration loses its capability.
      // Unexpected env/crypto errors and common binding/auth/budget errors propagate.
      if (error instanceof P1R27ValidationFailure) return;
      throw error;
    }
    if (!config || !config.operations.includes(execution.operation)) return;
    // Equality alone can be tested here; independent random generation remains an Owner requirement.
    const relay = env.get("JUNGSI_RELAY_TOKEN");
    if (typeof relay !== "string" || relay.length < 32 || relay.length > 512) invalid();
    const relayHash = await digest(new TextEncoder().encode(relay));
    if (await sameDigest(unhex(config.credentialSha), relayHash)) return;
    const credential = request.headers.get("X-Jungsi-P1-R27-Consumer-Credential");
    if (typeof credential !== "string" || !CREDENTIAL.test(credential)) return;
    const actual = await digest(new TextEncoder().encode(credential));
    if (!await sameDigest(unhex(config.credentialSha), actual)) return;
    // Re-check after async crypto; no credential is retained in guard state.
    if (
      !this.#active || execution.operation !== this.#operation || execution.session.user !== user ||
      user.subjectId !== this.#subject
    ) invalid();
    const after = this.#readNow();
    if (after >= config.expires) invalid();
    if (after >= this.#userExpiry) throw new AccessError("authentication_required", 401);
    this.#trust = config.trust;
    this.#descriptorExpiry = config.expires;
    this.#env = env;
    this.#configText = config.configText;
    this.#configSha = config.configSha;
  }
  /** Claim must match the same execution object and authenticated owner. */
  take(execution: Execution, owner: string): P1R27RequestInputs | undefined {
    if (
      !this.#active || !this.#prepared || this.#claimed || execution !== this.#execution ||
      owner !== this.#subject || execution.operation !== this.#operation ||
      execution.session.user.subjectId !== this.#subject ||
      execution.session.user.expiresAtUtc !== this.#userExpiry
    ) invalid();
    this.#claimed = true;
    if (!this.#trust) return undefined;
    const trust = this.#trust;
    const admission = Object.freeze({
      assertBoundConsumer: (input: AdmissionInput): void => {
        if (this.#used) invalid();
        this.#assertFresh();
        this.#used = true;
        const actual = closed(input, [
          "headSha256",
          "manifestSha256",
          "scopeSha256",
          "consumerBuildSha256",
          "consumerContractSha256",
        ]);
        for (
          const key of [
            "headSha256",
            "manifestSha256",
            "scopeSha256",
            "consumerBuildSha256",
            "consumerContractSha256",
          ] as const
        ) {
          if (actual[key] !== trust.pins[key]) invalid();
        }
      },
    });
    return Object.freeze({ trust, admission });
  }
  #assertFresh(): void {
    const execution = this.#execution, env = this.#env;
    if (
      !this.#active || !execution || !env ||
      execution.operation !== this.#operation ||
      execution.session.user.subjectId !== this.#subject ||
      execution.session.user.expiresAtUtc !== this.#userExpiry ||
      env.get("JUNGSI_P1_R27_CONSUMER_BINDING_JSON") !== this.#configText ||
      env.get("JUNGSI_P1_R27_CONSUMER_BINDING_SHA256") !== this.#configSha
    ) invalid();
    const now = this.#readNow();
    if (now >= this.#descriptorExpiry) invalid();
    if (now >= this.#userExpiry) throw new AccessError("authentication_required", 401);
  }
  /** Once v2 was admitted, require the same live request and configuration at delivery. */
  assertCurrent(): void {
    if (this.#used) this.#assertFresh();
  }
  close(): void {
    this.#active = false;
    this.#request = null;
    this.#execution = null;
    this.#trust = null;
    this.#subject = "";
    this.#operation = "";
    this.#lastNow = null;
    this.#userExpiry = 0n;
    this.#descriptorExpiry = 0n;
    this.#env = null;
    this.#configText = "";
    this.#configSha = "";
  }
}
