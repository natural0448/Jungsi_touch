/* 화면에서 쓰는 선 아이콘. 이모지·기호 문자 대신 이것만 쓴다. */

export function LockIcon({ size = 13 }: { size?: number }) {
  return (
    <svg className="ic-lock" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg className="ic-chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}
