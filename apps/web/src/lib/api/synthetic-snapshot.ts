import "server-only";
import type { SnapshotHeadDto, SnapshotPartPin } from "@/lib/dto";
import { ConnectionError, SnapshotChanged } from "./source";

/*
  합성 모드의 1페이지 정리본. 화면 제작·검토 때 담당자 전달 꾸러미의 공개 발행본 폴더
  (publication/: head·manifest·분할 .json.gz)를 그대로 읽어 실제와 같은 크기·모양으로 연결을 시험한다.
  폴더는 Git 에 넣지 않고 JUNGSI_SYNTHETIC_SNAPSHOT_DIR 로만 가리킨다. 없으면 '연결 대기'로 끝난다.
  응답은 실제 API 처럼 gzip 을 푼 원문 bytes 다(받는 쪽이 decoded pins 로 대조).
*/

type Manifest = {
  counts: SnapshotHeadDto["counts"];
  generated_at: string;
  normalization_rules_version: string;
  parts: (SnapshotPartPin & { object_key: string })[];
  full: (SnapshotPartPin & { object_key: string }) | null;
  schema_version?: string;
  selection_rules_version?: string;
  source_as_of?: string | null;
  r27_scope_coverage?: SnapshotHeadDto["r27_scope_coverage"];
};

const SNAPSHOT_ID = "p1-public-history:00000000000000000001";

async function load(): Promise<{ dir: string; head: Record<string, unknown>; manifest: Manifest }> {
  const dir = process.env.JUNGSI_SYNTHETIC_SNAPSHOT_DIR;
  if (!dir) throw new ConnectionError("unavailable", "snapshot_not_configured");
  const { readdir, readFile } = await import("node:fs/promises");
  const names = await readdir(dir);
  const headName = names.find((n) => n.endsWith(".head.json"));
  const manName = names.find((n) => n.endsWith(".manifest.json"));
  if (!headName || !manName) throw new ConnectionError("unavailable", "snapshot_not_configured");
  const head = JSON.parse(await readFile(`${dir}/${headName}`, "utf-8")) as Record<string, unknown>;
  const manifest = JSON.parse(await readFile(`${dir}/${manName}`, "utf-8")) as Manifest;
  return { dir, head, manifest };
}

const pin = (p: SnapshotPartPin & { object_key: string }): SnapshotPartPin => {
  const out: Partial<typeof p> = { ...p };
  delete out.object_key;
  return out as SnapshotPartPin;
};

export async function syntheticSnapshotHead(): Promise<SnapshotHeadDto> {
  const { head, manifest } = await load();
  return {
    format: "jungsi.history-snapshot-head/v1",
    status: "approved",
    snapshot_id: SNAPSHOT_ID,
    publication_sha256: String((head.manifest as { sha256: string }).sha256),
    source_head_sha256: String(head.source_head_sha256),
    generated_at: manifest.generated_at,
    source_as_of: manifest.source_as_of ?? null,
    schema_version: manifest.schema_version ?? "synthetic",
    normalization_rules_version: manifest.normalization_rules_version,
    selection_rules_version: String(head.selection_rules_version),
    counts: manifest.counts,
    delivery_mode: manifest.full ? "full" : "parts",
    full: manifest.full ? pin(manifest.full) : null,
    parts: manifest.parts.map(pin),
    expires_at: String(head.expires_at),
    ...(manifest.r27_scope_coverage ? { r27_scope_coverage: manifest.r27_scope_coverage } : {}),
  };
}

export async function syntheticSnapshotPart(snapshotId: string, partId: string): Promise<Uint8Array> {
  const { dir, manifest } = await load();
  if (snapshotId !== SNAPSHOT_ID) throw new SnapshotChanged();
  const part = manifest.parts.find((p) => p.part_id === partId);
  if (!part) throw new Error("정시터치 API 404 snapshot_part_not_found");
  const { readFile } = await import("node:fs/promises");
  const { gunzipSync } = await import("node:zlib");
  const gz = await readFile(`${dir}/${part.object_key.split("/").at(-1)}`);
  return new Uint8Array(gunzipSync(gz));
}
