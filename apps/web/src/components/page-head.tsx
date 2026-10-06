import type { ReactNode } from "react";

export function PageHead({ kicker, title, desc, side }: { kicker?: string; title: ReactNode; desc?: ReactNode; side?: ReactNode }) {
  return (
    <div className="pg-head">
      <div className="wrap row">
        <div>
          {kicker && <div className="kicker">{kicker}</div>}
          <h1>{title}</h1>
          {desc && <p>{desc}</p>}
        </div>
        {side && <div className="side">{side}</div>}
      </div>
    </div>
  );
}
