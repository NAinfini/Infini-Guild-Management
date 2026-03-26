import type { ReactNode } from "react";

type CompareBarProps = {
  classPrefix: string;
  icon: ReactNode;
  label: string;
  own: number;
  enemy: number;
};

export function CompareBar({ classPrefix: p, icon, label, own, enemy }: CompareBarProps) {
  const total = own + enemy || 1;
  const ownPct = Math.round((own / total) * 100);
  const enemyPct = 100 - ownPct;

  return (
    <div className={`${p}row`}>
      <div className={`${p}label`}>
        <span className={`${p}label-icon`}>{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`${p}bar-wrap`}>
        <span className={`${p}val ${p}val--left`}>{own.toLocaleString()}</span>
        <div className={`${p}bar`}>
          <div
            className={`${p}bar-fill ${p}bar-fill--own${ownPct >= enemyPct ? ` ${p}bar-fill--winning` : ""}`}
            style={{ width: `${ownPct}%` }}
          />
          <div
            className={`${p}bar-fill ${p}bar-fill--enemy${enemyPct > ownPct ? ` ${p}bar-fill--winning` : ""}`}
            style={{ width: `${enemyPct}%` }}
          />
        </div>
        <span className={`${p}val ${p}val--right`}>{enemy.toLocaleString()}</span>
      </div>
    </div>
  );
}
