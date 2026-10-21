/** Protected metadata and separately purpose-bound professional cursors. No key generation. */
import { AccessError } from "../application/access.ts";
import type {
  ProfessionalCursorCodec,
  ProfessionalMetadataCipher,
} from "../application/professional_ports.ts";
import { nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { parseNativeJson } from "../domain/native_json.ts";
import { proObject } from "../application/professional_policy.ts";

function encode(bytes: Uint8Array): string {
  let value = "";
  for (let i = 0; i < bytes.length; i += 16384) {
    value += String.fromCharCode(...bytes.subarray(i, i + 16384));
  }
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decode(value: string, maximum: number): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" || !value || value.length > maximum * 2 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) throw new Error("invalid_envelope");
  const input = value.replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(input + "=".repeat((4 - input.length % 4) % 4));
  const result = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  if (result.length > maximum || result.length < 1) throw new Error("invalid_envelope");
  return result;
}
export interface ProfessionalMetadataKeyRing {
  readonly activeKeyId: string;
  readonly keys: readonly { readonly keyId: string; readonly bytes: Uint8Array }[];
}
class ProtectedProfessionalJson {
  private readonly keys = new Map<string, Promise<CryptoKey>>();
  private readonly activeKeyId: string;
  constructor(
    ring: ProfessionalMetadataKeyRing,
    private readonly maximum: number,
    private readonly format: string,
  ) {
    if (
      !ring || !Number.isSafeInteger(maximum) || maximum < 64 || maximum > 8388608 ||
      !Array.isArray(ring.keys) || !ring.keys.length || ring.keys.length > 64
    ) {
      throw new AccessError("professional_crypto_unavailable", 503);
    }
    for (const key of ring.keys) {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key.keyId) || this.keys.has(key.keyId) ||
        !(key.bytes instanceof Uint8Array) || key.bytes.length !== 32
      ) {
        throw new AccessError("professional_crypto_unavailable", 503);
      }
      this.keys.set(
        key.keyId,
        crypto.subtle.importKey("raw", Uint8Array.from(key.bytes), "AES-GCM", false, [
          "encrypt",
          "decrypt",
        ]),
      );
    }
    if (!this.keys.has(ring.activeKeyId)) {
      throw new AccessError("professional_crypto_unavailable", 503);
    }
    this.activeKeyId = ring.activeKeyId;
  }
  async seal(purpose: string, value: NativeObject): Promise<string> {
    try {
      const bytes = new TextEncoder().encode(nativeJsonText(value));
      if (bytes.length > this.maximum) throw new Error("too_large");
      const keyId = this.activeKeyId, iv = crypto.getRandomValues(new Uint8Array(12));
      const aad = new TextEncoder().encode(this.format + "\0" + keyId + "\0" + purpose);
      const body = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: aad },
          await this.keys.get(keyId)!,
          bytes,
        ),
      );
      return nativeJsonText({
        format: this.format,
        key_id: keyId,
        nonce: encode(iv),
        ciphertext: encode(body),
      });
    } catch {
      throw new AccessError("professional_crypto_unavailable", 503);
    }
  }
  async open(purpose: string, value: string): Promise<NativeObject> {
    try {
      if (typeof value !== "string" || value.length > this.maximum * 2 + 1024) {
        throw new Error("invalid_envelope");
      }
      const envelope = proObject(parseNativeJson(value));
      if (
        Object.keys(envelope).length !== 4 || envelope.format !== this.format ||
        typeof envelope.key_id !== "string" ||
        typeof envelope.nonce !== "string" || typeof envelope.ciphertext !== "string" ||
        !this.keys.has(envelope.key_id)
      ) throw new Error("invalid_envelope");
      const iv = decode(envelope.nonce, 12), bytes = decode(envelope.ciphertext, this.maximum + 16);
      if (iv.length !== 12 || bytes.length < 16) throw new Error("invalid_envelope");
      const aad = new TextEncoder().encode(this.format + "\0" + envelope.key_id + "\0" + purpose);
      const body = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        await this.keys.get(envelope.key_id)!,
        bytes,
      );
      if (body.byteLength > this.maximum) throw new Error("too_large");
      return proObject(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(body)));
    } catch {
      throw new AccessError("professional_protected_value_invalid", 503);
    }
  }
}
export class ProfessionalStudentMetadataCipher implements ProfessionalMetadataCipher {
  private readonly codec: ProtectedProfessionalJson;
  constructor(ring: ProfessionalMetadataKeyRing, maximum: number) {
    this.codec = new ProtectedProfessionalJson(
      ring,
      maximum,
      "jungsi.professional-metadata-cipher/v1",
    );
  }
  seal(orgId: string, studentId: string, value: NativeObject): Promise<string> {
    return this.codec.seal("jungsi.pro.metadata/v1\0" + orgId + "\0" + studentId, value);
  }
  open(orgId: string, studentId: string, value: string): Promise<NativeObject> {
    return this.codec.open("jungsi.pro.metadata/v1\0" + orgId + "\0" + studentId, value);
  }
}
export class ProfessionalOperationCipher implements ProfessionalMetadataCipher {
  private readonly codec: ProtectedProfessionalJson;
  constructor(ring: ProfessionalMetadataKeyRing, maximum: number) {
    this.codec = new ProtectedProfessionalJson(
      ring,
      maximum,
      "jungsi.professional-operation-cipher/v1",
    );
  }
  seal(orgId: string, resourceId: string, value: NativeObject): Promise<string> {
    return this.codec.seal("jungsi.pro.operation/v1\0" + orgId + "\0" + resourceId, value);
  }
  open(orgId: string, resourceId: string, value: string): Promise<NativeObject> {
    return this.codec.open("jungsi.pro.operation/v1\0" + orgId + "\0" + resourceId, value);
  }
}
export class ProfessionalCursor implements ProfessionalCursorCodec {
  private readonly codec: ProtectedProfessionalJson;
  constructor(key: Uint8Array, maximum = 8192) {
    this.codec = new ProtectedProfessionalJson(
      { activeKeyId: "cursor", keys: [{ keyId: "cursor", bytes: key }] },
      maximum,
      "jungsi.professional-cursor/v1",
    );
  }
  async seal(payload: NativeObject): Promise<string> {
    return encode(new TextEncoder().encode(await this.codec.seal("jungsi.pro.cursor/v1", payload)));
  }
  async open(token: string): Promise<NativeObject> {
    try {
      return await this.codec.open(
        "jungsi.pro.cursor/v1",
        new TextDecoder("utf-8", { fatal: true }).decode(decode(token, 18000)),
      );
    } catch {
      throw new AccessError("professional_cursor_invalid", 422);
    }
  }
}
