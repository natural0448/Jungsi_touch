/** Opaque report locator cursor. Existing secret key is separated by authenticated purpose. */
import { AccessError } from "../application/access.ts";
import type { OwnReportCursorPort, OwnReportPosition } from "../application/own_report_list.ts";
const AAD = new TextEncoder().encode("jungsi.report.list-own.cursor/v1");
const FIELDS = [
  "format",
  "owner",
  "examId",
  "asOfUtc",
  "expiresAtUtc",
  "afterUpdatedAtUtc",
  "afterReportId",
];
function invalid(): never {
  throw new AccessError("invalid_cursor", 422);
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) invalid();
  try {
    return Uint8Array.from(
      atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)),
      (c) => c.charCodeAt(0),
    );
  } catch {
    return invalid();
  }
}
export class OwnReportCursor implements OwnReportCursorPort {
  private readonly key: Promise<CryptoKey>;
  constructor(secret: Uint8Array, private readonly maxCharacters: number) {
    if (
      !(secret instanceof Uint8Array) || secret.length !== 32 ||
      !Number.isSafeInteger(maxCharacters) || maxCharacters < 1
    ) throw new AccessError("security_policy_unavailable", 503);
    this.key = crypto.subtle.importKey("raw", Uint8Array.from(secret), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
  async seal(position: OwnReportPosition): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const raw = new TextEncoder().encode(JSON.stringify(position));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: AAD },
        await this.key,
        raw,
      ),
    );
    const token = "rl1." + encode(iv) + "." + encode(ciphertext);
    if (token.length > this.maxCharacters) {
      throw new AccessError("security_policy_unavailable", 503);
    }
    return token;
  }
  async open(token: string): Promise<OwnReportPosition> {
    try {
      if (typeof token !== "string" || token.length > this.maxCharacters) invalid();
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== "rl1") invalid();
      const iv = decode(parts[1]);
      if (iv.length !== 12) invalid();
      const raw = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: Uint8Array.from(iv), additionalData: AAD },
        await this.key,
        Uint8Array.from(decode(parts[2])),
      );
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
      const row = value as Record<string, unknown>;
      if (
        Object.keys(row).length !== FIELDS.length || FIELDS.some((k) => !Object.hasOwn(row, k)) ||
        row.format !== "jungsi.own-report-cursor/v1" ||
        FIELDS.filter((k) => k !== "examId").some((k) => typeof row[k] !== "string") ||
        row.examId !== null && typeof row.examId !== "string"
      ) invalid();
      return row as unknown as OwnReportPosition;
    } catch {
      return invalid();
    }
  }
}
