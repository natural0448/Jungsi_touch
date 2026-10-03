import type { SchoolBucket } from "@/lib/contract";

export const PATH = "/admissions/favorable";

/** 학교 탐색 분류 화면 이름(v0.12 school_bucket_ui_labels) */
export const BUCKETS: { v: SchoolBucket; label: string }[] = [
  { v: "challenge", label: "도전학교" },
  { v: "core", label: "핵심학교" },
  { v: "room", label: "여유 후보" },
];

export interface Query {
  bucket?: SchoolBucket;
  open?: string; // 펼친 학교 university_id
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 60) || undefined;

export function parseQuery(sp: Record<string, string | string[] | undefined>): Query {
  const b = one(sp.bucket);
  return { bucket: BUCKETS.some((x) => x.v === b) ? (b as SchoolBucket) : undefined, open: one(sp.open) };
}

export function hrefWith(cur: Query, patch: Partial<Query>) {
  const next = { ...cur, ...patch };
  const u = new URLSearchParams();
  if (next.bucket) u.set("bucket", next.bucket);
  if (next.open) u.set("open", next.open);
  const s = u.toString();
  return s ? `${PATH}?${s}` : PATH;
}
