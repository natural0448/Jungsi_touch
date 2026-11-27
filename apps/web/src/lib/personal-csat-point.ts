import type { ReferenceBandDto } from "./dto";

type Score = { central: string | null; low: string; high: string };
type Rank = { central: string | null; best: string | null; worst: string | null };

/** Retain the central value of a comparison while keeping its existing component type. */
export function personalCsatScore<T extends Score>(value: T | null | undefined): T | null {
  if (!value) return null;
  const { central } = value;
  if (typeof central !== "string" || !/^[+-]?\d+(?:\.\d+)?$/.test(central) || !Number.isFinite(Number(central))) return null;
  return { ...value, central, low: central, high: central };
}

function personalCsatRank(value: Rank | undefined): Rank | undefined {
  const central = value?.central;
  if (typeof central !== "string" || !/^(?:\d{1,2}(?:\.\d+)?|100(?:\.0+)?|<0\.01)$/.test(central)) return undefined;
  return { central, best: central, worst: central };
}

/** Only the producer's central verdict can be displayed or selected as a single category. */
export function personalCsatPoint(band: ReferenceBandDto | null | undefined): ReferenceBandDto | null {
  if (!band) return null;
  const { upper_code, upper_label: _upperLabel, range_codes: _rangeCodes, position, school_score, school_rank, school_gain, gain_tone, rank_bucket, position_share, ...rest } = band;
  // 서버(jungsi-api v332~)는 범위로만 정해진 행에 judgment_basis "interval" 을 싣고, 가운데로 확정된 행에는 칸을 싣지 않는다
  // (3페이지 응답 크기 상한 때문에 2026-11-24 화면팀). upper_code 가 있으면 범위 판정이다
  const central = band.source === "g" && !band.held && upper_code == null && band.judgment_basis !== "interval";
  return {
    ...rest,
    held: !central,
    school_score: personalCsatScore(school_score) ?? undefined,
    school_rank: central ? personalCsatRank(school_rank) : undefined,
    school_gain: central ? personalCsatScore(school_gain) ?? undefined : undefined,
    position: central ? position : undefined,
    // 무료 공개 응답의 대체 칸도 가운데로 확정된 행에서만 쓴다(숫자 칸과 같은 규칙)
    gain_tone: central ? gain_tone : undefined,
    rank_bucket: central ? rank_bucket : undefined,
    position_share: central ? position_share : undefined,
  };
}
