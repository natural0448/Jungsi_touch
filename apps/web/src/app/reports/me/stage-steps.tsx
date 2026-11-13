import { LockIcon } from "@/components/icons";
import type { InputStage } from "@/lib/exam";

/**
 * 수능 성적 입력 단계 표시(2026-11-12 최종관리자 결정). 수능일 이후에만 보이며 9월 모의평가 단계는 없다.
 * 지금 단계는 서버 입력 상태(stage)가 정한다.
 */
/** finalOpen: 실채점 입력이 열렸는지(성적표 배부 뒤). 배부 전 실채점 안내 화면에서는 가채점이 아직 잠기지 않는다 */
export function StageSteps({ stage, finalOpen = stage === "final" }: { stage: InputStage; finalOpen?: boolean }) {
  if (stage === "mock") return null;
  // 성적표 배부 뒤(실채점 단계)에는 가채점 단계가 잠겨 입력·확인할 수 없다(2026-11-12 최종관리자 결정)
  const finalNow = stage === "final" && finalOpen;
  // 두 단계 모두 같은 기준(성적표 배부일, lib/csat-release.ts 의 당일 포함 규칙)으로 말한다(2026-11-13 최종관리자 지시)
  const steps: { k: InputStage; label: string; sub: string; cls?: string }[] = [
    { k: "provisional", label: "수능 가채점", sub: "성적표 배부일부터 잠김", cls: finalNow ? "locked" : "on" },
    { k: "final", label: "수능 실채점", sub: "성적표 배부일부터 입력", cls: finalNow ? "on" : undefined },
  ];
  return (
    <ol className="rp-steps" aria-label="성적 입력 단계">
      {steps.map((s) => (
        <li key={s.k} className={s.cls} aria-current={s.cls === "on" ? "step" : undefined} aria-disabled={s.cls === "locked" || undefined}>
          <b>{s.cls === "locked" && <LockIcon size={12} />} {s.label}</b>
          <small>{s.sub}</small>
        </li>
      ))}
    </ol>
  );
}
