import { fieldGroupOf, FIELD_UNKNOWN } from "@/lib/field-group";

/** 학과 계열 표시. 2025 분류를 참고한 값은 그 사실을 함께 적고, 모르면 '계열 확인 중'이라고만 적는다 */
export function FieldTag({ id }: { id: string }) {
  const f = fieldGroupOf(id);
  if (!f) return <span className="fg none">{FIELD_UNKNOWN}</span>;
  return (
    <span className="fg" title={f.provisional ? "대교협 2025 학과 분류를 참고한 값입니다. 2027 분류는 확인 중입니다." : undefined}>
      {f.name}
      {f.provisional && <small> · 2025 분류 참고</small>}
    </span>
  );
}
