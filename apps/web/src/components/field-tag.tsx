import { fieldGroupOf, FIELD_UNKNOWN, type FieldBasis } from "@/lib/field-group";

const TITLE: Record<FieldBasis, string | null> = {
  "2025": "대교협 2025 학과 분류를 참고한 값입니다. 2027 분류는 확인 중입니다.",
  guide2027: "이 대학의 2027 모집요강에 적힌 계열입니다.",
  draft2027: "이 대학의 2027 요강 초안에 적힌 계열입니다. 확정 전 참고값입니다.",
  free: null,
};

/** 학과 계열 표시. 2025 분류를 참고한 값은 그 사실을 함께 적고, 모르면 '기타'라고만 적는다 */
export function FieldTag({ id }: { id: string }) {
  const f = fieldGroupOf(id);
  if (!f) return <span className="fg none">{FIELD_UNKNOWN}</span>;
  return (
    <span className="fg" title={TITLE[f.basis] ?? undefined}>
      {f.name}
      {f.note && <small> · {f.note}</small>}
    </span>
  );
}
