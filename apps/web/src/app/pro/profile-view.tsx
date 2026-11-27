import { PROFILE_FIELDS, tagsToProfile } from "@/lib/pro-profile";

/** 학생 상담 참고(희망 계열·전공·대학·지역·기타)를 항목별로 보인다. 빈 항목은 그리지 않는다 */
export function ProfileView({ tags, empty = null }: { tags: readonly string[]; empty?: React.ReactNode }) {
  const p = tagsToProfile(tags);
  const rows = PROFILE_FIELDS.filter((f) => p[f.key].length > 0);
  if (rows.length === 0) return <>{empty}</>;
  return (
    <dl className="pro-prof">
      {rows.map((f) => (
        <div key={f.key}>
          <dt>{f.label}</dt>
          <dd>{p[f.key].join(", ")}</dd>
        </div>
      ))}
    </dl>
  );
}
